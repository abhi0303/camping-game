import * as THREE from 'three';
import { GeoBuilder, extrudeX, rectsWithHoles, plateTexture } from './utils.js';
import { C, Z, Y, BW, CW, AXLE_F, AXLE_R, WHEEL_R, RV_MATS } from './rvDims.js';
import { buildInterior } from './rvInterior.js';

const STRIPES = [[1.18, 1.34, C.stripe], [1.38, 1.42, C.stripeLt], [1.10, 1.13, C.stripeLt]];
export const BAY = { z0: -3.45, z1: -2.6, y0: 0.55, y1: 0.92 };

// Builds the whole RV. Returns handles for animation / logic.
export function buildRV() {
  const B = {};
  for (const k of ['base', 'left', 'right', 'rear', 'roof', 'alcove']) B[k] = new GeoBuilder();
  const m = { root: new THREE.Group(), body: new THREE.Group(), groups: {}, wheels: [], pivots: {}, extras: [], parts: {} };
  m.root.add(m.body);

  sideWall(B.left, 1);
  sideWall(B.right, -1);
  shellAndCab(B.base, B.alcove);
  rearEnd(B.rear);
  roof(B.roof);
  buildInterior(B, m);

  for (const k in B) {
    const g = B[k].build(RV_MATS);
    g.name = k; m.groups[k] = g; m.body.add(g);
  }
  // License plates
  const plateMat = new THREE.MeshLambertMaterial({ map: plateTexture('RV-001') });
  const pf = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), plateMat);
  pf.position.set(0, 0.55, 4.125);
  const pr = pf.clone(); pr.position.set(0, 0.8, Z.rear - 0.004); pr.rotation.y = Math.PI;
  m.groups.base.add(pf); m.groups.rear.add(pr);

  // Doors (pivot at hinge)
  m.pivots.driverDoor = cabDoor(1); m.groups.left.add(m.pivots.driverDoor);
  m.pivots.passengerDoor = cabDoor(-1); m.groups.right.add(m.pivots.passengerDoor);
  m.pivots.entryDoor = entryDoor(); m.groups.right.add(m.pivots.entryDoor);
  m.pivots.bayHatch = bayHatch(); m.groups.left.add(m.pivots.bayHatch);
  for (const e of m.extras) m.groups[e.group].add(e.obj);
  addMud(m);

  // Wheels (children of root so body roll doesn't move them)
  for (const [x, z, front, w] of [[0.9, AXLE_F, true, 0.3], [-0.9, AXLE_F, true, 0.3], [0.97, AXLE_R, false, 0.34], [-0.97, AXLE_R, false, 0.34]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, WHEEL_R, z);
    const spin = makeWheel(w); pivot.add(spin);
    m.root.add(pivot); m.wheels.push({ pivot, spin, front });
  }
  return m;
}

/* ---------- helpers ---------- */
function stripeRun(b, side, xs, y0, y1, zFrom, zTo, excl, color) {
  let segs = [[zFrom, zTo]];
  for (const [e0, e1] of excl) {
    const next = [];
    for (const [a, c] of segs) {
      if (e1 <= a || e0 >= c) { next.push([a, c]); continue; }
      if (e0 > a) next.push([a, e0]);
      if (e1 < c) next.push([e1, c]);
    }
    segs = next;
  }
  for (const [a, c] of segs) if (c - a > 0.01) b.boxMM(side * xs, side * (xs + 0.012), y0, y1, a, c, color);
}

function windowDressing(b, side, xs, z0, z1, y0, y1, mat = 'glass') {
  b.boxMM(side * (xs - 0.04), side * (xs - 0.03), y0, y1, z0, z1, C.win, mat);
  const o0 = side * xs, o1 = side * (xs + 0.03), f = 0.06;
  b.boxMM(o0, o1, y1, y1 + f, z0 - f, z1 + f, C.frame);
  b.boxMM(o0, o1, y0 - f, y0, z0 - f, z1 + f, C.frame);
  b.boxMM(o0, o1, y0, y1, z0 - f, z0, C.frame);
  b.boxMM(o0, o1, y0, y1, z1, z1 + f, C.frame);
  if (z1 - z0 > 0.75) { const zc = (z0 + z1) / 2; b.boxMM(o0, o1, y0, y1, zc - 0.025, zc + 0.025, C.frame); }
  // light wood inner frame
  b.boxMM(side * (xs - 0.07), side * (xs - 0.05), y0 - 0.04, y0, z0 - 0.04, z1 + 0.04, C.wood);
}

