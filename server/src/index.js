// Farm World API for RV Van (Cloudflare Worker).
// The browser game talks to this; only this talks to NeonDB, with credentials kept in Worker secrets.
import { ApiError, corsHeaders, errorResponse, json } from './http.js';
import { openDb, one } from './db.js';
import { safeEqual } from './crypto.js';
import { migrate } from './migrations.js';
import * as R from './rooms.js';
import * as F from './farm.js';

const routes = [
  ['GET', /^\/v1\/health$/, health],
  ['POST', /^\/v1\/admin\/migrate$/, adminMigrate],
  ['POST', /^\/v1\/rooms$/, R.createRoom],
  ['GET', /^\/v1\/rooms\/([^/]+)$/, R.roomInfo, true],
  ['DELETE', /^\/v1\/rooms\/([^/]+)$/, R.deleteRoom, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/login$/, R.login, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/logout$/, R.logout, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/invites$/, R.createInvite, true],
  ['GET', /^\/v1\/rooms\/([^/]+)\/invites\/([A-Za-z0-9]{1,16})$/, R.invitePreview, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/join$/, R.joinWithInvite, true],
  ['DELETE', /^\/v1\/rooms\/([^/]+)\/members\/([^/]+)$/, R.removeMember, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/members\/([^/]+)\/permissions$/, R.setPermissions, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/members\/([^/]+)\/owner$/, R.transferOwner, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/session$/, R.openSession, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/heartbeat$/, R.heartbeat, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/verify$/, R.verifyTicket, true],
  ['GET', /^\/v1\/rooms\/([^/]+)\/farm$/, F.farmState, true],
  ['POST', /^\/v1\/rooms\/([^/]+)\/farm$/, F.farmAct, true],
  ['GET', /^\/v1\/rooms\/([^/]+)\/farm\/history$/, F.farmHistory, true],
];

async function health(req, env, db) {
  const r = await one(db, 'SELECT now() AS time');
  return json({ ok: true, time: r.time });
}

async function adminMigrate(req, env, db) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') || '');
  if (!env.ADMIN_SECRET || !m || !safeEqual(m[1], env.ADMIN_SECRET)) throw new ApiError(404, 'not_found', 'Not found');
  const applied = await migrate(db.pool);
  return json({ ok: true, applied });
}

// New tables are created by the first request after a deploy (once per worker instance; a database
// lock makes sure two instances never do it at the same time). POST /v1/admin/migrate does the same.
const schemaReady = new Set();      // databases already checked by this worker instance

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
    let res, db = null;
    try {
      const hit = routes.find(([m, re]) => m === req.method && re.test(path));
      if (!hit) throw new ApiError(404, 'not_found', 'Not found');
      const [, re, fn, hasCode] = hit;
      const args = re.exec(path).slice(1).map(decodeURIComponent);
      if (hasCode) args[0] = R.cleanCode(args[0]);
      db = openDb(env);
      const dbKey = env.__pool || env.DATABASE_URL;
      if (!schemaReady.has(dbKey) && fn !== adminMigrate) { await migrate(db.pool); schemaReady.add(dbKey); }
      res = await fn(req, env, db, ...args);
    } catch (e) {
      res = errorResponse(e);
    } finally {
      if (db) { const end = db.end().catch(() => {}); if (ctx && ctx.waitUntil) ctx.waitUntil(end); }
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
