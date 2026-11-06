// Crop fields, scarecrows and outfits (server/src/fields.js) against a real Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';
import { THIEVES } from '../src/thieves.js';
import { birdShare } from '../src/fields.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
const DB = 'rvfieldtest_' + Math.random().toString(36).slice(2, 8);
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
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.3.0.' + (n++ % 250) };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('http://api.test' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
const act = (w, body) => call('POST', `/v1/rooms/${w.code}/farm`, { requestId: `req-${Date.now()}-${++rid}`, ...body }, w.token);
const farm = w => call('GET', `/v1/rooms/${w.code}/farm`, undefined, w.token);
async function world(money = 5000) {
  const r = await call('POST', '/v1/rooms', { name: 'Abhi', pin: '1234', world: 'Wheat Farm' });
  const w = { code: r.body.room.code, token: r.body.token };
  await farm(w);
  await q('UPDATE rooms SET money = $2 WHERE code = $1', [w.code, money]);
  return w;
}
const field = (b, slot) => b.fields.list.find(f => f.slot === slot);
// time passes for one field: sowing started / grown earlier
const back = (w, slot, col, secs) => q(`UPDATE farm_fields SET ${col} = ${col} - make_interval(secs => $3) FROM rooms r WHERE r.id = farm_fields.room_id AND r.code = $1 AND slot = $2`, [w.code, slot, secs]);

