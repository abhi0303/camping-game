// Two homes from models at Sonpur's lower end, across the docks path from Poly View Farm, facing the path (both
// CC-BY-4.0, baked by tools/bake-textured.mjs; see the README's Credits):
//   the carrot farm   "Viking Carrot Farm" by Tom Verbeeck: a timber house with a steep tiled roof and crossed
//                     gable beams on its own patch of grass, carrot beds behind, baskets of carrots, a sheep, rabbits,
//                     crows on the roof, a shield by the door; its windows glow at night
//   the archway house "Medieval Toon House" by guillemvilah: a tall half-timbered tower house with a slate roof, a
//                     chimney and a weathervane, a wing on stilts, and an annex with an archway you can walk through,
//                     a lantern on its bracket at the end
// The ground under each is level (js/terrain.js PADS); a dirt path leads to each from the docks path. The walls
// are set up right away; the models are drawn when their files have come.
import { PADS } from '../terrain.js';
import { loadBaked } from '../baked.js';

// each home: its model, its frame (from PADS), the walls (rectangles and posts in its own frame, front = +z), the
// path's end at its door (local), the lights (local), its roof colour on the map
export const HOMES = [
  { name: 'Carrot farm', model: 'viking_carrot_farm', pad: 1, door: { x: 0.4, z: 4.0 },
    rects: [{ x0: -1.7, x1: 2.4, z0: -2.4, z1: 2.1 }], posts: [[-2.45, 0.53, 0.55], [2.63, -3.06, 0.4], [3.0, 0.4, 0.45]],
    lights: [], col: 0x2f8a8a },
  { name: 'Archway house', model: 'medieval_toon_house', pad: 2, door: { x: 0.75, z: 2.6 }, through: { x: 0.75, z: -4.6 },
    rects: [{ x0: -5.73, x1: -0.32, z0: -3.78, z1: 1.62 }, { x0: -4.75, x1: -1.3, z0: 1.62, z1: 3.4 }, { x0: 1.65, x1: 3.95, z0: -2.47, z1: 0.83 }],
    posts: [[-0.18, -2.3, 0.2], [-0.18, -1.6, 0.2], [-0.18, -0.9, 0.2], [-0.18, -0.2, 0.2], [-0.18, 0.5, 0.2]],    // (the arch's left side)
    lights: [[5.72, 3.35, -0.83, 'lamp']], col: 0x3a4652 },
];
// the docks path (js/fishing/area.js): from the village's main street to the middle dock's bank
const PATH = [[-95.5, -10], [-99.4, 37.4]];
const pathX = z => PATH[0][0] + (PATH[1][0] - PATH[0][0]) * (z - PATH[0][1]) / (PATH[1][1] - PATH[0][1]);

export class ModelHomes {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.on = false;
    this.homes = HOMES.map(h => ({ ...h, F: { x: PADS[h.pad].x, z: PADS[h.pad].z, yaw: PADS[h.pad].yaw } }));
    // a dirt path from the docks path to each door (and on through the archway): world segments for the village ground
    this.segs = [];
    for (const H of this.homes) {
      const d = this.at(H, H.door.x, H.door.z), e = H.through ? this.at(H, H.through.x, H.through.z) : d;
      this.segs.push([pathX(d.z), d.z, e.x, e.z, 1.6]);
    }
  }
  at(H, lx, lz) { const c = Math.cos(H.F.yaw), s = Math.sin(H.F.yaw); return { x: H.F.x + lx * c + lz * s, z: H.F.z - lx * s + lz * c }; }
  local(H, x, z) { const c = Math.cos(H.F.yaw), s = Math.sin(H.F.yaw), dx = x - H.F.x, dz = z - H.F.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; }

  enable({ dayNight } = {}) {
    if (this.on) return;
    this.on = true;
    const W = this.world, T = W.T;
    for (const H of this.homes) {
      const P = PADS[H.pad], y = T.heightAt(H.F.x, H.F.z);
      // the jungle off its ground
      const cs = [[-P.hw - 2, -P.hd - 2], [P.hw + 2, -P.hd - 2], [P.hw + 2, P.hd + 2], [-P.hw - 2, P.hd + 2]].map(([a, b]) => this.at(H, a, b));
      W.clearArea([{ x0: Math.min(...cs.map(p => p.x)), x1: Math.max(...cs.map(p => p.x)), z0: Math.min(...cs.map(p => p.z)), z1: Math.max(...cs.map(p => p.z)) }]);
      // walls and posts
      const dot = (lx, lz, r) => { const p = this.at(H, lx, lz); W.addCollider({ x: p.x, z: p.z, r }); };
      const wall = (ax, az, bx, bz, r) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (r * 1.5))); for (let i = 0; i <= n; i++) dot(ax + (bx - ax) * i / n, az + (bz - az) * i / n, r); };
      for (const R of H.rects) { const r = 0.35; wall(R.x0 + r, R.z0 + r, R.x1 - r, R.z0 + r, r); wall(R.x1 - r, R.z0 + r, R.x1 - r, R.z1 - r, r); wall(R.x1 - r, R.z1 - r, R.x0 + r, R.z1 - r, r); wall(R.x0 + r, R.z1 - r, R.x0 + r, R.z0 + r, r); }
      for (const [x, z, r] of H.posts) dot(x, z, r);
      // no grass blades through the floors
      W.addGrassBlock((x, z) => { if (Math.abs(x - H.F.x) > 9 || Math.abs(z - H.F.z) > 9) return false; const l = this.local(H, x, z); return H.rects.some(R => l.x > R.x0 - 0.2 && l.x < R.x1 + 0.2 && l.z > R.z0 - 0.2 && l.z < R.z1 + 0.2); });
      loadBaked(H.model, { dayNight }).then(g => {
        if (H.lights.length) g.userData.lights = H.lights;
        g.position.set(H.F.x, y, H.F.z); g.rotation.y = H.F.yaw;
        this.scene.add(g); g.updateMatrixWorld(true);
        g.children.forEach(m => W.addFogCull(m));
        H.group = g;
      }, e => console.warn(`[village] ${H.name} not loaded:`, e.message || e));
    }
  }
  // the houses on the village map (each rectangle)
  mapHouses() {
    return this.homes.flatMap(H => H.rects.map(R => { const c = this.at(H, (R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2); return { x: c.x, z: c.z, yaw: H.F.yaw, w: R.x1 - R.x0, d: R.z1 - R.z0, round: false, col: H.col }; }));
  }
}
