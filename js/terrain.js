import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './utils.js';

// Jungle map: hilly heightfield with a dirt road from the trailhead (south-west),
// across a river (broken bridge) and up to the hilltop camp (north-east).
export const HALF = 260, SIZE = HALF * 2, SEG = 130, CELL = SIZE / SEG, N = SEG + 1;
export const START = { x: -160, z: -192 };
export const CAMP = { x: 150, z: 166 };
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
  const e = Math.max(Math.abs(x), Math.abs(z)) - 208;
  if (e > 0) h += e * e * 0.012 + e * 0.3;                          // mountains frame the map
  return h;
}

/* ---------- curves ---------- */
const B = BRIDGE;
const ROAD_PTS = [
  [-162, -212], [-160, -192], [-156, -172], [-146, -156], [-128, -146], [-96, -134], [-70, -114],
  [-58, -84], [-44, -56], [-24, -34], [B.ax - B.dx * 12, B.az - B.dz * 12], [B.ax, B.az], [B.bx, B.bz],
  [B.bx + B.dx * 12, B.bz + B.dz * 12], [20, 52], [38, 74], [62, 92], [90, 104], [116, 122], [136, 142], [148, 158], [151, 168],
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
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - R + HALF) / CELL)), i1 = Math.min(SEG, Math.ceil((Math.max(x0, x1) + R + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - R + HALF) / CELL)), j1 = Math.min(SEG, Math.ceil((Math.max(z0, z1) + R + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
      const px = -HALF + k * CELL, pz = -HALF + j * CELL;
      const t = clamp(((px - x0) * ex + (pz - z0) * ez) / el, 0, 1);
      const d = Math.hypot(px - x0 - ex * t, pz - z0 - ez * t), idx = j * N + k;
      if (d < dist[idx]) { dist[idx] = d; if (param) param[idx] = curve.s[i] + (curve.s[i + 1] - curve.s[i]) * t; }
    }
  }
}

export function buildTerrain() {
  const H = new Float32Array(N * N), riverD = new Float32Array(N * N).fill(1e4), roadD = new Float32Array(N * N).fill(1e4), roadS = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = baseHeight(-HALF + i * CELL, -HALF + j * CELL);
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
  const G = 2 * 0.14;                                                  // max 14% grade
  for (let i = iB + 6; i <= road.n; i++) hr[i] = clamp(hr[i], hr[i - 1] - G, hr[i - 1] + G);
  for (let i = iA - 6; i >= 0; i--) hr[i] = clamp(hr[i], hr[i + 1] - G, hr[i + 1] + G);
  const W = D - 3.4, BED = W - 2.4, campH = hr[road.n], startH = hr[8];
  const sA = road.s[iA], sB = road.s[iB];
  const roadH = s => { const f = clamp(s / road.length, 0, 1) * road.n, i = Math.min(road.n - 1, Math.floor(f)); return lerp(hr[i], hr[i + 1], f - i); };

  // final terrain
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const idx = j * N + i, x = -HALF + i * CELL, z = -HALF + j * CELL, rd = riverD[idx];
    let h = H[idx];
    if (rd < RIVER_HALF + 1) h = lerp(BED, W + 0.7, smoothstep(RIVER_HALF - 2.5, RIVER_HALF + 1, rd));
    else if (rd < RIVER_HALF + 12) h = lerp(W + 0.7, Math.max(h, W + 0.7), smoothstep(RIVER_HALF + 1, RIVER_HALF + 12, rd));
    const s = roadS[idx], inSpan = s > sA + 1.5 && s < sB - 1.5;
    if (!inSpan && rd > RIVER_HALF + 1) { const w = 1 - smoothstep(6.5, 15, roadD[idx]); h = lerp(h, roadH(s) - 0.02, w); }
    const dc = Math.hypot(x - CAMP.x, z - CAMP.z); h = lerp(h, campH, 1 - smoothstep(20, 34, dc));
    const ds = Math.hypot(x - START.x, z - START.z); h = lerp(h, startH, 1 - smoothstep(26, 42, ds));
    H[idx] = h;
  }

  const heightAt = (x, z) => {
    const fi = clamp((x + HALF) / CELL, 0, SEG - 1e-4), fj = clamp((z + HALF) / CELL, 0, SEG - 1e-4);
    const i = Math.floor(fi), j = Math.floor(fj), fx = fi - i, fz = fj - j, k = j * N + i;
    const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  };
  const bilin = arr => (x, z) => {
    const fi = clamp((x + HALF) / CELL, 0, SEG - 1e-4), fj = clamp((z + HALF) / CELL, 0, SEG - 1e-4);
    const i = Math.floor(fi), j = Math.floor(fj), fx = fi - i, fz = fj - j, k = j * N + i;
    return lerp(lerp(arr[k], arr[k + 1], fx), lerp(arr[k + N], arr[k + N + 1], fx), fz);
  };

  road.h = hr; road.iA = iA; road.iB = iB; road.sA = sA; road.sB = sB;
  road.heightAt = roadH;
  road.nearest = nearest;
  road.pointAt = s => { const f = clamp(s / road.length, 0, 1) * road.n, i = Math.min(road.n - 1, Math.floor(f)), t = f - i;
    return { x: lerp(road.x[i], road.x[i + 1], t), z: lerp(road.z[i], road.z[i + 1], t), tx: road.tx[i], tz: road.tz[i], y: roadH(s) }; };

  const T = { H, heightAt, riverDistAt: bilin(riverD), roadDistAt: bilin(roadD), road, river, D, W, BED, campH, startH };
  T.mesh = terrainMesh(T, riverD, roadD);
  T.roadMesh = roadMesh(T);
  T.waterMesh = waterMesh(T);
  return T;
}

/* ---------- meshes ---------- */
const _c = new THREE.Color();
const GRASS = [0x3f7a35, 0x46833a, 0x4d8c3e, 0x3a7032, 0x427d36];
function terrainMesh(T, riverD, roadD) {
  const { H, W } = T, pos = [], col = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const face = (ia, ib, ic) => {
    const P = k => [-HALF + (k % N) * CELL, H[k], -HALF + Math.floor(k / N) * CELL];
    const a = P(ia), b = P(ib), c = P(ic);
    pos.push(...a, ...b, ...c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, ny1 = Math.abs(ny) / Math.hypot(nx, ny, nz);
    const h = (a[1] + b[1] + c[1]) / 3, rd = (riverD[ia] + riverD[ib] + riverD[ic]) / 3, od = (roadD[ia] + roadD[ib] + roadD[ic]) / 3;
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    if (h < W + 0.9 && rd < RIVER_HALF + 3) _c.set(h < W - 0.2 ? 0x6b5d42 : 0x9a8a62);
    else if (od < 7.5) _c.set(0x7a6446).lerp(_c.clone().set(GRASS[0]), smoothstep(5.5, 7.5, od));
    else if (ny1 < 0.78) _c.set(rnd() > 0.5 ? 0x7d7a70 : 0x6e6b62);
    else if (Math.hypot(cx - START.x, cz - START.z) < 34 || Math.hypot(cx - CAMP.x, cz - CAMP.z) < 28) _c.set(rnd() > 0.5 ? 0x7fa652 : 0x77a04c);
    else { _c.set(GRASS[(rnd() * GRASS.length) | 0]); if (h > T.campH - 8) _c.lerp(_c.clone().set(0x6f9c48), 0.5); }
    for (let k = 0; k < 3; k++) col.push(_c.r, _c.g, _c.b);
  };
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    face(a, c, b); face(b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.receiveShadow = true;
  return m;
}

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
