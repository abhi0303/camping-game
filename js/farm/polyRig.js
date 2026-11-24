// The model animals — the pig (js/farm/polyAnimals.js, baked by tools/bake-polyfarm.mjs from "Low Poly Farm V2"), the
// goat, the cows, the horses and the hens (js/farm/goatModel.js, cowModels.js, horseModels.js, chickenModels.js, baked
// by tools/bake-animals.mjs; some coats are another model recoloured, see VARIANTS):
// unpacked into geometry with a colour per triangle, and given the rig the farm's animal shader moves
// (js/farm/animals.js): every vertex gets aRig = [kind, a, b, c]. The model is one welded piece, so a vertex's
// part comes from where it is (the same place always gets the same part, so the skin never tears):
//   legs   below where they leave the body: swing from there (kind 1) and bend at the knee (kind 4.x)
//   neck   forward of the shoulder: turns down about the neck's base, a little at the shoulder and fully at the
//          head (kind 6, a = how much), so the neck bends smoothly when the animal grazes or roots; a horse's head
//          also nods back at the poll (aRig2), a chicken's bobs forward as it walks
//   wings  a hen's: the sides of its body flap out and up from the shoulder, more the further out (kind 3, weighted)
//   tail   the part hanging free of the rump: swishes from where it leaves it (kind 3)
import * as THREE from 'three';
import { PALETTE, POLY_ANIMALS } from './polyAnimals.js';
import { GOAT_MODEL } from './goatModel.js';
import { COW_MODELS } from './cowModels.js';
import { HORSE_MODELS } from './horseModels.js';
import { CHICKEN_MODELS } from './chickenModels.js';

