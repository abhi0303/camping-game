// Farm economy tests (money, goods, shelters, animals, offline production) against a real Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';
import { simulate } from '../src/farm.js';
import { CHICKENS, withAnimalConfig } from '../src/animals.js';
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
const ready = async w => (await farm(w)).body.animals.reduce((t, a) => t + a.ready, 0);
const emptyNests = w => q(`UPDATE animals a SET ready = 0 FROM rooms r WHERE r.id = a.room_id AND r.code = $1`, [w.code]);
async function addMember(w, name, pin = '5555') {
  const inv = await call('POST', `/v1/rooms/${w.code}/invites`, {}, w.token);
  const j = await call('POST', `/v1/rooms/${w.code}/join`, { invite: inv.body.invite, name, pin });
  assert.equal(j.status, 201, JSON.stringify(j.body));
  return { code: w.code, token: j.body.token };
}
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

test('the farm loop: coop, chickens arrive fed for 2 h, eggs wait in the nests, collect them, sell them', async () => {
  const w = await world();
  assert.equal((await act(w, { action: 'buy', item: 'chicken', qty: 1 })).body.error.code, 'no_shelter');
  let r = await act(w, { action: 'build', type: 'coop', plot: 0 });
  assert.equal(r.body.error.code, 'not_enough'); assert.match(r.body.error.message, /20 more wood/);
  const c = await coop(w);
  assert.equal(c.type, 'coop');
  assert.equal((await act(w, { action: 'buy', item: 'chicken', qty: 7 })).body.error.code, 'no_space');
  r = await act(w, { action: 'buy', item: 'chicken', qty: 6 });
  assert.equal(r.body.money, 500 - 120 - 100 - 240); assert.equal(r.body.animals.length, 6);
  assert.ok(r.body.animals.every(a => a.shelter === c.id && a.health === 100 && a.ready === 0 && Date.parse(a.fedUntil) > Date.now() + 7000e3));
  assert.equal((await act(w, { action: 'collect', shelter: c.id })).body.error.code, 'nothing_ready');
  // 10 hours pass: fed for the first 2 h only -> each chicken lays an egg every 5 minutes = 24 eggs, a full nest
  await travel(w, 10);
  r = await farm(w);
  assert.ok(r.body.animals.every(a => a.ready === 24 && a.hunger > 0 && a.health === 100), JSON.stringify(r.body.animals[0]));
  assert.equal(r.body.inventory.egg, 0); assert.equal(r.body.inventory.feed, 20);           // nothing eaten by itself
  // collect: the store holds 60 eggs, the other 84 wait in the nests
  r = await act(w, { action: 'collect', shelter: c.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.inventory.egg, r.body.result.total, r.body.result.full], [60, 60, true]);
  assert.match(r.body.message, /Abhi collected 60 white eggs — storage full/);
  assert.equal(r.body.animals.reduce((t, a) => t + a.ready, 0), 84);
  r = await act(w, { action: 'sell', item: 'egg', qty: 60 });
  assert.equal(r.body.money, 40 + 60); assert.equal(r.body.totalEarned, 60);
  assert.equal((await act(w, { action: 'sell', item: 'egg', qty: 1 })).body.error.code, 'not_enough');
  assert.equal((await act(w, { action: 'collect', shelter: c.id })).body.result.total, 60);
  assert.equal((await act(w, { action: 'sell', item: 'feed', qty: 1 })).body.error.code, 'bad_item');
  assert.equal((await act(w, { action: 'buy', item: 'coop', qty: 1 })).body.error.code, 'bad_item');
  assert.equal((await act(w, { action: 'buy', item: 'feed', qty: -3 })).body.error.code, 'bad_input');
  assert.equal((await act(w, { action: 'collect', shelter: 'nope' })).body.error.code, 'bad_input');
  const h = await call('GET', `/v1/rooms/${w.code}/farm/history`, undefined, w.token);
  assert.match(h.body.history[1].message, /Abhi sold 60 white eggs for ₹60/);
});

