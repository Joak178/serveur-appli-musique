const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- CONFIGURATION MOTEUR YT-DLP ---
const isWindows = process.platform === 'win32';
const binaryDir = isWindows ? __dirname : '/tmp';
const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpBinaryPath = path.join(binaryDir, fileName);
const cookiesPath = path.join(binaryDir, 'cookies.txt');

function setupCookies() {
    let cookiesContent = process.env.YOUTUBE_COOKIES;
    if (cookiesContent) {
        try {
            cookiesContent = cookiesContent.replace(/\\n/g, '\n');
            fs.writeFileSync(cookiesPath, cookiesContent);
            console.log("🍪 Cookies YouTube chargés !");
        } catch (e) {
            console.error("⚠️ Erreur écriture cookies:", e.message);
        }
    }
}

async function ensureYtDlp() {
    setupCookies();
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 1000000) {
        console.log("✅ Moteur yt-dlp présent.");
        return;
    }
    
    console.log("📥 Téléchargement de yt-dlp...");
    
    try {
        const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        fs.writeFileSync(ytDlpBinaryPath, buffer);
        fs.chmodSync(ytDlpBinaryPath, 0o755);
        
        console.log("✅ yt-dlp installé !");
    } catch (e) {
        console.error("❌ Erreur téléchargement yt-dlp:", e.message);
    }
}

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : null;
}

app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'Recherche vide' });
        const result = await ytSearch(query);
        const videos = result.videos.slice(0, 10).map(item => ({
            title: item.title,
            thumbnail: item.thumbnail,
            url: item.url,
            duration: item.timestamp,
            author: item.author.name
        }));
        res.json(videos);
    } catch (err) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// --- ROUTE POUR OBTENIR L'URL AUDIO (Solution 3) ---
app.get('/get-audio-url', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).json({ error: 'ID introuvable' });
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (!fs.existsSync(ytDlpBinaryPath)) {
        await ensureYtDlp();
        if (!fs.existsSync(ytDlpBinaryPath)) {
            return res.status(503).json({ error: 'Moteur absent' });
        }
    }

    console.log(`🔍 Extraction URL audio pour : ${videoId}`);

    try {
        const args = [
            youtubeUrl,
            '-f', 'bestaudio[ext=m4a]/best',
            '--get-url',
            '--no-playlist',
            '--quiet',
            '--force-ipv4',
            '--extractor-args', 'youtube:player_client=tv_embedded'
        ];

        if (fs.existsSync(cookiesPath)) {
            args.push('--cookies', cookiesPath);
        }

        const audioUrl = execSync(`"${ytDlpBinaryPath}" ${args.join(' ')}`, {
            encoding: 'utf8',
            timeout: 15000
        }).trim();

        if (!audioUrl || !audioUrl.startsWith('http')) {
            throw new Error('URL invalide');
        }

        console.log(`✅ URL audio extraite avec succès`);
        
        res.json({ 
            url: audioUrl,
            mimeType: 'audio/mp4'
        });

    } catch (err) {
        console.error("❌ Erreur extraction:", err.message);
        res.status(500).json({ error: 'Impossible d\'extraire l\'URL audio' });
    }
});

// IMPORTANT : Un seul app.listen à la fin
(async () => {
    await ensureYtDlp();
    app.listen(PORT, () => console.log(`🚀 Serveur prêt sur le port ${PORT}`));
})();
