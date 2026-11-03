// Farm economy tests (money, goods, shelters, animals, offline production) against a real Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';
import { simulate } from '../src/farm.js';
import { PLOTS } from '../src/layout.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
const DB = 'rvfarmtest_' + Math.random().toString(36).slice(2, 8);
let pool, env;
before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const u = new URL(ADMIN_URL); u.pathname = '/' + DB;
  pool = new pg.Pool({ connectionString: u.toString(), max: 12 });
  await migrate(pool);
  env = { __pool: pool, SERVER_SECRET: 'test-secret-0123456789', ADMIN_SECRET: 'admin-xyz', RATE_SCALE: 50 };
});
after(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.end();
});

let n = 0;
async function call(method, path, body, token) {
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.1.0.' + (n++ % 250) };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('http://api.test' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
let rid = 0;
const act = (w, body, token = w.token, requestId = `req-${Date.now()}-${++rid}`) => call('POST', `/v1/rooms/${w.code}/farm`, { requestId, ...body }, token);
const farm = (w, token = w.token) => call('GET', `/v1/rooms/${w.code}/farm`, undefined, token);
async function world() {
  const r = await call('POST', '/v1/rooms', { name: 'Abhi', pin: '1234', world: 'Econ Farm' });
  return { code: r.body.room.code, token: r.body.token };
}
const back = (w, hours) => q(`UPDATE rooms SET produced_at = now() - make_interval(secs => $2) WHERE code = $1`, [w.code, hours * 3600]);
// let `hours` pass on the farm: everything that happened (production counted, feeding) moves back in time
const travel = async (w, hours) => {
  await q(`UPDATE rooms SET produced_at = produced_at - make_interval(secs => $2) WHERE code = $1`, [w.code, hours * 3600]);
  await q(`UPDATE animals a SET fed_until = fed_until - make_interval(secs => $2), born_at = born_at - make_interval(secs => $2) FROM rooms r WHERE r.id = a.room_id AND r.code = $1`, [w.code, hours * 3600]);
};
const coop = async (w, plot = 0) => { await act(w, { action: 'buy', item: 'wood', qty: 20 }); return (await act(w, { action: 'build', type: 'coop', plot })).body.buildings.find(b => b.plot === plot); };
const setInv = (w, item, qty) => q(`INSERT INTO inventory (room_id, item, qty) SELECT id, $2, $3 FROM rooms WHERE code = $1 ON CONFLICT (room_id, item) DO UPDATE SET qty = EXCLUDED.qty`, [w.code, item, qty]);

test('a new farm: ₹500, 20 feed, the catalog, 8 plots, storage level 1', async () => {
  const w = await world();
  const f = await farm(w);
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.money, 500); assert.equal(f.body.inventory.feed, 20); assert.equal(f.body.inventory.egg, 0);
  assert.equal(f.body.plots, 8); assert.deepEqual(f.body.buildings, []); assert.deepEqual(f.body.animals, []);
  assert.equal(f.body.catalog.chicken.buy, 40); assert.equal(f.body.catalog.coop.capacity, 6);
  assert.equal(f.body.storageLevel, 1); assert.equal(f.body.caps.egg, 60); assert.equal(f.body.totalEarned, 0);
  assert.equal((await farm(w)).body.inventory.feed, 20);           // starting goods only once
  assert.equal((await call('GET', `/v1/rooms/${w.code}/farm`)).body.error.code, 'login_needed');
});

test('plots: two rows 21 m apart, every plot at its own place', async () => {
  const w = await world();
  await act(w, { action: 'buy', item: 'wood', qty: 40 });
  await act(w, { action: 'build', type: 'coop', plot: 0 });
  const r = await act(w, { action: 'build', type: 'coop', plot: 4 });
  const [a, b] = r.body.buildings;
  assert.deepEqual([a.plot, a.x, a.z, b.plot, b.x, b.z], [0, PLOTS[0].x, -189, 4, PLOTS[4].x, -168]);
  assert.equal(new Set(PLOTS.map(p => p.x + ',' + p.z)).size, 8);
});