// Chamfered wheel arch: corner fills + dark flare
function arch(b, side, xs, z0, fills = true) {
  if (fills) {
    const xm = side * (xs - 0.0165);
    b.add(new THREE.BoxGeometry(0.026, 0.4, 0.4), C.body, xm, 1.03, z0 - 0.58, Math.PI / 4, 0, 0);
    b.add(new THREE.BoxGeometry(0.026, 0.4, 0.4), C.body, xm, 1.03, z0 + 0.58, Math.PI / 4, 0, 0);
  }
  const f0 = side * xs, f1 = side * (xs + 0.04), fx = (f0 + f1) / 2;
  b.boxMM(f0, f1, 1.03, 1.09, z0 - 0.3, z0 + 0.3, C.trim);
  b.add(new THREE.BoxGeometry(0.04, 0.06, 0.42), C.trim, fx, 0.91, z0 - 0.46, -Math.PI / 4, 0, 0);
  b.add(new THREE.BoxGeometry(0.04, 0.06, 0.42), C.trim, fx, 0.91, z0 + 0.46, Math.PI / 4, 0, 0);
  b.boxMM(f0, f1, 0.45, 0.77, z0 - 0.64, z0 - 0.58, C.trim);
  b.boxMM(f0, f1, 0.45, 0.77, z0 + 0.58, z0 + 0.64, C.trim);
}

/* ---------- side walls (left = +1, right = -1) ---------- */
function sideWall(b, side) {
  const right = side < 0;
  const wins = right
    ? [[-3.3, -2.4, 1.55, 2.3], [-1.8, -1.1, 1.55, 2.3], [0.45, 1.55, 1.55, 2.3], [2.2, 2.75, 2.62, 2.95]]
    : [[-3.35, -2.45, 1.55, 2.3], [-1.75, -1.05, 1.55, 2.3], [1.05, 1.75, 1.55, 2.3], [2.2, 2.75, 2.62, 2.95]];
  const holes = [
    { z0: Z.cab, z1: Z.nose + 0.01, y0: Y.bottom - 0.01, y1: Y.alcove },
    { z0: AXLE_R - 0.58, z1: AXLE_R + 0.58, y0: Y.bottom - 0.01, y1: 1.03 },
    ...wins.map(w => ({ z0: w[0], z1: w[1], y0: w[2], y1: w[3] })),
  ];
  if (right) holes.push({ z0: -0.65, z1: 0.15, y0: Y.bottom - 0.01, y1: 2.42 });
  else holes.push({ z0: BAY.z0, z1: BAY.z1, y0: BAY.y0, y1: BAY.y1 });   // outdoor storage bay under the bed
  const rects = rectsWithHoles(Z.nose - Z.rear, Y.roof - Y.bottom,
    holes.map(h => ({ u0: h.z0 - Z.rear, u1: h.z1 - Z.rear, v0: h.y0 - Y.bottom, v1: h.y1 - Y.bottom })));
  for (const r of rects) {
    const z0 = r.u0 + Z.rear, z1 = r.u1 + Z.rear, y0 = r.v0 + Y.bottom, y1 = r.v1 + Y.bottom;
    b.boxMM(side * (BW - 0.03), side * BW, y0, y1, z0, z1, C.body);
    const ly0 = Math.max(y0, Y.floor), ly1 = Math.min(y1, Y.ceil + 0.04);
    if (ly1 > ly0) b.boxMM(side * (BW - 0.055), side * (BW - 0.03), ly0, ly1, z0, z1, C.wall);
  }
  wins.forEach(([z0, z1, y0, y1]) => windowDressing(b, side, BW, z0, z1, y0, y1));
  arch(b, side, BW, AXLE_R);
  const excl = right ? [[-0.65, 0.15]] : [];
  for (const [y0, y1, col] of STRIPES) stripeRun(b, side, BW, y0, y1, Z.rear, Z.cab, excl, col);
  stripeRun(b, side, BW, 2.47, 2.55, Z.rear, Z.nose, [], C.stripe);
  if (right) {
    // entrance details: drip rail, porch light (glows at night), grab handle
    b.boxMM(-BW, -BW - 0.04, 2.44, 2.47, -0.74, 0.24, C.frame);
    b.boxMM(-BW - 0.01, -BW + 0.06, Y.bottom - 0.01, Y.floor + 0.025, -0.65, 0.15, C.chrome); // door sill
    b.boxMM(-BW, -BW - 0.02, 2.58, 2.72, -0.46, -0.04, C.chrome);
    b.boxMM(-BW - 0.02, -BW - 0.07, 2.6, 2.7, -0.42, -0.08, 0xfff4d6, 'lamp');
    b.boxMM(-BW - 0.06, -BW - 0.09, 1.0, 1.75, -0.86, -0.83, C.chrome);
    for (const y of [1.03, 1.72]) b.boxMM(-BW, -BW - 0.08, y - 0.02, y + 0.02, -0.86, -0.83, C.chrome);
  }
  if (!right) {
    // storage bay frame + latch plate
    const o0 = BW, o1 = BW + 0.02, f = 0.035;
    b.boxMM(o0, o1, BAY.y1, BAY.y1 + f, BAY.z0 - f, BAY.z1 + f, C.frame);
    b.boxMM(o0, o1, BAY.y0 - f, BAY.y0, BAY.z0 - f, BAY.z1 + f, C.frame);
    b.boxMM(o0, o1, BAY.y0, BAY.y1, BAY.z0 - f, BAY.z0, C.frame);
    b.boxMM(o0, o1, BAY.y0, BAY.y1, BAY.z1, BAY.z1 + f, C.frame);
  }
  // strip between cab door top and alcove
  b.boxMM(side * (CW - 0.05), side * CW, 2.36, Y.alcove, Z.cab, 2.52, C.body);
  // front face of box outside the cab width
  b.boxMM(side * CW, side * BW, Y.bottom, Y.alcove, Z.cab, Z.cab + 0.03, C.body);
  // B-pillar
  b.boxMM(side * (CW - 0.05), side * CW, Y.bottom, 2.42, Z.cab, Z.cab + 0.05, C.body);
  // vertical corner trim at the rear
  b.boxMM(side * (BW - 0.01), side * (BW + 0.02), Y.bottom, Y.roof, Z.rear - 0.02, Z.rear + 0.05, 0xd9d0bc);
}

