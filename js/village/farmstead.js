// Poly View Farm: a farmstead at the edge of Sonpur village (Farm World), west of the path to the fishing docks.
// The model is "Low Poly Farm V2" by EdwinRC (https://sketchfab.com/Edwin3D, CC-BY-4.0), baked by
// tools/bake-polyfarm.mjs into models/low_poly_farm_v2/farmstead.bin: a red barn with a porch (two benches, a
// door, and a horse looking out of a window), a fenced yard with an arch over the gate, a windmill, pines, beds of
// corn and pumpkins with a scarecrow, a tractor, hay bales and rocks. Its cows, pigs and hens are live: the farm's
// decorative animals (js/farm/farmland.js), wandering, grazing and rooting in the yard.
// The ground under it is level (js/terrain.js PADS). A dirt lane leads from the docks path through the gate to the
// barn, with a lamp at the gate and a lantern on the porch. The fences, walls and benches are set up right away;
// the model itself is drawn when its file has loaded (nothing else waits for it), so where you can walk never
// depends on when it arrives.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT } from '../utils.js';
import { PADS } from '../terrain.js';
import { lampPost, wallLantern } from '../farm/props.js';
import { unpack } from '../farm/polyRig.js';

const FILE = 'models/low_poly_farm_v2/farmstead.bin';
export const FARMSTEAD = { x: PADS[0].x, z: PADS[0].z, yaw: PADS[0].yaw, name: 'Poly View Farm' };   // the gate faces +z (east)
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 100000) / 100000; };

// the layout in the farm's own frame (metres; the gate at +z, the barn at the back)
const FENCE = { x: 10.07, back: -9.84, front: 9.13 }, GATE = { x0: -2.62, x1: -1.25 };          // the way in under the arch
const BARN = { x0: -6.4, x1: 6.42, z0: -8.38, z1: -1.45 }, PORCH = { x0: -8.65, x1: -6.4, z0: -8.4, z1: -1.5, h: 0.14 };
const BENCHES = [{ x: -6.73, z: -7.0 }, { x: -6.73, z: -3.25 }], BENCH_H = 0.44;
const BEDS = [{ x0: -9.54, x1: -2.55, z0: 0.63, z1: 3.78 }, { x0: -9.54, x1: -2.55, z0: 4.65, z1: 7.9 }];   // corn, pumpkins
const SOLID = [[7.63, -1.16, 0.25], [6.64, 0.44, 0.25], [9.12, -0.24, 0.25], [8.13, 1.37, 0.25],            // the windmill's legs
  [8.28, -8.27, 0.38], [6.62, 6.22, 0.32], [4.88, 3.31, 0.32], [7.8, 2.92, 0.45],                           // the pines
  [0.45, 2.43, 1.0], [1.44, 0.38, 0.6], [2.42, 1.29, 0.6],                                                  // the tractor
  [4.95, 4.99, 1.1], [-5.45, -0.93, 0.5], [-4.45, -0.93, 0.5],                                              // the rocks, the hay
  [-3.1, 9.0, 0.42], [0.42, 9.0, 0.42],                                                                     // the arch's posts
  [-8.45, -1.67, 0.14], [-8.43, -3.71, 0.14], [-8.43, -6.2, 0.14], [-8.49, -8.24, 0.14]];                  // the porch posts
// where the animals wander (local boxes, well inside the fence: a cow is 2.3 m long): the yard inside the gate,
// the strip east of the barn, the pigs by the rocks, the hens between the tractor and the windmill
const YARD = { x0: -1.0, x1: 2.7, z0: 4.5, z1: 7.5 }, STRIP = { x0: 7.6, x1: 9.2, z0: -7.0, z1: -2.6 }, STY = { x0: 2.6, x1: 9.2, z0: 6.9, z1: 8.1 }, COOP = { x0: 3.4, x1: 6.2, z0: -0.9, z1: 2.4 };
const HERD = [['cow', YARD], ['cow', YARD], ['cow', STRIP], ['pig', STY], ['pig', STY], ['pig', STY, 0.62], ['chicken', COOP], ['chicken', COOP], ['chicken_brown', COOP]];

