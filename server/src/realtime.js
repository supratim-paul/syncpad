import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as aw from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import cookie from 'cookie';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { q } from './db.js';
import { originOk } from './config.js';
import { verifyAccess } from './tokens.js';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const SAVE_MS = 2000;            // debounce for persisting the doc
const SNAP_MS = 10 * 60 * 1000;  // auto-snapshot interval while editing
const RECHECK_MS = 5000;
const PING_MS = 25_000;          // keeps proxies from dropping idle sockets, detects dead ones         // membership re-check interval per connection
const BURST = 60;                // per-connection message bucket
const REFILL_PER_MS = 0.03;      // 30 msgs/sec sustained

const pending = new Map(); // roomId -> Promise<room|null>
const live = new Map();    // roomId -> room

// ---- optional Redis fan-out for multi-instance deployments ----
const INSTANCE = randomUUID();
let pub = null, sub = null;
if (process.env.REDIS_URL) {
  pub = new Redis(process.env.REDIS_URL);
  sub = new Redis(process.env.REDIS_URL);
  sub.on('messageBuffer', (ch, msg) => {
    const room = live.get(ch.toString().slice(5));
    if (!room || msg.subarray(0, 36).toString() === INSTANCE) return;
    const payload = new Uint8Array(msg.subarray(37));
    if (msg[36] === 0) Y.applyUpdate(room.doc, payload, 'redis');
    else aw.applyAwarenessUpdate(room.awareness, payload, 'redis');
  });
}
const publish = (id, kind, payload) =>
  pub?.publish(`room:${id}`, Buffer.concat([Buffer.from(INSTANCE), Buffer.from([kind]), Buffer.from(payload)]));

const send = (ws, buf) => { if (ws.readyState === 1) ws.send(buf, (err) => err && ws.terminate()); };

async function loadRoom(id) {
  const { rows: [row] } = await q('SELECT state FROM rooms WHERE id=$1', [id]);
  if (!row) return null;
  const doc = new Y.Doc();
  if (row.state) Y.applyUpdate(doc, new Uint8Array(row.state));
  const awareness = new aw.Awareness(doc);
  awareness.setLocalState(null);
  const room = { id, doc, awareness, conns: new Map(), timer: null, dirty: false, lastSnap: Date.now() };
  room.frame = (type, write) => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, type);
    write(e);
    return encoding.toUint8Array(e);
  };

  doc.on('update', (update, origin) => {
    const msg = room.frame(MSG_SYNC, (e) => sync.writeUpdate(e, update));
    for (const c of room.conns.keys()) send(c, msg);
    if (origin !== 'redis') publish(id, 0, update);
    room.dirty = true;
    if (!room.timer) room.timer = setTimeout(() => { room.timer = null; save(room).catch(console.error); }, SAVE_MS);
  });

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const ids = room.conns.get(origin);
    if (ids) { added.forEach((i) => ids.add(i)); removed.forEach((i) => ids.delete(i)); }
    const upd = aw.encodeAwarenessUpdate(awareness, added.concat(updated, removed));
    const msg = room.frame(MSG_AWARENESS, (e) => encoding.writeVarUint8Array(e, upd));
    for (const c of room.conns.keys()) send(c, msg);
    if (origin !== 'redis') publish(id, 1, upd);
  });

  live.set(id, room);
  sub?.subscribe(`room:${id}`);
  return room;
}

function getRoom(id) {
  let p = pending.get(id);
  if (!p) {
    p = loadRoom(id).then(
      (r) => { if (!r) pending.delete(id); return r; },
      (e) => { pending.delete(id); throw e; });
    pending.set(id, p);
  }
  return p;
}

async function addSnapshot(roomId, userId, state) {
  await q('INSERT INTO room_history(room_id, user_id, state) VALUES ($1,$2,$3)', [roomId, userId, state]);
  await q(`DELETE FROM room_history WHERE room_id=$1 AND id NOT IN
           (SELECT id FROM room_history WHERE room_id=$1 ORDER BY id DESC LIMIT 50)`, [roomId]);
}

async function save(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  if (!room.dirty) return;
  room.dirty = false;
  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
  await q('UPDATE rooms SET state=$2, updated_at=now() WHERE id=$1', [room.id, state]);
  if (Date.now() - room.lastSnap > SNAP_MS) {
    room.lastSnap = Date.now();
    await addSnapshot(room.id, null, state);
  }
}

async function maybeUnload(room) {
  await save(room);
  if (room.conns.size || live.get(room.id) !== room) return;
  live.delete(room.id);
  pending.delete(room.id);
  sub?.unsubscribe(`room:${room.id}`);
  room.awareness.destroy();
  room.doc.destroy();
}

