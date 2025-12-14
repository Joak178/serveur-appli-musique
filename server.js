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

// --- GESTION DES COOKIES (Anti-Blocage) ---
function setupCookies() {
    const cookiesContent = process.env.YOUTUBE_COOKIES;
    if (cookiesContent) {
        try {
            // On écrit les cookies dans un fichier temporaire
            fs.writeFileSync(cookiesPath, cookiesContent);
            console.log("🍪 Cookies YouTube chargés avec succès !");
        } catch (e) {
            console.error("⚠️ Erreur écriture cookies:", e.message);
        }
    } else {
        console.log("ℹ️ Aucun cookie trouvé (Variable YOUTUBE_COOKIES vide).");
    }
}

// --- INSTALLATION DU MOTEUR ---
async function ensureYtDlp() {
    setupCookies(); // On prépare les cookies dès le démarrage

    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 0) {
        console.log("✅ Moteur yt-dlp déjà présent.");
        return;
    }

    console.log(`⬇️  Téléchargement du moteur...`);
    try {
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        console.log("✅ Téléchargement réussi (lib).");
    } catch (e) {
        if (!isWindows) {
            try {
                execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${ytDlpBinaryPath}`);
                console.log("✅ Téléchargement réussi (curl).");
            } catch (curlErr) {
                console.error("❌ Échec téléchargement:", curlErr.message);
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

app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (!fs.existsSync(ytDlpBinaryPath)) {
        return res.status(503).send('Serveur en initialisation');
    }

    console.log(`🎵 Stream demandé: ${videoId}`);

    try {
        // CORRECTION: On force le Content-Type à audio/mp4 car on demande du m4a
        res.header('Content-Type', 'audio/mp4'); 
        res.header('Access-Control-Allow-Origin', '*');

        // Arguments optimisés pour la robustesse et la compatibilité navigateur
        const args = [
            youtubeUrl,
            '-f', 'bestaudio[ext=m4a]/best', // Priorité absolue au M4A (AAC)
            '-o', '-',              // Sortie standard (pipe)
            '--no-playlist',
            '--quiet',              // Moins de logs
            '--no-warnings',
            '--no-progress',        // IMPORTANT : Pas de barre de progression dans le flux binaire
            '--no-check-certificate',
            '--force-ipv4',          // Force IPv4 (plus stable sur Render)
            '--cache-dir', '/tmp/.cache'
        ];

        // SI les cookies existent, on les ajoute à la commande
        if (fs.existsSync(cookiesPath)) {
            console.log("🍪 Utilisation des cookies");
            args.push('--cookies', cookiesPath);
        }

        const child = spawn(ytDlpBinaryPath, args);

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            // On log tout ce qui est erreur critique
            if (msg.includes('ERROR') || msg.includes('403')) {
                console.error(`⚠️ Erreur yt-dlp: ${msg}`);
            }
        });

        child.stdout.pipe(res);

        res.on('close', () => child.kill());

    } catch (err) {
        console.error("❌ Erreur:", err.message);
        if (!res.headersSent) res.status(500).send('Erreur serveur');
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur prêt sur le port ${PORT}`));
