const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- CONFIGURATION CHEMINS ---
const isWindows = process.platform === 'win32';
const binaryDir = isWindows ? __dirname : '/tmp';
const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpBinaryPath = path.join(binaryDir, fileName);
const cookiesPath = path.join(binaryDir, 'cookies.txt');

console.log(`🔧 Configuration: Stockage du moteur dans ${ytDlpBinaryPath}`);

// --- GESTION DES COOKIES ---
function setupCookies() {
    const cookiesContent = process.env.YOUTUBE_COOKIES;
    if (cookiesContent) {
        try {
            fs.writeFileSync(cookiesPath, cookiesContent);
            console.log("🍪 Cookies YouTube chargés !");
        } catch (e) {
            console.error("⚠️ Erreur écriture cookies:", e.message);
        }
    } else {
        console.log("ℹ️ Pas de variable YOUTUBE_COOKIES détectée.");
    }
}

// --- INSTALLATION ROBUSTE ---
async function ensureYtDlp() {
    setupCookies();
    
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 0) {
        console.log("✅ Moteur yt-dlp présent.");
        return;
    }
    
    console.log(`⬇️  Téléchargement du moteur...`);
    try {
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        console.log("✅ Moteur installé via librairie !");
    } catch (e) {
        if (!isWindows) {
            try {
                execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${ytDlpBinaryPath}`);
                console.log("✅ Téléchargement réussi via CURL !");
            } catch (curlErr) {
                console.error("❌ Échec total du téléchargement:", curlErr.message);
            }
        }
    }

    if (fs.existsSync(ytDlpBinaryPath)) {
        if (!isWindows) fs.chmodSync(ytDlpBinaryPath, '777');
        console.log("✅ Moteur prêt !");
    }
}
ensureYtDlp();

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

// --- STREAMING DIRECT (Retour à la méthode locale) ---
app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Vérification présence moteur
    if (!fs.existsSync(ytDlpBinaryPath)) {
        await ensureYtDlp();
        if (!fs.existsSync(ytDlpBinaryPath)) return res.status(503).send('Moteur absent');
    }

    console.log(`🎵 Stream Direct demandé : ${videoId}`);

    try {
        res.header('Content-Type', 'audio/mp4');
        res.header('Access-Control-Allow-Origin', '*');

        // Arguments de la méthode locale, adaptés pour Render
        const args = [
            youtubeUrl,
            '-f', 'bestaudio[ext=m4a]/best', // Force le M4A pour compatibilité Web
            '-o', '-',              // Sortie Standard (LE secret du streaming direct)
            '--no-playlist',
            '--quiet',              // Moins de logs
            '--no-warnings',
            '--no-check-certificate',
            '--force-ipv4',          // Important pour Render
            '--cache-dir', '/tmp/.cache', // Vital pour Render
            
            // Simulation PC (pour matcher avec vos cookies)
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            '--referer', 'https://www.youtube.com/'
        ];

        // Ajout des cookies si présents
        if (fs.existsSync(cookiesPath)) {
            console.log("🍪 Injection des cookies");
            args.push('--cookies', cookiesPath);
        } else {
            console.log("ℹ️ Pas de cookies, tentative standard");
        }

        // Lancement direct du moteur (comme en local)
        const child = spawn(ytDlpBinaryPath, args);

        // Gestion des erreurs en temps réel
        child.stderr.on('data', (data) => {
            const msg = data.toString();
            // On log que les vraies erreurs pour ne pas polluer
            if (msg.includes('ERROR') || msg.includes('Sign in') || msg.includes('403')) {
                console.error(`⚠️ Erreur yt-dlp: ${msg}`);
            }
        });

        // Connexion directe du tuyau audio vers le navigateur
        child.stdout.pipe(res);

        // Nettoyage si l'utilisateur quitte la page
        res.on('close', () => child.kill());

    } catch (err) {
        console.error("❌ Erreur Node:", err.message);
        if (!res.headersSent) res.status(500).send('Erreur serveur');
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur Direct-Stream prêt sur le port ${PORT}`));
