// SUPPRIMÉ : const fetch = require('node-fetch'); <-- Cette ligne causait l'erreur
const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7860;

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
        const url = isWindows 
            ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
        
        // Utilisation du fetch natif de Node 18 (pas d'import requis)
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        fs.writeFileSync(ytDlpBinaryPath, buffer);
        fs.chmodSync(ytDlpBinaryPath, 0o755);
        
        console.log("✅ yt-dlp installé !");
    } catch (e) {
        console.error("❌ Erreur téléchargement yt-dlp:", e.message);
    }
}

// 1. ROUTE DE RECHERCHE YOUTUBE
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Recherche vide' });

    try {
        // Recherche les 10 premiers résultats avec yt-dlp
        const output = await ytDlp(`ytsearch10:${query}`, {
            dumpSingleJson: true,
            noWarnings: true,
            defaultSearch: 'ytsearch'
        });

        const results = output.entries.map(video => ({
            title: video.title,
            url: video.webpage_url,
            thumbnail: video.thumbnail,
            author: video.uploader,
            duration: video.duration_string
        }));

        res.json(results);
    } catch (err) {
        console.error("Erreur Recherche:", err);
        res.status(500).json({ error: "Erreur lors de la recherche" });
    }
});

app.get('/stream', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('URL manquante');

    const args = [
        videoUrl,
        '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        '-o', '-',
        '--no-playlist',
        '--quiet',
        '--force-ipv4',
        '--extractor-args', 'youtube:player_client=tv_embedded'
    ];

    if (fs.existsSync(cookiesPath)) {
        args.push('--cookies', cookiesPath);
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    const ytDlp = spawn(ytDlpBinaryPath, args);

    ytDlp.stdout.pipe(res);

    ytDlp.stderr.on('data', (data) => {
        console.error(`yt-dlp stderr: ${data}`);
    });

    ytDlp.on('close', (code) => {
        if (code !== 0) console.error(`yt-dlp terminé avec code ${code}`);
        res.end();
    });

    req.on('close', () => {
        ytDlp.kill();
    });
});

(async () => {
    await ensureYtDlp();
    app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur en écoute sur le port ${PORT}`);
});
})();
