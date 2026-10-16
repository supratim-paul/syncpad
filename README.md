# Syncpad

Real-time collaborative code/notes board. Node.js, WebSockets, React, PostgreSQL, JWT, Yjs (CRDT).

## Run locally
Needs Node 20+ and PostgreSQL 14+ (no Docker).

1. Install Postgres (Windows: installer from postgresql.org; macOS: `brew install postgresql@16 && brew services start postgresql@16`; Ubuntu: `sudo apt install postgresql && sudo service postgresql start`).
2. Create the user and database:
```bash
# Ubuntu/Debian
sudo -u postgres psql -c "CREATE USER syncpad_app WITH PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';" -c "CREATE DATABASE syncpad OWNER syncpad_app;"
# macOS: run the same CREATE USER / CREATE DATABASE SQL in psql. Windows: run it in SQL Shell (psql) as postgres. Do not grant SUPERUSER to the application user.
```
3. Configure and start:
```bash
cp server/.env.example server/.env      # replace DATABASE_URL credentials and set a random JWT_SECRET of 32+ characters
npm run install:all
npm run migrate
npm run dev:server                      # terminal 1, :3000
npm run dev:client                      # terminal 2, :5173 (open this URL in dev)
```

## Production

### Node host (Render, Railway, VPS) , no Docker
Set these env vars on the host:

| Var | Value |
|---|---|
| `SITE_URL` | public https URL, e.g. `https://syncpad.onrender.com` |
| `VITE_SITE_URL` | same as `SITE_URL` (used at build time) |
| `VITE_CONTACT_EMAIL` | your contact email |
| `DATABASE_URL` | Postgres URL (Neon: keep `?sslmode=require`) |
| `JWT_SECRET` | 32+ random chars |
| `NODE_ENV` | `production` |

- **Build command:** `npm run build:prod`
- **Start command:** `npm start`
- Render: New Web Service, runtime Node, the two commands above, health check path `/healthz`.
- Railway/Heroku-style hosts also read the included `Procfile`.
- VPS: run the build command once, then `npm i -g pm2 && pm2 start ecosystem.config.cjs && pm2 save`, and put Nginx (below) in front with TLS.

The schema migrates automatically on start (set `RUN_MIGRATIONS=false` to disable). In production the server refuses to start without `SITE_URL`, `DATABASE_URL`, `JWT_SECRET`. The host must support WebSockets (Vercel/Netlify serverless do not).

### Manual steps
```bash
cp client/.env.example client/.env      # VITE_SITE_URL, VITE_CONTACT_EMAIL
npm run build
NODE_ENV=production SITE_URL=https://your-domain.com JWT_SECRET=... DATABASE_URL=... npm start
```
Put it behind a TLS-terminating proxy. The server redirects http to https, sets HSTS, and trusts one proxy hop.
Nginx WebSocket location:
```nginx
location /ws/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600s;
}
location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
```
Multiple instances: set `REDIS_URL` on all of them.

## Where each item is handled
| # | Item | Where |
|---|---|---|
| 1 | Custom 404 + real status | `server/src/index.js` SPA fallback returns 404 for unknown pages, JSON 404 for `/api/*`; `NotFound` page |
| 2, 3 | Titles, descriptions | `client/src/meta.js` per page; `index.html` defaults |
| 4 | OG/Twitter | `client/index.html` (static, crawlers skip JS); `public/og-image.png` 1200x630, replace with your own |
| 5 | Alt text | Landing hero image; the logo is labelled |
| 7, 8 | Sitemap, robots | Generated at `/sitemap.xml`, `/robots.txt` from `SITE_URL`; private routes disallowed + `noindex` |
| 9 | HTTPS | Redirect, HSTS, `wss://` chosen from page protocol |
| 10 | Abuse protection | Rate limits on auth/join/API, honeypot, zod validation, WS payload cap (1 MB) and message bucket (30/s) |
| 13 | Privacy policy / Terms | `/privacy`, `/terms` (templates: review before launch) |
| 6, 11, 12, 14, 15 | Skipped | No internal link structure, thank-you page, analytics, FAQ or reviews. No non-essential cookies, so no banner. |

## Security notes
- JWT verified at WebSocket handshake; room membership checked at handshake and every 5 s per connection; sockets close when the access token expires (client reconnects instantly). Server pings every 25 s; clients reconnect immediately when a tab becomes visible or the network returns.
- `Origin` checked on WebSocket upgrade and all API writes (allowed: `SITE_URL`, `ALLOWED_ORIGINS`, or same host). API clients without an `Origin` header (curl) must send one.
- Tokens: 60 min access + 30 day sliding refresh (`ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`), HttpOnly, Secure, SameSite=Strict cookies. A used refresh token stays valid 60 s so multiple tabs cannot log each other out. The client renews every 10 min and on tab focus.
- Note and code text is rendered by CodeMirror as text, never as HTML. CSP blocks inline scripts.
- Account deletion cascades to rooms, history, memberships, sessions. Owners can clear history, reset the invite link, delete rooms.

## Ops
- Back up Postgres (`pg_dump` on a schedule). Doc state lives in `rooms.state`, snapshots in `room_history` (last 50 per room).
- Do the 4 post-launch steps in Search Console and confirm `https://your-domain.com/robots.txt` has no `Disallow: /`.

## Security / before deployment

- Keep `server/.env` private and never commit it. Use `server/.env.example` only as a placeholder template. If a real credential was ever committed or shared, rotate it immediately.
- Use a dedicated PostgreSQL role with only the privileges required by this app; never use `SUPERUSER`.
- Run `npm audit` from both `client` and `server` regularly and review fixes before upgrading dependencies.
- Review the Privacy Policy and Terms for your actual data practices before launching publicly.

- Graceful shutdown (SIGTERM) saves all open rooms before exit.
- Neon: if the connection fails with a channel-binding error, drop `&channel_binding=require` from `DATABASE_URL`. **Rotate the Neon password and JWT secret that were in the uploaded `.env`.**

- Neon: both the direct and the pooled (`-pooler`) connection strings work; migrations use a transaction-scoped lock for this reason.
