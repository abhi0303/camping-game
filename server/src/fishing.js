// Fishing: worms, rods (one per member, upgraded with the farm's money), casts and catches.
// The server decides what bites (from the player's rod), and a catch only counts when the server replays
// the player's pull / release log through the same challenge the game runs (js/fishing/sim.js) and it lands
// the fish — and not faster than the server's own clock allows. Every cast pays out at most once.
import { ApiError, badInput } from './http.js';
import { FISH, RODS, GIVE_UP, rollCast, runChallenge, cleanLog } from '../../js/fishing/sim.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPOTS = 8;                 // fishing spots along the river (the game has 3 today)
const LATE_MS = 180000;          // a catch must be reported within 3 minutes of the bite
const SLACK_MS = 1500;           // network / clock allowance when checking how long a challenge took
const lower = s => s.toLowerCase();

function rand() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}
export async function rodLevel(c, memberId) {
  const r = await c.one('SELECT rod_level FROM room_members WHERE id = $1', [memberId]);
  return r ? r.rod_level : 1;
}

// { spot } — one worm goes on the hook; the answer says when (and whether) something bites
export async function cast(c, { me, b, s, cat }) {
  const spot = Number(b.spot);
  if (!Number.isInteger(spot) || spot < 0 || spot >= SPOTS) throw badInput('Pick a fishing spot.');
  if ((s.inv.worms || 0) < 1) throw new ApiError(409, 'no_worms', 'You need worms to start fishing. Buy them at the Fish Market.');
  const full = Object.keys(FISH).filter(f => cat[f] && cat[f].cap && (s.inv[f] || 0) >= capOf(cat, f, s.level));
  if (full.length === Object.keys(FISH).length) throw new ApiError(409, 'storage_full', 'The fish storage is full — sell some fish at the Fish Market first.');
  const rod = await rodLevel(c, me.id);
  // one line in the water per player: an older cast still open is given up
  await c.rows(`UPDATE fishing_casts SET status = 'escaped', ended_at = now() WHERE member_id = $1 AND status = 'open'`, [me.id]);
  const roll = rollCast(rod, rand);
  const row = await c.one(`INSERT INTO fishing_casts (room_id, member_id, spot, rod, fish, weight, seed, pulls, bite_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::int IS NULL THEN NULL ELSE now() + make_interval(secs => $9::int / 1000.0) END)
      RETURNING id, bite_at, now() AS now`, [me.room_id, me.id, spot, rod, roll.fish, roll.weight, roll.seed, roll.pulls, roll.biteMs]);
  s.inv.worms -= 1;
  const detail = { cast: row.id, spot, rod, fish: roll.fish, pulls: roll.pulls, seed: roll.seed,
    biteAt: row.bite_at ? row.bite_at.toISOString() : null, giveUpAt: new Date(row.now.getTime() + GIVE_UP).toISOString() };
  return { money: 0, items: ['worms'], detail, message: `${me.name} cast a line` };
}

// { cast, log } — the pull / release log of the challenge (also sent when the fish escaped)
export async function reel(c, { me, b, s, cat }) {
  const id = String(b.cast || '');
  if (!UUID_RE.test(id)) throw badInput('Unknown cast.');
  const row = await c.one(`SELECT id, fish, weight, seed, pulls, rod, bite_at, status, now() AS now FROM fishing_casts
      WHERE id = $1 AND member_id = $2 FOR UPDATE`, [id, me.id]);
  if (!row) throw new ApiError(404, 'not_found', 'That cast is not yours.');
  if (row.status !== 'open') throw new ApiError(409, 'already_done', row.status === 'caught' ? 'That fish is already in the farm storage.' : 'That fish already got away.');
  const finish = (status, caught, why, message) => c.rows('UPDATE fishing_casts SET status = $2, ended_at = now() WHERE id = $1', [id, status])
    .then(() => ({ money: 0, items: caught ? [row.fish] : [], detail: { cast: id, caught, fish: caught ? row.fish : null, weight: caught ? row.weight : 0, value: caught ? (cat[row.fish].sell || 0) : 0, why }, message }));
  const log = cleanLog(b.log);
  if (!log) throw badInput('Bad fishing log.');
  if (!row.fish || !row.bite_at) return finish('escaped', false, 'nothing', `${me.name} caught nothing`);
  const res = runChallenge({ seed: row.seed, fish: row.fish, rod: row.rod, pulls: row.pulls }, log);
  const since = row.now.getTime() - row.bite_at.getTime();
  // a catch is only real if it was played: the replay must land the fish, and not faster than the clock allows
  if (!res.ok) return finish('escaped', false, res.why, `${me.name}'s fish escaped`);
  if (since + SLACK_MS < res.t) return finish('escaped', false, 'too_fast', `${me.name}'s fish escaped`);
  if (since > LATE_MS) return finish('escaped', false, 'timeout', `${me.name}'s fish escaped`);
  const cap = capOf(cat, row.fish, s.level);
  if ((s.inv[row.fish] || 0) >= cap) return finish('lost', false, 'storage_full', `${me.name} caught a fish but the fish storage was full`);
  s.inv[row.fish] = (s.inv[row.fish] || 0) + 1;
  const k = cat[row.fish];
  return finish('caught', true, 'caught', `${me.name} caught a ${lower(k.name)} (${row.weight} kg, ₹${k.sell})`);
}

// { level } — buy the next rod level for yourself with the farm's money (the level asked for, so a double
// click buys once)
export async function buyRod(c, { me, b, s, cat }) {
  const level = Number(b.level);
  const levels = (cat.rod && cat.rod.levels) || [];
  const L = levels.find(l => l.level === level);
  if (!Number.isInteger(level) || !L || level < 2) throw badInput('Unknown rod.');
  const have = await rodLevel(c, me.id);
  if (have >= level) throw new ApiError(409, 'already_owned', `You already have the ${RODS[have].name}.`);
  if (level !== have + 1) throw new ApiError(409, 'locked', `Get the ${RODS[level - 1].name} first.`);
  if (s.money < L.price) throw new ApiError(409, 'not_enough_money', `The ${RODS[level].name} costs ₹${L.price}; the farm has ₹${s.money}.`);
  await c.rows('UPDATE room_members SET rod_level = $2 WHERE id = $1', [me.id, level]);
  return { money: -L.price, items: [], detail: { level, cost: L.price }, message: `${me.name} bought the ${RODS[level].name} for ₹${L.price}` };
}

// the farm's fishing record (for the Fish Market's collection) and this member's rod
export async function fishingState(c, roomId, memberId) {
  const caught = {}, best = {};
  for (const r of await c.rows(`SELECT fish, count(*)::int AS n, max(weight) AS w FROM fishing_casts WHERE room_id = $1 AND status = 'caught' GROUP BY fish`, [roomId])) {
    caught[r.fish] = r.n; best[r.fish] = Math.round(r.w * 100) / 100;
  }
  const mine = await c.one(`SELECT count(*)::int AS n FROM fishing_casts WHERE member_id = $1 AND status = 'caught'`, [memberId]);
  return { rod: await rodLevel(c, memberId), caught, best, mine: mine ? mine.n : 0 };
}

// same storage limit rule as the farm (catalog cap × storage level multiplier)
function capOf(cat, item, level) {
  const mult = ((cat.storage && cat.storage.levels) || []).reduce((m, l) => (l.level <= level ? l.mult || m : m), 1);
  return cat[item] && cat[item].cap ? cat[item].cap * mult : Infinity;
}
