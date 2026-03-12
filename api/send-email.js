// Vercel Serverless Function: Email via Brevo senden
// ENV vars needed: BREVO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
    // CORS - nur eigene Domain
    const allowedOrigins = ['https://krankenversicherung.mitnorm.de', 'https://gkv-phi.vercel.app'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
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

    // Support both: new kontaktIds or legacy kundeIds/leadIds
    const { kontaktIds, kundeIds, leadIds, subject, htmlContent, textContent } = req.body;

    // Merge all IDs into one list
    const allIds = [];
    if (kontaktIds && Array.isArray(kontaktIds)) allIds.push(...kontaktIds);
    if (kundeIds && Array.isArray(kundeIds)) allIds.push(...kundeIds);
    if (leadIds && Array.isArray(leadIds)) allIds.push(...leadIds);

    if (allIds.length === 0) {
        return res.status(400).json({ error: 'Keine Empfänger ausgewählt' });
    }

    const isAdmin = berater.is_admin === true;

    // Kontakte laden (eine Query)
    const kontakteRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kontakte?id=in.(${allIds.join(',')})&select=*`,
        {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        }
    );
    const kontakte = await kontakteRes.json();
    const empfaenger = isAdmin ? kontakte : kontakte.filter(k => k.berater_id === berater.id);

    if (empfaenger.length === 0) {
        return res.status(403).json({ error: 'Keine berechtigten Empfänger gefunden' });
    }

    // Empfänger ohne Email und abgemeldete rausfiltern
    const kontakteMitEmail = empfaenger.filter(k => k.email && !k.email_abgemeldet);
    const abgemeldet = empfaenger.filter(k => k.email_abgemeldet).length;

    if (kontakteMitEmail.length === 0) {
        const msg = abgemeldet > 0
            ? `Alle ${abgemeldet} Empfänger haben sich von E-Mails abgemeldet`
            : 'Keine Kontakte mit E-Mail-Adresse';
        return res.status(400).json({ error: msg });
    }

    const results = [];
    const baseUrl = req.headers.origin || 'https://gkv-rechner.de';
    const apiBase = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

    // HMAC-Secret für Unsubscribe-Token
    const crypto = await import('crypto');
    const unsubSecret = SUPABASE_SERVICE_KEY.slice(0, 32);

    // Alle Berater laden (für zugeordneten Absender)
    const alleBeraterRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?select=*`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const alleBerater = await alleBeraterRes.json();
    const beraterMap = {};
    for (const b of alleBerater) beraterMap[b.id] = b;

    for (const kontakt of kontakteMitEmail) {
        // Absender = zugeordneter Berater des Kontakts (Fallback: eingeloggter Berater)
        const absender = (kontakt.berater_id && beraterMap[kontakt.berater_id]) || berater;

        // Unsubscribe-Token generieren
        const unsubToken = crypto.createHmac('sha256', unsubSecret).update(kontakt.id).digest('hex').slice(0, 16);
        const unsubscribeUrl = `${apiBase}/api/unsubscribe?id=${kontakt.id}&t=${unsubToken}`;
        // Individuellen Link erstellen (Kontakte mit code bekommen personalisierten Link)
        const kontaktLink = kontakt.code
            ? `${baseUrl}/?berater=${absender.slug}&kunde=${kontakt.code}`
            : `${baseUrl}/?berater=${absender.slug}`;

        // Platzhalter ersetzen
        function replacePlaceholders(str) {
            return str
                .replace(/\{\{vorname\}\}/g, kontakt.vorname)
                .replace(/\{\{nachname\}\}/g, kontakt.nachname)
                .replace(/\{\{link\}\}/g, kontaktLink)
                .replace(/\{\{berater_vorname\}\}/g, absender.vorname)
                .replace(/\{\{berater_nachname\}\}/g, absender.nachname);
        }

        const finalSubject = replacePlaceholders(subject || 'Ihr persönlicher GKV-Vergleich');

        // Text-Version: entweder vom User oder Default
        const rawText = textContent || defaultTextTemplate(berater);
        const finalText = replacePlaceholders(rawText);

        // HTML-Version: wenn vom User nur textContent kommt, wrappen wir es in ein HTML-Template
        let finalHtml;
        if (htmlContent) {
            finalHtml = replacePlaceholders(htmlContent);
            // Unsubscribe-Link vor </body> einfügen
            if (unsubscribeUrl) {
                const unsubFooter = `<div style="text-align:center;padding:12px;font-size:11px;"><a href="${unsubscribeUrl}" style="color:#94a3b8;text-decoration:underline;">Von E-Mails abmelden</a></div>`;
                finalHtml = finalHtml.replace('</body>', unsubFooter + '</body>');
            }
        } else {
            finalHtml = wrapTextInHtml(finalText, kontaktLink, absender, finalSubject, unsubscribeUrl);
        }

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
                        name: `${absender.vorname} ${absender.nachname} – mitNORM`,
                        email: 'service@mitnorm.com',
                    },
                    replyTo: {
                        name: `${absender.vorname} ${absender.nachname}`,
                        email: absender.email,
                    },
                    to: [{ email: kontakt.email, name: `${kontakt.vorname} ${kontakt.nachname}` }],
                    subject: finalSubject,
                    htmlContent: finalHtml,
                    textContent: finalText,
                    headers: {
                        'X-Kontakt-Id': kontakt.id,
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
                        kontakt_id: kontakt.id,
                        berater_id: berater.id,
                        brevo_message_id: brevoData.messageId || null,
                        subject: finalSubject,
                        status: 'sent',
                    }),
                });

                results.push({ id: kontakt.id, status: 'sent', email: kontakt.email });
            } else {
                results.push({ id: kontakt.id, status: 'error', error: brevoData.message || 'Brevo-Fehler' });
            }
        } catch (err) {
            results.push({ id: kontakt.id, status: 'error', error: err.message });
        }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const errors = results.filter(r => r.status === 'error').length;

    // Berater benachrichtigen (fire-and-forget)
    if (sent > 0) {
        const sentResults = results.filter(r => r.status === 'sent');
        for (const r of sentResults) {
            const kontakt = kontakteMitEmail.find(k => k.id === r.id);
            if (kontakt) {
                fetch(`${req.headers.origin || 'https://gkv-phi.vercel.app'}/api/notify-berater`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: 'email_sent',
                        berater_id: berater.id,
                        data: {
                            vorname: kontakt.vorname,
                            nachname: kontakt.nachname,
                            email: kontakt.email,
                            subject: subject || 'Ihr persönlicher GKV-Vergleich',
                        }
                    })
                }).catch(() => {});
            }
        }
    }

    return res.status(200).json({ sent, errors, results });
}

