import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { isProd, SITE_URL, originOk } from './config.js';
import { q } from './db.js';
import auth from './auth.js';
import rooms from './rooms.js';
import compression from 'compression';
import { attachRealtime, flushAll } from './realtime.js';
import { runMigrations } from './schema.js';
import { pool } from './db.js';

const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.disable('x-powered-by');

// Health check first: platform probes use plain http and must not be redirected.
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(compression());

// HTTPS everywhere in production (behind a TLS-terminating proxy).
if (isProd) app.use((req, res, next) => (req.secure ? next() : res.redirect(301, SITE_URL + req.originalUrl)));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", isProd ? 'wss:' : 'ws:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// SEO files, generated from SITE_URL.
const PUBLIC = ['/', '/login', '/signup', '/privacy', '/terms'];
const PRIVATE = [/^\/rooms$/, /^\/room\/[0-9a-f-]{36}$/, /^\/join\/[\w-]{6,40}$/];
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /rooms', 'Disallow: /room/', 'Disallow: /join/', 'Disallow: /ws/',
      `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n'));
});
app.get('/sitemap.xml', (req, res) => {
  const urls = PUBLIC.map((p) => `  <url><loc>${SITE_URL}${p === '/' ? '/' : p}</loc></url>`).join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// CSRF defence in depth (cookies are also SameSite=Strict): writes must come from an allowed origin.
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !originOk(req.headers.origin, req.headers.host))
    return res.status(403).json({ error: 'Origin not allowed' });
  next();
});
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', auth);
app.use('/api/rooms', rooms);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Client build + SPA fallback that returns a real 404 for unknown pages.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const hasDist = fs.existsSync(path.join(dist, 'index.html'));
if (hasDist) {
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
}
app.use((req, res) => {
  if (req.method !== 'GET' || !hasDist) return res.status(404).type('text/plain').send('Not found');
  const p = req.path.replace(/\/+$/, '') || '/';
  const isPublic = PUBLIC.includes(p);
  const isPrivate = PRIVATE.some((re) => re.test(p));
  if (isPrivate) res.set('X-Robots-Tag', 'noindex, nofollow');
  res.status(isPublic || isPrivate ? 200 : 404).sendFile(path.join(dist, 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

if (process.env.RUN_MIGRATIONS !== 'false') await runMigrations();

const server = http.createServer(app);
server.keepAliveTimeout = 65_000; // longer than common proxy idle timeouts
server.headersTimeout = 66_000;
attachRealtime(server);
setInterval(() => q("DELETE FROM refresh_tokens WHERE expires_at < now() OR replaced_at < now() - interval '5 minutes'").catch(() => {}), 3600_000).unref();
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Syncpad on :${port}`));

let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  console.log(`${sig}: saving rooms and shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close();
  await flushAll().catch(console.error);
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));
