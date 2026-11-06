// What grows in the fields (js/farm/fields.js): one entry per crop, matching the server's catalog crop_<id>.
// A crop has its growth stages — seeds in the furrows, little shoots, half grown, ripe — each a small low-poly
// clump (a few plants) that the field repeats along its rows, and the share of the growing time each stage starts
// at. Adding a crop (vegetables…) = a catalog row on the server + an entry here; the field code stays the same.
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';

const geoOf = fn => { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// a thin tapering stalk from a to c (3 sides)
function stalk(b, a, c, r0, r1, col) {
  const A = V(...a), Cc = V(...c), d = Cc.clone().sub(A), len = d.length();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  b.add(new THREE.CylinderGeometry(r1, r0, len, 3, 1, true), col, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, e.x, e.y, e.z);
}
// a wheat ear at the top of a stalk: grains stacked in two rows (leaning a little), a few awns
function ear(b, x, y, z, len, lean, turn, col, colD, awns) {
  b.group(x, y, z, lean, turn, 0, () => {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t = i / n, s = 1 - t * 0.4, gy = t * len, w = 0.03 * s;
      for (const sx of [-1, 1]) b.add(new THREE.OctahedronGeometry(1, 0), (i + (sx > 0 ? 1 : 0)) % 2 ? col : colD, sx * w * 0.65, gy + len / n * 0.55, 0, 0, 0, sx * 0.3, 'solid', w, len / n * 0.85, w * 0.8);
    }
    if (awns) for (const sx of [-1, 1]) b.add(new THREE.ConeGeometry(0.004, 0.13, 3, 1, true), colD, sx * 0.03, len + 0.03, 0, 0, 0, -sx * 0.35);
  });
}
// a long leaf from the stalk, bending out (a flat narrow blade)
function leaf(b, x, y, z, turn, len, col) {
  b.group(x, y, z, 0, turn, 0, () => b.add(new THREE.ConeGeometry(0.018, len, 3, 1, true), col, 0, len / 2 * 0.85, len * 0.35, 0.75, 0, 0, 'solid', 1, 1, 0.35));
}

export const CROPS = {
  wheat: {
    name: 'Wheat', product: 'wheat',
    // row spacing (m) and the distance between clumps along a row
    rows: 0.75, step: 0.42,
    // a stage is shown from this share of the growing time (after watering); 'sown' is before watering
    stages: [{ key: 'seeds', at: 0, label: 'Seeds in the soil' }, { key: 'small', at: 0.15, label: 'Little shoots' },
      { key: 'medium', at: 0.45, label: 'Growing tall' }, { key: 'final', at: 0.8, label: 'Ripening' }],
    geos: {
      // seeds: pale grains scattered on the ridge
      seeds: () => geoOf(b => { for (const [x, z, r] of [[-0.12, 0.03, 0.4], [0.02, -0.04, 1.2], [0.14, 0.02, 2.3], [-0.04, 0.06, 0.8], [0.09, -0.07, 1.7]]) b.add(new THREE.TetrahedronGeometry(1, 0), 0xe8d4a0, x, 0.015, z, 0, r, 1.2, 'solid', 0.014, 0.012, 0.03); }),
      // little shoots: a few short green blades
      small: () => geoOf(b => {
        for (const [x, z, a, h] of [[-0.08, 0.02, 0.2, 0.2], [0.04, -0.03, -0.25, 0.26], [0.1, 0.04, 0.1, 0.17], [-0.02, 0.05, -0.1, 0.22], [0.0, -0.06, 0.35, 0.19]])
          b.add(new THREE.ConeGeometry(0.014, h, 3, 1, true), x % 0.1 ? 0x7cc24a : 0x64ac3c, x, h / 2, z, a * 0.6, x * 9, a, 'solid', 1, 1, 0.5);
      }),
      // half grown: green stalks with leaves, small green-gold ears
      medium: () => geoOf(b => {
        for (const [x, z, h, tw] of [[-0.09, 0.0, 0.52, 0.2], [0.06, -0.05, 0.6, -0.15], [0.1, 0.06, 0.48, 0.3]]) {
          stalk(b, [x, 0, z], [x + tw * 0.08, h, z], 0.011, 0.007, 0x8cbf4c);
          leaf(b, x, h * 0.25, z, tw * 6, 0.24, 0x74b244);
          ear(b, x + tw * 0.08, h, z, 0.1, tw * 0.5, tw * 4, 0xb8c460, 0x9cb04c, false);
        }
      }),
      // ripe: tall golden stalks with full ears and awns
      final: () => geoOf(b => {
        for (const [x, z, h, tw] of [[-0.1, 0.0, 0.92, 0.22], [0.05, -0.06, 1.02, -0.18], [0.11, 0.07, 0.86, 0.32]]) {
          stalk(b, [x, 0, z], [x + tw * 0.12, h, z], 0.012, 0.008, 0xd6b25a);
          leaf(b, x, h * 0.3, z, tw * 6, 0.26, 0xc9a24c);
          ear(b, x + tw * 0.12, h, z, 0.17, tw * 0.9, tw * 4, 0xe9c66a, 0xd2a94e, true);
        }
      }),
      // far away (js/farm/fields.js): the same shapes, a stalk and one ear each — a fifth of the triangles
      mediumFar: () => geoOf(b => { for (const [x, z, h, tw] of [[-0.09, 0.0, 0.52, 0.2], [0.06, -0.05, 0.6, -0.15], [0.1, 0.06, 0.48, 0.3]]) { stalk(b, [x, 0, z], [x + tw * 0.08, h, z], 0.013, 0.008, 0x8cbf4c); b.add(new THREE.OctahedronGeometry(1, 0), 0xa8bc58, x + tw * 0.08, h + 0.05, z, 0, 0, 0, 'solid', 0.03, 0.07, 0.03); } }),
      finalFar: () => geoOf(b => { for (const [x, z, h, tw] of [[-0.1, 0.0, 0.92, 0.22], [0.05, -0.06, 1.02, -0.18], [0.11, 0.07, 0.86, 0.32]]) { stalk(b, [x, 0, z], [x + tw * 0.12, h, z], 0.014, 0.009, 0xd6b25a); b.add(new THREE.OctahedronGeometry(1, 0), 0xe2bc5e, x + tw * 0.12, h + 0.08, z, 0, 0, 0, 'solid', 0.04, 0.1, 0.035); } }),
    },
    farAt: 9,                         // metres from a field's middle: further away its crop is drawn with the far shapes
  },
};
// which stage a growing crop is at, from the share of its growing time gone by (0..1)
export function stageAt(crop, pct) {
  let s = crop.stages[0];
  for (const x of crop.stages) if (pct >= x.at) s = x;
  return s;
}
