require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const edgeTTS = require('edge-tts-universal');
const http = require('http');

// Configuration de Groq
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const ADMIN_NUMBER = '2250596569054@c.us';
const conversations = {};

// ============================
// SERVEUR WEB POUR QR CODE
// ============================
let qrCodeImage = "";
let botStatus = "⏳ En attente du QR Code...";

const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <html>
        <head>
            <title>Bot Shilajit</title>
            <meta http-equiv="refresh" content="5">
            <style>
                body { font-family: Arial; text-align: center; margin-top: 50px; background: #f0f0f0; }
                .card { background: white; padding: 30px; border-radius: 10px; display: inline-block; }
                img { width: 300px; height: 300px; }
                h2 { color: green; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🤖 Bot Vendeur Shilajit</h1>
                <h2>${botStatus}</h2>
                ${qrCodeImage ? `
                    <p>📱 Scanne ce QR Code avec WhatsApp :</p>
                    <img src="${qrCodeImage}" />
                ` : '<p>⏳ Chargement du QR Code...</p>'}
            </div>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Serveur démarré sur le port ${PORT}`);
});

// ============================
// CLIENT WHATSAPP
// ============================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ]
    }
});

// QR Code en image
client.on('qr', async (qr) => {
    console.log('QR Code généré !');
    botStatus = "📱 Scanne le QR Code ci-dessous !";
    qrCodeImage = await qrcode.toDataURL(qr);
});

// Bot prêt
client.on('ready', () => {
    console.log('✅ Bot Shilajit connecté !');
    botStatus = "✅ Bot connecté et actif !";
    qrCodeImage = "";
});

// Reconnexion automatique
client.on('disconnected', (reason) => {
    console.log('Bot déconnecté :', reason);
    botStatus = "❌ Bot déconnecté - Redémarrage...";
    client.initialize();
});

// ============================
// TRANSCRIPTION AUDIO
// ============================
async function transcribeAudio(msg) {
    try {
        const media = await msg.downloadMedia();
        if (!media) return null;

        const filePath = path.join(__dirname, `audio_${Date.now()}.ogg`);
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

// ============================
// RÉPONSE VOCALE TTS
// ============================
async function sendVoiceResponse(msg, text) {
    try {
        const voice = "fr-FR-DeniseNeural";
        const filePath = path.join(__dirname, `response_${Date.now()}.mp3`);

        await edgeTTS.generateAudio(text, filePath, { voice });

        const audioBuffer = fs.readFileSync(filePath);
        const media = new MessageMedia('audio/mpeg', audioBuffer.toString('base64'), 'response.mp3');
        await client.sendMessage(msg.from, media, { sendAudioAsVoice: true });

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
        console.error("Erreur TTS:", error);
        await msg.reply(text);
    }
}

// ============================
// GESTION DES MESSAGES
// ============================
client.on('message', async (msg) => {
    let text = msg.body;
    const userNumber = msg.from;

    // Messages vocaux
    if (msg.type === 'ptt' || msg.type === 'audio') {
        const transcribedText = await transcribeAudio(msg);
        if (!transcribedText) {
            await msg.reply("Désolé, je n'ai pas réussi à comprendre votre message vocal. 😵");
            return;
        }
        text = transcribedText;
        console.log(`Vocal transcrit de ${userNumber}: ${text}`);
    }

    // Commandes
    if (text.startsWith('!')) {
        if (text === '!ping') {
            await msg.reply('Pong ! 🏓');
        } else if (text === '!info') {
            await msg.reply('Je suis votre expert Shilajit, propulsé par Groq ! 🤖');
        } else if (text === '!reset') {
            delete conversations[userNumber];
            await msg.reply('Ma mémoire a été effacée ! 🧹');
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

        // Détection commande
        if (aiResponse.toLowerCase().includes("merci") && (aiResponse.toLowerCase().includes("nom") || aiResponse.toLowerCase().includes("adresse"))) {
            const userMsg = conversations[userNumber][conversations[userNumber].length - 2]?.content || "";
            const orderMessage = `📦 *NOUVELLE COMMANDE SHILAJIT*\n\n👤 Client : ${userNumber}\n📝 Détails : ${userMsg}\n\nLe client a finalisé sa commande !`;
            await client.sendMessage(ADMIN_NUMBER, orderMessage);
        }

        conversations[userNumber].push({ role: "assistant", content: aiResponse });

        // Réponse vocale ou texte
        if (msg.type === 'ptt' || msg.type === 'audio') {
            await sendVoiceResponse(msg, aiResponse);
        } else {
            await msg.reply(aiResponse);
        }

    } catch (error) {
        console.error("Erreur Groq:", error);
        await msg.reply("Désolé, j'ai eu un problème technique. 😵");
    }
});

client.initialize();