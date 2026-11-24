// Bakes the "Low Poly Farm V2" model (models/low_poly_farm_v2: glTF + a 64×64 colour palette texture) into what
// the game draws:
//   models/low_poly_farm_v2/farmstead.bin   the farm's buildings and things (Poly View Farm in Sonpur village,
//                                           js/village/farmstead.js), loaded when Farm World opens
//   js/farm/polyAnimals.js                  the model's pig (js/farm/polyRig.js gives it moving legs,
//                                           head and tail), small enough to ship with the game's code
// Every triangle gets the palette colour under its texture coordinates (the model is coloured that way), so the
// game can draw it with its own flat-shaded vertex-colour material. Positions are stored as 16-bit integers
// inside each part's box, one byte per triangle picks its colour.
//   node tools/bake-polyfarm.mjs
// The model: "Low Poly Farm V2" by EdwinRC (https://sketchfab.com/Edwin3D), CC-BY-4.0 — see its license.txt.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'models/low_poly_farm_v2');
const S = 0.55;                              // model units -> metres for the farm (the barn ~8 m to the ridge)
const GROUND_Y = -0.04;                      // the model's ground top
const CENTER = { x: 3.835, z: -9.675 };      // the middle of the fence, in the model
// The farm's own frame (js/village/farmstead.js): the gate faces +z. Model +x (the gate side) -> local +z.
const toFarm = (x, y, z) => [-(z - CENTER.z) * S, (y - GROUND_Y) * S, (x - CENTER.x) * S];

// the parts (model node names). The ground slab, the cows, the pigs and the hens are left out: the game has its
// own ground, and the animals are live ones (js/farm/farmland.js)
const PARTS = {
  barn: ['Cube.014', 'Cube.013'],            // the barn, and the horse looking out of its window
  fence: ['Text.001'],                       // the fence, the gate and the arch with the farm's name
  windmill: ['Plane.000'],
  trees: ['Plane.005'],
  pumpkins: ['Cube.009'],
  corn: ['Cube.010'],
  scarecrow: ['Plane'],
  rocks: ['Sphere.001'],
  hay: ['Cube.001', 'Cube.000', 'Cube.002'],
  tractor: ['Cube.011'],
};
// the animals: one of each, turned to face +z, feet at y = 0, scaled to the game's size (height at the withers)
const ANIMALS = {
  pig: { node: 'Plane.001', withers: 0.62 },
};

/* ---------- glTF ---------- */
const gltf = JSON.parse(readFileSync(join(SRC, 'scene.gltf'), 'utf8'));
const bin = readFileSync(join(SRC, gltf.buffers[0].uri));
function accessor(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  const start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const out = new T(a.count * n), view = new DataView(bin.buffer);
  const get = { 5126: o => view.getFloat32(o, true), 5125: o => view.getUint32(o, true), 5123: o => view.getUint16(o, true), 5121: o => view.getUint8(o) }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(start + k * stride + c * T.BYTES_PER_ELEMENT);
  return out;
}
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { const r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k]; return r; }
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const world = new Map();                     // node name -> world matrix of its mesh node(s)
(function walk(i, M) {
  const n = gltf.nodes[i], W = mul(M, local(n));
  if (n.mesh !== undefined) world.set(n.name, { W, mesh: n.mesh });
  for (const c of n.children || []) walk(c, W);
  // a mesh child named "<name>_0" belongs to its parent's name
  for (const c of n.children || []) if (gltf.nodes[c].mesh !== undefined && !world.has(n.name)) world.set(n.name, world.get(gltf.nodes[c].name));
})(gltf.scenes[0].nodes[0], I4);

/* ---------- the palette (PNG: 8-bit RGB / RGBA, not interlaced) ---------- */
function readPng(file) {
  const b = readFileSync(file);
  let p = 8, w = 0, h = 0, type = 0, idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; if (d[8] !== 8 || d[12]) throw new Error('unsupported PNG'); }
    if (t === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp) throw new Error('unsupported PNG colour type ' + type);
  const raw = inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * bpp), stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, up = y ? out[(y - 1) * stride + x] : 0, ul = y && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - ul, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, at: (u, v) => { const x = Math.min(w - 1, Math.max(0, Math.floor(u * w))), y = Math.min(h - 1, Math.max(0, Math.floor(v * h))), o = (y * w + x) * bpp; return (out[o] << 16) | (out[o + 1] << 8) | out[o + 2]; } };
}
const images = gltf.images.map(im => readPng(join(SRC, im.uri)));
const palette = [], palIdx = new Map();
const colourIndex = hex => { if (!palIdx.has(hex)) { palIdx.set(hex, palette.length); palette.push(hex); } return palIdx.get(hex); };

