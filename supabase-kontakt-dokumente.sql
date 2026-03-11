-- ============================================================
-- KONTAKT-DOKUMENTE: Generische Dokument-Tabelle für Leads & Kunden
-- Speichert generierte PDFs (Beratungsprotokolle) und andere Dateien
-- ============================================================

CREATE TABLE IF NOT EXISTS kontakt_dokumente (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kontakt_type TEXT NOT NULL CHECK (kontakt_type IN ('kunde', 'lead')),
    kontakt_id UUID NOT NULL,
    berater_id UUID REFERENCES berater(id) ON DELETE SET NULL,
    typ TEXT NOT NULL DEFAULT 'sonstiges' CHECK (typ IN ('beratungsprotokoll', 'gehaltsnachweis', 'kassenbescheid', 'kuendigung', 'sonstiges')),
    dateiname TEXT NOT NULL,
    storage_path TEXT,
    storage_url TEXT,
    dateigroesse INTEGER,
    mime_type TEXT,
    notiz TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kd2_kontakt ON kontakt_dokumente(kontakt_type, kontakt_id, created_at DESC);
CREATE INDEX idx_kd2_berater ON kontakt_dokumente(berater_id);

ALTER TABLE kontakt_dokumente ENABLE ROW LEVEL SECURITY;

-- Service-Key kann alles (API-Aufrufe)
-- Berater sehen Dokumente ihrer Kontakte
CREATE POLICY "berater_read_kontakt_dokumente" ON kontakt_dokumente
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Admin kann alle Dokumente sehen
CREATE POLICY "admin_read_kontakt_dokumente" ON kontakt_dokumente
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- Insert nur via Service-Key (API), daher kein INSERT-Policy nötig für anon/authenticated
-- Der Service-Key umgeht RLS automatisch
