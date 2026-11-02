// API tests against a real Postgres. Each run makes a throw-away database.
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
// Or against a running worker (wrangler dev + the real Neon driver through scripts/local-wsproxy.mjs):
//   TEST_API_URL=http://127.0.0.1:8799 TEST_DB_URL=<the database that worker uses> npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
const API = process.env.TEST_API_URL || '';
const DB = 'rvtest_' + Math.random().toString(36).slice(2, 8);
let pool, env;

before(async () => {
  if (API) { pool = new pg.Pool({ connectionString: process.env.TEST_DB_URL, max: 12 }); await migrate(pool); return; }
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const u = new URL(ADMIN_URL); u.pathname = '/' + DB;
  pool = new pg.Pool({ connectionString: u.toString(), max: 12 });
  await migrate(pool);
  env = { __pool: pool, SERVER_SECRET: 'test-secret-0123456789', ADMIN_SECRET: 'admin-xyz', ALLOWED_ORIGINS: 'https://abhi0303.github.io' };
});
after(async () => {
  await pool.end();
  if (API) return;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.end();
});

// one request, in-process or over HTTP
function send(path, init) {
  if (API) return fetch(API + path, init);
  return worker.fetch(new Request('http://api.test' + path, init), env, { waitUntil() {} });
}
let ipN = 0;
async function call(method, path, body, token, headers = {}) {
  const h = { 'Content-Type': 'application/json', Origin: 'https://abhi0303.github.io', 'X-Forwarded-For': '10.0.0.' + (ipN++ % 250), ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await send(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
async function world(owner = 'Abhi', pin = '1234') {
  const r = await call('POST', '/v1/rooms', { name: owner, pin, world: 'Test Farm' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { code: r.body.room.code, token: r.body.token, member: r.body.member };
}
async function addMember(w, name, pin = '5555') {
  const inv = await call('POST', `/v1/rooms/${w.code}/invites`, {}, w.token);
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const j = await call('POST', `/v1/rooms/${w.code}/join`, { invite: inv.body.invite, name, pin });
  assert.equal(j.status, 201, JSON.stringify(j.body));
  return { token: j.body.token, member: j.body.member };
}

test('health, CORS and unknown routes', async () => {
  const h = await call('GET', '/v1/health');
  assert.equal(h.status, 200); assert.equal(h.body.ok, true);
  assert.equal(h.headers.get('access-control-allow-origin'), 'https://abhi0303.github.io');
  const evil = await call('GET', '/v1/health', undefined, null, { Origin: 'https://evil.example' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const local = await call('GET', '/v1/health', undefined, null, { Origin: 'http://127.0.0.1:8000' });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8000');
  const pre = await send('/v1/rooms', { method: 'OPTIONS', headers: { Origin: 'https://abhi0303.github.io' } });
  assert.equal(pre.status, 204);
  const nf = await call('GET', '/v1/nope');
  assert.equal(nf.status, 404); assert.equal(nf.body.error.code, 'not_found');
});

test('create a world: validation and owner', async () => {
  assert.equal((await call('POST', '/v1/rooms', { name: 'A', pin: '12' })).body.error.code, 'bad_input');
  assert.equal((await call('POST', '/v1/rooms', { name: '  ', pin: '1234' })).body.error.code, 'bad_input');
  assert.equal((await call('POST', '/v1/rooms', 'not json')).status, 400);
  const w = await world();
  assert.match(w.code, /^[A-Z0-9]{6}$/);
  assert.deepEqual({ seat: w.member.seat, isOwner: w.member.isOwner, name: w.member.name }, { seat: 0, isOwner: true, name: 'Abhi' });
  const info = await call('GET', `/v1/rooms/${w.code}`, undefined, w.token);
  assert.equal(info.status, 200);
  assert.equal(info.body.members.length, 1); assert.equal(info.body.maxMembers, 4); assert.equal(info.body.room.name, 'Test Farm');
  // tokens are stored hashed, never as given
  assert.equal((await q('SELECT count(*)::int n FROM member_tokens WHERE token_hash = $1', [w.token]))[0].n, 0);
});

test('login: codes, wrong PIN, lockout, other device', async () => {
  const w = await world('Rahul', '4321');
  assert.equal((await call('POST', '/v1/rooms/AB/login', { name: 'Rahul', pin: '4321' })).body.error.code, 'bad_code');
  assert.equal((await call('POST', '/v1/rooms/ZZZZZZ/login', { name: 'Rahul', pin: '4321' })).body.error.code, 'room_not_found');
  assert.equal((await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Nobody', pin: '4321' })).body.error.code, 'wrong_login');
  const ok = await call('POST', `/v1/rooms/${w.code}/login`, { name: 'rahul', pin: '4321' });   // name is case-insensitive
  assert.equal(ok.status, 200); assert.ok(ok.body.token && ok.body.token !== w.token);
  for (let i = 1; i <= 4; i++) {
    const r = await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Rahul', pin: '0000' });
    assert.equal(r.body.error.code, 'wrong_login'); assert.match(r.body.error.message, new RegExp(`${5 - i} tr`));
  }
  assert.equal((await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Rahul', pin: '0000' })).body.error.code, 'locked');
  assert.equal((await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Rahul', pin: '4321' })).body.error.code, 'locked');   // even the right PIN
  await q(`UPDATE room_members SET locked_until = now() - interval '1 second' WHERE lower(name) = 'rahul'`);
  assert.equal((await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Rahul', pin: '4321' })).status, 200);
  // both devices stay logged in
  assert.equal((await call('GET', `/v1/rooms/${w.code}`, undefined, w.token)).status, 200);
  assert.equal((await call('GET', `/v1/rooms/${w.code}`, undefined, ok.body.token)).status, 200);
});

test('access: no token, garbage token, member of another world', async () => {
  const a = await world('Amit'), b = await world('Vijay');
  assert.equal((await call('GET', `/v1/rooms/${a.code}`)).body.error.code, 'login_needed');
  assert.equal((await call('GET', `/v1/rooms/${a.code}`, undefined, 'x'.repeat(43))).body.error.code, 'login_needed');
  assert.equal((await call('GET', `/v1/rooms/${a.code}`, undefined, b.token)).body.error.code, 'not_member');
  assert.equal((await call('POST', `/v1/rooms/${a.code}/session`, {}, b.token)).body.error.code, 'not_member');
});

test('invites: owner only, single use, names, 4 members max', async () => {
  const w = await world();
  const r = await addMember(w, 'Rahul');
  assert.equal(r.member.seat, 1); assert.equal(r.member.isOwner, false);
  assert.equal((await call('POST', `/v1/rooms/${w.code}/invites`, {}, r.token)).body.error.code, 'owner_only');
  const inv = await call('POST', `/v1/rooms/${w.code}/invites`, {}, w.token);
  const prev = await call('GET', `/v1/rooms/${w.code}/invites/${inv.body.invite}`);
  assert.equal(prev.status, 200); assert.equal(prev.body.members, 2); assert.equal(prev.body.room.name, 'Test Farm');
  assert.equal((await call('POST', `/v1/rooms/${w.code}/join`, { invite: inv.body.invite, name: 'RAHUL', pin: '1111' })).body.error.code, 'name_taken');
  const j = await call('POST', `/v1/rooms/${w.code}/join`, { invite: inv.body.invite, name: 'Amit', pin: '1111' });
  assert.equal(j.status, 201); assert.equal(j.body.member.seat, 2);
  assert.equal((await call('POST', `/v1/rooms/${w.code}/join`, { invite: inv.body.invite, name: 'Vijay', pin: '1111' })).body.error.code, 'invite_invalid');   // used
  const old = await call('POST', `/v1/rooms/${w.code}/invites`, {}, w.token);
  await q(`UPDATE room_invites SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
  assert.equal((await call('POST', `/v1/rooms/${w.code}/join`, { invite: old.body.invite, name: 'Vijay', pin: '1111' })).body.error.code, 'invite_invalid');   // expired
  assert.equal((await call('POST', `/v1/rooms/${w.code}/join`, { invite: 'WRONGONE', name: 'Vijay', pin: '1111' })).body.error.code, 'invite_invalid');
  await addMember(w, 'Vijay');
  const full = await call('POST', `/v1/rooms/${w.code}/invites`, {}, w.token);
  assert.equal(full.status, 409); assert.equal(full.body.error.code, 'members_full');
  const info = await call('GET', `/v1/rooms/${w.code}`, undefined, w.token);
  assert.deepEqual(info.body.members.map(m => [m.name, m.seat]), [['Abhi', 0], ['Rahul', 1], ['Amit', 2], ['Vijay', 3]]);
});

test('race: 3 people use 3 invites at once for 2 free seats -> exactly 2 get in', async () => {
  const w = await world();
  await addMember(w, 'Rahul');
  const invs = [];
  for (let i = 0; i < 3; i++) invs.push((await call('POST', `/v1/rooms/${w.code}/invites`, {}, w.token)).body.invite);
  const res = await Promise.all(invs.map((inv, i) => call('POST', `/v1/rooms/${w.code}/join`, { invite: inv, name: 'P' + i, pin: '2222' })));
  assert.equal(res.filter(r => r.status === 201).length, 2, JSON.stringify(res.map(r => r.body)));
  assert.equal(res.filter(r => r.body.error && r.body.error.code === 'members_full').length, 1);
  assert.equal((await q('SELECT count(*)::int n FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE r.code = $1', [w.code]))[0].n, 4);
});

test('remove a member: their login ends and the seat is free again', async () => {
  const w = await world();
  const r = await addMember(w, 'Rahul');
  assert.equal((await call('DELETE', `/v1/rooms/${w.code}/members/${w.member.id}`, undefined, r.token)).body.error.code, 'owner_only');
  assert.equal((await call('DELETE', `/v1/rooms/${w.code}/members/${w.member.id}`, undefined, w.token)).body.error.code, 'bad_input');   // not yourself
  assert.equal((await call('DELETE', `/v1/rooms/${w.code}/members/${r.member.id}`, undefined, w.token)).status, 200);
  assert.equal((await call('GET', `/v1/rooms/${w.code}`, undefined, r.token)).body.error.code, 'login_needed');
  assert.equal((await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Rahul', pin: '5555' })).body.error.code, 'wrong_login');
  const again = await addMember(w, 'Amit');
  assert.equal(again.member.seat, 1);
});

test('logout ends only that device', async () => {
  const w = await world();
  const second = (await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Abhi', pin: '1234' })).body.token;
  assert.equal((await call('POST', `/v1/rooms/${w.code}/logout`, {}, second)).status, 200);
  assert.equal((await call('GET', `/v1/rooms/${w.code}`, undefined, second)).body.error.code, 'login_needed');
  assert.equal((await call('GET', `/v1/rooms/${w.code}`, undefined, w.token)).status, 200);
});

test('live session: first is host, next is guest with a ticket the host can check', async () => {
  const w = await world();
  const r = await addMember(w, 'Rahul');
  const h = await call('POST', `/v1/rooms/${w.code}/session`, {}, w.token);
  assert.equal(h.body.role, 'host'); assert.equal(h.body.epoch, 1); assert.equal(h.body.world, null);
  assert.match(h.body.hostPeer, new RegExp(`^rvfarm-${w.code.toLowerCase()}-1-[a-z0-9]{5}$`));
  const g = await call('POST', `/v1/rooms/${w.code}/session`, {}, r.token);
  assert.equal(g.body.role, 'guest'); assert.equal(g.body.hostPeer, h.body.hostPeer); assert.equal(g.body.hostName, 'Abhi'); assert.ok(g.body.ticket);
  const v = await call('POST', `/v1/rooms/${w.code}/verify`, { ticket: g.body.ticket }, w.token);
  assert.equal(v.status, 200); assert.equal(v.body.member.name, 'Rahul'); assert.equal(v.body.member.seat, 1);
  assert.equal((await call('POST', `/v1/rooms/${w.code}/verify`, { ticket: g.body.ticket }, r.token)).body.error.code, 'not_host');
  const [p, s] = g.body.ticket.split('.');
  assert.equal((await call('POST', `/v1/rooms/${w.code}/verify`, { ticket: p + '.' + s.replace(/^./, c => (c === 'a' ? 'b' : 'a')) }, w.token)).body.error.code, 'bad_ticket');
  // a ticket from another world is useless here
  const other = await world('Vijay');
  await call('POST', `/v1/rooms/${other.code}/session`, {}, other.token);
  const om = await addMember(other, 'Mallory');
  const ot = (await call('POST', `/v1/rooms/${other.code}/session`, {}, om.token)).body.ticket;
  assert.equal((await call('POST', `/v1/rooms/${w.code}/verify`, { ticket: ot }, w.token)).body.error.code, 'bad_ticket');
});

test('heartbeat saves the world and the online list; wrong epoch is told to step down', async () => {
  const w = await world();
  const r = await addMember(w, 'Rahul');
  const h = await call('POST', `/v1/rooms/${w.code}/session`, {}, w.token);
  const snap = { v: 1, obj: 3, mats: { logs: 50 } };
  const hb = await call('POST', `/v1/rooms/${w.code}/heartbeat`, { epoch: h.body.epoch, online: [w.member.id, r.member.id, '00000000-0000-4000-8000-000000000000', 'junk'], world: snap }, w.token);
  assert.equal(hb.status, 200); assert.equal(hb.body.worldRev, 1); assert.equal(hb.body.online, 2);
  assert.deepEqual(hb.body.gone, ['00000000-0000-4000-8000-000000000000']);      // in the game but not a member
  const info = await call('GET', `/v1/rooms/${w.code}`, undefined, r.token);
  assert.equal(info.body.online, 2); assert.equal(info.body.host.name, 'Abhi');
  assert.deepEqual(info.body.members.map(m => m.online), [true, true]);
  assert.equal((await call('POST', `/v1/rooms/${w.code}/heartbeat`, { epoch: 99 }, w.token)).body.superseded, true);
  assert.equal((await call('POST', `/v1/rooms/${w.code}/heartbeat`, { epoch: h.body.epoch }, r.token)).body.superseded, true);
  assert.equal((await call('POST', `/v1/rooms/${w.code}/heartbeat`, { epoch: 1, world: { v: 2 } }, w.token)).body.error.code, 'bad_input');
  assert.equal((await call('POST', `/v1/rooms/${w.code}/heartbeat`, { epoch: 1, world: { v: 1, big: 'x'.repeat(210000) } }, w.token)).status, 413);
  // the save sent while the page closes carries the token in the body (no headers allowed there)
  const beacon = await send(`/v1/rooms/${w.code}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ token: w.token, epoch: 1, world: { v: 1, obj: 4 }, release: true }) });
  assert.equal(beacon.status, 200);
  const room = (await q('SELECT world, world_rev, host_member_id, online FROM rooms WHERE code = $1', [w.code]))[0];
  assert.deepEqual(room.world, { v: 1, obj: 4 }); assert.equal(room.world_rev, 2); assert.equal(room.host_member_id, null); assert.deepEqual(room.online, []);
  // released: the next member hosts right away and gets the saved world
  const next = await call('POST', `/v1/rooms/${w.code}/session`, {}, r.token);
  assert.equal(next.body.role, 'host'); assert.equal(next.body.epoch, 2); assert.deepEqual(next.body.world, { v: 1, obj: 4 });
});

test('host takeover rules: grace period, unavailable host, stale heartbeat, own other device', async () => {
  const w = await world();
  const r = await addMember(w, 'Rahul'), a = await addMember(w, 'Amit');
  const h = await call('POST', `/v1/rooms/${w.code}/session`, {}, w.token);
  // a new host gets 10 s to come online
  let s = await call('POST', `/v1/rooms/${w.code}/session`, { hostGone: 1, unavailable: true }, r.token);
  assert.equal(s.body.role, 'guest');
  // without "unavailable" a live host is never replaced
  await q(`UPDATE rooms SET host_since = now() - interval '20 seconds' WHERE code = $1`, [w.code]);
  s = await call('POST', `/v1/rooms/${w.code}/session`, { hostGone: 1 }, r.token);
  assert.equal(s.body.role, 'guest');
  // wrong epoch report is ignored
  s = await call('POST', `/v1/rooms/${w.code}/session`, { hostGone: 7, unavailable: true }, r.token);
  assert.equal(s.body.role, 'guest');
  s = await call('POST', `/v1/rooms/${w.code}/session`, { hostGone: 1, unavailable: true }, r.token);
  assert.equal(s.body.role, 'host'); assert.equal(s.body.epoch, 2);
  const sup = (await call('POST', `/v1/rooms/${w.code}/heartbeat`, { epoch: h.body.epoch }, w.token)).body;
  assert.equal(sup.superseded, true); assert.equal(sup.hostId, r.member.id); assert.equal(sup.hostName, 'Rahul');
  // heartbeat stopped for 35 s: anyone takes over
  await q(`UPDATE rooms SET host_seen_at = now() - interval '40 seconds' WHERE code = $1`, [w.code]);
  s = await call('POST', `/v1/rooms/${w.code}/session`, {}, a.token);
  assert.equal(s.body.role, 'host'); assert.equal(s.body.epoch, 3);
  // the same member opening on another device takes over their own session
  const amit2 = (await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Amit', pin: '5555' })).body.token;
  s = await call('POST', `/v1/rooms/${w.code}/session`, {}, amit2);
  assert.equal(s.body.role, 'host'); assert.equal(s.body.epoch, 4);
});

test('race: 3 members open an empty world at once -> exactly one host', async () => {
  const w = await world();
  const r = await addMember(w, 'Rahul'), a = await addMember(w, 'Amit');
  const res = await Promise.all([w, r, a].map(m => call('POST', `/v1/rooms/${w.code}/session`, {}, m.token)));
  const hosts = res.filter(x => x.body.role === 'host');
  assert.equal(hosts.length, 1, JSON.stringify(res.map(x => x.body.role)));
  for (const g of res.filter(x => x.body.role === 'guest')) assert.equal(g.body.hostPeer, hosts[0].body.hostPeer);
});

test('delete a world: owner only, typed name, then it is gone for everyone', async () => {
  const w = await world();
  const r = await addMember(w, 'Rahul');
  assert.equal((await call('DELETE', `/v1/rooms/${w.code}`, { confirm: 'Test Farm' }, r.token)).body.error.code, 'owner_only');
  assert.equal((await call('DELETE', `/v1/rooms/${w.code}`, { confirm: 'wrong' }, w.token)).body.error.code, 'bad_input');
  assert.equal((await call('DELETE', `/v1/rooms/${w.code}`, { confirm: 'test farm' }, w.token)).status, 200);
  assert.equal((await call('GET', `/v1/rooms/${w.code}`, undefined, r.token)).body.error.code, 'room_not_found');
  assert.equal((await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Abhi', pin: '1234' })).body.error.code, 'room_not_found');
  assert.equal((await q('SELECT count(*)::int n FROM room_members m JOIN rooms ro ON ro.id = m.room_id WHERE ro.code = $1', [w.code]))[0].n, 0);
});

test('admin migrate needs the admin secret', async () => {
  assert.equal((await call('POST', '/v1/admin/migrate', {}, 'wrong-secret-wrong')).status, 404);
  const ok = await call('POST', '/v1/admin/migrate', {}, 'admin-xyz');
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.applied, []);
});

test('rate limit: too many logins from one address', { skip: !!API && 'the local worker runs with higher limits' }, async () => {
  const w = await world();
  let last;
  for (let i = 0; i < 32; i++) last = await call('POST', `/v1/rooms/${w.code}/login`, { name: 'Ghost' + i, pin: '1234' }, null, { 'X-Forwarded-For': '9.9.9.9' });
  assert.equal(last.status, 429); assert.equal(last.body.error.code, 'slow_down');
});
