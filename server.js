const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process'); // On utilise le spawn natif pour un contrôle total

const app = express();
app.use(cors());

// --- INITIALISATION DU MOTEUR YT-DLP (Correction Windows) ---
// Sur Windows, il faut absolument l'extension .exe pour que spawn fonctionne bien
const isWindows = process.platform === 'win32';
const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpBinaryPath = path.join(__dirname, fileName);

// Fonction pour s'assurer que le moteur est installé
async function ensureYtDlp() {
    if (!fs.existsSync(ytDlpBinaryPath)) {
        console.log(`⬇️  Téléchargement du moteur ${fileName}...`);
        // Télécharge le bon binaire selon l'OS
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        
        // Sur Linux/Mac, il faut rendre le fichier exécutable
        if (!isWindows) {
            fs.chmodSync(ytDlpBinaryPath, '755');
        }
        console.log("✅ Moteur yt-dlp installé avec succès !");
    } else {
        console.log(`✅ Moteur détecté : ${ytDlpBinaryPath}`);
    }
}

// On lance la vérification au démarrage
ensureYtDlp().catch(err => console.error("❌ Erreur critique install yt-dlp:", err));

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : null;
}

// --- ROUTE RECHERCHE ---
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'Recherche vide' });

        console.log(`🔍 Recherche : ${query}`);
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
        console.error("❌ Erreur Recherche:", err.message);
        res.status(500).json({ error: 'Erreur recherche serveur' });
    }
});

// --- ROUTE STREAMING (Version Native Node.js) ---
app.get('/stream', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID Vidéo introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`🎵 Lecture ID : ${videoId}`);

    // Vérification ultime avant de lancer
    if (!fs.existsSync(ytDlpBinaryPath)) {
        return res.status(500).send('Le moteur yt-dlp est introuvable sur le serveur.');
    }

    try {
        res.header('Content-Type', 'audio/mpeg');
        res.header('Access-Control-Allow-Origin', '*');

        // Lancement du processus yt-dlp en natif
        // C'est beaucoup plus robuste que de passer par le wrapper pour le streaming
        const child = spawn(ytDlpBinaryPath, [
            youtubeUrl,
            '-f', 'bestaudio',      // Meilleure qualité audio
            '-o', '-',              // Sortie standard (stdout) pour le pipe
            '--no-playlist',
            '--quiet',              // Silence dans les logs
            '--no-warnings',
            '--prefer-free-formats' // Evite les DRM si possible
        ]);

        // Si yt-dlp a un problème au démarrage
        child.on('error', (err) => {
            console.error('❌ Erreur spawn:', err.message);
            if (!res.headersSent) res.status(500).send('Erreur lancement processus');
        });

        // Si yt-dlp crache une erreur pendant l'exécution (stderr)
        child.stderr.on('data', (data) => {
            // On ignore les warnings non critiques
            const msg = data.toString();
            if (!msg.includes('WARNING')) {
                console.error(`⚠️ yt-dlp stderr: ${msg}`);
            }
        });

        // LE TUYAU MAGIQUE : On connecte la sortie de yt-dlp directement à la réponse HTTP
        child.stdout.pipe(res);

        // Nettoyage à la fermeture
        res.on('close', () => {
            child.kill(); // On tue le processus si l'utilisateur ferme l'onglet
        });

    } catch (err) {
        console.error("❌ Erreur Générale:", err.message);
        if (!res.headersSent) res.status(500).send('Erreur serveur');
    }
});

app.listen(3000, () => console.log('🚀 Serveur "Native yt-dlp" prêt sur http://localhost:3000'));