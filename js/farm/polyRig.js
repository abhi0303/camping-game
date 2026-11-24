// The model animals — the cow and the pig (js/farm/polyAnimals.js, baked by tools/bake-polyfarm.mjs from "Low Poly
// Farm V2") and the goat (js/farm/goatModel.js, baked by tools/bake-goat.mjs from "Low poly Fat-tailed sheep"):
// unpacked into geometry with a colour per triangle, and given the rig the farm's animal shader moves
// (js/farm/animals.js): every vertex gets aRig = [kind, a, b, c]. The model is one welded piece, so a vertex's
// part comes from where it is (the same place always gets the same part, so the skin never tears):
//   legs   below where they leave the body: swing from there (kind 1) and bend at the knee (kind 4.x)
//   neck   forward of the shoulder: turns down about the neck's base, a little at the shoulder and fully at the
//          head (kind 6, a = how much), so the neck bends smoothly when the animal grazes or roots
//   tail   the part hanging free of the rump: swishes from where it leaves it (kind 3)
import * as THREE from 'three';
import { PALETTE, POLY_ANIMALS } from './polyAnimals.js';
import { GOAT_MODEL } from './goatModel.js';

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
//   smaller (the cow a little: it fits the village pens and the farm's barns) · model: its baked data (with its
//   own palette) when it isn't one of the farm model's
const RIGS = {
  cow: { size: 0.92, legs: [[-0.24, 0.55], [0.19, 0.55], [-0.22, -0.745], [0.2, -0.745]], hw: 0.1, hd: 0.15, cut: 0.6, knee: [0.36, 0.42],
    neck: { y: 0.85, z: 0.62, z0: 0.62, z1: 1.02, minY: 0.62 }, tail: { hw: 0.08, z: -0.86, top: 1.05 } },
  pig: { legs: [[-0.095, 0.2], [0.11, 0.24], [-0.095, -0.34], [0.105, -0.35]], hw: 0.08, hd: 0.14, cut: 0.21, knee: [0.1, 0.11],
    neck: { y: 0.33, z: 0.2, z0: 0.12, z1: 0.3, minY: 0.21 }, tail: { hw: 0.06, z: -0.535, top: 0.45, minY: 0.3 } },
  // the goat (a fat-tailed sheep): short legs, the neck bends down from the withers (a sheep grazes with its whole
  // neck low), the fat tail hangs below the rump
  goat: { model: GOAT_MODEL, legs: [[-0.085, 0.255], [0.088, 0.248], [-0.1, -0.258], [0.092, -0.25]], hw: 0.078, hd: 0.078, cut: 0.29, knee: [0.14, 0.17],
    neck: { y: 0.55, z: 0.1, z0: 0.08, z1: 0.45, minY: 0.36 }, tail: { hw: 0.11, z: -0.36, top: 0.6, minY: 0.36 } },
};
export function polyAnimal(type) {
  const R = RIGS[type], e = R.model || POLY_ANIMALS[type], g = unpack(e, e.palette || PALETTE), k = R.size || 1, p = g.attributes.position, n = p.count, rig = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let tag = [0, 0, 0, 0];
    const leg = y < R.cut ? R.legs.find(([lx, lz]) => Math.abs(x - lx) < R.hw && Math.abs(z - lz) < R.hd) : null;
    const T = R.tail, N = R.neck;
    if (leg) {
      const front = leg[1] > 0, ph = (leg[0] < 0) === front ? 0 : Math.PI, knee = R.knee[front ? 0 : 1];
      tag = y < knee ? [4 + knee * k / 2, ph, R.cut * k, leg[1] * k] : [1, ph, R.cut * k, leg[1] * k];   // diagonal pairs step together
    } else if (Math.abs(x) < T.hw && z < T.z && y < T.top && y > (T.minY || 0)) tag = [3, 1e-4, T.top * k, 0];
    else if (z > N.z0 && y > N.minY) tag = [6, smooth(N.z0, N.z1, z), N.y * k, N.z * k];
    rig.set(tag, i * 4);
  }
  if (k !== 1) { g.scale(k, k, k); g.computeBoundingSphere(); }
  g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
  return g;
}
