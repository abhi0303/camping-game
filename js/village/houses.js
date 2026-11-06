// The village's houses: one builder, many different houses. A house is put together from parts — walls of
// plaster, timber frame, stone, logs, boards or mud; a gable, hip, pyramid, thatched or saltbox roof (or a
// cone on a round hut); windows (square, arched, shuttered, round, barred), doors, porches, balconies,
// chimneys, side rooms, flower boxes and a stone foundation that follows the ground — and every house in
// HOUSES picks its own size, materials and parts, so no two look alike. Windows go into the 'win0..2' buckets
// (they light up at night, js/day-night.js), lanterns mark light points (GeoBuilder.light).
// Local frame: the house's middle at floor level (y = 0), the front (+z) facing the lane.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { C, boards, wallLantern } from '../farm/props.js';
import { buildCottage, COTTAGE } from './cottage.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const hull = pts => new ConvexGeometry(pts.map(p => V(...p)));
function prng(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return (a = 0, b = 1) => { s = (s * 16807) % 2147483647; return a + (s - 1) / 2147483646 * (b - a); }; }
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const TAU = Math.PI * 2;

/* ---------- the houses (each one different) ---------- */
// wall: plaster | timber | stone | logs | boards | mud · roof: gable | hip | pyramid | thatchGable | thatchHip | cone
export const HOUSES = [
  { name: 'Red tile cottage', w: 7, d: 5.4, floors: 1, wall: 'timber', wallCol: 0xf2e6c8, trim: 0x5b3a24, roof: 'gable', roofCol: 0xb8452f, pitch: 0.6,
    chimney: [-2, -0.9], porch: { w: 3.4, d: 1.7, rail: true }, win: { style: 'shutters', col: 0x4f7a3a }, door: { style: 'plank', col: 0x7a4a26 }, boxes: true, lantern: true, garden: 4.2 },
  { name: 'Timber two-storey', w: 7.2, d: 6, floors: 2, lower: 'stone', wall: 'timber', wallCol: 0xf4efe2, trim: 0x4a2f1d, roof: 'hip', roofCol: 0xa9402c, pitch: 0.55,
    chimney: [2.2, -1.2], balcony: true, win: { style: 'square' }, door: { style: 'arched', col: 0x5a3a20 }, lantern: true, garden: 4.4, pen: 'chicken' },
  { name: 'Round mud hut', shape: 'round', r: 2.5, w: 5, d: 5, floors: 1, wall: 'mud', wallCol: 0xc9905a, roof: 'cone', roofCol: 0xd6b35a, pitch: 0.75,
    win: { style: 'barred' }, door: { style: 'plank', col: 0x6e4626 }, garden: 3.4 },
  { name: 'Blue roof house', w: 6.6, d: 6, floors: 2, wall: 'plaster', wallCol: 0xf3efe6, trim: 0x4a3a2a, quoins: 0xc9c2b2, roof: 'gable', roofCol: 0x3d5f9e, pitch: 0.72,
    attic: 'round', chimney: [-2.1, 0.8], win: { style: 'shutters', col: 0x3d5f9e }, door: { style: 'plank', col: 0x3d5f9e }, boxes: true, garden: 4 },
  { name: 'Stone cottage', w: 6.2, d: 5, floors: 1, wall: 'stone', wallCol: 0x9b9a94, trim: 0x5b3a24, roof: 'gable', roofCol: 0x6e4a2e, pitch: 0.66,
    chimney: [2.2, 0], porch: { w: 2.4, d: 1.2 }, win: { style: 'square' }, door: { style: 'arched', col: 0x6e4626 }, lantern: true, garden: 3.8, pen: 'goat' },
  { name: 'Log cabin', w: 6.4, d: 5.2, floors: 1, wall: 'logs', wallCol: 0x9a6a3e, trim: 0x5b3a24, roof: 'gable', roofCol: 0x5d7a45, pitch: 0.62,
    chimney: [-2.4, -0.6], porch: { w: 6.4, d: 1.8, rail: true }, win: { style: 'square' }, door: { style: 'plank', col: 0x5a3a20 }, garden: 4 },
  { name: 'Thatched farmhouse', w: 7.6, d: 6.4, floors: 2, lower: 'stone', wall: 'timber', wallCol: 0xefe2c4, trim: 0x5b3a24, roof: 'thatchHip', roofCol: 0xd8b45a, pitch: 0.62,
    balcony: true, win: { style: 'shutters', col: 0x7a4a26 }, door: { style: 'plank', col: 0x6e4626 }, lantern: true, garden: 4.6, pen: 'cow' },
  { name: 'Pink house', w: 5.4, d: 5.4, floors: 2, wall: 'plaster', wallCol: 0xe9b7b4, trim: 0xf3eee6, quoins: 0xf3eee6, roof: 'hip', roofCol: 0xb5452f, pitch: 0.6,
    win: { style: 'arched' }, door: { style: 'arched', col: 0x3a8a8a }, boxes: true, garden: 3.8 },
  { name: 'Yellow gable house', w: 6, d: 6.8, floors: 2, wall: 'plaster', wallCol: 0xf0d48a, trim: 0x6e4a2e, roof: 'gable', ridgeZ: true, roofCol: 0x8a4a2a, pitch: 0.62,
    attic: 'square', balcony: true, win: { style: 'shutters', col: 0x4f7a3a }, door: { style: 'plank', col: 0x6e4a2e }, garden: 4 },
  { name: 'Mud verandah house', w: 8.4, d: 5, floors: 1, wall: 'mud', wallCol: 0xc78a52, band: true, roof: 'gable', roofCol: 0xc2603a, pitch: 0.45,
    porch: { w: 8.4, d: 2.1, posts: 5 }, win: { style: 'barred' }, door: { style: 'plank', col: 0x6e4626 }, garden: 4.4, pen: 'chicken' },
  { name: 'Stone tower house', w: 4.8, d: 4.8, floors: 2, wall: 'stone', wallCol: 0x8f8d86, trim: 0x4a2f1d, roof: 'pyramid', roofCol: 0xb5452f, pitch: 0.85,
    balcony: true, win: { style: 'arched' }, door: { style: 'arched', col: 0x5a3a20 }, lantern: true, garden: 3.6 },
  { name: 'Plank house', w: 6.2, d: 5.2, floors: 1, wall: 'boards', wallCol: 0x8a5a33, trim: 0x4a2f1d, roof: 'gable', ridgeOff: -1.0, roofCol: 0x5d636b, pitch: 0.55,
    annex: { side: 1, w: 2.4, d: 3.4, h: 2.1, wall: 'boards' }, win: { style: 'square' }, door: { style: 'plank', col: 0x6e4626 }, garden: 3.8, pen: 'horse' },
  { name: 'White and blue house', w: 6.8, d: 5.6, floors: 1, wall: 'plaster', wallCol: 0xf6f4ee, trim: 0x3a5e94, quoins: 0xd9dde4, roof: 'hip', roofCol: 0xc05a34, pitch: 0.58,
    porch: { w: 3.2, d: 1.6, rail: true }, win: { style: 'shutters', col: 0x3a5e94 }, door: { style: 'plank', col: 0x3a5e94 }, boxes: true, lantern: true, garden: 4 },
  { name: 'Thatch cottage', w: 5.6, d: 4.6, floors: 1, wall: 'plaster', wallCol: 0xf0e2c2, trim: 0x6e4a2e, roof: 'thatchGable', roofCol: 0xcfa84e, pitch: 0.85,
    win: { style: 'square' }, door: { style: 'plank', col: 0x4f7a3a }, boxes: true, garden: 3.8 },
  { name: 'Timber house with annex', w: 6.8, d: 5.6, floors: 1, wall: 'timber', wallCol: 0xeadcbc, trim: 0x5b3a24, roof: 'gable', roofCol: 0xb8452f, pitch: 0.6,
    chimney: [1.8, -1], annex: { side: -1, w: 2.6, d: 3.2, h: 2.2, wall: 'stone' }, win: { style: 'square' }, door: { style: 'plank', col: 0x7a4a26 }, garden: 4, pen: 'goat' },
  { name: 'Stone and wood house', w: 7, d: 6, floors: 2, lower: 'stone', wall: 'boards', wallCol: 0x9a6a3e, trim: 0x4a2f1d, roof: 'gable', roofCol: 0x6e4a2e, pitch: 0.6,
    chimney: [-2.4, -1], balcony: true, win: { style: 'square' }, door: { style: 'plank', col: 0x5a3a20 }, lantern: true, garden: 4.2 },
  { name: 'Small round hut', shape: 'round', r: 2.1, w: 4.2, d: 4.2, floors: 1, wall: 'mud', wallCol: 0xd4a06a, band: true, roof: 'cone', roofCol: 0xc0603a, pitch: 0.62, tiled: true,
    win: { style: 'barred' }, door: { style: 'plank', col: 0x7a4a26 }, garden: 3.2 },
  { name: 'Brick-red cottage', w: 6, d: 5, floors: 1, wall: 'plaster', wallCol: 0xc8775a, trim: 0xf0e2c2, quoins: 0xf0e2c2, roof: 'thatchGable', roofCol: 0xd8b45a, pitch: 0.72,
    porch: { w: 2.6, d: 1.4 }, win: { style: 'shutters', col: 0xf0e2c2 }, door: { style: 'arched', col: 0x5a3a20 }, garden: 3.8 },
  // the ivy cottage (js/village/cottage.js): its own builder; the side wing is its annex (for paths, steps and collisions)
  { name: 'Ivy cottage', shape: 'cottage', w: COTTAGE.w, d: COTTAGE.d, floors: 1, wall: 'stone', wallCol: 0xe9dfcd, trim: 0x6a4a32, roof: 'gable', roofCol: 0xa45a4e, pitch: 0.91,
    annex: { side: -1, ...COTTAGE.wing, wall: 'plaster' }, win: { style: 'square' }, door: { style: 'arched', col: 0x6f7d6c }, garden: 3.4,
    fence: 'picket', fenceCol: 0xdcc189, gardenKinds: ['flowers', 'veg'] },
];
// each house's own name, on the name plate at its gate (js/village/index.js: with its number, e.g. "04/D")
const TITLES = {
  'Red tile cottage': 'Lakshmi Kutir', 'Timber two-storey': 'Sharma Niwas', 'Round mud hut': 'Gopal Kutiya', 'Blue roof house': 'Neel Kamal',
  'Stone cottage': 'Shiv Sadan', 'Log cabin': 'Van Kutir', 'Thatched farmhouse': 'Kisan Ghar', 'Pink house': 'Gulab Niwas',
  'Yellow gable house': 'Suraj Bhawan', 'Mud verandah house': 'Ganga Niwas', 'Stone tower house': 'Shikhar Bhawan', 'Plank house': 'Verma Ghar',
  'White and blue house': 'Shanti Niwas', 'Thatch cottage': 'Tulsi Kutir', 'Timber house with annex': 'Yadav Sadan', 'Stone and wood house': 'Patel Bhawan',
  'Small round hut': 'Chhoti Kutiya', 'Brick-red cottage': 'Mitti Ghar', 'Ivy cottage': 'Lata Kutir',
};
for (const H of HOUSES) H.title = TITLES[H.name] || H.name;
// the village hall on the square (a little bigger, with a bell turret)
export const HALL = { name: 'Village hall', w: 10, d: 7, floors: 1, fh: 3.4, wall: 'plaster', wallCol: 0xf1e6cc, trim: 0x5b3a24, quoins: 0xb9b3a6,
  roof: 'gable', roofCol: 0xb5452f, pitch: 0.55, turret: true, porch: { w: 5, d: 2, posts: 4 }, win: { style: 'arched' }, door: { style: 'double', col: 0x6e4626 },
  lantern: true, garden: 3, big: true, title: 'Panchayat Bhawan' };