const _c = new THREE.Color();
const smooth = (a, b, v) => { const k = Math.max(0, Math.min(1, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
// base64 -> bytes
export function bytes(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
// a baked part { tris, box, q (16-bit positions in the box), c (a palette index per triangle) } -> BufferGeometry
// (q and c can be given as arrays already: the farm's parts come from a binary file)
export function unpack(e, palette = PALETTE, q = new Int16Array(bytes(e.q).buffer), c = bytes(e.c)) {
  const n = e.tris * 3, B = e.box, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = B[k] + (q[i * 3 + k] + 32768) / 65535 * (B[k + 3] - B[k]);
  for (let t = 0; t < e.tris; t++) {
    _c.set(palette[c[t]]);
    for (let k = 0; k < 3; k++) { const o = (t * 3 + k) * 3; col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// where the parts are (metres, the animal facing +z, feet at y = 0)
//   legs: [x, z] of each leg's middle, hw/hd: the half size of a leg's column, cut: where the legs leave the
//   body, knee: front / hind · neck: its base (y, z), the shoulder z0 (no turn) to z1 (the full turn), above y
//   minY · tail: the free part (|x| < hw, z < z, minY < y < top), swishing from y top · size: drawn that much
//   smaller · model: its baked data (with its own palette) when it isn't one of the farm model's · walk: the legs
//   step one after another like a cow's (hind, front, the other hind, the other front) instead of in diagonal pairs
// the cows: the neck turns down about a point low in the chest, so the nose reaches the grass
const COW = { walk: true, hw: 0.075, hd: 0.12 };
export const RIGS = {
  cow: { ...COW, model: COW_MODELS.cow, legs: [[-0.178, 0.655], [0.178, 0.655], [-0.19, -0.675], [0.19, -0.675]], cut: 0.47, knee: [0.24, 0.3],
    neck: { y: 0.86, z: 0.7, z0: 0.7, z1: 1.15, minY: 0.48 }, tail: { hw: 0.06, z: -0.745, top: 1.1, minY: 0.3 } },
  cow_bw: { ...COW, model: COW_MODELS.cow_bw, legs: [[-0.13, 0.585], [0.13, 0.585], [-0.19, -0.67], [0.19, -0.67]], hw: 0.07, cut: 0.45, knee: [0.25, 0.3],
    neck: { y: 0.84, z: 0.62, z0: 0.62, z1: 1.0, minY: 0.48 }, tail: { hw: 0.04, z: -0.712, top: 1.18, minY: 0.35 } },
  cow_black: { ...COW, model: COW_MODELS.cow_black, legs: [[-0.16, 0.645], [0.16, 0.645], [-0.16, -0.69], [0.16, -0.69]], hw: 0.07, cut: 0.47, knee: [0.26, 0.32],
    neck: { y: 0.86, z: 0.68, z0: 0.68, z1: 1.08, minY: 0.5 }, tail: { hw: 0.05, z: -0.76, top: 1.2, minY: 0.55 } },
  pig: { legs: [[-0.095, 0.2], [0.11, 0.24], [-0.095, -0.34], [0.105, -0.35]], hw: 0.08, hd: 0.14, cut: 0.21, knee: [0.1, 0.11],
    neck: { y: 0.33, z: 0.2, z0: 0.12, z1: 0.3, minY: 0.21 }, tail: { hw: 0.06, z: -0.535, top: 0.45, minY: 0.3 } },
  // the goat (a fat-tailed sheep): short legs, the neck bends down from the withers (a sheep grazes with its whole
  // neck low), the fat tail hangs below the rump
  goat: { model: GOAT_MODEL, legs: [[-0.085, 0.255], [0.088, 0.248], [-0.1, -0.258], [0.092, -0.25]], hw: 0.078, hd: 0.078, cut: 0.29, knee: [0.14, 0.17],
    neck: { y: 0.55, z: 0.1, z0: 0.08, z1: 0.45, minY: 0.36 }, tail: { hw: 0.11, z: -0.36, top: 0.6, minY: 0.36 } },
  // the horses (they walk like cows, one leg after another): the neck's root is the line from the breast up to the
  // withers; the neck bends just in front of it (axis: across that line toward the head, t0 … t1 the bend) about a
  // point a quarter of the way up it (y, z) and turns down as one piece — the withers don't move, so the neck
  // doesn't swell — and the head nods back at the poll (poll: where, z0 … z1 the head's weight, nod: how much of the
  // neck's turn); graze: the neck's turn that puts the nose in the grass
  horse_bay: { walk: true, model: HORSE_MODELS.horse_bay, legs: [[0.11, 0.44], [-0.1, 0.44], [0.11, -0.565], [-0.13, -0.565]], hw: 0.09, hd: 0.16, cut: 0.74, knee: [0.42, 0.5],
    neck: { y: 1.113, z: 0.61, axis: [0.654, 0.756], t0: 0, t1: 0.25, minY: 0.85 }, poll: { y: 1.86, z: 0.93, z0: 0.8, z1: 0.98, nod: 0.6 }, graze: 1.76, tail: { hw: 0.12, z: -0.7, top: 1.3, minY: 0.1 } },
  horse_black: { walk: true, twoSided: true, model: HORSE_MODELS.horse_black, legs: [[0.205, 0.58], [-0.205, 0.58], [0.175, -0.69], [-0.175, -0.69]], hw: 0.09, hd: 0.16, cut: 0.88, knee: [0.5, 0.58],
    neck: { y: 1.195, z: 0.677, axis: [0.884, 0.467], t0: 0, t1: 0.25, minY: 0.9 }, poll: { y: 1.9, z: 1.3, z0: 1.15, z1: 1.32, nod: 0.6 }, graze: 1.43, tail: { hw: 0.15, z: -0.9, top: 1.55, minY: 0.35 } },
  horse_chestnut: { walk: true, model: HORSE_MODELS.horse_chestnut, legs: [[0.115, 0.57], [-0.115, 0.57], [0.125, -0.65], [-0.125, -0.65]], hw: 0.09, hd: 0.16, cut: 0.75, knee: [0.45, 0.52],
    neck: { y: 1.095, z: 0.672, axis: [0.699, 0.715], t0: 0, t1: 0.25, minY: 0.85 }, poll: { y: 1.86, z: 1.0, z0: 0.92, z1: 1.08, nod: 0.6 }, graze: 1.74, tail: { hw: 0.1, z: -0.76, top: 1.38, minY: 0.6 } },
  // the hens: two legs (kind 1, the feet bend), the neck and head turn down to peck from low in the breast (peck:
  // how far, the hen leaning in a little, so the beak taps the ground), the wings (|x| from x0 to x1 the flap's
  // weight) lift out from the shoulder (px, py)
  chicken: { model: CHICKEN_MODELS.chicken, legs: [[0.06, 0], [-0.06, 0]], hw: 0.075, hd: 0.1, cut: 0.14, knee: [0.07, 0.07],
    neck: { y: 0.24, z: -0.01, z0: -0.02, z1: 0.12, minY: 0.28 }, peck: 1.12, wings: { x0: 0.1, x1: 0.15, y0: 0.13, y1: 0.4, z0: -0.24, z1: 0.06, px: 0.07, py: 0.33 } },
  chicken_brown: { model: CHICKEN_MODELS.chicken_brown, legs: [[0.075, 0], [-0.07, 0]], hw: 0.06, hd: 0.08, cut: 0.14, knee: [0.07, 0.07],
    neck: { y: 0.2, z: -0.04, z0: -0.03, z1: 0.12, minY: 0.3 }, peck: 1.1, wings: { x0: 0.085, x1: 0.125, y0: 0.13, y1: 0.36, z0: -0.2, z1: 0.04, px: 0.06, py: 0.33 } },
  chicken_dark: { model: CHICKEN_MODELS.chicken_dark, legs: [[0.06, 0], [-0.06, 0]], hw: 0.06, hd: 0.07, cut: 0.15, knee: [0.08, 0.08],
    neck: { y: 0.22, z: -0.07, z0: -0.06, z1: 0.1, minY: 0.36 }, peck: 1.22, wings: { x0: 0.085, x1: 0.12, y0: 0.15, y1: 0.4, z0: -0.25, z1: 0.04, px: 0.06, py: 0.38 } },
};
// coats made from another model, recoloured (colour: (h, s, l, centre of the triangle) -> [h, s, l], sRGB HSL)
const hash3 = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
function noise3(x, y, z) {                                   // smooth value noise (the spotted horse's patches)
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = x - X, v = y - Y, w = z - Z, f = t => t * t * (3 - 2 * t);
  let r = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) r += hash3(X + i, Y + j, Z + k) * (i ? f(u) : 1 - f(u)) * (j ? f(v) : 1 - f(v)) * (k ? f(w) : 1 - f(w));
  return r;
}
export const VARIANTS = {
  horse: { base: 'horse_bay' },                              // (worlds from before the horses' colours)
  // a grey-white horse from the black one (its eyes and nostrils stay dark)
  horse_white: { base: 'horse_black', colour: (h, s, l) => (l < 0.07 ? [h, 0.05, 0.22] : [0.1, 0.06, 0.72 + 0.26 * l]) },
  // a golden horse from the chestnut one: the red-brown coat turns gold, the light socks and blaze stay cream
  horse_palomino: { base: 'horse_chestnut', colour: (h, s, l) => (l > 0.6 ? [0.12, 0.35, Math.min(0.95, l)] : l < 0.08 ? [0.08, 0.3, 0.16] : [0.115, 0.62, Math.min(0.78, 0.18 + l * 1.45)]) },
  // a spotted (pinto) horse: the chestnut with big white patches
  horse_pinto: { base: 'horse_chestnut', colour: (h, s, l, c) => (noise3(c[0] * 3.2 + 7, c[1] * 2.6, c[2] * 2.2) > 0.55 && c[1] > 0.5 && c[1] < 1.75 ? [0.1, 0.08, 0.8 + 0.15 * l] : [h, s, l]) },
  // the golden hen from the white one: white feathers turn gold, the red comb and the legs stay
  chicken_gold: { base: 'chicken', colour: (h, s, l) => (s < 0.35 && l > 0.35 ? [0.12, 0.78, 0.34 + l * 0.32] : [h, s, l]) },
};
// the rig of a type (a recoloured coat has its base model's)
export const rigOf = type => RIGS[type] || (VARIANTS[type] && RIGS[VARIANTS[type].base]);
const _hsl = {};
function recolour(g, fn) {
  const p = g.attributes.position, col = g.attributes.color;
  for (let t = 0; t < p.count; t += 3) {
    const c = [0, 1, 2].map(k => (p.getComponent(t, k) + p.getComponent(t + 1, k) + p.getComponent(t + 2, k)) / 3);
    _c.setRGB(col.getX(t), col.getY(t), col.getZ(t)).getHSL(_hsl, THREE.SRGBColorSpace);      // (HSL as the eye sees it)
    const [h, s, l] = fn(_hsl.h, _hsl.s, _hsl.l, c);
    _c.setHSL(h, s, l, THREE.SRGBColorSpace);
    for (let k = 0; k < 3; k++) col.setXYZ(t + k, _c.r, _c.g, _c.b);
  }
}
export function polyAnimal(type) {
  const V = VARIANTS[type], R = rigOf(type), e = R.model || POLY_ANIMALS[V ? V.base : type], g = unpack(e, e.palette || PALETTE);
  if (V && V.colour) recolour(g, V.colour);
  return rigGeometry(g, R);
}
// tag every corner of a geometry (facing +z, feet at y = 0) with its part, by where it is (R: a rig as in RIGS; also
// for the guard dogs' textured models, js/farm/dogs.js)
export function rigGeometry(g, R) {
  const k = R.size || 1, p = g.attributes.position, n = p.count, rig = new Float32Array(n * 4), rig2 = R.poll ? new Float32Array(n * 4) : null;
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let tag = [0, 0, 0, 0];
    const leg = y < R.cut ? R.legs.find(([lx, lz]) => Math.abs(x - lx) < R.hw && Math.abs(z - lz) < R.hd) : null;
    const T = R.tail, N = R.neck, W = R.wings;
    if (leg) {
      const front = leg[1] > 0, left = leg[0] > 0, knee = R.knee[front ? 0 : 1];
      // a cow's walk: left hind, left front, right hind, right front, a quarter of a step apart · else diagonal pairs
      const ph = R.walk ? (front ? (left ? 1.5 : 0.5) : (left ? 0 : 1)) * Math.PI : (leg[0] < 0) === front ? 0 : Math.PI;
      tag = y < knee ? [4 + knee * k / 2, ph, R.cut * k, leg[1] * k] : [1, ph, R.cut * k, leg[1] * k];
    } else if (T && Math.abs(x) < T.hw && z < T.z && y < T.top && y > (T.minY || 0)) tag = [3, 1e-4, T.top * k, 0];
    else if (W && Math.abs(x) > W.x0 && y > W.y0 && y < W.y1 && z > W.z0 && z < W.z1) tag = [3, Math.sign(x) * W.px * k, W.py * k, smooth(W.x0, W.x1, Math.abs(x))];
    else if (N.axis ? y > N.minY && (z - N.z) * N.axis[0] + (y - N.y) * N.axis[1] > N.t0 : z > N.z0 && y > N.minY) {
      // (axis: a horse's long neck bends only at its root and turns as one piece — measured along the neck from the
      // root, not by z, so the crest at the withers doesn't swing out and swell it)
      const w = N.axis ? smooth(N.t0, N.t1, (z - N.z) * N.axis[0] + (y - N.y) * N.axis[1]) : smooth(N.z0, N.z1, z);
      tag = [6, w, N.y * k, N.z * k];
      if (rig2) { const P = R.poll; rig2.set([P.y * k, P.z * k, smooth(P.z0, P.z1, z), P.nod], i * 4); }
    }
    rig.set(tag, i * 4);
  }
  if (k !== 1) { g.scale(k, k, k); g.computeBoundingSphere(); }
  g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
  if (rig2) g.setAttribute('aRig2', new THREE.BufferAttribute(rig2, 4));
  return g;
}
