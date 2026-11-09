// Wild flowers around the player, standing on the painted meadow (js/terrain.js): white daisies and yellow
// flowers with chunky flat petals around a raised centre and broad leaves at the base. Foliage lighting: every
// face's normal is bent up toward the sky, so they are lit softly like the ground, with a gentle glow in
// daylight. They sway in the wind and are pressed down around the player's feet. They grow in little groups —
// never on dirt, roads, river banks, cliffs, farm pens, paths, rocks, bushes or tree trunks.
// Two instanced meshes (one draw call each). They cover a circle around the player; when the player has moved
// a few metres the circle is filled again, a slice per frame, so the game never stutters. Every spot on the map
// always gets the same flower (from the spot's own hash), so nothing jumps around as you walk. The circle's
// size follows the graphics quality.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MUD_T, SOIL_T } from './terrain.js';
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
export const mudAt = (x, z) => Math.max(gnoise(x * 0.065, z * 0.065) * 0.55 + gnoise(x * 0.17 + 7.3, z * 0.17 + 7.3) * 0.3 + gnoise(x * 0.5 - 3.1, z * 0.5 - 3.1) * 0.15,
  gnoise(x * 0.3 + 31.7, z * 0.3 + 31.7) * 0.78 + gnoise(x * 0.9 - 9.3, z * 0.9 - 9.3) * 0.22 - SOIL_T + MUD_T);

