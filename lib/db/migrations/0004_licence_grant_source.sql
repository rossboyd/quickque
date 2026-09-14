-- Distinguish paid purchases from intentionally complimentary grants.
ALTER TABLE quickque_licences
  ADD COLUMN IF NOT EXISTS licence_source text NOT NULL DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS grant_note text;

ALTER TABLE quickque_licences
  DROP CONSTRAINT IF EXISTS quickque_licences_licence_source_check;

ALTER TABLE quickque_licences
  ADD CONSTRAINT quickque_licences_licence_source_check
  CHECK (licence_source IN ('purchase', 'gift', 'tester'));

CREATE INDEX IF NOT EXISTS quickque_licences_source_lookup
  ON quickque_licences (licence_source, active);