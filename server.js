const express = require('express');
const cors = require('cors');
const { Client } = require('soundcloud-scraper');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Initialisation du client SoundCloud
const sc = new Client();

// 1. ROUTE DE RECHERCHE SOUNDCLOUD (Correction des noms de propriétés)
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Recherche vide' });

    try {
        console.log(`🔎 Recherche SoundCloud pour : "${query}"`);
        const results = await sc.search(query, 'track');

        const tracks = results.slice(0, 10).map(track => {
            // Extraction du titre (title ou name)
            const title = track.title || track.name || 'Titre inconnu';

            // Extraction de l'artiste (author.name, user.username, ou string)
            let author = 'Artiste inconnu';
            if (track.author && typeof track.author === 'object') {
                author = track.author.name || track.author.username || author;
            } else if (track.user && typeof track.user === 'object') {
                author = track.user.username || track.user.name || author;
            } else if (typeof track.author === 'string') {
                author = track.author;
            }

            // Extraction de l'image / miniature
            const thumbnail = track.thumbnail || track.artwork_url || (track.user ? track.user.avatar_url : null) || 'https://soundcloud.com/favicon.ico';

            // Extraction de la durée
            const duration = formatDuration(track.duration);

            return {
                title,
                url: track.url,
                thumbnail,
                author,
                duration
            };
        });

        res.json(tracks);
    } catch (err) {
        console.error("❌ Erreur Recherche SoundCloud:", err.message);
        res.status(500).json({ error: "Erreur lors de la recherche SoundCloud" });
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