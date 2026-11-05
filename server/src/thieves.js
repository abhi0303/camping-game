// Thieves and guard dogs.
//   - When more than 40 eggs are left waiting in the nest boxes, a thief takes notice and comes 8–25 minutes
//     later — unless the eggs have been collected by then. He sneaks up to the back of the coop with the most
//     eggs, takes as many as he needs (30–80 % of what is waiting) and runs off into the jungle. A raid is 'live'
//     for about 70 s (sneaking up, stealing, running away): players in the game see him and can catch him with
//     a net — everything comes back, with 10 % more. Nobody there: the eggs are gone, and the players are told
//     when they come back.
//   - Guard dogs (at most 2, ₹1000 each) on duty — fed with a bone (₹5, 4 hours) or a treat (₹25, 24 hours) —
//     save part of the take: 40 % at level 1, 70 % at level 2 (training ₹1500), 95–100 % at level 3 (₹2000).
//     With the best dog on duty at level 2 a thief comes at most twice a day, at level 3 once (3 times otherwise).
// Raids are worked out in settle() (farm.js) with the world's row locked, step by step through the time since the
// farm was last opened, so they happen once for everyone — also while nobody played.
import { ApiError, badInput } from './http.js';
import { istDay } from './orders.js';

export const THIEVES = {
  threshold: 40,                 // more eggs than this waiting in the nests and a thief notices
  noticeMin: [8, 25],            // he comes this many minutes later (if the eggs are still there)
  gapMin: 90,                    // at least this long between two raids
  perDay: [3, 3, 2, 1],          // raids a day: no dog on duty / the best dog on duty at level 1, 2, 3
  want: [0.3, 0.8],              // the share of the waiting eggs he means to take
  minWant: 8,
  bonus: 0.10,                   // caught: everything back and 10 % more
  approachS: 30, stealS: 8, runS: 34,   // seconds: sneaking up to the coop, taking the eggs, running away
  graceS: 4,                     // a catch sent just as he disappears still counts
  aheadH: 48,                    // a dog can be fed at most this far ahead
  on: true,                      // (tests of other things switch thieves off)
};
const H = 3600e3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function rand() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
const between = ([a, b], r = rand) => a + (b - a) * r();
const capOf = (cat, item, level) => {
  const mult = ((cat.storage && cat.storage.levels) || []).reduce((m, l) => (l.level <= level ? l.mult || m : m), 1);
  return cat[item] && cat[item].cap ? cat[item].cap * mult : Infinity;
};
const lower = s => s.toLowerCase();
// the guard dog's levels from the catalog: { level, cost, cut: [lo, hi], raids }
const levels = cat => (cat.guard_dog && cat.guard_dog.levels) || [{ level: 1, cut: [0.4, 0.4], raids: 3 }, { level: 2, cost: 1500, cut: [0.7, 0.7], raids: 2 }, { level: 3, cost: 2000, cut: [0.95, 1], raids: 1 }];
const levelOf = (cat, n) => levels(cat).find(l => l.level === n);
const perDay = (cat, best) => (best ? (levelOf(cat, best) || {}).raids ?? THIEVES.perDay[best] : THIEVES.perDay[0]);

/* ---------- inside settle() ---------- */
// what settle() needs to know about thieves and dogs (call once per settle, with the world's row locked)
export async function thiefCtx(c, roomId, dueAt) {
  const dogs = (await c.rows('SELECT id, slot, level, fed_until FROM farm_dogs WHERE room_id = $1 ORDER BY slot', [roomId]))
    .map(d => ({ id: d.id, level: d.level, fu: d.fed_until ? d.fed_until.getTime() : 0 }));
  const counts = new Map();
  for (const r of await c.rows(`SELECT day::text AS day, count(*)::int AS n FROM farm_thefts WHERE room_id = $1 AND at > now() - interval '9 days' GROUP BY day`, [roomId])) counts.set(r.day, r.n);
  const last = await c.one('SELECT max(at) AS at FROM farm_thefts WHERE room_id = $1', [roomId]);
  return { dogs, counts, last: last && last.at ? last.at.getTime() : -Infinity, due: dueAt ? dueAt.getTime() : null, due0: dueAt ? dueAt.getTime() : null, raids: [] };
}
const onDuty = (ctx, t) => ctx.dogs.filter(d => d.fu > t);
export const bestOnDuty = (ctx, t) => onDuty(ctx, t).reduce((m, d) => Math.max(m, d.level), 0);
const allowed = (ctx, cat, t) => (ctx.counts.get(istDay(t)) || 0) < perDay(cat, bestOnDuty(ctx, t)) && t - ctx.last >= THIEVES.gapMin * 60e3;

