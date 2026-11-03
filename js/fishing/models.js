// Low-poly fishing models: the three rods (each looks different), the three fish, the bobber, a wooden
// dock and the Fish Market building. Built like the farm models: their own frame, front = +z, ground at
// y = 0 under the centre; hAt(x, z) gives the ground height at a local point.
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';
import { C, FARM_MAT, planks, boards, crate, barrel, lantern, lampPost, sack } from '../farm/props.js';

const flat = () => 0;
const build = b => b.build(FARM_MAT);
const H = Math.PI / 2;
const ball = () => new THREE.SphereGeometry(1, 8, 6);
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

/* ---------- rods ---------- */
// Held in the right hand; the rod runs along +z from the butt (0) to the tip (len).
export const ROD_LOOK = {
  1: { len: 2.0, pole: 0xb0823e, knot: 0x7a5426, grip: 0xc9a26b, r0: 0.024, r1: 0.008 },       // bamboo / wood, cork grip
  2: { len: 2.3, pole: 0xaab3bb, knot: 0x5d656e, grip: 0x26282c, r0: 0.02, r1: 0.006, reel: 0xc9ced3 },   // steel, rubber grip
  3: { len: 2.6, pole: 0x1f2c4a, knot: 0xd4a73a, grip: 0x34383f, r0: 0.019, r1: 0.005, reel: 0xd4a73a, glow: 0x7cf0ff },   // carbon fibre + gold
};
const SPLIT = [0, 0.45, 0.75, 1];       // the rod bends at 45 % and 75 % of its length
const radiusAt = (L, k) => L.r0 + (L.r1 - L.r0) * k;
// one piece of the pole, from k0 to k1 of the length, drawn from z = 0 (its own pivot) forward
function pole(b, level, k0, k1) {
  const L = ROD_LOOK[level], z0 = k0 * L.len, len = (k1 - k0) * L.len;
  b.cyl(radiusAt(L, k1), radiusAt(L, k0), len, 6, 0, 0, len / 2, L.pole, H, 0, 0);
  // knots (bamboo), steel ferrules or gold wraps along the pole
  const step = level === 1 ? 0.3 : 0.42;
  for (let z = Math.ceil(z0 / step) * step; z < z0 + len - 0.02; z += step) {
    if (z < 0.5) continue;
    const r = radiusAt(L, z / L.len) + 0.004;
    b.cyl(r, r, level === 1 ? 0.025 : 0.018, 6, 0, 0, z - z0, L.knot, H, 0, 0);
  }
  // line guides under the pole (Steel and Fibre rods)
  if (level > 1) for (let z = 0.75; z < L.len - 0.05; z += level === 3 ? 0.36 : 0.48) {
    if (z < z0 || z >= z0 + len) continue;
    const r = radiusAt(L, z / L.len);
    b.add(new THREE.TorusGeometry(0.018, 0.004, 4, 8), level === 3 ? 0xd4a73a : 0xd8dde2, 0, -r - 0.022, z - z0, 0, 0, 0);
    b.box(0.006, 0.02, 0.006, 0, -r - 0.006, z - z0, 0x6a6e74);
  }
}
// the grip and reel (the part in the hand, the first 45 %)
function butt(b, level) {
  const L = ROD_LOOK[level];
  b.cyl(L.r0 + 0.012, L.r0 + 0.014, 0.42, 7, 0, 0, 0.09, L.grip, H, 0, 0);                // grip
  b.cyl(L.r0 + 0.016, L.r0 + 0.016, 0.04, 7, 0, 0, -0.13, level === 1 ? L.knot : 0x1a1b1e, H, 0, 0);   // butt cap
  if (level === 1) {                                     // a simple wooden spool with line
    b.cyl(0.035, 0.035, 0.06, 8, 0, -0.045, 0.34, 0x8a5a2b, 0, 0, H);
    b.cyl(0.026, 0.026, 0.062, 8, 0, -0.045, 0.34, 0xe8e2d0, 0, 0, H);
  } else {                                               // a reel with a handle
    const R = level === 3 ? 0.06 : 0.05;
    b.box(0.012, 0.05, 0.03, 0, -L.r0 - 0.03, 0.3, 0x3a3d42);
    b.cyl(R, R, 0.05, 10, 0, -L.r0 - 0.06 - R * 0.5, 0.3, L.reel, 0, 0, H);
    b.cyl(R * 0.7, R * 0.7, 0.054, 10, 0, -L.r0 - 0.06 - R * 0.5, 0.3, level === 3 ? 0x1f2c4a : 0x6a6e74, 0, 0, H);
    b.box(0.07, 0.012, 0.012, 0.045, -L.r0 - 0.06 - R * 0.5, 0.3, 0x3a3d42);
    b.box(0.012, 0.012, 0.03, 0.08, -L.r0 - 0.06 - R * 0.5, 0.3, level === 3 ? 0xd4a73a : 0x222326);
  }
  if (level === 3) for (const z of [-0.06, 0.2]) b.cyl(L.r0 + 0.017, L.r0 + 0.017, 0.02, 7, 0, 0, z, 0xd4a73a, H, 0, 0);
  pole(b, level, 0, SPLIT[1]);
}
function tipEnd(b, level, len) {
  const L = ROD_LOOK[level];
  b.add(new THREE.SphereGeometry(0.012, 6, 4), L.glow || L.knot, 0, 0, len, 0, 0, 0, L.glow ? 'glow' : 'solid');
}
// a whole straight rod in one GeoBuilder (the hotbar / other players' hands / previews)
export function buildRod(b, level) {
  const L = ROD_LOOK[level];
  butt(b, level);
  b.group(0, 0, SPLIT[1] * L.len, 0, 0, 0, () => pole(b, level, SPLIT[1], SPLIT[2]));
  b.group(0, 0, SPLIT[2] * L.len, 0, 0, 0, () => { pole(b, level, SPLIT[2], 1); tipEnd(b, level, (1 - SPLIT[2]) * L.len); });
}
// a rod that bends: { root, joints: [two pivots], tip (an Object3D at the tip) }. bend(a) curves it down.
export function rodRig(level) {
  const L = ROD_LOOK[level], root = new THREE.Group(), joints = [];
  let b = new GeoBuilder(); butt(b, level); root.add(build(b));
  let parent = root;
  for (let i = 1; i <= 2; i++) {
    const j = new THREE.Group(); j.position.z = (SPLIT[i] - (i === 1 ? 0 : SPLIT[i - 1])) * L.len;
    b = new GeoBuilder(); pole(b, level, SPLIT[i], SPLIT[i + 1]);
    if (i === 2) tipEnd(b, level, (1 - SPLIT[2]) * L.len);
    j.add(build(b)); parent.add(j); joints.push(j); parent = j;
  }
  const tip = new THREE.Object3D(); tip.position.z = (1 - SPLIT[2]) * L.len; parent.add(tip);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return { root, joints, tip, bend(a) { joints[0].rotation.x = a * 0.45; joints[1].rotation.x = a * 0.75; } };
}
// where the tip of a straight rod is (item-local)
export const rodTip = level => new THREE.Vector3(0, 0, ROD_LOOK[level].len);

