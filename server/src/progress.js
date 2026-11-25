// The farm level: XP, counters and this level's missions (the rules and tables are in js/farm/progression.js,
// shared with the game). Everything runs inside the farm's transactions with the world's row locked.
//   - settle() (farm.js) loads the progress; a world from before the farm level gets its level from what it has
//     earned (as if every ₹20 of sales had been 1 XP, at most level 12) — and at least the level of everything it
//     already keeps (cows: 4, horses: 5, Black hens: 6…), so it can still buy and build what it already has — and its
//     first missions.
//   - After every action farm.js adds the XP and counters the action earned (xpFor / statsFor).
//   - { action: 'levelup', level }: with the XP and every mission done, the farm goes up a level: its reward
//     (money and gold), the leftover XP carried over, the next level's missions.
import { ApiError } from './http.js';
import { xpNeed, levelReward, levelForXp, xpFor, statsFor, makeMissions, missionProgress } from '../../js/farm/progression.js';

const isHen = t => t.startsWith('chicken'), isMilker = t => t === 'goat' || t.startsWith('cow'), isHorse = t => t.startsWith('horse');
// what the farm has now (missions are picked from what it can do)
async function facts(c, roomId, level) {
  const a = await c.rows('SELECT type FROM animals WHERE room_id = $1', [roomId]);
  const f = await c.one(`SELECT (SELECT count(*)::int FROM farm_fields WHERE room_id = $1) AS fields,
      EXISTS (SELECT 1 FROM farm_machines WHERE room_id = $1 AND kind = 'flour') AS flour`, [roomId]);
  return { level, animals: a.length, hens: a.some(x => isHen(x.type)), milkers: a.some(x => isMilker(x.type)), horses: a.some(x => isHorse(x.type)),
    fields: f.fields > 0, flour: f.flour };
}

// the lowest farm level that allows everything the world keeps (its animals, its sheds and their levels, the storage)
async function ownedLevel(c, roomId, cat, storageLevel) {
  let n = 1;
  const lv = k => (k && k.minLevel) || 1;
  for (const a of await c.rows('SELECT DISTINCT type FROM animals WHERE room_id = $1', [roomId])) n = Math.max(n, lv(cat[a.type]));
  for (const b of await c.rows('SELECT DISTINCT type, level FROM buildings WHERE room_id = $1', [roomId])) {
    const k = cat[b.type];
    n = Math.max(n, lv(k), lv(((k && k.levels) || []).find(l => l.level === b.level)));
  }
  return Math.max(n, lv(((cat.storage && cat.storage.levels) || []).find(l => l.level === storageLevel)));
}
// from the world's row (r: farm_level, xp, xp_total, stats, missions, total_earned, storage_level): the progress, made
// the first time (cat: the catalog)
export async function loadProgress(c, roomId, r, cat = {}) {
  const P = { level: r.farm_level, xp: Number(r.xp), total: Number(r.xp_total), stats: r.stats || {}, missions: r.missions, dirty: false };
  if (!P.missions) {
    if (P.level === 1 && P.total === 0) {                   // a world from before the farm level (or a brand-new one)
      const from = Math.floor(Number(r.total_earned || 0) / 20), L = levelForXp(from, 12), own = await ownedLevel(c, roomId, cat, r.storage_level || 1);
      P.total = from;
      if (own > L.level) { P.level = own; P.xp = 0; } else { P.level = L.level; P.xp = L.xp; }
    }
    P.missions = makeMissions(P.level, await facts(c, roomId, P.level), P.stats, roomId);
    P.dirty = true;
  }
  return P;
}
// the world's columns that hold it (farm.js writes them together with the money after an action)
export const progressCols = P => ({ farm_level: P.level, xp: P.xp, xp_total: P.total, stats: JSON.stringify(P.stats), missions: JSON.stringify(P.missions) });
export async function saveProgress(c, roomId, P) {
  if (!P.dirty) return;
  const v = progressCols(P);
  await c.rows('UPDATE rooms SET farm_level = $2, xp = $3, xp_total = $4, stats = $5, missions = $6 WHERE id = $1',
    [roomId, v.farm_level, v.xp, v.xp_total, v.stats, v.missions]);
  P.dirty = false;
}
// counters grow (milk made while nobody played, an action's eggs, sales…)
export function bump(P, add) {
  for (const [k, v] of Object.entries(add)) if (v) { P.stats[k] = (P.stats[k] || 0) + v; P.dirty = true; }
}
// after an action: its XP and counters. Returns the XP earned.
export function earn(P, action, detail) {
  const xp = xpFor(action, detail || {});
  bump(P, statsFor(action, detail || {}));
  if (xp > 0) { P.xp += xp; P.total += xp; P.dirty = true; }
  return xp;
}

// the farm level as the game sees it (have: { animals })
export function progressState(P, have) {
  const missions = P.missions.map(m => missionProgress(m, P.stats, have)), need = xpNeed(P.level);
  return { level: P.level, xp: P.xp, need, total: P.total, stats: P.stats, missions,
    ready: P.xp >= need && missions.every(m => m.done), reward: levelReward(P.level + 1) };
}

// { level } — the level asked for (two players pressing at once level up once)
export async function levelUp(c, { me, b, s }) {
  const P = s.prog, want = Number(b.level);
  if (!Number.isInteger(want) || want < 2) throw new ApiError(400, 'bad_input', 'Which level?');
  if (P.level >= want) throw new ApiError(409, 'already_done', `The farm is already level ${P.level}.`);
  if (want !== P.level + 1) throw new ApiError(409, 'one_at_a_time', `Reach level ${P.level + 1} first.`);
  const have = { animals: (await c.one('SELECT count(*)::int AS n FROM animals WHERE room_id = $1', [me.room_id])).n };
  const st = progressState(P, have), need = xpNeed(P.level);
  if (P.xp < need) throw new ApiError(409, 'need_xp', `Level ${want} needs ${need} XP — the farm has ${P.xp}.`);
  const todo = st.missions.filter(m => !m.done);
  if (todo.length) throw new ApiError(409, 'missions', `Finish this level's missions first: ${todo.map(m => m.text.toLowerCase()).join('; ')}.`);
  const reward = levelReward(want);
  P.xp -= need; P.level = want; P.dirty = true;
  P.missions = makeMissions(want, await facts(c, me.room_id, want), P.stats, me.room_id);
  return { money: reward.money, gold: reward.gold, items: [], detail: { level: want, reward },
    message: `⭐ ${me.name} levelled the farm up to level ${want}! Reward: ₹${reward.money}${reward.gold ? ` and ${reward.gold} gold coin${reward.gold > 1 ? 's' : ''}` : ''}` };
}
