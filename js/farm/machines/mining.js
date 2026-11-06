// The gold mine in the world (south of the windmill): the site, the machine at its level, the cart going in and out of
// the tunnel, ore riding the conveyor, the coins in the box — and while it runs (7 PM – 4 AM India time, from the farm
// server's clock: the same on every screen) the stones and pulleys turn, it shakes a little, sparks fly from the
// grinding ring, smoke puffs from its exhaust and the beacon flashes. At 4 AM it all stops.
import * as THREE from 'three';
import { mineSiteModel, mineMachineModel, mineCartModel, MINE_SITE } from './machineModels.js';

export const MINE_POS = { x: -2, z: -163, yaw: -0.64 };            // where the player stood on the map: front toward the windmill and the farm
const local = (P, lx, lz) => { const c = Math.cos(P.yaw), s = Math.sin(P.yaw); return { x: P.x + lx * c + lz * s, z: P.z - lx * s + lz * c }; };

export class MineSite {
  constructor(scene, world, fx) { this.scene = scene; this.world = world; this.fx = fx; this.level = 0; this.t = 0; this.run = 0; }
  build() {
    const W = this.world, T = W.T, P = MINE_POS;
    W.clearArea([{ x0: P.x - 11, x1: P.x + 11, z0: P.z - 11, z1: P.z + 11 }]);
    W.addGrassBlock((x, z) => Math.hypot(x - P.x, z - P.z) < 9);
    // stand the site on the ground (the highest point of its platform), facing its way
    let gy = -Infinity;
    for (const [a, c] of [[-2.2, -1.8], [2.2, -1.8], [2.2, 1.8], [-2.2, 1.8], [0, 0]]) { const q = local(P, a, c); gy = Math.max(gy, T.heightAt(q.x, q.z)); }
    const g = this.group = new THREE.Group();
    g.position.set(P.x, gy, P.z); g.rotation.y = P.yaw;
    g.add(mineSiteModel());
    this.cart = mineCartModel(); g.add(this.cart);
    this.scene.add(g);
    g.updateMatrixWorld(true);
    for (const o of g.children) o.traverse(m => { if (m.isMesh) W.addFogCull(m); });
    // ore on the conveyor, coins in the box
    const nug = new THREE.DodecahedronGeometry(0.1, 0), gold = new THREE.MeshLambertMaterial({ color: 0xf2c14e, emissive: 0x8a5a00, emissiveIntensity: 0.35, flatShading: true });
    this.ore = new THREE.InstancedMesh(nug, gold, 6); this.ore.frustumCulled = false; g.add(this.ore);
    this.coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 10), gold, 30); this.coins.count = 0; this.coins.frustumCulled = false; g.add(this.coins);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._e = new THREE.Euler();
    // you bump into the rocks, the machine, the props
    const col = (lx, lz, r) => { const q = local(P, lx, lz); W.addCollider({ x: q.x, z: q.z, r }); };
    for (const [x, z, r] of [[-4.6, -7.2, 2.4], [-1.2, -7.8, 2.4], [2.4, -7.4, 2.3], [5, -6.7, 1.7], [-6.6, -5.8, 1.4], [-0.6, -6.1, 1.3], [1.3, -5.9, 1.1], [-4.6, -5.0, 0.8], [-1.3, -5.0, 0.8]]) col(x, z, r);
    for (const [x, z, r] of [[-0.6, -0.4, 1.0], [0.6, -0.4, 1.0], [-0.6, 0.4, 1.0], [0.6, 0.4, 1.0], [-1.45, 0.45, 0.35], [3.3, -1.4, 0.6], [4.1, -0.9, 0.4], [3.6, 1.6, 0.6], [3.9, 2.3, 0.4], [-1.65, -0.1, 0.45]]) col(x, z, r);
    col(MINE_SITE.chest[0], MINE_SITE.chest[2], 0.5); col(-4.6, -2.4, 0.3);
    this.centre = local(P, 0, 1.0); this.chestW = local(P, MINE_SITE.chest[0], MINE_SITE.chest[2] + 0.5);
  }
  // the machine at this level (rebuilt when it's upgraded)
  setLevel(level) {
    if (level === this.level) return;
    if (this.machine) { this.group.remove(this.machine.group); this.machine.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    this.level = level;
    this.machine = mineMachineModel(level);
    this.machine.group.position.y = 0.16;
    this.group.add(this.machine.group);
  }
  // every frame: m = the mine now (economy.mineNow()), near = how close the player is (m)
  update(dt, m) {
    if (!this.group) return;
    this.t += dt;
    if (m) { this.setLevel(m.level); this._coins(m.ready); }
    const running = !!(m && m.running);
    this.run += ((running ? 1 : 0) - this.run) * Math.min(1, dt * 1.5);   // (spins up at 7 PM, winds down at 4 AM)
    const M = this.machine, k = this.run, sp = M ? M.speed : 1;
    if (M) {
      for (const s of M.spin) s.o.rotation[s.axis] += dt * s.speed * sp * k * 2.2;
      M.group.position.x = running ? Math.sin(this.t * 63) * 0.008 * k : 0; M.group.position.z = running ? Math.cos(this.t * 51) * 0.006 * k : 0;
      M.beacon.emissiveIntensity = running ? 0.6 + 0.6 * Math.max(0, Math.sin(this.t * 6)) : 0;
      M.screen.color.setHex(running ? 0x5cff6a : 0x1a3a1a);
      if (running && this.fx) {
        const S = M.sparksAt, a = this.t * 9;
        this.fx.emit(this.group, [S[0] + Math.sin(a) * M.ringR, S[1] + 0.16, S[2] + Math.cos(a) * M.ringR], 'spark', 16 * dt * sp);
        this.fx.emit(this.group, M.smokeAt.map((v, i) => v + (i === 1 ? 0.16 : 0)), 'smoke', 2.2 * dt * sp);
      }
    }
    this._cart(running);
    this._ore(running);
  }
  // the cart: in the tunnel, out along the rails to the conveyor, a stop, back in (24 s) — parked at the end by day
  _cart(running) {
    const S = MINE_SITE, z0 = S.tunnel.z - 1.6, z1 = S.railEnd - 0.55;
    let z = z1;
    if (running) {
      const u = (this.t * this.machine.speed * 0.6) % 24;
      z = u < 4 ? z0 : u < 10 ? z0 + (z1 - z0) * smooth((u - 4) / 6) : u < 14 ? z1 : u < 20 ? z1 + (z0 - z1) * smooth((u - 14) / 6) : z0;
    }
    this.cart.position.set(S.railX, 0.13, z);
  }
  _ore(running) {
    const [fx, fy, fz] = MINE_SITE.conveyorFoot, top = [-0.75, 3.05, 0], m = this._m;
    for (let i = 0; i < 6; i++) {
      const u = running ? ((this.t * 0.18 * this.machine.speed + i / 6) % 1) : i / 6;
      this._v.set(fx + (top[0] - fx) * u, fy + 0.18 + (top[1] - fy) * u, fz + (top[2] - fz) * u);
      this._e.set(u * 7, i, 0);
      m.compose(this._v, this._q.setFromEuler(this._e), this._s.setScalar(running ? 1 : 0.0001));
      this.ore.setMatrixAt(i, m);
    }
    this.ore.instanceMatrix.needsUpdate = true;
  }
  // the coins waiting in the box (a few visible, a heap when there are many)
  _coins(n) {
    const show = Math.min(30, n);
    if (show === this.coins.count) return;
    const [cx, , cz] = MINE_SITE.chest, m = this._m;
    for (let i = 0; i < show; i++) {
      const layer = Math.floor(i / 10), j = i % 10, x = ((j % 5) - 2) * 0.13 + (layer % 2) * 0.06, z = (Math.floor(j / 5) - 0.5) * 0.17;
      this._v.set(cx + x, 0.16 + 0.44 + layer * 0.022, cz + z); this._e.set(0, i * 0.7, (i % 3 - 1) * 0.08);
      m.compose(this._v, this._q.setFromEuler(this._e), this._s.setScalar(1));
      this.coins.setMatrixAt(i, m);
    }
    this.coins.count = show; this.coins.instanceMatrix.needsUpdate = true;
  }
}
const smooth = k => k * k * (3 - 2 * k);