test('feeding: 1 feed per chicken for 2 h, feed some, not enough feed, already fed, timers move', async () => {
  const w = await world();
  const c = await coop(w);
  await act(w, { action: 'buy', item: 'chicken', qty: 4 });
  await travel(w, 3);                                       // fed 2 h, hungry for 1 h
  assert.equal(await ready(w), 4 * 24);
  await emptyNests(w);
  await setInv(w, 'feed', 3);
  let r = await act(w, { action: 'feed', shelter: c.id, all: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.result.fed, r.body.result.wanted, r.body.result.used, r.body.result.short], [3, 4, 3, true]);
  assert.match(r.body.message, /fed 3 regular white chickens \(3 feed\) — not enough feed for the other 1/);
  assert.equal(r.body.inventory.feed, 0);
  const fed = r.body.animals.filter(a => Date.parse(a.fedUntil) > Date.now());
  assert.equal(fed.length, 3);
  assert.ok(fed.every(a => Math.abs(Date.parse(a.fedUntil) - Date.now() - 2 * 3600e3) < 60e3));    // 2 h from now
  assert.equal((await act(w, { action: 'feed', shelter: c.id, all: true })).body.error.code, 'not_enough');
  // 1 more hour: only the 3 fed chickens lay (12 eggs each); the hungry one waits with an empty nest
  await travel(w, 1);
  r = await farm(w);
  assert.deepEqual(r.body.animals.map(a => a.ready).sort((x, y) => x - y), [0, 12, 12, 12]);
  // feed one chosen chicken: the hungriest goes first
  await setInv(w, 'feed', 20);
  r = await act(w, { action: 'feed', shelter: c.id, count: 1 });
  assert.equal(r.body.result.fed, 1);
  assert.ok(r.body.animals.every(a => Date.parse(a.fedUntil) > Date.now()));
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
  await travel(w, 1.5);                                     // 4 chickens × 12 an hour × 1.5 h = 72 eggs
  await Promise.all([farm(w), farm(w), farm(w), farm(w)]);
  assert.equal(await ready(w), 72);
});

test('hungry for a day: animals get weak; fed again they recover and lay', async () => {
  const w = await world();
  const c = await coop(w, 1);
  await act(w, { action: 'buy', item: 'chicken', qty: 2 });
  await travel(w, 50);                                      // fed 2 h, then 48 h hungry (weak after 24 h)
  let f = await farm(w);
  assert.ok(f.body.animals.every(a => a.hunger === 100 && a.health < 100 && a.health >= 10 && a.ready === 24), 'starving: ' + JSON.stringify(f.body.animals));
  const weak = f.body.animals[0].health;
  assert.equal((await act(w, { action: 'collect', shelter: c.id })).body.result.total, 48);
  for (let i = 0; i < 4; i++) await act(w, { action: 'feed', shelter: c.id, all: true });       // 8 h of food
  await travel(w, 8);
  f = await farm(w);
  assert.ok(f.body.animals.every(a => a.hunger === 0 && a.health > weak && a.ready > 0), 'fed: ' + JSON.stringify(f.body.animals));
});

