-- ============================================================
-- MIGRATION: kunden + leads → kontakte (einheitliche Tabelle)
-- ============================================================
-- ACHTUNG: Vor Ausführung ein Backup der Datenbank machen!
-- Reihenfolge: 1) kontakte erstellen, 2) Daten migrieren,
-- 3) FK-Referenzen updaten, 4) RLS-Policies, 5) alte Tabellen droppen
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. NEUE KONTAKTE-TABELLE
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kontakte (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vorname TEXT NOT NULL,
    nachname TEXT NOT NULL,
    email TEXT,
    telefon TEXT,
    notizen TEXT,

    -- Berater-Zuordnung
    berater_id UUID REFERENCES berater(id) ON DELETE SET NULL,
    berater_slug TEXT,

    -- Kunden-Code (NULL bei Leads, unique bei Kunden)
    code TEXT UNIQUE,

    -- Marketing / Herkunft
    kampagne TEXT,
    ref_source TEXT,
    session_id TEXT,

    -- Versicherungs-Eckdaten
    gewaehlte_kasse TEXT,
    aktuelle_kasse TEXT,
    gehalt NUMERIC,
    beschaeftigung TEXT,
    familienstand TEXT,
    kinder INTEGER,
    sparpotenzial_jahr NUMERIC,

    -- Status-Pipeline
    status TEXT DEFAULT 'neu' CHECK (status IN ('neu', 'kontaktiert', 'berechnet', 'termin', 'abgeschlossen', 'storniert')),

    -- Integration
    finfire_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kontakte_berater ON kontakte(berater_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kontakte_status ON kontakte(status);
CREATE INDEX IF NOT EXISTS idx_kontakte_code ON kontakte(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kontakte_finfire ON kontakte(finfire_id) WHERE finfire_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kontakte_email ON kontakte(email) WHERE email IS NOT NULL;

-- Updated_at Trigger
CREATE TRIGGER kontakte_updated_at
    BEFORE UPDATE ON kontakte
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════════════════
-- 2. DATEN MIGRIEREN (UUIDs bleiben erhalten!)
-- ══════════════════════════════════════════════════════════════

-- Leads übernehmen
INSERT INTO kontakte (
    id, vorname, nachname, email, telefon, notizen,
    berater_id, berater_slug, kampagne, ref_source, session_id,
    gewaehlte_kasse, aktuelle_kasse, gehalt, beschaeftigung,
    familienstand, kinder, sparpotenzial_jahr,
    status, finfire_id, created_at, updated_at
)
SELECT
    id, vorname, nachname, email, telefon, notizen,
    berater_id, berater_slug, kampagne, ref_source, session_id,
    gewaehlte_kasse, aktuelle_kasse, gehalt, beschaeftigung,
    familienstand, kinder, sparpotenzial_jahr,
    COALESCE(status, 'neu'), finfire_id, created_at, COALESCE(updated_at, created_at)
FROM leads
ON CONFLICT (id) DO NOTHING;

-- Kunden übernehmen
INSERT INTO kontakte (
    id, vorname, nachname, email, telefon, notizen,
    berater_id, code,
    status, finfire_id, created_at, updated_at
)
SELECT
    id, vorname, nachname, email, telefon, notizen,
    berater_id, code,
    COALESCE(status, 'neu'), finfire_id, created_at, created_at
FROM kunden
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 3. FK-REFERENZEN IN ABHÄNGIGEN TABELLEN UPDATEN
-- ══════════════════════════════════════════════════════════════

-- kunden_berechnungen: kunde_id → kontakt_id
ALTER TABLE kunden_berechnungen RENAME COLUMN kunde_id TO kontakt_id;
ALTER TABLE kunden_berechnungen DROP CONSTRAINT IF EXISTS kunden_berechnungen_kunde_id_fkey;
ALTER TABLE kunden_berechnungen ADD CONSTRAINT kunden_berechnungen_kontakt_id_fkey
    FOREIGN KEY (kontakt_id) REFERENCES kontakte(id) ON DELETE CASCADE;

-- kunden_emails: kunde_id → kontakt_id
ALTER TABLE kunden_emails RENAME COLUMN kunde_id TO kontakt_id;
ALTER TABLE kunden_emails DROP CONSTRAINT IF EXISTS kunden_emails_kunde_id_fkey;
ALTER TABLE kunden_emails ADD CONSTRAINT kunden_emails_kontakt_id_fkey
    FOREIGN KEY (kontakt_id) REFERENCES kontakte(id) ON DELETE CASCADE;

-- kunden_dokumente: kunde_id → kontakt_id
ALTER TABLE kunden_dokumente RENAME COLUMN kunde_id TO kontakt_id;
ALTER TABLE kunden_dokumente DROP CONSTRAINT IF EXISTS kunden_dokumente_kunde_id_fkey;
ALTER TABLE kunden_dokumente ADD CONSTRAINT kunden_dokumente_kontakt_id_fkey
    FOREIGN KEY (kontakt_id) REFERENCES kontakte(id) ON DELETE CASCADE;

-- Indexes auf neuen Spaltennamen
DROP INDEX IF EXISTS idx_kb_kunde;
CREATE INDEX IF NOT EXISTS idx_kb_kontakt ON kunden_berechnungen(kontakt_id, created_at DESC);

DROP INDEX IF EXISTS idx_ke_kunde;
CREATE INDEX IF NOT EXISTS idx_ke_kontakt ON kunden_emails(kontakt_id, created_at DESC);

DROP INDEX IF EXISTS idx_kd_kunde;
CREATE INDEX IF NOT EXISTS idx_kd_kontakt ON kunden_dokumente(kontakt_id, created_at DESC);

-- kontakt_dokumente: kontakt_type CHECK entfernen (nicht mehr nötig)
ALTER TABLE kontakt_dokumente DROP CONSTRAINT IF EXISTS kontakt_dokumente_kontakt_type_check;
-- kontakt_id referenziert jetzt kontakte(id) direkt
ALTER TABLE kontakt_dokumente ADD CONSTRAINT kontakt_dokumente_kontakt_id_fkey
    FOREIGN KEY (kontakt_id) REFERENCES kontakte(id) ON DELETE CASCADE;

-- ══════════════════════════════════════════════════════════════
-- 4. RLS POLICIES FÜR KONTAKTE
-- ══════════════════════════════════════════════════════════════

ALTER TABLE kontakte ENABLE ROW LEVEL SECURITY;

-- Anon kann Kontakte anlegen (vom Rechner)
CREATE POLICY "anon_insert_kontakte" ON kontakte
    FOR INSERT WITH CHECK (true);

-- Berater sehen ihre eigenen Kontakte
CREATE POLICY "berater_read_kontakte" ON kontakte
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Berater können ihre Kontakte bearbeiten
CREATE POLICY "berater_update_kontakte" ON kontakte
    FOR UPDATE USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Öffentlich: Kontakt per Code auffindbar (für Rechner-Lookup)
CREATE POLICY "public_read_kontakt_by_code" ON kontakte
    FOR SELECT USING (code IS NOT NULL);

-- Admin kann ALLE Kontakte lesen
CREATE POLICY "admin_read_all_kontakte" ON kontakte
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- Admin kann ALLE Kontakte bearbeiten
CREATE POLICY "admin_update_all_kontakte" ON kontakte
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- Admin kann Kontakte anlegen
CREATE POLICY "admin_insert_kontakte" ON kontakte
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- ══════════════════════════════════════════════════════════════
-- 5. RLS FÜR ABHÄNGIGE TABELLEN (kontakt_id statt kunde_id)
-- ══════════════════════════════════════════════════════════════

-- kunden_berechnungen: bestehende Policies behalten (berater_id basiert)
-- kunden_emails: bestehende Policies behalten (berater_id basiert)
-- kunden_dokumente: bestehende Policies behalten (berater_id basiert)

-- ══════════════════════════════════════════════════════════════
-- 6. ALTE TABELLEN DROPPEN (ERST NACH ERFOLGREICHEM CODE-DEPLOY!)
-- ══════════════════════════════════════════════════════════════
-- ACHTUNG: Diese Zeilen ERST ausführen wenn der neue Code deployed ist!
-- Vorher testen ob alles mit kontakte funktioniert!

-- DROP TABLE IF EXISTS leads CASCADE;
-- DROP TABLE IF EXISTS kunden CASCADE;
