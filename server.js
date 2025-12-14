const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const { spawn, execFile, execSync } = require('child_process');

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
            // Nettoyage éventuel des sauts de ligne si mal copiés
            // On écrit les cookies dans un fichier texte que yt-dlp va lire
            fs.writeFileSync(cookiesPath, cookiesContent);
            console.log("🍪 Cookies YouTube chargés depuis l'environnement !");
        } catch (e) {
            console.error("⚠️ Erreur écriture cookies:", e.message);
        }
    } else {
        console.log("ℹ️ Pas de variable YOUTUBE_COOKIES détectée.");
    }
}

// --- INSTALLATION ROBUSTE ---
async function ensureYtDlp() {
    setupCookies(); // Chargement des cookies au démarrage
    
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 0) {
        console.log("✅ Moteur yt-dlp présent.");
        return;
    }
    
    console.log(`⬇️  Téléchargement du moteur...`);
    try {
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        console.log("✅ Moteur installé via librairie !");
    } catch (e) {
        console.error("⚠️ Échec librairie, tentative CURL...");
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

// --- STREAMING AVEC COOKIES (Priorité Desktop) ---
app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (!fs.existsSync(ytDlpBinaryPath)) {
        await ensureYtDlp();
        if (!fs.existsSync(ytDlpBinaryPath)) return res.status(503).send('Moteur absent');
    }

    console.log(`🎵 [1/2] Récupération lien pour : ${videoId}`);

    const args = [
        youtubeUrl,
        '--get-url',
        '-f', 'bestaudio[ext=m4a]/best',
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4',
        '--cache-dir', '/tmp/.cache',
        // IMPORTANT : On utilise un User-Agent de PC classique pour correspondre aux cookies
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        '--referer', 'https://www.youtube.com/'
    ];

    // Si les cookies sont là, on les injecte.
    // Et on NE MET PAS 'player_client=android' pour éviter le conflit d'identité.
    if (fs.existsSync(cookiesPath)) {
        console.log("🍪 Authentification par cookies activée");
        args.push('--cookies', cookiesPath);
    } else {
        // Si PAS de cookies, on tente le mode Android en dernier recours
        console.log("ℹ️ Pas de cookies, tentative mode Android");
        args.push('--extractor-args', 'youtube:player_client=android');
    }

    execFile(ytDlpBinaryPath, args, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Erreur yt-dlp: ${stderr || error.message}`);
            // Si l'erreur mentionne "Sign in", c'est que les cookies sont invalides ou expirés
            return res.status(500).send('Erreur Auth YouTube');
        }

        const directUrl = stdout.trim();
        if (!directUrl) return res.status(500).send('Lien vide');

        console.log(`✅ [2/2] Stream via CURL...`);

        res.header('Content-Type', 'audio/mp4');
        res.header('Access-Control-Allow-Origin', '*');

        const streamer = spawn(isWindows ? 'curl.exe' : 'curl', [
            '-L', '-s', directUrl
        ]);

        streamer.stdout.pipe(res);
        streamer.stderr.on('data', (d) => console.error(`⚠️ Curl: ${d}`));
        res.on('close', () => streamer.kill());
    });
});

app.listen(PORT, () => console.log(`🚀 Serveur Audio prêt sur le port ${PORT}`));
