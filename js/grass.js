// Grass tufts and wild flowers around the player, standing on the painted meadow (js/terrain.js):
//   small, medium and tall tufts of low-poly blades (darker at the base, lighter yellow-green tips, swaying a
//   little in the wind), white daisies, yellow flowers and purple lavender. They grow in natural patches —
//   thick in some places, open ground in others, flowers in little groups — never on dirt, roads, river banks,
//   cliffs, farm pens or paths.
// Six instanced meshes (one draw call each). They cover a circle around the player; when the player has
// moved a few metres the circle is filled again, a slice per frame, so the game never stutters. Every spot
// on the map always gets the same plant (from the spot's own hash), so nothing jumps around as you walk.
// The circle's size and density follow the graphics quality.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUND, MUD_T, TONE_STEPS } from './terrain.js';
import { RIVER_HALF, START, CAMP, GIANT, TOWER_ZONE } from './terrain.js';

const QUALITY = { low: { r: 18, step: 0.95 }, medium: { r: 28, step: 0.72 }, high: { r: 38, step: 0.62 } };
const SNAP = 4;                  // refill after moving this far
const PER_FRAME = 2200;          // spots checked per frame while refilling

// the shader's hash / noise in JS (js/terrain.js GROUND_GLSL), so plants match the painted meadow and dirt
const fract = x => x - Math.floor(x);
function gh12(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function gnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = gh12(ix, iy), b = gh12(ix + 1, iy), c = gh12(ix, iy + 1), d = gh12(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}
export const mudAt = (x, z) => gnoise(x * 0.065, z * 0.065) * 0.55 + gnoise(x * 0.17 + 7.3, z * 0.17 + 7.3) * 0.3 + gnoise(x * 0.5 - 3.1, z * 0.5 - 3.1) * 0.15;
const toneAt = (x, z) => Math.min(1, Math.max(0, gnoise(x * 0.11, z * 0.11) * 0.7 + gnoise(x * 0.031, z * 0.031) * 0.5 - 0.12));
const PAL = [GROUND.g0, GROUND.g1, GROUND.g2, GROUND.g3].map(h => new THREE.Color(h));
const palAt = t => PAL[t < TONE_STEPS[0] ? 0 : t < TONE_STEPS[1] ? 1 : t < TONE_STEPS[2] ? 2 : 3];

/* ---------- models (vertex colours; tufts are tinted per instance, flowers keep their colours) ---------- */
const col3 = (g, fn) => {          // colour every vertex: fn(y) -> [r, g, b]
  const pos = g.attributes.position, c = [];
  for (let k = 0; k < pos.count; k++) c.push(...fn(pos.getY(k)));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
};
const solid = hex => { const c = new THREE.Color(hex); return () => [c.r, c.g, c.b]; };
const clean = g => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); return g; };
// one blade: a flat three-sided cone leaning out, dark at the base and light yellow-green at the tip (x tint)
function blade(h, w, a, lean, out) {
  const g = new THREE.ConeGeometry(w, h, 3, 1, true);
  g.translate(0, h / 2, 0); g.scale(1, 1, 0.32);
  g.rotateY(Math.PI / 2 - a);
  const ax = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));                    // lean away from the centre
  g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(ax, -lean));
  g.translate(Math.cos(a) * out, 0, Math.sin(a) * out);
  return col3(clean(g), y => { const t = Math.max(0, Math.min(1, y / h)); return [0.74 + 0.62 * t, 0.8 + 0.46 * t, 0.66 + 0.26 * t]; });
}
function tuft(n, hMin, hMax, w, seed) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const r = k => fract(Math.sin((i + 1) * 12.9898 * k + seed * 78.233) * 43758.5453);
    const a = i / n * Math.PI * 2 + r(1) * 0.9, h = hMin + (hMax - hMin) * r(2), lean = 0.18 + r(3) * 0.5;
    parts.push(blade(h, w * (0.8 + r(4) * 0.4), a, lean, 0.02 + r(5) * 0.07));
  }
  const m = mergeGeometries(parts); m.computeVertexNormals(); return m;
}
function stem(h, lean = 0) {
  const g = new THREE.CylinderGeometry(0.008, 0.012, h, 4, 1, true); g.translate(0, h / 2, 0); g.rotateZ(lean);
  return col3(clean(g), solid(0x4f9a30));
}
function leafPair(h) {
  return [0.6, 3.6].map(a => col3(blade(h, 0.035, a, 0.7, 0.01), y => { const t = Math.max(0, Math.min(1, y / h)); return [0.32 + 0.25 * t, 0.6 + 0.2 * t, 0.2 + 0.1 * t]; }));
}
// a flower head: a ring of petals (a flat low-poly disc) with a raised centre
function head(r, petals, petal, centre, y, tilt = 0.25) {
  const disc = col3(clean(new THREE.CylinderGeometry(r, r * 0.55, 0.02, petals)), solid(petal));
  const mid = col3(clean(new THREE.CylinderGeometry(r * 0.38, r * 0.42, 0.035, 6)), solid(centre)); mid.translate(0, 0.02, 0);
  const g = mergeGeometries([disc, mid]); g.rotateX(tilt); g.translate(0, y, 0);
  return g;
}
function daisy() {
  const m = mergeGeometries([stem(0.34, 0.06), head(0.075, 8, 0xf7f6ef, 0xf2c230, 0.34), ...leafPair(0.13)]); m.computeVertexNormals(); return m;
}
function yellowFlower() {
  const h2 = head(0.05, 6, 0xffdd40, 0xf0a020, 0.215, 0.5), s2 = stem(0.22, 0.25);
  h2.translate(-0.05, 0, 0);
  const m = mergeGeometries([stem(0.3, -0.08), head(0.07, 6, 0xffd83a, 0xf0a020, 0.3), s2, h2, ...leafPair(0.12)]); m.computeVertexNormals(); return m;
}
function lavender() {
  const parts = [...leafPair(0.15)];
  [[0, 0, 0.42], [0.06, 0.03, 0.34], [-0.05, 0.04, 0.37]].forEach(([x, z, h]) => {
    const s = stem(h); s.translate(x, 0, z); parts.push(s);
    for (let k = 0; k < 5; k++) {
      const b = col3(clean(new THREE.OctahedronGeometry(0.03 - k * 0.003, 0)), solid(k % 2 ? 0x9a6ee0 : 0x8455d0));
      b.scale(1, 1.4, 1); b.translate(x, h - 0.02 - k * 0.045, z); parts.push(b);
    }
  });
  const m = mergeGeometries(parts); m.computeVertexNormals(); return m;
}

