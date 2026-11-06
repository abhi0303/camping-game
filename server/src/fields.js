// Crop fields by the windmill, scarecrows, and the farmer's outfit.
//   - Six fields (slots 0–5) round the big windmill. A field is bought once (catalog 'field'); then it goes round:
//     empty → sowing (a player walks over it scattering seeds; at least `sowS` seconds) → sown (one seed bag of
//     its crop is used) → growing (watered for `water` rupees; ready after `growH` hours) → harvest → empty again.
//   - Crops come from the catalog (kind 'crop': its seed bag, product, timings and yield), so more crops (vegetables…)
//     are new catalog rows plus their models in the game — this file doesn't change.
//   - Birds eat from a field without a scarecrow: the harvest is decided when it's first taken — 70–90 % of the full
//     yield (350–450 of 500 wheat) with no scarecrow, 80–90 % with a level 1 scarecrow, all of it with level 2. The
//     harvest goes into the farm storage up to its limit; what doesn't fit stays in the field until there's room.
//   - Outfits (catalog kind 'outfit') belong to the member who bought them (with the farm's money) and are worn by
//     them; everyone sees them in the game.
import { ApiError, badInput } from './http.js';

export const FIELDS = { slots: 6 };
const H = 3600e3;
const lower = s => s.toLowerCase();
function rand() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
const slotOf = v => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n >= FIELDS.slots) throw badInput(`Field must be 1 to ${FIELDS.slots}.`); return n; };
const capOf = (cat, item, level) => {
  const k = cat[item];
  if (!k || !k.cap) return Infinity;
  if (k.capStep) return k.cap + k.capStep * (level - 1);
  const mult = ((cat.storage && cat.storage.levels) || []).reduce((m, l) => (l.level <= level ? l.mult || m : m), 1);
  return k.cap * mult;
};
// the crop a seed bag grows, or the crop by its id
const cropOf = (cat, id) => { const k = cat['crop_' + id]; return k && k.kind === 'crop' ? { id, ...k } : null; };
const scareLevels = cat => (cat.scarecrow && cat.scarecrow.levels) || [{ level: 1, share: [0.8, 0.9] }, { level: 2, cost: 800, share: [1, 1] }];
// the share of the full yield that's left after the birds, by scarecrow level (0: none)
export function birdShare(cat, level, r = rand) {
  const L = level ? scareLevels(cat).find(l => l.level === level) : null, s = L ? L.share : (cat.scarecrow && cat.scarecrow.none) || [0.7, 0.9];
  return s[0] + (s[1] - s[0]) * r();
}

/* ---------- state ---------- */
export async function fieldsState(c, roomId, s, cat, me) {
  if (!cat.field) return null;
  const list = await c.rows(`SELECT slot, crop, stage, sow_started_at, sow_by, sown_at, watered_at, ready_at, yield, harvested, scarecrow, bought_at
      FROM farm_fields WHERE room_id = $1 ORDER BY slot`, [roomId]);
  const iso = d => (d ? d.toISOString() : null);
  const w = me ? await c.one('SELECT outfits, outfit FROM room_members WHERE id = $1', [me.id]) : null;
  return {
    slots: FIELDS.slots,
    list: list.map(f => ({ slot: f.slot, crop: f.crop, stage: f.stage, sowStartedAt: iso(f.sow_started_at), sowBy: f.sow_by, sownAt: iso(f.sown_at),
      wateredAt: iso(f.watered_at), readyAt: iso(f.ready_at), yield: f.yield, harvested: f.harvested, scarecrow: f.scarecrow })),
    wardrobe: w ? { owned: w.outfits || [], wearing: w.outfit || null } : null,
  };
}

