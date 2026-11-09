// The big Dutch windmill on the meadow east of the road (Farm World): a smock mill about 18 m to the cap, the sails
// reaching 26 m. An octagonal two-storey base of cream plaster with timber corner posts on a stone footing — an
// arched door with a fanlight, arched windows below and small windows above, a ladder up the side — then a railed
// gallery (the stage) all round on V-shaped struts; above it a short boarded storey with shuttered windows, and the
// tall tapering smock of weatherboards, its eight corners trimmed in blue-grey, curving out at the bottom like a
// skirt; at the top the curb and a rounded grey cap with ribs, the windshaft and four lattice sails at the front
// (they turn, the same for every player: their angle comes from the shared clock), the tail pole with its struts
// at the back down to the gallery. Windows light up at night.
import * as THREE from 'three';
import { GeoBuilder, MAT } from '../utils.js';
import { limb } from '../flora.js';

export const MILL = { x: -4, z: -124, yaw: -Math.PI / 2 - 0.25 };     // the front (the sails) toward the road and the farm
// the second one, by the goat field across the road from the Farm Store (where the little wooden windmill stood), its
// sails toward the road
const RT = { x: 0.925, z: 0.381 }, RN = { x: -0.381, z: 0.925 }, R0 = { x: -101.82, z: -136.77 };
export const MILL2 = { x: R0.x + RT.x * -35 + RN.x * 22, z: R0.z + RT.z * -35 + RN.z * 22, yaw: 2.7512 };
// the gallery (deck height above the base, corner radius) and the ladder up to it on the side face at angle LADDER.a
// (distances from the middle: its foot on the ground, its top against the deck's edge, where a gap is left in the railing)
const GY = 5.6, GR = 5.4, AP = GR * Math.cos(Math.PI / 8);
const LADDER = { a: -Math.PI / 4, foot: 6.15, top: AP + 0.13, gap: 0.5 };
// a point's distance from the middle measured the octagon's way (the largest of its distances along the 8 face normals)
const octR = (lx, lz) => { let m = 0; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, d = lx * Math.sin(a) + lz * Math.cos(a); if (d > m) m = d; } return m; };
const C = {
  plaster: 0xf0e6d4, plaster2: 0xe6d8c2, stone: 0x8a877f, stoneL: 0x9e9b92, post: 0x7a5236, band: 0x6e4a30,
  board: 0x7a5a3e, boardL: 0x86664a, boardD: 0x6a4c34, trim: 0x8fb5b8, frame: 0x9cc4cf, wood: 0xc9a77a,
  deck: 0x8a6a48, rail: 0xd8c4a0, strut: 0x7a4a32, cap: 0x9a9fa6, capD: 0x7c8188, curb: 0xd8b880, glass: 0x4f6170,
  stock: 0x9fc7cc, lattice: 0xd68b6a, shutter: 0xb5553c, tail: 0xd2a874,
};
const R8 = Math.PI / 8;
// an octagonal frustum (a flat face toward +z), radius = to the corners
const octo = (b, r0, r1, y0, y1, col, open = false) => b.add(new THREE.CylinderGeometry(r1, r0, y1 - y0, 8, 1, open, R8), col, 0, (y0 + y1) / 2, 0);
// run fn on face k (0: the front) of an octagon whose face is `ap` out from the middle at height y (leaning back by lean)
const onFace = (b, k, ap, y, lean, fn) => { const a = k * Math.PI / 4; b.group(Math.sin(a) * ap, y, Math.cos(a) * ap, 0, a, 0, () => b.group(0, 0, 0, -lean, 0, 0, fn)); };
// a window: frame, glass, glazing bars (arched: a round top), a sill
function windowAt(b, w, h, arched, bucket, frame = C.post) {
  b.box(w + 0.14, h + 0.14, 0.08, 0, h / 2, 0.02, frame);
  b.box(w, h, 0.04, 0, h / 2, 0.06, C.glass, bucket);
  if (arched) { b.add(new THREE.CircleGeometry(w / 2 + 0.07, 10, 0, Math.PI), frame, 0, h, 0.061); b.add(new THREE.CircleGeometry(w / 2, 10, 0, Math.PI), C.glass, 0, h, 0.081, 0, 0, 0, bucket); }
  b.box(0.04, h + (arched ? w / 2 : 0), 0.03, 0, (h + (arched ? w / 2 : 0)) / 2, 0.09, frame);
  for (let y = h / 3; y < h; y += h / 3) b.box(w, 0.04, 0.03, 0, y, 0.09, frame);
  b.box(w + 0.26, 0.07, 0.16, 0, -0.04, 0.08, frame);
}

