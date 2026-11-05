// Things villagers do together, planned for the whole day from the day number (so every player's game plans
// the same day): two adults meeting for a chat on a lane, at a garden gate or on the square (three of them in
// the evening); two old people talking on a bench; children playing football, tag, a clapping game sitting in a
// ring, or walking somewhere together; old people watching the football. Each plan says who, when, and where
// everyone stands; js/village/ai.js makes everybody walk there in time (or wait for the other one).
// Football is played for real on the village green: the ball is kicked, rolls and slows down (it never jumps),
// the nearest child runs to it and kicks it on — passes, dribbles, shots, goals, a cheer, a kick back to the
// middle. The match is worked out play by play from the session's own random numbers, once, and then any
// moment of it can be looked up.
import { rng, H } from './schedule.js';
import { dist2 } from './navigation.js';

/* ---------- planning the day ---------- */
// C: { npcs: [{ age, wake, bed, lunch: [start, length] }], field, talkSpots: [{ node, x, z, tx, tz }],
//      squareSpots: [same], gates: [same, per house], benchPairs: [[seatA, seatB]], fieldSeats: [seat], playAreas: [{ x, z, r, field }], nav }
export function planDay(C, day) {
  const R = rng(day, 7001), plans = [], busy = C.npcs.map(() => []);
  const BUF = { child: 100, adult: 150, elder: 240 };
  const free = (i, a, b) => {
    const n = C.npcs[i], buf = BUF[n.age];
    if (a < n.wake + 900 || b > n.bed - 900) return false;
    if (b + buf > n.lunch[0] - 300 && a - buf < n.lunch[0] + n.lunch[1] + 300) return false;
    for (const [x, y] of busy[i]) if (b + buf > x && a - buf < y) return false;
    return true;
  };
  const take = (who, a, b) => { for (const i of who) busy[i].push([a, b]); };
  const pickFree = (age, a, b, k, not = []) => {
    const out = [], order = C.npcs.map((_, i) => i).filter(i => (Array.isArray(age) ? age.includes(C.npcs[i].age) : C.npcs[i].age === age) && !not.includes(i));
    for (let j = order.length - 1; j > 0; j--) { const r = R.int(j + 1); [order[j], order[r]] = [order[r], order[j]]; }
    for (const i of order) { if (out.length >= k) break; if (free(i, a, b)) out.push(i); }
    return out;
  };
  const areaBusy = [];
  const areaFree = (A, a, b) => !areaBusy.some(([x, y, z]) => x === A && b + 30 > y && a - 30 < z);
  // football: two or three sessions a day, 3–5 children each, and an old person or two watching
  if (C.field) for (const [w0, w1, p] of [[H(7.2), H(9.1), 0.75], [H(10), H(12), 0.95], [H(15), H(18.2), 1]]) {
    if (R() > p) continue;
    const dur = R(18 * 60, 32 * 60), t0 = w0 + R(0, Math.max(0, w1 - w0 - dur)), t1 = t0 + dur;
    const kids = pickFree('child', t0 - 60, t1 + 30, 3 + R.int(3));
    if (kids.length < 3) continue;
    const session = { t0, t1, kids, seed: (day * 31 + Math.floor(t0)) | 0 };
    const at = formation(kids.length).map(([lx, lz], j) => ({ pt: C.field.at(lx, lz), yaw: C.field.yawTo(0, 0, lx, lz), node: C.field.node }));
    plans.push({ kind: 'football', t0, t1, members: kids, at, session });
    take(kids, t0 - 60, t1 + 30);
    areaBusy.push([C.field.area, t0 - 120, t1 + 60]);
    // watchers on the bench by the pitch
    const nW = R.int(3);
    for (let w = 0; w < nW && w < C.fieldSeats.length; w++) {
      const a = t0 + R(60, 360), b = Math.min(t1 - R(0, 240), a + R(300, 1200));
      if (b - a < 240) continue;
      const who = pickFree(w === 0 ? 'elder' : ['elder', 'adult'], a - 30, b + 30, 1);
      if (!who.length) continue;
      const S = C.fieldSeats[w];
      plans.push({ kind: 'watch', t0: a, t1: b, members: who, at: [{ pt: [S.x, S.z], yaw: S.yaw, node: S.node, seat: S }], reserve: [[S.id, a, b]] });
      take(who, a - 30, b + 30);
    }
  }
  // children's games through the day
  for (let t = H(7.4); t < H(18.4); t += R(420, 900)) {
    if (R() > 0.75) continue;
    const kind = R.pick(['chase', 'chase', 'circle', 'circle', 'walk']);
    if (kind === 'walk') {
      const kids = pickFree('child', t - 30, t + 240, 2);
      if (kids.length < 2) continue;
      const walk = walkPlan(C, R, t, kids, 'child');
      if (!walk) continue;
      plans.push(walk); take(kids, walk.t0 - 30, walk.t1 + 20);
      continue;
    }
    const dur = kind === 'chase' ? R(90, 200) : R(150, 330), n = kind === 'chase' ? 2 + R.int(2) : 3 + R.int(2);
    const areas = C.playAreas.filter(A => areaFree(A, t, t + dur));
    if (!areas.length) continue;
    const A = R.pick(areas), kids = pickFree('child', t - 30, t + dur + 20, n);
    if (kids.length < 2) continue;
    if (kind === 'chase') {
      const chase = { cx: A.x, cz: A.z, rx: A.r * 0.85, rz: A.r * 0.62, rot: R(0, 6.28), n: kids.length, t0: t };
      chase.w = 2.6 / (0.72 * Math.sqrt(chase.rx * chase.rx + 2.25 * chase.rz * chase.rz));
      const at = kids.map((_, j) => { const p = chasePos(chase, j, 0); return { pt: [p.x, p.z], yaw: 0, node: A.node }; });
      plans.push({ kind: 'chase', t0: t, t1: t + dur, members: kids, at, chase });
    } else {
      const at = kids.map((_, j) => { const a = j / kids.length * Math.PI * 2 + R(0, 0.3); return { pt: [A.x + Math.sin(a) * 0.8, A.z + Math.cos(a) * 0.8], yaw: a + Math.PI, node: A.node }; });
      plans.push({ kind: 'circle', t0: t, t1: t + dur, members: kids, at, seed: R.int(1000) });
    }
    take(kids, t - 30, t + dur + 20); areaBusy.push([A, t, t + dur]);
  }
  // adults meeting for a chat (three on the square in the evening), old people walking together
  for (let t = H(6.6); t < H(20.4); t += R(150, 330)) {
    const h = t / 3600, p = h < 12 ? 0.32 : h < 14 ? 0.25 : h < 17 ? 0.42 : h < 19.6 ? 0.62 : 0.3;
    if (R() > p) continue;
    const dur = R(45, 150);
    const trio = h > 17 && h < 19.5 && R() < 0.35;
    const who = pickFree(R() < 0.82 ? 'adult' : ['adult', 'elder'], t - 30, t + dur + 20, trio ? 3 : 2);
    if (who.length < 2) continue;
    let at;
    if (who.length === 3 || R() < 0.25) { const Q = R.pick(C.squareSpots); at = ring(Q, who.length); }
    else if (R() < 0.6) { const G = C.gates[C.npcs[who[0]].home]; at = pair(G); }
    else { const Q = R.pick(C.talkSpots); at = pair(Q); }
    plans.push({ kind: 'talk', t0: t, t1: t + dur, members: who, at, seed: R.int(1000) });
    take(who, t - 30, t + dur + 20);
  }
  for (let t = H(7); t < H(19.2); t += R(480, 1100)) {
    if (R() > 0.55) continue;
    if (R() < 0.3) {   // a slow walk together
      const who = pickFree('elder', t - 60, t + 400, 2);
      if (who.length < 2) continue;
      const walk = walkPlan(C, R, t, who, 'elder');
      if (walk) { plans.push(walk); take(who, walk.t0 - 60, walk.t1 + 30); }
      continue;
    }
    const dur = R(240, 560), who = pickFree('elder', t - 60, t + dur + 30, 2);
    if (who.length < 2 || !C.benchPairs.length) continue;
    const pairs = C.benchPairs.filter(([a, b]) => !plans.some(P => P.reserve && P.reserve.some(([id, x, y]) => (id === a.id || id === b.id) && t + dur > x && t < y)));
    if (!pairs.length) continue;
    const [A, B] = R.pick(pairs);
    plans.push({ kind: 'talkSit', t0: t, t1: t + dur, members: who, at: [{ pt: [A.x, A.z], yaw: A.yaw, node: A.node, seat: A }, { pt: [B.x, B.z], yaw: B.yaw, node: B.node, seat: B }], reserve: [[A.id, t, t + dur], [B.id, t, t + dur]], seed: R.int(1000) });
    take(who, t - 60, t + dur + 30);
  }
  plans.sort((a, b) => a.t0 - b.t0);
  return plans;
}
// two people facing each other along the lane at a spot; three in a ring
function pair(Q) {
  const yaw = Math.atan2(Q.tx, Q.tz);
  return [{ pt: [Q.x - Q.tx * 0.55, Q.z - Q.tz * 0.55], yaw, node: Q.node }, { pt: [Q.x + Q.tx * 0.55, Q.z + Q.tz * 0.55], yaw: yaw + Math.PI, node: Q.node }];
}
function ring(Q, n) { return Array.from({ length: n }, (_, j) => { const a = j / n * Math.PI * 2 + 0.4; return { pt: [Q.x + Math.sin(a) * 0.7, Q.z + Math.cos(a) * 0.7], yaw: a + Math.PI, node: Q.node }; }); }
// two children (or two old people) meet at a waypoint and walk to another together, side by side
function walkPlan(C, R, t, who, age) {
  const nav = C.nav, starts = C.talkSpots;
  const A = R.pick(starts), B = R.pick(starts);
  if (A.node === B.node || !nav.reachable(A.node, B.node)) return null;
  const line = nav.polyline(A.node, B.node), speed = age === 'elder' ? 0.62 : 1.05;
  if (line.len < 15 || line.len > 90) return null;
  const meet = 15, t1 = t + meet + line.len / speed;
  const nx = -line.pts[1][1] + line.pts[0][1], nz = line.pts[1][0] - line.pts[0][0], nl = Math.hypot(nx, nz) || 1;
  const at = who.map((_, j) => ({ pt: [A.x + nx / nl * (j ? 0.38 : -0.38), A.z + nz / nl * (j ? 0.38 : -0.38)], yaw: Math.atan2(line.pts[1][0] - line.pts[0][0], line.pts[1][1] - line.pts[0][1]), node: A.node }));
  return { kind: 'walk', t0: t, t1, members: who, at, walk: { line, meet, speed, end: B.node }, age };
}

