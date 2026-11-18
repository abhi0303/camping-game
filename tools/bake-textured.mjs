// Bakes textured glTF models (models/<name>/scene.gltf) into what the game loads (js/baked.js):
//   models/<name>/game.bin        the meshes, one per material: positions and normals as 16-bit / 8-bit numbers,
//                                 texture coordinates as 16-bit numbers (each inside its part's box), indices
//   models/<name>/game-<k>.jpg    each material's colour texture, made smaller (macOS `sips`)
// Each model is turned, scaled and moved into the frame the game puts it in (metres, front at +z, the ground at
// y = 0), and parts the game doesn't want (a sky backdrop, a water ring) are left out.
//   node tools/bake-textured.mjs [name…]
// The models are CC-BY-4.0 (see each license.txt and the README's Credits).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// origin: the model point that becomes (0, 0, 0) (its ground under the front middle); yaw: then turned this much
// keep: materials to keep (all when left out); tex: the longest side of each texture (px); quality: JPEG quality
export const MODELS = {
  // the Fish Market (js/fishing/area.js): a junk ship run aground with a Chinese supply store in front of it. The
  // island and its water ring and the sky disc behind are left out: it stands on the ground, the hull sunk in.
  dae_villages__shipwrecked_chinese_supply_store: { scale: 0.1, origin: { x: 16, y: 24.6, z: 160 }, yaw: 0, keep: ['textureAtlas_m'], tex: { textureAtlas_m: 2048 }, quality: 82 },
  // a tall half-timbered house with an archway (Sonpur village, js/village/modelHomes.js)
  // (its archway side, the model's +x, becomes the front; scaled so you can walk through the arch)
  medieval_toon_house: { scale: 10.5, origin: { x: 0.08, y: 0, z: -0.29 }, yaw: -Math.PI / 2, tex: { Material: 1024 }, quality: 85 },
  // a Viking house among carrot beds, on its own patch of grass (Sonpur village, js/village/modelHomes.js)
  viking_carrot_farm: { scale: 0.012, origin: { x: 0, y: 0, z: 0 }, yaw: 0, tex: { M_Windows: 1024, M_Nature: 1024 }, quality: 82 },
};

