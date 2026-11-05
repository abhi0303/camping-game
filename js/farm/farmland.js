// The farm in the 3D world (Farm World only). South of the road: 8 plots (one signboard each), shelters with
// fenced pens, working gates and troughs, the farm storage (its look follows the storage level). North of
// the road: the Farm Store with the farmer, the Market, the delivery truck, the goat field and the windmill.
// Everything that changes comes from the server's farm state (buildings, gates, animals, storage level);
// animal movement is worked out from the shared (server) clock and each animal's id, so every player sees
// the same animals in the same places without sending positions over the network.
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';
import { PLOTS, PLOT_HW, PEN, PEN_BOX, GATE, SIGN_AT, STORAGE, STORE, MARKET, TRUCK, GOATS, WINDMILL, LAMPS, SIGN, STORE_SIGN, CLEAR, toWorld, toLocal } from './layout.js';
import { shelterModel, penGround, gateModel, signboard, wallSign, storageModel, storeModel, storeSteps, STORE_DIM, marketModel, truckModel, windmillModel,
  SHELTER_FOOT, PEN_FENCE, TROUGH_FEED, TROUGH_WATER, ANIMAL_GEO } from './models.js';
import { C, FARM_MAT, crate, barrel, eggStack, milkCan, hayBale, sack, lampPost, woodPile, stoneBin, fenceRun } from './props.js';
import { FarmerNPC } from './npc.js';
import { flambeau } from '../day-night.js';

const MAX_PER_TYPE = 64;
const SPEED = { chicken: 1.6, chicken_brown: 1.5, chicken_dark: 1.4, goat: 0.8, cow: 0.45, horse: 0.6,
  horse_bay: 0.6, horse_chestnut: 0.62, horse_black: 0.58, horse_white: 0.6, horse_palomino: 0.64, horse_pinto: 0.6 };
