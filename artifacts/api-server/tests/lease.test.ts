import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { issueLease, keyHash, DAY } from '../src/licensing/lease.ts';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const device = 'a'.repeat(64);
const entitlement = { id: 'purchase', plan: 'subscription' as const, active: true, paidThrough: 1000 + 90 * DAY, updatesUntil: null };
function claims(value: ReturnType<typeof issueLease>) { return JSON.parse(Buffer.from(value.payload, 'base64url').toString()); }
test('lease signatures cover key id and exact payload bytes', () => {
  const lease = issueLease(entitlement, device, pem, 'production', 1000);
  const message = Buffer.from(`quickque-lease-v1\n${lease.keyId}\n${lease.payload}`);
  assert.ok(verify(null, message, publicKey, Buffer.from(lease.signature, 'base64url')));
  assert.equal(verify(null, Buffer.concat([message, Buffer.from('x')]), publicKey, Buffer.from(lease.signature, 'base64url')), false);
  assert.equal(claims(lease).deviceId, device);
  assert.equal(claims(lease).expiresAt, 1000 + 30 * DAY);
});
test('subscription cannot outlive its prepaid entitlement', () => {
  assert.equal(claims(issueLease({ ...entitlement, paidThrough: 2000 }, device, pem, 'production', 1000)).expiresAt, 2000);
  const expired = claims(issueLease({ ...entitlement, paidThrough: 999 }, device, pem, 'production', 1000));
  assert.equal(expired.revoked, true); assert.deepEqual(expired.features, []);
});
test('perpetual leases carry a version cutoff without an offline expiration', () => {
  const lease = claims(issueLease({ ...entitlement, plan: 'perpetual', updatesUntil: 4000 }, device, pem, 'production', 1000));
  assert.equal(lease.expiresAt, null); assert.equal(lease.updatesUntil, 4000);
});
test('revocations are signed and never grant features', () => {
  const lease = claims(issueLease({ ...entitlement, active: false }, device, pem, 'production', 1000));
  assert.equal(lease.revoked, true); assert.deepEqual(lease.features, []);
  assert.notEqual(keyHash('purchase-key-one'), keyHash('purchase-key-two'));
});
test('invalid machine identifiers and missing subscription dates are rejected', () => {
  assert.throws(() => issueLease(entitlement, '../other', pem, 'production', 1000));
  assert.throws(() => issueLease({ ...entitlement, paidThrough: null }, device, pem, 'production', 1000));
});
