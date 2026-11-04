// Birds in the daytime: a few circling high over the player, and a few sitting on the tops of nearby jungle
// trees (now and then one flies off to another tree). Low-poly, flapping wings. They roost at night.
// Ambience asks perched() for where the birdsong comes from.
import * as THREE from 'three';

const FLYERS = 3, PERCHED = 3;
const COLORS = [[0xd63a2a, 0x1f3f8a], [0x2a7fd6, 0xf2c14e], [0x2b2b30, 0xf2a03a], [0xf2c14e, 0x3a8a3a], [0x3fae6a, 0xd63a2a]];
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function birdMesh(body, wing) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: body, flatShading: true });
  const wmat = new THREE.MeshLambertMaterial({ color: wing, flatShading: true, side: THREE.DoubleSide });
  const beakM = new THREE.MeshLambertMaterial({ color: 0xf2a03a, flatShading: true });
  const torso = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), mat);
  torso.scale.set(0.42, 0.42, 0.95); g.add(torso);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), mat);
  head.position.set(0, 0.16, 0.42); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), beakM);
  beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.14, 0.64); g.add(beak);
  const tailG = new THREE.BufferGeometry();
  tailG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.02, -0.35, -0.16, 0.06, -0.78, 0.16, 0.06, -0.78], 3)); tailG.computeVertexNormals();
  g.add(new THREE.Mesh(tailG, wmat));
  const wingG = new THREE.BufferGeometry();     // a wing: root along the body, tip out to the side
  wingG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.22, 0, 0, -0.22, 0.85, 0.02, -0.12, 0, 0, 0.22, 0.85, 0.02, -0.12, 0.62, 0.02, 0.12], 3)); wingG.computeVertexNormals();
  const wl = new THREE.Group(), wr = new THREE.Group();
  wl.add(new THREE.Mesh(wingG, wmat)); const mr = new THREE.Mesh(wingG, wmat); mr.scale.x = -1; wr.add(mr);
  wl.position.set(0.12, 0.08, 0.04); wr.position.set(-0.12, 0.08, 0.04);
  g.add(wl, wr);
  g.userData = { wl, wr, head };
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}

