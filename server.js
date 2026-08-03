const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

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

// 2. ROUTE STREAM AUDIO (VIA COBALT API)
app.get('/stream', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('URL manquante');

    try {
        // Appels à l'API Cobalt
        const response = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            body: JSON.stringify({
                url: videoUrl,
                isAudioOnly: true,
                aFormat: 'mp3'
            })
        });

        const data = await response.json();

        if (data.url) {
            console.log(`✅ Flux Cobalt extrait avec succès pour ${videoUrl}`);
            return res.redirect(data.url);
        } else if (data.picker) {
            // Si Cobalt renvoie une liste d'options
            const audioItem = data.picker.find(item => item.type === 'audio') || data.picker[0];
            return res.redirect(audioItem.url);
        } else {
            throw new Error(data.text || "Impossible d'extraire l'audio");
        }
    } catch (err) {
        console.error("❌ Erreur Cobalt Stream:", err.message);
        res.status(500).send("Erreur lors de la récupération du flux audio");
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur Cobalt en écoute sur le port ${PORT}`);
});