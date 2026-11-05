// How the villagers move: a pose is 16 joint angles (the same joints and directions as the players' Character
// in js/character.js) that the graphics card applies to the villager's body (characters.js).
//   - Walking and running: the step phase comes from the distance really walked (phase += π · distance / step
//     length), so the feet never slide; the stride and the arm swing grow with the speed; the hips sit as high
//     as the supporting leg reaches (legDrop), so the body bobs with every step on its own.
//   - Children run with long strides and bent arms; old people walk slowly with short steps, a stoop and
//     (some of them) a walking stick.
//   - Activities (sitting, talking, gardening, hoeing, watering, sweeping, pulling water from the well,
//     feeding hens, chopping wood, cooking, hanging washing, kicking a ball, clapping games…) are poses that
//     change with time. Every frame the villager's joints move toward the target pose (smooth transitions).
export const P = { rootY: 0, spineX: 1, spineY: 2, neckX: 3, headY: 4, shLx: 5, shLz: 6, elL: 7, shRx: 8, shRz: 9, elR: 10, spread: 11, hipLx: 12, knL: 13, hipRx: 14, knR: 15 };
const TAU = Math.PI * 2;
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = k => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;
const tri = x => { const f = x - Math.floor(x); return f < 0.5 ? f * 2 : 2 - f * 2; };

// how far the hips are above the feet for these leg angles (thigh, shin, foot), and the hips' rest height
export const legDrop = (S, hip, kn) => S.thigh * Math.cos(hip) + S.shin * Math.cos(hip + kn) + S.foot;
const restLeg = S => S.hipY - 0.02;
// the stride of one step for a leg swing A (radians)
export const stepLength = (S, A, run) => Math.max(0.12, 2 * (S.thigh + S.shin) * Math.sin(Math.max(0.05, A))) * (run ? 1.45 : 1);

// a villager's animation state: the pose now, the step phase, how much it walks
export class Animator {
  constructor() { this.cur = new Float32Array(16); this.tgt = new Float32Array(16); this.phase = 0; this.walkK = 0; this.init = false; }
  // move toward the target pose (rate: how fast)
  step(dt, rate) {
    const k = this.init ? 1 - Math.exp(-rate * dt) : 1;
    for (let i = 0; i < 16; i++) this.cur[i] += (this.tgt[i] - this.cur[i]) * k;
    this.init = true;
  }
}

/* ---------- the target pose ---------- */
// st: { S (skeleton), age, female, seed, stick, mode, act, tau, t, speed, A, phase, carry, item, seatH, talk,
//       kick, lift, look } — returns the smoothing rate
export function targetPose(T, st) {
  const S = st.S, t = st.t, sd = st.seed, elder = st.age === 'elder', child = st.age === 'child';
  T.fill(0);
  // standing and breathing
  const br = Math.sin(t * 2.1 + sd) * 0.025;
  T[P.spineX] = 0.02 + br + (elder ? 0.2 : 0); T[P.neckX] = -br - (elder ? 0.14 : 0);
  T[P.shLz] = 0.1; T[P.shRz] = -0.1; T[P.elL] = -0.15; T[P.elR] = -0.15;
  T[P.shLx] = Math.sin(t * 1.1 + sd) * 0.03; T[P.shRx] = -Math.sin(t * 1.1 + sd) * 0.03;
  let rate = 9, legs = true;
  const m = st.mode;
  if (m === 'walk' || m === 'run') {
    const run = m === 'run', A = st.A, sp = Math.sin(st.phase), cp = Math.cos(st.phase);
    T[P.hipLx] = -sp * A; T[P.hipRx] = sp * A;
    const kb = run ? 2.0 : 1.4, k0 = A > 0.05 ? (run ? 0.25 : 0.06) : 0;
    T[P.knL] = Math.max(0, cp) * A * kb + k0; T[P.knR] = Math.max(0, -cp) * A * kb + k0;
    const arm = elder ? 0.5 : 0.8;
    T[P.shLx] = sp * A * (run ? 1.0 : arm); T[P.shRx] = -sp * A * (run ? 1.0 : arm);
    T[P.elL] = run ? -1.45 : -0.25 - Math.max(0, -sp) * 0.3; T[P.elR] = run ? -1.45 : -0.25 - Math.max(0, sp) * 0.3;
    T[P.spineY] = sp * A * 0.15; T[P.spineX] = (run ? 0.26 : 0.06) + (elder ? 0.2 : 0);
    if (run) T[P.rootY] += Math.abs(Math.sin(st.phase)) * 0.05 * S.k;
    rate = 14;
  } else if (m === 'act') rate = act(T, st, S, t, sd, child, elder) || rate;
  if (st.item === 6 && m !== 'act') { T[P.shRx] = -0.35 - (m === 'walk' ? Math.sin(st.phase) * 0.1 : 0); T[P.elR] = -0.35; T[P.shRz] = -0.05; }   // the walking stick
  carryPose(T, st, m);
  // hips at the height the legs reach (unless the activity set it)
  if (legs && !st._root) T[P.rootY] += Math.max(legDrop(S, T[P.hipLx], T[P.knL]), legDrop(S, T[P.hipRx], T[P.knR])) - restLeg(S);
  st._root = false;
  T[P.rootY] += st.lift || 0;
  if (st.look !== undefined && st.look !== null) T[P.headY] = st.look;
  return rate;
}

