-- ============================================================
-- DOKUMENTE: Kunden-Dokument-Upload-System
-- ============================================================

CREATE TABLE IF NOT EXISTS kunden_dokumente (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kunde_id UUID REFERENCES kunden(id) ON DELETE CASCADE NOT NULL,
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

CREATE INDEX idx_kd_kunde ON kunden_dokumente(kunde_id, created_at DESC);
CREATE INDEX idx_kd_berater ON kunden_dokumente(berater_id);

ALTER TABLE kunden_dokumente ENABLE ROW LEVEL SECURITY;

-- Anon (Kunde) kann Dokumente hochladen
CREATE POLICY "anon_insert_dokumente" ON kunden_dokumente
    FOR INSERT WITH CHECK (true);

-- Berater sehen Dokumente ihrer Kunden
CREATE POLICY "berater_read_dokumente" ON kunden_dokumente
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Admin kann alle Dokumente sehen
CREATE POLICY "admin_read_all_dokumente" ON kunden_dokumente
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- ============================================================
-- STORAGE BUCKET (im Supabase SQL Editor ausfuehren)
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'kunden-dokumente',
    'kunden-dokumente',
    false,
    10485760,  -- 10 MB
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Anon kann hochladen
CREATE POLICY "anon_upload_dokumente" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'kunden-dokumente');

-- Berater kann Dokumente seiner Kunden lesen
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

-- Admin kann alles lesen
CREATE POLICY "admin_read_dokumente_storage" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'kunden-dokumente'
        AND EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );
