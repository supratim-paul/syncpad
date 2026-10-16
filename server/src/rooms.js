import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q } from './db.js';
import { requireAuth } from './tokens.js';
import { wrap, validate } from './util.js';
import { closeRoom, kickUser, snapshotRoom, restoreRoom } from './realtime.js';

const r = Router();
r.use(requireAuth);

const newCode = () => crypto.randomBytes(9).toString('base64url');
const uuid = z.string().uuid();
const createS = z.object({
  name: z.string().trim().min(1, 'Room name is required').max(80),
  kind: z.enum(['code', 'notes']),
  language: z.enum(['javascript', 'python', 'markdown', 'text']).default('javascript'),
});
const joinS = z.object({ code: z.string().trim().regex(/^[\w-]{6,40}$/, 'Invalid invite code') });
const joinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

// Non-members get 404, so room ids are not discoverable.
async function load(req, res) {
  if (!uuid.safeParse(req.params.id).success) { res.status(404).json({ error: 'Room not found' }); return null; }
  const { rows: [room] } = await q(
    `SELECT r.id, r.name, r.kind, r.language, r.owner_id, r.invite_code, m.role
       FROM rooms r JOIN room_members m ON m.room_id = r.id AND m.user_id = $2
      WHERE r.id = $1`, [req.params.id, req.user.id]);
  if (!room) { res.status(404).json({ error: 'Room not found' }); return null; }
  return room;
}

r.get('/', wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT r.id, r.name, r.kind, r.language, r.updated_at, r.invite_code, m.role
       FROM rooms r JOIN room_members m ON m.room_id = r.id
      WHERE m.user_id = $1 ORDER BY r.updated_at DESC`, [req.user.id]);
  res.json(rows);
}));

r.post('/', wrap(async (req, res) => {
  const d = validate(createS, req.body, res);
  if (!d) return;
  if (d.kind === 'notes') d.language = 'markdown';
  const { rows: [c] } = await q('SELECT count(*)::int AS n FROM rooms WHERE owner_id=$1', [req.user.id]);
  if (c.n >= 50) return res.status(429).json({ error: 'Room limit reached (50). Delete a room first.' });
  const { rows: [row] } = await q(
    `WITH r AS (
       INSERT INTO rooms(name, kind, language, owner_id, invite_code) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, owner_id)
     INSERT INTO room_members(room_id, user_id, role) SELECT id, owner_id, 'owner' FROM r RETURNING room_id`,
    [d.name, d.kind, d.language, req.user.id, newCode()]);
  res.status(201).json({ id: row.room_id });
}));

r.post('/join', joinLimiter, wrap(async (req, res) => {
  const d = validate(joinS, req.body, res);
  if (!d) return;
  const { rows: [room] } = await q('SELECT id FROM rooms WHERE invite_code=$1', [d.code]);
  if (!room) return res.status(404).json({ error: 'Invite code not found' });
  await q('INSERT INTO room_members(room_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [room.id, req.user.id]);
  res.json({ id: room.id });
}));

r.get('/:id', wrap(async (req, res) => {
  const room = await load(req, res);
  if (room) res.json(room);
}));

r.delete('/:id', wrap(async (req, res) => {
  const room = await load(req, res);
  if (!room) return;
  if (room.role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete a room' });
  closeRoom(room.id);
  await q('DELETE FROM rooms WHERE id=$1', [room.id]);
  res.status(204).end();
}));

r.delete('/:id/members/me', wrap(async (req, res) => {
  const room = await load(req, res);
  if (!room) return;
  if (room.role === 'owner') return res.status(400).json({ error: 'Owners must delete the room instead' });
  await q('DELETE FROM room_members WHERE room_id=$1 AND user_id=$2', [room.id, req.user.id]);
  kickUser(room.id, req.user.id);
  res.status(204).end();
}));

r.post('/:id/invite/rotate', wrap(async (req, res) => {
  const room = await load(req, res);
  if (!room) return;
  if (room.role !== 'owner') return res.status(403).json({ error: 'Only the owner can rotate the invite' });
  const { rows: [row] } = await q('UPDATE rooms SET invite_code=$2 WHERE id=$1 RETURNING invite_code', [room.id, newCode()]);
  res.json({ invite_code: row.invite_code });
}));

r.get('/:id/history', wrap(async (req, res) => {
  const room = await load(req, res);
  if (!room) return;
  const { rows } = await q(
    `SELECT h.id, h.created_at, u.name AS author
       FROM room_history h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.room_id=$1 ORDER BY h.id DESC LIMIT 50`, [room.id]);
  res.json(rows);
}));

r.post('/:id/history', wrap(async (req, res) => {
  const room = await load(req, res);
  if (!room) return;
  await snapshotRoom(room.id, req.user.id);
  res.status(201).end();
}));

r.post('/:id/history/:hid/restore', wrap(async (req, res) => {
  const room = await load(req, res);
  if (!room) return;
  const hid = z.coerce.number().int().positive().safeParse(req.params.hid);
  if (!hid.success) return res.status(404).json({ error: 'Snapshot not found' });
  const { rows: [h] } = await q('SELECT state FROM room_history WHERE id=$1 AND room_id=$2', [hid.data, room.id]);
  if (!h) return res.status(404).json({ error: 'Snapshot not found' });
  await restoreRoom(room.id, h.state, req.user.id);
  res.status(204).end();
}));

r.delete('/:id/history', wrap(async (req, res) => {
  const room = await load(req, res);
  if (!room) return;
  if (room.role !== 'owner') return res.status(403).json({ error: 'Only the owner can clear history' });
  await q('DELETE FROM room_history WHERE room_id=$1', [room.id]);
  res.status(204).end();
}));

export default r;
