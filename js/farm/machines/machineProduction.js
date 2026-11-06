// The industrial machines' rules and arithmetic, shared by the farm server (server/src/machines.js) and the game, so
// both always agree. Pure functions of the server's clock: nothing here keeps time by itself.
//   - Gold mine: runs by itself from 7 PM to 4 AM (India time), never by day; one gold coin per `min` minutes of
//     running time at its level. Unfinished work carries over to the next night.
//   - Flour machine: wheat goes into its hopper (at most `cap` wheat per capacity window of `winMin` minutes, the
//     windows aligned to the India-time clock); 10 wheat make `per10` packets of flour (10 kg each). Level 1 is turned
//     by hand: one turn of the millstone (`grindS` seconds) grinds up to `batch` wheat. From level 2 an electric motor
//     grinds the hopper by itself at `cap` wheat per window.
export const IST = 19800e3, DAY = 86400e3, H = 3600e3, MIN = 60e3;

export const MINE = {
  start: 19, end: 4,                                                    // India time: runs 19:00 → 04:00
  levels: [
    { level: 1, min: 120, name: 'Basic mining machine' },
    { level: 2, min: 90, cost: 5, name: 'Bigger hopper and motor' },
    { level: 3, min: 60, cost: 12, name: 'Two grinding stages' },
    { level: 4, min: 30, cost: 25, name: 'Industrial gold plant' },
  ],
};
export const FLOUR = {
  buy: 10, batch: 100, grindS: 15,
  levels: [
    { level: 1, manual: true, cap: 500, winMin: 60, per10: 2, name: 'Traditional stone mill' },
    { level: 2, cost: 5, cap: 500, winMin: 60, per10: 3, name: 'Electric flour machine' },
    { level: 3, cost: 10, cap: 1000, winMin: 60, per10: 3, name: 'Industrial flour machine' },
    { level: 4, cost: 18, cap: 1000, winMin: 30, per10: 3, name: 'Advanced flour machine' },
    { level: 5, cost: 30, cap: 2000, winMin: 30, per10: 3, name: 'High-capacity flour plant' },
  ],
};
export const levelOf = (R, n) => R.levels.find(l => l.level === n) || R.levels[0];

/* ---------- the mine's night shift ---------- */
// the running window that contains or follows India-time day d: [d·DAY + start, d·DAY + 24 h + end) in IST-shifted ms
const win = (R, d) => [d * DAY + R.start * H, d * DAY + (R.end + 24) * H];
export function isRunning(t, R = MINE) { const h = ((t + IST) % DAY + DAY) % DAY / H; return h >= R.start || h < R.end; }
// how much running time lies between moments a and b (ms)
export function runningMs(a, b, R = MINE) {
  if (!(b > a)) return 0;
  const A = a + IST, B = b + IST;
  let t = 0;
  for (let d = Math.floor(A / DAY) - 1; win(R, d)[0] < B; d++) { const [w0, w1] = win(R, d); t += Math.max(0, Math.min(B, w1) - Math.max(A, w0)); }
  return t;
}
// the moment `work` ms of running time will have passed after t
export function afterRunning(t, work, R = MINE) {
  const A = t + IST;
  for (let d = Math.floor(A / DAY) - 1; ; d++) {
    const [w0, w1] = win(R, d);
    if (w1 <= A) continue;
    const from = Math.max(A, w0), room = w1 - from;
    if (work <= room) return from + work - IST;
    work -= room;
  }
}
// when it next starts or stops
export function nextSwitch(t, R = MINE) {
  const A = t + IST;
  for (let d = Math.floor(A / DAY) - 1; ; d++) { const [w0, w1] = win(R, d); if (w0 > A) return w0 - IST; if (w1 > A) return w1 - IST; }
}
// the mine at `now` from what was saved at `at`: { level, ready (coins waiting), progress (share of the next coin) }
export function mineAt(m, at, now, R = MINE) {
  const L = levelOf(R, m.level), per = L.min * MIN;
  const p = (m.progress || 0) + runningMs(at, now, R) / per, whole = Math.floor(p + 1e-9);
  const progress = Math.max(0, p - whole), ready = (m.ready || 0) + whole, running = isRunning(now, R);
  return { level: L.level, ready, progress, running, perMin: L.min, perNight: (24 - R.start + R.end) * 60 / L.min,
    nextCoinAt: afterRunning(now, (1 - progress) * per, R), switchAt: nextSwitch(now, R) };
}

/* ---------- the flour machine ---------- */
// the start of the capacity window that contains t (aligned to the India-time clock)
export const windowStart = (t, L) => Math.floor((t + IST) / (L.winMin * MIN)) * L.winMin * MIN - IST;
// the machine at `now` from what was saved at `at`: { level, hopper, ready (packets waiting), progress (wheat ground
// toward the next 10), used (wheat put in this window), winStart } — an electric one has ground its hopper meanwhile
export function flourAt(f, at, now, R = FLOUR) {
  const L = levelOf(R, f.level);
  let hopper = f.hopper || 0, ready = f.ready || 0, progress = f.progress || 0;
  if (!L.manual && hopper >= 10 && now > at) {
    progress += (now - at) * L.cap / (L.winMin * MIN);
    const tens = Math.min(Math.floor(hopper / 10), Math.floor(progress / 10 + 1e-9));
    hopper -= tens * 10; ready += tens * L.per10; progress -= tens * 10;
    if (hopper < 10) progress = 0;                                    // (nothing left to grind: no time banked)
  }
  const ws = windowStart(now, L), used = f.winStart === ws ? f.used || 0 : 0;
  const room = Math.max(0, Math.min(L.cap - used, L.cap - hopper));
  const rate = L.manual ? 0 : L.cap / (L.winMin * MIN);
  return { level: L.level, manual: !!L.manual, hopper, ready, progress, used, winStart: ws, resetAt: ws + L.winMin * MIN, room, cap: L.cap, per10: L.per10,
    grinding: !L.manual && hopper >= 10, doneAt: rate && hopper >= 10 ? now + (hopper - progress) / rate : null, nextAt: rate && hopper >= 10 ? now + (10 - progress) / rate : null };
}
// what a turn of the hand mill grinds (wheat, packets)
export const turnOf = (hopper, R = FLOUR, L = levelOf(R, 1)) => { const w = Math.min(R.batch, Math.floor(hopper / 10) * 10); return { wheat: w, packets: w / 10 * L.per10 }; };
