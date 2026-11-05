// Village props: the well, carts, haystacks, clotheslines, an outdoor cooking hearth, storage sheds, the fruit
// stall on the square, tables and stools. Each adds parts to a GeoBuilder in its local space (y = 0 on the
// ground, +z its front); the farm's props (barrels, wood piles, benches, lamp posts…) are reused as they are.
import * as THREE from 'three';
import { C, boards, wheel, hayBale, woodPile, barrel, crate } from '../farm/props.js';
import { lumpGeo, limb } from '../flora.js';

const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const STONES = [0x9b9a94, 0x8a8880, 0xa8a59c, 0x7e7c75];

// the village well: a stone ring, a little tiled roof on two posts, the winch and a bucket
export function well(b) {
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; for (const y of [0.2, 0.52]) b.add(lumpGeo(0, 0.12, 300 + i + y * 10), STONES[(i + (y > 0.3 ? 1 : 0)) % 4], Math.cos(a) * 1.0, y, Math.sin(a) * 1.0, 0, -a, 0, 'solid', 0.3, 0.2, 0.22); }
  b.cyl(0.98, 0.98, 0.05, 14, 0, 0.62, 0, 0x8a877f);
  b.cyl(0.78, 0.78, 0.04, 14, 0, 0.45, 0, 0x2f5a78, 0, 0, 0, 'glass');
  for (const s of [-1, 1]) b.box(0.16, 2.1, 0.16, s * 0.95, 1.05, 0, C.woodD);
  for (const s of [-1, 1]) b.group(0, 2.25, s * 0.42, s * 0.62, 0, 0, () => { b.box(2.5, 0.1, 1.15, 0, 0, 0, 0xb5452f); for (let z = -0.45; z < 0.5; z += 0.3) b.box(2.52, 0.04, 0.06, 0, 0.06, z, 0x8e3424); });
  b.box(2.52, 0.12, 0.2, 0, 2.62, 0, 0x8e3424);
  b.cyl(0.08, 0.08, 1.8, 8, 0, 1.55, 0, C.wood, 0, 0, Math.PI / 2);
  b.box(0.05, 0.5, 0.05, 1.05, 1.4, 0, C.iron); b.box(0.05, 0.05, 0.25, 1.05, 1.15, 0.1, C.iron);
  b.box(0.02, 0.6, 0.02, 0, 1.2, 0, C.rope);
  b.cyl(0.16, 0.13, 0.26, 8, 0, 0.82, 0, C.woodL); b.cyl(0.17, 0.17, 0.03, 8, 0, 0.95, 0, C.iron);
}
// a wooden hand cart with two wheels (load: hay | crates | none)
export function cart(b, load = 'hay') {
  b.group(0, 0, 0, 0, 0, 0, () => {
    boards(b, 1.6, 0.08, 0, 0.62, 0, C.woodL, 1, 0, 1.1);
    for (const s of [-1, 1]) { b.box(1.6, 0.35, 0.06, 0, 0.82, s * 0.55, C.wood); b.box(0.06, 0.35, 1.1, s * 0.8, 0.82, 0, C.wood); }
    for (const s of [-1, 1]) wheel(b, 0, 0.55, s * 0.68, 0.55, Math.PI / 2);
    b.cyl(0.04, 0.04, 1.5, 5, 0, 0.55, 0, C.iron, Math.PI / 2, 0, 0);
    for (const s of [-0.4, 0.4]) b.box(1.5, 0.07, 0.07, 1.45, 0.55, s, C.woodD, 'solid', 0, 0, 0.25);
    if (load === 'hay') { b.add(lumpGeo(1, 0.14, 331), C.hay, 0, 1.1, 0, 0, 0, 0, 'solid', 0.85, 0.42, 0.62); b.add(lumpGeo(0, 0.2, 332), C.hayD, 0.2, 1.4, 0.1, 0, 0, 0, 'solid', 0.5, 0.25, 0.4); }
    else if (load === 'crates') { crate(b, -0.35, 0.66, 0, 0.5, C.woodXL); crate(b, 0.3, 0.66, 0.1, 0.45, C.woodL, 0.3); b.add(lumpGeo(0, 0.2, 333), 0xe0442a, -0.35, 1.25, 0, 0, 0, 0, 'solid', 0.22, 0.12, 0.22); }
  });
}
// a round haystack with a pole, or a stack of bales
export function haystack(b, bales = false) {
  if (bales) { hayBale(b, 0, 0, 0, 0); hayBale(b, 0.15, 0.62, 0.05, 0.3); hayBale(b, -1.05, 0, 0.1, 1.4); return; }
  b.add(lumpGeo(1, 0.1, 341), C.hay, 0, 0.75, 0, 0, 0, 0, 'solid', 1.2, 0.95, 1.2);
  b.add(new THREE.ConeGeometry(0.95, 1.1, 9), C.hayD, 0, 1.75, 0);
  b.cyl(0.04, 0.04, 3.0, 4, 0, 1.5, 0, C.woodD);
  for (let i = 0; i < 6; i++) { const a = i; b.add(new THREE.ConeGeometry(0.06, 0.4, 3), C.hayD, Math.cos(a) * 1.15, 0.2, Math.sin(a) * 1.15, Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8); }
}
// a clothesline between two posts with washing hanging on it
export function clothesline(b, len = 3.4) {
  for (const s of [-1, 1]) { b.box(0.1, 1.9, 0.1, s * len / 2, 0.95, 0, C.woodD); b.box(0.06, 0.06, 0.5, s * len / 2, 1.85, 0, C.woodD); }
  for (const z of [-0.18, 0.18]) b.box(len, 0.015, 0.015, 0, 1.82, z, C.rope);
  const cols = [0xe0443a, 0x3f7fd6, 0xf2c14e, 0xf7f6ef, 0x6cbb3c, 0xe98ab0, 0x8a5ad6];
  for (let x = -len / 2 + 0.35, i = 0; x < len / 2 - 0.2; x += 0.55, i++) {
    const h = 0.4 + (i % 3) * 0.15, z = i % 2 ? 0.18 : -0.18;
    b.box(0.42, h, 0.02, x, 1.82 - h / 2, z, cols[i % cols.length], 'solid', 0, 0, (i % 2 ? 1 : -1) * 0.04);
  }
}
// an outdoor cooking place: a ring of stones, firewood, a pot on a tripod; it glows at night
export function hearth(b) {
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; b.add(lumpGeo(0, 0.15, 350 + i), STONES[i % 4], Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55, 0, -a, 0, 'solid', 0.18, 0.13, 0.16); }
  for (let i = 0; i < 4; i++) b.cyl(0.05, 0.05, 0.7, 5, 0, 0.1, 0, i % 2 ? C.wood : C.woodD, Math.PI / 2, i * 0.8, 0);
  b.add(new THREE.ConeGeometry(0.22, 0.3, 6), 0xff8a2a, 0, 0.25, 0, 0, 0, 0, 'lamp');
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; limb(b, [Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55], [0, 1.1, 0], 0.03, 0.025, C.woodD, 4); }
  b.cyl(0.24, 0.18, 0.3, 8, 0, 0.62, 0, 0x2f2c2a); b.box(0.02, 0.38, 0.02, 0, 0.92, 0, C.iron);
  b.light(0, 0.35, 0, 'fire');
  woodPile(b, 1.1, 0, -0.2, 2, 0.9, 0.3);
}
// a small storage shed of boards with a lean-to roof and a door
export function shed(b, w = 2.2, d = 1.8, h = 2.0) {
  b.box(w + 0.15, 0.15, d + 0.15, 0, 0.07, 0, 0x8a877f);
  b.box(w, h, d, 0, h / 2 + 0.12, 0, C.wood);
  for (const [face, len, ry, x, z] of [['f', w, 0, 0, d / 2], ['b', w, Math.PI, 0, -d / 2], ['l', d, -Math.PI / 2, -w / 2, 0], ['r', d, Math.PI / 2, w / 2, 0]]) {
    b.group(x, 0, z, 0, ry, 0, () => boards(b, len, h, 0, h / 2 + 0.12, 0.02, C.woodL, Math.round(h / 0.3), 0, 0.04));
    void face;
  }
  b.box(0.8, 1.6, 0.06, 0.3, 0.92, d / 2 + 0.06, C.woodD); b.box(0.05, 0.05, 0.08, 0.6, 0.95, d / 2 + 0.1, C.iron);
  b.group(0, h + 0.4, 0, 0.3, 0, 0, () => b.box(w + 0.5, 0.12, d + 0.7, 0, 0, 0, 0x6e4a2e));
}
// the fruit and vegetable stall on the square: a counter, crates of produce, a striped awning
export function stall(b) {
  b.box(2.6, 0.9, 1.0, 0, 0.45, 0, C.wood); boards(b, 2.6, 0.9, 0, 0.45, 0.52, C.woodL, 3, 0, 0.04);
  b.box(2.8, 0.08, 1.15, 0, 0.94, 0, C.woodXL);
  const prod = [0xe0442a, 0xf2902a, 0x6cbb3c, 0xf2c14e, 0x8a4ad0];
  for (let i = 0; i < 5; i++) {
    const x = -1.05 + i * 0.52;
    b.box(0.46, 0.14, 0.62, x, 1.05, 0.05, C.woodL);
    for (let k = 0; k < 6; k++) b.add(new THREE.IcosahedronGeometry(0.075, 0), prod[i], x - 0.14 + (k % 3) * 0.14, 1.17 + (k > 2 ? 0.05 : 0), (k > 2 ? -0.08 : 0.14), 0, k, 0);
  }
  for (const [x, z] of [[-1.3, -0.45], [1.3, -0.45], [-1.3, 0.55], [1.3, 0.55]]) b.box(0.1, 2.5, 0.1, x, 1.25, z, C.woodD);
  b.group(0, 2.45, 0.05, 0.32, 0, 0, () => { for (let i = 0; i < 8; i++) b.box(3.0 / 8, 0.06, 1.5, -1.5 + (i + 0.5) * 3.0 / 8, 0, 0, i % 2 ? 0xf6f2e8 : 0xd0362a); });
  for (let i = 0; i < 8; i++) b.add(new THREE.ConeGeometry(0.1, 0.2, 3), i % 2 ? 0xf6f2e8 : 0xd0362a, -1.5 + (i + 0.5) * 3.0 / 8, 2.1, 0.82, Math.PI, 0, 0);
  crate(b, 1.75, 0, 0.1, 0.5, C.woodXL); barrel(b, -1.8, 0, 0.2, C.wood);
}
// a small table with two stools
export function tableSet(b) {
  b.cyl(0.55, 0.55, 0.06, 8, 0, 0.75, 0, C.woodL);
  b.cyl(0.06, 0.08, 0.72, 6, 0, 0.36, 0, C.woodD);
  for (const s of [-1, 1]) { b.cyl(0.22, 0.22, 0.05, 7, s * 0.85, 0.45, 0, C.wood); for (let k = 0; k < 3; k++) b.box(0.04, 0.44, 0.04, s * 0.85 + Math.cos(k * 2.1) * 0.15, 0.22, Math.sin(k * 2.1) * 0.15, C.woodD); }
  b.cyl(0.07, 0.06, 0.12, 6, 0.15, 0.84, 0.1, 0xc0603a);
}
// a row of clay pots and water pots
export function pots(b) {
  const col = [0xc0603a, 0xa8502e, 0xb86a42];
  for (let i = 0; i < 4; i++) { const x = i * 0.45, r = 0.16 + (i % 2) * 0.06; b.add(new THREE.SphereGeometry(r, 7, 5), col[i % 3], x, r * 0.9, 0, 0, 0, 0, 'solid', 1, 0.9, 1); b.cyl(r * 0.5, r * 0.6, 0.1, 7, x, r * 1.75, 0, col[(i + 1) % 3]); }
}
export { woodPile, barrel };

