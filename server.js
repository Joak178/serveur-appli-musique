const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Liste d'instances PIPED publiques très fiables
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.privacydev.net',
    'https://piped-api.garudalinux.org',
    'https://pipedapi.rs200.xyz'
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

// 2. ROUTE STREAM AUDIO (VIA PIPED API)
app.get('/stream', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('URL manquante');

    // Extraction de l'ID vidéo (11 caractères)
    const match = videoUrl.match(/(?:v=|\/|embed\/|shorts\/)([\w-]{11})/);
    const videoId = match ? match[1] : null;

    if (!videoId) return res.status(400).send('ID vidéo invalide');

    // Teste les instances Piped les unes après les autres
    for (const instance of PIPED_INSTANCES) {
        try {
            const response = await fetch(`${instance}/streams/${videoId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (!response.ok) continue;

            const data = await response.json();
            if (!data.audioStreams || data.audioStreams.length === 0) continue;

            // Filtre et trie pour obtenir la meilleure qualité audio
            const audioStream = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

            if (audioStream && audioStream.url) {
                console.log(`✅ Flux extrait via Piped (${instance}) pour ${videoId}`);
                return res.redirect(audioStream.url);
            }
        } catch (e) {
            console.warn(`⚠️ Échec instance Piped ${instance}:`, e.message);
        }
    }

    console.error(`❌ Impossible de récupérer l'audio pour ${videoId}`);
    res.status(500).send("Flux audio indisponible");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur léger Piped en écoute sur le port ${PORT}`);
});