const GATE_OPEN = Math.PI * 0.52;
const NEST_AT = { x: 2.7, z: -0.9 };          // in the pen, by the coop's nest boxes (behind the back fence)
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 100000) / 100000; };
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export class Farmland {
  // hooks: { onStore, onMarket, onStorage, onPlot(i), onShelter(bd), onFeed(bd), onGate(bd, open), onCollect(bd), eggsIn(bd) }
  constructor(scene, world, hooks) {
    this.scene = scene; this.world = world; this.hooks = hooks;
    this.on = false; this.st = null; this.built = new Map(); this.byPlot = new Map(); this.list = []; this.decor = [];
    this.signs = new Map(); this.markers = new Map(); this.storage = null; this.t = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._e = new THREE.Euler();
  }
  H(x, z) { return this.world.heightAt(x, z); }
  // ground height in a local frame, relative to the frame's own ground
  hAt(F, base = this.H(F.x, F.z)) { return (lx, lz) => { const w = toWorld(F, lx, lz); return this.H(w.x, w.z) - base; }; }
  // a mesh placed in a frame
  place(obj, F, y = this.H(F.x, F.z)) { obj.position.set(F.x, y, F.z); obj.rotation.y = F.yaw || 0; this.scene.add(obj); return obj; }
  // circles along a segment in a frame (local coordinates)
  wall(F, x0, z0, x1, z1, r = 0.3, step = r * 1.6, list = []) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let i = 0; i <= n; i++) { const w = toWorld(F, x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n); list.push(this.world.addCollider({ x: w.x, z: w.z, r })); }
    return list;
  }
  dot(F, x, z, r, list = []) { const w = toWorld(F, x, z); list.push(this.world.addCollider({ x: w.x, z: w.z, r })); return list; }

  // first time Farm World is played on this page: clear the ground and set up the farm
  enable() {
    if (this.on) return;
    this.on = true;
    this.world.clearArea(CLEAR);
    // no grass blades in the pens, on the walkway, in the buildings and on the path from the road
    const near = (P, x, z, r) => Math.hypot(x - P.x, z - P.z) < r, path = CLEAR[1];
    this.world.addGrassBlock((x, z) => {
      if (x > -107 && x < -49 && z > -184 && z < -173) return true;                                       // the walkway
      if (x > path.x0 && x < path.x1 && z > path.z0 && z < path.z1) return true;
      if (Math.abs(x - STORAGE.x) < 7.5 && Math.abs(z - STORAGE.z) < 7.5) return true;
      if (near(MARKET, x, z, 9.5) || near(TRUCK, x, z, 4.5) || near(WINDMILL, x, z, 3)) return true;
      const ls = toLocal(STORE, x, z);
      if (Math.abs(ls.x) < STORE_DIM.w / 2 + 1.2 && ls.z > -STORE_DIM.d / 2 - 1.2 && ls.z < STORE_DIM.d / 2 + STORE_DIM.porch + 3) return true;
      for (const P of PLOTS) { const l = toLocal(P, x, z); if (Math.abs(l.x) < PLOT_HW + 0.5 && l.z > -7.2 && l.z < 7.6) return true; }
      return false;
    });
    for (const P of PLOTS) { this._marker(P); this._sign(P.i, null); }
    // the farm sign by the road
    const s1 = signboard('FARM', 'plots · storage', { w: 2.0, h: 0.8, lift: 0.9, bg: '#41622c' });
    this.place(s1, { ...SIGN, yaw: 0 });
    this._storeSide();
    this._lamps();
    // animals: one instanced mesh per kind (the store's goats use the goat mesh too)
    this.inst = {};
    for (const [type, geo] of Object.entries(ANIMAL_GEO)) {
      const m = new THREE.InstancedMesh(geo(), FARM_MAT.solid, MAX_PER_TYPE);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.castShadow = true; m.frustumCulled = false;
      this.scene.add(m); this.inst[type] = m;
    }
  }

  /* ---------- plots ---------- */
  // corner stakes with ribbons marking an empty plot
  _marker(P) {
    const b = new GeoBuilder(), base = this.H(P.x, P.z), h = this.hAt(P, base), cs = [[-PLOT_HW, -6.3], [PLOT_HW, -6.3], [PLOT_HW, 6.3], [-PLOT_HW, 6.3]];
    cs.forEach(([x, z], i) => {
      const g = h(x, z), [x2, z2] = cs[(i + 1) % 4], g2 = h(x2, z2), len = Math.hypot(x2 - x, z2 - z);
      b.box(0.09, 1.1, 0.09, x, g + 0.4, z, C.woodD); b.box(0.04, 0.16, 0.2, x, g + 0.88, z + 0.1, 0xd8342a);
      b.group((x + x2) / 2, (g + g2) / 2 + 0.6, (z + z2) / 2, 0, Math.atan2(x2 - x, z2 - z), 0, () => b.box(0.025, 0.025, len, 0, 0, 0, C.rope, 'solid', -Math.atan2(g2 - g, len), 0, 0));
    });
    for (let k = 0; k < 10; k++) { const x = -4 + (k % 5) * 2, z = -3 + Math.floor(k / 5) * 5; b.add(new THREE.DodecahedronGeometry(0.09, 0), C.stone, x, h(x, z) + 0.04, z, k, k, 0); }
    const m = this.place(b.build(FARM_MAT), P, base);
    this.markers.set(P.i, m);
  }
  // one signboard per plot, by its gate; it names what is built there
  _sign(i, type) {
    const P = PLOTS[i], key = type || '';
    const old = this.signs.get(i);
    if (old && old.key === key) return;
    if (old) { this.scene.remove(old.mesh); old.mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); } }); }
    const k = type && this.st && this.st.catalog[type];
    const w = toWorld(P, SIGN_AT.x, SIGN_AT.z), base = this.H(w.x, w.z), F = { x: w.x, z: w.z, yaw: P.yaw };
    const mesh = signboard(`PLOT ${i + 1}`, k ? k.name : 'empty · build here', { w: 1.5, h: 0.62, hAt: this.hAt(F, base) });
    mesh.userData.plotSign = i;
    this.place(mesh, F, base);
    this.signs.set(i, { key, mesh });
  }
  _addShelter(bd) {
    const P = PLOTS[bd.plot];
    if (!P) return;
    const base = this.H(P.x, P.z), h = this.hAt(P, base), group = new THREE.Group();
    group.add(shelterModel(bd.type, h), penGround(h));
    // the gate: a hinged leaf, opened by players (shared through the server)
    const gy = h(GATE.x, GATE.z), pivot = gateModel(0);
    pivot.position.set(GATE.x, gy, GATE.z);
    group.add(pivot);
    this.place(group, P, base);
    const F = SHELTER_FOOT[bd.type] || SHELTER_FOOT.coop, cols = [], r = (F.z1 - F.z0) / 2 + 0.15;
    this.wall(P, -F.hw + r * 0.6, (F.z0 + F.z1) / 2, F.hw - r * 0.6, (F.z0 + F.z1) / 2, r, r, cols);
    const X = PEN_FENCE.x, Z0 = PEN_FENCE.z0, Z1 = PEN_FENCE.z1, G = PEN_FENCE.gate;
    this.wall(P, -X, Z0, -X, Z1, 0.22, 0.45, cols); this.wall(P, X, Z0, X, Z1, 0.22, 0.45, cols);
    this.wall(P, -X, Z1, -G, Z1, 0.22, 0.45, cols); this.wall(P, G, Z1, X, Z1, 0.22, 0.45, cols);
    if (F.hw + 0.15 < X - 0.3) { this.wall(P, -X, Z0, -F.hw - 0.15, Z0, 0.22, 0.45, cols); this.wall(P, F.hw + 0.15, Z0, X, Z0, 0.22, 0.45, cols); }
    for (const T of [TROUGH_FEED, TROUGH_WATER]) { this.dot(P, T.x - 0.5, T.z, 0.42, cols); this.dot(P, T.x + 0.5, T.z, 0.42, cols); }
    const open = !!bd.gateOpen;
    const gate = { pivot, open, cur: open ? GATE_OPEN : 0, cols: null, pending: 0 };
    this.built.set(bd.id, { bd, group, cols, gate, P });
    this.byPlot.set(bd.plot, bd);
    const mk = this.markers.get(bd.plot); if (mk) mk.visible = false;
  }
  _removeShelter(id) {
    const s = this.built.get(id);
    if (!s) return;
    this.scene.remove(s.group);
    s.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    for (const c of s.cols) this.world.removeCollider(c);
    if (s.gate.cols) for (const c of s.gate.cols) this.world.removeCollider(c);
    this.built.delete(id); this.byPlot.delete(s.bd.plot);
    const mk = this.markers.get(s.bd.plot); if (mk) mk.visible = true;
    this._sign(s.bd.plot, null);
  }
  // open / close a gate here at once (the server's answer and the other players follow)
  setGate(id, open, mine = false) {
    const s = this.built.get(id);
    if (!s) return;
    if (open === null) { s.gate.pending = 0; s.gate.open = !!s.bd.gateOpen; return; }
    s.gate.open = !!open;
    if (mine) s.gate.pending = performance.now();
  }
  gateOf(id) { const s = this.built.get(id); return s ? s.gate.open : false; }

  /* ---------- storage ---------- */
  _storage(level) {
    if (this.storage && this.storage.level === level) return;
    if (this.storage) {
      this.scene.remove(this.storage.mesh); this.storage.mesh.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      for (const c of this.storage.cols) this.world.removeCollider(c);
    }
    const S = STORAGE, base = this.H(S.x, S.z), h = this.hAt(S, base), mesh = this.place(storageModel(level, h), S, base), cols = [];
    let front;
    if (level < 2) {
      for (const x of [-1.6, 0, 1.6]) this.dot(S, x, -0.1, 1.1, cols);
      this.dot(S, 3.3, 0.2, 0.9, cols); this.dot(S, -3.3, 0.6, 0.6, cols);
      front = 2.9;
    } else {
      for (const x of [-3.3, -1.1, 1.1, 3.3]) for (const z of [-1.9, 0.3, 2.6]) this.dot(S, x, z, 1.25, cols);
      for (const x of [-3.6, 3.6]) this.dot(S, x, 4.3, 0.5, cols);
      for (const z of [-1.4, 0.4, 2.2]) this.dot(S, 6.0, z, 0.95, cols);
      const g = h(0, 6.2), y0 = (() => { let hi = -1e9; for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) hi = Math.max(hi, h(-4.4 + 8.8 * i / 4, -2.9 + 7.5 * j / 4)); return hi + 0.18; })();
      const n = Math.max(1, Math.ceil((y0 - g) / 0.3));
      this.wall(S, -1.5, 5.0, -1.5, 4.9 + n * 0.4, 0.25, 0.5, cols); this.wall(S, 1.5, 5.0, 1.5, 4.9 + n * 0.4, 0.25, 0.5, cols);
      this.dot(S, 0, 5.0 + n * 0.2, 0.9, cols);
      front = 5.2 + n * 0.4 + 0.5;
    }
    const w = toWorld(S, 0, front);
    this.storage = { level, mesh, cols, front: v3(w.x, this.H(w.x, w.z), w.z) };
  }

  /* ---------- across the road: store, market, truck, goats ---------- */
  _storeSide() {
    const S = STORE, sb = this.H(S.x, S.z), sh = this.hAt(S, sb), W = STORE_DIM.w, D = STORE_DIM.d, P = STORE_DIM.porch;
    let hi = -1e9;
    for (let x = -W / 2 - 0.3; x <= W / 2 + 0.3; x += 0.7) for (let z = -D / 2 - 0.3; z <= D / 2 + P + 0.3; z += 0.7) hi = Math.max(hi, sh(x, z));
    const F = hi + 0.22, FT = F + 0.08, steps = storeSteps(F, sh);
    const { body, cut } = storeModel(F, sh);
    this.place(body, S, sb); this.place(cut, S, sb);
    this.store = { F: sb + FT, cut, steps };
    // walking: the floor, and a ramp over the steps
    const top = sb + FT, z0 = steps.z0, z1 = steps.z1;
    this.world.surfaces.push({ surfaceAt: (x, z) => {
      const l = toLocal(S, x, z);
      if (Math.abs(l.x) <= W / 2 + 0.3 && l.z >= -D / 2 - 0.3 && l.z <= z0) return top;
      if (Math.abs(l.x) <= STORE_DIM.stairs && l.z > z0 && l.z <= z1 + 0.2) { const k = (l.z - z0) / (z1 + 0.2 - z0); return top + (sb + sh(l.x, z1 + 0.2) - top) * k; }
      return null;
    } });
    const cols = [], DW = STORE_DIM.door, SW = STORE_DIM.stairs;
    this.wall(S, -W / 2 + 0.3, -D / 2 + 0.55, W / 2 - 0.3, -D / 2 + 0.55, 0.6, 0.8, cols);                  // back wall + shelves
    for (const s of [-1, 1]) this.wall(S, s * (W / 2 - 0.05), -D / 2, s * (W / 2 - 0.05), D / 2 + P, 0.32, 0.5, cols);   // sides + porch rails
    this.wall(S, -W / 2 + 0.55, -3.3, -W / 2 + 0.55, 1.4, 0.55, 0.7, cols);                                // side shelves
    for (const s of [-1, 1]) this.wall(S, s * (DW + 0.2), D / 2, s * (W / 2), D / 2, 0.3, 0.5, cols);     // front wall
    for (const s of [-1, 1]) this.wall(S, s * (SW + 0.15), D / 2 + P, s * (W / 2), D / 2 + P, 0.28, 0.5, cols);   // porch rail
    this.wall(S, -4.8, 2.2, -2.0, 2.2, 0.5, 0.6, cols);                                                     // counter
    this.dot(S, W / 2 - 1.2, -2.6, 0.95, cols); this.dot(S, W / 2 - 1.3, 0.2, 0.75, cols);
    for (const [x, z] of [[4.6, 2.4], [5.2, 3.0], [2.8, 3.4]]) this.dot(S, x, z, 0.38, cols);
    for (const x of [-5.6, -2.3, 2.3, 5.6]) this.dot(S, x, D / 2 + P - 0.25, 0.22, cols);
    for (const x of [-4.8, -4.0, -3.2]) this.dot(S, x, D / 2 + 1.3, 0.45, cols);
    this.dot(S, 4.3, D / 2 + 1.5, 0.85, cols); this.dot(S, 5.6, D / 2 + 2.3, 0.55, cols);
    // stairs side walls (the plinth around them)
    for (const s of [-1, 1]) this.wall(S, s * (SW + 0.2), z0, s * (SW + 0.2), z1, 0.2, 0.4, cols);
    // the farmer behind the counter
    const nw = toWorld(S, -3.4, 1.35);
    this.npc = new FarmerNPC(this.scene, { x: nw.x, y: top, z: nw.z, yaw: S.yaw });
    const cw = toWorld(S, -3.4, 3.4);
    this.storeSpot = v3(cw.x, top, cw.z);
    this._storeProps(S, sb, sh);

    // the Market: an open hall with counters
    const M = MARKET, mb = this.H(M.x, M.z), mh = this.hAt(M, mb);
    let mhi = -1e9; for (let x = -4.7; x <= 4.7; x += 0.6) for (let z = -2.7; z <= 2.7; z += 0.6) mhi = Math.max(mhi, mh(x, z));
    const my = mhi + 0.12 + 0.06;
    this.place(marketModel(mh), M, mb);
    const sign = wallSign('MARKET', 'sell eggs · milk · goods', 3.4, 0.9, '', '#5a3a1c');
    sign.position.set(0, mhi + 0.12 + 3.95, 2.35);
    this.place(new THREE.Group().add(sign), M, mb);
    const mstep = new GeoBuilder();                                                              // a step up into the hall
    const mg = mh(0, 3.3), stepTop = (my + mg) / 2; mstep.box(8.6, stepTop - mg + 0.3, 0.7, 0, (stepTop + mg - 0.3) / 2, 2.95, C.stone);
    this.place(mstep.build(FARM_MAT), M, mb);
    this.world.surfaces.push({ surfaceAt: (x, z) => {
      const l = toLocal(M, x, z);
      if (Math.abs(l.x) <= 4.7 && Math.abs(l.z) <= 2.7) return mb + my;
      if (Math.abs(l.x) <= 4.3 && l.z > 2.7 && l.z <= 3.3) return mb + (my + mh(l.x, 3.4)) / 2;
      return null;
    } });
    this.wall(M, -3.9, 1.6, 3.9, 1.6, 0.42, 0.6, cols);
    for (const x of [-4.3, -1.5, 1.5, 4.3]) for (const z of [-2.3, 2.3]) this.dot(M, x, z, 0.2, cols);
    this.wall(M, -3.6, -1.6, 3.4, -1.6, 0.45, 0.7, cols);
    for (const s of [-1, 1]) this.wall(M, s * 4.55, -2.5, s * 4.55, 2.5, 0.25, 0.5, cols);           // closed at the sides and back
    this.wall(M, -4.5, -2.6, 4.5, -2.6, 0.25, 0.5, cols);
    const mw = toWorld(M, 0, 2.6);
    this.marketSpot = v3(mw.x, mb + my, mw.z);
    // the orders board by the Market's entrance (customer orders are delivered here)
    const ow = toWorld(M, -5.9, 3.6), OF = { x: ow.x, z: ow.z, yaw: M.yaw };
    this.place(signboard('ORDERS', 'deliveries · daily streak', { w: 1.7, h: 0.7, lift: 0.85, bg: '#5a3a1c', hAt: this.hAt(OF) }), OF);
    this.dot(M, -5.9, 3.6, 0.5, cols);

    // the delivery truck with chicken crates, a loading area beside the store
    const T = TRUCK, tb = this.H(T.x, T.z), th = this.hAt(T, tb), ha = th(0, -1.75), hf = th(0, 1.9);
    const truck = this.place(truckModel(), T, tb + (ha + hf) / 2 - 0.04);
    truck.rotation.order = 'YXZ'; truck.rotation.x = -Math.atan2(hf - ha, 3.65);
    this.wall(T, 0, -3.1, 0, 3.1, 1.15, 1.0, cols);
    // the goat field with its own goats, a windmill beside it
    const G = { x: GOATS.c.x, z: GOATS.c.z, yaw: STORE.yaw }, gb = this.H(G.x, G.z), gh = this.hAt(G, gb), hu = GOATS.hu, hv = GOATS.hv;
    const fb = new GeoBuilder();
    fenceRun(fb, -hu, -hv, hu, -hv, gh); fenceRun(fb, -hu, hv, hu, hv, gh); fenceRun(fb, hu, -hv, hu, hv, gh);
    fenceRun(fb, -hu, -hv, -hu, -1.2, gh); fenceRun(fb, -hu, 1.2, -hu, hv, gh);
    hayBale(fb, 3.6, gh(3.6, -4.8), -4.8, 0.3); hayBale(fb, 3.4, gh(3.4, -4.2) + 0.5, -4.4, -0.2);
    fb.group(-2.5, gh(-2.5, 4.5), 4.5, 0, 0, 0, () => { fb.box(1.8, 0.4, 0.6, 0, 0.3, 0, C.wood); fb.box(1.6, 0.06, 0.45, 0, 0.47, 0, 0x4f86b8, 'glass'); });
    this.place(fb.build(FARM_MAT), G, gb);
    const fg = gateModel(0), fgw = toWorld(G, -hu, -1.2), fgg = new THREE.Group();                // a closed field gate (toward the truck)
    fg.rotation.y = -Math.PI / 2; fgg.add(fg);
    this.place(fgg, { x: fgw.x, z: fgw.z, yaw: G.yaw }, this.H(fgw.x, fgw.z));
    this.wall(G, -hu, -hv, hu, -hv, 0.25, 0.6, cols); this.wall(G, -hu, hv, hu, hv, 0.25, 0.6, cols);
    this.wall(G, -hu, -hv, -hu, hv, 0.25, 0.6, cols); this.wall(G, hu, -hv, hu, hv, 0.25, 0.6, cols);
    this.goatField = { F: G, pen: { x0: -hu + 0.8, x1: hu - 0.8, z0: -hv + 0.8, z1: hv - 0.8 } };
    this.decor = ['gA', 'gB', 'gC', 'gD'].map(id => ({ id, type: 'goat', k: hash(id), field: true }));
    const wm = windmillModel(); this.wheel = wm.wheel;
    this.place(wm.group, WINDMILL); this.dot(WINDMILL, 0, 0, 1.2, cols);
    // lamps and the roadside sign
    const lb = new GeoBuilder();
    for (const L of LAMPS) lb.group(L.x, this.H(L.x, L.z), L.z, 0, L.yaw + Math.PI / 2, 0, () => lampPost(lb, 0, 0, 0));
    this.scene.add(lb.build(FARM_MAT));
    for (const L of LAMPS) this.world.addCollider({ x: L.x, z: L.z, r: 0.2 });
    this.place(signboard('FARM STORE', 'and MARKET', { w: 2.0, h: 0.8, lift: 0.9, bg: '#7a2a20', hAt: this.hAt(STORE_SIGN) }), STORE_SIGN);
    this.storeCols = cols;
  }
  // street lamps along the walkway and torches (flambeaux) at the farm's entrances — lit from dusk to dawn
  _lamps() {
    const b = new GeoBuilder();
    const post = (x, z, ry) => { lampPost(b, x, this.H(x, z), z, ry); this.world.addCollider({ x, z, r: 0.2 }); };
    const torch = (x, z) => { flambeau(b, x, this.H(x, z), z); this.world.addCollider({ x, z, r: 0.2 }); };
    const at = (F, lx, lz) => { const w = toWorld(F, lx, lz); torch(w.x, w.z); };
    for (const x of [-92, -80, -68]) { post(x, -182.4, -Math.PI / 2); post(x, -174.6, Math.PI / 2); }   // between the plots, over the walkway
    torch(-105.5, -182.6); torch(-105.5, -174.4);                                                       // the walkway's west end
    torch(SIGN.x - 2.3, SIGN.z); torch(SIGN.x + 2.3, SIGN.z);                                           // the FARM sign by the road
    at(STORE_SIGN, -2.2, 0); at(STORE_SIGN, 2.2, 0);                                                    // the FARM STORE sign across the road
    at(MARKET, 5.4, 3.7); at(MARKET, -4.4, 4.9);                                                        // the Market's front
    this.scene.add(b.build(FARM_MAT));
  }
  // crates, egg crates, milk cans, wood and stone around the store
  _storeProps(S, sb, h) {
    const b = new GeoBuilder(), W = STORE_DIM.w;
    const at = (x, z) => h(x, z);
    // the road side of the store (east): wood and stone storage
    woodPile(b, -W / 2 - 1.8, at(-W / 2 - 1.8, 0.5), 0.5, 3, 1.8);
    woodPile(b, -W / 2 - 1.8, at(-W / 2 - 1.8, -2.2) , -2.2, 2, 1.8);
    stoneBin(b, -W / 2 - 1.9, at(-W / 2 - 1.9, 3.4), 3.4, Math.PI / 2);
    for (const [x, z, s] of [[-W / 2 - 1.6, 6.4, 0.6], [-W / 2 - 2.3, 6.9, 0.55], [-W / 2 - 1.9, 7.6, 0.5]]) crate(b, x, at(x, z), z, s, C.woodL, x);
    // the truck side (west): the loading area with pallets of egg crates and milk
    const pallet = (x, z) => { const g = at(x, z); for (let i = 0; i < 4; i++) b.box(1.2, 0.08, 0.2, x, g + 0.05, z - 0.45 + i * 0.3, C.woodXL); b.box(1.2, 0.08, 1.0, x, g + 0.13, z, C.woodL); return g + 0.17; };
    let y = pallet(W / 2 + 2.0, 5.5); eggStack(b, W / 2 + 1.75, y, 5.3, 3, 0, [C.egg, C.eggB, C.egg]); eggStack(b, W / 2 + 2.3, y, 5.75, 2, 0.1, [C.eggB, C.eggD]);
    y = pallet(W / 2 + 2.0, 7.4); for (const [dx, dz] of [[-0.35, -0.25], [0.05, -0.25], [0.45, -0.25], [-0.35, 0.25], [0.05, 0.25], [0.45, 0.25]]) milkCan(b, W / 2 + 2.0 + dx, y, 7.4 + dz);
    y = pallet(W / 2 + 2.0, 2.4); crate(b, W / 2 + 1.75, y, 2.2, 0.55); crate(b, W / 2 + 2.3, y, 2.6, 0.5, C.woodXL, 0.3); crate(b, W / 2 + 2.0, y + 0.55, 2.35, 0.45, C.woodL, -0.2);
    barrel(b, W / 2 + 1.2, at(W / 2 + 1.2, -0.6), -0.6); barrel(b, W / 2 + 1.9, at(W / 2 + 1.9, -1.2), -1.2, C.woodD);
    sack(b, W / 2 + 1.3, at(W / 2 + 1.3, 0.6), 0.6, 0.4); sack(b, W / 2 + 1.7, at(W / 2 + 1.7, 0.9), 0.9, -0.3, C.hay);
    hayBale(b, W / 2 + 1.6, at(W / 2 + 1.6, -3.4), -3.4, Math.PI / 2);
    this.place(b.build(FARM_MAT), S, sb);
    const cols = [];
    for (const [x, z, r] of [[-W / 2 - 1.8, 0.5, 1.0], [-W / 2 - 1.8, -2.2, 0.8], [-W / 2 - 1.9, 3.4, 0.7], [-W / 2 - 1.9, 7.0, 0.8], [W / 2 + 2.0, 5.5, 0.75], [W / 2 + 2.0, 7.4, 0.75], [W / 2 + 2.0, 2.4, 0.75], [W / 2 + 1.5, -0.9, 0.7], [W / 2 + 1.5, 0.75, 0.5], [W / 2 + 1.6, -3.4, 0.65]]) this.dot(S, x, z, r, cols);
  }

  /* ---------- the server's state ---------- */
  setState(st) {
    if (!this.on || !st) return;
    this.st = st;
    const now = performance.now(), ids = new Set(st.buildings.map(b => b.id));
    for (const id of [...this.built.keys()]) if (!ids.has(id)) this._removeShelter(id);
    for (const bd of st.buildings) {
      if (!this.built.has(bd.id)) this._addShelter(bd);
      const s = this.built.get(bd.id);
      if (!s) continue;
      s.bd = bd; this.byPlot.set(bd.plot, bd);
      // the server's gate, unless this player just moved it and the answer isn't back yet
      if (!s.gate.pending || now - s.gate.pending > 8000) { s.gate.open = !!bd.gateOpen; s.gate.pending = 0; }
      this._sign(bd.plot, bd.type);
    }
    this._storage(st.storageLevel || 1);
    const plotOf = new Map(st.buildings.map(b => [b.id, b.plot]));
    this.list = st.animals.filter(a => this.inst[a.type] && plotOf.has(a.shelter)).map(a => ({ ...a, plot: plotOf.get(a.shelter), k: hash(a.id) }));
  }
  // the server answered this player's gate request
  gateDone(id) { const s = this.built.get(id); if (s) s.gate.pending = 0; }

  // where an animal is at a moment of the shared (server) clock: it walks around its pen for a while,
  // then stops and grazes. Only the clock and the animal's id decide it, so every screen agrees.
  posOf(a, serverMs) {
    const t = serverMs / 1000, k = a.k, sp = SPEED[a.type] || 1;
    const F = a.field ? this.goatField.F : PLOTS[a.plot], R = a.field ? this.goatField.pen : PEN;
    const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2, hx = (R.x1 - R.x0) / 2, hz = (R.z1 - R.z0) / 2;
    const at = tt => toWorld(F, cx + hx * 0.92 * Math.sin(tt * 0.11 + k * 40) * Math.cos(tt * 0.043 + k * 17), cz + hz * 0.92 * Math.sin(tt * 0.083 + k * 23));
    // walking speed swings between slow grazing and trotting; tt is its integral over time, so the animal
    // moves smoothly (multiplying the clock by a changing speed would make it jump)
    const T = t + k * 1000, ph = 0.05 * T + k * 31, pace = 0.5 + 0.5 * Math.sin(ph);
    const tt = sp * (0.8 * T - 10 * Math.cos(ph));
    const w = at(tt), w2 = at(tt + 0.6), walking = pace > 0.35;
    return { x: w.x, z: w.z, walking, yaw: Math.atan2(w2.x - w.x, w2.z - w.z) + (walking ? 0 : Math.sin(t * 0.7 + k * 5) * 0.3) };
  }
  update(dt, serverMs, me) {
    if (!this.on) return;
    this.t += dt;
    const t = serverMs / 1000, n = {};
    for (const type in this.inst) n[type] = 0;
    for (const a of this.list.concat(this.decor)) {
      const m = this.inst[a.type];
      if (n[a.type] >= MAX_PER_TYPE) continue;
      if (a.rentedUntil && Date.parse(a.rentedUntil) > serverMs) continue;      // a horse out on rent isn't home
      // a baby horse is small and grows with its level (Level 1 ~55 %, Level 10 full size)
      const size = a.level && a.type.startsWith('horse') ? 0.55 + 0.45 * (Math.min(10, a.level) - 1) / 9 : 1;
      this._s.setScalar(size);
      const p = this.posOf(a, serverMs), sp = SPEED[a.type] || 1, chick = a.type.startsWith('chicken');
      const bob = p.walking ? Math.abs(Math.sin(t * 9 * sp + a.k * 9)) * (chick ? 0.05 : 0.04) : 0;
      const sick = a.health !== undefined && a.health < 40 ? 0.06 : 0;
      // standing chickens peck at the ground now and then
      const peck = chick && !p.walking ? Math.max(0, Math.sin(t * 3 + a.k * 20)) * 0.35 : 0;
      this._e.set(p.walking ? 0 : 0.08 + sick + peck, p.yaw, sick * 2);
      this._q.setFromEuler(this._e);
      this._p.set(p.x, this.H(p.x, p.z) + 0.035 + bob, p.z);
      m.setMatrixAt(n[a.type]++, this._m.compose(this._p, this._q, this._s));
    }
    for (const type in this.inst) { const m = this.inst[type]; m.count = n[type]; m.instanceMatrix.needsUpdate = true; }
    // gates swing; a closed gate blocks the way
    for (const s of this.built.values()) {
      const g = s.gate, want = g.open ? GATE_OPEN : 0;
      g.cur += Math.sign(want - g.cur) * Math.min(Math.abs(want - g.cur), dt * 2.6);
      g.pivot.rotation.y = g.cur;
      if (g.open && g.cols) { for (const c of g.cols) this.world.removeCollider(c); g.cols = null; }
      if (!g.open && !g.cols && g.cur < 0.25) g.cols = this.wall(s.P, GATE.x + 0.25, GATE.z, GATE.x + GATE.w - 0.25, GATE.z, 0.24, 0.45);
    }
    if (this.wheel) this.wheel.rotation.z -= dt * 1.4;
    if (this.npc) this.npc.update(dt, me);
    // inside the store: hide its front wall and roof so the camera sees in
    if (this.store && me) {
      const l = toLocal(STORE, me.x, me.z);
      this.store.cut.visible = !(Math.abs(l.x) < STORE_DIM.w / 2 && l.z > -STORE_DIM.d / 2 && l.z < STORE_DIM.d / 2 + 0.1 && me.y > this.store.F - 0.8);
    }
  }
  // keep the camera inside the store while the player is in it (the back and side walls stay)
  camClip(target, dir, d) {
    if (!this.store || this.store.cut.visible) return d;
    const W = STORE_DIM.w / 2 - 0.25, D = STORE_DIM.d / 2 - 0.25, top = this.store.F + STORE_DIM.wall - 0.3;
    for (let i = 1; i <= 12; i++) {
      const s = d * i / 12, x = target.x + dir.x * s, y = target.y + dir.y * s, z = target.z + dir.z * s, l = toLocal(STORE, x, z);
      if (Math.abs(l.x) > W || l.z < -D || y > top) return Math.max(0.5, d * (i - 1) / 12);
    }
    return d;
  }
  // the plot (and its shelter) the player is standing at, or null
  plotAt(p) {
    if (!this.on || !p) return null;
    for (const P of PLOTS) {
      const l = toLocal(P, p.x, p.z);
      if (Math.abs(l.x) < PLOT_HW + 0.6 && l.z > -7 && l.z < 9.2) return { i: P.i, bd: this.byPlot.get(P.i) || null, inPen: l.x > PEN_BOX.x0 && l.x < PEN_BOX.x1 && l.z > PEN_BOX.z0 && l.z < PEN_BOX.z1 };
    }
    return null;
  }

  // things to walk up to (E / tap)
  acts() {
    if (!this.on) return [];
    if (!this._acts) {
      const plotActs = [];
      for (const P of PLOTS) {
        const sw = toWorld(P, SIGN_AT.x, SIGN_AT.z + 0.6), gw = toWorld(P, 0, GATE.z), tw = toWorld(P, TROUGH_FEED.x, TROUGH_FEED.z - 1.1), nw = toWorld(P, NEST_AT.x, NEST_AT.z);
        const bd = () => this.byPlot.get(P.i);
        plotActs.push(
          { pos: v3(sw.x, this.H(sw.x, sw.z), sw.z), r: 1.9, plot: P.i, label: () => this._plotLabel(P.i), act: () => { const b = bd(); if (b) this.hooks.onShelter(b); else this.hooks.onPlot(P.i); } },
          { pos: v3(gw.x, this.H(gw.x, gw.z), gw.z), r: 1.9, plot: P.i, needs: true,
            label: () => (this.gateOf(bd().id) ? '🚪 Close the gate' : '🚪 Open the gate'), act: () => { const b = bd(); this.hooks.onGate(b, !this.gateOf(b.id)); } },
          { pos: v3(tw.x, this.H(tw.x, tw.z), tw.z), r: 1.3, plot: P.i, needs: true,
            label: () => { const k = this.st.catalog[bd().type], a = this.st.catalog[k.animal]; return `🌾 Feed the ${a ? a.name.toLowerCase() + 's' : 'animals'} (trough)`; },
            act: () => this.hooks.onFeed(bd()) },
          // a coop's nest boxes (by the back fence of the pen): collect the eggs
          { pos: v3(nw.x, this.H(nw.x, nw.z), nw.z), r: 1.5, plot: P.i, needs: true, nests: true,
            label: () => { const n = this.hooks.eggsIn(bd()); return n ? `🥚 Collect eggs from the nest boxes (${n} ready)` : '🪺 Nest boxes — no eggs ready yet'; },
            act: () => this.hooks.onCollect(bd()) },
        );
      }
      this._plotActs = plotActs;
      this._acts = true;
    }
    const l = [];
    if (this.storeSpot) l.push({ pos: this.storeSpot, r: 2.4, label: () => '🧑‍🌾 Talk to the farmer — Farm Store', act: () => this.hooks.onStore() });
    if (this.marketSpot) l.push({ pos: this.marketSpot, r: 2.8, label: () => '🛒 Market — orders, sell eggs, milk and goods', act: () => this.hooks.onMarket() });
    if (this.storage) l.push({ pos: this.storage.front, r: 2.8, label: () => `📦 Farm storage (level ${this.storage.level}) — store logs & stones, upgrade`, act: () => this.hooks.onStorage() });
    for (const a of this._plotActs) if (!a.needs || this.byPlot.has(a.plot)) if (!a.nests || this._nests(this.byPlot.get(a.plot))) l.push(a);
    return l;
  }
  // chickens keep their eggs in nest boxes (servers before the nest update put eggs straight into storage)
  _nests(bd) { const c = this.st && this.st.catalog, k = c && c[bd.type], a = k && c[k.animal]; return !!(a && a.nest); }
  _plotLabel(i) {
    const bd = this.byPlot.get(i), cat = this.st && this.st.catalog;
    if (!bd || !cat) return `🌱 Plot ${i + 1} — build a shelter here`;
    const k = cat[bd.type], n = this.list.filter(a => a.plot === i).length;
    return `${k.icon} Plot ${i + 1} · ${k.name} (${n}/${k.capacity}) — animals & production`;
  }
}
