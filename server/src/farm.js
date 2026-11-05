// Farm economy: the world's shared money and goods, shelters, animals and what they produce.
// Every change runs in one transaction with the world's row locked, so two players buying at the
// same moment can never spend the same money twice. Prices and rules come from the catalog table.
// Feeding is done by the players: one feeding (feedCost units of feed) keeps an animal fed for
// feedHours; only fed animals produce. Production is counted lazily: whenever the farm is opened or
// changed, the time since produced_at (database clock) is worked out and produced_at moves forward
// in the same transaction, so no period is ever counted twice.
import { ApiError, badInput, json, rateLimit, readJson } from './http.js';
import { rows, tx } from './db.js';
import { member } from './rooms.js';
import { PLOTS } from './layout.js';
import { withAnimalConfig } from './animals.js';
import { cast, reel, buyRod, fishingState } from './fishing.js';
import { ensureOrders, ordersState, deliver } from './orders.js';
import { ensureRentals, rentalsState, rent, sellHorse, isHorse, HORSES } from './horses.js';
import { thiefCtx, thiefStep, thiefSave, thievesState, catchThief, dogAction, seenThefts } from './thieves.js';

const H = 3600e3;
const MAX_OFFLINE_H = 24 * 7;          // production is counted for at most a week of absence
const START_GOODS = { feed: 20 };      // a new farm starts with ₹500 (column default) and some feed
const FEED_AHEAD_H = 24;               // an animal can be fed for at most a day ahead
const STARVE_AFTER_H = 24;             // hungry for this long: the animal starts getting weak
const HEAL_PER_H = 10, SICK_PER_H = 5, MIN_HEALTH = 10;   // animals get weak, never die
const REQ_RE = /^[A-Za-z0-9_-]{8,64}$/, UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEPOSIT_MAX = 50, DEPOSIT_PER_MIN = 150;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;
const lower = s => s.toLowerCase();

