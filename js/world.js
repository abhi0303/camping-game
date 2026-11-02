import * as THREE from 'three';
import { GeoBuilder, MAT, rand, srand, clamp, lerp, canvasTexture } from './utils.js';
import { buildTerrain, X0, Z0, SX, SZ, START, CAMP, BRIDGE, RIVER_HALF, NORTH, VALLEY, TOWER_ZONE, GIANT } from './terrain.js';

const GC = 10, GNX = Math.ceil(SX / GC), GNZ = Math.ceil(SZ / GC);   // collision grid (10 m cells)
const CHX = 3, CHZ = 6;                                             // vegetation chunks (frustum culling)

export class World {
  constructor(scene, opts = {}) {
    this.scene = scene; this.lite = !!opts.lite; this.onNightChange = null;
    this.bounds = { minX: -232, maxX: 232, minZ: -232, maxZ: 712 };
    this.grid = Array.from({ length: GNX * GNZ }, () => []);
    this.surfaces = [];          // extra walkable tops (towers, castle walls): { surfaceAt(x, z, y) -> height | null }
    this.night = 0; this.nightTarget = 0; this.time = 0; this.fireBoost = 0;
    this.bridge = null;          // set by main (BridgeWorld)
    this.crates = [];            // supply crates {pos, label, give, taken}
    srand(4242);

    this._lights();
    this._sky();
    const T = this.T = buildTerrain();
    this.W = T.W;
    scene.add(T.mesh, T.roadMesh, T.waterMesh);
    this._vegetation();
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
  // Push a world-space point out of nearby colliders
  collide(p, radius) {
    this.forNear(p.x, p.z, c => {
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
    this.sunOffset = new THREE.Vector3(34, 60, 20);
    this.scene.add(sun); this.scene.add(sun.target);
  }
  _sky() {
    const g = new THREE.SphereGeometry(500, 16, 10);
    const pos = g.attributes.position, col = [];
    const top = new THREE.Color(0x4a8fd6), hor = new THREE.Color(0xd3e6f0), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) { c.copy(hor).lerp(top, Math.pow(clamp(pos.getY(i) / 500, 0, 1), 0.6)); col.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.dome = new THREE.Mesh(g, this.skyMat); this.dome.renderOrder = -1;
    this.scene.add(this.dome);
  }

  /* ---------------- vegetation (instanced, chunked) ---------------- */
  _vegetation() {
    const geo = fn => { const b = new GeoBuilder(); fn(b); return b.build().children[0].geometry; };
    const types = {
      jungle: { geo: geo(jungleTree), n: 430, shadow: true, r: 0.55, tree: true, near: 7.5 },
      tall: { geo: geo(tallTree), n: 70, shadow: true, r: 0.7, tree: true, near: 9 },
      palm: { geo: geo(palmTree), n: 130, shadow: true, r: 0.4, tree: true, near: 7.5, river: true },
      fern: { geo: geo(fern), n: 800, shadow: false, near: 5.2, small: true },
      bush: { geo: geo(bush), n: 260, shadow: false, near: 5.6, small: true },
      rock: { geo: geo(rock), n: 110, shadow: true, near: 6, rock: true },
      // highlands (north of the ridge)
      pine: { geo: geo(pineTree), n: 420, shadow: true, r: 0.5, tree: true, near: 7.5, north: true },
      pine2: { geo: geo(pineTall), n: 90, shadow: true, r: 0.6, tree: true, near: 9, north: true },
      hbush: { geo: geo(bush), n: 160, shadow: false, near: 5.6, small: true, north: true },
      tuft: { geo: geo(grassTuft), n: 420, shadow: false, near: 4.8, small: true, north: true },
      hrock: { geo: geo(rock), n: 170, shadow: true, near: 6, rock: true, north: true },
    };
    if (this.lite) for (const k in types) types[k].n = Math.round(types[k].n * 0.55);   // phones: lighter jungle
    const T = this.T, m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const key in types) {
      const t = types[key], chunks = Array.from({ length: CHX * CHZ }, () => []);
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
        p.set(x, T.heightAt(x, z) - 0.1, z); q.setFromAxisAngle(up, rand(0, Math.PI * 2)); s.set(sc, sc * (t.small ? rand(0.8, 1.2) : 1), sc);
        const ci = clamp(Math.floor((x - X0) / (SX / CHX)), 0, CHX - 1) + CHX * clamp(Math.floor((z - Z0) / (SZ / CHZ)), 0, CHZ - 1);
        chunks[ci].push(m.compose(p, q, s).clone());
        if (t.r) this.addCollider({ x, z, r: t.r * sc, tree: !!t.tree });
        else if (t.rock && sc > 0.9) this.addCollider({ x, z, r: 0.9 * sc, rock: true });
        placed++;
      }
      for (const list of chunks) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(t.geo, MAT.solid, list.length);
        list.forEach((mm, i) => im.setMatrixAt(i, mm));
        im.castShadow = t.shadow; im.receiveShadow = !t.shadow;
        im.computeBoundingSphere();
        this.scene.add(im);
        (this.vegMeshes || (this.vegMeshes = [])).push(im);
      }
    }
  }

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
    for (const cell of this.grid) for (let i = cell.length - 1; i >= 0; i--) { const c = cell[i]; if ((c.tree || c.rock) && inside(c.x, c.z)) cell.splice(i, 1); }
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
      b.box(0.25, 0.18, 0.2, 0.6, 2.45, 1.7, 0xfff4d6, 'lamp');
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
    const g = b.build({ solid: this.cloudMat });
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
    if (Math.abs(this.night - this.nightTarget) > 0.001) {
      this.night = clamp(this.night + Math.sign(this.nightTarget - this.night) * dt * 0.8, 0, 1);
      const n = this.night;
      this.scene.background.copy(this.skyDay).lerp(this.skyNight, n);
      this.scene.fog.color.copy(this.scene.background);
      this.sun.intensity = lerp(2.3, 0.1, n);
      this.hemi.intensity = lerp(1.5, 0.32, n);
      this.hemi.color.setHex(n > 0.5 ? 0x8fa6d8 : 0xd6e8ff);
      this.skyMat.color.setRGB(lerp(1, 0.1, n), lerp(1, 0.13, n), lerp(1, 0.25, n));
      this.cloudMat.emissiveIntensity = lerp(0.5, 0.03, n);
      MAT.lamp.emissiveIntensity = n * 1.6;
    }
    this.sun.position.copy(focus).add(this.sunOffset);
    this.sun.target.position.copy(focus);
    this.dome.position.copy(camera.position);
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
function jungleTree(b) {
  b.cyl(0.26, 0.42, 9, 6, 0, 4.5, 0, 0x6b5a45);
  for (let i = 0; i < 3; i++) { const a = i * 2.1; b.box(0.22, 0.9, 1.0, Math.cos(a) * 0.38, 0.4, Math.sin(a) * 0.38, 0x5e4f3c, 'solid', 0, -a, 0.35); }
  b.add(new THREE.IcosahedronGeometry(3.0, 0), 0x2f6b2c, 0, 9.4, 0, 0, 0, 0, 'solid', 1.35, 0.7, 1.35);
  b.add(new THREE.IcosahedronGeometry(2.4, 0), 0x3b7a33, 1.3, 10.5, 0.6, 0.4, 0.2, 0, 'solid', 1.2, 0.75, 1.2);
  b.add(new THREE.IcosahedronGeometry(2.1, 0), 0x2a5e28, -1.1, 10.1, -0.9, 0.2, 0.7, 0, 'solid', 1.2, 0.7, 1.2);
  b.box(0.06, 3.4, 0.06, 1.6, 7.0, 0.5, 0x2d5a26); b.box(0.06, 2.6, 0.06, -1.3, 7.6, -0.9, 0x2d5a26); b.box(0.05, 3.0, 0.05, 0.2, 7.2, 1.7, 0x335f2a);
}
function tallTree(b) {
  b.cyl(0.32, 0.55, 15, 6, 0, 7.5, 0, 0x8a8172);
  b.add(new THREE.IcosahedronGeometry(4.4, 0), 0x356f2e, 0, 15.4, 0, 0, 0.3, 0, 'solid', 1.3, 0.45, 1.3);
  b.add(new THREE.IcosahedronGeometry(2.8, 0), 0x2c6127, 1.5, 16.3, -1.0, 0.3, 0, 0, 'solid', 1.2, 0.5, 1.2);
}
function palmTree(b) {
  let px = 0, py = 0;
  for (let i = 0; i < 5; i++) {
    const sh = 1.5, t = i / 5, ox = 0.12 * (1 + t);
    b.cyl(0.2 * (1 - t * 0.35), 0.24 * (1 - t * 0.3), sh * 1.04, 6, px + ox / 2, py + sh / 2, 0, i % 2 ? 0x8a6a45 : 0x7a5c3b, 0, 0, -ox * 0.15);
    px += ox; py += sh;
  }
  const cols = [0x3f8f3a, 0x4fa043, 0x35802f];
  for (let i = 0; i < 8; i++) b.group(px, py, 0, 0, -(i / 8) * Math.PI * 2, 0, () => b.box(0.9, 0.08, 3.2, 0, -0.35, 1.4, cols[i % 3], 'solid', 0.45, 0, 0));
  b.add(new THREE.IcosahedronGeometry(0.45, 0), 0x6b4b2e, px, py - 0.2, 0);
}
function fern(b) {
  for (let i = 0; i < 7; i++) b.group(0, 0.15, 0, 0, (i / 7) * Math.PI * 2, 0, () => b.box(0.32, 0.03, 1.3, 0, 0.25, 0.55, i % 2 ? 0x3f8a36 : 0x4a9a3e, 'solid', -0.5, 0, 0));
}
function bush(b) {
  b.add(new THREE.IcosahedronGeometry(0.9, 0), 0x3c7d34, 0, 0.55, 0, 0, 0, 0, 'solid', 1, 0.75, 1);
  b.add(new THREE.IcosahedronGeometry(0.6, 0), 0x4a8c3c, 0.6, 0.45, 0.3, 0.5, 0, 0);
}
function rock(b) { b.add(new THREE.DodecahedronGeometry(1, 0), 0x7d7b74, 0, 0.35, 0, 0.3, 0.5, 0, 'solid', 1.2, 0.75, 1); }
function pineTree(b) {
  b.cyl(0.2, 0.3, 3, 6, 0, 1.5, 0, 0x6a4a2e);
  b.add(new THREE.ConeGeometry(2.4, 3.4, 7), 0x2f6b3a, 0, 3.6, 0);
  b.add(new THREE.ConeGeometry(1.9, 3.0, 7), 0x377a42, 0, 5.4, 0, 0, 0.4, 0);
  b.add(new THREE.ConeGeometry(1.3, 2.6, 7), 0x3f8649, 0, 7.1, 0, 0, 0.8, 0);
}
function pineTall(b) {
  b.cyl(0.26, 0.4, 5, 6, 0, 2.5, 0, 0x5e4128);
  for (let i = 0; i < 4; i++) b.add(new THREE.ConeGeometry(3.0 - i * 0.6, 3.6, 7), i % 2 ? 0x2c6436 : 0x34723f, 0, 5 + i * 2.2, 0, 0, i * 0.5, 0);
}
function grassTuft(b) {
  for (let i = 0; i < 5; i++) b.box(0.08, 0.55, 0.02, Math.cos(i * 1.3) * 0.12, 0.25, Math.sin(i * 1.3) * 0.12, i % 2 ? 0x6aa843 : 0x7cb850, 'solid', (i - 2) * 0.2, i * 1.2, 0);
}
