import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const COOKIE_NAME = 'quickque_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET is required');
  return value;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function credentialFingerprint(): string {
  return sign(`admin-password:${process.env.QUICKQUE_ADMIN_PASSWORD ?? ''}`);
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordMatches(candidate: unknown): boolean {
  const configured = process.env.QUICKQUE_ADMIN_PASSWORD;
  return typeof candidate === 'string' && Boolean(configured) && equal(candidate, configured!);
}

export function allowedAdmin(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  const allowed = (process.env.QUICKQUE_ADMIN_EMAILS ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export function createAdminSession(email: string): string {
  const payload = Buffer.from(JSON.stringify({
    email: email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    nonce: randomBytes(16).toString('hex'),
    credential: credentialFingerprint(),
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readAdminSession(req: Request): { email: string } | null {
  const raw = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!raw) return null;
  const separator = raw.lastIndexOf('.');
  if (separator < 1) return null;
  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!equal(sign(payload), signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email?: unknown; exp?: unknown; credential?: unknown };
    if (!allowedAdmin(parsed.email) ||
        typeof parsed.exp !== 'number' ||
        parsed.exp <= Date.now() / 1000 ||
        typeof parsed.credential !== 'string' ||
        !equal(parsed.credential, credentialFingerprint())) return null;
    return { email: parsed.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export function sessionCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}