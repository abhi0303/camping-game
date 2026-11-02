// The farm in the 3D world (Farm World only): cleared ground near the trailhead, 8 plots, the market
// stall, the farm store, shelters built from the server's state, and the animals walking in their pens.
// Animal movement is worked out from the shared (server) clock and each animal's id, so every player
// sees the same animals in the same places without sending positions over the network.
import * as THREE from 'three';
import { GeoBuilder, MAT } from '../utils.js';
import { PLOTS, PEN, MARKET, STORE, SIGN, CLEAR, toWorld } from './layout.js';
import { shelterModel, marketModel, storeModel, plotStakes, signMesh, ANIMAL_GEO } from './models.js';

const MAX_PER_TYPE = 64;
const SPEED = { chicken: 1.6, goat: 0.8, cow: 0.45, horse: 0.6 };
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 100000) / 100000; };

export class Farmland {
  // hooks: { onMarket, onStore, onPlot(i), onShelter(building) } — open the popups
  constructor(scene, world, hooks) {
    this.scene = scene; this.world = world; this.hooks = hooks;
    this.on = false; this.st = null; this.built = new Map(); this.byPlot = new Map(); this.list = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._e = new THREE.Euler();
  }
  H(x, z) { return this.world.heightAt(x, z); }

  // first time Farm World is played on this page: clear the ground and set up the farm
  enable() {
    if (this.on) return;
    this.on = true;
    this.world.clearArea(CLEAR);
    const b = new GeoBuilder();
    for (const P of PLOTS) b.group(P.x, this.H(P.x, P.z), P.z, 0, P.yaw, 0, () => plotStakes(b));
    this.scene.add(b.build());
    const place = (obj, at, y = 0) => { obj.position.set(at.x, this.H(at.x, at.z) + y, at.z); obj.rotation.y = at.yaw || 0; this.scene.add(obj); return obj; };
    place(marketModel(), MARKET);
    place(storeModel(), STORE);
    this.world.addCollider({ x: MARKET.x, z: MARKET.z, r: 1.6 });
    this.world.addCollider({ x: STORE.x - 0.4, z: STORE.z, r: 1.8 });
    const fwd = (at, d) => ({ x: at.x + Math.sin(at.yaw) * d, z: at.z + Math.cos(at.yaw) * d, yaw: at.yaw });
    place(signMesh('MARKET', 'buy · sell', 2.2, 0.8), { ...fwd(MARKET, -0.9) }, 3.15);
    place(signMesh('FARM STORE', 'logs · stones', 2.2, 0.8), { ...fwd(STORE, -1.45) }, 2.95);
    // plot number signs at each gate
    PLOTS.forEach(P => { const w = toWorld(P, 2.4, 6.4); const s = signMesh(`PLOT ${P.i + 1}`, '', 0.9, 0.34); place(s, { x: w.x, z: w.z, yaw: P.yaw }, 1.25); });
    // sign by the road
    const post = new GeoBuilder(); post.cyl(0.1, 0.12, 2.6, 6, 0, 1.3, 0, 0x6e4a2a);
    place(post.build(), SIGN);
    const ang = Math.atan2(-82 - SIGN.x, -178 - SIGN.z);
    place(signMesh('🌾 FARM →', 'market · plots', 2, 0.7, '#3f6a2a'), { x: SIGN.x, z: SIGN.z, yaw: ang + Math.PI / 2 }, 2.3);
    // animals: one instanced mesh per kind
    this.inst = {};
    for (const [type, geo] of Object.entries(ANIMAL_GEO)) {
      const m = new THREE.InstancedMesh(geo(), MAT.solid, MAX_PER_TYPE);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.castShadow = true; m.frustumCulled = false;
      this.scene.add(m); this.inst[type] = m;
    }
  }

  // the farm's state from the server: put up new shelters, update the animals
  setState(st) {
    if (!this.on || !st) return;
    this.st = st;
    for (const bd of st.buildings) {
      if (this.built.has(bd.id)) continue;
      const P = PLOTS[bd.plot];
      if (!P) continue;
      const mesh = shelterModel(bd.type);
      mesh.position.set(P.x, this.H(P.x, P.z), P.z); mesh.rotation.y = P.yaw;
      this.scene.add(mesh);
      const cols = [-3, 0, 3].map(lx => { const w = toWorld(P, lx, -4); return this.world.addCollider({ x: w.x, z: w.z, r: 2.2 }); });
      this.built.set(bd.id, { bd, mesh, cols });
      this.byPlot.set(bd.plot, bd);
    }
    const plotOf = new Map(st.buildings.map(b => [b.id, b.plot]));
    this.list = st.animals.filter(a => this.inst[a.type] && plotOf.has(a.shelter)).map(a => ({ ...a, plot: plotOf.get(a.shelter), k: hash(a.id) }));
  }

