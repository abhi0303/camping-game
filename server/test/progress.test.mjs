// The farm's long game (js/farm/progression.js, server/src/progress.js): the farm level with XP and missions,
// level gates, shed levels, animals' care levels, the Market's demand, and what gold buys — against a real Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';
import { THIEVES } from '../src/thieves.js';
import { xpNeed, levelForXp, levelReward, salePay, loadNow, careLevel, makeMissions, MARKET } from '../../js/farm/progression.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
const DB = 'rvprogtest_' + Math.random().toString(36).slice(2, 8);
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
const act = (w, body) => call('POST', `/v1/rooms/${w.code}/farm`, { requestId: `req-${Date.now()}-${++rid}`, ...body }, w.token);
const farm = w => call('GET', `/v1/rooms/${w.code}/farm`, undefined, w.token);
async function world(money = 500) {
  const r = await call('POST', '/v1/rooms', { name: 'Abhi', pin: '1234', world: 'Level Farm' });
  const w = { code: r.body.room.code, token: r.body.token };
  await farm(w);
  await q('UPDATE rooms SET money = $2 WHERE code = $1', [w.code, money]);
  return w;
}
const setInv = (w, item, qty) => q(`INSERT INTO inventory (room_id, item, qty) SELECT id, $2, $3 FROM rooms WHERE code = $1 ON CONFLICT (room_id, item) DO UPDATE SET qty = EXCLUDED.qty`, [w.code, item, qty]);
const travel = async (w, hours) => {
  await q(`UPDATE rooms SET produced_at = produced_at - make_interval(secs => $2) WHERE code = $1`, [w.code, hours * 3600]);
  await q(`UPDATE animals a SET fed_until = fed_until - make_interval(secs => $2) FROM rooms r WHERE r.id = a.room_id AND r.code = $1`, [w.code, hours * 3600]);
  await q(`UPDATE market_load m SET at = at - make_interval(secs => $2) FROM rooms r WHERE r.id = m.room_id AND r.code = $1`, [w.code, hours * 3600]);
};
const coop = async w => { await setInv(w, 'wood', 100); return (await act(w, { action: 'build', type: 'coop', plot: 0 })).body.buildings.find(b => b.plot === 0); };

test('the rules: XP per level grows for ever, rewards, levels from old earnings, care levels, missions sized to the level', () => {
  assert.deepEqual([1, 2, 3, 5, 10, 20].map(xpNeed), [100, 303, 580, 1313, 3981, 12068]);
  assert.deepEqual(levelReward(5), { money: 750, gold: 2 });
  assert.deepEqual(levelForXp(100 + 303 + 50), { level: 3, xp: 50 });
  assert.deepEqual(levelForXp(1e9, 12).level, 12);
  assert.deepEqual([0, 5.9, 6, 20, 47, 48, 100, 1000].map(careLevel), [1, 1, 2, 3, 3, 4, 5, 5]);
  assert.deepEqual(makeMissions(1, { level: 1 }).map(m => m.k), ['eggs', 'sold']);
  const late = makeMissions(9, { level: 9, hens: true, animals: 10, fields: true, flour: true }, { eggs: 500 }, 'room-x');
  assert.equal(late.length, 3);
  assert.ok(late.every(m => m.n > 0 && !['milk', 'rent'].includes(m.k)), JSON.stringify(late));       // (no goats, cows or horses)
  assert.deepEqual(makeMissions(9, { level: 9, hens: true, animals: 10, fields: true, flour: true }, { eggs: 500 }, 'room-x'), late);   // the same for the same farm
});

test('the Market\'s demand: each unit a little cheaper, 35 % at the lowest, back by half every 3 hours', () => {
  assert.equal(salePay('egg', 1, 0, 60), 48);              // 60 × ₹1 from full price down to 60 %
  assert.equal(salePay('egg', 1, 0, 1000), 382);           // most of them at the floor (35 %)
  assert.equal(salePay('gold', MARKET.gold, 0, 1), 90);
  assert.equal(loadNow(100, 0, 3 * 3600e3), 50);
  assert.equal(loadNow(100, 0, 6 * 3600e3), 25);
});