/* ---------- floor, chassis, cab front, alcove ---------- */
function shellAndCab(b, al) {
  // floor with plank lines
  // (floor is notched around the rear wheel wells so nothing shows through the arches)
  const a0 = AXLE_R - 0.62, a1 = AXLE_R + 0.62;
  b.boxMM(-BW + 0.03, BW - 0.03, Y.bottom, Y.floor, Z.rear + 0.03, a0, C.floor);
  b.boxMM(-BW + 0.03, BW - 0.03, Y.bottom, Y.floor, a1, Z.cab, C.floor);
  b.boxMM(-0.72, 0.72, Y.bottom, Y.floor, a0, a1, C.floor);
  for (let x = -1.05; x <= 1.06; x += 0.21) {
    const segs = Math.abs(x) > 0.7 ? [[Z.rear + 0.06, a0], [a1, Z.cab]] : [[Z.rear + 0.06, Z.cab]];
    for (const [z0, z1] of segs) b.boxMM(x - 0.006, x + 0.006, Y.floor, Y.floor + 0.003, z0, z1, C.floorLine);
  }
  b.boxMM(-CW + 0.05, CW - 0.05, Y.bottom, Y.floor, Z.cab, Z.nose, 0x3a3a3c);
  // chassis + underbody
  b.boxMM(-0.85, 0.85, 0.28, Y.bottom, -3.6, Z.nose, C.dark);
  b.boxMM(0.25, 0.8, 0.18, 0.3, -1.0, 0.1, C.dark);
  b.cyl(0.04, 0.04, 0.5, 5, -0.6, 0.25, -3.75, 0x55585c, Math.PI / 2, 0, 0);
  for (const s of [1, -1]) b.boxMM(s * 0.72, s * 1.12, 0.12, 0.5, -2.46, -2.43, 0x1a1a1a);
  // dark wheel wells so the interior doesn't show through the arches
  const WELL = 0x1c1c1e;
  for (const s of [1, -1]) {
    b.boxMM(s * 0.74, s * (BW - 0.03), 1.03, 1.07, AXLE_R - 0.6, AXLE_R + 0.6, WELL);
    b.boxMM(s * 0.72, s * 0.76, Y.bottom, 1.07, AXLE_R - 0.6, AXLE_R + 0.6, WELL);
    b.boxMM(s * 0.74, s * (BW - 0.03), Y.bottom, 1.07, AXLE_R - 0.62, AXLE_R - 0.58, WELL);
    b.boxMM(s * 0.74, s * (BW - 0.03), Y.bottom, 1.07, AXLE_R + 0.58, AXLE_R + 0.62, WELL);
    b.boxMM(s * 0.72, s * (CW - 0.05), 1.03, 1.07, AXLE_F - 0.6, AXLE_F + 0.6, WELL);
    b.boxMM(s * 0.72, s * (CW - 0.05), Y.bottom, 1.07, AXLE_F - 0.62, AXLE_F - 0.58, WELL);
  }

  // engine nose (hood + front fenders) with wheel notch
  b.add(extrudeX([[2.95, 1.03], [3.35, 1.03], [3.63, 0.75], [3.63, 0.45], [3.95, 0.45], [3.95, 1.25], [3.86, 1.33], [2.95, 1.47]], 2 * CW), C.body);
  b.boxMM(-0.72, 0.72, 0.4, 1.03, 2.95, 3.63, C.dark);
  for (const s of [1, -1]) {
    arch(b, s, CW, AXLE_F, false);
    // fender stripes
    stripeRun(b, s, CW, 1.18, 1.34, 2.95, 3.85, [], C.stripe);
    stripeRun(b, s, CW, 1.38, 1.42, 2.95, 3.2, [], C.stripeLt);
    stripeRun(b, s, CW, 1.10, 1.13, 2.95, 3.9, [], C.stripeLt);
  }
  // grille, headlights, signals, bumper
  b.boxMM(-0.56, 0.56, 0.72, 1.17, 3.95, 3.975, C.chrome);
  b.boxMM(-0.52, 0.52, 0.75, 1.14, 3.95, 3.985, 0x34363b);
  for (let y = 0.8; y < 1.12; y += 0.075) b.boxMM(-0.5, 0.5, y, y + 0.025, 3.95, 3.99, 0x8c9096);
  b.boxMM(-0.08, 0.08, 0.92, 0.98, 3.95, 3.995, C.chrome);
  for (const s of [1, -1]) {
    b.boxMM(s * 0.58, s * 0.94, 0.8, 1.12, 3.95, 3.975, C.chrome);
    b.boxMM(s * 0.61, s * 0.91, 0.83, 1.09, 3.95, 3.99, 0xfff6dc, 'headlight');
    b.boxMM(s * 0.95, s * 1.06, 0.83, 1.09, 3.95, 3.985, 0xffa040, 'amber');
  }
  b.boxMM(-1.12, 1.12, 0.4, 0.7, 3.93, 4.12, C.trim);
  b.boxMM(-1.1, 1.1, 0.66, 0.69, 4.0, 4.125, 0x55585c);
  // windshield + A-pillars + wipers
  const wsA = -0.468, wsY = 1.925, wsZ = 2.72;
  b.add(new THREE.BoxGeometry(2 * CW - 0.1, 1.02, 0.015), C.win, 0, wsY, wsZ, wsA, 0, 0, 'glassLight');
  for (const s of [1, -1]) {
    b.add(new THREE.BoxGeometry(0.07, 1.04, 0.07), C.body, s * (CW - 0.035), wsY, wsZ, wsA, 0, 0);
    b.add(new THREE.BoxGeometry(0.5, 0.02, 0.02), 0x111111, s * 0.35, 1.52, 2.93, 0, 0, s * 0.12);
    // side mirrors
    b.boxMM(s * CW, s * (CW + 0.26), 1.62, 1.66, 2.86, 2.9, C.dark);
    b.boxMM(s * CW, s * (CW + 0.26), 1.95, 1.99, 2.86, 2.9, C.dark);
    b.boxMM(s * (CW + 0.24), s * (CW + 0.33), 1.55, 2.05, 2.8, 2.95, C.dark);
    b.boxMM(s * (CW + 0.25), s * (CW + 0.32), 1.6, 2.0, 2.795, 2.8, 0x9fb4c4);
  }
  b.boxMM(-CW, CW, 2.36, Y.alcove, 2.42, 2.56, C.body); // windshield header

  // over-cab alcove (own group so it can be hidden when sitting in the cab)
  al.boxMM(-BW, BW, Y.alcove - 0.04, Y.alcove + 0.04, Z.cab, Z.nose, C.body);
  al.add(extrudeX([[2.95, 2.38], [3.2, 2.62], [3.2, 2.98], [3.0, 3.2], [2.95, 3.2]], 2 * BW), C.body);
  al.boxMM(-0.75, 0.75, 2.68, 2.92, 3.2, 3.215, C.win);
  al.boxMM(-0.79, 0.79, 2.64, 2.96, 3.198, 3.208, C.frame);
  for (const x of [-0.3, 0, 0.3, -1.1, 1.1]) al.box(0.12, 0.05, 0.06, x, 3.03, 3.16, 0xffa040, 'amber', 0.8, 0, 0);
  al.boxMM(-BW + 0.05, BW - 0.05, Y.alcove + 0.04, Y.alcove + 0.2, Z.cab + 0.05, Z.nose - 0.02, 0xe9e2d0); // mattress
  al.boxMM(-BW + 0.05, 0.55, Y.alcove + 0.2, Y.alcove + 0.24, Z.cab + 0.04, Z.nose - 0.03, 0x5f7391);  // blanket
  al.box(0.32, 0.12, 0.55, 0.85, Y.alcove + 0.27, 2.42, 0xf7f7f2);                                    // pillow
  al.boxMM(-BW + 0.05, BW - 0.05, Y.alcove + 0.04, Y.alcove + 0.3, Z.cab, Z.cab + 0.05, C.wood);       // lip
}