export class Birds {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.t = 0; this.vis = 0;
    this.root = new THREE.Group(); scene.add(this.root);
    this.fly = []; this.perch = [];
    for (let i = 0; i < FLYERS; i++) {
      const c = COLORS[i % COLORS.length], m = birdMesh(c[0], c[1]);
      m.scale.setScalar(1.15);
      this.root.add(m);
      this.fly.push({ m, a: i * 2.1, r: 16 + i * 7, h: 20 + i * 5, w: (i % 2 ? -1 : 1) * (0.22 + i * 0.05), ph: i * 1.3, glide: 0, cx: 0, cz: 0 });
    }
    for (let i = 0; i < PERCHED; i++) {
      const c = COLORS[(i + 2) % COLORS.length], m = birdMesh(c[0], c[1]);
      m.scale.setScalar(0.85); m.visible = false;
      this.root.add(m);
      this.perch.push({ m, st: 'none', at: null, from: new THREE.Vector3(), to: new THREE.Vector3(), k: 0, dur: 4, next: 20 + i * 15, look: 0, hop: 0, yaw: 0 });
    }
    this._v = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.center = null;
  }
  // where perched birds sit (for the birdsong)
  perched() { return this.vis > 0.5 ? this.perch.filter(b => b.st === 'sit').map(b => b.m.position) : []; }

  // a jungle tree crown top near (x, z), not taken by another bird
  _spot(x, z, minD, maxD) {
    const W = this.world, tops = W.treeTops || {}, list = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      W.forNear(x + Math.cos(a) * d, z + Math.sin(a) * d, c => { if (c.tree && tops[c.kind] && !list.includes(c)) list.push(c); });
      if (list.length > 12) break;
    }
    const free = list.filter(c => { const d = Math.hypot(c.x - x, c.z - z); return d > minD && d < maxD + 10 && !this.perch.some(b => b.at === c); });
    if (!free.length) return null;
    const c = free[Math.floor(Math.random() * free.length)], top = tops[c.kind][Math.floor(Math.random() * Math.min(2, tops[c.kind].length))];
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), lx = top[0] * c.sc, lz = top[2] * c.sc;
    // (a rotation about Y by yaw: x' = x cos + z sin, z' = -x sin + z cos)
    return { c, p: new THREE.Vector3(c.x + lx * cs + lz * sn, c.y + top[1] * c.sc + 0.18, c.z - lx * sn + lz * cs) };
  }
  _flap(m, k, speed) {
    const u = m.userData, a = Math.sin(this.t * speed + m.id) * 0.9 * k + 0.12;
    u.wl.rotation.set(0, 0, a); u.wr.rotation.set(0, 0, -a);
  }

  // dark: 0 day .. 1 night · focus: the player (or the RV)
  update(dt, focus, dark) {
    this.t += dt;
    const want = dark < 0.55 ? 1 : 0;
    this.vis = damp(this.vis, want, 1.5, dt);
    const on = this.vis > 0.05;
    this.root.visible = on;
    if (!on) { for (const b of this.perch) { b.st = 'none'; b.at = null; b.m.visible = false; } this.center = null; return; }
    const W = this.world;
    // flyers: wide circles that drift after the player; flap a while, then glide
    for (const b of this.fly) {
      b.cx = damp(b.cx || focus.x, focus.x, 0.15, dt); b.cz = damp(b.cz || focus.z, focus.z, 0.15, dt);
      b.a += b.w * dt; b.glide -= dt;
      if (b.glide < -3 - Math.random() * 3) b.glide = 2 + Math.random() * 3;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r * 0.8;
      const y = W.heightAt(b.cx, b.cz) + b.h + Math.sin(this.t * 0.4 + b.ph) * 2;
      const m = b.m;
      m.position.set(x, Math.max(y, W.W + 8), z);
      const dx = -Math.sin(b.a) * b.w, dz = Math.cos(b.a) * 0.8 * b.w;
      m.rotation.set(0, Math.atan2(dx, dz), -Math.sign(b.w) * 0.35, 'YXZ');
      this._flap(m, b.glide > 0 ? 0.1 : 1, 13);
      m.scale.setScalar(1.15 * this.vis);
    }
    // perched birds: pick trees around the player; re-pick when the player has moved on
    if (!this.center || Math.hypot(focus.x - this.center.x, focus.z - this.center.z) > 55) {
      this.center = { x: focus.x, z: focus.z };
      for (const b of this.perch) if (b.st !== 'fly') b.st = 'none';
    }
    for (const b of this.perch) {
      const m = b.m;
      if (b.st === 'none') {
        const s = this._spot(this.center.x, this.center.z, 12, 38);
        if (!s) { m.visible = false; continue; }
        b.at = s.c; b.to.copy(s.p); b.st = 'sit'; m.visible = true; m.position.copy(s.p); b.yaw = Math.random() * 6.28; b.next = 25 + Math.random() * 40;
      }
      if (b.st === 'sit') {
        b.next -= dt; b.look -= dt; b.hop = Math.max(0, b.hop - dt);
        if (b.look < 0) { b.look = 0.8 + Math.random() * 2.5; b.yawTo = b.yaw + (Math.random() - 0.5) * 2.2; if (Math.random() < 0.3) b.hop = 0.25; }
        b.yaw = damp(b.yaw, b.yawTo ?? b.yaw, 6, dt);
        m.position.set(b.to.x, b.to.y + Math.sin(Math.min(1, b.hop / 0.25) * Math.PI) * 0.12, b.to.z);
        m.rotation.set(-0.15, b.yaw, 0, 'YXZ');
        m.userData.head.rotation.y = Math.sin(this.t * 2.3 + m.id) * 0.5;
        const u = m.userData; u.wl.rotation.set(0, 1.4, -0.15); u.wr.rotation.set(0, -1.4, 0.15);   // wings folded back along the body
        if (b.next < 0) {                                                           // off to another tree
          const s = this._spot(this.center.x, this.center.z, 10, 40);
          if (s) { b.from.copy(b.to); b.to.copy(s.p); b.at = s.c; b.k = 0; b.dur = 2.5 + b.from.distanceTo(b.to) / 9; b.st = 'fly'; } else b.next = 20;
        }
      } else if (b.st === 'fly') {
        b.k = Math.min(1, b.k + dt / b.dur);
        const k = b.k, e = k * k * (3 - 2 * k);
        this._p.lerpVectors(b.from, b.to, e); this._p.y += Math.sin(k * Math.PI) * 6;
        this._v.subVectors(this._p, m.position);
        if (this._v.lengthSq() > 1e-6) m.rotation.set(0, Math.atan2(this._v.x, this._v.z), 0, 'YXZ');
        m.position.copy(this._p);
        this._flap(m, k > 0.85 ? 0.4 : 1, 16);
        if (k >= 1) { b.st = 'sit'; b.next = 25 + Math.random() * 45; }
      }
      m.scale.setScalar(0.85 * this.vis);
    }
  }
}