test('the farm loop: coop, chickens arrive fed for 2 h, eggs only while fed, sell them', async () => {
  const w = await world();
  assert.equal((await act(w, { action: 'buy', item: 'chicken', qty: 1 })).body.error.code, 'no_shelter');
  let r = await act(w, { action: 'build', type: 'coop', plot: 0 });
  assert.equal(r.body.error.code, 'not_enough'); assert.match(r.body.error.message, /20 more wood/);
  const c = await coop(w);
  assert.equal(c.type, 'coop');
  assert.equal((await act(w, { action: 'buy', item: 'chicken', qty: 7 })).body.error.code, 'no_space');
  r = await act(w, { action: 'buy', item: 'chicken', qty: 6 });
  assert.equal(r.body.money, 500 - 120 - 100 - 240); assert.equal(r.body.animals.length, 6);
  assert.ok(r.body.animals.every(a => a.shelter === c.id && a.health === 100 && Date.parse(a.fedUntil) > Date.now() + 7000e3));
  // 10 hours pass: fed for the first 2 h only -> 6 chickens × 1 egg an hour × 2 h = 12 eggs, then they wait for food
  await travel(w, 10);
  r = await farm(w);
  assert.equal(r.body.inventory.egg, 12); assert.equal(r.body.inventory.feed, 20);    // nothing eaten by itself
  assert.ok(r.body.animals.every(a => a.hunger > 0 && a.health === 100), JSON.stringify(r.body.animals[0]));
  r = await act(w, { action: 'sell', item: 'egg', qty: 12 });
  assert.equal(r.body.money, 40 + 72); assert.equal(r.body.totalEarned, 72);
  assert.equal((await act(w, { action: 'sell', item: 'egg', qty: 1 })).body.error.code, 'not_enough');
  assert.equal((await act(w, { action: 'sell', item: 'feed', qty: 1 })).body.error.code, 'bad_item');
  assert.equal((await act(w, { action: 'buy', item: 'coop', qty: 1 })).body.error.code, 'bad_item');
  assert.equal((await act(w, { action: 'buy', item: 'feed', qty: -3 })).body.error.code, 'bad_input');
  const h = await call('GET', `/v1/rooms/${w.code}/farm/history`, undefined, w.token);
  assert.match(h.body.history[0].message, /Abhi sold 12 eggs for ₹72/);
});

test('feeding: feed all, feed some, not enough feed, already fed, timers move', async () => {
  const w = await world();
  const c = await coop(w);
  await act(w, { action: 'buy', item: 'chicken', qty: 4 });
  await travel(w, 3);                                       // fed 2 h, hungry for 1 h
  let r = await farm(w);
  const eggs0 = r.body.inventory.egg;                       // 4 × 1 × 2 = 8
  assert.equal(eggs0, 8);
  await setInv(w, 'feed', 3);
  r = await act(w, { action: 'feed', shelter: c.id, all: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.result.fed, r.body.result.wanted, r.body.result.short], [3, 4, true]);
  assert.match(r.body.message, /fed 3 chickens \(3 feed\) — not enough feed for the other 1/);
  assert.equal(r.body.inventory.feed, 0);
  const fed = r.body.animals.filter(a => Date.parse(a.fedUntil) > Date.now()).length;
  assert.equal(fed, 3);
  assert.equal((await act(w, { action: 'feed', shelter: c.id, all: true })).body.error.code, 'not_enough');
  // 2 more hours: only the 3 fed chickens lay
  await travel(w, 2);
  r = await farm(w);
  assert.equal(r.body.inventory.egg, eggs0 + 6);
  // feed one chosen chicken: the hungriest goes first
  await setInv(w, 'feed', 20);
  r = await act(w, { action: 'feed', shelter: c.id, count: 1 });
  assert.equal(r.body.result.fed, 1);
  // feeding ahead stacks 2 h per feed, at most a day ahead
  for (let i = 0; i < 11; i++) await act(w, { action: 'feed', shelter: c.id, count: 1 });
  r = await act(w, { action: 'feed', shelter: c.id, all: true });
  assert.ok(r.body.animals.every(a => Date.parse(a.fedUntil) <= Date.now() + 24 * 3600e3 + 60e3));
  assert.equal((await act(w, { action: 'feed', shelter: c.id, count: 9 })).body.error.code, 'bad_input');
  assert.equal((await act(w, { action: 'feed', shelter: '00000000-0000-4000-8000-000000000000', all: true })).body.error.code, 'not_found');
});

