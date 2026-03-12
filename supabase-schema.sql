-- ============================================================
-- GKV-RECHNER: Vollständiges Datenbankschema (Stand: März 2026)
-- ============================================================
-- Dieses Schema ist die aktuelle Referenz.
-- Tabellen: berater, kontakte, kunden_berechnungen,
--           kunden_emails, kunden_dokumente, kontakt_dokumente
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- HILFSFUNKTIONEN
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sicherer Code-Lookup für den Rechner (gibt nur nötige Felder zurück)
CREATE OR REPLACE FUNCTION lookup_kontakt_by_code(lookup_code TEXT)
RETURNS TABLE (id UUID, vorname TEXT, nachname TEXT, code TEXT, berater_id UUID, berater_slug TEXT)
LANGUAGE sql SECURITY DEFINER
AS $$
    SELECT id, vorname, nachname, code, berater_id, berater_slug
    FROM kontakte
    WHERE code = lookup_code
    LIMIT 1;
$$;

-- ══════════════════════════════════════════════════════════════
-- 1. BERATER
-- ══════════════════════════════════════════════════════════════

CREATE TABLE berater (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    vorname TEXT NOT NULL,
    nachname TEXT NOT NULL,
    titel TEXT DEFAULT '',
    email TEXT UNIQUE NOT NULL,
    telefon TEXT,
    calendly_url TEXT,
    bild_url TEXT,
    team TEXT,
    aktiv BOOLEAN DEFAULT true,
    is_admin BOOLEAN DEFAULT false,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    last_login_at TIMESTAMPTZ,
    last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_berater_slug ON berater(slug) WHERE aktiv = true;

ALTER TABLE berater ENABLE ROW LEVEL SECURITY;

-- Aktive Berater sind öffentlich lesbar (für Rechner-Slug-Lookup)
CREATE POLICY "public_read_active_berater" ON berater
    FOR SELECT USING (aktiv = true);

-- Berater können ihr eigenes Profil updaten
CREATE POLICY "berater_update_own" ON berater
    FOR UPDATE USING (auth_user_id = auth.uid());

-- Admin kann alle Berater lesen (auch inaktive)
CREATE POLICY "admin_read_all_berater" ON berater
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- ══════════════════════════════════════════════════════════════
-- 2. KONTAKTE (vereinheitlicht aus kunden + leads)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE kontakte (
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

    -- Email-Abmeldung
    email_abgemeldet BOOLEAN DEFAULT false,
    email_abgemeldet_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kontakte_berater ON kontakte(berater_id, created_at DESC);
CREATE INDEX idx_kontakte_status ON kontakte(status);
CREATE INDEX idx_kontakte_code ON kontakte(code) WHERE code IS NOT NULL;
CREATE INDEX idx_kontakte_finfire ON kontakte(finfire_id) WHERE finfire_id IS NOT NULL;
CREATE INDEX idx_kontakte_email ON kontakte(email) WHERE email IS NOT NULL;

CREATE TRIGGER kontakte_updated_at
    BEFORE UPDATE ON kontakte
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

ALTER TABLE kontakte ENABLE ROW LEVEL SECURITY;

-- Anon kann Kontakte anlegen (vom Rechner, nur mit gültigem Berater)
CREATE POLICY "anon_insert_kontakte" ON kontakte
    FOR INSERT WITH CHECK (
        berater_slug IS NOT NULL
        AND berater_slug IN (SELECT slug FROM berater)
    );

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
-- 3. KUNDEN-BERECHNUNGEN
-- ══════════════════════════════════════════════════════════════

CREATE TABLE kunden_berechnungen (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kontakt_id UUID REFERENCES kontakte(id) ON DELETE CASCADE NOT NULL,
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

CREATE INDEX idx_kb_kontakt ON kunden_berechnungen(kontakt_id, created_at DESC);

ALTER TABLE kunden_berechnungen ENABLE ROW LEVEL SECURITY;

-- Anon kann Berechnungen einfügen (vom Rechner, nur für existierende Kontakte)
CREATE POLICY "anon_insert_berechnungen" ON kunden_berechnungen
    FOR INSERT WITH CHECK (
        kontakt_id IN (SELECT id FROM kontakte)
    );

-- Berater sehen Berechnungen ihrer Kontakte
CREATE POLICY "berater_read_berechnungen" ON kunden_berechnungen
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Admin kann alle Berechnungen lesen
CREATE POLICY "admin_read_all_berechnungen" ON kunden_berechnungen
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- ══════════════════════════════════════════════════════════════
-- 4. KUNDEN-EMAILS (Tracking)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE kunden_emails (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kontakt_id UUID REFERENCES kontakte(id) ON DELETE CASCADE NOT NULL,
    berater_id UUID REFERENCES berater(id) ON DELETE SET NULL,
    brevo_message_id TEXT,
    subject TEXT,
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'clicked', 'bounced')),
    quelle TEXT DEFAULT 'dashboard',
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ke_kontakt ON kunden_emails(kontakt_id, created_at DESC);
CREATE INDEX idx_ke_message ON kunden_emails(brevo_message_id) WHERE brevo_message_id IS NOT NULL;

ALTER TABLE kunden_emails ENABLE ROW LEVEL SECURITY;

-- Berater sehen Emails ihrer Kontakte
CREATE POLICY "berater_read_emails" ON kunden_emails
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Berater können Emails einfügen
CREATE POLICY "berater_insert_emails" ON kunden_emails
    FOR INSERT WITH CHECK (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Admin kann alle Emails lesen
CREATE POLICY "admin_read_all_emails" ON kunden_emails
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- Webhook-Updates laufen über Service-Key (umgeht RLS automatisch)

-- ══════════════════════════════════════════════════════════════
-- 5. KUNDEN-DOKUMENTE (Upload vom Kunden)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE kunden_dokumente (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kontakt_id UUID REFERENCES kontakte(id) ON DELETE CASCADE NOT NULL,
    berater_id UUID REFERENCES berater(id) ON DELETE CASCADE NOT NULL,
    dateiname TEXT NOT NULL,
    original_name TEXT NOT NULL,
    typ TEXT NOT NULL CHECK (typ IN ('gehaltsnachweis', 'kassenbescheid', 'kuendigung', 'sonstiges')),
    storage_path TEXT NOT NULL,
    dateigroesse INTEGER,
    mime_type TEXT,
    notiz TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kd_kontakt ON kunden_dokumente(kontakt_id, created_at DESC);

ALTER TABLE kunden_dokumente ENABLE ROW LEVEL SECURITY;

-- Anon kann Dokumente hochladen (nur für existierende Kontakte)
CREATE POLICY "anon_insert_dokumente" ON kunden_dokumente
    FOR INSERT WITH CHECK (
        kontakt_id IN (SELECT id FROM kontakte)
    );

-- Berater sehen Dokumente ihrer Kontakte
CREATE POLICY "berater_read_dokumente" ON kunden_dokumente
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Admin kann alle Dokumente sehen
CREATE POLICY "admin_read_all_dokumente" ON kunden_dokumente
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- ══════════════════════════════════════════════════════════════
-- 6. KONTAKT-DOKUMENTE (Generierte PDFs etc.)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE kontakt_dokumente (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kontakt_id UUID NOT NULL REFERENCES kontakte(id) ON DELETE CASCADE,
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

CREATE INDEX idx_kd2_kontakt ON kontakt_dokumente(kontakt_id, created_at DESC);

ALTER TABLE kontakt_dokumente ENABLE ROW LEVEL SECURITY;

-- Berater sehen Dokumente ihrer Kontakte
CREATE POLICY "berater_read_kontakt_dokumente" ON kontakt_dokumente
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Berater können Dokumente einfügen
CREATE POLICY "berater_insert_kontakt_dokumente" ON kontakt_dokumente
    FOR INSERT WITH CHECK (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Admin kann alle Dokumente sehen
CREATE POLICY "admin_read_kontakt_dokumente" ON kontakt_dokumente
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- Insert via Service-Key (API) umgeht RLS automatisch

-- ══════════════════════════════════════════════════════════════
-- 7. STORAGE BUCKET
-- ══════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'kunden-dokumente',
    'kunden-dokumente',
    false,
    10485760,  -- 10 MB
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Berater kann Dokumente seiner Kontakte lesen
CREATE POLICY "berater_read_dokumente_storage" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'kunden-dokumente'
        AND EXISTS (
            SELECT 1 FROM kunden_dokumente kd
            JOIN berater b ON kd.berater_id = b.id
            WHERE kd.storage_path = name
            AND b.auth_user_id = auth.uid()
        )
    );

-- Admin kann alles im Storage lesen
CREATE POLICY "admin_read_dokumente_storage" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'kunden-dokumente'
        AND EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );
