// Vercel Serverless Function: Berater-Profilbild hochladen
// Nutzt Service Key für Storage-Upload (umgeht RLS)
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

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

    const headers = {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    // Decode base64 to buffer
    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const path = `berater/${berater_id}/profil.jpg`;

    // Upload to storage (upsert)
    const uploadRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/kunden-dokumente/${path}`,
        {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'image/jpeg',
                'x-upsert': 'true',
            },
            body: buffer,
        }
    );

    if (!uploadRes.ok) {
        const err = await uploadRes.text();
        console.error('Storage upload error:', err);
        return res.status(500).json({ error: 'Upload fehlgeschlagen', detail: err });
    }

    // Get public URL
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/kunden-dokumente/${path}`;
    const bildUrl = publicUrl + '?t=' + Date.now();

    // Update berater record
    const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?id=eq.${berater_id}`,
        {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ bild_url: bildUrl }),
        }
    );

    if (!updateRes.ok) {
        const err = await updateRes.text();
        return res.status(500).json({ error: 'DB-Update fehlgeschlagen', detail: err });
    }

    return res.status(200).json({ bild_url: bildUrl });
}
