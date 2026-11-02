// Apply database migrations: DATABASE_URL=postgresql://... npm run migrate
// (Needs a normal Postgres connection; on Neon use the connection string from the Neon console.)
import pg from 'pg';
import { migrate } from '../src/migrations.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined });
try {
  const applied = await migrate(pool, m => console.log(m));
  console.log(applied.length ? `done: applied ${applied.join(', ')}` : 'already up to date');
} catch (e) {
  console.error('migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
