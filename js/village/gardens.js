// The village gardens: every house gets its own garden between its front door and the lane — flower beds,
// sunflowers, vegetable patches, small fruit trees, bushes, clay pots, a stepping-stone path and a fence
// (white pickets, wood, a low stone wall, a hedge, or none) — some tidy, in rows, some a little wild. Fences,
// paths, beds and pots are merged into the village mesh; the many small plants are instanced (PLANTS).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBuilder } from '../utils.js';
import { C, fenceRun, bench, barrel } from '../farm/props.js';
import { gardenFlower } from '../grass.js';
import { lumpGeo, limb, roundBush } from '../flora.js';

function prng(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return (a = 0, b = 1) => { s = (s * 16807) % 2147483647; return a + (s - 1) / 2147483646 * (b - a); }; }
const geoOf = fn => { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; };

/* ---------- plant models (instanced) ---------- */
function sunflower(b) {
  limb(b, [0, 0, 0], [0.04, 1.45, 0.02], 0.035, 0.025, 0x4f8f2c, 5);
  for (const [y, a] of [[0.5, 0.4], [0.85, 2.6], [1.15, 4.6]]) b.add(new THREE.OctahedronGeometry(1, 0), 0x5fa338, Math.cos(a) * 0.16, y, Math.sin(a) * 0.16, 0.3, -a, 0.5, 'solid', 0.2, 0.03, 0.12);
  b.group(0.05, 1.5, 0.06, 0.5, 0, 0, () => {
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; b.add(new THREE.OctahedronGeometry(1, 0), i % 2 ? 0xffc928 : 0xf7b51c, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, 0, -a, 0, 'solid', 0.11, 0.02, 0.05); }
    b.cyl(0.13, 0.15, 0.06, 10, 0, 0.02, 0, 0x5a3a1a);
  });
}
function cabbage(b) {
  b.add(lumpGeo(0, 0.12, 201), 0x8fcf5a, 0, 0.13, 0, 0, 0, 0, 'solid', 0.2, 0.16, 0.2);
  b.add(lumpGeo(0, 0.15, 202), 0x5fa83a, 0, 0.09, 0, 0, 0.6, 0, 'solid', 0.28, 0.12, 0.28);
}
function tomato(b) {
  b.cyl(0.015, 0.015, 0.75, 4, 0.06, 0.37, 0, 0xb08a52);
  b.add(lumpGeo(0, 0.18, 203), 0x4f9a30, 0, 0.35, 0, 0, 0, 0, 'solid', 0.22, 0.3, 0.22);
  for (const [x, y, z] of [[0.15, 0.32, 0.05], [-0.1, 0.45, 0.14], [0.05, 0.22, -0.15], [-0.14, 0.26, -0.05]]) b.add(new THREE.IcosahedronGeometry(0.06, 0), 0xe0342a, x, y, z);
}
function carrot(b) {
  for (let i = 0; i < 4; i++) { const a = i * 1.6; b.add(new THREE.ConeGeometry(0.03, 0.32, 3), i % 2 ? 0x5fae3a : 0x4f9a30, Math.cos(a) * 0.04, 0.16, Math.sin(a) * 0.04, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); }
  b.cyl(0.05, 0.04, 0.05, 6, 0, 0.02, 0, 0xf08a2a);
}
function fruitTree(b) {
  limb(b, [0, 0, 0], [0.1, 1.4, 0], 0.13, 0.09, 0x8b4b2b, 6);
  limb(b, [0.08, 1.1, 0], [0.55, 1.6, 0.2], 0.06, 0.04, 0x8b4b2b, 5); limb(b, [0.06, 1.0, 0], [-0.45, 1.55, -0.25], 0.06, 0.04, 0x8b4b2b, 5);
  b.add(lumpGeo(1, 0.12, 211), 0x6cbb3c, 0.1, 1.95, 0, 0, 0, 0, 'solid', 0.95, 0.75, 0.95);
  b.add(lumpGeo(1, 0.12, 212), 0x82cc4b, 0.55, 1.75, 0.3, 0, 0, 0, 'solid', 0.6, 0.5, 0.6);
  b.add(lumpGeo(1, 0.12, 213), 0x5aa833, -0.45, 1.7, -0.3, 0, 0, 0, 'solid', 0.6, 0.5, 0.6);
  for (const [x, y, z] of [[0.6, 1.5, 0.75], [-0.7, 1.55, 0.2], [0.2, 1.4, -0.85], [0.95, 1.9, -0.1], [-0.3, 2.2, 0.75], [0.1, 1.55, 0.95], [-0.9, 1.85, -0.5], [0.7, 2.3, 0.4]])
    b.add(new THREE.IcosahedronGeometry(0.09, 0), (x * 10 | 0) % 2 ? 0xf2902a : 0xe0442a, x, y, z);
}
export const PLANTS = {
  daisy: () => gardenFlower(false), yellow: () => gardenFlower(true), sunflower: () => geoOf(sunflower), cabbage: () => geoOf(cabbage), tomato: () => geoOf(tomato),
  carrot: () => geoOf(carrot), bush: () => geoOf(roundBush), fruitTree: () => geoOf(fruitTree),
};
export const SHADOW_PLANTS = new Set(['fruitTree', 'sunflower', 'bush']);

