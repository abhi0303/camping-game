// Scarecrows for the fields (two looks) and the crows that come for the crops.
//   Level 1: a pumpkin head with a carved face under a pointed brown hat with a dark band, a brown coat over a cream
//     shirt with a belt and buckle, a ragged hem with straw sticking out, straw hands, arms out on the cross bar,
//     two crows perched on the arms, all on a wooden post.
//   Level 2: the same scarecrow better dressed — a red coat covered in patches (brown, purple, tan), a rope belt,
//     more straw, a thicker red-brown hat with a red band and patches, and a little mound of earth with grass
//     tufts and stones at the foot of the post.
// Models stand at y = 0, facing +z (about 2.1 m tall).
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';

const geoOf = fn => { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function limbBox(b, a, c, w, d, col) {
  const A = V(...a), Cc = V(...c), dir = Cc.clone().sub(A), len = dir.length();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()));
  b.add(new THREE.BoxGeometry(w, len, d), col, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, e.x, e.y, e.z);
}
const STRAW = [0xe8c45a, 0xd8ae44, 0xf0d47a];
// a crow (perched, facing +z), local origin at its feet
export function crow(b, x, y, z, ry = 0, s = 1) {
  b.group(x, y, z, 0, ry, 0, () => {
    const K = 0x1c1c22, K2 = 0x2a2a34;
    b.add(new THREE.OctahedronGeometry(1, 0), K, 0, 0.09 * s, 0, 0.2, 0, 0, 'solid', 0.06 * s, 0.07 * s, 0.13 * s);     // body
    b.add(new THREE.OctahedronGeometry(1, 0), K2, 0, 0.16 * s, 0.08 * s, 0, 0, 0, 'solid', 0.045 * s, 0.045 * s, 0.05 * s);   // head
    b.add(new THREE.ConeGeometry(0.016 * s, 0.07 * s, 4), 0x3a3a3a, 0, 0.155 * s, 0.14 * s, Math.PI / 2, 0, 0);           // beak
    b.add(new THREE.OctahedronGeometry(1, 0), K, 0, 0.1 * s, -0.15 * s, -0.4, 0, 0, 'solid', 0.035 * s, 0.015 * s, 0.09 * s);   // tail
    for (const sx of [-1, 1]) b.add(new THREE.OctahedronGeometry(1, 0), K2, sx * 0.05 * s, 0.1 * s, -0.02 * s, 0.15, 0, sx * 0.3, 'solid', 0.02 * s, 0.05 * s, 0.11 * s);   // wings
    for (const sx of [-1, 1]) b.box(0.008 * s, 0.04 * s, 0.008 * s, sx * 0.02 * s, 0.02 * s, 0.01 * s, 0x6a5a40);           // legs
    for (const sx of [-1, 1]) b.box(0.012 * s, 0.012 * s, 0.012 * s, sx * 0.022 * s, 0.17 * s, 0.115 * s, 0xf0e6c0);        // eyes
  });
}
export const crowGeometry = () => geoOf(b => crow(b, 0, 0, 0, 0, 1.15));