/* ---------- tag: one runs, the other chases; when caught they swap and run the other way ---------- */
const PHASE = 9;
function chasePos(c, j, tau, out = {}) {
  // the track parameter of the runner and the chaser, phase by phase
  let lead = 0, fol = -1.4, dir = 1, leader = 0;
  const k = Math.floor(tau / PHASE), tp = tau - k * PHASE;
  for (let i = 0; i < k; i++) {
    // at the end of a phase the chaser has caught up (0.25 behind); they swap and turn round
    const leadEnd = lead + dir * PHASE, folEnd = leadEnd - dir * 0.25;
    lead = folEnd; fol = leadEnd; dir = -dir; leader = 1 - leader;
  }
  const lp = lead + dir * tp;
  let fp;
  if (k === 0) fp = lp - dir * (1.4 - 1.15 * tp / PHASE);
  else { const hold = Math.min(tp, 1); fp = tp < 1 ? fol : lp + dir * (1.25 - 1.0 * (tp - hold) / (PHASE - 1)); }
  const role = j === leader ? 0 : j === 1 - leader ? 1 : 2;
  const u = role === 0 ? lp : role === 1 ? fp : fp - dir * 1.1;
  const th = u * c.w, lx = c.rx * Math.sin(th), lz = c.rz * Math.sin(1.5 * th + 0.6), cr = Math.cos(c.rot), sr = Math.sin(c.rot);
  out.x = c.cx + lx * cr + lz * sr; out.z = c.cz - lx * sr + lz * cr;
  out.tag = k > 0 && tp < 1 && role === 1;          // just caught: stands a second
  out.chasing = role !== 0;
  return out;
}
export { chasePos };

