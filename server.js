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
            fs.writeFileSync(cookiesPath, cookiesContent);
            console.log("🍪 Cookies YouTube chargés !");
        } catch (e) {
            console.error("⚠️ Erreur écriture cookies:", e.message);
        }
    }
}

// --- INSTALLATION ROBUSTE (AVEC SECOURS CURL) ---
async function ensureYtDlp() {
    setupCookies();
    
    // Vérification : Fichier existe ET n'est pas vide (taille > 0)
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 0) {
        console.log("✅ Moteur yt-dlp présent.");
        return;
    }
    
    console.log(`⬇️  Téléchargement du moteur...`);
    
    // TENTATIVE 1 : Librairie Standard
    try {
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        console.log("✅ Moteur installé via librairie !");
    } catch (e) {
        console.error("⚠️ Échec librairie, passage au plan B...");
        
        // TENTATIVE 2 : CURL (Mode Brute Force pour Linux/Render)
        if (!isWindows) {
            try {
                console.log("🔄 Lancement de CURL...");
                // On télécharge le dernier binaire officiel directement
                execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${ytDlpBinaryPath}`);
                console.log("✅ Téléchargement réussi via CURL !");
            } catch (curlErr) {
                console.error("❌ Échec total du téléchargement (CURL):", curlErr.message);
            }
        }
    }

    // VÉRIFICATION FINALE ET PERMISSIONS
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 0) {
        if (!isWindows) {
            try {
                fs.chmodSync(ytDlpBinaryPath, '777'); // Rend le fichier exécutable
            } catch (permErr) {
                console.error("⚠️ Erreur permissions:", permErr.message);
            }
        }
        console.log("✅ Moteur prêt et exécutable !");
    } else {
        console.error("❌ ERREUR CRITIQUE : Le moteur n'a pas pu être téléchargé.");
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

    // Vérification ultime avant de lancer
    if (!fs.existsSync(ytDlpBinaryPath)) {
        // Tentative de rattrapage de dernière minute
        await ensureYtDlp();
        if (!fs.existsSync(ytDlpBinaryPath)) {
            return res.status(503).send('Serveur en erreur: Moteur absent');
        }
    }

    console.log(`🎵 [1/2] Récupération du lien direct pour : ${videoId}`);

    const args = [
        youtubeUrl,
        '--get-url',
        '-f', 'bestaudio[ext=m4a]/best',
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4',
        '--cache-dir', '/tmp/.cache'
    ];

    if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);

    execFile(ytDlpBinaryPath, args, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Erreur yt-dlp [Step 1]: ${stderr || error.message}`);
            return res.status(500).send('Erreur récupération lien (Cookies/IP)');
        }

        const directUrl = stdout.trim();
        if (!directUrl) {
            return res.status(500).send('Lien direct vide');
        }

        console.log(`✅ [2/2] Lien trouvé, lancement du stream CURL...`);

        res.header('Content-Type', 'audio/mp4');
        res.header('Access-Control-Allow-Origin', '*');

        const streamer = spawn(isWindows ? 'curl.exe' : 'curl', [
            '-L',
            '-s',
            directUrl
        ]);

        streamer.stdout.pipe(res);
        streamer.stderr.on('data', (data) => console.error(`⚠️ Erreur Curl: ${data}`));
        res.on('close', () => streamer.kill());
    });
});

app.listen(PORT, () => console.log(`🚀 Serveur Robust-Curl prêt sur le port ${PORT}`));