/* ---------- small merged parts ---------- */
// a patch of soil (or anything flat) that follows the ground: x0..x1, z0..z1 in the house's frame
export function groundPatch(b, x0, z0, x1, z1, col, gAt, lift = 0.05) {
  const nx = Math.max(2, Math.ceil((x1 - x0) / 0.8)), nz = Math.max(2, Math.ceil((z1 - z0) / 0.8));
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + cx, z = p.getZ(i) + cz; p.setXYZ(i, x, gAt(x, z) + lift, z); }
  g.computeVertexNormals();
  b.add(g, col);
}
function picketRun(b, x0, z0, x1, z1, gAt, col = 0xf2efe6) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / 0.2)), a = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, g = gAt(x, z);
    b.box(0.07, 0.62, 0.035, x, g + 0.31, z, col, 'solid', 0, a + Math.PI / 2, 0);
    b.add(new THREE.ConeGeometry(0.05, 0.1, 4), col, x, g + 0.66, z, 0, a + Math.PI / 4, 0);
  }
  for (const y of [0.18, 0.46]) {
    const ga = gAt(x0, z0), gb = gAt(x1, z1), tilt = Math.atan2(gb - ga, len);
    b.group((x0 + x1) / 2, (ga + gb) / 2 + y, (z0 + z1) / 2, 0, a, 0, () => b.box(0.04, 0.06, len, 0, 0, -0.03, col, 'solid', -tilt, 0, 0));
  }
}
function stoneWall(b, x0, z0, x1, z1, gAt, R) {
  const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0), cols = [0x9b9a94, 0x8a8880, 0xa8a59c, 0x7e7c75];
  for (let row = 0; row < 2; row++) for (let s = row * 0.2; s < len - 0.1; s += R(0.35, 0.55)) {
    const t = s / len, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    b.add(lumpGeo(0, 0.15, Math.floor(s * 100) + row), cols[Math.floor(R(0, 4))], x, gAt(x, z) + 0.14 + row * 0.24, z, 0, a + R(-0.3, 0.3), 0, 'solid', R(0.2, 0.28), 0.14, R(0.16, 0.22));
  }
}
function pot(b, x, y, z, R, flowers) {
  b.cyl(0.2, 0.14, 0.32, 8, x, y + 0.16, z, 0xc0603a);
  b.cyl(0.22, 0.22, 0.05, 8, x, y + 0.32, z, 0xa8502e);
  if (flowers) for (let i = 0; i < 4; i++) b.add(new THREE.IcosahedronGeometry(0.07, 0), [0xe0443a, 0xf2c14e, 0xf08ab0, 0xf7f6ef][i], x + Math.cos(i * 1.6) * 0.1, y + 0.5, z + Math.sin(i * 1.6) * 0.1);
  b.add(lumpGeo(0, 0.15, 220 + Math.floor(R(0, 9))), 0x5fae3a, x, y + 0.42, z, 0, 0, 0, 'solid', 0.2, 0.16, 0.2);
}
function steppingStones(b, x, z0, z1, gAt, R) {
  for (let z = z0 + 0.3; z < z1 - 0.1; z += 0.62) {
    const xx = x + R(-0.12, 0.12);
    b.add(new THREE.CylinderGeometry(0.28, 0.3, 0.08, 7), [0xb5b0a4, 0xa8a49a, 0xc0bbb0][Math.floor(R(0, 3))], xx, gAt(xx, z) + 0.03, z, 0, R(0, 3), 0, 'solid', 1, 1, 0.8);
  }
}

