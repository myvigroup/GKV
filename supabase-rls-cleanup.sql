-- ============================================================
-- RLS POLICIES AUFRÄUMEN
-- ============================================================

-- 1. kunden_dokumente: anon_insert einschränken (nur mit gültiger kontakt_id)
DROP POLICY IF EXISTS "anon_insert_dokumente" ON kunden_dokumente;
CREATE POLICY "anon_insert_dokumente" ON kunden_dokumente
    FOR INSERT WITH CHECK (
        kontakt_id IN (SELECT id FROM kontakte)
    );

-- 2. berater: öffentlichen Zugriff auf nötige Felder beschränken
-- Aktuell: alle aktiven Berater mit ALLEN Feldern öffentlich lesbar
-- Neu: nur slug und Felder die der Rechner braucht
DROP POLICY IF EXISTS "public_read_active_berater" ON berater;
CREATE POLICY "public_read_active_berater" ON berater
    FOR SELECT USING (aktiv = true);
-- Hinweis: Die Felder-Einschränkung passiert im Frontend (select('slug,vorname,nachname,bild_url'))
-- Supabase RLS kann keine Spalten filtern, nur Zeilen

-- 3. anrufe: RLS aktivieren und Policies setzen
ALTER TABLE anrufe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "berater_read_anrufe" ON anrufe
    FOR SELECT USING (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

CREATE POLICY "admin_read_all_anrufe" ON anrufe
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM berater WHERE auth_user_id = auth.uid() AND is_admin = true)
    );

-- Service-Role (Webhooks) umgeht RLS automatisch → kein INSERT-Policy nötig

-- 4. kontakt_dokumente: INSERT für Berater erlauben
CREATE POLICY "berater_insert_kontakt_dokumente" ON kontakt_dokumente
    FOR INSERT WITH CHECK (
        berater_id IN (SELECT id FROM berater WHERE auth_user_id = auth.uid())
    );

-- 5. Storage: anon_upload einschränken
-- ACHTUNG: Storage-Policies werden im Supabase Dashboard unter Storage → Policies verwaltet
-- Die anon_upload_dokumente Policy sollte entfernt oder eingeschränkt werden.
-- Da Storage-Policies nicht per SQL geändert werden können, bitte manuell im Dashboard:
-- Storage → kunden-dokumente → Policies → anon_upload_dokumente → DELETE

-- 6. Sicherstellen: alte leads/kunden Policies aufräumen (Tabellen sind gelöscht)
-- Falls Policies noch existieren, werden sie mit den Tabellen gelöscht (CASCADE)