/* ---------- parts ---------- */
const STONE = [0x9b9a94, 0x8a8880, 0xa8a59c, 0x7e7c75, 0x93918a];
// run fn on a wall face: local x along the face, +z out of it (face: front | back | left | right)
function onFace(b, face, w, d, fn) {
  const F = { front: [0, d / 2, 0, w], back: [0, -d / 2, Math.PI, w], right: [w / 2, 0, Math.PI / 2, d], left: [-w / 2, 0, -Math.PI / 2, d] }[face];
  b.group(face === 'right' || face === 'left' ? F[0] : 0, 0, face === 'front' || face === 'back' ? F[1] : 0, 0, F[2], 0, () => fn(F[3]));
}
// a window in a face (x: along the face, y: bottom of the glass)
function windowAt(b, x, y, ww, wh, S, R) {
  const st = S.win.style, trim = S.trim || 0x5b3a24, glass = S.winBucket;
  b.box(ww + 0.16, wh + 0.16, 0.08, x, y + wh / 2, 0.03, trim);
  if (st === 'arched') {
    b.add(new THREE.CircleGeometry(ww / 2 + 0.08, 10, 0, Math.PI), trim, x, y + wh, 0.071);
    b.add(new THREE.CircleGeometry(ww / 2, 10, 0, Math.PI), 0x4f6170, x, y + wh, 0.085, 0, 0, 0, glass);
  }
  b.box(ww, wh, 0.04, x, y + wh / 2, 0.06, 0x4f6170, glass);
  if (st === 'barred') for (let i = 1; i < 4; i++) b.box(0.035, wh, 0.03, x - ww / 2 + i * ww / 4, y + wh / 2, 0.095, 0x4a3420);
  else { b.box(0.05, wh, 0.03, x, y + wh / 2, 0.09, trim); b.box(ww, 0.05, 0.03, x, y + wh * 0.55, 0.09, trim); }
  b.box(ww + 0.3, 0.07, 0.18, x, y - 0.05, 0.08, shade(trim, 0.9));                                         // sill
  if (st === 'shutters') for (const s of [-1, 1]) {
    const sx = x + s * (ww / 2 + ww * 0.27 + 0.06);
    b.box(ww * 0.52, wh + 0.08, 0.05, sx, y + wh / 2, 0.05, S.win.col);
    for (let k = 1; k < 5; k++) b.box(ww * 0.46, 0.025, 0.02, sx, y + k * wh / 5, 0.085, shade(S.win.col, 0.8));
  }
  if (S.boxes && R() < 0.75) {                                                                               // a flower box
    b.box(ww + 0.12, 0.18, 0.22, x, y - 0.2, 0.14, 0x7a4a26);
    const cols = [0xe0443a, 0xf2c14e, 0xf08ab0, 0xf7f6ef, 0xb06ad6];
    for (let k = 0; k < 5; k++) b.add(new THREE.IcosahedronGeometry(0.075, 0), cols[(k + Math.floor(x * 7)) % cols.length], x - ww / 2 + 0.1 + k * (ww - 0.2) / 4, y - 0.06, 0.16);
    b.box(ww, 0.08, 0.16, x, y - 0.1, 0.14, 0x4f8a34);
  }
}
function doorAt(b, x, S) {
  const D = S.door, dw = D.style === 'double' ? 1.7 : 1.05, dh = 2.05, trim = S.trim || 0x5b3a24;
  b.box(dw + 0.2, dh + 0.12, 0.08, x, dh / 2, 0.03, trim);
  b.box(dw, dh, 0.06, x, dh / 2, 0.06, D.col);
  if (D.style === 'arched' || D.style === 'double') {
    b.add(new THREE.CircleGeometry(dw / 2 + 0.1, 12, 0, Math.PI), trim, x, dh, 0.071);
    b.add(new THREE.CircleGeometry(dw / 2, 12, 0, Math.PI), D.col, x, dh, 0.085);
  }
  for (let i = 1; i < 4; i++) b.box(0.025, dh - 0.1, 0.02, x - dw / 2 + i * dw / 4, dh / 2, 0.095, shade(D.col, 0.8));
  if (D.style === 'double') b.box(0.04, dh, 0.03, x, dh / 2, 0.1, shade(D.col, 0.6));
  b.box(0.06, 0.06, 0.08, x + dw * 0.32, 1.0, 0.12, 0xd8b45a);                                               // handle
  b.box(dw + 0.5, 0.08, 0.5, x, dh + (D.style === 'plank' ? 0.25 : 0.62), 0.25, shade(trim, 0.95), 'solid', 0.22, 0, 0);   // a little canopy
}
// stone blocks scattered over a face (len wide, from y0 up h), leaving the holes free
function stoneBlocks(b, len, y0, h, R, holes = []) {
  for (let row = 0, y = y0 + 0.06; y < y0 + h - 0.2; row++, y += 0.36) {
    let x = -len / 2 + (row % 2 ? 0.3 : 0.05);
    while (x < len / 2 - 0.25) {
      const bw = R(0.45, 0.85), cx = x + bw / 2;
      if (R() < 0.72 && !holes.some(([hx0, hx1, hy0, hy1]) => cx + bw / 2 > hx0 && cx - bw / 2 < hx1 && y + 0.32 > hy0 && y < hy1))
        b.box(Math.min(bw, len / 2 - x) - 0.06, 0.3, 0.05, cx, y + 0.15, 0.025, STONE[Math.floor(R(0, STONE.length))]);
      x += bw;
    }
  }
}
// the walls of one floor: a box of the wall colour, then the material's look on every face
function floorWalls(b, S, w, d, y0, h, mat, col, R, holes) {
  if (mat === 'logs') {                                                                                    // log cabin: round logs crossing at the corners
    b.box(w - 0.2, h, d - 0.2, 0, y0 + h / 2, 0, shade(col, 0.8));
    for (let y = y0 + 0.16, i = 0; y < y0 + h; y += 0.3, i++) {
      const c = shade(col, 0.92 + (i % 3) * 0.06);
      for (const s of [-1, 1]) {
        b.cyl(0.16, 0.16, w + 0.5, 6, 0, y + (i % 2) * 0.15, s * (d / 2 - 0.05), c, 0, 0, Math.PI / 2);
        b.cyl(0.16, 0.16, d + 0.5, 6, s * (w / 2 - 0.05), y + ((i + 1) % 2) * 0.15, 0, shade(c, 0.95), Math.PI / 2, 0, 0);
      }
    }
    return;
  }
  b.box(w, h, d, 0, y0 + h / 2, 0, col);
  for (const face of ['front', 'back', 'left', 'right']) onFace(b, face, w, d, len => {
    const fh = holes[face] || [];
    if (mat === 'stone') stoneBlocks(b, len, y0, h, R, fh);
    else if (mat === 'boards') boards(b, len, h, 0, y0 + h / 2, 0.02, col, Math.round(h / 0.3), 0, 0.05);
    else if (mat === 'timber') {
      const tr = S.trim;
      b.box(len + 0.04, 0.16, 0.07, 0, y0 + 0.08, 0.03, tr); b.box(len + 0.04, 0.16, 0.07, 0, y0 + h - 0.08, 0.03, tr);
      b.box(len + 0.04, 0.1, 0.06, 0, y0 + 0.85, 0.03, tr);
      const xs = [-len / 2 + 0.07, len / 2 - 0.07, ...fh.map(([a, c]) => [a - 0.12, c + 0.12]).flat()];
      for (const x of xs) if (Math.abs(x) <= len / 2) b.box(0.14, h, 0.07, x, y0 + h / 2, 0.03, tr);
      // a brace in the end panels where there's room
      for (const s of [-1, 1]) {
        const x0 = s * (len / 2 - 0.07), free = !fh.some(([a, c]) => Math.min(Math.abs(a - x0), Math.abs(c - x0)) < 1.3 || (a < x0 && c > x0));
        if (free && len > 3) { const dx = -s * 1.0, dy = h - 0.95; b.box(0.12, Math.hypot(dx, dy), 0.06, x0 + dx / 2, y0 + 0.85 + dy / 2 - 0.05, 0.03, tr, 'solid', 0, 0, Math.atan2(dx, dy) * -1); }
      }
    } else if (mat === 'mud') {
      b.box(len + 0.06, 0.5, 0.06, 0, y0 + 0.25, 0.02, shade(col, 0.78));                                   // darker foot
      if (S.band) for (let x = -len / 2 + 0.3; x < len / 2 - 0.2; x += 0.42) {                              // white painted band
        if (fh.some(([a, c, hy0]) => x > a - 0.1 && x < c + 0.1 && hy0 < y0 + 1.6)) continue;
        b.add(new THREE.CircleGeometry(0.07, 6), 0xf6efe0, x, y0 + 1.45, 0.035);
        b.add(new THREE.CircleGeometry(0.045, 4), 0xf6efe0, x + 0.21, y0 + 1.45, 0.035);
      }
    } else if (mat === 'plaster' && S.quoins) {
      for (let y = y0 + 0.05, i = 0; y < y0 + h - 0.25; y += 0.34, i++) for (const s of [-1, 1]) b.box(i % 2 ? 0.34 : 0.5, 0.28, 0.05, s * (len / 2 - (i % 2 ? 0.17 : 0.25)), y + 0.14, 0.025, S.quoins);
    }
  });
}
// the windows and door of a floor (and the holes they leave, for the wall's pattern)
function openings(S, w, d, floor, y0, h) {
  const out = { front: [], back: [], left: [], right: [] }, list = [];
  const ww = S.win.style === 'arched' ? 0.8 : 0.95, wh = S.win.style === 'arched' ? 1.05 : 1.0, wy = y0 + (floor ? 0.75 : 0.95);
  for (const face of ['front', 'back', 'left', 'right']) {
    const len = face === 'front' || face === 'back' ? w : d;
    let n = Math.max(1, Math.floor((len - 1) / 2.3));
    if (face !== 'front' && face !== 'back') n = Math.min(n, 2);
    const xs = [];
    if (face === 'front' && !floor) {                                                                        // the door in the middle, a window each side
      xs.push({ door: true, x: 0 });
      const k = Math.max(1, Math.floor((len / 2 - 1) / 2.1));
      for (let i = 1; i <= k; i++) { const x = i * Math.min(2.1, (len / 2 - 0.4) / (k + 0.2)); xs.push({ x }, { x: -x }); }
    } else if (face === 'front' && floor && S.balcony) { xs.push({ door: true, x: 0, balcony: true }); if (len > 5) xs.push({ x: len / 2 - 1.1 }, { x: -len / 2 + 1.1 }); }
    else for (let i = 0; i < n; i++) xs.push({ x: -len / 2 + (i + 0.5) * len / n });
    for (const o of xs) {
      if (o.door) { const dw = S.door.style === 'double' ? 1.7 : 1.05; out[face].push([o.x - dw / 2 - 0.1, o.x + dw / 2 + 0.1, y0, y0 + 2.2]); }
      else out[face].push([o.x - ww / 2 - 0.1, o.x + ww / 2 + 0.1, wy - 0.1, wy + wh + 0.1]);
      list.push({ face, ...o, wy, ww, wh });
    }
  }
  return { holes: out, list };
}

