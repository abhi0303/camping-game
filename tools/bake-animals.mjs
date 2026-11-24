// Bakes the farm's textured animal models into what the game draws:
//   js/farm/goatModel.js   the goat — "Low poly Fat-tailed sheep 3d model" (models/low_poly_fat-tailed_sheep_3d_model)
//   js/farm/cowModels.js   the cows — "Cow" (models/cows/brown_cow: the brown cow), "Cow Idle" (black_and_white_cow)
//                          and "Cow Skin" (black_cow)
// For each model:
//   - its meshes are placed by their nodes (a skinned mesh in its bind pose), every material with its own texture,
//   - the corners are joined along the textures' seams, each taking the colour around it (every triangle's
//     texture averaged over its area, in linear light — sRGB averages come out too dark),
//   - the mesh is simplified to about `tris` triangles (meshoptimizer keeps its shape and the colour edges: eyes,
//     nose, hooves, patches),
//   - every triangle gets the average of its corners' colours, quantised to a palette of `colours` colours,
//   - turned to face +z, feet at y = 0, scaled to the farm's size, the legs' middle at the origin,
//   - positions as 16-bit integers inside the box, one palette byte per triangle (js/farm/polyRig.js unpack).
// js/farm/polyRig.js gives them their moving legs, necks and tails.
//   npm i --no-save meshoptimizer@0.21.0   (once, anywhere; or MESHOPT=<path to its index.module.js>)
//   node tools/bake-animals.mjs [goat|cows]
// The models are CC-BY-4.0 (each folder's license.txt; credited in the README). Textures are read through macOS
// `sips` (Node has no JPEG / PNG decoder of its own).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const { MeshoptSimplifier } = await import(process.env.MESHOPT ? pathToFileURL(process.env.MESHOPT).href : 'meshoptimizer');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// place: model (x, y, z) -> the farm's frame (metres, facing +z, feet at y = 0), or
// face: the model's forward axis + height: its top in metres (feet on the ground, centred, the legs' middle at z = 0)
const OUTPUTS = {
  goat: {
    file: 'js/farm/goatModel.js', name: 'GOAT_MODEL',
    about: 'from "Low poly Fat-tailed sheep 3d model" by iRahulRajput\n// (https://sketchfab.com/rt699448), CC-BY-4.0. The farm\'s goat',
    models: {
      // it faces +x; 1.15 m nose to tail, the legs' middle at model x = -0.14
      goat: { dir: 'models/low_poly_fat-tailed_sheep_3d_model', tris: 4000, colours: 128, place: (x, y, z) => [-z * 1.15, y * 1.15, (x - -0.14) * 1.15] },
    },
  },
  cows: {
    file: 'js/farm/cowModels.js', name: 'COW_MODELS',
    about: 'from "Cow" by Josué Boisvert (https://sketchfab.com/JosueBoisvert),\n// "Cow Idle" by kenchoo (https://sketchfab.com/kenchoo) and "Cow Skin" by GSCreations (https://sketchfab.com/gscreations2508),\n// all CC-BY-4.0. The farm\'s cows (cow: the brown one, cow_bw: black and white, cow_black: black)',
    models: {
      cow: { dir: 'models/cows/brown_cow', tris: 4000, colours: 128, face: '+z', height: 1.32 },
      cow_bw: { dir: 'models/cows/black_and_white_cow', tris: 4000, colours: 128, face: '+z', height: 1.36 },
      cow_black: { dir: 'models/cows/black_cow', tris: 4000, colours: 128, face: '+z', height: 1.42 },
    },
  },
};

/* ---------- glTF ---------- */
function loadGltf(dir) {
  const gltf = JSON.parse(readFileSync(join(dir, 'scene.gltf'), 'utf8'));
  const bin = readFileSync(join(dir, gltf.buffers[0].uri));
  const accessor = i => {
    const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
    const out = new T(a.count * n), view = new DataView(bin.buffer);
    const get = { 5126: o => view.getFloat32(o, true), 5125: o => view.getUint32(o, true), 5123: o => view.getUint16(o, true), 5121: o => view.getUint8(o) }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(start + k * stride + c * T.BYTES_PER_ELEMENT);
    return out;
  };
  return { gltf, accessor };
}
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { const r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k]; return r; }
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const isIdentity = M => M.every((v, i) => v === I4[i]);