/* ---------- rear wall, lights, bumper, ladder ---------- */
function rearEnd(b) {
  const rects = rectsWithHoles(2 * BW, Y.roof - Y.bottom, [{ u0: BW - 0.55, u1: BW + 0.55, v0: 1.65 - Y.bottom, v1: 2.35 - Y.bottom }]);
  for (const r of rects) {
    const x0 = r.u0 - BW, x1 = r.u1 - BW, y0 = r.v0 + Y.bottom, y1 = r.v1 + Y.bottom;
    b.boxMM(x0, x1, y0, y1, Z.rear, Z.rear + 0.03, C.body);
    const ly0 = Math.max(y0, Y.floor), ly1 = Math.min(y1, Y.ceil + 0.04);
    if (ly1 > ly0) b.boxMM(Math.max(x0, -BW + 0.055), Math.min(x1, BW - 0.055), ly0, ly1, Z.rear + 0.03, Z.rear + 0.055, C.wall);
  }
  b.boxMM(-0.55, 0.55, 1.65, 2.35, Z.rear + 0.03, Z.rear + 0.04, C.win, 'glass');
  const z0 = Z.rear - 0.03, z1 = Z.rear, f = 0.06;
  b.boxMM(-0.61, 0.61, 2.35, 2.35 + f, z0, z1, C.frame); b.boxMM(-0.61, 0.61, 1.65 - f, 1.65, z0, z1, C.frame);
  b.boxMM(-0.61, -0.55, 1.65, 2.35, z0, z1, C.frame); b.boxMM(0.55, 0.61, 1.65, 2.35, z0, z1, C.frame);
  for (const [y0, y1, col] of STRIPES) b.boxMM(-BW, BW, y0, y1, Z.rear - 0.012, Z.rear, col);
  b.boxMM(-BW, BW, 2.47, 2.55, Z.rear - 0.012, Z.rear, C.stripe);
  for (const s of [1, -1]) {
    b.boxMM(s * 0.9, s * 1.14, 0.74, 1.25, Z.rear - 0.05, Z.rear, 0xc8261c, 'taillight');
    b.boxMM(s * 0.9, s * 1.14, 0.64, 0.74, Z.rear - 0.05, Z.rear, 0xffa040, 'amber');
    b.boxMM(s * 0.72, s * 0.86, 0.95, 1.08, Z.rear - 0.03, Z.rear, 0xf4f4f4);
  }
  b.boxMM(-BW - 0.02, BW + 0.02, 0.32, 0.6, Z.rear - 0.18, Z.rear, C.trim);
  // ladder (vehicle right side of the rear)
  const zl = Z.rear - 0.14;
  for (const lx of [-0.98, -0.62]) {
    b.boxMM(lx - 0.02, lx + 0.02, 0.62, 3.55, zl - 0.02, zl + 0.02, C.rack);
    for (const sy of [0.9, 1.9, 2.9]) b.boxMM(lx - 0.015, lx + 0.015, sy - 0.015, sy + 0.015, zl, Z.rear, C.rack);
    b.boxMM(lx - 0.02, lx + 0.02, 3.51, 3.55, zl - 0.02, Z.rear + 0.45, C.rack);
    b.boxMM(lx - 0.02, lx + 0.02, Y.roof + 0.06, 3.55, Z.rear + 0.41, Z.rear + 0.45, C.rack);
  }
  for (let y = 0.8; y < 3.45; y += 0.3) b.boxMM(-0.98, -0.62, y - 0.015, y + 0.015, zl - 0.015, zl + 0.015, C.rack);
}

