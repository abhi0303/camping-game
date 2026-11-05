// Low-poly farm models: plot shelters with their pens (fence, gate, troughs, dirt ground), plot
// signboards, the farm storage (level 1 and 2), the Farm Store, the Market, the delivery truck, the
// windmill and the animals. Models are built in their own frame (front = +z, ground at y = 0 under the
// centre); hAt(x, z) gives the ground height at a local point, so posts and floors sit on slopes.
import * as THREE from 'three';
import { GeoBuilder, canvasTexture } from '../utils.js';
import { C, FARM_MAT, planks, boards, crate, barrel, eggCrate, eggStack, milkCan, hayBale, sack, lantern, lampPost, wallLantern, woodPile,
  stonePile, stoneBin, wheel, bench, shelf, stockShelf, fenceRun } from './props.js';

const flat = () => 0;
const build = b => b.build(FARM_MAT);

/* ---------- signs ---------- */
function woodTexture(text, sub, w, h, bg = '#6b4423', icon = '') {
  return canvasTexture(w, h, (c, cw, ch) => {
    c.fillStyle = bg; c.fillRect(0, 0, cw, ch);
    // planks and grain
    const n = 3;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i % 2 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.05)'; c.fillRect(0, i * ch / n, cw, ch / n);
      c.strokeStyle = 'rgba(40,20,8,.45)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, i * ch / n); c.lineTo(cw, i * ch / n); c.stroke();
      c.strokeStyle = 'rgba(40,20,8,.18)'; c.lineWidth = 1;
      for (let k = 0; k < 5; k++) { const y = i * ch / n + (k + 0.6) * ch / n / 6; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(cw * 0.3, y + 3, cw * 0.6, y - 3, cw, y + 1); c.stroke(); }
    }
    c.strokeStyle = '#3a2412'; c.lineWidth = Math.max(6, ch * 0.07); c.strokeRect(3, 3, cw - 6, ch - 6);
    for (const [x, y] of [[14, 14], [cw - 14, 14], [14, ch - 14], [cw - 14, ch - 14]]) { c.fillStyle = '#2a1a0c'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); }
    c.fillStyle = '#f6e7bf'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowOffsetY = 2; c.shadowBlur = 2;
    const big = sub ? ch * 0.42 : ch * 0.5;
    c.font = `bold ${big}px Georgia, serif`;
    c.fillText((icon ? icon + ' ' : '') + text, cw / 2, sub ? ch * 0.4 : ch * 0.53, cw - 30);
    if (sub) { c.font = `bold ${ch * 0.2}px Arial, sans-serif`; c.fillText(sub, cw / 2, ch * 0.78, cw - 30); }
  });
}
// a text panel readable from both sides
function textPanel(tex, w, h) {
  const g = new THREE.Group(), geo = new THREE.PlaneGeometry(w, h), mat = new THREE.MeshLambertMaterial({ map: tex });
  const f = new THREE.Mesh(geo, mat), k = new THREE.Mesh(geo, mat);
  f.position.z = 0.051; k.position.z = -0.051; k.rotation.y = Math.PI;
  g.add(f, k);
  return g;
}
// a wooden signboard on two posts standing on the ground (front = +z)
export function signboard(text, sub = '', { w = 1.5, h = 0.62, lift = 0.75, hAt = flat, bg } = {}) {
  const g = new THREE.Group(), b = new GeoBuilder();
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 0.03), gy = hAt(x, 0);
    b.box(0.11, lift + h + 0.55 - gy, 0.11, x, gy - 0.4 + (lift + h + 0.55 - gy) / 2, 0, C.woodD);
    b.add(new THREE.ConeGeometry(0.09, 0.12, 4), C.woodD, x, lift + h + 0.21, 0, 0, Math.PI / 4, 0);
  }
  b.box(w + 0.16, h + 0.14, 0.09, 0, lift + h / 2, 0, C.woodD);                // frame
  b.box(w + 0.3, 0.06, 0.2, 0, lift + h + 0.1, 0, C.roof);                    // little cap
  g.add(build(b));
  const p = textPanel(woodTexture(text, sub, 512, Math.round(512 * h / w), bg), w, h);
  p.position.set(0, lift + h / 2, 0);
  g.add(p);
  return g;
}
// a sign board fixed on a wall (front = +z)
export function wallSign(text, sub, w, h, icon = '', bg) {
  const g = new THREE.Group(), b = new GeoBuilder();
  b.box(w + 0.2, h + 0.2, 0.08, 0, 0, -0.03, C.woodD);
  g.add(build(b));
  const p = textPanel(woodTexture(text, sub, 768, Math.round(768 * h / w), bg, icon), w, h);
  p.position.z = 0.02; g.add(p);
  return g;
}

/* ---------- roofs ---------- */
// a gable roof along x over a building w wide, d deep, starting at height y, with shingle rows
function gableRoof(b, w, d, y, rise, color, over = 0.4, colorD = C.roofD) {
  const half = d / 2 + over, len = Math.hypot(half, rise), a = Math.atan2(rise, half);
  for (const s of [1, -1]) {
    b.group(0, y + rise / 2, s * half / 2, s * a, 0, 0, () => {
      b.box(w + over * 2, 0.12, len, 0, 0, 0, colorD);
      const rows = Math.max(3, Math.round(len / 0.38));
      for (let i = 0; i < rows; i++) b.box(w + over * 2 + 0.04, 0.06, len / rows + 0.06, 0, 0.08 + (i % 2) * 0.012, -len / 2 + (i + 0.5) * len / rows, i % 2 ? color : colorD);
    });
  }
  b.box(w + over * 2 + 0.1, 0.16, 0.26, 0, y + rise + 0.04, 0, C.woodD);       // ridge
  for (const s of [-1, 1]) b.box(0.12, 0.2, len * 2 * Math.cos(a), s * (w / 2 + over), y + rise / 2 - 0.04, 0, C.woodD);   // fascia (approx)
}
// triangular gable wall (front/back) as stacked boards, x from -w/2..w/2, rising `rise` above y
function gableWall(b, w, y, rise, z, color) {
  const n = Math.max(3, Math.round(rise / 0.22));
  for (let i = 0; i < n; i++) { const k = 1 - (i + 0.5) / n; b.box(w * k, rise / n * 0.96, 0.1, 0, y + (i + 0.5) * rise / n, z, i % 2 ? color : shadeOf(color, 0.94)); }
}
const shadeOf = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

/* ---------- plot shelters ---------- */
// footprint of each building at the back of its plot (local x half-width, z range)
export const SHELTER_FOOT = { coop: { hw: 2.2, z0: -5.8, z1: -2.6 }, goat_shed: { hw: 3.2, z0: -6.2, z1: -2.2 }, barn: { hw: 4.1, z0: -6.5, z1: -1.6 }, stable: { hw: 4.1, z0: -6.4, z1: -1.8 } };

function groundRange(hAt, x0, x1, z0, z1) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const g = hAt(x0 + (x1 - x0) * i / 4, z0 + (z1 - z0) * j / 4); lo = Math.min(lo, g); hi = Math.max(hi, g); }
  return [lo, hi];
}

