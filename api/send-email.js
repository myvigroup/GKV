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
    const { kundeIds, leadIds, subject, htmlContent, textContent } = req.body;

    // Support both: kundeIds only (legacy) or kundeIds + leadIds (new)
    const hasKunden = kundeIds && Array.isArray(kundeIds) && kundeIds.length > 0;
    const hasLeads = leadIds && Array.isArray(leadIds) && leadIds.length > 0;

    if (!hasKunden && !hasLeads) {
        return res.status(400).json({ error: 'Keine Empfänger ausgewählt (kundeIds oder leadIds fehlt)' });
    }

    const isAdmin = berater.is_admin === true;
    let empfaenger = [];

    // Kunden laden
    if (hasKunden) {
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
        const erlaubt = isAdmin ? kunden : kunden.filter(k => k.berater_id === berater.id);
        empfaenger.push(...erlaubt.map(k => ({ ...k, _type: 'kunde' })));
    }

    // Leads laden
    if (hasLeads) {
        const leadsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/leads?id=in.(${leadIds.join(',')})&select=*`,
            {
                headers: {
                    apikey: SUPABASE_SERVICE_KEY,
                    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                }
            }
        );
        const leads = await leadsRes.json();
        const erlaubt = isAdmin ? leads : leads.filter(l => l.berater_id === berater.id);
        empfaenger.push(...erlaubt.map(l => ({ ...l, _type: 'lead' })));
    }

    if (empfaenger.length === 0) {
        return res.status(403).json({ error: 'Keine berechtigten Empfänger gefunden' });
    }

    // Empfänger ohne Email rausfiltern
    const kundenMitEmail = empfaenger.filter(k => k.email);

    if (kundenMitEmail.length === 0) {
        return res.status(400).json({ error: 'Keine Kunden mit E-Mail-Adresse' });
    }

    const results = [];
    const baseUrl = req.headers.origin || 'https://gkv-rechner.de';

    for (const kunde of kundenMitEmail) {
        // Individuellen Link erstellen (Kunden haben code, Leads nicht)
        const kundeLink = kunde.code
            ? `${baseUrl}/?berater=${berater.slug}&kunde=${kunde.code}`
            : `${baseUrl}/?berater=${berater.slug}`;

        // Platzhalter ersetzen
        function replacePlaceholders(str) {
            return str
                .replace(/\{\{vorname\}\}/g, kunde.vorname)
                .replace(/\{\{nachname\}\}/g, kunde.nachname)
                .replace(/\{\{link\}\}/g, kundeLink)
                .replace(/\{\{berater_vorname\}\}/g, berater.vorname)
                .replace(/\{\{berater_nachname\}\}/g, berater.nachname);
        }

        const finalSubject = replacePlaceholders(subject || 'Ihr persönlicher GKV-Vergleich');

        // Text-Version: entweder vom User oder Default
        const rawText = textContent || defaultTextTemplate(berater);
        const finalText = replacePlaceholders(rawText);

        // HTML-Version: wenn vom User nur textContent kommt, wrappen wir es in ein HTML-Template
        let finalHtml;
        if (htmlContent) {
            finalHtml = replacePlaceholders(htmlContent);
        } else {
            // Text in ein HTML-Template mit Tracking-fähigem Link wrappen
            finalHtml = wrapTextInHtml(finalText, kundeLink, berater, finalSubject);
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
                // Email-Tracking in DB speichern (nur für Kunden, nicht Leads)
                if (kunde._type === 'kunde') {
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
                }

                results.push({ id: kunde.id, type: kunde._type, status: 'sent', email: kunde.email });
            } else {
                results.push({ id: kunde.id, type: kunde._type, status: 'error', error: brevoData.message || JSON.stringify(brevoData) });
            }
        } catch (err) {
            results.push({ id: kunde.id, type: kunde._type, status: 'error', error: err.message });
        }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const errors = results.filter(r => r.status === 'error').length;

    return res.status(200).json({ sent, errors, results });
}

function wrapTextInHtml(text, link, berater, subject) {
    // Text in Absätze aufteilen und {{link}} durch einen klickbaren Button ersetzen
    const paragraphs = text.split(/\n\n+/).map(p => {
        // Wenn der Absatz den Link enthält, einen Button daraus machen
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
        <p style="margin:0;font-size:12px;color:#94a3b8;">Diese E-Mail wurde über den mitNORM GKV-Vergleichsrechner versendet.</p>
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