test('a new farm: level 1, two missions; XP from what it does; level up only with the XP and the missions done, once', async () => {
  const w = await world(5000);
  let f = (await farm(w)).body;
  assert.deepEqual([f.progress.level, f.progress.need, f.progress.missions.map(m => [m.k, m.n, m.got])], [1, 100, [['eggs', 50, 0], ['sold', 200, 0]]]);
  assert.equal((await act(w, { action: 'levelup', level: 2 })).body.error.code, 'need_xp');
  // building and buying earn XP
  const c = await coop(w);
  let r = await act(w, { action: 'buy', item: 'chicken', qty: 6 });
  assert.equal(r.body.result.xp, 18);
  assert.equal(r.body.progress.xp, 30 + 18);
  // eggs: collected (XP and the mission), sold (XP and the mission)
  await q(`UPDATE animals a SET ready = 10 FROM rooms r WHERE r.id = a.room_id AND r.code = $1`, [w.code]);
  r = await act(w, { action: 'collect', shelter: c.id });
  assert.equal(r.body.result.xp, 15);
  assert.deepEqual(r.body.progress.missions.map(m => m.got), [50, 0]);
  assert.equal(r.body.progress.missions[0].done, true);
  r = await act(w, { action: 'sell', item: 'egg', qty: 60 });
  assert.equal(r.body.progress.missions[1].got, 48);
  assert.equal((await act(w, { action: 'levelup', level: 2 })).body.error.code, 'need_xp');       // 65 XP of 100
  // enough XP (another coop), but a mission isn't done
  await setInv(w, 'wood', 300);
  await act(w, { action: 'build', type: 'coop', plot: 1 });
  r = await act(w, { action: 'buy', item: 'chicken', qty: 2 });
  assert.ok(r.body.progress.xp >= 100, JSON.stringify(r.body.progress));
  assert.equal((await act(w, { action: 'levelup', level: 2 })).body.error.code, 'missions');
  // the rest of the money from sales: wood (the Market's demand for wood is high)
  r = await act(w, { action: 'sell', item: 'wood', qty: 70 });
  assert.ok(r.body.progress.missions.every(m => m.done), JSON.stringify(r.body.progress.missions));
  assert.equal(r.body.progress.ready, true);
  const money = r.body.money, gold = r.body.machines.gold;
  // two players press "Level up" at once: once
  const [a, b] = await Promise.all([act(w, { action: 'levelup', level: 2 }), act(w, { action: 'levelup', level: 2 })]);
  assert.equal([a, b].filter(x => x.status === 200).length, 1, JSON.stringify([a.body.error, b.body.error]));
  assert.equal([a, b].find(x => x.body.error).body.error.code, 'already_done');
  f = (await farm(w)).body;
  assert.equal(f.progress.level, 2);
  assert.equal(f.money, money + levelReward(2).money); assert.equal(f.machines.gold, gold + levelReward(2).gold);
  assert.deepEqual(f.progress.missions.map(m => [m.k, m.got]), [['feed', 0], ['fish', 0]]);    // counted from now
  assert.ok(f.progress.xp < f.progress.need);
});