/* ---------- roofs ---------- */
// a roof slab (local x along the ridge): tilted by rx, with tile rows (or thatch bands) on top
function slab(b, len, wid, t, cx, cy, cz, rx, col, kind) {
  b.group(0, cy, cz, rx, 0, 0, () => {
    b.box(len, t, wid, cx, 0, 0, col);
    const thatch = kind === 'thatch', step = thatch ? 0.55 : 0.36;
    for (let z = -wid / 2 + step / 2; z < wid / 2; z += step) b.box(len + 0.02, thatch ? 0.09 : 0.045, thatch ? 0.18 : 0.07, cx, t / 2 + 0.02, z, shade(col, thatch ? 0.86 : 0.82));
    if (thatch) b.box(len + 0.1, t + 0.06, 0.24, cx, -0.03, wid / 2 - 0.1, shade(col, 0.78));               // the thick eave edge
  });
}
// a gable roof over a w × d box (ridge along x), eaves at y0. Returns the ridge height.
function gable(b, S, w, d, y0, wallCol) {
  const p = S.pitch, o = 0.45, thatch = S.roof === 'thatchGable', t = thatch ? 0.38 : 0.16, off = S.ridgeOff || 0;
  // the ridge at z = off; each slope has its own pitch so that both eaves meet their walls (a saltbox when off ≠ 0)
  const ridgeY = y0 + (d / 2 + Math.abs(off)) * Math.tan(p);
  const len = w + 2 * o + (thatch ? 0.2 : 0);
  for (const s of [1, -1]) {
    const wallZ = s * d / 2, dist = Math.abs(wallZ - off), pp = Math.atan((ridgeY - y0) / dist);
    const z1 = wallZ + s * o, run = Math.abs(z1 - off), wid = run / Math.cos(pp), cz = (off + z1) / 2, cy = ridgeY - run / 2 * Math.tan(pp) + t / 2 / Math.cos(pp);
    slab(b, len, wid, t, 0, cy, cz, s * pp, S.roofCol, thatch ? 'thatch' : 'tile');
  }
  if (thatch) b.cyl(0.24, 0.24, len, 7, 0, ridgeY + 0.22, off, shade(S.roofCol, 0.9), 0, 0, Math.PI / 2);
  else b.box(len, 0.14, 0.3, 0, ridgeY + 0.12, off, shade(S.roofCol, 0.78));
  // the gable ends (wall colour), with an attic window
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.05);
    b.add(hull([[x, y0 - 0.01, -d / 2], [x, y0 - 0.01, d / 2], [x, ridgeY - 0.05, off], [x - s * 0.25, y0 - 0.01, -d / 2], [x - s * 0.25, y0 - 0.01, d / 2], [x - s * 0.25, ridgeY - 0.05, off]]), wallCol);
    if (S.wall === 'timber') { b.box(0.08, ridgeY - y0, 0.14, x + s * 0.03, (y0 + ridgeY) / 2, off, S.trim); }
    if (S.attic && ridgeY - y0 > 1.3) {
      const ay = y0 + (ridgeY - y0) * 0.42;
      b.group(x + s * 0.02, 0, off * 0.5, 0, s * Math.PI / 2, 0, () => {
        if (S.attic === 'round') { b.add(new THREE.CircleGeometry(0.38, 10), S.trim, 0, ay, 0.04); b.add(new THREE.CircleGeometry(0.3, 10), 0x4f6170, 0, ay, 0.05, 0, 0, 0, S.winBucket); }
        else { b.box(0.7, 0.7, 0.06, 0, ay, 0.04, S.trim); b.box(0.56, 0.56, 0.04, 0, ay, 0.07, 0x4f6170, S.winBucket); }
      });
    }
  }
  return ridgeY;
}
// a hip (or pyramid) roof as one solid, with caps along the ridge and the hips
function hip(b, S, w, d, y0) {
  const p = S.pitch, o = 0.45, thatch = S.roof === 'thatchHip', fas = thatch ? 0.4 : 0.18;
  const ew = w / 2 + o, ed = d / 2 + o, ey = y0 - o * Math.tan(p) * 0.6;
  const rise = Math.min(w, d) / 2 * Math.tan(p), ridge = S.roof === 'pyramid' ? 0 : Math.max(0, (w - d) / 2);
  const top = y0 + rise + fas;
  const pts = [[-ew, ey, -ed], [ew, ey, -ed], [ew, ey, ed], [-ew, ey, ed], [-ew, ey + fas, -ed], [ew, ey + fas, -ed], [ew, ey + fas, ed], [-ew, ey + fas, ed]];
  if (ridge > 0.05) pts.push([-ridge, top, 0], [ridge, top, 0]); else pts.push([0, top, 0]);
  b.add(hull(pts), S.roofCol);
  const capCol = shade(S.roofCol, thatch ? 0.85 : 0.78), apexA = [-ridge, top + 0.04, 0], apexB = [ridge, top + 0.04, 0];
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const ap = cx < 0 ? apexA : apexB;
    if (!thatch) limbBox(b, [cx * ew, ey + fas + 0.02, cz * ed], ap, 0.09, capCol);
  }
  if (ridge > 0.05 && !thatch) limbBox(b, apexA, apexB, 0.1, capCol);
  if (thatch) {                                                                                            // a second, smaller layer of thatch, and a darker fringe
    const k = 0.62, ey2 = ey + (top - ey) * 0.42;
    const p2 = [[-ew * k, ey2, -ed * k], [ew * k, ey2, -ed * k], [ew * k, ey2, ed * k], [-ew * k, ey2, ed * k], [-ew * k, ey2 + 0.3, -ed * k], [ew * k, ey2 + 0.3, -ed * k], [ew * k, ey2 + 0.3, ed * k], [-ew * k, ey2 + 0.3, ed * k]];
    if (ridge > 0.05) p2.push([-ridge, top + 0.22, 0], [ridge, top + 0.22, 0]); else p2.push([0, top + 0.22, 0]);
    b.add(hull(p2), shade(S.roofCol, 1.06));
    for (const s of [-1, 1]) { b.box(ew * 2 + 0.1, 0.16, 0.2, 0, ey - 0.02, s * ed, shade(S.roofCol, 0.76)); b.box(0.2, 0.16, ed * 2 + 0.1, s * ew, ey - 0.02, 0, shade(S.roofCol, 0.76)); }
    b.cyl(0.18, 0.26, 0.4, 6, 0, top + 0.4, 0, shade(S.roofCol, 0.8));
  }
  return top;
}
// a thin box from a to c (roof caps)
function limbBox(b, a, c, r, col) {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], len = Math.hypot(dx, dy, dz);
  const m = new THREE.Matrix4().lookAt(V(...a), V(...c), V(0, 1, 0)), e = new THREE.Euler().setFromRotationMatrix(m);
  b.add(new THREE.BoxGeometry(r * 2, r * 1.4, len), col, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, e.x, e.y, e.z);
}