test('race: two players press "Feed all" at once with feed for one round -> feed never goes below zero', async () => {
  const w = await world();
  const c = await coop(w);
  await act(w, { action: 'buy', item: 'chicken', qty: 4 });
  await travel(w, 3);
  await setInv(w, 'feed', 4);
  const [a, b] = await Promise.all([act(w, { action: 'feed', shelter: c.id, all: true }), act(w, { action: 'feed', shelter: c.id, all: true })]);
  const used = [a, b].reduce((t, x) => t + (x.body.result ? x.body.result.used : 0), 0);
  assert.equal(used, 4, JSON.stringify([a.body.result || a.body.error, b.body.result || b.body.error]));
  assert.equal((await farm(w)).body.inventory.feed, 0);
});

test('race: ₹500, two purchases of ₹300 and ₹396 at the same moment -> only one goes through', async () => {
  const w = await world();
  const [a, b] = await Promise.all([act(w, { action: 'buy', item: 'feed', qty: 150 }), act(w, { action: 'buy', item: 'wood', qty: 66 })]);
  const ok = [a, b].filter(x => x.status === 200), no = [a, b].filter(x => x.body.error);
  assert.equal(ok.length, 1, JSON.stringify([a.body, b.body].map(x => x.error || x.money)));
  assert.equal(no[0].body.error.code, 'not_enough_money');
  const money = Number((await q('SELECT money FROM rooms WHERE code = $1', [w.code]))[0].money);
  assert.ok(money === 200 || money === 104, String(money));
});

