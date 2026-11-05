// Trees, bushes, plants, rocks and broken wood in the stylised low-poly look (bright lime leaves in drooping,
// layered pads; red-brown bark; rounded grey rocks). Every model is built from code into a GeoBuilder `b`
// (js/utils.js) and merged, then drawn instanced by js/world.js. Each model uses its own seeded random
// numbers, so building them never changes the world's shared random sequence (where things are placed).
import * as THREE from 'three';

const TAU = Math.PI * 2;
function prng(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return (a = 0, b = 1) => { s = (s * 16807) % 2147483647; return a + (s - 1) / 2147483646 * (b - a); }; }
const C = {
  leafL: 0xb9e24f, leaf: 0xa3d340, leafD: 0x86ba33, leafDD: 0x6c9c2b,
  olive: 0xaecb47, oliveD: 0x8aa936,
  bark: 0x8b4b2b, barkD: 0x6d3a21, barkL: 0xa45c33, wood: 0xd6a466, woodD: 0xb98448,
  palm: 0xb06c35, palmD: 0x94562a,
  pineL: 0xa9c84b, pineLD: 0x7f9e36, pineG: 0x88b34a, pineGD: 0x5e8b36,
  rock: 0xa3a8b1, rockL: 0xb5bac3, rockD: 0x8a909a, red: 0xb35b3b, redD: 0x8f4329,
};

