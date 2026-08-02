# Image de base Node.js
FROM node:20-slim

# Installation de Python 3, FFmpeg et curl (requis pour yt-dlp)
RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Dossier de travail
WORKDIR /app

# Copie des fichiers de dépendances Node
COPY package*.json ./

# Installation des paquets npm
RUN npm install

# Copie du reste du code du serveur
COPY . .

# Koyeb injectera automatiquement la variable PORT
ENV PORT=8080
EXPOSE 8080

# Lancement du serveur
CMD ["node", "server.js"]
