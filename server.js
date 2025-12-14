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

// --- GESTION DES COOKIES (Nettoyage + Debug) ---
function setupCookies() {
    let cookiesContent = process.env.YOUTUBE_COOKIES;
    if (cookiesContent) {
        try {
            // Nettoyage : On remplace les sauts de ligne littéraux "\n" qui arrivent parfois lors du copier-coller
            cookiesContent = cookiesContent.replace(/\\n/g, '\n');
            fs.writeFileSync(cookiesPath, cookiesContent);
            console.log(`🍪 Cookies chargés ! (Taille: ${cookiesContent.length} caractères)`);
            console.log(`   Aperçu: ${cookiesContent.substring(0, 50)}...`);
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
    
    // On force la mise à jour si le fichier est trop petit (corrompu)
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 1000000) {
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

// --- STREAMING (MODE TV EMBEDDED) ---
app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

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
            '-f', 'bestaudio',      // On laisse yt-dlp choisir le meilleur format audio dispo
            '-o', '-',              // Sortie Standard
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--no-check-certificate',
            '--force-ipv4',
            '--cache-dir', '/tmp/.cache',
            
            // --- ASTUCE INGÉNIEUSE : MODE TV ---
            // Le client 'tv_embedded' est beaucoup moins strict sur les IPs Datacenter
            '--extractor-args', 'youtube:player_client=tv_embedded'
        ];

        // On n'ajoute les cookies QUE s'ils sont présents
        if (fs.existsSync(cookiesPath)) {
            console.log("🍪 Injection des cookies");
            args.push('--cookies', cookiesPath);
        } else {
            console.log("ℹ️ Sans cookies (Mode TV)");
        }

        const child = spawn(ytDlpBinaryPath, args);

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            // On surveille les erreurs critiques
            if (msg.includes('ERROR') || msg.includes('Sign in') || msg.includes('403')) {
                console.error(`⚠️ Erreur yt-dlp: ${msg}`);
            }
        });

        child.stdout.pipe(res);

        res.on('close', () => child.kill());

    } catch (err) {
        console.error("❌ Erreur Node:", err.message);
        if (!res.headersSent) res.status(500).send('Erreur serveur');
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur TV-Mode prêt sur le port ${PORT}`));
