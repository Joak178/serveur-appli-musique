const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const axios = require('axios'); // Uniquement axios pour les requêtes API

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- API EXTERNE DE RÉCUPÉRATION D'URL ---
// Cette URL est un service tiers fiable qui gère le décryptage des liens YouTube
const YOUTUBE_EXTRACTOR_API = 'https://ytapi.microlink.io/'; 

// --- FONCTIONS UTILITAIRES ---
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

// --- NOUVELLE ROUTE : RÉCUPÉRER L'URL DIRECTE DU FLUX (Pas de streaming via Render) ---
app.get('/get-audio-url', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`🎵 [API Externe] Demande de lien direct pour : ${videoId}`);

    try {
        // 1. Appel à l'API externe pour obtenir le lien direct
        const response = await axios.get(YOUTUBE_EXTRACTOR_API, {
            params: {
                url: youtubeUrl,
                embed: 'media',
                filter: 'audio' // On demande spécifiquement l'audio
            },
            // Simulation de navigateur pour éviter les blocages de l'API externe
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' }
        });

        const data = response.data;
        
        // 2. Extraction du lien audio
        let audioLink = data.metadata?.audio?.url;
        
        if (!audioLink) {
            console.error("❌ Lien audio non trouvé dans la réponse API.");
            return res.status(500).json({ error: 'Lien audio non disponible via API.' });
        }
        
        console.log(`✅ Succès ! URL CDN renvoyée : ${audioLink.substring(0, 50)}...`);

        // 3. Renvoi de l'URL au Frontend
        res.json({
            url: audioLink,
            mimeType: 'audio/mp4' // On suppose que le format est compatible
        });

    } catch (err) {
        console.error("❌ Erreur API Externe:", err.message);
        res.status(500).json({ error: 'Erreur communication API externe. Le service est peut-être saturé.' });
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur API Externe prêt sur le port ${PORT}`));
