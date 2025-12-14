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

// --- CONFIGURATION CHEMINS (Compatible Render & Local) ---
const isWindows = process.platform === 'win32';
// Sur Render, on DOIT utiliser /tmp. En local, on reste dans le dossier du projet.
const binaryDir = isWindows ? __dirname : '/tmp';
const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpBinaryPath = path.join(binaryDir, fileName);
const cookiesPath = path.join(binaryDir, 'cookies.txt');

console.log(`🔧 Configuration: Stockage du moteur dans ${ytDlpBinaryPath}`);

// --- GESTION DES COOKIES ---
function setupCookies() {
    let cookiesContent = process.env.YOUTUBE_COOKIES;
    if (cookiesContent) {
        try {
            // Nettoyage des sauts de ligne
            cookiesContent = cookiesContent.replace(/\\n/g, '\n');
            fs.writeFileSync(cookiesPath, cookiesContent);
            console.log("🍪 Cookies YouTube chargés !");
        } catch (e) {
            console.error("⚠️ Erreur écriture cookies:", e.message);
        }
    }
}

// --- INSTALLATION ROBUSTE ---
async function ensureYtDlp() {
    // IMPORTANT : On appelle setupCookies() juste pour charger le fichier si nécessaire, mais on ne l'utilise pas dans le spawn ci-dessous.
    setupCookies();
    
    // Vérification présence moteur
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 1000000) {
        console.log("✅ Moteur yt-dlp présent.");
        return;
    }
    
    console.log(`⬇️  Téléchargement du moteur vers ${binaryDir}...`);
    try {
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        console.log("✅ Moteur installé via librairie !");
    } catch (e) {
        // Fallback CURL pour Linux/Render si la librairie échoue
        if (!isWindows) {
            try {
                execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${ytDlpBinaryPath}`);
                console.log("✅ Téléchargement réussi via CURL !");
            } catch (curlErr) {
                console.error("❌ Échec total du téléchargement:", curlErr.message);
            }
        }
    }

    // IMPORTANT : Permissions d'exécution pour Linux/Render
    if (fs.existsSync(ytDlpBinaryPath)) {
        if (!isWindows) fs.chmodSync(ytDlpBinaryPath, '777');
        console.log("✅ Moteur prêt et exécutable !");
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

// --- STREAMING NATIF (Solution TV EMBEDDED) ---
app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Vérification moteur avant spawn
    if (!fs.existsSync(ytDlpBinaryPath)) {
        await ensureYtDlp();
        if (!fs.existsSync(ytDlpBinaryPath)) return res.status(503).send('Moteur absent');
    }

    console.log(`🎵 Stream demandé : ${videoId}`);

    try {
        res.header('Content-Type', 'audio/mp4');
        res.header('Access-Control-Allow-Origin', '*');

        const args = [
            youtubeUrl,
            '-f', 'bestaudio[ext=m4a]/best', // Priorité M4A
            '-o', '-',              // Sortie Standard (Stdout)
            '--no-playlist',
            '--quiet',              // Moins de logs
            '--no-warnings',
            '--no-check-certificate',
            '--force-ipv4',         // Indispensable sur Render
            '--cache-dir', '/tmp/.cache', // Indispensable sur Render (écriture cache)
            
            // --- ASTUCE FINALE : MODE TV EMBEDDED (Le seul qui fonctionne sans auth) ---
            '--extractor-args', 'youtube:player_client=tv_embedded'
            // NOTE : Pas de --cookies ou --user-agent pour ne pas générer de conflit d'identité
        ];

        // Lancement natif (spawn)
        const child = spawn(ytDlpBinaryPath, args);

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            // Si le blocage persiste même en mode TV, c'est que YouTube est très agressif
            if (msg.includes('ERROR') || msg.includes('Sign in') || msg.includes('403')) {
                console.error(`⚠️ Erreur yt-dlp: ${msg}`);
            }
        });

        // Le "Pipe" natif qui évite l'erreur "stream.pipe is not a function"
        child.stdout.pipe(res);

        res.on('close', () => child.kill());

    } catch (err) {
        console.error("❌ Erreur Node:", err.message);
        if (!res.headersSent) res.status(500).send('Erreur serveur');
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur Natif prêt sur le port ${PORT}`));
