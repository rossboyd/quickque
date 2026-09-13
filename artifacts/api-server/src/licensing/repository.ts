import { pool } from '@workspace/db';
import type { Entitlement } from './lease';
// Lock the purchase row so parallel activations cannot exceed its device allowance.
export async function entitlementForDevice(hash: string, deviceId: string, release = false): Promise<Entitlement | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM quickque_licences WHERE key_hash = $1 FOR UPDATE', [hash]);
    const row = result.rows[0];
    if (!row) { await client.query('ROLLBACK'); return null; }
    if (release) await client.query('DELETE FROM quickque_licence_devices WHERE licence_id = $1 AND device_id = $2', [row.id, deviceId]);
    else if (row.active && (row.plan !== 'subscription' || Number(row.paid_through) > Date.now() / 1000)) {
      const devices = await client.query('SELECT device_id FROM quickque_licence_devices WHERE licence_id = $1', [row.id]);
      if (!devices.rows.some(device => device.device_id === deviceId)) {
        if (devices.rowCount! >= row.device_limit) { await client.query('ROLLBACK'); throw new Error('DEVICE_LIMIT'); }
        await client.query('INSERT INTO quickque_licence_devices (licence_id, device_id) VALUES ($1, $2)', [row.id, deviceId]);
      }
    }
    await client.query('COMMIT');
    return { id: row.id, plan: row.plan, active: release ? false : row.active, paidThrough: row.paid_through === null ? null : Number(row.paid_through), updatesUntil: row.updates_until === null ? null : Number(row.updates_until) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
