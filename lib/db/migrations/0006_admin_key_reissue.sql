ALTER TABLE quickque_licence_admin_audit
  DROP CONSTRAINT IF EXISTS quickque_licence_admin_audit_action_check;

ALTER TABLE quickque_licence_admin_audit
  ADD CONSTRAINT quickque_licence_admin_audit_action_check
  CHECK (action IN (
    'create_gift',
    'create_tester',
    'activate',
    'revoke',
    'remove_device',
    'reissue_key'
  ));