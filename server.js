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

// --- CONFIGURATION CHEMINS (Spécial Cloud/Render) ---
const isWindows = process.platform === 'win32';
// Sur Render (Linux), on utilise /tmp
const binaryDir = isWindows ? __dirname : '/tmp';
const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpBinaryPath = path.join(binaryDir, fileName);

console.log(`🔧 Configuration: Stockage du moteur dans ${ytDlpBinaryPath}`);

// --- INSTALLATION ROBUSTE DU MOTEUR (Avec Fallback CURL) ---
async function ensureYtDlp() {
    if (fs.existsSync(ytDlpBinaryPath) && fs.statSync(ytDlpBinaryPath).size > 0) {
        console.log("✅ Moteur yt-dlp déjà présent.");
        return;
    }

    console.log(`⬇️  Téléchargement du moteur ${fileName} vers ${binaryDir}...`);
    
    try {
        // Tentative 1 : Via la librairie standard
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        console.log("✅ Téléchargement réussi via librairie.");
    } catch (e) {
        console.error("⚠️ Échec téléchargement librairie:", e.message);
        
        // Tentative 2 : Méthode "Brute Force" (Linux/Render uniquement)
        if (!isWindows) {
            console.log("🔄 Tentative de secours via CURL...");
            try {
                // On télécharge le binaire officiel Linux directement
                execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${ytDlpBinaryPath}`);
                console.log("✅ Téléchargement réussi via CURL !");
            } catch (curlErr) {
                console.error("❌ Échec total du téléchargement (CURL):", curlErr.message);
            }
        }
    }

    // Vérification finale et permissions
    if (fs.existsSync(ytDlpBinaryPath)) {
        if (!isWindows) {
            try {
                fs.chmodSync(ytDlpBinaryPath, '777'); // Permission d'exécution totale
            } catch (permErr) {
                console.error("⚠️ Erreur permissions:", permErr.message);
            }
        }
        const size = fs.statSync(ytDlpBinaryPath).size;
        console.log(`✅ Moteur prêt ! Taille: ${(size / 1024 / 1024).toFixed(2)} MB`);
    } else {
        console.error("❌ LE FICHIER N'A PAS ÉTÉ CRÉÉ.");
    }
}

// Lancement immédiat au démarrage
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
        console.error("Erreur Recherche:", err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Vérification de sécurité avec tentative de réparation
    if (!fs.existsSync(ytDlpBinaryPath)) {
        console.error("❌ Moteur absent lors de la requête stream");
        await ensureYtDlp(); // On réessaie
        
        if (!fs.existsSync(ytDlpBinaryPath)) {
            console.error("❌ Abandon: Impossible d'installer le moteur.");
            return res.status(503).send('Serveur en erreur: Impossible installer moteur audio.');
        }
    }

    console.log(`🎵 Stream demandé: ${videoId}`);

    try {
        res.header('Content-Type', 'audio/mp4');
        res.header('Access-Control-Allow-Origin', '*');

        // Lancement de yt-dlp
        // --cache-dir /tmp/.cache est vital sur Render pour éviter les erreurs d'écriture
        const child = spawn(ytDlpBinaryPath, [
            youtubeUrl,
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '-o', '-',
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--no-check-certificate',
            '--cache-dir', '/tmp/.cache',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]);

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes('ERROR') || msg.includes('403')) {
                console.error(`⚠️ Erreur yt-dlp: ${msg}`);
            }
        });

        child.stdout.pipe(res);

        res.on('close', () => {
            child.kill();
        });

    } catch (err) {
        console.error("❌ Erreur Route:", err.message);
        if (!res.headersSent) res.status(500).send('Erreur serveur critique');
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur v3 (Fallback CURL) prêt sur le port ${PORT}`));
