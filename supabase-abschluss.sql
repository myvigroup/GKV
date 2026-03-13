-- Abschluss-Details auf kontakte speichern
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS abschluss_art TEXT;
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS empfehlungen_anzahl INTEGER DEFAULT 0;
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS abschluss_notiz TEXT;
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS abgeschlossen_at TIMESTAMPTZ;

-- Aktivität / Sub-Status (z.B. "Nicht erreicht", "Mailbox", etc.)
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS sub_status TEXT;
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS sub_status_at TIMESTAMPTZ;
