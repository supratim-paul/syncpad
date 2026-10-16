import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000, // serverless Postgres (Neon) can take a few seconds to wake
  keepAlive: true,
});
// Without this, a dropped idle connection crashes the whole process.
pool.on('error', (e) => console.error('pg idle client error:', e.message));
export const q = (text, params) => pool.query(text, params);
