import jwt from 'jsonwebtoken';
import { JWT_SECRET, ACCESS_MS } from './config.js';

export const signAccess = (u) =>
  jwt.sign({ sub: u.id, name: u.name }, JWT_SECRET, { algorithm: 'HS256', expiresIn: Math.floor(ACCESS_MS / 1000) });

export const verifyAccess = (t) => jwt.verify(t || '', JWT_SECRET, { algorithms: ['HS256'] });

export function requireAuth(req, res, next) {
  try {
    const c = verifyAccess(req.cookies?.at);
    req.user = { id: c.sub, name: c.name };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
