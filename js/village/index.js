// Sonpur village (Farm World): puts the village into the world the first time Farm World opens on this page.
// It clears the jungle in the village area, places the village hall on the square and the houses along the
// lanes (js/village/layout.js), builds every house (houses.js), its garden (gardens.js), some animal pens
// (animals.js), the props, street lamps and trees, paints the lanes and the paved square on the ground
// (js/terrain.js), adds collisions, keeps the wild flowers off lanes and gardens, and draws the village on the
// map. Static parts are merged into a few chunk meshes (one per area and material); the many plants and the
// trees are instanced. Windows light up at night and lamps glow (js/day-night.js, the shared IST clock).
// The villagers (js/village/ai.js) live in it: they get the doors, gardens, pens, props and benches from here.
import * as THREE from 'three';
import { GeoBuilder, MAT } from '../utils.js';
import { C, lampPost, bench, barrel, woodPile } from '../farm/props.js';
import { signboard } from '../farm/models.js';
import { broadleafA, broadleafB, roundTree } from '../flora.js';
import { HOUSES, HALL, buildHouse } from './houses.js';
import { buildGarden, PLANTS, SHADOW_PLANTS } from './gardens.js';
import { buildPen, PEN_SIZE, ANIMALS } from './animals.js';
import { well, cart, haystack, clothesline, hearth, shed, stall, tableSet, pots } from './props.js';
import { Villagers } from './ai.js';
import { VILLAGE_NAME, SQUARE, LANES, VILLAGE_CLEAR, BOUNDS, laneDist, laneSegments, placeHouses, inside, plot } from './layout.js';

const CHUNK = 32;
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 100000) / 100000; };
function prng(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return (a = 0, b = 1) => { s = (s * 16807) % 2147483647; return a + (s - 1) / 2147483646 * (b - a); }; }
const geoOf = fn => { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; };

