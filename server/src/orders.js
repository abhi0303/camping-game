// Market orders: customers ask the farm for a mix of goods it can make (eggs, milk, fish), paying 10 % more
// than the normal price. One order at a time; after one is delivered the next arrives 30–60 minutes later, at
// most 3 a day. A day ends at midnight India time (IST) for everyone in the world. Delivering at least one
// order a day for 5 days in a row pays a ₹200 bonus on the 5th day (and the 10th, 15th…); a missed day starts
// the streak again. Orders are made lazily when the farm is opened (no timers needed on the server).
import { ApiError, badInput } from './http.js';

export const ORDERS = {
  perDay: 3,                 // orders a day
  extra: 0.10,               // paid on top of the normal selling price
  gapMin: [30, 60],          // minutes until the next order after one is delivered
  streakDays: 5,             // a bonus every this many days in a row
  bonus: 200,                // ₹ streak bonus
  hours: [1.5, 3],           // an order asks for about this many hours of the farm's output
  fish: { fish_small: [3, 6], fish_medium: [2, 4], fish_large: [1, 2] },   // how many of each fish an order asks for
};
const IST = 5.5 * 3600e3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMERS = ['Sharma Sweets', 'Hotel Kaveri', 'Gupta Dhaba', 'Mrs. Iyer', 'Green Leaf Café', 'Patel Bakery', 'Mountain View Resort',
  'Raju\'s Tea Stall', 'Village School Canteen', 'Mehta Caterers', 'Sunrise Dairy Shop', 'Fisherman\'s Kitchen'];
const lower = s => s.toLowerCase();

// the India-time calendar day of a moment, and when it ends
export const istDay = ms => new Date(ms + IST).toISOString().slice(0, 10);
export function istDayEnd(ms) { const d = new Date(ms + IST); d.setUTCHours(24, 0, 0, 0); return d.getTime() - IST; }
const dayBefore = day => new Date(Date.parse(day + 'T00:00:00Z') - 86400e3).toISOString().slice(0, 10);

function rand() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
const between = ([a, b], r = rand) => a + (b - a) * r();
const shuffle = (list, r = rand) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
const capOf = (cat, item, level) => {
  const mult = ((cat.storage && cat.storage.levels) || []).reduce((m, l) => (l.level <= level ? l.mult || m : m), 1);
  return cat[item] && cat[item].cap ? cat[item].cap * mult : Infinity;
};

// what the farm can make today: { item: per hour } from its animals, and the fish its members can catch
export function makeable(cat, animals, rodMax) {
  const perH = {};
  for (const a of animals) {
    const k = cat[a.type];
    if (k && k.product && k.rate && cat[k.product] && cat[k.product].sell) perH[k.product] = (perH[k.product] || 0) + k.rate;
  }
  // fish the members' rods catch easily: small with any rod, medium from the Steel rod, large with the Fibre rod
  const fish = Object.keys(ORDERS.fish).filter(f => cat[f] && cat[f].sell && rodMax >= { fish_small: 1, fish_medium: 2, fish_large: 3 }[f]);
  return { perH, fish };
}
// a new order: 2–3 different goods (1–2 when the farm makes little), sized to a few hours of output
export function makeOrder(cat, animals, rodMax, level = 1, r = rand) {
  const { perH, fish } = makeable(cat, animals, rodMax);
  const produce = shuffle(Object.keys(perH), r), catches = shuffle(fish.slice(), r);
  let picks;
  if (!produce.length) picks = catches.slice(0, r() < 0.5 ? 2 : 1);          // no animals yet: fish only
  else {
    // the farm's own produce first; a kind of fish fills up a small farm's order (and sometimes a bigger one)
    picks = produce.slice(0, Math.min(produce.length, r() < 0.4 ? 3 : 2));
    if (catches.length && picks.length < 3 && (picks.length < 2 || r() < 0.3)) picks.push(catches[0]);
  }
  const items = picks.map(item => {
    let qty;
    if (ORDERS.fish[item]) qty = Math.round(between(ORDERS.fish[item], r));
    else qty = Math.round(perH[item] * between(ORDERS.hours, r));
    qty = Math.max(cat[item].sell >= 10 ? 1 : 2, Math.min(qty, Math.floor(capOf(cat, item, level) / 2)));
    return { item, qty };
  });
  const value = items.reduce((t, x) => t + cat[x.item].sell * x.qty, 0);
  return { items, value, pay: Math.ceil(value * (1 + ORDERS.extra)), customer: CUSTOMERS[Math.floor(r() * CUSTOMERS.length)] };
}

async function farmMakes(c, roomId) {
  const animals = await c.rows('SELECT type FROM animals WHERE room_id = $1', [roomId]);
  const rod = await c.one('SELECT COALESCE(max(rod_level), 1)::int AS r FROM room_members WHERE room_id = $1', [roomId]);
  return { animals, rodMax: rod ? rod.r : 1 };
}
async function addOrder(c, roomId, cat, s, day, n, availableMs) {
  const { animals, rodMax } = await farmMakes(c, roomId);
  const o = makeOrder(cat, animals, rodMax, s.level);
  await c.rows(`INSERT INTO farm_orders (room_id, day, n, customer, items, pay, available_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (room_id, day, n) DO NOTHING`, [roomId, day, n, o.customer, JSON.stringify(o.items), o.pay, new Date(availableMs)]);
}