/* ---------- textures (via sips -> BMP, 1024 px), bilinear; glTF's v runs down the image ---------- */
function readTexture(file, size) {
  const dir = mkdtempSync(join(tmpdir(), 'bake-')), bmp = join(dir, 't.bmp');
  try {
    execFileSync('sips', ['-s', 'format', 'bmp', '-z', String(size), String(size), file, '--out', bmp], { stdio: 'ignore' });
    const b = readFileSync(bmp), off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28) / 8;
    const h = Math.abs(hRaw), stride = Math.ceil(w * bpp / 4) * 4, topDown = hRaw < 0;
    const px = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      const row = off + (topDown ? y : h - 1 - y) * stride;
      for (let x = 0; x < w; x++) { const o = row + x * bpp, i = (y * w + x) * 3; px[i] = b[o + 2]; px[i + 1] = b[o + 1]; px[i + 2] = b[o]; }
    }
    return (u, v, out) => {
      u -= Math.floor(u); v -= Math.floor(v);                       // (repeat wrapping)
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

/* ---------- one model ---------- */
const lin = v => Math.pow((v / 255 + 0.055) / 1.055, 2.4), srgb = l => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const BARY = [];
for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4 - i; j++) BARY.push([(i + 0.33) / 4.99, (j + 0.33) / 4.99]);   // 15 points inside

