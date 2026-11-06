// Models of the industrial machines and their sites (low-poly, vertex-coloured; moving parts are separate objects).
//   The gold mine: a rocky outcrop with a timber-framed tunnel and a GOLD MINE sign, rails with a mine cart, an ore
//   conveyor up to the machine, crates, barrels, gems, a pickaxe, a dynamite plunger, a lantern; the blue mining machine
//   on a steel platform (four levels, each bigger and busier) and the wooden coin box in front of it.
//   The flour mill ("Aata Chakki"): a plank platform under a tin lean-to roof, wheat sheaves and sacks of wheat on one
//   side, flour sacks on the other; the machine in five levels — a stone hand mill on a wooden table, then electric
//   (motor, belt, hopper, chute), industrial, advanced (a little silo, two chutes) and a twin-chamber plant.
// Local frames: the machine's middle on the ground at (0, 0, 0), its front toward +z.
import * as THREE from 'three';
import { GeoBuilder, MAT } from '../../utils.js';
import { limb, lumpGeo } from '../../flora.js';

const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const C = {
  blue: 0x2f6fd8, blueD: 0x2458b0, blueL: 0x4a86ea, steel: 0xb8bec6, steelD: 0x8a9098, stone: 0x8c8a86, stoneD: 0x6e6c68, yellow: 0xf2b630,
  gold: 0xf2c14e, goldD: 0xc9962a, wood: 0x8a5a33, woodL: 0xa8743f, woodD: 0x6e4626, rock: 0xb07a52, rockL: 0xc4906a, rockD: 0x8f5f3e, rockG: 0x9a958e,
  rail: 0x5a5a60, tie: 0x7a5232, dark: 0x1c1610, red: 0xc23a2a, green: 0x4f8a3c, greenD: 0x3e7030, cream: 0xefe6d0, tin: 0x8a98a6, tinD: 0x6e7a88,
  jute: 0xcdb27a, juteD: 0xb39660, flour: 0xf4f0e6, wheat: 0xe2bc5e, wheatD: 0xc9a24c, rope: 0xc8b28a,
};
// a sign board's picture: carved letters on dark wood (or painted on a plank)
export function signTexture(lines, { w = 512, h = 160, bg = '#4a2e1a', fg = '#f2d27a', font = 'Georgia, serif' } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const y = 12 + i * h / 6; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 5, w * 0.7, y - 5, w, y + 2); g.stroke(); }
  g.strokeStyle = 'rgba(255,230,170,.45)'; g.lineWidth = 5; g.strokeRect(9, 9, w - 18, h - 18);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowOffsetY = 3; g.shadowBlur = 3;
  lines.forEach(([text, size], i) => { g.font = `800 ${size}px ${font}`; g.fillText(text, w / 2, h * (lines.length === 1 ? 0.5 : 0.36 + i * 0.36)); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const plane = (tex, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }));
const built = (fn, mats) => { const b = new GeoBuilder(); fn(b); const g = b.build({ ...MAT, ...(mats || {}) }); return g; };
// a bolt head (on the steelwork)
const bolt = (b, x, y, z, ry = 0) => b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 6), C.steel, x, y, z, Math.PI / 2, ry, 0);
function barrel(b, x, z, col, s = 1) {
  b.cyl(0.3 * s, 0.3 * s, 0.85 * s, 10, x, 0.43 * s, z, col);
  for (const y of [0.15, 0.43, 0.71]) b.cyl(0.31 * s, 0.31 * s, 0.04 * s, 10, x, y * s, z, shade(col, 0.7));
  b.cyl(0.26 * s, 0.26 * s, 0.02, 10, x, 0.86 * s, z, shade(col, 0.85));
}
function crate(b, x, y, z, s = 0.7, ry = 0, col = C.woodL) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.box(s, s, s, 0, s / 2, 0, col);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.07, s + 0.01, 0.07, sx * (s / 2 - 0.02), s / 2, sz * (s / 2 - 0.02), shade(col, 0.75));
    for (const sz of [-1, 1]) limb(b, [-s / 2 + 0.05, 0.06, sz * (s / 2 + 0.005)], [s / 2 - 0.05, s - 0.06, sz * (s / 2 + 0.005)], 0.025, 0.025, shade(col, 0.75), 4);
  });
}
function sack(b, x, y, z, col, s = 1, ry = 0, top = null) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.add(lumpGeo(1, 0.08, Math.round(x * 31 + z * 17 + 40)), col, 0, 0.28 * s, 0, 0, 0, 0, 'solid', 0.26 * s, 0.3 * s, 0.22 * s);
    b.cyl(0.1 * s, 0.14 * s, 0.12 * s, 6, 0, 0.6 * s, 0, shade(col, 0.9));
    b.cyl(0.11 * s, 0.11 * s, 0.03, 6, 0, 0.56 * s, 0, C.rope);
    if (top) b.add(new THREE.CircleGeometry(0.1 * s, 6), top, 0, 0.665 * s, 0, -Math.PI / 2, 0, 0);
  });
}