export class Farmstead {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.F = FARMSTEAD; this.on = false; this.mesh = null;
    // the lane: from the docks path to the gate, then through the yard to the barn's doors (world segments for
    // the village ground: ax, az, bx, bz, width)
    const g0 = this.at(-1.94, 10.4), g1 = this.at(-0.45, -1.2);
    this.segs = [[-96.6, g0.z, g0.x, g0.z, 2.2], [g0.x, g0.z, g1.x, g1.z, 1.7]];
    const corners = m => [[-10.6 - m, -10.4 - m], [10.6 + m, -10.4 - m], [10.6 + m, 10.9 + m], [-10.6 - m, 10.9 + m]].map(([a, b]) => this.at(a, b));
    const boxOf = c => ({ x0: Math.min(...c.map(p => p.x)), x1: Math.max(...c.map(p => p.x)), z0: Math.min(...c.map(p => p.z)), z1: Math.max(...c.map(p => p.z)) });
    this.box = boxOf(corners(0)); this.box.x1 = Math.max(this.box.x1, -96.6);       // (and the lane)
    this.clear = boxOf(corners(3.5));                          // no jungle trees over the fence
    this.seats = [];
  }
  // world point at local (lx, lz) / local point of world (x, z)
  at(lx, lz) { const F = this.F, c = Math.cos(F.yaw), s = Math.sin(F.yaw); return { x: F.x + lx * c + lz * s, z: F.z - lx * s + lz * c }; }
  local(x, z) { const F = this.F, c = Math.cos(F.yaw), s = Math.sin(F.yaw), dx = x - F.x, dz = z - F.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; }

  // chunk(x, z): the village's GeoBuilder there (the lamp and the lantern go into the village's meshes)
  enable({ farmland, chunk } = {}) {
    if (this.on) return;
    this.on = true;
    const W = this.world, T = W.T, F = this.F;
    this.y = T.heightAt(F.x, F.z);
    W.clearArea([this.clear, { x0: -107, x1: -96.6, z0: this.segs[0][1] - 2.5, z1: this.segs[0][1] + 2.5 }]);   // (the jungle; and along the lane)
    this._colliders();
    // the porch floor is walked on
    W.surfaces.push({ surfaceAt: (x, z) => { const l = this.local(x, z); return l.x > PORCH.x0 && l.x < PORCH.x1 && l.z > PORCH.z0 && l.z < PORCH.z1 ? this.y + PORCH.h : null; } });
    // no grass blades in the barn, the porch, the beds, under the tractor and the rocks, or on the lane
    const segD = (x, z, [ax, az, bx, bz]) => { const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
    W.addGrassBlock((x, z) => {
      if (x < this.box.x0 - 1 || x > this.box.x1 + 1 || z < this.box.z0 - 1 || z > this.box.z1 + 1) return false;
      if (this.segs.some(s => segD(x, z, s) < s[4] / 2 + 0.2)) return true;
      const l = this.local(x, z), inR = (R, m = 0.2) => l.x > R.x0 - m && l.x < R.x1 + m && l.z > R.z0 - m && l.z < R.z1 + m;
      return inR(BARN) || inR(PORCH) || BEDS.some(B => inR(B)) || Math.hypot(l.x - 1.4, l.z - 1.4) < 1.9 || Math.hypot(l.x - 4.95, l.z - 4.99) < 1.3;
    });
    // a lamp at the gate (its lantern over the lane) and a lantern on the porch, by the door
    if (chunk) {
      const p = this.at(-4.1, 10.7), b = chunk(p.x, p.z);
      lampPost(b, p.x, T.heightAt(p.x, p.z), p.z, F.yaw);
      W.addCollider({ x: p.x, z: p.z, r: 0.2 });
      const q = this.at(-6.4, -5.9), b2 = chunk(q.x, q.z);
      b2.group(q.x, this.y + 1.55, q.z, 0, F.yaw, 0, () => wallLantern(b2, 0, 0, 0, -Math.PI / 2));
    }
    // the benches on the porch (sit on them: js/village/index.js)
    this.seats = BENCHES.map(B => { const p = this.at(B.x, B.z); return { F: { x: p.x, z: p.z, yaw: F.yaw - Math.PI / 2 }, where: 'porch', h: BENCH_H, local: [[-0.42, 0], [0.42, 0]] }; });
    // the animals
    if (farmland && farmland.decor) farmland.decor.push(...HERD.map(([type, R, size], i) => {
      const id = `v-polyfarm-${i}`;
      return { id, type, k: hash(id), home: { F: { x: F.x, z: F.z, yaw: F.yaw }, R }, ...(size ? { size } : {}) };
    }));
    this._load();
  }
  _colliders() {
    const W = this.world, dot = (lx, lz, r) => { const p = this.at(lx, lz); W.addCollider({ x: p.x, z: p.z, r }); };
    const wall = (ax, az, bx, bz, r, step) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step)); for (let i = 0; i <= n; i++) dot(ax + (bx - ax) * i / n, az + (bz - az) * i / n, r); };
    const X = FENCE.x;
    wall(-X, FENCE.back, X, FENCE.back, 0.22, 0.45); wall(-X, FENCE.back, -X, FENCE.front, 0.22, 0.45); wall(X, FENCE.back, X, FENCE.front, 0.22, 0.45);
    wall(-X, FENCE.front, GATE.x0 - 0.5, FENCE.front, 0.22, 0.45); wall(GATE.x1, FENCE.front, X, FENCE.front, 0.22, 0.45);
    wall(-2.78, 9.5, -2.71, 10.2, 0.12, 0.3);                                      // the gate's leaf, swung open (tools/bake-polyfarm.mjs)
    const ring = (R, r) => { wall(R.x0 + r, R.z0 + r, R.x1 - r, R.z0 + r, r, r * 1.6); wall(R.x1 - r, R.z0 + r, R.x1 - r, R.z1 - r, r, r * 1.6); wall(R.x1 - r, R.z1 - r, R.x0 + r, R.z1 - r, r, r * 1.6); wall(R.x0 + r, R.z1 - r, R.x0 + r, R.z0 + r, r, r * 1.6); };
    ring(BARN, 0.45);
    for (const B of BEDS) ring(B, 0.3);
    for (const [x, z, r] of SOLID) dot(x, z, r);
    for (const B of BENCHES) { dot(B.x - 0.1, B.z - 0.5, 0.25); dot(B.x - 0.1, B.z + 0.5, 0.25); }
  }
  // the model: one mesh, drawn once its file has come
  async _load() {
    try {
      const res = await fetch(FILE);
      if (!res.ok) throw new Error(res.status);
      const buf = await res.arrayBuffer(), n = new DataView(buf).getUint32(0, true), base = 4 + n;
      const H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
      const geos = H.parts.map(p => unpack(p, H.palette, new Int16Array(buf, base + p.offset, p.tris * 9), new Uint8Array(buf, base + p.offset + p.tris * 18, p.tris)));
      const geo = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      geo.deleteAttribute('normal');                        // (flat shading works its normals out itself)
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, MAT.solid);
      m.position.set(this.F.x, this.y, this.F.z); m.rotation.y = this.F.yaw;
      m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); m.name = 'polyfarm';
      this.scene.add(m); this.world.addFogCull(m); this.mesh = m;
    } catch (e) { console.warn('[farmstead] model not loaded:', e.message || e); }
  }
  // the barn on the village map
  mapHouses() {
    const c = this.at((PORCH.x0 + BARN.x1) / 2, (BARN.z0 + BARN.z1) / 2);
    return [{ x: c.x, z: c.z, yaw: this.F.yaw, w: BARN.x1 - PORCH.x0, d: BARN.z1 - BARN.z0, round: false, col: 0x8a5a44 }];
  }
}