async function bake(label, A) {
  const SRC = join(ROOT, A.dir), { gltf, accessor } = loadGltf(SRC);
  // every primitive of every mesh node, in model space (a skinned mesh: its bind pose — the node's own transform is ignored)
  const prims = [];
  (function walk(i, M) {
    const n = gltf.nodes[i], W = mul(M, local(n));
    if (n.mesh !== undefined) for (const p of gltf.meshes[n.mesh].primitives) prims.push({ p, W: n.skin !== undefined ? I4 : W });
    for (const c of n.children || []) walk(c, W);
  })(gltf.scenes[0].nodes[0], I4);
  const textures = new Map();
  const texOf = (mat) => {
    const t = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
    if (!t) return null;
    const src = gltf.textures[t.index].source;
    if (!textures.has(src)) textures.set(src, readTexture(join(SRC, gltf.images[src].uri), 1024));
    return { tex: textures.get(src), uv: t.texCoord || 0 };
  };
  // all corners (placed), uvs, triangles (with their texture and colour factor)
  const P = [], UV = [], IDX = [], TRI = [];
  for (const { p, W } of prims) {
    const pos = accessor(p.attributes.POSITION), base = P.length / 3, mat = gltf.materials[p.material], T = texOf(mat);
    const uv = T ? accessor(p.attributes['TEXCOORD_' + T.uv]) : null, idx = p.indices !== undefined ? accessor(p.indices) : null;
    const f = (mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor) || [1, 1, 1, 1];
    const id = isIdentity(W);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (id) P.push(x, y, z);
      else P.push(W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]);
      UV.push(uv ? uv[(i / 3) * 2] : 0, uv ? uv[(i / 3) * 2 + 1] : 0);
    }
    const n = idx ? idx.length : pos.length / 3;
    for (let t = 0; t < n; t += 3) { for (let k = 0; k < 3; k++) IDX.push(base + (idx ? idx[t + k] : t + k)); TRI.push({ T, f }); }
  }

  // join the corners by position (the textures' seams split them), each taking the colour around it
  const lo0 = [1e9, 1e9, 1e9], hi0 = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo0[k] = Math.min(lo0[k], P[i + k]); hi0[k] = Math.max(hi0[k], P[i + k]); }
  const Q = 1e5 / Math.max(hi0[0] - lo0[0], hi0[1] - lo0[1], hi0[2] - lo0[2]);
  const key = i => `${Math.round(P[i * 3] * Q)},${Math.round(P[i * 3 + 1] * Q)},${Math.round(P[i * 3 + 2] * Q)}`;
  const weld = new Uint32Array(P.length / 3), first = new Map(), pts = [];
  for (let i = 0; i < weld.length; i++) { const k = key(i); if (!first.has(k)) { first.set(k, pts.length / 3); pts.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); } weld[i] = first.get(k); }
  const V = Float32Array.from(pts), nV = V.length / 3, acc = new Float64Array(nV * 4), s = [0, 0, 0];
  const idx = new Uint32Array(IDX.length);
  for (let t = 0; t < IDX.length; t += 3) {
    const [a, b, c] = [IDX[t], IDX[t + 1], IDX[t + 2]], { T, f } = TRI[t / 3];
    let r = 0, g = 0, bl = 0;
    for (const [ka, kb] of BARY) {
      const kc = 1 - ka - kb;
      if (T) { const u = UV[a * 2] * ka + UV[b * 2] * kb + UV[c * 2] * kc, v = UV[a * 2 + 1] * ka + UV[b * 2 + 1] * kb + UV[c * 2 + 1] * kc; T.tex(u, v, s); }
      else s[0] = s[1] = s[2] = 255;
      r += lin(s[0]); g += lin(s[1]); bl += lin(s[2]);
    }
    if (f[0] !== 1 || f[1] !== 1 || f[2] !== 1) { r *= f[0]; g *= f[1]; bl *= f[2]; }
    const e1 = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
    const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2 + 1e-12;
    for (const i of [a, b, c]) { const o = weld[i] * 4; acc[o] += r / BARY.length * area; acc[o + 1] += g / BARY.length * area; acc[o + 2] += bl / BARY.length * area; acc[o + 3] += area; }
    idx[t] = weld[a]; idx[t + 1] = weld[b]; idx[t + 2] = weld[c];
  }
  const vcol = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) vcol[i * 3 + k] = acc[i * 4 + k] / (acc[i * 4 + 3] || 1);

  // simplify (keeping colour edges)
  await MeshoptSimplifier.ready;
  MeshoptSimplifier.useExperimentalFeatures = true;
  const [simple, err] = MeshoptSimplifier.simplifyWithAttributes(idx, V, 3, vcol, 3, [0.4, 0.4, 0.4], null, A.tris * 3, 0.05);
  const tris = simple.length / 3;
  const rgb = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) rgb[t * 3 + k] = srgb((vcol[simple[t * 3] * 3 + k] + vcol[simple[t * 3 + 1] * 3 + k] + vcol[simple[t * 3 + 2] * 3 + k]) / 3);
  const { palette, lab } = kmeans(rgb, A.colours);

  // into the farm's frame
  let place = A.place;
  if (!place) {
    const ax = { '+x': [0, 1], '-x': [0, -1], '+z': [2, 1], '-z': [2, -1] }[A.face], side = ax[0] === 0 ? 2 : 0;
    const used = new Set(simple), sc = A.height / (hi0[1] - lo0[1]), cx = (lo0[side] + hi0[side]) / 2;
    // the legs' middle: the hooves (the corners near the ground), half way between the front and the hind ones
    let f0 = 1e9, f1 = -1e9;
    for (const i of used) if (V[i * 3 + 1] < lo0[1] + (hi0[1] - lo0[1]) * 0.06) { const v = V[i * 3 + ax[0]] * ax[1]; f0 = Math.min(f0, v); f1 = Math.max(f1, v); }
    const mid = (f0 + f1) / 2;
    // facing +z: forward = the model's axis (× its sign); x: the other axis, so that the turn keeps the model's handedness
    place = (x, y, z) => {
      const m = [x, y, z], fw = m[ax[0]] * ax[1] - mid, sd = (m[side] - cx) * (ax[0] === 0 ? -ax[1] : ax[1]);
      return [sd * sc, (y - lo0[1]) * sc, fw * sc];
    };
  }
  const pos = new Float32Array(tris * 9);
  for (let t = 0; t < tris * 3; t++) {
    const i = simple[t], p = place(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]);
    pos[t * 3] = p[0]; pos[t * 3 + 1] = p[1]; pos[t * 3 + 2] = p[2];
  }
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
  // (the box is rounded outwards, and the values clamped: a corner just past its edge would wrap round to the other side)
  const box = [...lo.map(v => Math.floor(v * 1e4) / 1e4), ...hi.map(v => Math.ceil(v * 1e4) / 1e4)];
  const q = new Int16Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) q[i + k] = Math.max(-32768, Math.min(32767, Math.round(((pos[i + k] - box[k]) / Math.max(1e-6, box[k + 3] - box[k])) * 65535 - 32768)));
  console.log(`${label}: corners ${P.length / 3} -> ${nV} joined · triangles ${IDX.length / 3} -> ${tris} (error ${(err * 100).toFixed(2)} %) · box ${box.join(', ')} · ${palette.length} colours`);
  const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
  return { tris, box, palette, q: b64(q), c: b64(lab) };
}

/* ---------- a palette (k-means, seeded by spreading over the colours) ---------- */
function kmeans(rgb, k, iters = 12) {
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

/* ---------- the files ---------- */
const only = process.argv[2];
for (const [name, O] of Object.entries(OUTPUTS)) {
  if (only && only !== name) continue;
  const out = {};
  for (const [k, A] of Object.entries(O.models)) out[k] = await bake(k, A);
  const single = Object.keys(out).length === 1, file = join(ROOT, O.file);
  const tris = Object.values(out).map(m => m.tris).join(' / ');
  writeFileSync(file, `// Generated by tools/bake-animals.mjs ${O.about}: ${tris} triangles, facing +z, feet at y = 0
// (js/farm/polyRig.js unpacks and rigs ${single ? 'it' : 'them'}). Do not edit by hand.
export const ${O.name} = ${JSON.stringify(single ? Object.values(out)[0] : out)};
`);
  console.log(`${O.file} ${(readFileSync(file).length / 1024).toFixed(0)} KB`);
}