/* ================= the gold mine ================= */
// where things are on the site (local)
export const MINE_SITE = {
  tunnel: { x: -2.9, z: -4.6 },                      // the tunnel mouth (rails run out of it toward +z)
  railEnd: 0.9,                                      // the rails end here (z), beside the conveyor's foot
  railX: -2.9, conveyorFoot: [-2.9, 0.55, 0.6], hopper: [0, 2.9, 0],
  chest: [1.25, 0, 2.05], radius: 7.5,
};
export function mineSiteModel() {
  const S = MINE_SITE, g = new THREE.Group();
  g.add(built(b => {
    // the rocky outcrop behind (big faceted rocks, warm brown and a little grey), grass on top
    const rocks = [[-4.6, 1.6, -7.4, 2.8, 2.3, 2.4, 0], [-1.2, 2.2, -7.9, 2.6, 2.8, 2.5, 1], [2.4, 1.7, -7.6, 2.7, 2.2, 2.3, 2], [5, 1.1, -6.8, 1.9, 1.6, 1.8, 3], [-6.6, 0.9, -5.8, 1.5, 1.4, 1.6, 4],
      [0.6, 3.9, -8.6, 2.2, 1.8, 2.0, 5], [-3.2, 3.6, -8.4, 2.0, 1.7, 1.9, 6], [3.6, 3.2, -8.3, 1.7, 1.4, 1.6, 7], [-0.6, 0.9, -6.2, 1.6, 1.1, 1.3, 8], [1.3, 1.0, -5.9, 1.3, 1.0, 1.2, 9], [-5.2, 2.4, -6.6, 1.2, 1.0, 1.2, 10]];
    for (const [x, y, z, sx, sy, sz, i] of rocks) b.add(lumpGeo(0, 0.18, 610 + i), [C.rock, C.rockL, C.rockD, C.rock, C.rockG][i % 5], x, y, z, 0, i * 0.7, 0, 'solid', sx, sy, sz);
    for (let i = 0; i < 9; i++) { const a = i * 2.1; b.add(new THREE.ConeGeometry(0.05, 0.4, 3), i % 2 ? 0x5fae3a : 0x74c046, -3.5 + i * 0.85, 4.3 + Math.sin(a) * 0.5, -8.4 + Math.cos(a) * 0.4, Math.sin(a) * 0.3, a, 0); }
    // the tunnel: a dark hole in the rock, the timber frame round it, a GOLD MINE board (its letters are a separate plane)
    const T = S.tunnel;
    b.box(2.0, 2.5, 2.2, T.x, 1.25, T.z - 0.9, C.dark);
    b.add(lumpGeo(0, 0.15, 640), C.rockD, T.x - 1.7, 1.4, T.z - 0.6, 0, 0, 0, 'solid', 0.9, 1.6, 1.0);
    b.add(lumpGeo(0, 0.15, 641), C.rock, T.x + 1.7, 1.3, T.z - 0.6, 0, 0, 0, 'solid', 0.9, 1.5, 1.0);
    b.add(lumpGeo(0, 0.15, 642), C.rockL, T.x, 3.2, T.z - 0.7, 0, 0, 0, 'solid', 1.8, 0.9, 1.0);
    for (const sx of [-1, 1]) { b.box(0.26, 2.7, 0.26, T.x + sx * 1.08, 1.35, T.z, C.wood); b.box(0.32, 0.12, 0.32, T.x + sx * 1.08, 0.06, T.z, C.woodD); }
    b.box(2.7, 0.3, 0.34, T.x, 2.75, T.z, C.woodL);
    for (const sx of [-1, 1]) limb(b, [T.x + sx * 1.08, 2.0, T.z + 0.05], [T.x + sx * 0.55, 2.62, T.z + 0.05], 0.06, 0.06, C.wood, 4);
    b.box(2.4, 0.62, 0.08, T.x, 3.3, T.z + 0.1, C.woodD);                                    // (the sign board)
    for (const sx of [-1, 1]) b.box(0.08, 0.5, 0.08, T.x + sx * 0.9, 3.05, T.z + 0.08, C.woodD);
    // the rails: out of the tunnel to the conveyor, ties under them
    for (let z = T.z - 1.5; z <= S.railEnd + 0.01; z += 0.45) b.box(1.15, 0.08, 0.2, S.railX, 0.04, z, C.tie);
    for (const sx of [-1, 1]) b.box(0.07, 0.09, S.railEnd - T.z + 1.6, S.railX + sx * 0.42, 0.12, (S.railEnd + T.z - 1.5) / 2, C.rail);
    b.box(1.0, 0.35, 0.2, S.railX, 0.25, S.railEnd + 0.25, C.woodD);                             // the buffer at the end
    // the steel platform the machine stands on, a ramp to it
    b.box(4.4, 0.16, 3.6, 0, 0.08, 0, 0x6e747c);
    for (let x = -2; x <= 2.01; x += 0.5) b.box(0.03, 0.01, 3.5, x, 0.165, 0, 0x5a6068);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.22, 0.04, 0.22, sx * 2.05, 0.18, sz * 1.65, C.yellow);
    b.box(1.6, 0.06, 1.0, 0.9, 0.06, 2.3, 0x7a8088, 'solid', 0.12, 0, 0);
    // props: crates, barrels, gems, a pickaxe, the dynamite plunger, rocks, a lantern post (lit at night)
    crate(b, 3.2, 0, -1.6, 0.75, 0.3); crate(b, 3.25, 0.75, -1.55, 0.6, 0.8, C.woodXL || 0xc08a52); crate(b, 4.1, 0, -0.9, 0.6, -0.4);
    barrel(b, 3.4, 1.1, 0x5a6470); barrel(b, 4.05, 1.5, C.red, 0.95); barrel(b, 3.75, 2.2, 0x5a6470, 0.9);
    for (const [x, z, col, s] of [[-1.3, -3.6, 0xe0443a, 0.11], [-1.05, -3.45, 0x3fbf5a, 0.09], [-1.2, -3.25, 0x4a7ae0, 0.1], [-0.9, -3.7, 0xe0443a, 0.08], [-1.45, -3.35, 0xf2c14e, 0.09]])
      b.add(new THREE.OctahedronGeometry(s, 0), col, x, s * 0.8, z, 0, x * 3, 0.3);
    limb(b, [-1.9, 0.02, -2.6], [-1.55, 0.95, -2.95], 0.03, 0.03, C.woodL, 4);                // pickaxe
    b.add(new THREE.BoxGeometry(0.6, 0.06, 0.07), C.steelD, -1.55, 0.97, -2.95, 0, 0.7, 0.25);
    b.group(-4.6, 0, -2.4, 0, 0.5, 0, () => { b.box(0.42, 0.32, 0.32, 0, 0.16, 0, C.red); b.box(0.04, 0.42, 0.04, 0, 0.5, 0, C.steelD); b.box(0.36, 0.05, 0.05, 0, 0.72, 0, C.woodD);
      limb(b, [0.2, 0.1, 0.1], [0.9, 0.02, 0.6], 0.012, 0.012, 0x2a2a2a, 3); });
    for (const [x, z, s] of [[-5.4, 0.6, 0.45], [5.2, -2.8, 0.55], [-4.4, 1.8, 0.3], [2.6, -3.6, 0.35]]) b.add(lumpGeo(0, 0.2, 660 + Math.round(x)), C.rockG, x, s * 0.5, z, 0, x, 0, 'solid', s, s * 0.7, s);
    const L = [S.tunnel.x + 1.55, S.tunnel.z + 0.4];
    b.box(0.1, 2.3, 0.1, L[0], 1.15, L[1], C.woodD); b.box(0.5, 0.06, 0.06, L[0] - 0.2, 2.25, L[1], C.woodD);
    b.box(0.02, 0.18, 0.02, L[0] - 0.4, 2.13, L[1], 0x2a2a2a); b.cyl(0.1, 0.12, 0.05, 8, L[0] - 0.4, 1.98, L[1], 0x3a3a3e);
    b.cyl(0.08, 0.08, 0.2, 8, L[0] - 0.4, 1.85, L[1], 0xffd88a, 0, 0, 0, 'lampGlass'); b.light(L[0] - 0.4, 1.85, L[1], 'lantern');
    // the ore conveyor: from the end of the rails up to the hopper (its belt bits move: machines.js)
    const [fx, fy, fz] = S.conveyorFoot, top = [-0.75, 2.95, 0];
    for (const sz of [-1, 1]) limb(b, [fx, fy, fz + sz * 0.3], [top[0], top[1], top[2] + sz * 0.3], 0.05, 0.05, C.steelD, 4);
    limb(b, [fx, fy - 0.05, fz], top.map((v, i) => v - (i === 1 ? 0.05 : 0)), 0.22, 0.22, 0x2a2a2e, 4);
    for (const t of [0.15, 0.5, 0.85]) { const x = fx + (top[0] - fx) * t, y = fy + (top[1] - fy) * t, z = fz + (top[2] - fz) * t; b.box(0.08, y, 0.08, x, y / 2, z + 0.3, C.steelD); b.box(0.08, y, 0.08, x, y / 2, z - 0.3, C.steelD); }
    // the coin box: an open wooden chest with iron bands
    const [cx, , cz] = S.chest;
    b.group(cx, 0.16, cz, 0, -0.15, 0, () => {
      b.box(0.9, 0.5, 0.6, 0, 0.25, 0, C.woodL); b.box(0.82, 0.04, 0.52, 0, 0.42, 0, C.woodD);
      for (const x of [-0.3, 0.3]) b.box(0.06, 0.52, 0.62, x, 0.26, 0, 0x3a3a3e);
      b.group(0, 0.5, -0.3, -1.9, 0, 0, () => { b.box(0.9, 0.08, 0.6, 0, 0, 0.3, C.wood); for (const x of [-0.3, 0.3]) b.box(0.06, 0.09, 0.62, x, 0, 0.3, 0x3a3a3e); });
    });
  }, { lampGlass: MAT.lampGlass }));
  // the GOLD MINE board
  const sign = plane(signTexture([['GOLD MINE', 92]], { w: 512, h: 128 }), 2.3, 0.56);
  sign.position.set(S.tunnel.x, 3.3, S.tunnel.z + 0.145); g.add(sign);
  return g;
}
// the mine cart (rides the rails: machines.js moves it), full of ore
export function mineCartModel() {
  return built(b => {
    b.add(new THREE.CylinderGeometry(0.62, 0.48, 0.55, 4, 1, false, Math.PI / 4), 0x4a4a52, 0, 0.62, 0, 0, 0, 0, 'solid', 1.0, 1, 1.35);
    b.add(new THREE.CylinderGeometry(0.64, 0.64, 0.06, 4, 1, false, Math.PI / 4), 0x3a3a40, 0, 0.9, 0, 0, 0, 0, 'solid', 1.0, 1, 1.35);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { b.cyl(0.14, 0.14, 0.08, 8, sx * 0.44, 0.17, sz * 0.36, 0x2a2a2e, 0, 0, Math.PI / 2); b.cyl(0.05, 0.05, 0.1, 6, sx * 0.44, 0.17, sz * 0.36, C.steel, 0, 0, Math.PI / 2); }
    for (let i = 0; i < 9; i++) b.add(new THREE.DodecahedronGeometry(0.13 + (i % 3) * 0.03, 0), [C.gold, C.goldD, 0xe8b23a][i % 3], ((i % 3) - 1) * 0.22, 0.95 + (i % 2) * 0.06, (Math.floor(i / 3) - 1) * 0.28);
  });
}

