import { Router, type IRouter } from 'express';
import {
  allowedAdmin,
  clearSessionCookie,
  createAdminSession,
  passwordMatches,
  readAdminSession,
  sessionCookie,
} from '../auth/adminSession';

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function attemptKey(ip: string | undefined) {
  return ip || 'unknown';
}

router.get('/admin/session', (req, res) => {
  const session = readAdminSession(req);
  if (!session) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, email: session.email });
});

router.post('/admin/session', (req, res) => {
  const key = attemptKey(req.ip);
  const now = Date.now();
  const current = attempts.get(key);
  const state = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + WINDOW_MS }
    : current;
  if (state.count >= MAX_ATTEMPTS) {
    res.setHeader('Retry-After', String(Math.ceil((state.resetAt - now) / 1000)));
    res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
    return;
  }

  const emailIsAllowed = allowedAdmin(req.body?.email);
  const passwordIsValid = passwordMatches(req.body?.password);
  if (!emailIsAllowed || !passwordIsValid) {
    state.count += 1;
    attempts.set(key, state);
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  attempts.delete(key);
  const email = req.body.email.trim().toLowerCase();
  res.setHeader('Set-Cookie', sessionCookie(createAdminSession(email)));
  res.json({ authenticated: true, email });
});

router.delete('/admin/session', (_req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(204).end();
});

export default router;