export function shelterModel(type, hAt = flat) {
  const b = new GeoBuilder(), F = SHELTER_FOOT[type] || SHELTER_FOOT.coop;
  const [lo, hi] = groundRange(hAt, -F.hw, F.hw, F.z0, F.z1), y0 = hi + 0.12, cz = (F.z0 + F.z1) / 2, dep = F.z1 - F.z0;
  b.box(F.hw * 2 + 0.3, y0 - lo + 0.4, dep + 0.3, 0, (y0 + lo - 0.4) / 2, cz, C.stoneD);          // stone foundation
  for (let i = 0; i < 6; i++) b.box(0.5, 0.14, 0.04, -F.hw + 0.4 + i * (F.hw * 2 - 0.8) / 5, y0 - 0.2, F.z1 + 0.16, C.stoneL);
  if (type === 'coop') coop(b, y0, cz);
  else if (type === 'goat_shed') goatShed(b, y0, cz);
  else if (type === 'barn') barn(b, y0, cz);
  else stable(b, y0, cz);
  penFence(b, hAt, F.hw);
  troughs(b, hAt);
  scatter(b, hAt);
  return build(b);
}
function coop(b, y0, cz) {
  b.group(0, y0, cz, 0, 0, 0, () => {
    for (const x of [-1.8, 1.8]) for (const z of [-1.3, 1.3]) b.box(0.14, 0.6, 0.14, x, 0.3, z, C.woodD);
    b.box(4.1, 0.14, 3.1, 0, 0.66, 0, C.woodD);
    boards(b, 3.9, 1.7, 0, 1.58, 1.48, C.woodL); boards(b, 3.9, 1.7, 0, 1.58, -1.48, C.woodL);
    boards(b, 2.9, 1.7, -1.93, 1.58, 0, C.woodL, undefined, Math.PI / 2); boards(b, 2.9, 1.7, 1.93, 1.58, 0, C.woodL, undefined, Math.PI / 2);
    for (const x of [-1.98, 1.98]) for (const z of [-1.52, 1.52]) b.box(0.14, 1.8, 0.14, x, 1.58, z, C.woodD);
    gableWall(b, 3.9, 2.43, 0.9, 1.5, C.woodL); gableWall(b, 3.9, 2.43, 0.9, -1.5, C.woodL);
    b.group(0, 0, 0, 0, Math.PI / 2, 0, () => gableRoof(b, 3.1, 4.1, 2.43, 0.95, C.red, 0.35, C.redD));
    b.box(0.8, 1.0, 0.08, 0.6, 1.25, 1.54, C.woodD); b.box(0.68, 0.88, 0.04, 0.6, 1.25, 1.59, 0x3a2414);   // little door
    b.box(0.7, 0.5, 0.06, -0.9, 1.75, 1.53, C.white); b.box(0.58, 0.38, 0.05, -0.9, 1.75, 1.56, C.glass, 'glass');
    b.box(0.05, 0.5, 0.06, -0.9, 1.75, 1.58, C.white);
    wallLantern(b, 1.45, 1.35, 1.52);                                                                   // a lamp by the door
    // nesting boxes on the side with a lid
    b.box(0.9, 0.6, 2.0, 2.4, 1.15, -0.1, C.wood); b.box(1.0, 0.08, 2.1, 2.42, 1.5, -0.1, C.redD, 'solid', 0, 0, -0.25);
    for (const z of [-0.7, -0.1, 0.5]) b.box(0.02, 0.5, 0.04, 2.86, 1.15, z + 0.3, C.woodD);
    // ramp down into the pen with slats
    b.group(0.6, 0.35, 2.35, -0.38, 0, 0, () => { b.box(0.8, 0.06, 1.9, 0, 0, 0, C.wood); for (let i = 0; i < 6; i++) b.box(0.82, 0.05, 0.05, 0, 0.05, -0.8 + i * 0.32, C.woodD); });
  });
}
function goatShed(b, y0, cz) {
  b.group(0, y0, cz, 0, 0, 0, () => {
    planks(b, 6, 2.4, 0, 1.2, -1.9, C.wood);
    planks(b, 3.8, 2.4, -2.95, 1.2, 0, C.woodD, undefined, Math.PI / 2); planks(b, 3.8, 2.4, 2.95, 1.2, 0, C.woodD, undefined, Math.PI / 2);
    for (const x of [-2.95, 0, 2.95]) b.box(0.18, 2.95, 0.18, x, 1.48, 1.9, C.woodD);
    b.box(6.2, 0.18, 0.2, 0, 2.95, 1.9, C.woodD);
    lantern(b, 1.5, 2.4, 1.9);                                                                          // hangs from the front beam
    b.group(0, 3.0, 0, -0.17, 0, 0, () => { b.box(6.8, 0.12, 4.7, 0, 0, 0, C.roofGD); for (let i = 0; i < 9; i++) b.box(6.84, 0.05, 0.56, 0, 0.08 + (i % 2) * 0.01, -2.2 + i * 0.55, i % 2 ? C.roofG : C.roofGD); });
    hayBale(b, -1.8, 0, -1.2); hayBale(b, -1.8, 0.5, -1.2, 0.2); hayBale(b, 1.6, 0, -1.2, -0.1);
    b.box(1.4, 0.9, 0.12, 0.2, 0.9, -1.75, C.woodL);                          // hay rack
    for (let i = 0; i < 6; i++) b.box(0.04, 0.8, 0.05, -0.4 + i * 0.24, 0.9, -1.68, C.woodD);
  });
}
function barn(b, y0, cz) {
  b.group(0, y0, cz, 0, 0, 0, () => {
    planks(b, 8, 3.2, 0, 1.6, 2.43, C.red, 22); planks(b, 8, 3.2, 0, 1.6, -2.43, C.red, 22);
    planks(b, 4.8, 3.2, -3.98, 1.6, 0, C.redD, 13, Math.PI / 2); planks(b, 4.8, 3.2, 3.98, 1.6, 0, C.redD, 13, Math.PI / 2);
    for (const x of [-4.02, 4.02]) for (const z of [-2.45, 2.45]) b.box(0.16, 3.25, 0.16, x, 1.62, z, C.white);
    gableWall(b, 8, 3.2, 1.7, 2.43, C.red); gableWall(b, 8, 3.2, 1.7, -2.43, C.red);
    b.group(0, 0, 0, 0, Math.PI / 2, 0, () => gableRoof(b, 4.8, 8, 3.2, 1.75, C.roof, 0.45));
    b.box(2.6, 2.6, 0.06, 0, 1.3, 2.48, C.white); b.box(2.3, 2.3, 0.08, 0, 1.25, 2.5, C.red);
    for (const s of [1, -1]) b.box(0.14, 3.1, 0.06, 0, 1.25, 2.55, C.white, 'solid', 0, 0, s * 0.78);
    b.box(0.08, 2.4, 0.07, 0, 1.25, 2.56, C.white);
    b.box(1.3, 1.0, 0.08, 0, 3.85, 2.47, C.white); b.box(1.1, 0.8, 0.06, 0, 3.85, 2.5, 0x3a2a20, 'window');   // the loft window
    for (const s of [-1, 1]) wallLantern(b, s * 1.75, 1.95, 2.5);
  });
}
function stable(b, y0, cz) {
  b.group(0, y0, cz, 0, 0, 0, () => {
    boards(b, 8, 2.8, 0, 1.4, -2.15, C.wood);
    boards(b, 4.3, 2.8, -3.95, 1.4, 0, C.woodD, undefined, Math.PI / 2); boards(b, 4.3, 2.8, 3.95, 1.4, 0, C.woodD, undefined, Math.PI / 2);
    for (const x of [-1.32, 1.32]) b.box(0.12, 1.7, 3.8, x, 0.85, -0.2, C.woodD);
    for (const x of [-2.64, 0, 2.64]) { boards(b, 2.3, 1.15, x, 0.6, 2.12, C.woodL, 4); b.box(0.08, 1.4, 0.06, x, 0.65, 2.18, C.woodD, 'solid', 0, 0, 0.9); }
    for (const x of [-3.98, -1.32, 1.32, 3.98]) b.box(0.16, 2.85, 0.16, x, 1.42, 2.12, C.woodD);
    gableWall(b, 8, 2.8, 1.2, -2.15, C.wood);
    gableRoof(b, 8, 4.4, 2.8, 1.25, C.roofG, 0.45, C.roofGD);
    b.box(1.2, 0.6, 0.06, 0, 2.4, 2.2, C.woodXL);
    for (const s of [-1, 1]) { b.box(0.04, 0.32, 0.04, s * 2.64, 2.65, 2.3, C.iron); lantern(b, s * 2.64, 2.05, 2.3); }   // small lanterns at the stalls
    hayBale(b, -2.6, 0, -1.4); barrel(b, 2.8, 0, -1.4);
  });
}
// the pen in front of a shelter: a fence with a gap for the gate (the gate is its own model)
export const PEN_FENCE = { x: 5, z0: -1.7, z1: 6, gate: 1.25 };
function penFence(b, hAt, hw) {
  const P = PEN_FENCE, back = Math.min(P.x, hw + 0.15);
  fenceRun(b, -P.x, P.z0, -P.x, P.z1, hAt);
  fenceRun(b, P.x, P.z0, P.x, P.z1, hAt);
  fenceRun(b, -P.x, P.z1, -P.gate, P.z1, hAt);
  fenceRun(b, P.gate, P.z1, P.x, P.z1, hAt);
  if (back < P.x - 0.3) { fenceRun(b, -P.x, P.z0, -back, P.z0, hAt, { corners: false }); fenceRun(b, back, P.z0, P.x, P.z0, hAt, { corners: false }); }
  for (const s of [-1, 1]) { const g = hAt(s * P.gate, P.z1); b.box(0.2, 1.9, 0.2, s * P.gate, g + 0.55, P.z1, C.woodD); b.box(0.28, 0.08, 0.28, s * P.gate, g + 1.52, P.z1, C.wood); }   // gate posts
  lantern(b, P.gate, hAt(P.gate, P.z1) + 1.52, P.z1);                                                   // a lamp on the gate post
}
export const TROUGH_FEED = { x: -2.9, z: 4.5 }, TROUGH_WATER = { x: 2.9, z: 4.5 };
function troughs(b, hAt) {
  for (const [T, fill] of [[TROUGH_FEED, 'feed'], [TROUGH_WATER, 'water']]) {
    const g = hAt(T.x, T.z);
    b.group(T.x, g, T.z, 0, 0, 0, () => {
      for (const s of [-1, 1]) b.box(0.12, 0.42, 0.62, s * 0.78, 0.2, 0, C.woodD);
      boards(b, 1.7, 0.36, 0, 0.32, 0.27, C.wood, 2, 0, 0.06); boards(b, 1.7, 0.36, 0, 0.32, -0.27, C.wood, 2, 0, 0.06);
      b.box(1.7, 0.06, 0.5, 0, 0.16, 0, C.woodD);
      if (fill === 'feed') { b.box(1.55, 0.1, 0.44, 0, 0.42, 0, C.hay); for (let i = 0; i < 8; i++) b.box(0.05, 0.03, 0.04, -0.6 + i * 0.17, 0.48, -0.1 + (i % 3) * 0.1, 0xb8862e); }
      else b.box(1.55, 0.06, 0.44, 0, 0.44, 0, 0x4f86b8, 'glass');
    });
  }
  const s = hAt(-2.9, 3.7); sack(b, -4.3, s, 3.6, 0.4, C.sack);
}
// seeds and pebbles on the dirt
function scatter(b, hAt) {
  let r = 7;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) {
    const x = -4.4 + rnd() * 8.8, z = -1 + rnd() * 6.6, g = hAt(x, z);
    if (i % 3) b.box(0.05, 0.02, 0.03, x, g + 0.05, z, i % 2 ? 0xd8b24e : 0xb8862e, 'solid', 0, rnd() * 3, 0);
    else b.add(new THREE.DodecahedronGeometry(0.06 + rnd() * 0.08, 0), [C.stone, C.stoneD, C.stoneL][i % 3], x, g + 0.03, z, rnd(), rnd(), 0);
  }
}