  // animals walk around their pen (same for every player: shared clock + the animal's id)
  update(dt, serverMs) {
    if (!this.on) return;
    const t = serverMs / 1000, n = {};
    for (const type in this.inst) n[type] = 0;
    for (const a of this.list) {
      const m = this.inst[a.type];
      if (n[a.type] >= MAX_PER_TYPE) continue;
      const P = PLOTS[a.plot], k = a.k, sp = SPEED[a.type] || 1;
      const pos = tt => {
        const cx = (PEN.x0 + PEN.x1) / 2, cz = (PEN.z0 + PEN.z1) / 2, hx = (PEN.x1 - PEN.x0) / 2, hz = (PEN.z1 - PEN.z0) / 2;
        return [cx + hx * 0.9 * Math.sin(tt * 0.11 + k * 40) * Math.cos(tt * 0.043 + k * 17), cz + hz * 0.9 * Math.sin(tt * 0.083 + k * 23)];
      };
      // walk for a while, then stop and graze
      const pace = 0.5 + 0.5 * Math.sin(t * 0.05 + k * 31), tt = (t + k * 1000) * sp * (0.3 + pace);
      const [lx, lz] = pos(tt), [nx, nz] = pos(tt + 0.6);
      const w = toWorld(P, lx, lz), w2 = toWorld(P, nx, nz);
      const walking = pace > 0.35, bob = walking ? Math.abs(Math.sin(t * 9 * sp + k * 9)) * (a.type === 'chicken' ? 0.05 : 0.04) : 0;
      const yaw = Math.atan2(w2.x - w.x, w2.z - w.z) + (walking ? 0 : Math.sin(t * 0.7 + k * 5) * 0.3);
      const sick = a.health < 40 ? 0.06 : 0;
      this._e.set(walking ? 0 : 0.08 + sick, yaw, sick * 2);
      this._q.setFromEuler(this._e);
      this._p.set(w.x, this.H(w.x, w.z) + bob, w.z);
      m.setMatrixAt(n[a.type]++, this._m.compose(this._p, this._q, this._s));
    }
    for (const type in this.inst) { const m = this.inst[type]; m.count = n[type]; m.instanceMatrix.needsUpdate = true; }
  }

  // things to walk up to (E / tap)
  acts() {
    if (!this.on) return [];
    if (!this._acts) {
      const at = (o, d) => new THREE.Vector3(o.x + Math.sin(o.yaw) * d, 0, o.z + Math.cos(o.yaw) * d);
      const market = at(MARKET, 1.6), store = at(STORE, 1.4);
      market.y = this.H(market.x, market.z); store.y = this.H(store.x, store.z);
      this._acts = [
        { pos: market, r: 2.6, label: () => '🛒 Market — buy animals & feed, sell eggs and milk', act: () => this.hooks.onMarket() },
        { pos: store, r: 2.6, label: () => '🪵 Farm store — put your logs and stones in the farm', act: () => this.hooks.onStore() },
        ...PLOTS.map(P => {
          const w = toWorld(P, 0, 7.0), pos = new THREE.Vector3(w.x, this.H(w.x, w.z), w.z);
          return { pos, r: 2.4, label: () => this._plotLabel(P.i), act: () => { const bd = this.byPlot.get(P.i); if (bd) this.hooks.onShelter(bd); else this.hooks.onPlot(P.i); } };
        }),
      ];
    }
    return this._acts;
  }
  _plotLabel(i) {
    const bd = this.byPlot.get(i), cat = this.st && this.st.catalog;
    if (!bd || !cat) return `🌱 Plot ${i + 1} — build a shelter here`;
    const k = cat[bd.type], n = this.list.filter(a => a.plot === i).length;
    return `${k.icon} ${k.name} (${n}/${k.capacity}) — look after the animals`;
  }
}
