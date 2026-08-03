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

    const match = videoUrl.match(/(?:v=|\/|embed\/|shorts\/)([\w-]{11})/);
    const videoId = match ? match[1] : null;

    if (!videoId) return res.status(400).send('ID vidéo invalide');

    const PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://api.piped.privacydev.net',
        'https://piped-api.garudalinux.org'
    ];

    for (const instance of PIPED_INSTANCES) {
        try {
            const apiRes = await fetch(`${instance}/streams/${videoId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (!apiRes.ok) continue;

            const data = await apiRes.json();
            if (!data.audioStreams || data.audioStreams.length === 0) continue;

            const audioStreamInfo = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

            // Téléchargement du flux et relais direct vers la réponse HTTP
            const audioFetch = await fetch(audioStreamInfo.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://youtube.com'
                }
            });

            if (!audioFetch.ok) continue;

            res.setHeader('Content-Type', audioStreamInfo.mimeType || 'audio/mpeg');
            
            // Relais du flux vidéo/audio vers le navigateur
            const arrayBuffer = await audioFetch.arrayBuffer();
            return res.send(Buffer.from(arrayBuffer));

        } catch (e) {
            console.warn(`⚠️ Échec instance ${instance}:`, e.message);
        }
    }

    res.status(500).send("Flux audio indisponible");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur léger Piped en écoute sur le port ${PORT}`);
});