const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Liste d'instances Invidious publiques fiables (avec fallback si une est en panne)
const INVIDIOUS_INSTANCES = [
    'https://invidious.nerdvpn.de',
    'https://inv.tux.pizza',
    'https://invidious.drgns.space',
    'https://vid.puffyan.us'
];

// 1. ROUTE DE RECHERCHE YOUTUBE
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Recherche vide' });

    try {
        const r = await ytSearch(query);
        const videos = r.videos.slice(0, 10);

        const results = videos.map(video => ({
            title: video.title,
            url: video.url,
            thumbnail: video.thumbnail,
            author: video.author.name,
            duration: video.timestamp
        }));

        res.json(results);
    } catch (err) {
        console.error("Erreur Recherche:", err);
        res.status(500).json({ error: "Erreur lors de la recherche" });
    }
});

// 2. ROUTE STREAM AUDIO (VIA INVIDIOUS)
app.get('/stream', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('URL manquante');

    // Extraction de l'ID vidéo (11 caractères)
    const match = videoUrl.match(/(?:v=|\/|embed\/|shorts\/)([\w-]{11})/);
    const videoId = match ? match[1] : null;

    if (!videoId) return res.status(400).send('ID vidéo invalide');

    // Essaye les instances Invidious les unes après les autres
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            const response = await fetch(`${instance}/api/v1/videos/${videoId}`);
            if (!response.ok) continue;

            const data = await response.json();
            if (!data.adaptiveFormats) continue;

            // Cherche le meilleur flux audio uniquement
            const audioStream = data.adaptiveFormats
                .filter(f => f.type && f.type.includes('audio/'))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

            if (audioStream && audioStream.url) {
                console.log(`✅ Flux extrait depuis ${instance} pour ${videoId}`);
                return res.redirect(audioStream.url);
            }
        } catch (e) {
            console.warn(`⚠️ Échec instance ${instance}:`, e.message);
        }
    }

    console.error(`❌ Impossible de récupérer l'audio pour ${videoId}`);
    res.status(500).send("Flux audio indisponible");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur léger Invidious en écoute sur le port ${PORT}`);
});