// Horses: six colours (the catalog's horse_* rows), bought as a baby (Level 1, catalog `foal` price) or grown
// (Level 10, `buy` price). A horse grows one level for every 2 hours it is fed (`grow` levels an hour, worked
// out with production in farm.js), up to Level 10. Level 10 horses can be rented out: now and then a customer
// asks for 1 or 2 horses (sometimes a certain colour) for a few hours; a player hands them over at the Market,
// the farm is paid at once, and the horses come back by themselves when the time is up. Horses can be sold at
// any level (more for older and rarer ones). Rental requests are made lazily when the farm is opened.
import { ApiError, badInput } from './http.js';

export const HORSES = {
  maxLevel: 10,
  sellFoal: 0.7,            // a horse sells for 70 % of the baby price at Level 1 …
  sellAdult: 0.8,           // … rising to 80 % of the grown price at Level 10
  everyMin: [60, 120],      // minutes between rental requests (while there are free Level 10 horses)
  offerMin: 60,             // a request waits this long for someone to hand the horses over
  hours: [1, 2, 2, 2, 3, 4],
  twoHorses: 0.35,          // chance a request is for 2 horses (when the farm has 2 free)
  colour: 0.4,              // chance a request asks for a certain colour …
  colourExtra: 0.2,         // … and pays this much more for it
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RENTERS = [['Ravi', 'for a wedding procession'], ['Priya', 'for a trail ride in the hills'], ['Arjun', 'for the village fair'],
  ['Meera', 'for a photo shoot'], ['Kabir', 'to carry supplies up the pass'], ['Anaya', 'for riding lessons'], ['Rohan', 'for a film shoot'],
  ['Isha', 'for the festival parade'], ['Vikram', 'for a polo practice'], ['Sana', 'for a birthday party']];
const lower = s => s.toLowerCase();
function rand() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
const pick = list => list[Math.floor(rand() * list.length)];

export const isHorse = k => !!(k && k.grow);
// what a horse sells for at a level
export function horsePrice(k, level) {
  const lo = k.foal * HORSES.sellFoal, hi = k.buy * HORSES.sellAdult;
  return Math.round(lo + (hi - lo) * (Math.min(HORSES.maxLevel, Math.max(1, level)) - 1) / (HORSES.maxLevel - 1));
}
// Level 10 horses at home (not out on rent), the healthiest first
async function freeHorses(c, roomId, cat, nowDate) {
  const list = await c.rows(`SELECT id, type, health FROM animals WHERE room_id = $1 AND level >= $2 AND (rented_until IS NULL OR rented_until <= $3)
      ORDER BY health DESC, born_at, id`, [roomId, HORSES.maxLevel, nowDate]);
  return list.filter(a => isHorse(cat[a.type]));
}

// end requests nobody took and rentals whose time is up; make a new request when one is due
export async function ensureRentals(c, roomId, cat, s) {
  const now = s.now;
  await c.rows(`UPDATE horse_rentals SET status = 'expired' WHERE room_id = $1 AND status = 'offer' AND expires_at <= $2`, [roomId, now]);
  await c.rows(`UPDATE horse_rentals SET status = 'done' WHERE room_id = $1 AND status = 'active' AND returns_at <= $2`, [roomId, now]);
  if (await c.one(`SELECT 1 FROM horse_rentals WHERE room_id = $1 AND status = 'offer'`, [roomId])) return;
  const r = await c.one('SELECT next_rental_at FROM rooms WHERE id = $1', [roomId]);
  if (r && r.next_rental_at && r.next_rental_at > now) return;
  const free = await freeHorses(c, roomId, cat, now);
  if (!free.length) return;                     // asked again as soon as a horse is ready
  const n = free.length >= 2 && rand() < HORSES.twoHorses ? 2 : 1;
  let variety = null;
  if (rand() < HORSES.colour) {
    const counts = {};
    for (const a of free) counts[a.type] = (counts[a.type] || 0) + 1;
    const fits = Object.keys(counts).filter(t => counts[t] >= n);
    if (fits.length) variety = pick(fits);
  }
  const hours = pick(HORSES.hours);
  // any colour pays the common rate; a certain colour pays its own rate and a little more
  const base = variety ? cat[variety].rent * (1 + HORSES.colourExtra) : Math.min(...Object.values(cat).filter(isHorse).map(k => k.rent));
  const pay = Math.max(1, Math.round(base * hours / 2 * n));
  const [renter, purpose] = pick(RENTERS);
  await c.rows(`INSERT INTO horse_rentals (room_id, renter, purpose, horses, variety, hours, pay, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz + make_interval(mins => $9))`, [roomId, renter, purpose, n, variety, hours, pay, now, HORSES.offerMin]);
  await c.rows(`UPDATE rooms SET next_rental_at = $2::timestamptz + make_interval(mins => $3) WHERE id = $1`, [roomId, now, Math.round(HORSES.everyMin[0] + rand() * (HORSES.everyMin[1] - HORSES.everyMin[0]))]);
}

export async function rentalsState(c, roomId, s) {
  const list = await c.rows(`SELECT h.id, h.renter, h.purpose, h.horses, h.variety, h.hours, h.pay, h.status, h.expires_at, h.returns_at, m.name AS by
      FROM horse_rentals h LEFT JOIN room_members m ON m.id = h.accepted_by
      WHERE h.room_id = $1 AND ((h.status = 'offer' AND h.expires_at > $2) OR (h.status = 'active' AND h.returns_at > $2)) ORDER BY h.created_at`, [roomId, s.now]);
  return list.map(h => ({ id: h.id, renter: h.renter, purpose: h.purpose, horses: h.horses, variety: h.variety, hours: h.hours, pay: h.pay, status: h.status,
    expiresAt: h.expires_at.toISOString(), returnsAt: h.returns_at ? h.returns_at.toISOString() : null, by: h.by }));
}

// { offer } — hand the horses over: the farm is paid now, the horses are away (and looked after) until they return
export async function rent(c, { me, b, s, cat }) {
  const id = String(b.offer || '');
  if (!UUID_RE.test(id)) throw badInput('Pick a rental request.');
  const o = await c.one(`SELECT id, renter, horses, variety, hours, pay, status, expires_at FROM horse_rentals WHERE id = $1 AND room_id = $2 FOR UPDATE`, [id, me.room_id]);
  if (!o) throw new ApiError(404, 'not_found', 'That request is not for this farm.');
  if (o.status === 'active' || o.status === 'done') throw new ApiError(409, 'already_done', `${o.renter} already has the horses.`);
  if (o.status !== 'offer' || o.expires_at <= s.now) throw new ApiError(409, 'expired', `${o.renter} found horses somewhere else.`);
  // the asked-for colour; for "any horse" the plainest go first (rarer ones wait for requests that pay for them)
  const free = (await freeHorses(c, me.room_id, cat, s.now)).filter(a => !o.variety || a.type === o.variety)
    .sort((x, y) => cat[x.type].rent - cat[y.type].rent);
  if (free.length < o.horses) {
    const what = o.variety ? lower(cat[o.variety].name) : 'horse';
    throw new ApiError(409, 'no_horses', `${o.renter} needs ${o.horses} Level ${HORSES.maxLevel} ${what}${o.horses > 1 ? 's' : ''} at home — you have ${free.length}.`);
  }
  const ids = free.slice(0, o.horses).map(a => a.id);
  await c.rows(`UPDATE animals SET rented_until = $2::timestamptz + make_interval(hours => $3),
      fed_until = GREATEST(COALESCE(fed_until, $2::timestamptz), $2::timestamptz + make_interval(hours => $3)) WHERE id = ANY($1::uuid[])`, [ids, s.now, o.hours]);
  await c.rows(`UPDATE horse_rentals SET status = 'active', accepted_at = $2, returns_at = $2::timestamptz + make_interval(hours => $3), horse_ids = $4, accepted_by = $5
      WHERE id = $1`, [id, s.now, o.hours, ids, me.id]);
  return { money: o.pay, earned: o.pay, items: [], detail: { offer: id, horses: ids, pay: o.pay, hours: o.hours },
    message: `${me.name} handed ${o.horses} horse${o.horses > 1 ? 's' : ''} to ${o.renter} for ${o.hours} h — ₹${o.pay}` };
}

// { animal } — sell a horse (not one that is out on rent)
export async function sellHorse(c, { me, b, s, cat }) {
  const id = String(b.animal || '');
  if (!UUID_RE.test(id)) throw badInput('Pick a horse.');
  const a = await c.one(`SELECT id, type, level, rented_until FROM animals WHERE id = $1 AND room_id = $2 FOR UPDATE`, [id, me.room_id]);
  if (!a) throw new ApiError(404, 'not_found', 'That horse is not on this farm.');
  const k = cat[a.type];
  if (!isHorse(k)) throw new ApiError(400, 'bad_item', 'Only horses can be sold.');
  if (a.rented_until && a.rented_until > s.now) throw new ApiError(409, 'on_rent', 'That horse is out on rent — sell it when it is back.');
  const price = horsePrice(k, a.level);
  await c.rows('DELETE FROM animals WHERE id = $1', [id]);
  return { money: price, earned: price, items: [], detail: { animal: id, type: a.type, level: a.level, price },
    message: `${me.name} sold a Level ${a.level} ${lower(k.name)} for ₹${price}` };
}
