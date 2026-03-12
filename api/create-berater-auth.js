// Vercel Serverless Function: Auth-User für neuen Berater erstellen
// Braucht service_role key weil admin.createUser nur serverseitig geht
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
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

    // Auth prüfen: Caller muss Admin sein
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Nicht autorisiert' });
    }

    const token = authHeader.replace('Bearer ', '');
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });

    if (!userRes.ok) {
        return res.status(401).json({ error: 'Token ungültig' });
    }

    const user = await userRes.json();

    // Prüfe ob Admin
    const beraterRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?auth_user_id=eq.${user.id}&select=is_admin`,
        {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        }
    );
    const beraterData = await beraterRes.json();

    if (!beraterData || beraterData.length === 0 || !beraterData[0].is_admin) {
        return res.status(403).json({ error: 'Keine Admin-Berechtigung' });
    }

    const { email, password, berater_id } = req.body;

    if (!email || !password || !berater_id) {
        return res.status(400).json({ error: 'email, password und berater_id erforderlich' });
    }

    // Auth-User erstellen via Supabase Admin API
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
        })
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
        return res.status(400).json({ error: createData.msg || createData.message || JSON.stringify(createData) });
    }

    const authUserId = createData.id;

    // Berater-Record mit auth_user_id verknüpfen
    const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?id=eq.${berater_id}`,
        {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({ auth_user_id: authUserId })
        }
    );

    if (!updateRes.ok) {
        return res.status(500).json({ error: 'Auth-User erstellt, aber Verknüpfung fehlgeschlagen' });
    }

    return res.status(200).json({ success: true, auth_user_id: authUserId });
}
