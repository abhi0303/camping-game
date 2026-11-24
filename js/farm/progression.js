// The farm's long game, shared by the farm server (server/src/progress.js, farm.js) and the game, so both always
// agree. Pure functions and tables, nothing keeps time here.
//   - Farm level and XP: almost everything the farm does earns XP (selling, orders, eggs, harvests, fish, gold,
//     building and upgrading…). A level needs its XP and its missions (2–3 tasks picked for the farm, sized to the
//     level); then a player levels the farm up and gets the reward. Levels never run out (each needs a bit more).
//     New levels unlock animals, sheds and their upgrades, storage levels, fields and soils (catalog `minLevel`).
//   - Animals grow with care: every hour an animal is fed counts; at 6 / 20 / 48 / 100 hours it reaches care level
//     2–5 and makes 10 / 20 / 35 / 50 % more. Sheds have levels too (more room, a little more production).
//   - The Market's demand: selling a lot of one thing at once pushes its price down (to 35 % at the lowest), and it
//     recovers by half every 3 hours. Customer orders always pay the full price and more — they're the farm's best
//     buyers. Gold coins can be sold there too.

/* ---------- farm level ---------- */
// XP from level n to n + 1 (100, 303, 580, 919, 1313 … 3981 at 10 … 12068 at 20)
export const xpNeed = n => Math.round(100 * Math.pow(Math.max(1, n), 1.6));
// the reward for reaching level n
export const levelReward = n => ({ money: 150 * n, gold: Math.floor(n / 2) });
// a level from all the XP ever earned (worlds from before the farm level start at the level their sales earned them)
export function levelForXp(total, cap = Infinity) {
  let n = 1;
  while (n < cap && total >= xpNeed(n)) { total -= xpNeed(n); n++; }
  return { level: n, xp: Math.floor(total) };
}

// XP for an action, from what the server did (detail) — the same for every player of the world
export function xpFor(action, d = {}) {
  const k = d.op || '';
  switch (action) {
    case 'sell': return Math.floor((d.pay || 0) / 20);
    case 'order': return 25 + Math.floor((d.pay || 0) / 20);
    case 'collect': return Math.ceil((d.total || 0) / 4);
    case 'feed': return Math.ceil((d.fed || 0) / 2);
    case 'reel': return d.caught ? ({ fish_small: 2, fish_medium: 4, fish_large: 8 }[d.fish] || 2) : 0;
    case 'field': return k === 'harvest' ? Math.floor((d.got || 0) / 25) : k === 'sow' ? 5 : k === 'water' ? 2 : k === 'buy' ? 30 : k === 'soil' ? 50 : 0;
    case 'machine': return k === 'collect' ? (d.machine === 'mine' ? 3 * (d.got || 0) : Math.floor((d.got || 0) / 10)) : k === 'upgrade' || k === 'buy' ? 40 : 0;
    case 'build': return 30;
    case 'upgrade': return 40 + 10 * (d.level || 1);
    case 'buy': return d.animal ? 3 * (d.qty || 1) : 0;
    case 'rent': return 10 + Math.floor((d.pay || 0) / 20);
    case 'dog': return k === 'buy' ? 20 : k === 'train' ? 30 : 0;
    case 'rod': return 20;
    default: return 0;
  }
}
// what an action adds to the farm's counters (missions count these): { stat: n }
export function statsFor(action, d = {}) {
  const k = d.op || '', s = {};
  if (action === 'sell') s.sold = d.pay || 0;
  if (action === 'order') { s.orders = 1; s.sold = d.pay || 0; }
  if (action === 'collect') s.eggs = d.total || 0;
  if (action === 'feed') s.feed = d.fed || 0;
  if (action === 'reel' && d.caught) s.fish = 1;
  if (action === 'field' && k === 'harvest') s.wheat = d.got || 0;
  if (action === 'machine' && k === 'collect') s[d.machine === 'mine' ? 'gold' : 'flour'] = d.got || 0;
  if (action === 'upgrade' || (action === 'machine' && k === 'upgrade') || (action === 'field' && k === 'soil') || (action === 'dog' && k === 'train')) s.upgrades = 1;
  if (action === 'rent') s.rentals = 1;
  if (action === 'buy' && d.animal) s.animals = d.qty || 1;
  return s;
}

