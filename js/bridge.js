import * as THREE from 'three';
import { GeoBuilder, clamp, rand, canvasTexture } from './utils.js';
import { BRIDGE } from './terrain.js';
import { crate } from './world.js';
import { audio } from './audio.js';

/* ================= bridge materials + physics (2D side view) =================
   x = distance along the bridge (0 = south bank edge, SPAN = north bank edge)
   y = height relative to the road level on the banks. One truss is simulated;
   the other side is identical, so it carries half of every load. */
export const SPAN = BRIDGE.span;
export const BMAT = {
  road: { name: 'Road (planks)', color: '#c08f55', hex: 0xb98a52, E: 3.0e6, max: 36000, kgm: 22, maxLen: 4, mat: 'planks', per: 2 },
  log: { name: 'Log beam', color: '#7a5230', hex: 0x7f5532, E: 5.0e6, max: 52000, kgm: 26, maxLen: 5, mat: 'logs', per: 5 },
  rope: { name: 'Rope', color: '#e3d29a', hex: 0xd8c690, E: 1.4e6, max: 30000, kgm: 2, maxLen: 10, mat: 'rope', per: 5, tension: true },
};
export const AXLE_LOAD = 4000 * 9.81 / 2 / 2;     // RV: 4 t, two axles, two side trusses
export const PLAYER_LOAD = 85 * 9.81 / 2;

export function anchorList(pier) {
  const a = [{ x: 0, y: 0 }, { x: 0, y: -2 }, { x: SPAN, y: 0 }, { x: SPAN, y: -2 }];
  if (pier) a.push({ x: SPAN / 2, y: 0 }, { x: SPAN / 2, y: -2 });
  return a;
}
export function memberLen(d, m) { const a = d.nodes[m.a], b = d.nodes[m.b]; return Math.hypot(b.x - a.x, b.y - a.y); }
export function costOf(d) {
  const c = { planks: 0, logs: 0, rope: 0, stone: d.pier ? 6 : 0 };
  for (const m of d.members) { const t = BMAT[m.type]; c[t.mat] += Math.ceil(memberLen(d, m) / t.per - 1e-6); }
  return c;
}

export class BridgeSim {
  constructor(design, floorY) {
    this.floorY = floorY; this.age = 0; this.acc = 0; this.broke = []; this.maxRatio = 0;
    this.nodes = design.nodes.map(n => ({ x: n.x, y: n.y, vx: 0, vy: 0, fx: 0, fy: 0, lx: 0, ly: 0, m: 30, fixed: !!n.fixed }));
    this.members = design.members.map(m => {
      const A = this.nodes[m.a], Bn = this.nodes[m.b], L0 = Math.hypot(Bn.x - A.x, Bn.y - A.y), t = BMAT[m.type];
      A.m += t.kgm * L0 / 2; Bn.m += t.kgm * L0 / 2;
      return { a: m.a, b: m.b, type: m.type, L0, fs: 0, ratio: 0, broken: false };
    });
  }
  clearLoads() { for (const p of this.nodes) { p.lx = 0; p.ly = 0; } }
  // road surface at x (highest intact road member that spans it)
  roadAt(x) {
    let best = null;
    for (const m of this.members) {
      if (m.broken || m.type !== 'road') continue;
      const A = this.nodes[m.a], Bn = this.nodes[m.b], x0 = Math.min(A.x, Bn.x), x1 = Math.max(A.x, Bn.x);
      if (x < x0 - 0.05 || x > x1 + 0.05 || x1 - x0 < 0.05) continue;
      const t = clamp((x - A.x) / (Bn.x - A.x), 0, 1), y = A.y + (Bn.y - A.y) * t;
      if (!best || y > best.y) best = { m, t, y };
    }
    return best;
  }
  addLoad(x, w) {
    const r = this.roadAt(x);
    if (!r) return false;
    this.nodes[r.m.a].ly -= w * (1 - r.t); this.nodes[r.m.b].ly -= w * r.t;
    return true;
  }
  step(dt) {
    const h = 1 / 240;
    this.acc += Math.min(dt, 0.05);
    let n = 0;
    while (this.acc >= h && n < 12) { this._sub(h); this.acc -= h; n++; }
  }
  _sub(h) {
    this.age += h;
    const g = 9.81 * Math.min(1, this.age / 1.2);          // ease gravity in so a fresh bridge settles gently
    for (const p of this.nodes) { p.fx = p.lx; p.fy = p.ly - g * p.m; }
    let maxR = 0;
    for (const m of this.members) {
      if (m.broken) continue;
      const A = this.nodes[m.a], Bn = this.nodes[m.b], t = BMAT[m.type];
      const dx = Bn.x - A.x, dy = Bn.y - A.y, L = Math.hypot(dx, dy);
      if (L < 1e-5) continue;
      const ux = dx / L, uy = dy / L;
      let strain = (L - m.L0) / m.L0;
      const slack = t.tension && strain < 0;
      if (slack) strain = 0;
      const k = t.E / m.L0, rv = (Bn.vx - A.vx) * ux + (Bn.vy - A.vy) * uy;
      const fSpring = t.E * strain, f = fSpring + (slack ? 0 : 0.6 * Math.sqrt(k * 60) * rv);
      m.fs += (fSpring - m.fs) * 0.12;
      m.ratio = Math.abs(m.fs) / t.max;
      if (m.ratio > maxR) maxR = m.ratio;
      A.fx += f * ux; A.fy += f * uy; Bn.fx -= f * ux; Bn.fy -= f * uy;
      if (m.ratio > 1) { m.broken = true; this.broke.push(m); }
    }
    this.maxRatio = maxR;
    for (const p of this.nodes) {
      if (p.fixed) continue;
      p.vx = (p.vx + (p.fx / p.m) * h) * 0.9995; p.vy = (p.vy + (p.fy / p.m) * h) * 0.9995;
      p.x += p.vx * h; p.y += p.vy * h;
      if (p.y < this.floorY) { p.y = this.floorY; p.vy = 0; p.vx *= 0.6; }
    }
  }
  get roadIntact() { return this.members.some(m => m.type === 'road' && !m.broken); }
}

