// Low-poly fishing models: the three rods (each looks different), the three fish, the bobber and a wooden
// dock (the Fish Market is a baked model: js/fishing/area.js). Built like the farm models: their own frame, front = +z, ground at
// y = 0 under the centre; hAt(x, z) gives the ground height at a local point.
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';
import { C, FARM_MAT, barrel, lampPost } from '../farm/props.js';

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

