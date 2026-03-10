// Vercel Serverless Function: Berater per E-Mail benachrichtigen
// Events: new_lead, berechnung, email_sent, berater_welcome
// ENV vars needed: BREVO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Key');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { BREVO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

    if (!BREVO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    const { event, berater_id, data } = req.body;

    if (!event || !berater_id) {
        return res.status(400).json({ error: 'event und berater_id erforderlich' });
    }

    // Berater laden
    const beraterRes = await fetch(
        `${SUPABASE_URL}/rest/v1/berater?id=eq.${berater_id}&select=*`,
        {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        }
    );
    const beraterData = await beraterRes.json();

    if (!beraterData || beraterData.length === 0) {
        return res.status(404).json({ error: 'Berater nicht gefunden' });
    }

    const berater = beraterData[0];
    const dashboardUrl = 'https://gkv-phi.vercel.app/dashboard';

    // E-Mail-Inhalt je nach Event
    let subject, htmlContent;

    switch (event) {
        case 'new_lead': {
            const name = `${data.vorname} ${data.nachname}`;
            const spar = data.sparpotenzial_jahr
                ? `${Number(data.sparpotenzial_jahr).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €/Jahr`
                : 'nicht berechnet';
            subject = `Neuer Lead: ${name}`;
            htmlContent = buildNotificationHtml(berater, `
                <h2 style="margin:0 0 8px;font-size:18px;color:#0F172A;">Neuer Lead eingegangen</h2>
                <p style="margin:0 0 16px;color:#64748B;">Ein neuer Interessent hat den GKV-Rechner genutzt.</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;width:140px;">Name</td><td style="padding:8px 0;font-weight:600;font-size:14px;">${esc(name)}</td></tr>
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;">E-Mail</td><td style="padding:8px 0;font-size:14px;">${esc(data.email || '–')}</td></tr>
                    ${data.telefon ? `<tr><td style="padding:8px 0;color:#64748B;font-size:14px;">Telefon</td><td style="padding:8px 0;font-size:14px;">${esc(data.telefon)}</td></tr>` : ''}
                    ${data.gewaehlte_kasse ? `<tr><td style="padding:8px 0;color:#64748B;font-size:14px;">Gewählte Kasse</td><td style="padding:8px 0;font-size:14px;">${esc(data.gewaehlte_kasse)}</td></tr>` : ''}
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;">Sparpotenzial</td><td style="padding:8px 0;font-weight:700;color:#00B67A;font-size:14px;">${spar}</td></tr>
                </table>
                ${ctaButton(dashboardUrl, 'Im Dashboard ansehen')}
            `);
            break;
        }

        case 'berechnung': {
            const name = `${data.vorname} ${data.nachname}`;
            const spar = data.sparpotenzial_jahr
                ? `${Number(data.sparpotenzial_jahr).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €/Jahr`
                : '–';
            subject = `Neue Berechnung von ${name}`;
            htmlContent = buildNotificationHtml(berater, `
                <h2 style="margin:0 0 8px;font-size:18px;color:#0F172A;">Neue Berechnung durchgeführt</h2>
                <p style="margin:0 0 16px;color:#64748B;">${esc(name)} hat eine GKV-Berechnung durchgeführt.</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;width:140px;">Name</td><td style="padding:8px 0;font-weight:600;font-size:14px;">${esc(name)}</td></tr>
                    ${data.gewaehlte_kasse ? `<tr><td style="padding:8px 0;color:#64748B;font-size:14px;">Gewählte Kasse</td><td style="padding:8px 0;font-size:14px;">${esc(data.gewaehlte_kasse)}</td></tr>` : ''}
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;">Sparpotenzial</td><td style="padding:8px 0;font-weight:700;color:#00B67A;font-size:14px;">${spar}</td></tr>
                </table>
                ${ctaButton(dashboardUrl, 'Im Dashboard ansehen')}
            `);
            break;
        }

        case 'email_sent': {
            const name = `${data.vorname} ${data.nachname}`;
            subject = `E-Mail an ${name} versendet`;
            htmlContent = buildNotificationHtml(berater, `
                <h2 style="margin:0 0 8px;font-size:18px;color:#0F172A;">E-Mail versendet</h2>
                <p style="margin:0 0 16px;color:#64748B;">Eine E-Mail wurde an deinen Kontakt gesendet.</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;width:140px;">Empfänger</td><td style="padding:8px 0;font-weight:600;font-size:14px;">${esc(name)}</td></tr>
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;">E-Mail</td><td style="padding:8px 0;font-size:14px;">${esc(data.email || '–')}</td></tr>
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;">Betreff</td><td style="padding:8px 0;font-size:14px;">${esc(data.subject || '–')}</td></tr>
                </table>
                ${ctaButton(dashboardUrl, 'Im Dashboard ansehen')}
            `);
            break;
        }

        case 'berater_welcome': {
            subject = `Willkommen bei mitNORM, ${berater.vorname}!`;
            const hasPassword = data.password;
            htmlContent = buildNotificationHtml(berater, `
                <h2 style="margin:0 0 8px;font-size:18px;color:#0F172A;">Willkommen im Team!</h2>
                <p style="margin:0 0 16px;color:#475569;line-height:1.6;">
                    Hallo ${esc(berater.vorname)},<br><br>
                    du wurdest als Berater auf der mitNORM GKV-Plattform hinzugefügt.
                    Über dein persönliches Dashboard kannst du deine Kontakte verwalten,
                    E-Mails versenden und den Überblick über deine Leads behalten.
                </p>
                <div style="background:#F1F5F9;border-radius:8px;padding:16px;margin-bottom:20px;">
                    <p style="margin:0 0 4px;font-size:13px;color:#64748B;font-weight:600;">DEINE ZUGANGSDATEN</p>
                    <table style="width:100%;border-collapse:collapse;">
                        <tr><td style="padding:6px 0;color:#64748B;font-size:14px;width:120px;">E-Mail</td><td style="padding:6px 0;font-weight:600;font-size:14px;">${esc(berater.email)}</td></tr>
                        ${hasPassword ? `<tr><td style="padding:6px 0;color:#64748B;font-size:14px;">Passwort</td><td style="padding:6px 0;font-weight:600;font-size:14px;font-family:monospace;">${esc(data.password)}</td></tr>` : ''}
                    </table>
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <tr><td style="padding:8px 0;color:#64748B;font-size:14px;width:140px;">Dein Rechner-Link</td><td style="padding:8px 0;font-size:14px;"><a href="https://krankenversicherung.mitnorm.de/?berater=${esc(berater.slug)}" style="color:#004283;">krankenversicherung.mitnorm.de/?berater=${esc(berater.slug)}</a></td></tr>
                </table>
                ${ctaButton(dashboardUrl, 'Zum Dashboard')}
                <p style="margin:16px 0 0;font-size:13px;color:#94A3B8;">Bitte ändere dein Passwort nach dem ersten Login.</p>
            `);
            break;
        }

        default:
            return res.status(400).json({ error: `Unbekanntes Event: ${event}` });
    }

    // Via Brevo senden
    try {
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': BREVO_API_KEY,
            },
            body: JSON.stringify({
                sender: {
                    name: 'mitNORM GKV-Rechner',
                    email: 'service@mitnorm.com',
                },
                to: [{ email: berater.email, name: `${berater.vorname} ${berater.nachname}` }],
                subject,
                htmlContent,
            }),
        });

        const brevoData = await brevoRes.json();

        if (brevoRes.ok) {
            return res.status(200).json({ sent: true, messageId: brevoData.messageId });
        } else {
            return res.status(500).json({ error: brevoData.message || JSON.stringify(brevoData) });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

function buildNotificationHtml(berater, content) {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#333;background:#f8fafc;">
    <div style="background:#004283;padding:20px 28px;text-align:center;">
        <span style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px;">mit<span style="color:#06BADD;">NORM</span></span>
    </div>
    <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;">
        ${content}
    </div>
    <div style="background:#f8fafc;padding:16px 28px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">mitNORM GKV-Vergleichsrechner &middot; Automatische Benachrichtigung</p>
    </div>
</body></html>`;
}

function ctaButton(url, text) {
    return `<div style="text-align:center;margin:20px 0;">
        <a href="${url}" style="display:inline-block;background:#004283;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;">${text}</a>
    </div>`;
}

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
