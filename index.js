require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const edgeTTS = require('edge-tts-universal');

// Configuration de Groq
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// NUMÉRO DE L'ADMINISTRATEUR (pour recevoir les commandes)
const ADMIN_NUMBER = '2250596569054@c.us';

// Mémoire des conversations : { "numéro": [messages] }
const conversations = {};

// Création du client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Génération du QR Code
client.on('qr', (qr) => {
    console.log('SCANNEZ CE QR CODE AVEC WHATSAPP :');
    qrcode.generate(qr, {small: true});
});

// Notification quand le bot est prêt
client.on('ready', () => {
    console.log('Le bot Vendeur Efficace est prêt et connecté ! ✅');
});

// Fonction pour transcrire l'audio via Groq Whisper
async function transcribeAudio(msg) {
    try {
        const media = await msg.downloadMedia();
        if (!media) return null;

        const filePath = path.join(__dirname, `audio_${Date.now()}.ogg`);

        // Dans whatsapp-web.js, media.data contient la base64 du fichier
        const buffer = Buffer.from(media.data, 'base64');
        fs.writeFileSync(filePath, buffer);

        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-large-v3",
            response_format: "text",
        });

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return transcription;
    } catch (error) {
        console.error("Erreur Whisper:", error);
        return null;
    }
}

// Fonction pour générer un vocal via node-edge-tts
async function sendVoiceResponse(msg, text) {
    try {
        const voice = "fr-FR-DeniseNeural";
        const filePath = path.join(__dirname, `response_${Date.now()}.mp3`);

        // Correction pour edge-tts-universal : la méthode est generateAudio
        await edgeTTS.generateAudio(text, filePath, { voice });

        const audioBuffer = fs.readFileSync(filePath);
        const media = new MessageMedia('audio/mpeg', audioBuffer, 'response.mp3');
        await client.sendMessage(msg.from, media, { sendAudioAsVoice: true });

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
        console.error("Erreur TTS:", error);
        await msg.reply(text); // Fallback vers texte si le vocal échoue
    }
}

// Gestion des messages reçus
client.on('message', async (msg) => {
    let text = msg.body;
    const userNumber = msg.from;

    // Gestion des messages vocaux
    if (msg.type === 'ptt' || msg.type === 'audio') {
        const transcribedText = await transcribeAudio(msg);
        if (!transcribedText) {
            await msg.reply("Désolé, je n'ai pas réussi à comprendre votre message vocal. 😵");
            return;
        }
        text = transcribedText;
        console.log(`Vocal transcrit de ${userNumber}: ${text}`);
    }

    if (text.startsWith('!')) {
        if (text === '!ping') {
            await msg.reply('Pong ! 🏓');
        } else if (text === '!info') {
            await msg.reply('Je suis votre expert Shilajit, propulsé par l\'IA de Groq ! 🤖');
        } else if (text === '!reset') {
            delete conversations[userNumber];
            await msg.reply('Ma mémoire a été effacée pour cette conversation ! 🧹');
        }
        return;
    }

    try {
        if (!conversations[userNumber]) {
            conversations[userNumber] = [];
        }

        conversations[userNumber].push({ role: "user", content: text });

        if (conversations[userNumber].length > 10) {
            conversations[userNumber].shift();
        }

        const messages = [
            {
                role: "system",
                content: "Tu es un assistant de vente efficace pour le Shilajit. Ton but est d'être utile, rapide et direct. \n\nRÈGLES STRICTES :\n1. RÉPONSES TRès COURTES : Maximum 2 phrases. Jamais de longs discours.\n2. PAS DE DÉLIRES : Ne parle pas de philosophie, de miracles ou de choses exagérées. Reste factuel et professionnel.\n3. TARIFS : Produit 10 000 F, Livraison 1 500 F, Expédition 2 000 F.\n4. ACTION : Dès que le client est d'accord, demande SESSION : Nom, Adresse et Téléphone.\n\nStyle : Courtois, professionnel, sans exagération. Pas de poésie, juste du business."
            },
            ...conversations[userNumber]
        ];

        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.1-8b-instant",
        });

        const aiResponse = chatCompletion.choices[0]?.message?.content || "Désolé, je n'ai pas pu générer de réponse.";

        // DÉTECTION DE COMMANDE : Si l'IA a collecté les coordonnées, on envoie la commande à l'admin
        if (aiResponse.toLowerCase().includes("merci") && (aiResponse.toLowerCase().includes("nom") || aiResponse.toLowerCase().includes("adresse"))) {
            const userMsg = conversations[userNumber][conversations[userNumber].length - 2]?.content || "";
            const orderMessage = `📦 *NOUVELLE COMMANDE SHILAJIT*\n\n👤 Client : ${userNumber}\n📝 Détails : ${userMsg}\n\nLe client a finalisé sa commande !`;
            await client.sendMessage(ADMIN_NUMBER, orderMessage);
            console.log(`Commande envoyée à l'admin pour le client ${userNumber}`);
        }

        conversations[userNumber].push({ role: "assistant", content: aiResponse });

        // Réponse : Si l'utilisateur a envoyé un vocal, on répond en vocal. Sinon, en texte.
        if (msg.type === 'ptt' || msg.type === 'audio') {
            await sendVoiceResponse(msg, aiResponse);
        } else {
            await msg.reply(aiResponse);
        }

    } catch (error) {
        console.error("Erreur Groq:", error);
        await msg.reply("Désolé, j'ai eu un petit problème technique avec mon cerveau IA. 😵");
    }
});

client.initialize();
