// The fishing area in the world (Farm World): the Fish Market east of the Market with its fisherman, a
// footpath north through the jungle to the river, and three wooden docks on the river's south bank — each
// one a fishing spot. Fish swim (and now and then jump) around the docks; rings spread on the water.
// Nothing here changes with the game state; the fishing itself is in fishing.js.
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';
import { RIVER_HALF } from '../terrain.js';
import { FISH_MARKET, FISH_SIGN, toWorld, toLocal } from '../farm/layout.js';
import { signboard, wallSign } from '../farm/models.js';
import { C, FARM_MAT, lampPost, barrel, crate } from '../farm/props.js';
import { FarmerNPC } from '../farm/npc.js';
import { flambeau } from '../day-night.js';
import { fishMarketModel, FISH_MARKET_DIM, dockModel, buildFish } from './models.js';

const DOCK_X = [-112, -97, -82];        // roughly where the three docks meet the river (world x)
const DOCK_LEN = 6.5, DOCK_W = 2.4;
const SWIMMERS = 4;                     // fish swimming around each dock
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export class FishingArea {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.on = false;
    this.spots = []; this.t = 0; this.ripples = []; this.drops = null;
  }
  H(x, z) { return this.world.heightAt(x, z); }
  hAt(F, base = this.H(F.x, F.z)) { return (lx, lz) => { const w = toWorld(F, lx, lz); return this.H(w.x, w.z) - base; }; }
  place(obj, F, y = this.H(F.x, F.z)) { obj.position.set(F.x, y, F.z); obj.rotation.y = F.yaw || 0; this.scene.add(obj); return obj; }
  wall(F, x0, z0, x1, z1, r = 0.3, step = r * 1.6) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let i = 0; i <= n; i++) { const w = toWorld(F, x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n); this.world.addCollider({ x: w.x, z: w.z, r }); }
  }
  dot(F, x, z, r) { const w = toWorld(F, x, z); this.world.addCollider({ x: w.x, z: w.z, r }); }

  // first time Farm World is played on this page
  enable() {
    if (this.on) return;
    this.on = true;
    this.W = this.world.T.W;
    this._docks();
    this._market();
    this._path();
    this._water();
  }

  /* ---------- the docks ---------- */
  _docks() {
    const r = this.world.T.river, W = this.W;
    DOCK_X.forEach((tx, i) => {
      let k = 0;
      for (let j = 0; j <= r.n; j++) if (Math.abs(r.x[j] - tx) < Math.abs(r.x[k] - tx)) k = j;
      // the bank toward the farm (south), the dock pointing to the middle of the river
      let nx = r.tz[k], nz = -r.tx[k];
      if (nz > 0) { nx = -nx; nz = -nz; }
      const out = RIVER_HALF + 2.6, ox = r.x[k] + nx * out, oz = r.z[k] + nz * out;
      const F = { x: ox, z: oz, yaw: Math.atan2(-nx, -nz) }, base = this.H(ox, oz);
      const deck = Math.min(W + 1.3, Math.max(W + 0.75, base - 0.03));
      const mesh = dockModel(DOCK_LEN, DOCK_W, deck - base, this.hAt(F, base), i * 3);
      this.place(mesh, F, base);
      // walk on it; rails stop you stepping off its sides and end
      const hw = DOCK_W / 2;
      this.world.surfaces.push({ surfaceAt: (x, z) => { const l = toLocal(F, x, z); return Math.abs(l.x) <= hw + 0.05 && l.z >= -0.4 && l.z <= DOCK_LEN + 0.05 ? deck : null; } });
      this.wall(F, -hw - 0.2, 1.6, -hw - 0.2, DOCK_LEN, 0.22, 0.45); this.wall(F, hw + 0.2, 1.6, hw + 0.2, DOCK_LEN, 0.22, 0.45);
      this.wall(F, -hw, DOCK_LEN + 0.2, hw, DOCK_LEN + 0.2, 0.22, 0.45);
      this.dot(F, hw - 0.45, 0.9, 0.35);
      const stand = toWorld(F, 0, DOCK_LEN - 0.9), water = toWorld(F, 0, DOCK_LEN + 4.6), bank = toWorld(F, 0, -2.2);
      this.spots.push({ i, F, deck, yaw: F.yaw, stand: v3(stand.x, deck, stand.z), water: v3(water.x, W, water.z), bank: v3(bank.x, this.H(bank.x, bank.z), bank.z) });
    });
  }

  /* ---------- the Fish Market ---------- */
  _market() {
    const M = FISH_MARKET, mb = this.H(M.x, M.z), mh = this.hAt(M, mb), W = FISH_MARKET_DIM.w, D = FISH_MARKET_DIM.d;
    let hi = -1e9;
    for (let x = -W / 2; x <= W / 2; x += 1) for (let z = -D / 2; z <= D / 2; z += 1) hi = Math.max(hi, mh(x, z));
    const floor = hi + FISH_MARKET_DIM.floor;
    this.place(fishMarketModel(floor, mh), M, mb);
    const sign = wallSign('FISH MARKET', 'fresh catch · worms · rods', 3.6, 0.9, '', '#1f4a63');
    sign.position.set(0, floor + 3.78, D / 2 + 0.03);
    this.place(new THREE.Group().add(sign), M, mb);
    this.place(signboard('FISH MARKET', 'worms · rods · sell fish', { w: 2.0, h: 0.8, lift: 0.9, bg: '#1f4a63', hAt: this.hAt(FISH_SIGN) }), FISH_SIGN);
    // its floor and walls
    const top = mb + floor;
    this.world.surfaces.push({ surfaceAt: (x, z) => {
      const l = toLocal(M, x, z);
      if (Math.abs(l.x) <= W / 2 && Math.abs(l.z) <= D / 2) return top;
      if (l.x > 2.95 && l.x < 4.85 && l.z > D / 2 && l.z < D / 2 + 1.3) return mb + floor + (mh(l.x, D / 2 + 1.3) - floor) * (l.z - D / 2) / 1.3;   // the steps
      return null;
    } });
    this.wall(M, -W / 2 + 0.2, -D / 2 + 0.25, W / 2 - 0.2, -D / 2 + 0.25, 0.32, 0.5);
    for (const s of [-1, 1]) this.wall(M, s * (W / 2 - 0.15), -D / 2 + 0.2, s * (W / 2 - 0.15), D / 2 - 0.1, 0.3, 0.5);
    this.wall(M, -W / 2 + 0.3, D / 2 - 0.75, 3.1, D / 2 - 0.75, 0.45, 0.6);              // the counter
    for (const [x, z, r] of [[-4.0, -2.2, 0.75], [4.2, -2.2, 0.75], [3.4, -2.7, 0.35], [3.7, 2.6, 0.45], [-2.6, -3.0, 0.4], [2.9, -3.0, 0.4]]) this.dot(M, x, z, r);
    for (const s of [-1, 1]) this.dot(M, s * (W / 2 + 0.6), D / 2 + 1.5, 0.2);
    this.dot(M, -W / 2 - 1.9, -1, 0.9); this.dot(M, -W / 2 - 1.9, 0.5, 0.8); this.dot(M, -W / 2 - 1.9, -2.4, 0.7);
    // the fisherman behind the counter
    const nw = toWorld(M, -0.6, D / 2 - 1.55);
    this.npc = new FarmerNPC(this.scene, { x: nw.x, y: top, z: nw.z, yaw: M.yaw }, {
      colors: { jacket: 0x2f5d7a, jacketLt: 0x3d7091, shirt: 0xd9e6ee, jeans: 0x3b4655, jeansDk: 0x2e3846, belt: 0x2a1a10,
        skin: 0xa86f48, skinDk: 0x8f5c3a, hair: 0x6a5a4a, shoe: 0x2a2a2a, shoeGrey: 0x3a3a3a, sole: 0x1a1a1a, watch: 0x4a4a4a },
      hat: b => {                                          // an olive bucket hat with a fly hook
        b.cyl(0.2, 0.27, 0.06, 12, 0, 0.29, -0.005, 0x6f7a3a);
        b.cyl(0.15, 0.17, 0.14, 12, 0, 0.36, -0.005, 0x7d8844);
        b.cyl(0.152, 0.152, 0.03, 12, 0, 0.32, -0.005, 0x4f5a2a);
        b.box(0.02, 0.05, 0.02, 0.15, 0.36, 0.03, 0xe0302a); b.box(0.015, 0.015, 0.05, 0.15, 0.39, 0.05, 0xf2c14e);
      },
      lines: ['Welcome! Looking for worms or fishing rods?', 'Or do you want to sell your catch?'],
    });
    const front = toWorld(M, -0.6, D / 2 + 1.3), inside = toWorld(M, -0.6, D / 2 - 2.4);
    this.marketSpots = [v3(front.x, this.H(front.x, front.z), front.z), v3(inside.x, top, inside.z)];
    this.marketTop = top;
  }

  /* ---------- the footpath: Fish Market -> river bank, with lamps and signposts ---------- */
  _path() {
    const M = FISH_MARKET, W = FISH_MARKET_DIM.w, s = this.spots;
    const start = toWorld(M, -W / 2 - 1.2, -FISH_MARKET_DIM.d / 2 - 2.5);
    const pts = [[start.x, start.z], [-91.5, -78], [-93, -45], [-95.5, -10], [s[1].bank.x, s[1].bank.z]];
    const branch = [[s[0].bank.x, s[0].bank.z], [s[1].bank.x, s[1].bank.z], [s[2].bank.x, s[2].bank.z]];
    const rects = [], b = new GeoBuilder(), lamps = [];
    // stepping stones every 1.25 m (a lamp every `every` m), and the jungle cleared 3 m around the path
    const lay = (list, every) => {
      let walked = 0, nextLamp = 6;
      for (let i = 0; i < list.length - 1; i++) {
        const [x0, z0] = list[i], [x1, z1] = list[i + 1], len = Math.hypot(x1 - x0, z1 - z0), dir = Math.atan2(x1 - x0, z1 - z0);
        rects.push({ x0: Math.min(x0, x1) - 3, x1: Math.max(x0, x1) + 3, z0: Math.min(z0, z1) - 3, z1: Math.max(z0, z1) + 3 });
        for (let d = 0; d < len; d += 1.25) {
          const k = d / len, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k, j = Math.round((walked + d) * 0.8);
          if (this.world.T.riverDistAt(x, z) < RIVER_HALF + 1.6) continue;
          const side = ((j * 37) % 7 - 3) * 0.07, px = x + side * Math.cos(dir), pz = z - side * Math.sin(dir), yaw = dir + (j % 5) * 0.1;
          // lie on the slope: tilt along and across the path
          const fx = Math.sin(yaw) * 0.5, fz = Math.cos(yaw) * 0.5, H = (u, v) => this.H(px + u, pz + v);
          const pitch = -Math.atan((H(fx, fz) - H(-fx, -fz)) / 1), roll = Math.atan((H(fz, -fx) - H(-fz, fx)) / 1);
          b.group(px, this.H(px, pz) + 0.015, pz, 0, yaw, 0, () => b.box(0.95 + (j % 3) * 0.12, 0.09, 0.7 + (j % 2) * 0.15, 0, 0, 0, [C.stone, C.stoneL, C.stoneD][j % 3], 'solid', pitch, 0, roll));
          if (every && walked + d >= nextLamp) { nextLamp += every; lamps.push([x + 1.5 * Math.cos(dir), z - 1.5 * Math.sin(dir)]); }
        }
        walked += len;
      }
    };
    lay(pts, 24); lay(branch, 0);
    // torches where the path leaves the Fish Market, and by the Fish Market's sign at the road
    const [sx, sz] = pts[0], ln = Math.hypot(pts[1][0] - sx, pts[1][1] - sz), ax = (pts[1][0] - sx) / ln, az = (pts[1][1] - sz) / ln;
    const torch = (x, z) => { flambeau(b, x, this.H(x, z), z); this.world.addCollider({ x, z, r: 0.2 }); };
    for (const sd of [-1, 1]) torch(sx + ax * 1.2 + az * 1.8 * sd, sz + az * 1.2 - ax * 1.8 * sd);
    for (const lx of [-2.2, 2.2]) { const w = toWorld(FISH_SIGN, lx, 0); torch(w.x, w.z); }
    for (const [x, z] of lamps) { lampPost(b, x, this.H(x, z), z, Math.PI); this.world.addCollider({ x, z, r: 0.2 }); }
    // barrels and crates at the bank; reeds and rocks between the docks
    for (const sp of s) {
      const F = sp.F, h = this.hAt(F, 0);
      b.group(F.x, 0, F.z, 0, F.yaw, 0, () => {
        barrel(b, -2.3, h(-2.3, -0.4), -0.4, C.woodD); crate(b, 2.2, h(2.2, -0.9), -0.9, 0.55, C.woodL, 0.3);
        for (let k = 0; k < 14; k++) {
          const x = (k % 2 ? 1 : -1) * (2.0 + (k * 0.37) % 2.2), z = 0.4 + (k * 0.53) % 2.4;
          const g = h(x, z), tall = 0.7 + (k % 4) * 0.22;
          b.box(0.04, tall, 0.04, x, g + tall / 2, z, k % 3 ? 0x5f8a3a : 0x7a9a46, 'solid', (k % 3 - 1) * 0.15, 0, (k % 2 - 0.5) * 0.25);
          if (k % 3 === 0) b.box(0.06, 0.18, 0.06, x + 0.02, g + tall + 0.05, z, 0x6a4a2a);
        }
        for (let k = 0; k < 4; k++) { const x = (k % 2 ? 1 : -1) * (3.4 + k * 0.3), z = 1.2 + k * 0.7; b.add(new THREE.DodecahedronGeometry(0.35 + (k % 2) * 0.15, 0), [C.stone, C.stoneD][k % 2], x, h(x, z) + 0.12, z, k, k * 0.5, 0); }
      });
    }
    this.scene.add(b.build(FARM_MAT));
    // signposts: by the Fish Market and at the bank
    const sw = toWorld(M, -W / 2 - 1.4, -FISH_MARKET_DIM.d / 2 - 1.2);
    this.place(signboard('FISHING DOCKS', '↑ follow the path to the river', { w: 1.9, h: 0.72, lift: 0.85, bg: '#1f4a63', hAt: this.hAt({ x: sw.x, z: sw.z, yaw: Math.PI }) }), { x: sw.x, z: sw.z, yaw: Math.PI });
    const bw = s[1].bank, back = { x: bw.x - 2.6, z: bw.z - 2.2, yaw: s[1].yaw + Math.PI };
    this.place(signboard('FISH MARKET', '↓ worms · rods · sell your catch', { w: 1.9, h: 0.72, lift: 0.85, bg: '#1f4a63', hAt: this.hAt(back) }), back);
    this.world.clearArea(rects.concat(s.map(sp => ({ x0: sp.F.x - 6, x1: sp.F.x + 6, z0: sp.F.z - 6, z1: sp.F.z + 6 }))));
    const segs = [];
    for (const list of [pts, branch]) for (let i = 0; i < list.length - 1; i++) segs.push([...list[i], ...list[i + 1]]);
    const segD = (x, z, [ax, az, bx, bz]) => { const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1))); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
    this.world.addGrassBlock((x, z) => Math.hypot(x - M.x, z - M.z) < 9 || segs.some(g => segD(x, z, g) < 1.5) || s.some(sp => Math.hypot(x - sp.bank.x, z - sp.bank.z) < 3.2));
  }

  /* ---------- water life: swimming fish, jumps, rings and drops ---------- */
  _water() {
    const fb = new GeoBuilder(); buildFish(fb, 'fish_medium');
    const fishGeo = fb.build(FARM_MAT).children[0].geometry;
    this.swim = new THREE.InstancedMesh(fishGeo, FARM_MAT.solid, this.spots.length * SWIMMERS);
    this.swim.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.swim.frustumCulled = false;
    this.scene.add(this.swim);
    this.fish = [];
    this.spots.forEach((sp, i) => { for (let k = 0; k < SWIMMERS; k++) this.fish.push({ sp, r: 1.6 + k * 0.7, w: (k % 2 ? 1 : -1) * (0.35 + k * 0.07), a: i * 2 + k * 1.7, s: 0.7 + (k % 3) * 0.25, jump: -1, next: 4 + ((i * 5 + k * 3) % 9) }); });
    const ringGeo = new THREE.RingGeometry(0.82, 1, 28);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 2;
      this.scene.add(m); this.ripples.push({ m, t: 1, life: 1.4, size: 1 });
    }
    const N = 48, pos = new Float32Array(N * 3).fill(-999);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.drops = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xf4fbff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }));
    this.drops.frustumCulled = false; this.scene.add(this.drops);
    this.dropV = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, life: 0 })); this.dropI = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }
  ripple(x, z, size = 1, life = 1.4) {
    const r = this.ripples.reduce((a, b) => (b.t > a.t ? b : a));
    r.t = 0; r.life = life; r.size = size; r.m.position.set(x, this.W + 0.03, z); r.m.visible = true;
  }
  splash(x, z, n = 10, power = 1) {
    const pos = this.drops.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      const d = this.dropV[this.dropI], j = this.dropI; this.dropI = (this.dropI + 1) % this.dropV.length;
      const a = Math.random() * 6.28, s = (0.6 + Math.random()) * power;
      d.x = Math.cos(a) * s; d.z = Math.sin(a) * s; d.y = (2 + Math.random() * 2) * power; d.life = 1.2;
      pos.setXYZ(j, x, this.W + 0.05, z);
    }
    pos.needsUpdate = true;
    this.ripple(x, z, 0.9 * power, 1.2); this.ripple(x, z, 1.5 * power, 1.8);
  }
  // p: the local player (to show the fisherman's greeting)
  update(dt, p) {
    if (!this.on) return;
    this.t += dt;
    if (this.npc) this.npc.update(dt, p);
    const W = this.W;
    // fish swim in circles in front of each dock; now and then one jumps
    this.fish.forEach((f, i) => {
      f.a += f.w * f.s * dt;
      const c = f.sp.water, x = c.x + Math.cos(f.a) * f.r, z = c.z + Math.sin(f.a) * f.r * 0.7;
      let y = W - 0.13, pitch = 0;
      f.next -= dt;
      if (f.jump < 0 && f.next <= 0) { f.jump = 0; this.splash(x, z, 6, 0.6); this.onJump && this.onJump(x, z, false); }
      if (f.jump >= 0) {
        f.jump += dt / 0.8;
        y = W - 0.1 + Math.sin(Math.min(1, f.jump) * Math.PI) * 0.75; pitch = (0.5 - f.jump) * 2.2;
        if (f.jump >= 1) { f.jump = -1; f.next = 7 + Math.random() * 10; this.splash(x, z, 8, 0.7); this.onJump && this.onJump(x, z, true); }
      }
      const yaw = Math.atan2(-Math.sin(f.a) * f.w, Math.cos(f.a) * 0.7 * f.w);
      this._e.set(pitch, yaw, 0); this._q.setFromEuler(this._e);
      this.swim.setMatrixAt(i, this._m.compose(this._p.set(x, y, z), this._q, this._s));
    });
    this.swim.instanceMatrix.needsUpdate = true;
    // a calm ring now and then near each dock
    if (Math.random() < dt * 0.9) { const sp = this.spots[Math.floor(Math.random() * this.spots.length)], a = Math.random() * 6.28; this.ripple(sp.water.x + Math.cos(a) * 2.5, sp.water.z + Math.sin(a) * 2, 0.6, 2.2); }
    for (const r of this.ripples) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.life);
      const s = (0.15 + r.t * 1.2) * r.size;
      r.m.scale.set(s, s, s); r.m.material.opacity = 0.55 * (1 - r.t);
      if (r.t >= 1) r.m.visible = false;
    }
    const pos = this.drops.geometry.attributes.position;
    let live = false;
    for (let i = 0; i < this.dropV.length; i++) {
      const d = this.dropV[i];
      if (d.life <= 0) continue;
      live = true; d.life -= dt; d.y -= 9.8 * dt;
      const y = pos.getY(i) + d.y * dt;
      if (y < W || d.life <= 0) { d.life = 0; pos.setXYZ(i, 0, -999, 0); continue; }
      pos.setXYZ(i, pos.getX(i) + d.x * dt, y, pos.getZ(i) + d.z * dt);
    }
    if (live || this._live) pos.needsUpdate = true;
    this._live = live;
  }
}
