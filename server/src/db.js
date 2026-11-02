// Database access. In Cloudflare a Neon Pool (Postgres over WebSockets) is opened for each request
// and closed at the end. Tests and the local dev server pass a node-postgres pool (same API) as env.__pool.
import { Pool, neonConfig } from '@neondatabase/serverless';
import { ApiError } from './http.js';

export function openDb(env) {
  if (env.__pool) return { pool: env.__pool, end: async () => {} };
  if (!env.DATABASE_URL) throw new ApiError(503, 'not_configured', 'The Farm World server is not set up yet (no database).');
  // local testing only (wrangler dev + scripts/local-wsproxy.mjs in front of a plain Postgres); never set in Cloudflare
  if (env.NEON_LOCAL_WSPROXY) {
    Object.assign(neonConfig, { wsProxy: env.NEON_LOCAL_WSPROXY, useSecureWebSocket: false, pipelineConnect: false, forceDisablePgSSL: true });
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  return { pool, end: () => pool.end() };
}

export async function rows(db, text, params = []) { return (await db.pool.query(text, params)).rows; }
export async function one(db, text, params = []) { return (await db.pool.query(text, params)).rows[0] || null; }

// Run fn(client) inside BEGIN / COMMIT. Anything thrown rolls the whole thing back.
// Callers lock the room row first (SELECT ... FOR UPDATE), so changes to one world happen one at a time.
export async function tx(db, fn) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn({ rows: async (t, p = []) => (await c.query(t, p)).rows, one: async (t, p = []) => (await c.query(t, p)).rows[0] || null });
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) { /* connection gone */ }
    throw e;
  } finally {
    c.release();
  }
}

export const isUniqueViolation = (e, name) => e && e.code === '23505' && (!name || String(e.constraint || '').includes(name));
