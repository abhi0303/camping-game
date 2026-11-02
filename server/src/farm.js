// Farm economy: the world's shared money and goods, shelters, animals and what they produce.
// Every change runs in one transaction with the world's row locked, so two players buying at the
// same moment can never spend the same money twice. Prices and rules come from the catalog table.
// Animal production is counted lazily: whenever the farm is opened or changed, the time since
// produced_at (database clock) is simulated and produced_at moves forward in the same transaction.
import { ApiError, badInput, json, rateLimit, readJson } from './http.js';
import { rows, tx } from './db.js';
import { member } from './rooms.js';
import { PLOTS } from './layout.js';

const MAX_OFFLINE_H = 24 * 7;          // production is counted for at most a week of absence
const START_GOODS = { feed: 20 };      // a new farm starts with ₹500 (column default) and some feed
const HUNGER_PER_H = 100 / 24;         // an unfed animal is starving after a day
const EAT_PER_H = 50, HEAL_PER_H = 10, SICK_PER_H = 5, MIN_HEALTH = 10;   // animals get weak, never die
const REQ_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DEPOSIT_MAX = 50, DEPOSIT_PER_MIN = 150;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;

/* ---------- reading ---------- */
async function catalog(c) {
  const list = await c.rows('SELECT item, kind, name, icon, buy_price, sell_price, data FROM catalog ORDER BY sort, item');
  return Object.fromEntries(list.map(r => [r.item, { ...r.data, kind: r.kind, name: r.name, icon: r.icon, buy: r.buy_price, sell: r.sell_price }]));
}
async function invMap(c, roomId) {
  const inv = {};
  for (const r of await c.rows('SELECT item, qty FROM inventory WHERE room_id = $1', [roomId])) inv[r.item] = Number(r.qty);
  return inv;
}
async function writeInv(c, roomId, items, inv) {
  const keys = [...new Set(items)];
  if (!keys.length) return;
  await c.rows(`INSERT INTO inventory (room_id, item, qty) SELECT $1, unnest($2::text[]), unnest($3::bigint[])
      ON CONFLICT (room_id, item) DO UPDATE SET qty = EXCLUDED.qty`, [roomId, keys, keys.map(k => inv[k] || 0)]);
}

/* ---------- production ---------- */
// Simulate `hours` of farm life in steps of at most an hour. Animals share the feed store; fed animals
// heal and produce (scaled by health); unfed ones get hungry, then weak. Products go into storage up to
// its limit; the rest is lost. Mutates animals and inv; returns the eaten part of the next feed unit.
export function simulate(animals, inv, feedEaten, cat, hours) {
  const steps = Math.max(1, Math.ceil(hours - 1e-9)), h = hours / steps;
  let feed = Math.max(0, (inv.feed || 0) - feedEaten);
  const made = {};
  for (const a of animals) { a.fed = false; a.made = false; }
  for (let s = 0; s < steps; s++) {
    let need = 0;
    for (const a of animals) need += (cat[a.type].feed || 0) * h;
    const f = need > 1e-12 ? Math.min(1, feed / need) : 1;
    feed = Math.max(0, feed - need * f);
    for (const a of animals) {
      const k = cat[a.type];
      if (f > 0) a.fed = true;
      if (f >= 0.999) { a.hunger = Math.max(0, a.hunger - EAT_PER_H * h); a.health = Math.min(100, a.health + HEAL_PER_H * h); }
      else {
        a.hunger = clamp(a.hunger + (1 - f) * HUNGER_PER_H * h - f * EAT_PER_H * h, 0, 100);
        if (a.hunger >= 100) a.health = Math.max(MIN_HEALTH, a.health - SICK_PER_H * h);
        else a.health = Math.min(100, a.health + HEAL_PER_H * h * f);
      }
      if (k.product && k.rate) a.progress += k.rate * h * f * (a.health / 100);
    }
    for (const a of animals) {
      const p = cat[a.type].product, whole = p ? Math.floor(a.progress + 1e-9) : 0;
      if (whole < 1) continue;
      const take = Math.min(whole, Math.max(0, (cat[p].cap ?? Infinity) - (inv[p] || 0)));
      if (take > 0) { inv[p] = (inv[p] || 0) + take; made[p] = (made[p] || 0) + take; a.made = true; }
      a.progress = Math.max(0, a.progress - whole);
    }
  }
  const qty = Math.max(0, Math.ceil(feed - 1e-9));
  inv.feed = qty;
  return { made, feedEaten: Math.max(0, Math.min(qty - feed, 0.999999)) };
}

