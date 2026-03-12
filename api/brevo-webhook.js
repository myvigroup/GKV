// Vercel Serverless Function: Brevo Webhook-Events empfangen
// Trackt: delivered, opened, clicked, bounced
// Erstellt automatisch Einträge für Brevo-Kampagnen-Mails (nicht über Dashboard)
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    const headers = {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    // Brevo sendet Events als Array oder einzelnes Objekt
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
        const messageId = event['message-id'] || event.messageId;
        const eventType = event.event;
        const recipientEmail = event.email;
        const subject = event.subject || null;

        if (!messageId || !eventType) continue;

        // Status-Mapping: Brevo Event → unser Status
        const statusMap = {
            'delivered': 'delivered',
            'opened': 'opened',
            'click': 'clicked',
            'hard_bounce': 'bounced',
            'soft_bounce': 'bounced',
            'blocked': 'bounced',
        };

        const newStatus = statusMap[eventType];
        if (!newStatus) continue;

        // Email-Record anhand messageId suchen
        const findRes = await fetch(
            `${SUPABASE_URL}/rest/v1/kunden_emails?brevo_message_id=eq.${encodeURIComponent(messageId)}&select=id,status`,
            { headers }
        );

        let records = await findRes.json();

        // Kein bestehender Eintrag? → Brevo-Kampagne/Automation
        // Kontakt über E-Mail-Adresse suchen und Eintrag erstellen
        if ((!records || records.length === 0) && recipientEmail) {
            const kontaktRes = await fetch(
                `${SUPABASE_URL}/rest/v1/kontakte?email=eq.${encodeURIComponent(recipientEmail)}&select=id,berater_id&limit=1`,
                { headers }
            );
            const kontakte = await kontaktRes.json();

            if (kontakte && kontakte.length > 0) {
                const kontakt = kontakte[0];
                const now = new Date().toISOString();
                const insertData = {
                    kontakt_id: kontakt.id,
                    berater_id: kontakt.berater_id,
                    brevo_message_id: messageId,
                    subject: subject,
                    status: newStatus === 'bounced' ? 'bounced' : 'sent',
                    quelle: 'brevo',
                };
                if (newStatus === 'delivered') { insertData.status = 'delivered'; insertData.delivered_at = now; }
                if (newStatus === 'opened') { insertData.status = 'opened'; insertData.opened_at = now; }
                if (newStatus === 'clicked') { insertData.status = 'clicked'; insertData.clicked_at = now; }

                await fetch(`${SUPABASE_URL}/rest/v1/kunden_emails`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
                    body: JSON.stringify(insertData),
                });
                continue;
            }
            continue;
        }

        if (!records || records.length === 0) continue;

        const record = records[0];

        // Status nur "nach vorne" updaten (sent → delivered → opened → clicked)
        const statusOrder = ['sent', 'delivered', 'opened', 'clicked'];
        const currentIdx = statusOrder.indexOf(record.status);
        const newIdx = statusOrder.indexOf(newStatus);

        // Bounced überschreibt immer
        if (newStatus === 'bounced' || newIdx > currentIdx) {
            const updateData = { status: newStatus };

            if (newStatus === 'delivered') updateData.delivered_at = new Date().toISOString();
            if (newStatus === 'opened') updateData.opened_at = new Date().toISOString();
            if (newStatus === 'clicked') updateData.clicked_at = new Date().toISOString();

            await fetch(
                `${SUPABASE_URL}/rest/v1/kunden_emails?id=eq.${record.id}`,
                {
                    method: 'PATCH',
                    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                    body: JSON.stringify(updateData),
                }
            );
        }
    }

    return res.status(200).json({ received: true });
}
