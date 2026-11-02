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
const setInv = (w, item, qty) => q(`INSERT INTO inventory (room_id, item, qty) SELECT id, $2, $3 FROM rooms WHERE code = $1 ON CONFLICT (room_id, item) DO UPDATE SET qty = EXCLUDED.qty`, [w.code, item, qty]);

test('a new farm: ₹500, 20 feed, the catalog and 8 plots', async () => {
  const w = await world();
  const f = await farm(w);
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.money, 500); assert.equal(f.body.inventory.feed, 20); assert.equal(f.body.inventory.egg, 0);
  assert.equal(f.body.plots, 8); assert.deepEqual(f.body.buildings, []); assert.deepEqual(f.body.animals, []);
  assert.equal(f.body.catalog.chicken.buy, 40); assert.equal(f.body.catalog.coop.capacity, 6);
  // opening it again does not hand out the starting goods twice
  assert.equal((await farm(w)).body.inventory.feed, 20);
  assert.equal((await call('GET', `/v1/rooms/${w.code}/farm`)).body.error.code, 'login_needed');
});

test('the farm loop: buy wood, build a coop, buy chickens, eggs while away, sell them', async () => {
  const w = await world();
  let r = await act(w, { action: 'buy', item: 'chicken', qty: 1 });
  assert.equal(r.body.error.code, 'no_shelter');
  r = await act(w, { action: 'build', type: 'coop', plot: 0 });
  assert.equal(r.body.error.code, 'not_enough'); assert.match(r.body.error.message, /20 more wood/);
  r = await act(w, { action: 'buy', item: 'wood', qty: 20 });
  assert.equal(r.body.money, 380); assert.equal(r.body.inventory.wood, 20);
  r = await act(w, { action: 'build', type: 'coop', plot: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.money, 280); assert.equal(r.body.inventory.wood, 0);
  assert.deepEqual([r.body.buildings[0].type, r.body.buildings[0].plot, r.body.buildings[0].x, r.body.buildings[0].z], ['coop', 0, PLOTS[0].x, PLOTS[0].z]);
  assert.equal((await act(w, { action: 'build', type: 'coop', plot: 0 })).body.error.code, 'plot_taken');
  assert.equal((await act(w, { action: 'build', type: 'coop', plot: 8 })).body.error.code, 'bad_input');
  assert.equal((await act(w, { action: 'buy', item: 'chicken', qty: 7 })).body.error.code, 'no_space');
  r = await act(w, { action: 'buy', item: 'chicken', qty: 6 });
  assert.equal(r.body.money, 40); assert.equal(r.body.animals.length, 6);
  assert.ok(r.body.animals.every(a => a.shelter === r.body.buildings[0].id && a.health === 100));
  // 10 hours away: 6 chickens × 0.5 eggs/h = 30 eggs, eating 6 × 0.25 × 10 = 15 feed
  await back(w, 10);
  r = await farm(w);
  assert.equal(r.body.inventory.egg, 30); assert.equal(r.body.inventory.feed, 5);
  r = await act(w, { action: 'sell', item: 'egg', qty: 30 });
  assert.equal(r.body.money, 40 + 180); assert.equal(r.body.inventory.egg, 0);
  assert.equal((await act(w, { action: 'sell', item: 'egg', qty: 1 })).body.error.code, 'not_enough');
  assert.equal((await act(w, { action: 'sell', item: 'feed', qty: 1 })).body.error.code, 'bad_item');
  assert.equal((await act(w, { action: 'buy', item: 'coop', qty: 1 })).body.error.code, 'bad_item');
  assert.equal((await act(w, { action: 'buy', item: 'feed', qty: -3 })).body.error.code, 'bad_input');
  assert.equal((await act(w, { action: 'buy', item: 'feed', qty: 1.5 })).body.error.code, 'bad_input');
  // the history names who did what
  const h = await call('GET', `/v1/rooms/${w.code}/farm/history`, undefined, w.token);
  assert.match(h.body.history[0].message, /Abhi sold 30 eggs for ₹180/); assert.equal(h.body.history[0].money, 180);
});

test('race: ₹500, two purchases of ₹300 and ₹400 at the same moment -> only one goes through', async () => {
  const w = await world();
  const [a, b] = await Promise.all([act(w, { action: 'buy', item: 'feed', qty: 150 }), act(w, { action: 'buy', item: 'wood', qty: 66 })]);   // ₹300 and ₹396
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
  assert.equal((await q(`SELECT count(*)::int n FROM room_transactions t JOIN rooms r ON r.id = t.room_id WHERE r.code = $1`, [w.code]))[0].n, 1);
});

test('production is counted once, even when the farm is opened from many places at once', async () => {
  const w = await world();
  await act(w, { action: 'buy', item: 'wood', qty: 20 });
  await act(w, { action: 'build', type: 'coop', plot: 3 });
  await act(w, { action: 'buy', item: 'chicken', qty: 4 });
  await setInv(w, 'feed', 100);
  await back(w, 6);                                         // 4 chickens × 0.5 × 6 h = 12 eggs
  await Promise.all([farm(w), farm(w), farm(w), farm(w)]);
  const f = await farm(w);
  assert.equal(f.body.inventory.egg, 12); assert.equal(f.body.inventory.feed, 94);
});

test('hungry animals stop producing and get weak; fed again they recover', async () => {
  const w = await world();
  await act(w, { action: 'buy', item: 'wood', qty: 20 });
  await act(w, { action: 'build', type: 'coop', plot: 1 });
  await act(w, { action: 'buy', item: 'chicken', qty: 2 });
  await setInv(w, 'feed', 0);
  await back(w, 48);
  let f = await farm(w);
  assert.equal(f.body.inventory.egg, 0);
  assert.ok(f.body.animals.every(a => a.hunger === 100 && a.health < 100 && a.health >= 10), 'starving: ' + JSON.stringify(f.body.animals));
  const weak = f.body.animals[0].health;
  await setInv(w, 'feed', 50);
  await back(w, 8);                                         // health climbs back 10/h, eggs follow
  f = await farm(w);
  assert.ok(f.body.animals.every(a => a.hunger === 0 && a.health > weak), 'fed: ' + JSON.stringify(f.body.animals));
  assert.ok(f.body.inventory.egg >= 1);
});

test('storage limit and the one-week cap on time away', async () => {
  const w = await world();
  await act(w, { action: 'buy', item: 'wood', qty: 20 });
  await act(w, { action: 'build', type: 'coop', plot: 2 });
  await act(w, { action: 'buy', item: 'chicken', qty: 6 });
  await setInv(w, 'feed', 500);
  await back(w, 24 * 30);                                   // a month away: only a week is counted
  const f = await farm(w);
  assert.equal(f.body.inventory.egg, 60);                   // the egg store holds 60
  assert.equal(f.body.inventory.feed, 500 - 6 * 0.25 * 168);
});

test('storing logs and stones: limits per request and per minute', async () => {
  const w = await world();
  let r = await act(w, { action: 'deposit', items: { wood: 50, stone: 40 } });
  assert.equal(r.status, 200); assert.equal(r.body.inventory.wood, 50); assert.equal(r.body.inventory.stone, 40);
  assert.deepEqual([r.body.result.wood, r.body.result.stone], [50, 40]);
  assert.equal((await act(w, { action: 'deposit', items: { wood: 51 } })).body.error.code, 'bad_input');
  assert.equal((await act(w, { action: 'deposit', items: {} })).body.error.code, 'bad_input');
  assert.equal((await act(w, { action: 'deposit', items: { wood: 50 } })).status, 200);
  assert.equal((await act(w, { action: 'deposit', items: { wood: 50 } })).body.error.code, 'slow_down');   // 190 in a minute
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
  await act(a, { action: 'buy', item: 'wood', qty: 20 });
  await act(a, { action: 'build', type: 'coop', plot: 0 });
  await act(a, { action: 'buy', item: 'chicken', qty: 1 });
  assert.equal((await call('DELETE', `/v1/rooms/${a.code}`, { confirm: 'Econ Farm' }, a.token)).status, 200);
  const left = await q(`SELECT (SELECT count(*)::int FROM buildings b LEFT JOIN rooms r ON r.id = b.room_id WHERE r.id IS NULL) AS orphans`);
  assert.equal(left[0].orphans, 0);
});

test('simulate(): half the feed needed -> half the production, then hunger', () => {
  const cat = { chicken: { feed: 1, product: 'egg', rate: 1 }, egg: { cap: 100 } };
  const animals = [{ type: 'chicken', health: 100, hunger: 0, progress: 0 }, { type: 'chicken', health: 100, hunger: 0, progress: 0 }];
  const inv = { feed: 2, egg: 0 };
  const out = simulate(animals, inv, 0, cat, 2);           // 2 h × 2 chickens need 4 feed, only 2 there
  assert.equal(inv.feed, 0); assert.equal(out.feedEaten, 0);
  assert.equal(inv.egg, 2);                                  // first hour fully fed: 1 egg each
  assert.ok(animals.every(a => a.hunger > 0));
});

test('upgrade: a database with only migration 1 and an existing world gets the farm tables on the first request', async () => {
  const { MIGRATIONS } = await import('../src/migrations.js');
  const name = DB + '_up';
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
  const u = new URL(ADMIN_URL); u.pathname = '/' + name;
  const p2 = new pg.Pool({ connectionString: u.toString(), max: 4 });
  try {
    await p2.query('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await p2.query(MIGRATIONS[0].sql);
    await p2.query(`INSERT INTO schema_migrations (id, name) VALUES (1, 'rooms_members_invites')`);
    // a world made by the phase-2 server
    const env2 = { ...env, __pool: p2 };
    const send = (method, path, body, token) => worker.fetch(new Request('http://api.test' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) }), env2, {}).then(async r => ({ status: r.status, body: await r.json() }));
    const made = await send('POST', '/v1/rooms', { name: 'Old', pin: '1234', world: 'Old Farm' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const f = await send('GET', `/v1/rooms/${made.body.room.code}/farm`, undefined, made.body.token);
    assert.equal(f.status, 200, JSON.stringify(f.body));
    assert.equal(f.body.money, 500); assert.equal(f.body.inventory.feed, 20);
    assert.deepEqual((await p2.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r => r.id), [1, 2]);
  } finally {
    await p2.end();
    const a2 = new pg.Client({ connectionString: ADMIN_URL });
    await a2.connect(); await a2.query(`DROP DATABASE IF EXISTS ${name}`); await a2.end();
  }
});