test('three varieties: Brown Desi and Black are locked until the farm has earned enough; 5 / 7 / 9 minutes, own eggs and prices', async () => {
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
  const k = r.body.catalog;
  assert.deepEqual(['chicken', 'chicken_brown', 'chicken_dark'].map(x => [k[x].variety, k[x].eggMinutes, k[x].feedMinutes, k[x].feedCost, k[x].nest]),
    [['Regular White', 5, 120, 1, 24], ['Brown Desi', 7, 120, 1, 24], ['Black', 9, 120, 1, 24]]);
  assert.equal(k.chicken.rate, 12);
  await travel(w, 1);                                       // all fed: 60/5 = 12, 60/7 = 8.6 -> 8, 60/9 = 6.7 -> 6
  r = await act(w, { action: 'collect', shelter: c.id });
  assert.deepEqual([r.body.inventory.egg, r.body.inventory.egg_brown, r.body.inventory.egg_dark], [12, 16, 6]);
  assert.deepEqual(r.body.animals.map(a => a.ready), [0, 0, 0, 0]);
  // each keeps its own part-made egg: the Brown Desi ones are 4/7 of the way to the next
  assert.ok(r.body.animals.filter(a => a.type === 'chicken_brown').every(a => a.progress > 0.5 && a.progress < 0.65), JSON.stringify(r.body.animals));
  const before = r.body.money;
  r = await act(w, { action: 'sell', item: 'egg_brown', qty: 16 });
  assert.equal(r.body.money, before + 48);
  r = await act(w, { action: 'sell', item: 'egg_dark', qty: 6 });
  assert.equal(r.body.money, before + 48 + 42); assert.equal(r.body.totalEarned, 1500 + 90);
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
  await travel(w, 2);                                       // 6 full nests = 144 eggs (the level-1 store held 60)
  r = await act(w, { action: 'collect', shelter: c.id });
  assert.deepEqual([r.body.inventory.egg, r.body.result.full], [120, true]);
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

test('upgrade from older databases: migration 1 only, 2 with animals and buildings, 3, 4 (live today) -> nests, fishing', async () => {
  const { MIGRATIONS } = await import('../src/migrations.js');
  for (const upTo of [1, 2, 3, 4]) {
    const name = DB + '_up' + upTo;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
    const u = new URL(ADMIN_URL); u.pathname = '/' + name;
    const p2 = new pg.Pool({ connectionString: u.toString(), max: 4 });
    try {
      await p2.query('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      for (const m of MIGRATIONS.slice(0, upTo)) { await p2.query(m.sql); await p2.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]); }
      const room = (await p2.query(`INSERT INTO rooms (code, name) VALUES ('OLD${upTo}AA', 'Old') RETURNING id`)).rows[0].id;
      if (upTo >= 2) {
        const b = (await p2.query(`INSERT INTO buildings (room_id, type, plot, x, z, yaw) VALUES ($1, 'coop', 5, -86, ${upTo === 2 ? -172 : -168}, 3.14) RETURNING id`, [room])).rows[0].id;
        await p2.query(`INSERT INTO animals (room_id, type, shelter_id) VALUES ($1, 'chicken', $2)`, [room, b]);
        await p2.query(`INSERT INTO room_transactions (room_id, request_id, kind, money_delta) VALUES ($1, 'r1', 'sell', 42)`, [room]);
      }
      // eggs in storage before the price drop: their old value is paid out (10 × (₹6 − ₹1) + 2 × (₹35 − ₹7))
      if (upTo === 4) await p2.query(`INSERT INTO inventory (room_id, item, qty) VALUES ($1, 'egg', 10), ($1, 'egg_dark', 2)`, [room]);
      const env2 = { ...env, __pool: p2 };
      const r = await worker.fetch(new Request('http://api.test/v1/health'), env2, {});
      assert.equal(r.status, 200);
      assert.deepEqual((await p2.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map(x => x.id), [1, 2, 3, 4, 5]);
      const rm = (await p2.query('SELECT money, storage_level, total_earned FROM rooms')).rows[0];
      assert.deepEqual([Number(rm.money), rm.storage_level, Number(rm.total_earned)], [upTo === 4 ? 500 + 50 + 56 : 500, 1, upTo === 2 ? 42 : 0]);
      if (upTo >= 2) {
        assert.equal((await p2.query('SELECT z FROM buildings')).rows[0].z, -168);
        assert.equal((await p2.query('SELECT ready FROM animals')).rows[0].ready, 0);
      }
      const cat = Object.fromEntries((await p2.query(`SELECT item, name, kind, sell_price, buy_price FROM catalog`)).rows.map(x => [x.item, x]));
      assert.deepEqual(['egg', 'egg_brown', 'egg_dark', 'fish_small', 'fish_medium', 'fish_large'].map(x => cat[x].sell_price), [1, 3, 7, 2, 5, 14]);
      assert.deepEqual([cat.chicken.name, cat.chicken_dark.name, cat.worm_pack.buy_price, cat.rod.kind], ['Regular White chicken', 'Black chicken', 1, 'gear']);
      assert.equal((await p2.query('SELECT rod_level FROM room_members')).rows.length, 0);
      assert.equal((await p2.query('SELECT count(*)::int AS n FROM fishing_casts')).rows[0].n, 0);
    } finally {
      await p2.end();
      const a2 = new pg.Client({ connectionString: ADMIN_URL });
      await a2.connect(); await a2.query(`DROP DATABASE IF EXISTS ${name}`); await a2.end();
    }
  }
});


/* ---------- chickens: timers, nests, collecting ---------- */
const chickenCat = () => ({
  chicken: withAnimalConfig('chicken', { product: 'egg' }), chicken_brown: withAnimalConfig('chicken_brown', { product: 'egg_brown' }),
  chicken_dark: withAnimalConfig('chicken_dark', { product: 'egg_dark' }), egg: { cap: 60 }, egg_brown: { cap: 60 }, egg_dark: { cap: 60 },
});
const hen = (type, fedMin, progress = 0, t0 = 0) => ({ type, health: 100, hunger: 0, progress, ready: 0, fed_until: fedMin == null ? null : new Date(t0 + fedMin * 60e3) });

test('chickens: one egg every 5 / 7 / 9 minutes, from the central animal config', () => {
  assert.deepEqual(Object.values(CHICKENS).map(c => c.eggMinutes), [5, 7, 9]);
  const cat = chickenCat(), t0 = Date.UTC(2026, 0, 1), M = 60e3;
  const hens = [hen('chicken', 120, 0, t0), hen('chicken_brown', 120, 0, t0), hen('chicken_dark', 120, 0, t0)];
  const inv = {};
  const at = min => { simulate(hens, inv, cat, t0 + at.last * M, t0 + min * M); at.last = min; return hens.map(h => h.ready); };
  at.last = 0;
  assert.deepEqual(at(4.9), [0, 0, 0]);
  assert.deepEqual(at(5.01), [1, 0, 0]);
  assert.deepEqual(at(7.01), [1, 1, 0]);
  assert.deepEqual(at(9.01), [1, 1, 1]);
  assert.deepEqual(at(63.01), [12, 9, 7]);
  assert.deepEqual(inv, {});                                // eggs wait in the nests, not in storage
});

test('chickens: every chicken has its own timer; the shortest one is next', () => {
  const cat = chickenCat(), t0 = Date.UTC(2026, 0, 1), M = 60e3;
  // bought at different times: one is 80 % of the way to its egg, one 10 %
  const hens = [hen('chicken', 120, 0.8, t0), hen('chicken', 120, 0.1, t0), hen('chicken_dark', 120, 0.5, t0)];
  simulate(hens, {}, cat, t0, t0 + 1.1 * M);                // 1.1 min = 0.22 of a white egg
  assert.deepEqual(hens.map(h => h.ready), [1, 0, 0]);
  assert.ok(Math.abs(hens[0].progress - 0.02) < 1e-6 && Math.abs(hens[1].progress - 0.32) < 1e-6, JSON.stringify(hens));
  assert.ok(Math.abs(hens[2].progress - (0.5 + 1.1 / 9)) < 1e-6);
});

test('chickens: an unfed chicken lays nothing, feeding runs out, a full nest stops laying', () => {
  const cat = chickenCat(), t0 = Date.UTC(2026, 0, 1), H = 3600e3;
  const hens = [hen('chicken', null, 0, t0), hen('chicken', 10, 0, t0), hen('chicken', 24 * 60, 0, t0)];
  const inv = {};
  simulate(hens, inv, cat, t0, t0 + 10 * H);                // 10 h away
  assert.deepEqual(hens.map(h => h.ready), [0, 2, 24]);     // never fed · fed 10 min · nest full after 2 h
  assert.equal(hens[0].hunger, 100);
  assert.ok(hens[2].progress < 1);                          // no half-made eggs pile up behind a full nest
  hens[2].ready = 0;                                        // collected
  simulate(hens, inv, cat, t0 + 10 * H, t0 + 10 * H + 10 * 60e3);
  assert.equal(hens[2].ready, 2);                           // laying again
});

test('offline: a week away never makes more than a full nest per chicken; storage untouched', async () => {
  const w = await world();
  const c = await coop(w);
  await act(w, { action: 'buy', item: 'chicken', qty: 3 });
  await setInv(w, 'feed', 100);
  for (let i = 0; i < 11; i++) await act(w, { action: 'feed', shelter: c.id, all: true });    // fed a whole day ahead
  await travel(w, 24 * 3);                                  // 3 days away: fed for the first day only
  let f = await farm(w);
  assert.ok(f.body.animals.every(a => a.ready === 24 && a.hunger === 100), JSON.stringify(f.body.animals));
  assert.equal(f.body.inventory.egg, 0);
  assert.equal(f.body.inventory.feed, 100 - 3 * 11);         // feed is only used when a player feeds
  await travel(w, 24 * 9);                                  // and much longer: still one full nest each
  f = await farm(w);
  assert.ok(f.body.animals.every(a => a.ready === 24));
});

test('collect: two players press Collect at the same moment -> every egg is collected once', async () => {
  const w = await world(), p2 = await addMember(w, 'Rahul');
  const c = await coop(w);
  await act(w, { action: 'buy', item: 'chicken', qty: 3 });
  await travel(w, 0.5);                                     // 3 × 6 eggs
  const [a, b] = await Promise.all([act(w, { action: 'collect', shelter: c.id }), act(p2, { action: 'collect', shelter: c.id })]);
  const ok = [a, b].filter(x => x.status === 200);
  assert.equal(ok.length, 1, JSON.stringify([a.body.error, b.body.error]));
  assert.equal([a, b].find(x => x.body.error).body.error.code, 'nothing_ready');
  assert.equal(ok[0].body.result.total, 18);
  const f = await farm(w);
  assert.equal(f.body.inventory.egg, 18); assert.equal(await ready(w), 0);
  // the same request again (retry) does not collect twice
  await travel(w, 0.5);
  const x = await act(w, { action: 'collect', shelter: c.id }, w.token, 'collect-once-1');
  const y = await act(w, { action: 'collect', shelter: c.id }, w.token, 'collect-once-1');
  assert.equal(x.body.result.total, 18); assert.equal(y.body.replay, true);
  assert.equal((await farm(w)).body.inventory.egg, 36);
});

/* ---------- fishing ---------- */
import { startChallenge, step, runChallenge, rollCast, RODS, FISH } from '../../js/fishing/sim.js';
// a good player: pulls on the bite, lets go while the fish fights, pulls while it is tired
function play(spec) {
  const s = startChallenge(spec), log = [];
  let last = 0;
  while (!s.done) {
    const v = s.phase === 'hook' || (s.phase === 'tired' && s.tension < 0.9) ? 1 : 0;
    if (v !== last) { log.push([s.t, v]); last = v; }
    step(s, !!v);
  }
  return { log, ms: s.t };
}
const lastCast = w => q(`SELECT f.* FROM fishing_casts f JOIN rooms r ON r.id = f.room_id WHERE r.code = $1 ORDER BY cast_at DESC LIMIT 1`, [w.code]).then(r => r[0]);
// make the last cast a sure bite of `fish` that bit `agoMs` ago
const rig = (id, fish, pulls, agoMs = 60e3) => q(`UPDATE fishing_casts SET fish = $2, pulls = $3, weight = 1.5, bite_at = now() - make_interval(secs => $4::int / 1000.0) WHERE id = $1`, [id, fish, pulls, agoMs]);

test('fishing: rods decide what can bite — large fish only on the Level 3 rod', () => {
  let x = 7; const rand = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const seen = { 1: {}, 2: {}, 3: {} };
  for (const rod of [1, 2, 3]) for (let i = 0; i < 3000; i++) { const r = rollCast(rod, rand); seen[rod][r.fish || 'none'] = (seen[rod][r.fish || 'none'] || 0) + 1; }
  assert.ok(!seen[1].fish_large && !seen[2].fish_large && seen[3].fish_large > 400, JSON.stringify(seen));
  assert.ok(seen[1].none > 300 && seen[1].fish_medium > 300);              // not every cast gets a bite
  for (const f of Object.keys(FISH)) for (let i = 0; i < 200; i++) {
    const r = rollCast(3, rand);
    if (r.fish) { assert.ok(r.biteMs >= 3000 && r.biteMs <= 10000); assert.ok(r.pulls >= FISH[r.fish].pulls[0] - 1 && r.pulls <= FISH[r.fish].pulls[1]); }
  }
  // the mini-game: a good player lands each fish; always pulling snaps the line; never pulling misses the bite
  for (const rod of [1, 2, 3]) for (const fish of Object.keys(RODS[rod].odds)) for (let seed = 1; seed < 40; seed++) {
    const spec = { seed: seed * 977, fish, rod, pulls: FISH[fish].pulls[1] };
    const r = runChallenge(spec, play(spec).log);
    assert.ok(r.ok && r.pulls === spec.pulls, `${rod} ${fish} ${seed} ${r.why}`);
    assert.equal(runChallenge(spec, [[0, 1]]).why, 'snap');
    assert.equal(runChallenge(spec, []).why, 'missed');
  }
});

test('fishing: worms (10 for ₹1), casting takes one worm, a played catch lands the fish once', async () => {
  const w = await world();
  let r = await act(w, { action: 'cast', spot: 0 });
  assert.equal(r.body.error.code, 'no_worms'); assert.match(r.body.error.message, /You need worms to start fishing/);
  r = await act(w, { action: 'buy', item: 'worm_pack', qty: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.money, r.body.inventory.worms], [499, 10]);
  assert.equal(r.body.fishing.rod, 1);
  assert.equal((await act(w, { action: 'cast', spot: 99 })).body.error.code, 'bad_input');
  r = await act(w, { action: 'cast', spot: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.inventory.worms, 9);
  const d = r.body.result;
  assert.ok(d.cast && d.rod === 1 && d.spot === 1 && d.giveUpAt);
  // claiming the catch at once (before the fish could have been played) fails, and the worm is gone
  await rig(d.cast, 'fish_medium', 4, -5000);               // bites 5 s from now
  const spec = { seed: (await lastCast(w)).seed, fish: 'fish_medium', rod: 1, pulls: 4 };
  const good = play(spec);
  r = await act(w, { action: 'reel', cast: d.cast, log: good.log });
  assert.deepEqual([r.body.result.caught, r.body.result.why], [false, 'too_fast']);
  assert.equal(r.body.inventory.fish_medium, 0); assert.equal(r.body.inventory.worms, 9);
  assert.equal((await act(w, { action: 'reel', cast: d.cast, log: good.log })).body.error.code, 'already_done');
  // a real one: cast, the fish bit a minute ago, the log lands it
  const c2 = (await act(w, { action: 'cast', spot: 1 })).body.result;
  await rig(c2.cast, 'fish_medium', 4);
  const spec2 = { seed: (await lastCast(w)).seed, fish: 'fish_medium', rod: 1, pulls: 4 };
  const log2 = play(spec2).log;
  const [a, b] = await Promise.all([act(w, { action: 'reel', cast: c2.cast, log: log2 }), act(w, { action: 'reel', cast: c2.cast, log: log2 })]);
  const won = [a, b].filter(x => x.status === 200);
  assert.equal(won.length, 1, JSON.stringify([a.body, b.body].map(x => x.error || x.result)));
  assert.deepEqual([won[0].body.result.caught, won[0].body.result.fish, won[0].body.result.value], [true, 'fish_medium', 5]);
  assert.equal([a, b].find(x => x.body.error).body.error.code, 'already_done');
  r = await farm(w);
  assert.deepEqual([r.body.inventory.fish_medium, r.body.inventory.worms], [1, 8]);
  assert.deepEqual([r.body.fishing.caught.fish_medium, r.body.fishing.mine], [1, 1]);
  // sell it at the Fish Market price
  r = await act(w, { action: 'sell', item: 'fish_medium', qty: 1 });
  assert.equal(r.body.money, 499 + 5);
  assert.equal((await act(w, { action: 'sell', item: 'fish_medium', qty: 1 })).body.error.code, 'not_enough');
  // only the catch is in the history, not the casts
  const h = await call('GET', `/v1/rooms/${w.code}/farm/history`, undefined, w.token);
  assert.ok(!h.body.history.some(e => e.kind === 'cast'));
  assert.equal(h.body.history.filter(e => e.kind === 'reel').length, 1);
  assert.match(h.body.history[1].message, /Abhi caught a medium fish/);
});

test('fishing: a faked or badly played log loses the fish (and the worm); nothing biting; one line per player', async () => {
  const w = await world(), p2 = await addMember(w, 'Rahul');
  await setInv(w, 'worms', 6);
  // always pulling: the line snaps
  let c = (await act(w, { action: 'cast', spot: 0 })).body.result;
  await rig(c.cast, 'fish_small', 2);
  let r = await act(w, { action: 'reel', cast: c.cast, log: [[0, 1]] });
  assert.deepEqual([r.body.result.caught, r.body.result.why], [false, 'snap']);
  // a made-up log ("caught a large fish") on a cast that rolled a small fish -> replayed as the small fish, and
  // a large fish can't be claimed at all: the server only knows what it rolled
  c = (await act(w, { action: 'cast', spot: 0 })).body.result;
  await rig(c.cast, 'fish_small', 2);
  r = await act(w, { action: 'reel', cast: c.cast, fish: 'fish_large', log: [[0, 1], [300, 0], [5000, 1], [9000, 0]] });
  assert.equal(r.body.result.caught, false);
  assert.equal(r.body.inventory.fish_large, 0);
  assert.equal((await act(w, { action: 'reel', cast: c.cast, log: 'caught' })).body.error.code, 'already_done');
  c = (await act(w, { action: 'cast', spot: 0 })).body.result;
  assert.equal((await act(w, { action: 'reel', cast: c.cast, log: [[5, 1], [2, 0]] })).body.error.code, 'bad_input');
  // nothing bit: the cast ends with nothing
  await q(`UPDATE fishing_casts SET fish = NULL, bite_at = NULL WHERE id = $1`, [c.cast]);
  r = await act(w, { action: 'reel', cast: c.cast, log: [] });
  assert.deepEqual([r.body.result.caught, r.body.result.why], [false, 'nothing']);
  // someone else's cast can't be reeled in by you
  c = (await act(w, { action: 'cast', spot: 2 })).body.result;
  assert.equal((await act(p2, { action: 'reel', cast: c.cast, log: [] })).body.error.code, 'not_found');
  // a new cast gives up your older open line; the other player fishes at the same time without trouble
  const c2 = (await act(w, { action: 'cast', spot: 2 })).body.result;
  assert.equal((await q('SELECT status FROM fishing_casts WHERE id = $1', [c.cast]))[0].status, 'escaped');
  const o = (await act(p2, { action: 'cast', spot: 1 })).body.result;
  assert.ok(o && o.cast);
  assert.equal((await q('SELECT status FROM fishing_casts WHERE id = $1', [c2.cast]))[0].status, 'open');
  assert.equal((await farm(w)).body.inventory.worms, 0);
  assert.equal((await act(w, { action: 'cast', spot: 0 })).body.error.code, 'no_worms');
  // too late: a bite more than 3 minutes ago can't be claimed
  await setInv(w, 'worms', 1);
  c = (await act(w, { action: 'cast', spot: 0 })).body.result;
  await rig(c.cast, 'fish_small', 2, 200e3);
  const spec = { seed: (await lastCast(w)).seed, fish: 'fish_small', rod: 1, pulls: 2 };
  r = await act(w, { action: 'reel', cast: c.cast, log: play(spec).log });
  assert.deepEqual([r.body.result.caught, r.body.result.why], [false, 'timeout']);
});

test('fishing rods: buy Level 2 then Level 3 with the farm money, in order, once each; your own rod', async () => {
  const w = await world(), p2 = await addMember(w, 'Rahul');
  assert.equal((await act(w, { action: 'rod', level: 3 })).body.error.code, 'locked');
  assert.equal((await act(w, { action: 'rod', level: 1 })).body.error.code, 'bad_input');
  const [a, b] = await Promise.all([act(w, { action: 'rod', level: 2 }), act(w, { action: 'rod', level: 2 })]);
  assert.equal([a, b].filter(x => x.status === 200).length, 1);
  assert.equal([a, b].find(x => x.body.error).body.error.code, 'already_owned');
  let r = await farm(w);
  assert.deepEqual([r.body.money, r.body.fishing.rod], [350, 2]);
  assert.equal((await farm(p2)).body.fishing.rod, 1);       // each player has their own rod
  r = await act(w, { action: 'rod', level: 3 });
  assert.equal(r.body.error.code, 'not_enough_money'); assert.match(r.body.error.message, /₹500/);
  await q(`UPDATE rooms SET money = 600 WHERE code = $1`, [w.code]);
  r = await act(w, { action: 'rod', level: 3 });
  assert.deepEqual([r.status, r.body.money, r.body.fishing.rod], [200, 100, 3]);
  assert.match(r.body.message, /Abhi bought the Advanced Fibre Rod for ₹500/);
  // the new rod is used for the next cast (and its large fish land)
  await setInv(w, 'worms', 1);
  const c = (await act(w, { action: 'cast', spot: 0 })).body.result;
  assert.equal(c.rod, 3);
  await rig(c.cast, 'fish_large', 6);
  const spec = { seed: (await lastCast(w)).seed, fish: 'fish_large', rod: 3, pulls: 6 };
  r = await act(w, { action: 'reel', cast: c.cast, log: play(spec).log });
  assert.deepEqual([r.body.result.caught, r.body.result.value, r.body.inventory.fish_large], [true, 14, 1]);
});
