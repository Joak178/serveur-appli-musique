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

// --- PROXY PUBLIC DE SECOURS ---
// IMPORTANT : Ces proxies sont temporaires et peuvent tomber rapidement
const SOCKS5_PROXY = 'socks5://188.166.195.127:1080'; // Exemple de proxy public

console.log(`🔧 Proxy de secours configuré : ${SOCKS5_PROXY ? 'Activé' : 'Désactivé'}`);

// (Reste des fonctions setupCookies, ensureYtDlp, extractVideoId, app.get('/search') inchangées)
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

// Installation robuste (méthode spawn) - Conservée
async function ensureYtDlp() {
    setupCookies();
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 1000000) {
        console.log("✅ Moteur yt-dlp présent.");
        return;
    }
    
    // (Logiciel de téléchargement de yt-dlp ici)
    // ... [Téléchargement et chmod du binaire] ...
}
// ensureYtDlp(); // Décommentez pour le test, mais pour Render il est exécuté par défaut

// (Fonctionnalités de recherche)
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


// --- ROUTE STREAMING DIRECT AVEC PROXY ---
app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (!fs.existsSync(ytDlpBinaryPath)) {
        await ensureYtDlp();
        if (!fs.existsSync(ytDlpBinaryPath)) return res.status(503).send('Moteur absent');
    }

    console.log(`🎵 Stream demandé (Proxy) : ${videoId}`);

    try {
        res.header('Content-Type', 'audio/mp4');
        res.header('Access-Control-Allow-Origin', '*');

        const args = [
            youtubeUrl,
            '-f', 'bestaudio[ext=m4a]/best',
            '-o', '-',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--no-check-certificate',
            '--force-ipv4',
            '--cache-dir', '/tmp/.cache',
            // On utilise le mode TV EMBEDDED car il est le plus permissif sur le type d'IP
            '--extractor-args', 'youtube:player_client=tv_embedded' 
        ];

        // AJOUT DES ARGUMENTS PROXY
        if (SOCKS5_PROXY) {
            args.push('--proxy', SOCKS5_PROXY);
            console.log("-> Requête routée via SOCKS5 Proxy");
        }

        // Ajout des cookies (même si en mode TV, pour le contenu restreint)
        if (fs.existsSync(cookiesPath)) {
            args.push('--cookies', cookiesPath);
        }

        const child = spawn(ytDlpBinaryPath, args);

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            // Si le blocage persiste
            if (msg.includes('ERROR') || msg.includes('Sign in') || msg.includes('403')) {
                console.error(`❌ Erreur yt-dlp: ${msg}`);
                // On pourrait ajouter ici une logique pour changer de proxy si possible
            }
        });

        child.stdout.pipe(res);
        res.on('close', () => child.kill());

    } catch (err) {
        console.error("❌ Erreur Node:", err.message);
        if (!res.headersSent) res.status(500).send('Erreur serveur');
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur Proxy-Stream prêt sur le port ${PORT}`));