// the farm at moment t (animals worked out up to t): a thief who was coming arrives; a full farm gets noticed.
// Mutates the chickens' nests (ready) and ctx (raids, due, counts). nowMs: the server's now (decides 'live').
export function thiefStep(ctx, animals, cat, t, nowMs, r = rand) {
  if (!THIEVES.on) return;
  const nests = animals.filter(a => cat[a.type] && cat[a.type].nest);
  if (!nests.length) { ctx.due = null; return; }
  const waiting = () => nests.reduce((s, a) => s + (a.ready || 0), 0);
  if (ctx.due !== null && t >= ctx.due) {
    const at = ctx.due;
    ctx.due = null;
    if (waiting() > THIEVES.threshold && allowed(ctx, cat, at)) {
      ctx.raids.push(raid(ctx, nests, cat, at, nowMs, r));
      ctx.counts.set(istDay(at), (ctx.counts.get(istDay(at)) || 0) + 1);
      ctx.last = at;
    }
  }
  if (ctx.due === null && waiting() > THIEVES.threshold && allowed(ctx, cat, t)) ctx.due = t + between(THIEVES.noticeMin, r) * 60e3;
}
// one raid at moment `at`: what he wants, what the dogs on duty save, which eggs go
function raid(ctx, nests, cat, at, nowMs, r) {
  const waiting = nests.reduce((s, a) => s + a.ready, 0);
  const want = Math.min(waiting, Math.max(THIEVES.minWant, Math.round(waiting * between(THIEVES.want, r))));
  const duty = onDuty(ctx, at), level = duty.reduce((m, d) => Math.max(m, d.level), 0);
  let keep = 1;
  for (const d of duty) { const L = levelOf(cat, d.level); keep *= 1 - between(L ? L.cut : [0, 0], r); }
  const take = Math.round(want * keep);
  // he goes for the coop with the most eggs (and takes from the next one if that's not enough)
  const by = new Map();
  for (const a of nests) by.set(a.shelter_id, (by.get(a.shelter_id) || 0) + a.ready);
  const shelter = [...by.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])))[0][0];
  const order = nests.slice().sort((x, y) => (y.shelter_id === shelter) - (x.shelter_id === shelter) || y.ready - x.ready);
  const taken = {};
  let left = take;
  for (const a of order) {
    if (left <= 0) break;
    const n = Math.min(a.ready, left);
    if (n <= 0) continue;
    a.ready -= n; left -= n;
    const p = cat[a.type].product;
    taken[p] = (taken[p] || 0) + n;
  }
  const got = take - left, steal = at + THIEVES.approachS * 1000, escape = steal + (THIEVES.stealS + THIEVES.runS) * 1000;
  return { at, steal, escape, shelter, want, taken, got, saved: want - got, level, dogs: duty.length,
    status: escape < nowMs ? (got ? 'stolen' : 'scared') : 'live', seed: Math.floor(r() * 2147483646) + 1 };
}
// after the steps: new raids, the thief now on his way (if any), raids that are over
export async function thiefSave(c, roomId, ctx) {
  for (const x of ctx.raids) {
    await c.rows(`INSERT INTO farm_thefts (room_id, day, at, steal_at, escape_at, shelter_id, wanted, taken, saved, dog_level, dogs, status, seed)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [roomId, istDay(x.at), new Date(x.at), new Date(x.steal), new Date(x.escape), x.shelter, x.want, JSON.stringify(x.taken), x.saved, x.level, x.dogs, x.status, x.seed]);
  }
  if (ctx.due !== ctx.due0) await c.rows('UPDATE rooms SET thief_due_at = $2 WHERE id = $1', [roomId, ctx.due === null ? null : new Date(ctx.due)]);
  const over = await c.rows(`UPDATE farm_thefts SET status = CASE WHEN (SELECT COALESCE(sum(v::int), 0) FROM jsonb_each_text(taken) AS e(k, v)) > 0 THEN 'stolen' ELSE 'scared' END
      WHERE room_id = $1 AND status = 'live' AND escape_at < now() - make_interval(secs => $2) RETURNING id`, [roomId, THIEVES.graceS]);
  return ctx.raids.length > 0 || ctx.due !== ctx.due0 || over.length > 0;
}

/* ---------- what the players see ---------- */
export async function thievesState(c, roomId, s, me, cat) {
  const now = s.now.getTime();
  const list = await c.rows(`SELECT t.id, t.at, t.steal_at, t.escape_at, t.shelter_id, t.wanted, t.taken, t.saved, t.dog_level, t.dogs, t.status, t.seed, t.caught_at, m.name AS caught_by
      FROM farm_thefts t LEFT JOIN room_members m ON m.id = t.caught_by WHERE t.room_id = $1 ORDER BY t.at DESC LIMIT 15`, [roomId]);
  const dogs = await c.rows('SELECT id, slot, level, fed_until FROM farm_dogs WHERE room_id = $1 ORDER BY slot', [roomId]);
  const r = await c.one('SELECT thief_due_at FROM rooms WHERE id = $1', [roomId]);
  const m = me ? await c.one('SELECT thefts_seen_at, created_at FROM room_members WHERE id = $1', [me.id]) : null;
  const best = dogs.filter(d => d.fed_until && d.fed_until.getTime() > now).reduce((x, d) => Math.max(x, d.level), 0);
  const today = await c.one(`SELECT count(*)::int AS n FROM farm_thefts WHERE room_id = $1 AND day = $2::date`, [roomId, istDay(now)]);
  return {
    rules: { threshold: THIEVES.threshold, bonus: THIEVES.bonus, approachS: THIEVES.approachS, stealS: THIEVES.stealS, runS: THIEVES.runS, aheadH: THIEVES.aheadH, perDay: THIEVES.perDay[0] },
    dogs: dogs.map(d => ({ id: d.id, slot: d.slot, level: d.level, fedUntil: d.fed_until ? d.fed_until.toISOString() : null })),
    list: list.map(t => ({ id: t.id, at: t.at.toISOString(), stealAt: t.steal_at.toISOString(), escapeAt: t.escape_at.toISOString(), shelter: t.shelter_id,
      wanted: t.wanted, taken: t.taken, saved: t.saved, dogLevel: t.dog_level, dogs: t.dogs, status: t.status, seed: t.seed,
      caughtBy: t.caught_by || null, caughtAt: t.caught_at ? t.caught_at.toISOString() : null })),
    seenAt: m ? (m.thefts_seen_at || m.created_at).toISOString() : null,
    dueAt: r && r.thief_due_at ? r.thief_due_at.toISOString() : null,
    today: today.n, limit: perDay(cat, best), best,
  };
}

/* ---------- actions ---------- */
// { theft } — a player's net caught the thief while he was still around: the eggs come back with 10 % more (into
// the storage; what doesn't fit goes back into the coop's nests). The world's row is locked: caught once.
export async function catchThief(c, { me, b, s, cat }) {
  const id = String(b.theft || '');
  if (!UUID_RE.test(id)) throw badInput('Which thief?');
  const t = await c.one('SELECT id, at, escape_at, taken, shelter_id, status FROM farm_thefts WHERE id = $1 AND room_id = $2 FOR UPDATE', [id, me.room_id]);
  if (!t) throw new ApiError(404, 'not_found', 'That thief was never here.');
  const now = s.now.getTime();
  if (t.status === 'caught') throw new ApiError(409, 'already_caught', 'Someone has already caught this thief.');
  if (t.status !== 'live' || now > t.escape_at.getTime() + THIEVES.graceS * 1000 || now < t.at.getTime()) throw new ApiError(409, 'got_away', 'Too late — the thief got away.');
  const back = {}, spill = {}, items = [];
  let total = 0, bonus = 0;
  for (const [p, n] of Object.entries(t.taken || {})) {
    if (!(n > 0) || !cat[p]) continue;
    const extra = Math.ceil(n * THIEVES.bonus);
    back[p] = n + extra; total += n; bonus += extra;
    const room = Math.max(0, capOf(cat, p, s.level) - (s.inv[p] || 0)), put = Math.min(back[p], room);
    s.inv[p] = (s.inv[p] || 0) + put; items.push(p);
    if (put < back[p]) spill[p] = back[p] - put;
  }
  // what didn't fit in the storage: back into the nests (that coop first)
  for (const [p, n0] of Object.entries(spill)) {
    let n = n0;
    const hens = await c.rows(`SELECT id, type, ready FROM animals WHERE room_id = $1 ORDER BY (shelter_id = $2) DESC, ready, id`, [me.room_id, t.shelter_id]);
    const ids = [], ready = [];
    for (const a of hens) {
      const k = cat[a.type];
      if (n <= 0 || !k || k.product !== p || !k.nest) continue;
      const put = Math.min(n, Math.max(0, k.nest - a.ready));
      if (put > 0) { ids.push(a.id); ready.push(a.ready + put); n -= put; }
    }
    if (ids.length) await c.rows('UPDATE animals a SET ready = v.ready FROM unnest($1::uuid[], $2::int[]) AS v(id, ready) WHERE a.id = v.id', [ids, ready]);
  }
  await c.rows(`UPDATE farm_thefts SET status = 'caught', caught_by = $2, caught_at = now() WHERE id = $1`, [id, me.id]);
  const what = Object.entries(back).map(([p, n]) => `${n} ${lower(cat[p].name)}`).join(', ');
  return { money: 0, items, detail: { theft: id, back, total, bonus },
    message: total ? `${me.name} caught the thief! Got back ${what} (${bonus} extra)` : `${me.name} caught the thief — he hadn't got a single egg` };
}

// guard dogs: { op: 'buy' } · { op: 'feed', dog, food: 'bone' | 'dog_treat' } · { op: 'train', dog, level }
export async function dogAction(c, { me, b, s, cat }) {
  const k = cat.guard_dog;
  if (!k) throw new ApiError(400, 'bad_item', 'Guard dogs are not sold yet.');
  const op = String(b.op || ''), now = s.now.getTime();
  if (op === 'buy') {
    const have = await c.rows('SELECT slot FROM farm_dogs WHERE room_id = $1', [me.room_id]);
    if (have.length >= (k.max || 2)) throw new ApiError(409, 'max_dogs', `The farm already has ${k.max || 2} guard dogs — the most it can keep.`);
    if (s.money < k.buy) throw new ApiError(409, 'not_enough_money', `Not enough money: a guard dog costs ₹${k.buy}, the farm has ₹${s.money}.`);
    const used = new Set(have.map(d => d.slot)), slot = [0, 1].find(i => !used.has(i));
    await c.rows(`INSERT INTO farm_dogs (room_id, slot, level, fed_until) VALUES ($1, $2, 1, now() + make_interval(secs => $3))`, [me.room_id, slot, (k.hours || 4) * 3600]);
    return { money: -k.buy, items: [], detail: { op, slot, cost: k.buy }, message: `${me.name} bought a guard dog (${k.breed || 'German Shepherd'}) for ₹${k.buy} — on duty for ${k.hours || 4} hours` };
  }
  const id = String(b.dog || '');
  if (!UUID_RE.test(id)) throw badInput('Which dog?');
  const d = await c.one('SELECT id, slot, level, fed_until FROM farm_dogs WHERE id = $1 AND room_id = $2 FOR UPDATE', [id, me.room_id]);
  if (!d) throw new ApiError(404, 'not_found', 'That dog is not on this farm.');
  if (op === 'feed') {
    const food = b.food === 'dog_treat' ? 'dog_treat' : 'bone', f = cat[food];
    if (!f) throw badInput('Unknown dog food.');
    if ((s.inv[food] || 0) < 1) throw new ApiError(409, 'not_enough', `No ${lower(f.name)} in the farm storage — buy some at the Farm Store (Buy feed).`);
    const hours = f.dogHours || (food === 'bone' ? 4 : 24), base = Math.max(now, d.fed_until ? d.fed_until.getTime() : 0), until = base + hours * H;
    if (until > now + THIEVES.aheadH * H + 1000) throw new ApiError(409, 'already_fed', `This dog is already on duty for ${Math.floor((base - now) / H)} hours — at most ${THIEVES.aheadH} hours ahead.`);
    s.inv[food] -= 1;
    await c.rows('UPDATE farm_dogs SET fed_until = $2 WHERE id = $1', [id, new Date(until)]);
    return { money: 0, items: [food], detail: { op, dog: id, food, hours, until: new Date(until).toISOString() },
      message: `${me.name} gave guard dog ${d.slot + 1} ${food === 'bone' ? 'a bone' : 'a treat'} — on duty ${hours} more hours` };
  }
  if (op === 'train') {
    const n = Number(b.level);
    if (!Number.isInteger(n) || n < 2 || n > 3) throw badInput('Level must be 2 or 3.');
    if (d.level >= n) throw new ApiError(409, 'already_upgraded', `Guard dog ${d.slot + 1} is already level ${d.level}.`);
    if (n !== d.level + 1) throw new ApiError(409, 'in_order', `Train it to level ${d.level + 1} first.`);
    const L = levelOf(cat, n), cost = L && L.cost;
    if (!cost) throw new ApiError(409, 'max_level', 'There is no higher level yet.');
    if (s.money < cost) throw new ApiError(409, 'not_enough_money', `Not enough money: level ${n} training costs ₹${cost}, the farm has ₹${s.money}.`);
    await c.rows('UPDATE farm_dogs SET level = $2 WHERE id = $1', [id, n]);
    return { money: -cost, items: [], detail: { op, dog: id, level: n, cost }, message: `${me.name} trained guard dog ${d.slot + 1} to level ${n} for ₹${cost}` };
  }
  throw badInput('Unknown dog action.');
}

// { } — this player has read the theft reports (they're shown once, when you come back)
export async function seenThefts(c, { me }) {
  await c.rows('UPDATE room_members SET thefts_seen_at = now() WHERE id = $1', [me.id]);
  return { money: 0, items: [], detail: {}, message: '' };
}
