// Vercel Serverless Function: Email via Brevo senden
// ENV vars needed: BREVO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { BREVO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

    if (!BREVO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    // Auth prüfen: Supabase JWT aus Authorization-Header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Nicht autorisiert' });
    }

    const token = authHeader.replace('Bearer ', '');

    // User über Supabase verifizieren
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });

    if (!userRes.ok) {
        return res.status(401).json({ error: 'Token ungültig' });
    }

    const user = await userRes.json();

    // Berater laden
    const beraterRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?auth_user_id=eq.${user.id}&select=*`,
        {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        }
    );
    const beraterData = await beraterRes.json();

    if (!beraterData || beraterData.length === 0) {
        return res.status(403).json({ error: 'Kein Berater-Account gefunden' });
    }

    const berater = beraterData[0];
    const { kundeIds, subject, htmlContent, textContent } = req.body;

    if (!kundeIds || !Array.isArray(kundeIds) || kundeIds.length === 0) {
        return res.status(400).json({ error: 'kundeIds fehlt' });
    }

    // Kunden laden
    const kundenRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kunden?id=in.(${kundeIds.join(',')})&select=*`,
        {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        }
    );
    const kunden = await kundenRes.json();

    // Zugriffsprüfung: Nur eigene Kunden oder Admin
    const isAdmin = berater.is_admin === true;
    const erlaubteKunden = isAdmin
        ? kunden
        : kunden.filter(k => k.berater_id === berater.id);

    if (erlaubteKunden.length === 0) {
        return res.status(403).json({ error: 'Keine berechtigten Kunden' });
    }

    // Kunden ohne Email rausfiltern
    const kundenMitEmail = erlaubteKunden.filter(k => k.email);

    if (kundenMitEmail.length === 0) {
        return res.status(400).json({ error: 'Keine Kunden mit E-Mail-Adresse' });
    }

    const results = [];
    const baseUrl = req.headers.origin || 'https://gkv-rechner.de';

    for (const kunde of kundenMitEmail) {
        // Individuellen Link erstellen
        const kundeLink = `${baseUrl}/?berater=${berater.slug}&kunde=${kunde.code}`;

        // Email-Body mit Platzhaltern ersetzen
        const finalHtml = (htmlContent || defaultHtmlTemplate(berater))
            .replace(/\{\{vorname\}\}/g, kunde.vorname)
            .replace(/\{\{nachname\}\}/g, kunde.nachname)
            .replace(/\{\{link\}\}/g, kundeLink)
            .replace(/\{\{berater_vorname\}\}/g, berater.vorname)
            .replace(/\{\{berater_nachname\}\}/g, berater.nachname);

        const finalText = (textContent || defaultTextTemplate(berater))
            .replace(/\{\{vorname\}\}/g, kunde.vorname)
            .replace(/\{\{nachname\}\}/g, kunde.nachname)
            .replace(/\{\{link\}\}/g, kundeLink)
            .replace(/\{\{berater_vorname\}\}/g, berater.vorname)
            .replace(/\{\{berater_nachname\}\}/g, berater.nachname);

        const finalSubject = (subject || 'Ihr persönlicher GKV-Vergleich')
            .replace(/\{\{vorname\}\}/g, kunde.vorname)
            .replace(/\{\{nachname\}\}/g, kunde.nachname);

        try {
            // Via Brevo senden
            const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'api-key': BREVO_API_KEY,
                },
                body: JSON.stringify({
                    sender: {
                        name: `${berater.vorname} ${berater.nachname} – mitNORM`,
                        email: 'service@mitnorm.com',
                    },
                    replyTo: {
                        name: `${berater.vorname} ${berater.nachname}`,
                        email: berater.email,
                    },
                    to: [{ email: kunde.email, name: `${kunde.vorname} ${kunde.nachname}` }],
                    subject: finalSubject,
                    htmlContent: finalHtml,
                    textContent: finalText,
                    headers: {
                        'X-Kunde-Id': kunde.id,
                        'X-Berater-Id': berater.id,
                    },
                }),
            });

            const brevoData = await brevoRes.json();

            if (brevoRes.ok) {
                // Email-Tracking in DB speichern
                await fetch(`${SUPABASE_URL}/rest/v1/kunden_emails`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        apikey: SUPABASE_SERVICE_KEY,
                        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                        Prefer: 'return=minimal',
                    },
                    body: JSON.stringify({
                        kunde_id: kunde.id,
                        berater_id: berater.id,
                        brevo_message_id: brevoData.messageId || null,
                        subject: finalSubject,
                        status: 'sent',
                    }),
                });

                results.push({ kunde_id: kunde.id, status: 'sent', email: kunde.email });
            } else {
                results.push({ kunde_id: kunde.id, status: 'error', error: brevoData.message || 'Brevo-Fehler' });
            }
        } catch (err) {
            results.push({ kunde_id: kunde.id, status: 'error', error: err.message });
        }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const errors = results.filter(r => r.status === 'error').length;

    return res.status(200).json({ sent, errors, results });
}

function defaultHtmlTemplate(berater) {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
    <div style="background: #004283; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Ihr persönlicher GKV-Vergleich</h1>
    </div>
    <div style="background: #fff; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
        <p>Hallo {{vorname}},</p>
        <p>es ist wieder Zeit für Ihr jährliches Krankenkassen-Update! Die Beitragssätze haben sich geändert – prüfen Sie jetzt, ob Sie sparen können.</p>
        <p>Ich habe Ihnen einen <strong>persönlichen Vergleichsrechner</strong> erstellt:</p>
        <div style="text-align: center; margin: 24px 0;">
            <a href="{{link}}" style="display: inline-block; background: #06BADD; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Jetzt Beitrag vergleichen</a>
        </div>
        <p style="font-size: 14px; color: #64748b;">Der Vergleich dauert nur 30 Sekunden und ist natürlich kostenlos.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 14px;">Mit freundlichen Grüßen,<br><strong>{{berater_vorname}} {{berater_nachname}}</strong></p>
    </div>
</body>
</html>`;
}

function defaultTextTemplate(berater) {
    return `Hallo {{vorname}},

es ist wieder Zeit für Ihr jährliches Krankenkassen-Update! Die Beitragssätze haben sich geändert – prüfen Sie jetzt, ob Sie sparen können.

Ihr persönlicher Vergleichsrechner: {{link}}

Der Vergleich dauert nur 30 Sekunden und ist kostenlos.

Mit freundlichen Grüßen,
{{berater_vorname}} {{berater_nachname}}`;
}
