// Vercel Serverless Function: Placetel Anruf-Events empfangen
// Events: IncomingCall, OutgoingCall, CallAccepted, HungUp
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY, PLACETEL_WEBHOOK_SECRET (optional)

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, PLACETEL_WEBHOOK_SECRET } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    // Optional: HMAC-Signatur prüfen
    if (PLACETEL_WEBHOOK_SECRET) {
        const crypto = await import('crypto');
        const signature = req.headers['x-placetel-signature'];
        const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const expected = crypto.createHmac('sha256', PLACETEL_WEBHOOK_SECRET)
            .update(rawBody).digest('hex');
        if (signature !== expected) {
            return res.status(401).json({ error: 'Ungültige Signatur' });
        }
    }

    const { event, from, to, call_id, direction, duration, type, peer } = req.body;

    if (!event || !call_id) {
        return res.status(400).json({ error: 'event und call_id erforderlich' });
    }

    // Telefonnummern normalisieren für Matching
    const nummer = direction === 'out' ? normalizePhone(to) : normalizePhone(from);

    if (event === 'HungUp') {
        // Anruf beendet - jetzt speichern wir den kompletten Anruf
        const kontakt = await findKontaktByPhone(SUPABASE_URL, SUPABASE_SERVICE_KEY, nummer);

        // Anruf speichern
        await fetch(`${SUPABASE_URL}/rest/v1/anrufe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({
                call_id,
                direction,
                from_number: from || null,
                to_number: to || null,
                duration: parseInt(duration) || 0,
                hangup_type: type || null,
                peer: peer || null,
                kontakt_type: kontakt ? kontakt.type : null,
                kontakt_id: kontakt ? kontakt.id : null,
                berater_id: kontakt ? kontakt.berater_id : null,
            }),
        });

        // Berater benachrichtigen bei verpasstem Anruf
        if (type === 'missed' && kontakt && kontakt.berater_id) {
            const kontaktName = `${kontakt.vorname} ${kontakt.nachname}`;
            fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/notify-berater`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: 'missed_call',
                    berater_id: kontakt.berater_id,
                    data: {
                        vorname: kontakt.vorname,
                        nachname: kontakt.nachname,
                        telefon: nummer,
                    }
                })
            }).catch(() => {});
        }
    }

    return res.status(200).json({ received: true });
}

// Telefonnummer normalisieren: +49171... → 0171..., Leerzeichen/Sonderzeichen entfernen
function normalizePhone(phone) {
    if (!phone) return '';
    let p = phone.replace(/[\s\-\/\(\)]/g, '');
    // +49 → 0
    if (p.startsWith('+49')) p = '0' + p.slice(3);
    if (p.startsWith('0049')) p = '0' + p.slice(4);
    return p;
}

// Kontakt über Telefonnummer in leads + kunden suchen
async function findKontaktByPhone(supabaseUrl, serviceKey, phone) {
    if (!phone) return null;

    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
    };

    // Verschiedene Formate für die Suche
    const variants = buildPhoneVariants(phone);
    const likeFilter = variants.map(v => `telefon.like.*${v}*`).join(',');

    // In leads suchen
    const leadsRes = await fetch(
        `${supabaseUrl}/rest/v1/leads?or=(${encodeURIComponent(likeFilter)})&select=id,vorname,nachname,telefon,berater_id&limit=1`,
        { headers }
    );
    const leads = await leadsRes.json();
    if (leads && leads.length > 0) {
        return { ...leads[0], type: 'lead' };
    }

    // In kunden suchen
    const kundenRes = await fetch(
        `${supabaseUrl}/rest/v1/kunden?or=(${encodeURIComponent(likeFilter)})&select=id,vorname,nachname,telefon,berater_id&limit=1`,
        { headers }
    );
    const kunden = await kundenRes.json();
    if (kunden && kunden.length > 0) {
        return { ...kunden[0], type: 'kunde' };
    }

    return null;
}

// Verschiedene Telefonnummer-Varianten für die Suche generieren
function buildPhoneVariants(phone) {
    const clean = phone.replace(/[\s\-\/\(\)\+]/g, '');
    const variants = [clean];

    // Ohne führende 0
    if (clean.startsWith('0')) {
        variants.push(clean.slice(1));
        variants.push('+49' + clean.slice(1));
    }

    // Letzten 8-10 Ziffern (Kernrufnummer)
    if (clean.length >= 8) {
        variants.push(clean.slice(-8));
    }

    return variants;
}