// the blue mining machine at level 1–4. Returns { group, spin: [{ o, axis, speed }], beacon (material), sparksAt, smokeAt, beltPath }
export function mineMachineModel(level) {
  const g = new THREE.Group(), spin = [], lv = level, big = [1, 1.3, 1.5, 1.75][lv - 1];
  const beacon = new THREE.MeshLambertMaterial({ color: 0xffa020, emissive: 0xff7a00, emissiveIntensity: 0 });
  const screen = new THREE.MeshBasicMaterial({ color: 0x1a3a1a });
  const deck = 1.05, ringR = lv >= 4 ? 0.85 : 0.65;
  g.add(built(b => {
    const W = 2.3 * (lv >= 4 ? 1.15 : 1), D = 1.6;
    // the frame: legs on silver feet, cross beams, a deck plate
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.box(0.16, deck, 0.16, sx * W / 2, 0.16 + deck / 2, sz * D / 2, C.blue);
      b.box(0.26, 0.1, 0.26, sx * W / 2, 0.21, sz * D / 2, C.steel);
      bolt(b, sx * W / 2, 0.16 + deck - 0.15, sz * (D / 2 + 0.085));
    }
    for (const sz of [-1, 1]) { b.box(W, 0.12, 0.12, 0, 0.55, sz * D / 2, C.blueD); b.box(W + 0.1, 0.14, 0.14, 0, 0.16 + deck, sz * D / 2, C.blue); }
    for (const sx of [-1, 1]) { b.box(0.12, 0.12, D, sx * W / 2, 0.55, 0, C.blueD); b.box(0.14, 0.14, D + 0.1, sx * W / 2, 0.16 + deck, 0, C.blue); }
    b.box(W - 0.1, 0.06, D - 0.1, 0, 0.16 + deck + 0.06, 0, C.blueL);
    // the grinding chamber: a steel ring round the stone, a tray under the outlet
    b.cyl(ringR + 0.05, ringR + 0.1, 0.32, 16, 0, deck + 0.38, 0, C.steel);
    b.cyl(ringR - 0.04, ringR - 0.04, 0.02, 16, 0, deck + 0.55, 0, C.steelD);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; bolt(b, Math.sin(a) * (ringR + 0.1), deck + 0.38, Math.cos(a) * (ringR + 0.1), a); }
    // the hopper on four posts, a feed tube down to the stone
    const hs = big, hy = deck + 1.55 * hs + 0.2;
    b.add(new THREE.CylinderGeometry(0.72 * hs, 0.2, 0.85 * hs, 4, 1, false, Math.PI / 4), C.blue, 0, hy, 0);
    b.add(new THREE.CylinderGeometry(0.76 * hs, 0.76 * hs, 0.08, 4, 1, false, Math.PI / 4), C.blueD, 0, hy + 0.44 * hs, 0);
    for (let i = 0; i < 10; i++) b.add(new THREE.DodecahedronGeometry(0.1, 0), [C.gold, C.goldD, 0xe8b23a][i % 3], ((i % 4) - 1.5) * 0.24 * hs, hy + 0.47 * hs, (Math.floor(i / 4) - 1) * 0.26 * hs);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.08, hy - deck - 0.3, 0.08, sx * 0.5, (deck + 0.55 + hy - 0.25) / 2, sz * 0.5, C.blueD);
    b.cyl(0.12, 0.14, hy - deck - 0.9, 8, 0, (deck + 0.95 + hy - 0.4) / 2, 0, C.steelD);
    // the motor beside it and its pulley; a belt to the stone's shaft
    const mx = W / 2 + 0.05, ms = lv >= 2 ? 1.25 : 1;
    b.box(0.55 * ms, 0.5 * ms, 0.6 * ms, mx, deck + 0.45, -0.25, C.blueD);
    for (let i = 0; i < 5; i++) b.box(0.57 * ms, 0.03, 0.62 * ms, mx, deck + 0.28 + i * 0.08 * ms, -0.25, C.blue);
    b.box(0.2, 0.2, 0.2, mx + 0.32 * ms, deck + 0.45, -0.25, C.steelD);
    limb(b, [mx + 0.05, deck + 0.85, 0.25], [0.15, deck + 0.75, 0.15], 0.02, 0.02, 0x222226, 4);
    limb(b, [mx + 0.05, deck + 0.62, 0.25], [0.15, deck + 0.68, 0.15], 0.02, 0.02, 0x222226, 4);
    // the control box: a screen with a gear, green and red buttons (the beacon on top is its own material)
    const kx = -W / 2 - 0.2;
    b.box(0.08, 1.2, 0.08, kx, 0.76, 0.45, C.steelD);
    b.box(0.5, 0.62, 0.26, kx, 1.4, 0.45, 0x9aa1a8);
    b.box(0.32, 0.22, 0.02, kx, 1.5, 0.585, 0x111111);
    b.add(new THREE.PlaneGeometry(0.28, 0.18), 0xffffff, kx, 1.5, 0.597, 0, 0, 0, 'screen');
    b.cyl(0.045, 0.045, 0.04, 8, kx - 0.11, 1.24, 0.585, 0x3fbf3a, Math.PI / 2, 0, 0); b.cyl(0.045, 0.045, 0.04, 8, kx + 0.11, 1.24, 0.585, 0xd8342a, Math.PI / 2, 0, 0);
    b.cyl(0.07, 0.08, 0.06, 8, kx, 1.74, 0.45, 0x2a2a2e);
    b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8), 0xffffff, kx, 1.85, 0.45, 0, 0, 0, 'beacon');
    // the outlet chute down to the coin box, yellow safety rails
    limb(b, [0.5, deck + 0.3, ringR - 0.1], [1.15, 0.85, 1.75], 0.14, 0.12, C.blueD, 4);
    for (const sz of [-1, 1]) { b.box(0.05, 0.6, 0.05, -W / 2 + 0.15, deck + 0.5, sz * (D / 2 - 0.05), C.yellow); b.box(0.05, 0.6, 0.05, -0.35, deck + 0.5, sz * (D / 2 - 0.05), C.yellow);
      b.box(W / 2 - 0.45, 0.05, 0.05, (-W / 2 - 0.2) / 2, deck + 0.8, sz * (D / 2 - 0.05), C.yellow); }
    // level 2: a hydraulic ram and a second pulley; level 3: a second grinding stage and the cyclone separator with its
    // pipes; level 4: a bigger chamber with gold bands, an exhaust stack, more pipes, a second beacon
    if (lv >= 2) { b.cyl(0.07, 0.07, 0.8, 8, -0.9, deck + 0.9, -0.6, C.steel, 0.4, 0, 0); b.cyl(0.1, 0.1, 0.35, 8, -0.9, deck + 0.55, -0.75, C.blueD, 0.4, 0, 0); }
    if (lv >= 3) {
      b.cyl(0.42, 0.46, 0.3, 14, 0.15, deck + 0.38 + 0.0, -1.3, C.steel);
      b.box(0.9, deck, 0.9, 0.15, 0.16 + deck / 2, -1.3, C.blueD);
      limb(b, [0.15, deck + 0.6, -0.95], [0.1, deck + 0.7, -0.55], 0.09, 0.09, C.steel, 6);
      const cx = W / 2 + 0.95, cz = -0.95;                                   // (beside the motor, where you see it)
      b.cyl(0.36, 0.36, 1.1, 12, cx, deck + 0.9, cz, C.steel); b.add(new THREE.ConeGeometry(0.36, 0.7, 12), C.steel, cx, deck - 0.0, cz, Math.PI, 0, 0);
      b.cyl(0.38, 0.38, 0.14, 12, cx, deck + 1.1, cz, C.yellow);
      limb(b, [cx, deck + 1.45, cz], [cx, deck + 2.2, cz], 0.12, 0.12, C.steelD, 8);
      limb(b, [cx, deck + 2.2, cz], [0.35, deck + 2.25, -0.35], 0.12, 0.12, C.steelD, 8);
      for (const [x, z] of [[cx - 0.3, cz - 0.3], [cx + 0.3, cz - 0.3], [cx - 0.3, cz + 0.3], [cx + 0.3, cz + 0.3]]) b.box(0.06, deck - 0.2, 0.06, x, deck / 2 + 0.06, z, C.blueD);
    }
    if (lv >= 4) {
      for (const y of [deck + 0.26, deck + 0.5]) b.cyl(ringR + 0.12, ringR + 0.12, 0.05, 16, 0, y, 0, C.gold);
      b.cyl(0.14, 0.16, 2.0, 8, W / 2 - 0.2, deck + 1.6, -0.75, 0x5a5a60); b.cyl(0.18, 0.18, 0.12, 8, W / 2 - 0.2, deck + 2.62, -0.75, 0x3a3a40);
      b.add(new THREE.CylinderGeometry(0.34, 0.12, 0.4, 8), C.gold, 1.2, 1.05, 1.95); b.cyl(0.36, 0.36, 0.05, 8, 1.2, 1.26, 1.95, C.goldD);   // a gold funnel into the coin box
      b.cyl(0.07, 0.08, 0.06, 8, -kx * 0 + W / 2, deck + 0.95, 0.65, 0x2a2a2e);
      b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8), 0xffffff, W / 2, deck + 1.06, 0.65, 0, 0, 0, 'beacon');
    }
  }, { beacon, screen }));
  // the turning parts: the millstone(s), the motor pulley(s)
  const stone = built(b => { b.cyl(ringR - 0.08, ringR - 0.06, 0.42, 14, 0, 0, 0, C.stone); for (let i = 0; i < 6; i++) b.box(0.05, 0.43, 0.08, Math.sin(i) * (ringR - 0.07), 0, Math.cos(i) * (ringR - 0.07), C.stoneD, 'solid', 0, i, 0); b.cyl(0.13, 0.13, 0.12, 8, 0, 0.26, 0, C.steel); });
  stone.position.set(0, deck + 0.52, 0); g.add(stone); spin.push({ o: stone, axis: 'y', speed: 1.2 });
  const mx = 2.3 * (lv >= 4 ? 1.15 : 1) / 2 + 0.05;
  const pulley = built(b => { b.cyl(0.3, 0.3, 0.07, 14, 0, 0, 0, 0x2a2a2e, Math.PI / 2, 0, 0); for (let i = 0; i < 4; i++) b.box(0.05, 0.5, 0.04, 0, 0, 0.0, C.steel, 'solid', 0, 0, i * Math.PI / 4); b.cyl(0.07, 0.07, 0.1, 8, 0, 0, 0, C.steel, Math.PI / 2, 0, 0); });
  pulley.position.set(mx + 0.05, deck + 0.74, 0.27); g.add(pulley); spin.push({ o: pulley, axis: 'z', speed: 6 });
  if (lv >= 2) { const p2 = pulley.clone(); p2.scale.setScalar(0.7); p2.position.set(mx + 0.05, deck + 0.74, -0.78); g.add(p2); spin.push({ o: p2, axis: 'z', speed: -8 }); }
  if (lv >= 3) { const s2 = stone.clone(); s2.scale.set(0.6, 0.8, 0.6); s2.position.set(0.15, deck + 0.5, -1.3); g.add(s2); spin.push({ o: s2, axis: 'y', speed: -1.8 }); }
  return { group: g, spin, beacon, screen, deck, sparksAt: [0, deck + 0.6, 0], ringR, smokeAt: lv >= 4 ? [2.3 * 1.15 / 2 - 0.2, deck + 2.7, -0.75] : lv >= 3 ? [2.3 / 2 + 0.95, deck + 2.3, -0.95] : [mx + 0.32, deck + 0.6, -0.25], speed: [1, 1.4, 2, 3][lv - 1] };
}