// dirt ground of a pen that follows the terrain: patchy soil, worn spots by the troughs and gate, grass at the edges
export function penGround(hAt) {
  const nx = 18, nz = 14, x0 = -4.9, x1 = 4.9, z0 = -1.6, z1 = 5.95;
  const pos = [], col = [], c = new THREE.Color();
  const noise = (x, z) => Math.sin(x * 2.1 + z * 0.7) * Math.cos(z * 1.7 - x * 0.4) + Math.sin(x * 5.3 - z * 4.1) * 0.35;
  const vtx = (i, j) => {
    const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz, n = noise(x, z);
    const edge = Math.min(x - x0, x1 - x, z1 - z) < 0.45 && n > -0.2;
    const worn = Math.hypot(x - TROUGH_FEED.x, z - TROUGH_FEED.z) < 1.5 || Math.hypot(x, z - 5.9) < 1.6;
    c.setHex(edge ? (n > 0.4 ? C.grass : C.grassD) : worn ? C.dirtD : n > 0.5 ? C.dirtL : n < -0.6 ? C.dirtD : C.dirt);
    if (!edge && n > 0.9) c.setHex(C.grassD);                     // a few grass tufts
    return [x, hAt(x, z) + 0.035, z, c.r, c.g, c.b];
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = vtx(i, j), bb = vtx(i + 1, j), cc = vtx(i + 1, j + 1), d = vtx(i, j + 1);
    for (const v of [a, d, cc, a, cc, bb]) { pos.push(v[0], v[1], v[2]); col.push(v[3], v[4], v[5]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, FARM_MAT.solid);
  m.receiveShadow = true;
  return m;
}

// the pen gate: hinged at local x = -1.2 (pivot at the group origin), the leaf runs along +x
export function gateModel(groundY = 0) {
  const pivot = new THREE.Group(), b = new GeoBuilder(), w = 2.38;
  b.box(0.1, 1.2, 0.1, 0.06, groundY + 0.62, 0, C.woodD); b.box(0.1, 1.2, 0.1, w - 0.06, groundY + 0.62, 0, C.woodD);
  for (const y of [0.15, 0.62, 1.1]) b.box(w, 0.11, 0.07, w / 2, groundY + y + 0.08, 0, C.woodL);
  for (let i = 1; i < 6; i++) b.box(0.08, 1.0, 0.05, i * w / 6, groundY + 0.66, 0.04, C.wood);
  b.group(w / 2, groundY + 0.66, 0.06, 0, 0, Math.atan2(0.9, w - 0.2), () => b.box(Math.hypot(w - 0.2, 0.9), 0.1, 0.05, 0, 0, 0, C.woodD));
  b.box(0.06, 0.1, 0.14, w - 0.12, groundY + 0.85, 0, C.iron);                   // latch
  for (const y of [0.25, 1.05]) b.box(0.14, 0.06, 0.12, 0.02, groundY + y, 0, C.iron);   // hinges
  pivot.add(build(b));
  return pivot;
}

/* ---------- farm storage ---------- */
// level 1: a small open shed · level 2: a bigger storehouse with a porch, windows and lanterns (front = +z)
export function storageModel(level, hAt = flat) {
  const b = new GeoBuilder();
  if (level < 2) {
    const [lo, hi] = groundRange(hAt, -2.4, 2.4, -1.8, 1.6), y0 = hi + 0.1;
    b.box(4.8, y0 - lo + 0.3, 3.4, 0, (y0 + lo - 0.3) / 2, -0.1, C.stoneD);
    b.group(0, y0, 0, 0, 0, 0, () => {
      planks(b, 4.6, 2.3, 0, 1.15, -1.6, C.wood);
      planks(b, 3.2, 2.3, -2.25, 1.15, 0, C.woodD, undefined, Math.PI / 2); planks(b, 3.2, 2.3, 2.25, 1.15, 0, C.woodD, undefined, Math.PI / 2);
      for (const x of [-2.25, 2.25]) b.box(0.16, 2.7, 0.16, x, 1.35, 1.55, C.woodD);
      b.group(0, 2.55, 0, -0.16, 0, 0, () => { b.box(5.2, 0.1, 3.8, 0, 0, 0, C.roofGD); for (let i = 0; i < 7; i++) b.box(5.24, 0.05, 0.56, 0, 0.07, -1.65 + i * 0.55, i % 2 ? C.roofG : C.roofGD); });
      shelf(b, -1.2, 0, -1.2, 1.6, 1.6, 0.5, 3); stockShelf(b, -1.2, 0, -1.2, 1.6, 1.6, 3, ['crate', 'sack']);
      crate(b, 1.0, 0, -0.9, 0.6); crate(b, 1.05, 0.6, -0.95, 0.5, C.woodXL, 0.3); sack(b, 1.6, 0, 0.2, 0.4);
      b.box(0.03, 0.2, 0.03, -1.6, 2.62, 1.4, C.iron); lantern(b, -1.6, 2.06, 1.4);
    });
    woodPile(b, 3.3, hAt(3.3, 0), 0.2, 3, 1.5);
    stonePile(b, -3.3, hAt(-3.3, 0.6), 0.6, 6, 0.3);
    return build(b);
  }
  const [lo, hi] = groundRange(hAt, -4.4, 4.4, -2.9, 4.6), y0 = hi + 0.18;
  b.box(9.0, y0 - lo + 0.4, 7.6, 0, (y0 + lo - 0.4) / 2, 0.9, C.stoneD);
  for (let i = 0; i < 9; i++) b.box(0.8, 0.16, 0.05, -4 + i, y0 - 0.25, 4.72, i % 2 ? C.stoneL : C.stone);
  const g = hAt(0, 6.2), n = Math.max(1, Math.ceil((y0 - g) / 0.3)), rise = (y0 - g) / (n + 1);   // steps down to the walkway
  for (let k = 0; k < n; k++) { const top = y0 - (k + 1) * rise; b.box(3.2, top - g + 0.5, 0.4, 0, (top + g - 0.5) / 2, 4.9 + k * 0.4, k % 2 ? C.stone : C.stoneL); }
  b.group(0, y0, 0, 0, 0, 0, () => {
    b.box(8.8, 0.1, 7.4, 0, 0.02, 0.9, C.woodL);                                      // deck
    // walls: stone skirt + lap boards, white corner posts
    for (const [w, x, z, ry] of [[8.4, 0, -2.7, 0], [5.4, -4.15, 0, Math.PI / 2], [5.4, 4.15, 0, Math.PI / 2]]) {
      b.group(x, 0, z, 0, ry, 0, () => { b.box(w, 0.7, 0.2, 0, 0.35, 0, C.stone); boards(b, w, 2.6, 0, 2.0, 0, C.wood, 9); });
    }
    for (const s of [-1, 1]) { b.group(s * 2.9, 0, 2.7, 0, 0, 0, () => { b.box(2.6, 0.7, 0.2, 0, 0.35, 0, C.stone); boards(b, 2.6, 2.6, 0, 2.0, 0, C.wood, 9); }); }
    for (const x of [-4.2, 4.2]) for (const z of [-2.75, 2.75]) b.box(0.2, 3.4, 0.2, x, 1.7, z, C.white);
    boards(b, 3.2, 0.6, 0, 3.0, 2.7, C.wood, 2);                                       // over the door
    for (const s of [-1, 1]) {                                                          // open double doors
      b.group(s * 1.6, 0, 2.8, 0, s * -1.3, 0, () => { planks(b, 1.5, 2.6, -s * 0.75, 1.35, 0, C.red, 4); for (const d of [1, -1]) b.box(0.08, 2.9, 0.05, -s * 0.75, 1.35, 0.06, C.white, 'solid', 0, 0, d * 0.52); });
    }
    for (const s of [-1, 1]) { b.box(1.1, 0.9, 0.08, s * 2.9, 2.2, 2.82, C.white); b.box(0.92, 0.72, 0.05, s * 2.9, 2.2, 2.86, C.glow, 'window'); b.box(0.06, 0.72, 0.06, s * 2.9, 2.2, 2.9, C.white); b.box(0.92, 0.06, 0.06, s * 2.9, 2.2, 2.9, C.white); }
    gableWall(b, 8.4, 3.3, 1.7, 2.75, C.wood); gableWall(b, 8.4, 3.3, 1.7, -2.75, C.wood);
    b.group(0, 0, 0, 0, Math.PI / 2, 0, () => gableRoof(b, 5.6, 8.4, 3.3, 1.75, C.roof, 0.55));
    for (let i = 0; i < 5; i++) b.box(0.14, 0.18, 6.6, -3.6 + i * 1.8, 3.25, 0, C.woodD);                    // visible beams
    // porch roof on posts
    for (const x of [-4.1, -1.6, 1.6, 4.1]) b.box(0.18, 2.9, 0.18, x, 1.45, 4.5, C.woodD);
    b.box(8.6, 0.16, 0.2, 0, 2.95, 4.5, C.woodD);
    b.group(0, 3.15, 3.6, -0.22, 0, 0, () => { b.box(9.0, 0.1, 2.3, 0, 0, 0, C.roofD); for (let i = 0; i < 5; i++) b.box(9.04, 0.05, 0.48, 0, 0.07, -0.95 + i * 0.47, i % 2 ? C.roof : C.roofD); });
    lantern(b, -1.6, 2.35, 4.3); lantern(b, 1.6, 2.35, 4.3);
    // inside: shelves full of goods, barrels and sacks
    for (const x of [-2.7, 0, 2.7]) { shelf(b, x, 0.05, -2.2, 2.2, 2.2, 0.55, 4); stockShelf(b, x, 0.05, -2.2, 2.2, 2.2, 4, x < 0 ? ['egg', 'can', 'crate'] : x > 0 ? ['sack', 'jar', 'crate'] : ['crate', 'egg', 'sack']); }
    shelf(b, -3.6, 0.05, 0.4, 2.2, 2.0, 0.5, 4, Math.PI / 2); stockShelf(b, -3.6, 0.05, 0.4, 2.2, 2.0, 4, ['can', 'egg', 'jar'], Math.PI / 2);
    barrel(b, 3.4, 0.05, 1.2); barrel(b, 3.1, 0.05, 1.9, C.woodD); sack(b, 2.2, 0.05, 1.0, 0.3); sack(b, 2.6, 0.05, 1.5, -0.2);
    for (const x of [-1.2, 1.2]) { b.box(0.35, 0.25, 0.35, x, 3.0, 0.4, C.glow, 'lampGlass'); b.light(x, 2.85, 0.4, 'ceiling'); }   // ceiling lamps
    bench(b, 2.7, 0.05, 3.9); hayBale(b, -3.0, 0.05, 3.7, 0.1);
  });
  // side lean-to with wood and stone
  b.group(5.2, hAt(5.2, 0), 0, 0, 0, 0, () => {
    for (const z of [-2.2, 2.2]) b.box(0.14, 2.2, 0.14, 1.2, 1.1, z, C.woodD);
    b.group(0.6, 2.1, 0, 0, 0, -0.22, () => b.box(1.9, 0.08, 5, 0, 0, 0, C.roofGD));
    woodPile(b, 0.5, 0, -0.9, 3, 1.6); stoneBin(b, 0.5, 0, 1.3);
  });
  return build(b);
}

/* ---------- Farm Store (big red farm store with a porch and an interior) ---------- */
// The store is two models: `body` (floor, back and side walls, porch, everything inside) and `cut` (front
// wall, roof, gables, sign) which is hidden while a player is inside so the camera can see them.
// floor: height of the floor (local y, the caller works it out from the ground); the floor top is floor + 0.08.
export const STORE_DIM = { w: 14, d: 10, porch: 3, wall: 4.2, door: 2.2, stairs: 2.5 };
export function storeSteps(floor, hAt = flat) {
  const D = STORE_DIM.d, P = STORE_DIM.porch, z0 = D / 2 + P + 0.3, g = hAt(0, z0 + 1.6);
  const n = Math.max(2, Math.ceil((floor - g) / 0.3)), depth = 0.4;
  return { z0, z1: z0 + n * depth, n, depth, g, rise: (floor - g) / (n + 1) };
}
export function storeModel(floor, hAt = flat) {
  const b = new GeoBuilder(), r = new GeoBuilder(), W = STORE_DIM.w, D = STORE_DIM.d, Hw = STORE_DIM.wall, P = STORE_DIM.porch, F = floor, DW = STORE_DIM.door;
  const [lo] = groundRange(hAt, -W / 2 - 0.3, W / 2 + 0.3, -D / 2 - 0.3, D / 2 + P + 0.3);
  // stone plinth, wooden floor (inside + porch) and steps down to the road side
  b.box(W + 0.6, F - lo + 0.6, D + P + 0.6, 0, (F + lo - 0.6) / 2, P / 2, C.stoneD);
  for (let i = 0; i < 15; i++) b.box(0.86, 0.2, 0.05, -W / 2 + 0.2 + i * 0.97, F - 0.28, D / 2 + P + 0.31, i % 2 ? C.stoneL : C.stone);
  for (let i = 0; i < 20; i++) b.box(W - 0.1, 0.06, (D + P) / 20 - 0.02, 0, F + 0.05, -D / 2 + (i + 0.5) * (D + P) / 20, i % 2 ? C.woodL : C.woodXL);
  const S = storeSteps(F, hAt), SW = STORE_DIM.stairs;
  for (let k = 0; k < S.n; k++) {
    const top = F - (k + 1) * S.rise, bot = S.g - 0.5;
    b.box(SW * 2, top - bot, S.depth, 0, (top + bot) / 2, S.z0 + (k + 0.5) * S.depth, k % 2 ? C.stone : C.stoneL);
  }
  for (const s of [-1, 1]) b.box(0.3, F - S.g + 0.5, S.n * S.depth, s * (SW + 0.15), (F + S.g - 0.5) / 2 - 0.1, S.z0 + S.n * S.depth / 2, C.stoneD);
  b.group(0, F, 0, 0, 0, 0, () => {
    // back and side walls: red vertical planks, white corner trims, lit windows
    planks(b, W, Hw, 0, Hw / 2, -D / 2, C.red, 34);
    for (const s of [-1, 1]) planks(b, D, Hw, s * W / 2, Hw / 2, 0, C.redD, 26, Math.PI / 2);
    for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) b.box(0.24, Hw + 0.1, 0.24, x, Hw / 2, z, C.white);
    const win = (B, x, y, z, ry) => B.group(x, y, z, 0, ry, 0, () => {
      B.box(1.5, 1.3, 0.1, 0, 0, 0.02, C.white); B.box(1.3, 1.1, 0.05, 0, 0, 0.06, C.glow, 'window');
      B.box(0.07, 1.1, 0.08, 0, 0, 0.09, C.white); B.box(1.3, 0.07, 0.08, 0, 0, 0.09, C.white);
      B.box(1.7, 0.1, 0.25, 0, -0.72, 0.12, C.white);
    });
    for (const s of [-1, 1]) for (const z of [-2.5, 2.2]) win(b, s * (W / 2 + 0.05), 2.0, z, s * Math.PI / 2);
    // big doors swung open onto the porch
    for (const s of [-1, 1]) b.group(s * DW, 0, D / 2 + 0.1, 0, s * -1.45, 0, () => {
      planks(b, 2.1, 3.2, -s * 1.05, 1.65, 0, C.red, 6);
      for (const d of [1, -1]) b.box(0.1, 3.7, 0.06, -s * 1.05, 1.65, 0.07, C.white, 'solid', 0, 0, d * 0.58);
      b.box(2.12, 0.12, 0.07, -s * 1.05, 0.12, 0.07, C.white); b.box(2.12, 0.12, 0.07, -s * 1.05, 3.18, 0.07, C.white);
    });
    // porch: roof on pillars with braces, railings, lanterns
    for (const x of [-5.6, -2.3, 2.3, 5.6]) {
      b.box(0.26, 3.6, 0.26, x, 1.8, D / 2 + P - 0.25, C.woodD); b.box(0.42, 0.2, 0.42, x, 0.1, D / 2 + P - 0.25, C.stone);
      for (const s of [-1, 1]) b.group(x + s * 0.32, 3.3, D / 2 + P - 0.25, 0, 0, s * 0.75, () => b.box(0.1, 0.75, 0.1, 0, 0, 0, C.woodD));
    }
    b.box(12, 0.24, 0.3, 0, 3.6, D / 2 + P - 0.25, C.woodD);
    b.group(0, 3.95, D / 2 + P / 2 - 0.1, -0.2, 0, 0, () => { b.box(12.6, 0.12, P + 0.6, 0, 0, 0, C.roofD); for (let k = 0; k < 7; k++) b.box(12.64, 0.06, (P + 0.6) / 7 + 0.04, 0, 0.08 + (k % 2) * 0.01, -(P + 0.6) / 2 + (k + 0.5) * (P + 0.6) / 7, k % 2 ? C.roof : C.roofD); });
    for (const s of [-1, 1]) {
      fenceRun(b, s * (SW + 0.1), D / 2 + P - 0.05, s * (W / 2 - 0.1), D / 2 + P - 0.05, flat, { h: 0.95, spacing: 1.2, color: C.woodL });
      fenceRun(b, s * (W / 2 - 0.1), D / 2 + 0.15, s * (W / 2 - 0.1), D / 2 + P - 0.05, flat, { h: 0.95, spacing: 1.2, color: C.woodL });
    }
    lantern(b, -2.3, 2.9, D / 2 + P - 0.45); lantern(b, 2.3, 2.9, D / 2 + P - 0.45);
    for (const x of [-4.2, 4.2]) { b.box(0.03, 0.5, 0.03, x, 3.55, D / 2 + 1.3, C.iron); lantern(b, x, 2.86, D / 2 + 1.3); }   // over the displays
    // porch displays: eggs by the door (left), milk cans on the right, a bench
    b.box(2.4, 0.9, 0.8, -4.0, 0.45, D / 2 + 1.3, C.wood); b.box(2.6, 0.08, 0.95, -4.0, 0.93, D / 2 + 1.3, C.woodXL);
    for (let i = 0; i < 3; i++) eggStack(b, -4.8 + i * 0.75, 0.97, D / 2 + 1.3, 2 + (i % 2), 0, i === 1 ? [C.eggB, C.eggB] : i === 2 ? [C.eggD, C.egg] : [C.egg, C.egg, C.eggB]);
    for (const [x, z] of [[3.6, 1.1], [4.0, 1.5], [4.4, 1.0], [3.8, 1.9], [4.6, 1.8], [5.0, 1.3]]) milkCan(b, x, 0.05, D / 2 + z);
    bench(b, 5.6, 0.05, D / 2 + 2.3, Math.PI);
    // inside: shelves of eggs, milk, feed sacks and jars; a counter with a till; wood and stone corner; lamps
    for (const [x, kinds] of [[-5.2, ['egg', 'egg', 'can']], [-2.6, ['can', 'can', 'egg']], [0.2, ['sack', 'sack', 'crate']], [2.8, ['jar', 'crate', 'sack']]]) {
      shelf(b, x, 0.08, -D / 2 + 0.45, 2.3, 2.6, 0.55, 5); stockShelf(b, x, 0.08, -D / 2 + 0.45, 2.3, 2.6, 5, kinds);
    }
    for (const z of [-2.2, 0.3]) { shelf(b, -W / 2 + 0.45, 0.08, z, 2.3, 2.4, 0.55, 4, Math.PI / 2); stockShelf(b, -W / 2 + 0.45, 0.08, z, 2.3, 2.4, 4, ['egg', 'can', 'jar'], Math.PI / 2); }
    b.box(3.2, 1.05, 0.9, -3.4, 0.55, 2.2, C.wood); b.box(3.4, 0.08, 1.05, -3.4, 1.1, 2.2, C.woodXL);           // counter
    for (let i = 0; i < 6; i++) b.box(0.04, 0.95, 0.03, -4.9 + i * 0.6, 0.55, 2.66, C.woodD);
    b.box(0.5, 0.3, 0.4, -2.4, 1.29, 2.15, 0x2a2a30); b.box(0.42, 0.32, 0.06, -2.4, 1.55, 2.0, 0x2a2a30, 'solid', -0.25, 0, 0); b.box(0.36, 0.24, 0.02, -2.4, 1.56, 2.03, 0x9fe0a8, 'glow', -0.25, 0, 0);   // till
    eggCrate(b, -4.1, 1.14, 2.2); lantern(b, -3.3, 1.14, 2.35);
    woodPile(b, W / 2 - 1.2, 0.08, -2.6, 3, 1.4, Math.PI / 2); stoneBin(b, W / 2 - 1.3, 0.08, 0.2, Math.PI / 2);
    for (const [x, z] of [[4.6, 2.4], [5.2, 3.0], [2.8, 3.4]]) barrel(b, x, 0.08, z, z > 3 ? C.woodD : C.wood);
    for (const x of [-3.5, 0, 3.5]) for (const z of [-2, 1.5]) { b.box(0.05, 0.7, 0.05, x, Hw - 0.35, z, C.iron); b.box(0.5, 0.18, 0.5, x, Hw - 0.75, z, C.iron); b.box(0.36, 0.12, 0.36, x, Hw - 0.88, z, C.glow, 'lampGlass'); b.light(x, Hw - 1.0, z, 'ceiling'); }
  });
  // the part hidden while someone is inside: front wall, roof, gables, beams
  r.group(0, F, 0, 0, 0, 0, () => {
    planks(r, (W - DW * 2) / 2, Hw, -(W + DW * 2) / 4, Hw / 2, D / 2, C.red, 12);
    planks(r, (W - DW * 2) / 2, Hw, (W + DW * 2) / 4, Hw / 2, D / 2, C.red, 12);
    planks(r, DW * 2, Hw - 3.3, 0, 3.3 + (Hw - 3.3) / 2, D / 2, C.red, 11);
    for (const s of [-1, 1]) r.box(0.18, 3.35, 0.2, s * (DW + 0.05), 1.67, D / 2 + 0.02, C.white);
    r.box(DW * 2 + 0.3, 0.2, 0.22, 0, 3.35, D / 2 + 0.02, C.white);
    for (const x of [-4.6, 4.6]) r.group(x, 2.0, D / 2 + 0.05, 0, 0, 0, () => {
      r.box(1.5, 1.3, 0.1, 0, 0, 0.02, C.white); r.box(1.3, 1.1, 0.05, 0, 0, 0.06, C.glow, 'window');
      r.box(0.07, 1.1, 0.08, 0, 0, 0.09, C.white); r.box(1.3, 0.07, 0.08, 0, 0, 0.09, C.white);
      r.box(1.7, 0.1, 0.25, 0, -0.72, 0.12, C.white);
    });
    for (const x of [-3.2, 3.2]) lantern(r, x, 3.1, D / 2 + 0.3);
    // gambrel roof along x with shingles; gable walls front and back
    const prof = [[-W / 2 - 0.4, Hw - 0.1], [-W / 2 + 1.6, Hw + 1.9], [0, Hw + 3.1], [W / 2 - 1.6, Hw + 1.9], [W / 2 + 0.4, Hw - 0.1]];
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = prof[i], [x1, y1] = prof[i + 1], len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
      r.group((x0 + x1) / 2, (y0 + y1) / 2, 0, 0, 0, a, () => {
        r.box(len + 0.05, 0.16, D + 1.2, 0, 0, 0, C.roofD);
        const rows = Math.max(3, Math.round(len / 0.42));
        for (let k = 0; k < rows; k++) r.box(len / rows + 0.05, 0.07, D + 1.24, -len / 2 + (k + 0.5) * len / rows, 0.1 + (k % 2) * 0.012, 0, k % 2 ? C.roof : C.roofD);
      });
    }
    r.box(0.3, 0.2, D + 1.3, 0, Hw + 3.15, 0, C.woodD);
    const shape = new THREE.Shape([new THREE.Vector2(-W / 2, Hw), new THREE.Vector2(W / 2, Hw), new THREE.Vector2(W / 2 - 1.6, Hw + 1.85), new THREE.Vector2(0, Hw + 3.0), new THREE.Vector2(-W / 2 + 1.6, Hw + 1.85)]);
    for (const z of [D / 2, -D / 2]) {
      r.add(new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }), C.red, 0, 0, z - 0.07);
      for (let i = 0; i < 13; i++) { const x = -6 + i, top = Hw + (Math.abs(x) < 5.4 ? 3.0 - Math.abs(x) * (1.15 / 5.4) : 1.85 * (W / 2 - Math.abs(x)) / 1.6); r.box(0.05, top - Hw - 0.1, 0.03, x, (top + Hw) / 2, z + (z > 0 ? 0.09 : -0.09), C.redD); }
    }
    r.box(1.6, 1.2, 0.12, 0, Hw + 1.25, -D / 2 - 0.1, C.white); r.box(1.36, 0.96, 0.06, 0, Hw + 1.25, -D / 2 - 0.16, C.glow, 'window');
    for (let i = 0; i < 5; i++) r.box(W, 0.2, 0.18, 0, Hw - 0.12, -D / 2 + 1 + i * 2, C.woodD);               // ceiling beams
    r.box(W, 0.12, D, 0, Hw - 0.02, 0, C.woodD);                                                        // ceiling
  });
  const body = build(b), cut = build(r);
  const sign = wallSign('FARM STORE', 'eggs · milk · feed · animals', 5.4, 1.35);
  sign.position.set(0, F + Hw + 1.25, D / 2 + 0.2); cut.add(sign);
  return { body, cut };
}

