-- Archivieren + Löschen von Kontakten

-- Archiv-Felder
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS archiviert BOOLEAN DEFAULT false;
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS archiviert_at TIMESTAMPTZ;

-- Berater dürfen ihre eigenen Kontakte löschen
CREATE POLICY "berater_delete_kontakte" ON kontakte
    FOR DELETE USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- Admin darf alle Kontakte löschen
CREATE POLICY "admin_delete_all_kontakte" ON kontakte
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );
