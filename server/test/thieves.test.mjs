// Thieves and guard dogs (server/src/thieves.js) against a real Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';
import { THIEVES, thiefStep } from '../src/thieves.js';
import { istDay } from '../src/orders.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
const DB = 'rvthieftest_' + Math.random().toString(36).slice(2, 8);
let pool, env;
before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const u = new URL(ADMIN_URL); u.pathname = '/' + DB;
  pool = new pg.Pool({ connectionString: u.toString(), max: 12 });
  await migrate(pool);
  THIEVES.on = true;
  env = { __pool: pool, SERVER_SECRET: 'test-secret-0123456789', ADMIN_SECRET: 'admin-xyz', RATE_SCALE: 50 };
});
after(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.end();
});

let n = 0, rid = 0;
async function call(method, path, body, token) {
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.2.0.' + (n++ % 250) };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('http://api.test' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
const act = (w, body) => call('POST', `/v1/rooms/${w.code}/farm`, { requestId: `req-${Date.now()}-${++rid}`, ...body }, w.token);
const farm = w => call('GET', `/v1/rooms/${w.code}/farm`, undefined, w.token);
async function world(money = 500) {
  const r = await call('POST', '/v1/rooms', { name: 'Abhi', pin: '1234', world: 'Thief Farm' });
  const w = { code: r.body.room.code, token: r.body.token };
  await farm(w);
  await q('UPDATE rooms SET money = $2 WHERE code = $1', [w.code, money]);
  return w;
}
// let `hours` pass: everything with a time on the farm moves back (production, feeding, the thief on his way, raids, dogs)
async function travel(w, hours) {
  const s = hours * 3600, id = (await q('SELECT id FROM rooms WHERE code = $1', [w.code]))[0].id;
  await q(`UPDATE rooms SET produced_at = produced_at - make_interval(secs => $2), thief_due_at = thief_due_at - make_interval(secs => $2) WHERE id = $1`, [id, s]);
  await q(`UPDATE animals SET fed_until = fed_until - make_interval(secs => $2), born_at = born_at - make_interval(secs => $2) WHERE room_id = $1`, [id, s]);
  await q(`UPDATE farm_dogs SET fed_until = fed_until - make_interval(secs => $2) WHERE room_id = $1`, [id, s]);
  await q(`UPDATE room_members SET created_at = created_at - make_interval(secs => $2) WHERE room_id = $1`, [id, s]);
  await q(`UPDATE farm_thefts SET at = at - make_interval(secs => $2), steal_at = steal_at - make_interval(secs => $2), escape_at = escape_at - make_interval(secs => $2),
      day = ((at - make_interval(secs => $2)) AT TIME ZONE 'Asia/Kolkata')::date WHERE room_id = $1`, [id, s]);
}
async function coopWithHens(w, hens = 6, plot = 0) {
  await act(w, { action: 'buy', item: 'wood', qty: 20 });
  const b = (await act(w, { action: 'build', type: 'coop', plot })).body.buildings.find(x => x.plot === plot);
  await act(w, { action: 'buy', item: 'chicken', qty: hens, shelter: b.id });
  return b;
}
const setReady = (w, n) => q(`UPDATE animals a SET ready = $2 FROM rooms r WHERE r.id = a.room_id AND r.code = $1`, [w.code, n]);
const thefts = async w => (await farm(w)).body.thieves;
const raids = w => q(`SELECT t.* FROM farm_thefts t JOIN rooms r ON r.id = t.room_id WHERE r.code = $1 ORDER BY t.at`, [w.code]);
const waiting = async w => (await farm(w)).body.animals.reduce((t, a) => t + a.ready, 0);

test('catalog: bones ₹5 (4 h), treats ₹25 (24 h), a guard dog ₹1000 (2 at most), training ₹1500 and ₹2000', async () => {
  const w = await world();
  const c = (await farm(w)).body.catalog;
  assert.deepEqual([c.bone.buy, c.bone.dogHours, c.dog_treat.buy, c.dog_treat.dogHours], [5, 4, 25, 24]);
  assert.deepEqual([c.guard_dog.buy, c.guard_dog.max, c.guard_dog.levels.map(l => l.cost || 0)], [1000, 2, [0, 1500, 2000]]);
  const t = await thefts(w);
  assert.deepEqual([t.dogs, t.list, t.dueAt, t.today, t.limit, t.rules.threshold], [[], [], null, 0, 3, 40]);
  assert.equal((await act(w, { action: 'buy', item: 'guard_dog', qty: 1 })).body.error.code, 'bad_item');   // (dogs have their own action)
});

test('no thief while 40 eggs or fewer wait; more than 40 and one notices, comes 8–25 min later', async () => {
  const w = await world();
  await coopWithHens(w, 6);
  await setReady(w, 6);                                     // 36 eggs
  assert.equal((await thefts(w)).dueAt, null);
  await setReady(w, 7);                                     // 42 eggs
  const t = await thefts(w);
  const due = Date.parse(t.dueAt) - Date.now();
  assert.ok(due > 7.5 * 60e3 && due < 25.5 * 60e3, String(due));
  assert.equal((await raids(w)).length, 0);
});

test('eggs collected before he comes: no raid', async () => {
  const w = await world();
  const b = await coopWithHens(w, 6);
  await setReady(w, 8);
  assert.ok((await thefts(w)).dueAt);
  assert.equal((await act(w, { action: 'collect', shelter: b.id })).status, 200);   // 48 eggs -> storage (60)
  await q(`UPDATE animals a SET fed_until = now() - interval '1 hour' FROM rooms r WHERE r.id = a.room_id AND r.code = $1`, [w.code]);   // no new eggs
  await travel(w, 1);
  assert.equal((await raids(w)).length, 0);
  assert.equal((await thefts(w)).dueAt, null);
});

test('nobody playing: a thief takes 30–80 % of the waiting eggs from the fullest coop; at most 3 a day, 90 min apart', async () => {
  const w = await world();
  const b = await coopWithHens(w, 6);
  await setReady(w, 20);                                    // 120 eggs
  await thefts(w);                                          // he notices
  await travel(w, 0.5);
  const before = 120, after1 = await waiting(w);
  const [r1] = await raids(w);
  assert.equal(r1.status, 'stolen'); assert.equal(r1.shelter_id, b.id); assert.equal(r1.dog_level, 0);
  const took = r1.taken.egg;
  assert.ok(took >= 0.3 * before - 1 && took <= 0.8 * before + 1, String(took));
  assert.equal(r1.wanted, took); assert.equal(r1.saved, 0);
  assert.ok(after1 >= before - took);                        // (the hens laid a few more meanwhile)
  // a whole day away with full nests: never more than 3 raids in one India-time day, 90 min apart
  await q(`UPDATE animals a SET fed_until = now() + interval '30 hours' FROM rooms r WHERE r.id = a.room_id AND r.code = $1`, [w.code]);
  await travel(w, 30);
  await farm(w);
  const all = await raids(w), perDay = {};
  for (const x of all) perDay[x.day.toISOString().slice(0, 10)] = (perDay[x.day.toISOString().slice(0, 10)] || 0) + 1;
  assert.ok(all.length >= 4, String(all.length));
  assert.ok(Object.values(perDay).every(k => k <= 3), JSON.stringify(perDay));
  for (let i = 1; i < all.length; i++) assert.ok(all[i].at - all[i - 1].at >= 90 * 60e3 - 1000);
  // the report: newest first, seen later by this member
  const t = await thefts(w);
  assert.equal(t.list[0].id, all[all.length - 1].id);
  assert.ok(Date.parse(t.seenAt) < Date.parse(t.list[0].at));
  assert.equal((await act(w, { action: 'seen' })).status, 200);
  assert.ok(Date.parse((await thefts(w)).seenAt) > Date.parse(t.list[0].at));
  const h = await call('GET', `/v1/rooms/${w.code}/farm/history`, undefined, w.token);
  assert.ok(!h.body.history.some(x => x.kind === 'seen'));
});

test('guard dogs: buy (₹1000, 2 at most), feed a bone (+4 h) or a treat (+24 h), at most 2 days ahead, train in order', async () => {
  const w = await world(7000);
  let r = await act(w, { action: 'dog', op: 'buy' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.money, 6000);
  const d = r.body.thieves.dogs[0];
  assert.equal(d.level, 1); assert.ok(Math.abs(Date.parse(d.fedUntil) - Date.now() - 4 * 3600e3) < 60e3);
  assert.equal((await act(w, { action: 'dog', op: 'buy' })).status, 200);
  assert.equal((await act(w, { action: 'dog', op: 'buy' })).body.error.code, 'max_dogs');
  assert.equal((await act(w, { action: 'dog', op: 'feed', dog: d.id, food: 'bone' })).body.error.code, 'not_enough');
  await act(w, { action: 'buy', item: 'bone', qty: 3 }); await act(w, { action: 'buy', item: 'dog_treat', qty: 2 });
  r = await act(w, { action: 'dog', op: 'feed', dog: d.id, food: 'bone' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.inventory.bone, 2);
  assert.ok(Math.abs(Date.parse(r.body.thieves.dogs[0].fedUntil) - Date.now() - 8 * 3600e3) < 60e3);
  r = await act(w, { action: 'dog', op: 'feed', dog: d.id, food: 'dog_treat' });
  assert.ok(Math.abs(Date.parse(r.body.thieves.dogs[0].fedUntil) - Date.now() - 32 * 3600e3) < 60e3);
  assert.equal((await act(w, { action: 'dog', op: 'feed', dog: d.id, food: 'dog_treat' })).body.error.code, 'already_fed');
  assert.equal((await act(w, { action: 'dog', op: 'train', dog: d.id, level: 3 })).body.error.code, 'in_order');
  r = await act(w, { action: 'dog', op: 'train', dog: d.id, level: 2 });
  assert.equal(r.body.money, 6000 - 1000 - 15 - 50 - 1500); assert.equal(r.body.thieves.dogs[0].level, 2);
  assert.equal((await act(w, { action: 'dog', op: 'train', dog: d.id, level: 2 })).body.error.code, 'already_upgraded');
  r = await act(w, { action: 'dog', op: 'train', dog: d.id, level: 3 });
  assert.equal(r.body.thieves.dogs[0].level, 3); assert.equal(r.body.money, 6000 - 1000 - 15 - 50 - 1500 - 2000);
  assert.equal((await act(w, { action: 'dog', op: 'train', dog: d.id, level: 3 })).body.error.code, 'already_upgraded');
  assert.match((await call('GET', `/v1/rooms/${w.code}/farm/history`, undefined, w.token)).body.history[0].message, /trained guard dog 1 to level 3 for ₹2000/);
});

test('dogs on duty: level 1 saves 40 %, level 3 saves 95–100 % and only one raid a day; a hungry dog saves nothing', async () => {
  for (const [level, lo, hi, fed] of [[1, 0.4, 0.4, true], [3, 0.95, 1, true], [3, 0, 0, false]]) {
    const w = await world(9000);
    await coopWithHens(w, 6);
    const id = (await act(w, { action: 'dog', op: 'buy' })).body.thieves.dogs[0].id;
    for (let l = 2; l <= level; l++) await act(w, { action: 'dog', op: 'train', dog: id, level: l });
    await q(`UPDATE farm_dogs SET fed_until = ${fed ? "now() + interval '40 hours'" : "now() - interval '1 hour'"} WHERE id = $1`, [id]);
    await q(`UPDATE animals a SET fed_until = now() + interval '40 hours' FROM rooms r WHERE r.id = a.room_id AND r.code = $1`, [w.code]);
    await setReady(w, 20);
    await thefts(w);
    await travel(w, 20);
    await farm(w);
    const all = await raids(w);
    assert.ok(all.length >= 1);
    for (const x of all) {
      assert.equal(x.dog_level, fed ? level : 0);
      const cut = x.saved / x.wanted;
      assert.ok(cut >= lo - 0.03 && cut <= hi + 0.03, `level ${level}: saved ${x.saved} of ${x.wanted}`);
      assert.equal(x.status, x.saved === x.wanted ? 'scared' : 'stolen');
    }
    if (level === 3 && fed) { const days = new Set(all.map(x => x.day.toISOString())); assert.equal(all.length, days.size); }
  }
});

test('a live thief: caught with the net -> everything back with 10 % more, once; too late after he escapes', async () => {
  const w = await world();
  await coopWithHens(w, 6);
  await setReady(w, 20);
  await thefts(w);
  await q(`UPDATE rooms SET thief_due_at = now() - interval '5 seconds' WHERE code = $1`, [w.code]);
  let t = await thefts(w);
  const live = t.list.find(x => x.status === 'live');
  assert.ok(live, JSON.stringify(t.list));
  assert.ok(Date.parse(live.escapeAt) - Date.parse(live.at) > 60e3);
  const took = live.taken.egg;
  let r = await act(w, { action: 'catch', theft: live.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.inventory.egg, Math.min(60, took + Math.ceil(took * 0.1)));
  assert.equal(r.body.result.bonus, Math.ceil(took * 0.1));
  assert.match(r.body.message, /Abhi caught the thief! Got back/);
  assert.equal(r.body.thieves.list[0].status, 'caught'); assert.equal(r.body.thieves.list[0].caughtBy, 'Abhi');
  assert.equal((await act(w, { action: 'catch', theft: live.id })).body.error.code, 'already_caught');
  // another one, who gets away
  await setReady(w, 20);
  await q(`UPDATE farm_thefts t SET at = at - interval '3 hours', steal_at = steal_at - interval '3 hours', escape_at = escape_at - interval '3 hours' FROM rooms r WHERE r.id = t.room_id AND r.code = $1`, [w.code]);
  await q(`UPDATE rooms SET thief_due_at = now() - interval '5 seconds' WHERE code = $1`, [w.code]);
  t = await thefts(w);
  const second = t.list.find(x => x.status === 'live');
  assert.ok(second);
  await q(`UPDATE farm_thefts SET escape_at = now() - interval '10 seconds' WHERE id = $1`, [second.id]);
  assert.equal((await act(w, { action: 'catch', theft: second.id })).body.error.code, 'got_away');
  assert.equal((await thefts(w)).list.find(x => x.id === second.id).status, 'stolen');
});

test('thiefStep(): wanted share, the dogs\' cut, the fullest coop first', () => {
  const cat = { chicken: { nest: 24, product: 'egg' }, guard_dog: { levels: [{ level: 1, cut: [0.4, 0.4], raids: 3 }, { level: 2, cut: [0.7, 0.7], raids: 2 }, { level: 3, cut: [0.95, 1], raids: 1 }] } };
  const hens = () => [{ type: 'chicken', shelter_id: 'a', ready: 10 }, { type: 'chicken', shelter_id: 'b', ready: 24 }, { type: 'chicken', shelter_id: 'b', ready: 20 }];
  const half = () => 0.5;
  const now = Date.parse('2026-11-05T06:00:00Z');
  const ctx = { dogs: [], counts: new Map(), last: -Infinity, due: now, due0: now, raids: [] };
  const a = hens();
  thiefStep(ctx, a, cat, now, now + 3600e3, half);
  const x = ctx.raids[0];
  assert.equal(x.want, 30);                                 // 55 % of 54
  assert.equal(x.shelter, 'b'); assert.deepEqual(x.taken, { egg: 30 }); assert.equal(x.status, 'stolen');
  assert.deepEqual(a.map(h => h.ready), [10, 0, 14]);       // the fullest nest in the fullest coop first
  // a level-2 dog on duty saves 70 %; and that was the day's limit for level 2 after two raids
  const ctx2 = { dogs: [{ level: 2, fu: now + 9e7 }], counts: new Map([[istDay(now), 1]]), last: -Infinity, due: now, due0: now, raids: [] };
  thiefStep(ctx2, hens(), cat, now, now, half);
  assert.equal(ctx2.raids[0].want, 30); assert.equal(ctx2.raids[0].got, 9); assert.equal(ctx2.raids[0].saved, 21); assert.equal(ctx2.raids[0].status, 'live');
  thiefStep(ctx2, hens(), cat, now + 4 * 3600e3, now, half);
  assert.equal(ctx2.due, null);                             // 2 raids today with a level-2 dog: no more
});
