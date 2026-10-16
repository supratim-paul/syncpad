# Syncpad deployment notes

## ACTION REQUIRED
The uploaded archive contained `server/.env` with a live Neon database URL and JWT secret. It is removed from this package. **Rotate the Neon password and generate a new `JWT_SECRET`.**

## Changed in this revision
- Sessions: access token 60 min, refresh token 30 days sliding (env-configurable). Previously 15 min / 7 days.
- Fixed random logouts: refresh-token rotation race between tabs (60 s grace window + cross-tab Web Lock); network/5xx errors no longer count as "signed out"; client renews every 10 min and on tab focus/online.
- WebSocket: server heartbeat (25 s), instant reconnect on tab return/online/token rollover, editor no longer rebuilt when the invite link is reset.
- Server: pg pool error handler (idle drop crashed the process), keep-alive, graceful SIGTERM save, unhandled-rejection logging, gzip, proxy-safe keep-alive timeouts, `/healthz` exempt from HTTPS redirect, auto-migration with advisory lock, production env validation, same-host Origin allowance.
- Buttons: nav shows Log in/Sign up or Rooms/Log out (Log out was shown to signed-out users and unstyled); Rooms list has Open / Copy invite / Delete-Leave buttons; room bar has real Back, History & settings, Close, Restore buttons; Landing CTA adapts to login state; error boundary added.
- Added Procfile, ecosystem.config.cjs (pm2), `build:prod` script, server/.env.example.

## Verified here
Client production build; server boot and HTTP checks (healthz, HTTPS redirect, 404, 401, origin check, gzip, robots). Not verified: live Postgres/WebSocket flow (no database in the build sandbox), `npm audit`. Run both before launch.
