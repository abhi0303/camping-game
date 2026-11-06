import * as THREE from 'three';
import { GeoBuilder, damp, clamp } from './utils.js';

const COL = {
  jacket: 0x26282d, jacketLt: 0x33363c, shirt: 0xe8e8ea, jeans: 0x3f6fb5, jeansDk: 0x355f9c,
  skin: 0xc98e5e, skinDk: 0xb57d50, hair: 0x2b211d, glass: 0x0e0f11, shoe: 0xf2f2f2, shoeGrey: 0x8d9096, sole: 0xd5d5d5, belt: 0x2a211d, watch: 0x1a1a1a,
};

// Box whose top and bottom have different sizes (gives the faceted low-poly look)
export function tbox(wt, dt, wb, db, h) {
  const g = new THREE.BoxGeometry(1, h, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * (top ? wt : wb));
    p.setZ(i, p.getZ(i) * (top ? dt : db));
  }
  return g;
}

const POSE_KEYS = ['hipsY', 'hipsX', 'spineX', 'spineY', 'spineZ', 'neckX', 'shLx', 'shLz', 'elL', 'shRx', 'shRz', 'elR',
  'hipLx', 'hipLz', 'knL', 'anL', 'hipRx', 'hipRz', 'knR', 'anR'];

export class Character {
  constructor(colors = {}) {
    this.col = { ...COL, ...colors };
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.cur = {}; this.tgt = {};
    POSE_KEYS.forEach(k => { this.cur[k] = 0; this.tgt[k] = 0; });
    this.t = 0; this.phase = 0;
    this.punchT = 1; this.punchHand = 1; this.fightTimer = 0; this.landT = 0; this.swingT = 1; this.swingKind = 'chop'; this.recoilT = 0;
    this._build();
  }

  _mesh(fn) { const b = new GeoBuilder(); fn(b); return b.build(); }

