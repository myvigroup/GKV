-- Email-Abmeldung: neues Feld in kontakte
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS email_abgemeldet BOOLEAN DEFAULT false;
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS email_abgemeldet_at TIMESTAMPTZ;