/* ---------- for the villagers (js/village/ai.js) ---------- */
// a charpai: a wooden cot strung with rope, for sitting outside the house (local +z: the side you sit on)
export function charpai(b) {
  for (const [x, z] of [[-0.9, -0.42], [0.9, -0.42], [-0.9, 0.42], [0.9, 0.42]]) b.box(0.08, 0.44, 0.08, x, 0.22, z, C.woodD);
  for (const s of [-1, 1]) { b.box(1.95, 0.07, 0.07, 0, 0.4, s * 0.43, C.wood); b.box(0.07, 0.07, 0.92, s * 0.94, 0.4, 0, C.wood); }
  for (let i = 0; i < 8; i++) b.box(1.8, 0.02, 0.06, 0, 0.42, -0.36 + i * 0.103, i % 2 ? 0xd8c8a0 : 0xc8b48a);
  for (let i = 0; i < 6; i++) b.box(0.05, 0.025, 0.82, -0.75 + i * 0.3, 0.425, 0, 0xbca47a);
  b.box(0.5, 0.08, 0.62, -0.62, 0.47, -0.02, 0xc84a3a); b.box(0.5, 0.02, 0.64, -0.62, 0.5, -0.02, 0xe0b040);
}
// a football goal: two posts and a bar (local x = 0 the goal line, the net behind it toward -x)
export function goal(b) {
  const W = 0xf2efe6, N = 0xdedad0;
  for (const s of [-1, 1]) { b.box(0.08, 1.12, 0.08, 0, 0.56, s * 1.1, W); b.box(0.04, 1.32, 0.04, -0.36, 0.53, s * 1.1, N, 'solid', 0, 0, 0.6); b.box(0.75, 0.04, 0.04, -0.37, 0.03, s * 1.1, N); }
  b.box(0.08, 0.08, 2.28, 0, 1.12, 0, W);
  b.box(0.04, 0.04, 2.2, -0.73, 0.03, 0, N);
  for (let z = -0.9; z <= 0.91; z += 0.3) b.box(0.012, 1.3, 0.012, -0.36, 0.53, z, N, 'solid', 0, 0, 0.6);
  for (let y = 0.25; y < 1.1; y += 0.28) b.box(0.012, 0.012, 2.2, -(1.12 - y) * 0.62, y, 0, N);
}
// a football: a faceted ball, white with dark patches
export function football() {
  const g = new THREE.IcosahedronGeometry(0.11, 1), n = g.attributes.position.count, col = new Float32Array(n * 3), w = new THREE.Color(0xf4f2ec), k = new THREE.Color(0x222226);
  for (let f = 0; f < n / 3; f++) { const c = f % 5 === 0 ? k : w; for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (f * 3 + v) * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
  return g;
}
// a hurricane lantern, hanging from its handle at (0, 0, 0): chimney, glowing glass in wire guards, a red tank
export function lantern(b) {
  const M = 0x3a3d40, D = 0x26282a;
  b.box(0.012, 0.06, 0.012, 0, -0.03, 0, M);
  b.box(0.13, 0.012, 0.012, 0, -0.005, 0, M);
  for (const s of [-1, 1]) b.box(0.012, 0.09, 0.012, s * 0.065, -0.05, 0, M);
  b.cyl(0.028, 0.032, 0.035, 8, 0, -0.075, 0, D);
  b.cyl(0.04, 0.072, 0.035, 8, 0, -0.1, 0, M);
  b.cyl(0.05, 0.056, 0.12, 8, 0, -0.18, 0, 0xffd27a, 0, 0, 0, 'lampGlass');
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; b.box(0.008, 0.13, 0.008, Math.cos(a) * 0.062, -0.18, Math.sin(a) * 0.062, M); }
  b.cyl(0.074, 0.08, 0.055, 8, 0, -0.27, 0, 0x9a2a1e);
  b.cyl(0.082, 0.082, 0.012, 8, 0, -0.3, 0, D);
}
