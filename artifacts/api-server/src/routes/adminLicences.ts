import { randomBytes, randomUUID } from 'node:crypto';
import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { keyHash } from '../licensing/lease';
import { requireQuickqueAdmin } from '../middlewares/requireQuickqueAdmin';

const router: IRouter = Router();
router.use('/admin', requireQuickqueAdmin);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const devicePattern = /^[a-f0-9]{64}$/;

function publicRow(row: any) {
  return {
    id: row.id, email: row.customer_email, plan: row.plan, source: row.licence_source,
    active: row.active, paidThrough: row.paid_through === null ? null : new Date(Number(row.paid_through) * 1000).toISOString(),
    purchasedAt: row.purchased_at, deviceLimit: row.device_limit,
    stripeCustomerId: row.stripe_customer_id, stripeSubscriptionId: row.stripe_subscription_id,
    stripeCheckoutSessionId: row.stripe_checkout_session_id, deviceCount: Number(row.device_count ?? 0),
  };
}

router.get('/admin/summary', async (_req, res): Promise<void> => {
  const { rows } = await pool.query(`SELECT count(*)::int total,
    count(*) FILTER (WHERE active)::int active,
    count(*) FILTER (WHERE licence_source='gift')::int gifts,
    count(*) FILTER (WHERE licence_source='tester')::int testers,
    count(*) FILTER (WHERE plan='subscription')::int subscriptions,
    count(*) FILTER (WHERE plan='perpetual')::int lifetime
    FROM quickque_licences`);
  const recent = await pool.query('SELECT count(*)::int count FROM quickque_licence_lease_audit WHERE recorded_at > now() - interval \'7 days\'');
  res.json({ ...rows[0], recentIssuances: recent.rows[0].count });
});

router.get('/admin/licences', async (req, res): Promise<void> => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : '';
  const { rows } = await pool.query(`SELECT l.*, count(d.device_id)::int device_count
    FROM quickque_licences l LEFT JOIN quickque_licence_devices d ON d.licence_id=l.id
    WHERE $1='' OR l.customer_email ILIKE '%' || $1 || '%' OR l.id::text=$1
    OR coalesce(l.stripe_customer_id,'') ILIKE '%' || $1 || '%'
    GROUP BY l.id ORDER BY l.purchased_at DESC LIMIT 200`, [search]);
  res.json(rows.map(publicRow));
});

router.get('/admin/licences/:id', async (req, res): Promise<void> => {
  if (!uuidPattern.test(req.params.id as string)) { res.status(400).json({ error: 'Invalid licence' }); return; }
  const result = await pool.query(`SELECT l.*, count(d.device_id)::int device_count
    FROM quickque_licences l LEFT JOIN quickque_licence_devices d ON d.licence_id=l.id
    WHERE l.id=$1 GROUP BY l.id`, [req.params.id]);
  if (!result.rows[0]) { res.status(404).json({ error: 'Licence not found' }); return; }
  const devices = await pool.query(`SELECT device_id id, device_id "hardwareId",
    'Not recorded' model, 'Not recorded' "osVersion", activated_at "firstSeenAt",
    activated_at "lastSeenAt", true active
    FROM quickque_licence_devices WHERE licence_id=$1 ORDER BY activated_at DESC`, [req.params.id]);
  const leases = await pool.query(`SELECT id, action, "createdAt", "ipAddress", details FROM (
    SELECT lease_id id, action, recorded_at "createdAt",
      NULL::text "ipAddress", concat('Plan: ', plan, '; expires: ', coalesce(expires_at::text,'never'), '; revoked: ', revoked::text) details
      FROM quickque_licence_lease_audit WHERE licence_id=$1
    UNION ALL
    SELECT id, action, created_at "createdAt", NULL::text "ipAddress",
      CASE WHEN details = '{}'::jsonb THEN NULL ELSE details::text END details
      FROM quickque_licence_admin_audit WHERE licence_id=$1
    ) activity ORDER BY "createdAt" DESC LIMIT 100`, [req.params.id]);
  const usage = await pool.query(`SELECT
    EXISTS(SELECT 1 FROM quickque_licence_devices WHERE licence_id=$1)
    OR EXISTS(SELECT 1 FROM quickque_licence_lease_audit WHERE licence_id=$1)
    AS used`, [req.params.id]);
  res.json({ ...publicRow(result.rows[0]), canDelete: !usage.rows[0].used, devices: devices.rows, auditRows: leases.rows });
});

