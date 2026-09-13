// Operator-only CLI. No public endpoint creates purchase entitlements.
import { generateKeyPairSync, randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [action, ...values] = process.argv.slice(2);
const options = Object.fromEntries(values.map(value => { const at = value.indexOf('='); if (at < 0) throw new Error('Use name=value options'); return [value.slice(0, at), value.slice(at + 1)]; }));
if (action === 'keys') {
  if (!options.directory || !/^[A-Za-z0-9_-]{1,64}$/.test(options.id ?? '')) throw new Error('keys directory=/secure/path id=production-1');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(options.directory, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  const publicKeys = [[options.id, publicKey.export({ format: 'jwk' }).x]];
  writeFileSync(resolve(options.directory, 'public-keys.json'), JSON.stringify(publicKeys), { mode: 0o644, flag: 'wx' });
  console.log('Signing key files created. Keep private.pem only on the licence server.');
} else if (action === 'grant' || action === 'revoke') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (action === 'revoke') {
      if (!options.id) throw new Error('revoke id=<purchase UUID>');
      await pool.query('UPDATE quickque_licences SET active = false WHERE id = $1', [options.id]);
      console.log('Revocation recorded. Existing offline leases remain valid until renewal or expiry.');
    } else {
      if (!['subscription', 'perpetual'].includes(options.plan)) throw new Error('grant plan=subscription paid-through=YYYY-MM-DD OR grant plan=perpetual');
      const email = options.email?.trim();
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A customer email is required: email=customer@example.com');
      const paidThrough = options.plan === 'subscription' ? Math.floor(Date.parse(options['paid-through']) / 1000) : null;
      if (options.plan === 'subscription' && (!Number.isSafeInteger(paidThrough) || paidThrough <= Date.now() / 1000)) throw new Error('A future paid-through date is required');
      const anniversary = new Date(); anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
      const updatesUntil = options.plan === 'perpetual' ? Math.floor(anniversary.getTime() / 1000) : null;
      const key = `QQ-${randomBytes(32).toString('base64url')}`;
      const id = randomUUID();
      await pool.query('INSERT INTO quickque_licences (id,key_hash,plan,paid_through,updates_until,customer_email) VALUES ($1,$2,$3,$4,$5,$6)', [id, createHash('sha256').update(key).digest('hex'), options.plan, paidThrough, updatesUntil, email]);
      // This is the operator's one-time delivery output, not an application/request log.
      console.log(JSON.stringify({ id, licenceKey: key, updatesUntil, paidThrough }));
    }
  } finally { await pool.end(); }
} else throw new Error('Use keys, grant, or revoke. See docs/licensing.md.');