export class Village {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.on = false;
    this.houses = []; this.pens = []; this.objects = []; this.spots = { doors: [], benches: [], square: SQUARE };
  }
  // everything the village puts in the scene goes through here (so it can be found, hidden or measured)
  _add(o) { this.scene.add(o); this.objects.push(o); }
  // world point (x, z) at local (lx, lz) of frame F = { x, z, yaw }
  static at(F, lx, lz) { const c = Math.cos(F.yaw), s = Math.sin(F.yaw); return { x: F.x + lx * c + lz * s, z: F.z - lx * s + lz * c }; }

  enable({ farmland, minimap } = {}) {
    if (this.on) return;
    this.on = true;
    const W = this.world, T = W.T, R = prng(2024);
    W.clearArea(VILLAGE_CLEAR);
    // everything solid the village adds is marked as the village's (the villagers' paths keep clear of it)
    const addCollider = W.addCollider;
    W.addCollider = c => { c.village = true; return addCollider.call(W, c); };
    this.chunks = new Map(); this.plants = {}; this.trees = {};
    const chunk = (x, z) => { const k = Math.floor((x - BOUNDS.x0) / CHUNK) + ',' + Math.floor((z - BOUNDS.z0) / CHUNK); if (!this.chunks.has(k)) this.chunks.set(k, new GeoBuilder()); return this.chunks.get(k); };
    const gIn = F => (lx, lz) => { const p = Village.at(F, lx, lz); return T.heightAt(p.x, p.z) - F.y; };
    const plantIn = F => (kind, lx, lz, yaw = 0, s = 1) => {
      const p = Village.at(F, lx, lz);
      // phones grow fewer garden flowers: picked by position, so the village's own random numbers (and with them
      // where the trees and props go, and the villagers' paths) are the same on every device
      if (W.lite && (kind === 'daisy' || kind === 'yellow')) { const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453; if (h - Math.floor(h) < 0.45) return; }
      (this.plants[kind] || (this.plants[kind] = [])).push([p.x, T.heightAt(p.x, p.z) - 0.03, p.z, F.yaw + yaw, s]);
    };
    // the village hall on the north side of the square, facing it
    const hall = { x: SQUARE.x - 2, z: SQUARE.z + SQUARE.r + HALL.garden + HALL.d / 2 + 0.6, yaw: Math.PI, spec: HALL };
    const hc = [[-HALL.w / 2, -HALL.d / 2], [HALL.w / 2, -HALL.d / 2], [HALL.w / 2, HALL.d / 2], [-HALL.w / 2, HALL.d / 2]].map(([a, c]) => { const p = Village.at(hall, a, c); return T.heightAt(p.x, p.z); });
    hall.base = Math.max(...hc) + 0.15; hall.r = 7.5;
    // the square's own things (kept free of houses)
    const avoid = [plot(hall, HALL)];
    // houses along the lanes
    const specs = HOUSES.map(s => ({ ...s }));
    const placed = placeHouses(T, specs, { avoid, log: (...a) => console.warn('[village]', ...a) });
    this.houses = [hall, ...placed];
    // build every house and its garden
    this.houses.forEach((H, i) => {
      H.y = H.base;
      const b = chunk(H.x, H.z), F = { x: H.x, z: H.z, yaw: H.yaw, y: H.base };
      b.group(H.x, H.base, H.z, 0, H.yaw, 0, () => {
        buildHouse(b, H, gIn(F), i + 1);
        H.garden = buildGarden(b, H, gIn(F), i + 3, plantIn(F));
      });
      this._houseColliders(H);
      const door = Village.at(F, 0, (H.spec.shape === 'round' ? H.spec.r : H.spec.d / 2) + (H.spec.porch ? H.spec.porch.d : 0) + 0.9);
      this.spots.doors.push({ x: door.x, z: door.z, yaw: H.yaw, house: H.spec.name });
    });
    // animal pens beside the houses that keep animals
    for (const H of placed) if (H.spec.pen) this._pen(H, chunk, gIn, farmland);
    // the square: the well, benches, the fruit stall, lamps, a big tree
    this._square(chunk);
    // things beside the houses: wood piles, carts, haystacks, clotheslines, hearths, sheds, tables, pots
    placed.forEach((H, i) => this._yard(H, i, chunk, R));
    // street lamps along the lanes, the village sign, trees round the village
    this._lamps(chunk);
    this._sign();
    this._trees(R);
    // the villagers: their paths and places, the football green, cots outside some houses
    W.addCollider = addCollider;
    this.people = new Villagers(this);
    this.people.prepare((x, z) => chunk(x, z));
    // build the meshes
    const mats = { ...MAT, win0: W.dayNight.windowMats[0], win1: W.dayNight.windowMats[1], win2: W.dayNight.windowMats[2] };
    for (const b of this.chunks.values()) { const g = b.build(mats); g.traverse(o => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } }); this._add(g); }
    this._instanced();
    this.people.start(o => this._add(o));
    // the lanes and the square on the ground, the grass and flowers kept off them, the map
    const segs = laneSegments();
    T.setVillageGround && T.setVillageGround(segs, SQUARE, BOUNDS);
    W.addGrassBlock((x, z) => this.blocked(x, z));
    if (minimap && minimap.addVillage) minimap.addVillage({ segs, square: SQUARE, houses: this.houses.map(H => ({ x: H.x, z: H.z, yaw: H.yaw, w: H.spec.shape === 'round' ? H.spec.r * 2 : H.spec.w, d: H.spec.shape === 'round' ? H.spec.r * 2 : H.spec.d, round: H.spec.shape === 'round', col: H.spec.roofCol })) });
  }
  // is (x, z) on a lane, the square, a house with its garden, or a pen? (no wild flowers there)
  blocked(x, z) {
    if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return false;
    if (Math.hypot(x - SQUARE.x, z - SQUARE.z) < SQUARE.r + 0.5) return true;
    if (this.people && this.people._inField(x, z, 0.4)) return true;
    if (laneDist(x, z).d < 0.4) return true;
    for (const H of this.houses) { const S = H.spec, w = S.shape === 'round' ? S.r * 2 + 1.5 : S.w + 1.4; if (inside({ ...H, z: H.z + Math.cos(H.yaw) * S.garden / 2, x: H.x + Math.sin(H.yaw) * S.garden / 2 }, x, z, w, (S.shape === 'round' ? S.r * 2 : S.d) + S.garden + 0.6)) return true; }
    for (const P of this.pens) if (inside(P, x, z, PEN_SIZE.hw * 2 + 0.4, PEN_SIZE.z1 - PEN_SIZE.z0 + 0.4)) return true;
    return false;
  }

  // every frame (Farm World): ms = the shared clock, viewers = players' positions
  update(dt, ms, viewers) { if (this.people) this.people.update(dt, ms, viewers); }

  /* ---------- parts ---------- */
  _houseColliders(H) {
    const S = H.spec, add = (x, z, r) => this.world.addCollider({ x, z, r, house: true });
    if (S.shape === 'round') { for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, p = Village.at(H, Math.cos(a) * (S.r - 0.2), Math.sin(a) * (S.r - 0.2)); add(p.x, p.z, 0.55); } return; }
    const rect = (cx, cz, w, d) => {
      for (const [ax, az, bx, bz] of [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]]) {
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 0.9));
        for (let i = 0; i <= n; i++) { const t = i / n, p = Village.at(H, cx + ax + (bx - ax) * t, cz + az + (bz - az) * t); add(p.x, p.z, 0.5); }
      }
    };
    rect(0, 0, S.w - 0.5, S.d - 0.5);
    if (S.annex) rect(S.annex.side * (S.w / 2 + S.annex.w / 2), -S.d / 2 + S.annex.d / 2 + 0.2, S.annex.w - 0.4, S.annex.d - 0.4);
    if (S.porch) for (const s of [-1, 1]) { const p = Village.at(H, s * (Math.min(S.porch.w, S.w) / 2 - 0.12), S.d / 2 + S.porch.d - 0.12); add(p.x, p.z, 0.2); }
  }
  // a pen beside house H (the first side with room), and its animals (the farm's decorative animals)
  _pen(H, chunk, gIn, farmland) {
    const S = H.spec, T = this.world.T, kind = S.pen;
    const tries = [[1, S.w / 2 + PEN_SIZE.hw + 1.0, -0.2, 0], [-1, -(S.w / 2 + PEN_SIZE.hw + 0.9), -0.2, 0], [0, 0, -(S.d / 2 + 3.4), Math.PI]];
    for (const [, lx, lz, turn] of tries) {
      const c = Village.at(H, lx, lz), P = { x: c.x, z: c.z, yaw: H.yaw + turn };
      const pts = [[-PEN_SIZE.hw, PEN_SIZE.z0], [PEN_SIZE.hw, PEN_SIZE.z0], [PEN_SIZE.hw, PEN_SIZE.z1], [-PEN_SIZE.hw, PEN_SIZE.z1], [0, 0]].map(([a, b]) => Village.at(P, a, b));
      const hs = pts.map(p => T.heightAt(p.x, p.z));
      if (Math.max(...hs) - Math.min(...hs) > 1.4) continue;
      if (pts.some(p => laneDist(p.x, p.z).d < 0.8 || T.roadDistAt(p.x, p.z) < 6 || T.riverDistAt(p.x, p.z) < 9)) continue;
      if (pts.some(p => this.houses.some(o => o !== H && inside(o, p.x, p.z, (o.spec.shape === 'round' ? o.spec.r * 2 : o.spec.w) + 1, (o.spec.shape === 'round' ? o.spec.r * 2 : o.spec.d) + o.spec.garden * 2)))) continue;
      if (pts.some(p => this.pens.some(o => inside(o, p.x, p.z, PEN_SIZE.hw * 2 + 1, 6)))) continue;
      P.y = Math.min(...hs);
      const b = chunk(P.x, P.z);
      let home;
      b.group(P.x, P.y, P.z, 0, P.yaw, 0, () => { home = buildPen(b, kind, gIn(P)); });
      P.kind = kind; P.house = H;
      this.pens.push(P);
      // the fence: you can't walk into the yard
      for (const [ax, az, bx, bz] of [[-PEN_SIZE.hw, PEN_SIZE.z1, PEN_SIZE.hw, PEN_SIZE.z1], [-PEN_SIZE.hw, PEN_SIZE.z0, -PEN_SIZE.hw, PEN_SIZE.z1], [PEN_SIZE.hw, PEN_SIZE.z0, PEN_SIZE.hw, PEN_SIZE.z1], [-PEN_SIZE.hw, PEN_SIZE.z0, PEN_SIZE.hw, PEN_SIZE.z0]]) {
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.7);
        for (let i = 0; i <= n; i++) { const p = Village.at(P, ax + (bx - ax) * i / n, az + (bz - az) * i / n); this.world.addCollider({ x: p.x, z: p.z, r: 0.28 }); }
      }
      if (farmland && farmland.decor) {
        const list = ANIMALS[kind].map((type, i) => ({ id: `v-${H.spec.name}-${i}`, type, k: hash(`v-${H.spec.name}-${i}`), home: { F: { x: P.x, z: P.z, yaw: P.yaw }, ...home }, gi: i, gn: ANIMALS[kind].length, gk: hash(H.spec.name) }));
        if (kind === 'goat' && list.length >= 2) { list[0].partner = list[1]; list[1].partner = list[0]; }
        farmland.decor.push(...list);
      }
      return;
    }
  }
  _square(chunk) {
    const T = this.world.T, Q = SQUARE, b = chunk(Q.x, Q.z), put = (x, z, yaw, fn) => b.group(x, T.heightAt(x, z), z, 0, yaw, 0, fn);
    put(Q.x, Q.z, 0.3, () => well(b));
    this.world.addCollider({ x: Q.x, z: Q.z, r: 1.35 });
    // benches round the well, facing it
    for (const a of [0.6, 2.2, 3.8, 5.3]) {
      const x = Q.x + Math.cos(a) * 4.2, z = Q.z + Math.sin(a) * 4.2, yaw = Math.atan2(Q.x - x, Q.z - z) + Math.PI;
      put(x, z, yaw, () => bench(b, 0, 0, 0, 0));
      this.spots.benches.push({ x, z, yaw: yaw + Math.PI });
    }
    // the fruit stall on the west side, lamps round the square, barrels and pots
    const sx = Q.x - Q.r + 1.6, sz = Q.z - 2.2;
    put(sx, sz, Math.PI / 2, () => stall(b));
    this.world.addCollider({ x: sx, z: sz, r: 1.1 }); this.world.addCollider({ x: sx, z: sz + 1.2, r: 0.7 }); this.world.addCollider({ x: sx, z: sz - 1.2, r: 0.7 });
    this.spots.stall = { x: sx + 1.4, z: sz, yaw: -Math.PI / 2 };
    this.spots.stallAt = { x: sx, z: sz };
    for (const a of [0.2, 1.75, 3.35, 4.9]) { const x = Q.x + Math.cos(a) * (Q.r - 0.4), z = Q.z + Math.sin(a) * (Q.r - 0.4); put(x, z, a, () => lampPost(b, 0, 0, 0, 0)); this.world.addCollider({ x, z, r: 0.2 }); }
    put(Q.x + 3.2, Q.z - Q.r + 1.2, 0.4, () => pots(b));
    put(Q.x - 2.6, Q.z - Q.r + 0.9, 0, () => barrel(b, 0, 0, 0, C.wood));
    put(Q.x - 2.0, Q.z - Q.r + 0.7, 0, () => barrel(b, 0, 0, 0, C.woodL));
    this.bigTree = { x: Q.x - Q.r - 2.5, z: Q.z + Q.r - 1 };
  }
  // one or two things beside each house (where there's room)
  _yard(H, i, chunk, R) {
    const T = this.world.T, S = H.spec, w = S.shape === 'round' ? S.r * 2 : S.w, d = S.shape === 'round' ? S.r * 2 : S.d;
    const items = ['wood', 'cart', 'hay', 'line', 'hearth', 'shed', 'table', 'pots', 'bales', 'wood'];
    const pick = [items[i % items.length], items[(i * 3 + 5) % items.length]];
    const spots = [[-(w / 2 + 1.5), -d * 0.15, Math.PI / 2], [w / 2 + 1.5, -d * 0.15, -Math.PI / 2], [-(w * 0.25), -(d / 2 + 1.6), 0], [w * 0.25, -(d / 2 + 1.7), 0]];
    let n = 0;
    for (const [lx, lz, turn] of spots) {
      if (n >= 2) break;
      const p = Village.at(H, lx, lz), what = pick[n], rad = what === 'cart' || what === 'line' || what === 'shed' ? 1.8 : 1.2;
      if (laneDist(p.x, p.z).d < rad || T.roadDistAt(p.x, p.z) < 6 || T.riverDistAt(p.x, p.z) < 9) continue;
      if (this.houses.some(o => o !== H && inside(o, p.x, p.z, (o.spec.shape === 'round' ? o.spec.r * 2 : o.spec.w) + rad * 2, (o.spec.shape === 'round' ? o.spec.r * 2 : o.spec.d) + rad * 2))) continue;
      if (this.pens.some(o => inside(o, p.x, p.z, PEN_SIZE.hw * 2 + rad * 2, 4.2 + rad * 2))) continue;
      const b = chunk(p.x, p.z), yaw = H.yaw + turn;
      b.group(p.x, T.heightAt(p.x, p.z) - 0.02, p.z, 0, yaw, 0, () => {
        if (what === 'wood') woodPile(b, 0, 0, 0, 3, 1.5, 0);
        else if (what === 'cart') cart(b, R() < 0.5 ? 'hay' : 'crates');
        else if (what === 'hay') haystack(b, false);
        else if (what === 'bales') haystack(b, true);
        else if (what === 'line') clothesline(b, 3.2);
        else if (what === 'hearth') hearth(b);
        else if (what === 'shed') shed(b);
        else if (what === 'table') tableSet(b);
        else pots(b);
      });
      if (what !== 'line' && what !== 'pots') this.world.addCollider({ x: p.x, z: p.z, r: what === 'cart' || what === 'shed' ? 1.1 : what === 'hay' ? 1.2 : 0.7 });
      (this.spots.props || (this.spots.props = [])).push({ what, x: p.x, z: p.z, yaw, house: H });
      n++;
    }
  }
  _lamps(chunk) {
    const T = this.world.T;
    for (const L of LANES) {
      if (L.id === 'main') continue;                                  // (the fishing path has its own lamps)
      let walked = 0, next = 7, side = 1;
      for (let i = 0; i < L.pts.length - 1; i++) {
        const [ax, az] = L.pts[i], [bx, bz] = L.pts[i + 1], len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
        for (let s = 0; s < len; s += 1) {
          if (walked + s < next) continue;
          const x = ax + tx * s - tz * side * (L.w / 2 + 0.8), z = az + tz * s + tx * side * (L.w / 2 + 0.8);
          if (this.houses.some(o => inside(o, x, z, (o.spec.shape === 'round' ? o.spec.r * 2 : o.spec.w) + 0.8, (o.spec.shape === 'round' ? o.spec.r * 2 : o.spec.d) + 0.8)) || this.pens.some(o => inside(o, x, z, 5.4, 4.8))) continue;
          if (laneDist(x, z).d < 0.3 || Math.hypot(x - SQUARE.x, z - SQUARE.z) < SQUARE.r + 1) continue;
          const b = chunk(x, z);
          b.group(x, T.heightAt(x, z), z, 0, Math.atan2(tx * side, tz * side), 0, () => lampPost(b, 0, 0, 0, 0));   // the lantern hangs over the lane
          this.world.addCollider({ x, z, r: 0.2 });
          next = walked + s + 15; side = -side;
        }
        walked += len;
      }
    }
  }
  _sign() {
    const T = this.world.T, [ax, az] = LANES[1].pts[0], x = ax + 2.4, z = az + 1.2;
    const s = signboard(VILLAGE_NAME.toUpperCase(), 'village', { w: 1.9, h: 0.75, lift: 0.9, bg: '#7a4e2a' });
    s.position.set(x, T.heightAt(x, z), z); s.rotation.y = Math.atan2(-0.4, -1) + Math.PI * 0.85;
    this._add(s);
    this.world.addCollider({ x, z, r: 0.3 });
  }
  // trees round the village and between the houses (where there's room), and the big tree by the square
  _trees(R) {
    const T = this.world.T, list = [];
    const ok = (x, z, r) => !(x < BOUNDS.x0 + 1 || x > BOUNDS.x1 - 1 || z < BOUNDS.z0 + 1 || z > BOUNDS.z1 - 1)
      && T.roadDistAt(x, z) > 7 && T.riverDistAt(x, z) > 10 && laneDist(x, z).d > r && Math.hypot(x - SQUARE.x, z - SQUARE.z) > SQUARE.r + r
      && !this.houses.some(o => inside(o, x, z, (o.spec.shape === 'round' ? o.spec.r * 2 : o.spec.w) + r * 2, (o.spec.shape === 'round' ? o.spec.r * 2 : o.spec.d) + o.spec.garden * 2 + r))
      && !this.pens.some(o => inside(o, x, z, PEN_SIZE.hw * 2 + r * 2, 4.2 + r * 2)) && !list.some(t => Math.hypot(t.x - x, t.z - z) < 6);
    if (ok(this.bigTree.x, this.bigTree.z, 2)) list.push({ ...this.bigTree, k: 0, s: 1.15 });
    for (let i = 0; i < 260 && list.length < 32; i++) {
      const x = R(BOUNDS.x0 + 2, BOUNDS.x1 - 2), z = R(BOUNDS.z0 + 2, BOUNDS.z1 - 2);
      if (ok(x, z, 2.2)) list.push({ x, z, k: Math.floor(R(0, 3)), s: R(0.75, 1.0) });
    }
    for (const t of list) { (this.trees[t.k] || (this.trees[t.k] = [])).push([t.x, T.heightAt(t.x, t.z) - 0.1, t.z, R(0, 6), t.s]); this.world.addCollider({ x: t.x, z: t.z, r: 0.45 * t.s, tree: true }); }
  }
  // the instanced plants and trees
  _instanced() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const make = (geo, list, shadow) => {
      const im = new THREE.InstancedMesh(geo, MAT.solid, list.length);
      list.forEach(([x, y, z, yaw, sc], i) => im.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromAxisAngle(up, yaw), s.set(sc, sc, sc))));
      im.castShadow = shadow; im.receiveShadow = true; im.computeBoundingSphere();
      this._add(im);
    };
    for (const [kind, list] of Object.entries(this.plants)) if (list.length && PLANTS[kind]) make(PLANTS[kind](), list, SHADOW_PLANTS.has(kind));
    const tg = [geoOf(broadleafA), geoOf(broadleafB), geoOf(roundTree)];
    for (const [k, list] of Object.entries(this.trees)) if (list.length) make(tg[k], list, true);
  }
}