// Bring the farm up to now. Must run inside a transaction; locks the world's row.
async function settle(c, roomId, cat) {
  const r = await c.one('SELECT money, econ_rev, produced_at, feed_eaten, now() AS now FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
  const inv = await invMap(c, roomId), dirty = [];
  let changed = false, feedEaten = r.feed_eaten;
  if (r.econ_rev === 0) {                                  // first time this farm is opened: starting goods
    for (const [k, n] of Object.entries(START_GOODS)) { inv[k] = (inv[k] || 0) + n; dirty.push(k); }
    changed = true;
  }
  const hours = Math.min(MAX_OFFLINE_H, Math.max(0, (r.now - r.produced_at) / 3600e3));
  if (hours > 0) {
    const animals = await c.rows('SELECT id, type, health, hunger, progress FROM animals WHERE room_id = $1 ORDER BY born_at, id', [roomId]);
    if (animals.length) {
      const out = simulate(animals, inv, feedEaten, cat, hours);
      feedEaten = out.feedEaten;
      dirty.push('feed', ...Object.keys(out.made));
      await c.rows(`UPDATE animals a SET health = v.health, hunger = v.hunger, progress = v.progress,
          last_fed_at = CASE WHEN v.fed THEN $7 ELSE a.last_fed_at END,
          last_production_at = CASE WHEN v.made THEN $7 ELSE a.last_production_at END
          FROM unnest($1::uuid[], $2::real[], $3::real[], $4::float8[], $5::bool[], $6::bool[]) AS v(id, health, hunger, progress, fed, made)
          WHERE a.id = v.id`,
      [animals.map(a => a.id), animals.map(a => a.health), animals.map(a => a.hunger), animals.map(a => a.progress), animals.map(a => a.fed), animals.map(a => a.made), r.now]);
      changed = true;
    }
  }
  await writeInv(c, roomId, dirty, inv);
  await c.rows('UPDATE rooms SET produced_at = $2, feed_eaten = $3, econ_rev = econ_rev + $4 WHERE id = $1', [roomId, r.now, feedEaten, changed ? 1 : 0]);
  return { money: Number(r.money), rev: r.econ_rev + (changed ? 1 : 0), now: r.now, inv, feedEaten };
}

async function state(c, roomId, cat, s) {
  const blds = await c.rows('SELECT id, type, plot, level, x, z, yaw FROM buildings WHERE room_id = $1 ORDER BY plot', [roomId]);
  const ans = await c.rows('SELECT id, type, shelter_id, health, hunger, progress, born_at FROM animals WHERE room_id = $1 ORDER BY born_at, id', [roomId]);
  const inventory = {};
  for (const [k, v] of Object.entries(cat)) if (v.kind === 'good') inventory[k] = s.inv[k] || 0;
  return {
    rev: s.rev, money: s.money, at: s.now.toISOString(), feedEaten: r1(s.feedEaten),
    inventory,
    buildings: blds.map(b => ({ id: b.id, type: b.type, plot: b.plot, level: b.level, x: b.x, z: b.z, yaw: b.yaw })),
    animals: ans.map(a => ({ id: a.id, type: a.type, shelter: a.shelter_id, health: r1(a.health), hunger: r1(a.hunger), progress: Math.round(a.progress * 100) / 100, born: a.born_at })),
    catalog: cat, plots: PLOTS.length,
  };
}

/* ---------- requests ---------- */
export async function farmState(req, env, db, code) {
  rateLimit(req, 'farmget', 120, 60e3, env);
  const me = await member(db, req, code);
  return tx(db, async c => {
    const cat = await catalog(c);
    const s = await settle(c, me.room_id, cat);
    return json(await state(c, me.room_id, cat, s));
  });
}

export async function farmHistory(req, env, db, code) {
  const me = await member(db, req, code);
  const list = await rows(db, `SELECT t.kind, t.detail, t.money_delta, t.created_at, m.name FROM room_transactions t
      LEFT JOIN room_members m ON m.id = t.member_id WHERE t.room_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT 30`, [me.room_id]);
  return json({ history: list.map(x => ({ kind: x.kind, who: x.name || 'A former member', message: x.detail.message || '', money: Number(x.money_delta), at: x.created_at })) });
}

// one action: { requestId, action: buy | sell | build | deposit, ... }. A retried requestId returns
// the result of the first try instead of running again.
export async function farmAct(req, env, db, code) {
  rateLimit(req, 'farmact', 120, 60e3, env);
  const b = await readJson(req, 4096);
  const me = await member(db, req, code);
  const rid = String(b.requestId || '');
  if (!REQ_RE.test(rid)) throw badInput('Missing request id');
  const fn = ACTIONS[b.action];
  if (!fn) throw badInput('Unknown farm action');
  return tx(db, async c => {
    const cat = await catalog(c);
    const s = await settle(c, me.room_id, cat);
    const dup = await c.one('SELECT detail FROM room_transactions WHERE room_id = $1 AND request_id = $2', [me.room_id, rid]);
    if (dup) return json({ ok: true, replay: true, message: dup.detail.message || '', result: dup.detail, ...(await state(c, me.room_id, cat, s)) });
    const out = await fn(c, { me, b, cat, s });
    await writeInv(c, me.room_id, out.items || [], s.inv);
    // the CHECK (money >= 0) constraint backs up the checks in the actions
    if (out.money) await c.rows('UPDATE rooms SET money = money + $2 WHERE id = $1', [me.room_id, out.money]);
    s.money += out.money || 0;
    const detail = { ...out.detail, message: out.message };
    await c.rows(`INSERT INTO room_transactions (room_id, member_id, request_id, kind, detail, money_delta) VALUES ($1, $2, $3, $4, $5, $6)`,
      [me.room_id, me.id, rid, b.action, JSON.stringify(detail), out.money || 0]);
    await c.rows('UPDATE rooms SET econ_rev = econ_rev + 1 WHERE id = $1', [me.room_id]);
    s.rev++;
    return json({ ok: true, message: out.message, result: detail, ...(await state(c, me.room_id, cat, s)) });
  });
}

/* ---------- actions ---------- */
function whole(v, lo, hi, what = 'Amount') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw badInput(`${what} must be a whole number from ${lo} to ${hi}.`);
  return n;
}
const lower = s => s.toLowerCase();

