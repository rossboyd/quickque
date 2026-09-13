-- Apply after 0001. Email is contact information, never an activation credential.
-- Existing testing licences can remain without a purchase email.
ALTER TABLE quickque_licences
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS purchased_at timestamptz NOT NULL DEFAULT now();

-- Multiple purchases can belong to the same email or Stripe customer.
CREATE INDEX IF NOT EXISTS quickque_licences_email_lookup
  ON quickque_licences (lower(btrim(customer_email)));
CREATE UNIQUE INDEX IF NOT EXISTS quickque_licences_checkout_purchase
  ON quickque_licences (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quickque_licences_subscription_purchase
  ON quickque_licences (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
