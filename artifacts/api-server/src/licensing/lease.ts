import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
export const DAY = 86400;
export type Entitlement = { id: string; plan: 'subscription' | 'perpetual'; active: boolean; paidThrough: number | null; updatesUntil: number | null };
export function keyHash(key: string) { return createHash('sha256').update(key).digest('hex'); }
export function issueLease(entitlement: Entitlement, deviceId: string, privateKeyPem: string, keyId: string, now = Math.floor(Date.now() / 1000)) {
  if (!/^[a-f0-9]{64}$/.test(deviceId) || !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId)) throw new Error('Invalid lease identity');
  if (!['subscription', 'perpetual'].includes(entitlement.plan) || !entitlement.id ||
      (entitlement.plan === 'subscription' && !Number.isSafeInteger(entitlement.paidThrough)) ||
      (entitlement.updatesUntil !== null && !Number.isSafeInteger(entitlement.updatesUntil))) throw new Error('Invalid purchase entitlement');
  const revoked = !entitlement.active || (entitlement.plan === 'subscription' && entitlement.paidThrough! <= now);
  const claims = { schema: 1, product: 'quickque', leaseId: randomUUID(), licenceId: entitlement.id, deviceId,
    plan: entitlement.plan, features: revoked ? [] : ['saved_audio', 'voice_follow'], issuedAt: now,
    refreshAfter: now + DAY,
    expiresAt: revoked ? now + DAY : entitlement.plan === 'subscription' ? Math.min(now + 30 * DAY, entitlement.paidThrough!) : null,
    updatesUntil: entitlement.plan === 'perpetual' ? null : entitlement.updatesUntil, revoked };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 signing key is required');
  const signature = sign(null, Buffer.from(`quickque-lease-v1\n${keyId}\n${payload}`), privateKey).toString('base64url');
  return { keyId, payload, signature };
}