async function buy(c, { me, b, cat, s }) {
  const item = String(b.item || ''), k = cat[item];
  if (!k || !k.buy || k.kind === 'building') throw new ApiError(400, 'bad_item', 'That can\'t be bought at the market.');
  const qty = whole(b.qty, 1, k.kind === 'animal' ? 12 : 500);
  const cost = k.buy * qty;
  if (s.money < cost) throw new ApiError(409, 'not_enough_money', `Not enough money: ${qty} × ${k.name} costs ₹${cost}, the farm has ₹${s.money}.`);
  if (k.kind === 'animal') {
    const home = cat[k.shelter];
    const sh = await c.rows(`SELECT b.id, (SELECT count(*)::int FROM animals a WHERE a.shelter_id = b.id) AS n
        FROM buildings b WHERE b.room_id = $1 AND b.type = $2 ORDER BY b.plot`, [me.room_id, k.shelter]);
    if (!sh.length) throw new ApiError(409, 'no_shelter', `${k.name}s need a ${lower(home.name)}. Build one on a farm plot first.`);
    const free = sh.reduce((t, x) => t + Math.max(0, home.capacity - x.n), 0);
    if (free < qty) throw new ApiError(409, 'no_space', free ? `Only ${free} free place${free > 1 ? 's' : ''} for ${lower(k.name)}s. Build another ${lower(home.name)} for more.` : `Every ${lower(home.name)} is full. Build another one for more ${lower(k.name)}s.`);
    const homes = [];
    for (const x of sh) for (let i = x.n; i < home.capacity && homes.length < qty; i++) homes.push(x.id);
    await c.rows('INSERT INTO animals (room_id, type, shelter_id, last_fed_at) SELECT $1, $2, unnest($3::uuid[]), now()', [me.room_id, item, homes]);
    return { money: -cost, detail: { item, qty, cost }, message: `${me.name} bought ${qty} ${qty === 1 ? lower(k.name) : lower(k.name) + 's'} for ₹${cost}` };
  }
  const have = s.inv[item] || 0, cap = k.cap ?? Infinity;
  if (have + qty > cap) throw new ApiError(409, 'storage_full', `The farm can keep at most ${cap} ${lower(k.name)} (it has ${have}).`);
  s.inv[item] = have + qty;
  return { money: -cost, items: [item], detail: { item, qty, cost }, message: `${me.name} bought ${qty} ${lower(k.name)} for ₹${cost}` };
}