export class DutchMill {
  // P: where it stands ({ x, z, yaw }; the big one by the fields if left out) · opts.clear: the meadow cleared round it (m)
  constructor(scene, world, P = MILL, opts = {}) { this.scene = scene; this.world = world; this.on = false; this.P = P; this.x = P.x; this.z = P.z; this.clear = opts.clear ?? 18; }
  enable() {
    if (this.on) return;
    this.on = true;
    const W = this.world, T = W.T, { x, z, yaw } = this.P;
    // the meadow round it cleared of trees and bushes; no grass blades through the base
    W.clearArea([{ x0: x - this.clear, x1: x + this.clear, z0: z - this.clear, z1: z + this.clear }]);
    W.addGrassBlock((px, pz) => Math.hypot(px - x, pz - z) < 4.6);
    let gy = -Infinity;
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; gy = Math.max(gy, T.heightAt(x + Math.cos(a) * 4.3, z + Math.sin(a) * 4.3)); }
    const b = new GeoBuilder(), bucket = 'win1';
    this.base = gy + 0.05; this.deck = this.base + GY;
    const fl = this._toWorld(Math.sin(LADDER.a) * LADDER.foot, Math.cos(LADDER.a) * LADDER.foot);
    this.footY = T.heightAt(fl.x, fl.z) - this.base;                      // the ground under the ladder's foot (base frame)
    this._tower(b, bucket);
    const mats = { ...MAT, win1: W.dayNight.windowMats[1] };
    const g = b.build(mats);
    g.position.set(x, gy + 0.05, z); g.rotation.y = yaw;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g); this.group = g;
    // the sails: their own mesh, turning on the windshaft
    const sb = new GeoBuilder();
    this._sails(sb);
    const sails = sb.build(MAT);
    sails.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.hub = new THREE.Group();
    this.hub.position.set(0, this.HUB.y, this.HUB.z); this.hub.rotation.x = -this.HUB.tilt;
    this.hub.add(sails); this.sails = sails;
    g.add(this.hub);
    g.updateMatrixWorld(true);
    g.traverse(o => { if (o.isMesh && o.parent === g) W.addFogCull(o); });
    // you bump into the base (on the ground only: up on the gallery you walk round above it)
    W.addCollider({ x, z, r: 4.3, top: this.deck - 1.2 });
    // the gallery's deck is walked on; the railing and the boarded storey keep you on it
    W.surfaces.push({ surfaceAt: (px, pz) => { const l = this._toLocal(px, pz), r = octR(l.x, l.z); return r < AP + 0.06 && r > 2.4 ? this.deck : null; } });
    const prev = W.constrain;
    W.constrain = p => { if (prev) prev(p); this._constrain(p); };
  }
  _toWorld(lx, lz) { const P = this.P, c = Math.cos(P.yaw), s = Math.sin(P.yaw); return { x: P.x + lx * c + lz * s, z: P.z - lx * s + lz * c }; }
  _toLocal(x, z) { const P = this.P, c = Math.cos(P.yaw), s = Math.sin(P.yaw), dx = x - P.x, dz = z - P.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; }
  // a point along the ladder's face, d from the middle, at height y above the base → world
  _ladderPt(d, y) { const w = this._toWorld(Math.sin(LADDER.a) * d, Math.cos(LADDER.a) * d); return new THREE.Vector3(w.x, this.base + y, w.z); }
  // up on the gallery: stay between the boarded storey and the railing
  _constrain(p) {
    if (!this.on || p.y < this.deck - 0.6 || p.y > this.deck + 3) return;
    const l = this._toLocal(p.x, p.z), r = octR(l.x, l.z);
    if (r > AP + 0.8 || r < 1e-3) return;
    const lo = 3.12, hi = AP - 0.4, t = r < lo ? lo : r > hi ? hi : r;
    if (t === r) return;
    const w = this._toWorld(l.x * t / r, l.z * t / r);
    p.x = w.x; p.z = w.z;
  }
  // E: climb the ladder up to the gallery (at its foot), or back down (at the gap in the railing)
  acts(player) {
    if (!this.on) return [];
    if (!this._acts) {
      const foot = this._ladderPt(LADDER.foot + 0.45, this.footY), gap = this._ladderPt(AP - 0.55, GY);
      this._acts = [
        { pos: foot, r: 1.5, label: () => "Climb up to the windmill's gallery", act: () => this._climb(player, true) },
        { pos: gap, r: 1.3, label: () => 'Climb down the ladder', act: () => this._climb(player, false) },
      ];
    }
    return this._acts;
  }
  _climb(p, up) {
    const f = LADDER, along = y => f.foot + (f.top - f.foot) * (y - this.footY) / (GY + 1.05 - this.footY);   // the ladder's distance out at height y
    const foot = this._ladderPt(f.foot + 0.45, this.footY), high = this._ladderPt(along(GY - 0.9) + 0.32, GY - 0.9), gap = this._ladderPt(AP - 0.15, GY), on = this._ladderPt(AP - 0.7, GY);
    const face = this.P.yaw + f.a + Math.PI, out = face + Math.PI, climbT = Math.max(1.6, (GY - this.footY) / 2.2);
    const end = yaw => { p.mode = 'foot'; p.grounded = true; p.vy = 0; p.yaw = yaw; };
    if (up) p.startTween([foot], { dur: 0.4, yaw: face, done: () => p.startTween([high], { dur: climbT, anim: 'climb', yaw: face, done: () => p.startTween([gap, on], { dur: 0.6, yaw: face, done: () => end(out) }) }) });
    else p.startTween([gap, high], { dur: 0.7, yaw: face, done: () => p.startTween([foot], { dur: climbT, anim: 'climb', yaw: face, done: () => end(out) }) });
  }
  // every frame: the sails turn (counter-clockwise seen from the front, about 5 turns a minute)
  update(ms) { if (this.sails) this.sails.rotation.z = (ms / 1000 * 0.55) % (Math.PI * 2); }

  _tower(b, bucket) {
    // stone footing, lower storey, the band, upper storey
    octo(b, 4.35, 4.3, -2.5, 0.35, C.stone);
    octo(b, 4.4, 4.4, 0.25, 0.4, C.stoneL);
    octo(b, 4.1, 3.85, 0.4, 3.0, C.plaster);
    octo(b, 4.0, 4.0, 2.95, 3.15, C.band);
    octo(b, 3.85, 3.5, 3.15, 5.55, C.plaster2);
    // timber corner posts on both storeys
    for (let k = 0; k < 8; k++) {
      const a = R8 + k * Math.PI / 4, cs = [Math.sin(a), Math.cos(a)];
      limb(b, [cs[0] * 4.12, 0.4, cs[1] * 4.12], [cs[0] * 3.87, 3.0, cs[1] * 3.87], 0.09, 0.09, C.post, 4);
      limb(b, [cs[0] * 3.87, 3.15, cs[1] * 3.87], [cs[0] * 3.52, 5.55, cs[1] * 3.52], 0.08, 0.08, C.post, 4);
    }
    const ap1 = 3.97 * Math.cos(R8) + 0.01, ap2 = 3.68 * Math.cos(R8) + 0.01, lean1 = Math.atan(0.25 / 2.6), lean2 = Math.atan(0.35 / 2.4);
    // the front door: arched, a fanlight with radial bars, light blue frame, double doors, a step
    onFace(b, 0, ap1, 0.4, lean1, () => {
      b.box(1.5, 2.25, 0.1, 0, 1.12, 0.02, C.frame);
      b.box(1.25, 2.1, 0.05, 0, 1.05, 0.07, C.wood);
      b.box(0.04, 2.1, 0.03, 0, 1.05, 0.1, 0x8a6a48);
      b.add(new THREE.CircleGeometry(0.75, 12, 0, Math.PI), C.frame, 0, 2.2, 0.03);
      b.add(new THREE.CircleGeometry(0.62, 12, 0, Math.PI), C.glass, 0, 2.2, 0.075, 0, 0, 0, bucket);
      for (let i = 1; i < 4; i++) { const a = Math.PI * i / 4; b.box(0.035, 0.62, 0.03, Math.cos(a) * 0.31, 2.2 + Math.sin(a) * 0.31, 0.1, C.frame, 'solid', 0, 0, a - Math.PI / 2); }
      b.box(0.06, 0.06, 0.06, 0.4, 1.05, 0.12, 0x3a3a3e);
    });
    b.box(1.8, 0.12, 0.7, 0, 0.3, ap1 + 0.32, C.stoneL);
    // arched windows below, small windows above
    for (const k of [2, -2, 3, -3]) onFace(b, k, ap1, 1.0, lean1, () => windowAt(b, 0.85, 1.15, true, bucket));
    for (const k of [0, 1, -1, 4]) onFace(b, k, ap2, 3.95, lean2, () => windowAt(b, 0.6, 0.75, false, bucket));
    for (const k of [1, -1]) onFace(b, k, ap1, 2.35, lean1, () => b.box(0.5, 0.3, 0.04, 0, 0, 0.03, 0xe8e2d6));   // little plaques
    // the ladder up to the gallery: from the ground out on the side face to the deck's edge, its rails above the deck as handholds
    b.group(0, 0, 0, 0, LADDER.a, 0, () => {
      const y0 = this.footY - 0.3, y1 = GY + 1.05, zAt = y => LADDER.foot + (LADDER.top - LADDER.foot) * (y - this.footY) / (y1 - this.footY);
      for (const sx of [-1, 1]) limb(b, [sx * 0.3, y0, zAt(y0)], [sx * 0.3, y1, zAt(y1)], 0.04, 0.035, C.wood, 4);
      for (let y = this.footY + 0.3; y < GY + 0.9; y += 0.3) b.box(0.6, 0.045, 0.06, 0, y, zAt(y), C.wood);
      for (const sx of [-1, 1]) b.box(0.08, 0.1, 0.24, sx * 0.3, GY - 0.05, LADDER.top - 0.08, C.post);             // hooks over the deck's edge
    });
    // the gallery: a deck all round, its edge, a railing with crosses (a gap where the ladder comes up), V struts underneath
    octo(b, GR, GR, GY - 0.18, GY, C.deck);
    octo(b, GR + 0.05, GR + 0.05, GY - 0.32, GY - 0.16, C.trim, true);
    for (let k = 0; k < 8; k++) {
      const a0 = R8 + k * Math.PI / 4, a1 = a0 + Math.PI / 4, p0 = [Math.sin(a0) * GR, Math.cos(a0) * GR], p1 = [Math.sin(a1) * GR, Math.cos(a1) * GR];
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      const ladderSide = Math.abs(Math.atan2(Math.sin(a0 + Math.PI / 8 - LADDER.a), Math.cos(a0 + Math.PI / 8 - LADDER.a))) < 0.01;
      // (the side with the ladder: two runs either side of the gap, a post at each side of it)
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), k0 = 0.5 - LADDER.gap / L, k1 = 0.5 + LADDER.gap / L, lerp = k => [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k];
      const runs = ladderSide ? [[p0, lerp(k0)], [lerp(k1), p1]] : [[p0, mid], [mid, p1]];
      for (const p of ladderSide ? [p0, lerp(k0), lerp(k1)] : [p0, mid]) b.box(0.12, 1.15, 0.12, p[0], GY + 0.57, p[1], C.rail);
      for (const [a, c] of runs) {
        for (const y of [0.14, 1.08]) limb(b, [a[0], GY + y, a[1]], [c[0], GY + y, c[1]], 0.035, 0.035, C.rail, 4);
        limb(b, [a[0], GY + 0.16, a[1]], [c[0], GY + 1.06, c[1]], 0.025, 0.025, C.rail, 3); limb(b, [a[0], GY + 1.06, a[1]], [c[0], GY + 0.16, c[1]], 0.025, 0.025, C.rail, 3);
      }
      // two struts from below each corner of the base out to the deck's edge (a V)
      const ac = R8 + k * Math.PI / 4, foot = [Math.sin(ac) * 3.82, 3.35, Math.cos(ac) * 3.82];
      for (const s of [-1, 1]) { const at = ac + s * 0.2; limb(b, foot, [Math.sin(at) * (GR - 0.3), GY - 0.3, Math.cos(at) * (GR - 0.3)], 0.07, 0.07, C.strut, 4); }
    }
    // the boarded storey above the gallery, shuttered windows, a door out onto the gallery
    octo(b, 3.05, 3.0, GY, GY + 1.8, C.board);
    for (let y = GY + 0.3; y < GY + 1.8; y += 0.3) octo(b, 3.06, 3.05, y - 0.02, y + 0.02, C.boardD, true);
    const ap3 = 3.0 * Math.cos(R8) + 0.02;
    for (const k of [1, -2]) onFace(b, k, ap3, GY + 0.65, 0, () => { windowAt(b, 0.5, 0.6, false, bucket, C.post); for (const s of [-1, 1]) b.box(0.3, 0.68, 0.05, s * 0.45, 0.3, 0.05, C.shutter); });
    onFace(b, 4, ap3, GY, 0, () => { b.box(0.8, 1.6, 0.06, 0, 0.8, 0.03, C.boardL); b.box(0.92, 1.68, 0.04, 0, 0.84, 0.01, C.post); });
    // the smock: weatherboard rings tapering with a curve, flared at the bottom; corner trims; small windows
    const Y0 = GY + 1.8, Y1 = 16.2, rAt = t => 1.95 + 1.35 * Math.pow(1 - t, 2.1);
    const n = 18;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      octo(b, rAt(t0) + 0.04, rAt(t1), Y0 + (Y1 - Y0) * t0, Y0 + (Y1 - Y0) * t1 + 0.01, i % 2 ? C.board : C.boardL, true);
    }
    octo(b, rAt(1), rAt(1), Y1, Y1 + 0.02, C.boardD);
    for (let k = 0; k < 8; k++) {
      const a = R8 + k * Math.PI / 4;
      for (let i = 0; i < 6; i++) {
        const t0 = i / 6, t1 = (i + 1) / 6, r0 = rAt(t0) + 0.07, r1 = rAt(t1) + 0.05;
        limb(b, [Math.sin(a) * r0, Y0 + (Y1 - Y0) * t0, Math.cos(a) * r0], [Math.sin(a) * r1, Y0 + (Y1 - Y0) * t1, Math.cos(a) * r1], 0.07, 0.065, C.trim, 4);
      }
    }
    for (const [k, t] of [[1, 0.32], [-2, 0.55], [3, 0.4]]) {
      const r = rAt(t), y = Y0 + (Y1 - Y0) * t, slope = (rAt(t - 0.05) - rAt(t + 0.05)) / ((Y1 - Y0) * 0.1);
      onFace(b, k, r * Math.cos(R8) + 0.02, y, Math.atan(slope), () => windowAt(b, 0.45, 0.55, false, bucket, C.post));
    }
    // the curb and the cap: a rounded hood, longer front to back, with ribs; a little window at the back
    octo(b, 2.15, 2.15, Y1 + 0.02, Y1 + 0.22, C.curb);
    b.add(new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), C.cap, 0, Y1 + 0.2, -0.15, 0, 0, 0, 'solid', 2.05, 1.85, 2.6);
    for (let i = 0; i < 7; i++) {                                                                       // ribs over the top, front to back
      const xr = -1.7 + i * 0.57, pts = [];
      for (let j = 0; j <= 8; j++) { const a = j / 8 * Math.PI, ex = Math.sqrt(Math.max(0, 1 - (xr / 2.05) ** 2)); pts.push([xr, Y1 + 0.22 + Math.sin(a) * 1.86 * ex, -0.15 + Math.cos(a) * 2.62 * ex]); }
      for (let j = 0; j < 8; j++) limb(b, pts[j], pts[j + 1], 0.035, 0.035, C.capD, 3);
    }
    b.box(0.5, 0.45, 0.1, 0, Y1 + 0.75, -2.62, C.post); b.box(0.36, 0.32, 0.05, 0, Y1 + 0.75, -2.66, C.glass, bucket);
    // the windshaft out of the front of the cap, tipped up a little
    const tilt = 0.14, hubY = Y1 + 0.85, hubZ = 3.0;
    limb(b, [0, hubY - Math.tan(tilt) * 2.2, 0.8], [0, hubY, hubZ - 0.2], 0.2, 0.18, C.boardD, 8);
    this.HUB = { y: hubY, z: hubZ, tilt };
    // the tail pole at the back, braced from the cap, down to the gallery, with a little winch wheel
    const tailEnd = [0, GY + 0.55, -(GR + 0.55)];
    limb(b, [0, Y1 + 0.5, -2.3], tailEnd, 0.12, 0.1, C.tail, 6);
    for (const s of [-1, 1]) limb(b, [s * 1.6, Y1 + 0.25, -1.5], [0, (Y1 + GY) / 2 + 1.5, -(GR * 0.72)], 0.07, 0.06, C.tail, 5);
    b.box(3.4, 0.14, 0.14, 0, Y1 + 0.22, -1.6, C.tail);
    b.add(new THREE.TorusGeometry(0.4, 0.05, 4, 10), C.post, 0.3, tailEnd[1] + 0.1, tailEnd[2] + 0.1, 0, Math.PI / 2, 0);
  }
  // four sails in the hub's plane (x, y), turning about z: two stocks crossing, each arm a lattice on one side and a
  // narrow board on the other; two lattices orange-red, two blue-grey
  _sails(b) {
    const L = 9.3;
    b.box(0.26, L * 2, 0.22, 0, 0, 0.12, C.stock);
    b.box(L * 2, 0.26, 0.22, 0, 0, -0.12, C.stock);
    b.box(0.6, 0.6, 0.6, 0, 0, 0, C.boardD);
    for (let k = 0; k < 4; k++) b.group(0, 0, 0, 0, 0, k * Math.PI / 2, () => {
      const col = k % 2 ? C.lattice : C.stock, z = k % 2 ? -0.12 : 0.12;
      b.box(0.07, L - 1.8, 0.06, 2.0, (L + 1.8) / 2, z, col);
      b.box(0.05, L - 1.8, 0.05, 1.05, (L + 1.8) / 2, z, col);
      for (let y = 1.8; y <= L + 0.01; y += 0.46) b.box(2.05, 0.05, 0.05, 1.03, y, z, col);
      b.box(0.32, L - 2.2, 0.03, -0.32, (L + 2.2) / 2, z, C.stock);
    });
  }
}
