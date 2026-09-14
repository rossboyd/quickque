CREATE TABLE IF NOT EXISTS quickque_licence_admin_audit (
  id uuid PRIMARY KEY,
  admin_user_id text NOT NULL,
  licence_id uuid REFERENCES quickque_licences(id),
  action text NOT NULL CHECK (action IN ('create_gift','create_tester','activate','revoke','remove_device')),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quickque_licence_admin_audit_time
  ON quickque_licence_admin_audit (created_at DESC);