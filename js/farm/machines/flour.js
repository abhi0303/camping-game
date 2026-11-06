// The flour mill in the world (across the road from the Farm Store): the platform and lean-to, wheat and flour sacks,
// and the machine at its level (or just the empty corner with a FOR SALE board before it's bought). Level 1 turns only
// while a player turns its handle; from level 2 it grinds by itself whenever there's wheat in its hopper (worked out
// from the farm server's numbers and clock, so every screen sees the same). Flour dust comes out of the chute; full
// sacks appear on the pallet as packets wait in the tray.
import * as THREE from 'three';
import { MAT } from '../../utils.js';
import { flourSiteModel, flourMachineModel, flourSackGeometry, FLOUR_SITE, signTexture } from './machineModels.js';
import { STORE } from '../layout.js';

// where the player stood across the road from the Farm Store, facing it
const RT = { x: 0.925, z: 0.381 }, RN = { x: -0.381, z: 0.925 }, R0 = { x: -101.82, z: -136.77 };
export const FLOUR_POS = { x: R0.x + RT.x * 4 + RN.x * -14, z: R0.z + RT.z * 4 + RN.z * -14, yaw: Math.atan2(RN.x, RN.z) };
const local = (P, lx, lz) => { const c = Math.cos(P.yaw), s = Math.sin(P.yaw); return { x: P.x + lx * c + lz * s, z: P.z - lx * s + lz * c }; };

export class FlourMill {
  constructor(scene, world, fx) { this.scene = scene; this.world = world; this.fx = fx; this.level = -1; this.t = 0; this.turning = false; }
  build() {
    const W = this.world, T = W.T, P = FLOUR_POS;
    W.clearArea([{ x0: P.x - 6, x1: P.x + 6, z0: P.z - 6, z1: P.z + 6 }]);
    W.addGrassBlock((x, z) => { const c = Math.cos(P.yaw), s = Math.sin(P.yaw), dx = x - P.x, dz = z - P.z; return Math.abs(dx * c - dz * s) < 3.4 && Math.abs(dx * s + dz * c) < 2.7; });
    let gy = -Infinity;
    for (const [a, c] of [[-3, -2.1], [3, -2.1], [3, 2.1], [-3, 2.1], [0, 0]]) { const q = local(P, a, c); gy = Math.max(gy, T.heightAt(q.x, q.z)); }
    const g = this.group = new THREE.Group();
    g.position.set(P.x, gy, P.z); g.rotation.y = P.yaw;
    g.add(flourSiteModel());
    this.scene.add(g);
    g.updateMatrixWorld(true);
    for (const o of g.children) o.traverse(m => { if (m.isMesh) W.addFogCull(m); });
    // flour sacks on the pallet (as many as the tray holds, a dozen at most)
    this.sacks = new THREE.InstancedMesh(flourSackGeometry(), MAT.solid, 12); this.sacks.count = 0; this.sacks.frustumCulled = false; g.add(this.sacks);
    // before it's bought: a board in the empty corner
    this.sale = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.75), new THREE.MeshLambertMaterial({ map: signTexture([['FLOUR MACHINE', 54], ['10 gold coins', 40]], { w: 512, h: 300, bg: '#3e2716', fg: '#f2d27a' }), emissive: 0xffffff, emissiveIntensity: 0.1 }));
    this.sale.material.emissiveMap = this.sale.material.map;
    this.sale.position.set(0, 1.2, 0.3); g.add(this.sale);
    this.salePost = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), MAT.solid); this.salePost.position.set(0, 0.6, 0.25); g.add(this.salePost);
    this.salePost.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(this.salePost.geometry.attributes.position.count * 3).fill(0.42), 3));
    const col = (lx, lz, r) => { const q = local(P, lx, lz); W.addCollider({ x: q.x, z: q.z, r }); };
    for (const x of [-2.9, -1.5, 0, 1.5, 2.9]) col(x, -2.05, 0.45);
    for (const [x, z] of [[-2.9, 1.9], [2.9, 1.9]]) col(x, z, 0.2);
    col(-2.3, -0.6, 0.6); col(-2.25, 1.15, 0.4); col(2.15, 0.4, 0.6); col(0, 0, 0.75);
    this.handleW = () => { const h = FLOUR_SITE.handle; return { ...local(P, h[0], h[2]), y: gy + 0.15 }; };
    this.centre = local(P, 0, 1.2); this.base = gy; this.P = P;
  }
  // the machine at this level (0: not bought yet)
  setLevel(level) {
    if (level === this.level) return;
    if (this.machine) { this.group.remove(this.machine.group); this.machine.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.machine = null; }
    this.level = level;
    this.sale.visible = this.salePost.visible = !level;
    if (!level) return;
    this.machine = flourMachineModel(level);
    this.machine.group.position.y = 0.15 - 0.15;
    this.group.add(this.machine.group);
  }
  // every frame: f = the machine now (economy.flourNow(), null before it's bought)
  update(dt, f) {
    if (!this.group) return;
    this.t += dt;
    this.setLevel(f ? f.level : 0);
    const M = this.machine;
    if (!M) { this.sacks.count = 0; return; }
    const busy = this.turning || (f && f.grinding);
    for (const s of M.spin) s.o.rotation[s.axis] += dt * s.speed * (busy ? 1 : 0) * (this.turning ? 1.4 : 1);
    if (busy && this.fx) this.fx.emit(this.group, M.chuteAt, 'flour', 14 * dt);
    this._sacks(f ? Math.ceil(f.ready / 10) : 0);
  }
  _sacks(n) {
    n = Math.min(12, n);
    if (n === this.sacks.count) return;
    const [px, py, pz] = FLOUR_SITE.sacks, m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / 6), j = i % 6;
      v.set(px - 0.38 + (j % 3) * 0.38, py + 0.15 + layer * 0.5, pz - 0.2 + Math.floor(j / 3) * 0.4);
      m.compose(v, q.setFromAxisAngle(up, i * 1.3), s); this.sacks.setMatrixAt(i, m);
    }
    this.sacks.count = n; this.sacks.instanceMatrix.needsUpdate = true;
  }
}
export { STORE };