/* ---------- models ---------- */
const lin = hex => new THREE.Color(hex);                       // (linear colour for vertex colours)
const UP = new THREE.Vector3(0, 1, 0);
// build a mesh from triangles [[a, b, c, colA, colB, colC], …] (points as [x, y, z], colours THREE.Color)
function tris(list) {
  const pos = [], col = [];
  for (const [a, b, c, ca, cb, cc] of list) { pos.push(...a, ...b, ...c); for (const k of [ca, cb, cc]) col.push(k.r, k.g, k.b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const solidCol = (g, hex) => {
  const c = lin(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
};
const clean = g => { g = g.index ? g.toNonIndexed() : g; for (const k of ['uv', 'normal']) if (g.attributes[k]) g.deleteAttribute(k); return g; };
// foliage normals: each face's own normal, turned to the light side and bent up toward the sky by k (0..1)
function softNormals(g, k) {
  const p = g.attributes.position, n = new Float32Array(p.count * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    f.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    if (f.y < 0) f.negate();
    f.lerp(UP, k).normalize();
    for (let j = 0; j < 3; j++) n.set([f.x, f.y, f.z], (i + j) * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); return g;
}
// one broad blade: two flat halves meeting at a creased spine, a pointed tip, bending outward (+z) as it rises
function leaf(h, w, lean, cols) {
  const [c0, c1, c2] = cols, d = w * 0.32;
  const at = t => ({ y: h * t * (1 - 0.18 * lean * t), z: lean * h * 0.55 * t * t });
  const m = at(0.5), tp = at(1), w1 = w * 0.82;
  const L0 = [-w / 2, 0, 0], R0 = [w / 2, 0, 0], S0 = [0, 0, -d], L1 = [-w1 / 2, m.y, m.z], R1 = [w1 / 2, m.y, m.z], S1 = [0, m.y, m.z - d * 0.55], T = [0, tp.y, tp.z];
  return tris([[L0, S0, L1, c0, c0, c1], [S0, S1, L1, c0, c1, c1], [L1, S1, T, c1, c1, c2], [S0, R0, R1, c0, c0, c1], [S0, R1, S1, c0, c1, c1], [S1, R1, T, c1, c1, c2]]);
}
const place = (g, yaw, out) => { g.rotateY(yaw); g.translate(Math.sin(yaw) * out, 0, Math.cos(yaw) * out); return g; };
// broad leaves at the foot of a flower
function baseLeaves(n, h, seed) {
  const parts = [], cols = [lin(0x3b8a24), lin(0x5fb534), lin(0x8fd556)];
  for (let i = 0; i < n; i++) parts.push(place(leaf(h * (0.8 + 0.3 * ((i * 7 + seed) % 3) / 2), h * 0.42, 0.75, cols), i / n * Math.PI * 2 + seed, 0.02));
  return mergeGeometries(parts);
}
function stem(h, x = 0, z = 0, lean = 0) {
  const g = clean(new THREE.CylinderGeometry(0.009, 0.013, h, 5, 1, true)); g.translate(0, h / 2, 0); g.rotateZ(lean); g.translate(x, 0, z);
  return solidCol(g, 0x4c9a2c);
}
// a flower head: chunky flat petals (six-sided, rounded) around a raised centre, tilted a little.
// flat: each petal is just its top face, and the centre a low cone (a fraction of the triangles)
function head(r, n, petal, centre, x, y, z, tilt, flat = false) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const g = flat ? solidCol(clean(new THREE.CircleGeometry(0.5, 6).rotateX(-Math.PI / 2)), petal) : solidCol(clean(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)), petal);
    g.scale(r * (n > 6 ? 0.62 : 0.85), flat ? 1 : 0.018, r * 0.95); g.translate(0, flat ? 0.009 : 0, r * 0.62); g.rotateX(-0.12); g.rotateY(i / n * Math.PI * 2);
    parts.push(g);
  }
  const mid = solidCol(clean(flat ? new THREE.ConeGeometry(r * 0.42, 0.05, 6, 1, true) : new THREE.CylinderGeometry(r * 0.36, r * 0.42, 0.045, 7)), centre); mid.translate(0, 0.02, 0);
  parts.push(mid);
  const g = mergeGeometries(parts); g.rotateX(tilt); g.translate(x, y, z);
  return g;
}
function daisy() {
  return softNormals(mergeGeometries([baseLeaves(4, 0.17, 1), stem(0.36, 0, 0, 0.05), head(0.095, 8, 0xfbfbf6, 0xf5c533, 0.018, 0.36, 0, 0.3),
    stem(0.26, 0.07, 0.02, -0.15), head(0.07, 7, 0xfbfbf6, 0xf5c533, 0.105, 0.255, 0.02, 0.5)]), 0.45);
}
function yellowFlower() {
  return softNormals(mergeGeometries([baseLeaves(4, 0.16, 2), stem(0.33, 0, 0, -0.06), head(0.09, 5, 0xffd02e, 0xf09a1c, -0.02, 0.33, 0, 0.3),
    stem(0.22, -0.06, 0.03, 0.2), head(0.065, 5, 0xffd84a, 0xf09a1c, -0.104, 0.215, 0.03, 0.55)]), 0.45);
}
// the lighter flower for garden beds, where there are hundreds: one head of flat petals and two leaves
// (about 80 triangles instead of about 400)
export function gardenFlower(yellow) {
  return softNormals(mergeGeometries(yellow
    ? [baseLeaves(2, 0.16, 2), stem(0.33, 0, 0, -0.06), head(0.09, 5, 0xffd02e, 0xf09a1c, -0.02, 0.33, 0, 0.3, true)]
    : [baseLeaves(2, 0.17, 1), stem(0.36, 0, 0, 0.05), head(0.095, 8, 0xfbfbf6, 0xf5c533, 0.018, 0.36, 0, 0.3, true)]), 0.45);
}
const WHITE = new THREE.Color(1, 1, 1);

export class Grass {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.kx = null; this.job = null; this.rev = -1;
    // [0] white daisies, [1] yellow flowers
    this.geos = [daisy(), yellowFlower()];
    this.time = { value: 0 }; this.pressAt = { value: new THREE.Vector3(1e5, 1e5, 0) }; this.glow = { value: 0.16 };
    this.wind = { value: 1 };                     // how hard the wind blows (Farm World's weather: js/weather/effects.js)
    const mat = this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.time; sh.uniforms.uPress = this.pressAt; sh.uniforms.uGlow = this.glow; sh.uniforms.uWind = this.wind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uWind;\nuniform vec3 uPress;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          // pressed down and leaning away around the player's feet (you can always see where you walk)
          vec2 away = instanceMatrix[3].xz - uPress.xy; float pd = length(away), pk = mix(0.28, 1.0, smoothstep(0.45, 1.7, pd));
          transformed.y *= pk;
          float sw = sin(uTime * (1.2 + 0.4 * uWind) + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27) + 0.35 * (uWind - 1.0);
          transformed.x += sw * 0.07 * uWind * transformed.y * transformed.y; transformed.z += sw * 0.04 * uWind * transformed.y * transformed.y;
          #endif`);
      // both sides of a blade are lit the same (the normals already point up toward the light)
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;');   // soft daylight glow
    };
    mat.customProgramCacheKey = () => 'grass-v6';
    this.setQuality('medium');
  }
  setQuality(name) {
    const Q = QUALITY[name] || QUALITY.medium;
    if (this.Q === Q) return;
    this.Q = Q;
    const max = Math.ceil(Math.PI * (Q.r / Q.step) ** 2) + 64;
    this.caps = [Math.ceil(max * 0.18), Math.ceil(max * 0.18)];
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
  // daylight glow: none at night (dark: 0 day .. 1 night)
  setDark(dark) { this.glow.value = 0.16 * (1 - Math.min(1, dark * 1.3)); }
  // may a flower grow at (x, z)? (not on roads, water, cliffs, dirt, building zones, farm pens, paths or objects)
  _ok(x, z) {
    const W = this.world, T = W.T;
    if (T.roadDistAt(x, z) < 5.6 || T.riverDistAt(x, z) < RIVER_HALF + 1.3) return false;   // (the jungle floor can lie below the river's level)
    if (Math.abs(T.heightAt(x + 1, z) - T.heightAt(x - 1, z)) > 1.1 || Math.abs(T.heightAt(x, z + 1) - T.heightAt(x, z - 1)) > 1.1) return false;
    if (Math.hypot(x - START.x, z - START.z) < 14 || Math.hypot(x - CAMP.x, z - CAMP.z) < 14 || Math.hypot(x - GIANT.x, z - GIANT.z) < 34
      || (Math.abs(x - TOWER_ZONE.x) < TOWER_ZONE.hw + 3 && Math.abs(z - TOWER_ZONE.z) < TOWER_ZONE.hd + 3)) return false;
    for (const f of W.grassBlock) if (f(x, z)) return false;
    if (mudAt(x, z) >= MUD_T - 0.035) return false;
    return !W.blockedAt(x, z);                                    // not on rocks, bushes, tree trunks, fences, lamps…
  }
  // the player's feet (x, z), or null when not walking: grass there is pressed down
  press(x, z) { if (x === null) this.pressAt.value.set(1e5, 1e5, 0); else this.pressAt.value.set(x, z, 1); }
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
      // flowers in little groups
      const bloom = gnoise(x * 0.09 - 5.5, z * 0.09 + 2.7);
      if (bloom <= 0.56 || h3 <= 0.85) continue;
      const dx = x - J.cx, dz = z - J.cz, d2 = dx * dx + dz * dz;
      if (d2 > r2 || !this._ok(x, z)) continue;
      const v = h1 < 0.55 ? 0 : 1, st = this.stage[v];             // a few more daisies than yellow flowers
      if (st.n >= this.caps[v]) continue;
      const edge = Math.min(1, (1 - Math.sqrt(d2) / Q.r) * 5);   // shrink near the circle's edge (no hard border)
      const size = (1.15 + h2 * 0.35) * (0.35 + 0.65 * edge);
      q.setFromAxisAngle(up, h3 * 40);
      m.compose(p.set(x, T.heightAt(x, z) - 0.02, z), q, sc.set(size, size * (0.8 + h1 * 0.45), size));
      m.toArray(st.mat, st.n * 16);
      c.copy(WHITE);                                               // flowers keep their own colours
      st.col[st.n * 3] = c.r; st.col[st.n * 3 + 1] = c.g; st.col[st.n * 3 + 2] = c.b;
      st.n++;
    }
    if (J.k < tot) return;
    // done: show the new flowers
    this.meshes.forEach((mesh, v) => {
      const st = this.stage[v];
      mesh.instanceMatrix.array.set(st.mat.subarray(0, st.n * 16));
      mesh.instanceColor.array.set(st.col.subarray(0, st.n * 3));
      mesh.count = st.n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    });
    this.kx = J.kx; this.kz = J.kz; this.rev = J.rev; this.job = null;
  }
}