/* ---------- football ---------- */
// the field (local: x along the pitch, the goals at x = ±HL, z across)
export const PITCH = { HL: 6.5, HW: 4.0, GOAL: 1.1 };
const DECEL = 2.6, PARK = [PITCH.HL - 0.6, PITCH.GOAL + 1.1];
function formation(n) {
  const A = [[-2.3, -1.5], [2.3, 1.5], [-2.3, 1.7], [2.3, -1.7], [-4.6, 0], [4.6, 0]];
  return A.slice(0, n);
}
const clampF = (x, z, m = 0.6) => [Math.max(-PITCH.HL + m, Math.min(PITCH.HL - m, x)), Math.max(-PITCH.HW + m, Math.min(PITCH.HW - m, z))];
// work out a whole session: returns { plays, kids, end } (all in pitch coordinates)
export function simulateFootball(session, speeds) {
  const R = rng(session.seed, 3301), n = session.kids.length, plays = [];
  const team = j => (j % 2 === 0 ? 1 : -1);                  // +1 attacks +x, -1 attacks -x
  let pos = formation(n).map(p => p.slice()), ball = PARK.slice(), t = session.t0 + 1.2, restAt = t;
  let mode = 'restart', kicker = nearest(pos, ball);
  const vRun = j => speeds[j] * 1.0, vJog = j => speeds[j] * 0.58;
  let guard = 0;
  while (guard++ < 2000) {
    const last = t > session.t1 - 9;
    const g = team(kicker);
    // what the kicker does with it
    let target, goal = false, shot = false;
    if (last) { target = PARK.slice(); mode = 'park'; }
    else if (mode === 'restart') target = [R(-0.6, 0.6), R(-0.8, 0.8)];
    else if (ball[0] * g > PITCH.HL - 4.2 && R() < 0.4) {
      shot = true; const z = R(-2.6, 2.6);
      goal = Math.abs(z) < PITCH.GOAL - 0.2 && R() < 0.75;
      if (!goal && Math.abs(z) < PITCH.GOAL + 0.5) { target = clampF(g * (PITCH.HL - 0.9), z * 0.5 + R(-0.6, 0.6)); shot = false; }   // saved / blocked: it stops in front of the goal
      if (shot || goal) target = [g * (PITCH.HL + (goal ? 0.65 : 0.25)), goal ? z : Math.sign(z) * Math.max(Math.abs(z), PITCH.GOAL + 0.5)];
    } else {
      const mates = []; for (let j = 0; j < n; j++) if (j !== kicker && team(j) === g) mates.push(j);
      if (mates.length && R() < 0.5) { const m = R.pick(mates); target = clampF(pos[m][0] + g * 1.2, pos[m][1]); }
      else target = clampF(ball[0] + g * R(2.2, 4.6), ball[1] + R(-1.7, 1.7));
    }
    const dx = target[0] - ball[0], dz = target[1] - ball[1], d = Math.max(0.6, Math.sqrt(dx * dx + dz * dz)), ux = dx / d, uz = dz / d;
    const v0 = Math.sqrt(2 * DECEL * d), roll = v0 / DECEL;
    // the kicker runs up to the ball (from behind it); everyone else moves to where they want to be
    const app = [ball[0] - ux * 0.42, ball[1] - uz * 0.42];
    const kd = dist2(pos[kicker][0], pos[kicker][1], app[0], app[1]);
    const tk = Math.max(t + 0.15 + kd / vRun(kicker), restAt + 0.1, t + 0.5);
    const moves = [];
    for (let j = 0; j < n; j++) {
      let to, v, dep = t + 0.1 + R(0, 0.35);
      if (j === kicker) { to = app; dep = t + 0.1; v = Math.max(0.6, kd / Math.max(0.2, tk - dep - 0.05)); v = Math.min(v, vRun(j)); }
      else if (last) { to = clampF(pos[j][0] * 0.7, pos[j][1] * 0.7 + (team(j) > 0 ? -1 : 1) * 0.6, 1); v = vJog(j) * 0.6; }
      else if (team(j) === g) { to = clampF(target[0] + g * R(1.8, 3.2), target[1] + (pos[j][1] > target[1] ? 1 : -1) * R(1.4, 2.4)); v = vJog(j); }
      else { const own = -team(j); to = clampF((target[0] + own * PITCH.HL * 0.35) * 0.6 + target[0] * 0.4, target[1] * 0.7 + R(-1, 1)); v = vJog(j); }
      moves.push([pos[j][0], pos[j][1], to[0], to[1], dep, v]);
    }
    const play = { t, tk, b0: ball.slice(), b1: target.slice(), v0, ux, uz, roll, kicker, goal, mode, moves };
    plays.push(play);
    const tNext = tk + 0.3;
    pos = moves.map((_, j) => moveAt(play, j, tNext));
    ball = target; restAt = tk + roll;
    if (mode === 'park' || tNext >= session.t1 - 1) break;
    // goal: a cheer, then the other side fetches it and kicks it back to the middle
    if (goal) {
      const cheer = restAt + 0.2;
      plays.push({ t: tNext, tk: 1e12, b0: ball.slice(), b1: ball.slice(), v0: 0, ux: 0, uz: 0, roll: 0, kicker: -1, goal: false, mode: 'cheer', scorer: kicker, cheerT: cheer, moves: pos.map(p => [p[0], p[1], p[0], p[1], 0, 1]) });
      t = cheer + 2.8; mode = 'restart';
      const other = []; for (let j = 0; j < n; j++) if (team(j) !== g) other.push(j);
      kicker = other.length ? nearestOf(pos, ball, other) : nearest(pos, ball);
      continue;
    }
    // whoever gets to the ball first plays it next: a team-mate (pass or dribble) or the nearest opponent
    const cands = [];
    if (!shot) cands.push(kicker);
    for (let j = 0; j < n; j++) if (j !== kicker) cands.push(j);
    let best = kicker, bt = 1e9;
    for (const j of cands) {
      const tg = team(j), a2 = [ball[0] - tg * 0.42, ball[1]], dd = dist2(pos[j][0], pos[j][1], a2[0], a2[1]), tt = dd / vRun(j) + (j === kicker ? 0.25 : 0) + R(0, 0.3);
      if (tt < bt) { bt = tt; best = j; }
    }
    kicker = best; mode = 'play'; t = tNext;
    if (R() < 0.04 && !last) { t += R(6, 14); }   // a moment's rest: the ball has stopped, they catch their breath
  }
  return { plays, n };
}
function nearest(pos, b) { let k = 0, bd = 1e9; pos.forEach((p, j) => { const d = dist2(p[0], p[1], b[0], b[1]); if (d < bd) { bd = d; k = j; } }); return k; }
function nearestOf(pos, b, list) { let k = list[0], bd = 1e9; for (const j of list) { const d = dist2(pos[j][0], pos[j][1], b[0], b[1]); if (d < bd) { bd = d; k = j; } } return k; }
// where child j is at time tau during a play
export function moveAt(play, j, tau) {
  const [fx, fz, tx, tz, dep, v] = play.moves[j];
  if (tau <= dep) return [fx, fz];
  const d = dist2(fx, fz, tx, tz), k = d < 1e-6 ? 1 : Math.min(1, (tau - dep) * v / d);
  return [fx + (tx - fx) * k, fz + (tz - fz) * k];
}
// the play going on at time tau
export function playAt(sim, tau) {
  const P = sim.plays;
  let lo = 0, hi = P.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (P[m].t <= tau) lo = m; else hi = m - 1; }
  return P[lo];
}
// the ball at time tau (pitch coordinates): from the last kick, rolling and slowing to a stop
export function ballAt(sim, tau) {
  const P = sim.plays;
  let lo = 0, hi = P.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (P[m].t <= tau) lo = m; else hi = m - 1; }
  // the last kick before tau (this play's own kick may still be coming: then the previous one's ball is rolling)
  for (let i = lo; i >= 0; i--) {
    const p = P[i];
    if (p.v0 > 0 && p.tk <= tau) { const s = Math.min(tau - p.tk, p.roll), d = p.v0 * s - DECEL * s * s / 2; return { x: p.b0[0] + p.ux * d, z: p.b0[1] + p.uz * d, moving: tau - p.tk < p.roll }; }
  }
  return { x: P[0].b0[0], z: P[0].b0[1], moving: false };
}
export { PARK };
