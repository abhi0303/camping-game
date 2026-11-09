import * as THREE from 'three';
import { GeoBuilder, MAT, rand, srand, clamp, canvasTexture } from './utils.js';
import { DayNight, flambeau } from './day-night.js';
import * as F from './flora.js';
import { buildTerrain, X0, Z0, SX, SZ, START, CAMP, BRIDGE, RIVER_HALF, NORTH, VALLEY, TOWER_ZONE, GIANT } from './terrain.js';

const GC = 10, GNX = Math.ceil(SX / GC), GNZ = Math.ceil(SZ / GC);   // collision grid (10 m cells)
const CHX = 6, CHZ = 12;                                            // vegetation chunks, about 78 m square (frustum and fog culling)

export class World {
  constructor(scene, opts = {}) {
    this.scene = scene; this.lite = !!opts.lite; this.onNightChange = null;
    this.bounds = { minX: -232, maxX: 232, minZ: -232, maxZ: 712 };
    this.grid = Array.from({ length: GNX * GNZ }, () => []);
    this.deco = Array.from({ length: GNX * GNZ }, () => []);   // small things on the ground {x, z, r} (no collision: grass keeps off them)
    this.fogList = [];           // still meshes skipped when wholly in the fog: { m, c, r }
    this.surfaces = [];          // extra walkable tops (towers, castle walls): { surfaceAt(x, z, y) -> height | null }
    this.night = 0; this.nightTarget = 0; this.time = 0; this.fireBoost = 0;
    this.bridge = null;          // set by main (BridgeWorld)
    this.crates = [];            // supply crates {pos, label, give, taken}
    this.grassBlock = [];        // (x, z) -> true where no grass blades may grow (farm pens, paths…; js/grass.js)
    this.grassRev = 0;
    srand(4242);

    this._lights();
    this.dayNight = new DayNight(this);     // sun, sky, fog, clouds and lamps by the time of day (js/day-night.js)
    const T = this.T = buildTerrain();
    this.W = T.W;
    scene.add(T.mesh, T.roadMesh, T.waterMesh);
    this._vegetation();
    this._groundDecor();
    const b = new GeoBuilder();
    this._trailhead(b);
    this._camp(b);
    this._highlands(b);
    const stat = b.build();
    stat.traverse(o => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
    scene.add(stat);
    this._clouds();
    this._helicopter();
  }

  /* ---------------- queries ---------------- */
  heightAt(x, z) { return this.T.heightAt(x, z); }
  // ground under a point: terrain, or the bridge deck if standing on it
  groundAt(x, z, y = 1e9) {
    let g = this.T.heightAt(x, z);
    if (this.bridge) { const b = this.bridge.surfaceAt(x, z); if (b !== null && b > g && y >= b - 0.7) g = b; }
    for (const s of this.surfaces) { const b = s.surfaceAt(x, z, y); if (b !== null && b > g && y >= b - 0.7) g = b; }
    return g;
  }
  waterDepth(x, z) {
    if (this.T.riverDistAt(x, z) > RIVER_HALF + 2) return 0;
    return Math.max(0, this.W - this.T.heightAt(x, z));
  }
  _cell(x, z) { return clamp(Math.floor((z - Z0) / GC), 0, GNZ - 1) * GNX + clamp(Math.floor((x - X0) / GC), 0, GNX - 1); }
  addCollider(c) { c.cell = this._cell(c.x, c.z); this.grid[c.cell].push(c); return c; }
  removeCollider(c) { const a = this.grid[c.cell]; const i = a ? a.indexOf(c) : -1; if (i >= 0) a.splice(i, 1); }
  forNear(x, z, fn) {
    const ci = clamp(Math.floor((x - X0) / GC), 0, GNX - 1), cj = clamp(Math.floor((z - Z0) / GC), 0, GNZ - 1);
    for (let j = Math.max(0, cj - 1); j <= Math.min(GNZ - 1, cj + 1); j++)
      for (let i = Math.max(0, ci - 1); i <= Math.min(GNX - 1, ci + 1); i++)
        for (const c of this.grid[j * GNX + i]) fn(c);
  }
  // Push a world-space point out of nearby colliders (a collider with top / bottom only counts between those heights)
  collide(p, radius) {
    this.forNear(p.x, p.z, c => {
      if ((c.top !== undefined && p.y > c.top) || (c.bottom !== undefined && p.y < c.bottom)) return;   // (only between those heights, when given)
      const dx = p.x - c.x, dz = p.z - c.z, rr = c.r + radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), k = (rr - d) / d; p.x += dx * k; p.z += dz * k; }
    });
    p.x = clamp(p.x, this.bounds.minX, this.bounds.maxX);
    p.z = clamp(p.z, this.bounds.minZ, this.bounds.maxZ);
  }
  nearestTree(x, z, fx, fz, maxD) {
    let best = null, bd = maxD;
    this.forNear(x, z, c => {
      if (!c.tree) return;
      const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.2) { bd = d; best = c; }
    });
    return best;
  }

  /* ---------------- lighting / sky ---------------- */
  _lights() {
    this.skyDay = new THREE.Color(0xa9cbe0); this.skyNight = new THREE.Color(0x0c1220);
    this.scene.background = this.skyDay.clone();
    this.scene.fog = new THREE.Fog(this.skyDay.clone(), 70, 300);
    this.hemi = new THREE.HemisphereLight(0xd6e8ff, 0x4d6b38, 1.5);
    this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 160;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    this.scene.add(sun); this.scene.add(sun.target);
  }

  /* ---------------- vegetation (instanced, chunked) ---------------- */
  // trees and bushes sway in the wind: the higher up a tree, the more it moves (Farm World's weather sets how
  // hard and which way: js/weather/effects.js). Shadows stay still.
  _vegMaterial() {
    const m = MAT.solid.clone(), U = this.windU = { uWT: { value: 0 }, uWA: { value: 0.12 }, uWD: { value: new THREE.Vector2(0.6, 0.8) } };
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWT, uWA; uniform vec2 uWD;')
        .replace('#include <project_vertex>', `vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            float wh = max(transformed.y, 0.0) * length(instanceMatrix[1].xyz), wp = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
            float ws = (0.55 + 0.45 * sin(uWT * 1.3 + wp) + 0.2 * sin(uWT * 3.1 + wp * 1.7)) * uWA * wh * wh * 0.006;
            mvPosition.xz += uWD * ws;
          #endif
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    m.customProgramCacheKey = () => 'veg-wind-v1';
    return m;
  }

  _vegetation() {
    const geo = fn => { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; };
    this.vegMat = this._vegMaterial();
    // every kind has one or more looks (js/flora.js); which look a spot gets comes from its position (w: how
    // often each look appears), so the world's random sequence — and where everything stands — is unchanged
    const rocks = [geo(F.boulderA), geo(F.boulderB), geo(F.standingRock), geo(F.redRock)], bushG = geo(F.roundBush);
    const types = {
      jungle: { geos: [geo(F.broadleafA), geo(F.broadleafB), geo(F.roundTree), geo(F.deadTree)], w: [0.42, 0.36, 0.17, 0.05], n: 430, shadow: true, r: 0.55, tree: true, near: 7.5 },
      tall: { geos: [geo(F.bigTree)], n: 70, shadow: true, r: 0.7, tree: true, near: 9 },
      palm: { geos: [geo(F.palmA), geo(F.palmB)], n: 130, shadow: true, r: 0.4, tree: true, near: 7.5, river: true },
      fern: { geos: [geo(F.smallPlant)], n: 800, shadow: false, near: 5.2, small: true },
      bush: { geos: [bushG], n: 260, shadow: false, near: 5.6, small: true },
      rock: { geos: rocks, w: [0.38, 0.32, 0.18, 0.12], n: 110, shadow: true, near: 6, rock: true },
      // highlands (north of the ridge)
      pine: { geos: [geo(F.pineLime), geo(F.pineGreen)], n: 420, shadow: true, r: 0.5, tree: true, near: 7.5, north: true },
      pine2: { geos: [geo(F.pineTall), geo(F.cypress)], w: [0.65, 0.35], n: 90, shadow: true, r: 0.6, tree: true, near: 9, north: true },
      hbush: { geos: [bushG], n: 160, shadow: false, near: 5.6, small: true, north: true },
      tuft: { geos: [geo(grassTuft)], n: 420, shadow: false, near: 4.8, small: true, north: true },
      hrock: { geos: rocks.slice(0, 3), w: [0.42, 0.36, 0.22], n: 170, shadow: true, near: 6, rock: true, north: true },
    };
    const look = (t, x, z) => {
      if (t.geos.length < 2) return 0;
      const h = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1, w = t.w || t.geos.map(() => 1 / t.geos.length);
      let acc = 0;
      for (let i = 0; i < w.length; i++) { acc += w[i]; if (h < acc) return i; }
      return w.length - 1;
    };
    if (this.lite) for (const k in types) types[k].n = Math.round(types[k].n * 0.55);   // phones: lighter jungle
    const T = this.T, m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // the highest points of each tree's crown, in the tree's own space (birds sit there: js/birds.js)
    this.treeTops = {};
    for (const key of ['jungle', 'tall']) types[key].geos.forEach((g, vi) => {
      const pos = g.attributes.position, pts = [];
      for (let i = 0; i < pos.count; i++) pts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
      pts.sort((a, b) => b[1] - a[1]);
      this.treeTops[key + vi] = pts.filter((v, i) => pts.findIndex(w => Math.hypot(w[0] - v[0], w[2] - v[2]) < 0.4 && Math.abs(w[1] - v[1]) < 0.4) === i).slice(0, 4);
    });
    for (const key in types) {
      const t = types[key], chunks = t.geos.map(() => Array.from({ length: CHX * CHZ }, () => []));
      let placed = 0, tries = 0;
      while (placed < t.n && tries < t.n * 30) {
        tries++;
        const x = rand(-232, 232), z = t.north ? rand(NORTH + 6, 712) : rand(-232, NORTH - 10);
        const rd = T.roadDistAt(x, z), wd = T.riverDistAt(x, z);
        const ds = Math.hypot(x - START.x, z - START.z), dc = Math.hypot(x - CAMP.x, z - CAMP.z), db = Math.hypot(x - BRIDGE.mx, z - BRIDGE.mz);
        if (rd < t.near || ds < (t.small ? 30 : 40) || dc < (t.small ? 24 : 32)) continue;
        if (t.north && (Math.hypot(x - GIANT.x, z - GIANT.z) < (t.small ? 34 : 46) || (Math.abs(x - TOWER_ZONE.x) < TOWER_ZONE.hw + (t.small ? 3 : 9) && Math.abs(z - TOWER_ZONE.z) < TOWER_ZONE.hd + (t.small ? 3 : 9)))) continue;
        if (wd < RIVER_HALF + (t.rock ? 0.5 : t.small ? 1 : 2.5)) continue;
        if (!t.small && !t.rock && db < 20) continue;
        if (!t.small && rd > 40 && rand() > 0.6) continue;          // denser jungle along the trail
        if (t.river && wd > 45 && rand() > 0.35) continue;
        const sc = t.rock ? rand(0.4, 1.9) : rand(0.8, 1.3);
        const yaw = rand(0, Math.PI * 2);
        p.set(x, T.heightAt(x, z) - 0.1, z); q.setFromAxisAngle(up, yaw); s.set(sc, sc * (t.small ? rand(0.8, 1.2) : 1), sc);
        const ci = clamp(Math.floor((x - X0) / (SX / CHX)), 0, CHX - 1) + CHX * clamp(Math.floor((z - Z0) / (SZ / CHZ)), 0, CHZ - 1);
        const vi = look(t, x, z);
        chunks[vi][ci].push(m.compose(p, q, s).clone());
        if (t.r) this.addCollider({ x, z, r: t.r * sc, tree: !!t.tree, kind: key + vi, yaw, sc, y: p.y });   // (kind, yaw, sc, y: birds perch on the crowns)
        else if (t.rock && sc > 0.9) this.addCollider({ x, z, r: 0.9 * sc, rock: true });
        else if (t.rock || key === 'bush' || key === 'hbush' || key === 'fern') this.addDeco(x, z, (t.rock ? 1.0 : key === 'fern' ? 0.8 : 1.0) * sc);
        placed++;
      }
      for (let vi = 0; vi < t.geos.length; vi++) for (const list of chunks[vi]) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(t.geos[vi], t.rock ? MAT.solid : this.vegMat, list.length);
        list.forEach((mm, i) => im.setMatrixAt(i, mm));
        im.castShadow = t.shadow; im.receiveShadow = !t.shadow;
        im.computeBoundingSphere();
        this.scene.add(im);
        (this.vegMeshes || (this.vegMeshes = [])).push(im);
      }
    }
  }

  // Small things on the ground that go with the painted grass and mud (js/terrain.js): leafy plants,
  // pebbles, grey rocks, round bushes, cut stumps and broken logs (the flowers near the player are js/grass.js). Instanced and chunked like the jungle (one draw call per chunk and kind), no
  // shadows, no colliders. They use their own random numbers, so the jungle, crates and colliders stay
  // exactly where they were. Phones get about half.
  _groundDecor() {
    let seed = 9137;
    const rnd = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };
    const geo = fn => { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; };
    const T = this.T, k = this.lite ? 0.55 : 1;
    const kinds = [
      { geo: geo(F.smallPlant), n: 650, sc: [0.7, 1.2], road: 5.4 },
      { geo: geo(F.pebbles), n: 1100, sc: [0.5, 1.1], road: 4.8, tints: [0x9aa0aa, 0xa8adb6, 0x8f96a2, 0xb0b4bb, 0x9a8a7a], deco: 0.7 },   // little groups of pebbles, coloured per group
      { geo: geo(F.rockCluster), n: 700, sc: [0.45, 1.0], road: 6, flat: true, tints: [0xa3a8b1, 0xb2b7c0, 0x99a2b0, 0xaeb0b4], solid: 0.55, deco: 1.4 },   // grey and bluish-grey rocks with small stones (you bump into the bigger ones)
      { geo: geo(F.roundBush), n: 380, sc: [0.5, 1.0], road: 6, tints: [0xffffff, 0xeef8e4, 0xfff6de], deco: 1.15 },   // round, faceted, bright
      { geo: geo(F.stump), n: 140, sc: [0.75, 1.25], road: 6, collide: 0.5, deco: 1.2 },          // cut stumps with roots
      { geo: geo(F.fallenLog), n: 100, sc: [0.7, 1.15], road: 6.5, log: true, deco: 1.6 },       // broken fallen logs
    ];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (const t of kinds) {
      const chunks = Array.from({ length: CHX * CHZ }, () => []), n = Math.round(t.n * k);
      let placed = 0, tries = 0;
      while (placed < n && tries < n * 20) {
        tries++;
        const x = rnd(-230, 230), z = rnd(-230, 708), y = T.heightAt(x, z);
        if (T.roadDistAt(x, z) < t.road || T.riverDistAt(x, z) < RIVER_HALF + 1.2) continue;
        if (Math.abs(T.heightAt(x + 1.5, z) - T.heightAt(x - 1.5, z)) > 1.6 || Math.abs(T.heightAt(x, z + 1.5) - T.heightAt(x, z - 1.5)) > 1.6) continue;   // no cliffs
        if (Math.hypot(x - START.x, z - START.z) < 16 || Math.hypot(x - CAMP.x, z - CAMP.z) < 16 || Math.hypot(x - GIANT.x, z - GIANT.z) < 34
          || (Math.abs(x - TOWER_ZONE.x) < TOWER_ZONE.hw + 3 && Math.abs(z - TOWER_ZONE.z) < TOWER_ZONE.hd + 3)) continue;
        const sc = rnd(t.sc[0], t.sc[1]);
        e.set(t.flat ? rnd(-0.3, 0.3) : 0, rnd(0, Math.PI * 2), t.flat ? rnd(-0.3, 0.3) : 0); q.setFromEuler(e);
        p.set(x, y - (t.flat ? sc * 0.25 : 0.05), z); sv.set(sc, sc * (t.flat ? rnd(0.6, 1) : rnd(0.85, 1.2)), sc);
        const ci = clamp(Math.floor((x - X0) / (SX / CHX)), 0, CHX - 1) + CHX * clamp(Math.floor((z - Z0) / (SZ / CHZ)), 0, CHZ - 1);
        chunks[ci].push({ m: m.compose(p, q, sv).clone(), c: t.tints ? t.tints[Math.floor(rnd(0, t.tints.length))] : 0 });
        this.addDeco(x, z, sc * (t.deco || 0.45));                                                   // grass keeps off it
        if (t.solid && sc > t.solid) this.addCollider({ x, z, r: sc * 1.05, rock: true });
        if (t.collide) this.addCollider({ x, z, r: sc * t.collide, rock: true });
        if (t.log) for (const d of [-0.8, 0.8]) this.addCollider({ x: x + Math.cos(e.y) * d * sc, z: z - Math.sin(e.y) * d * sc, r: 0.38 * sc, rock: true });
        placed++;
      }
      for (const list of chunks) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(t.geo, MAT.solid, list.length), tc = new THREE.Color();
        list.forEach((o, i) => { im.setMatrixAt(i, o.m); if (t.tints) im.setColorAt(i, tc.set(o.c)); });
        im.castShadow = false; im.receiveShadow = true;
        im.computeBoundingSphere();
        this.scene.add(im);
        (this.vegMeshes || (this.vegMeshes = [])).push(im);
      }
    }
  }

  // a small thing on the ground (rock, pebble, bush, plant) that grass and flowers must not grow on
  addDeco(x, z, r) { this.deco[this._cell(x, z)].push({ x, z, r }); }
  // is (x, z) on (or right next to) an object — a collider (tree trunk, rock, fence, lamp…) or a ground decoration?
  blockedAt(x, z, pad = 0.25) {
    const ci = clamp(Math.floor((x - X0) / GC), 0, GNX - 1), cj = clamp(Math.floor((z - Z0) / GC), 0, GNZ - 1);
    for (let j = Math.max(0, cj - 1); j <= Math.min(GNZ - 1, cj + 1); j++)
      for (let i = Math.max(0, ci - 1); i <= Math.min(GNX - 1, ci + 1); i++) {
        for (const c of this.grid[j * GNX + i]) { const dx = c.x - x, dz = c.z - z, rr = c.r + pad; if (dx * dx + dz * dz < rr * rr) return true; }
        for (const c of this.deco[j * GNX + i]) { const dx = c.x - x, dz = c.z - z, rr = c.r + pad; if (dx * dx + dz * dz < rr * rr) return true; }
      }
    return false;
  }

  // no grass blades here (a test (x, z) -> true); the grass around the player is filled again
  addGrassBlock(fn) { this.grassBlock.push(fn); this.grassRev++; }

  // Farm World: clear trees, bushes and rocks from these rectangles (the farm and its path).
  // Done after the jungle is made, so Zombie Trail's jungle stays exactly as it is.
  clearArea(rects) {
    const inside = (x, z) => rects.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), m = new THREE.Matrix4();
    for (const im of this.vegMeshes || []) {
      let hit = false;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        if (inside(m.elements[12], m.elements[14])) { im.setMatrixAt(i, zero); hit = true; }
      }
      if (hit) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    }
    this._compactVeg();
    for (const cell of this.grid) for (let i = cell.length - 1; i >= 0; i--) { const c = cell[i]; if ((c.tree || c.rock) && inside(c.x, c.z)) cell.splice(i, 1); }
    for (const cell of this.deco) for (let i = cell.length - 1; i >= 0; i--) if (inside(cell[i].x, cell[i].z)) cell.splice(i, 1);
    this.grassRev++;
  }

  // drop the cleared (zero-size) plants from the instance lists, so the graphics card doesn't draw them at all
  _compactVeg() {
    const m = new THREE.Matrix4(), c = new THREE.Color();
    for (const im of this.vegMeshes || []) {
      let n = 0;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        if (m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0) continue;
        if (n !== i) { im.setMatrixAt(n, m); if (im.instanceColor) { im.getColorAt(i, c); im.setColorAt(n, c); } }
        n++;
      }
      if (n === im.count) continue;
      im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      if (n) im.computeBoundingSphere(); else { im.visible = false; im.userData.empty = true; }
    }
  }
  // every frame: a chunk of plants that lies wholly beyond the fog (where it would be drawn in the fog colour, unseen)
  // is not drawn at all
  _fogCull(camera) {
    const far = this.scene.fog ? this.scene.fog.far + 6 : Infinity, p = camera.position;
    for (const im of this.vegMeshes || []) {
      if (im.userData.empty) continue;
      const S = im.boundingSphere;
      im.visible = !S || p.distanceTo(S.center) - S.radius < far;
    }
    for (const o of this.fogList) o.m.visible = p.distanceTo(o.c) - o.r < far;
  }
  // other things that never move (Sonpur village's meshes): skipped the same way when they're wholly in the fog
  addFogCull(m) {
    const g = m.geometry;
    if (m.isInstancedMesh) { if (!m.boundingSphere) m.computeBoundingSphere(); }
    else if (!g.boundingSphere) g.computeBoundingSphere();
    m.updateMatrixWorld(true);
    const S = (m.isInstancedMesh ? m.boundingSphere : g.boundingSphere).clone().applyMatrix4(m.matrixWorld);
    this.fogList.push({ m, c: S.center, r: S.radius });
  }

  /* ---------------- trailhead (start) ---------------- */
  _trailhead(b) {
    const r = this.T.road, P = s => { const q = r.pointAt(s); q.nx = q.tz; q.nz = -q.tx; return q; };
    // entrance gate over the road
    const g = P(32), gy = this.T.heightAt(g.x, g.z);
    for (const sd of [1, -1]) {
      const x = g.x + g.nx * 5.4 * sd, z = g.z + g.nz * 5.4 * sd;
      b.cyl(0.32, 0.4, 6.2, 7, x, gy + 3.1, z, 0x6e4a2a);
      b.cyl(0.5, 0.55, 0.5, 7, x, gy + 0.25, z, 0x7d7b74);
      this.addCollider({ x, z, r: 0.45 });
    }
    for (const sd of [1, -1]) {                                   // torches beside the gate
      const x = g.x + g.nx * 6.5 * sd, z = g.z + g.nz * 6.5 * sd;
      flambeau(b, x, this.T.heightAt(x, z), z); this.addCollider({ x, z, r: 0.2 });
    }
    const ang = Math.atan2(g.nx, g.nz);
    b.cyl(0.26, 0.26, 12.4, 7, g.x, gy + 5.9, g.z, 0x6e4a2a, Math.PI / 2, ang, 0);
    b.cyl(0.2, 0.2, 11.2, 6, g.x, gy + 5.2, g.z, 0x7a5230, Math.PI / 2, ang, 0);
    const signTex = canvasTexture(512, 128, (c, w, h) => {
      c.fillStyle = '#5b3a1e'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#3a2412'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
      c.fillStyle = '#f2e3b6'; c.textAlign = 'center'; c.font = 'bold 58px Georgia'; c.fillText('JUNGLE TRAIL', w / 2, 66);
      c.font = 'bold 26px Arial'; c.fillText('▲ HILLTOP CAMP  ·  BRIDGE 0.3 km', w / 2, 106);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.55), new THREE.MeshLambertMaterial({ map: signTex, side: THREE.DoubleSide }));
    sign.position.set(g.x, gy + 4.35, g.z); sign.rotation.y = Math.atan2(-g.tx, -g.tz);
    this.scene.add(sign);
    b.group(g.x, gy + 4.35, g.z, 0, Math.atan2(-g.tx, -g.tz), 0, () => { b.box(6.5, 1.8, 0.1, 0, 0, -0.08, 0x3a2412); });

    // ranger hut beside the parking
    const h = P(14), hx = h.x - h.nx * 13, hz = h.z - h.nz * 13, hy = this.T.heightAt(hx, hz), ha = Math.atan2(h.nx, h.nz);
    b.group(hx, hy, hz, 0, ha, 0, () => {
      b.box(4.4, 0.3, 3.6, 0, 0.15, 0, 0x6a4a2c);
      b.box(4.0, 2.6, 3.2, 0, 1.6, 0, 0x8a5a33);
      for (let y = 0.6; y < 2.9; y += 0.42) b.box(4.04, 0.05, 3.24, 0, y, 0, 0x6e4626);
      for (const sd of [1, -1]) b.box(4.6, 0.12, 2.15, 0, 3.35, sd * 0.95, 0x2f4f2a, 'solid', sd * 0.55, 0, 0);
      b.box(0.9, 1.9, 0.08, 0.6, 1.25, 1.62, 0x5a3a1e);
      b.box(1.0, 0.7, 0.08, -1.1, 1.8, 1.62, 0x2a3a48);
      b.box(1.1, 0.8, 0.06, -1.1, 1.8, 1.6, 0x6e4626);
      b.box(0.25, 0.18, 0.2, 0.6, 2.45, 1.7, 0xfff4d6, 'lamp'); b.light(0.6, 2.32, 1.85);
      b.box(4.4, 0.12, 1.2, 0, 0.36, 2.2, 0x7a5230);
    });
    this.addCollider({ x: hx, z: hz, r: 2.4 });
    // supply crate next to the hut
    const cx = hx + h.tx * 3.4 + h.nx * 1.5, cz = hz + h.tz * 3.4 + h.nz * 1.5, cy = this.T.heightAt(cx, cz);
    crate(b, cx, cy, cz, ha);
    this.addCollider({ x: cx, z: cz, r: 0.7 });
    this.crates.push({ pos: new THREE.Vector3(cx, cy, cz), label: 'Open supply crate', give: { planks: 6, rope: 6, logs: 4 }, taken: false });
    // map board on the other side of the road
    const mb = P(22), mx = mb.x + mb.nx * 7.5, mz = mb.z + mb.nz * 7.5, my = this.T.heightAt(mx, mz), ma = Math.atan2(-mb.nx, -mb.nz);
    b.group(mx, my, mz, 0, ma, 0, () => {
      for (const sd of [1, -1]) b.box(0.16, 2.4, 0.16, sd * 1.15, 1.2, 0, 0x6e4a2a);
      b.box(2.6, 1.9, 0.1, 0, 1.75, -0.06, 0x5b3a1e);
      b.box(2.9, 0.12, 0.5, 0, 2.8, 0, 0x2f4f2a);
    });
    this.mapBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.mapBoard.position.set(mx + Math.sin(ma) * 0.0, my + 1.75, mz); this.mapBoard.rotation.y = ma;
    this.mapBoard.translateZ(0.01);
    this.scene.add(this.mapBoard);
    this.mapBoardPos = new THREE.Vector3(mx, my, mz);
    this.addCollider({ x: mx, z: mz, r: 0.9 });
    // log fence around the parking
    for (let a = 0.4; a < 5.6; a += 0.35) {
      const x = START.x + Math.cos(a) * 34, z = START.z + Math.sin(a) * 34;
      if (this.T.roadDistAt(x, z) < 7) continue;
      const y = this.T.heightAt(x, z);
      b.cyl(0.1, 0.12, 1.2, 5, x, y + 0.6, z, 0x6e4a2a);
      b.cyl(0.08, 0.08, 12.2, 5, x, y + 0.9, z, 0x7a5230, Math.PI / 2, -a, 0);
    }
  }

  /* ---------------- hilltop camp (destination) ---------------- */
  _camp(b) {
    const y0 = this.T.campH;
    const fx = CAMP.x - 7, fz = CAMP.z + 5;
    this.firePos = new THREE.Vector3(fx, y0, fz);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.add(new THREE.DodecahedronGeometry(0.24, 0), 0x7d7b76, fx + Math.cos(a) * 0.8, y0 + 0.12, fz + Math.sin(a) * 0.8, a, a, 0); }
    b.cyl(0.09, 0.09, 1.1, 5, fx, y0 + 0.15, fz, 0x5a3b22, 0, 0.6, Math.PI / 2);
    b.cyl(0.09, 0.09, 1.1, 5, fx, y0 + 0.15, fz, 0x5a3b22, 0, -0.6, Math.PI / 2);
    for (const a of [0.3, 2.4, 4.4]) b.box(1.8, 0.4, 0.45, fx + Math.cos(a) * 2.8, y0 + 0.2, fz + Math.sin(a) * 2.8, 0x6e4a2a, 'solid', 0, -a + Math.PI / 2, 0);
    this.addCollider({ x: fx, z: fz, r: 1.0 });
    b.light(fx, y0 + 0.55, fz, 'fire');
    for (const a of [1.35, 3.4, 5.4]) {                            // torches around the fire ring (none on the road)
      const x = fx + Math.cos(a) * 4.4, z = fz + Math.sin(a) * 4.4;
      if (this.T.roadDistAt(x, z) < 6) continue;
      flambeau(b, x, this.T.heightAt(x, z), z); this.addCollider({ x, z, r: 0.2 });
    }
    for (const [dx, dz, a] of [[6, 8, 0.3], [9, 2, -0.4]]) picnicTable(b, CAMP.x + dx, y0, CAMP.z + dz, a, this);
    // lookout platform
    const lx = CAMP.x + 10, lz = CAMP.z - 9;
    for (const [px, pz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) { b.cyl(0.14, 0.16, 4.2, 6, lx + px, y0 + 2.1, lz + pz, 0x6e4a2a); this.addCollider({ x: lx + px, z: lz + pz, r: 0.25 }); }
    b.box(3.4, 0.2, 3.4, lx, y0 + 4.1, lz, 0x8a5a33);
    for (const sd of [1, -1]) { b.box(3.4, 0.08, 0.08, lx, y0 + 5.0, lz + sd * 1.65, 0x6e4a2a); b.box(0.08, 0.08, 3.4, lx + sd * 1.65, y0 + 5.0, lz, 0x6e4a2a); }
    b.box(3.8, 0.12, 3.8, lx, y0 + 6.4, lz, 0x2f4f2a); for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) b.cyl(0.07, 0.07, 1.4, 5, lx + px, y0 + 5.7, lz + pz, 0x6e4a2a);
    // flag
    b.cyl(0.06, 0.08, 7, 6, CAMP.x - 2, y0 + 3.5, CAMP.z - 10, 0xb9bec4);
    b.box(1.6, 1.0, 0.04, CAMP.x - 1.15, y0 + 6.3, CAMP.z - 10, 0xe8a33a);
    this.campPos = new THREE.Vector3(CAMP.x, y0, CAMP.z);
    // flame (animated)
    const fg = new GeoBuilder();
    fg.add(new THREE.ConeGeometry(0.35, 0.9, 5), 0xff8a1e, 0, 0.45, 0);
    fg.add(new THREE.ConeGeometry(0.2, 0.6, 5), 0xffd23a, 0.05, 0.35, 0.04);
    this.flame = fg.build({ solid: new THREE.MeshBasicMaterial({ vertexColors: true }) });
    this.flame.position.set(fx, y0 + 0.1, fz);
    this.flame.traverse(o => { o.castShadow = false; });
    this.scene.add(this.flame);
    this.fireLight = new THREE.PointLight(0xff8a30, 0, 16, 2);
    this.fireLight.position.set(fx, y0 + 1.2, fz);
    this.scene.add(this.fireLight);
  }

  /* ---------------- highlands: Watchtower Valley + Giant Plateau ---------------- */
  _highlands(b) {
    const T = this.T, H = (x, z) => T.heightAt(x, z);
    // tower building zone: corner stakes + rope boundary
    const Z = TOWER_ZONE, zx0 = Z.x - Z.hw, zx1 = Z.x + Z.hw, zz0 = Z.z - Z.hd, zz1 = Z.z + Z.hd;
    for (const [x, z] of [[zx0, zz0], [zx1, zz0], [zx0, zz1], [zx1, zz1]]) { const y = H(x, z); b.cyl(0.08, 0.1, 1.2, 5, x, y + 0.6, z, 0xd8b04a); b.box(0.3, 0.2, 0.3, x, y + 1.2, z, 0xc0392b); }
    for (let x = zx0 + 2; x < zx1; x += 4) for (const z of [zz0, zz1]) { const y = H(x, z); b.cyl(0.05, 0.06, 0.8, 4, x, y + 0.4, z, 0x8a5a33); }
    for (let z = zz0 + 2; z < zz1; z += 4) for (const x of [zx0, zx1]) { const y = H(x, z); b.cyl(0.05, 0.06, 0.8, 4, x, y + 0.4, z, 0x8a5a33); }
    for (const [ax, az, bx, bz] of [[zx0, zz0, zx1, zz0], [zx0, zz1, zx1, zz1], [zx0, zz0, zx0, zz1], [zx1, zz0, zx1, zz1]]) {
      const len = Math.hypot(bx - ax, bz - az), y = H((ax + bx) / 2, (az + bz) / 2);
      b.box(0.04, 0.04, len, (ax + bx) / 2, y + 0.75, (az + bz) / 2, 0xe8d090, 'solid', 0, Math.atan2(bx - ax, bz - az), 0);
    }
    // tower workbench (between the zone and the road)
    const tb = this.towerBenchPos = new THREE.Vector3(zx1 + 4.5, 0, Z.z - 4); tb.y = H(tb.x, tb.z);
    workbench(b, tb.x, tb.y, tb.z, -Math.PI / 2, 0x6a8f3a); this.addCollider({ x: tb.x, z: tb.z, r: 1.1 });
    this._sign('WATCHTOWER VALLEY', 'build towers · hold the horde', tb.x + 2.6, tb.z + 6, Math.PI / 2);
    // supply crates in the valley
    for (const [dx, dz, give] of [[3, 3, { logs: 6, planks: 10, rope: 4 }], [3.5, -9, { logs: 6, planks: 8, rope: 4, stone: 6 }]]) {
      const x = zx1 + dx, z = Z.z + dz, y = H(x, z);
      crate(b, x, y, z, 0.3); this.addCollider({ x, z, r: 0.7 });
      this.crates.push({ pos: new THREE.Vector3(x, y, z), label: 'Open supply crate', give, taken: false });
    }
    // Giant Plateau: boundary stones around the castle ring + workbench + stone crates
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const x = GIANT.x + Math.cos(a) * (GIANT.r + 1.2), z = GIANT.z + Math.sin(a) * (GIANT.r + 1.2), y = H(x, z);
      b.add(new THREE.DodecahedronGeometry(0.35, 0), 0xd8d2c0, x, y + 0.15, z, a, a, 0);
    }
    const cb = this.castleBenchPos = new THREE.Vector3(GIANT.x + 6, 0, GIANT.z - 6); cb.y = H(cb.x, cb.z);
    workbench(b, cb.x, cb.y, cb.z, Math.PI * 0.75, 0x7d7b74); this.addCollider({ x: cb.x, z: cb.z, r: 1.1 });
    this._sign('GIANT PLATEAU', 'build the castle · beware giants', GIANT.x + 22, GIANT.z - 34, Math.PI * 0.82);
    for (const [dx, dz, give] of [[-8, -4, { stone: 16 }], [9, 2, { stone: 16 }], [-3, 9, { stone: 12, logs: 6, planks: 6 }]]) {
      const x = GIANT.x + dx, z = GIANT.z + dz, y = H(x, z);
      crate(b, x, y, z, dx * 0.1); this.addCollider({ x, z, r: 0.7 });
      this.crates.push({ pos: new THREE.Vector3(x, y, z), label: 'Open supply crate (stone)', give, taken: false });
    }
  }
  _sign(title, sub, x, z, a) {
    const y = this.T.heightAt(x, z);
    const tex = canvasTexture(512, 160, (c, w, h) => {
      c.fillStyle = '#5b3a1e'; c.fillRect(0, 0, w, h); c.strokeStyle = '#3a2412'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
      c.fillStyle = '#f2e3b6'; c.textAlign = 'center'; c.font = 'bold 50px Georgia'; c.fillText(title, w / 2, 72);
      c.font = 'bold 26px Arial'; c.fillText(sub, w / 2, 122);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.25), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    m.position.set(x, y + 2.2, z); m.rotation.y = a; this.scene.add(m);
    const b = new GeoBuilder();
    for (const sd of [-1.7, 1.7]) b.cyl(0.1, 0.12, 2.9, 6, Math.cos(a) * sd, 1.45, -Math.sin(a) * sd, 0x6e4a2a);
    const g = b.build(); g.position.set(x, y, z); this.scene.add(g);
    this.addCollider({ x, z, r: 0.5 });
  }

  _clouds() {
    const b = new GeoBuilder();
    for (let i = 0; i < 22; i++) {
      const a = rand(0, Math.PI * 2), r = rand(80, 220), y = rand(90, 130), x = Math.cos(a) * r, z = Math.sin(a) * r + (i >= 14 ? 420 : 0);
      for (let k = 0; k < 4; k++) b.add(new THREE.IcosahedronGeometry(rand(7, 13), 0), 0xffffff, x + rand(-14, 14), y + rand(-2, 3), z + rand(-6, 6), 0, rand(0, 3), 0, 'solid', 1.4, 0.55, 1);
    }
    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false, emissive: 0x9db0c8, emissiveIntensity: 0.5 });
    const g = this.cloudGroup = b.build({ solid: this.cloudMat });    // (Farm World's real weather has its own drifting clouds: js/weather/effects.js)
    g.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    this.scene.add(g);
  }

  _helicopter() {
    const b = new GeoBuilder();
    b.box(1.5, 1.3, 2.6, 0, 0, 0, 0x2e3238);
    b.box(1.4, 1.0, 0.9, 0, 0.05, 1.5, 0x1d2a35, 'glass');
    b.cyl(0.18, 0.32, 4.2, 5, 0, 0.25, -3.2, 0x2e3238, Math.PI / 2, 0, 0);
    b.box(0.08, 1.1, 0.7, 0, 0.75, -5.1, 0x2e3238);
    for (const s of [-0.75, 0.75]) b.box(0.08, 0.08, 2.8, s, -1.05, 0.2, 0x1b1d20);
    this.heli = b.build();
    const rb = new GeoBuilder(); rb.box(9, 0.05, 0.35, 0, 0, 0, 0x16181b); rb.box(0.35, 0.05, 9, 0, 0, 0, 0x16181b);
    this.rotor = rb.build(); this.rotor.position.y = 1.05;
    this.heli.add(this.rotor);
    this.heli.traverse(o => { o.castShadow = false; });
    this.scene.add(this.heli);
  }

  setNight(on, fromNet = false) { this.nightTarget = on ? 1 : 0; if (!fromNet && this.onNightChange) this.onNightChange(this.nightTarget); }
  boostFire(sec) { this.fireBoost = Math.min(180, this.fireBoost + sec); }

  update(dt, focus, camera) {
    this.time += dt;
    if (this.windU) this.windU.uWT.value = this.time;
    // Zombie Trail: the night comes and goes with the campaign (in Farm World DayNight follows the real time)
    if (this.dayNight.mode !== 'real' && Math.abs(this.night - this.nightTarget) > 0.001)
      this.night = clamp(this.night + Math.sign(this.nightTarget - this.night) * dt * 0.8, 0, 1);
    this.dayNight.update(dt, focus, camera);     // sun + shadows, sky, fog, clouds, lamps
    this._fogCull(camera);
    this.fireBoost = Math.max(0, this.fireBoost - dt);
    const big = 1 + 0.9 * Math.min(1, this.fireBoost / 5);
    const f = (1 + Math.sin(this.time * 17) * 0.08 + Math.sin(this.time * 31) * 0.05) * big;
    this.flame.scale.set(f, (1 + Math.sin(this.time * 23) * 0.12) * big, f);
    this.fireLight.intensity = (0.8 + this.night * 7) * f;
    const a = this.time * 0.06;
    this.heli.position.set(Math.cos(a) * 170, 95 + Math.sin(a * 3) * 5, Math.sin(a) * 140);
    this.heli.rotation.set(0, Math.atan2(-Math.sin(a) * 170, Math.cos(a) * 140), 0.18);
    this.rotor.rotation.y += dt * 28;
  }
}

/* ---------------- prop + plant builders ---------------- */
export function crate(b, x, y, z, a) {
  b.group(x, y, z, 0, a, 0, () => {
    b.box(1.1, 0.8, 0.8, 0, 0.4, 0, 0x9a6a3c);
    for (const yy of [0.12, 0.68]) b.box(1.12, 0.08, 0.82, 0, yy, 0, 0x6e4a2a);
    b.box(0.08, 0.82, 0.82, 0, 0.4, 0, 0x6e4a2a);
    b.box(0.9, 0.05, 0.6, 0, 0.83, 0, 0xc9a66b);
  });
}
function workbench(b, x, y, z, a, accent) {
  b.group(x, y, z, 0, a, 0, () => {
    b.box(2.2, 0.12, 1.0, 0, 0.92, 0, 0x9a6a3c);
    for (const [px, pz] of [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]]) b.box(0.1, 0.9, 0.1, px, 0.45, pz, 0x6e4a2a);
    b.box(2.0, 0.06, 0.8, 0, 0.3, 0, 0x7a5230);
    b.box(0.9, 0.02, 0.6, -0.4, 0.99, 0, 0xf2ead2);                 // plans
    b.box(0.4, 0.15, 0.25, 0.7, 1.05, 0.1, accent);                 // tool box
    b.box(0.08, 0.5, 0.08, 0.9, 1.2, -0.3, 0x6e4a2a); b.box(0.3, 0.12, 0.12, 0.9, 1.45, -0.3, 0x55585c);   // hammer
  });
}
function picnicTable(b, x, y, z, ry, world) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.box(1.8, 0.06, 0.8, 0, 0.75, 0, 0x9a6a3c);
    b.box(1.8, 0.05, 0.3, 0, 0.45, 0.65, 0x8a5c33); b.box(1.8, 0.05, 0.3, 0, 0.45, -0.65, 0x8a5c33);
    for (const sx of [-0.7, 0.7]) { b.box(0.07, 0.95, 0.07, sx, 0.4, 0.35, 0x6e4a2a, 'solid', 0.6, 0, 0); b.box(0.07, 0.95, 0.07, sx, 0.4, -0.35, 0x6e4a2a, 'solid', -0.6, 0, 0); }
  });
  world.addCollider({ x, z, r: 1.0 });
}
function grassTuft(b) {
  for (let i = 0; i < 5; i++) b.box(0.08, 0.55, 0.02, Math.cos(i * 1.3) * 0.12, 0.25, Math.sin(i * 1.3) * 0.12, i % 2 ? 0x6aa843 : 0x7cb850, 'solid', (i - 2) * 0.2, i * 1.2, 0);
}