/* ---------- fish (head toward +z) ---------- */
export const FISH_LOOK = {
  fish_small: { len: 0.28, back: 0x4f7390, side: 0x9fc3da, belly: 0xe6eef2, fin: 0x6d8fa8, name: 'Small fish' },
  fish_medium: { len: 0.48, back: 0x5c7a32, side: 0xc9a945, belly: 0xf0e2b0, fin: 0xb0603a, stripe: 0xd2694a, name: 'Medium fish' },
  fish_large: { len: 0.9, back: 0x5a3a24, side: 0xb8742e, belly: 0xe8c890, fin: 0xd0502a, name: 'Large fish', whiskers: true },
};
export function buildFish(b, type) {
  const F = FISH_LOOK[type] || FISH_LOOK.fish_small, l = F.len, w = l * 0.16, h = l * 0.24;
  b.add(ball(), F.side, 0, 0, 0, 0, 0, 0, 'solid', w, h, l * 0.5);                      // body
  b.add(ball(), F.back, 0, h * 0.35, -l * 0.02, 0, 0, 0, 'solid', w * 0.9, h * 0.7, l * 0.46);   // darker back
  b.add(ball(), F.belly, 0, -h * 0.35, 0.02 * l, 0, 0, 0, 'solid', w * 0.85, h * 0.55, l * 0.4);
  if (F.stripe) b.add(ball(), F.stripe, 0, 0.02 * l, 0, 0, 0, 0, 'solid', w * 1.02, h * 0.18, l * 0.42);
  // tail, fins, eyes, mouth
  b.box(0.012, h * 1.5, l * 0.2, 0, 0, -l * 0.55, F.fin, 'solid', 0, 0, 0);
  b.box(0.012, h * 0.6, l * 0.3, 0, h * 0.95, -l * 0.05, F.fin, 'solid', 0.25, 0, 0);
  for (const s of [-1, 1]) {
    b.box(0.01, h * 0.35, l * 0.14, s * w * 0.9, -h * 0.35, l * 0.18, F.fin, 'solid', 0, s * 0.5, s * 0.6);
    b.add(new THREE.SphereGeometry(Math.max(0.01, l * 0.03), 6, 4), 0x111111, s * w * 0.8, h * 0.22, l * 0.36);
    if (F.whiskers) b.box(0.008, 0.008, l * 0.22, s * w * 0.5, -h * 0.25, l * 0.56, 0x3a2414, 'solid', 0.4, s * 0.5, 0);
  }
  b.box(w * 0.9, 0.012, 0.02, 0, -h * 0.08, l * 0.49, 0x2a1a14);
}
export function fishModel(type) { const b = new GeoBuilder(); buildFish(b, type); return build(b); }