test('a field: buy, sow (seeds used, not too fast), water, grow 2 hours, harvest into storage', async () => {
  const w = await world();
  let r = await act(w, { action: 'field', op: 'buy', slot: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.money, 4500);
  assert.equal(field(r.body, 2).stage, 'empty');
  assert.equal((await act(w, { action: 'field', op: 'buy', slot: 2 })).body.error.code, 'field_taken');
  assert.equal((await act(w, { action: 'field', op: 'sowstart', slot: 0 })).body.error.code, 'not_owned');
  // no seeds yet
  assert.equal((await act(w, { action: 'field', op: 'sowstart', slot: 2 })).body.error.code, 'no_seeds');
  r = await act(w, { action: 'buy', item: 'wheat_seeds', qty: 2 });
  assert.equal(r.body.inventory.wheat_seeds, 2); assert.equal(r.body.money, 4480);
  r = await act(w, { action: 'field', op: 'sowstart', slot: 2 });
  assert.equal(field(r.body, 2).stage, 'sowing');
  assert.equal((await act(w, { action: 'field', op: 'sow', slot: 2 })).body.error.code, 'too_fast');
  await back(w, 2, 'sow_started_at', 10);
  r = await act(w, { action: 'field', op: 'sow', slot: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(field(r.body, 2).stage, 'sown'); assert.equal(r.body.inventory.wheat_seeds, 1);
  assert.equal((await act(w, { action: 'field', op: 'harvest', slot: 2 })).body.error.code, 'nothing');
  r = await act(w, { action: 'field', op: 'water', slot: 2 });
  assert.equal(r.body.money, 4460);
  const f = field(r.body, 2);
  assert.equal(f.stage, 'growing');
  assert.ok(Math.abs(Date.parse(f.readyAt) - Date.parse(f.wateredAt) - 2 * 3600e3) < 2000);
  assert.equal((await act(w, { action: 'field', op: 'harvest', slot: 2 })).body.error.code, 'not_ready');
  await back(w, 2, 'ready_at', 2 * 3600 + 5);
  r = await act(w, { action: 'field', op: 'harvest', slot: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = r.body.inventory.wheat;
  assert.ok(got >= 350 && got <= 450, `no scarecrow: 350–450 wheat, got ${got}`);
  assert.equal(field(r.body, 2).stage, 'empty');
  assert.equal(r.body.caps.wheat, 1000);
});

test('scarecrows: level 1 then 2 (full harvest); the birds\' share by level', async () => {
  const w = await world();
  await act(w, { action: 'field', op: 'buy', slot: 0 });
  assert.equal((await act(w, { action: 'field', op: 'scarecrow', slot: 0, level: 2 })).body.error.code, 'need_scarecrow');
  let r = await act(w, { action: 'field', op: 'scarecrow', slot: 0, level: 1 });
  assert.equal(r.body.money, 4000); assert.equal(field(r.body, 0).scarecrow, 1);
  r = await act(w, { action: 'field', op: 'scarecrow', slot: 0, level: 2 });
  assert.equal(r.body.money, 3200); assert.equal(field(r.body, 0).scarecrow, 2);
  assert.equal((await act(w, { action: 'field', op: 'scarecrow', slot: 0, level: 2 })).body.error.code, 'already_upgraded');
  await act(w, { action: 'buy', item: 'wheat_seeds', qty: 1 });
  await act(w, { action: 'field', op: 'sowstart', slot: 0 });
  await back(w, 0, 'sow_started_at', 10);
  await act(w, { action: 'field', op: 'sow', slot: 0 });
  await act(w, { action: 'field', op: 'water', slot: 0 });
  await back(w, 0, 'ready_at', 7300);
  r = await act(w, { action: 'field', op: 'harvest', slot: 0 });
  assert.equal(r.body.inventory.wheat, 500);
  // the share left after the birds, by scarecrow level
  const cat = { scarecrow: { none: [0.7, 0.9], levels: [{ level: 1, share: [0.8, 0.9] }, { level: 2, share: [1, 1] }] } };
  for (let i = 0; i < 50; i++) {
    const a = birdShare(cat, 0) * 500, b = birdShare(cat, 1) * 500;
    assert.ok(a >= 350 && a <= 450); assert.ok(b >= 400 && b <= 450);
  }
  assert.equal(birdShare(cat, 2) * 500, 500);
});

test('a full storage: the rest of the harvest waits in the field; the storage level raises the limit by 500', async () => {
  const w = await world();
  const id = (await q('SELECT id FROM rooms WHERE code = $1', [w.code]))[0].id;
  await q(`INSERT INTO inventory (room_id, item, qty) VALUES ($1, 'wheat', 900) ON CONFLICT (room_id, item) DO UPDATE SET qty = 900`, [id]);
  await act(w, { action: 'field', op: 'buy', slot: 5 });
  await act(w, { action: 'field', op: 'scarecrow', slot: 5, level: 1 });
  await act(w, { action: 'field', op: 'scarecrow', slot: 5, level: 2 });
  await act(w, { action: 'buy', item: 'wheat_seeds', qty: 1 });
  await act(w, { action: 'field', op: 'sowstart', slot: 5 });
  await back(w, 5, 'sow_started_at', 10);
  await act(w, { action: 'field', op: 'sow', slot: 5 });
  await act(w, { action: 'field', op: 'water', slot: 5 });
  await back(w, 5, 'ready_at', 7300);
  let r = await act(w, { action: 'field', op: 'harvest', slot: 5 });
  assert.equal(r.body.inventory.wheat, 1000);
  const f = field(r.body, 5);
  assert.equal(f.stage, 'growing'); assert.equal(f.yield, 500); assert.equal(f.harvested, 100);
  assert.equal((await act(w, { action: 'field', op: 'harvest', slot: 5 })).body.error.code, 'storage_full');
  await q('UPDATE rooms SET storage_level = 2 WHERE id = $1', [id]);
  r = await act(w, { action: 'field', op: 'harvest', slot: 5 });
  assert.equal(r.body.caps.wheat, 1500); assert.equal(r.body.inventory.wheat, 1400);
  assert.equal(field(r.body, 5).stage, 'empty');
});

test('outfits: bought with the farm\'s money, worn by the buyer; the scarecrow isn\'t sold as goods', async () => {
  const w = await world(1500);
  assert.equal((await act(w, { action: 'buy', item: 'scarecrow', qty: 1 })).body.error.code, 'bad_item');
  assert.equal((await act(w, { action: 'outfit', op: 'wear', item: 'farmer_outfit' })).body.error.code, 'not_owned');
  let r = await act(w, { action: 'outfit', op: 'buy', item: 'farmer_outfit' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.money, 500);
  assert.deepEqual(r.body.fields.wardrobe, { owned: ['farmer_outfit'], wearing: 'farmer_outfit' });
  assert.equal((await act(w, { action: 'outfit', op: 'buy', item: 'farmer_outfit' })).body.error.code, 'owned');
  r = await act(w, { action: 'outfit', op: 'off' });
  assert.equal(r.body.fields.wardrobe.wearing, null);
  r = await act(w, { action: 'outfit', op: 'wear', item: 'farmer_outfit' });
  assert.equal(r.body.fields.wardrobe.wearing, 'farmer_outfit');
});