/* ---------- missions ---------- */
// each level's tasks. `stat`: a counter that has to grow by n while the level lasts; `have`: something the farm has
// to have. `needs`: only for a farm that can do it (what it has when the level starts)
const r10 = v => Math.max(10, Math.round(v / 10) * 10), r50 = v => Math.max(50, Math.round(v / 50) * 50);
export const MISSIONS = {
  eggs:    { stat: 'eggs', text: n => `Collect ${n} eggs from the nests`, n: L => r10(25 + 25 * L), needs: f => f.hens },
  sold:    { stat: 'sold', text: n => `Earn ₹${n} selling at the Market`, n: L => r50(200 * Math.pow(L, 1.35)) },
  orders:  { stat: 'orders', text: n => `Deliver ${n} customer order${n > 1 ? 's' : ''}`, n: L => 1 + Math.floor(L / 3) },
  fish:    { stat: 'fish', text: n => `Catch ${n} fish at the docks`, n: L => 2 + L },
  feed:    { stat: 'feed', text: n => `Feed your animals ${n} times`, n: L => 8 + 6 * L, needs: f => f.animals > 0 },
  milk:    { stat: 'milk', text: n => `Get ${n} milk from your goats and cows`, n: L => 4 + 3 * L, needs: f => f.milkers },
  wheat:   { stat: 'wheat', text: n => `Harvest ${n} wheat`, n: L => r50(250 + 100 * L), needs: f => f.fields },
  flour:   { stat: 'flour', text: n => `Make ${n} packets of flour`, n: L => r10(40 + 15 * L), needs: f => f.flour },
  gold:    { stat: 'gold', text: n => `Collect ${n} gold coins from the mine`, n: L => 2 + Math.floor(L / 2), needs: f => f.level >= 3 },
  upgrade: { stat: 'upgrades', text: () => 'Upgrade something: a shed, the storage, a field\'s soil, a machine or a dog', n: L => (L >= 8 ? 2 : 1), needs: f => f.level >= 2 },
  rent:    { stat: 'rentals', text: n => `Rent out horses ${n} time${n > 1 ? 's' : ''}`, n: L => 1 + Math.floor(L / 6), needs: f => f.horses },
  animals: { have: 'animals', text: n => `Have ${n} animals on the farm`, n: L => 3 + 2 * L },
};
// the first levels teach the farm; later ones are picked for the farm (2 at levels 2–4, then 3)
const FIRST = { 1: ['eggs', 'sold'], 2: ['feed', 'fish'], 3: ['orders', 'animals'] };
function prng(seed) { let s = (Math.abs(seed) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const hashStr = t => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return h >>> 0; };
// the missions for level L of a farm (f: { level, hens, animals, milkers, fields, flour, horses }), each with the
// counter's value now (base) — progress is counted from there
export function makeMissions(L, f, stats = {}, seedText = '') {
  let kinds = FIRST[L];
  if (!kinds) {
    const r = prng(hashStr(seedText + ':' + L)), pool = Object.keys(MISSIONS).filter(k => !MISSIONS[k].needs || MISSIONS[k].needs({ ...f, level: L }));
    kinds = [];
    while (kinds.length < Math.min(L <= 4 ? 2 : 3, pool.length)) { const k = pool[Math.floor(r() * pool.length)]; if (!kinds.includes(k)) kinds.push(k); }
  }
  return kinds.map(k => ({ k, n: MISSIONS[k].n(L), b: MISSIONS[k].stat ? stats[MISSIONS[k].stat] || 0 : 0 }));
}
// how far a mission is (have: { animals }) -> { text, n, got, done }
export function missionProgress(m, stats = {}, have = {}) {
  const M = MISSIONS[m.k];
  if (!M) return { text: m.k, n: m.n, got: m.n, done: true };
  const got = M.stat ? (stats[M.stat] || 0) - (m.b || 0) : have[M.have] || 0;
  return { k: m.k, text: M.text(m.n), n: m.n, got: Math.max(0, Math.min(m.n, Math.floor(got))), done: got >= m.n };
}

/* ---------- animals: care levels ---------- */
// hours fed to reach each care level, and how much more it makes there
export const CARE = { hours: [0, 6, 20, 48, 100], mult: [1, 1.1, 1.2, 1.35, 1.5], max: 5 };
export function careLevel(hours) { let n = 1; while (n < CARE.max && hours >= CARE.hours[n]) n++; return n; }
export const careMult = level => CARE.mult[Math.max(1, Math.min(CARE.max, level)) - 1];
// hours still to go to the next care level (Infinity at the top)
export const careToNext = (hours, level) => (level >= CARE.max ? Infinity : Math.max(0, CARE.hours[level] - hours));

/* ---------- sheds: levels ---------- */
// a shed's level (catalog data.levels: [{ level, capacity, bonus, money, wood, stone, gold, minLevel }])
export const shedLevel = (k, level) => {
  const list = (k && k.levels) || [];
  return list.find(l => l.level === level) || { level: 1, capacity: k ? k.capacity : 0, bonus: 1 };
};
export const shedCapacity = (k, level) => shedLevel(k, level).capacity || (k && k.capacity) || 0;
export const shedBonus = (k, level) => shedLevel(k, level).bonus || 1;

/* ---------- the Market's demand ---------- */
export const MARKET = {
  floor: 0.35, halfH: 3,                    // the lowest price (share of the normal one), recovery half-life (hours)
  demand: { egg: 150, egg_brown: 90, egg_dark: 50, egg_gold: 20, goat_milk: 30, cow_milk: 24, cow_milk_bw: 20, cow_milk_black: 14, fish_small: 40, fish_medium: 24, fish_large: 12, flour: 300, wood: 400, stone: 400, gold: 20 },
  gold: 90,                                 // ₹ for a gold coin (before its demand drops)
};
// the load left from earlier sales at a moment (it halves every halfH hours)
export const loadNow = (load, atMs, nowMs) => (load > 0 ? load * Math.pow(0.5, Math.max(0, nowMs - atMs) / (MARKET.halfH * 3600e3)) : 0);
export const demandOf = item => MARKET.demand[item] || 200;
// the price share now, and what selling qty of an item pays (each unit sold pushes the price down a little)
export const priceShare = (item, load) => Math.max(MARKET.floor, 1 - load / demandOf(item));
export function salePay(item, base, load, qty) {
  const D = demandOf(item), f = MARKET.floor, atFloor = Math.max(0, Math.ceil(D * (1 - f) - load));
  const k = Math.min(qty, atFloor);                       // units sold above the floor: an arithmetic run
  let sum = 0;
  if (k > 0) { const first = 1 - load / D, last = 1 - (load + k - 1) / D; sum += base * (first + last) / 2 * k; }
  sum += base * f * (qty - k);
  return Math.floor(sum + 1e-6);
}
