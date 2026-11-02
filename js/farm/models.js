// Low-poly farm models (same building style as the rest of the world): shelters, the market stall,
// the farm store, plot markers and the animals (one geometry each, drawn as instances).
import * as THREE from 'three';
import { GeoBuilder, canvasTexture } from '../utils.js';

const WOOD = 0x8a5a33, WOOD_D = 0x6e4626, WOOD_L = 0xa8743f, ROOF = 0x5b3a24, RED = 0xa83a2c, WHITE = 0xf0ece0,
  STONE = 0x8a877f, HAY = 0xd8b24e, WATER = 0x4f86b8, GREEN_ROOF = 0x2f4f2a;

// a sign board with text (its own small mesh, like the trail signs)
export function signMesh(text, sub, w = 1.6, h = 0.6, bg = '#5b3a1e') {
  const tex = canvasTexture(256, 96, (c, cw, ch) => {
    c.fillStyle = bg; c.fillRect(0, 0, cw, ch);
    c.strokeStyle = '#3a2412'; c.lineWidth = 8; c.strokeRect(4, 4, cw - 8, ch - 8);
    c.fillStyle = '#f2e3b6'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `bold ${sub ? 38 : 46}px Arial`; c.fillText(text, cw / 2, sub ? 38 : ch / 2);
    if (sub) { c.font = 'bold 22px Arial'; c.fillText(sub, cw / 2, 74); }
  });
  // two faces back to back, so the text reads the right way from both sides
  const g = new THREE.Group(), geo = new THREE.PlaneGeometry(w, h), mat = new THREE.MeshLambertMaterial({ map: tex });
  const front = new THREE.Mesh(geo, mat), back = new THREE.Mesh(geo, mat);
  back.rotation.y = Math.PI;
  g.add(front, back);
  return g;
}

// pen fence around the front of a plot, gate gap in the middle of the front
function penFence(b) {
  const post = (x, z) => b.cyl(0.07, 0.08, 1.1, 5, x, 0.55, z, WOOD_D);
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.45, 0.85]) b.box(0.06, 0.08, len, (x0 + x1) / 2, y, (z0 + z1) / 2, WOOD, 'solid', 0, a, 0);
  };
  for (const sx of [-5, 5]) { for (let z = -1.6; z <= 6.01; z += 1.9) post(sx, z); rail(sx, -1.6, sx, 6); }
  for (const [x0, x1] of [[-5, -1.2], [1.2, 5]]) { for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 2) post(x, 6); rail(x0, 6, x1, 6); }
  // feed and water troughs
  b.box(1.4, 0.35, 0.5, -3.6, 0.2, 4.6, WOOD_D); b.box(1.25, 0.06, 0.38, -3.6, 0.36, 4.6, HAY);
  b.box(1.4, 0.35, 0.5, 3.6, 0.2, 4.6, WOOD_D); b.box(1.25, 0.06, 0.38, 3.6, 0.36, 4.6, WATER);
}
// a sloped roof made of two planks meeting at the ridge (along x)
function gableRoof(b, w, d, y, rise, color, over = 0.35) {
  const half = d / 2 + over, len = Math.hypot(half, rise), a = Math.atan2(rise, half);
  for (const s of [1, -1]) b.box(w + over * 2, 0.14, len, 0, y + rise / 2, s * half / 2, color, 'solid', s * a, 0, 0);
}

