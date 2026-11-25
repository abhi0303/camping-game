// The guard dogs' models, with their own textures (baked by tools/bake-animals.mjs: models/dogs/<dir>/game.bin and its
// game-<k>.jpg / .png textures, one per group of triangles): level 1 the Cane Corso, level 2 the German Shepherd, level 3
// the Boxer. Loaded when Farm World's dogs start (js/farm/dogs.js); positions in the dog's frame (facing +z, paws at
// y = 0), the textures as glTF has them (not flipped); a see-through texture (the German Shepherd's fur fringes) is
// drawn with its alpha cut out.
import * as THREE from 'three';

export const DOG_MODELS = { 1: 'models/dogs/cane_corso_level_1', 2: 'models/dogs/german_shepherd_level_2', 3: 'models/dogs/boxer_level_3' };
// each level's breed (a dog changes breed as it's trained)
export const DOG_BREEDS = { 1: 'Cane Corso', 2: 'German Shepherd', 3: 'Boxer' };
const cache = {};
// -> Promise<{ geometry (position, uv, index, a group per texture), textures: [{ texture, alpha }] }>
export function loadDog(level) {
  if (cache[level]) return cache[level];
  const dir = DOG_MODELS[level];
  return (cache[level] = fetch(`${dir}/game.bin`).then(r => { if (!r.ok) throw new Error(`${dir}/game.bin: ${r.status}`); return r.arrayBuffer(); }).then(buf => {
    const len = new DataView(buf).getUint32(0, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)).trim());
    let o = 4 + len;
    const q = new Int16Array(buf, o, H.verts * 3); o += Math.ceil(H.verts * 6 / 4) * 4;
    const qu = new Uint16Array(buf, o, H.verts * 2); o += Math.ceil(H.verts * 4 / 4) * 4;
    const idx = H.index === 2 ? new Uint16Array(buf, o, H.tris * 3) : new Uint32Array(buf, o, H.tris * 3);
    const B = H.box, U = H.uv, pos = new Float32Array(H.verts * 3), uv = new Float32Array(H.verts * 2);
    for (let i = 0; i < H.verts; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = B[k] + (q[i * 3 + k] + 32768) / 65535 * (B[k + 3] - B[k]);
      for (let k = 0; k < 2; k++) uv[i * 2 + k] = U[k] + qu[i * 2 + k] / 65535 * (U[k + 2] - U[k]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    H.groups.forEach((G, k) => g.addGroup(G.start, G.count, k));
    g.computeBoundingSphere();
    const loader = new THREE.TextureLoader();
    return Promise.all(H.groups.map(G => loader.loadAsync(`${dir}/${G.tex}`).then(texture => {
      texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
      return { texture, alpha: G.alpha };
    }))).then(textures => ({ geometry: g, textures }));
  }));
}