/* ================= the flour mill ================= */
export const FLOUR_SITE = { handle: [0.0, 0, 1.25], sacks: [2.15, 0.17, 0.4], wheat: [-2.3, 0.17, 0.2] };
// the platform, the lean-to roof, wheat on one side, the flour pallet on the other, the AATA CHAKKI board
export function flourSiteModel() {
  const g = new THREE.Group();
  g.add(built(b => {
    // plank platform with a step
    for (let i = 0; i < 9; i++) b.box(6.2, 0.15, 0.48, 0, 0.075, -2.0 + i * 0.5, [C.woodL, C.wood, 0xb07e48][i % 3]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.18, 0.4, 0.18, sx * 3.0, 0, sz * 2.1, C.woodD);
    b.box(1.6, 0.08, 0.5, 0, 0.05, 2.45, C.woodD);
    // the lean-to: four posts, a back wall of planks, a tin roof sloping back
    for (const [x, z, h] of [[-2.9, 1.9, 3.5], [2.9, 1.9, 3.5], [-2.9, -2.0, 3.0], [2.9, -2.0, 3.0]]) b.box(0.16, h, 0.16, x, h / 2 + 0.15, z, C.woodD);
    for (let i = 0; i < 8; i++) b.box(6.0, 0.38, 0.06, 0, 0.4 + i * 0.37, -2.05, [C.wood, C.woodL][i % 2]);
    const pitch = Math.atan2(0.55, 4.3);
    b.group(0, 3.38, 0, pitch, 0, 0, () => { b.box(6.6, 0.06, 4.7, 0, 0, 0, C.tin); for (let x = -3.2; x <= 3.21; x += 0.4) b.box(0.05, 0.05, 4.72, x, 0.05, 0, C.tinD); });
    for (const z of [1.9, -2.0]) b.box(6.1, 0.14, 0.14, 0, z > 0 ? 3.64 : 3.14, z, C.woodD);
    // wheat: sheaves standing together, a heap, two sacks of wheat
    const [wx, wy, wz] = FLOUR_SITE.wheat;
    for (let i = 0; i < 5; i++) {
      const x = wx - 0.35 + (i % 3) * 0.35, z = wz - 0.9 + Math.floor(i / 3) * 0.4;
      b.cyl(0.13, 0.17, 0.85, 7, x, wy + 0.43, z, i % 2 ? C.wheat : C.wheatD); b.cyl(0.18, 0.18, 0.05, 7, x, wy + 0.5, z, C.rope);
      for (let k = 0; k < 6; k++) b.add(new THREE.ConeGeometry(0.04, 0.22, 3), C.wheat, x + Math.sin(k) * 0.1, wy + 0.95, z + Math.cos(k) * 0.1, Math.sin(k) * 0.4, k, 0);
    }
    b.add(lumpGeo(1, 0.12, 677), C.wheat, wx, wy + 0.2, wz + 0.5, 0, 0, 0, 'solid', 0.6, 0.3, 0.5);
    sack(b, wx + 0.55, wy, wz + 1.0, C.jute, 1, 0.3, C.wheat); sack(b, wx - 0.1, wy, wz + 1.15, C.juteD, 0.95, -0.4, C.wheat);
    // the flour corner: a pallet (the sacks on it come and go: machines.js), a weighing scale
    const [px, py, pz] = FLOUR_SITE.sacks;
    for (let i = 0; i < 4; i++) b.box(1.2, 0.05, 0.22, px, py + 0.12, pz - 0.36 + i * 0.24, C.woodL);
    for (const z of [-0.4, 0, 0.4]) b.box(1.2, 0.1, 0.1, px, py + 0.05, pz + z, C.woodD);
    b.group(px - 0.2, py, pz + 1.15, 0, 0.3, 0, () => { b.box(0.5, 0.08, 0.4, 0, 0.04, 0, 0x3a3a3e); b.box(0.06, 0.7, 0.06, 0, 0.4, -0.15, 0x3a3a3e); b.cyl(0.14, 0.14, 0.04, 12, 0, 0.78, -0.15, 0xe8e2d6, Math.PI / 2, 0, 0);
      b.box(0.4, 0.02, 0.34, 0, 0.1, 0.02, C.steel); });
    // a lamp under the roof (lit at night)
    b.box(0.03, 0.5, 0.03, 0, 3.05, 1.3, 0x2a2a2a); b.cyl(0.18, 0.06, 0.12, 8, 0, 2.78, 1.3, 0x3a5a3a); b.add(new THREE.SphereGeometry(0.07, 6, 4), 0xffe2a0, 0, 2.7, 1.3, 0, 0, 0, 'lampGlass');
    b.light(0, 2.65, 1.3, 'lamp');
  }, { lampGlass: MAT.lampGlass }));
  const sign = plane(signTexture([['AATA CHAKKI', 72], ['Flour Mill', 44]], { w: 512, h: 180, bg: '#7a2a1a', fg: '#ffe6a8' }), 2.4, 0.84);
  sign.position.set(0, 4.02, 1.97); g.add(sign);
  const back = built(b => b.box(2.55, 0.95, 0.08, 0, 0, 0, C.woodD)); back.position.set(0, 4.02, 1.92); g.add(back);
  return g;
}
// a sack of flour (on the pallet)
export const flourSackGeometry = () => { const b = new GeoBuilder(); sack(b, 0, 0, 0, 0xf4f0e6, 0.8, 0, 0xffffff); return b.build().children[0].geometry; };