/* ---------- triangles of a node, in model world space, with a colour each ---------- */
function triangles(name) {
  const e = world.get(name);
  if (!e) throw new Error('no node ' + name);
  const out = { pos: [], col: [] };
  for (const prim of gltf.meshes[e.mesh].primitives) {
    const P = accessor(prim.attributes.POSITION), UV = accessor(prim.attributes.TEXCOORD_0), idx = prim.indices !== undefined ? accessor(prim.indices) : null;
    const mat = gltf.materials[prim.material], img = images[gltf.textures[mat.pbrMetallicRoughness.baseColorTexture.index].source];
    const n = idx ? idx.length : P.length / 3, W = e.W;
    for (let t = 0; t < n; t += 3) {
      let u = 0, v = 0;
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx[t + k] : t + k, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        out.pos.push(W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]);
        u += UV[i * 2] / 3; v += UV[i * 2 + 1] / 3;
      }
      out.col.push(colourIndex(img.at(u, v)));
    }
  }
  return out;
}

/* ---------- encoding ---------- */
// positions -> Int16 inside the part's box; returns { box, q (Int16Array), c (Uint8Array) }
function encode(pos, col) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
  const q = new Int16Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) q[i + k] = Math.round(((pos[i + k] - lo[k]) / Math.max(1e-6, hi[k] - lo[k])) * 65535 - 32768);
  return { box: [...lo, ...hi].map(v => +v.toFixed(4)), q, c: Uint8Array.from(col) };
}
// footprint circles: clusters of the part's low vertices (things to bump into: posts, trunks, wheels, walls)
function footprint(pos, below, link, rMin) {
  const pts = [];
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] < below) pts.push([pos[i], pos[i + 2]]);
  const cl = [];
  for (const p of pts) {
    const near = cl.filter(c => c.pts.some(q => Math.abs(q[0] - p[0]) < link && Math.abs(q[1] - p[1]) < link));
    if (!near.length) { cl.push({ pts: [p] }); continue; }
    const into = near[0];
    into.pts.push(p);
    for (const o of near.slice(1)) { into.pts.push(...o.pts); cl.splice(cl.indexOf(o), 1); }
  }
  return cl.map(c => {
    const xs = c.pts.map(p => p[0]), zs = c.pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return [+((x0 + x1) / 2).toFixed(2), +((z0 + z1) / 2).toFixed(2), +Math.max(rMin, Math.hypot(x1 - x0, z1 - z0) / 2).toFixed(2), +(x1 - x0).toFixed(2), +(z1 - z0).toFixed(2)];
  });
}

// the pieces of a part (triangles that share corners): [{ tris: [...], lo, hi }]
function islands(pos) {
  const n = pos.length / 9, par = Array.from({ length: n }, (_, i) => i), find = i => (par[i] === i ? i : (par[i] = find(par[i]))), own = new Map();
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const o = (t * 3 + k) * 3, key = `${Math.round(pos[o] * 500)},${Math.round(pos[o + 1] * 500)},${Math.round(pos[o + 2] * 500)}`;
    if (own.has(key)) par[find(t)] = find(own.get(key)); else own.set(key, t);
  }
  const g = new Map();
  for (let t = 0; t < n; t++) { const r = find(t); if (!g.has(r)) g.set(r, { tris: [], lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] }); g.get(r).tris.push(t); }
  for (const I of g.values()) for (const t of I.tris) for (let k = 0; k < 9; k++) { const c = k % 3, v = pos[t * 9 + k]; I.lo[c] = Math.min(I.lo[c], v); I.hi[c] = Math.max(I.hi[c], v); }
  return [...g.values()];
}
// The gate's leaf stands half open across the way in; swing it right open (out, along the arch's post), so you
// can walk through. Its pieces lie between the arch's left post and the way in, outside the fence line.
function openGate(pos) {
  const leaf = islands(pos).filter(I => I.lo[0] > -2.95 && I.hi[0] < -1.65 && I.lo[2] > 8.7 && I.hi[2] < 10 && I.hi[1] < 1.3);
  const vs = leaf.flatMap(I => I.tris.flatMap(t => [0, 1, 2].map(k => t * 9 + k * 3)));
  if (!vs.length) throw new Error('gate leaf not found');
  const avg = sel => { const s = vs.filter(sel); return [s.reduce((a, o) => a + pos[o], 0) / s.length, s.reduce((a, o) => a + pos[o + 2], 0) / s.length]; };
  const lo = Math.min(...vs.map(o => pos[o])), hi = Math.max(...vs.map(o => pos[o]));
  const hinge = avg(o => pos[o] < lo + 0.12), tip = avg(o => pos[o] > hi - 0.12);
  const turn = Math.atan2(1, 0.08) - Math.atan2(tip[1] - hinge[1], tip[0] - hinge[0]), c = Math.cos(turn), s = Math.sin(turn);
  for (const o of vs) { const dx = pos[o] - hinge[0], dz = pos[o + 2] - hinge[1]; pos[o] = hinge[0] + dx * c - dz * s; pos[o + 2] = hinge[1] + dx * s + dz * c; }
  console.log('gate leaf:', vs.length / 3, 'triangles swung', (turn * 180 / Math.PI).toFixed(0), '° about', hinge.map(v => v.toFixed(2)).join(', '));
}