/* ---------- Market: an open market hall with counters ---------- */
export function marketModel(hAt = flat) {
  const b = new GeoBuilder(), W = 9, D = 5;
  const [lo, hi] = groundRange(hAt, -W / 2, W / 2, -D / 2, D / 2), y0 = hi + 0.12;
  b.box(W + 0.4, y0 - lo + 0.3, D + 0.4, 0, (y0 + lo - 0.3) / 2, 0, C.stoneD);
  b.group(0, y0, 0, 0, 0, 0, () => {
    for (let i = 0; i < 14; i++) b.box(W, 0.06, D / 14 - 0.02, 0, 0.03, -D / 2 + (i + 0.5) * D / 14, i % 2 ? C.woodL : C.woodXL);
    for (const x of [-W / 2 + 0.2, -1.5, 1.5, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) { b.box(0.24, 3.2, 0.24, x, 1.6, z, C.woodD); b.box(0.36, 0.16, 0.36, x, 0.08, z, C.stone); }
    for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) b.box(W, 0.22, 0.26, 0, 3.2, z, C.woodD);
    for (const x of [-W / 2 + 0.2, -1.5, 1.5, W / 2 - 0.2]) b.box(0.22, 0.2, D, x, 3.2, 0, C.woodD);
    gableRoof(b, W, D, 3.3, 1.4, C.red, 0.5, C.redD);
    gableWall(b, W, 3.3, 1.35, D / 2 - 0.2, C.wood); gableWall(b, W, 3.3, 1.35, -D / 2 + 0.2, C.wood);
    // counters along the front with goods; striped awnings at the sides
    b.box(W - 1.2, 0.95, 0.8, 0, 0.48, D / 2 - 0.9, C.wood); b.box(W - 1, 0.08, 0.95, 0, 0.98, D / 2 - 0.9, C.woodXL);
    for (let i = 0; i < 8; i++) b.box(0.04, 0.85, 0.03, -3.4 + i, 0.48, D / 2 - 0.48, C.woodD);
    eggStack(b, -3.0, 1.02, D / 2 - 0.9, 2, 0, [C.egg, C.egg]); eggStack(b, -2.2, 1.02, D / 2 - 0.9, 2, 0, [C.eggB, C.eggB]); eggStack(b, -1.4, 1.02, D / 2 - 0.9, 1, 0, [C.eggD]);
    for (const x of [0, 0.4, 0.8]) milkCan(b, x, 1.02, D / 2 - 0.9, 0.8);
    // baskets of vegetables and a weighing scale
    for (const [x, col] of [[1.8, 0xd04a30], [2.5, 0xe8b030], [3.2, 0x6aa040]]) { b.cyl(0.26, 0.2, 0.22, 8, x, 1.13, D / 2 - 0.9, C.woodXL); for (let k = 0; k < 5; k++) b.add(new THREE.SphereGeometry(0.07, 6, 4), col, x - 0.12 + (k % 3) * 0.12, 1.28, D / 2 - 0.95 + Math.floor(k / 3) * 0.12); }
    b.box(0.3, 0.05, 0.3, -0.7, 1.06, D / 2 - 0.95, C.metalD); b.box(0.04, 0.3, 0.04, -0.7, 1.22, D / 2 - 0.95, C.metalD); b.box(0.5, 0.03, 0.03, -0.7, 1.38, D / 2 - 0.95, C.metalD);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) b.box(0.4, 0.06, 1.3, s * (W / 2 + 0.55), 2.55 - 0.0, -1.6 + i * 0.8 + 0.4, i % 2 ? C.white : C.red, 'solid', 0, 0, s * 0.35);
    // behind the counters: crates of goods, milk, barrels, a chalk price board
    for (const [x, z] of [[-3.4, -1.6], [-2.6, -1.7], [3.2, -1.6]]) crate(b, x, 0.06, z, 0.62);
    crate(b, -3.0, 0.68, -1.65, 0.5, C.woodXL, 0.3);
    for (const [x, z] of [[1.6, -1.6], [2.0, -1.8], [1.8, -1.25]]) milkCan(b, x, 0.06, z);
    barrel(b, 0.4, 0.06, -1.6); hayBale(b, -0.8, 0.06, -1.6, 0.2);
    b.box(1.6, 1.0, 0.08, 0, 2.2, -D / 2 + 0.28, 0x2a3a2e); b.box(1.75, 1.15, 0.06, 0, 2.2, -D / 2 + 0.24, C.woodD);
    lantern(b, -1.5, 2.6, D / 2 - 0.4); lantern(b, 1.5, 2.6, D / 2 - 0.4);
    for (const x of [-3.2, 3.2]) { b.box(0.03, 0.42, 0.03, x, 3.0, 0.9, C.iron); lantern(b, x, 2.36, 0.9); }   // hanging lamps over the stalls
  });
  return build(b);
}

