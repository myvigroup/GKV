// Vercel Serverless Function: Berater-Profilbild speichern
// Speichert das Bild als Data-URL direkt in der DB (kein Storage nötig)
// Das Bild ist bereits auf 400x400 JPEG gecroppt (~50-80KB als base64)
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
    // CORS
    const allowedOrigins = ['https://krankenversicherung.mitnorm.de', 'https://gkv-phi.vercel.app'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    // Auth prüfen
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Nicht autorisiert' });
    }
    const token = authHeader.replace('Bearer ', '');
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Token ungültig' });
    const user = await userRes.json();

    // Berater laden und prüfen ob berater_id zum User gehört
    const beraterCheckRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?auth_user_id=eq.${user.id}&select=id,is_admin`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const beraterCheck = await beraterCheckRes.json();
    if (!beraterCheck || beraterCheck.length === 0) {
        return res.status(403).json({ error: 'Kein Berater-Account' });
    }

    const { berater_id, image_base64 } = req.body;
    if (!berater_id || !image_base64) {
        return res.status(400).json({ error: 'berater_id und image_base64 erforderlich' });
    }

    // Nur eigenes Bild oder Admin
    const ownBerater = beraterCheck[0];
    if (ownBerater.id !== berater_id && !ownBerater.is_admin) {
        return res.status(403).json({ error: 'Keine Berechtigung für diesen Berater' });
    }

    // Validate it's actually a data URL
    if (!image_base64.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Ungültiges Bildformat' });
    }

    const headers = {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
    };

    // Store data URL directly in bild_url column
    const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?id=eq.${berater_id}`,
        {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ bild_url: image_base64 }),
        }
    );

    if (!updateRes.ok) {
        const err = await updateRes.text();
        console.error('DB update error:', err);
        return res.status(500).json({ error: 'Speichern fehlgeschlagen' });
    }

    return res.status(200).json({ bild_url: image_base64 });
}
