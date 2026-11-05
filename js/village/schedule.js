// The villagers' day, in India time (IST, the shared clock of Farm World — js/day-night.js):
//   early morning   up with the sun: gardens, animals, water from the well, sweeping; old people walk
//   late morning    work round the houses; children play (football, games)
//   midday          lunch indoors, then rest and sit in the shade
//   afternoon       work and visiting; children play again
//   evening         walking, gathering at the square, cooking, the last feed for the animals
//   night           children home first, then the old, then the adults; the village is quiet
// What someone does next is picked from these weights (times their own preferences, js/village/ai.js), so the
// village changes naturally through the day. Everything comes from the day number and the villager, never
// from this computer's clock or random numbers, so every player sees the same day.
export const DAY = 86400;
const IST = 19800;
export const H = h => h * 3600;
// the shared clock (ms) -> day number and seconds since midnight IST
export function istClock(ms) { const s = ms / 1000 + IST; const day = Math.floor(s / DAY); return { day, sod: s - day * DAY }; }

// a random-number stream for (day, who, what): the same everywhere (integer hashing, mulberry32)
export function rng(...keys) {
  let h = 2166136261 >>> 0;
  for (const k of keys) { h = Math.imul(h ^ (k | 0), 16777619) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; }
  let s = h || 1;
  const f = (a = 0, b = 1) => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a); };
  f.int = n => Math.floor(f() * n) % n;
  f.pick = arr => arr[f.int(arr.length)];
  return f;
}

// when each villager gets up and goes to bed (seconds since midnight), and lunch
export function dayTimes(age, R) {
  if (age === 'child') return { wake: H(6.4) + R(0, 2400), bed: H(18.7) + R(0, 2700), lunch: [H(12) + R(0, 1200), R(1500, 2400)] };
  if (age === 'elder') return { wake: H(5.6) + R(0, 2400), bed: H(19.4) + R(0, 3600), lunch: [H(12.4) + R(0, 1200), R(3600, 5400)] };
  return { wake: H(5.9) + R(0, 2400), bed: H(19.9) + R(0, 5400), lunch: [H(12.2) + R(0, 1800), R(1800, 3000)] };
}

// how likely each activity is at this time of day (before the villager's own preferences)
const ADULT = [
  // [from hour, { activity: weight }]
  [5, { garden: 3, animals: 3.5, well: 2.5, sweep: 2.5, wood: 1, stroll: 0.8, cook: 1 }],
  [9, { garden: 2.5, wood: 2, hay: 1.2, line: 1.5, cook: 1, well: 1.2, shop: 1.2, stroll: 1, visit: 1, animals: 1 }],
  [12, { sit: 3, cook: 1.5, shop: 0.6, visit: 1, stroll: 0.6 }],
  [14, { garden: 2, animals: 1.5, wood: 1.2, hay: 0.8, stroll: 1.5, visit: 1.5, shop: 1, sit: 1, line: 0.6 }],
  [17, { stroll: 2, sit: 2, animals: 2, well: 1, cook: 2.2, visit: 1.2, shop: 0.5 }],
  [19, { sit: 2.5, cook: 1, stroll: 0.6 }],
];
const ELDER = [
  [5, { stroll: 3, sit: 2, garden: 1, animals: 0.6 }],
  [9, { sit: 4, stroll: 1.5, garden: 0.6, visit: 0.8 }],
  [12, { sit: 4, stroll: 0.5 }],
  [14.5, { sit: 4, stroll: 1, visit: 1 }],
  [17, { sit: 3.5, stroll: 1.2 }],
  [19, { sit: 2 }],
];
const CHILD = [
  [6, { run: 1.5, stroll: 1.5, sit: 1, help: 2, hop: 1, watch: 0.5 }],
  [8, { run: 2.5, hop: 1.5, stroll: 1.5, sit: 1, watch: 1.5, help: 0.6 }],
  [12, { sit: 2, stroll: 1, hop: 1 }],
  [13.5, { run: 2.5, hop: 1.5, stroll: 1.5, sit: 1.2, watch: 1.5 }],
  [17, { run: 2, stroll: 2, hop: 1, sit: 1, watch: 1 }],
];
const TABLE = { adult: ADULT, elder: ELDER, child: CHILD };
export function weights(age, sod) {
  const T = TABLE[age], h = sod / 3600;
  let w = T[0][1];
  for (const [from, ww] of T) if (h >= from) w = ww;
  return w;
}
// how long an activity lasts (seconds)
export const DURATION = {
  garden: [100, 260], animals: [70, 170], well: [35, 60], sweep: [60, 130], wood: [90, 210], hay: [80, 170], line: [60, 130], cook: [120, 320],
  shop: [30, 70], stroll: [8, 30], visit: [25, 70], sit: [150, 600], vend: [600, 1500],
  run: [30, 80], hop: [40, 90], help: [35, 60], watch: [60, 180],
};
export const ELDER_SIT = [400, 1300];
// walking speeds (m/s)
export const SPEED = { adult: 1.25, elder: 0.72, child: 1.15, run: 3.3, jog: 2.1 };
