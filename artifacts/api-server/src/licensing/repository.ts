import { pool } from '@workspace/db';
import type { Entitlement, LeaseAction, LeaseAudit } from './lease';

type IssuedLease<T> = { envelope: T; audit: LeaseAudit };

// Keep device allocation, signing and the audit insert in one transaction.
// If signing or audit persistence fails, no activation change is committed.
export async function issueForDevice<T>(
  hash: string,
  deviceId: string,
  action: LeaseAction,
  issue: (entitlement: Entitlement) => IssuedLease<T>,
): Promise<T | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT * FROM quickque_licences WHERE key_hash = $1 FOR UPDATE',
      [hash],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    const release = action === 'deactivate';
    if (release) {
      await client.query(
        'DELETE FROM quickque_licence_devices WHERE licence_id = $1 AND device_id = $2',
        [row.id, deviceId],
      );
    } else if (
      row.active &&
      (row.plan !== 'subscription' || Number(row.paid_through) > Date.now() / 1000)
    ) {
      const devices = await client.query(
        'SELECT device_id FROM quickque_licence_devices WHERE licence_id = $1',
        [row.id],
      );
      if (!devices.rows.some(device => device.device_id === deviceId)) {
        if (devices.rowCount! >= row.device_limit) {
          await client.query('ROLLBACK');
          throw new Error('DEVICE_LIMIT');
        }
        await client.query(
          'INSERT INTO quickque_licence_devices (licence_id, device_id) VALUES ($1, $2)',
          [row.id, deviceId],
        );
      }
    }

    const entitlement: Entitlement = {
      id: row.id,
      plan: row.plan,
      active: release ? false : row.active,
      paidThrough: row.paid_through === null ? null : Number(row.paid_through),
      updatesUntil: row.updates_until === null ? null : Number(row.updates_until),
    };
    const issued = issue(entitlement);
    const audit = issued.audit;
    if (
      audit.licenceId !== entitlement.id ||
      audit.deviceId !== deviceId ||
      audit.action !== action ||
      audit.plan !== entitlement.plan
    ) throw new Error('Issued lease audit does not match entitlement');

    await client.query(
      `INSERT INTO quickque_licence_lease_audit
       (lease_id, licence_id, device_id, action, plan, feature_ids,
        signing_key_id, issued_at, refresh_after, expires_at, revoked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        audit.leaseId,
        audit.licenceId,
        audit.deviceId,
        audit.action,
        audit.plan,
        audit.features,
        audit.signingKeyId,
        audit.issuedAt,
        audit.refreshAfter,
        audit.expiresAt,
        audit.revoked,
      ],
    );
    await client.query('COMMIT');
    return issued.envelope;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}