// a red and white float
export function bobberModel() {
  const b = new GeoBuilder();
  b.add(new THREE.SphereGeometry(0.07, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xe0302a, 0, 0, 0);
  b.add(new THREE.SphereGeometry(0.07, 8, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xf4f1ea, 0, 0, 0);
  b.cyl(0.008, 0.008, 0.12, 4, 0, 0.1, 0, 0xf4f1ea);
  return build(b);
}

/* ---------- a wooden dock: from the bank (z = 0) out over the water (z = len), deck at y = deck ---------- */
export function dockModel(len, wid, deck, hAt = flat, seed = 0) {
  const b = new GeoBuilder();
  // posts down into the river bed, stringers, planks across
  for (let z = 0.3; z <= len; z += 1.8) for (const s of [-1, 1]) {
    const x = s * (wid / 2 - 0.1), g = Math.min(hAt(x, z), deck - 0.4) - 0.5, top = deck + (z > len - 0.5 ? 0.9 : 0.05);
    b.cyl(0.11, 0.13, top - g, 7, x, (top + g) / 2, z, shade(C.woodD, 0.9 + (z % 3) * 0.04));
  }
  for (const s of [-1, 1]) b.box(0.14, 0.18, len, s * (wid / 2 - 0.1), deck - 0.17, len / 2, C.woodD);
  const n = Math.round(len / 0.3);
  for (let i = 0; i < n; i++) b.box(wid + ((i * 7 + seed) % 3) * 0.04, 0.07, 0.27, ((i * 13 + seed) % 5 - 2) * 0.01, deck - 0.035, (i + 0.5) * len / n, shade(C.woodL, [1, 0.9, 1.06, 0.95][(i + seed) % 4]));
  // rope rail at the far end, a tackle box, a bucket, a little barrel and a lantern post
  for (const s of [-1, 1]) b.box(0.03, 0.03, 1.8, s * (wid / 2 - 0.1), deck + 0.75, len - 1.0, C.rope);
  b.box(wid - 0.2, 0.03, 0.03, 0, deck + 0.75, len - 0.1, C.rope);
  b.group(-wid / 2 + 0.45, deck, len - 1.6, 0, 0.3, 0, () => { b.box(0.42, 0.2, 0.26, 0, 0.1, 0, 0x2f6a4a); b.box(0.44, 0.04, 0.28, 0, 0.21, 0, 0x255a3c); b.box(0.12, 0.03, 0.04, 0, 0.245, 0, 0x1a1a1a); });
  b.cyl(0.13, 0.11, 0.26, 8, wid / 2 - 0.4, deck + 0.13, len - 2.3, 0x6a7a86);
  b.cyl(0.11, 0.11, 0.02, 8, wid / 2 - 0.4, deck + 0.22, len - 2.3, 0x3a5a70);
  barrel(b, wid / 2 - 0.45, deck, 0.9, C.woodD);
  lampPost(b, -wid / 2 + 0.05, deck, 0.4, 0);
  return build(b);
}

/* ---------- the Fish Market (front = +z, toward the road) ---------- */
export const FISH_MARKET_DIM = { w: 10, d: 7, floor: 0.6 };
const SEA = 0x4f7f95, SEA_D = 0x3d6578, SEA_L = 0x6c97aa, TRIM = 0xeef0ea, ICE = 0xdff2f8;
export function fishMarketModel(floor, hAt = flat) {
  const b = new GeoBuilder(), W = FISH_MARKET_DIM.w, D = FISH_MARKET_DIM.d;
  // stilts and a raised plank floor
  for (const x of [-W / 2 + 0.3, -W / 6, W / 6, W / 2 - 0.3]) for (const z of [-D / 2 + 0.3, 0, D / 2 - 0.3]) {
    const g = hAt(x, z) - 0.3;
    b.box(0.26, floor - g, 0.26, x, (floor + g) / 2, z, C.woodD);
  }
  const n = 24;
  for (let i = 0; i < n; i++) b.box(W, 0.1, D / n - 0.015, 0, floor - 0.05, -D / 2 + (i + 0.5) * D / n, [C.woodL, C.woodXL, C.wood][i % 3]);
  b.group(0, floor, 0, 0, 0, 0, () => {
    // walls: weathered blue-grey planks with white trim; the front is open over a long counter
    planks(b, W, 3.2, 0, 1.6, -D / 2 + 0.05, SEA);
    planks(b, D, 3.2, -W / 2 + 0.05, 1.6, 0, SEA_D, undefined, H);
    planks(b, D, 3.2, W / 2 - 0.05, 1.6, 0, SEA_D, undefined, H);
    for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) b.box(0.2, 3.3, 0.2, x, 1.65, z, TRIM);
    b.box(W + 0.1, 0.22, 0.24, 0, 3.25, D / 2 - 0.1, TRIM);
    b.box(W + 0.1, 0.18, 0.22, 0, 3.25, -D / 2 + 0.1, TRIM);
    // roof: a gable along x with blue tin sheets
    const half = D / 2 + 0.5, rise = 1.5, len = Math.hypot(half, rise), a = Math.atan2(rise, half);
    for (const s of [1, -1]) b.group(0, 3.35 + rise / 2, s * half / 2, s * a, 0, 0, () => {
      b.box(W + 1, 0.1, len, 0, 0, 0, SEA_D);
      for (let i = 0; i < 14; i++) b.box(0.4, 0.06, len + 0.02, -W / 2 - 0.2 + i * (W + 0.6) / 13, 0.07, 0, i % 2 ? SEA_L : 0x8fb3c2);
    });
    b.box(W + 1.1, 0.16, 0.28, 0, 3.35 + rise + 0.03, 0, TRIM);
    for (let i = 0; i < 6; i++) { const k = 1 - (i + 0.5) / 6; for (const z of [D / 2 - 0.1, -D / 2 + 0.1]) b.box(W * k, rise / 6 * 0.95, 0.1, 0, 3.35 + (i + 0.5) * rise / 6, z, i % 2 ? SEA : SEA_L); }
    // striped awning over the counter
    for (let i = 0; i < 12; i++) b.box(W / 12 + 0.02, 0.06, 1.5, -W / 2 + (i + 0.5) * W / 12, 2.65, D / 2 + 0.6, i % 2 ? TRIM : 0x2f7fb0, 'solid', -0.32, 0, 0);
    for (const s of [-1, 1]) b.box(0.1, 2.3, 0.1, s * (W / 2 - 0.2), 1.3, D / 2 + 1.2, C.woodD);
    // the counter: a fish display on crushed ice, a scale, price slates
    b.box(W - 2.4, 1.0, 0.9, -0.6, 0.5, D / 2 - 0.75, C.wood);
    boards(b, W - 2.4, 0.9, -0.6, 0.5, D / 2 - 0.29, C.woodL, 3, 0, 0.05);
    b.box(W - 2.3, 0.08, 1.0, -0.6, 1.04, D / 2 - 0.75, C.woodXL);
    b.box(3.4, 0.12, 0.75, -1.9, 1.12, D / 2 - 0.75, ICE);
    for (let i = 0; i < 9; i++) b.group(-3.4 + i * 0.36, 1.2, D / 2 - 0.75 + (i % 2 ? 0.14 : -0.14), 0, 0.15 * (i % 3 - 1) + H, H, () => buildFish(b, i % 3 === 2 ? 'fish_medium' : 'fish_small'));
    b.group(0.6, 1.22, D / 2 - 0.75, 0, H + 0.2, H, () => buildFish(b, 'fish_large'));
    b.box(0.3, 0.05, 0.3, 2.2, 1.11, D / 2 - 0.8, C.metalD); b.box(0.04, 0.3, 0.04, 2.2, 1.26, D / 2 - 0.8, C.metalD); b.box(0.5, 0.03, 0.03, 2.2, 1.42, D / 2 - 0.8, C.metalD);
    for (const x of [-3.6, -0.6, 2.4]) { b.box(0.5, 0.36, 0.04, x, 1.35, D / 2 - 0.25, 0x2a3a2e); b.box(0.56, 0.42, 0.03, x, 1.35, D / 2 - 0.27, C.woodD); }
    // worm containers by the counter's end: tubs of soil with pink worms
    for (const [x, z] of [[3.6, D / 2 - 0.6], [4.05, D / 2 - 0.9], [3.55, D / 2 - 1.15]]) {
      b.cyl(0.2, 0.17, 0.32, 9, x, 0.16, z, 0x7a5a3a); b.cyl(0.18, 0.18, 0.03, 9, x, 0.31, z, 0x4a3220);
      for (let k = 0; k < 4; k++) b.box(0.1, 0.02, 0.02, x - 0.08 + (k % 2) * 0.12, 0.34, z - 0.06 + (k >> 1) * 0.12, 0xe08a8a, 'solid', 0, k * 0.8, 0);
    }
    // back wall: a rack with the three rods, nets, a hanging fish line and a menu board
    b.box(3.0, 0.08, 0.1, -2.6, 2.3, -D / 2 + 0.2, C.woodD); b.box(3.0, 0.08, 0.1, -2.6, 0.9, -D / 2 + 0.2, C.woodD);
    for (let i = 1; i <= 3; i++) b.group(-3.7 + i * 0.6, 0.2, -D / 2 + 0.3, -H + 0.02, 0, 0, () => buildRod(b, i));
    for (let i = 0; i < 6; i++) b.box(0.012, 1.4, 0.012, 0.6 + i * 0.25, 2.1, -D / 2 + 0.15, 0x3a4a3a);
    for (let i = 0; i < 6; i++) b.box(1.3, 0.012, 0.012, 1.25, 1.5 + i * 0.25, -D / 2 + 0.15, 0x3a4a3a);
    b.box(2.6, 0.06, 0.06, 2.9, 2.55, -D / 2 + 0.6, C.woodD);
    for (let i = 0; i < 6; i++) { const t = ['fish_small', 'fish_medium', 'fish_small', 'fish_large', 'fish_small', 'fish_medium'][i]; b.box(0.01, 0.2, 0.01, 1.8 + i * 0.42, 2.45, -D / 2 + 0.6, C.rope); b.group(1.8 + i * 0.42, 2.38 - FISH_LOOK[t].len * 0.55, -D / 2 + 0.6, H, 0, 0, () => buildFish(b, t)); }
    // crates of fish on ice, barrels, sacks, a red and white buoy
    for (const [x, z, r] of [[-4.2, -2.4, 0.2], [-3.5, -2.6, -0.1], [-4.2, -1.6, 0]]) { crate(b, x, 0, z, 0.6, C.woodL, r); b.box(0.52, 0.06, 0.52, x, 0.6, z, ICE); }
    for (let k = 0; k < 4; k++) b.group(-4.25 + (k % 2) * 0.22, 0.66, -2.45 + (k >> 1) * 0.2, 0, 0.3, H, () => buildFish(b, 'fish_small'));
    barrel(b, 4.2, 0, -2.6, SEA_D); barrel(b, 4.25, 0, -1.8); sack(b, 3.4, 0, -2.7, 0.3);
    b.add(new THREE.TorusGeometry(0.28, 0.08, 6, 12), 0xe0302a, W / 2 - 0.16, 2.0, 1.2, 0, H, 0);
    for (let i = 0; i < 4; i++) b.box(0.1, 0.12, 0.17, W / 2 - 0.16, 2.0 + Math.sin(i * H) * 0.28, 1.2 + Math.cos(i * H) * 0.28, TRIM, 'solid', i * H, 0, 0);
    lantern(b, -3.0, 2.25, D / 2 - 0.2); lantern(b, 2.8, 2.25, D / 2 - 0.2);
    // a step in front of the counter's open end (the way in)
  });
  // steps up at the open (east) side of the front
  for (let i = 0; i < 3; i++) { const g = hAt(3.9, D / 2 + 0.4 + i * 0.4); b.box(1.8, Math.max(0.1, floor - i * floor / 3 - g), 0.4, 3.9, (floor - i * floor / 3 + g) / 2, D / 2 + 0.2 + i * 0.4, C.woodL); }
  // lamp posts and a rowing boat on the side
  lampPost(b, -W / 2 - 0.6, hAt(-W / 2 - 0.6, D / 2 + 1.5), D / 2 + 1.5, 0);
  lampPost(b, W / 2 + 0.6, hAt(W / 2 + 0.6, D / 2 + 1.5), D / 2 + 1.5, Math.PI);
  b.group(-W / 2 - 1.9, hAt(-W / 2 - 1.9, -1) + 0.25, -1, 0, 0.1, 0.25, () => {
    for (const s of [-1, 1]) b.box(0.08, 0.4, 3.2, s * 0.55, 0.15, 0, 0x2f6a8a, 'solid', 0, 0, s * 0.35);
    b.box(1.0, 0.08, 3.0, 0, -0.04, 0, 0x2a5a76); b.box(1.1, 0.06, 0.3, 0, 0.25, 0.3, C.woodL);
    b.box(0.05, 0.05, 2.4, 0.2, 0.35, -0.2, C.woodXL, 'solid', 0.1, 0.2, 0);
  });
  return build(b);
}
