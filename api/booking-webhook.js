// Vercel Serverless Function: Microsoft Bookings Webhook (via Power Automate)
// Empfängt Termin-Daten und verknüpft sie mit dem Kontakt in Supabase.
// Unterstützt: created, updated, cancelled
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY, BOOKING_WEBHOOK_SECRET (optional)

export default async function handler(req, res) {
    // CORS
    const allowedOrigins = ['https://krankenversicherung.mitnorm.de', 'https://gkv-phi.vercel.app'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, BOOKING_WEBHOOK_SECRET } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    // Optional: Webhook-Secret prüfen
    if (BOOKING_WEBHOOK_SECRET) {
        const secret = req.headers['x-webhook-secret'];
        if (secret !== BOOKING_WEBHOOK_SECRET) {
            return res.status(401).json({ error: 'Ungültiges Webhook-Secret' });
        }
    }

    const { customerEmail, customerName, startTime, endTime, serviceName, staffName, action } = req.body;

    if (!customerEmail) {
        return res.status(400).json({ error: 'customerEmail erforderlich' });
    }

    const headers = {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
    };

    // Kontakt per E-Mail suchen
    const searchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kontakte?email=eq.${encodeURIComponent(customerEmail)}&order=created_at.desc&limit=1`,
        { headers }
    );
    const kontakte = await searchRes.json();

    if (!kontakte || kontakte.length === 0) {
        console.warn(`[Booking-Webhook] Kein Kontakt gefunden für E-Mail: ${customerEmail}`);
        return res.status(200).json({ received: true, matched: false, message: 'Kein Kontakt mit dieser E-Mail gefunden' });
    }

    const kontakt = kontakte[0];
    const eventAction = (action || 'created').toLowerCase();

    let updateData = { updated_at: new Date().toISOString() };

    if (eventAction === 'cancelled') {
        // Termin storniert
        updateData.termin_datum = null;
        updateData.termin_storniert_at = new Date().toISOString();
        // Status zurücksetzen (nur wenn aktuell "termin")
        if (kontakt.status === 'termin') {
            updateData.status = kontakt.sparpotenzial_jahr ? 'berechnet' : 'kontaktiert';
        }
    } else {
        // Termin erstellt oder umgebucht
        if (!startTime) {
            return res.status(400).json({ error: 'startTime erforderlich für created/updated' });
        }

        // Bei Umbuchung: alten Termin merken
        if (kontakt.termin_datum && eventAction === 'updated') {
            updateData.termin_vorher = kontakt.termin_datum;
        }

        updateData.termin_datum = startTime;
        updateData.termin_gebucht_at = new Date().toISOString();
        updateData.termin_storniert_at = null;

        // Status auf "termin" setzen (außer wenn schon abgeschlossen)
        if (kontakt.status !== 'abgeschlossen') {
            updateData.status = 'termin';
        }
    }

    await fetch(
        `${SUPABASE_URL}/rest/v1/kontakte?id=eq.${kontakt.id}`,
        {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify(updateData),
        }
    );

    return res.status(200).json({
        received: true,
        matched: true,
        action: eventAction,
        kontakt_id: kontakt.id,
        termin_datum: eventAction === 'cancelled' ? null : startTime,
    });
}
