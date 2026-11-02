import * as THREE from 'three';
import { GeoBuilder, clamp, damp, dampAngle, lerp } from './utils.js';
import { tbox } from './character.js';
import { audio } from './audio.js';

// Night zombies. All of them are drawn with 7 instanced meshes (one per body part),
// so 1 zombie or 24 zombies cost the same handful of draw calls.
// The host (or a solo player) runs the AI; guests only follow the host's snapshots.
export const ZMAX = 24;
export const ZS = { rise: 0, walk: 1, attack: 2, hit: 3, dead: 4 };
const RAD = 0.34;                      // body radius for collisions
const HIT_R = 0.4, HIT_H = 1.8;        // shot hit cylinder
const HX = 1.24, ZB0 = -3.9, ZB1 = 4.14;   // RV hull box (local), same as the RV collider
const REACH_P = 1.05, REACH_RV = 0.55;

const K = {
  skin: 0x86a277, skinDk: 0x6c8760, shirt: 0xbdb39c, shirtDk: 0x8c836c, pants: 0x4b5163, pantsDk: 0x3c4150,
  shoe: 0x2b2622, blood: 0x6e1d16, hair: 0x2b2420, mouth: 0x260b09,
};
const PARTS = {
  torso: b => {                       // pivot at the hips
    b.add(tbox(0.33, 0.2, 0.34, 0.21, 0.2), K.pants, 0, 0, 0);
    b.add(tbox(0.4, 0.22, 0.32, 0.2, 0.46), K.shirt, 0, 0.32, 0);
    b.box(0.2, 0.15, 0.02, 0.06, 0.26, 0.115, K.blood);
    b.box(0.12, 0.08, 0.02, -0.1, 0.43, 0.112, K.shirtDk);
    b.box(0.1, 0.12, 0.02, -0.06, 0.15, 0.106, K.skinDk);          // rip in the shirt
    b.box(0.44, 0.07, 0.24, 0, 0.53, 0, K.shirtDk);
    b.cyl(0.06, 0.065, 0.1, 6, 0, 0.59, 0, K.skin);
  },
  head: b => {                        // pivot at the neck
    b.add(tbox(0.2, 0.21, 0.21, 0.22, 0.26), K.skin, 0, 0.13, 0.01);
    b.box(0.22, 0.06, 0.23, 0, 0.27, -0.01, K.hair);
    b.box(0.09, 0.05, 0.1, 0.06, 0.295, 0.03, K.skinDk);
    b.box(0.12, 0.04, 0.03, 0, 0.05, 0.115, K.mouth);
    b.box(0.03, 0.05, 0.04, 0, 0.12, 0.122, K.skinDk);
    b.box(0.2, 0.03, 0.03, 0, 0.185, 0.112, K.skinDk);
    for (const s of [1, -1]) b.box(0.03, 0.06, 0.05, s * 0.112, 0.13, 0, K.skinDk);
  },
  eyes: b => { for (const s of [1, -1]) b.box(0.05, 0.032, 0.02, s * 0.05, 0.145, 0.121, 0xffffff); },
  arm: b => {                         // pivot at the shoulder, hangs along -y
    b.add(tbox(0.12, 0.12, 0.1, 0.1, 0.28), K.shirt, 0, -0.13, 0);
    b.add(tbox(0.085, 0.085, 0.07, 0.07, 0.3), K.skin, 0, -0.42, 0);
    b.box(0.08, 0.11, 0.06, 0, -0.62, 0.01, K.skinDk);
    b.box(0.07, 0.05, 0.02, 0, -0.33, 0.045, K.blood);
  },
  leg: b => {                         // pivot at the hip
    b.add(tbox(0.16, 0.18, 0.13, 0.15, 0.48), K.pants, 0, -0.24, 0);
    b.add(tbox(0.13, 0.15, 0.12, 0.14, 0.36), K.pantsDk, 0, -0.64, 0);
    b.box(0.1, 0.1, 0.03, 0, -0.6, 0.075, K.skin);
    b.box(0.14, 0.09, 0.27, 0, -0.875, 0.05, K.shoe);
  },
};
function partGeo(fn) { const b = new GeoBuilder(); fn(b); const g = b.build(); return g.children[0].geometry; }