/* ---------- roof, ceiling, rack, AC ---------- */
function roof(b) {
  b.boxMM(-BW - 0.01, BW + 0.01, Y.roof - 0.02, Y.roof + 0.06, Z.rear - 0.02, Z.nose, C.body);
  b.boxMM(-BW + 0.055, BW - 0.055, Y.ceil, Y.ceil + 0.04, Z.rear + 0.055, Z.nose, C.ceiling);
  for (const z of [-2.8, -1.1, 0.9]) b.boxMM(-0.2, 0.2, Y.ceil - 0.02, Y.ceil, z - 0.13, z + 0.13, 0xfff7e0, 'ilamp');
  // AC unit
  b.boxMM(-0.42, 0.42, Y.roof + 0.06, Y.roof + 0.4, -1.1, -0.1, 0xf2f0ea);
  b.boxMM(-0.38, 0.38, Y.roof + 0.4, Y.roof + 0.44, -1.05, -0.15, 0xe3e0d8);
  for (let k = 0; k < 5; k++) {
    const y = Y.roof + 0.12 + k * 0.05;
    b.boxMM(-0.36, 0.36, y, y + 0.022, -0.1, -0.09, 0x8e8c85);
    for (const s of [1, -1]) b.boxMM(s * 0.42, s * 0.43, y, y + 0.022, -1.0, -0.2, 0x8e8c85);
  }
  b.boxMM(-0.25, 0.25, Y.roof + 0.06, Y.roof + 0.16, 1.0, 1.5, 0xd8d5cc);
  b.boxMM(-0.25, 0.25, Y.roof + 0.06, Y.roof + 0.13, -2.6, -2.1, 0xd8d5cc);
  // roof rack
  for (const s of [1, -1]) {
    b.boxMM(s * 1.0 - 0.025, s * 1.0 + 0.025, Y.roof + 0.32, Y.roof + 0.37, -2.9, 2.6, C.rack);
    for (let z = -2.9; z <= 2.61; z += 1.1) b.boxMM(s * 1.0 - 0.02, s * 1.0 + 0.02, Y.roof + 0.06, Y.roof + 0.34, z - 0.02, z + 0.02, C.rack);
  }
  for (const z of [-2.9, 1.3, 2.6]) b.boxMM(-1.0, 1.0, Y.roof + 0.32, Y.roof + 0.37, z - 0.025, z + 0.025, C.rack);
}