function scarecrow(b, lv) {
  const red = lv >= 2, coat = red ? 0xb8452e : 0x8a6038, coatD = red ? 0x8e3020 : 0x6e4a2a, hat = red ? 0x9a5a34 : 0x7a5a38, hatD = red ? 0x7a4226 : 0x5e4428;
  const band = red ? 0xc23a2a : 0x3e2a1c, wood = 0x7a5232, pumpkin = 0xe07a1e, pumpkinD = 0xc2621a;
  // the post and the cross bar
  b.box(0.12, 2.0, 0.12, 0, 1.0, -0.04, wood);
  b.box(1.5, 0.09, 0.09, 0, 1.42, -0.04, wood);
  if (red) {                                                                                  // the mound at its foot
    b.add(new THREE.CylinderGeometry(0.42, 0.55, 0.12, 9), 0x6b4a2c, 0, 0.04, 0);
    for (const [x, z] of [[0.3, 0.2], [-0.32, 0.1], [0.1, -0.35], [-0.2, -0.28]]) for (let k = 0; k < 3; k++) b.add(new THREE.ConeGeometry(0.025, 0.18, 3), [0x5fae3a, 0x74c046][k % 2], x + (k - 1) * 0.04, 0.17, z, (k - 1) * 0.3, k, 0);
    for (const [x, z, s] of [[0.42, -0.1, 0.07], [-0.4, 0.3, 0.06], [0.2, 0.42, 0.05]]) b.add(new THREE.DodecahedronGeometry(s, 0), 0x9a978e, x, s * 0.6, z);
  }
  // the coat: body flaring to a ragged hem, sleeves along the bar, a collar; the shirt and its buttons
  b.add(new THREE.CylinderGeometry(0.2, 0.3, 0.75, 7), coat, 0, 1.06, 0);
  for (let i = 0; i < 9; i++) {                                                                // ragged hem points
    const a = i / 9 * Math.PI * 2, r = 0.3;
    b.add(new THREE.ConeGeometry(0.06, 0.18, 3), i % 2 ? coat : coatD, Math.sin(a) * r, 0.62, Math.cos(a) * r, Math.PI, a, 0);
  }
  for (let i = 0; i < 11; i++) {                                                               // straw under the hem
    const a = (i + 0.5) / 11 * Math.PI * 2;
    b.add(new THREE.ConeGeometry(0.02, 0.2 + (i % 3) * 0.05, 3), STRAW[i % 3], Math.sin(a) * 0.26, 0.6, Math.cos(a) * 0.26, Math.PI + Math.sin(i) * 0.25, a, 0);
  }
  b.box(0.16, 0.42, 0.04, 0, 1.18, 0.2, 0xece2c8);                                              // shirt front
  for (const y of [1.08, 1.18, 1.28]) b.box(0.025, 0.025, 0.02, 0, y, 0.225, 0x5a4a3a);
  for (const sx of [-1, 1]) b.box(0.13, 0.12, 0.05, sx * 0.1, 1.38, 0.19, coatD, 'solid', 0.3, 0, sx * 0.4);   // collar
  if (red) {                                                                                   // rope belt and patches
    b.add(new THREE.TorusGeometry(0.235, 0.025, 4, 10), 0xcfb27a, 0, 0.92, 0, Math.PI / 2, 0, 0);
    b.box(0.03, 0.18, 0.03, 0.06, 0.82, 0.24, 0xcfb27a, 'solid', 0, 0, 0.2);
    for (const [x, y, z, c, ry] of [[0.17, 1.12, 0.14, 0x7a5236, 0.7], [-0.2, 0.86, 0.13, 0x6a4a7a, -0.7], [0.05, 0.78, -0.27, 0xc9a46a, 3.0], [-0.14, 1.2, -0.17, 0x6a4a7a, 3.6], [0.22, 0.8, -0.1, 0xc9a46a, 2.0]])
      b.add(new THREE.BoxGeometry(0.11, 0.1, 0.012), c, x, y, z, 0, ry, 0);
  } else {
    b.box(0.5, 0.06, 0.44, 0, 0.92, 0, 0x3e2a1c);                                                // belt
    b.box(0.07, 0.07, 0.02, 0, 0.92, 0.23, 0xc9a23a);                                           // buckle
    for (const [x, y] of [[0.15, 1.18], [-0.15, 1.18]]) b.box(0.08, 0.07, 0.02, x, y, 0.21, coatD);   // pockets
  }
  for (const sx of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.08, 0.1, 0.55, 6), coat, sx * 0.42, 1.42, -0.04, 0, 0, Math.PI / 2);   // sleeve
    if (red) b.add(new THREE.BoxGeometry(0.1, 0.012, 0.09), 0xc9a46a, sx * 0.4, 1.51, -0.04);
    for (let k = 0; k < 5; k++) b.add(new THREE.ConeGeometry(0.022, 0.22, 3), STRAW[k % 3], sx * (0.74 + 0.04 * (k % 2)), 1.42 + (k - 2) * 0.035, -0.04 + (k % 3 - 1) * 0.03, 0, 0, -sx * (Math.PI / 2 + (k - 2) * 0.22));   // straw hands
    for (let k = 0; k < 4; k++) b.add(new THREE.ConeGeometry(0.018, 0.14, 3), STRAW[k % 3], sx * (0.25 + k * 0.03), 1.36, 0.07, 0.4, 0, sx * (0.6 + k * 0.2));   // straw at the shoulders
  }
  // the pumpkin head with a carved face
  b.add(new THREE.IcosahedronGeometry(1, 1), pumpkin, 0, 1.72, 0, 0, 0, 0, 'solid', 0.2, 0.19, 0.2);
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; b.add(new THREE.IcosahedronGeometry(1, 0), i % 2 ? pumpkin : pumpkinD, Math.sin(a) * 0.09, 1.72, Math.cos(a) * 0.09, 0, a, 0, 'solid', 0.13, 0.19, 0.12); }   // lobes
  b.cyl(0.025, 0.035, 0.08, 5, 0, 1.94, 0, 0x5a7a2a);
  for (const sx of [-1, 1]) b.add(new THREE.ConeGeometry(0.05, 0.06, 3), 0x2a1a0e, sx * 0.08, 1.77, 0.205, Math.PI / 2, 0, 0);   // eyes
  b.add(new THREE.ConeGeometry(0.03, 0.04, 3), 0x2a1a0e, 0, 1.71, 0.215, Math.PI / 2, 0, 0);                                     // nose
  b.box(0.2, 0.035, 0.02, 0, 1.64, 0.2, 0x2a1a0e);                                                                              // mouth
  for (const x of [-0.06, 0.02]) b.box(0.035, 0.03, 0.022, x, 1.665, 0.205, pumpkin);                                           // teeth
  if (red) for (let k = 0; k < 6; k++) b.add(new THREE.ConeGeometry(0.02, 0.14, 3), STRAW[k % 3], (k - 2.5) * 0.06, 1.88, -0.12, -0.9, 0, (k - 2.5) * 0.2);   // straw hair
  // the pointed hat: a brim, a crown that bends over at the tip, a band
  const brim = red ? 0.4 : 0.36;
  b.add(new THREE.CylinderGeometry(brim, brim + 0.02, red ? 0.05 : 0.035, 10), hat, 0, 1.9, 0, 0.08, 0, 0);
  b.add(new THREE.CylinderGeometry(0.15, 0.2, 0.24, 8), hat, 0, 2.04, 0);
  b.add(new THREE.CylinderGeometry(0.08, 0.15, 0.2, 7), hatD, 0.02, 2.24, -0.02, -0.15, 0, -0.15);
  b.add(new THREE.ConeGeometry(0.08, 0.24, 6), hat, 0.12, 2.38, -0.06, -0.3, 0, -1.0);
  b.add(new THREE.CylinderGeometry(0.205, 0.205, 0.06, 8), band, 0, 1.96, 0);
  if (red) for (const [x, y, z, ry] of [[0.12, 2.06, 0.11, 0.8], [-0.14, 2.02, -0.1, 3.8]]) b.add(new THREE.BoxGeometry(0.08, 0.07, 0.012), 0xc9a46a, x, y, z, 0, ry, 0);
  // two crows on the arms
  crow(b, 0.55, 1.47, -0.04, 0.5, 1.2); crow(b, -0.58, 1.47, -0.04, -0.9, 1.2);
}
export const scarecrowGeometry = lv => geoOf(b => scarecrow(b, lv));