const WHITE = new THREE.Color(1, 1, 1);

export class Grass {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.kx = null; this.job = null; this.rev = -1;
    // [0] small, [1] medium, [2] tall tufts, [3] daisies, [4] yellow flowers, [5] lavender
    this.geos = [tuft(10, 0.16, 0.3, 0.07, 1), tuft(13, 0.26, 0.5, 0.075, 2), tuft(15, 0.4, 0.78, 0.08, 3), daisy(), yellowFlower(), lavender()];
    this.time = { value: 0 };
    const mat = this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    mat.onBeforeCompile = sh => {                       // a gentle sway: the higher the vertex, the more it moves
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          float sw = sin(uTime * 1.6 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27);
          transformed.x += sw * 0.08 * transformed.y * transformed.y; transformed.z += sw * 0.045 * transformed.y * transformed.y;
          #endif`);
    };
    mat.customProgramCacheKey = () => 'grass-v2';
    this.setQuality('medium');
  }
  setQuality(name) {
    const Q = QUALITY[name] || QUALITY.medium;
    if (this.Q === Q) return;
    this.Q = Q;
    const max = Math.ceil(Math.PI * (Q.r / Q.step) ** 2) + 64;
    // most spots hold a tuft; flowers are few
    this.caps = [max, Math.ceil(max * 0.6), Math.ceil(max * 0.3), Math.ceil(max * 0.12), Math.ceil(max * 0.12), Math.ceil(max * 0.12)];
    for (const m of this.meshes || []) { this.scene.remove(m); m.dispose(); }
    this.meshes = this.geos.map((g, v) => {
      const m = new THREE.InstancedMesh(g, this.mat, this.caps[v]);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, WHITE); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
      this.scene.add(m);
      return m;
    });
    this.stage = this.caps.map(c => ({ mat: new Float32Array(c * 16), col: new Float32Array(c * 3), n: 0 }));
    this.kx = null; this.job = null;
  }
  // may a plant grow at (x, z)? (not on roads, water, cliffs, dirt, building zones, farm pens or paths)
  _ok(x, z) {
    const W = this.world, T = W.T;
    if (T.roadDistAt(x, z) < 5.6 || T.riverDistAt(x, z) < RIVER_HALF + 1.3) return false;   // (the jungle floor can lie below the river's level)
    if (Math.abs(T.heightAt(x + 1, z) - T.heightAt(x - 1, z)) > 1.1 || Math.abs(T.heightAt(x, z + 1) - T.heightAt(x, z - 1)) > 1.1) return false;
    if (Math.hypot(x - START.x, z - START.z) < 14 || Math.hypot(x - CAMP.x, z - CAMP.z) < 14 || Math.hypot(x - GIANT.x, z - GIANT.z) < 34
      || (Math.abs(x - TOWER_ZONE.x) < TOWER_ZONE.hw + 3 && Math.abs(z - TOWER_ZONE.z) < TOWER_ZONE.hd + 3)) return false;
    for (const f of W.grassBlock) if (f(x, z)) return false;
    return mudAt(x, z) < MUD_T - 0.035;
  }
  // focus: the player (or the RV / drone)
  update(dt, focus) {
    this.time.value += dt;
    const kx = Math.round(focus.x / SNAP), kz = Math.round(focus.z / SNAP), rev = this.world.grassRev;
    if (!this.job && (kx !== this.kx || kz !== this.kz || rev !== this.rev)) {
      const Q = this.Q, s = Q.step, cx = kx * SNAP, cz = kz * SNAP;
      this.job = { cx, cz, kx, kz, rev, i0: Math.floor((cx - Q.r) / s), j0: Math.floor((cz - Q.r) / s), n: Math.ceil(2 * Q.r / s) + 1, k: 0 };
      for (const st of this.stage) st.n = 0;
    }
    if (this.job) this._work();
  }
  _work() {
    const J = this.job, Q = this.Q, s = Q.step, r2 = Q.r * Q.r, T = this.world.T, tot = J.n * J.n;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const end = Math.min(tot, J.k + PER_FRAME);
    for (; J.k < end; J.k++) {
      const ai = J.i0 + (J.k % J.n), aj = J.j0 + Math.floor(J.k / J.n);
      const h1 = gh12(ai * 1.31 + 0.7, aj * 0.97 + 3.3), h2 = gh12(ai * 0.73 + 9.1, aj * 1.17 + 1.9), h3 = gh12(ai + 17.7, aj + 5.3);
      const x = (ai + 0.1 + h1 * 0.8) * s, z = (aj + 0.1 + h2 * 0.8) * s;
      // patches: thick grass in some places, open ground in others; flowers in little groups
      const dens = gnoise(x * 0.16 + 3.1, z * 0.16 - 8.2), bloom = gnoise(x * 0.09 - 5.5, z * 0.09 + 2.7);
      const flower = bloom > 0.6 && h3 > 0.86;
      if (!flower && h3 > dens * 1.35 - 0.1) continue;
      const dx = x - J.cx, dz = z - J.cz, d2 = dx * dx + dz * dz;
      if (d2 > r2 || !this._ok(x, z)) continue;
      const v = flower ? 3 + Math.floor(h1 * 2.999) : h2 < 0.55 ? 0 : h2 < 0.86 ? 1 : 2, st = this.stage[v];
      if (st.n >= this.caps[v]) continue;
      const edge = Math.min(1, (1 - Math.sqrt(d2) / Q.r) * 5);   // shrink near the circle's edge (no hard border)
      const size = (flower ? 1.75 + h2 * 0.5 : 0.8 + h1 * 0.5) * (0.35 + 0.65 * edge);   // flowers: big enough to see
      q.setFromAxisAngle(up, h3 * 40);
      m.compose(p.set(x, T.heightAt(x, z) - 0.02, z), q, sc.set(size, size * (0.85 + h2 * 0.3), size));
      m.toArray(st.mat, st.n * 16);
      if (flower) c.copy(WHITE);
      else c.copy(palAt(Math.min(1, Math.max(0, toneAt(x, z) + (h1 - 0.5) * 0.3)))).multiplyScalar(0.9 + h2 * 0.15);
      st.col[st.n * 3] = c.r; st.col[st.n * 3 + 1] = c.g; st.col[st.n * 3 + 2] = c.b;
      st.n++;
    }
    if (J.k < tot) return;
    // done: show the new plants
    this.meshes.forEach((mesh, v) => {
      const st = this.stage[v];
      mesh.instanceMatrix.array.set(st.mat.subarray(0, st.n * 16));
      mesh.instanceColor.array.set(st.col.subarray(0, st.n * 3));
      mesh.count = st.n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    });
    this.kx = J.kx; this.kz = J.kz; this.rev = J.rev; this.job = null;
  }
}