/* ---------- doors ---------- */
function cabDoor(side) {
  const b = new GeoBuilder();
  const hx = side * CW, hz = Z.nose;
  b.group(-hx, 0, -hz, 0, 0, 0, () => {
    const hole = [[2.02, 1.5], [2.84, 1.5], [2.46, 2.28], [2.02, 2.28]];
    const prof = [[1.95, 0.45], [2.47, 0.45], [2.47, 0.75], [2.75, 1.03], [2.95, 1.03], [2.95, 1.47], [2.5, 2.36], [1.95, 2.36]];
    b.add(extrudeX(prof, 0.05, [hole]), C.body, side * (CW - 0.025), 0, 0);
    b.add(extrudeX(hole, 0.01), C.win, side * (CW - 0.03), 0, 0, 0, 0, 0, 'glassLight');
    for (const [y0, y1, col] of STRIPES) b.boxMM(side * CW, side * (CW + 0.012), y0, y1, 1.95, 2.95, col);
    b.boxMM(side * CW, side * (CW + 0.03), 1.45, 1.49, 2.0, 2.16, C.dark);
    b.boxMM(side * (CW - 0.05), side * (CW - 0.08), 0.6, 1.45, 2.0, 2.85, C.doorCard);
    b.boxMM(side * (CW - 0.08), side * (CW - 0.14), 1.1, 1.16, 2.1, 2.6, C.dashDk);
  });
  const pivot = new THREE.Group();
  pivot.position.set(hx, 0, hz);
  pivot.add(b.build(RV_MATS));
  pivot.userData.openAngle = side > 0 ? -1.1 : 1.1;
  return pivot;
}