test('level gates: goats from level 2, a cow barn from 4; a coop\'s level 2 from farm level 2 — more room', async () => {
  const w = await world(20000);
  const c = await coop(w);
  assert.equal((await act(w, { action: 'build', type: 'goat_shed', plot: 1 })).body.error.code, 'locked');
  let r = await act(w, { action: 'upgrade', target: 'building', building: c.id, level: 2 });
  assert.equal(r.body.error.code, 'locked'); assert.match(r.body.error.message, /farm level 2/);
  await q(`UPDATE rooms SET farm_level = 2 WHERE code = $1`, [w.code]);
  await setInv(w, 'wood', 200); await setInv(w, 'stone', 50);
  r = await act(w, { action: 'upgrade', target: 'building', building: c.id, level: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.buildings.find(b => b.id === c.id).level, 2);
  assert.deepEqual([r.body.inventory.wood, r.body.inventory.stone], [140, 30]);
  assert.equal((await act(w, { action: 'upgrade', target: 'building', building: c.id, level: 4 })).body.error.code, 'one_at_a_time');
  r = await act(w, { action: 'buy', item: 'chicken', qty: 8 });                  // room for 8 now (was 6)
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await act(w, { action: 'buy', item: 'chicken', qty: 1 })).body.error.code, 'no_space');
  assert.equal((await act(w, { action: 'build', type: 'goat_shed', plot: 1 })).status, 200);
  assert.equal((await act(w, { action: 'build', type: 'barn', plot: 2 })).body.error.code, 'locked');
  // level 4 of a coop costs gold too
  await q(`UPDATE rooms SET farm_level = 7, money = 50000 WHERE code = $1`, [w.code]);
  await setInv(w, 'wood', 900); await setInv(w, 'stone', 900);
  assert.equal((await act(w, { action: 'upgrade', target: 'building', building: c.id, level: 3 })).status, 200);
  r = await act(w, { action: 'upgrade', target: 'building', building: c.id, level: 4 });
  assert.equal(r.body.error.code, 'not_enough'); assert.match(r.body.error.message, /5 more gold coins/);
  await q(`UPDATE rooms SET gold = 9 WHERE code = $1`, [w.code]);
  r = await act(w, { action: 'upgrade', target: 'building', building: c.id, level: 4 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.machines.gold, 4);
});

test('care: an animal fed for longer reaches care level 2 (6 h), 3 (20 h)… and lays more; a better coop adds a little', async () => {
  const w = await world(5000);
  const c = await coop(w);
  await act(w, { action: 'buy', item: 'chicken', qty: 1 });
  await setInv(w, 'feed', 100);
  for (let i = 0; i < 11; i++) await act(w, { action: 'feed', shelter: c.id, all: true });   // fed a day ahead
  await travel(w, 6.5);
  let a = (await farm(w)).body.animals[0];
  assert.deepEqual([a.level, a.care], [2, 6.5]);
  await travel(w, 14);
  a = (await farm(w)).body.animals[0];
  assert.equal(a.level, 3);
});

test('the Market\'s demand: a second sale right after pays less, three hours later half the drop is back; orders pay in full', async () => {
  const w = await world(1000);
  await setInv(w, 'egg', 120);
  let r = await act(w, { action: 'sell', item: 'egg', qty: 60 });
  assert.equal(r.body.result.pay, 48);
  r = await act(w, { action: 'sell', item: 'egg', qty: 30 });                      // from 60 % down to 40 %: ₹15
  assert.equal(r.body.result.pay, 15);
  await travel(w, 3);                                                              // the load (90) halves to 45
  r = await act(w, { action: 'sell', item: 'egg', qty: 30 });                      // from 70 % down to 50 %: ₹18
  assert.equal(r.body.result.pay, 18);
  assert.ok((await farm(w)).body.market.load.egg.load > 70);
});

