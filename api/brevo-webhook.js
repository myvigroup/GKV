// Vercel Serverless Function: Brevo Webhook-Events empfangen
// Trackt: delivered, opened, clicked, bounced
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    // Brevo sendet Events als Array oder einzelnes Objekt
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
        const messageId = event['message-id'] || event.messageId;
        const eventType = event.event;

        if (!messageId || !eventType) continue;

        // Status-Mapping: Brevo Event → unser Status
        const statusMap = {
            'delivered': 'delivered',
            'opened': 'opened',      // Nur erstes Öffnen tracken
            'click': 'clicked',
            'hard_bounce': 'bounced',
            'soft_bounce': 'bounced',
            'blocked': 'bounced',
        };

        const newStatus = statusMap[eventType];
        if (!newStatus) continue;

        // Email-Record finden
        const findRes = await fetch(
            `${SUPABASE_URL}/rest/v1/kunden_emails?brevo_message_id=eq.${encodeURIComponent(messageId)}&select=id,status`,
            {
                headers: {
                    apikey: SUPABASE_SERVICE_KEY,
                    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                }
            }
        );

        const records = await findRes.json();
        if (!records || records.length === 0) continue;

        const record = records[0];

        // Status nur "nach vorne" updaten (sent → delivered → opened → clicked)
        const statusOrder = ['sent', 'delivered', 'opened', 'clicked'];
        const currentIdx = statusOrder.indexOf(record.status);
        const newIdx = statusOrder.indexOf(newStatus);

        // Bounced überschreibt immer
        if (newStatus === 'bounced' || newIdx > currentIdx) {
            const updateData = { status: newStatus };

            // Timestamps setzen
            if (newStatus === 'delivered') updateData.delivered_at = new Date().toISOString();
            if (newStatus === 'opened') updateData.opened_at = new Date().toISOString();
            if (newStatus === 'clicked') updateData.clicked_at = new Date().toISOString();

            await fetch(
                `${SUPABASE_URL}/rest/v1/kunden_emails?id=eq.${record.id}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        apikey: SUPABASE_SERVICE_KEY,
                        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                        Prefer: 'return=minimal',
                    },
                    body: JSON.stringify(updateData),
                }
            );
        }
    }

    return res.status(200).json({ received: true });
}