/* ---------- delivery truck with chicken crates (front = +z) ---------- */
export function truckModel() {
  const b = new GeoBuilder(), CAB = 0xe6e2d6, TRIM = 0x3f5a78, TYRE = 0x222226;
  for (const z of [1.9, -1.2, -2.3]) for (const s of [-1, 1]) { b.cyl(0.46, 0.46, 0.34, 12, s * 1.05, 0.46, z, TYRE, 0, 0, Math.PI / 2); b.cyl(0.25, 0.25, 0.36, 8, s * 1.06, 0.46, z, C.metalD, 0, 0, Math.PI / 2); }
  b.box(1.9, 0.3, 6.4, 0, 0.75, 0, 0x2e2e33);                                         // chassis
  b.box(2.2, 1.0, 1.5, 0, 1.35, 2.55, CAB); b.box(2.25, 0.28, 1.55, 0, 0.98, 2.55, TRIM);   // hood
  b.box(2.2, 1.45, 1.6, 0, 2.05, 1.35, CAB);                                          // cab
  b.box(1.9, 0.7, 0.06, 0, 2.25, 2.16, C.glass, 'glass', -0.15, 0, 0);
  for (const s of [-1, 1]) { b.box(0.06, 0.6, 1.1, s * 1.11, 2.25, 1.35, C.glass, 'glass'); b.box(0.3, 0.2, 0.06, s * 0.75, 1.45, 3.31, C.glow, 'glow'); b.box(0.06, 0.3, 0.2, s * 1.2, 2.2, 2.2, C.iron); }
  b.box(2.3, 0.2, 0.16, 0, 0.82, 3.33, C.metalD); b.box(1.0, 0.3, 0.05, 0, 1.25, 3.31, C.metalD);   // bumper, grille
  // flat bed with wooden sides
  b.box(2.3, 0.14, 4.2, 0, 1.0, -1.25, C.woodD);
  for (const s of [-1, 1]) boards(b, 4.2, 0.8, s * 1.12, 1.5, -1.25, C.woodL, 3, Math.PI / 2, 0.08);
  boards(b, 2.3, 0.8, 0, 1.5, -3.32, C.woodL, 3, 0, 0.08);
  // chicken crates (wire cages with birds)
  for (let i = 0; i < 6; i++) {
    const x = (i % 2 ? 0.52 : -0.52), z = -0.1 - Math.floor(i / 2) * 1.05, y = 1.08 + (i > 3 ? 0 : 0);
    b.group(x, y, z, 0, 0, 0, () => {
      b.box(0.95, 0.04, 0.9, 0, 0.02, 0, C.woodD); b.box(0.95, 0.04, 0.9, 0, 0.62, 0, C.woodD);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.05, 0.62, 0.05, sx * 0.45, 0.32, sz * 0.42, C.woodD);
      for (let k = 0; k < 5; k++) { b.box(0.02, 0.58, 0.02, -0.36 + k * 0.18, 0.32, 0.44, C.metal); b.box(0.02, 0.58, 0.02, -0.36 + k * 0.18, 0.32, -0.44, C.metal); }
      for (let k = 0; k < 3; k++) b.add(new THREE.DodecahedronGeometry(0.13, 0), [C.egg, C.eggB, C.white][(i + k) % 3], -0.24 + k * 0.24, 0.2, (k % 2) * 0.12 - 0.06, 0, 0, 0, 'solid', 1, 0.9, 1.2);
    });
  }
  for (let i = 0; i < 2; i++) crate(b, -0.5 + i, 1.08, -3.0, 0.45, C.woodXL);
  return build(b);
}