test('gold: sold at the Market, a golden hen at level 10 (30 gold), a field ripened at once, its soil improved', async () => {
  const w = await world(50000);
  await q(`UPDATE rooms SET gold = 100 WHERE code = $1`, [w.code]);
  let r = await act(w, { action: 'sell', item: 'gold', qty: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result.pay, salePay('gold', MARKET.gold, 0, 2)); assert.equal(r.body.machines.gold, 98);
  assert.equal((await act(w, { action: 'sell', item: 'gold', qty: 500 })).body.error.code, 'not_enough');
  const c = await coop(w);
  assert.equal((await act(w, { action: 'buy', item: 'chicken_gold', qty: 1 })).body.error.code, 'locked');
  await q(`UPDATE rooms SET farm_level = 10 WHERE code = $1`, [w.code]);
  r = await act(w, { action: 'buy', item: 'chicken_gold', qty: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.machines.gold, r.body.animals[0].type, r.body.animals[0].shelter], [68, 'chicken_gold', c.id]);
  assert.match(r.body.message, /for 30 gold coins/);
  // a field: buy, sow, water, rush with gold (1 coin for every 20 minutes left: 2 h -> 6)
  await act(w, { action: 'field', op: 'buy', slot: 0 });
  await setInv(w, 'wheat_seeds', 2);
  await act(w, { action: 'field', op: 'sowstart', slot: 0, crop: 'wheat' });
  await q(`UPDATE farm_fields SET sow_started_at = now() - interval '1 minute'`);
  await act(w, { action: 'field', op: 'sow', slot: 0 });
  await act(w, { action: 'field', op: 'water', slot: 0 });
  r = await act(w, { action: 'field', op: 'rush', slot: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.machines.gold, 62);
  r = await act(w, { action: 'field', op: 'harvest', slot: 0 });
  assert.ok(r.body.result.got >= 350, JSON.stringify(r.body.result));
  // the soil: level 2 (₹1500 and 3 gold), then 3 (₹4000 and 10 gold: more wheat, faster)
  assert.equal((await act(w, { action: 'field', op: 'soil', slot: 0, level: 3 })).body.error.code, 'one_at_a_time');
  r = await act(w, { action: 'field', op: 'soil', slot: 0, level: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.fields.list[0].soil, 2); assert.equal(r.body.machines.gold, 59);
  r = await act(w, { action: 'field', op: 'soil', slot: 0, level: 3 });
  assert.equal(r.body.fields.list[0].soil, 3);
  // the next fields cost more and come later
  assert.equal(r.body.fields.next.price, 800);
});

test('a world from before the farm level starts at the level its sales earned (at most 12), with its missions', async () => {
  const w = await world(1000);
  await q(`UPDATE rooms SET farm_level = 1, xp = 0, xp_total = 0, missions = NULL, total_earned = 20000 WHERE code = $1`, [w.code]);
  const f = (await farm(w)).body;
  const L = levelForXp(1000, 12);
  assert.deepEqual([f.progress.level, f.progress.xp], [L.level, L.xp]);
  assert.ok(f.progress.level >= 4 && f.progress.missions.length >= 2, JSON.stringify(f.progress));
});

/* ---------- worlds that were being played before this update ---------- */
// A database as it is live today (migrations 1–12) with worlds that have been played for a while, then the update
// (migration 13 runs on the first request): nothing they had is lost, and they play on.
import { createHash } from 'node:crypto';
import { MIGRATIONS } from '../src/migrations.js';
test('live worlds from before the update keep everything: money, gold, goods, animals, horses on rent, fields, machines, dogs, orders', async () => {
  const name = DB + '_live';
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
  const u = new URL(ADMIN_URL); u.pathname = '/' + name;
  const p2 = new pg.Pool({ connectionString: u.toString(), max: 6 }), Q = (sql, p) => p2.query(sql, p).then(r => r.rows);
  try {
    await Q('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const m of MIGRATIONS.filter(m => m.id <= 12)) { await Q(m.sql); await Q('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]); }
    // a world as players left it, with a login for its owner
    const mk = async (code, earned, money, gold) => {
      const room = (await Q(`INSERT INTO rooms (code, name, money, gold, total_earned, storage_level, econ_rev, produced_at, order_streak, order_streak_day)
        VALUES ($1, 'Old farm', $2, $3, $4, 2, 40, now() - interval '10 minutes', 3, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1) RETURNING id`, [code, money, gold, earned]))[0].id;
      const m = (await Q(`INSERT INTO room_members (room_id, seat, name, pin_salt, pin_hash, is_owner) VALUES ($1, 0, 'Abhi', 's', 'h', true) RETURNING id`, [room]))[0].id;
      const token = 'old-login-token-of-' + code;
      await Q('INSERT INTO member_tokens (token_hash, member_id) VALUES ($1, $2)', [createHash('sha256').update(token).digest('hex'), m]);
      return { room, member: m, w: { code, token } };
    };
    const A = await mk('LIVEAA', 2400, 3500, 7), B = await mk('LIVEBB', 30000, 900, 0), C = await mk('LIVECC', 0, 500, 0);
    const bd = async (room, type, plot) => (await Q(`INSERT INTO buildings (room_id, type, plot, x, z, yaw) VALUES ($1, $2, $3, 0, 0, 0) RETURNING id`, [room, type, plot]))[0].id;
    const coopA = await bd(A.room, 'coop', 0), shedA = await bd(A.room, 'goat_shed', 1), barnA = await bd(A.room, 'barn', 2), stableA = await bd(A.room, 'stable', 3);
    const animal = (room, type, shelter, extra = {}) => Q(`INSERT INTO animals (room_id, type, shelter_id, health, progress, ready, level, fed_until, rented_until)
      VALUES ($1, $2, $3, 90, 0.5, $4, $5, now() + interval '1 hour', $6) RETURNING id`, [room, type, shelter, extra.ready || 0, extra.level || 1, extra.rented || null]).then(r => r[0].id);
    for (let i = 0; i < 4; i++) await animal(A.room, 'chicken', coopA, { ready: 10 });
    for (let i = 0; i < 2; i++) await animal(A.room, 'chicken_brown', coopA, { ready: 8 });
    for (let i = 0; i < 2; i++) await animal(A.room, 'goat', shedA);
    await animal(A.room, 'cow', barnA);
    const away = await animal(A.room, 'horse_bay', stableA, { level: 10, rented: new Date(Date.now() + 3600e3) });
    const foal = await animal(A.room, 'horse_black', stableA, { level: 3 });
    await Q(`INSERT INTO horse_rentals (room_id, renter, purpose, horses, hours, pay, status, expires_at, accepted_at, returns_at, horse_ids)
      VALUES ($1, 'Ravi', 'for a wedding', 1, 2, 50, 'active', now(), now() - interval '1 hour', now() + interval '1 hour', $2)`, [A.room, [away]]);
    await Q(`INSERT INTO farm_fields (room_id, slot, crop, stage, sown_at, watered_at, ready_at, scarecrow) VALUES
      ($1, 0, 'wheat', 'growing', now() - interval '2 hours', now() - interval '90 minutes', now() + interval '30 minutes', 1), ($1, 1, NULL, 'empty', NULL, NULL, NULL, 0)`, [A.room]);
    await Q(`INSERT INTO farm_machines (room_id, kind, level, calc_at, ready, hopper) VALUES ($1, 'mine', 2, now(), 3, 0), ($1, 'flour', 1, now(), 0, 50)`, [A.room]);
    await Q(`INSERT INTO farm_dogs (room_id, slot, level, fed_until) VALUES ($1, 0, 2, now() + interval '5 hours')`, [A.room]);
    await Q(`INSERT INTO farm_orders (room_id, day, n, customer, items, pay, available_at) VALUES ($1, (now() AT TIME ZONE 'Asia/Kolkata')::date, 1, 'Hotel Kaveri', '[{"item": "egg", "qty": 5}, {"item": "goat_milk", "qty": 2}]', 50, now() - interval '5 minutes')`, [A.room]);
    const goods = { egg: 30, egg_brown: 12, goat_milk: 5, cow_milk: 3, wood: 120, stone: 40, feed: 80, wheat: 600, flour: 40, worms: 20, fish_small: 5, bone: 4 };
    for (const [item, qty] of Object.entries(goods)) await Q('INSERT INTO inventory (room_id, item, qty) VALUES ($1, $2, $3)', [A.room, item, qty]);
    const coopB = await bd(B.room, 'coop', 0);
    for (let i = 0; i < 6; i++) await animal(B.room, 'chicken', coopB);

    // the update: the first request applies migration 13
    const env2 = { ...env, __pool: p2 };
    const go = async (w, method, path, body) => {
      const res = await worker.fetch(new Request('http://api.test' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + w.token, 'X-Forwarded-For': '10.5.0.' + (n++ % 250) },
        body: body ? JSON.stringify(body) : undefined }), env2, { waitUntil() {} });
      return { status: res.status, body: await res.json() };
    };
    const get = w => go(w, 'GET', `/v1/rooms/${w.code}/farm`), act2 = (w, body) => go(w, 'POST', `/v1/rooms/${w.code}/farm`, { requestId: 'live-request-' + (++rid), ...body });
    let r = await get(A.w);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual((await Q('SELECT max(id)::int AS n FROM schema_migrations'))[0].n, 13);
    let f = r.body;
    // money, gold, earnings, the storage level and every good: as they were
    assert.deepEqual([f.money, f.machines.gold, f.totalEarned, f.storageLevel], [3500, 7, 2400, 2]);
    for (const [item, qty] of Object.entries(goods)) assert.equal(f.inventory[item], qty, item);
    // every animal, building, horse level; the horse out on rent stays away; eggs in the nests are still there
    assert.deepEqual(f.animals.map(a => a.type).sort(), ['chicken', 'chicken', 'chicken', 'chicken', 'chicken_brown', 'chicken_brown', 'cow', 'goat', 'goat', 'horse_bay', 'horse_black']);
    assert.deepEqual(f.buildings.map(b => [b.type, b.level]), [['coop', 1], ['goat_shed', 1], ['barn', 1], ['stable', 1]]);
    assert.deepEqual([f.animals.find(a => a.id === away).level, f.animals.find(a => a.id === foal).level], [10, 3]);
    assert.ok(Date.parse(f.animals.find(a => a.id === away).rentedUntil) > Date.now());
    assert.ok(f.animals.filter(a => a.type.startsWith('chicken')).every(a => a.ready >= 8), JSON.stringify(f.animals));
    assert.ok(f.animals.filter(a => !a.type.startsWith('horse')).every(a => a.level === 1 && a.care > 0 && a.care < 1));   // (care starts now)
    assert.equal(f.rentals.length, 1);
    // the field keeps growing (same ripe time, its scarecrow), the machines, the dog, today's order (its pay), the streak
    const fd = f.fields.list.find(x => x.slot === 0);
    assert.deepEqual([fd.stage, fd.scarecrow, fd.soil, f.fields.list.length], ['growing', 1, 1, 2]);
    assert.deepEqual([f.machines.mine.level, f.machines.mine.ready >= 3, f.machines.flour.level, f.machines.flour.hopper], [2, true, 1, 50]);
    assert.deepEqual([f.thieves.dogs.length, f.thieves.dogs[0].level], [1, 2]);
    const order = f.orders.list.find(o => o.status === 'open');
    assert.deepEqual([order.customer, order.pay, f.orders.streak.days], ['Hotel Kaveri', 50, 3]);
    // its farm level: its sales earned it level 2, but it keeps horses (level 5): it starts at level 5, so it can still
    // buy and build all it has
    assert.deepEqual([f.progress.level, f.progress.xp, f.progress.total, f.progress.missions.length], [5, 0, 120, 3]);
    assert.ok(f.progress.missions.every(m => m.got === 0));
    // and it plays on
    r = await act2(A.w, { action: 'collect', shelter: coopA });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.result.total >= 56);
    r = await act2(A.w, { action: 'order', order: order.id });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.result.pay, 50);
    r = await act2(A.w, { action: 'buy', item: 'cow', qty: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await act2(A.w, { action: 'buy', item: 'horse_bay', qty: 1, age: 'foal' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await Q(`UPDATE farm_fields SET ready_at = now() - interval '1 minute' WHERE room_id = $1 AND slot = 0`, [A.room]);
    r = await act2(A.w, { action: 'field', op: 'harvest', slot: 0 });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.result.got >= 400 && r.body.result.got <= 450, JSON.stringify(r.body.result));
    r = await act2(A.w, { action: 'machine', machine: 'mine', op: 'collect' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.progress.xp > 0 && r.body.progress.missions.some(m => m.got > 0) || r.body.progress.xp > 0);
    // a big earner with only chickens: the level its sales earned, with the XP left over
    f = (await get(B.w)).body;
    const L = levelForXp(1500, 12);
    assert.deepEqual([f.progress.level, f.progress.xp, f.money], [L.level, L.xp, 900]);
    assert.equal(f.animals.length, 6);
    // a world nobody had played yet: level 1
    f = (await get(C.w)).body;
    assert.deepEqual([f.progress.level, f.progress.xp, f.money], [1, 0, 500]);
    // opened again: the same level and missions (worked out only once)
    const again = (await get(A.w)).body.progress;
    assert.equal(again.level, 5); assert.equal(again.missions.length, 3);
  } finally {
    await p2.end();
    const a2 = new pg.Client({ connectionString: ADMIN_URL });
    await a2.connect(); await a2.query(`DROP DATABASE IF EXISTS ${name}`); await a2.end();
  }
});
