// Bakes the "Low poly Fat-tailed sheep 3d model" (models/low_poly_fat-tailed_sheep_3d_model: glTF, 19k triangles
// and a 4096 px fur texture) into the farm's goat, js/farm/goatModel.js:
//   - its corners are joined along the texture's seams, each taking the fur's colour around it,
//   - the mesh is simplified to about TARGET triangles (meshoptimizer keeps its shape and the colour edges),
//   - every triangle gets the average of its corners' colours (so the fur's fine detail doesn't flicker),
//     quantised to a palette of COLOURS colours,
//   - turned to face +z, feet at y = 0, scaled to the farm's goat size, the legs' middle at the origin,
//   - positions as 16-bit integers inside the box and one palette byte per triangle (js/farm/polyRig.js unpack).
// js/farm/polyRig.js gives it moving legs, a neck that bends down to graze and a fat tail that wags.
//   npm i --no-save meshoptimizer@0.21.0   (once, anywhere; or MESHOPT=<path to its index.module.js>)
//   node tools/bake-goat.mjs
// The model: "Low poly Fat-tailed sheep 3d model" by iRahulRajput (https://sketchfab.com/rt699448), CC-BY-4.0 —
// see its license.txt. The texture is read through macOS `sips` (it has no JPEG decoder of its own).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const { MeshoptSimplifier } = await import(process.env.MESHOPT ? pathToFileURL(process.env.MESHOPT).href : 'meshoptimizer');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'models/low_poly_fat-tailed_sheep_3d_model');
const OUT = join(ROOT, 'js/farm/goatModel.js');
const TARGET = 4000;          // triangles
const SCALE = 1.15;           // model units -> metres (about 0.75 m at the back, 1.15 m nose to tail)
const MID_X = -0.14;          // the model's x half way between its front and hind legs (it faces +x)
const COLOURS = 128;

/* ---------- glTF (one mesh; its node matrices cancel out) ---------- */
const gltf = JSON.parse(readFileSync(join(SRC, 'scene.gltf'), 'utf8'));
const bin = readFileSync(join(SRC, gltf.buffers[0].uri));
function accessor(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
  const start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const out = new T(a.count * n), view = new DataView(bin.buffer);
  const get = { 5126: o => view.getFloat32(o, true), 5125: o => view.getUint32(o, true), 5123: o => view.getUint16(o, true) }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(start + k * stride + c * T.BYTES_PER_ELEMENT);
  return out;
}
const prim = gltf.meshes[0].primitives[0];
const P = accessor(prim.attributes.POSITION), UV = accessor(prim.attributes.TEXCOORD_0), IDX = Uint32Array.from(accessor(prim.indices));

/* ---------- the texture (via sips -> BMP, 1024 px) ---------- */
function readTexture(file, size) {
  const dir = mkdtempSync(join(tmpdir(), 'goat-')), bmp = join(dir, 't.bmp');
  try {
    execFileSync('sips', ['-s', 'format', 'bmp', '-z', String(size), String(size), file, '--out', bmp], { stdio: 'ignore' });
    const b = readFileSync(bmp), off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28) / 8;
    const h = Math.abs(hRaw), stride = Math.ceil(w * bpp / 4) * 4, topDown = hRaw < 0;
    const px = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      const row = off + (topDown ? y : h - 1 - y) * stride;
      for (let x = 0; x < w; x++) { const o = row + x * bpp, i = (y * w + x) * 3; px[i] = b[o + 2]; px[i + 1] = b[o + 1]; px[i + 2] = b[o]; }
    }
    // bilinear sample at (u, v) — glTF's v runs down the image
    return (u, v, out) => {
      const fx = Math.min(w - 1.001, Math.max(0, u * w - 0.5)), fy = Math.min(h - 1.001, Math.max(0, v * h - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      for (let c = 0; c < 3; c++) {
        const p = k => px[k * 3 + c], i = y0 * w + x0;
        out[c] = (p(i) * (1 - ax) + p(i + 1) * ax) * (1 - ay) + (p(i + w) * (1 - ax) + p(i + w + 1) * ax) * ay;
      }
      return out;
    };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const tex = readTexture(join(SRC, gltf.images[0].uri), 1024);

/* ---------- the colour at every corner: the texture averaged over the triangles around it ---------- */
// The texture is cut into hundreds of small islands, so the mesh's corners are split along every seam; the
// simplifier can't collapse across them. So the corners are joined by position first, each taking the colour
// of the fur around it (each triangle's average colour, weighted by its area).
// (averaged in linear light, as the texture would be filtered on screen — sRGB averages come out too dark)
const lin = v => Math.pow((v / 255 + 0.055) / 1.055, 2.4), srgb = l => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const BARY = [];
for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4 - i; j++) BARY.push([(i + 0.33) / 4.99, (j + 0.33) / 4.99]);   // 15 points inside
const key = i => `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`;
const weld = new Uint32Array(P.length / 3), first = new Map(), pts = [];
for (let i = 0; i < weld.length; i++) { const k = key(i); if (!first.has(k)) { first.set(k, pts.length / 3); pts.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); } weld[i] = first.get(k); }
const V = Float32Array.from(pts), nV = V.length / 3, acc = new Float64Array(nV * 4), s = [0, 0, 0];
const idx = new Uint32Array(IDX.length);
for (let t = 0; t < IDX.length; t += 3) {
  const [a, b, c] = [IDX[t], IDX[t + 1], IDX[t + 2]];
  let r = 0, g = 0, bl = 0;
  for (const [ka, kb] of BARY) {
    const kc = 1 - ka - kb, u = UV[a * 2] * ka + UV[b * 2] * kb + UV[c * 2] * kc, v = UV[a * 2 + 1] * ka + UV[b * 2 + 1] * kb + UV[c * 2 + 1] * kc;
    tex(u, v, s); r += lin(s[0]); g += lin(s[1]); bl += lin(s[2]);
  }
  const e1 = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
  const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2 + 1e-12;
  for (const i of [a, b, c]) { const o = weld[i] * 4; acc[o] += r / BARY.length * area; acc[o + 1] += g / BARY.length * area; acc[o + 2] += bl / BARY.length * area; acc[o + 3] += area; }
  idx[t] = weld[a]; idx[t + 1] = weld[b]; idx[t + 2] = weld[c];
}
const vcol = new Float32Array(nV * 3);
for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) vcol[i * 3 + k] = acc[i * 4 + k] / (acc[i * 4 + 3] || 1);