async function sell(c, { me, b, s, cat }) {
  const item = String(b.item || ''), k = cat[item];
  if (!k || !k.sell) throw new ApiError(400, 'bad_item', 'The market doesn\'t buy that.');
  const qty = whole(b.qty, 1, 100000);
  const have = s.inv[item] || 0;
  if (qty > have) throw new ApiError(409, 'not_enough', `The farm only has ${have} ${lower(k.name)}.`);
  s.inv[item] = have - qty;
  const pay = k.sell * qty;
  return { money: pay, items: [item], detail: { item, qty, pay }, message: `${me.name} sold ${qty} ${lower(k.name)} for ₹${pay}` };
}

async function build(c, { me, b, s, cat }) {
  const type = String(b.type || ''), k = cat[type];
  if (!k || k.kind !== 'building') throw new ApiError(400, 'bad_item', 'Unknown building.');
  const plot = whole(b.plot, 0, PLOTS.length - 1, 'Plot');
  if (await c.one('SELECT 1 FROM buildings WHERE room_id = $1 AND plot = $2', [me.room_id, plot])) throw new ApiError(409, 'plot_taken', 'Something is already built on that plot.');
  const wood = k.wood || 0, stone = k.stone || 0, cost = k.buy || 0;
  const miss = [];
  if (s.money < cost) miss.push(`₹${cost - s.money} more money`);
  if ((s.inv.wood || 0) < wood) miss.push(`${wood - (s.inv.wood || 0)} more wood`);
  if ((s.inv.stone || 0) < stone) miss.push(`${stone - (s.inv.stone || 0)} more stone`);
  if (miss.length) throw new ApiError(409, 'not_enough', `A ${lower(k.name)} needs ${miss.join(', ')}.`);
  s.inv.wood = (s.inv.wood || 0) - wood; s.inv.stone = (s.inv.stone || 0) - stone;
  const P = PLOTS[plot];
  await c.rows('INSERT INTO buildings (room_id, type, plot, x, z, yaw) VALUES ($1, $2, $3, $4, $5, $6)', [me.room_id, type, plot, P.x, P.z, P.yaw]);
  return { money: -cost, items: ['wood', 'stone'], detail: { type, plot, cost, wood, stone }, message: `${me.name} built a ${lower(k.name)} on plot ${plot + 1}` };
}

// logs and stones collected in the world go into the farm's store (as wood / stone for building)
async function deposit(c, { me, b, s, cat }) {
  const items = b.items && typeof b.items === 'object' ? b.items : {};
  const want = { wood: whole(items.wood || 0, 0, DEPOSIT_MAX, 'Wood'), stone: whole(items.stone || 0, 0, DEPOSIT_MAX, 'Stone') };
  if (!want.wood && !want.stone) throw badInput('Nothing to store.');
  const recent = await c.one(`SELECT COALESCE(sum(COALESCE((detail->>'wood')::int, 0) + COALESCE((detail->>'stone')::int, 0)), 0)::int AS n
      FROM room_transactions WHERE room_id = $1 AND member_id = $2 AND kind = 'deposit' AND created_at > now() - interval '60 seconds'`, [me.room_id, me.id]);
  if (recent.n + want.wood + want.stone > DEPOSIT_PER_MIN) throw new ApiError(429, 'slow_down', 'That is a lot at once — wait a minute and store the rest.');
  const got = {};
  for (const k of ['wood', 'stone']) {
    const space = Math.max(0, (cat[k].cap ?? Infinity) - (s.inv[k] || 0));
    got[k] = Math.min(want[k], space);
    s.inv[k] = (s.inv[k] || 0) + got[k];
  }
  if (!got.wood && !got.stone) throw new ApiError(409, 'storage_full', 'The farm store is full.');
  return { money: 0, items: ['wood', 'stone'], detail: { wood: got.wood, stone: got.stone }, message: `${me.name} stored ${[got.wood && `${got.wood} wood`, got.stone && `${got.stone} stone`].filter(Boolean).join(' and ')}` };
}

const ACTIONS = { buy, sell, build, deposit };
