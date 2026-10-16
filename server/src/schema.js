import fs from 'node:fs';
import { pool } from './db.js';

// Idempotent. A transaction-scoped advisory lock keeps parallel instances from racing and
// is safe behind Neon's pooled (PgBouncer) endpoint, unlike session-level locks.
export async function runMigrations() {
  const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(727369)');
    await c.query(sql);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