/* ---------- windmill (the wheel turns: returned separately) ---------- */
export function windmillModel() {
  const tower = new GeoBuilder(), H = 8;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower.group(sx * 0.9, H / 2, sz * 0.9, sz * 0.11, 0, -sx * 0.11, () => tower.box(0.14, H, 0.14, 0, 0, 0, C.woodD));
  for (let i = 1; i < 5; i++) { const y = i * H / 5, k = 1 - y / H * 0.75, s = 0.9 * k + 0.1; for (const [ry, ox, oz] of [[0, 0, s], [0, 0, -s], [Math.PI / 2, s, 0], [Math.PI / 2, -s, 0]]) tower.box(s * 2, 0.08, 0.08, ox, y, oz, C.wood, 'solid', 0, ry, 0); }
  tower.box(0.6, 0.5, 0.9, 0, H + 0.1, 0, C.woodD);
  tower.box(0.08, 0.7, 1.6, 0, H + 0.2, -1.2, C.woodL);                                   // tail vane
  const wheelG = new GeoBuilder();
  for (let i = 0; i < 12; i++) wheelG.group(0, 0, 0, 0, 0, i * Math.PI / 6, () => { wheelG.box(0.06, 1.7, 0.04, 0, 0.95, 0, C.woodD); wheelG.box(0.34, 1.1, 0.03, 0.12, 1.15, 0.02, C.woodXL, 'solid', 0, 0.35, 0); });
  wheelG.cyl(0.18, 0.18, 0.3, 8, 0, 0, 0, C.iron, Math.PI / 2, 0, 0);
  const g = new THREE.Group(), w = build(wheelG);
  g.add(build(tower));
  w.position.set(0, H + 0.15, 0.55); g.add(w);
  return { group: g, wheel: w };
}

