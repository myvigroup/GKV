// Vercel Serverless Function: Berater einladen (Passwort-Reset-Flow)
// 1. Auth-User mit zufälligem Passwort erstellen
// 2. Passwort-Reset-Mail via Supabase senden
// 3. Willkommens-Mail via Brevo senden
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY, BREVO_API_KEY

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

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, BREVO_API_KEY } = process.env;
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
    if (!userRes.ok) return res.status(401).json({ error: 'Token ungültig' });
    const user = await userRes.json();

    const beraterRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?auth_user_id=eq.${user.id}&select=is_admin`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const beraterData = await beraterRes.json();
    if (!beraterData || beraterData.length === 0 || !beraterData[0].is_admin) {
        return res.status(403).json({ error: 'Keine Admin-Berechtigung' });
    }

    const { email, berater_id } = req.body;
    if (!email || !berater_id) {
        return res.status(400).json({ error: 'email und berater_id erforderlich' });
    }

    const headers = {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
    };

    // 1. Auth-User mit zufälligem Passwort erstellen
    const crypto = await import('crypto');
    const tempPassword = crypto.randomBytes(24).toString('base64url');

    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            email,
            password: tempPassword,
            email_confirm: true,
        })
    });
    const createData = await createRes.json();

    if (!createRes.ok) {
        return res.status(400).json({ error: createData.msg || createData.message || 'Auth-User konnte nicht erstellt werden' });
    }

    // 2. Berater-Record mit auth_user_id verknüpfen
    await fetch(`${SUPABASE_URL}/rest/v1/berater?id=eq.${berater_id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ auth_user_id: createData.id }),
    });

    // 3. Passwort-Reset-Mail via Supabase senden
    const resetRes = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email,
        }),
    });

    if (!resetRes.ok) {
        return res.status(200).json({
            success: true,
            warning: 'Auth-User erstellt, aber Reset-Mail konnte nicht gesendet werden. Bitte manuell über Supabase Dashboard.',
        });
    }

    // 4. Willkommens-Mail via Brevo (ohne Passwort!)
    if (BREVO_API_KEY) {
        const beraterDetailRes = await fetch(
            `${SUPABASE_URL}/rest/v1/berater?id=eq.${berater_id}&select=*`,
            { headers }
        );
        const beraterDetail = await beraterDetailRes.json();
        const berater = beraterDetail?.[0];

        if (berater) {
            const dashboardUrl = 'https://krankenversicherung.mitnorm.de/dashboard';

            await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'api-key': BREVO_API_KEY,
                },
                body: JSON.stringify({
                    sender: { name: 'mitNORM GKV-Rechner', email: 'service@mitnorm.com' },
                    to: [{ email: berater.email, name: `${berater.vorname} ${berater.nachname}` }],
                    subject: `Willkommen bei mitNORM, ${berater.vorname}!`,
                    htmlContent: buildWelcomeHtml(berater, dashboardUrl),
                }),
            }).catch(() => {});
        }
    }

    return res.status(200).json({ success: true });
}

function buildWelcomeHtml(berater, dashboardUrl) {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#333;background:#f8fafc;">
    <div style="background:#004283;padding:20px 28px;text-align:center;">
        <span style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px;">mit<span style="color:#06BADD;">NORM</span></span>
    </div>
    <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;">
        <h2 style="margin:0 0 8px;font-size:18px;color:#0F172A;">Willkommen im Team!</h2>
        <p style="margin:0 0 16px;color:#475569;line-height:1.6;">
            Hallo ${esc(berater.vorname)},<br><br>
            du wurdest als Berater auf der mitNORM GKV-Plattform hinzugefügt.
            Über dein persönliches Dashboard kannst du deine Kontakte verwalten,
            E-Mails versenden und den Überblick über deine Leads behalten.
        </p>
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:13px;color:#15803D;font-weight:600;">DEIN ZUGANG</p>
            <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
                Du erhältst in Kürze eine separate E-Mail mit einem Link, um dein Passwort zu setzen.<br>
                Deine Login-E-Mail: <strong>${esc(berater.email)}</strong>
            </p>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr><td style="padding:8px 0;color:#64748B;font-size:14px;width:140px;">Dein Rechner-Link</td><td style="padding:8px 0;font-size:14px;"><a href="https://krankenversicherung.mitnorm.de/?berater=${esc(berater.slug)}" style="color:#004283;">krankenversicherung.mitnorm.de/?berater=${esc(berater.slug)}</a></td></tr>
        </table>
        <div style="text-align:center;margin:20px 0;">
            <a href="${dashboardUrl}" style="display:inline-block;background:#004283;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;">Zum Dashboard</a>
        </div>
    </div>
    <div style="background:#f8fafc;padding:16px 28px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">mitNORM GKV-Vergleichsrechner</p>
    </div>
</body></html>`;
}

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
