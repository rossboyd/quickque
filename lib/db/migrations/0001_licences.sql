-- Apply explicitly before enabling the licence service. Purchase fulfilment is server-only.
CREATE TABLE IF NOT EXISTS quickque_licences (
  id uuid PRIMARY KEY,
  key_hash text NOT NULL UNIQUE,
  plan text NOT NULL CHECK (plan IN ('subscription', 'perpetual')),
  active boolean NOT NULL DEFAULT true,
  paid_through bigint,
  updates_until bigint,
  device_limit integer NOT NULL DEFAULT 2 CHECK (device_limit BETWEEN 1 AND 100),
  CHECK (plan <> 'subscription' OR paid_through IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS quickque_licence_devices (
  licence_id uuid NOT NULL REFERENCES quickque_licences(id),
  device_id text NOT NULL CHECK (device_id ~ '^[a-f0-9]{64}$'),
  activated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (licence_id, device_id)
);