/* ---------- actions ---------- */
// { op: buy | sowstart | sow | water | harvest | scarecrow, slot, crop?, level? }
export async function fieldAction(c, { me, b, s, cat }) {
  const F = cat.field;
  if (!F) throw new ApiError(400, 'bad_item', 'Fields are not sold yet.');
  const op = String(b.op || ''), slot = slotOf(b.slot), n = slot + 1, now = s.now.getTime();
  if (op === 'buy') {
    if (await c.one('SELECT 1 FROM farm_fields WHERE room_id = $1 AND slot = $2', [me.room_id, slot])) throw new ApiError(409, 'field_taken', `Field ${n} already belongs to the farm.`);
    if (s.money < F.buy) throw new ApiError(409, 'not_enough_money', `Not enough money: a field costs ₹${F.buy}, the farm has ₹${s.money}.`);
    await c.rows('INSERT INTO farm_fields (room_id, slot) VALUES ($1, $2)', [me.room_id, slot]);
    return { money: -F.buy, items: [], detail: { op, slot, cost: F.buy }, message: `${me.name} bought field ${n} by the windmill for ₹${F.buy}` };
  }
  const f = await c.one('SELECT * FROM farm_fields WHERE room_id = $1 AND slot = $2 FOR UPDATE', [me.room_id, slot]);
  if (!f) throw new ApiError(409, 'not_owned', `Field ${n} isn't the farm's yet — buy it first.`);
  if (op === 'scarecrow') {                                      // buy one (level 1) or train it up (level 2)
    const k = cat.scarecrow;
    if (!k) throw new ApiError(400, 'bad_item', 'Scarecrows are not sold yet.');
    const level = Number(b.level || 1), L = scareLevels(cat).find(l => l.level === level);
    if (!L) throw badInput('Unknown scarecrow level.');
    if (f.scarecrow >= level) throw new ApiError(409, 'already_upgraded', level === 1 ? `Field ${n} already has a scarecrow.` : `Field ${n}'s scarecrow is already level ${f.scarecrow}.`);
    if (f.scarecrow !== level - 1) throw new ApiError(409, 'need_scarecrow', `Field ${n} needs a scarecrow first.`);
    const cost = level === 1 ? k.buy : L.cost;
    if (s.money < cost) throw new ApiError(409, 'not_enough_money', `Not enough money: ₹${cost} needed, the farm has ₹${s.money}.`);
    await c.rows('UPDATE farm_fields SET scarecrow = $2 WHERE id = $1', [f.id, level]);
    return { money: -cost, items: [], detail: { op, slot, level, cost },
      message: level === 1 ? `${me.name} put up a scarecrow in field ${n} for ₹${cost}` : `${me.name} dressed up field ${n}'s scarecrow to level ${level} for ₹${cost}` };
  }
  if (op === 'sowstart') {                                       // a player starts walking the field with seeds
    if (f.stage !== 'empty' && f.stage !== 'sowing') throw new ApiError(409, 'busy', `Field ${n} is already ${f.stage === 'sown' ? 'sown — water it' : 'growing'}.`);
    const crop = cropOf(cat, String(b.crop || 'wheat'));
    if (!crop) throw badInput('Unknown crop.');
    if ((s.inv[crop.seed] || 0) < 1) throw new ApiError(409, 'no_seeds', `No ${lower(cat[crop.seed].name)} in the farm storage — buy some at the Farm Store (₹${cat[crop.seed].buy}).`);
    await c.rows(`UPDATE farm_fields SET stage = 'sowing', crop = $2, sow_started_at = now(), sow_by = $3 WHERE id = $1`, [f.id, crop.id, me.id]);
    return { money: 0, items: [], detail: { op, slot, crop: crop.id }, message: `${me.name} started sowing ${lower(crop.name)} in field ${n}` };
  }
  if (op === 'sow') {                                            // done walking it: the seeds are in
    const crop = cropOf(cat, f.crop || 'wheat');
    if (f.stage !== 'sowing' || !crop) throw new ApiError(409, 'not_sowing', `Start sowing field ${n} first.`);
    if (f.sow_by !== me.id) throw new ApiError(409, 'not_yours', 'Someone else is sowing this field.');
    if (now - f.sow_started_at.getTime() < ((crop.sowS || 10) - 1.5) * 1000) throw new ApiError(409, 'too_fast', 'Walk all over the field scattering the seeds first.');
    if ((s.inv[crop.seed] || 0) < 1) throw new ApiError(409, 'no_seeds', `No ${lower(cat[crop.seed].name)} left in the farm storage.`);
    s.inv[crop.seed] -= 1;
    await c.rows(`UPDATE farm_fields SET stage = 'sown', sown_at = now() WHERE id = $1`, [f.id]);
    return { money: 0, items: [crop.seed], detail: { op, slot, crop: crop.id }, message: `${me.name} sowed field ${n} with ${lower(crop.name)} — now water it` };
  }
  if (op === 'water') {
    const crop = cropOf(cat, f.crop || 'wheat');
    if (f.stage !== 'sown' || !crop) throw new ApiError(409, 'not_sown', f.stage === 'growing' ? `Field ${n} is already watered and growing.` : `Sow field ${n} first.`);
    const cost = crop.water || 20;
    if (s.money < cost) throw new ApiError(409, 'not_enough_money', `Not enough money: watering costs ₹${cost}, the farm has ₹${s.money}.`);
    const ready = new Date(now + (crop.growH || 2) * H);
    await c.rows(`UPDATE farm_fields SET stage = 'growing', watered_at = now(), ready_at = $2, yield = NULL, harvested = 0 WHERE id = $1`, [f.id, ready]);
    return { money: -cost, items: [], detail: { op, slot, cost, readyAt: ready.toISOString() },
      message: `${me.name} watered field ${n} for ₹${cost} — the ${lower(crop.name)} is ready in ${crop.growH || 2} hours` };
  }
  if (op === 'harvest') {
    const crop = cropOf(cat, f.crop || 'wheat');
    if (f.stage !== 'growing' || !crop) throw new ApiError(409, 'nothing', `Nothing is growing in field ${n}.`);
    if (now < f.ready_at.getTime()) throw new ApiError(409, 'not_ready', `Field ${n} isn't ready yet.`);
    // the birds' share is decided the first time the field is harvested (with the scarecrow it has then)
    let total = f.yield;
    if (total === null) total = Math.round((crop.yield || 500) * birdShare(cat, f.scarecrow));
    const p = crop.product, room = Math.max(0, capOf(cat, p, s.level) - (s.inv[p] || 0)), want = total - f.harvested, take = Math.min(want, room);
    if (take <= 0) throw new ApiError(409, 'storage_full', `The farm storage has no room for more ${lower(cat[p].name)} (it holds ${capOf(cat, p, s.level)}). Upgrade the storage.`);
    s.inv[p] = (s.inv[p] || 0) + take;
    const done = f.harvested + take >= total;
    if (done) await c.rows(`UPDATE farm_fields SET stage = 'empty', crop = NULL, yield = NULL, harvested = 0, sow_started_at = NULL, sow_by = NULL, sown_at = NULL, watered_at = NULL, ready_at = NULL WHERE id = $1`, [f.id]);
    else await c.rows('UPDATE farm_fields SET yield = $2, harvested = $3 WHERE id = $1', [f.id, total, f.harvested + take]);
    const lost = (crop.yield || 500) - total;
    return { money: 0, items: [p], detail: { op, slot, got: take, total, left: total - f.harvested - take, lost },
      message: `${me.name} harvested ${take} ${lower(cat[p].name)} from field ${n}` + (lost > 0 && f.yield === null ? ` (birds ate ${lost})` : '') + (done ? '' : ` — storage full, ${total - f.harvested - take} wait in the field`) };
  }
  throw badInput('Unknown field action.');
}