/* ---------- a whole house ---------- */
// H: { spec, base } · gAt(lx, lz): the ground height (relative to the floor) under a local point
export function buildHouse(b, H, gAt, seed) {
  const S = H.spec, R = prng(seed * 977 + 31);
  S.winBucket = 'win' + (seed % 3);
  if (S.shape === 'round') return roundHut(b, S, gAt, R);
  if (S.shape === 'cottage') return buildCottage(b, H, gAt, R, S.winBucket);
  const w = S.w, d = S.d, fh = S.fh || 2.7, uh = 2.5, floors = S.floors || 1;
  const lo = Math.min(...[[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]].map(([x, z]) => gAt(x, z)));
  // the stone foundation down to the ground
  const ph = Math.max(0.35, -lo + 0.3);
  b.box(w + 0.32, ph, d + 0.32, 0, 0.12 - ph / 2, 0, 0x8a877f);
  b.box(w + 0.42, 0.1, d + 0.42, 0, 0.1, 0, 0x9e9b92);
  // floors
  let y = 0.12;
  for (let f = 0; f < floors; f++) {
    const h = f ? uh : fh, mat = f === 0 && S.lower ? S.lower : S.wall, col = f === 0 && S.lower === 'stone' ? 0x9b9a94 : S.wallCol;
    const op = openings(S, w, d, f, y, h);
    floorWalls(b, S, w, d, y, h, mat, col, R, op.holes);
    for (const o of op.list) onFace(b, o.face, w, d, () => {
      const dz = mat === 'logs' ? 0.16 : 0;
      b.group(0, 0, dz, 0, 0, 0, () => {
        if (o.door && !o.balcony) doorAt(b, o.x, { ...S, trim: S.trim });
        else if (o.door) { b.box(1.05, 2.0, 0.06, o.x, y + 1.0, 0.06, S.door.col); b.box(1.25, 2.1, 0.08, o.x, y + 1.05, 0.03, S.trim); b.box(0.9, 0.9, 0.04, o.x, y + 1.35, 0.1, 0x4f6170, S.winBucket); }
        else windowAt(b, o.x, o.wy, o.ww, o.wh, S, R);
      });
    });
    if (f < floors - 1) b.box(w + 0.16, 0.18, d + 0.16, 0, y + h + 0.02, 0, S.trim || 0x5b3a24);       // the floor band between storeys
    y += h;
  }
  // roof
  let ridgeY;
  const roofS = { ...S };
  if (S.roof === 'gable' || S.roof === 'thatchGable') {
    if (S.ridgeZ) { b.group(0, 0, 0, 0, Math.PI / 2, 0, () => { ridgeY = gable(b, roofS, d, w, y, S.wallCol); }); }
    else ridgeY = gable(b, roofS, w, d, y, S.wall === 'stone' ? 0x9b9a94 : S.wall === 'logs' || S.wall === 'boards' ? S.wallCol : S.wallCol);
  } else ridgeY = hip(b, roofS, w, d, y);
  // chimney
  if (S.chimney) {
    const [cx, cz] = S.chimney, top = ridgeY + 0.7;
    b.box(0.62, top - y + 0.2, 0.62, cx, (top + y) / 2, cz, 0x8a8880);
    b.box(0.78, 0.14, 0.78, cx, top + 0.07, cz, 0x6f6c66);
    b.box(0.4, 0.06, 0.4, cx, top + 0.15, cz, 0x2a2622);
    for (let k = 0; k < 4; k++) b.box(0.64, 0.05, 0.64, cx, y + 0.4 + k * (top - y) / 4.5, cz, 0x7e7c75);
  }
  // a porch: deck, posts, railing and its own little roof
  if (S.porch) {
    const P = S.porch, pw = Math.min(P.w, w), pd = P.d, n = P.posts || 2, ph2 = fh + 0.05;
    boards(b, pw, 0.1, 0, 0.07, d / 2 + pd / 2, 0x9a6a3e, 1, 0, pd);
    for (let i = 0; i < Math.round(pd / 0.25); i++) b.box(pw, 0.03, 0.02, 0, 0.13, d / 2 + 0.12 + i * 0.25, 0x6e4626);
    b.box(pw + 0.1, -lo + 0.1, 0.12, 0, 0.12 + lo / 2, d / 2 + pd, 0x6e4626);
    for (let i = 0; i < n; i++) { const x = -pw / 2 + 0.12 + i * (pw - 0.24) / (n - 1); b.box(0.14, ph2, 0.14, x, ph2 / 2 + 0.12, d / 2 + pd - 0.12, S.trim); }
    if (P.rail) for (const s of [-1, 1]) {
      const x0 = s * pw / 2;
      b.box(0.06, 0.06, pd, x0 - s * 0.06, 0.95, d / 2 + pd / 2, S.trim);
      for (let z = d / 2 + 0.2; z < d / 2 + pd - 0.1; z += 0.22) b.box(0.04, 0.8, 0.04, x0 - s * 0.06, 0.55, z, S.trim);
    }
    const rz = d / 2 + pd + 0.25, rw = (pd + 0.35) / Math.cos(0.32);
    b.group(0, ph2 + 0.3 + (pd + 0.35) / 2 * Math.tan(0.32), d / 2 + (pd + 0.35) / 2 - 0.05, 0.32, 0, 0, () => b.box(pw + 0.5, 0.12, rw, 0, 0, 0, S.roof.startsWith('thatch') ? S.roofCol : shade(S.roofCol, 0.95)));
    void rz;
    // steps down to the ground in front of the porch
    const front = gAt(0, d / 2 + pd + 0.6), steps = Math.max(0, Math.ceil((0.12 - front) / 0.22));
    for (let i = 1; i <= steps; i++) b.box(1.3, 0.22, 0.34, 0, 0.12 - i * 0.22 + 0.11, d / 2 + pd + i * 0.32 - 0.1, 0x9e9b92);
  } else {
    const front = gAt(0, d / 2 + 0.6), steps = Math.max(0, Math.ceil((0.12 - front) / 0.22));
    for (let i = 1; i <= steps; i++) b.box(1.4, 0.22, 0.34, 0, 0.12 - i * 0.22 + 0.11, d / 2 + i * 0.32 - 0.12, 0x9e9b92);
  }
  // a balcony on the upper floor
  if (S.balcony && floors > 1) {
    const by = fh + 0.12, bw = Math.min(3.2, w * 0.55);
    boards(b, bw, 0.1, 0, by, d / 2 + 0.5, 0x8a5a33, 1, 0, 1.0);
    b.box(bw, 0.06, 0.06, 0, by + 0.95, d / 2 + 0.98, S.trim);
    for (let x = -bw / 2; x <= bw / 2 + 0.01; x += 0.22) b.box(0.05, 0.9, 0.05, x, by + 0.5, d / 2 + 0.98, S.trim);
    for (const s of [-1, 1]) { b.box(0.06, 0.06, 1.0, s * bw / 2, by + 0.95, d / 2 + 0.5, S.trim); limbBox(b, [s * (bw / 2 - 0.2), by - 0.75, d / 2 + 0.05], [s * (bw / 2 - 0.2), by - 0.05, d / 2 + 0.85], 0.05, S.trim); }
    b.box(0.5, 0.35, 0.3, -bw / 2 + 0.4, by + 0.2, d / 2 + 0.7, 0xc0603a); b.add(new THREE.IcosahedronGeometry(0.28, 0), 0x5fae3a, -bw / 2 + 0.4, by + 0.55, d / 2 + 0.7);
  }
  // a side room with a lean-to roof
  if (S.annex) {
    const A = S.annex, ax = A.side * (w / 2 + A.w / 2), az = -d / 2 + A.d / 2 + 0.2;
    b.group(ax, 0, az, 0, 0, 0, () => {
      const alo = Math.min(gAt(ax - A.w / 2, az), gAt(ax + A.w / 2, az), gAt(ax, az + A.d / 2));
      b.box(A.w + 0.2, -alo + 0.3, A.d + 0.2, 0, 0.12 + alo / 2 - 0.1, 0, 0x8a877f);
      floorWalls(b, { ...S, wall: A.wall }, A.w, A.d, 0.12, A.h, A.wall, A.wall === 'stone' ? 0x9b9a94 : S.wallCol, R, { front: [[-0.5, 0.5, 0.12, 2]] });
      onFace(b, 'front', A.w, A.d, () => { b.box(0.95, 1.9, 0.06, 0, 1.07, 0.06, 0x6e4626); b.box(1.1, 2.0, 0.07, 0, 1.1, 0.03, S.trim); });
      const run = A.w + 0.5, rr = 0.42, wid = run / Math.cos(rr);
      b.group(0, A.h + 0.12 + 0.35, 0, 0, 0, A.side * rr, () => b.box(wid, 0.14, A.d + 0.6, 0, 0, 0, S.roof.startsWith('thatch') ? S.roofCol : shade(S.roofCol, 0.92)));
    });
  }
  if (S.turret) turret(b, S, ridgeY);
  if (S.lantern) wallLanternAt(b, S, d);
  return { ridgeY };
}
function wallLanternAt(b, S, d) {
  const dx = S.door.style === 'double' ? 1.3 : 0.95, z = d / 2 + (S.porch ? 0 : 0);
  b.group(dx, 1.3, z, 0, 0, 0, () => wallLantern(b, 0, 0, 0));
}
// the hall's bell turret on the ridge
function turret(b, S, ridgeY) {
  const y0 = ridgeY - 0.3, h = 1.6, s = 1.3;
  b.box(s, 0.5, s, 0, y0 + 0.25, 0, S.wallCol);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(0.18, h, 0.18, x * (s / 2 - 0.09), y0 + 0.5 + h / 2, z * (s / 2 - 0.09), S.trim);
  b.cyl(0.18, 0.32, 0.45, 8, 0, y0 + 0.5 + h * 0.62, 0, 0xc9a23a);                                           // the bell
  b.box(0.06, 0.2, 0.06, 0, y0 + 0.5 + h * 0.62 - 0.3, 0, 0x6f5a2a);
  b.add(hull([[-s / 2 - 0.2, y0 + 0.5 + h, -s / 2 - 0.2], [s / 2 + 0.2, y0 + 0.5 + h, -s / 2 - 0.2], [s / 2 + 0.2, y0 + 0.5 + h, s / 2 + 0.2], [-s / 2 - 0.2, y0 + 0.5 + h, s / 2 + 0.2], [0, y0 + 0.5 + h + 1.3, 0]]), S.roofCol);
  b.cyl(0.03, 0.03, 0.6, 4, 0, y0 + 0.5 + h + 1.55, 0, 0x3a3a3e);
}
// a round hut: a cylinder of mud, a conical roof (thatch or tiles), a door and a couple of small windows
function roundHut(b, S, gAt, R) {
  const r = S.r, h = 2.5, seg = 12;
  const lo = Math.min(...Array.from({ length: 8 }, (_, i) => gAt(Math.cos(i / 8 * TAU) * r, Math.sin(i / 8 * TAU) * r)), gAt(0, 0));
  const ph = Math.max(0.35, -lo + 0.3);
  b.cyl(r + 0.2, r + 0.28, ph, seg, 0, 0.12 - ph / 2, 0, 0x8a877f);
  b.cyl(r, r, h, seg, 0, 0.12 + h / 2, 0, S.wallCol);
  b.cyl(r + 0.03, r + 0.05, 0.5, seg, 0, 0.37, 0, shade(S.wallCol, 0.78));
  if (S.band) b.cyl(r + 0.02, r + 0.02, 0.26, seg, 0, 1.5, 0, 0xf6efe0);
  // door (front) and two windows (sides)
  b.group(0, 0.12, r - 0.02, 0, 0, 0, () => doorAt(b, 0, S));
  for (const a of [1.15, -1.15]) b.group(Math.sin(a) * (r - 0.02), 0, Math.cos(a) * (r - 0.02), 0, a, 0, () => windowAt(b, 0, 1.15, 0.6, 0.6, S, R));
  // the roof
  const rr = r + 0.65, rh = rr * Math.tan(S.pitch);
  b.add(new THREE.ConeGeometry(rr, rh, seg), S.roofCol, 0, 0.12 + h + rh / 2 - 0.1, 0);
  if (S.tiled) for (let k = 1; k < 4; k++) { const f = k / 4; b.add(new THREE.CylinderGeometry(rr * (1 - f) + 0.04, rr * (1 - f) + 0.09, 0.07, seg, 1, true), shade(S.roofCol, 0.8), 0, 0.12 + h - 0.1 + rh * f, 0); }
  else { b.cyl(rr + 0.02, rr + 0.12, 0.22, seg, 0, 0.12 + h - 0.1, 0, shade(S.roofCol, 0.78)); b.cyl(0.08, 0.2, 0.5, 6, 0, 0.12 + h + rh - 0.1, 0, shade(S.roofCol, 0.8)); }
  return { ridgeY: h + rh };
}