/* ---------- the farm ---------- */
const parts = [], chunks = [];
let offset = 0;
for (const [name, nodes] of Object.entries(PARTS)) {
  const pos = [], col = [];
  for (const nd of nodes) {
    const t = triangles(nd);
    for (let i = 0; i < t.pos.length; i += 3) pos.push(...toFarm(t.pos[i], t.pos[i + 1], t.pos[i + 2]));
    col.push(...t.col);
  }
  if (name === 'fence') openGate(pos);
  const e = encode(pos, col), tris = col.length;
  parts.push({ name, tris, offset, box: e.box, foot: footprint(pos, 0.3, 0.35, 0.12) });
  const qb = Buffer.from(e.q.buffer), cb = Buffer.alloc(Math.ceil(tris / 4) * 4);
  Buffer.from(e.c.buffer).copy(cb);
  chunks.push(qb, cb); offset += qb.length + cb.length;
}

/* ---------- the animals ---------- */
const animals = {};
for (const [type, A] of Object.entries(ANIMALS)) {
  const t = triangles(A.node), P = t.pos;
  // its length along the ground: the main axis of its points (x, z)
  let mx = 0, mz = 0, n = P.length / 3;
  for (let i = 0; i < P.length; i += 3) { mx += P[i] / n; mz += P[i + 2] / n; }
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < P.length; i += 3) { const dx = P[i] - mx, dz = P[i + 2] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  let ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);           // the long axis' angle from +x
  const ax = Math.cos(ang), az = Math.sin(ang);
  // which end is the head: the end with more of the animal up high near it (head and neck) than the tail
  let yMin = 1e9, yMax = -1e9;
  for (let i = 1; i < P.length; i += 3) { yMin = Math.min(yMin, P[i]); yMax = Math.max(yMax, P[i]); }
  let fwd = 0;
  for (let i = 0; i < P.length; i += 3) if (P[i + 1] > yMin + (yMax - yMin) * 0.6) fwd += Math.sign((P[i] - mx) * ax + (P[i + 2] - mz) * az);
  const s = fwd >= 0 ? 1 : -1;
  // turn so the head points +z; feet on y = 0
  const pos = [];
  for (let i = 0; i < P.length; i += 3) {
    const dx = P[i] - mx, dz = P[i + 2] - mz, along = (dx * ax + dz * az) * s, across = (-dx * az + dz * ax) * s;
    pos.push(-across, P[i + 1] - yMin, along);
  }
  // scale: the height at the withers (the top of the back a little behind the front legs) to the game's size
  let back = 0, lo = 1e9, hi = -1e9;
  for (let i = 0; i < pos.length; i += 3) { lo = Math.min(lo, pos[i + 2]); hi = Math.max(hi, pos[i + 2]); }
  for (let i = 0; i < pos.length; i += 3) { const k = (pos[i + 2] - lo) / (hi - lo); if (k > 0.35 && k < 0.55 && Math.abs(pos[i]) < 0.3 * (hi - lo)) back = Math.max(back, pos[i + 1]); }
  const sc = A.withers / back;
  for (let i = 0; i < pos.length; i++) pos[i] *= sc;
  const e = encode(pos, t.col);
  animals[type] = { tris: t.col.length, box: e.box, q: Buffer.from(e.q.buffer).toString('base64'), c: Buffer.from(e.c.buffer).toString('base64') };
  console.log(type, 'tris', t.col.length, 'box', e.box.join(' '), 'scale', sc.toFixed(4), 'head', s > 0 ? '+axis' : '-axis');
}

/* ---------- write ---------- */
const header = Buffer.from(JSON.stringify({ v: 1, scale: S, palette, parts }));
const pad = Buffer.alloc((4 - ((4 + header.length) % 4)) % 4, 32);
const lenB = Buffer.alloc(4); lenB.writeUInt32LE(header.length + pad.length);
writeFileSync(join(SRC, 'farmstead.bin'), Buffer.concat([lenB, header, pad, ...chunks]));
writeFileSync(join(ROOT, 'js/farm/polyAnimals.js'), `// GENERATED by tools/bake-polyfarm.mjs from models/low_poly_farm_v2 — don't edit by hand.
// The pig of "Low Poly Farm V2" by EdwinRC (https://sketchfab.com/Edwin3D), CC-BY-4.0: positions as
// 16-bit integers inside each animal's box (base64), one palette colour (sRGB) per triangle.
export const PALETTE = ${JSON.stringify(palette)};
export const POLY_ANIMALS = ${JSON.stringify(animals, null, 1)};
`);
console.log('parts', parts.map(p => `${p.name}:${p.tris}`).join(' '), 'colours', palette.length, 'bin', offset + header.length + 4, 'bytes');