/* ================= the bridge in the 3D world ================= */
const _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _ex = new THREE.Vector3(), _ey = new THREE.Vector3(), _ez = new THREE.Vector3(), _c = new THREE.Color(), _red = new THREE.Color(0xff2a1a);

export class BridgeWorld {
  constructor(scene, world, toast) {
    this.scene = scene; this.world = world; this.toast = toast;
    const T = world.T;
    this.D = T.D; this.W = T.W; this.BED = T.BED;
    this.A = new THREE.Vector3(BRIDGE.ax, 0, BRIDGE.az);
    this.dir = new THREE.Vector3(BRIDGE.dx, 0, BRIDGE.dz);
    this.lat = new THREE.Vector3(BRIDGE.dz, 0, -BRIDGE.dx);
    this.state = 'broken'; this.sim = null; this.design = null; this.spent = null;
    this.role = 'solo';   // solo | host | guest (guests only display the host's simulation)
    this.debris = [];
    this._site();
    const plankTex = canvasTexture(256, 64, (c, w, h) => {
      c.fillStyle = '#d8b07a'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#c9a06a' : '#d2a873'; c.fillRect(i * 32, 0, 30, h); c.fillStyle = '#6e4a2a'; c.fillRect(i * 32 + 30, 0, 2, h); }
    });
    const mk = (geo, cap, mat) => { const im = new THREE.InstancedMesh(geo, mat, cap); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); return im; };
    const lam = opt => new THREE.MeshLambertMaterial({ flatShading: true, ...opt });
    this.imRoad = mk(new THREE.BoxGeometry(1, 0.16, BRIDGE.width), 48, lam({ map: plankTex }));
    this.imLog = mk(new THREE.CylinderGeometry(0.14, 0.14, 1, 6).rotateZ(-Math.PI / 2), 160, lam({}));
    this.imRope = mk(new THREE.CylinderGeometry(0.035, 0.035, 1, 4).rotateZ(-Math.PI / 2), 160, lam({}));
    this.imJoint = mk(new THREE.BoxGeometry(0.3, 0.3, 0.3), 160, lam({ color: 0x3a3c40 }));
    for (const im of [this.imRoad, this.imLog, this.imRope]) im.setColorAt(0, _c.set(0xffffff));
  }

  // bridge-local (x along, y up from road level, w sideways) -> world
  toWorld(x, y, w, out) { return out.copy(this.A).addScaledVector(this.dir, x).addScaledVector(this.lat, w).setY(this.D + y); }
  local(px, pz) { const rx = px - this.A.x, rz = pz - this.A.z; return { x: rx * this.dir.x + rz * this.dir.z, w: rx * this.lat.x + rz * this.lat.z }; }

  surfaceAt(px, pz) {
    const l = this.local(px, pz);
    // the stone abutments are solid road-level ground at both ends
    if (Math.abs(l.w) < 2.9 && ((l.x >= -4.2 && l.x <= 0) || (l.x >= SPAN && l.x <= SPAN + 4.2))) return this.D;
    if (!this.sim) return null;
    if (Math.abs(l.w) > BRIDGE.width / 2 + 0.15 || l.x < -0.3 || l.x > SPAN + 0.3) return null;
    const r = this.sim.roadAt(clamp(l.x, 0, SPAN));
    return r ? this.D + r.y + 0.08 : null;
  }

  _site() {
    const b = new GeoBuilder(), D = this.D, BED = this.BED, ang = Math.atan2(BRIDGE.dx, BRIDGE.dz);
    b.group(this.A.x, 0, this.A.z, 0, ang, 0, () => {
      for (const [z0, z1] of [[-4.2, 0.15], [SPAN - 0.15, SPAN + 4.2]]) {
        b.boxMM(-2.9, 2.9, BED - 0.6, D - 0.02, z0, z1, 0x8a877e);
        for (let y = BED; y < D - 0.4; y += 0.7) b.boxMM(-2.95, 2.95, y, y + 0.08, z0 - 0.03, z1 + 0.03, 0x6e6b62);
        b.boxMM(-2.9, 2.9, D - 0.08, D + 0.02, z0, z1, 0x9a978e);
      }
    });
    this.siteMesh = b.build(); this.scene.add(this.siteMesh);
    // the old broken bridge (removed when you build a new one)
    const o = new GeoBuilder();
    o.group(this.A.x, 0, this.A.z, 0, ang, 0, () => {
      o.box(BRIDGE.width, 0.16, 2.6, 0, D - 0.55, 1.15, 0x8a6a45, 'solid', 0.45, 0, 0);
      o.box(BRIDGE.width, 0.16, 2.2, 0.3, D - 0.5, SPAN - 0.95, 0x7a5c3b, 'solid', -0.5, 0, 0.1);
      for (let i = 0; i < 6; i++) o.box(rand(1.5, 3.5), 0.14, 0.35, rand(-3, 3), this.W + 0.05, rand(3, SPAN - 3), 0x7a5c3b, 'solid', rand(-0.2, 0.2), rand(0, 3), rand(-0.2, 0.2));
      o.cyl(0.14, 0.14, 4, 6, -1.2, this.W + 0.4, SPAN * 0.4, 0x6e4a2a, 0.9, 0, 0.6);
      for (const s of [-1, 1]) o.box(0.03, 2.2, 0.03, s * 2.1, D - 1.2, 0.3, 0xd8c690, 'solid', 0.3, 0, 0);
      // warning sign on the south approach
      o.box(0.12, 1.4, 0.12, -3.6, D + 0.7, -9, 0x6e4a2a);
      o.box(1.6, 0.7, 0.06, -3.6, D + 1.45, -9, 0xd9342b);
      o.box(1.4, 0.12, 0.07, -3.6, D + 1.45, -9.01, 0xffffff);
    });
    this.oldMesh = o.build(); this.scene.add(this.oldMesh);
    // stone pier (shown when the design includes one)
    const p = new GeoBuilder();
    p.group(this.A.x, 0, this.A.z, 0, ang, 0, () => {
      p.boxMM(-2.4, 2.4, BED - 0.5, D - 0.02, SPAN / 2 - 0.7, SPAN / 2 + 0.7, 0x8a877e);
      for (let y = BED; y < D - 0.4; y += 0.6) p.boxMM(-2.45, 2.45, y, y + 0.07, SPAN / 2 - 0.73, SPAN / 2 + 0.73, 0x6e6b62);
    });
    this.pierMesh = p.build(); this.pierMesh.visible = false; this.scene.add(this.pierMesh);
    // workbench + supplies on the south bank
    const wb = this.toWorld(-10, 0, -7.5, new THREE.Vector3()); wb.y = this.world.heightAt(wb.x, wb.z);
    const w = new GeoBuilder();
    w.group(wb.x, wb.y, wb.z, 0, ang, 0, () => {
      w.box(2.2, 0.1, 1.0, 0, 0.92, 0, 0x9a6a3c);
      for (const [x, z] of [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]]) w.box(0.1, 0.9, 0.1, x, 0.45, z, 0x6e4a2a);
      w.box(0.7, 0.02, 0.18, 0.4, 1.0, 0.1, 0xb9bec4); w.box(0.18, 0.06, 0.08, 0.85, 1.02, 0.1, 0x2a2a2a);
      for (let i = 0; i < 4; i++) w.box(1.8, 0.06, 0.25, -0.1, 0.99 + i * 0.065, -0.3, i % 2 ? 0xc9a06a : 0xd8b07a);
      w.box(0.12, 1.6, 0.12, -1.3, 0.8, 0.7, 0x6e4a2a); w.box(1.2, 0.8, 0.05, -1.3, 1.7, 0.72, 0xe8d8a8);
    });
    for (let i = 0; i < 5; i++) w.cyl(0.22, 0.22, 3, 7, wb.x + this.dir.x * 3 + this.lat.x * (-1 - i * 0.05), wb.y + 0.25 + (i > 2 ? 0.4 : 0), wb.z + this.dir.z * 3 + this.lat.z * (-1) + (i % 3) * 0.45, 0x7a5230, Math.PI / 2, ang + Math.PI / 2, 0);
    const cp = this.toWorld(-13, 0, -6.2, new THREE.Vector3()); cp.y = this.world.heightAt(cp.x, cp.z);
    crate(w, cp.x, cp.y, cp.z, ang);
    this.scene.add(w.build());
    this.workbenchPos = wb;
    this.world.addCollider({ x: wb.x, z: wb.z, r: 1.2 });
    this.world.addCollider({ x: cp.x, z: cp.z, r: 0.7 });
    const lp = new THREE.Vector3(wb.x + this.dir.x * 3 - this.lat.x, wb.y, wb.z + this.dir.z * 3 - this.lat.z);
    this.world.crates.push({ pos: lp, label: 'Take logs from the pile', give: { logs: 6 }, taken: false });
    this.world.crates.push({ pos: cp, label: 'Open supply crate', give: { rope: 4, planks: 2 }, taken: false });
  }

  build(design) {
    if (this.oldMesh) { this.scene.remove(this.oldMesh); this.oldMesh = null; }
    this.design = JSON.parse(JSON.stringify(design));
    this.sim = new BridgeSim(this.design, this.BED - this.D + 0.3);
    this.pierMesh.visible = !!design.pier;
    this.state = 'built'; this.snapped = 0;
    this._render();
  }

  update(dt, loads) {
    this._debris(dt);
    if (!this.sim) return;
    if (this.role === 'guest') {
      const k = 1 - Math.exp(-12 * dt);
      for (const n of this.sim.nodes) if (n.tx !== undefined) { n.x += (n.tx - n.x) * k; n.y += (n.ty - n.y) * k; }
      this._render();
      return;
    }
    this.sim.clearLoads();
    for (const L of loads) {
      const s = this.surfaceAt(L.x, L.z);
      if (s !== null && Math.abs(L.y - s) < 0.7) this.sim.addLoad(clamp(this.local(L.x, L.z).x, 0, SPAN), L.w);
    }
    this.sim.step(dt);
    if (this.sim.broke.length) {
      for (const m of this.sim.broke) this._snap(m);
      this.sim.broke.length = 0;
      if (this.state === 'built') { this.state = 'damaged'; this.toast('💥 Crack! A part of the bridge snapped — it was too weak'); }
      audio.thud(70, 0.35);
    }
    this._render();
  }

  _render() {
    const s = this.sim, hw = BRIDGE.width / 2 - 0.12;
    let nr = 0, nl = 0, np = 0, nj = 0;
    const used = new Set();
    for (const m of s.members) {
      if (m.broken) continue;
      const A = s.nodes[m.a], Bn = s.nodes[m.b], t = BMAT[m.type];
      _c.set(t.hex).lerp(_red, clamp((m.ratio - 0.45) / 0.55, 0, 1));
      const sides = m.type === 'road' ? [0] : [-hw, hw];
      for (const w of sides) {
        this.toWorld(A.x, A.y, w, _a); this.toWorld(Bn.x, Bn.y, w, _b);
        const L = _a.distanceTo(_b);
        _ex.subVectors(_b, _a).divideScalar(L || 1); _ez.copy(this.lat); _ey.crossVectors(_ez, _ex).normalize();
        _m.makeBasis(_ex.multiplyScalar(L), _ey, _ez).setPosition(_a.add(_b).multiplyScalar(0.5));
        const im = m.type === 'road' ? this.imRoad : m.type === 'log' ? this.imLog : this.imRope;
        const i = m.type === 'road' ? nr++ : m.type === 'log' ? nl++ : np++;
        if (i >= im.instanceMatrix.count) continue;
        im.setMatrixAt(i, _m); im.setColorAt(i, _c);
      }
      used.add(m.a); used.add(m.b);
    }
    for (const k of used) {
      const p = s.nodes[k];
      for (const w of [-hw, hw]) { this.toWorld(p.x, p.y, w, _a); _m.makeTranslation(_a.x, _a.y, _a.z); if (nj < 160) this.imJoint.setMatrixAt(nj++, _m); }
    }
    const fin = (im, n) => { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; };
    fin(this.imRoad, nr); fin(this.imLog, nl); fin(this.imRope, np); fin(this.imJoint, nj);
  }

  // multiplayer: the host streams joint positions, stress and broken pieces
  snapshot() {
    const s = this.sim, q = v => Math.round(v * 1000) / 1000;
    return { n: s.nodes.flatMap(n => [q(n.x), q(n.y)]), b: s.members.map(m => (m.broken ? 1 : 0)).join(''), r: s.members.map(m => Math.min(9, Math.round(m.ratio * 9))).join(''), st: this.state };
  }
  applySnapshot(snap) {
    const s = this.sim;
    if (!s || snap.n.length !== s.nodes.length * 2) return;
    s.nodes.forEach((n, i) => { n.tx = snap.n[i * 2]; n.ty = snap.n[i * 2 + 1]; });
    s.members.forEach((m, i) => {
      m.ratio = (+snap.r[i] || 0) / 9;
      if (snap.b[i] === '1' && !m.broken) { m.broken = true; this._snap(m); if (this.state === 'built') this.toast('💥 Crack! The bridge is breaking!'); }
    });
    this.state = snap.st;
  }

  _snap(m) {
    const s = this.sim, A = s.nodes[m.a], Bn = s.nodes[m.b];
    const geo = m.type === 'road' ? new THREE.BoxGeometry(1, 0.16, 2) : new THREE.CylinderGeometry(0.14, 0.14, 1, 6).rotateZ(-Math.PI / 2);
    for (const f of [0.25, 0.75]) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: BMAT[m.type].hex, flatShading: true }));
      this.toWorld(A.x + (Bn.x - A.x) * f, A.y + (Bn.y - A.y) * f, 0, mesh.position);
      mesh.scale.x = m.L0 / 2;
      this.scene.add(mesh);
      this.debris.push({ mesh, v: new THREE.Vector3(rand(-1, 1), rand(0, 2), rand(-1, 1)), w: new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3)), t: 0 });
    }
    if (this.debris.length > 40) { const d = this.debris.shift(); this.scene.remove(d.mesh); }
  }
  _debris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.t += dt;
      if (d.mesh.position.y > this.W - 0.2) { d.v.y -= 9.8 * dt; d.mesh.rotation.x += d.w.x * dt; d.mesh.rotation.z += d.w.z * dt; }
      else { d.v.multiplyScalar(0.9); d.v.y = -0.15; }
      d.mesh.position.addScaledVector(d.v, dt);
      if (d.t > 6) { this.scene.remove(d.mesh); this.debris.splice(i, 1); }
    }
  }
}
