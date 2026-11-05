// Grass around the player: mostly short, broad low-poly leaves lying low, and now and then a taller clump of blades (dark at the base, lighter at the
// tips, swaying a little in the wind) standing on the painted ground (js/terrain.js), in the same greens and
// the same meadow patches, never in the mud, on roads, river banks, cliffs, farm pens or paths.
// Two instanced meshes (tall clusters and short leafy ones) — two draw calls. They cover a circle around the
// player; when the player has moved a few metres the circle is filled again, a slice per frame, so the game
// never stutters. Every spot on the map always gets the same cluster (it comes from the spot's own hash), so
// grass doesn't jump around as you walk. The circle's size and density follow the graphics quality.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUND, MUD_T, TONE_STEPS } from './terrain.js';
import { RIVER_HALF, START, CAMP, GIANT, TOWER_ZONE } from './terrain.js';

const QUALITY = { low: { r: 18, step: 1.0 }, medium: { r: 28, step: 0.72 }, high: { r: 38, step: 0.6 } };
const SNAP = 4;                  // refill after moving this far
const PER_FRAME = 2200;          // spots checked per frame while refilling

// the shader's hash / noise in JS (js/terrain.js GROUND_GLSL), so blades match the painted meadow and mud
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

// a cluster of blades: thin three-sided cones leaning outwards, coloured dark at the base and light at the tip
// (white-ish: each cluster is tinted by its instance colour)
function cluster(n, hMin, hMax, spread, width, lean0 = 0.25, flat = 0.45) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + (i % 2) * 0.4 + ((i * 5) % 3) * 0.3, h = hMin + (hMax - hMin) * ((i * 7) % n) / Math.max(1, n - 1), lean = lean0 + ((i * 3) % 4) * 0.12;
    const g = new THREE.ConeGeometry(width, h, 3, 1, true);
    g.translate(0, h / 2, 0);
    g.scale(1, 1, flat);
    g.rotateZ(-Math.cos(a) * lean); g.rotateX(Math.sin(a) * lean); g.rotateY(a * 0.7);
    g.translate(Math.cos(a) * spread, 0, Math.sin(a) * spread);
    const pos = g.attributes.position, col = [];
    for (let k = 0; k < pos.count; k++) { const t = Math.min(1, Math.max(0, pos.getY(k) / h)); const v = 0.62 + 0.5 * t; col.push(v, v, v); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(g.toNonIndexed ? g.toNonIndexed() : g);
  }
  const m = mergeGeometries(parts); m.computeVertexNormals(); return m;
}

export class Grass {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.kx = null; this.job = null; this.rev = -1;
    // [0] the occasional tall clump of blades, [1] short broad leaves lying low (most of them)
    this.geos = [cluster(5, 0.24, 0.58, 0.06, 0.04), cluster(5, 0.12, 0.22, 0.05, 0.085, 0.8, 0.22)];
    this.time = { value: 0 };
    const mat = this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    mat.onBeforeCompile = sh => {                       // a gentle sway: the higher the vertex, the more it moves
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          float sw = sin(uTime * 1.6 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27);
          transformed.x += sw * 0.09 * transformed.y * transformed.y; transformed.z += sw * 0.05 * transformed.y * transformed.y;
          #endif`);
    };
    mat.customProgramCacheKey = () => 'grass-v1';
    this.setQuality('medium');
  }
  setQuality(name) {
    const Q = QUALITY[name] || QUALITY.medium;
    if (this.Q === Q) return;
    this.Q = Q;
    const max = Math.ceil(Math.PI * (Q.r / Q.step) ** 2) + 64;
    for (const m of this.meshes || []) { this.scene.remove(m); m.dispose(); }
    this.meshes = this.geos.map(g => {
      const m = new THREE.InstancedMesh(g, this.mat, max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
      this.scene.add(m);
      return m;
    });
    this.stage = this.meshes.map(() => ({ mat: new Float32Array(max * 16), col: new Float32Array(max * 3), n: 0 }));
    this.max = max; this.kx = null; this.job = null;
  }
  // is grass allowed at (x, z)? (not on roads, water, cliffs, mud, building zones, farm pens or paths)
  _ok(x, z, y) {
    const W = this.world, T = W.T;
    if (T.roadDistAt(x, z) < 4.9 || T.riverDistAt(x, z) < RIVER_HALF + 1.3) return false;   // (the jungle floor can lie below the river's level)
    if (Math.abs(T.heightAt(x + 1, z) - T.heightAt(x - 1, z)) > 1.1 || Math.abs(T.heightAt(x, z + 1) - T.heightAt(x, z - 1)) > 1.1) return false;
    if (Math.hypot(x - START.x, z - START.z) < 14 || Math.hypot(x - CAMP.x, z - CAMP.z) < 14 || Math.hypot(x - GIANT.x, z - GIANT.z) < 34
      || (Math.abs(x - TOWER_ZONE.x) < TOWER_ZONE.hw + 3 && Math.abs(z - TOWER_ZONE.z) < TOWER_ZONE.hd + 3)) return false;
    for (const f of W.grassBlock) if (f(x, z)) return false;
    return mudAt(x, z) < MUD_T - 0.02;
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
      if (h3 < 0.3) continue;                                    // gaps: the painted leaves show through
      const x = (ai + 0.1 + h1 * 0.8) * s, z = (aj + 0.1 + h2 * 0.8) * s, dx = x - J.cx, dz = z - J.cz, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const y = T.heightAt(x, z);
      if (!this._ok(x, z, y)) continue;
      const tall = h3 > 0.92 && h1 > 0.35, v = tall ? 0 : 1, st = this.stage[v];   // tall blades: about 1 spot in 20
      if (st.n >= this.max) continue;
      const edge = Math.min(1, (1 - Math.sqrt(d2) / Q.r) * 5);   // shrink near the circle's edge (no hard border)
      const size = (tall ? 0.7 + h1 * 0.5 : 0.8 + h1 * 0.7) * (0.35 + 0.65 * edge);
      q.setFromAxisAngle(up, h2 * Math.PI * 2);
      m.compose(p.set(x, y - 0.03, z), q, sc.set(size, size * (0.8 + h3 * 0.5), size));
      m.toArray(st.mat, st.n * 16);
      const tone = Math.min(1, Math.max(0, toneAt(x, z) + (h1 - 0.5) * 0.35));
      c.copy(palAt(tone)).multiplyScalar(0.92 + h2 * 0.2);
      if (mudAt(x, z) > MUD_T - 0.07) c.lerp(PAL[0], 0.5);       // darker next to the mud
      st.col[st.n * 3] = c.r; st.col[st.n * 3 + 1] = c.g; st.col[st.n * 3 + 2] = c.b;
      st.n++;
    }
    if (J.k < tot) return;
    // done: show the new grass
    this.meshes.forEach((mesh, v) => {
      const st = this.stage[v];
      mesh.instanceMatrix.array.set(st.mat.subarray(0, st.n * 16));
      mesh.instanceColor.array.set(st.col.subarray(0, st.n * 3));
      mesh.count = st.n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    });
    this.kx = J.kx; this.kz = J.kz; this.rev = J.rev; this.job = null;
  }
}