function wrapTextInHtml(text, link, berater, subject, unsubscribeUrl) {
    const paragraphs = text.split(/\n\n+/).map(p => {
        if (p.includes(link)) {
            const beforeLink = p.replace(link, '').trim();
            return (beforeLink ? `<p style="margin:0 0 8px;line-height:1.6;">${escHtml(beforeLink)}</p>` : '') +
                `<div style="text-align:center;margin:20px 0;">
                    <a href="${link}" style="display:inline-block;background:#06BADD;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">Jetzt Beitrag vergleichen</a>
                </div>`;
        }
        return `<p style="margin:0 0 12px;line-height:1.6;">${escHtml(p).replace(/\n/g, '<br>')}</p>`;
    }).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#333;background:#f8fafc;">
    <div style="background:#004283;padding:24px 28px;text-align:center;">
        <span style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px;">mit<span style="color:#06BADD;">NORM</span></span>
    </div>
    <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;">
        ${paragraphs}
    </div>
    <div style="background:#f8fafc;padding:16px 28px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
        <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;">Diese E-Mail wurde über den mitNORM GKV-Vergleichsrechner versendet.</p>
        ${unsubscribeUrl ? `<p style="margin:0;font-size:11px;"><a href="${unsubscribeUrl}" style="color:#94a3b8;text-decoration:underline;">Von E-Mails abmelden</a></p>` : ''}
    </div>
</body></html>`;
}

function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function defaultTextTemplate(berater) {
    return `Hallo {{vorname}},

es ist wieder Zeit für Ihr jährliches Krankenkassen-Update! Die Beitragssätze haben sich geändert – prüfen Sie jetzt, ob Sie sparen können.

Ihr persönlicher Vergleichsrechner: {{link}}

Der Vergleich dauert nur 30 Sekunden und ist kostenlos.

Mit freundlichen Grüßen,
{{berater_vorname}} {{berater_nachname}}`;
}