export function shelterModel(type) {
  const b = new GeoBuilder();
  b.box(10.4, 0.25, 5.6, 0, -0.05, -4, STONE);                      // foundation (hides uneven ground)
  if (type === 'coop') {
    b.group(0, 0, -4.2, 0, 0, 0, () => {
      for (const x of [-1.8, 1.8]) for (const z of [-1.3, 1.3]) b.cyl(0.08, 0.08, 0.6, 5, x, 0.3, z, WOOD_D);
      b.box(4, 0.15, 3, 0, 0.62, 0, WOOD_D);
      b.box(3.9, 1.6, 2.9, 0, 1.5, 0, WOOD_L);
      for (let y = 0.9; y < 2.3; y += 0.35) b.box(3.94, 0.04, 2.94, 0, y, 0, WOOD);
      gableRoof(b, 3.9, 2.9, 2.3, 0.9, RED);
      b.box(0.7, 0.9, 0.06, 0, 1.15, 1.47, WOOD_D);                    // little door
      b.box(1.0, 0.6, 0.9, 2.45, 1.0, 0.2, WOOD);                       // nesting box
      b.box(0.8, 0.06, 2.0, 0, 0.35, 2.3, WOOD, 'solid', -0.35, 0, 0);  // ramp
    });
  } else if (type === 'goat_shed') {
    b.group(0, 0, -4.2, 0, 0, 0, () => {
      b.box(6, 2.2, 0.2, 0, 1.1, -1.9, WOOD);                           // back wall
      for (const x of [-2.95, 2.95]) b.box(0.2, 2.2, 3.8, x, 1.1, 0, WOOD_D);
      for (const x of [-2.95, 0, 2.95]) b.cyl(0.1, 0.1, 2.9, 6, x, 1.45, 1.9, WOOD_D);
      b.box(6.6, 0.16, 4.6, 0, 2.75, 0, GREEN_ROOF, 'solid', -0.18, 0, 0);
      for (const [x, z] of [[-1.8, -1], [-0.6, -1.2], [1.6, -1]]) b.box(1.1, 0.6, 0.7, x, 0.3, z, HAY);
    });
  } else if (type === 'barn') {
    b.group(0, 0, -4, 0, 0, 0, () => {
      b.box(8, 3.2, 4.8, 0, 1.6, 0, RED);
      for (const x of [-3.98, 3.98]) b.box(0.08, 3.2, 4.85, x, 1.6, 0, WHITE);
      gableRoof(b, 8, 4.8, 3.2, 1.6, ROOF, 0.4);
      b.box(2.4, 2.4, 0.08, 0, 1.2, 2.42, WHITE);                       // doors with a white X
      b.box(2.2, 2.2, 0.1, 0, 1.2, 2.44, RED);
      for (const s of [1, -1]) b.box(0.18, 3.1, 0.12, 0, 1.2, 2.5, WHITE, 'solid', 0, 0, s * 0.75);
      b.box(1.2, 0.9, 0.1, 0, 3.6, 2.42, 0x3a2a20);                     // hay loft window
    });
  } else if (type === 'stable') {
    b.group(0, 0, -4.1, 0, 0, 0, () => {
      b.box(8, 2.8, 0.25, 0, 1.4, -2.1, WOOD);
      for (const x of [-3.9, 3.9]) b.box(0.25, 2.8, 4.4, x, 1.4, 0, WOOD);
      for (const x of [-1.3, 1.3]) b.box(0.12, 1.6, 3.6, x, 0.8, -0.2, WOOD_D);      // stall walls
      for (const x of [-2.6, 0, 2.6]) b.box(2.2, 1.1, 0.12, x, 0.55, 2.1, WOOD_L);   // half doors
      for (const x of [-3.9, -1.3, 1.3, 3.9]) b.cyl(0.1, 0.1, 2.8, 6, x, 1.4, 2.1, WOOD_D);
      gableRoof(b, 8, 4.4, 2.8, 1.2, GREEN_ROOF, 0.45);
      b.box(1, 0.5, 0.6, -2.6, 0.3, -1.4, HAY);
    });
  }
  penFence(b);
  return b.build();
}

// four corner stakes of every plot (the plot area before anything is built)
export function plotStakes(b) {
  for (const x of [-5.5, 5.5]) for (const z of [-6.5, 6.5]) b.cyl(0.05, 0.06, 0.7, 5, x, 0.35, z, WOOD_L);
}

export function marketModel() {
  const b = new GeoBuilder();
  b.box(3.4, 1.0, 1.1, 0, 0.5, 0.2, WOOD);                             // counter
  b.box(3.6, 0.1, 1.3, 0, 1.05, 0.2, WOOD_L);
  for (const x of [-1.65, 1.65]) for (const z of [-0.9, 0.7]) b.cyl(0.08, 0.08, 2.6, 6, x, 1.3, z, WOOD_D);
  for (let i = 0; i < 6; i++) b.box(0.62, 0.08, 2.1, -1.55 + i * 0.62, 2.62, -0.05, i % 2 ? WHITE : RED, 'solid', -0.25, 0, 0);   // striped awning
  for (const [x, c] of [[-1.1, 0xe8e2cc], [-0.5, 0xe8e2cc]]) { b.box(0.5, 0.18, 0.4, x, 1.2, 0.2, WOOD_D); for (let k = 0; k < 4; k++) b.add(new THREE.SphereGeometry(0.06, 6, 4), c, x - 0.15 + (k % 2) * 0.3, 1.33, 0.1 + Math.floor(k / 2) * 0.2); }
  for (const x of [0.5, 0.85, 1.2]) b.cyl(0.12, 0.13, 0.42, 8, x, 1.31, 0.2, 0xd8dde2);   // milk cans
  b.box(0.8, 0.5, 0.6, 2.3, 0.25, 0.4, WOOD); b.box(0.7, 0.12, 0.5, 2.3, 0.55, 0.4, HAY);  // feed sacks
  return b.build();
}

export function storeModel() {
  const b = new GeoBuilder();
  b.box(4.2, 2.3, 0.2, 0, 1.15, -1.4, WOOD);
  for (const x of [-2.05, 2.05]) b.box(0.2, 2.3, 3, x, 1.15, 0, WOOD_D);
  b.box(4.8, 0.14, 3.6, 0, 2.45, 0, GREEN_ROOF, 'solid', -0.15, 0, 0);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) b.cyl(0.18, 0.18, 1.8, 7, -1.2 + i * 0.37 + row * 0.18, 0.2 + row * 0.33, -0.6, WOOD_L, 0, 0, Math.PI / 2);
  for (const [x, y, z, s] of [[1.1, 0.25, -0.5, 0.35], [1.5, 0.22, -0.1, 0.3], [1.3, 0.55, -0.4, 0.28], [0.85, 0.2, 0.0, 0.25]]) b.add(new THREE.DodecahedronGeometry(s, 0), STONE, x, y, z);
  return b.build();
}

