import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './utils.js';

// Map: a jungle in the south (trailhead -> river/broken bridge -> hilltop camp), then a mountain
// pass into the pine highlands in the north (Watchtower Valley -> Giant Plateau, the final stand).
// The heightfield is a rectangle X0..X1 x Z0..Z1 with 4 m cells.
export const HALF = 260, X0 = -260, X1 = 260, Z0 = -260, Z1 = 740;
export const SX = X1 - X0, SZ = Z1 - Z0, CELL = 4, SEGX = SX / CELL, SEGZ = SZ / CELL, NX = SEGX + 1, NZ = SEGZ + 1;
export const SIZE = SX;      // (width; kept for older code)
export const NORTH = 250;    // the ridge between the jungle and the highlands
export const START = { x: -160, z: -192 };
export const CAMP = { x: 150, z: 166 };
export const VALLEY = { x: 70, z: 368 };                                  // Watchtower Valley (tower shelter)
export const TOWER_ZONE = { x: 70, z: 368, hw: 17, hd: 13 };              // where towers may stand (half sizes)
export const GIANT = { x: -80, z: 592, r: 26 };                           // Giant Plateau: castle ring (max radius)
export const RIVER_HALF = 6.5;
export const BRIDGE = (() => {
  const mx = 0, mz = 10, l = Math.hypot(0.25, 1), dx = 0.25 / l, dz = 1 / l, span = 16;
  return { mx, mz, dx, dz, span, width: 4.4, ax: mx - dx * span / 2, az: mz - dz * span / 2, bx: mx + dx * span / 2, bz: mz + dz * span / 2 };
})();

/* ---------- noise ---------- */
function hash(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), u), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}
function fbm(x, z) {
  let s = 0, a = 1, f = 1, t = 0;
  for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}
function baseHeight(x, z) {
  let h = fbm(x * 0.011 + 10, z * 0.011 - 5) * 24 - 8;
  h += fbm(x * 0.05 + 3, z * 0.05) * 3.5;
  const dc = Math.hypot(x - CAMP.x, z - CAMP.z);
  h += 26 * Math.exp(-(dc * dc) / (2 * 80 * 80));                 // the camp hill
  const ds = Math.hypot(x - START.x, z - START.z);
  h = lerp(h, 2, Math.exp(-(ds * ds) / (2 * 50 * 50)));             // low, flat trailhead
  // rocky ridge between the jungle and the highlands, with a pass for the road
  const rz = z - NORTH, pass = 1 - Math.exp(-((x - 128) ** 2) / (2 * 20 * 20));
  h += (34 + fbm(x * 0.03, 7) * 18) * Math.exp(-(rz * rz) / (2 * 16 * 16)) * pass;
  if (z > NORTH) { const dv = Math.hypot(x - VALLEY.x, z - VALLEY.z); h = lerp(h, 12, Math.exp(-(dv * dv) / (2 * 60 * 60))); }
  const dg = Math.hypot(x - GIANT.x, z - GIANT.z);
  h = lerp(h, 22, Math.exp(-(dg * dg) / (2 * 70 * 70)));            // the plateau
  const e = Math.max(Math.abs(x) - 208, z - 708, -z - 208);
  if (e > 0) h += e * e * 0.012 + e * 0.3;                          // mountains frame the map
  return h;
}

