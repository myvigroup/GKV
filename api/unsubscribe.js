// Vercel Serverless Function: Email-Abmeldung
// GET /api/unsubscribe?id=KONTAKT_ID&t=TIMESTAMP_TOKEN
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).send(errorPage('Server-Konfiguration fehlt'));
    }

    const { id, t } = req.query;

    if (!id || !t) {
        return res.status(400).send(errorPage('Ungültiger Abmelde-Link'));
    }

    // Token validieren (einfacher HMAC aus kontakt_id + secret)
    const crypto = await import('crypto');
    const secret = SUPABASE_SERVICE_KEY.slice(0, 32);
    const expected = crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, 16);

    if (t !== expected) {
        return res.status(400).send(errorPage('Ungültiger Abmelde-Link'));
    }

    // Kontakt als abgemeldet markieren
    const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kontakte?id=eq.${encodeURIComponent(id)}`,
        {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({
                email_abgemeldet: true,
                email_abgemeldet_at: new Date().toISOString(),
            }),
        }
    );

    if (!updateRes.ok) {
        return res.status(500).send(errorPage('Fehler beim Abmelden. Bitte versuchen Sie es später erneut.'));
    }

    // Erfolgsseite anzeigen
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(successPage());
}

function successPage() {
    return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Abmeldung erfolgreich – mitNORM</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 48px; max-width: 480px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #004283; font-size: 1.5rem; margin: 0 0 12px; }
    p { color: #64748b; line-height: 1.6; margin: 0; }
    .brand { margin-top: 32px; font-size: .85rem; color: #94a3b8; }
</style></head>
<body>
    <div class="card">
        <div class="icon">&#10003;</div>
        <h1>Erfolgreich abgemeldet</h1>
        <p>Sie erhalten ab sofort keine E-Mails mehr von uns.<br>Falls Sie sich erneut anmelden möchten, kontaktieren Sie bitte Ihren Berater.</p>
        <div class="brand">mitNORM Finanzplanung</div>
    </div>
</body></html>`;
}

function errorPage(msg) {
    return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fehler – mitNORM</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 48px; max-width: 480px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    h1 { color: #dc2626; font-size: 1.5rem; margin: 0 0 12px; }
    p { color: #64748b; line-height: 1.6; margin: 0; }
</style></head>
<body>
    <div class="card">
        <h1>Fehler</h1>
        <p>${msg}</p>
    </div>
</body></html>`;
}
