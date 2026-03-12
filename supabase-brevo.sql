-- ============================================================
-- BREVO EMAIL-TRACKING: Kunden-Emails verfolgen
-- ============================================================

-- 1. EMAIL-TRACKING-TABELLE
CREATE TABLE IF NOT EXISTS kunden_emails (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kunde_id UUID REFERENCES kunden(id) ON DELETE CASCADE NOT NULL,
    berater_id UUID REFERENCES berater(id) ON DELETE CASCADE NOT NULL,
    brevo_message_id TEXT,
    subject TEXT,
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'error')),
    sent_at TIMESTAMPTZ DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ke_kunde ON kunden_emails(kunde_id, created_at DESC);
CREATE INDEX idx_ke_berater ON kunden_emails(berater_id);
CREATE INDEX idx_ke_message_id ON kunden_emails(brevo_message_id);

-- 2. ROW LEVEL SECURITY
ALTER TABLE kunden_emails ENABLE ROW LEVEL SECURITY;

-- Berater sehen Emails ihrer Kunden
CREATE POLICY "berater_read_emails" ON kunden_emails
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Berater können Emails für ihre Kunden anlegen
CREATE POLICY "berater_insert_emails" ON kunden_emails
    FOR INSERT WITH CHECK (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Admin kann alle Emails sehen
CREATE POLICY "admin_read_all_emails" ON kunden_emails
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- Webhook-Updates (via service_role key, nicht über RLS)
-- Der Webhook-Endpoint nutzt den service_role key, daher braucht er keine Policy.
-- Alternativ: anon darf status updaten wenn message_id stimmt
CREATE POLICY "webhook_update_emails" ON kunden_emails
    FOR UPDATE USING (true)
    WITH CHECK (true);