/* ---------- animals: one merged geometry each, facing +z, feet at y = 0 ---------- */
// horse coats: body, mane and tail, lower legs, a white face mark, brown patches (spotted)
const HORSE_COATS = {
  horse_bay: { body: 0x7a4a2a, mane: 0x1e140e, socks: 0x2a1a12 },
  horse_chestnut: { body: 0xa0522d, mane: 0x8a3e1e, socks: 0x8f4825, blaze: 0xf2eee6 },
  horse_black: { body: 0x24211f, mane: 0x121110, socks: 0x1a1817, blaze: 0xf2eee6 },
  horse_white: { body: 0xe6e2da, mane: 0xcfc9be, socks: 0xd8d2c8 },
  horse_palomino: { body: 0xd9a646, mane: 0xf5eedc, socks: 0xc99436, blaze: 0xf5eedc },
  horse_pinto: { body: 0xf0ece4, mane: 0x3a2414, socks: 0xe8e2d8, patches: 0x6e4024 },
};
function horse(b, o) {
  b.box(0.5, 0.56, 1.35, 0, 1.25, 0, o.body);
  rig(b, [2, 0, 1.42, 0.5], () => {                                    // neck and head (lower to graze)
    b.box(0.26, 0.6, 0.3, 0, 1.68, 0.62, o.body, 'solid', 0.55, 0, 0);
    b.box(0.24, 0.26, 0.56, 0, 1.98, 0.92, o.body, 'solid', 0.45, 0, 0);
    b.box(0.07, 0.5, 0.36, 0, 1.82, 0.56, o.mane, 'solid', 0.55, 0, 0);
    if (o.blaze) b.box(0.08, 0.04, 0.3, 0, 2.11, 0.98, o.blaze, 'solid', 0.45, 0, 0);
    for (const x of [-0.07, 0.07]) b.box(0.05, 0.12, 0.04, x, 2.16, 0.78, o.body);
    for (const x of [-0.125, 0.125]) b.box(0.012, 0.04, 0.04, x, 2.02, 0.98, 0x111111);     // eyes
    if (o.patches) b.box(0.27, 0.3, 0.2, 0, 1.75, 0.66, o.patches, 'solid', 0.55, 0, 0);
  });
  if (o.patches) { b.box(0.52, 0.34, 0.42, 0, 1.3, 0.28, o.patches); b.box(0.52, 0.28, 0.3, 0, 1.36, -0.42, o.patches); }
  for (const x of [-0.17, 0.17]) for (const z of [-0.5, 0.5]) rig(b, [1, (x < 0) === (z > 0) ? 0 : Math.PI, 0.98, z], () => {
    b.cyl(0.06, 0.055, 0.5, 5, x, 0.73, z, o.body);                    // upper leg
    b.cyl(0.055, 0.05, 0.42, 5, x, 0.27, z, o.socks);                  // lower leg
    b.cyl(0.06, 0.065, 0.07, 5, x, 0.035, z, 0x2a2420);                // hoof
  });
  rig(b, [3, 1e-4, 1.26, 0], () => b.box(0.1, 0.55, 0.1, 0, 1.0, -0.72, o.mane, 'solid', -0.3, 0, 0));   // tail (swishes)
}
// a cow (white with black patches): a faceted barrel body, an udder, jointed legs with dark hooves, a neck and
// a head with a pink muzzle, ears and short horns, a tail with a dark tuft. Faces +z, feet at y = 0.
const COW = { coat: 0xf4f1ea, patch: 0x2a2622, udder: 0xe8a8a0, nose: 0xe8a8a0, hoof: 0x2a2420, horn: 0xe8e0c8, eye: 0x1a1612, ear: 0xe8d8d0 };
function cow(b, o) {
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  b.add(ico(1), o.coat, 0, 1.02, 0.02, 0, 0, 0, 'solid', 0.33, 0.31, 0.7);
  b.add(ico(1, 0), o.coat, 0, 1.07, 0.42, 0, 0, 0, 'solid', 0.3, 0.29, 0.3);                                   // chest
  b.add(ico(1, 0), o.patch, 0.2, 1.08, 0.22, 0, 0, 0, 'solid', 0.15, 0.17, 0.24);
  b.add(ico(1, 0), o.patch, -0.21, 1.0, -0.2, 0, 0, 0, 'solid', 0.14, 0.2, 0.27);
  b.add(ico(1, 0), o.patch, 0.05, 1.3, -0.32, 0, 0, 0, 'solid', 0.18, 0.06, 0.2);
  b.add(new THREE.DodecahedronGeometry(0.1, 0), o.udder, 0, 0.7, -0.27, 0, 0, 0, 'solid', 1, 0.7, 1.15);
  for (const x of [-0.035, 0.035]) for (const z of [-0.31, -0.23]) b.cyl(0.01, 0.014, 0.06, 4, x, 0.62, z, o.udder);
  for (const x of [-0.19, 0.19]) for (const z of [0.42, -0.44]) rig(b, [1, (x < 0) === (z > 0) ? 0 : Math.PI, 0.86, z], () => {
    const fz = z > 0 ? 0.02 : -0.015;
    limb(b, [x, 0.86, z], [x, 0.42, z + fz], 0.085, 0.06, o.coat, 6);
    b.add(new THREE.DodecahedronGeometry(0.058, 0), o.coat, x, 0.41, z + fz);
    limb(b, [x, 0.41, z + fz], [x, 0.07, z], 0.052, 0.046, o.coat, 6);
    b.cyl(0.05, 0.056, 0.07, 6, x, 0.035, z + 0.005, o.hoof);
  });
  rig(b, [3, 1e-4, 1.24, 0], () => {                                                                           // tail (swishes)
    limb(b, [0, 1.24, -0.68], [0, 0.64, -0.75], 0.025, 0.02, o.coat, 4);
    b.add(new THREE.ConeGeometry(0.05, 0.17, 5), o.patch, 0, 0.58, -0.75, Math.PI, 0, 0);
  });
  rig(b, [2, 0, 1.1, 0.55], () => {                                                                            // neck and head (graze)
    limb(b, [0, 1.08, 0.52], [0, 1.2, 0.84], 0.17, 0.13, o.coat, 7);
    b.group(0, 1.17, 0.95, 0.55, 0, 0, () => {
      b.box(0.26, 0.24, 0.34, 0, 0, 0, o.coat);
      b.box(0.27, 0.12, 0.2, 0, 0.07, -0.02, o.patch);                                                         // a dark patch over the eyes
      b.box(0.25, 0.16, 0.14, 0, -0.05, 0.21, o.nose);                                                         // muzzle
      for (const x of [-0.06, 0.06]) b.box(0.03, 0.03, 0.01, x, -0.04, 0.285, 0x5a3a36);                       // nostrils
      for (const sx of [-1, 1]) {
        b.box(0.012, 0.035, 0.035, sx * 0.133, 0.05, 0.06, o.eye);
        b.box(0.14, 0.05, 0.08, sx * 0.19, 0.06, -0.08, o.ear, 'solid', 0, 0, sx * 0.25);
        limb(b, [sx * 0.09, 0.12, -0.1], [sx * 0.18, 0.22, -0.12], 0.025, 0.012, o.horn, 4);
      }
    });
  });
}
function geomOf(fn) { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; }
// a model whose parts can move (js/farm/animals.js): every vertex gets aRig = [kind, a, b, c]
//   kind 0 body · 1 leg (a: step phase, b/c: hip y/z) · 2 head and neck (b/c: neck base y/z) · 3 wing (a: shoulder x, b: shoulder y)
function rigOf(fn) {
  const b = new GeoBuilder(), add = b.add.bind(b);
  let cur = [0, 0, 0, 0];
  b.add = (...args) => {
    const g = add(...args), n = g.attributes.position.count, r = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) r.set(cur, i * 4);
    g.setAttribute('aRig', new THREE.BufferAttribute(r, 4));
    return g;
  };
  b.rig = (tag, f) => { const prev = cur; cur = tag; f(); cur = prev; };
  fn(b);
  return b.build().children[0].geometry;
}
const rig = (b, tag, f) => (b.rig ? b.rig(tag, f) : f());
const leg = (b, x, z, h, r, c) => b.cyl(r, r * 0.8, h, 5, x, h / 2, z, c);
// a chicken: body, neck, head, comb, wattles, beak, wings, tail, legs. Varieties change colours and shape.
function chicken(b, o) {
  const s = o.size || 1;
  b.group(0, 0, 0, 0, 0, 0, () => {
    b.add(new THREE.DodecahedronGeometry(0.17 * s, 0), o.body, 0, 0.3 * s, 0, 0, 0, 0, 'solid', 1, 0.92, 1.3);
    rig(b, [2, 0, 0.34 * s, 0.08 * s], () => {                                             // neck and head (bob, peck)
      b.add(new THREE.DodecahedronGeometry(0.1 * s, 0), o.neck || o.body, 0, 0.42 * s, 0.13 * s, 0, 0, 0, 'solid', 1, 1.3, 1);
      b.box(0.11 * s, 0.12 * s, 0.12 * s, 0, 0.52 * s, 0.17 * s, o.head || o.neck || o.body);
      b.box(0.03 * s, 0.08 * s, 0.11 * s, 0, 0.61 * s, 0.17 * s, o.comb);
      b.box(0.035 * s, 0.06 * s, 0.03 * s, 0, 0.45 * s, 0.22 * s, o.comb);
      b.box(0.05 * s, 0.035 * s, 0.07 * s, 0, 0.51 * s, 0.25 * s, o.beak);
      for (const x of [-0.034, 0.034]) b.box(0.02 * s, 0.02 * s, 0.02 * s, x * s, 0.54 * s, 0.215 * s, 0x111111);
    });
    for (const sx of [-1, 1]) rig(b, [3, sx * 0.09 * s, 0.37 * s, 0], () =>                // wings (flap when hopping)
      b.add(new THREE.DodecahedronGeometry(0.1 * s, 0), o.wing, sx * 0.13 * s, 0.31 * s, -0.02 * s, 0, 0, sx * 0.2, 'solid', 0.45, 0.85, 1.35));
    if (o.longTail) for (let k = 0; k < 4; k++) b.box(0.03 * s, 0.32 * s, 0.05 * s, (k - 1.5) * 0.03 * s, 0.46 * s, -0.24 * s - k * 0.012, k % 2 ? o.tail : o.tail2 || o.tail, 'solid', -0.7 + k * 0.12, 0, 0);
    else b.box(0.1 * s, 0.14 * s, 0.1 * s, 0, 0.38 * s, -0.22 * s, o.tail, 'solid', 0.55, 0, 0);
    for (const x of [-0.05, 0.05]) rig(b, [1, x < 0 ? 0 : Math.PI, 0.17 * s, 0], () => { leg(b, x * s, 0, 0.17 * s, 0.016 * s, o.legs); b.box(0.06 * s, 0.015 * s, 0.07 * s, x * s, 0.008, 0.02 * s, o.legs); });
  });
}
// a goat (Boer style): white faceted body, brown head and neck with a white blaze down the face, long droopy
// ears, horns curving back, amber eyes with a dark slit, a beard, jointed legs with dark hooves, an upturned
// tail and a small udder. Faces +z, feet at y = 0 (about 1 m to the horn tips).
const GOAT_COAT = { coat: 0xf2ede3, belly: 0xe2dbcd, shin: 0xe0d8ca, head: 0x8f4f2c, headD: 0x74401f, blaze: 0xf5f0e6, horn: 0x9a8a72, hornTip: 0x5e5246,
  hoof: 0x3a302a, nose: 0x4e3a34, eye: 0xd09a2a, ear: 0x8f4f2c, earIn: 0xe0a898, beard: 0xd8d0c2, udder: 0xe9b3aa };