/* ---------- one garden ---------- */
// H: the house ({ spec, x, z, yaw, base }) · gAt: ground in its frame · toWorld(lx, lz) -> { x, z } · plant(kind, lx, lz, yaw, s)
export function buildGarden(b, H, gAt, seed, plant) {
  const S = H.spec, R = prng(seed * 131 + 7), w = S.shape === 'round' ? S.r * 2 + 1.5 : S.w, d = S.shape === 'round' ? S.r * 2 : S.d;
  const zA = d / 2 + (S.porch ? S.porch.d + 0.3 : 0.6), zB = d / 2 + S.garden - 0.15, half = w / 2 + 0.6;
  if (zB - zA < 1.2) return;
  const tidy = R() < 0.6, kinds = ['flowers', 'sunflowers', 'veg', 'bushes', 'fruit', 'flowers'];
  const pick = () => kinds[Math.floor(R(0, kinds.length))];
  const left = pick(), right = seed % 3 === 0 ? 'veg' : pick();
  // the path from the door to the lane
  steppingStones(b, 0, zA - 0.2, zB + 0.3, gAt, R);
  // the beds either side of it
  for (const [side, kind] of [[-1, left], [1, right]]) {
    const x0 = side < 0 ? -half + 0.3 : 0.9, x1 = side < 0 ? -0.9 : half - 0.3, z0 = zA, z1 = zB - 0.35;
    if (x1 - x0 < 0.8) continue;
    bed(b, kind, x0, z0, x1, z1, gAt, R, plant, tidy);
  }
  // the fence along the lane, with a gap for the path
  const ft = ['picket', 'wood', 'stone', 'hedge', 'none', 'picket', 'wood'][seed % 7];
  const zf = zB, runs = [[-half, zf, -0.75, zf], [0.75, zf, half, zf], [-half, zf, -half, zA - 0.4], [half, zf, half, zA - 0.4]];
  for (const [ax, az, bx, bz] of runs) {
    if (ft === 'picket') picketRun(b, ax, az, bx, bz, gAt, seed % 2 ? 0xf2efe6 : 0xe9dcc0);
    else if (ft === 'wood') fenceRun(b, ax, az, bx, bz, gAt, { h: 0.85, spacing: 1.5, color: C.woodL });
    else if (ft === 'stone') stoneWall(b, ax, az, bx, bz, gAt, R);
    else if (ft === 'hedge' && az === bz) for (let x = ax + 0.3; x < bx; x += 0.7) plant('bush', x, az, R(0, 6), R(0.42, 0.55));
  }
  // pots by the door, and a bench or a barrel
  const dz = d / 2 + (S.porch ? S.porch.d : 0) + 0.35;
  if (R() < 0.8) { pot(b, -0.95, gAt(-0.95, dz), dz, R, R() < 0.6); pot(b, 0.95, gAt(0.95, dz), dz, R, R() < 0.6); }
  if (R() < 0.45) { const x = side2(R) * (half - 1.0), z = zA + 0.5; bench(b, x, gAt(x, z), z, Math.PI); }
  else if (R() < 0.6) { const x = side2(R) * (half - 0.4), z = d / 2 - 0.2; barrel(b, x, gAt(x, z), z, C.wood); }
}
const side2 = R => (R() < 0.5 ? -1 : 1);
// one bed: flowers, sunflowers, vegetables, bushes or a fruit tree
function bed(b, kind, x0, z0, x1, z1, gAt, R, plant, tidy) {
  const w = x1 - x0, dpt = z1 - z0;
  if (kind === 'veg') {
    groundPatch(b, x0, z0, x1, z1, 0x6e4a2a, gAt, 0.04);
    for (let z = z0 + 0.3, row = 0; z < z1 - 0.1; z += 0.5, row++) {
      const k = ['cabbage', 'tomato', 'carrot'][(((row + Math.floor(x0)) % 3) + 3) % 3];
      for (let x = x0 + 0.3; x < x1 - 0.15; x += k === 'tomato' ? 0.6 : 0.42) plant(k, x + R(-0.04, 0.04), z, R(0, 6), R(0.85, 1.1));
    }
    return;
  }
  if (kind === 'sunflowers') {
    for (let x = x0 + 0.3; x < x1; x += 0.55) plant('sunflower', x + R(-0.08, 0.08), z0 + 0.25 + R(0, 0.2), R(-0.4, 0.4), R(0.85, 1.15));
    for (let i = 0; i < w * 3; i++) plant(R() < 0.6 ? 'daisy' : 'yellow', R(x0, x1), R(z0 + 0.6, z1), R(0, 6), R(1.2, 1.6));
    return;
  }
  if (kind === 'fruit') {
    plant('fruitTree', (x0 + x1) / 2 + R(-0.3, 0.3), (z0 + z1) / 2, R(0, 6), R(0.75, 1.0));
    for (let i = 0; i < w * 2; i++) plant('daisy', R(x0, x1), R(z0, z1), R(0, 6), R(1.1, 1.5));
    return;
  }
  if (kind === 'bushes') {
    for (let x = x0 + 0.4; x < x1; x += 0.9) plant('bush', x, z0 + dpt * R(0.3, 0.7), R(0, 6), R(0.5, 0.75));
    for (let i = 0; i < w * 2; i++) plant('yellow', R(x0, x1), R(z0, z1), R(0, 6), R(1.1, 1.5));
    return;
  }
  // flowers: in rows (tidy) or scattered (wild)
  if (!tidy) groundPatch(b, x0, z0, x1, z1, 0x7a5a36, gAt, 0.03);
  if (tidy) for (let z = z0 + 0.25; z < z1; z += 0.4) for (let x = x0 + 0.2; x < x1; x += 0.35) plant((Math.round(z * 3) % 2) ? 'daisy' : 'yellow', x, z, R(0, 6), R(1.3, 1.6));
  else for (let i = 0; i < w * dpt * 4; i++) plant(R() < 0.55 ? 'daisy' : 'yellow', R(x0, x1), R(z0, z1), R(0, 6), R(1.1, 1.7));
}
export { mergeGeometries };
