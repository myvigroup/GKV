-- ============================================================
-- GKV-RECHNER: Supabase Datenbank-Setup
-- ============================================================
-- Bestehende Tabellen werden gelöscht und neu erstellt.
-- ============================================================

-- Alte Tabellen entfernen (falls vorhanden)
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS berater CASCADE;

-- 1. BERATER-TABELLE
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
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_berater_slug ON berater(slug) WHERE aktiv = true;

-- 2. LEADS-TABELLE
CREATE TABLE leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vorname TEXT NOT NULL,
    nachname TEXT NOT NULL,
    email TEXT NOT NULL,
    telefon TEXT,
    berater_id UUID REFERENCES berater(id) ON DELETE SET NULL,
    berater_slug TEXT,
    kampagne TEXT,
    ref_source TEXT,
    gewaehlte_kasse TEXT,
    aktuelle_kasse TEXT,
    gehalt NUMERIC,
    beschaeftigung TEXT,
    familienstand TEXT,
    kinder INTEGER,
    sparpotenzial_jahr NUMERIC,
    session_id TEXT,
    status TEXT DEFAULT 'neu' CHECK (status IN ('neu', 'kontaktiert', 'termin', 'abgeschlossen', 'storniert')),
    notizen TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_leads_berater ON leads(berater_id, created_at DESC);
CREATE INDEX idx_leads_status ON leads(status);

-- 3. UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- 4. ROW LEVEL SECURITY
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE berater ENABLE ROW LEVEL SECURITY;

-- Jeder kann Leads einfügen (vom Rechner)
CREATE POLICY "anon_insert_leads" ON leads
    FOR INSERT WITH CHECK (true);

-- Berater sehen nur ihre eigenen Leads
CREATE POLICY "berater_own_leads" ON leads
    FOR SELECT USING (
        berater_id IN (
            SELECT id FROM berater WHERE auth_user_id = auth.uid()
        )
    );

-- Berater können Status/Notizen ihrer Leads updaten
CREATE POLICY "berater_update_leads" ON leads
    FOR UPDATE USING (
        berater_id IN (
            SELECT id FROM berater WHERE auth_user_id = auth.uid()
        )
    );

-- Aktive Berater sind öffentlich lesbar (für Rechner-Slug-Lookup)
CREATE POLICY "public_read_active_berater" ON berater
    FOR SELECT USING (aktiv = true);

-- Berater können ihr eigenes Profil updaten
CREATE POLICY "berater_update_own" ON berater
    FOR UPDATE USING (auth_user_id = auth.uid());

-- 5. INITIALE BERATER-DATEN (aus dem bestehenden Code)
INSERT INTO berater (slug, vorname, nachname, email, telefon, calendly_url, team) VALUES
    ('bastian-friede', 'Bastian', 'Friede', 'bastian.friede@mitnorm.com', '+49 123 456 7890', 'https://outlook.office.com/book/JahresupdatemitBastianFriede@mitNORM.com/s/Gio1_VlL-Euu0rWh4GFgfA2?ismsaljsauthenabled=true', 'mitNORM'),
    ('andreas-müller', 'Andreas', 'Müller', 'andreas.mueller@mitnorm.com', '+49 123 456 7893', 'https://outlook.office.com/book/JahresupdatemitBastianFriede@mitNORM.com/s/Gio1_VlL-Euu0rWh4GFgfA2?ismsaljsauthenabled=true', 'mitNORM'),
    ('lisa-mueller', 'Lisa', 'Müller', 'l.mueller@beispiel.de', '+49 123 456 7891', 'https://calendly.com/lisa-mueller/gkv-beratung', 'Vertrieb Süd'),
    ('max-schmidt', 'Max', 'Schmidt', 'm.schmidt@beispiel.de', '+49 123 456 7892', 'https://calendly.com/max-schmidt/gkv-beratung', 'Vertrieb West');