async function handle(ws, room, data, isBinary) {
  if (ws.readyState !== 1) return;
  if (!isBinary) return ws.close(1003, 'binary only');
  const now = Date.now();
  ws.tokens = Math.min(BURST, ws.tokens + (now - ws.refilled) * REFILL_PER_MS);
  ws.refilled = now;
  if (--ws.tokens < 0) return ws.close(1008, 'rate limit');

  // Re-check membership regularly so removed users lose access quickly.
  if (now - ws.checkedAt > RECHECK_MS) {
    const { rowCount } = await q('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2', [room.id, ws.userId]);
    if (!rowCount) return ws.close(4403, 'forbidden');
    ws.checkedAt = now;
  }

  const dec = decoding.createDecoder(new Uint8Array(data));
  const type = decoding.readVarUint(dec);
  if (type === MSG_SYNC) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    sync.readSyncMessage(dec, enc, room.doc, ws);
    if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc));
  } else if (type === MSG_AWARENESS) {
    aw.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), ws);
  } else {
    ws.close(1003, 'bad message');
  }
}

function onConnection(ws, room, claims) {
  Object.assign(ws, { isAlive: true, userId: claims.sub, checkedAt: Date.now(), tokens: BURST, refilled: Date.now(), chain: Promise.resolve() });
  room.conns.set(ws, new Set());
  // Close when the access token expires; the client refreshes and reconnects.
  const expTimer = setTimeout(() => ws.close(4401, 'token expired'), Math.max(claims.exp * 1000 - Date.now(), 0));

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;
    ws.chain = ws.chain.then(() => handle(ws, room, data, isBinary)).catch(() => ws.close(1011, 'error'));
  });
  ws.on('error', () => ws.terminate());
  ws.on('close', () => {
    clearTimeout(expTimer);
    const ids = room.conns.get(ws);
    room.conns.delete(ws);
    if (ids?.size) aw.removeAwarenessStates(room.awareness, [...ids], null);
    maybeUnload(room).catch(console.error);
  });

  send(ws, room.frame(MSG_SYNC, (e) => sync.writeSyncStep1(e, room.doc)));
  const states = room.awareness.getStates();
  if (states.size) {
    send(ws, room.frame(MSG_AWARENESS, (e) =>
      encoding.writeVarUint8Array(e, aw.encodeAwarenessUpdate(room.awareness, [...states.keys()]))));
  }
}

const WS_PATH = /^\/ws\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  const reject = (socket, code, msg) => {
    socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { ws.terminate(); }
    }
  }, PING_MS);
  beat.unref();
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    try {
      const m = WS_PATH.exec(new URL(req.url, 'http://x').pathname);
      if (!m) return reject(socket, 404, 'Not Found');
      if (!originOk(req.headers.origin, req.headers.host)) return reject(socket, 403, 'Forbidden');   // cross-site WebSocket hijacking guard
      let claims;
      try { claims = verifyAccess(cookie.parse(req.headers.cookie || '').at); }
      catch { return reject(socket, 401, 'Unauthorized'); }                           // JWT checked at handshake
      const { rowCount } = await q('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2', [m[1], claims.sub]);
      if (!rowCount) return reject(socket, 403, 'Forbidden');                         // membership checked at join
      const room = await getRoom(m[1]);
      if (!room) return reject(socket, 404, 'Not Found');
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, room, claims));
    } catch (e) {
      console.error(e);
      reject(socket, 500, 'Server Error');
    }
  });
}

export function closeRoom(id) {
  const room = live.get(id);
  if (!room) return;
  room.dirty = false;
  for (const ws of room.conns.keys()) ws.close(4410, 'room deleted');
}

export function kickUser(roomId, userId) {
  for (const room of live.values()) {
    if (roomId && room.id !== roomId) continue;
    for (const ws of room.conns.keys()) if (ws.userId === userId) ws.close(4403, 'removed');
  }
}

export async function snapshotRoom(id, userId) {
  const room = await getRoom(id);
  if (!room) return false;
  await addSnapshot(id, userId, Buffer.from(Y.encodeStateAsUpdate(room.doc)));
  await maybeUnload(room);
  return true;
}

export async function restoreRoom(id, state, userId) {
  const room = await getRoom(id);
  if (!room) return false;
  await addSnapshot(id, userId, Buffer.from(Y.encodeStateAsUpdate(room.doc))); // keep current state so restore is reversible
  const tmp = new Y.Doc();
  Y.applyUpdate(tmp, new Uint8Array(state));
  const text = tmp.getText('content').toString();
  const t = room.doc.getText('content');
  room.doc.transact(() => { t.delete(0, t.length); t.insert(0, text); });
  await maybeUnload(room);
  return true;
}

// Persist every open room (used on shutdown).
export async function flushAll() {
  await Promise.allSettled([...live.values()].map((r) => save(r)));
}