/* ---------- curves ---------- */
const B = BRIDGE;
const ROAD_PTS = [
  [-162, -212], [-160, -192], [-156, -172], [-146, -156], [-128, -146], [-96, -134], [-70, -114],
  [-58, -84], [-44, -56], [-24, -34], [B.ax - B.dx * 12, B.az - B.dz * 12], [B.ax, B.az], [B.bx, B.bz],
  [B.bx + B.dx * 12, B.bz + B.dz * 12], [20, 52], [38, 74], [62, 92], [90, 104], [116, 122], [136, 142], [148, 158], [151, 168],
  // north: over the pass into the highlands
  [149, 186], [142, 206], [134, 228], [128, 250], [124, 272], [118, 296], [110, 320], [101, 344], [97, 368], [94, 392],
  [82, 418], [62, 444], [36, 470], [8, 498], [-22, 526], [-48, 552], [-66, 572], [-78, 588], [-80, 596],
];
const RIVER_PTS = [[-275, 70], [-200, 52], [-140, 60], [-80, 38], [-40, 22], [-19.4, 14.8], [0, 10], [19.4, 5.2], [50, -4], [100, -24], [150, -18], [200, -40], [275, -30]];
function sampleCurve(pts, step) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
  const L = c.getLength(), n = Math.ceil(L / step);
  const sp = c.getSpacedPoints(n);
  const x = new Float32Array(n + 1), z = new Float32Array(n + 1), tx = new Float32Array(n + 1), tz = new Float32Array(n + 1), s = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    x[i] = sp[i].x; z[i] = sp[i].z; s[i] = (i / n) * L;
    const a = sp[Math.max(0, i - 1)], b = sp[Math.min(n, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    tx[i] = (b.x - a.x) / l; tz[i] = (b.z - a.z) / l;
  }
  return { n, x, z, tx, tz, s, length: L };
}

// Write the distance to a polyline into a grid (only near the line, so it's fast)
function rasterDist(curve, R, dist, param) {
  for (let i = 0; i < curve.n; i++) {
    const x0 = curve.x[i], z0 = curve.z[i], x1 = curve.x[i + 1], z1 = curve.z[i + 1];
    const ex = x1 - x0, ez = z1 - z0, el = ex * ex + ez * ez || 1;
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - R - X0) / CELL)), i1 = Math.min(SEGX, Math.ceil((Math.max(x0, x1) + R - X0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - R - Z0) / CELL)), j1 = Math.min(SEGZ, Math.ceil((Math.max(z0, z1) + R - Z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
      const px = X0 + k * CELL, pz = Z0 + j * CELL;
      const t = clamp(((px - x0) * ex + (pz - z0) * ez) / el, 0, 1);
      const d = Math.hypot(px - x0 - ex * t, pz - z0 - ez * t), idx = j * NX + k;
      if (d < dist[idx]) { dist[idx] = d; if (param) param[idx] = curve.s[i] + (curve.s[i + 1] - curve.s[i]) * t; }
    }
  }
}

