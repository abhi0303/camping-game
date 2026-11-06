// The industrial machines and the farm's gold (a second, shared currency next to the rupees).
//   - Gold mine (every farm has one, level 1 to start): runs by itself 7 PM – 4 AM India time and makes a gold coin every
//     120 / 90 / 60 / 30 minutes of running (level 1–4). Coins wait in its collection box until a player collects them
//     into the farm's gold. Upgrades cost gold.
//   - Flour machine (bought once per world for 10 gold): wheat from the farm storage goes into its hopper — at most its
//     capacity per window; 10 wheat → 2 packets (level 1) or 3 packets (level 2+) of 10 kg flour. Level 1 is turned by
//     hand (a turn of 15 s grinds up to 100 wheat); from level 2 it grinds by itself. Packets wait in its tray until
//     collected into the storage.
// The rules and arithmetic are in js/farm/machines/machineProduction.js (shared with the game). Everything is worked out
// in settle() (farm.js) with the world's row locked, from the database clock, so it happens while nobody plays too, and
// two players can never collect, spend or grind the same thing twice.
import { ApiError, badInput } from './http.js';
import { MINE, FLOUR, levelOf, mineAt, flourAt, turnOf } from '../../js/farm/machines/machineProduction.js';

const H = 3600e3, MAX_OFFLINE_H = 24 * 7;
const capOf = (cat, item, level) => {
  const k = cat[item];
  if (!k || !k.cap) return Infinity;
  if (k.capStep) return k.cap + k.capStep * (level - 1);
  const mult = ((cat.storage && cat.storage.levels) || []).reduce((m, l) => (l.level <= level ? l.mult || m : m), 1);
  return k.cap * mult;
};
const row = m => ({ level: m.level, ready: m.ready, progress: m.progress, hopper: m.hopper, used: m.win_used, winStart: m.win_start ? m.win_start.getTime() : null });

/* ---------- inside settle() ---------- */
// bring the machines up to `now` (every farm gets its mine the first time). Returns true when something changed.
export async function settleMachines(c, roomId, now) {
  const t = now.getTime();
  await c.rows(`INSERT INTO farm_machines (room_id, kind, calc_at) VALUES ($1, 'mine', $2) ON CONFLICT (room_id, kind) DO NOTHING`, [roomId, now]);
  const list = await c.rows('SELECT id, kind, level, calc_at, progress, ready, hopper, win_start, win_used FROM farm_machines WHERE room_id = $1', [roomId]);
  let changed = false;
  for (const m of list) {
    const from = Math.max(m.calc_at.getTime(), t - MAX_OFFLINE_H * H);
    if (m.kind === 'mine') {
      const x = mineAt(row(m), from, t, MINE);
      if (x.ready !== m.ready) changed = true;
      await c.rows('UPDATE farm_machines SET ready = $2, progress = $3, calc_at = $4 WHERE id = $1', [m.id, x.ready, x.progress, now]);
    } else {
      const x = flourAt(row(m), from, t, FLOUR);
      if (x.ready !== m.ready) changed = true;
      await c.rows('UPDATE farm_machines SET ready = $2, progress = $3, hopper = $4, win_start = $5, win_used = $6, calc_at = $7 WHERE id = $1',
        [m.id, x.ready, x.progress, x.hopper, new Date(x.winStart), x.used, now]);
    }
  }
  return changed;
}

/* ---------- state ---------- */
export async function machinesState(c, roomId, s) {
  const list = await c.rows('SELECT kind, level, progress, ready, hopper, win_start, win_used, grind_started_at, grind_by FROM farm_machines WHERE room_id = $1', [roomId]);
  const by = Object.fromEntries(list.map(m => [m.kind, m]));
  const out = m => m && { level: m.level, ready: m.ready, progress: m.progress, hopper: m.hopper, used: m.win_used, winStart: m.win_start ? m.win_start.getTime() : null,
    grindStartedAt: m.grind_started_at ? m.grind_started_at.toISOString() : null, grindBy: m.grind_by };
  return { gold: s.gold, at: s.now.toISOString(), mine: out(by.mine) || { level: 1, ready: 0, progress: 0 }, flour: out(by.flour) || null, rules: { mine: MINE, flour: FLOUR } };
}