  _build() {
    const K = this.col;
    const j = this.j = {};
    j.hips = new THREE.Group(); j.hips.position.y = 0.94; this.root.add(j.hips);
    j.hips.add(this._mesh(b => {
      b.add(tbox(0.33, 0.21, 0.34, 0.2, 0.2), K.jeans, 0, 0, 0);
      b.box(0.345, 0.035, 0.215, 0, 0.085, 0, K.belt);
      b.box(0.05, 0.03, 0.01, 0, 0.085, 0.11, 0x9a8a6a);
    }));
    // legs
    for (const s of [1, -1]) {
      const hip = new THREE.Group(); hip.position.set(s * 0.095, -0.02, 0); j.hips.add(hip);
      hip.add(this._mesh(b => b.add(tbox(0.17, 0.19, 0.15, 0.165, 0.46), K.jeans, 0, -0.23, 0)));
      const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
      knee.add(this._mesh(b => {
        b.add(tbox(0.15, 0.165, 0.135, 0.15, 0.42), K.jeansDk, 0, -0.2, 0);
        b.box(0.155, 0.06, 0.17, 0, -0.38, 0.0, K.jeans);
      }));
      const ankle = new THREE.Group(); ankle.position.y = -0.375; knee.add(ankle);
      ankle.add(this._mesh(b => {
        b.box(0.14, 0.09, 0.28, 0, -0.025, 0.05, K.shoe);
        b.box(0.145, 0.03, 0.29, 0, -0.07, 0.05, K.sole);
        b.box(0.146, 0.04, 0.14, 0, -0.02, 0.0, K.shoeGrey);
        b.box(0.12, 0.05, 0.06, 0, 0.0, 0.17, K.shoe);
      }));
      const k = s > 0 ? 'L' : 'R';
      j['hip' + k] = hip; j['kn' + k] = knee; j['an' + k] = ankle;
    }
    // torso
    j.spine = new THREE.Group(); j.spine.position.y = 0.09; j.hips.add(j.spine);
    j.spine.add(this._mesh(b => {
      b.add(tbox(0.38, 0.21, 0.31, 0.19, 0.46), K.shirt, 0, 0.23, 0);
      // jacket: back + sides, open at the front
      b.add(tbox(0.43, 0.17, 0.36, 0.15, 0.48), K.jacket, 0, 0.23, -0.035);
      for (const s of [1, -1]) {
        b.add(tbox(0.12, 0.08, 0.1, 0.07, 0.48), K.jacket, s * 0.155, 0.23, 0.075);
        b.box(0.06, 0.2, 0.02, s * 0.115, 0.38, 0.12, K.jacketLt, 'solid', 0, 0, s * 0.3);  // lapel
        b.box(0.07, 0.04, 0.012, s * 0.15, 0.3, 0.118, K.jacketLt);                          // chest pocket
        b.box(0.1, 0.06, 0.2, s * 0.2, 0.47, -0.02, K.jacket);                               // shoulder
      }
      b.box(0.24, 0.07, 0.06, 0, 0.47, -0.1, K.jacketLt);                                     // collar back
      b.box(0.1, 0.04, 0.02, 0, 0.435, 0.1, K.skin);                                         // v-neck
    }));
    j.neck = new THREE.Group(); j.neck.position.y = 0.48; j.spine.add(j.neck);
    j.neck.add(this._mesh(b => b.cyl(0.055, 0.06, 0.1, 6, 0, 0.02, 0, K.skin)));
    j.head = new THREE.Group(); j.head.position.y = 0.07; j.neck.add(j.head);
    j.head.add(this._mesh(b => {
      b.add(tbox(0.2, 0.22, 0.19, 0.2, 0.25), K.skin, 0, 0.12, 0);
      b.box(0.215, 0.07, 0.235, 0, 0.255, -0.005, K.hair);
      b.box(0.17, 0.05, 0.08, 0, 0.29, 0.06, K.hair, 'solid', -0.25, 0, 0);
      b.box(0.215, 0.17, 0.05, 0, 0.17, -0.095, K.hair);
      for (const s of [1, -1]) {
        b.box(0.02, 0.1, 0.14, s * 0.103, 0.2, -0.02, K.hair);
        b.box(0.03, 0.06, 0.04, s * 0.105, 0.13, -0.01, K.skinDk);     // ear
        b.box(0.02, 0.09, 0.13, s * 0.1, 0.055, 0.04, K.hair);        // sideburn/jaw beard
        b.box(0.08, 0.05, 0.02, s * 0.05, 0.155, 0.113, K.glass);     // lens
        b.box(0.01, 0.015, 0.14, s * 0.1, 0.165, 0.04, K.glass);      // temple arm
      }
      b.box(0.03, 0.012, 0.015, 0, 0.165, 0.115, K.glass);            // bridge
      b.box(0.205, 0.06, 0.05, 0, 0.035, 0.09, K.hair);              // beard
      b.box(0.1, 0.02, 0.02, 0, 0.085, 0.112, K.hair);                // moustache
      b.box(0.035, 0.05, 0.04, 0, 0.115, 0.115, K.skinDk);            // nose
    }));
    this.headAnchor = new THREE.Object3D(); this.headAnchor.position.set(0, 0.15, 0.06); j.head.add(this.headAnchor);
    // arms
    for (const s of [1, -1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.255, 0.43, -0.01); j.spine.add(sh);
      sh.add(this._mesh(b => b.add(tbox(0.125, 0.125, 0.105, 0.11, 0.3), K.jacket, 0, -0.14, 0)));
      const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
      el.add(this._mesh(b => {
        b.add(tbox(0.11, 0.115, 0.1, 0.1, 0.07), K.jacketLt, 0, -0.03, 0);   // rolled sleeve
        b.add(tbox(0.085, 0.085, 0.07, 0.07, 0.2), K.skin, 0, -0.15, 0);
        b.box(0.08, 0.025, 0.08, 0, -0.24, 0, s > 0 ? K.watch : 0x2a2a2a);  // watch / band
        b.box(0.075, 0.1, 0.06, 0, -0.3, 0.005, K.skin);                    // hand
        b.box(0.03, 0.05, 0.03, -s * 0.045, -0.29, 0.03, K.skin);            // thumb
      }));
      const k = s > 0 ? 'L' : 'R';
      j['sh' + k] = sh; j['el' + k] = el;
      if (s < 0) { this.hand = new THREE.Group(); this.hand.position.set(0, -0.31, 0.01); el.add(this.hand); } // held items go here
    }
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  }

  // hidden in first-person / cockpit so the camera doesn't see the inside of the head or torso
  // Recolour the outfit in place (vertex colours), e.g. when you get your co-op slot
  setColors(colors) {
    const next = { ...this.col, ...colors }, pairs = [];
    for (const k of ['jacket', 'jacketLt', 'shirt', 'jeans', 'jeansDk']) if (next[k] !== undefined && next[k] !== this.col[k]) pairs.push([new THREE.Color(this.col[k]), new THREE.Color(next[k])]);
    this.col = next;
    if (!pairs.length) return;
    const inHand = o => { for (let p = o; p; p = p.parent) if (p === this.hand) return true; return false; };
    this.root.traverse(o => {
      const c = o.isMesh && !inHand(o) && o.geometry.attributes.color;
      if (!c) return;
      let changed = false;
      for (let i = 0; i < c.count; i++) for (const [from, to] of pairs) {
        if (Math.abs(c.getX(i) - from.r) < 1e-3 && Math.abs(c.getY(i) - from.g) < 1e-3 && Math.abs(c.getZ(i) - from.b) < 1e-3) { c.setXYZ(i, to.r, to.g, to.b); changed = true; break; }
      }
      if (changed) c.needsUpdate = true;
    });
  }
  setHeadVisible(v) { this.j.head.visible = v; this.j.neck.children[0].visible = v; this.j.spine.children[0].visible = v; }

  punch() {
    if (this.punchT < 0.6) return false;
    this.punchHand *= -1; this.punchT = 0; this.fightTimer = 2.2;
    return true;
  }
  land(strength) { this.landT = clamp(strength, 0, 1); }
  recoil() { this.recoilT = 1; }
  // Tool swing: 'chop' (overhead strike) or 'saw' (push forward + vibrate); 'kick': a football kick
  swing(kind) {
    if (this.swingT < 1) return false;
    this.swingT = 0; this.swingKind = kind;
    return true;
  }

  // s: { mode, speed, vy, steer }
  update(dt, s) {
    this.t += dt;
    const T = this.tgt, t = this.t;
    POSE_KEYS.forEach(k => T[k] = 0);
    let rate = 14;
    this.punchT = Math.min(1, this.punchT + dt / 0.32);
    this.fightTimer = Math.max(0, this.fightTimer - dt);
    this.landT = Math.max(0, this.landT - dt * 4);
    this.recoilT = Math.max(0, this.recoilT - dt * 5);
    this.swingT = Math.min(1, this.swingT + dt / (this.swingKind === 'saw' ? 0.6 : this.swingKind === 'kick' ? 0.42 : 0.5));
    const mode = s.mode;

    // idle base
    const br = Math.sin(t * 2.1) * 0.025;
    T.spineX = 0.02 + br; T.neckX = -br; T.shLz = 0.1; T.shRz = -0.1; T.elL = -0.15; T.elR = -0.15;
    T.shLx = Math.sin(t * 1.1) * 0.03; T.shRx = -Math.sin(t * 1.1) * 0.03;

    if (mode === 'walk' || mode === 'run' || mode === 'crouch') {
      const run = mode === 'run', crouch = mode === 'crouch';
      const spd = s.speed;
      this.phase += dt * spd * (run ? 1.55 : 2.3) * (crouch ? 1.3 : 1);
      const p = this.phase, sp = Math.sin(p), cp = Math.cos(p);
      const A = clamp(spd / (run ? 5 : 2.2), 0, 1) * (run ? 0.95 : 0.5);
      T.hipLx = -sp * A; T.hipRx = sp * A;
      T.knL = Math.max(0, cp) * A * (run ? 2.0 : 1.4) + (run ? 0.25 : 0.06) * (A > 0.05 ? 1 : 0);
      T.knR = Math.max(0, -cp) * A * (run ? 2.0 : 1.4) + (run ? 0.25 : 0.06) * (A > 0.05 ? 1 : 0);
      T.anL = -(T.hipLx + T.knL) * 0.6; T.anR = -(T.hipRx + T.knR) * 0.6;
      T.shLx = sp * A * (run ? 1.0 : 0.8); T.shRx = -sp * A * (run ? 1.0 : 0.8);
      T.elL = run ? -1.45 : -0.25 - Math.max(0, -sp) * 0.3; T.elR = run ? -1.45 : -0.25 - Math.max(0, sp) * 0.3;
      T.spineY = sp * A * 0.15; T.spineX = run ? 0.28 : 0.06;
      T.hipsY = -Math.abs(sp) * (run ? 0.06 : 0.03) + (run ? 0.02 : 0);
      if (crouch) {
        T.hipsY = -0.45; T.spineX = 0.42; T.neckX = -0.35;
        T.hipLx = -1.25 - sp * 0.2; T.hipRx = -1.25 + sp * 0.2;
        T.knL = 2.1 + Math.max(0, cp) * 0.2; T.knR = 2.1 + Math.max(0, -cp) * 0.2;
        T.anL = -0.85; T.anR = -0.85;
        T.shLx = -0.75 + sp * 0.15; T.shRx = -0.75 - sp * 0.15; T.elL = -0.7; T.elR = -0.7;
        T.hipLz = 0.12; T.hipRz = -0.12;
      }
    } else if (mode === 'jump') {
      const up = clamp(s.vy / 4, -1, 1);
      T.hipLx = -0.75; T.knL = 1.3; T.hipRx = -0.15 + (1 - up) * 0.1; T.knR = 0.55;
      T.anL = -0.3; T.anR = -0.2;
      T.shLx = -2.4; T.shLz = 0.45; T.elL = -0.7; T.shRx = -2.4; T.shRz = -0.45; T.elR = -0.7;
      T.spineX = 0.05; rate = 10;
    } else if (mode === 'sit' || mode === 'drive') {
      T.hipLx = -1.52; T.hipRx = -1.52; T.knL = 1.5; T.knR = 1.5; T.anL = 0; T.anR = 0;
      T.hipLz = 0.06; T.hipRz = -0.06; T.spineX = -0.06;
      T.shLx = -0.35; T.shRx = -0.35; T.elL = -0.95; T.elR = -0.95; T.shLz = 0.12; T.shRz = -0.12;
      if (mode === 'drive') {
        T.hipLx = -1.42; T.hipRx = -1.42; T.knL = 1.3; T.knR = 1.3; T.spineX = -0.02;
        const st = (s.steer || 0) * 0.5;
        T.shLx = -0.45 + st; T.shRx = -0.45 - st; T.elL = -1.6; T.elR = -1.6;
        T.shLz = -0.06; T.shRz = 0.06; T.spineZ = -st * 0.1;
      }
      rate = 9;
    } else if (mode === 'lie') {
      T.knL = 0.15; T.knR = 0.25; T.hipLx = -0.1; T.hipRx = -0.18; T.anL = 0.5; T.anR = 0.5;
      T.shLx = -2.85; T.shLz = 0.35; T.elL = -1.7;
      T.shRx = 0.05; T.shRz = -0.12; T.elR = -0.3;
      T.spineX = 0; T.neckX = 0.2; rate = 8;
    } else if (mode === 'downed') {
      // hurt and lying on the ground (the root is tipped onto its back by the player pitch)
      const br2 = Math.sin(t * 3) * 0.04;
      T.knL = 0.35; T.knR = 0.12; T.hipLx = -0.3; T.hipRx = -0.05; T.anL = 0.3; T.anR = 0.4;
      T.shLx = -0.2; T.shLz = 0.55 + br2; T.elL = -0.5; T.shRx = -0.6; T.shRz = -0.4; T.elR = -1.2;
      T.spineX = -0.05 + br2; T.neckX = 0.25; T.spineZ = 0.08; rate = 6;
    } else if (mode === 'climb') {
      this.phase += dt * 5;
      const sp = Math.sin(this.phase);
      T.hipLx = -0.9 - sp * 0.45; T.knL = 1.3 + sp * 0.5; T.hipRx = -0.9 + sp * 0.45; T.knR = 1.3 - sp * 0.5;
      T.anL = -0.3; T.anR = -0.3;
      T.shLx = -2.6 + sp * 0.35; T.shRx = -2.6 - sp * 0.35; T.elL = -0.55; T.elR = -0.55;
      T.shLz = 0.15; T.shRz = -0.15; T.spineX = 0.05;
    }

    // fight stance + punches (on foot only)
    if (this.fightTimer > 0 && (mode === 'idle' || mode === 'walk')) {
      const e = this.punchT < 1 ? Math.sin(this.punchT * Math.PI) : 0;
      T.spineX = 0.12; T.spineY = 0.25; T.neckX = -0.1;
      T.shLx = -1.25; T.shLz = 0.25; T.elL = -2.0;
      T.shRx = -1.1; T.shRz = -0.3; T.elR = -2.15;
      if (mode === 'idle') { T.hipLx = -0.28; T.hipRx = 0.25; T.knL = 0.3; T.knR = 0.25; T.anL = 0; T.anR = -0.25; T.hipsY = -0.05; }
      if (this.punchHand > 0) { T.shRx = -1.1 - 0.5 * e; T.elR = -2.15 + 2.1 * e; T.shRz = -0.3 + 0.25 * e; T.spineY = 0.25 - 0.65 * e; }
      else { T.shLx = -1.25 - 0.35 * e; T.elL = -2.0 + 1.95 * e; T.shLz = 0.25 - 0.2 * e; T.spineY = 0.25 + 0.3 * e; }
      rate = 22;
    }
    // holding an item
    const hold = s.hold, onFoot = mode === 'idle' || mode === 'walk' || mode === 'run' || mode === 'crouch';
    if (hold && onFoot) {
      if (hold === 'tool') { T.shRx = T.shRx * 0.4 - 0.2; T.elR = -0.55; }
      else if (hold === 'saw') { T.shLx = T.shRx = -0.8; T.elL = T.elR = -0.65; T.shLz = -0.2; T.shRz = 0.2; }
      else if (hold === 'aim') { T.shRx = -0.95; T.elR = -0.5; T.shRz = -0.05; }
      else if (hold === 'carry') { T.shRz = -0.18; T.elR = -0.2; T.shRx *= 0.4; }
      else if (hold === 'controller') { T.shLx = T.shRx = -0.55; T.elL = T.elR = -1.45; T.shLz = -0.28; T.shRz = 0.28; T.neckX = 0.3; }
      else if (hold === 'binoculars') { T.shLx = T.shRx = -1.35; T.elL = T.elR = -2.25; T.shLz = -0.3; T.shRz = 0.3; }
      // fishing: the rod held out over the water, swung back over the head to cast, raised to pull
      else if (hold === 'rod') { T.shRx = -0.45; T.elR = -0.75; T.shRz = 0.06; T.shLx = -0.55; T.elL = -1.2; T.shLz = -0.5; }
      else if (hold === 'rodCast') { T.shRx = -2.75; T.elR = -0.45; T.shRz = 0.1; T.shLx = -1.5; T.elL = -1.1; T.shLz = -0.35; T.spineX = -0.12; }
      else if (hold === 'rodPull') { T.shRx = -0.95; T.elR = -1.35; T.shRz = 0.1; T.shLx = -0.9; T.elL = -1.65; T.shLz = -0.5; T.spineX = -0.16; }
      else if (hold === 'gun') {
        // both hands on the shotgun, pointing where you aim (s.aim = pitch up/down)
        const ap = s.aim || 0, k = this.recoilT;
        T.shRx = -1.2 - ap - 0.45 * k; T.elR = -0.37 + 0.15 * k; T.shRz = -0.08;
        T.shLx = -1.42 - ap - 0.35 * k; T.shLz = -0.62; T.elL = -0.22;
        T.spineY = 0.12; T.spineX = (mode === 'run' ? 0.12 : 0.05) - 0.08 * k; T.neckX = -0.1 - ap * 0.5;
        rate = 20;
      } else if (hold === 'carryP') {
        // a teammate over the shoulders: both arms up holding them
        T.shLx = -2.35; T.shLz = 0.25; T.elL = -1.75; T.shRx = -2.35; T.shRz = -0.25; T.elR = -1.75; T.spineX = 0.18;
      }
    }
    if (this.swingT < 1 && onFoot) {
      const t = this.swingT, L = (a, b, k) => a + (b - a) * k;
      if (this.swingKind === 'kick') {                       // a football kick: the right leg back, then through the ball
        let hip, kn;
        if (t < 0.32) { const k = t / 0.32; hip = L(0, 0.75, k); kn = L(0.1, 1.35, k); }
        else if (t < 0.55) { const k = (t - 0.32) / 0.23; hip = L(0.75, -1.05, k); kn = L(1.35, 0.1, k); }
        else { const k = (t - 0.55) / 0.45; hip = L(-1.05, T.hipRx, k); kn = L(0.1, T.knR, k); }
        T.hipRx = hip; T.knR = kn; T.shLx = -hip * 0.45; T.shRx = hip * 0.35; T.shLz = -0.35; T.shRz = 0.3; T.spineX = 0.08 - Math.min(0, hip) * 0.12;
      } else if (this.swingKind === 'saw') {
        const v = Math.sin(t * 90) * 0.05;
        T.shLx = T.shRx = -0.55 + v; T.elL = T.elR = -0.35; T.spineX = 0.3; T.shLz = -0.2; T.shRz = 0.2;
      } else {
        let sh, el;
        if (t < 0.35) { const k = t / 0.35; sh = L(-0.3, -2.8, k); el = L(-0.5, -1.3, k); }
        else if (t < 0.55) { const k = (t - 0.35) / 0.2; sh = L(-2.8, -0.35, k); el = L(-1.3, -0.15, k); }
        else { const k = (t - 0.55) / 0.45; sh = L(-0.35, T.shRx, k); el = L(-0.15, T.elR, k); }
        T.shRx = sh; T.elR = el; T.shLx = sh * 0.85; T.elL = el; T.shLz = -0.12; T.shRz = 0.05;
        if (t > 0.3 && t < 0.7) T.spineX += 0.25;
      }
      rate = 30;
    }
    if (this.landT > 0 && mode !== 'jump') {
      T.hipsY -= this.landT * 0.12; T.knL += this.landT * 0.4; T.knR += this.landT * 0.4; T.hipLx -= this.landT * 0.2; T.hipRx -= this.landT * 0.2;
    }

    const C = this.cur;
    POSE_KEYS.forEach(k => { C[k] = damp(C[k], T[k], rate, dt); });
    const j = this.j;
    j.hips.position.y = 0.94 + C.hipsY; j.hips.rotation.x = C.hipsX;
    j.spine.rotation.set(C.spineX, C.spineY, C.spineZ);
    j.neck.rotation.x = C.neckX;
    j.shL.rotation.set(C.shLx, 0, C.shLz); j.elL.rotation.x = C.elL;
    j.shR.rotation.set(C.shRx, 0, C.shRz); j.elR.rotation.x = C.elR;
    j.hipL.rotation.set(C.hipLx, 0, C.hipLz); j.knL.rotation.x = C.knL; j.anL.rotation.x = C.anL;
    j.hipR.rotation.set(C.hipRx, 0, C.hipRz); j.knR.rotation.x = C.knR; j.anR.rotation.x = C.anR;
  }

  // Snap pose instantly (used when teleporting into seats)
  snap() { POSE_KEYS.forEach(k => { this.cur[k] = this.tgt[k]; }); }
}
