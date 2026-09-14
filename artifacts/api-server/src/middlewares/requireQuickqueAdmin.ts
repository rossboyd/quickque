import { clerkClient, getAuth } from '@clerk/express';
import type { RequestHandler } from 'express';

export const requireQuickqueAdmin: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  const allowed = new Set(
    (process.env.QUICKQUE_ADMIN_EMAILS ?? '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowed.size === 0) {
    res.status(503).json({ error: 'Admin access is not configured' });
    return;
  }
  const user = await clerkClient.users.getUser(userId);
  const emails = user.emailAddresses.map(item => item.emailAddress.toLowerCase());
  if (!emails.some(email => allowed.has(email))) {
    res.status(403).json({ error: 'Administrator access required' });
    return;
  }
  res.locals.adminUserId = userId;
  next();
};