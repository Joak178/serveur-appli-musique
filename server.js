const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

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
    }
}

// --- INSTALLATION MOTEUR ---
async function ensureYtDlp() {
    setupCookies();
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 0) {
        console.log("✅ Moteur yt-dlp présent.");
        return;
    }
    console.log(`⬇️  Téléchargement du moteur...`);
    try {
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        if (!isWindows) fs.chmodSync(ytDlpBinaryPath, '777');
        console.log("✅ Moteur installé !");
    } catch (e) {
        console.error("❌ Erreur téléchargement:", e.message);
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

// --- STREAMING EN DEUX ÉTAPES (SOLUTION SÛRE) ---
app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (!fs.existsSync(ytDlpBinaryPath)) {
        return res.status(503).send('Serveur en initialisation');
    }

    console.log(`🎵 [1/2] Récupération du lien direct pour : ${videoId}`);

    // Arguments pour récupérer juste l'URL (Step 1)
    const args = [
        youtubeUrl,
        '--get-url',       // On veut juste le lien, pas télécharger
        '-f', 'bestaudio[ext=m4a]/best', // Priorité M4A
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4',
        '--cache-dir', '/tmp/.cache'
    ];

    if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);

    // Exécution de yt-dlp pour avoir l'URL
    execFile(ytDlpBinaryPath, args, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Erreur yt-dlp [Step 1]: ${stderr || error.message}`);
            // ICI on peut renvoyer une vraie erreur 500 au navigateur car le header n'est pas encore parti
            return res.status(500).send('Erreur récupération lien (Cookies/IP)');
        }

        const directUrl = stdout.trim();
        if (!directUrl) {
            return res.status(500).send('Lien direct vide');
        }

        console.log(`✅ [2/2] Lien trouvé, lancement du stream CURL...`);

        // Step 2 : On utilise CURL pour streamer le lien direct vers le navigateur
        // CURL est natif sur Render (Linux) et gère très bien le streaming réseau
        res.header('Content-Type', 'audio/mp4');
        res.header('Access-Control-Allow-Origin', '*');

        const streamer = spawn(isWindows ? 'curl.exe' : 'curl', [
            '-L',           // Suivre les redirections
            '-s',           // Silencieux
            directUrl       // L'URL googlevideo.com récupérée
        ]);

        streamer.stdout.pipe(res);

        streamer.stderr.on('data', (data) => console.error(`⚠️ Erreur Curl: ${data}`));
        
        res.on('close', () => streamer.kill());
    });
});

app.listen(PORT, () => console.log(`🚀 Serveur Two-Step prêt sur le port ${PORT}`));