export function buildTerrain() {
  const NN = NX * NZ, H = new Float32Array(NN), riverD = new Float32Array(NN).fill(1e4), roadD = new Float32Array(NN).fill(1e4), roadS = new Float32Array(NN);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) H[j * NX + i] = baseHeight(X0 + i * CELL, Z0 + j * CELL);
  const road = sampleCurve(ROAD_PTS, 2), river = sampleCurve(RIVER_PTS, 3);
  rasterDist(river, 30, riverD, null);
  rasterDist(road, 22, roadD, roadS);

  // road height profile: smoothed terrain, flat across the bridge, slope-limited
  const hr = new Float32Array(road.n + 1);
  for (let i = 0; i <= road.n; i++) hr[i] = baseHeight(road.x[i], road.z[i]);
  for (let pass = 0; pass < 3; pass++) {
    const c = hr.slice();
    for (let i = 0; i <= road.n; i++) { let a = 0, k = 0; for (let d = -10; d <= 10; d++) { const q = i + d; if (q >= 0 && q <= road.n) { a += c[q]; k++; } } hr[i] = a / k; }
  }
  const nearest = (x, z) => { let bi = 0, bd = 1e9; for (let i = 0; i <= road.n; i++) { const d = (road.x[i] - x) ** 2 + (road.z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const iA = nearest(B.ax, B.az), iB = nearest(B.bx, B.bz);
  let D = -1e9;
  for (let i = iA - 8; i <= iB + 8; i++) D = Math.max(D, hr[i]);
  D = Math.max(D + 0.3, 3);
  for (let i = iA - 5; i <= iB + 5; i++) hr[i] = D;
  // the clearings (camp, valley, plateau) are flat: pull the road there to one height first
  const iC = nearest(CAMP.x, CAMP.z), iV = nearest(VALLEY.x + 28, VALLEY.z), iG = road.n;
  for (const [cx, cz, ic, r0, r1] of [[CAMP.x, CAMP.z, iC, 20, 34], [VALLEY.x, VALLEY.z, iV, 30, 46], [GIANT.x, GIANT.z, iG, 34, 50]]) {
    const fh = hr[ic];
    for (let i = 0; i <= road.n; i++) { const d = Math.hypot(road.x[i] - cx, road.z[i] - cz); if (d < r1) hr[i] = lerp(hr[i], fh, 1 - smoothstep(r0, r1, d)); }
  }
  const G = 2 * 0.14;                                                  // max 14% grade
  for (let i = iB + 6; i <= road.n; i++) hr[i] = clamp(hr[i], hr[i - 1] - G, hr[i - 1] + G);
  for (let i = iA - 6; i >= 0; i--) hr[i] = clamp(hr[i], hr[i + 1] - G, hr[i + 1] + G);
  const W = D - 3.4, BED = W - 2.4, campH = hr[iC], startH = hr[8], valleyH = hr[iV], giantH = hr[iG];
  const sA = road.s[iA], sB = road.s[iB];
  const roadH = s => { const f = clamp(s / road.length, 0, 1) * road.n, i = Math.min(road.n - 1, Math.floor(f)); return lerp(hr[i], hr[i + 1], f - i); };

  // final terrain
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const idx = j * NX + i, x = X0 + i * CELL, z = Z0 + j * CELL, rd = riverD[idx];
    let h = H[idx];
    if (rd < RIVER_HALF + 1) h = lerp(BED, W + 0.7, smoothstep(RIVER_HALF - 2.5, RIVER_HALF + 1, rd));
    else if (rd < RIVER_HALF + 12) h = lerp(W + 0.7, Math.max(h, W + 0.7), smoothstep(RIVER_HALF + 1, RIVER_HALF + 12, rd));
    const dc = Math.hypot(x - CAMP.x, z - CAMP.z); h = lerp(h, campH, 1 - smoothstep(20, 34, dc));
    const ds = Math.hypot(x - START.x, z - START.z); h = lerp(h, startH, 1 - smoothstep(26, 42, ds));
    const dv = Math.hypot(x - VALLEY.x, z - VALLEY.z); h = lerp(h, valleyH, 1 - smoothstep(30, 46, dv));
    const dg = Math.hypot(x - GIANT.x, z - GIANT.z); h = lerp(h, giantH, 1 - smoothstep(34, 50, dg));
    const s = roadS[idx], inSpan = s > sA + 1.5 && s < sB - 1.5;
    if (!inSpan && rd > RIVER_HALF + 1) { const w = 1 - smoothstep(6.5, 15, roadD[idx]); h = lerp(h, roadH(s) - 0.02, w); }
    H[idx] = h;
  }

  const heightAt = (x, z) => {
    const fi = clamp((x - X0) / CELL, 0, SEGX - 1e-4), fj = clamp((z - Z0) / CELL, 0, SEGZ - 1e-4);
    const i = Math.floor(fi), j = Math.floor(fj), fx = fi - i, fz = fj - j, k = j * NX + i;
    const a = H[k], b = H[k + 1], c = H[k + NX], d = H[k + NX + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  };
  const bilin = arr => (x, z) => {
    const fi = clamp((x - X0) / CELL, 0, SEGX - 1e-4), fj = clamp((z - Z0) / CELL, 0, SEGZ - 1e-4);
    const i = Math.floor(fi), j = Math.floor(fj), fx = fi - i, fz = fj - j, k = j * NX + i;
    return lerp(lerp(arr[k], arr[k + 1], fx), lerp(arr[k + NX], arr[k + NX + 1], fx), fz);
  };

  road.h = hr; road.iA = iA; road.iB = iB; road.sA = sA; road.sB = sB;
  road.sCamp = road.s[iC]; road.sValley = road.s[iV]; road.sGiant = road.length;
  road.heightAt = roadH;
  road.nearest = nearest;
  road.pointAt = s => { const f = clamp(s / road.length, 0, 1) * road.n, i = Math.min(road.n - 1, Math.floor(f)), t = f - i;
    return { x: lerp(road.x[i], road.x[i + 1], t), z: lerp(road.z[i], road.z[i + 1], t), tx: road.tx[i], tz: road.tz[i], y: roadH(s) }; };

  const T = { H, heightAt, riverDistAt: bilin(riverD), roadDistAt: bilin(roadD), road, river, D, W, BED, campH, startH, valleyH, giantH };
  T.mesh = terrainMesh(T, riverD, roadD);
  T.roadMesh = roadMesh(T);
  T.waterMesh = waterMesh(T);
  return T;
}

/* ---------- meshes ---------- */
const _c = new THREE.Color();
const GRASS = [0x3f7a35, 0x46833a, 0x4d8c3e, 0x3a7032, 0x427d36];
const GRASS_N = [0x5c9a3a, 0x67a442, 0x70ab47, 0x568f37, 0x62a03f];     // brighter highland grass
function terrainMesh(T, riverD, roadD) {
  const { H, W } = T, pos = [], col = [], grass = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const face = (ia, ib, ic) => {
    const P = k => [X0 + (k % NX) * CELL, H[k], Z0 + Math.floor(k / NX) * CELL];
    const a = P(ia), b = P(ib), c = P(ic);
    pos.push(...a, ...b, ...c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, ny1 = Math.abs(ny) / Math.hypot(nx, ny, nz);
    const h = (a[1] + b[1] + c[1]) / 3, rd = (riverD[ia] + riverD[ib] + riverD[ic]) / 3, od = (roadD[ia] + roadD[ib] + roadD[ic]) / 3;
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    let gk = 0;                                   // how much of the painted grass-and-mud ground this face gets
    if (h < W + 0.9 && rd < RIVER_HALF + 3) _c.set(h < W - 0.2 ? 0x6b5d42 : 0x9a8a62);
    else if (od < 7.5) { gk = smoothstep(5.5, 7.5, od); _c.set(0x7a6446).lerp(_c.clone().set(GRASS[0]), gk); }
    else if (ny1 < 0.78) _c.set(cz > NORTH - 20 ? (rnd() > 0.5 ? 0x8f887a : 0x7e786c) : rnd() > 0.5 ? 0x7d7a70 : 0x6e6b62);
    else if (Math.hypot(cx - START.x, cz - START.z) < 34 || Math.hypot(cx - CAMP.x, cz - CAMP.z) < 28) { gk = 1; _c.set(rnd() > 0.5 ? 0x7fa652 : 0x77a04c); }
    else if (Math.hypot(cx - GIANT.x, cz - GIANT.z) < 40 || (Math.abs(cx - TOWER_ZONE.x) < TOWER_ZONE.hw + 4 && Math.abs(cz - TOWER_ZONE.z) < TOWER_ZONE.hd + 4)) _c.set(rnd() > 0.5 ? 0xa39463 : 0x9a8b5c);
    else if (cz > NORTH) { gk = 1; _c.set(GRASS_N[(rnd() * GRASS_N.length) | 0]); if (h > 40) { const a = Math.min(1, (h - 40) / 25); _c.lerp(_c.clone().set(0x7b8a5a), a); gk = 1 - a * 0.7; } }
    else { gk = 1; _c.set(GRASS[(rnd() * GRASS.length) | 0]); if (h > T.campH - 8) _c.lerp(_c.clone().set(0x6f9c48), 0.5); }
    for (let k = 0; k < 3; k++) { col.push(_c.r, _c.g, _c.b); grass.push(gk); }
  };
  for (let j = 0; j < SEGZ; j++) for (let i = 0; i < SEGX; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    face(a, c, b); face(b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aGrass', new THREE.Float32BufferAttribute(grass, 1));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, groundMaterial());
  m.receiveShadow = true;
  return m;
}

/* ---------- the painted ground: a bright, clean low-poly meadow with soft dirt patches ----------
   Drawn by the terrain's shader from the world position (no texture, no extra geometry, no seams):
   - the grass is a calm surface of soft, roughly hexagonal patches (about 1.2 m) in close lime shades
     (TONE_STEPS), a touch darker in places;
   - dirt: where a slow noise is high the ground is light orange-brown earth with a few darker lumps and
     tiny stones, plus small spots of bare soil here and there; edges fray naturally;
   - the flowers standing on it are js/grass.js; far away the facets calm down (no shimmer).
   Faces that are not grass (road verges, river banks, rock slopes, sandy build zones) keep their own colour
   (aGrass = 0). Lighting, shadows, fog and day / night work as before (only the surface colour changes).
   The same palette and dirt noise are used by js/grass.js. */
export const GROUND = { g0: 0x64b237, g1: 0x74c343, g2: 0x84d14d, g3: 0x95dc5a, m0: 0xb8814a, m1: 0xcc985c, m2: 0x9a6a3c };
// how much of each green (by the meadow-tone noise): close lime shades, mostly the two middle ones
export const TONE_STEPS = [0.25, 0.5, 0.82];
export const MUD_T = 0.68;
export const SOIL_T = 0.86;          // small bare-soil spots (a second, finer noise) above this
export function groundMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const u = {};
  for (const k in GROUND) u['uGr_' + k] = { value: new THREE.Color(GROUND[k]) };
  mat.userData.ground = u;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGrass;\nvarying float vGrass;\nvarying vec3 vGWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGrass = aGrass;\nvGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vGrass > 0.01) {
          float far = smoothstep(30.0, 110.0, distance(vGWorld, cameraPosition));
          diffuseColor.rgb = mix(diffuseColor.rgb, groundColor(vGWorld.xz, far), vGrass);
        }`);
  };
  mat.customProgramCacheKey = () => 'ground-v14';
  return mat;
}
const GROUND_GLSL = /* glsl */`
varying float vGrass; varying vec3 vGWorld;
uniform vec3 uGr_g0, uGr_g1, uGr_g2, uGr_g3, uGr_m0, uGr_m1, uGr_m2;
const float MUD_T = ${MUD_T};
float gh12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 gh22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh12(i), gh12(i + vec2(1.0, 0.0)), f.x), mix(gh12(i + vec2(0.0, 1.0)), gh12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// the dirt field: big dirt patches, and small spots of bare soil (1–3 m) folded in on the same scale
float gmud(vec2 p) {
  float big = gnoise(p * 0.065) * 0.55 + gnoise(p * 0.17 + 7.3) * 0.3 + gnoise(p * 0.5 - 3.1) * 0.15;
  float small = gnoise(p * 0.3 + 31.7) * 0.78 + gnoise(p * 0.9 - 9.3) * 0.22;
  return max(big, small - ${SOIL_T} + MUD_T);
}
float gtone(vec2 p) { return clamp(gnoise(p * 0.11) * 0.7 + gnoise(p * 0.031) * 0.5 - 0.12, 0.0, 1.0); }
vec3 gpal(float t) { return t < ${TONE_STEPS[0]} ? uGr_g0 : t < ${TONE_STEPS[1]} ? uGr_g1 : t < ${TONE_STEPS[2]} ? uGr_g2 : uGr_g3; }
// nearest cell of an irregular grid (scale: cells per metre): cell id, offset from p to its centre
vec2 gcell(vec2 p, float scale, out vec2 off) {
  vec2 q = p * scale, ip = floor(q), fp = fract(q), id = ip; float d1 = 9.0; off = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), r = o + 0.1 + gh22(ip + o) * 0.8 - fp; float d = dot(r, r);
    if (d < d1) { d1 = d; off = r; id = ip + o; }
  }
  return id;
}
vec3 groundColor(vec2 p, float far) {
  float mud = gmud(p), tone = gtone(p);
  vec2 off; vec2 id = gcell(p, 0.85, off);                                 // soft, roughly hexagonal patches (~1.2 m)
  float h = gh12(id * 1.7 + 3.1);
  vec2 dir = normalize(gh22(id + 4.0) - 0.5 + 0.001);
  float side = dot(off, dir) > 0.0 ? 1.0 : -1.0;                           // which half of the facet (very subtle)
  float facet = mix(1.0 + (h - 0.5) * 0.08 + side * 0.015, 1.0, far);
  float thick = smoothstep(0.45, 0.85, gnoise(p * 0.16 + vec2(3.1, -8.2)));  // slightly darker meadow spots
  facet *= 1.0 - 0.07 * thick;
  // the dirt's edge frays: small bits decide one by one near the boundary
  float edge = (mud - (MUD_T - 0.035)) / 0.035;
  bool dirt = mud > MUD_T;
  if (!dirt && edge > 0.0 && far < 0.8) dirt = gnoise(p * 2.7 + 5.1) * 0.65 + gnoise(p * 6.3 - 2.2) * 0.35 < edge * 0.85;   // organic frayed edge
  if (dirt) {
    vec3 col = mix(uGr_m0, uGr_m1, 0.35 + 0.4 * gnoise(p * 0.35) + (h - 0.5) * 0.12) * facet;
    if (far < 0.6) {                                                         // a few darker lumps and tiny stones
      vec2 q = p * 2.2, ip = floor(q), fp = fract(q);
      vec2 c = 0.2 + gh22(ip) * 0.6; float e = length(fp - c), ph = gh12(ip + 11.0);
      if (ph > 0.93 && e < 0.16 + ph * 0.06) col = (ph > 0.985 ? vec3(0.42, 0.41, 0.42) : uGr_m2) * (1.0 + clamp(c.y - fp.y, -0.3, 0.3) * 0.8);
    }
    return col;
  }
  vec3 col = gpal(clamp(tone + (h - 0.5) * 0.5, 0.0, 1.0)) * facet;          // each patch one of the close limes
  if (edge > -0.6) col = mix(col, uGr_g3 * 1.02, 0.25 * clamp(edge + 0.6, 0.0, 1.0));   // a little lighter, drier grass by the dirt
  return col;
}`;

function strip(pos, col, x0, z0, x1, z1, nx0, nz0, nx1, nz1, w0, w1, y0, y1, color) {
  _c.set(color);
  const A = [x0 + nx0 * w0, y0, z0 + nz0 * w0], B = [x0 + nx0 * w1, y0, z0 + nz0 * w1];
  const C = [x1 + nx1 * w0, y1, z1 + nz1 * w0], Dd = [x1 + nx1 * w1, y1, z1 + nz1 * w1];
  // two triangles facing up
  pos.push(...A, ...C, ...B, ...B, ...C, ...Dd);
  for (let k = 0; k < 6; k++) col.push(_c.r, _c.g, _c.b);
}
function fixWinding(pos) { // make every triangle face up
  for (let i = 0; i < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uz = pos[i + 5] - pos[i + 2], vx = pos[i + 6] - pos[i], vz = pos[i + 8] - pos[i + 2];
    if (uz * vx - ux * vz < 0) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
  }
}
function finish(pos, col, mat) {
  fixWinding(pos);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}

function roadMesh(T) {
  const r = T.road, pos = [], col = [];
  for (let i = 0; i < r.n; i++) {
    if (i >= r.iA && i < r.iB) continue;                       // the bridge goes here
    const nx0 = r.tz[i], nz0 = -r.tx[i], nx1 = r.tz[i + 1], nz1 = -r.tx[i + 1];
    const y0 = r.h[i] + 0.06, y1 = r.h[i + 1] + 0.06;
    const args = [r.x[i], r.z[i], r.x[i + 1], r.z[i + 1], nx0, nz0, nx1, nz1];
    strip(pos, col, ...args, -4.4, -1.4, y0, y1, i % 7 ? 0x8a7350 : 0x857049);
    strip(pos, col, ...args, -1.4, -0.7, y0 + 0.01, y1 + 0.01, 0x6d5a3d);
    strip(pos, col, ...args, -0.7, 0.7, y0, y1, 0x8f7954);
    strip(pos, col, ...args, 0.7, 1.4, y0 + 0.01, y1 + 0.01, 0x6d5a3d);
    strip(pos, col, ...args, 1.4, 4.4, y0, y1, i % 5 ? 0x8a7350 : 0x84704d);
  }
  return finish(pos, col, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}

function waterMesh(T) {
  const r = T.river, pos = [], col = [];
  const blues = [0x3d7fa6, 0x4386ad, 0x3a789e];
  for (let i = 0; i < r.n; i++) {
    strip(pos, col, r.x[i], r.z[i], r.x[i + 1], r.z[i + 1], r.tz[i], -r.tx[i], r.tz[i + 1], -r.tx[i + 1], -(RIVER_HALF + 1.6), RIVER_HALF + 1.6, T.W, T.W, blues[i % 3]);
  }
  const m = finish(pos, col, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.82, depthWrite: false }));
  m.receiveShadow = false;
  return m;
}