/* ---------- geometry helpers ---------- */
// triangles -> geometry; each triangle is turned so its face points away from `o` (outward)
function trisGeo(list, o = [0, 0, 0]) {
  const pos = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), g = new THREE.Vector3(), O = new THREE.Vector3(...o);
  for (const [p, q, r] of list) {
    a.set(...p); b.set(...q); c.set(...r);
    n.subVectors(b, a).cross(c.clone().sub(a));
    g.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(O);
    if (n.dot(g) < 0) pos.push(...p, ...r, ...q); else pos.push(...p, ...q, ...r);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
// both faces of thin things (fronds, leaves): one set facing up (light colour), one facing down (dark)
function twoSided(list) {
  const v = new THREE.Vector3(), w = new THREE.Vector3(), U = [], D = [];
  for (const t of list) {
    v.set(t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]); w.set(t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]);
    if (v.cross(w).y >= 0) { U.push(t); D.push([t[0], t[2], t[1]]); } else { U.push([t[0], t[2], t[1]]); D.push(t); }
  }
  const mk = l => { const pos = []; for (const t of l) pos.push(...t[0], ...t[1], ...t[2]); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; };
  return [mk(U), mk(D)];
}
// a tapered cylinder from point a to point c
const _a = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _y = new THREE.Vector3(0, 1, 0);
export function limb(b, a, c, r0, r1, col, seg = 6) {
  _a.set(...a); _c.set(...c);
  const d = _c.clone().sub(_a), len = d.length();
  _e.setFromQuaternion(_q.setFromUnitVectors(_y, d.normalize()));
  b.add(new THREE.CylinderGeometry(r1, r0, len * 1.04, seg), col, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, _e.x, _e.y, _e.z);
}
// a lumpy rock / blob: an icosahedron whose points are pushed in and out (the same push for the same point,
// so the surface stays closed)
export function lumpGeo(detail, amt, seed) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, R = prng(seed), map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e3)},${Math.round(p.getY(i) * 1e3)},${Math.round(p.getZ(i) * 1e3)}`;
    if (!map.has(k)) map.set(k, 1 + R(-amt, amt));
    const s = map.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------- leaves ---------- */
// a leaf pad: an irregular low dome with a jagged, drooping edge — light on top, darker underneath and on
// the hanging edge (the reference's layered canopy)
function pad(b, x, y, z, r, seed, cols = [C.leafL, C.leafD], h = r * 0.5, droop = 0.6) {
  const R = prng(seed * 7919 + 13), n = 9 + Math.floor(R(0, 3)), ring = [], tips = [];
  for (let i = 0; i < n; i++) { const a = (i + R(-0.25, 0.25)) / n * TAU, rr = r * R(0.78, 1.08); ring.push([Math.cos(a) * rr, R(-0.08, 0.1) * h, Math.sin(a) * rr]); }
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n], k = R(0.98, 1.12);
    tips.push([(p[0] + q[0]) / 2 * k, -h * droop * R(0.45, 1.0), (p[2] + q[2]) / 2 * k]);
  }
  const top = [R(-0.12, 0.12) * r, h * 0.55, R(-0.12, 0.12) * r], bot = [0, -h * 0.28, 0];
  const T = [], S = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    T.push([top, p, q]);
    S.push([p, tips[i], q], [p, q, bot]);
  }
  b.add(trisGeo(T), cols[0], x, y, z);
  b.add(trisGeo(S), cols[1], x, y, z);
}
// a pine tier: a cone with a zigzag rim (points hanging down, notches up)
function tier(b, y, r, h, seed, cols) {
  const R = prng(seed * 104729 + 7), n = 10 + 2 * Math.floor(R(0, 2)), rim = [];
  for (let i = 0; i < n; i++) {
    const a = (i + R(-0.2, 0.2)) / n * TAU, tip = i % 2 === 0;
    const rr = r * (tip ? R(0.95, 1.08) : R(0.66, 0.76)), yy = tip ? -h * R(0.08, 0.18) : h * R(0.1, 0.16);
    rim.push([Math.cos(a) * rr, yy, Math.sin(a) * rr]);
  }
  const apex = [R(-0.05, 0.05) * r, h, R(-0.05, 0.05) * r], bot = [0, h * 0.12, 0], T = [], U = [];
  for (let i = 0; i < n; i++) { const p = rim[i], q = rim[(i + 1) % n]; T.push([apex, p, q]); U.push([q, p, bot]); }
  b.add(trisGeo(T, [0, h * 0.3, 0]), cols[0], 0, y, 0);
  b.add(trisGeo(U, [0, h * 0.6, 0]), cols[1], 0, y, 0);
}
// a long leaf / frond: a folded strip with jagged sides, rising then drooping (both faces)
function frond(b, len, wid, droop, yaw, tilt, x, y, z, seed, cols) {
  const R = prng(seed * 31 + 5), N = 7, C0 = [], L = [], Rr = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, w = wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7) * (1 - 0.35 * t) * (k % 2 ? R(0.7, 0.85) : R(1.05, 1.2));
    const cx = len * t, cy = len * (tilt * t - droop * t * t);
    C0.push([cx, cy, 0]); L.push([cx - w * 0.15, cy - w * 0.32, w]); Rr.push([cx - w * 0.15, cy - w * 0.32, -w]);
  }
  const tri = [];
  for (let k = 0; k < N; k++) { tri.push([C0[k], L[k], C0[k + 1]], [L[k], L[k + 1], C0[k + 1]], [C0[k], C0[k + 1], Rr[k]], [Rr[k], C0[k + 1], Rr[k + 1]]); }
  const [up, dn] = twoSided(tri);
  b.add(up, cols[0], x, y, z, 0, yaw, 0);
  b.add(dn, cols[1], x, y, z, 0, yaw, 0);
}

/* ---------- broadleaf trees ---------- */
// a crown of leaf pads in rings (a rounded dome): rings = [[y, ring radius, pad radius, count], …]
function crown(seed, rings, top) {
  const R = prng(seed), out = [];
  for (const [y, rr, pr, n] of rings) {
    const a0 = R(0, TAU);
    for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU + R(-0.25, 0.25), d = rr * R(0.85, 1.12); out.push([Math.cos(a) * d, y + R(-0.35, 0.35), Math.sin(a) * d, pr * R(0.88, 1.12)]); }
  }
  if (top) out.push([R(-0.3, 0.3), top[0], R(-0.3, 0.3), top[1]]);
  return out;
}
// a trunk with a root flare (no flat boards), a few branches out to the crown, and the leaf pads
function broadleaf(b, o) {
  const R = prng(o.seed), lean = o.lean || 0, H = o.trunkH, r = o.trunkR;
  b.add(new THREE.CylinderGeometry(r * 1.05, r * 1.9, 0.9, 7), C.bark, 0, 0.42, 0);                         // root flare
  for (let i = 0; i < 4; i++) {                                                                                // surface roots
    const a = i / 4 * TAU + R(0, 0.8), l = r * R(2.2, 3.0);
    limb(b, [Math.cos(a) * r * 0.6, 0.45, Math.sin(a) * r * 0.6], [Math.cos(a) * l, -0.05, Math.sin(a) * l], r * 0.42, r * 0.12, C.barkD, 5);
  }
  const mid = [lean * 0.4, H * 0.55, 0], top = [lean, H, 0];
  limb(b, [0, 0.6, 0], mid, r, r * 0.86, C.bark, 7);
  limb(b, mid, top, r * 0.86, r * 0.62, C.bark, 7);
  // branches to the outermost low pads (the rest of the crown hides the trunk top)
  const outer = o.pads.map(p => [p, Math.hypot(p[0] - lean, p[2])]).filter(([, d]) => d > 1.2).sort((p, q) => q[1] - p[1]).slice(0, o.branches || 5);
  for (const [[x, y, z, pr]] of outer) {
    const from = [lean * (0.6 + R(0, 0.3)), H * R(0.78, 0.98), 0], to = [x * 0.78, y - pr * 0.3, z * 0.78];
    const bend = [(from[0] + to[0]) / 2 + R(-0.3, 0.3), (from[1] + to[1]) / 2 + R(0.1, 0.5), (from[2] + to[2]) / 2 + R(-0.3, 0.3)];
    limb(b, from, bend, r * 0.5, r * 0.34, C.bark, 5); limb(b, bend, to, r * 0.34, r * 0.18, C.barkL, 5);
  }
  const ys = o.pads.map(p => p[1]), hiY = Math.max(...ys), loY = Math.min(...ys);
  o.pads.forEach(([x, y, z, pr], i) => {
    const k = (y - loY) / Math.max(0.01, hiY - loY), sun = R(0, 1) < 0.25;                                    // a few sunlit, yellower pads
    const cols = k > 0.6 ? [sun ? 0xc6e85c : C.leafL, C.leafL] : k > 0.25 ? [sun ? C.leafL : C.leaf, C.leafL] : [C.leaf, C.leaf];
    pad(b, x, y, z, pr, o.seed * 13 + i, cols, pr * 0.66, 0.42);
  });
}
export const broadleafA = b => broadleaf(b, { seed: 3, trunkH: 5.6, trunkR: 0.34, lean: 0.15,
  pads: crown(3, [[6.3, 2.7, 1.9, 5], [7.8, 1.9, 2.1, 5], [9.2, 0.95, 2.0, 3]], [10.3, 1.6]) });
export const broadleafB = b => broadleaf(b, { seed: 7, trunkH: 6.2, trunkR: 0.32, lean: -0.35,
  pads: crown(7, [[6.8, 2.4, 1.8, 5], [8.3, 1.6, 2.0, 4], [9.6, 0.7, 1.7, 2]], [10.6, 1.3]).map(([x, y, z, r], i) => [x + (i % 3 === 0 ? 0.6 : -0.2), y, z, r]) });
// the big canopy tree (the tallest jungle trees)
export const bigTree = b => broadleaf(b, { seed: 11, trunkH: 9.0, trunkR: 0.52, lean: 0.2, branches: 6,
  pads: crown(11, [[10.2, 4.0, 2.3, 6], [11.8, 3.0, 2.6, 6], [13.4, 1.7, 2.5, 4]], [14.8, 2.2]) });
// a round tree of stacked, drooping layers on a short trunk
export const roundTree = b => {
  const s = 1.55;
  limb(b, [0, -0.1, 0], [0.05, 3.6 * s, 0], 0.26 * s, 0.17 * s, C.bark, 6);
  b.add(new THREE.CylinderGeometry(0.3 * s, 0.48 * s, 0.5, 7), C.bark, 0, 0.2, 0);
  [[3.4, 2.0], [4.1, 1.85], [4.75, 1.55], [5.3, 1.1], [5.72, 0.62]].forEach(([y, r], i) =>
    pad(b, 0, y * s, 0, r * s, 40 + i, i > 2 ? [C.olive, C.oliveD] : [C.olive, C.oliveD], r * s * 0.42, 0.75));
};
// a bare dead tree with forked branches
export const deadTree = b => {
  const R = prng(91);
  limb(b, [0, -0.1, 0], [0.2, 3.4, 0.1], 0.36, 0.26, C.bark, 6);
  b.add(new THREE.CylinderGeometry(0.36, 0.62, 0.6, 7), C.barkD, 0, 0.28, 0);
  const grow = (p, dir, len, r, depth) => {
    const q = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len];
    limb(b, p, q, r, r * 0.62, depth > 1 ? C.bark : C.barkL, 5);
    if (depth >= 3) return;
    const n = depth === 0 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = R(0, TAU), sp = R(0.45, 0.85), d = [dir[0] * 0.6 + Math.cos(a) * sp, dir[1] * 0.7 + R(0.1, 0.4), dir[2] * 0.6 + Math.sin(a) * sp], l = Math.hypot(...d);
      grow(q, d.map(v => v / l), len * R(0.55, 0.72), r * 0.6, depth + 1);
    }
  };
  grow([0.2, 3.3, 0.1], [0.05, 1, 0.02], 2.6, 0.26, 0);
};

/* ---------- palms ---------- */
function palm(b, seed, bend) {
  const R = prng(seed), N = 7;
  let prev = [0, -0.1, 0];
  for (let k = 1; k <= N; k++) {                                                                            // a gently curved trunk in rings
    const t = k / N, p = [bend * t * t, t * 8.2, bend * 0.25 * t * t];
    limb(b, prev, p, 0.25 - 0.1 * (k - 1) / N, 0.25 - 0.1 * k / N, k % 2 ? C.palm : C.palmD, 6);
    prev = p;
  }
  b.add(new THREE.DodecahedronGeometry(0.32, 0), C.palmD, prev[0], prev[1] + 0.05, prev[2]);
  for (let i = 0; i < 8; i++) {
    const yaw = i / 8 * TAU + R(-0.2, 0.2);
    frond(b, R(3.0, 3.6), R(0.32, 0.4), R(0.85, 1.1), yaw, R(0.35, 0.6), prev[0], prev[1] + 0.1, prev[2], seed * 10 + i, i % 2 ? [C.leaf, C.leafD] : [C.leafL, C.leafD]);
  }
}
export const palmA = b => palm(b, 5, 1.1);
export const palmB = b => palm(b, 17, -0.7);

/* ---------- pines ---------- */
function pine(b, o) {
  limb(b, [0, -0.1, 0], [0, o.trunk, 0], o.tr, o.tr * 0.7, C.bark, 6);
  for (let i = 0; i < o.tiers; i++) {
    const k = i / (o.tiers - 1), r = o.r0 + (o.r1 - o.r0) * k;
    tier(b, o.y0 + i * o.step, r, o.th * (1 - 0.3 * k), o.seed + i, o.cols);
  }
}
export const pineLime = b => pine(b, { seed: 21, trunk: 2.2, tr: 0.24, tiers: 6, y0: 1.5, step: 1.05, r0: 2.3, r1: 0.65, th: 1.7, cols: [C.pineL, C.pineLD] });
export const pineGreen = b => pine(b, { seed: 33, trunk: 2.2, tr: 0.24, tiers: 7, y0: 1.4, step: 0.92, r0: 2.2, r1: 0.55, th: 1.6, cols: [C.pineG, C.pineGD] });
export const pineTall = b => pine(b, { seed: 47, trunk: 3.2, tr: 0.32, tiers: 8, y0: 2.2, step: 1.2, r0: 3.0, r1: 0.75, th: 2.0, cols: [C.pineG, C.pineGD] });
// a tall, narrow cypress of rounded lumps
export const cypress = b => {
  limb(b, [0, -0.1, 0], [0, 1.6, 0], 0.22, 0.18, C.bark, 6);
  [[1.9, 1.15, 1.3], [3.3, 1.2, 1.4], [4.8, 1.05, 1.4], [6.2, 0.85, 1.3], [7.4, 0.6, 1.1]].forEach(([y, r, h], i) =>
    b.add(lumpGeo(1, 0.14, 60 + i), i % 2 ? C.leaf : C.leafL, 0, y, 0, 0, i * 0.7, 0, 'solid', r, h, r));
};

/* ---------- bushes and small plants ---------- */
export const roundBush = b => {
  b.add(lumpGeo(1, 0.12, 71), C.leaf, 0, 0.55, 0, 0, 0, 0, 'solid', 0.85, 0.7, 0.85);
  b.add(lumpGeo(1, 0.12, 72), C.leafL, 0.6, 0.45, 0.35, 0, 0.5, 0, 'solid', 0.6, 0.5, 0.6);
  b.add(lumpGeo(1, 0.12, 73), C.leafD, -0.5, 0.4, -0.25, 0, 1.0, 0, 'solid', 0.55, 0.45, 0.55);
};
// a low plant of broad pointed leaves (the jungle's undergrowth)
export const smallPlant = b => {
  const R = prng(81);
  for (let i = 0; i < 6; i++) frond(b, R(0.55, 0.8), R(0.12, 0.17), R(0.9, 1.3), i / 6 * TAU + R(-0.2, 0.2), R(0.9, 1.3), 0, 0.05, 0, 200 + i, i % 2 ? [C.leaf, C.leafDD] : [C.leafL, C.leafD]);
};

/* ---------- rocks ---------- */
export const boulderA = b => {
  b.add(lumpGeo(1, 0.16, 101), C.rock, 0, 0.38, 0, 0, 0, 0, 'solid', 1.25, 0.82, 1.05);
  b.add(lumpGeo(0, 0.12, 102), C.rockD, 1.1, 0.12, 0.45, 0.4, 0.2, 0, 'solid', 0.32, 0.26, 0.3);
};
export const boulderB = b => {
  b.add(lumpGeo(1, 0.18, 103), C.rockL, 0, 0.4, 0, 0.2, 0.6, 0, 'solid', 1.0, 0.85, 0.9);
  b.add(lumpGeo(1, 0.15, 104), C.rock, 0.9, 0.22, -0.35, 0, 1.2, 0, 'solid', 0.6, 0.5, 0.55);
  b.add(lumpGeo(0, 0.12, 105), C.rockD, -0.85, 0.08, 0.5, 0.3, 0, 0.2, 'solid', 0.22, 0.18, 0.22);
};
export const standingRock = b => {
  b.add(lumpGeo(1, 0.14, 107), C.rockL, 0, 1.05, 0, 0.06, 0.4, 0.05, 'solid', 0.55, 1.45, 0.5);
  b.add(lumpGeo(0, 0.12, 108), C.rockD, 0.6, 0.12, 0.3, 0, 0.6, 0, 'solid', 0.26, 0.22, 0.24);
};
export const redRock = b => {
  b.add(lumpGeo(0, 0.2, 109), C.red, 0, 0.6, 0, 0.2, 0.3, 0.15, 'solid', 0.6, 1.0, 0.55);
  b.add(lumpGeo(0, 0.15, 110), C.redD, 0.55, 0.12, 0.25, 0, 0.8, 0, 'solid', 0.24, 0.2, 0.22);
};
// a big rock with small ones around it (ground decoration)
export const rockCluster = b => {
  b.add(lumpGeo(1, 0.16, 121), 0xffffff, 0, 0.42, 0, 0.3, 0.6, 0.1, 'solid', 1.2, 0.8, 1.0);
  b.add(lumpGeo(1, 0.15, 122), 0xeef0f4, 1.05, 0.22, 0.4, 0.5, 0.2, 0.4, 'solid', 0.55, 0.45, 0.5);
  b.add(lumpGeo(0, 0.12, 123), 0xdde0e6, -1.1, 0.1, 0.3, 0.3, 0.5, 0.2, 'solid', 0.24, 0.2, 0.22);
  b.add(lumpGeo(0, 0.12, 124), 0xe4e6ea, 1.6, 0.06, -0.2, 0.1, 0.9, 0.4, 'solid', 0.16, 0.13, 0.15);
};
// a little group of pebbles (tinted per instance)
export const pebbles = b => {
  [[0, 0, 0.28], [0.42, 0.18, 0.18], [-0.32, 0.3, 0.15], [0.12, -0.38, 0.2], [-0.45, -0.2, 0.11]].forEach(([x, z, r], i) =>
    b.add(lumpGeo(0, 0.15, 130 + i), 0xffffff, x, r * 0.45, z, i * 0.7, i, 0, 'solid', r, r * 0.7, r * 0.9));
};

/* ---------- broken wood ---------- */
// a cut stump with roots spreading out
export const stump = b => {
  const R = prng(141);
  b.add(new THREE.CylinderGeometry(0.42, 0.52, 0.62, 8), C.bark, 0, 0.3, 0);
  b.add(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 8), C.wood, 0, 0.62, 0);                               // the cut face
  b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.045, 8), C.woodD, 0, 0.625, 0);                               // its rings
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU + R(-0.3, 0.3), l = R(0.95, 1.35);
    limb(b, [Math.cos(a) * 0.32, 0.3, Math.sin(a) * 0.32], [Math.cos(a) * l, -0.04, Math.sin(a) * l], 0.17, 0.05, C.barkD, 5);
  }
};
// a fallen log: a cut end, a jagged broken end and a short branch stub (lies along x)
export const fallenLog = b => {
  b.add(new THREE.CylinderGeometry(0.3, 0.33, 2.7, 8), C.bark, 0, 0.3, 0, 0, 0, Math.PI / 2);
  b.add(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 8), C.wood, -1.36, 0.3, 0, 0, 0, Math.PI / 2);
  const R = prng(151);
  for (let i = 0; i < 6; i++) {                                                                              // splinters at the broken end
    const a = i / 6 * TAU, r = 0.22;
    b.add(new THREE.ConeGeometry(0.1, R(0.25, 0.5), 4), i % 2 ? C.woodD : C.wood, 1.4, 0.3 + Math.sin(a) * r, Math.cos(a) * r, 0, 0, -Math.PI / 2 + R(-0.2, 0.2));
  }
  limb(b, [0.3, 0.45, 0.1], [0.6, 0.95, 0.45], 0.1, 0.05, C.barkL, 5);
};
// a fallen tree lying across the road (two halves that move apart when it's cut): root plate on one side,
// the crown on the other. side: -1 roots, +1 crown. jit: 4 small random numbers (kept for the world's sequence)
export function fallenTreeHalf(b, side, jit) {
  b.add(new THREE.CylinderGeometry(0.5, 0.56, 6.2, 9), C.bark, side * 3.1, 0.55, 0, 0, 0, Math.PI / 2);
  if (side < 0) {
    b.add(lumpGeo(1, 0.15, 161), C.barkD, -6.3, 1.1, 0, 0, 0, 0, 'solid', 0.4, 1.5, 1.5);                  // the root plate with earth
    b.add(lumpGeo(0, 0.2, 162), 0x7a5a3a, -6.45, 0.9, 0.2, 0, 0, 0, 'solid', 0.3, 1.0, 1.1);
    for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; limb(b, [-6.2, 1.1, 0], [-6.9, 1.1 + Math.sin(a) * 1.7, Math.cos(a) * 1.7], 0.14, 0.04, C.barkD, 5); }
  } else {
    for (let i = 0; i < 3; i++) limb(b, [3.6 + i * 0.9, 0.7, 0], [4.6 + i * 0.9, 1.4 + jit[i] * 2, (i - 1) * 1.4], 0.14, 0.07, C.barkL, 5);
    [[6.6, 1.5, 0.4 + jit[0], 1.7], [5.5, 1.7, -1.3 + jit[1], 1.5], [7.5, 1.1, -0.7 + jit[2], 1.3], [5.0, 1.3, 1.4 + jit[3], 1.2], [6.4, 2.3, -0.3, 1.2]]
      .forEach(([x, y, z, r], i) => pad(b, x, y, z, r, 170 + i, i === 4 ? [C.leafL, C.leaf] : [C.leaf, C.leafD]));
  }
}
export const FLORA_COLORS = C;