const E1 = new THREE.Euler(0, 0, 0, 'YXZ'), E2 = new THREE.Euler(), Q = new THREE.Quaternion();
const V = new THREE.Vector3(), SC = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
const MR = new THREE.Matrix4(), MT = new THREE.Matrix4(), MX = new THREE.Matrix4(), ML = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function child(out, parent, x, y, z, rx, ry, rz) { E2.set(rx, ry, rz); Q.setFromEuler(E2); ML.compose(V.set(x, y, z), Q, ONE); return out.multiplyMatrices(parent, ML); }
const _c = new THREE.Color();

export class Zombies {
  constructor(scene, world) {
    this.world = world; this.list = []; this.byId = new Map(); this.seq = 0;
    this.listener = new THREE.Vector3(); this.groanCd = 0;
    this._p = new THREE.Vector3(); this._l = new THREE.Vector3(); this._seen = new Set();
    const body = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffb43a });
    const geo = { torso: partGeo(PARTS.torso), head: partGeo(PARTS.head), eyes: partGeo(PARTS.eyes), arm: partGeo(PARTS.arm), leg: partGeo(PARTS.leg) };
    const make = (g, mat, shadow) => {
      const m = new THREE.InstancedMesh(g, mat, ZMAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = false;
      if (mat === body) for (let i = 0; i < ZMAX; i++) m.setColorAt(i, _c.setRGB(1, 1, 1));
      scene.add(m);
      return m;
    };
    this.m = { torso: make(geo.torso, body, true), head: make(geo.head, body, true), eyes: make(geo.eyes, eyeMat, false),
      armL: make(geo.arm, body, true), armR: make(geo.arm, body, true), legL: make(geo.leg, body, true), legR: make(geo.leg, body, true) };
    this.bodyMeshes = [this.m.torso, this.m.head, this.m.armL, this.m.armR, this.m.legL, this.m.legR];
  }

  aliveCount() { let n = 0; for (const z of this.list) if (z.st !== ZS.dead) n++; return n; }
  get count() { return this.list.length; }
  clear() { this.list.length = 0; this.byId.clear(); }

  _make(id, x, z, spd) {
    const y = this.world.groundAt(x, z);
    const zb = { id, x, y, z, yaw: Math.random() * Math.PI * 2, hp: 100, st: ZS.rise, t: 0, ph: Math.random() * 6, spd,
      sc: 0.92 + Math.random() * 0.16, tilt: (Math.random() - 0.5) * 0.5, tint: new THREE.Color().setRGB(0.85 + Math.random() * 0.25, 0.85 + Math.random() * 0.25, 0.85 + Math.random() * 0.25),
      flash: 0, tgt: null, retT: 0, hitDone: false, stuckT: 0, wig: 0, wigDir: 1, lx: x, lz: z, kbx: 0, kbz: 0, burn: -1,
      nx: x, nz: z, nyaw: 0, pred: 0, groanT: 2 + Math.random() * 6,
      P: { lean: 0.2, sway: 0, hx: 0.1, hz: 0, aLx: -2.6, aLz: 0.1, aRx: -2.6, aRz: -0.1, lL: 0, lR: 0 } };
    this.list.push(zb); this.byId.set(id, zb);
    return zb;
  }
  _remove(i) { const z = this.list[i]; this.byId.delete(z.id); this.list.splice(i, 1); }
  _set(z, st) { z.st = st; z.t = 0; }

  /* ---------------- host / solo: spawning + AI ---------------- */
  spawn(x, z, spd) { if (this.list.length >= ZMAX) return null; return this._make(++this.seq, x, z, spd); }
  kill(z, dx = 0, dz = 0, fling = false) {
    if (z.st === ZS.dead) return;
    z.hp = 0; this._set(z, ZS.dead);
    const k = fling ? 7 : 1.6; z.kbx = dx * k; z.kbz = dz * k;
  }
  // shots hit zombie `id` (host side)
  hit(id, dmg, dx, dz) {
    const z = this.byId.get(id);
    if (!z || z.st === ZS.dead) return false;
    z.hp -= dmg; z.flash = 1;
    if (z.hp <= 0) { this.kill(z, dx, dz); return true; }
    if (dmg >= 20 && z.st !== ZS.rise) { this._set(z, ZS.hit); z.kbx = dx * 2.4; z.kbz = dz * 2.4; }
    return false;
  }
  // morning: every zombie collapses within a couple of seconds
  burnAll() { for (const z of this.list) if (z.st !== ZS.dead && z.burn < 0) z.burn = Math.random() * 2.5; }

  // which player (or which RV, if that player hides in / on it) a zombie goes for
  _pick(z, ctx) {
    let best = null, bd = 1e9;
    for (const p of ctx.players) {
      if (p.down) continue;
      if (p.safe >= 0) {
        const r = ctx.rvs[p.safe]; if (!r) continue;
        const d = Math.hypot(r.root.position.x - z.x, r.root.position.z - z.z) - 2;
        if (d < bd) { bd = d; best = { rv: p.safe }; }
      } else {
        const d = Math.hypot(p.x - z.x, p.z - z.z);
        if (d < bd) { bd = d; best = { id: p.id }; }
      }
    }
    return best;
  }
  _hullDist(r, z) {
    const l = r.toLocal(this._p.set(z.x, r.root.position.y + 0.6, z.z), this._l);
    const ex = Math.max(Math.abs(l.x) - HX, 0), ez = Math.max(l.z - ZB1, ZB0 - l.z, 0);
    return Math.hypot(ex, ez);
  }
  // ctx: { players: [{id,x,y,z,safe,down}], rvs, strike(zombie, target), runOver(rv, zombie) }
  simulate(dt, ctx) {
    const L = this.list, W = this.world;
    for (let i = L.length - 1; i >= 0; i--) {
      const z = L[i];
      z.t += dt;
      if (z.burn >= 0 && z.st !== ZS.dead) { z.burn -= dt; z.flash = 1; if (z.burn < 0) this.kill(z); }
      if (z.st === ZS.dead) {
        if (z.t < 1.2 && (z.kbx || z.kbz)) {
          const f = Math.exp(-4 * z.t); z.x += z.kbx * f * dt; z.z += z.kbz * f * dt;
          this._p.set(z.x, z.y, z.z); W.collide(this._p, RAD); z.x = this._p.x; z.z = this._p.z;
          z.y = W.groundAt(z.x, z.z, z.y + 0.6);
        }
        if (z.t > 4.2) this._remove(i);
        continue;
      }
      if (z.st === ZS.rise) { if (z.t >= 1.6) this._set(z, ZS.walk); else continue; }
      if ((z.retT -= dt) <= 0) { z.retT = 0.35 + Math.random() * 0.3; z.tgt = this._pick(z, ctx); }
      const tg = z.tgt;
      let gx, gz, near = false, tp = null;
      if (tg && tg.rv !== undefined && ctx.rvs[tg.rv]) {
        const r = ctx.rvs[tg.rv];
        gx = r.root.position.x; gz = r.root.position.z; near = this._hullDist(r, z) < REACH_RV;
      } else if (tg && tg.id !== undefined && (tp = ctx.players.find(p => p.id === tg.id))) {
        gx = tp.x; gz = tp.z;
        near = Math.hypot(gx - z.x, gz - z.z) < REACH_P && Math.abs(tp.y - z.y) < 1.3;
      } else { gx = z.x + Math.sin(z.yaw) * 4; gz = z.z + Math.cos(z.yaw) * 4; }
      const dx = gx - z.x, dz = gz - z.z, d = Math.hypot(dx, dz) || 1;
      if (z.st === ZS.attack) {
        z.yaw = dampAngle(z.yaw, Math.atan2(dx, dz), 8, dt);
        if (!z.hitDone && z.t >= 0.5) { z.hitDone = true; if (near || (tp && d < REACH_P + 0.6)) ctx.strike(z, tg); }
        if (z.t >= 1.25) this._set(z, ZS.walk);
        continue;
      }
      if (z.st === ZS.hit) {
        const f = Math.exp(-6 * z.t); z.x += z.kbx * f * dt; z.z += z.kbz * f * dt;
        this._collide(z, ctx);
        if (z.t >= 0.4) this._set(z, ZS.walk);
        continue;
      }
      if (near && tg) { this._set(z, ZS.attack); z.hitDone = false; continue; }
      // walk toward the goal, around each other, and wiggle free when stuck behind a tree
      let mx = dx / d, mz = dz / d;
      if (z.wig > 0) { z.wig -= dt; const k = z.wigDir, ax = mx * 0.35 - mz * k, az = mz * 0.35 + mx * k; mx = ax; mz = az; }
      for (const o of L) {
        if (o === z || o.st === ZS.dead) continue;
        const ox = z.x - o.x, oz = z.z - o.z, dd = ox * ox + oz * oz;
        if (dd < 0.64 && dd > 1e-6) { const s = Math.sqrt(dd), k = ((0.8 - s) / s) * 1.6; mx += ox * k; mz += oz * k; }
      }
      const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      const v = z.spd * (W.waterDepth(z.x, z.z) > 0.4 ? 0.55 : 1) * (tg ? 1 : 0.35);
      const ox = z.x, oz = z.z;
      z.x += mx * v * dt; z.z += mz * v * dt;
      if (W.waterDepth(z.x, z.z) > 1.35) { z.x = ox; z.z = oz; }        // zombies don't swim
      this._collide(z, ctx);
      z.yaw = dampAngle(z.yaw, Math.atan2(mx, mz), 6, dt);
      if ((z.stuckT += dt) > 1) {
        if (Math.hypot(z.x - z.lx, z.z - z.lz) < v * 0.35 && z.wig <= 0) { z.wig = 1.2; z.wigDir = Math.random() < 0.5 ? 1 : -1; }
        z.stuckT = 0; z.lx = z.x; z.lz = z.z;
      }
    }
    // a moving RV runs zombies over
    for (const r of ctx.rvs) {
      if (Math.abs(r.speed) < 3) continue;
      const sg = Math.sign(r.speed);
      for (const z of L) {
        if (z.st === ZS.dead || z.st === ZS.rise) continue;
        const l = r.toLocal(this._p.set(z.x, z.y + 0.6, z.z), this._l);
        if (Math.abs(l.x) < HX + 0.4 && l.z > ZB0 - 0.35 && l.z < ZB1 + 0.4 && l.y > -1.2 && l.y < 3.2) {
          this.kill(z, r.forward.x * sg + (l.x > 0 ? -r.forward.z : r.forward.z) * 0.6, r.forward.z * sg + (l.x > 0 ? r.forward.x : -r.forward.x) * 0.6, true);
          ctx.runOver(r, z);
        }
      }
    }
  }
  _collide(z, ctx) {
    const W = this.world;
    this._p.set(z.x, z.y, z.z);
    W.collide(this._p, RAD);
    for (const r of ctx.rvs) r.pushOut(this._p, RAD);
    z.x = this._p.x; z.z = this._p.z;
    z.y = W.groundAt(z.x, z.z, z.y + 0.6);
  }

  /* ---------------- network ---------------- */
  snapshot() {
    const a = [];
    for (const z of this.list) a.push(z.id, Math.round(z.x * 10), Math.round(z.z * 10), Math.round(z.yaw * 100), z.st, Math.max(0, Math.round(z.hp)), Math.round(z.spd * 10));
    return a;
  }
  // guest: follow the host's zombies
  applySnapshot(a) {
    const seen = this._seen; seen.clear();
    for (let i = 0; i + 6 < a.length; i += 7) {
      const id = a[i], x = a[i + 1] / 10, zz = a[i + 2] / 10, yaw = a[i + 3] / 100, st = a[i + 4], hp = a[i + 5], spd = a[i + 6] / 10;
      seen.add(id);
      let z = this.byId.get(id);
      if (!z) {
        if (st === ZS.dead) continue;
        z = this._make(id, x, zz, spd);
        z.yaw = yaw; z.st = st; z.t = st === ZS.rise ? 0 : 2;
      }
      z.nx = x; z.nz = zz; z.nyaw = yaw; z.spd = spd;
      if (hp < z.hp && z.pred <= 0) z.flash = Math.max(z.flash, 0.7);
      if (z.pred > 0 && st !== ZS.dead) continue;        // we already saw it die from our own shot
      z.hp = hp;
      if (st !== z.st) { z.st = st; z.t = 0; }
    }
    for (const z of this.list) if (!seen.has(z.id) && z.st !== ZS.dead) this._set(z, ZS.dead);
    for (let i = this.list.length - 1; i >= 0; i--) if (!seen.has(this.list[i].id) && this.list[i].st === ZS.dead && this.list[i].t > 4.2) this._remove(i);
  }
  // guest: smooth toward the latest snapshot
  follow(dt) {
    const k = 1 - Math.exp(-10 * dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      z.t += dt;
      if (z.pred > 0) z.pred -= dt;
      if ((z.nx - z.x) ** 2 + (z.nz - z.z) ** 2 > 25) { z.x = z.nx; z.z = z.nz; }
      z.x += (z.nx - z.x) * k; z.z += (z.nz - z.z) * k;
      z.yaw = dampAngle(z.yaw, z.nyaw, 10, dt);
      z.y = this.world.groundAt(z.x, z.z, z.y + 0.6);
      if (z.st === ZS.dead && z.t > 4.5) this._remove(i);
    }
  }
  // a guest's own shot: show it right away (the host decides for real)
  predictHit(id, dmg) {
    const z = this.byId.get(id);
    if (!z || z.st === ZS.dead) return false;
    z.flash = 1; z.hp -= dmg;
    if (z.hp <= 0) { this._set(z, ZS.dead); z.pred = 1.5; return true; }
    return false;
  }

  /* ---------------- shooting queries ---------------- */
  // nearest zombie hit by a ray (vertical cylinder per zombie). Returns { z, t } or null
  raycast(o, d, maxT, tMin = 0) {
    let best = null, bt = maxT;
    const a = d.x * d.x + d.z * d.z;
    for (const z of this.list) {
      if (z.st === ZS.dead) continue;
      const yo = z.st === ZS.rise ? -1.75 * (1 - clamp(z.t / 1.6, 0, 1)) : 0;
      if (yo < -1.1) continue;
      const y0 = z.y + yo, y1 = y0 + HIT_H * z.sc, ox = o.x - z.x, oz = o.z - z.z;
      let t0, t1;
      if (a < 1e-8) { if (ox * ox + oz * oz > HIT_R * HIT_R) continue; t0 = -1e9; t1 = 1e9; }
      else {
        const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - HIT_R * HIT_R, disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const s = Math.sqrt(disc); t0 = (-b - s) / (2 * a); t1 = (-b + s) / (2 * a);
      }
      if (Math.abs(d.y) > 1e-6) {
        let ta = (y0 - o.y) / d.y, tb = (y1 - o.y) / d.y; if (ta > tb) { const q = ta; ta = tb; tb = q; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      } else if (o.y < y0 || o.y > y1) continue;
      t0 = Math.max(t0, tMin);
      if (t0 <= t1 && t0 < bt) { bt = t0; best = { z, t: t0 }; }
    }
    return best;
  }
  // gentle aim help (mobile + mouse): the zombie closest to the crosshair within maxAng radians
  assist(o, d, maxAng, maxDist, out) {
    let best = null, bc = Math.cos(maxAng);
    for (const z of this.list) {
      if (z.st === ZS.dead || z.st === ZS.rise) continue;
      V.set(z.x - o.x, z.y + 1.15 * z.sc - o.y, z.z - o.z);
      const len = V.length();
      if (len > maxDist || len < 0.5) continue;
      const c = V.dot(d) / len;
      if (c > bc) { bc = c; best = z; }
    }
    return best ? out.set(best.x, best.y + 1.15 * best.sc, best.z) : null;
  }

  /* ---------------- drawing ---------------- */
  render(dt, listener) {
    const L = this.list, n = Math.min(L.length, ZMAX);
    if (listener) this.listener.copy(listener);
    this.groanCd -= dt;
    for (let i = 0; i < n; i++) {
      const z = L[i], P = z.P, t = z.t;
      let lean = 0.24, sway = 0, hx = 0.12, hz = z.tilt, aLx = -1.35, aRx = -1.28, aLz = 0.12, aRz = -0.12, lL = 0, lR = 0, fall = 0, yo = 0, snap = false;
      if (z.st === ZS.walk) {
        z.ph += dt * z.spd * 2.4;
        const s = Math.sin(z.ph);
        lL = s * 0.5; lR = -s * 0.5;
        aLx = -1.35 + Math.sin(z.ph * 0.5) * 0.16; aRx = -1.25 - Math.sin(z.ph * 0.5 + 1) * 0.16;
        sway = s * 0.08; lean = 0.25 + Math.abs(s) * 0.05; hz = z.tilt + s * 0.07;
      } else if (z.st === ZS.rise) {
        const k = clamp(t / 1.6, 0, 1);
        yo = -1.75 * (1 - k) * (1 - k); aLx = aRx = -2.7 + k * 1.2; lean = -0.15 + k * 0.3; lL = -0.3 * (1 - k); snap = true;
      } else if (z.st === ZS.attack) {
        if (t < 0.45) { const u = t / 0.45; aLx = aRx = lerp(-1.4, -2.7, u); lean = lerp(0.25, -0.08, u); }
        else if (t < 0.65) { const u = (t - 0.45) / 0.2; aLx = aRx = lerp(-2.7, -0.75, u); lean = lerp(-0.08, 0.55, u); }
        else { const u = clamp((t - 0.65) / 0.55, 0, 1); aLx = aRx = lerp(-0.75, -1.35, u); lean = lerp(0.55, 0.25, u); }
        aLz = 0.3; aRz = -0.3;
      } else if (z.st === ZS.hit) {
        const u = 1 - clamp(t / 0.4, 0, 1);
        lean = -0.4 * u; aLx = -0.5; aRx = -2.1; hx = -0.35 * u;
      } else if (z.st === ZS.dead) {
        const k = clamp(t / 0.7, 0, 1);
        fall = -(Math.PI / 2) * k * k; aLx = -2.9; aRx = -2.6; aLz = 0.5; aRz = -0.4; lean = 0; hx = -0.3; lL = -0.15; lR = 0.2;
        yo = 0.12 * k - (t > 2.2 ? (t - 2.2) * 0.5 : 0); snap = true;
      }
      const r = snap ? 1 : 1 - Math.exp(-12 * dt);
      P.lean += (lean - P.lean) * r; P.sway += (sway - P.sway) * r; P.hx += (hx - P.hx) * r; P.hz += (hz - P.hz) * r;
      P.aLx += (aLx - P.aLx) * r; P.aRx += (aRx - P.aRx) * r; P.aLz += (aLz - P.aLz) * r; P.aRz += (aRz - P.aRz) * r;
      P.lL += (lL - P.lL) * r; P.lR += (lR - P.lR) * r;

      E1.set(fall, z.yaw, 0); Q.setFromEuler(E1);
      MR.compose(V.set(z.x, z.y + yo, z.z), Q, SC.setScalar(z.sc));
      child(MT, MR, 0, 0.92, 0, P.lean, 0, P.sway); this.m.torso.setMatrixAt(i, MT);
      child(MX, MT, 0, 0.62, 0.02, P.hx, 0, P.hz); this.m.head.setMatrixAt(i, MX);
      this.m.eyes.setMatrixAt(i, z.st === ZS.dead && t > 0.4 ? ZERO : MX);
      child(MX, MT, 0.25, 0.5, 0, P.aLx, 0, P.aLz); this.m.armL.setMatrixAt(i, MX);
      child(MX, MT, -0.25, 0.5, 0, P.aRx, 0, P.aRz); this.m.armR.setMatrixAt(i, MX);
      child(MX, MR, 0.1, 0.92, 0, P.lL, 0, 0.03); this.m.legL.setMatrixAt(i, MX);
      child(MX, MR, -0.1, 0.92, 0, P.lR, 0, -0.03); this.m.legR.setMatrixAt(i, MX);

      z.flash = Math.max(0, z.flash - dt * 5);
      const f = z.flash, tc = z.tint;
      _c.setRGB(tc.r * (1 + f * 1.6), tc.g * (1 - f * 0.45), tc.b * (1 - f * 0.45));
      for (const m of this.bodyMeshes) m.setColorAt(i, _c);

      if (z.st !== ZS.dead && z.st !== ZS.rise && (z.groanT -= dt) <= 0) {
        z.groanT = 4 + Math.random() * 7;
        const dd = Math.hypot(z.x - this.listener.x, z.z - this.listener.z);
        if (dd < 30 && this.groanCd <= 0) { this.groanCd = 0.7; audio.groan(clamp(1 - dd / 30, 0.1, 1) * 0.8); }
      }
    }
    for (const k in this.m) {
      const m = this.m[k];
      m.count = n; m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