// { op: buy | wear | off, item }: outfits are the buyer's own
export async function outfitAction(c, { me, b, s, cat }) {
  const op = String(b.op || ''), item = String(b.item || ''), k = cat[item];
  const m = await c.one('SELECT outfits, outfit FROM room_members WHERE id = $1 FOR UPDATE', [me.id]);
  const owned = m.outfits || [];
  if (op === 'off') {
    await c.rows('UPDATE room_members SET outfit = NULL WHERE id = $1', [me.id]);
    return { money: 0, items: [], detail: { op }, message: `${me.name} changed back into their own clothes` };
  }
  if (!k || k.kind !== 'outfit') throw badInput('Unknown outfit.');
  if (op === 'buy') {
    if (owned.includes(item)) throw new ApiError(409, 'owned', `You already have the ${lower(k.name)}.`);
    if (s.money < k.buy) throw new ApiError(409, 'not_enough_money', `Not enough money: the ${lower(k.name)} costs ₹${k.buy}, the farm has ₹${s.money}.`);
    await c.rows('UPDATE room_members SET outfits = array_append(outfits, $2), outfit = $2 WHERE id = $1', [me.id, item]);
    return { money: -k.buy, items: [], detail: { op, item, cost: k.buy }, message: `${me.name} bought the ${lower(k.name)} for ₹${k.buy} and put it on` };
  }
  if (op === 'wear') {
    if (!owned.includes(item)) throw new ApiError(409, 'not_owned', `Buy the ${lower(k.name)} first.`);
    await c.rows('UPDATE room_members SET outfit = $2 WHERE id = $1', [me.id, item]);
    return { money: 0, items: [], detail: { op, item }, message: `${me.name} put on the ${lower(k.name)}` };
  }
  throw badInput('Unknown outfit action.');
}