const _ga = new THREE.Vector3(), _gb = new THREE.Vector3(), _gq = new THREE.Quaternion(), _ge = new THREE.Euler(), _gy = new THREE.Vector3(0, 1, 0);
// a tapered cylinder from point a to point c (radius r0 at a, r1 at c)
function limb(b, a, c, r0, r1, col, seg = 5) {
  _ga.set(...a); _gb.set(...c);
  const d = _gb.clone().sub(_ga), len = d.length();
  _ge.setFromQuaternion(_gq.setFromUnitVectors(_gy, d.normalize()));
  b.add(new THREE.CylinderGeometry(r1, r0, len, seg), col, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, _ge.x, _ge.y, _ge.z);
}
function goat(b, o) {
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  // body: chest and rump (faceted barrels), a lighter belly, the spine ridge
  b.add(ico(1), o.coat, 0, 0.665, 0.1, 0, 0, 0, 'solid', 0.19, 0.2, 0.26);
  b.add(ico(1), o.coat, 0, 0.675, -0.15, 0, 0, 0, 'solid', 0.18, 0.19, 0.25);
  b.add(ico(1, 0), o.belly, 0, 0.53, -0.02, 0, 0, 0, 'solid', 0.14, 0.09, 0.28);
  b.add(ico(1, 0), o.coat, 0, 0.8, -0.04, 0, 0, 0, 'solid', 0.1, 0.07, 0.3);
  // udder
  b.add(new THREE.DodecahedronGeometry(0.055, 0), o.udder, 0, 0.47, -0.17, 0, 0, 0, 'solid', 1, 0.75, 1);
  for (const x of [-0.022, 0.022]) b.cyl(0.008, 0.012, 0.04, 4, x, 0.43, -0.17, o.udder);
  // legs: upper leg, knee, shin, hoof (front legs a little forward)
  for (const x of [-0.1, 0.1]) for (const z of [0.23, -0.24]) rig(b, [1, (x < 0) === (z > 0) ? 0 : Math.PI, 0.58, z], () => {   // diagonal pairs step together
    const fz = z > 0 ? 0.015 : -0.01;
    limb(b, [x, 0.58, z], [x, 0.31, z + fz], 0.064, 0.042, o.coat, 6);
    b.add(new THREE.DodecahedronGeometry(0.042, 0), o.coat, x, 0.3, z + fz);
    limb(b, [x, 0.3, z + fz], [x, 0.05, z], 0.036, 0.031, o.shin, 6);
    b.cyl(0.034, 0.04, 0.055, 6, x, 0.027, z + 0.004, o.hoof);
  });
  // tail: a short tuft pointing up and back
  b.add(new THREE.ConeGeometry(0.03, 0.11, 5), o.coat, 0, 0.82, -0.4, -0.55, 0, 0);
  // neck (brown, like the head) and head: they turn down together from the neck base (eating, drinking, butting)
  rig(b, [2, 0, 0.74, 0.27], () => {
  limb(b, [0, 0.74, 0.27], [0, 0.95, 0.43], 0.1, 0.075, o.head, 6);
  b.add(ico(1, 0), o.head, 0, 0.78, 0.3, 0.5, 0, 0, 'solid', 0.11, 0.1, 0.1);
  // head, tipped nose-down
  b.group(0, 0.99, 0.46, 0.35, 0, 0, () => {
    b.add(new THREE.DodecahedronGeometry(0.1, 0), o.head, 0, 0.02, 0, 0, 0, 0, 'solid', 0.92, 0.95, 1.1);   // skull
    b.cyl(0.048, 0.072, 0.17, 6, 0, -0.035, 0.1, o.head, Math.PI / 2, 0, 0);                               // muzzle
    b.box(0.04, 0.016, 0.21, 0, 0.065, 0.075, o.blaze, 'solid', 0.4, 0, 0);                                 // white blaze
    b.box(0.07, 0.035, 0.03, 0, -0.03, 0.185, o.nose);                                                       // nose
    for (const x of [-0.016, 0.016]) b.box(0.012, 0.012, 0.01, x, -0.022, 0.2, 0x1e1614);                   // nostrils
    b.box(0.05, 0.008, 0.012, 0, -0.068, 0.175, o.headD);                                                    // mouth
    for (const sx of [-1, 1]) {
      b.add(ico(0.02, 0), o.eye, sx * 0.08, 0.045, 0.045);                                                   // amber eye
      b.box(0.006, 0.007, 0.026, sx * 0.098, 0.045, 0.045, 0x111111);                                        // goat's slit pupil
      // long droopy ear (brown, pink inside)
      b.group(sx * 0.09, 0.04, -0.03, 0, sx * 0.35, -sx * 0.8, () => {
        b.add(new THREE.OctahedronGeometry(1, 0), o.ear, sx * 0.11, 0, 0, 0, 0, 0, 'solid', 0.12, 0.018, 0.048);
        b.add(new THREE.OctahedronGeometry(1, 0), o.earIn, sx * 0.1, -0.008, 0, 0, 0, 0, 'solid', 0.085, 0.009, 0.03);
      });
      // horn curving up and back (thick at the base, darker at the tip)
      const H = [[sx * 0.04, 0.09, -0.005], [sx * 0.05, 0.15, -0.045], [sx * 0.06, 0.18, -0.11], [sx * 0.068, 0.17, -0.175], [sx * 0.075, 0.13, -0.215]];
      for (let i = 0; i < H.length - 1; i++) limb(b, H[i], H[i + 1], 0.024 - i * 0.005, 0.019 - i * 0.005, i < 2 ? o.horn : o.hornTip);
    }
    b.add(new THREE.ConeGeometry(0.026, 0.1, 5), o.beard, 0, -0.12, 0.11, Math.PI + 0.25, 0, 0);            // beard
  });
  });
}
export const ANIMAL_GEO = {
  chicken: () => rigOf(b => chicken(b, { body: 0xf3efe6, wing: 0xe8e2d4, tail: 0xe0d8c6, comb: 0xd8342a, beak: 0xf0b030, legs: 0xf0b030 })),
  chicken_brown: () => rigOf(b => chicken(b, { body: 0x9a5a2a, neck: 0xc8822e, head: 0xb06a28, wing: 0x6e3c1c, tail: 0x1e2a22, tail2: 0x2e4a34, longTail: true, comb: 0xd8342a, beak: 0xd8a040, legs: 0xc89a40, size: 1.05 })),
  chicken_dark: () => rigOf(b => chicken(b, { body: 0x2a2a2e, neck: 0x34343a, head: 0x2e2e32, wing: 0x1c1d24, tail: 0x15161c, tail2: 0x22304a, longTail: true, comb: 0x5a1a2a, beak: 0x3a3a3a, legs: 0x2a2a2a, size: 1.0 })),
  goat: () => rigOf(b => goat(b, GOAT_COAT)),
  cow: () => rigOf(b => cow(b, COW)),
  // horses in six colours (catalog horse_*); 'horse' is the bay one (worlds from before the colours)
  horse: () => rigOf(b => horse(b, HORSE_COATS.horse_bay)),
  ...Object.fromEntries(Object.keys(HORSE_COATS).map(k => [k, () => rigOf(b => horse(b, HORSE_COATS[k]))])),
};