// the flour machine at level 1–5. Returns { group, spin: [{ o, axis, speed }], stone, chuteAt, crank (level 1: the handle's
// pivot height and radius), hopperTop }
export function flourMachineModel(level) {
  const g = new THREE.Group(), spin = [], lv = level;
  const paint = lv >= 5 ? 0xb8452e : 0x4f8a3c, paintD = lv >= 5 ? 0x8e3020 : 0x3e7030, trim = lv >= 5 ? C.cream : C.steel;
  const tableH = lv >= 3 ? 0.95 : 0.85, stoneR = 0.38;
  let chuteAt = [0.62, 0.62, 0.35], hopperTop = null;
  g.add(built(b => {
    if (lv <= 2) {
      // the wooden table (legs, rails, top frame) and the lower millstone in its basin with a pouring spout
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.12, tableH, 0.12, sx * 0.48, 0.15 + tableH / 2, sz * 0.48, C.wood);
      for (const s of [-1, 1]) { b.box(1.08, 0.08, 0.1, 0, 0.45, s * 0.48, C.woodD); b.box(0.1, 0.08, 1.08, s * 0.48, 0.45, 0, C.woodD); b.box(1.12, 0.1, 0.12, 0, 0.15 + tableH, s * 0.5, C.woodL); b.box(0.12, 0.1, 1.12, s * 0.5, 0.15 + tableH, 0, C.woodL); }
      b.cyl(0.6, 0.55, 0.18, 14, 0, 0.15 + tableH + 0.12, 0, C.stone);
      b.cyl(0.6, 0.6, 0.06, 14, 0, 0.15 + tableH + 0.22, 0, C.stoneD);
      b.cyl(0.52, 0.52, 0.02, 14, 0, 0.15 + tableH + 0.23, 0, C.flour);
      b.box(0.22, 0.08, 0.32, 0.5, 0.15 + tableH + 0.16, 0.3, C.stone, 'solid', 0, -0.6, -0.2);
      chuteAt = [0.64, 0.15 + tableH + 0.1, 0.42];
      // buckets: wheat beside, flour under the spout
      const bucket = (x, z, top) => { b.cyl(0.2, 0.16, 0.36, 10, x, 0.33, z, C.woodL); for (const y of [0.22, 0.44]) b.cyl(0.205, 0.205, 0.03, 10, x, y, z, 0x3a3a3e); b.cyl(0.18, 0.18, 0.02, 10, x, 0.48, z, top);
        b.add(new THREE.TorusGeometry(0.19, 0.012, 3, 10, Math.PI), 0x3a3a3e, x, 0.5, z, 0, 0, 0); };
      bucket(0.75, 0.55, C.flour); bucket(-0.8, 0.35, C.wheat);
    } else {
      // a steel frame (painted) with the grinding chamber enclosing the stones
      const W = lv >= 5 ? 1.7 : lv >= 4 ? 1.35 : 1.2;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { b.box(0.12, tableH, 0.12, sx * W / 2, 0.15 + tableH / 2, sz * 0.5, paint); b.box(0.2, 0.06, 0.2, sx * W / 2, 0.18, sz * 0.5, trim); }
      for (const s of [-1, 1]) { b.box(W, 0.1, 0.1, 0, 0.15 + tableH, s * 0.5, paintD); b.box(0.1, 0.1, 1.0, s * W / 2, 0.15 + tableH, 0, paintD); b.box(W, 0.08, 0.08, 0, 0.5, s * 0.5, paintD); }
      const chambers = lv >= 5 ? [-0.42, 0.42] : [0];
      for (const x of chambers) { b.cyl(0.46, 0.5, 0.5, 14, x, 0.15 + tableH + 0.3, 0, trim); b.cyl(0.48, 0.48, 0.05, 14, x, 0.15 + tableH + 0.56, 0, paintD); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; bolt(b, x + Math.sin(a) * 0.5, 0.15 + tableH + 0.3, Math.cos(a) * 0.5, a); } }
      // the output chutes into bins / sacks
      const outs = lv >= 5 ? [-0.6, 0, 0.6] : lv >= 4 ? [-0.3, 0.3] : [0.2];
      for (const x of outs) { limb(b, [x, 0.15 + tableH + 0.1, 0.4], [x * 1.1, 0.55, 0.95], 0.08, 0.07, trim, 6); b.box(0.5, 0.42, 0.42, x * 1.1, 0.36, 1.1, lv >= 4 ? paintD : C.woodL); b.box(0.44, 0.03, 0.36, x * 1.1, 0.56, 1.1, C.flour); }
      chuteAt = [outs[outs.length - 1] * 1.1, 0.6, 0.95];
      // a sifter box (level 3+), a control panel (level 5)
      b.box(0.5, 0.36, 0.5, -W / 2 - 0.35, 0.15 + tableH - 0.1, 0.1, paintD); b.box(0.52, 0.04, 0.52, -W / 2 - 0.35, 0.15 + tableH + 0.1, 0.1, trim);
      if (lv >= 5) { b.box(0.06, 1.1, 0.06, W / 2 + 0.45, 0.7, 0.55, C.steelD); b.box(0.42, 0.5, 0.2, W / 2 + 0.45, 1.35, 0.55, C.cream); b.box(0.3, 0.16, 0.02, W / 2 + 0.45, 1.45, 0.66, 0x1a3a1a);
        for (const [x, c] of [[-0.1, 0x3fbf3a], [0.1, 0xd8342a]]) b.cyl(0.035, 0.035, 0.03, 8, W / 2 + 0.45 + x, 1.25, 0.66, c, Math.PI / 2, 0, 0); }
    }
    // level 2+: the automatic hopper above the stones, the motor and its belt, a power cable from a little pole
    if (lv >= 2) {
      const hs = [1, 1, 1.3, 1.45, 1.75][lv - 1], hy = 0.15 + tableH + (lv >= 3 ? 1.15 : 1.0) + 0.25 * hs;
      b.add(new THREE.CylinderGeometry(0.42 * hs, 0.12, 0.6 * hs, 4, 1, false, Math.PI / 4), lv >= 3 ? paint : C.steel, 0, hy, 0);
      b.add(new THREE.CylinderGeometry(0.44 * hs, 0.44 * hs, 0.05, 4, 1, false, Math.PI / 4), paintD, 0, hy + 0.31 * hs, 0);
      for (let i = 0; i < 8; i++) b.add(new THREE.OctahedronGeometry(0.08, 0), i % 2 ? C.wheat : C.wheatD, ((i % 3) - 1) * 0.16 * hs, hy + 0.33 * hs, (Math.floor(i / 3) - 1) * 0.16 * hs);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.05, hy - 0.15 - tableH - 0.3, 0.05, sx * 0.3 * hs, (0.15 + tableH + 0.4 + hy - 0.2) / 2, sz * 0.3 * hs, paintD);
      b.cyl(0.07, 0.08, hy - 0.15 - tableH - 0.55, 8, 0, (0.15 + tableH + 0.55 + hy - 0.3) / 2, 0, C.steelD);
      hopperTop = [0, hy + 0.35 * hs, 0];
      const motors = lv >= 4 ? [[-1, 1.05], [1, 1.05]] : [[1, 0.85]], ms = lv >= 4 ? 1.25 : 1;
      for (const [sx, d] of motors) {
        const mx = sx * (d + (lv >= 5 ? 0.35 : 0));
        b.box(0.5, 0.42, 0.42, mx, 0.15 + tableH - 0.15, -0.25, paintD);
        b.box(0.5 * ms, 0.4 * ms, 0.55 * ms, mx, 0.15 + tableH + 0.3, -0.25, paint);
        for (let i = 0; i < 4; i++) b.box(0.52 * ms, 0.025, 0.57 * ms, mx, 0.15 + tableH + 0.16 + i * 0.09 * ms, -0.25, paintD);
        limb(b, [mx - sx * 0.1, 0.15 + tableH + 0.62, -0.25], [0, 0.15 + tableH + (lv >= 3 ? 0.75 : 0.65), -0.05], 0.018, 0.018, 0x222226, 4);
      }
      b.box(0.1, 2.6, 0.1, -1.6, 1.45, -1.6, C.woodD); b.box(0.5, 0.06, 0.06, -1.6, 2.65, -1.6, C.woodD);
      for (const x of [-1.8, -1.4]) b.cyl(0.03, 0.03, 0.08, 6, x, 2.72, -1.6, 0xe8e2d6);
      limb(b, [-1.6, 2.6, -1.55], [motors[0][0] * motors[0][1], 0.15 + tableH + 0.5, -0.45], 0.015, 0.015, 0x1a1a1a, 4);
    }
    // level 4+: a small silo feeding the hopper
    if (lv >= 4) {
      const sx = 1.55 + (lv >= 5 ? 0.4 : 0), sz = -1.25;
      b.cyl(0.42, 0.42, 1.5, 12, sx, 1.55, sz, trim); b.add(new THREE.ConeGeometry(0.42, 0.5, 12), trim, sx, 0.55, sz, Math.PI, 0, 0); b.add(new THREE.ConeGeometry(0.44, 0.35, 12), paintD, sx, 2.48, sz);
      for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.box(0.05, 0.85, 0.05, sx + x, 0.55, sz + z, paintD);
      limb(b, [sx - 0.2, 2.3, sz + 0.2], hopperTop.map((v, i) => v + [0.25, -0.15, -0.2][i]), 0.06, 0.06, C.steelD, 6);
    }
  }));
  // the turning parts: the upper millstone (level 1–2, with the handle on level 1), a flywheel, the motor pulleys
  let stone = null;
  if (lv <= 2) {
    stone = built(b => { b.cyl(stoneR, stoneR + 0.02, 0.28, 14, 0, 0, 0, C.stone); b.cyl(0.08, 0.08, 0.3, 8, 0, 0.01, 0, C.dark); for (let i = 0; i < 6; i++) b.box(0.03, 0.29, 0.05, Math.sin(i) * stoneR, 0, Math.cos(i) * stoneR, C.stoneD, 'solid', 0, i, 0);
      for (let i = 0; i < 6; i++) b.add(new THREE.OctahedronGeometry(0.025, 0), C.wheat, Math.sin(i) * 0.04, 0.16, Math.cos(i) * 0.04);
      if (lv === 1) { b.box(0.05, 0.05, 0.12, 0, 0.12, stoneR - 0.08, C.woodD); b.cyl(0.035, 0.035, 0.32, 6, 0, 0.3, stoneR - 0.06, C.woodL); }
      else b.cyl(0.18, 0.18, 0.06, 12, 0, 0.32, 0, 0x2a2a2e); });
    stone.position.set(0, 0.15 + tableH + 0.4, 0); g.add(stone); spin.push({ o: stone, axis: 'y', speed: 2.2 });
  } else {
    const fw = built(b => { b.cyl(0.3, 0.3, 0.06, 14, 0, 0, 0, 0x2a2a2e); for (let i = 0; i < 4; i++) b.box(0.56, 0.05, 0.04, 0, 0.03, 0, C.steel, 'solid', 0, i * Math.PI / 4, 0); b.cyl(0.06, 0.06, 0.12, 8, 0, 0, 0, C.steel); });
    const xs = lv >= 5 ? [-0.42, 0.42] : [0];
    for (const x of xs) { const o = fw.clone(); o.position.set(x, 0.15 + tableH + 0.75, 0); g.add(o); spin.push({ o, axis: 'y', speed: 4 }); }
  }
  if (lv >= 2) {
    const pul = built(b => { b.cyl(0.14, 0.14, 0.06, 12, 0, 0, 0, 0x2a2a2e, Math.PI / 2, 0, 0); b.box(0.04, 0.26, 0.03, 0, 0, 0.0, C.steel); b.box(0.26, 0.04, 0.03, 0, 0, 0.0, C.steel); });
    const motors = lv >= 4 ? [-1, 1] : [1];
    for (const sx of motors) { const o = pul.clone(); const d = (lv >= 4 ? 1.05 : 0.85) + (lv >= 5 ? 0.35 : 0); o.position.set(sx * d, 0.15 + tableH + 0.62, 0.06); g.add(o); spin.push({ o, axis: 'z', speed: 9 * sx }); }
  }
  return { group: g, spin, stone, chuteAt, hopperTop, tableH, stoneY: 0.15 + tableH + 0.4, stoneR };
}