router.delete('/admin/licences/:id', async (req, res): Promise<void> => {
  if (!uuidPattern.test(req.params.id as string)) { res.status(400).json({ error: 'Invalid licence' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const licence = await client.query(`SELECT * FROM quickque_licences
      WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!licence.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Licence not found' }); return; }
    const usage = await client.query(`SELECT
      EXISTS(SELECT 1 FROM quickque_licence_devices WHERE licence_id=$1)
      OR EXISTS(SELECT 1 FROM quickque_licence_lease_audit WHERE licence_id=$1)
      AS used`, [req.params.id]);
    if (usage.rows[0].used) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'A licence that has activated a device or issued a lease cannot be deleted' });
      return;
    }
    await client.query(`INSERT INTO quickque_licence_admin_audit
      (id,admin_user_id,licence_id,action,details) VALUES($1,$2,$3,'delete_licence',$4)`,
      [randomUUID(),res.locals.adminUserId,req.params.id,{
        licenceId: req.params.id,
        plan: licence.rows[0].plan,
        source: licence.rows[0].licence_source,
      }]);
    await client.query('DELETE FROM quickque_licences WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

router.post('/admin/licences', async (req, res): Promise<void> => {
  const { email, source, plan, paidThrough, note } = req.body ?? {};
  const paidThroughSeconds = typeof paidThrough === 'string'
    ? Math.floor(new Date(paidThrough).getTime() / 1000)
    : NaN;
  if (typeof email !== 'string' || !emailPattern.test(email) ||
      !['gift','tester'].includes(source) || !['perpetual','subscription'].includes(plan) ||
      (source === 'gift' && plan !== 'perpetual') ||
      (source === 'tester' && plan === 'subscription' && (!Number.isSafeInteger(paidThroughSeconds) || paidThroughSeconds <= Date.now()/1000)) ||
      (note !== undefined && (typeof note !== 'string' || note.length > 500))) {
    res.status(400).json({ error: 'Invalid complimentary licence' }); return;
  }
  const id = randomUUID();
  const key = `QQ-${randomBytes(32).toString('base64url')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO quickque_licences
      (id,key_hash,plan,paid_through,updates_until,customer_email,licence_source,grant_note)
      VALUES($1,$2,$3,$4,NULL,$5,$6,$7) RETURNING *`,
      [id,keyHash(key),plan,plan === 'subscription' ? paidThroughSeconds : null,email.trim(),source,note?.trim() || null]);
    await client.query(`INSERT INTO quickque_licence_admin_audit
      (id,admin_user_id,licence_id,action,details) VALUES($1,$2,$3,$4,$5)`,
      [randomUUID(),res.locals.adminUserId,id,source === 'gift' ? 'create_gift' : 'create_tester',{ plan }]);
    await client.query('COMMIT');
    res.status(201).json({ licence: publicRow(inserted.rows[0]), licenceKey: key });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

router.patch('/admin/licences/:id/status', async (req, res): Promise<void> => {
  if (!uuidPattern.test(req.params.id as string) || typeof req.body?.active !== 'boolean') { res.status(400).json({ error: 'Invalid request' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query('UPDATE quickque_licences SET active=$1 WHERE id=$2 RETURNING *', [req.body.active,req.params.id]);
    if (!updated.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Licence not found' }); return; }
    await client.query('INSERT INTO quickque_licence_admin_audit(id,admin_user_id,licence_id,action,details) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(),res.locals.adminUserId,req.params.id,req.body.active ? 'activate' : 'revoke',{}]);
    await client.query('COMMIT'); res.json(publicRow(updated.rows[0]));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

router.post('/admin/licences/:id/reissue-key', async (req, res): Promise<void> => {
  if (!uuidPattern.test(req.params.id as string)) { res.status(400).json({ error: 'Invalid licence' }); return; }
  const key = `QQ-${randomBytes(32).toString('base64url')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query('UPDATE quickque_licences SET key_hash=$1 WHERE id=$2 RETURNING *', [keyHash(key),req.params.id]);
    if (!updated.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Licence not found' }); return; }
    await client.query(`INSERT INTO quickque_licence_admin_audit
      (id,admin_user_id,licence_id,action,details) VALUES($1,$2,$3,'reissue_key',$4)`,
      [randomUUID(),res.locals.adminUserId,req.params.id,{ existingDevicesRetained: true }]);
    await client.query('COMMIT');
    res.json({ licence: publicRow(updated.rows[0]), licenceKey: key });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

router.delete('/admin/licences/:id/devices/:deviceId', async (req, res): Promise<void> => {
  if (!uuidPattern.test(req.params.id as string) || !devicePattern.test(req.params.deviceId as string)) { res.status(400).json({ error: 'Invalid request' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const removed = await client.query('DELETE FROM quickque_licence_devices WHERE licence_id=$1 AND device_id=$2', [req.params.id,req.params.deviceId]);
    if (!removed.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Device not found' }); return; }
    await client.query('INSERT INTO quickque_licence_admin_audit(id,admin_user_id,licence_id,action,details) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(),res.locals.adminUserId,req.params.id,'remove_device',{ deviceId:req.params.deviceId }]);
    await client.query('COMMIT'); res.json({ success: true });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

export default router;