-- RPC-Funktion: Lead-Daten aktualisieren (sicher, ohne anon UPDATE Policy)
-- Wird vom Rechner aufgerufen wenn ein bestehender Kontakt (per code) berechnet

CREATE OR REPLACE FUNCTION update_kontakt_by_code(
    kontakt_code TEXT,
    p_vorname TEXT DEFAULT NULL,
    p_nachname TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_telefon TEXT DEFAULT NULL,
    p_gewaehlte_kasse TEXT DEFAULT NULL,
    p_aktuelle_kasse TEXT DEFAULT NULL,
    p_gehalt NUMERIC DEFAULT NULL,
    p_beschaeftigung TEXT DEFAULT NULL,
    p_familienstand TEXT DEFAULT NULL,
    p_kinder INTEGER DEFAULT NULL,
    p_sparpotenzial_jahr NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_kontakt kontakte%ROWTYPE;
BEGIN
    -- Kontakt per code finden
    SELECT * INTO v_kontakt FROM kontakte WHERE code = kontakt_code;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Kontakt nicht gefunden');
    END IF;

    -- Update nur die Felder die übergeben wurden
    UPDATE kontakte SET
        vorname = COALESCE(p_vorname, vorname),
        nachname = COALESCE(p_nachname, nachname),
        email = COALESCE(p_email, email),
        telefon = COALESCE(p_telefon, telefon),
        gewaehlte_kasse = COALESCE(p_gewaehlte_kasse, gewaehlte_kasse),
        aktuelle_kasse = COALESCE(p_aktuelle_kasse, aktuelle_kasse),
        gehalt = COALESCE(p_gehalt, gehalt),
        beschaeftigung = COALESCE(p_beschaeftigung, beschaeftigung),
        familienstand = COALESCE(p_familienstand, familienstand),
        kinder = COALESCE(p_kinder, kinder),
        sparpotenzial_jahr = COALESCE(p_sparpotenzial_jahr, sparpotenzial_jahr),
        updated_at = now()
    WHERE id = v_kontakt.id;

    RETURN json_build_object('success', true, 'id', v_kontakt.id);
END;
$$;

-- RPC-Funktion: Kontakt per E-Mail + Berater suchen (Dubletten-Check)
CREATE OR REPLACE FUNCTION lookup_kontakt_by_email(
    p_email TEXT,
    p_berater_id UUID
)
RETURNS TABLE (id UUID, code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT k.id, k.code
    FROM kontakte k
    WHERE k.email = p_email
      AND k.berater_id = p_berater_id
    ORDER BY k.created_at DESC
    LIMIT 1;
END;
$$;