/* ---------- animals: one merged geometry each, facing +z, feet at y = 0 ---------- */
function geomOf(build) { const b = new GeoBuilder(); build(b); return b.build().children[0].geometry; }
const leg = (b, x, z, h, r, c) => b.cyl(r, r * 0.8, h, 5, x, h / 2, z, c);
export const ANIMAL_GEO = {
  chicken: () => geomOf(b => {
    b.add(new THREE.DodecahedronGeometry(0.17, 0), 0xf3efe6, 0, 0.3, 0, 0, 0, 0, 'solid', 1, 0.9, 1.25);
    b.box(0.12, 0.13, 0.12, 0, 0.46, 0.14, 0xf3efe6);
    b.box(0.03, 0.07, 0.08, 0, 0.55, 0.14, 0xd8342a);                   // comb
    b.box(0.05, 0.035, 0.06, 0, 0.45, 0.22, 0xf0b030);                  // beak
    b.box(0.1, 0.12, 0.1, 0, 0.36, -0.2, 0xe8e1d2, 'solid', 0.5, 0, 0); // tail
    for (const x of [-0.05, 0.05]) leg(b, x, 0, 0.16, 0.015, 0xf0b030);
  }),
  goat: () => geomOf(b => {
    b.box(0.34, 0.32, 0.7, 0, 0.62, 0, 0xe2ddd2);
    b.box(0.2, 0.24, 0.28, 0, 0.86, 0.42, 0xe2ddd2, 'solid', 0.3, 0, 0);
    for (const x of [-0.06, 0.06]) b.cyl(0.02, 0.035, 0.2, 4, x, 1.02, 0.36, 0x8a7a64, -0.5, 0, 0);
    b.box(0.06, 0.12, 0.04, 0, 0.7, 0.54, 0xb8b0a0);                    // beard
    for (const x of [-0.12, 0.12]) for (const z of [-0.26, 0.26]) leg(b, x, z, 0.46, 0.04, 0xcfc8ba);
    b.box(0.06, 0.12, 0.06, 0, 0.78, -0.37, 0xe2ddd2, 'solid', -0.6, 0, 0);
  }),
  cow: () => geomOf(b => {
    b.box(0.62, 0.62, 1.4, 0, 1.05, 0, 0xf4f1ea);
    b.box(0.02, 0.36, 0.42, 0.315, 1.1, 0.2, 0x2a2622);                 // black patches
    b.box(0.02, 0.3, 0.5, -0.315, 1.0, -0.3, 0x2a2622);
    b.box(0.4, 0.02, 0.36, 0, 1.365, -0.1, 0x2a2622);
    b.box(0.4, 0.42, 0.46, 0, 1.25, 0.86, 0xf4f1ea);
    b.box(0.3, 0.2, 0.14, 0, 1.12, 1.12, 0xe8a8a0);                     // muzzle
    for (const s of [-1, 1]) b.cyl(0.025, 0.04, 0.18, 4, s * 0.17, 1.52, 0.8, 0xe8e0c8, 0, 0, -s * 0.9);
    for (const x of [-0.22, 0.22]) for (const z of [-0.5, 0.5]) leg(b, x, z, 0.76, 0.07, 0xe8e4dc);
    b.box(0.14, 0.12, 0.18, 0, 0.7, 0.2, 0xe8a8a0);                     // udder
  }),
  horse: () => geomOf(b => {
    b.box(0.5, 0.56, 1.35, 0, 1.25, 0, 0x7a4a2a);
    b.box(0.26, 0.6, 0.3, 0, 1.68, 0.62, 0x7a4a2a, 'solid', 0.55, 0, 0);   // neck
    b.box(0.24, 0.26, 0.56, 0, 1.98, 0.92, 0x7a4a2a, 'solid', 0.45, 0, 0); // head
    b.box(0.07, 0.5, 0.36, 0, 1.82, 0.56, 0x2a1a12, 'solid', 0.55, 0, 0);  // mane
    for (const x of [-0.07, 0.07]) b.box(0.05, 0.12, 0.04, x, 2.16, 0.78, 0x7a4a2a);
    for (const x of [-0.17, 0.17]) for (const z of [-0.5, 0.5]) leg(b, x, z, 0.98, 0.06, 0x6a3e22);
    b.box(0.1, 0.55, 0.1, 0, 1.0, -0.72, 0x2a1a12, 'solid', -0.3, 0, 0);   // tail
  }),
};
