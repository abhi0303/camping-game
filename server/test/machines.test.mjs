// The gold mine, the flour machine and gold coins (server/src/machines.js) against a real Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';
import { THIEVES } from '../src/thieves.js';
import { runningMs } from '../../js/farm/machines/machineProduction.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
const DB = 'rvmachtest_' + Math.random().toString(36).slice(2, 8);
let pool, env;
before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const u = new URL(ADMIN_URL); u.pathname = '/' + DB;
  pool = new pg.Pool({ connectionString: u.toString(), max: 12 });
  await migrate(pool);
  THIEVES.on = false;
  env = { __pool: pool, SERVER_SECRET: 'test-secret-0123456789', ADMIN_SECRET: 'admin-xyz', RATE_SCALE: 50 };
});
after(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.end();
});

let n = 0, rid = 0;
async function call(method, path, body, token) {
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.4.0.' + (n++ % 250) };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('http://api.test' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
const act = (w, body, requestId) => call('POST', `/v1/rooms/${w.code}/farm`, { requestId: requestId || `req-${Date.now()}-${++rid}`, ...body }, w.token);
const farm = w => call('GET', `/v1/rooms/${w.code}/farm`, undefined, w.token);
async function world() {
  const r = await call('POST', '/v1/rooms', { name: 'Abhi', pin: '1234', world: 'Gold Farm' });
  const w = { code: r.body.room.code, token: r.body.token };
  await farm(w);
  w.id = (await q('SELECT id FROM rooms WHERE code = $1', [w.code]))[0].id;
  return w;
}
const setGold = (w, g) => q('UPDATE rooms SET gold = $2 WHERE id = $1', [w.id, g]);
const setWheat = (w, n) => q(`INSERT INTO inventory (room_id, item, qty) VALUES ($1, 'wheat', $2) ON CONFLICT (room_id, item) DO UPDATE SET qty = $2`, [w.id, n]);
// the machine was last worked out `secs` ago (and its capacity window / turning started that long ago too)
const back = (w, kind, secs) => q(`UPDATE farm_machines SET calc_at = calc_at - make_interval(secs => $3), win_start = win_start - make_interval(secs => $3),
    grind_started_at = grind_started_at - make_interval(secs => $3) WHERE room_id = $1 AND kind = $2`, [w.id, kind, secs]);

test('the gold mine: every farm has one; it makes coins only at night (7 PM – 4 AM IST), keeps unfinished work, collect, upgrade with gold', async () => {
  const w = await world();
  let s = (await farm(w)).body;
  assert.equal(s.machines.gold, 0); assert.equal(s.machines.mine.level, 1); assert.equal(s.machines.mine.ready, 0); assert.equal(s.machines.flour, null);
  // three days away: 27 hours of night at 2 h a coin = 13 coins and half of the next
  await back(w, 'mine', 3 * 86400);
  s = (await farm(w)).body;
  const coins = s.machines.mine.ready, prog = s.machines.mine.progress;
  const run = runningMs(Date.now() - 3 * 86400e3, Date.now()) / 3600e3;
  assert.ok(Math.abs(coins + prog - run / 2) < 0.01, `${coins} + ${prog} vs ${run / 2}`);
  assert.equal(coins, Math.floor(run / 2 + 1e-9));
  // a week and more away: at most a week is counted
  await back(w, 'mine', 30 * 86400);
  const r2 = (await farm(w)).body.machines.mine;
  assert.ok(r2.ready <= coins + 32, String(r2.ready));
  // collect into the farm's gold (once, even if sent twice)
  const id = 'collect-gold-1';
  let c = await act(w, { action: 'machine', machine: 'mine', op: 'collect' }, id);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const got = r2.ready;
  assert.equal(c.body.machines.gold, got); assert.equal(c.body.machines.mine.ready, 0);
  c = await act(w, { action: 'machine', machine: 'mine', op: 'collect' }, id);
  assert.equal(c.body.replay, true); assert.equal(c.body.machines.gold, got);
  assert.equal((await act(w, { action: 'machine', machine: 'mine', op: 'collect' })).body.error.code, 'nothing_ready');
  // upgrades: in order, with gold
  await setGold(w, 4);
  assert.equal((await act(w, { action: 'machine', machine: 'mine', op: 'upgrade', level: 2 })).body.error.code, 'not_enough_gold');
  assert.equal((await act(w, { action: 'machine', machine: 'mine', op: 'upgrade', level: 3 })).body.error.code, 'one_at_a_time');
  await setGold(w, 50);
  c = await act(w, { action: 'machine', machine: 'mine', op: 'upgrade', level: 2 });
  assert.equal(c.body.machines.mine.level, 2); assert.equal(c.body.machines.gold, 45);
  assert.equal((await act(w, { action: 'machine', machine: 'mine', op: 'upgrade', level: 2 })).body.error.code, 'already_upgraded');
  for (const lv of [3, 4]) c = await act(w, { action: 'machine', machine: 'mine', op: 'upgrade', level: lv });
  assert.equal(c.body.machines.mine.level, 4); assert.equal(c.body.machines.gold, 50 - 5 - 12 - 25);
  // level 4: a coin every 30 minutes of night — one night = 18 coins
  await q(`UPDATE farm_machines SET ready = 0, progress = 0 WHERE room_id = $1 AND kind = 'mine'`, [w.id]);
  await back(w, 'mine', 86400);
  assert.equal((await farm(w)).body.machines.mine.ready, 18);
});

test('race: two players buy the flour machine at the same moment with gold for one -> one machine, gold never below zero', async () => {
  const w = await world();
  await setGold(w, 15);
  const res = await Promise.all([1, 2].map(() => act(w, { action: 'machine', machine: 'flour', op: 'buy' })));
  assert.equal(res.filter(r => r.status === 200).length, 1, JSON.stringify(res.map(r => r.body.error)));
  assert.ok(res.some(r => r.body.error && ['owned', 'not_enough_gold'].includes(r.body.error.code)));
  const s = (await farm(w)).body.machines;
  assert.equal(s.gold, 5); assert.equal(s.flour.level, 1);
  assert.equal((await q(`SELECT count(*)::int AS n FROM farm_machines WHERE room_id = $1 AND kind = 'flour'`, [w.id]))[0].n, 1);
});

test('the flour machine, level 1: wheat in by tens (500 an hour), turn the millstone (15 s, 100 wheat → 20 packets), collect into storage', async () => {
  const w = await world();
  await setGold(w, 10);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 100 })).body.error.code, 'not_owned');
  await act(w, { action: 'machine', machine: 'flour', op: 'buy' });
  await setWheat(w, 800);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 25 })).status, 400);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 900 })).body.error.code, 'not_enough');
  let r = await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 400 });
  assert.equal(r.body.inventory.wheat, 400); assert.equal(r.body.machines.flour.hopper, 400);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 200 })).body.error.code, 'capacity');   // 500 an hour
  r = await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 100 });
  assert.equal(r.body.machines.flour.hopper, 500); assert.equal(r.body.inventory.wheat, 300);
  // a level 1 machine doesn't grind by itself
  await back(w, 'flour', 600);
  assert.equal((await farm(w)).body.machines.flour.hopper, 500);
  // turning: start, not too fast, then 100 wheat → 20 packets
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'turn' })).body.error.code, 'not_turning');
  await act(w, { action: 'machine', machine: 'flour', op: 'turnstart' });
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'turn' })).body.error.code, 'too_fast');
  await back(w, 'flour', 15);
  r = await act(w, { action: 'machine', machine: 'flour', op: 'turn' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.machines.flour.hopper, 400); assert.equal(r.body.machines.flour.ready, 20);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'turn' })).body.error.code, 'not_turning');   // a new turn needs a new start
  // collect the packets into the storage (it holds 500 at level 1)
  r = await act(w, { action: 'machine', machine: 'flour', op: 'collect' });
  assert.equal(r.body.inventory.flour, 20); assert.equal(r.body.machines.flour.ready, 0); assert.equal(r.body.caps.flour, 500);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'collect' })).body.error.code, 'nothing_ready');
  // flour sells at the Market
  r = await act(w, { action: 'sell', item: 'flour', qty: 20 });
  assert.equal(r.status, 200); assert.equal(r.body.inventory.flour, 0);
  // the next hour: room for 500 more again
  await back(w, 'flour', 3600);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 100 })).body.machines.flour.hopper, 500);
});

