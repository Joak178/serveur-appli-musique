const express = require('express');
const cors = require('cors');
const { Client } = require('soundcloud-scraper');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Initialisation du client SoundCloud
const sc = new Client();

// 1. ROUTE DE RECHERCHE SOUNDCLOUD
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Recherche vide' });

    try {
        console.log(`🔎 Recherche SoundCloud pour : "${query}"`);
        const results = await sc.search(query, 'track');

        // On prend les 10 premiers résultats
        const tracks = results.slice(0, 10).map(track => ({
            title: track.title,
            url: track.url,
            thumbnail: track.thumbnail || 'https://soundcloud.com/favicon.ico',
            author: track.author ? track.author.name : 'Artiste inconnu',
            duration: formatDuration(track.duration)
        }));

        res.json(tracks);
    } catch (err) {
        console.error("❌ Erreur Recherche SoundCloud:", err.message);
        res.status(500).json({ error: "Erreur lors de la recherche SoundCloud" });
    }
});

// 2. ROUTE STREAM AUDIO SOUNDCLOUD
app.get('/stream', async (req, res) => {
    const trackUrl = req.query.url;
    if (!trackUrl) return res.status(400).send('URL manquante');

    try {
        console.log(`🎵 Extraction du flux pour : ${trackUrl}`);
        
        // Récupère les infos du morceau
        const song = await sc.getSongInfo(trackUrl);
        
        // Télécharge/récupère le flux audio sous forme de stream Node.js
        const stream = await song.downloadProgressive();

        res.setHeader('Content-Type', 'audio/mpeg');
        
        // Transmet le flux directement au navigateur (pipe)
        stream.pipe(res);

        req.on('close', () => {
            if (stream.destroy) stream.destroy();
        });

    } catch (err) {
        console.error("❌ Erreur Stream SoundCloud:", err.message);
        res.status(500).send("Impossible de récupérer le flux audio");
    }
});

// Helper pour formater la durée en mm:ss
function formatDuration(ms) {
    if (!ms) return "3:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur SoundCloud en écoute sur le port ${PORT}`);
});