function carryPose(T, st, m) {
  const c = st.carry, moving = m === 'walk' || m === 'run', sw = moving ? Math.sin(st.phase) : 0;
  if (c === 1 || c === 2 || c === 5) { T[P.shLx] = -2.75; T[P.shLz] = 0.32; T[P.elL] = -0.85; T[P.neckX] = Math.min(T[P.neckX], 0.02); T[P.spineX] = Math.min(T[P.spineX], 0.08); }
  else if (c === 3) { T[P.shRx] = -2.25; T[P.shRz] = -0.05; T[P.elR] = -1.95; }
  else if (c === 4) { T[P.shLx] = -0.45; T[P.elL] = -1.35; T[P.shLz] = 0.05; }
  else if (c === 6) { T[P.shLx] = sw * 0.15; T[P.shLz] = 0.2; T[P.elL] = -0.18; }
  else if (c === 7 && st.act !== 'raise') { T[P.shLx] = -0.42 + sw * 0.06; T[P.shLz] = 0.16; T[P.elL] = -0.9; }   // a lantern held out in front
  if (!moving && m === 'act') return;
  const it = st.item;
  if (it === 3) { T[P.shRx] = sw * 0.12; T[P.shRz] = -0.24; T[P.elR] = -0.1; }
  else if (it === 1 || it === 5 || it === 9) { T[P.shRx] = -0.12 - sw * 0.1; T[P.elR] = -0.3; T[P.shRz] = -0.06; }
  else if (it === 2) { T[P.shRx] = sw * 0.12; T[P.shRz] = -0.2; T[P.elR] = -0.15; }
}

