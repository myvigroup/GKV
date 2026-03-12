-- ============================================================
-- ADMIN-SYSTEM: Übergreifende Verwaltung aller Berater & Kunden
-- ============================================================

-- 1. Admin-Flag auf Berater-Tabelle
ALTER TABLE berater ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- 2. Admin kann ALLE Leads lesen
CREATE POLICY "admin_read_all_leads" ON leads
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- 3. Admin kann ALLE Leads updaten
CREATE POLICY "admin_update_all_leads" ON leads
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- 4. Admin kann ALLE Kunden lesen
CREATE POLICY "admin_read_all_kunden" ON kunden
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- 5. Admin kann ALLE Kunden bearbeiten (z.B. Berater-Zuordnung ändern)
CREATE POLICY "admin_update_all_kunden" ON kunden
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- 6. Admin kann Kunden anlegen (auch für andere Berater)
CREATE POLICY "admin_insert_kunden" ON kunden
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- 7. Admin kann ALLE Berechnungen lesen
CREATE POLICY "admin_read_all_berechnungen" ON kunden_berechnungen
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- 8. Admin kann alle Berater lesen (auch inaktive)
CREATE POLICY "admin_read_all_berater" ON berater
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- Admin aktivieren (z.B. für Bastian Friede):
-- UPDATE berater SET is_admin = true WHERE slug = 'bastian-friede';
