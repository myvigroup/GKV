// Vercel Serverless Function: Berater-Profilbild speichern
// Speichert das Bild als Data-URL direkt in der DB (kein Storage nötig)
// Das Bild ist bereits auf 400x400 JPEG gecroppt (~50-80KB als base64)
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    const { berater_id, image_base64 } = req.body;
    if (!berater_id || !image_base64) {
        return res.status(400).json({ error: 'berater_id und image_base64 erforderlich' });
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
        return res.status(500).json({ error: 'Speichern fehlgeschlagen', detail: err });
    }

    return res.status(200).json({ bild_url: image_base64 });
}
