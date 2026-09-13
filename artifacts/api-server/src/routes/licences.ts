import { Router } from 'express';
import { issueLease, keyHash } from '../licensing/lease';
const router = Router();
const attempts = new Map<string, { count: number; until: number }>();
router.post('/licences/:action', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['activate', 'renew', 'deactivate'].includes(req.params.action)) { res.sendStatus(404); return; }
  const signingKey = process.env.QUICKQUE_LICENCE_PRIVATE_KEY;
  const keyId = process.env.QUICKQUE_LICENCE_KEY_ID;
  if (!signingKey || !keyId || !process.env.DATABASE_URL) { res.status(503).json({ error: 'NOT_CONFIGURED', message: 'Licence activation is not configured yet.' }); return; }
  const now = Date.now();
  for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
  const ip = req.ip ?? 'unknown';
  const budget = attempts.get(ip) ?? { count: 0, until: now + 60000 };
  if (budget.count >= 20 || (!attempts.has(ip) && attempts.size >= 10000)) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'RATE_LIMITED' }); return; }
  budget.count++; attempts.set(ip, budget);
  const { licenceKey, deviceId } = req.body ?? {};
  if (typeof licenceKey !== 'string' || !/^QQ-[A-Za-z0-9_-]{43}$/.test(licenceKey) || typeof deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(deviceId)) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
  try {
    const { entitlementForDevice } = await import('../licensing/repository');
    const entitlement = await entitlementForDevice(keyHash(licenceKey), deviceId, req.params.action === 'deactivate');
    if (!entitlement) { res.status(401).json({ error: 'INVALID_KEY', message: 'This licence key was not recognised.' }); return; }
    res.json(issueLease(entitlement, deviceId, signingKey, keyId));
  } catch (error) {
    if (error instanceof Error && error.message === 'DEVICE_LIMIT') { res.status(409).json({ error: 'DEVICE_LIMIT', message: 'Deactivate another Mac before using this licence here.' }); return; }
    // Never include signing material, purchase keys or database errors in responses/logs.
    res.status(503).json({ error: 'UNAVAILABLE', message: 'Licence service unavailable. Your existing offline lease is unchanged.' });
  }
});
export default router;
