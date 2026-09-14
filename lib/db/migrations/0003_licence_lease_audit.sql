-- Append-only audit of signed leases. Raw purchase keys and full lease blobs are
-- deliberately excluded. Apply after 0001 and 0002.
CREATE TABLE IF NOT EXISTS quickque_licence_lease_audit (
  lease_id uuid PRIMARY KEY,
  licence_id uuid NOT NULL REFERENCES quickque_licences(id),
  device_id text NOT NULL CHECK (device_id ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK (action IN ('activate', 'renew', 'deactivate')),
  plan text NOT NULL CHECK (plan IN ('subscription', 'perpetual')),
  feature_ids text[] NOT NULL DEFAULT '{}',
  signing_key_id text NOT NULL CHECK (length(signing_key_id) BETWEEN 1 AND 64),
  issued_at bigint NOT NULL,
  refresh_after bigint NOT NULL,
  expires_at bigint,
  revoked boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (refresh_after >= issued_at),
  CHECK (expires_at IS NULL OR expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS quickque_licence_lease_audit_licence_time
  ON quickque_licence_lease_audit (licence_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS quickque_licence_lease_audit_device_time
  ON quickque_licence_lease_audit (device_id, issued_at DESC);