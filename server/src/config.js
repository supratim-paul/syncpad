export const isProd = process.env.NODE_ENV === 'production';
export const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be set to 32+ random characters');
if (isProd) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
  if (/localhost|127\.0\.0\.1/.test(SITE_URL)) throw new Error('SITE_URL must be your public https URL in production');
}

// Sessions: short-lived access token, long sliding refresh token (renewed on every use).
export const ACCESS_MS = Math.max(5, Number(process.env.ACCESS_TOKEN_MINUTES) || 60) * 60_000;
export const REFRESH_MS = Math.max(1, Number(process.env.REFRESH_TOKEN_DAYS) || 30) * 86_400_000;

const origins = (process.env.ALLOWED_ORIGINS || `${SITE_URL},http://localhost:5173`)
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
if (!origins.includes(SITE_URL)) origins.push(SITE_URL);

// Allowed if listed, or if the Origin host equals the Host the request was sent to (same-origin).
export const originOk = (o, host) => {
  if (!o) return false;
  if (origins.includes(o)) return true;
  try { return !!host && new URL(o).host === host; } catch { return false; }
};
