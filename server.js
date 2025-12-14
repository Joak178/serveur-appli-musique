const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- CONFIGURATION CHEMINS (Spécial Cloud/Render) ---
const isWindows = process.platform === 'win32';
// Sur Render (Linux), on doit utiliser /tmp car le reste est souvent en lecture seule
const binaryDir = isWindows ? __dirname : '/tmp';
const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpBinaryPath = path.join(binaryDir, fileName);

console.log(`🔧 Configuration: Stockage du moteur dans ${ytDlpBinaryPath}`);

// --- INSTALLATION ROBUSTE DU MOTEUR ---
async function ensureYtDlp() {
    // On vérifie si le fichier existe ET s'il a une taille > 0
    if (!fs.existsSync(ytDlpBinaryPath) || fs.statSync(ytDlpBinaryPath).size === 0) {
        console.log(`⬇️  Téléchargement du moteur ${fileName} vers ${binaryDir}...`);
        try {
            await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
            
            // Sur Linux, il est CRUCIAL de rendre le fichier exécutable
            if (!isWindows) {
                fs.chmodSync(ytDlpBinaryPath, '777');
            }
            console.log("✅ Moteur yt-dlp installé et prêt !");
        } catch (e) {
            console.error("❌ Erreur fatale lors du téléchargement de yt-dlp:", e);
        }
    } else {
        console.log("✅ Moteur yt-dlp déjà présent.");
    }
}

// Lancement immédiat au démarrage du serveur
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

// --- ROUTE STREAMING BLINDÉE ---
app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Vérification de sécurité avant de lancer le spawn
    if (!fs.existsSync(ytDlpBinaryPath)) {
        console.error("❌ Moteur yt-dlp introuvable lors de la requête");
        // On tente de le réinstaller en urgence
        await ensureYtDlp();
        // Si toujours pas là, erreur 503
        if (!fs.existsSync(ytDlpBinaryPath)) {
            return res.status(503).send('Serveur en cours d\'initialisation, réessayez dans 5 secondes');
        }
    }

    console.log(`🎵 Stream demandé: ${videoId}`);

    try {
        res.header('Content-Type', 'audio/mp4');
        res.header('Access-Control-Allow-Origin', '*');

        // On lance yt-dlp
        const child = spawn(ytDlpBinaryPath, [
            youtubeUrl,
            '-f', 'bestaudio[ext=m4a]/bestaudio', // Essaie M4A, sinon le meilleur dispo
            '-o', '-',              // Sortie standard
            '--no-playlist',
            '--quiet',
            '--no-warnings',
            '--no-check-certificate', // Aide parfois sur les vieux serveurs
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' // Faux navigateur
        ]);

        let headersSent = false;

        // Gestion d'erreur au lancement (ex: fichier non exécutable)
        child.on('error', (err) => {
            console.error('❌ Erreur SPAWN:', err.message);
            if (!headersSent) {
                headersSent = true;
                res.status(500).send('Erreur interne du moteur audio');
            }
        });

        // Logs d'erreur de yt-dlp (ex: 403 Forbidden de YouTube)
        child.stderr.on('data', (data) => {
            const msg = data.toString();
            // On ignore les petits warnings, on ne log que les erreurs bloquantes
            if (msg.includes('ERROR') || msg.includes('403')) {
                console.error(`⚠️ Erreur yt-dlp: ${msg}`);
            }
        });

        // Connexion du flux
        child.stdout.pipe(res);

        res.on('close', () => {
            child.kill();
        });

    } catch (err) {
        console.error("❌ Erreur Route:", err.message);
        if (!res.headersSent) res.status(500).send('Erreur serveur critique');
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur v2 (Dossier TMP) prêt sur le port ${PORT}`));
