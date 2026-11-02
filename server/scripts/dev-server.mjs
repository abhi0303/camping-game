// Run the API on your computer against a local Postgres (for development and the game's tests):
//   DATABASE_URL=postgres://postgres@127.0.0.1:5432/rvfarm PORT=8787 npm run dev
// The game page uses it when opened from localhost with ?api=http://127.0.0.1:8787
import http from 'node:http';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';

export async function startDevServer({ databaseUrl, port = 8787, host = '127.0.0.1', secret = 'dev-secret-change-me-please', admin = 'dev-admin' } = {}) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  await migrate(pool);
  const env = { __pool: pool, SERVER_SECRET: secret, ADMIN_SECRET: admin, ALLOWED_ORIGINS: '' };
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const body = chunks.length ? Buffer.concat(chunks) : null;
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method, headers: req.headers, body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
      });
      const r = await worker.fetch(request, env, { waitUntil() {} });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500); res.end(String(e && e.message));
    }
  });
  await new Promise(r => server.listen(port, host, r));
  return { server, pool, env, url: `http://${host}:${port}`, close: async () => { server.closeAllConnections?.(); await new Promise(r => server.close(r)); await pool.end(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startDevServer({ databaseUrl: process.env.DATABASE_URL, port: Number(process.env.PORT || 8787) });
  console.log(`Farm World API on ${s.url}`);
}
