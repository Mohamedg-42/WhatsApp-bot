# Utiliser une image Node.js stable
FROM node:20

# Installer les dépendances système pour Chrome et Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    lsb-release \
    && apt-get install -y chromium \
    && rm -rf /var/lib/apt/lists/*

# Configurer la variable d'environnement pour Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Créer le dossier de l'application
WORKDIR /app

# Copier package.json et package-lock.json
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier le reste du code
COPY . .

# Le port utilisé par Render
EXPOSE 10000

# Lancer l'application
CMD ["npm", "start"]