/* ---------- reading ---------- */
async function catalog(c) {
  const list = await c.rows('SELECT item, kind, name, icon, buy_price, sell_price, data FROM catalog ORDER BY sort, item');
  // chickens' timings come from the central animal config (server/src/animals.js)
  return Object.fromEntries(list.map(r => [r.item, withAnimalConfig(r.item, { ...r.data, kind: r.kind, name: r.name, icon: r.icon, buy: r.buy_price, sell: r.sell_price })]));
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
// storage limits grow with the farm storage level
const storageMult = (cat, level) => ((cat.storage && cat.storage.levels) || []).reduce((m, l) => (l.level <= level ? l.mult || m : m), 1);
const capOf = (cat, item, level) => (cat[item] && cat[item].cap ? cat[item].cap * storageMult(cat, level) : Infinity);

/* ---------- production ---------- */
// Work out the farm between two moments (ms), in steps of at most an hour. An animal produces only
// while it is fed (until fed_until), scaled by its health. Fed animals heal; one left hungry for a day
// gets weak. Chickens (catalog `nest`) keep their eggs in their own nest box until a player collects them
// (`ready`); a full nest stops that chicken laying. Other products go straight into storage up to its
// limit; the rest is lost. Every animal has its own timer (`progress`). Mutates animals and inv.
export function simulate(animals, inv, cat, fromMs, toMs, level = 1) {
  const span = Math.max(0, toMs - fromMs), steps = Math.max(1, Math.ceil(span / H - 1e-9)), step = span / steps;
  const made = {}, laid = {};
  for (const a of animals) { a.made = false; a.ready = a.ready || 0; a.fu = a.fed_until ? new Date(a.fed_until).getTime() : -Infinity; }
  for (let s = 0; s < steps; s++) {
    const s0 = fromMs + s * step, s1 = s0 + step;
    for (const a of animals) {
      const k = cat[a.type], fedH = clamp(Math.min(s1, a.fu) - s0, 0, step) / H;
      const starveH = clamp(s1 - Math.max(s0, a.fu + STARVE_AFTER_H * H), 0, step) / H;
      a.health = Math.max(MIN_HEALTH, Math.min(100, a.health + HEAL_PER_H * fedH) - SICK_PER_H * starveH);
      if (k.product && k.rate && !(k.nest && a.ready >= k.nest)) a.progress += k.rate * fedH * (a.health / 100);
      else if (k.grow && (a.level || 1) < (k.maxLevel || HORSES.maxLevel)) a.progress += k.grow * fedH * (a.health / 100);   // horses grow
    }
    for (const a of animals) {
      const k = cat[a.type];
      if (k.grow) {                                    // a level for every whole step of growth, up to the top level
        const up = Math.floor(a.progress + 1e-9), max = k.maxLevel || HORSES.maxLevel;
        if (up >= 1) { a.level = Math.min(max, (a.level || 1) + up); a.progress = a.level >= max ? 0 : Math.max(0, a.progress - up); }
        continue;
      }
      const p = k.product, whole = p ? Math.floor(a.progress + 1e-9) : 0;
      if (whole < 1) continue;
      if (k.nest) {                                    // into the nest box, until it is full
        const take = Math.min(whole, Math.max(0, k.nest - a.ready));
        if (take > 0) { a.ready += take; laid[p] = (laid[p] || 0) + take; a.made = true; }
        a.progress = take < whole ? 0 : Math.max(0, a.progress - whole);
        continue;
      }
      const take = Math.min(whole, Math.max(0, capOf(cat, p, level) - (inv[p] || 0)));
      if (take > 0) { inv[p] = (inv[p] || 0) + take; made[p] = (made[p] || 0) + take; a.made = true; }
      a.progress = Math.max(0, a.progress - whole);
    }
  }
  for (const a of animals) a.hunger = clamp((toMs - a.fu) / (STARVE_AFTER_H * H) * 100, 0, 100);
  return { made, laid };
}

// Bring the farm up to now. Must run inside a transaction; locks the world's row.
async function settle(c, roomId, cat) {
  const r = await c.one(`SELECT money, econ_rev, produced_at, total_earned, storage_level, thief_due_at, now() AS now FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
  const inv = await invMap(c, roomId), dirty = [];
  let changed = false;
  if (r.econ_rev === 0) {                                  // first time this farm is opened: starting goods
    for (const [k, n] of Object.entries(START_GOODS)) { inv[k] = (inv[k] || 0) + n; dirty.push(k); }
    changed = true;
  }
  const from = Math.max(r.produced_at.getTime(), r.now.getTime() - MAX_OFFLINE_H * H), to = r.now.getTime();
  if (to > from) {
    const animals = await c.rows('SELECT id, type, shelter_id, health, hunger, progress, ready, level, fed_until FROM animals WHERE room_id = $1 ORDER BY born_at, id', [roomId]);
    if (animals.length) {
      // hour by hour (and to the moment a thief arrives): a thief may come for eggs left waiting (thieves.js)
      const hens = animals.some(a => cat[a.type] && cat[a.type].nest), ctx = hens || r.thief_due_at ? await thiefCtx(c, roomId, r.thief_due_at) : null;
      const out = { made: {} };
      for (const a of animals) a.madeAny = false;
      for (let t = from; t < to;) {
        const end = !ctx ? to : Math.min(to, t + H, ctx.due !== null && ctx.due > t ? ctx.due : Infinity);
        const o = simulate(animals, inv, cat, t, end, r.storage_level);
        for (const [k, v] of Object.entries(o.made)) out.made[k] = (out.made[k] || 0) + v;
        for (const a of animals) a.madeAny = a.madeAny || a.made;
        t = end;
        if (ctx) thiefStep(ctx, animals, cat, t, to);
      }
      for (const a of animals) a.made = a.madeAny;
      if (ctx && await thiefSave(c, roomId, ctx)) changed = true;
      dirty.push(...Object.keys(out.made));
      await c.rows(`UPDATE animals a SET health = v.health, hunger = v.hunger, progress = v.progress, ready = v.ready, level = v.level,
          last_production_at = CASE WHEN v.made THEN $7 ELSE a.last_production_at END
          FROM unnest($1::uuid[], $2::real[], $3::real[], $4::float8[], $5::bool[], $6::int[], $8::int[]) AS v(id, health, hunger, progress, made, ready, level)
          WHERE a.id = v.id`,
      [animals.map(a => a.id), animals.map(a => a.health), animals.map(a => a.hunger), animals.map(a => a.progress), animals.map(a => a.made), animals.map(a => a.ready), r.now, animals.map(a => a.level || 1)]);
      changed = true;
    }
  }
  await writeInv(c, roomId, dirty, inv);
  await c.rows('UPDATE rooms SET produced_at = $2, econ_rev = econ_rev + $3 WHERE id = $1', [roomId, r.now, changed ? 1 : 0]);
  return { money: Number(r.money), rev: r.econ_rev + (changed ? 1 : 0), now: r.now, inv, level: r.storage_level, earned: Number(r.total_earned) };
}

async function state(c, roomId, cat, s, me) {
  await ensureOrders(c, roomId, cat, s);
  await ensureRentals(c, roomId, cat, s);
  const blds = await c.rows('SELECT id, type, plot, level, x, z, yaw, gate_open FROM buildings WHERE room_id = $1 ORDER BY plot', [roomId]);
  const ans = await c.rows('SELECT id, type, shelter_id, health, hunger, progress, ready, level, rented_until, fed_until, born_at FROM animals WHERE room_id = $1 ORDER BY born_at, id', [roomId]);
  const inventory = {}, caps = {};
  for (const [k, v] of Object.entries(cat)) if (v.kind === 'good') { inventory[k] = s.inv[k] || 0; if (v.cap) caps[k] = capOf(cat, k, s.level); }
  return {
    rev: s.rev, money: s.money, at: s.now.toISOString(), storageLevel: s.level, totalEarned: s.earned,
    inventory, caps,
    buildings: blds.map(b => ({ id: b.id, type: b.type, plot: b.plot, level: b.level, x: b.x, z: b.z, yaw: b.yaw, gateOpen: b.gate_open })),
    animals: ans.map(a => ({ id: a.id, type: a.type, shelter: a.shelter_id, health: r1(a.health), hunger: r1(a.hunger), progress: Math.round(a.progress * 10000) / 10000,
      ready: a.ready, level: a.level, rentedUntil: a.rented_until ? a.rented_until.toISOString() : null, fedUntil: a.fed_until ? a.fed_until.toISOString() : null, born: a.born_at })),
    catalog: cat, plots: PLOTS.length,
    fishing: me ? await fishingState(c, roomId, me.id) : null,
    orders: await ordersState(c, roomId, s),
    rentals: await rentalsState(c, roomId, s),
    thieves: await thievesState(c, roomId, s, me, cat),
  };
}

/* ---------- requests ---------- */
export async function farmState(req, env, db, code) {
  rateLimit(req, 'farmget', 120, 60e3, env);
  const me = await member(db, req, code);
  return tx(db, async c => {
    const cat = await catalog(c);
    const s = await settle(c, me.room_id, cat);
    return json(await state(c, me.room_id, cat, s, me));
  });
}

export async function farmHistory(req, env, db, code) {
  const me = await member(db, req, code);
  const list = await rows(db, `SELECT t.kind, t.detail, t.money_delta, t.created_at, m.name FROM room_transactions t
      LEFT JOIN room_members m ON m.id = t.member_id WHERE t.room_id = $1 AND t.kind NOT IN ('gate', 'cast', 'seen')
      AND NOT (t.kind = 'reel' AND (t.detail->>'caught')::boolean IS NOT TRUE) ORDER BY t.created_at DESC, t.id DESC LIMIT 30`, [me.room_id]);
  return json({ history: list.map(x => ({ kind: x.kind, who: x.name || 'A former member', message: x.detail.message || '', money: Number(x.money_delta), at: x.created_at })) });
}

// one action: { requestId, action: buy | sell | build | deposit | feed | upgrade, ... }. A retried requestId
// returns the result of the first try instead of running again.
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
    if (dup) return json({ ok: true, replay: true, message: dup.detail.message || '', result: dup.detail, ...(await state(c, me.room_id, cat, s, me)) });
    const out = await fn(c, { me, b, cat, s });
    await writeInv(c, me.room_id, out.items || [], s.inv);
    // the CHECK (money >= 0) constraint backs up the checks in the actions
    if (out.money) await c.rows('UPDATE rooms SET money = money + $2, total_earned = total_earned + $3 WHERE id = $1', [me.room_id, out.money, out.earned || 0]);
    s.money += out.money || 0; s.earned += out.earned || 0;
    const detail = { ...out.detail, message: out.message };
    await c.rows(`INSERT INTO room_transactions (room_id, member_id, request_id, kind, detail, money_delta) VALUES ($1, $2, $3, $4, $5, $6)`,
      [me.room_id, me.id, rid, b.action, JSON.stringify(detail), out.money || 0]);
    await c.rows('UPDATE rooms SET econ_rev = econ_rev + 1 WHERE id = $1', [me.room_id]);
    s.rev++;
    return json({ ok: true, message: out.message, result: detail, ...(await state(c, me.room_id, cat, s, me)) });
  });
}

/* ---------- actions ---------- */
function whole(v, lo, hi, what = 'Amount') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw badInput(`${what} must be a whole number from ${lo} to ${hi}.`);
  return n;
}
const plural = (n, k) => `${n} ${lower(k.name)}${n === 1 || /s$/.test(k.name) ? '' : 's'}`;

async function buy(c, { me, b, cat, s }) {
  const item = String(b.item || ''), k = cat[item];
  if (!k || !k.buy || k.kind === 'building' || k.kind === 'upgrade' || k.kind === 'dog') throw new ApiError(400, 'bad_item', 'That can\'t be bought here.');
  const qty = whole(b.qty, 1, k.kind === 'animal' ? 12 : 500);
  if (k.unlock && s.earned < k.unlock) throw new ApiError(409, 'locked', `${k.name}s are sold once the farm has earned ₹${k.unlock} from sales (₹${s.earned} so far).`);
  const foal = isHorse(k) && b.age === 'foal';            // a baby horse: cheaper, Level 1
  const cost = (foal ? k.foal : k.buy) * qty;
  if (s.money < cost) throw new ApiError(409, 'not_enough_money', `Not enough money: ${qty} × ${k.name} costs ₹${cost}, the farm has ₹${s.money}.`);
  if (k.kind === 'animal') {
    const home = cat[k.shelter];
    const sh = await c.rows(`SELECT b.id, (SELECT count(*)::int FROM animals a WHERE a.shelter_id = b.id) AS n
        FROM buildings b WHERE b.room_id = $1 AND b.type = $2 ORDER BY b.plot`, [me.room_id, k.shelter]);
    const pref = String(b.shelter || '');                    // bought from a shelter's panel: that shelter first
    if (UUID_RE.test(pref)) sh.sort((x, y) => (y.id === pref) - (x.id === pref));
    if (!sh.length) throw new ApiError(409, 'no_shelter', `${k.name}s need a ${lower(home.name)}. Build one on a farm plot first.`);
    const free = sh.reduce((t, x) => t + Math.max(0, home.capacity - x.n), 0);
    if (free < qty) throw new ApiError(409, 'no_space', free ? `Only ${free} free place${free > 1 ? 's' : ''} in your ${lower(home.name)}s. Build another for more.` : `Every ${lower(home.name)} is full. Build another one for more animals.`);
    const homes = [];
    for (const x of sh) for (let i = x.n; i < home.capacity && homes.length < qty; i++) homes.push(x.id);
    // new animals arrive fed for one feeding period
    const level = isHorse(k) && !foal ? k.maxLevel || HORSES.maxLevel : 1;
    await c.rows(`INSERT INTO animals (room_id, type, shelter_id, last_fed_at, fed_until, level)
        SELECT $1, $2, unnest($3::uuid[]), now(), now() + make_interval(secs => $4), $5`, [me.room_id, item, homes, (k.feedHours || 2) * 3600, level]);
    return { money: -cost, detail: { item, qty, cost, level }, message: `${me.name} bought ${foal ? `${qty} baby ${lower(k.name)}${qty > 1 ? 's' : ''}` : plural(qty, k)} for ₹${cost}` };
  }
  // a pack (e.g. 10 worms for ₹1) adds `n` of another item per pack
  const into = k.pack ? k.pack.item : item, n = k.pack ? k.pack.n * qty : qty, ik = cat[into];
  const have = s.inv[into] || 0, cap = capOf(cat, into, s.level);
  if (have + n > cap) throw new ApiError(409, 'storage_full', `The farm storage holds at most ${cap} ${lower(ik.name)} (it has ${have}). Upgrade the storage for more room.`);
  s.inv[into] = have + n;
  return { money: -cost, items: [into], detail: { item, into, qty, n, cost }, message: `${me.name} bought ${k.pack ? `${n} ${lower(ik.name)}` : `${qty} ${lower(k.name)}`} for ₹${cost}` };
}

async function sell(c, { me, b, s, cat }) {
  const item = String(b.item || ''), k = cat[item];
  if (!k || !k.sell) throw new ApiError(400, 'bad_item', 'That can\'t be sold here.');
  const qty = whole(b.qty, 1, 100000);
  const have = s.inv[item] || 0;
  if (qty > have) throw new ApiError(409, 'not_enough', `The farm only has ${have} ${lower(k.name)}.`);
  s.inv[item] = have - qty;
  const pay = k.sell * qty;
  return { money: pay, earned: pay, items: [item], detail: { item, qty, pay }, message: `${me.name} sold ${qty} ${lower(k.name)} for ₹${pay}` };
}

async function build(c, { me, b, s, cat }) {
  const type = String(b.type || ''), k = cat[type];
  if (!k || k.kind !== 'building') throw new ApiError(400, 'bad_item', 'Unknown building.');
  const plot = whole(b.plot, 0, PLOTS.length - 1, 'Plot');
  if (await c.one('SELECT 1 FROM buildings WHERE room_id = $1 AND plot = $2', [me.room_id, plot])) throw new ApiError(409, 'plot_taken', 'Something is already built on that plot.');
  const miss = needs(s, k.buy || 0, k.wood || 0, k.stone || 0);
  if (miss.length) throw new ApiError(409, 'not_enough', `A ${lower(k.name)} needs ${miss.join(', ')}.`);
  s.inv.wood = (s.inv.wood || 0) - (k.wood || 0); s.inv.stone = (s.inv.stone || 0) - (k.stone || 0);
  const P = PLOTS[plot];
  await c.rows('INSERT INTO buildings (room_id, type, plot, x, z, yaw) VALUES ($1, $2, $3, $4, $5, $6)', [me.room_id, type, plot, P.x, P.z, P.yaw]);
  return { money: -(k.buy || 0), items: ['wood', 'stone'], detail: { type, plot, cost: k.buy, wood: k.wood, stone: k.stone }, message: `${me.name} built a ${lower(k.name)} on plot ${plot + 1}` };
}
function needs(s, money, wood, stone) {
  const miss = [];
  if (s.money < money) miss.push(`₹${money - s.money} more money`);
  if ((s.inv.wood || 0) < wood) miss.push(`${wood - (s.inv.wood || 0)} more wood`);
  if ((s.inv.stone || 0) < stone) miss.push(`${stone - (s.inv.stone || 0)} more stone`);
  return miss;
}

// logs and stones collected in the world go into the farm storage (as wood / stone for building)
async function deposit(c, { me, b, s, cat }) {
  const items = b.items && typeof b.items === 'object' ? b.items : {};
  const want = { wood: whole(items.wood || 0, 0, DEPOSIT_MAX, 'Wood'), stone: whole(items.stone || 0, 0, DEPOSIT_MAX, 'Stone') };
  if (!want.wood && !want.stone) throw badInput('Nothing to store.');
  const recent = await c.one(`SELECT COALESCE(sum(COALESCE((detail->>'wood')::int, 0) + COALESCE((detail->>'stone')::int, 0)), 0)::int AS n
      FROM room_transactions WHERE room_id = $1 AND member_id = $2 AND kind = 'deposit' AND created_at > now() - interval '60 seconds'`, [me.room_id, me.id]);
  if (recent.n + want.wood + want.stone > DEPOSIT_PER_MIN) throw new ApiError(429, 'slow_down', 'That is a lot at once — wait a minute and store the rest.');
  const got = {};
  for (const k of ['wood', 'stone']) {
    got[k] = Math.min(want[k], Math.max(0, capOf(cat, k, s.level) - (s.inv[k] || 0)));
    s.inv[k] = (s.inv[k] || 0) + got[k];
  }
  if (!got.wood && !got.stone) throw new ApiError(409, 'storage_full', 'The farm storage is full. Upgrade it for more room.');
  return { money: 0, items: ['wood', 'stone'], detail: { wood: got.wood, stone: got.stone }, message: `${me.name} stored ${[got.wood && `${got.wood} wood`, got.stone && `${got.stone} stone`].filter(Boolean).join(' and ')}` };
}

// feed the animals of one shelter: { shelter, count } (count = how many, the hungriest first) or { all: true }.
// Each feeding costs feedCost units and keeps that animal fed feedHours longer (at most a day ahead).
// With too little feed, only as many animals as the feed allows are fed.
async function feed(c, { me, b, s, cat }) {
  const shelter = String(b.shelter || '');
  if (!UUID_RE.test(shelter)) throw badInput('Pick a shelter to feed.');
  const bd = await c.one('SELECT type FROM buildings WHERE id = $1 AND room_id = $2', [shelter, me.room_id]);
  if (!bd) throw new ApiError(404, 'not_found', 'That shelter is not on this farm.');
  const list = await c.rows(`SELECT id, type, fed_until, (fed_until IS NOT NULL AND fed_until > now()) AS fed, now() AS now
      FROM animals WHERE shelter_id = $1 ORDER BY fed_until ASC NULLS FIRST, born_at, id`, [shelter]);
  if (!list.length) throw new ApiError(409, 'no_animals', 'There are no animals here to feed.');
  const want = b.all ? list.length : whole(b.count, 1, list.length, 'Number of animals');
  const now = list[0].now.getTime();
  let fed = 0, used = 0, full = 0, short = false;
  const ids = [], until = [];
  for (const a of list) {
    if (fed >= want) break;
    const k = cat[a.type], cost = k.feedCost || 1, hours = k.feedHours || 2;
    const base = Math.max(now, a.fed_until ? a.fed_until.getTime() : 0);
    if (base + hours * H > now + FEED_AHEAD_H * H + 1000) { full++; continue; }
    if ((s.inv.feed || 0) < cost) { short = true; break; }
    s.inv.feed -= cost; used += cost; fed++;
    ids.push(a.id); until.push(new Date(base + hours * H).toISOString());
  }
  if (!fed) {
    if (short) throw new ApiError(409, 'not_enough', 'No feed left. Buy feed at the Farm Store.');
    throw new ApiError(409, 'already_fed', `These animals are already fed for the next ${FEED_AHEAD_H} hours.`);
  }
  await c.rows(`UPDATE animals a SET fed_until = v.until, last_fed_at = now() FROM unnest($1::uuid[], $2::timestamptz[]) AS v(id, until) WHERE a.id = v.id`, [ids, until]);
  // the fed animals' name; a coop with several chicken varieties just says "chickens"
  const types = new Set(list.filter(a => ids.includes(a.id)).map(a => a.type)), home = cat[cat[bd.type].animal] || cat[list[0].type];
  const noun = types.size === 1 ? lower(cat[[...types][0]].name) : home.nest ? 'chicken' : home.grow ? 'horse' : lower(home.name);
  const message = `${me.name} fed ${fed} ${noun}${fed === 1 ? '' : 's'} (${used} feed)` + (short && fed < want ? ` — not enough feed for the other ${want - fed}` : '');
  return { money: 0, items: ['feed'], detail: { shelter, fed, wanted: want, used, short: short && fed < want, full }, message };
}

// collect the eggs waiting in the nest boxes of one shelter: { shelter }. They go into the farm storage
// (up to its limit; the rest stay in the nests). The world's row is locked, so two players pressing
// "Collect" at once never get the same egg: the second one finds the nests already empty.
async function collect(c, { me, b, s, cat }) {
  const shelter = String(b.shelter || '');
  if (!UUID_RE.test(shelter)) throw badInput('Pick a shelter.');
  const list = await c.rows('SELECT id, type, ready FROM animals WHERE shelter_id = $1 AND room_id = $2 AND ready > 0 ORDER BY ready DESC, born_at, id', [shelter, me.room_id]);
  if (!list.length) throw new ApiError(409, 'nothing_ready', 'No eggs are ready yet.');
  const got = {}, ids = [], left = [];
  let full = false;
  for (const a of list) {
    const p = cat[a.type].product, room = Math.max(0, capOf(cat, p, s.level) - (s.inv[p] || 0)), take = Math.min(a.ready, room);
    if (take < a.ready) full = true;
    if (take <= 0) continue;
    s.inv[p] = (s.inv[p] || 0) + take; got[p] = (got[p] || 0) + take;
    ids.push(a.id); left.push(a.ready - take);
  }
  if (!ids.length) throw new ApiError(409, 'storage_full', 'The farm storage has no room for more eggs. Sell some at the Market or upgrade the storage.');
  await c.rows('UPDATE animals a SET ready = v.ready FROM unnest($1::uuid[], $2::int[]) AS v(id, ready) WHERE a.id = v.id', [ids, left]);
  const n = Object.values(got).reduce((t, v) => t + v, 0);
  const what = Object.entries(got).map(([p, q]) => `${q} ${lower(cat[p].name)}`).join(', ');
  return { money: 0, items: Object.keys(got), detail: { shelter, got, total: n, full }, message: `${me.name} collected ${what}${full ? ' — storage full, the rest wait in the nests' : ''}` };
}

// upgrade the farm storage to the next level: { target: 'storage', level } (the level asked for, so two
// players pressing the button at the same time upgrade only once)
async function upgrade(c, { me, b, s, cat }) {
  if (b.target !== 'storage' || !cat.storage) throw badInput('Unknown upgrade.');
  const level = whole(b.level, 2, 99, 'Level');
  if (s.level >= level) throw new ApiError(409, 'already_upgraded', `The farm storage is already level ${s.level}.`);
  const next = (cat.storage.levels || []).find(l => l.level === s.level + 1);
  if (!next || next.level !== level) throw new ApiError(409, 'max_level', 'There is no higher storage level yet.');
  const miss = needs(s, next.money || 0, next.wood || 0, next.stone || 0);
  if (miss.length) throw new ApiError(409, 'not_enough', `The upgrade needs ${miss.join(', ')}.`);
  s.inv.wood = (s.inv.wood || 0) - (next.wood || 0); s.inv.stone = (s.inv.stone || 0) - (next.stone || 0);
  await c.rows('UPDATE rooms SET storage_level = $2 WHERE id = $1', [me.room_id, next.level]);
  s.level = next.level;
  return { money: -(next.money || 0), items: ['wood', 'stone'], detail: { target: 'storage', level: next.level, cost: next.money }, message: `${me.name} upgraded the farm storage to level ${next.level}` };
}

// open or close the gate of a shelter's pen: { shelter, open }. Asking for the state it is already in is fine
// (two players closing it at once both succeed).
async function gate(c, { me, b }) {
  const shelter = String(b.shelter || '');
  if (!UUID_RE.test(shelter)) throw badInput('Pick a gate.');
  const open = b.open === true;
  const r = await c.one('UPDATE buildings SET gate_open = $3 WHERE id = $1 AND room_id = $2 RETURNING plot', [shelter, me.room_id, open]);
  if (!r) throw new ApiError(404, 'not_found', 'That shelter is not on this farm.');
  return { money: 0, items: [], detail: { shelter, open }, message: `${me.name} ${open ? 'opened' : 'closed'} the gate of plot ${r.plot + 1}` };
}

const ACTIONS = { buy, sell, build, deposit, feed, upgrade, gate, collect, cast, reel, rod: buyRod, order: deliver, rent, sellhorse: sellHorse,
  catch: catchThief, dog: dogAction, seen: seenThefts };