function entryDoor() {
  const b = new GeoBuilder();
  const hx = -BW, hz = 0.15, z0 = -0.65, y0 = 0.58, y1 = 2.42;
  b.group(-hx, 0, -hz, 0, 0, 0, () => {
    const rects = rectsWithHoles(hz - z0, y1 - y0, [{ u0: 0.15, u1: 0.6, v0: 1.2, v1: 1.73 }]);
    for (const r of rects) {
      b.boxMM(-BW, -BW + 0.04, y0 + r.v0, y0 + r.v1, z0 + r.u0, z0 + r.u1, C.body);
      b.boxMM(-BW + 0.04, -BW + 0.06, y0 + r.v0, y0 + r.v1, z0 + r.u0, z0 + r.u1, C.wall);
    }
    b.boxMM(-BW + 0.015, -BW + 0.025, 1.67, 2.2, -0.5, -0.05, C.win, 'glass');
    const o0 = -BW, o1 = -BW - 0.025;
    b.boxMM(o0, o1, 2.2, 2.25, -0.55, 0.0, C.frame); b.boxMM(o0, o1, 1.62, 1.67, -0.55, 0.0, C.frame);
    b.boxMM(o0, o1, 1.67, 2.2, -0.55, -0.5, C.frame); b.boxMM(o0, o1, 1.67, 2.2, -0.05, 0.0, C.frame);
    for (const [ya, yb, col] of STRIPES) b.boxMM(-BW, -BW - 0.012, ya, yb, z0, hz, col);
    b.boxMM(-BW - 0.045, -BW, 1.47, 1.53, -0.6, -0.47, C.chrome);
    b.boxMM(-BW + 0.06, -BW + 0.09, 1.47, 1.53, -0.6, -0.47, C.chrome);
  });
  const pivot = new THREE.Group();
  pivot.position.set(hx, 0, hz);
  pivot.add(b.build(RV_MATS));
  pivot.userData.openAngle = 2.6;   // swings right round against the body, clear of the doorway
  return pivot;
}

// Outdoor storage bay hatch: hinged along its top edge, swings up and out
function bayHatch() {
  const b = new GeoBuilder();
  const hy = BAY.y1 + 0.01, zc = (BAY.z0 + BAY.z1) / 2, hw = (BAY.z1 - BAY.z0) / 2 - 0.005;
  b.boxMM(-0.03, 0.004, BAY.y0 + 0.005 - hy, -0.01, -hw, hw, C.body);
  b.boxMM(-0.04, -0.03, BAY.y0 + 0.02 - hy, -0.03, -hw + 0.02, hw - 0.02, C.trim);
  b.boxMM(0.004, 0.012, -0.23, -0.2, -hw + 0.03, hw - 0.03, C.stripe);
  b.boxMM(0.004, 0.03, -0.33, -0.29, -0.07, 0.07, C.chrome);
  b.cyl(0.018, 0.018, 0.02, 8, 0.02, -0.31, 0.12, 0x2a2a2a, 0, 0, Math.PI / 2);
  const pivot = new THREE.Group();
  pivot.position.set(BW, hy, zc);
  pivot.add(b.build(RV_MATS));
  pivot.userData.openAngle = 1.45; pivot.userData.axis = 'z';
  return pivot;
}