function bake(name, M) {
  const SRC = join(ROOT, 'models', name);
  const gltf = JSON.parse(readFileSync(join(SRC, 'scene.gltf'), 'utf8')), bin = readFileSync(join(SRC, gltf.buffers[0].uri));
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const accessor = i => {
    const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType], stride = bv.byteStride || n * size, start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const get = { 5126: o => view.getFloat32(o, true), 5125: o => view.getUint32(o, true), 5123: o => view.getUint16(o, true), 5121: o => view.getUint8(o) }[a.componentType];
    const out = new Float64Array(a.count * n);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(start + k * stride + c * size);
    return out;
  };
  const mul = (a, b) => { const r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k]; return r; };
  const local = n => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  // the game's frame: (p - origin) * scale, turned by yaw about y
  const c = Math.cos(M.yaw), s = Math.sin(M.yaw), O = M.origin, S = M.scale;
  const place = (x, y, z) => { const dx = (x - O.x) * S, dz = (z - O.z) * S; return [dx * c + dz * s, (y - O.y) * S, -dx * s + dz * c]; };
  const turn = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [(x * c + z * s) / l, y / l, (-x * s + z * c) / l]; };
  // every primitive, merged per material
  const mats = new Map();
  (function walk(i, W) {
    const n = gltf.nodes[i], Wn = mul(W, local(n));
    if (n.mesh !== undefined) for (const p of gltf.meshes[n.mesh].primitives) {
      const mat = gltf.materials[p.material];
      if (M.keep && !M.keep.includes(mat.name)) continue;
      const P = accessor(p.attributes.POSITION), N = p.attributes.NORMAL !== undefined ? accessor(p.attributes.NORMAL) : null, UV = accessor(p.attributes.TEXCOORD_0);
      const idx = p.indices !== undefined ? accessor(p.indices) : Float64Array.from({ length: P.length / 3 }, (_, k) => k);
      if (!mats.has(mat.name)) mats.set(mat.name, { mat, pos: [], nor: [], uv: [], idx: [] });
      const G = mats.get(mat.name), base = G.pos.length / 3;
      // normals turn with the node's rotation (its inverse transpose; these nodes scale evenly or not at all)
      for (let v = 0; v < P.length / 3; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        G.pos.push(...place(Wn[0] * x + Wn[4] * y + Wn[8] * z + Wn[12], Wn[1] * x + Wn[5] * y + Wn[9] * z + Wn[13], Wn[2] * x + Wn[6] * y + Wn[10] * z + Wn[14]));
        if (N) { const a = N[v * 3], b = N[v * 3 + 1], d = N[v * 3 + 2]; G.nor.push(...turn(Wn[0] * a + Wn[4] * b + Wn[8] * d, Wn[1] * a + Wn[5] * b + Wn[9] * d, Wn[2] * a + Wn[6] * b + Wn[10] * d)); }
        else G.nor.push(0, 1, 0);
        G.uv.push(UV[v * 2], UV[v * 2 + 1]);
      }
      // a mirrored node flips its triangles' winding
      const det = Wn[0] * (Wn[5] * Wn[10] - Wn[6] * Wn[9]) - Wn[4] * (Wn[1] * Wn[10] - Wn[2] * Wn[9]) + Wn[8] * (Wn[1] * Wn[6] - Wn[2] * Wn[5]);
      for (let t = 0; t < idx.length; t += 3) det < 0 ? G.idx.push(base + idx[t], base + idx[t + 2], base + idx[t + 1]) : G.idx.push(base + idx[t], base + idx[t + 1], base + idx[t + 2]);
    }
    for (const ch of n.children || []) walk(ch, Wn);
  })(gltf.scenes[0].nodes[0], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  const parts = [], chunks = [];
  let offset = 0;
  const texFiles = new Map();                          // (materials sharing a texture share the file)
  const push = buf => { const pad = (4 - (buf.length % 4)) % 4, b = pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf; chunks.push(b); const o = offset; offset += b.length; return o; };
  for (const [mname, G] of mats) {
    const n = G.pos.length / 3, box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9], uvb = [1e9, 1e9, -1e9, -1e9];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { box[a] = Math.min(box[a], G.pos[i * 3 + a]); box[a + 3] = Math.max(box[a + 3], G.pos[i * 3 + a]); }
    for (let i = 0; i < n; i++) for (let a = 0; a < 2; a++) { uvb[a] = Math.min(uvb[a], G.uv[i * 2 + a]); uvb[a + 2] = Math.max(uvb[a + 2], G.uv[i * 2 + a]); }
    const q = new Int16Array(n * 3), u = new Uint16Array(n * 2), nr = new Int8Array(n * 3);
    for (let i = 0; i < n * 3; i++) { const a = i % 3; q[i] = Math.round((G.pos[i] - box[a]) / Math.max(1e-6, box[a + 3] - box[a]) * 65535 - 32768); nr[i] = Math.round(G.nor[i] * 127); }
    for (let i = 0; i < n * 2; i++) { const a = i % 2; u[i] = Math.round((G.uv[i] - uvb[a]) / Math.max(1e-6, uvb[a + 2] - uvb[a]) * 65535); }
    const big = n > 65535, ix = big ? Uint32Array.from(G.idx) : Uint16Array.from(G.idx);
    // the texture: smaller, as a JPEG (colour only: these materials have no see-through parts)
    const m = G.mat, pb = m.pbrMetallicRoughness || {}, ti = pb.baseColorTexture ? gltf.textures[pb.baseColorTexture.index].source : null;
    let tex = null;
    if (ti !== null) {
      const px = (M.tex && M.tex[mname]) || 1024, key = ti + '@' + px;
      if (!texFiles.has(key)) {
        texFiles.set(key, `game-${texFiles.size}.jpg`);
        execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(M.quality || 82), '-Z', String(px), join(SRC, gltf.images[ti].uri), '--out', join(SRC, texFiles.get(key))], { stdio: 'ignore' });
      }
      tex = texFiles.get(key);
    }
    const glow = !!(m.emissiveTexture || (m.emissiveFactor && m.emissiveFactor.some(v => v > 0.2)));
    parts.push({ name: mname, verts: n, tris: G.idx.length / 3, big, box: box.map(v => +v.toFixed(4)), uvbox: uvb.map(v => +v.toFixed(5)), tex, glow, double: !!m.doubleSided, color: pb.baseColorFactor || null,
      pos: push(Buffer.from(q.buffer)), uv: push(Buffer.from(u.buffer)), nor: push(Buffer.from(nr.buffer)), idx: push(Buffer.from(ix.buffer)) });
    console.log(`  ${mname}: ${n} vertices, ${G.idx.length / 3} triangles, box ${box.map(v => v.toFixed(2)).join(' ')}${tex ? ', ' + tex : ''}${glow ? ' (glows)' : ''}`);
  }
  const header = Buffer.from(JSON.stringify({ v: 1, parts })), pad = Buffer.alloc((4 - ((4 + header.length) % 4)) % 4, 32), len = Buffer.alloc(4);
  len.writeUInt32LE(header.length + pad.length);
  writeFileSync(join(SRC, 'game.bin'), Buffer.concat([len, header, pad, ...chunks]));
  console.log(`${name}: game.bin ${(offset + header.length + 4) / 1024 | 0} KB`);
}

const only = process.argv.slice(2);
for (const [name, M] of Object.entries(MODELS)) if (!only.length || only.includes(name)) bake(name, M);
