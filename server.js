const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const ytDlp = require('yt-dlp-exec');

const app = express();
app.use(cors()); // Nécessaire pour éviter les blocages CORS sur Three.js

// 1. ROUTE DE RECHERCHE YOUTUBE
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Recherche vide' });

    try {
        // Recherche les 10 premiers résultats avec yt-dlp
        const output = await ytDlp(`ytsearch10:${query}`, {
            dumpSingleJson: true,
            noWarnings: true,
            defaultSearch: 'ytsearch'
        });

        const results = output.entries.map(video => ({
            title: video.title,
            url: video.webpage_url,
            thumbnail: video.thumbnail,
            author: video.uploader,
            duration: video.duration_string
        }));

        res.json(results);
    } catch (err) {
        console.error("Erreur Recherche:", err);
        res.status(500).json({ error: "Erreur lors de la recherche" });
    }
});

// 2. ROUTE DE STREAMING AUDIO DIRECT (Pour le visualiseur 3D)
app.get('/stream', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('URL manquante');

    try {
        // Extraction de l'URL directe du flux audio (Opus / AAC) sans re-télécharger la vidéo
        const audioFormatUrl = await ytDlp(videoUrl, {
            format: 'bestaudio[ext=m4a]/bestaudio/best',
            getUrl: true
        });

        // Redirection vers le flux audio officiel de Google/YouTube
        // C'est cette URL que la balise <audio> de ton HTML va lire
        res.redirect(audioFormatUrl.trim());
    } catch (err) {
        console.error("Erreur Stream:", err);
        res.status(500).send("Impossible de récupérer l'audio");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));