/* ---------- mud splatter (canvas textures on thin transparent panels) ---------- */
function mudTexture(Lm, Hm, holes, arches, seed) {
  const PX = 90, W = Math.round(Lm * PX), H = Math.round(Hm * PX);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let sd = seed; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const browns = ['92,70,46', '110,86,58', '78,60,40', '128,104,74'];
  // grimy band along the bottom with a ragged top edge
  for (const [a, top] of [[0.35, 0.75], [0.55, 0.5], [0.75, 0.28]]) {
    g.fillStyle = `rgba(92,70,46,${a})`; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, H * (1 - top * (0.75 + 0.5 * rnd())));
    g.lineTo(W, H); g.closePath(); g.fill();
  }
  // heavy crust around wheel arches (spray from the tyres)
  for (const u of arches) {
    const cx = u * PX;
    for (let i = 0; i < 90; i++) {
      const a = Math.PI + rnd() * Math.PI, r = (0.55 + rnd() * 0.45) * PX;
      g.fillStyle = `rgba(${browns[(rnd() * 4) | 0]},${0.5 + rnd() * 0.45})`;
      g.beginPath(); g.arc(cx + Math.cos(a) * r, H + Math.sin(a) * r * 0.9, 2 + rnd() * 7, 0, 7); g.fill();
    }
  }
  // splatter dots (more near the bottom) + upward spray streaks
  for (let i = 0; i < W * 1.4; i++) {
    const x = rnd() * W, y = H - Math.pow(rnd(), 2.2) * H;
    g.fillStyle = `rgba(${browns[(rnd() * 4) | 0]},${0.35 + rnd() * 0.55})`;
    g.beginPath(); g.arc(x, y, 0.8 + rnd() * 3.2, 0, 7); g.fill();
  }
  g.lineCap = 'round';
  for (let i = 0; i < W * 0.12; i++) {
    const x = rnd() * W, len = 6 + rnd() * 26, y = H - rnd() * H * 0.35;
    g.strokeStyle = `rgba(${browns[(rnd() * 4) | 0]},${0.3 + rnd() * 0.4})`; g.lineWidth = 1 + rnd() * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 10, y - len); g.stroke();
  }
  // keep openings (door, hatch, wheel arches) clean
  g.globalCompositeOperation = 'destination-out';
  for (const h of holes) g.fillRect(h.u0 * PX, H - h.v1 * PX, (h.u1 - h.u0) * PX, (h.v1 - h.v0) * PX);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  return t;
}
function addMud(m) {
  const mat = map => new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, alphaTest: 0.03, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const panel = (group, L, Hh, x, y, z, ry, holes, arches, seed) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(L, Hh), mat(mudTexture(L, Hh, holes, arches, seed)));
    p.position.set(x, y, z); p.rotation.y = ry; p.renderOrder = 2;
    m.groups[group].add(p);
  };
  const y0 = Y.bottom, Hs = 1.05, L = Z.cab - Z.rear, arch = [AXLE_R - 0.6, AXLE_R + 0.6];
  // left side (+X): u runs from the front (cab) to the rear
  const uL = z => Z.cab - z;
  panel('left', L, Hs, BW + 0.014, y0 + Hs / 2, (Z.cab + Z.rear) / 2, Math.PI / 2,
    [{ u0: uL(arch[1]), u1: uL(arch[0]), v0: 0, v1: 0.6 }, { u0: uL(BAY.z1) - 0.02, u1: uL(BAY.z0) + 0.02, v0: BAY.y0 - y0 - 0.02, v1: BAY.y1 - y0 + 0.03 }],
    [uL(AXLE_R)], 11);
  // right side (-X): u runs from the rear to the front
  const uR = z => z - Z.rear;
  panel('right', L, Hs, -(BW + 0.014), y0 + Hs / 2, (Z.cab + Z.rear) / 2, -Math.PI / 2,
    [{ u0: uR(arch[0]), u1: uR(arch[1]), v0: 0, v1: 0.6 }, { u0: uR(-0.67), u1: uR(0.17), v0: 0, v1: 2 }],
    [uR(AXLE_R)], 23);
  // rear
  panel('rear', 2 * BW, 0.85, 0, 0.6 + 0.425, Z.rear - 0.012, Math.PI, [], [], 37);
  // front fenders (around the front wheels)
  const fa = [AXLE_F - 0.6, AXLE_F + 0.6], FL = Z.front - Z.nose, Hf = 0.78;
  panel('base', FL, Hf, CW + 0.014, y0 + Hf / 2, (Z.front + Z.nose) / 2, Math.PI / 2,
    [{ u0: Z.front - fa[1], u1: Z.front - Math.max(fa[0], Z.nose), v0: 0, v1: 0.6 }], [Z.front - AXLE_F], 41);
  panel('base', FL, Hf, -(CW + 0.014), y0 + Hf / 2, (Z.front + Z.nose) / 2, -Math.PI / 2,
    [{ u0: Math.max(fa[0], Z.nose) - Z.nose, u1: fa[1] - Z.nose, v0: 0, v1: 0.6 }], [AXLE_F - Z.nose], 53);
}

/* ---------- wheels ---------- */
function makeWheel(w) {
  const b = new GeoBuilder();
  b.cyl(WHEEL_R, WHEEL_R, w, 12, 0, 0, 0, C.tire, 0, 0, Math.PI / 2);
  b.cyl(WHEEL_R * 0.93, WHEEL_R * 0.93, w + 0.01, 12, 0, 0, 0, 0x2a2a2d, 0, 0, Math.PI / 2);
  b.cyl(0.27, 0.27, w + 0.02, 10, 0, 0, 0, C.hub, 0, 0, Math.PI / 2);
  b.cyl(0.1, 0.12, w + 0.06, 6, 0, 0, 0, 0x6a6e74, 0, 0, Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    for (const s of [1, -1]) b.box(0.02, 0.05, 0.05, s * (w / 2 + 0.02), Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0x55585c);
  }
  return b.build(RV_MATS);
}
