-- ============================================================
-- KUNDEN-SYSTEM: Individuelle Links für Bestandskunden
-- ============================================================

-- 1. KUNDEN-TABELLE
CREATE TABLE IF NOT EXISTS kunden (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    berater_id UUID REFERENCES berater(id) ON DELETE CASCADE NOT NULL,
    code TEXT UNIQUE NOT NULL,
    vorname TEXT NOT NULL,
    nachname TEXT NOT NULL,
    email TEXT,
    telefon TEXT,
    notizen TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kunden_code ON kunden(code);
CREATE INDEX idx_kunden_berater ON kunden(berater_id);

-- 2. KUNDEN-BERECHNUNGEN
CREATE TABLE IF NOT EXISTS kunden_berechnungen (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kunde_id UUID REFERENCES kunden(id) ON DELETE CASCADE NOT NULL,
    berater_id UUID REFERENCES berater(id) ON DELETE CASCADE,
    gehalt NUMERIC,
    beschaeftigung TEXT,
    familienstand TEXT,
    kinder INTEGER,
    aktuelle_kasse TEXT,
    guenstigste_kasse TEXT,
    guenstigster_beitrag NUMERIC,
    aktueller_beitrag NUMERIC,
    sparpotenzial_jahr NUMERIC,
    top5 JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kb_kunde ON kunden_berechnungen(kunde_id, created_at DESC);

-- 3. ROW LEVEL SECURITY
ALTER TABLE kunden ENABLE ROW LEVEL SECURITY;
ALTER TABLE kunden_berechnungen ENABLE ROW LEVEL SECURITY;

-- Berater können ihre eigenen Kunden lesen
CREATE POLICY "berater_read_kunden" ON kunden
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Berater können Kunden anlegen
CREATE POLICY "berater_insert_kunden" ON kunden
    FOR INSERT WITH CHECK (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Berater können ihre Kunden bearbeiten
CREATE POLICY "berater_update_kunden" ON kunden
    FOR UPDATE USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Öffentlich: Kunde per Code auffindbar (für Rechner-Lookup)
CREATE POLICY "public_read_kunde_by_code" ON kunden
    FOR SELECT USING (true);

-- Jeder kann Berechnungen einfügen (vom Rechner)
CREATE POLICY "anon_insert_berechnungen" ON kunden_berechnungen
    FOR INSERT WITH CHECK (true);

-- Berater sehen Berechnungen ihrer Kunden
CREATE POLICY "berater_read_berechnungen" ON kunden_berechnungen
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );
