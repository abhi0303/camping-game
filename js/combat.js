import * as THREE from 'three';
import { audio } from './audio.js';
import { clamp } from './utils.js';

// Pump shotgun with unlimited ammo. Every player has one (G to take it out).
const PELLETS = 8, SPREAD = 0.065, RANGE = 36, DMG = 15, COOLDOWN = 0.85;
export const MUZZLE = new THREE.Vector3(0, -0.66, 0.062);

/* ---------- muzzle flash (shared geometry/material, one small mesh per gun) ---------- */
const flashGeo = (() => {
  const a = new THREE.PlaneGeometry(0.2, 0.36), b = new THREE.PlaneGeometry(0.2, 0.36);
  b.rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array, pb = b.attributes.position.array, ia = a.index.array, ib = b.index.array;
  const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
  const idx = [...ia, ...Array.from(ib, i => i + pa.length / 3)];
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  g.translate(0, -0.17, 0);
  return g;
})();
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcf73, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
// the muzzle point of a shotgun model (adds the flash mesh the first time)
export function muzzleOf(model) {
  let m = model.getObjectByName('muzzle');
  if (!m) {
    m = new THREE.Object3D(); m.name = 'muzzle'; m.position.copy(MUZZLE); model.add(m);
    const f = new THREE.Mesh(flashGeo, flashMat); f.name = 'flash'; f.visible = false; f.frustumCulled = false; m.add(f);
  }
  return m;
}

/* ---------- pellet streaks: one line buffer for every shot in the game ---------- */
export class Tracers {
  constructor(scene, n = 96) {
    this.n = n; this.i = 0; this.live = 0;
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 6); this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('color', this.ca);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  add(a, b) {
    const k = this.i; this.i = (this.i + 1) % this.n;
    const p = this.pos, o = k * 6, s = 0.25;
    p[o] = a.x + (b.x - a.x) * s; p[o + 1] = a.y + (b.y - a.y) * s; p[o + 2] = a.z + (b.z - a.z) * s;
    p[o + 3] = b.x; p[o + 4] = b.y; p[o + 5] = b.z;
    this.life[k] = 1; this.live = 0.2;
  }
  update(dt) {
    if (this.live <= 0) return;
    this.live -= dt;
    for (let k = 0; k < this.n; k++) {
      let l = this.life[k];
      if (l <= 0) continue;
      l = Math.max(0, l - dt / 0.1); this.life[k] = l;
      const o = k * 6, c = this.col;
      c[o] = 0.35 * l; c[o + 1] = 0.3 * l; c[o + 2] = 0.2 * l;      // faint tail
      c[o + 3] = 1 * l; c[o + 4] = 0.85 * l; c[o + 5] = 0.5 * l;    // bright head
      if (l <= 0) for (let j = 0; j < 6; j++) c[o + j] = 0;
    }
    this.pa.needsUpdate = true; this.ca.needsUpdate = true;
  }
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _aim = new THREE.Vector3(), _pd = new THREE.Vector3(), _end = new THREE.Vector3(), _w = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _r = new THREE.Vector3(), _u = new THREE.Vector3();

// spread pellets around `dir` (writes into out)
function spread(dir, amt, out) {
  _r.crossVectors(dir, _up); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize();
  _u.crossVectors(_r, dir).normalize();
  const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * amt;
  return out.copy(dir).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();
}
// distance along a ray to the terrain (coarse 1 m march, then refine)
export function terrainT(world, o, d, maxT) {
  let prev = 0;
  for (let t = 0.5; t <= maxT; t += 1) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y < world.heightAt(x, z)) {
      let a = prev, b = t;
      for (let i = 0; i < 5; i++) { const m = (a + b) / 2; if (o.y + d.y * m < world.heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
      return a;
    }
    prev = t;
  }
  return maxT;
}

export class Combat {
  constructor(g) {   // { camera, rig, player, gear, zombies, tracers, world, toast, onHits }
    this.g = g; this.cd = 0; this.shots = 0; this.flashT = 0; this.hitT = 0; this.warnT = 0;
    this.cross = document.getElementById('cross');
  }
  get out() { return this.g.gear.gunOut; }
  canDraw() {
    const p = this.g.player;
    return (p.mode === 'foot' || p.mode === 'inside' || p.mode === 'tween') && !p.downed && !p.carrying && !this.g.gear.drone.active;
  }
  setOut(on) {
    const gear = this.g.gear;
    if (!!on === !!gear.gunOut) return;
    if (on && !this.canDraw()) return;
    gear.gunOut = !!on;
    if (on && gear.inv.equipped >= 0) { gear.inv.equipped = -1; gear.inv._changed(); }
    if (on) gear.zooming = false;
    gear.refreshHeld();
    audio.click();
  }
  toggle() {
    if (!this.out && !this.canDraw()) { this.g.toast(this.g.player.downed ? 'You are down!' : 'Take the shotgun out on foot'); return; }
    this.setOut(!this.out);
    this.g.toast(this.out ? '🔫 Shotgun ready — click / F to shoot (unlimited ammo) · G to put it away' : 'Shotgun put away');
  }

  update(dt, input) {
    const g = this.g, p = g.player;
    this.cd -= dt; this.hitT -= dt;
    if (this.out && (p.downed || p.carrying || g.gear.drone.active)) this.setOut(false);
    p.aiming = this.out && p.mode === 'foot' && !p.downed;
    if (p.aiming) { g.camera.getWorldDirection(_d); p.aimPitch = Math.asin(clamp(_d.y, -1, 1)); } else p.aimPitch = 0;
    if (this.cross) {
      const show = p.aiming && !g.gear.zooming;
      if (show !== this._crossOn) { this._crossOn = show; this.cross.classList.toggle('hidden', !show); }
      const hit = this.hitT > 0;
      if (hit !== this._hitOn) { this._hitOn = hit; this.cross.classList.toggle('hit', hit); }
    }
    const trigger = input.click || input.isDown('KeyF');
    if (p.aiming && trigger && this.cd <= 0) this.fire();
    else if (this.out && p.mode === 'inside' && (input.click || input.wasPressed('KeyF')) && performance.now() - this.warnT > 3000) { this.warnT = performance.now(); g.toast('No shooting inside the RV — go outside or up on the roof'); }
    // muzzle flash
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0 && this.flash) this.flash.visible = false; }
  }

  fire() {
    const g = this.g, p = g.player, cam = g.camera, Z = g.zombies;
    this.cd = COOLDOWN; this.shots++;
    p.char.root.updateMatrixWorld(true);
    const gun = g.gear.held; if (!gun) return;
    const mz = muzzleOf(gun);
    mz.getWorldPosition(_m);
    // what is under the crosshair? (start the camera ray at the player so nothing behind you counts)
    cam.getWorldDirection(_d); _o.copy(cam.position);
    p.char.root.getWorldPosition(_w);
    const t0 = Math.max(0, _w.sub(_o).dot(_d));
    const hit = Z.raycast(_o, _d, 70, t0);
    if (hit) _aim.copy(_o).addScaledVector(_d, hit.t);
    else if (!Z.assist(_m, _d, 0.085, 40, _aim)) _aim.copy(_o).addScaledVector(_d, terrainT(g.world, _o, _d, 70));
    _aim.sub(_m); const dist = _aim.length(); _aim.normalize();
    if (dist < 0.5) _aim.copy(_d);
    // pellets
    const hits = new Map();
    const tMax = terrainT(g.world, _m, _aim, RANGE);
    for (let i = 0; i < PELLETS; i++) {
      spread(_aim, SPREAD, _pd);
      const h = Z.raycast(_m, _pd, Math.min(RANGE, tMax + 1));
      const t = h ? h.t : Math.min(RANGE, tMax);
      _end.copy(_m).addScaledVector(_pd, t);
      g.tracers.add(_m, _end);
      if (h) {
        const fall = h.t < 10 ? 1 : clamp(1 - (h.t - 10) / 26 * 0.65, 0.35, 1);
        hits.set(h.z.id, (hits.get(h.z.id) || 0) + DMG * fall);
      }
    }
    if (hits.size) { this.hitT = 0.18; g.onHits(hits, _aim.x, _aim.z); }
    // feedback
    this.flash = mz.getObjectByName('flash'); this.flash.visible = true; this.flash.rotation.y = Math.random() * 3; this.flashT = 0.06;
    p.char.recoil();
    g.rig.pitch += 0.035;
    audio.shot(1);
  }
}

// a teammate fired: same flash, streaks and sound on our screen (damage is theirs to send)
const _rd = new THREE.Vector3();
export function remoteShot(model, yaw, pitch, tracers, listener) {
  const mz = muzzleOf(model);
  mz.getWorldPosition(_m);
  _rd.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  for (let i = 0; i < PELLETS; i++) { spread(_rd, SPREAD, _pd); tracers.add(_m, _end.copy(_m).addScaledVector(_pd, 22 + Math.random() * 10)); }
  const f = mz.getObjectByName('flash'); f.visible = true; f.rotation.y = Math.random() * 3;
  setTimeout(() => { f.visible = false; }, 60);
  const d = listener ? _m.distanceTo(listener) : 10;
  audio.shot(clamp(1 - d / 80, 0.05, 0.8));
}
