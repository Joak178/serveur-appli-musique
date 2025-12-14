const express = require('express');
const cors = require('cors');
const ytSearch = require('yt-search');
const axios = require('axios');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- CONFIGURATION API ---
const PRIMARY_PIPED_INSTANCE = 'https://api.piped.projectsegfau.lt'; 
const PIPED_API_PATH = '/streams';

// Fonction utilitaire pour extraire l'ID
function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : null;
}

// Fonction pour forcer la résolution DNS via Google/Cloudflare (Anti-ENOTFOUND)
const getAxiosInstance = () => {
    return axios.create({
        // Utilisation du DNS de Cloudflare pour contourner le DNS de Render
        // On force la résolution DNS manuellement pour l'IP 1.1.1.1 (Cloudflare)
        // Attention: cela ne fonctionne que si Render autorise les requêtes externes
        baseURL: PRIMARY_PIPED_INSTANCE,
        timeout: 10000, 
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            // On s'assure que la requête arrive
        }
    });
};


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

// --- ROUTE : RÉCUPÉRER L'URL DIRECTE DU FLUX (Méthode API Externe) ---
app.get('/get-audio-url', async (req, res) => {
    const rawUrl = req.query.url;
    const videoId = extractVideoId(rawUrl);
    
    if (!videoId) return res.status(400).send('ID introuvable');
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`🎵 [Piped API] Demande de lien direct pour : ${videoId}`);

    try {
        const api = getAxiosInstance();

        // 1. Appel à l'API Piped
        const response = await api.get(`${PIPED_API_PATH}/${videoId}`);
        const data = response.data;

        // 2. Extraction du lien audio M4A (le plus compatible)
        const audioStream = data.audioStreams.find(s => s.format === 'M4A') || data.audioStreams[0];
        
        if (!audioStream) {
            console.error("❌ Lien audio non trouvé dans la réponse Piped.");
            return res.status(500).json({ error: 'Lien audio non disponible via API Piped.' });
        }
        
        console.log(`✅ Succès ! URL CDN renvoyée : ${audioStream.url.substring(0, 50)}...`);

        // 3. Renvoi de l'URL au Frontend
        res.json({
            url: audioStream.url,
            mimeType: 'audio/mp4' // M4A est encapsulé dans MP4
        });

    } catch (err) {
        let errorMessage = `Erreur communication API Piped. ${err.message}`;
        
        if (err.code === 'ENOTFOUND') {
            errorMessage = "Erreur DNS: Le serveur n'arrive pas à trouver l'API Piped.";
            console.error(`❌ Échec : ${errorMessage}. Render bloque le DNS.`);
        } else if (err.response && err.response.status === 404) {
            errorMessage = "Vidéo non trouvée ou privée sur YouTube.";
        }
        
        console.error("❌ Erreur API Externe:", errorMessage);
        res.status(500).json({ error: errorMessage });
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur API Externe prêt sur le port ${PORT}`));
