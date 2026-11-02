import * as THREE from 'three';
import { GeoBuilder, clamp, dampAngle, lerp } from './utils.js';
import { tbox } from './character.js';
import { GIANT } from './terrain.js';
import { audio } from './audio.js';

// The last stand: stone-throwing giants at the Giant Plateau. Ten of them in total (2 first, then one more
// every half minute). Drawn with instanced meshes like the zombies. The host runs them; guests follow.
export const GMAX = 10, GTOTAL = 10;
export const GS = { walk: 0, throw: 1, punch: 2, hit: 3, dead: 4, idle: 5 };
const SC = 4.6, RAD = 1.8, HIT_R = 1.55, HIT_H = 8.4;
const GRAV = -12;
const K = { skin: 0xe2ab7e, skinDk: 0xc48d62, beard: 0x5a3a24, hair: 0x40281a, cloth: 0x6e4a2e, clothDk: 0x553822, belt: 0x3e2a1a, band: 0x4a3426, gold: 0xc9a24a, eye: 0x1a1210 };
const PARTS = {
  torso: b => {
    b.add(tbox(0.36, 0.24, 0.38, 0.26, 0.24), K.cloth, 0, 0, 0);
    b.box(0.4, 0.07, 0.27, 0, 0.1, 0, K.belt); b.box(0.08, 0.06, 0.02, 0, 0.1, 0.14, K.gold);
    for (const s of [1, -1]) b.box(0.16, 0.3, 0.05, s * 0.09, -0.24, 0.11, K.clothDk, 'solid', 0.05, 0, s * 0.05);   // loincloth flaps
    b.add(tbox(0.5, 0.28, 0.38, 0.24, 0.48), K.skin, 0, 0.36, 0);
    for (const s of [1, -1]) b.box(0.19, 0.13, 0.04, s * 0.1, 0.46, 0.14, K.skinDk);                            // chest
    for (let k = 0; k < 3; k++) b.box(0.16, 0.05, 0.03, 0, 0.18 + k * 0.08, 0.125, K.skinDk);                   // belly
    b.box(0.6, 0.14, 0.3, 0, 0.6, 0, K.skin);                                                                     // shoulders
    b.cyl(0.09, 0.1, 0.08, 6, 0, 0.67, 0, K.skin);
  },
  head: b => {
    b.add(tbox(0.22, 0.23, 0.24, 0.24, 0.27), K.skin, 0, 0.13, 0);
    b.box(0.25, 0.07, 0.26, 0, 0.27, -0.01, K.hair);
    b.box(0.25, 0.14, 0.06, 0, 0.18, -0.12, K.hair);
    b.box(0.24, 0.17, 0.08, 0, 0.0, 0.1, K.beard);
    b.box(0.2, 0.1, 0.06, 0, -0.1, 0.09, K.beard);
    b.box(0.22, 0.03, 0.04, 0, 0.19, 0.12, K.beard);              // brow
    for (const s of [1, -1]) b.box(0.04, 0.025, 0.02, s * 0.055, 0.165, 0.125, K.eye);
    b.box(0.04, 0.06, 0.05, 0, 0.11, 0.135, K.skinDk);
  },
  arm: b => {
    b.add(tbox(0.17, 0.17, 0.14, 0.14, 0.3), K.skin, 0, -0.14, 0);
    b.add(tbox(0.14, 0.14, 0.12, 0.12, 0.3), K.skin, 0, -0.42, 0);
    b.box(0.15, 0.08, 0.15, 0, -0.52, 0, K.band);
    b.box(0.15, 0.15, 0.15, 0, -0.64, 0.01, K.skinDk);                // fist
  },
  leg: b => {
    b.add(tbox(0.2, 0.21, 0.16, 0.17, 0.48), K.skin, 0, -0.24, 0);
    b.add(tbox(0.15, 0.16, 0.13, 0.14, 0.36), K.skin, 0, -0.64, 0);
    b.box(0.16, 0.06, 0.16, 0, -0.5, 0, K.band);
    b.box(0.16, 0.09, 0.3, 0, -0.875, 0.05, K.skinDk);
  },
};
const geoOf = fn => { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; };
const E1 = new THREE.Euler(0, 0, 0, 'YXZ'), E2 = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SV = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
const MR = new THREE.Matrix4(), MT = new THREE.Matrix4(), MX = new THREE.Matrix4(), ML = new THREE.Matrix4();
function child(out, parent, x, y, z, rx, ry, rz) { E2.set(rx, ry, rz); Q.setFromEuler(E2); ML.compose(V.set(x, y, z), Q, ONE); return out.multiplyMatrices(parent, ML); }
const _c = new THREE.Color(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Giants {
  constructor(scene, world) {
    this.world = world; this.scene = scene;
    this.list = []; this.byId = new Map(); this.seq = 0; this.spawned = 0; this.killed = 0;
    this.boulders = []; this.bseq = 0; this.puffs = [];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const geo = { torso: geoOf(PARTS.torso), head: geoOf(PARTS.head), arm: geoOf(PARTS.arm), leg: geoOf(PARTS.leg) };
    const make = g => {
      const m = new THREE.InstancedMesh(g, mat, GMAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.castShadow = true;
      for (let i = 0; i < GMAX; i++) m.setColorAt(i, _c.setRGB(1, 1, 1));
      scene.add(m); return m;
    };
    this.m = { torso: make(geo.torso), head: make(geo.head), armL: make(geo.arm), armR: make(geo.arm), legL: make(geo.leg), legR: make(geo.leg) };
    // boulders (held + flying) and dust puffs
    const bg = new THREE.DodecahedronGeometry(0.85, 0), bm = new THREE.MeshLambertMaterial({ color: 0x7d746a, flatShading: true });
    this.rockPool = Array.from({ length: 16 }, () => { const r = new THREE.Mesh(bg, bm); r.visible = false; r.castShadow = true; scene.add(r); return r; });
    const pg = new THREE.IcosahedronGeometry(1, 0), pm = new THREE.MeshLambertMaterial({ color: 0xb4a07c, transparent: true, opacity: 0.6, depthWrite: false, flatShading: true });
    this.puffPool = Array.from({ length: 10 }, () => { const p = new THREE.Mesh(pg, pm.clone()); p.visible = false; scene.add(p); return { m: p, t: 1 }; });
  }
  get alive() { let n = 0; for (const g of this.list) if (g.st !== GS.dead) n++; return n; }
  get remaining() { return GTOTAL - this.killed; }
  clear() { this.list.length = 0; this.byId.clear(); for (const b of this.boulders) b.mesh.visible = false; this.boulders.length = 0; }
  reset() { this.clear(); this.spawned = 0; this.killed = 0; }

  _make(id, x, z, role, hp) {
    const g = { id, x, z, y: this.world.heightAt(x, z), yaw: Math.atan2(GIANT.x - x, GIANT.z - z), hp, max: hp, st: GS.walk, t: 0, ph: Math.random() * 6, role,
      stand: 30 + Math.random() * 9, cd: 2 + Math.random() * 3, tgt: null, retT: 0, flash: 0, nx: x, nz: z, nyaw: 0, thrown: false, hitDone: false,
      P: { lean: 0, aLx: 0, aRx: 0, aLz: 0.15, aRz: -0.15, lL: 0, lR: 0, hx: 0 } };
    this.list.push(g); this.byId.set(id, g);
    return g;
  }
  _set(g, st) { g.st = st; g.t = 0; g.thrown = false; g.hitDone = false; }
  // host: a new giant walks out of the forest (north / west of the plateau)
  spawn(hp) {
    if (this.spawned >= GTOTAL) return null;
    const a = (100 + Math.random() * 110) * Math.PI / 180, d = 66 + Math.random() * 8;
    const x = clamp(GIANT.x + Math.cos(a) * d, -222, 222), z = clamp(GIANT.z + Math.sin(a) * d, -222, 700);
    this.spawned++;
    audio.thud(45, 0.8);
    return this._make(++this.seq, x, z, Math.random() < 0.55 ? 't' : 's', hp);
  }
  // host: a cannonball / explosion hits giant `id`
  hit(id, dmg) {
    const g = this.byId.get(id);
    if (!g || g.st === GS.dead) return false;
    g.hp -= dmg; g.flash = 1;
    if (g.hp <= 0) { g.hp = 0; this._set(g, GS.dead); this.killed++; audio.thud(40, 1.0); return true; }
    if (dmg >= 150 && g.st !== GS.throw) this._set(g, GS.hit);
    return false;
  }

  /* ---------------- host AI ---------------- */
  // ctx: { players: [{id,x,y,z,down,dead}], structures, rvs, throwAt(g, from, to), stomp(g), punchWall(g, W), punchRV(g, rv) }
  simulate(dt, ctx) {
    const L = this.list, S = ctx.structures;
    for (let i = L.length - 1; i >= 0; i--) {
      const g = L[i];
      g.t += dt;
      if (g.st === GS.dead) { if (g.t > 7) { this.list.splice(i, 1); this.byId.delete(g.id); } continue; }
      if ((g.retT -= dt) <= 0) {
        g.retT = 1 + Math.random();
        let best = null, bd = 1e9;
        for (const p of ctx.players) { if (p.dead) continue; const d = Math.hypot(p.x - g.x, p.z - g.z) + (p.down ? 15 : 0); if (d < bd) { bd = d; best = p; } }
        g.tgt = best ? best.id : null;
      }
      const tp = ctx.players.find(p => p.id === g.tgt) || null;
      if (g.st === GS.throw) {
        if (tp) g.yaw = dampAngle(g.yaw, Math.atan2(tp.x - g.x, tp.z - g.z), 3, dt);
        if (!g.thrown && g.t >= 0.95) { g.thrown = true; if (tp) ctx.throwAt(g, this.handPos(g, _a), _b.set(tp.x + (Math.random() - 0.5) * 3, tp.y + 0.8, tp.z + (Math.random() - 0.5) * 3)); }
        if (g.t >= 1.7) { this._set(g, GS.idle); g.cd = 3.5 + Math.random() * 3; }
        continue;
      }
      if (g.st === GS.punch) {
        if (!g.hitDone && g.t >= 0.75) { g.hitDone = true; ctx.stomp(g); audio.thud(50, 0.5); }
        if (g.t >= 1.5) { this._set(g, GS.idle); g.cd = 0.6 + Math.random(); }
        continue;
      }
      if (g.st === GS.hit) { if (g.t >= 0.5) this._set(g, GS.idle); continue; }
      g.cd -= dt;
      const dc = Math.hypot(g.x - GIANT.x, g.z - GIANT.z);
      const wall = S.nearestWall(g.x, g.z);
      const blocked = wall && wall.d < RAD + 1.6;
      const near = tp && Math.hypot(tp.x - g.x, tp.z - g.z) < 6.5 && tp.y < g.y + 6;
      // what to do
      if (g.cd <= 0 && (blocked || near)) { g.yaw = blocked ? Math.atan2(wall.W.mx - g.x, wall.W.mz - g.z) : Math.atan2(tp.x - g.x, tp.z - g.z); g.punchW = blocked ? wall.W.i : -1; this._set(g, GS.punch); continue; }
      if (g.role === 't' && dc <= g.stand && tp) { if (g.cd <= 0) { this._set(g, GS.throw); continue; } if (g.st !== GS.idle) this._set(g, GS.idle); g.yaw = dampAngle(g.yaw, Math.atan2(tp.x - g.x, tp.z - g.z), 2, dt); continue; }
      if (g.role === 's' && g.cd <= 0 && tp && dc > 34 && Math.random() < dt * 0.15) { this._set(g, GS.throw); continue; }   // smashers sometimes throw on the way
      // walk towards the castle (or the target once inside)
      const inside = dc < 8 || !S.anyWalls;
      const gx = inside && tp ? tp.x : GIANT.x, gz = inside && tp ? tp.z : GIANT.z;
      const dx = gx - g.x, dz = gz - g.z, d = Math.hypot(dx, dz) || 1;
      if (d < 4.5) { if (g.st !== GS.idle) this._set(g, GS.idle); continue; }
      if (g.st !== GS.walk) this._set(g, GS.walk);
      let mx = dx / d, mz = dz / d;
      for (const o of L) { if (o === g || o.st === GS.dead) continue; const ox = g.x - o.x, oz = g.z - o.z, dd = Math.hypot(ox, oz); if (dd < 4.5 && dd > 0.01) { mx += ox / dd * (4.5 - dd) * 0.4; mz += oz / dd * (4.5 - dd) * 0.4; } }
      const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      const v = 1.35;
      g.x += mx * v * dt; g.z += mz * v * dt;
      this._collide(g, ctx);
      g.yaw = dampAngle(g.yaw, Math.atan2(mx, mz), 2.5, dt);
    }
  }
  _collide(g, ctx) {
    // standing walls stop giants (they have to punch through); so does the RV
    for (const W of ctx.structures.walls) {
      if (!W.alive) continue;
      const rx = g.x - W.ax, rz = g.z - W.az, along = clamp(rx * W.dx + rz * W.dz, 0, W.len);
      const px = W.ax + W.dx * along, pz = W.az + W.dz * along, ex = g.x - px, ez = g.z - pz, d = Math.hypot(ex, ez), min = RAD + W.t / 2;
      if (d < min && d > 1e-4) { g.x = px + ex / d * min; g.z = pz + ez / d * min; }
    }
    _a.set(g.x, g.y, g.z);
    for (const r of ctx.rvs) r.pushOut(_a, RAD);
    g.x = _a.x; g.z = _a.z;
    g.y = this.world.heightAt(g.x, g.z);
  }
  handPos(g, out) {
    // right hand when the arm is raised overhead, roughly
    const s = Math.sin(g.yaw), c = Math.cos(g.yaw);
    return out.set(g.x - c * 0.25 * SC * 1.0 + s * 0.2 * SC, g.y + 2.3 * SC, g.z + s * 0.25 * SC + c * 0.2 * SC);
  }

  /* ---------------- boulders (everyone simulates the same flight) ---------------- */
  launch(id, x, y, z, vx, vy, vz) {
    const mesh = this.rockPool.find(m => !m.visible) || this.rockPool[0];
    mesh.visible = true; mesh.position.set(x, y, z);
    const b = { id, p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(vx, vy, vz), t: 0, mesh, done: false, spin: new THREE.Vector3(Math.random() * 4, Math.random() * 4, 0) };
    this.boulders.push(b);
    return b;
  }
  // a throw aimed to land on `to` (host)
  aim(from, to) {
    const d = Math.hypot(to.x - from.x, to.z - from.z), T = clamp(d / 22, 1.0, 2.4);
    return { T, vx: (to.x - from.x) / T, vy: (to.y - from.y - 0.5 * GRAV * T * T) / T, vz: (to.z - from.z) / T };
  }
  // step every boulder; onHit(b, wall|null, point) is called by the host for each impact
  stepBoulders(dt, structures, onHit) {
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i];
      if (b.done) { b.mesh.visible = false; this.boulders.splice(i, 1); continue; }
      _a.copy(b.p);
      b.t += dt; b.v.y += GRAV * dt; b.p.addScaledVector(b.v, dt);
      b.mesh.position.copy(b.p); b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt;
      const W = structures.wallHit(_a, b.p);
      const ground = this.world.heightAt(b.p.x, b.p.z);
      if (W || b.p.y <= ground + 0.4 || b.t > 6) {
        if (b.p.y < ground + 0.4) b.p.y = ground + 0.4;
        this.impact(b);
        if (onHit) onHit(b, W, b.p);
      }
    }
  }
  impact(b, at) {
    if (b.done) return;
    b.done = true; b.mesh.visible = false;
    if (at) b.p.copy(at);
    this.puff(b.p, 2.6);
    audio.thud(60, 0.35);
  }
  endBoulder(id, x, y, z) { const b = this.boulders.find(q => q.id === id); if (b) this.impact(b, _b.set(x, y, z)); else this.puff(_b.set(x, y, z), 2.6); }
  puff(p, size) {
    const f = this.puffPool.find(q => q.t >= 1) || this.puffPool[0];
    f.t = 0; f.size = size; f.m.visible = true; f.m.position.copy(p); f.m.material.opacity = 0.6;
  }

  /* ---------------- network ---------------- */
  snapshot() {
    const a = [this.spawned, this.killed];
    for (const g of this.list) a.push(g.id, Math.round(g.x * 10), Math.round(g.z * 10), Math.round(g.yaw * 100), g.st, Math.round(g.hp), Math.round(g.max), Math.round(g.t * 10));
    return a;
  }
  applySnapshot(a) {
    this.spawned = a[0]; this.killed = a[1];
    const seen = new Set();
    for (let i = 2; i + 7 < a.length; i += 8) {
      const id = a[i]; seen.add(id);
      let g = this.byId.get(id);
      if (!g) { g = this._make(id, a[i + 1] / 10, a[i + 2] / 10, 't', a[i + 6]); }
      g.nx = a[i + 1] / 10; g.nz = a[i + 2] / 10; g.nyaw = a[i + 3] / 100; g.max = a[i + 6];
      if (a[i + 5] < g.hp) g.flash = Math.max(g.flash, 0.8);
      g.hp = a[i + 5];
      if (a[i + 4] !== g.st) { g.st = a[i + 4]; g.t = a[i + 7] / 10; }
    }
    for (let i = this.list.length - 1; i >= 0; i--) { const g = this.list[i]; if (!seen.has(g.id)) { this.byId.delete(g.id); this.list.splice(i, 1); } }
  }
  follow(dt) {
    const k = 1 - Math.exp(-6 * dt);
    for (const g of this.list) {
      g.t += dt;
      if ((g.nx - g.x) ** 2 + (g.nz - g.z) ** 2 > 100) { g.x = g.nx; g.z = g.nz; }
      g.x += (g.nx - g.x) * k; g.z += (g.nz - g.z) * k;
      g.yaw = dampAngle(g.yaw, g.nyaw, 6, dt);
      g.y = this.world.heightAt(g.x, g.z);
    }
  }
  // cannonball queries: the giant hit by a ball moving a -> b (ball radius r)
  ballHit(a, b, r) {
    for (const g of this.list) {
      if (g.st === GS.dead) continue;
      for (let k = 0; k <= 3; k++) {
        const f = k / 3, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
        if (y < g.y - r || y > g.y + HIT_H + r) continue;
        if (Math.hypot(x - g.x, z - g.z) < HIT_R + r + (y > g.y + 5.5 ? 0.6 : 0)) return g;
      }
    }
    return null;
  }

  /* ---------------- drawing ---------------- */
  render(dt) {
    const L = this.list, n = Math.min(L.length, GMAX);
    for (let i = 0; i < n; i++) {
      const g = L[i], P = g.P, t = g.t;
      let lean = 0.05, aLx = 0, aRx = 0, aLz = 0.18, aRz = -0.18, lL = 0, lR = 0, fall = 0, yo = 0, hx = 0, snap = false;
      if (g.st === GS.walk) {
        g.ph += dt * 2.2;
        const s = Math.sin(g.ph); lL = s * 0.42; lR = -s * 0.42; aLx = -s * 0.32; aRx = s * 0.32; lean = 0.08 + Math.abs(s) * 0.03; yo = -Math.abs(s) * 0.12;
      } else if (g.st === GS.idle) { const s = Math.sin(t * 1.4); aLx = -0.1 + s * 0.05; aRx = -0.15 - s * 0.05; lean = 0.04; }
      else if (g.st === GS.throw) {
        if (t < 0.95) { const u = t / 0.95; aRx = lerp(0, -3.0, u); aRz = lerp(-0.18, -0.35, u); lean = lerp(0.05, -0.22, u); aLx = lerp(0, -0.9, u); }
        else { const u = clamp((t - 0.95) / 0.3, 0, 1); aRx = lerp(-3.0, -0.6, u); lean = lerp(-0.22, 0.3, u); aLx = -0.9 + u * 0.7; }
      } else if (g.st === GS.punch) {
        if (t < 0.6) { const u = t / 0.6; aLx = aRx = lerp(0, -3.0, u); lean = lerp(0.05, -0.18, u); aLz = 0.3; aRz = -0.3; }
        else { const u = clamp((t - 0.6) / 0.2, 0, 1); aLx = aRx = lerp(-3.0, -0.7, u); lean = lerp(-0.18, 0.6, u); aLz = 0.3; aRz = -0.3; }
      } else if (g.st === GS.hit) { const u = 1 - clamp(t / 0.5, 0, 1); lean = -0.3 * u; hx = -0.4 * u; aLx = -0.8 * u; aRx = -0.5 * u; }
      else if (g.st === GS.dead) { const k = clamp(t / 1.3, 0, 1); fall = (Math.PI / 2) * k * k; aLx = aRx = -2.6; lean = 0.2; yo = -(t > 3.5 ? (t - 3.5) * 0.7 : 0) - 0.3 * k; snap = true; }
      const r = snap ? 1 : 1 - Math.exp(-10 * dt);
      for (const [kk, val] of [['lean', lean], ['aLx', aLx], ['aRx', aRx], ['aLz', aLz], ['aRz', aRz], ['lL', lL], ['lR', lR], ['hx', hx]]) P[kk] += (val - P[kk]) * r;
      E1.set(fall, g.yaw, 0); Q.setFromEuler(E1);
      MR.compose(V.set(g.x, g.y + yo, g.z), Q, SV.setScalar(SC));
      child(MT, MR, 0, 0.92, 0, P.lean, 0, 0); this.m.torso.setMatrixAt(i, MT);
      child(MX, MT, 0, 0.7, 0.02, P.hx, 0, 0); this.m.head.setMatrixAt(i, MX);
      child(MX, MT, 0.33, 0.56, 0, P.aLx, 0, P.aLz); this.m.armL.setMatrixAt(i, MX);
      child(MX, MT, -0.33, 0.56, 0, P.aRx, 0, P.aRz); this.m.armR.setMatrixAt(i, MX);
      // boulder in the right hand while winding up a throw
      if (g.st === GS.throw && t < 0.95) {
        if (!g.rock) { g.rock = this.rockPool.find(m => !m.visible); if (g.rock) g.rock.visible = true; }
        if (g.rock) { _a.set(0, -0.72, 0).applyMatrix4(MX); g.rock.position.copy(_a); }
      } else if (g.rock) { if (!this.boulders.some(b => b.mesh === g.rock)) g.rock.visible = false; g.rock = null; }
      child(MX, MR, 0.13, 0.92, 0, P.lL, 0, 0.04); this.m.legL.setMatrixAt(i, MX);
      child(MX, MR, -0.13, 0.92, 0, P.lR, 0, -0.04); this.m.legR.setMatrixAt(i, MX);
      g.flash = Math.max(0, g.flash - dt * 4);
      _c.setRGB(1 + g.flash * 1.4, 1 - g.flash * 0.4, 1 - g.flash * 0.4);
      for (const k in this.m) this.m[k].setColorAt(i, _c);
    }
    for (const k in this.m) { const m = this.m[k]; m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const f of this.puffPool) {
      if (f.t >= 1) continue;
      f.t = Math.min(1, f.t + dt / 0.9);
      f.m.scale.setScalar(f.size * (0.4 + f.t));
      f.m.material.opacity = 0.6 * (1 - f.t);
      if (f.t >= 1) f.m.visible = false;
    }
  }
  // the wall a punching giant is hitting / players in reach of a stomp
  frontOf(g, out) { return out.set(g.x + Math.sin(g.yaw) * 3.2, g.y, g.z + Math.cos(g.yaw) * 3.2); }
}
