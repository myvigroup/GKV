-- ============================================================
-- KONTAKTVERLAUF: Brevo-Kampagnen + finfire ID
-- ============================================================

-- 1. Quelle-Feld zu kunden_emails (Dashboard vs Brevo-Kampagne)
ALTER TABLE kunden_emails ADD COLUMN IF NOT EXISTS quelle TEXT DEFAULT 'dashboard';
-- Werte: 'dashboard' (über Dashboard gesendet), 'brevo' (Brevo-Kampagne/Automation)

-- 2. finfire_id an Kunden und Leads
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS finfire_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS finfire_id TEXT;

-- Index für schnelle Suche
CREATE INDEX IF NOT EXISTS idx_kunden_finfire ON kunden(finfire_id) WHERE finfire_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_finfire ON leads(finfire_id) WHERE finfire_id IS NOT NULL;
