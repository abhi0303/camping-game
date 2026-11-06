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
  constructor(scene, world) { this.scene = scene; this.world = world; this.on = false; this.x = MILL.x; this.z = MILL.z; }
  enable() {
    if (this.on) return;
    this.on = true;
    const W = this.world, T = W.T, { x, z, yaw } = MILL;
    // the meadow round it cleared of trees and bushes; no grass blades through the base
    W.clearArea([{ x0: x - 18, x1: x + 18, z0: z - 18, z1: z + 18 }]);
    W.addGrassBlock((px, pz) => Math.hypot(px - x, pz - z) < 4.6);
    let gy = -Infinity;
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; gy = Math.max(gy, T.heightAt(x + Math.cos(a) * 4.3, z + Math.sin(a) * 4.3)); }
    const b = new GeoBuilder(), bucket = 'win1';
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
    // you bump into the base
    W.addCollider({ x, z, r: 4.3 });
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
    // a ladder up a side face to the gallery
    onFace(b, -1, ap1 + 0.35, 0, 0, () => {
      for (const s of [-1, 1]) limb(b, [s * 0.28, 0, 0.55], [s * 0.28, 5.2, -0.02], 0.035, 0.035, C.wood, 4);
      for (let y = 0.3; y < 5.1; y += 0.32) b.box(0.56, 0.04, 0.05, 0, y, 0.55 - y / 5.2 * 0.57, C.wood);
    });
    // the gallery: a deck all round, its edge, a railing with crosses, V struts underneath
    const GY = 5.6, GR = 5.4;
    octo(b, GR, GR, GY - 0.18, GY, C.deck);
    octo(b, GR + 0.05, GR + 0.05, GY - 0.32, GY - 0.16, C.trim, true);
    for (let k = 0; k < 8; k++) {
      const a0 = R8 + k * Math.PI / 4, a1 = a0 + Math.PI / 4, p0 = [Math.sin(a0) * GR, Math.cos(a0) * GR], p1 = [Math.sin(a1) * GR, Math.cos(a1) * GR];
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      for (const p of [p0, mid]) b.box(0.12, 1.15, 0.12, p[0], GY + 0.57, p[1], C.rail);
      for (const y of [0.14, 1.08]) limb(b, [p0[0], GY + y, p0[1]], [p1[0], GY + y, p1[1]], 0.035, 0.035, C.rail, 4);
      for (const [a, c] of [[p0, mid], [mid, p1]]) { limb(b, [a[0], GY + 0.16, a[1]], [c[0], GY + 1.06, c[1]], 0.025, 0.025, C.rail, 3); limb(b, [a[0], GY + 1.06, a[1]], [c[0], GY + 0.16, c[1]], 0.025, 0.025, C.rail, 3); }
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