test('the flour machine, level 2+: grinds by itself (3 packets per 10 wheat), capacity per window; a full storage keeps packets in the tray', async () => {
  const w = await world();
  await setGold(w, 100);
  await act(w, { action: 'machine', machine: 'flour', op: 'buy' });
  let r = await act(w, { action: 'machine', machine: 'flour', op: 'upgrade', level: 2 });
  assert.equal(r.body.machines.flour.level, 2); assert.equal(r.body.machines.gold, 85);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'turnstart' })).body.error.code, 'electric');
  await setWheat(w, 3000);
  await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 500 });
  // half an hour: 250 wheat ground (500 an hour) → 75 packets
  await back(w, 'flour', 1800);
  r = await farm(w);
  assert.equal(r.body.machines.flour.hopper, 250); assert.equal(r.body.machines.flour.ready, 75);
  // two more hours: the rest, and no time banked while empty
  await back(w, 'flour', 7200);
  r = await farm(w);
  assert.equal(r.body.machines.flour.hopper, 0); assert.equal(r.body.machines.flour.ready, 150); assert.equal(r.body.machines.flour.progress, 0);
  // levels 3–5: 1000 an hour, 1000 per 30 minutes, 2000 per 30 minutes
  for (const lv of [3, 4, 5]) await act(w, { action: 'machine', machine: 'flour', op: 'upgrade', level: lv });
  r = await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 2000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'add', qty: 10 })).body.error.code, 'capacity');
  await back(w, 'flour', 900);                                         // 15 minutes: 1000 wheat → 300 packets
  r = await farm(w);
  assert.equal(r.body.machines.flour.hopper, 1000); assert.equal(r.body.machines.flour.ready, 450);
  // collect: the storage holds 500 flour packets at level 1
  await q(`INSERT INTO inventory (room_id, item, qty) VALUES ($1, 'flour', 200) ON CONFLICT (room_id, item) DO UPDATE SET qty = 200`, [w.id]);
  r = await act(w, { action: 'machine', machine: 'flour', op: 'collect' });
  assert.equal(r.body.inventory.flour, 500); assert.equal(r.body.machines.flour.ready, 150);
  assert.equal((await act(w, { action: 'machine', machine: 'flour', op: 'collect' })).body.error.code, 'storage_full');
  assert.equal(r.body.machines.gold, 100 - 10 - 5 - 10 - 18 - 30);
});