// today's first order exists; yesterday's open orders are over. Runs with the world's row locked.
export async function ensureOrders(c, roomId, cat, s) {
  const now = s.now.getTime(), day = istDay(now);
  await c.rows(`UPDATE farm_orders SET status = 'expired' WHERE room_id = $1 AND status = 'open' AND day < $2::date`, [roomId, day]);
  const first = await c.one('SELECT 1 FROM farm_orders WHERE room_id = $1 AND day = $2::date LIMIT 1', [roomId, day]);
  if (!first) await addOrder(c, roomId, cat, s, day, 1, now);
}

// the streak as it stands now: days in a row with a delivered order (0 if a day was missed)
function streakNow(row, day) {
  const last = row.order_streak_day;
  if (!last || (last !== day && last !== dayBefore(day))) return { days: 0, today: false };
  return { days: row.order_streak, today: last === day };
}

export async function ordersState(c, roomId, s) {
  const now = s.now.getTime(), day = istDay(now);
  const list = await c.rows(`SELECT o.id, o.n, o.customer, o.items, o.pay, o.status, o.available_at, o.done_at, m.name AS done_by
      FROM farm_orders o LEFT JOIN room_members m ON m.id = o.done_by WHERE o.room_id = $1 AND o.day = $2::date ORDER BY o.n`, [roomId, day]);
  const r = await c.one(`SELECT order_streak, order_streak_day::text AS order_streak_day FROM rooms WHERE id = $1`, [roomId]);
  return {
    day, endsAt: new Date(istDayEnd(now)).toISOString(), perDay: ORDERS.perDay, extra: ORDERS.extra, bonus: ORDERS.bonus, streakDays: ORDERS.streakDays,
    streak: streakNow(r, day),
    list: list.map(o => ({ id: o.id, n: o.n, customer: o.customer, items: o.items, pay: o.pay, status: o.status,
      availableAt: o.available_at.toISOString(), doneAt: o.done_at ? o.done_at.toISOString() : null, doneBy: o.done_by })),
  };
}

// { order } — deliver an order from the farm storage (all of it at once). The world's row is locked, so two
// players delivering at the same moment deliver it once.
export async function deliver(c, { me, b, s, cat }) {
  const id = String(b.order || '');
  if (!UUID_RE.test(id)) throw badInput('Pick an order.');
  const o = await c.one(`SELECT id, day::text AS day, n, customer, items, pay, status, available_at FROM farm_orders WHERE id = $1 AND room_id = $2 FOR UPDATE`, [id, me.room_id]);
  if (!o) throw new ApiError(404, 'not_found', 'That order is not on this farm.');
  const now = s.now.getTime(), day = istDay(now);
  if (o.status === 'done') throw new ApiError(409, 'already_done', 'That order has already been delivered.');
  if (o.status === 'expired' || o.day !== day) throw new ApiError(409, 'expired', 'That order ended at midnight.');
  if (o.available_at.getTime() > now) throw new ApiError(409, 'not_yet', 'That order hasn\'t arrived yet.');
  const missing = o.items.filter(x => (s.inv[x.item] || 0) < x.qty).map(x => `${x.qty - (s.inv[x.item] || 0)} ${lower(cat[x.item].name)}`);
  if (missing.length) throw new ApiError(409, 'not_enough', `Still needed: ${missing.join(', ')}.`);
  for (const x of o.items) s.inv[x.item] -= x.qty;
  await c.rows(`UPDATE farm_orders SET status = 'done', done_at = now(), done_by = $2 WHERE id = $1`, [id, me.id]);
  // the streak: the first order of a day counts; every 5th day in a row pays the bonus
  const r = await c.one(`SELECT order_streak, order_streak_day::text AS order_streak_day FROM rooms WHERE id = $1`, [me.room_id]);
  let streak = r.order_streak, bonus = 0;
  if (r.order_streak_day !== day) {
    streak = r.order_streak_day === dayBefore(day) ? streak + 1 : 1;
    if (streak % ORDERS.streakDays === 0) bonus = ORDERS.bonus;
    await c.rows('UPDATE rooms SET order_streak = $2, order_streak_day = $3::date WHERE id = $1', [me.room_id, streak, day]);
  }
  // the next order of the day comes a little later
  if (o.n < ORDERS.perDay) await addOrder(c, me.room_id, cat, s, day, o.n + 1, now + between(ORDERS.gapMin) * 60e3);
  const what = o.items.map(x => `${x.qty} ${lower(cat[x.item].name)}`).join(', ');
  return {
    money: o.pay + bonus, earned: o.pay, items: o.items.map(x => x.item),
    detail: { order: id, n: o.n, pay: o.pay, bonus, streak, customer: o.customer },
    message: `${me.name} delivered ${o.customer}'s order (${what}) for ₹${o.pay}` + (bonus ? ` — 🔥 ${streak}-day streak bonus ₹${bonus}!` : ''),
  };
}