test('the same request sent twice (double click / retry) runs once', async () => {
  const w = await world();
  const [a, b] = await Promise.all([act(w, { action: 'buy', item: 'wood', qty: 10 }, w.token, 'same-request-1'), act(w, { action: 'buy', item: 'wood', qty: 10 }, w.token, 'same-request-1')]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal([a, b].filter(x => x.body.replay).length, 1);
  const f = await farm(w);
  assert.equal(f.body.money, 440); assert.equal(f.body.inventory.wood, 10);
});

test('production is counted once, even when the farm is opened from many places at once', async () => {
  const w = await world();
  const c = await coop(w, 3);
  await act(w, { action: 'buy', item: 'chicken', qty: 4 });
  await setInv(w, 'feed', 100);
  for (let i = 0; i < 3; i++) await act(w, { action: 'feed', shelter: c.id, all: true });     // fed for 2 + 6 h
  await travel(w, 6);                                       // 4 chickens × 1 × 6 h = 24 eggs
  await Promise.all([farm(w), farm(w), farm(w), farm(w)]);
  assert.equal((await farm(w)).body.inventory.egg, 24);
});

test('hungry for a day: animals get weak; fed again they recover and lay', async () => {
  const w = await world();
  const c = await coop(w, 1);
  await act(w, { action: 'buy', item: 'chicken', qty: 2 });
  await travel(w, 50);                                      // fed 2 h, then 48 h hungry (weak after 24 h)
  let f = await farm(w);
  assert.ok(f.body.animals.every(a => a.hunger === 100 && a.health < 100 && a.health >= 10), 'starving: ' + JSON.stringify(f.body.animals));
  const eggsBefore = f.body.inventory.egg, weak = f.body.animals[0].health;
  for (let i = 0; i < 4; i++) await act(w, { action: 'feed', shelter: c.id, all: true });       // 8 h of food
  await travel(w, 8);
  f = await farm(w);
  assert.ok(f.body.animals.every(a => a.hunger === 0 && a.health > weak), 'fed: ' + JSON.stringify(f.body.animals));
  assert.ok(f.body.inventory.egg > eggsBefore);
});

test('Desi chickens: locked until the farm has earned enough, their own eggs and prices', async () => {
  const w = await world();
  const c = await coop(w);
  let r = await act(w, { action: 'buy', item: 'chicken_brown', qty: 1 });
  assert.equal(r.body.error.code, 'locked'); assert.match(r.body.error.message, /₹300/);
  await q(`UPDATE rooms SET total_earned = 300, money = 5000 WHERE code = $1`, [w.code]);
  r = await act(w, { action: 'buy', item: 'chicken_brown', qty: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await act(w, { action: 'buy', item: 'chicken_dark', qty: 1 })).body.error.code, 'locked');
  await q(`UPDATE rooms SET total_earned = 1500 WHERE code = $1`, [w.code]);
  r = await act(w, { action: 'buy', item: 'chicken_dark', qty: 1 });
  r = await act(w, { action: 'buy', item: 'chicken', qty: 1 });
  assert.deepEqual(r.body.animals.map(a => a.type).sort(), ['chicken', 'chicken_brown', 'chicken_brown', 'chicken_dark']);
  assert.ok(r.body.animals.every(a => a.shelter === c.id));
  await travel(w, 2);                                       // all fed for these 2 h: one egg an hour each
  r = await farm(w);
  assert.deepEqual([r.body.inventory.egg, r.body.inventory.egg_brown, r.body.inventory.egg_dark], [2, 4, 2]);
  assert.ok(['chicken', 'chicken_brown', 'chicken_dark'].every(k => r.body.catalog[k].rate === 1));
  const before = r.body.money;
  r = await act(w, { action: 'sell', item: 'egg_brown', qty: 4 });
  assert.equal(r.body.money, before + 56);
  r = await act(w, { action: 'sell', item: 'egg_dark', qty: 2 });
  assert.equal(r.body.money, before + 56 + 70); assert.equal(r.body.totalEarned, 1500 + 126);
});

test('storage: level 2 upgrade doubles the limits, costs money + wood + stone, happens once', async () => {
  const w = await world();
  let r = await act(w, { action: 'upgrade', target: 'storage', level: 2 });
  assert.equal(r.body.error.code, 'not_enough'); assert.match(r.body.error.message, /₹100 more money/);
  await q(`UPDATE rooms SET money = 2000 WHERE code = $1`, [w.code]);
  await setInv(w, 'wood', 100); await setInv(w, 'stone', 50);
  const [a, b] = await Promise.all([act(w, { action: 'upgrade', target: 'storage', level: 2 }), act(w, { action: 'upgrade', target: 'storage', level: 2 })]);
  assert.equal([a, b].filter(x => x.status === 200).length, 1);
  assert.equal([a, b].find(x => x.body.error).body.error.code, 'already_upgraded');
  r = await farm(w);
  assert.equal(r.body.storageLevel, 2); assert.equal(r.body.caps.egg, 120); assert.equal(r.body.caps.wood, 1000);
  assert.deepEqual([r.body.money, r.body.inventory.wood, r.body.inventory.stone], [1400, 20, 10]);
  assert.equal((await act(w, { action: 'upgrade', target: 'storage', level: 3 })).body.error.code, 'max_level');
  // the bigger store keeps more eggs
  const c = await coop(w, 5);
  await act(w, { action: 'buy', item: 'chicken', qty: 6 });
  await setInv(w, 'feed', 200);
  for (let i = 0; i < 5; i++) await act(w, { action: 'feed', shelter: c.id, all: true });      // fed for 2 + 10 h
  await travel(w, 12);                                      // 6 × 1 × 12 = 72 eggs (the level-1 store held 60)
  assert.equal((await farm(w)).body.inventory.egg, 72);
});

test('pen gates: open and close for everyone, saved, not in the history', async () => {
  const w = await world();
  const c = await coop(w, 2);
  assert.equal(c.gateOpen, false);
  const o = await act(w, { action: 'gate', shelter: c.id, open: true });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal(o.body.buildings.find(b => b.id === c.id).gateOpen, true);
  assert.equal((await farm(w)).body.buildings.find(b => b.id === c.id).gateOpen, true);
  // two players close it at the same moment: both fine, it ends closed
  const [x, y] = await Promise.all([act(w, { action: 'gate', shelter: c.id, open: false }), act(w, { action: 'gate', shelter: c.id, open: false })]);
  assert.deepEqual([x.status, y.status], [200, 200]);
  assert.equal((await farm(w)).body.buildings.find(b => b.id === c.id).gateOpen, false);
  assert.equal((await act(w, { action: 'gate', shelter: '00000000-0000-4000-8000-000000000000', open: true })).body.error.code, 'not_found');
  const h = await call('GET', `/v1/rooms/${w.code}/farm/history`, undefined, w.token);
  assert.ok(!h.body.history.some(e => /gate/.test(e.message)));
});

test('buying from a shelter\'s panel puts the animal in that shelter', async () => {
  const w = await world();
  await act(w, { action: 'buy', item: 'wood', qty: 40 });
  await act(w, { action: 'build', type: 'coop', plot: 1 });
  const r = await act(w, { action: 'build', type: 'coop', plot: 6 });
  const c6 = r.body.buildings.find(b => b.plot === 6);
  await q(`UPDATE rooms SET money = 500 WHERE code = $1`, [w.code]);
  const x = await act(w, { action: 'buy', item: 'chicken', qty: 2, shelter: c6.id });
  assert.equal(x.status, 200, JSON.stringify(x.body));
  assert.deepEqual(x.body.animals.map(a => a.shelter), [c6.id, c6.id]);
  const y = await act(w, { action: 'buy', item: 'chicken', qty: 1 });
  assert.equal(y.body.animals.filter(a => a.shelter !== c6.id).length, 1);       // no shelter given: the first plot's coop
});

test('storing logs and stones: limits per request and per minute', async () => {
  const w = await world();
  let r = await act(w, { action: 'deposit', items: { wood: 50, stone: 40 } });
  assert.equal(r.status, 200); assert.equal(r.body.inventory.wood, 50); assert.equal(r.body.inventory.stone, 40);
  assert.equal((await act(w, { action: 'deposit', items: { wood: 51 } })).body.error.code, 'bad_input');
  assert.equal((await act(w, { action: 'deposit', items: {} })).body.error.code, 'bad_input');
  assert.equal((await act(w, { action: 'deposit', items: { wood: 50 } })).status, 200);
  assert.equal((await act(w, { action: 'deposit', items: { wood: 50 } })).body.error.code, 'slow_down');
});

test('prices come from the catalog table', async () => {
  const w = await world();
  await q(`UPDATE catalog SET buy_price = 3 WHERE item = 'stone'`);
  const r = await act(w, { action: 'buy', item: 'stone', qty: 10 });
  assert.equal(r.body.money, 470);
  await q(`UPDATE catalog SET buy_price = 8 WHERE item = 'stone'`);
});

test('another world\'s member can\'t touch this farm; deleting the world removes its farm', async () => {
  const a = await world(), b = await world();
  assert.equal((await act(a, { action: 'buy', item: 'feed', qty: 1 }, b.token)).body.error.code, 'not_member');
  await coop(a);
  await act(a, { action: 'buy', item: 'chicken', qty: 1 });
  assert.equal((await call('DELETE', `/v1/rooms/${a.code}`, { confirm: 'Econ Farm' }, a.token)).status, 200);
  assert.equal((await q(`SELECT count(*)::int n FROM animals a LEFT JOIN rooms r ON r.id = a.room_id WHERE r.id IS NULL`))[0].n, 0);
});

test('simulate(): production only while fed; storage limit', () => {
  const cat = { chicken: { product: 'egg', rate: 1 }, egg: { cap: 3 } };
  const t0 = Date.UTC(2026, 0, 1), H = 3600e3;
  const animals = [{ type: 'chicken', health: 100, hunger: 0, progress: 0, fed_until: new Date(t0 + 2 * H) }, { type: 'chicken', health: 100, hunger: 0, progress: 0, fed_until: null }];
  const inv = { egg: 0 };
  simulate(animals, inv, cat, t0, t0 + 5 * H);
  assert.equal(inv.egg, 2);                                  // first chicken fed 2 h, second never
  assert.equal(animals[1].hunger, 100); assert.ok(animals[0].hunger > 0);
  animals[0].fed_until = new Date(t0 + 20 * H);
  simulate(animals, inv, cat, t0 + 5 * H, t0 + 15 * H);
  assert.equal(inv.egg, 3);                                  // storage holds 3
});

test('upgrade from older databases: migration 1 only, 2 with animals and buildings, 3 (live today): eggs every hour', async () => {
  const { MIGRATIONS } = await import('../src/migrations.js');
  for (const upTo of [1, 2, 3]) {
    const name = DB + '_up' + upTo;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
    const u = new URL(ADMIN_URL); u.pathname = '/' + name;
    const p2 = new pg.Pool({ connectionString: u.toString(), max: 4 });
    try {
      await p2.query('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      for (const m of MIGRATIONS.slice(0, upTo)) { await p2.query(m.sql); await p2.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]); }
      const room = (await p2.query(`INSERT INTO rooms (code, name) VALUES ('OLD${upTo}AA', 'Old') RETURNING id`)).rows[0].id;
      if (upTo === 2) {
        const b = (await p2.query(`INSERT INTO buildings (room_id, type, plot, x, z, yaw) VALUES ($1, 'coop', 5, -86, -172, 3.14) RETURNING id`, [room])).rows[0].id;
        await p2.query(`INSERT INTO animals (room_id, type, shelter_id) VALUES ($1, 'chicken', $2)`, [room, b]);
        await p2.query(`INSERT INTO room_transactions (room_id, request_id, kind, money_delta) VALUES ($1, 'r1', 'sell', 42)`, [room]);
      }
      const env2 = { ...env, __pool: p2 };
      const r = await worker.fetch(new Request('http://api.test/v1/health'), env2, {});
      assert.equal(r.status, 200);
      assert.deepEqual((await p2.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map(x => x.id), [1, 2, 3, 4]);
      const rm = (await p2.query('SELECT money, storage_level, total_earned FROM rooms')).rows[0];
      assert.deepEqual([Number(rm.money), rm.storage_level, Number(rm.total_earned)], [500, 1, upTo === 2 ? 42 : 0]);
      if (upTo === 2) {
        const b = (await p2.query('SELECT z FROM buildings')).rows[0];
        assert.equal(b.z, -168);
        const a = (await p2.query('SELECT fed_until > now() AS fed FROM animals')).rows[0];
        assert.equal(a.fed, true);
      }
      const rates = (await p2.query(`SELECT item, (data->>'rate')::float AS rate FROM catalog WHERE item LIKE 'chicken%' ORDER BY item`)).rows;
      assert.deepEqual(rates.map(x => [x.item, x.rate]), [['chicken', 1], ['chicken_brown', 1], ['chicken_dark', 1]]);
    } finally {
      await p2.end();
      const a2 = new pg.Client({ connectionString: ADMIN_URL });
      await a2.connect(); await a2.query(`DROP DATABASE IF EXISTS ${name}`); await a2.end();
    }
  }
});
