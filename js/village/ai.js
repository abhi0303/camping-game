// Sonpur's villagers: 26 people (12 adults, 6 old people, 8 children) who live in the village's houses and go
// about their day. Each has a home, a role (farmer, animal keeper, woodcutter, water carrier, housework, the
// fruit seller), favourite things to do, a walking speed and a look of their own.
// How it works:
//   - Places: the waypoint graph (navigation.js) and the spots where things are done — garden beds, pens, the
//     well, wood piles, hearths, clotheslines, haystacks, the stall, benches, charpais (rope cots put outside
//     some houses), a football green with goals (found on open, flat ground), places for children's games.
//   - A whole day for everybody is planned at once from the day number (IST): the shared events first
//     (interactions.js: chats, bench talks, football, games), then everyone's own activities in time order, each
//     picked from the time of day and their preferences (schedule.js), at a free spot (nobody takes a spot
//     someone else is using), cut short to be in time for the next shared event, lunch or bed.
//   - Each frame, every villager's place and pose come from that plan and the shared clock alone, so all the
//     players see the same village without sending anything. Only small things are local: stepping aside for
//     players and each other, turning the head toward a player close by, the smoothing of turns and poses.
//   - Far from the village nothing is updated; the further away, the less often poses are worked out.
import * as THREE from 'three';
import { MAT, GeoBuilder } from '../utils.js';
import { bubbleTexture } from '../farm/npc.js';
import { bench } from '../farm/props.js';
import { charpai, goal, football, lantern } from './props.js';
import { Crowd, SKEL, makeLook, pivots, ITEM, CARRY, FLAG, HAT, HAIR } from './characters.js';
import { Animator, targetPose, stepLength } from './animations.js';
import { Nav, along, dist2 } from './navigation.js';
import { DAY, H, istClock, rng, dayTimes, weights, DURATION, ELDER_SIT, SPEED } from './schedule.js';
import { planDay, simulateFootball, playAt, ballAt, moveAt, chasePos, PITCH, PARK } from './interactions.js';
import { LANES, SQUARE, BOUNDS, inClear, laneDist } from './layout.js';
import { PEN_SIZE } from './animals.js';

const TAU = Math.PI * 2, ACC = 0.45;
const SEATED = new Set(['sit', 'drink', 'talkSit', 'watchSit', 'sitGround', 'clap']);
const STEP_TURN = new Set(['stand', 'look', 'wait', 'talk', 'water', 'feed', 'shop', 'pull', 'watch', 'pour']);
const at = (F, lx, lz) => { const c = Math.cos(F.yaw), s = Math.sin(F.yaw); return [F.x + lx * c + lz * s, F.z - lx * s + lz * c]; };
const toLocal = (F, x, z) => { const c = Math.cos(F.yaw), s = Math.sin(F.yaw), dx = x - F.x, dz = z - F.z; return [dx * c - dz * s, dx * s + dz * c]; };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (a, b, rate, dt) => a + wrap(b - a) * (1 - Math.exp(-rate * dt));
const sm = k => k * k * (3 - 2 * k);
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// who lives in the village
const ADULTS = [['m', 'keeper'], ['f', 'keeper'], ['m', 'farmer'], ['f', 'farmer'], ['m', 'wood'], ['m', 'farmer'], ['f', 'water'], ['m', 'vendor'], ['f', 'home'], ['m', 'wood'], ['f', 'home'], ['f', 'home']];
const PREFS = {
  farmer: { garden: 2.6, hay: 1.4, animals: 1.1 }, keeper: { animals: 3.2, hay: 1.6, garden: 0.8 }, wood: { wood: 3, hay: 1.3, stroll: 1.2 },
  water: { well: 3, line: 1.6, cook: 1.4, sweep: 1.2 }, home: { sweep: 2, line: 2, cook: 2.2, shop: 1.6, garden: 0.9 }, vendor: { shop: 0, visit: 1.4, sit: 1.3 },
  watch: { sit: 1.7, visit: 1.4, stroll: 1.2, garden: 0.5, wood: 0.4, animals: 0.4, sweep: 0, line: 0, cook: 0, well: 0.5 },
};
const STALL_HOURS = [[H(8.25), H(12)], [H(15), H(18.5)]];
const PATROL_V = 0.8;                       // the night watchman's pace (m/s)
const IST_S = 19800;
// rotations of a point p about o (the same as the villager shader's joints)
const rotX = (p, o, a) => { const c = Math.cos(a), s = Math.sin(a), y = p[1] - o[1], z = p[2] - o[2]; p[1] = o[1] + c * y - s * z; p[2] = o[2] + s * y + c * z; };
const rotY = (p, o, a) => { const c = Math.cos(a), s = Math.sin(a), x = p[0] - o[0], z = p[2] - o[2]; p[0] = o[0] + c * x + s * z; p[2] = o[2] - s * x + c * z; };
const rotZ = (p, o, a) => { const c = Math.cos(a), s = Math.sin(a), x = p[0] - o[0], y = p[1] - o[1]; p[0] = o[0] + c * x - s * y; p[1] = o[1] + s * x + c * y; };

export class Villagers {
  constructor(village) { this.V = village; this.W = village.world; this.T = village.world.T; this.extra = []; this.day = null; this.visible = true; this.frame = 0; }

