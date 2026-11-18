// Textured models baked by tools/bake-textured.mjs (models/<name>/game.bin and its game-<k>.jpg textures): loaded
// into a group with one mesh per material, drawn with the game's own lighting (Lambert, smooth shading), casting
// and taking shadows. A material that glows (lit windows) glows brighter at night (js/day-night.js addGlow).
// The group is in the model's own frame (metres, front at +z, its ground at y = 0); place it like any model.
import * as THREE from 'three';

const loader = new THREE.TextureLoader(), files = new Map();
// a model's file (fetched once, however many copies are drawn)
function fetchBin(url) {
  if (!files.has(url)) files.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); }));
  return files.get(url);
}
function texture(url) {
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;                  // (glTF's texture coordinates)
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
// name: the folder in models/. dayNight: lets glowing windows light up at night
export async function loadBaked(name, { dayNight = null } = {}) {
  const dir = `models/${name}/`, buf = await fetchBin(dir + 'game.bin'), n = new DataView(buf).getUint32(0, true), base = 4 + n;
  const H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))), group = new THREE.Group(), maps = new Map();
  for (const p of H.parts) {
    const q = new Int16Array(buf, base + p.pos, p.verts * 3), u = new Uint16Array(buf, base + p.uv, p.verts * 2), nr = new Int8Array(buf, base + p.nor, p.verts * 3);
    const B = p.box, U = p.uvbox, pos = new Float32Array(p.verts * 3), uv = new Float32Array(p.verts * 2);
    for (let i = 0; i < p.verts * 3; i++) { const a = i % 3; pos[i] = B[a] + (q[i] + 32768) / 65535 * (B[a + 3] - B[a]); }
    for (let i = 0; i < p.verts * 2; i++) { const a = i % 2; uv[i] = U[a] + u[i] / 65535 * (U[a + 2] - U[a]); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Int8Array.from(nr), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(p.big ? new Uint32Array(buf.slice(base + p.idx, base + p.idx + p.tris * 12)) : new Uint16Array(buf.slice(base + p.idx, base + p.idx + p.tris * 6)), 1));
    g.computeBoundingSphere();
    if (p.tex && !maps.has(p.tex)) maps.set(p.tex, texture(dir + p.tex));
    const map = p.tex ? maps.get(p.tex) : null;
    const mat = new THREE.MeshLambertMaterial({ map, side: p.double ? THREE.DoubleSide : THREE.FrontSide, ...(p.color ? { color: new THREE.Color().setRGB(p.color[0], p.color[1], p.color[2], THREE.SRGBColorSpace) } : {}) });
    if (p.glow) { mat.emissive.set(0xffffff); mat.emissiveMap = map; mat.emissiveIntensity = 0.25; if (dayNight && dayNight.addGlow) dayNight.addGlow(mat, 0.25, 1.25); }
    const m = new THREE.Mesh(g, mat);
    m.name = p.name; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  return group;
}