/* ---------- simplify (keeping colour edges: the eyes, the nose, the hooves) ---------- */
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;
const [simple, err] = MeshoptSimplifier.simplifyWithAttributes(idx, V, 3, vcol, 3, [0.4, 0.4, 0.4], null, TARGET * 3, 0.05);
const tris = simple.length / 3;
console.log(`corners ${P.length / 3} -> ${nV} joined · triangles: ${IDX.length / 3} -> ${tris} (error ${(err * 100).toFixed(2)} %)`);
const rgb = new Float32Array(tris * 3);
for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) rgb[t * 3 + k] = srgb((vcol[simple[t * 3] * 3 + k] + vcol[simple[t * 3 + 1] * 3 + k] + vcol[simple[t * 3 + 2] * 3 + k]) / 3);

/* ---------- a palette (k-means, seeded by spreading over the colours) ---------- */
function kmeans(k, iters = 12) {
  const n = rgb.length / 3, C = [];
  C.push([rgb[0], rgb[1], rgb[2]]);
  const d = new Float32Array(n).fill(1e9);
  while (C.length < k) {                                   // farthest-point seeding
    const c = C[C.length - 1];
    let best = 0;
    for (let i = 0; i < n; i++) {
      const e = (rgb[i * 3] - c[0]) ** 2 + (rgb[i * 3 + 1] - c[1]) ** 2 + (rgb[i * 3 + 2] - c[2]) ** 2;
      if (e < d[i]) d[i] = e;
      if (d[i] > d[best]) best = i;
    }
    if (d[best] < 4) break;
    C.push([rgb[best * 3], rgb[best * 3 + 1], rgb[best * 3 + 2]]);
  }
  const lab = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bi = 0, be = 1e18;
      for (let j = 0; j < C.length; j++) { const e = (rgb[i * 3] - C[j][0]) ** 2 + (rgb[i * 3 + 1] - C[j][1]) ** 2 + (rgb[i * 3 + 2] - C[j][2]) ** 2; if (e < be) { be = e; bi = j; } }
      lab[i] = bi; const S = sum[bi]; S[0] += rgb[i * 3]; S[1] += rgb[i * 3 + 1]; S[2] += rgb[i * 3 + 2]; S[3]++;
    }
    for (let j = 0; j < C.length; j++) if (sum[j][3]) C[j] = [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]];
  }
  return { palette: C.map(([r, g, b]) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)), lab };
}
const { palette, lab } = kmeans(COLOURS);

/* ---------- into the farm's frame: model +x (the head) -> +z, model z -> -x ---------- */
const pos = new Float32Array(tris * 9);
for (let t = 0; t < tris * 3; t++) {
  const i = simple[t], x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
  pos[t * 3] = -z * SCALE; pos[t * 3 + 1] = y * SCALE; pos[t * 3 + 2] = (x - MID_X) * SCALE;
}
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
const box = [...lo, ...hi].map(v => +v.toFixed(4));
const q = new Int16Array(pos.length);
for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) q[i + k] = Math.round(((pos[i + k] - box[k]) / Math.max(1e-6, box[k + 3] - box[k])) * 65535 - 32768);

const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
writeFileSync(OUT, `// Generated by tools/bake-goat.mjs from "Low poly Fat-tailed sheep 3d model" by iRahulRajput
// (https://sketchfab.com/rt699448), CC-BY-4.0. The farm's goat: ${tris} triangles, facing +z, feet at y = 0
// (js/farm/polyRig.js unpacks and rigs it). Do not edit by hand.
export const GOAT_MODEL = ${JSON.stringify({ tris, box, palette, q: b64(q), c: b64(lab) })};
`);
console.log(`box ${box.join(', ')} · ${palette.length} colours · ${OUT} ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`);
