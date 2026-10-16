import 'dotenv/config';
import { pool } from './db.js';
import { runMigrations } from './schema.js';
await runMigrations();
await pool.end();
console.log('schema applied');