  /* ================= setting up (while the village is built) ================= */
  // chunk(x, z) -> the GeoBuilder for that part of the village (the goals, benches and charpais go in there)
  prepare(chunk) {
    const V = this.V;
    this.houses = V.houses.map((H, i) => this._house(H, i));
    this.pens = V.pens.map(P => ({ ...P, c: Math.cos(P.yaw), s: Math.sin(P.yaw) }));
    this.nav = new Nav((x, z, ign) => this._blocked(x, z, ign));
    this.seatDefs = [];
    this._lanes(); this._squareRing(); this._houseNodes();
    this._grid(); this._field(chunk); this._playAreas(); this._charpais(chunk);
    this._spots();
    this.nav.finish();
    this._prune();
    this._roster();
    this._patrolRoute();
  }
  _house(Hs, i) {
    const S = Hs.spec, round = S.shape === 'round', d2 = round ? S.r : S.d / 2, pd = S.porch ? S.porch.d : 0, g = Hs.garden;
    return { Hs, i, x: Hs.x, z: Hs.z, yaw: Hs.yaw, c: Math.cos(Hs.yaw), s: Math.sin(Hs.yaw), spec: S, round, d2, pd, base: Hs.base, doorZ: d2 + pd + 0.9, g, hall: i === 0,
      gbox: g ? { x0: -g.half - 0.15, x1: g.half + 0.15, z0: g.zA - 0.55, z1: g.zB + 0.12 } : null, pen: this.V.pens.find(P => P.house === Hs) || null };
  }
  // is (x, z) inside a house (with its porch and side room), a garden (unless it's `ign`'s), a pen or by a prop?
  _blocked(x, z, ign, noTrees) {
    for (const h of this.houses) {
      const dx = x - h.x, dz = z - h.z;
      if (dx * dx + dz * dz > 484) continue;
      const lx = dx * h.c - dz * h.s, lz = dx * h.s + dz * h.c, S = h.spec;
      if (h.round) { if (lx * lx + lz * lz < (S.r + 0.4) ** 2) return true; }
      else {
        if (Math.abs(lx) < S.w / 2 + 0.38 && Math.abs(lz) < S.d / 2 + 0.38) return true;
        if (S.porch && Math.abs(lx) < Math.min(S.porch.w, S.w) / 2 + 0.25 && lz > 0 && lz < S.d / 2 + S.porch.d + 0.3) return true;
        if (S.annex) { const A = S.annex, ax = A.side * (S.w / 2 + A.w / 2), az = -S.d / 2 + A.d / 2 + 0.2; if (Math.abs(lx - ax) < A.w / 2 + 0.38 && Math.abs(lz - az) < A.d / 2 + 0.38) return true; }
      }
      const G = h.gbox;
      if (G && h !== ign && lx > G.x0 && lx < G.x1 && lz > G.z0 && lz < G.z1) return true;
    }
    for (const P of this.pens) {
      const dx = x - P.x, dz = z - P.z;
      if (dx * dx + dz * dz > 64) continue;
      const lx = dx * P.c - dz * P.s, lz = dx * P.s + dz * P.c;
      if (Math.abs(lx) < PEN_SIZE.hw + 0.35 && lz > PEN_SIZE.z0 - 0.35 && lz < PEN_SIZE.z1 + 0.35) return true;
    }
    let hit = false;
    this.W.forNear(x, z, c => {
      if (hit || c.house || c.npc || ((c.tree || c.rock) && !c.village) || (noTrees && c.tree)) return;
      const dx = x - c.x, dz = z - c.z, r = c.r + 0.27;
      if (dx * dx + dz * dz < r * r) hit = true;
    });
    return hit;
  }
  // waypoints every few metres along every lane; lane ends join the lane they meet
  _lanes() {
    const nav = this.nav, ends = [];
    for (const L of LANES) {
      const ids = [];
      for (let i = 0; i < L.pts.length - 1; i++) {
        const [ax, az] = L.pts[i], [bx, bz] = L.pts[i + 1], n = Math.max(1, Math.ceil(dist2(ax, az, bx, bz) / 4));
        for (let k = i === 0 ? 0 : 1; k <= n; k++) ids.push(this._laneNode(ax + (bx - ax) * k / n, az + (bz - az) * k / n, L));
      }
      for (let i = 0; i < ids.length - 1; i++) nav.link(ids[i], ids[i + 1]);
      ends.push([L, ids[0]], [L, ids[ids.length - 1]]);
    }
    for (const [L, e] of ends) {
      const N = nav.nodes[e];
      let best = -1, bd = 4.5;
      for (const M of nav.nodes) if (M.lane && M.laneId !== L.id && !nav.adj[e].includes(M.id)) { const d = dist2(N.x, N.z, M.x, M.z); if (d < bd) { bd = d; best = M.id; } }
      if (best >= 0) nav.link(e, best);
    }
  }
  _laneNode(x, z, L) {
    for (const M of this.nav.nodes) if (M.lane && dist2(x, z, M.x, M.z) < 1.0) return M.id;
    return this.nav.node(x, z, { lane: true, laneId: L.id, w: L.w });
  }
  // a ring of waypoints round the square (between the benches and the lamps)
  _squareRing() {
    const Q = SQUARE, nav = this.nav, ids = [];
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU, x = Q.x + Math.cos(a) * 6.0, z = Q.z + Math.sin(a) * 6.0; ids.push(this._blocked(x, z) ? -1 : nav.node(x, z, { square: true })); }
    for (let k = 0; k < 12; k++) { const a = ids[k], b = ids[(k + 1) % 12]; if (a >= 0 && b >= 0 && nav.clear(nav.nodes[a].x, nav.nodes[a].z, nav.nodes[b].x, nav.nodes[b].z)) nav.link(a, b); }
    this.ring = ids.filter(i => i >= 0);
    for (const id of this.ring) nav._attach(id, { only: M => M.lane, max: 7 });
    // lanes that start on the paved square join it there (whatever stands on the square's edge)
    for (const N of nav.nodes) if (N.lane && dist2(N.x, N.z, Q.x, Q.z) < Q.r + 1.2) {
      const near = this.ring.map(id => [dist2(N.x, N.z, nav.nodes[id].x, nav.nodes[id].z), id]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, id] of near.slice(0, 2)) nav.link(N.id, id);
    }
  }
  // each house: its doorstep, the door, the garden path and the gate on the lane
  _houseNodes() {
    const nav = this.nav;
    for (const h of this.houses) {
      const g = h.g, [dx, dz] = at(h, 0, h.doorZ);
      h.D = nav.node(dx, dz, { door: h.i });
      h.I = at(h, 0, h.d2 + 0.25);
      const gz = g ? g.zB + 0.55 : h.doorZ + 1.4, [gx, gzw] = at(h, 0, gz);
      h.G = nav.node(gx, gzw, { gate: h.i });
      if (g && g.zB - h.doorZ > 1.6) { const [mx, mz] = at(h, 0, (h.doorZ + g.zB) / 2); h.M = nav.node(mx, mz, {}); nav.link(h.D, h.M); nav.link(h.M, h.G); }
      else { h.M = h.D; nav.link(h.D, h.G); }
      if (!nav._attach(h.G, { ignore: h, only: M => M.lane || M.square, max: 9 })) nav._attach(h.G, { ignore: h, max: 16 });
    }
  }
  // a 1 m grid of the village: free open ground (not a house, garden, pen, prop, lane, square, road or river)
  _grid() {
    const B = BOUNDS, nx = Math.ceil(B.x1 - B.x0), nz = Math.ceil(B.z1 - B.z0), T = this.T;
    this.gn = [nx, nz]; this.occ = new Uint8Array(nx * nz); this.hg = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = B.x0 + i + 0.5, z = B.z0 + j + 0.5, k = j * nx + i;
      this.hg[k] = T.heightAt(x, z);
      this.occ[k] = !inClear(x, z) || T.roadDistAt(x, z) < 6.5 || T.riverDistAt(x, z) < 10 || laneDist(x, z).d < 0.4 || dist2(x, z, SQUARE.x, SQUARE.z) < SQUARE.r + 1 || this._blocked(x, z, null, true) ? 1 : this._blocked(x, z) ? 2 : 0;
    }
  }
  _cellOf(x, z) { const i = Math.floor(x - BOUNDS.x0), j = Math.floor(z - BOUNDS.z0); return i < 0 || j < 0 || i >= this.gn[0] || j >= this.gn[1] ? -1 : j * this.gn[0] + i; }
  _open(x, z, trees) { const k = this._cellOf(x, z); return k >= 0 && (!this.occ[k] || (trees && this.occ[k] === 2)); }
  _stamp(F, hw, hd) { for (let lx = -hw; lx <= hw + 0.01; lx += 0.5) for (let lz = -hd; lz <= hd + 0.01; lz += 0.5) { const [x, z] = at(F, lx, lz), k = this._cellOf(x, z); if (k >= 0) this.occ[k] = 1; } }
  // the football green: the flattest open rectangle near the square, with goals and a bench or two beside it
  _field(chunk) {
    const { HL, HW, GOAL } = PITCH, T = this.T;
    let best = null;
    const search = (pl, pw) => {
      for (let cz = BOUNDS.z0 + 6; cz < BOUNDS.z1 - 6; cz += 2) for (let cx = BOUNDS.x0 + 6; cx < BOUNDS.x1 - 6; cx += 2) for (let a = 0; a < 8; a++) {
        const F = { x: cx, z: cz, yaw: a * Math.PI / 8 };
        let ok = true, lo = 1e9, hi = -1e9, trees = 0;
        for (let lx = -HL - pl; lx <= HL + pl + 0.01 && ok; lx += 1.25) for (let lz = -HW - pw; lz <= HW + pw + 0.01; lz += 1.25) {
          const [x, z] = at(F, lx, lz);
          if (!this._open(x, z, true)) { ok = false; break; }
          const k = this._cellOf(x, z), h = this.hg[k]; if (h < lo) lo = h; if (h > hi) hi = h;
          if (this.occ[k] === 2) trees++;
        }
        if (!ok || hi - lo > 1.7) continue;
        const score = (hi - lo) * 5 + dist2(cx, cz, SQUARE.x, SQUARE.z) * 0.05 + trees * 0.4;
        if (!best || score < best.score) best = { ...F, score };
      }
    };
    search(0.8, 1.7);
    if (!best) search(0.5, 0.8);
    if (!best) return;
    const F = this.field = { x: best.x, z: best.z, yaw: best.yaw };
    F.at = (lx, lz) => at(F, lx, lz);
    // the village trees standing on the green are taken out (before the trees are drawn)
    const onIt = (x, z) => { const [lx, lz] = toLocal(F, x, z); return Math.abs(lx) < HL + 2.6 && Math.abs(lz) < HW + 3.2; };
    for (const k in this.V.trees) this.V.trees[k] = this.V.trees[k].filter(t => !onIt(t[0], t[2]));
    const gone = [];
    for (let lx = -HL - 4; lx <= HL + 4; lx += 3) for (let lz = -HW - 4; lz <= HW + 4; lz += 3) { const [x, z] = at(F, lx, lz); this.W.forNear(x, z, c => { if (c.tree && c.village && onIt(c.x, c.z) && !gone.includes(c)) gone.push(c); }); }
    for (const c of gone) this.W.removeCollider(c);
    for (let k = 0; k < this.occ.length; k++) if (this.occ[k] === 2) { const x = BOUNDS.x0 + (k % this.gn[0]) + 0.5, z = BOUNDS.z0 + Math.floor(k / this.gn[0]) + 0.5; if (onIt(x, z)) this.occ[k] = 0; }
    F.yawTo = (tx, tz, fx, fz) => { const [ax, az] = at(F, fx, fz), [bx, bz] = at(F, tx, tz); return Math.atan2(bx - ax, bz - az); };
    this._stamp(F, HL + 0.8, HW + 0.8);
    // the goals (their posts are solid)
    for (const s of [1, -1]) {
      const [gx, gz] = F.at(s * HL, 0), b = chunk(gx, gz);
      b.group(gx, T.heightAt(gx, gz), gz, 0, F.yaw + (s > 0 ? Math.PI : 0), 0, () => goal(b));
      for (const zz of [-GOAL, GOAL]) { const [px, pz] = F.at(s * HL, zz); this.W.addCollider({ x: px, z: pz, r: 0.1, village: true }); }
    }
    // white corner stones
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const [x, z] = F.at(sx * HL, sz * HW), b = chunk(x, z); b.box(0.22, 0.14, 0.22, x, T.heightAt(x, z) + 0.04, z, 0xf2efe6); }
    // benches along a touchline, facing the pitch
    for (const side of [-1, 1]) {
      let n = 0;
      for (const lx of [-3.2, 3.2]) {
        const [x, z] = F.at(lx, side * (HW + 1.5)), BF = { x, z, yaw: F.yaw + (side < 0 ? 0 : Math.PI) };
        if (![[-0.9, -0.3], [0.9, -0.3], [-0.9, 0.9], [0.9, 0.9], [0, 0]].every(([a, c]) => { const [px, pz] = at(BF, a, c); return this._open(px, pz) || this._inField(px, pz, 2.6); })) continue;
        const b = chunk(x, z);
        b.group(x, T.heightAt(x, z), z, 0, BF.yaw, 0, () => bench(b, 0, 0, 0, 0));
        this.seatDefs.push({ F: BF, where: 'field', local: [[-0.4, -0.02], [0.4, -0.02]], app: [[-0.4, 0.62], [0.4, 0.62]], h: 0.48 });
        n++;
      }
      if (n) break;
    }
    // the way onto the pitch: the middle of the touchline nearest a lane
    let bestN = null;
    for (const side of [-1, 1]) { const [x, z] = F.at(0, side * (HW + 0.6)), L = laneDist(x, z).d; if (!bestN || L < bestN.L) bestN = { x, z, L }; }
    F.node = this.nav.attach(bestN.x, bestN.z, {}, {});
  }
  _inField(x, z, pad = 0) { if (!this.field) return false; const [lx, lz] = toLocal(this.field, x, z); return Math.abs(lx) < PITCH.HL + pad && Math.abs(lz) < PITCH.HW + pad; }
  // places for children's games: the green, and up to two more open, flat patches
  _playAreas() {
    this.areas = [];
    if (this.field && this.field.node >= 0) this.areas.push({ x: this.field.x, z: this.field.z, r: 4.2, field: true, node: this.field.node });
    const cands = [];
    for (let cz = BOUNDS.z0 + 6; cz < BOUNDS.z1 - 6; cz += 2) for (let cx = BOUNDS.x0 + 6; cx < BOUNDS.x1 - 6; cx += 2) {
      let ok = true, lo = 1e9, hi = -1e9;
      for (let k = 0; k < 13 && ok; k++) { const a = k / 12 * TAU, r = k === 12 ? 0 : 4.4, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (!this._open(x, z)) ok = false; else { const h = this.hg[this._cellOf(x, z)]; lo = Math.min(lo, h); hi = Math.max(hi, h); } }
      if (ok && hi - lo < 1.0) cands.push([dist2(cx, cz, SQUARE.x, SQUARE.z) + (hi - lo) * 8, cx, cz]);
    }
    cands.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (const [, x, z] of cands) {
      if (this.areas.length >= 3) break;
      if (this.areas.some(A => dist2(A.x, A.z, x, z) < 16)) continue;
      const node = this.nav.attach(x, z, {}, {});
      if (node < 0) continue;
      this.areas.push({ x, z, r: 3.8, node });
      this._stamp({ x, z, yaw: 0 }, 3.5, 3.5);
    }
  }
  // rope cots outside some houses, beside the garden on the lane side
  _charpais(chunk) {
    let n = 0;
    for (const h of this.houses) {
      if (h.hall || n >= 8) continue;
      const g = h.g, half = g ? g.half : h.spec.shape === 'round' ? h.spec.r : h.spec.w / 2, lz = g ? g.zB - 1.1 : h.doorZ;
      for (const side of h.i % 2 ? [1, -1] : [-1, 1]) {
        const [cx, cz] = at(h, side * (half + 1.5), lz), F = { x: cx, z: cz, yaw: h.yaw };
        if (![[-1.15, -0.6], [1.15, -0.6], [-1.15, 0.6], [1.15, 0.6], [0, 0], [-0.45, 1.0], [0.45, 1.0], [0, -0.6]].every(([a, c]) => { const [x, z] = at(F, a, c); return this._open(x, z); })) continue;
        const b = chunk(cx, cz);
        b.group(cx, this.T.heightAt(cx, cz) - 0.02, cz, 0, F.yaw, 0, () => charpai(b));
        for (const s of [-1, 1]) { const [x, z] = at(F, s * 0.72, -0.05); this.W.addCollider({ x, z, r: 0.34, village: true }); }
        this.seatDefs.push({ F, where: 'home', house: h, local: [[-0.45, 0.12], [0.45, 0.12]], app: [[-0.45, 0.88], [0.45, 0.88]], h: 0.44 });
        this._stamp(F, 1.3, 0.9);
        n++; break;
      }
    }
  }
  // every place something is done
  _spots() {
    const nav = this.nav, V = this.V, T = this.T, sp = this.spots = [];
    const add = (kind, x, z, yaw, o = {}) => {
      let node;
      if (o.via) { const w = nav.attach(o.via[0], o.via[1], {}, { ignore: o.ignore }); if (w < 0) return null; node = nav.attach(x, z, {}, { to: w }); }
      else node = nav.attach(x, z, {}, o.to !== undefined ? { to: o.to } : { ignore: o.ignore });
      if (node < 0) return null;
      const S = { id: sp.length, kind, x, z, yaw, node, cap: o.cap ?? 1, ...o };
      sp.push(S); return S;
    };
    this.beds = []; this.penSpots = []; this.wellSpots = []; this.props = { wood: [], cook: [], line: [], hay: [] }; this.seats = []; this.pairs = []; this.sweeps = []; this.watchSpots = [];
    // garden beds: stand on the path facing the bed
    for (const h of this.houses) if (h.g) for (const bd of h.g.beds) {
      const [x, z] = at(h, bd.side * 0.6, (bd.z0 + bd.z1) / 2), S = add('bed', x, z, h.yaw + (bd.side < 0 ? -Math.PI / 2 : Math.PI / 2), { house: h, bed: bd.kind, to: h.M });
      if (S) this.beds.push(S);
    }
    // sweeping the garden path (gate to door)
    for (const h of this.houses) if (h.g && h.M !== h.D) { const [gx, gz] = at(h, 0, h.g.zB + 0.3), [dx, dz] = at(h, 0, h.doorZ + 0.2); this.sweeps.push({ id: -1, kind: 'sweep', house: h, node: h.G, x: nav.nodes[h.G].x, z: nav.nodes[h.G].z, a: [gx, gz], b: [dx, dz], cap: 0 }); }
    // pens: at the front fence, facing in
    for (const P of this.pens) {
      const house = this.houses.find(h => h.Hs === P.house);
      for (const [lx, lz, turn] of [[0, PEN_SIZE.z1 + 0.75, Math.PI], [-1.2, PEN_SIZE.z1 + 0.75, Math.PI], [1.2, PEN_SIZE.z1 + 0.75, Math.PI], [PEN_SIZE.hw + 0.75, 0.6, -Math.PI / 2], [-PEN_SIZE.hw - 0.75, 0.6, Math.PI / 2]]) {
        const [x, z] = at(P, lx, lz);
        if (this._blocked(x, z)) continue;
        const S = add('pen', x, z, P.yaw + turn, { pen: P.kind, house });
        if (S) { this.penSpots.push(S); break; }
      }
    }
    // things beside the houses
    for (const p of V.spots.props || []) {
      const F = { x: p.x, z: p.z, yaw: p.yaw }, h = this.houses.find(q => q.Hs === p.house);
      const put = (kind, list, lx, lz) => { const [x, z] = at(F, lx, lz); if (this._blocked(x, z)) return; const S = add(kind, x, z, Math.atan2(p.x - x, p.z - z), { house: h }); if (S) list.push(S); };
      if (p.what === 'wood') put('wood', this.props.wood, 0, 1.05);
      else if (p.what === 'hearth') put('cook', this.props.cook, 0, 1.0);
      else if (p.what === 'line') put('line', this.props.line, 0, 0.62);
      else if (p.what === 'hay') put('hay', this.props.hay, 0, 1.78);
      else if (p.what === 'bales') put('hay', this.props.hay, 0.3, 1.2);
      else if (p.what === 'table') this.seatDefs.push({ F, where: 'table', house: h, local: [[0.85, 0], [-0.85, 0]], app: [[1.5, 0], [-1.5, 0]], h: 0.475, faceIn: true });
    }
    // the well
    for (let k = 0; k < 10 && this.wellSpots.length < 3; k++) {
      const a = 0.25 + k / 10 * TAU, x = SQUARE.x + Math.cos(a) * 1.78, z = SQUARE.z + Math.sin(a) * 1.78;
      if (this.wellSpots.some(S => dist2(S.x, S.z, x, z) < 1.6)) continue;
      const S = add('well', x, z, Math.atan2(SQUARE.x - x, SQUARE.z - z), { via: [SQUARE.x + Math.cos(a) * 3.0, SQUARE.z + Math.sin(a) * 3.0] });
      if (S) this.wellSpots.push(S);
    }
    // the fruit stall: the seller behind it, a customer in front
    if (V.spots.stallAt) {
      const F = { x: V.spots.stallAt.x, z: V.spots.stallAt.z, yaw: Math.PI / 2 };
      const [vx, vz] = at(F, 0, -0.95), [cx, cz] = at(F, 0, 1.3), [wx, wz] = at(F, 0, -2.0), [ux, uz] = at(F, 0, 2.2);
      this.vend = add('vend', vx, vz, F.yaw, { via: [wx, wz] });
      this.stall = add('shop', cx, cz, F.yaw + Math.PI, { via: [ux, uz] });
    }
    // benches on the square, in gardens, at tables, charpais, by the pitch: two seats each
    for (const B of V.spots.benches) this.seatDefs.push({ F: { x: B.x, z: B.z, yaw: B.yaw - Math.PI }, where: 'square', local: [[-0.4, -0.02], [0.4, -0.02]], app: [[-0.4, 0.62], [0.4, 0.62]], h: 0.48 });
    for (const h of this.houses) if (h.g && h.g.bench) { const [x, z] = at(h, h.g.bench.x, h.g.bench.z); this.seatDefs.push({ F: { x, z, yaw: h.yaw + Math.PI }, where: 'home', house: h, local: [[-0.4, -0.02], [0.4, -0.02]], app: [[-0.4, 0.62], [0.4, 0.62]], h: 0.48, to: h.D }); }
    for (const D of this.seatDefs) {
      const two = [];
      D.local.forEach(([lx, lz], k) => {
        const [sx, sz] = at(D.F, lx, lz), [ax, az] = at(D.F, D.app[k][0], D.app[k][1]);
        const yaw = D.faceIn ? Math.atan2(D.F.x - sx, D.F.z - sz) : D.F.yaw;
        if (D.to === undefined && this._blocked(ax, az) && !this._inField(ax, az, 3)) return;
        const S = add('seat', ax, az, yaw, { seat: { x: sx, z: sz, y: T.heightAt(D.F.x, D.F.z), h: D.h }, where: D.where, house: D.house, to: D.to });
        if (S) { this.seats.push(S); two.push(S); }
      });
      if (two.length === 2) this.pairs.push(two);
    }
    this.fieldSeats = this.seats.filter(S => S.where === 'field');
    // where children stand to watch a match
    if (this.field && this.field.node >= 0) for (const [lx, side] of [[-2.2, -1], [2.4, -1], [0, 1], [-4.6, 1], [4.4, 1]]) {
      const [x, z] = this.field.at(lx, side * (PITCH.HW + 0.9));
      const S = add('watch', x, z, this.field.yawTo(lx, 0, lx, side * (PITCH.HW + 0.9)), { to: this.field.node });
      if (S) this.watchSpots.push(S);
    }
    // places to meet for a chat: lane waypoints (with the lane's direction), spots on the square, garden gates
    const tangent = id => { const N = nav.nodes[id], ln = nav.adj[id].filter(m => nav.nodes[m].lane); if (ln.length < 1) return [1, 0]; const A = nav.nodes[ln[0]], B = ln.length > 1 ? nav.nodes[ln[1]] : N; let tx = B.x - A.x, tz = B.z - A.z; const l = Math.hypot(tx, tz) || 1; return [tx / l, tz / l]; };
    this.talkSpots = [];
    nav.nodes.filter(N => N.lane).forEach((N, k) => { if (k % 2) return; const [tx, tz] = tangent(N.id); if (!inClear(N.x, N.z)) return; this.talkSpots.push({ node: N.id, x: N.x, z: N.z, tx, tz }); });
    this.squareSpots = [];
    for (const a of [1.4, 3.0, 4.55, 6.05]) { const x = SQUARE.x + Math.cos(a) * 5.6, z = SQUARE.z + Math.sin(a) * 5.6; if (this._blocked(x, z)) continue; const S = add('square', x, z, 0, { cap: 0 }); if (S) this.squareSpots.push({ node: S.node, x, z, tx: -Math.sin(a), tz: Math.cos(a) }); }
    this.gates = this.houses.map(h => ({ node: h.G, x: nav.nodes[h.G].x, z: nav.nodes[h.G].z, tx: h.c, tz: -h.s }));
    this.laneNodes = nav.nodes.filter(N => N.lane && inClear(N.x, N.z)).map(N => N.id);
  }
  // drop what can't be reached
  _prune() {
    const nav = this.nav, ref = this.ring.length ? this.ring[0] : this.laneNodes[0], ok = id => id >= 0 && nav.reachable(ref, id);
    const keep = list => list.filter(S => ok(S.node));
    this.beds = keep(this.beds); this.penSpots = keep(this.penSpots); this.wellSpots = keep(this.wellSpots); this.seats = keep(this.seats); this.watchSpots = keep(this.watchSpots); this.fieldSeats = keep(this.fieldSeats);
    for (const k in this.props) this.props[k] = keep(this.props[k]);
    this.pairs = this.pairs.filter(p => p.every(S => ok(S.node)));
    this.areas = this.areas.filter(A => ok(A.node));
    // each play area can be booked for one game at a time; children sit on the ground at fixed places in it
    this.areas.forEach((A, k) => {
      A.res = { id: 'area' + k, cap: 1 };
      A.slots = [];
      for (let j = 0; j < 9; j++) { const r = j < 5 ? 1.5 : 2.6, a = j < 5 ? j / 5 * TAU : (j - 5) / 4 * TAU + 0.6; A.slots.push({ id: 'area' + k + 's' + j, cap: 1, x: A.x + Math.cos(a) * r, z: A.z + Math.sin(a) * r, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) }); }
    });
    this.talkSpots = this.talkSpots.filter(S => ok(S.node)); this.squareSpots = this.squareSpots.filter(S => ok(S.node)); this.laneNodes = this.laneNodes.filter(ok);
    if (this.vend && !ok(this.vend.node)) this.vend = null; if (this.stall && !ok(this.stall.node)) this.stall = null;
    if (this.field && !ok(this.field.node)) this.field.node = -1;
    this.homes = this.houses.filter(h => !h.hall && ok(h.D) && ok(h.G));
    this.sweeps = this.sweeps.filter(S => ok(S.node));
  }
  // the villagers: who lives where, and what they look like
  _roster() {
    const homes = this.homes, people = [];
    if (!homes.length) { this.npcs = []; return; }
    const order = [...homes.filter(h => h.pen), ...homes.filter(h => !h.pen)];
    const rank = { keeper: 0, farmer: 1, wood: 2, water: 3, home: 4, vendor: 5 };
    const adults = ADULTS.map(([g, role], k) => ({ age: 'adult', female: g === 'f', role, k })).sort((a, b) => rank[a.role] - rank[b.role] || a.k - b.k);
    adults.forEach((a, i) => people.push({ ...a, home: order[i % order.length] }));
    const nA = Math.min(adults.length, order.length);
    for (let i = 0; i < 6; i++) people.push({ age: 'elder', female: i % 2 === 1, role: 'elder', home: order[i < 3 ? (i * 2) % nA : (nA + i - 3) % order.length] });
    const fam = [1, 3, 5, 6, 0, 2, 8, 9];
    for (let i = 0; i < 8; i++) people.push({ age: 'child', female: i % 2 === 1, role: 'child', home: order[fam[i] % nA] });
    // the night watchman (chowkidar): an empty house if there is one
    const used = new Set(people.map(p => p.home));
    people.push({ age: 'adult', female: false, role: 'watch', home: order.find(h => !used.has(h)) || order[order.length - 1] });
    const counts = { adult: 0, child: 0 };
    this.npcs = people.map((p, i) => {
      const R = rng(5003, i), L = makeLook(p.age, p.female, R), kind = p.age === 'child' ? 'child' : 'adult';
      if (p.role === 'watch') Object.assign(L, { top: 0x8a7a52, bottom: 0xece4d0, accent: 0x6e5a48, accent2: 0x5a2a1e, hat: HAT.turban, hair: HAIR.crop, stick: true, sx: 1.06, sy: 1.0, shoes: 0x3a2a1a,
        flags: (1 << FLAG.KURTA) | (1 << FLAG.MOUSTACHE) | (1 << FLAG.SHAWL) });
      const pref = { ...(PREFS[p.role] || {}) };
      if (p.age === 'elder') { pref.stroll = R(0.7, 1.6); pref.sit = R(0.8, 1.5); pref.garden = R(0.5, 1.4); }
      if (p.age === 'child') { pref.run = R(0.7, 1.5); pref.hop = R(0.5, 1.4); pref.watch = R(0.6, 1.5); }
      const speed = p.age === 'elder' ? SPEED.elder * R(0.86, 1.1) * (L.stick ? 0.92 : 1) : p.age === 'child' ? SPEED.child * R(0.92, 1.1) : SPEED.adult * R(0.92, 1.08);
      return { i, ...p, kind, idx: counts[kind]++, L, pref, speed, run: SPEED.run * R(0.9, 1.1), S: SKEL[kind], item0: L.stick ? ITEM.stick : 0, seed: R(0, 100),
        anim: new Animator(), st: { S: SKEL[kind], age: p.age, seed: 0 }, yaw: 0, turn: 0, px: 0, pz: 0, ox: 0, oz: 0, spd: 0, shown: false, col: null };
    });
    this.counts = counts;
  }

  /* ================= start (after the village meshes are built) ================= */
  start(add) {
    if (!this.npcs || !this.npcs.length) return;
    this.crowd = new Crowd(null, this.counts, add);
    for (const n of this.npcs) { this.crowd.look(n.kind, n.idx, n.L); n.st.seed = n.seed; n.st.stick = n.L.stick; }
    const ball = this.ball = new THREE.Mesh(football(), MAT.solid);
    ball.castShadow = true; ball.matrixAutoUpdate = true;
    add(ball);
    this.ballRot = new THREE.Quaternion(); this._q = new THREE.Quaternion(); this._ax = new THREE.Vector3();
    this.lastBall = null;
    this._o = {}; this._a = {};
    this.piv = { adult: pivots(SKEL.adult), child: pivots(SKEL.child) };
    // the watchman's lantern (a moving lamp: js/day-night.js) and his call
    const lb = new GeoBuilder(); lantern(lb);
    this.lanternObj = lb.build(); this.lanternObj.visible = false;
    add(this.lanternObj);
    this.lamp = this.W.dayNight.addMovingLamp(this.lanternObj, 'lantern');
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('Jaagte raho!'), transparent: true, depthWrite: false, opacity: 0 }));
    this.bubble.scale.set(1.6, 0.47, 1); this.bubble.renderOrder = 5; this.bubble.visible = false;
    add(this.bubble);
  }

  /* ================= planning a day ================= */
  _buildDay(day) {
    this.day = day;
    const npcs = this.npcs;
    this.dayAbs = day * DAY - IST_S;
    const times = npcs.map((n, i) => {
      const R = rng(day, i, 11);
      return { age: n.age, home: this.houses.indexOf(n.home), ...(n.role === 'watch' ? { wake: H(13.4) + R(0, 1500), bed: H(18.6) + R(0, 600), lunch: [H(23.5), 60] } : dayTimes(n.age, R)) };
    });
    const C = { npcs: times, field: this.field && this.field.node >= 0 ? { ...this.field, area: this.areas.find(A => A.field) } : null,
      talkSpots: this.talkSpots, squareSpots: this.squareSpots.length ? this.squareSpots : this.talkSpots, gates: this.gates, benchPairs: this.pairs, fieldSeats: this.fieldSeats, playAreas: this.areas, nav: this.nav };
    const plans = this.plans = planDay(C, day);
    const res = this.res = new Map();
    for (const P of plans) {
      if (P.reserve) for (const [id, a, b] of P.reserve) this._reserve(id, a, b);
      const A = P.kind === 'football' ? this.areas.find(q => q.field) : P.kind === 'chase' || P.kind === 'circle' ? this.areas.find(q => q.node === P.at[0].node) : null;
      if (A) this._reserve(A.res.id, P.t0 - 40, P.t1 + 30);
      if (P.kind === 'football') P.sim = simulateFootball(P.session, P.members.map(m => npcs[m].run));
    }
    const st = npcs.map((n, i) => ({ i, n, d: times[i], t: times[i].wake, segs: [{ k: 'in', t0: 0, t1: times[i].wake, house: n.home }], pos: n.home.I.slice(), node: n.home.D, inside: n.home, plans: [], pi: 0, lunched: false, R: rng(day, i, 977), done: false }));
    plans.forEach(P => P.members.forEach((m, j) => st[m].plans.push({ P, j })));
    // the watchman: still on his round after midnight; home at the end of the round after 5:24 AM, to sleep
    const Wm = this.watchman, PR = this.patrol;
    if (Wm) {
      const s = st[Wm.i], h = Wm.home, N = this.nav.nodes[h.G];
      const pEnd = Math.ceil((this.dayAbs + H(5.4)) / PR.period) * PR.period - this.dayAbs;
      s.segs = [{ k: 'patrol', t0: 0, t1: pEnd, carry: CARRY.lantern, item: ITEM.stick }];
      s.t = pEnd; s.pos = [N.x, N.z]; s.node = h.G; s.inside = null;
      this._home(s, times[Wm.i].wake, { carry: CARRY.lantern });
    }
    for (let guard = 0; guard < 40000; guard++) {
      let s = null;
      for (const x of st) if (!x.done && (!s || x.t < s.t)) s = x;
      if (!s) break;
      this._step(s);
    }
    // the watchman's evening: supper at home, then out to his gate with the lantern lit, and the round all night
    if (Wm) {
      const s = st[Wm.i], last = s.segs[s.segs.length - 1], h = Wm.home, N = this.nav.nodes[h.G];
      if (last.k === 'in') {
        s.pos = h.I.slice(); s.node = h.D; s.inside = h;
        const toGate = this._wt(s, h.G, null, Wm.speed), desired = Math.max(last.t0 + 900, H(19.25));
        const tP = Math.ceil((this.dayAbs + desired + toGate + 20) / PR.period) * PR.period - this.dayAbs, out = tP - toGate - s.R(8, 20);
        if (tP < DAY - 60 && out > last.t0 + 60) {
          last.t1 = out; s.t = out;
          this._walk(s, h.G, null, { carry: CARRY.lantern, item: ITEM.stick });
          if (s.t < tP) this._act(s, 'stand', tP - s.t, { x: N.x, z: N.z, yaw: h.yaw, carry: CARRY.lantern, item: ITEM.stick });
          s.segs.push({ k: 'patrol', t0: Math.max(tP, s.t), t1: DAY, carry: CARRY.lantern, item: ITEM.stick });
        }
      }
    }
    this.timeline = st.map(s => s.segs);
  }
  // the watchman's round: from his gate along every lane to its end and back, past the square and the green,
  // stopping at each end to look round with the lantern up (and blow his whistle). It repeats all night; where he
  // is depends only on the clock, so the round goes on unbroken past midnight and every player sees him in the
  // same place.
  _patrolRoute() {
    const Wm = this.npcs.find(n => n.role === 'watch');
    if (!Wm) return;
    const nav = this.nav, start = Wm.home.G, targets = new Set();
    for (const L of LANES) for (const pt of [L.pts[0], L.pts[L.pts.length - 1]]) {
      const id = nav.nearestLane(pt[0], pt[1], 3);
      if (id >= 0 && inClear(nav.nodes[id].x, nav.nodes[id].z) && nav.reachable(start, id)) targets.add(id);
    }
    if (this.ring.length && nav.reachable(start, this.ring[0])) targets.add(this.ring[0]);
    if (this.field && this.field.node >= 0 && nav.reachable(start, this.field.node)) targets.add(this.field.node);
    targets.delete(start);
    const order = [start], left = [...targets];
    let cur = start;
    while (left.length) { left.sort((a, b) => nav.dist(cur, a) - nav.dist(cur, b) || a - b); cur = left.shift(); order.push(cur); }
    order.push(start);
    const legs = [];
    let period = 0;
    for (let i = 0; i < order.length - 1; i++) {
      const pts = [];
      for (const id of nav.route(order[i], order[i + 1])) { const N = nav.nodes[id], L = pts[pts.length - 1]; if (!L || dist2(L[0], L[1], N.x, N.z) > 0.05) pts.push([N.x, N.z, 0]); }
      if (pts.length < 2) continue;
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist2(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]));
      const len = cum[cum.length - 1], last = i === order.length - 2, A = pts[pts.length - 2], B = pts[pts.length - 1];
      legs.push({ line: { pts, cum, len }, walk: len / PATROL_V, pause: last ? 0 : 14 + (i * 7) % 12, face: Math.atan2(B[0] - A[0], B[1] - A[1]) });
      period += len / PATROL_V + legs[legs.length - 1].pause;
    }
    if (!legs.length || period < 60) return;
    this.patrol = { legs, period };
    this.watchman = Wm;
  }
  // where the watchman is on his round at absolute time T (seconds)
  _patrolAt(T, out) {
    const R = this.patrol, P = R.period;
    let ph = T - Math.floor(T / P) * P;
    out.loop = Math.floor(T / P);
    for (let i = 0; i < R.legs.length; i++) {
      const L = R.legs[i];
      if (ph < L.walk + L.pause || i === R.legs.length - 1) {
        out.leg = i;
        if (ph < L.walk) { const a = along(L.line, ph * PATROL_V, this._a); out.x = a.x; out.z = a.z; out.face = Math.atan2(a.tx, a.tz); out.pause = -1; }
        else { const B = L.line.pts[L.line.pts.length - 1]; out.x = B[0]; out.z = B[1]; out.face = L.face; out.pause = Math.min(ph - L.walk, L.pause); }
        return out;
      }
      ph -= L.walk + L.pause;
    }
    return out;
  }
  _reserve(id, a, b) { if (id === -1 || id === undefined) return; let L = this.res.get(id); if (!L) this.res.set(id, L = []); L.push([a, b]); }
  _isFree(S, a, b) { if (!S.cap) return true; const L = this.res.get(S.id); return !L || !L.some(([x, y]) => b + 2 > x && a - 2 < y); }
  _wt(s, node, pt, speed) {
    const nav = this.nav, d = nav.dist(s.node, node);
    if (d > 1e8) return Infinity;
    const A = nav.nodes[s.node], B = nav.nodes[node];
    return (dist2(s.pos[0], s.pos[1], A.x, A.z) + d + (pt ? dist2(B.x, B.z, pt[0], pt[1]) : 0)) / speed + ACC + 0.25;
  }
  _walk(s, node, pt, o = {}) {
    const speed = o.speed || s.n.speed, T = this._wt(s, node, pt, speed), N = this.nav.nodes[node];
    const end = pt ? pt.slice() : [N.x, N.z];
    if (T < Infinity && (dist2(s.pos[0], s.pos[1], end[0], end[1]) > 0.08 || s.node !== node)) {
      s.segs.push({ k: 'walk', t0: s.t, t1: s.t + T, a: s.node, b: node, P: s.pos.slice(), Q: pt ? pt.slice() : null, run: !!o.run, item: o.item ?? s.n.item0, carry: o.carry || 0, hA: s.inside, hB: o.house || null, line: null, hint: 0 });
      s.t += T;
    }
    s.node = node; s.pos = end; s.inside = null;
  }
  _act(s, act, dur, o) {
    const seg = { k: 'act', t0: s.t, t1: s.t + dur, act, x: o.x, z: o.z, yaw: o.yaw, item: o.item ?? s.n.item0, carry: o.carry || 0, seat: o.seat || null, dyn: o.dyn || null, talk: o.talk };
    s.segs.push(seg); s.t += dur;
    s.pos = o.dyn ? this._dynPos(o.dyn, dur, {}).xz : [o.x, o.z];
  }
  _home(s, until, o = {}) {
    const h = s.n.home;
    if (s.inside !== h) this._walk(s, h.D, h.I, { ...o, house: h });
    const t0 = s.t;
    if (o.stay) until = t0 + o.stay;
    s.segs.push({ k: 'in', t0, t1: Math.max(until, t0 + 5), house: h }); s.t = Math.max(until, t0 + 5);
    s.pos = h.I.slice(); s.node = h.D; s.inside = h;
  }
  // one more step of somebody's day
  _step(s) {
    const n = s.n, d = s.d, t = s.t, R = s.R;
    const home = this._wt(s, n.home.D, null, n.speed);
    if (t + home >= d.bed || t > DAY - 60) { this._home(s, DAY); s.done = true; return; }
    while (s.pi < s.plans.length && s.plans[s.pi].P.t1 <= t + 2) s.pi++;
    const PL = s.plans[s.pi];
    let lead = 0;
    if (PL) {
      const A = PL.P.at[PL.j], run = n.age === 'child' && (PL.P.kind === 'football' || PL.P.kind === 'chase');
      lead = this._wt(s, A.node, A.pt, run ? n.run : n.speed);
      if (t + lead + 12 >= PL.P.t0) { this._attend(s, PL, run); s.pi++; return; }
    }
    if (!s.lunched && t + home >= d.lunch[0]) { s.lunched = true; this._home(s, Math.max(t + home, d.lunch[0]) + d.lunch[1]); return; }
    const target = PL ? { node: PL.P.at[PL.j].node, t: PL.P.t0 } : !s.lunched ? { node: n.home.D, t: d.lunch[0] } : { node: n.home.D, t: d.bed };
    const budget = target.t - t;
    if (budget < 45) { this._idle(s, Math.max(6, Math.min(budget - lead, 30))); return; }
    for (let tries = 0; tries < 6; tries++) { const job = this._choose(s, target, budget); if (job) { this._do(s, job); return; } }
    this._idle(s, Math.min(Math.max(6, budget - lead - 5), R(20, 50)));
  }
  _idle(s, dur) { this._act(s, s.n.age === 'child' ? 'look' : 'stand', Math.max(5, dur), { x: s.pos[0], z: s.pos[1], yaw: s.R(0, TAU) }); }
  _attend(s, { P, j }, run) {
    const A = P.at[j], n = s.n;
    this._walk(s, A.node, A.pt, { speed: run ? n.run : n.speed, run });
    if (s.t < P.t0) this._act(s, P.kind === 'football' || P.kind === 'chase' ? 'stand' : 'wait', P.t0 - s.t, { x: A.pt[0], z: A.pt[1], yaw: A.yaw, item: n.item0 });
    const t0 = Math.max(P.t0, s.t), end = this._planEnd(P, j);
    s.segs.push({ k: 'plan', t0, t1: P.t1, P, j, arrive: t0 > P.t0 + 0.5 ? s.pos.slice() : null, item: n.item0, carry: 0 });
    s.t = Math.max(P.t1, t0 + 1); s.pos = end.pt; s.node = end.node; s.inside = null;
  }
  _planEnd(P, j) {
    const A = P.at[j];
    if (P.kind === 'football') { const pl = P.sim.plays[P.sim.plays.length - 1], [lx, lz] = moveAt(pl, j, P.t1); return { pt: this.field.at(lx, lz), node: this.field.node }; }
    if (P.kind === 'chase') { const p = chasePos(P.chase, j, P.t1 - P.t0); return { pt: [p.x, p.z], node: A.node }; }
    if (P.kind === 'walk') { const L = P.walk.line, e = L.pts[L.pts.length - 1], f = L.pts[Math.max(0, L.pts.length - 2)], tx = e[0] - f[0], tz = e[1] - f[1], l = Math.hypot(tx, tz) || 1, o = j ? 0.38 : -0.38; return { pt: [e[0] + tz / l * o, e[1] - tx / l * o], node: P.walk.end }; }
    return { pt: A.pt.slice(), node: A.node };
  }
  // pick something to do and somewhere to do it; null if nothing fits before `target`
  _choose(s, target, budget) {
    const n = s.n, R = s.R, sod = s.t;
    let W = weights(n.age, sod);
    if (n.role === 'vendor' && this.vend && STALL_HOURS.some(([a, b]) => sod >= a && sod < b - 300)) W = { vend: 10 };
    const opts = [];
    let tot = 0;
    for (const k in W) { const w = W[k] * (n.pref[k] ?? 1); if (w > 0 && this._can(k, n)) { opts.push([k, w]); tot += w; } }
    if (!opts.length) return null;
    let r = R() * tot, a = opts[0][0];
    for (const [k, w] of opts) { r -= w; if (r <= 0) { a = k; break; } }
    return this._job(s, a, target, budget);
  }
  _can(a, n) {
    switch (a) {
      case 'garden': return this.beds.length > 0;
      case 'animals': return this.penSpots.length > 0;
      case 'well': case 'help': return this.wellSpots.length > 0;
      case 'sweep': return this.sweeps.some(S => S.house === n.home);
      case 'wood': return this.props.wood.length > 0;
      case 'hay': return this.props.hay.length > 0;
      case 'line': return this.props.line.length > 0;
      case 'cook': return this.props.cook.length > 0;
      case 'shop': return !!this.stall && n.role !== 'vendor';
      case 'vend': return !!this.vend && n.role === 'vendor';
      case 'run': case 'hop': return this.areas.length > 0;
      case 'watch': return this.watchSpots.length > 0;
      default: return true;
    }
  }
  // a free spot from a list (one near is likelier), with its walking time
  _pick(s, list, dur, prefer) {
    if (!list.length) return null;
    const R = s.R, sp = s.n.speed;
    const cands = list.map(S => [this.nav.dist(s.node, S.node) * (prefer && prefer(S) ? 0.25 : 1) + R(0, 25), S]).sort((a, b) => a[0] - b[0]).slice(0, 6);
    for (const [, S] of cands) { const w = this._wt(s, S.node, null, sp); if (w < Infinity && this._isFree(S, s.t + w, s.t + w + dur)) return { S, w }; }
    return null;
  }
  _job(s, a, target, budget) {
    const n = s.n, R = s.R, age = n.age, home = n.home, own = S => S.house === home;
    const rg = a === 'sit' && age === 'elder' ? ELDER_SIT : DURATION[a] || [30, 80];
    let areaRes = null, dur = R(rg[0], rg[1]), got = null, act = a, item = 0, carry = 0, wItem = n.item0, wCarry = 0, then = null, dyn = null, toPt = null, yaw = 0, run = false, seat = null;
    switch (a) {
      case 'garden': {
        got = this._pick(s, this.beds, dur, own); if (!got) return null;
        const k = got.S.bed;
        act = age === 'elder' ? 'water' : k === 'veg' ? (R() < 0.5 ? 'hoe' : R() < 0.5 ? 'weed' : 'water') : k === 'fruit' ? 'pick' : k === 'bushes' ? 'weed' : R() < 0.6 ? 'water' : 'weed';
        item = act === 'hoe' ? ITEM.hoe : act === 'water' ? ITEM.can : 0; wItem = item || n.item0;
        if (act === 'pick') then = { kind: 'in', carry: CARRY.handBasket };
        break;
      }
      case 'animals': {
        got = this._pick(s, this.penSpots, dur, own); if (!got) return null;
        if (got.S.pen === 'chicken') { act = 'feed'; carry = CARRY.bowl; wCarry = CARRY.bowl; }
        else { act = 'tend'; if (n.female && R() < 0.6) wCarry = CARRY.hay; }
        break;
      }
      case 'well': case 'help': {
        dur = R(22, 40); got = this._pick(s, this.wellSpots, dur); if (!got) return null;
        act = 'pull';
        const pot = n.female && age !== 'child';
        if (pot) wCarry = CARRY.pot; else wItem = ITEM.bucket;
        then = { kind: 'pour', carry: pot ? CARRY.pot : 0, item: pot ? n.item0 : ITEM.bucket };
        break;
      }
      case 'sweep': {
        const S = this.sweeps.find(q => q.house === home); if (!S) return null;
        got = { S, w: this._wt(s, S.node, S.a, n.speed) }; toPt = S.a; item = ITEM.broom; wItem = ITEM.broom;
        dyn = { type: 'sweep', a: S.a, b: S.b, v: 0.24 };
        break;
      }
      case 'wood': {
        got = this._pick(s, this.props.wood, dur, own); if (!got) return null;
        if (R() < 0.7) { act = 'chop'; item = ITEM.axe; wItem = ITEM.axe; } else act = 'stack';
        then = { kind: 'stack', carry: CARRY.wood };
        break;
      }
      case 'hay': got = this._pick(s, this.props.hay, dur, own); if (!got) return null; act = 'fork'; item = ITEM.fork; wItem = ITEM.fork; break;
      case 'line': got = this._pick(s, this.props.line, dur, own); if (!got) return null; act = 'hang'; wCarry = CARRY.handBasket; then = { kind: 'in', carry: CARRY.handBasket }; break;
      case 'cook': got = this._pick(s, this.props.cook, dur, own); if (!got) return null; act = 'cook'; item = ITEM.ladle; break;
      case 'shop': { got = this._pick(s, [this.stall], dur); if (!got) return null; act = 'shop'; carry = CARRY.handBasket; wCarry = CARRY.handBasket; then = { kind: 'in', carry: n.female ? CARRY.basket : CARRY.handBasket }; break; }
      case 'vend': {
        const blk = STALL_HOURS.find(([x, y]) => s.t >= x && s.t < y);
        got = this._pick(s, [this.vend], 60); if (!got) return null;
        dur = Math.max(60, (blk ? blk[1] : s.t + 900) - s.t - got.w); act = 'vend';
        break;
      }
      case 'stroll': case 'visit': {
        let id;
        if (a === 'visit') { const others = this.homes.filter(h => h !== home); if (!others.length) return null; const h = R.pick(others); id = h.G; yaw = h.yaw + Math.PI; }
        else { const far = this.laneNodes.filter(m => { const d = this.nav.dist(s.node, m); return d > 15 && d < (age === 'elder' ? 45 : 70); }); if (!far.length) return null; id = R.pick(far); yaw = R(0, TAU); }
        const N = this.nav.nodes[id], w = this._wt(s, id, null, n.speed);
        if (!this._isFree({ id: 'node' + id, cap: 1 }, s.t + w, s.t + w + dur)) return null;
        got = { S: { id: 'node' + id, node: id, x: N.x, z: N.z, yaw, cap: 1 }, w };
        act = a === 'visit' && R() < 0.5 ? 'stand' : 'look';
        break;
      }
      case 'sit': {
        if (age === 'child' && (R() < 0.6 || !this.seats.length)) {
          const A = this._area(s, dur, true); if (!A) return null;
          const w = this._wt(s, A.node, [A.x, A.z], n.speed), slot = A.slots.find(S => this._isFree(S, s.t + w, s.t + w + dur + 10));
          if (!slot) return null;
          toPt = [slot.x, slot.z];
          got = { S: { id: slot.id, node: A.node, x: slot.x, z: slot.z, yaw: slot.yaw, cap: 1 }, w }; act = 'sitGround';
          break;
        }
        const pool = this.seats.filter(S => age === 'elder' ? true : S.where !== 'field');
        got = this._pick(s, pool, dur, S => (S.house === home) || (age === 'elder' && S.where === 'square'));
        if (!got) return null;
        seat = got.S.seat;
        act = age !== 'child' && got.S.where !== 'square' && R() < 0.4 ? 'drink' : 'sit';
        if (act === 'drink') item = ITEM.cup;
        break;
      }
      case 'run': case 'hop': {
        const A = this._area(s, dur); if (!A) return null;
        areaRes = A.res;
        if (a === 'run') { const r = A.r * R(0.45, 0.8), ph = R(0, TAU), dir = R() < 0.5 ? 1 : -1; dyn = { type: 'loop', cx: A.x, cz: A.z, r, w: dir * n.run * 0.8 / r, ph }; act = 'run'; run = true; }
        else { const ang = R(0, TAU), ax = A.x + Math.cos(ang) * 1.2, az = A.z + Math.sin(ang) * 1.2; dyn = { type: 'hop', a: [ax, az], b: [ax - Math.cos(ang) * 2.4, az - Math.sin(ang) * 2.4], v: 0.75 }; act = 'hop'; }
        toPt = this._dynPos(dyn, 0, {}).xz;
        got = { S: { id: -1, node: A.node, x: toPt[0], z: toPt[1], yaw: 0, cap: 0 }, w: this._wt(s, A.node, toPt, n.speed) };
        break;
      }
      case 'watch': {
        const P = this.plans.find(q => q.kind === 'football' && q.t0 < s.t + 120 && q.t1 > s.t + 200 && !q.members.includes(n.i));
        if (!P) return null;
        dur = Math.min(dur * 2, P.t1 - s.t - 60);
        got = this._pick(s, this.watchSpots, dur); if (!got) return null; act = 'watch';
        break;
      }
      default: return null;
    }
    const S = got.S, w = got.w;
    if (w === Infinity) return null;
    // time to come back from there to wherever is next (and to take things home first)
    const back = this.nav.dist(S.node, target.node) / n.speed + 4 + (then ? this.nav.dist(S.node, home.D) / n.speed * 2 + 40 : 0);
    const room = budget - w - back - 5;
    if (room < 18) return null;
    dur = Math.min(dur, room);
    return { a, S, w, act, dur, item, carry, wItem, wCarry, then, dyn, toPt, seat, run, areaRes };
  }
  _do(s, J) {
    const n = s.n, S = J.S;
    this._walk(s, S.node, J.toPt, { item: J.wItem, carry: J.wCarry, run: J.run, speed: J.run ? n.run * 0.8 : n.speed });
    const t0 = s.t;
    this._act(s, J.act, J.dur, { x: J.toPt ? J.toPt[0] : S.x, z: J.toPt ? J.toPt[1] : S.z, yaw: S.yaw, item: J.item || n.item0, carry: J.carry, seat: J.seat, dyn: J.dyn });
    if (S.cap && S.id !== -1) this._reserve(S.id, t0, s.t);
    if (J.areaRes) this._reserve(J.areaRes.id, t0 - J.w, s.t + 10);
    if (J.then) {
      const h = n.home, T = J.then;
      if (T.kind === 'in') this._home(s, 0, { carry: T.carry, stay: s.R(15, 45) });
      else {
        this._walk(s, h.D, null, { carry: T.carry, item: T.item ?? n.item0 });
        const [px, pz] = at(h, s.n.i % 2 ? 0.75 : -0.75, h.doorZ - 0.1);
        this._walk(s, h.D, [px, pz], { carry: T.carry, item: T.item ?? n.item0 });
        this._act(s, T.kind === 'pour' ? 'pour' : 'stack', s.R(4, 7), { x: px, z: pz, yaw: h.yaw + Math.PI, carry: 0, item: T.kind === 'pour' ? T.item : n.item0 });
      }
    }
  }
  // a play area that no football match is using
  _area(s, dur, sit) {
    const a = s.t, b = s.t + dur + 150;
    const list = this.areas.filter(A => this._isFree(A.res, a, b) && (sit || A.slots.every(S => this._isFree(S, a, b))));
    return list.length ? s.R.pick(list) : null;
  }
  // moving activities: sweeping up and down the path, running round, hopping back and forth
  _dynPos(d, tau, out) {
    if (d.type === 'loop') { const a = d.ph + d.w * tau; out.xz = [d.cx + Math.sin(a) * d.r, d.cz + Math.cos(a) * d.r]; return out; }
    const L = dist2(d.a[0], d.a[1], d.b[0], d.b[1]) || 1, u = (tau * d.v) / L, f = u - Math.floor(u / 2) * 2, k = f < 1 ? f : 2 - f;
    out.xz = [d.a[0] + (d.b[0] - d.a[0]) * k, d.a[1] + (d.b[1] - d.a[1]) * k];
    return out;
  }

  /* ================= every frame ================= */
  // ms: the shared clock · viewers: [{ x, z }] players on foot nearby (the first is this player)
  update(dt, ms, viewers) {
    if (!this.crowd) return;
    const { day, sod } = istClock(ms);
    if (day !== this.day) this._buildDay(day);
    const near = viewers.some(p => dist2(p.x, p.z, SQUARE.x, SQUARE.z) < 230);
    if (!near) { if (this.visible) { this.crowd.setVisible(false); this.ball.visible = false; if (this.lanternObj) { this.lanternObj.visible = false; this.bubble.visible = false; } for (const n of this.npcs) this._collider(n, false); this.visible = false; } return; }
    if (!this.visible) { this.crowd.setVisible(true); this.ball.visible = true; this.visible = true; }
    this.frame++;
    this.shopNow = false;
    for (const n of this.npcs) { const seg = this._seg(n.i, sod); if (seg.k === 'act' && seg.act === 'shop') this.shopNow = true; }
    this._ballUpdate(sod, dt);
    const o = this._o;
    for (const n of this.npcs) {
      const seg = this._seg(n.i, sod);
      this._state(n, seg, sod, o);
      if (!o.vis) { if (n.shown) { this.crowd.hide(n.kind, n.idx); this._collider(n, false); n.shown = false; n.init = false; } }
      else this._show(n, o, dt, sod, viewers);
      if (n === this.watchman) this._lantern(n, o, viewers, dt);
    }
    this.crowd.commit();
  }
  _seg(i, sod) {
    const L = this.timeline[i];
    let lo = 0, hi = L.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m].t0 <= sod) lo = m; else hi = m - 1; }
    return L[lo];
  }
  // where a villager is and what they're doing at this moment of their plan
  _state(n, seg, sod, o) {
    const tau = sod - seg.t0;
    o.vis = true; o.y = null; o.mode = null; o.act = 'stand'; o.tau = tau; o.item = seg.item || 0; o.carry = seg.carry || 0; o.seatH = 0; o.look = null; o.kick = 0; o.talk = 0; o.talkRole = 0; o.talkSeed = 0; o.run = false; o.face = null; o.walking = false; o.stop = -1;
    if (seg.k === 'in') { o.vis = false; return; }
    if (seg.k === 'patrol') {
      const p = this._patrolAt(this.dayAbs + sod, this._pp || (this._pp = {}));
      o.x = p.x; o.z = p.z; o.face = p.face; o.carry = CARRY.lantern; o.item = ITEM.stick;
      if (p.pause >= 0) { o.act = 'raise'; o.tau = p.pause; o.stop = p.loop * 1000 + p.leg; }
      else o.walking = true;
      return;
    }
    if (seg.k === 'walk') {
      if (!seg.line) seg.line = this.nav.polyline(seg.a, seg.b, seg.P, seg.Q);
      const L = seg.line, T = seg.t1 - seg.t0, v = L.len / Math.max(0.3, T - ACC);
      const t = Math.min(Math.max(tau, 0), T);
      const s = t < ACC ? v * t * t / (2 * ACC) : t > T - ACC ? L.len - v * (T - t) * (T - t) / (2 * ACC) : v * (t - ACC / 2);
      const p = along(L, s, this._a, seg.hint); seg.hint = p.i;
      let x = p.x, z = p.z;
      if (p.lane) { const k = Math.min(1, p.edge / 1.6) * 0.5; x += p.tz * k; z -= p.tx * k; }
      o.x = x; o.z = z; o.face = Math.atan2(p.tx, p.tz); o.run = seg.run; o.walking = true;
      o.y = this._doorY(seg.hA, x, z) ?? this._doorY(seg.hB, x, z);
      return;
    }
    if (seg.k === 'act') {
      o.act = seg.act; o.face = seg.yaw;
      if (seg.dyn) {
        const p = this._dynPos(seg.dyn, tau, this._a).xz; o.x = p[0]; o.z = p[1];
        if (seg.dyn.type === 'loop') { o.act = null; o.run = true; o.face = null; }
        else if (seg.dyn.type === 'hop') o.face = null;
        else o.face = null;
      } else { o.x = seg.x; o.z = seg.z; }
      if (seg.seat) this._sit(o, seg.seat, seg.x, seg.z, tau, seg.t1 - seg.t0, n);
      if (seg.act === 'vend') o.talk = this.shopNow ? 1 : 0;
      if (seg.act === 'watch' && this.ballW) o.face = Math.atan2(this.ballW[0] - o.x, this.ballW[1] - o.z);
      return;
    }
    // a shared plan
    const P = seg.P, j = seg.j, A = P.at[j];
    o.talkRole = j % 2; o.talkSeed = P.seed || 0;
    switch (P.kind) {
      case 'talk': o.x = A.pt[0]; o.z = A.pt[1]; o.face = A.yaw; o.act = 'talk'; break;
      case 'talkSit': case 'watch':
        o.act = P.kind === 'watch' ? 'watchSit' : 'talkSit'; o.face = A.yaw; this._sit(o, A.seat.seat, A.pt[0], A.pt[1], sod - Math.max(P.t0, seg.t0), P.t1 - Math.max(P.t0, seg.t0), n);
        if (P.kind === 'talkSit') o.look = j ? -0.55 : 0.55; else if (this.ballW) o.look = Math.max(-1, Math.min(1, wrap(Math.atan2(this.ballW[0] - o.x, this.ballW[1] - o.z) - A.yaw)));
        break;
      case 'circle': o.x = A.pt[0]; o.z = A.pt[1]; o.face = A.yaw; o.act = Math.floor((sod + (P.seed || 0)) / 26) % 2 ? 'clap' : 'sitGround'; o.y = null; break;
      case 'chase': { const p = chasePos(P.chase, j, sod - P.t0, this._a); o.x = p.x; o.z = p.z; o.run = !p.tag; o.act = p.tag ? 'stand' : null; break; }
      case 'walk': {
        const W = P.walk, t = sod - P.t0 - W.meet;
        if (t < 0) { o.x = A.pt[0]; o.z = A.pt[1]; o.face = A.yaw; o.act = 'talk'; break; }
        const L = W.line, s = Math.min(L.len, t * W.speed), p = along(L, s, this._a, seg.hint || 0); seg.hint = p.i;
        const off = j ? 0.38 : -0.38; o.x = p.x + p.tz * off; o.z = p.z - p.tx * off; o.face = Math.atan2(p.tx, p.tz); o.walking = s < L.len; o.act = s < L.len ? null : 'talk';
        break;
      }
      case 'football': this._football(o, P, j, sod, seg); break;
      default: o.x = A.pt[0]; o.z = A.pt[1];
    }
    // somebody who came late joins in smoothly
    if (seg.arrive && P.kind !== 'talkSit' && P.kind !== 'watch') { const k = sm(c01((sod - seg.t0) / 1.5)); o.x = seg.arrive[0] + (o.x - seg.arrive[0]) * k; o.z = seg.arrive[1] + (o.z - seg.arrive[1]) * k; }
  }
  // sitting down on a seat (from its approach point) and getting up again at the end
  _sit(o, seat, ax, az, tau, T, n) {
    const k = tau < 0.9 ? sm(c01(tau / 0.9)) : tau > T - 0.9 ? sm(c01((T - tau) / 0.9)) : 1;
    o.x = ax + (seat.x - ax) * k; o.z = az + (seat.z - az) * k;
    if (k > 0.25) { o.seatH = seat.h / n.L.sy; o.y = seat.y; }
    else { o.act = 'stand'; }
  }
  _football(o, P, j, sod, seg) {
    const sim = P.sim, pl = playAt(sim, sod), [lx, lz] = moveAt(pl, j, sod), [x, z] = this.field.at(lx, lz);
    o.x = x; o.z = z; o.act = null; o.run = true;
    if (pl.kicker === j && sod > pl.tk - 0.34 && sod < pl.tk + 0.3) { o.act = 'kick'; o.kick = Math.max(-1, Math.min(1, (sod - pl.tk) / 0.32)); o.face = Math.atan2(...this._dirW(pl.ux, pl.uz)); }
    else if (pl.mode === 'cheer' && sod > pl.cheerT - 2.4 && (j % 2) === (pl.scorer % 2)) o.act = 'celebrate';
    if (this.ballW && !o.act) o.face = Math.atan2(this.ballW[0] - x, this.ballW[1] - z);
    if (!o.act) o.act = 'stand';
    o.ball = true;
  }
  _dirW(ux, uz) { const F = this.field, c = Math.cos(F.yaw), s = Math.sin(F.yaw); return [ux * c + uz * s, -ux * s + uz * c]; }
  _doorY(h, x, z) {
    if (!h) return null;
    const [lx, lz] = toLocal(h, x, z);
    if (Math.abs(lx) > 0.9 || lz < h.d2 - 0.4 || lz > h.doorZ + 0.05) return null;
    const floor = h.base + 0.12, top = h.d2 + h.pd;
    if (lz <= top) return floor;
    const [gx, gz] = at(h, 0, h.doorZ), gy = this.T.heightAt(gx, gz);
    return floor + (gy - floor) * c01((lz - top) / (h.doorZ - top));
  }
  // the ball: where the match has it (rolling, turning as it rolls), or resting by the goal between matches
  _ballUpdate(sod, dt) {
    if (!this.field) { this.ball.visible = false; this.ballW = null; return; }
    const P = this.plans.find(q => q.kind === 'football' && sod >= q.t0 && sod < q.t1 + 5);
    let lx = PARK[0], lz = PARK[1];
    if (P) { const b = ballAt(P.sim, sod); lx = b.x; lz = b.z; }
    const [x, z] = this.field.at(lx, lz), y = this.T.heightAt(x, z) + 0.11;
    if (this.lastBall) {
      const dx = x - this.lastBall[0], dz = z - this.lastBall[1], d = Math.hypot(dx, dz);
      if (d > 1e-4 && d < 2) { this._ax.set(dz / d, 0, -dx / d); this._q.setFromAxisAngle(this._ax, d / 0.11); this.ball.quaternion.premultiply(this._q); }
    }
    this.ball.position.set(x, y, z);
    this.lastBall = [x, z]; this.ballW = P ? [x, z] : null;
  }
  // draw one villager: step aside for players and each other, turn smoothly, legs from the real distance moved
  _show(n, o, dt, sod, viewers) {
    // stepping aside (only while walking)
    let fx = 0, fz = 0;
    if (o.walking || o.ball) {
      for (const m of this.npcs) {
        if (m === n || !m.shown) continue;
        const dx = (o.x + n.ox) - m.px, dz = (o.z + n.oz) - m.pz, d2 = dx * dx + dz * dz;
        if (d2 < 0.81 && d2 > 1e-6) { const d = Math.sqrt(d2), k = (0.9 - d) / 0.9; fx += dx / d * k; fz += dz / d * k; }
      }
      for (const p of viewers) {
        const dx = (o.x + n.ox) - p.x, dz = (o.z + n.oz) - p.z, d2 = dx * dx + dz * dz;
        if (d2 < 1.6 && d2 > 1e-6) { const d = Math.sqrt(d2), k = (1.26 - d) / 1.26 * 1.6; fx += dx / d * k; fz += dz / d * k; }
      }
    }
    n.ox += fx * 2.2 * dt; n.oz += fz * 2.2 * dt;
    const decay = Math.exp(-(o.walking ? 1.2 : o.ball ? 2.5 : 4) * dt); n.ox *= decay; n.oz *= decay;
    const ol = Math.hypot(n.ox, n.oz); if (ol > 0.9) { n.ox *= 0.9 / ol; n.oz *= 0.9 / ol; }
    const px = o.x + n.ox, pz = o.z + n.oz;
    // how far it really moved this frame -> speed, step phase, facing
    let d = n.init ? dist2(n.px, n.pz, px, pz) : 0;
    if (d > 2.5) d = 0;
    const spd = dt > 1e-4 ? d / dt : 0;
    n.spd += (spd - n.spd) * (1 - Math.exp(-12 * dt));
    const moving = n.spd > 0.12 && !SEATED.has(o.act) && o.act !== 'kick';
    const run = (o.run && n.spd > 1.6) || n.spd > 2.3;
    const A = run ? 0.82 * c01(n.spd / 3.4) + 0.12 : (n.age === 'elder' ? 0.3 : n.age === 'child' ? 0.48 : 0.42) * c01(n.spd / (n.age === 'elder' ? 0.7 : 1.2));
    if (moving && d > 0) n.anim.phase += Math.PI * d / stepLength(n.S, A, run);
    let face = o.face;
    if (moving && d > 0.004 && (o.walking || o.act === null || o.act === 'stand' || o.act === 'hop' || o.act === 'sweep' || o.ball)) face = Math.atan2(px - n.px, pz - n.pz);
    if (face === null || face === undefined) face = n.yaw;
    if (!n.init) n.yaw = face;
    const yaw0 = n.yaw;
    n.yaw = dampAngle(n.yaw, face, moving ? 9 : 5, dt);
    // turning on the spot: small steps while the body comes round
    const turnRate = dt > 1e-4 ? Math.abs(wrap(n.yaw - yaw0)) / dt : 0;
    n.turn += ((turnRate > 0.7 && !moving && !SEATED.has(o.act) && STEP_TURN.has(o.act || 'stand') ? 1 : 0) - n.turn) * (1 - Math.exp(-8 * dt));
    if (n.turn > 0.05) n.anim.phase += Math.abs(wrap(n.yaw - yaw0)) * 2.6;
    n.px = px; n.pz = pz; n.init = true;
    // look at a player close by (not while busy with a game or a chat)
    let look = o.look;
    if (look === null && !o.ball && o.act !== 'talk' && o.act !== 'talkSit') {
      const p = viewers[0];
      if (p) { const dx = p.x - px, dz = p.z - pz, dd = dx * dx + dz * dz; if (dd < 25 && dd > 0.5) look = Math.max(-1.1, Math.min(1.1, wrap(Math.atan2(dx, dz) - n.yaw))) * 0.9; }
    }
    // the pose (worked out less often far away)
    let far = 1e9;
    for (const p of viewers) { const dd = dist2(p.x, p.z, px, pz); if (dd < far) far = dd; }
    if (!(far > 85 && (this.frame + n.i) % 3)) {
      const st = n.st;
      st.t = sod; st.tau = o.tau; st.lift = 0; st.look = look; st.carry = o.carry; st.item = o.item; st.seatH = o.seatH; st.kick = o.kick; st.talk = o.talk; st.talkRole = o.talkRole; st.talkSeed = o.talkSeed; st.A = A; st.phase = n.anim.phase;
      if (o.act === 'sweep') { st.mode = 'act'; st.act = 'sweep'; st.A = moving ? 0.18 : 0; }
      else if (moving && (o.act === null || o.act === 'stand' || o.act === 'look' || o.act === 'wait' || o.walking)) { st.mode = run ? 'run' : 'walk'; st.act = null; }
      else if (n.turn > 0.3) { st.mode = 'walk'; st.act = null; st.A = 0.2 * n.turn; }
      else { st.mode = 'act'; st.act = o.act || 'stand'; }
      if (o.act === 'kick') { st.mode = 'act'; st.act = 'kick'; }
      if (o.act === 'hop') { st.mode = 'act'; st.act = 'hop'; }
      const rate = targetPose(n.anim.tgt, st);
      n.anim.step(far > 85 ? dt * 3 : dt, rate);
    }
    const y = o.y ?? this.T.heightAt(px, pz);
    n.wy = y;
    this.crowd.set(n.kind, n.idx, px, y, pz, n.yaw, n.L.sx, n.L.sy, n.anim.cur, o.item || 0, o.carry || 0, n.L.hat);
    n.shown = true;
    this._collider(n, true, px, pz);
  }
  // the watchman's lantern hangs from his left hand (worked out from his pose, like the graphics card does) and
  // lights the lane round him; at each stop he blows his whistle, and calls "Jaagte raho!" if you're close
  _lantern(n, o, viewers, dt) {
    const on = n.shown && o.vis && o.carry === CARRY.lantern;
    this.lanternObj.visible = on;
    if (on) {
      const h = this._handL(n);
      this.lanternObj.position.set(h[0], h[1], h[2]); this.lanternObj.rotation.y = n.yaw;
      this.lamp.p.set(h[0], h[1] - 0.18, h[2]);
      if (o.act === 'raise' && o.stop !== this.lastStop && o.tau > 0.4) { this.lastStop = o.stop; if (this.onWhistle) this.onWhistle(n.px, n.pz); this.callT = 4.5; }
    }
    this.callT = Math.max(0, (this.callT || 0) - dt);
    const v = viewers[0], close = on && v && dist2(v.x, v.z, n.px, n.pz) < 16, m = this.bubble.material;
    m.opacity = c01(m.opacity + (close && this.callT > 0 ? dt * 5 : -dt * 3));
    this.bubble.visible = m.opacity > 0.01;
    if (this.bubble.visible) this.bubble.position.set(n.px, (n.wy || 0) + 2.35 * n.L.sy, n.pz);
  }
  // where a villager's left hand is in the world
  _handL(n) {
    const S = n.S, P = this.piv[n.kind], c = n.anim.cur, p = [P[4][0], P[4][1] - S.fore - 0.01, 0.005];
    rotX(p, P[4], c[7]);
    rotZ(p, P[3], c[6]); rotX(p, P[3], c[5]);
    rotY(p, P[1], c[2]); rotX(p, P[1], c[1]);
    p[1] += c[0];
    const x = p[0] * n.L.sx, y = p[1] * n.L.sy, z = p[2] * n.L.sx, cy = Math.cos(n.yaw), sy = Math.sin(n.yaw);
    return [n.px + cy * x + sy * z, (n.wy || 0) + y, n.pz - sy * x + cy * z];
  }
  // players bump into villagers
  _collider(n, on, x, z) {
    const W = this.W;
    if (!on) { if (n.col) { W.removeCollider(n.col); n.col = null; } return; }
    if (!n.col) { n.col = W.addCollider({ x, z, r: 0.28, npc: true }); return; }
    const cell = W._cell(x, z);
    n.col.x = x; n.col.z = z;
    if (cell !== n.col.cell) { W.removeCollider(n.col); W.addCollider(n.col); }
  }
  // (for tests and the next phase) what somebody is doing now
  describe(i, ms) { const { sod } = istClock(ms), seg = this._seg(i, sod), n = this.npcs[i]; return { age: n.age, role: n.role, home: n.home.spec.name, kind: seg.k, act: seg.act || (seg.P && seg.P.kind) || (seg.k === 'patrol' ? 'patrol' : null) }; }
}