// one activity's pose (tau: seconds since it began). Returns a smoothing rate, or nothing for the default.
function act(T, st, S, t, sd, child, elder) {
  const a = st.act, tau = st.tau;
  switch (a) {
    case 'idle': case 'wait': case 'look': case 'stand': {
      T[P.headY] = Math.sin(t * 0.21 + sd * 3) * (a === 'look' ? 0.75 : 0.4) * sm(c01(Math.abs(Math.sin(t * 0.13 + sd)) * 1.6));
      const w = Math.sin(t * 0.37 + sd) * 0.06; T[P.hipLx] = w; T[P.hipRx] = -w * 0.5; T[P.knL] = Math.max(0, -w) * 1.5; T[P.spread] = 0.04;
      if (!child && Math.sin(t * 0.09 + sd * 5) > 0.55) { T[P.shLx] = -0.25; T[P.elL] = -1.3; T[P.shRx] = -0.25; T[P.elR] = -1.3; T[P.shLz] = -0.05; T[P.shRz] = 0.05; }   // hands clasped in front
      return;
    }
    case 'sit': case 'talkSit': case 'drink': case 'watchSit': {
      sit(T, S, st.seatH);
      if (child) { T[P.knL] += Math.sin(t * 3.1 + sd) * 0.3; T[P.knR] += Math.sin(t * 3.1 + sd + 2) * 0.3; }
      if (elder) { T[P.spineX] = 0.16; T[P.neckX] = -0.12; }
      if (a === 'talkSit') talkArms(T, st, t, sd, true);
      else if (a === 'drink') { const c = c01((((t + sd * 7) % 9) - 6) / 1.2), up = sm(c < 0.5 ? c * 2 : 2 - c * 2); T[P.shRx] = lerp(-0.4, -0.55, up); T[P.elR] = lerp(-1.1, -2.35, up); T[P.neckX] -= up * 0.15; }
      else if (a === 'watchSit') cheer(T, t, sd, 0.6);
      else T[P.headY] = Math.sin(t * 0.17 + sd * 3) * 0.5;
      st._root = true; return 7;
    }
    case 'sitGround': case 'clap': {
      T[P.rootY] = 0.1 * S.limb + 0.02 - S.hipY; T[P.hipLx] = -1.35; T[P.hipRx] = -1.35; T[P.knL] = 2.55; T[P.knR] = 2.55; T[P.spread] = 0.75;
      T[P.spineX] = 0.08; T[P.shLx] = -0.5; T[P.shRx] = -0.5; T[P.shLz] = 0.25; T[P.shRz] = -0.25; T[P.elL] = -0.6; T[P.elR] = -0.6;
      if (a === 'clap') { const c = Math.sin((t + sd) * 7); T[P.shLx] = -1.05; T[P.shRx] = -1.05; T[P.elL] = -0.75; T[P.elR] = -0.75; T[P.shLz] = 0.05 + Math.max(0, c) * 0.35; T[P.shRz] = -0.05 - Math.max(0, c) * 0.35; T[P.neckX] = Math.sin(t * 2.3 + sd) * 0.08; }
      else T[P.headY] = Math.sin(t * 0.4 + sd) * 0.6;
      st._root = true; return 8;
    }
    case 'talk': case 'shop': { stand(T, t, sd); talkArms(T, st, t, sd, false); if (a === 'shop' && Math.sin(t * 0.7 + sd) > 0.6) { T[P.shRx] = -1.25; T[P.elR] = -0.2; T[P.shRz] = 0.1; } return; }
    case 'vend': {
      stand(T, t, sd);
      if (st.talk) talkArms(T, st, t, sd, false);
      else { const c = Math.sin(t * 1.3 + sd); T[P.spineX] = 0.2; T[P.neckX] = 0.3; T[P.shLx] = -0.75 + c * 0.12; T[P.shRx] = -0.75 - c * 0.12; T[P.elL] = -0.5; T[P.elR] = -0.5; }
      return;
    }
    case 'squat': case 'weed': case 'cook': {
      const hip = -1.25, kn = 2.1; T[P.hipLx] = hip; T[P.hipRx] = hip; T[P.knL] = kn; T[P.knR] = kn; T[P.spread] = 0.12; T[P.spineX] = 0.42; T[P.neckX] = 0.15;
      if (a === 'cook') { T[P.shRx] = -0.95 + Math.cos(t * 3) * 0.2; T[P.shRz] = -0.15 + Math.sin(t * 3) * 0.2; T[P.elR] = -0.9; T[P.shLx] = -0.6; T[P.elL] = -0.6; T[P.shLz] = 0.2; }
      else { const c = (t * 0.8 + sd) % 1, r = c < 0.6 ? sm(c / 0.6) : 1 - sm((c - 0.6) / 0.4), c2 = ((t * 0.8 + sd + 0.5) % 1); const r2 = c2 < 0.6 ? sm(c2 / 0.6) : 1 - sm((c2 - 0.6) / 0.4);
        T[P.shLx] = -1.05 + r * 0.45; T[P.shRx] = -1.05 + r2 * 0.45; T[P.elL] = -0.35 - r * 0.5; T[P.elR] = -0.35 - r2 * 0.5; T[P.shLz] = 0.05; T[P.shRz] = -0.05; }
      return 10;
    }
    case 'hoe': case 'fork': {
      T[P.spread] = 0.12; T[P.hipLx] = -0.28; T[P.knL] = 0.18; T[P.hipRx] = 0.18; T[P.knR] = 0.08;
      const per = a === 'hoe' ? 1.35 : 2.0, c = ((t + sd) / per) % 1;
      let sh, el, bend;
      if (a === 'hoe') {
        if (c < 0.5) { const k = sm(c / 0.5); sh = lerp(-0.45, -2.05, k); el = lerp(-0.15, -0.95, k); bend = lerp(0.35, 0.1, k); }
        else if (c < 0.62) { const k = (c - 0.5) / 0.12; sh = lerp(-2.05, -0.45, k); el = lerp(-0.95, -0.15, k); bend = lerp(0.1, 0.45, k); }
        else { sh = -0.45; el = -0.15; bend = 0.45 - sm((c - 0.62) / 0.38) * 0.1; }
      } else {
        if (c < 0.4) { const k = sm(c / 0.4); sh = lerp(-0.7, -0.55, k); el = -0.3; bend = lerp(0.2, 0.5, k); }
        else if (c < 0.7) { const k = sm((c - 0.4) / 0.3); sh = lerp(-0.55, -1.9, k); el = lerp(-0.3, -1.0, k); bend = lerp(0.5, 0.0, k); T[P.spineY] = k * 0.45; }
        else { const k = sm((c - 0.7) / 0.3); sh = lerp(-1.9, -0.7, k); el = lerp(-1.0, -0.3, k); bend = lerp(0, 0.2, k); T[P.spineY] = 0.45 * (1 - k); }
      }
      T[P.shRx] = sh; T[P.elR] = el; T[P.shLx] = sh * 0.88 - 0.1; T[P.elL] = el - 0.3; T[P.shLz] = -0.25; T[P.shRz] = 0.05; T[P.spineX] = bend; T[P.neckX] = 0.2;
      return 16;
    }
    case 'water': {
      stand(T, t, sd); T[P.shRx] = -0.8 + Math.sin(t * 0.9 + sd) * 0.08; T[P.elR] = -0.2; T[P.shRz] = -0.08 + Math.sin(t * 0.6) * 0.06; T[P.neckX] = 0.3; T[P.spineX] = 0.12;
      return;
    }
    case 'sweep': {
      T[P.spineX] = 0.75; T[P.neckX] = -0.3; T[P.hipLx] = -0.35 + (st.A ? -Math.sin(st.phase) * st.A : 0); T[P.hipRx] = -0.35 + (st.A ? Math.sin(st.phase) * st.A : 0); T[P.knL] = 0.4; T[P.knR] = 0.4;
      T[P.shRx] = -0.3; T[P.shRz] = -0.1 + Math.sin(t * 3.2 + sd) * 0.45; T[P.elR] = -0.2; T[P.shLx] = -0.65; T[P.elL] = -0.7; T[P.shLz] = 0.1;
      return 12;
    }
    case 'pull': {
      stand(T, t, sd); T[P.spread] = 0.1; const c = Math.sin(t * 2.2 + sd);
      T[P.shLx] = -2.0 + c * 0.5; T[P.shRx] = -2.0 - c * 0.5; T[P.elL] = -0.6; T[P.elR] = -0.6; T[P.shLz] = -0.1; T[P.shRz] = 0.1; T[P.spineX] = 0.1 + Math.abs(c) * 0.08; T[P.neckX] = 0.25;
      return 12;
    }
    case 'feed': {
      stand(T, t, sd); T[P.neckX] = 0.3; T[P.shLx] = -0.45; T[P.elL] = -1.35; T[P.shLz] = 0.05;
      const c = ((t + sd) / 1.7) % 1;
      if (c < 0.4) { const k = sm(c / 0.4); T[P.shRx] = lerp(-0.85, -0.5, k); T[P.shRz] = lerp(-0.65, 0.12, k); T[P.elR] = lerp(-0.2, -1.4, k); }
      else if (c < 0.6) { const k = sm((c - 0.4) / 0.2); T[P.shRx] = lerp(-0.5, -0.85, k); T[P.shRz] = lerp(0.12, -0.65, k); T[P.elR] = lerp(-1.4, -0.2, k); }
      else { T[P.shRx] = -0.85; T[P.shRz] = -0.65; T[P.elR] = -0.2; }
      return 14;
    }
    case 'tend': {
      T[P.spineX] = 0.95; T[P.neckX] = -0.25; T[P.hipLx] = -0.45; T[P.hipRx] = -0.45; T[P.knL] = 0.4; T[P.knR] = 0.4; T[P.spread] = 0.1;
      T[P.shRx] = -0.95 + Math.sin(t * 2.4 + sd) * 0.18; T[P.elR] = -0.3; T[P.shLx] = -0.6; T[P.elL] = -0.6;
      return 10;
    }
    case 'chop': {
      T[P.spread] = 0.15; T[P.hipLx] = -0.22; T[P.knL] = 0.15; T[P.hipRx] = 0.12;
      const c = ((t + sd) / 1.5) % 1; let sh, el;
      if (c < 0.35) { const k = sm(c / 0.35); sh = lerp(-0.35, -2.8, k); el = lerp(-0.15, -1.3, k); }
      else if (c < 0.5) { const k = (c - 0.35) / 0.15; sh = lerp(-2.8, -0.35, k); el = lerp(-1.3, -0.15, k); }
      else { sh = -0.35; el = -0.15; }
      T[P.shRx] = sh; T[P.elR] = el; T[P.shLx] = sh * 0.85; T[P.elL] = el; T[P.shLz] = -0.12; T[P.shRz] = 0.05;
      T[P.spineX] = c > 0.3 && c < 0.7 ? 0.35 : 0.12; T[P.neckX] = 0.15;
      return 18;
    }
    case 'stack': case 'pick': {
      const c = ((t + sd) / 3) % 1, down = c < 0.5 ? sm(c * 2) : 1 - sm((c - 0.5) * 2);
      T[P.spineX] = lerp(0.1, 1.05, down); T[P.hipLx] = -0.5 * down; T[P.hipRx] = -0.5 * down; T[P.knL] = 0.5 * down; T[P.knR] = 0.5 * down; T[P.spread] = 0.1;
      T[P.shLx] = lerp(-0.3, -0.95, down); T[P.shRx] = lerp(-0.3, -0.95, down); T[P.elL] = -0.5; T[P.elR] = -0.5; T[P.neckX] = 0.1;
      if (a === 'pick') { T[P.spineX] = 0.05; T[P.shLx] = -2.4 + down * 0.4; T[P.shRx] = -2.6 + down * 0.5; T[P.elL] = -0.5; T[P.elR] = -0.6 - down * 0.4; T[P.neckX] = -0.45; T[P.hipLx] = 0; T[P.hipRx] = 0; T[P.knL] = 0; T[P.knR] = 0; }
      return 10;
    }
    case 'hang': {
      stand(T, t, sd); const c = ((t + sd) / 4) % 1;
      if (c < 0.35) { const k = c < 0.17 ? sm(c / 0.17) : 1 - sm((c - 0.17) / 0.18); T[P.spineX] = 0.85 * k; T[P.shLx] = -0.9 * k; T[P.shRx] = -0.9 * k; T[P.knL] = 0.3 * k; T[P.knR] = 0.3 * k; T[P.hipLx] = -0.3 * k; T[P.hipRx] = -0.3 * k; }
      else { const w = Math.sin(t * 3) * 0.1; T[P.shLx] = -2.6 + w; T[P.shRx] = -2.5 - w; T[P.elL] = -0.45; T[P.elR] = -0.45; T[P.neckX] = -0.35; }
      return 10;
    }
    case 'pour': { stand(T, t, sd); T[P.shRx] = -1.1; T[P.elR] = -0.5; T[P.shRz] = -0.2; T[P.spineX] = 0.25; T[P.neckX] = 0.3; return; }
    case 'kick': {
      // kick: a run-up stance, the right leg swings back and through, arms out for balance (k: -1..1 around the strike)
      const k = st.kick ?? 0;
      T[P.shLz] = 0.55; T[P.shRz] = -0.45; T[P.shLx] = -0.4; T[P.elL] = -0.6; T[P.elR] = -0.6; T[P.spineX] = 0.18;
      if (k < 0) { const b = sm(c01(k + 1)); T[P.hipRx] = lerp(0, 0.65, b); T[P.knR] = lerp(0.1, 1.3, b); T[P.hipLx] = -0.15; T[P.knL] = 0.25; }
      else { const f = sm(c01(k * 2.5)); T[P.hipRx] = lerp(0.65, -1.15, f); T[P.knR] = lerp(1.3, 0.1, f); T[P.hipLx] = -0.1; T[P.knL] = 0.2; T[P.spineX] = 0.05; }
      return 24;
    }
    case 'celebrate': {
      T[P.shLx] = -2.8; T[P.shRx] = -2.8; T[P.shLz] = 0.35; T[P.shRz] = -0.35; T[P.elL] = -0.2; T[P.elR] = -0.2;
      const j = Math.abs(Math.sin((t + sd) * 6)); T[P.knL] = 0.4 * (1 - j); T[P.knR] = 0.4 * (1 - j); T[P.hipLx] = -0.2 * (1 - j); T[P.hipRx] = -0.2 * (1 - j);
      st.lift = (st.lift || 0) + j * 0.16 * S.k; return 16;
    }
    case 'hop': {
      const c = ((tau) * 1.6) % 1, up = Math.sin(c * Math.PI);
      T[P.hipRx] = -0.45; T[P.knR] = 1.6; T[P.hipLx] = -0.15 * up; T[P.knL] = 0.35 * (1 - up); T[P.shLz] = 0.5; T[P.shRz] = -0.5; T[P.elL] = -0.4; T[P.elR] = -0.4; T[P.spineX] = 0.1;
      st.lift = (st.lift || 0) + up * 0.16 * S.k; return 18;
    }
    case 'watch': { stand(T, t, sd); cheer(T, t, sd, 1); return; }
    case 'raise': {
      // the night watchman stops: lantern held up, looking round, the stick tapped on the ground
      stand(T, t, sd); T[P.spread] = 0.08;
      T[P.shLx] = -1.4 + Math.sin(t * 0.7) * 0.05; T[P.shLz] = 0.22; T[P.elL] = -0.28;
      T[P.headY] = Math.sin(tau * 0.75) * 0.8; T[P.neckX] = -0.05;
      T[P.shRx] = -0.32 - Math.max(0, Math.sin(tau * 2.6)) * 0.22; T[P.elR] = -0.3; T[P.shRz] = -0.05;
      return 10;
    }
    case 'catch': { stand(T, t, sd); T[P.shLx] = -0.9; T[P.shRx] = -0.9; T[P.elL] = -0.6; T[P.elR] = -0.6; T[P.spineX] = 0.2; T[P.knL] = 0.3; T[P.knR] = 0.3; T[P.hipLx] = -0.25; T[P.hipRx] = -0.25; return; }
    default: stand(T, t, sd);
  }
}
function stand(T, t, sd) { const w = Math.sin(t * 0.37 + sd) * 0.05; T[P.hipLx] = w; T[P.hipRx] = -w * 0.5; T[P.knL] = Math.max(0, -w) * 1.5; T[P.spread] = 0.04; }
function sit(T, S, seatH) {
  T[P.rootY] = (seatH || 0.46) + 0.1 * S.limb + 0.02 - S.hipY;
  T[P.hipLx] = -1.52; T[P.hipRx] = -1.52; T[P.knL] = 1.5; T[P.knR] = 1.5; T[P.spread] = 0.07; T[P.spineX] = -0.04;
  T[P.shLx] = -0.38; T[P.shRx] = -0.38; T[P.elL] = -0.95; T[P.elR] = -0.95; T[P.shLz] = 0.12; T[P.shRz] = -0.12;
}
// talking: whoever is speaking (they take turns, st.talk = 1 or 2) moves a hand and nods; the other listens
function talkArms(T, st, t, sd, seated) {
  const turn = Math.floor((t + (st.talkSeed || 0)) / 4.5) % 2, speaking = (st.talkRole || 0) === turn;
  if (speaking) {
    const g = Math.sin(t * 2.6 + sd), hand = Math.floor((t + sd) / 9) % 2;
    if (hand) { T[P.shRx] = -0.45 + g * 0.12; T[P.elR] = -1.35 - Math.sin(t * 3.3) * 0.25; T[P.shRz] = -0.18 + Math.sin(t * 1.7) * 0.08; }
    else { T[P.shLx] = -0.45 + g * 0.12; T[P.elL] = -1.35 - Math.sin(t * 3.1) * 0.25; T[P.shLz] = 0.18 - Math.sin(t * 1.9) * 0.08; }
    T[P.neckX] += Math.sin(t * 4.2 + sd) * 0.05; T[P.spineY] = Math.sin(t * 0.8 + sd) * 0.06;
  } else {
    T[P.neckX] += Math.max(0, Math.sin(t * 1.8 + sd)) * 0.13;
    if (!seated && Math.sin(t * 0.11 + sd * 3) > 0.3) { T[P.shLx] = -0.5; T[P.elL] = -1.9; T[P.shRx] = -0.5; T[P.elR] = -1.9; T[P.shLz] = -0.25; T[P.shRz] = 0.25; }   // arms folded
  }
}
// watching a game: now and then a cheer with the arms up
function cheer(T, t, sd, k) {
  const c = ((t + sd * 13) % 23) / 23;
  if (c > 0.9) { const e = Math.sin((c - 0.9) / 0.1 * Math.PI); T[P.shLx] = lerp(T[P.shLx], -2.6, e * k); T[P.shRx] = lerp(T[P.shRx], -2.6, e * k); T[P.elL] = lerp(T[P.elL], -0.3, e); T[P.elR] = lerp(T[P.elR], -0.3, e); }
}
export { TAU, tri };
