-- Booking-Integration: Termin-Daten auf kontakte speichern
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS termin_datum TIMESTAMPTZ;
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS termin_gebucht_at TIMESTAMPTZ;
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS termin_storniert_at TIMESTAMPTZ;
