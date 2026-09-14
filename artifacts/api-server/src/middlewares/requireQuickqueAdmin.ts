import type { RequestHandler } from 'express';
import { readAdminSession } from '../auth/adminSession';

export const requireQuickqueAdmin: RequestHandler = (req, res, next) => {
  const session = readAdminSession(req);
  if (!session) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  res.locals.adminUserId = session.email;
  next();
};