/* ---------- actions ---------- */
// { machine: 'mine' | 'flour', op, ... } — mine: collect, upgrade {level} · flour: buy, add {qty}, turnstart, turn, collect, upgrade {level}
export async function machineAction(c, { me, b, s, cat }) {
  const kind = b.machine === 'flour' ? 'flour' : b.machine === 'mine' ? 'mine' : null, op = String(b.op || '');
  if (!kind) throw badInput('Which machine?');
  if (kind === 'flour' && op === 'buy') {
    if (await c.one(`SELECT 1 FROM farm_machines WHERE room_id = $1 AND kind = 'flour'`, [me.room_id])) throw new ApiError(409, 'owned', 'The farm already has its flour machine.');
    if (s.gold < FLOUR.buy) throw new ApiError(409, 'not_enough_gold', `Not enough gold: the flour machine costs ${FLOUR.buy} gold coins, the farm has ${s.gold}.`);
    await c.rows(`INSERT INTO farm_machines (room_id, kind, calc_at) VALUES ($1, 'flour', now())`, [me.room_id]);
    return { money: 0, gold: -FLOUR.buy, items: [], detail: { machine: kind, op, gold: FLOUR.buy }, message: `${me.name} bought the flour machine for ${FLOUR.buy} gold coins` };
  }
  const m = await c.one('SELECT * FROM farm_machines WHERE room_id = $1 AND kind = $2 FOR UPDATE', [me.room_id, kind]);
  if (!m) throw new ApiError(409, 'not_owned', kind === 'flour' ? 'Buy the flour machine first (10 gold coins).' : 'The mine is not ready yet.');
  const R = kind === 'mine' ? MINE : FLOUR, name = kind === 'mine' ? 'the gold mine' : 'the flour machine';
  if (op === 'upgrade') {
    const level = Number(b.level), L = R.levels.find(l => l.level === level);
    if (!L || level < 2) throw badInput('Unknown level.');
    if (m.level >= level) throw new ApiError(409, 'already_upgraded', `${name[0].toUpperCase() + name.slice(1)} is already level ${m.level}.`);
    if (m.level !== level - 1) throw new ApiError(409, 'one_at_a_time', `Upgrade ${name} to level ${m.level + 1} first.`);
    if (s.gold < L.cost) throw new ApiError(409, 'not_enough_gold', `Not enough gold: level ${level} costs ${L.cost} gold coins, the farm has ${s.gold}.`);
    await c.rows('UPDATE farm_machines SET level = $2, grind_started_at = NULL, grind_by = NULL WHERE id = $1', [m.id, level]);
    return { money: 0, gold: -L.cost, items: [], detail: { machine: kind, op, level, gold: L.cost }, message: `${me.name} upgraded ${name} to level ${level} (${L.name.toLowerCase()}) for ${L.cost} gold coins` };
  }
  if (kind === 'mine') {
    if (op !== 'collect') throw badInput('Unknown mine action.');
    if (m.ready < 1) throw new ApiError(409, 'nothing_ready', 'No gold coins in the box yet — the mine works at night (7 PM – 4 AM).');
    await c.rows('UPDATE farm_machines SET ready = 0 WHERE id = $1', [m.id]);
    return { money: 0, gold: m.ready, items: [], detail: { machine: kind, op, got: m.ready }, message: `${me.name} collected ${m.ready} gold coin${m.ready > 1 ? 's' : ''} from the mine` };
  }
  // the flour machine
  const L = levelOf(FLOUR, m.level), now = s.now.getTime(), f = flourAt(row(m), now, now, FLOUR);
  if (op === 'add') {
    const qty = Number(b.qty);
    if (!Number.isInteger(qty) || qty < 10 || qty % 10) throw badInput('Put wheat in by tens (10, 20, 30…).');
    if ((s.inv.wheat || 0) < qty) throw new ApiError(409, 'not_enough', `The farm storage has only ${s.inv.wheat || 0} wheat.`);
    if (qty > f.room) throw new ApiError(409, 'capacity', f.room ? `The machine takes only ${f.room} more wheat now (${L.cap} per ${L.winMin} minutes).` : `The machine has had its ${L.cap} wheat for these ${L.winMin} minutes — more from ${new Date(f.resetAt + 19800e3).toISOString().slice(11, 16)}.`);
    s.inv.wheat -= qty;
    await c.rows('UPDATE farm_machines SET hopper = hopper + $2, win_used = $3, win_start = $4 WHERE id = $1', [m.id, qty, f.used + qty, new Date(f.winStart)]);
    return { money: 0, items: ['wheat'], detail: { machine: kind, op, qty }, message: `${me.name} put ${qty} wheat into the flour machine${L.manual ? ' — turn the millstone to grind it' : ''}` };
  }
  if (op === 'turnstart' || op === 'turn') {
    if (!L.manual) throw new ApiError(409, 'electric', 'This machine grinds by itself.');
    const t = turnOf(m.hopper, FLOUR, L);
    if (t.wheat < 10) throw new ApiError(409, 'empty', 'Put wheat into the machine first.');
    if (op === 'turnstart') {
      await c.rows('UPDATE farm_machines SET grind_started_at = now(), grind_by = $2 WHERE id = $1', [m.id, me.id]);
      return { money: 0, items: [], detail: { machine: kind, op }, message: `${me.name} started turning the millstone` };
    }
    if (m.grind_by !== me.id || !m.grind_started_at) throw new ApiError(409, 'not_turning', 'Start turning the millstone first.');
    if (now - m.grind_started_at.getTime() < (FLOUR.grindS - 1.5) * 1000) throw new ApiError(409, 'too_fast', `Keep turning — a turn takes ${FLOUR.grindS} seconds.`);
    await c.rows('UPDATE farm_machines SET hopper = hopper - $2, ready = ready + $3, grind_started_at = NULL, grind_by = NULL WHERE id = $1', [m.id, t.wheat, t.packets]);
    return { money: 0, items: [], detail: { machine: kind, op, wheat: t.wheat, packets: t.packets }, message: `${me.name} ground ${t.wheat} wheat into ${t.packets} packets of flour` };
  }
  if (op === 'collect') {
    if (f.ready < 1) throw new ApiError(409, 'nothing_ready', 'No flour packets in the tray yet.');
    const room = Math.max(0, capOf(cat, 'flour', s.level) - (s.inv.flour || 0)), take = Math.min(f.ready, room);
    if (take < 1) throw new ApiError(409, 'storage_full', `The farm storage is full of flour (${capOf(cat, 'flour', s.level)} packets). Sell some or upgrade the storage.`);
    s.inv.flour = (s.inv.flour || 0) + take;
    await c.rows('UPDATE farm_machines SET ready = ready - $2 WHERE id = $1', [m.id, take]);
    return { money: 0, items: ['flour'], detail: { machine: kind, op, got: take, left: f.ready - take },
      message: `${me.name} collected ${take} packets of flour (${take * 10} kg)` + (take < f.ready ? ` — storage full, ${f.ready - take} wait in the tray` : '') };
  }
  throw badInput('Unknown flour machine action.');
}
