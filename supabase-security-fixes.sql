-- ============================================================
-- SECURITY FIXES
-- ============================================================

-- FIX 1: Öffentlicher Zugriff auf kontakte einschränken
-- VORHER: Jeder kann ALLE Kontakte mit Code lesen (Name, Email, Gehalt, etc.)
-- NACHHER: Nur spezifische Felder via RPC-Funktion
DROP POLICY IF EXISTS "public_read_kontakt_by_code" ON kontakte;

-- Stattdessen: Eingeschränkte Funktion die nur nötige Felder zurückgibt
CREATE OR REPLACE FUNCTION lookup_kontakt_by_code(lookup_code TEXT)
RETURNS TABLE (id UUID, vorname TEXT, nachname TEXT, code TEXT, berater_id UUID, berater_slug TEXT)
LANGUAGE sql SECURITY DEFINER
AS $$
    SELECT id, vorname, nachname, code, berater_id, berater_slug
    FROM kontakte
    WHERE code = lookup_code
    LIMIT 1;
$$;

-- FIX 2: Webhook-Update-Policy auf kunden_emails entfernen
-- Die service_role (von Webhooks benutzt) umgeht RLS automatisch
DROP POLICY IF EXISTS "webhook_update_emails" ON kunden_emails;
DROP POLICY IF EXISTS "webhook_insert_emails" ON kunden_emails;

-- FIX 3: Anon-Insert einschränken
-- Nur mit gültigem berater_slug erlaubt
DROP POLICY IF EXISTS "anon_insert_kontakte" ON kontakte;
CREATE POLICY "anon_insert_kontakte" ON kontakte
    FOR INSERT WITH CHECK (
        berater_slug IS NOT NULL
        AND berater_slug IN (SELECT slug FROM berater)
    );

-- FIX 4: Service-Role Bypass sicherstellen für Webhooks
-- (service_role umgeht RLS per Default, kein Policy nötig)

-- FIX 5: Anon-Insert auf kunden_berechnungen einschränken
-- Nur wenn kontakt_id existiert
DROP POLICY IF EXISTS "anon_insert_berechnungen" ON kunden_berechnungen;
CREATE POLICY "anon_insert_berechnungen" ON kunden_berechnungen
    FOR INSERT WITH CHECK (
        kontakt_id IN (SELECT id FROM kontakte)
    );
