import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q } from './db.js';
import { isProd, ACCESS_MS, REFRESH_MS } from './config.js';
import { signAccess, requireAuth } from './tokens.js';
import { wrap, validate } from './util.js';
import { kickUser } from './realtime.js';

const cookieBase = { httpOnly: true, secure: isProd, sameSite: 'strict' };
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const DUMMY = bcrypt.hashSync('timing-equalizer', 12);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const email = z.string().trim().toLowerCase().email().max(254);
const signupS = z.object({
  name: z.string().trim().min(1, 'Name is required').max(50),
  email,
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
  website: z.string().optional(), // honeypot
});
const loginS = z.object({ email, password: z.string().min(1).max(128) });

async function startSession(res, user) {
  const rt = crypto.randomBytes(32).toString('base64url');
  await q('INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [user.id, hash(rt), new Date(Date.now() + REFRESH_MS)]);
  // Cap stored sessions per user so the table cannot grow without bound.
  await q(`DELETE FROM refresh_tokens WHERE user_id=$1 AND id NOT IN
           (SELECT id FROM refresh_tokens WHERE user_id=$1 ORDER BY expires_at DESC LIMIT 20)`, [user.id]);
  setAccess(res, user);
  res.cookie('rt', rt, { ...cookieBase, maxAge: REFRESH_MS, path: '/api/auth' });
}
const setAccess = (res, user) =>
  res.cookie('at', signAccess(user), { ...cookieBase, maxAge: ACCESS_MS, path: '/' });
const clearSession = (res) => {
  res.clearCookie('at', { ...cookieBase, path: '/' });
  res.clearCookie('rt', { ...cookieBase, path: '/api/auth' });
};

const r = Router();

r.post('/signup', limiter, wrap(async (req, res) => {
  const d = validate(signupS, req.body, res);
  if (!d) return;
  if (d.website) return res.status(204).end(); // bot filled the honeypot
  const ph = await bcrypt.hash(d.password, 12);
  try {
    const { rows: [u] } = await q(
      'INSERT INTO users(email, name, password_hash) VALUES ($1,$2,$3) RETURNING id, email, name',
      [d.email, d.name, ph]);
    await startSession(res, u);
    res.status(201).json({ user: u });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That email is already registered' });
    throw e;
  }
}));

r.post('/login', limiter, wrap(async (req, res) => {
  const d = validate(loginS, req.body, res);
  if (!d) return;
  const { rows: [u] } = await q('SELECT id, email, name, password_hash FROM users WHERE email=$1', [d.email]);
  const ok = await bcrypt.compare(d.password, u?.password_hash ?? DUMMY);
  if (!u || !ok) return res.status(401).json({ error: 'Incorrect email or password' });
  await startSession(res, u);
  res.json({ user: { id: u.id, email: u.email, name: u.name } });
}));

// Rotating refresh token. A just-used token stays valid for 60 s so two tabs (or a retried
// request) refreshing at the same moment do not log the user out.
r.post('/refresh', wrap(async (req, res) => {
  const rt = req.cookies?.rt;
  if (!rt) return res.status(401).json({ error: 'No session' });
  const h = hash(rt);
  let { rows: [row] } = await q(
    'UPDATE refresh_tokens SET replaced_at=now() WHERE token_hash=$1 AND replaced_at IS NULL AND expires_at > now() RETURNING user_id', [h]);
  let rotated = !!row;
  if (!row) {
    ({ rows: [row] } = await q(
      "SELECT user_id FROM refresh_tokens WHERE token_hash=$1 AND expires_at > now() AND replaced_at > now() - interval '60 seconds'", [h]));
  }
  if (!row) { clearSession(res); return res.status(401).json({ error: 'Session expired' }); }
  const { rows: [u] } = await q('SELECT id, email, name FROM users WHERE id=$1', [row.user_id]);
  if (!u) { clearSession(res); return res.status(401).json({ error: 'Session expired' }); }
  if (rotated) await startSession(res, u); else setAccess(res, u);
  res.json({ user: u });
}));

r.post('/logout', wrap(async (req, res) => {
  if (req.cookies?.rt) await q('DELETE FROM refresh_tokens WHERE token_hash=$1', [hash(req.cookies.rt)]);
  clearSession(res);
  res.status(204).end();
}));

r.get('/me', requireAuth, wrap(async (req, res) => {
  const { rows: [u] } = await q('SELECT id, email, name FROM users WHERE id=$1', [req.user.id]);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: u });
}));

// Account + data deletion (cascades to owned rooms, history, memberships, tokens).
r.delete('/me', requireAuth, limiter, wrap(async (req, res) => {
  const d = validate(z.object({ password: z.string().min(1).max(128) }), req.body, res);
  if (!d) return;
  const { rows: [u] } = await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!u || !(await bcrypt.compare(d.password, u.password_hash)))
    return res.status(403).json({ error: 'Incorrect password' });
  kickUser(null, req.user.id);
  await q('DELETE FROM users WHERE id=$1', [req.user.id]);
  clearSession(res);
  res.status(204).end();
}));

export default r;
