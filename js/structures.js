import * as THREE from 'three';
import { GeoBuilder, MAT, clamp } from './utils.js';
import { TOWER_ZONE, GIANT } from './terrain.js';
import { audio } from './audio.js';

// Things the team designs and builds: watchtowers (Watchtower Valley) and the stone castle wall (Giant Plateau).
// Designs come from the designer (designer.js); this file turns them into real, climbable, breakable buildings.
export const FLOOR = 2.8, MAX_SLOTS = 4;
export const TSIZE = {
  s: { name: 'Small', half: 1.5, maxF: 2, slots: 1, logs: 2, planks: 3, rope: 1, stone: 3, hp: 240 },
  m: { name: 'Medium', half: 2.25, maxF: 3, slots: 2, logs: 3, planks: 5, rope: 2, stone: 5, hp: 380 },
  b: { name: 'Big', half: 3.25, maxF: 4, slots: 4, logs: 4, planks: 8, rope: 2, stone: 8, hp: 560 },
};
export const towerHp = t => Math.round(TSIZE[t.size].hp * (1 + 0.25 * (t.floors - 1)) * (t.stone ? 1.6 : 1));
export function towerCost(d) {
  const c = { logs: 0, planks: 0, rope: 0, stone: 0 };
  for (const t of d.towers) { const S = TSIZE[t.size]; c.logs += S.logs * t.floors; c.planks += S.planks * t.floors; c.rope += S.rope; if (t.stone) c.stone += S.stone; }
  return c;
}
export const slotsUsed = d => d.towers.reduce((n, t) => n + TSIZE[t.size].slots, 0);
// problems with a tower layout (empty = fine)
export function towerProblems(d) {
  const out = [];
  if (!d.towers.length) out.push('Add at least one tower');
  if (slotsUsed(d) > MAX_SLOTS) out.push('Too many towers (4 small, 2 medium or 1 big)');
  d.towers.forEach((t, i) => {
    const h = TSIZE[t.size].half;
    if (Math.abs(t.x) > TOWER_ZONE.hw - h || Math.abs(t.z) > TOWER_ZONE.hd - h) out.push(`Tower ${i + 1} is outside the building zone`);
    d.towers.forEach((u, j) => { if (j > i && Math.abs(t.x - u.x) < h + TSIZE[u.size].half + 1.2 && Math.abs(t.z - u.z) < h + TSIZE[u.size].half + 1.2) out.push(`Towers ${i + 1} and ${j + 1} are too close (leave room for the ladders)`); });
  });
  return out;
}

// castle: a closed ring of wall segments around the plateau (points are relative to its centre)
export function wallSegs(d) {
  const n = d.pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = d.pts[i], b = d.pts[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    out.push({ i, ax: a[0], az: a[1], bx: b[0], bz: b[1], len, gate: i === d.gate });
  }
  return out;
}
export const wallThick = d => (d.thick ? 1.6 : 1.0);
export const wallHp = (d, s) => Math.round(s.gate ? s.len * 30 : s.len * (d.h / 3) * 45 * (d.thick ? 1.6 : 1));
export function castleCost(d) {
  const c = { logs: 0, planks: 0, rope: 0, stone: 0 };
  for (const s of wallSegs(d)) {
    if (s.gate) { c.logs += 6; c.planks += 6; }
    else c.stone += s.len * 0.55 * (d.h / 3) * (d.thick ? 1.5 : 1);
  }
  if (d.turrets) c.stone += 4 * d.pts.length;
  c.stone = Math.ceil(c.stone);
  return c;
}
export function castleProblems(d) {
  const out = [];
  if (d.pts.length < 3) out.push('A wall needs at least 3 corners');
  if (d.pts.some(p => Math.hypot(p[0], p[1]) > GIANT.r + 0.01)) out.push('Keep every corner inside the plateau boundary');
  for (const s of wallSegs(d)) {
    if (s.len < 3) out.push(`Wall ${s.i + 1} is too short`);
    if (s.gate && s.len < 5) out.push('The gate wall must be at least 5 m long');
  }
  return [...new Set(out)];
}

const C = { log: 0x6e4a2a, logLt: 0x8a5a33, plank: 0xa0703f, plankDk: 0x84592f, rope: 0xc9a66b, stone: 0x8d8a82, stoneDk: 0x726f68, stoneLt: 0xa29f96, banner: 0xc0392b, gold: 0xe8c45a };
const _v = new THREE.Vector3();

export class Structures {
  constructor(scene, world, toast) {
    this.scene = scene; this.world = world; this.toast = toast;
    this.towers = []; this.walls = []; this.turrets = [];
    this.tDesign = null; this.cDesign = null;
    this.fx = []; this.player = null; this.onChange = null;
    this._acts = [];
    world.surfaces.push(this);
    world.constrain = p => this.constrain(p);
  }
  get anyTowers() { return this.towers.some(t => t.alive); }
  get anyWalls() { return this.walls.some(w => w.alive); }

  /* ---------------- building ---------------- */
  buildTowers(d, instant = false) {
    if (this.tDesign) return;
    this.tDesign = JSON.parse(JSON.stringify(d));
    d.towers.forEach((t, i) => {
      const S = TSIZE[t.size], x = TOWER_ZONE.x + t.x, z = TOWER_ZONE.z + t.z, y = this.world.heightAt(x, z);
      const T = { kind: 't', i, size: t.size, floors: t.floors, stone: !!t.stone, x, z, y, half: S.half, top: y + t.floors * FLOOR + 0.12,
        max: towerHp(t), hp: towerHp(t), alive: true, colliders: [], rise: instant ? 1 : 0 };
      T.group = this._towerMesh(T);
      T.group.position.set(x, y - (instant ? 0 : T.top - y), z);
      this.scene.add(T.group);
      const h = S.half;
      for (const [cx, cz] of [[-h, -h], [h, -h], [-h, h], [h, h], [0, h], [h, 0], [-h, 0]]) T.colliders.push(this.world.addCollider({ x: x + cx, z: z + cz, r: 0.32, struct: T }));
      T.ladderBase = new THREE.Vector3(x, y, z - h - 0.75);
      T.ladderTop = new THREE.Vector3(x, T.top, z - h + 0.55);
      T.bar = hpBar(); T.bar.position.set(x, T.top + 1.6, z); this.scene.add(T.bar);
      this.towers.push(T);
    });
    if (!instant) audio.thud(90, 0.4);
    this._changed();
  }

  buildCastle(d, instant = false) {
    if (this.cDesign) return;
    this.cDesign = JSON.parse(JSON.stringify(d));
    const th = wallThick(d), y = this.world.heightAt(GIANT.x, GIANT.z);
    for (const s of wallSegs(d)) {
      const ax = GIANT.x + s.ax, az = GIANT.z + s.az, bx = GIANT.x + s.bx, bz = GIANT.z + s.bz;
      const dx = (bx - ax) / s.len, dz = (bz - az) / s.len;
      // inward normal: towards the plateau centre
      let nx = -dz, nz = dx;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if ((GIANT.x - mx) * nx + (GIANT.z - mz) * nz < 0) { nx = -nx; nz = -nz; }
      const W = { kind: 'w', i: s.i, gate: s.gate, ax, az, bx, bz, dx, dz, nx, nz, len: s.len, mx, mz, y, h: d.h, t: th,
        max: wallHp(d, s), hp: wallHp(d, s), alive: true, colliders: [], rise: instant ? 1 : 0 };
      W.group = this._wallMesh(W);
      W.group.position.set(mx, y - (instant ? 0 : d.h + 1), mz);
      // battlements sit on local -x: turn the wall so that side faces outwards
      W.group.rotation.y = Math.atan2(dx, dz) + ((dz * nx - dx * nz) < 0 ? Math.PI : 0);
      this.scene.add(W.group);
      const n = Math.ceil(s.len / 0.9);
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n, along = f * s.len;
        if (s.gate && along > 1.1 && along < s.len - 1.1) continue;      // the gate opening
        W.colliders.push(this.world.addCollider({ x: ax + dx * along, z: az + dz * along, r: th / 2 + 0.08, struct: W }));
      }
      W.bar = hpBar(); W.bar.position.set(mx, y + d.h + 1.4, mz); this.scene.add(W.bar);
      this.walls.push(W);
    }
    if (d.turrets) for (const p of d.pts) {
      const x = GIANT.x + p[0], z = GIANT.z + p[1], b = new GeoBuilder();
      b.cyl(1.35, 1.5, d.h + 1.4, 8, 0, (d.h + 1.4) / 2, 0, C.stone);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; b.box(0.5, 0.5, 0.5, Math.cos(a) * 1.25, d.h + 1.65, Math.sin(a) * 1.25, C.stoneLt, 'solid', 0, -a, 0); }
      b.cyl(0.3, 0.2, 0.4, 6, 0, d.h + 1.6, 0, 0x4a3a2a);
      const g = b.build(); g.position.set(x, y - (instant ? 0 : d.h + 2), z); this.scene.add(g);
      const fl = flame(); fl.position.set(0, d.h + 1.95, 0); g.add(fl);
      this.turrets.push({ x, z, y, g, top: y + d.h + 1.4, rise: instant ? 1 : 0, h: d.h + 2, c: this.world.addCollider({ x, z, r: 1.45 }) });
    }
    if (!instant) audio.thud(70, 0.5);
    this._changed();
  }

  _towerMesh(T) {
    const b = new GeoBuilder(), h = T.half, top = T.floors * FLOOR;
    if (T.stone) {                                                    // stone foundation
      b.box(h * 2 + 0.5, 1.3, h * 2 + 0.5, 0, 0.65, 0, C.stone);
      for (let k = -1; k <= 1; k += 2) b.box(h * 2 + 0.52, 0.08, h * 2 + 0.52, 0, 0.65 + k * 0.32, 0, C.stoneDk);
    }
    for (const [cx, cz] of [[-h, -h], [h, -h], [-h, h], [h, h]]) b.cyl(0.17, 0.22, top + 1.05, 6, cx, (top + 1.05) / 2, cz, C.log);
    for (let f = 1; f <= T.floors; f++) {
      const fy = f * FLOOR;
      b.box(h * 2 + 0.3, 0.18, h * 2 + 0.3, 0, fy, 0, f % 2 ? C.plank : C.plankDk);
      for (let k = -h + 0.3; k < h; k += 0.6) b.box(0.03, 0.19, h * 2 + 0.28, k, fy + 0.005, 0, C.plankDk);
      // cross bracing below each floor
      for (const sd of [-1, 1]) {
        b.box(0.12, 0.12, Math.hypot(h * 2, FLOOR) , sd * h, fy - FLOOR / 2, 0, C.logLt, 'solid', Math.atan2(h * 2, FLOOR) * (f % 2 ? 1 : -1), 0, 0);
        b.box(Math.hypot(h * 2, FLOOR), 0.12, 0.12, 0, fy - FLOOR / 2, sd * h, C.logLt, 'solid', 0, 0, Math.atan2(FLOOR, h * 2) * (f % 2 ? -1 : 1));
      }
    }
    // railing around the top (open at the ladder)
    for (const sd of [-1, 1]) {
      b.box(h * 2 + 0.2, 0.1, 0.1, 0, top + 0.95, sd * h, C.logLt);
      b.box(0.1, 0.1, h * 2 + 0.2, sd * h, top + 0.95, 0, C.logLt);
      b.box(h * 2 + 0.2, 0.08, 0.08, 0, top + 0.5, h, C.log);
      b.box(0.08, 0.08, h * 2 + 0.2, sd * h, top + 0.5, 0, C.log);
    }
    // ladder on the south side
    for (const sd of [-0.32, 0.32]) b.box(0.08, top + 0.9, 0.08, sd, (top + 0.9) / 2, -h - 0.35, C.log);
    for (let ry = 0.35; ry < top + 0.8; ry += 0.42) b.box(0.66, 0.06, 0.06, 0, ry, -h - 0.35, C.plankDk);
    // banner + torch on top
    b.cyl(0.04, 0.04, 2.2, 5, h - 0.1, top + 1.1 + 0.5, h - 0.1, 0xb9bec4);
    b.box(0.04, 0.8, 0.6, h - 0.1, top + 1.95, h + 0.22, C.banner);
    b.box(0.045, 0.12, 0.62, h - 0.1, top + 1.53, h + 0.22, C.gold);
    const g = b.build();
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const fl = flame(); fl.position.set(-h + 0.1, top + 1.15, -h + 0.1); g.add(fl);
    return g;
  }

  _wallMesh(W) {
    const b = new GeoBuilder(), L = W.len, H = W.h, t = W.t;   // local: z along the wall, x across (+x = ...)
    if (W.gate) {
      for (const sd of [-1, 1]) {
        b.box(t + 0.3, H + 0.8, 1.1, 0, (H + 0.8) / 2, sd * (L / 2 - 0.55), C.stone);
        b.box(t + 0.5, 0.4, 1.3, 0, H + 1.0, sd * (L / 2 - 0.55), C.stoneLt);
      }
      b.box(t * 0.6, 0.6, L - 1.6, 0, H + 0.2, 0, C.log);                               // lintel beam
      for (const sd of [-1, 1]) {                                                         // open wooden doors
        b.group(0, 0, sd * (L / 2 - 1.1), 0, sd * 1.25, 0, () => {
          b.box(0.18, H - 0.3, (L - 2.2) / 2, 0, (H - 0.3) / 2, -sd * (L - 2.2) / 4, C.plank);
          for (const yy of [0.6, H - 1]) b.box(0.22, 0.16, (L - 2.2) / 2, 0, yy, -sd * (L - 2.2) / 4, C.log);
        });
      }
      b.box(0.06, 1.2, 0.8, -(t / 2 + 0.2), H - 0.2, L / 2 - 0.55, C.banner);
    } else {
      b.box(t, H, L, 0, H / 2, 0, C.stone);
      // block courses
      for (let yy = 0.6; yy < H; yy += 0.7) b.box(t + 0.03, 0.06, L + 0.01, 0, yy, 0, C.stoneDk);
      for (let zz = -L / 2 + 0.9; zz < L / 2 - 0.4; zz += 1.8) for (let yy = 0.3; yy < H - 0.3; yy += 1.4) b.box(t + 0.04, 0.64, 0.05, 0, yy, zz + ((yy * 10) % 2 ? 0.9 : 0), C.stoneDk);
      // walkway + battlements on the outer edge
      b.box(t + 0.1, 0.12, L, 0, H + 0.06, 0, C.stoneLt);
      for (let zz = -L / 2 + 0.5; zz < L / 2 - 0.3; zz += 1.2) b.box(0.35, 0.6, 0.6, -(t / 2 - 0.12), H + 0.42, zz, C.stone);
      if (L > 7) { b.box(0.05, 1.4, 0.9, -(t / 2 + 0.03), H - 0.9, 0, C.banner); b.box(0.06, 0.25, 0.92, -(t / 2 + 0.04), H - 0.3, 0, C.gold); }
    }
    const g = b.build();
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /* ---------------- standing on top ---------------- */
  // world.groundAt asks every surface: tower floors and wall tops are walkable
  surfaceAt(x, z, y) {
    let best = null;
    for (const T of this.towers) {
      if (!T.alive || T.rise < 1 || Math.abs(x - T.x) > T.half + 0.1 || Math.abs(z - T.z) > T.half + 0.1) continue;
      for (let f = T.floors; f >= 1; f--) { const fy = T.y + f * FLOOR + 0.1; if (fy <= y + 0.7) { if (best === null || fy > best) best = fy; break; } }
    }
    for (const W of this.walls) {
      if (!W.alive || W.gate || W.rise < 1) continue;
      const rx = x - W.ax, rz = z - W.az, along = rx * W.dx + rz * W.dz, perp = rx * W.nx + rz * W.nz;
      if (along < -0.2 || along > W.len + 0.2 || Math.abs(perp) > W.t / 2 + 0.05) continue;
      const fy = W.y + W.h + 0.12;
      if (fy <= y + 0.7 && (best === null || fy > best)) best = fy;
    }
    for (const Tu of this.turrets) if (Tu.rise >= 1 && Math.hypot(x - Tu.x, z - Tu.z) < 1.3 && Tu.top <= y + 0.7) best = Math.max(best ?? -1e9, Tu.top);
    return best;
  }
  // keep players on a tower top / wall walkway (no accidental falls)
  constrain(p) {
    for (const T of this.towers) {
      if (!T.alive || p.y < T.y + FLOOR - 0.5 || Math.abs(p.x - T.x) > T.half + 0.6 || Math.abs(p.z - T.z) > T.half + 0.6) continue;
      const m = T.half - 0.3; p.x = clamp(p.x, T.x - m, T.x + m); p.z = clamp(p.z, T.z - m, T.z + m);
      return;
    }
    let best = null, bd = 1e9;
    for (const W of this.walls) {
      if (!W.alive || W.gate || p.y < W.y + W.h - 0.6) continue;
      const rx = p.x - W.ax, rz = p.z - W.az, along = rx * W.dx + rz * W.dz, perp = rx * W.nx + rz * W.nz;
      if (along < -0.8 || along > W.len + 0.8 || Math.abs(perp) > W.t / 2 + 0.9) continue;
      if (Math.abs(perp) < bd) { bd = Math.abs(perp); best = { W, along, perp }; }
    }
    if (best) {
      const { W, along } = best, m = Math.max(0.05, W.t / 2 - 0.22), perp = clamp(best.perp, -m, m);
      p.x = W.ax + W.dx * along + W.nx * perp; p.z = W.az + W.dz * along + W.nz * perp;
    }
  }
  towerAt(p) {
    for (const T of this.towers) if (T.alive && p.y > T.y + FLOOR - 0.6 && Math.abs(p.x - T.x) < T.half + 0.4 && Math.abs(p.z - T.z) < T.half + 0.4) return T.i;
    return -1;
  }
  wallAt(p) {
    for (const W of this.walls) {
      if (!W.alive || W.gate || p.y < W.y + W.h - 0.6) continue;
      const rx = p.x - W.ax, rz = p.z - W.az, along = rx * W.dx + rz * W.dz, perp = rx * W.nx + rz * W.nz;
      if (along > -0.5 && along < W.len + 0.5 && Math.abs(perp) < W.t / 2 + 0.4) return W.i;
    }
    return -1;
  }
  // distance from a point to a tower's footprint (zombies attack when close)
  towerDist(i, x, z) { const T = this.towers[i]; if (!T) return 1e9; return Math.hypot(Math.max(Math.abs(x - T.x) - T.half, 0), Math.max(Math.abs(z - T.z) - T.half, 0)); }
  // nearest standing wall segment to a point: { W, d }
  nearestWall(x, z) {
    let best = null, bd = 1e9;
    for (const W of this.walls) {
      if (!W.alive) continue;
      const rx = x - W.ax, rz = z - W.az, along = clamp(rx * W.dx + rz * W.dz, 0, W.len);
      const d = Math.hypot(x - (W.ax + W.dx * along), z - (W.az + W.dz * along)) - W.t / 2;
      if (d < bd) { bd = d; best = W; }
    }
    return best ? { W: best, d: bd } : null;
  }
  // does a straight piece of a boulder's flight (a -> b) hit a standing wall? returns the wall or null
  wallHit(a, b) {
    for (const W of this.walls) {
      if (!W.alive) continue;
      const top = W.y + W.h + 0.4;
      for (let k = 0; k <= 4; k++) {
        const f = k / 4, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
        if (y > top || y < W.y - 0.5) continue;
        const rx = x - W.ax, rz = z - W.az, along = rx * W.dx + rz * W.dz, perp = rx * W.nx + rz * W.nz;
        if (along > -0.3 && along < W.len + 0.3 && Math.abs(perp) < W.t / 2 + 0.5) {
          if (W.gate && along > 1.1 && along < W.len - 1.1 && y < W.y + W.h - 0.3) continue;   // through the open gate
          return W;
        }
      }
    }
    return null;
  }
  inCastle(x, z) {
    if (!this.cDesign) return false;
    const P = this.cDesign.pts; let inside = false;
    const px = x - GIANT.x, pz = z - GIANT.z;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, zi] = P[i], [xj, zj] = P[j];
      if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /* ---------------- damage / repair (host decides, everyone shows) ---------------- */
  damage(kind, i, dmg) {
    const S = (kind === 't' ? this.towers : this.walls)[i];
    if (!S || !S.alive) return false;
    S.hp = Math.max(0, S.hp - dmg);
    if (S.hp <= 0) { this._collapse(S); return true; }
    this._changed();
    return false;
  }
  repair(kind, i, amount) {
    const S = (kind === 't' ? this.towers : this.walls)[i];
    if (!S || !S.alive) return false;
    S.hp = Math.min(S.max, S.hp + amount);
    this._changed();
    return true;
  }
  // structure next to the player that needs fixing: { kind, i, S }
  damagedNear(p, maxD = 1.9) {
    for (const T of this.towers) if (T.alive && T.hp < T.max && this.towerDist(T.i, p.x, p.z) < maxD && Math.abs(p.y - T.y) < 1.5) return { kind: 't', i: T.i, S: T };
    const n = this.nearestWall(p.x, p.z);
    if (n && n.d < maxD && n.W.hp < n.W.max && Math.abs(p.y - n.W.y) < n.W.h + 1) return { kind: 'w', i: n.W.i, S: n.W };
    return null;
  }
  _collapse(S) {
    S.alive = false; S.hp = 0; S.fall = 0;
    for (const c of S.colliders) this.world.removeCollider(c);
    S.colliders = [];
    S.bar.visible = false;
    audio.thud(55, 0.6); audio.thud(80, 0.4);
    this.toast(S.kind === 't' ? `💥 Tower ${S.i + 1} collapsed!` : S.gate ? '💥 The gate was smashed!' : '💥 A castle wall broke!');
    this._changed();
  }
  state() { return { th: this.towers.map(t => Math.round(t.hp)), wh: this.walls.map(w => Math.round(w.hp)) }; }
  applyState(d) {
    if (!d) return;
    (d.th || []).forEach((hp, i) => { const T = this.towers[i]; if (!T) return; if (hp <= 0 && T.alive) this._collapse(T); else if (T.alive) T.hp = hp; });
    (d.wh || []).forEach((hp, i) => { const W = this.walls[i]; if (!W) return; if (hp <= 0 && W.alive) this._collapse(W); else if (W.alive) W.hp = hp; });
    this._changed();
  }
  save() { return { td: this.tDesign, cd: this.cDesign, ...this.state() }; }
  load(s) {
    if (!s) return;
    if (s.td) this.buildTowers(s.td, true);
    if (s.cd) this.buildCastle(s.cd, true);
    this.applyState(s);
  }
  _changed() { this._bars = true; this.onChange && this.onChange(); }

  /* ---------------- climbing ---------------- */
  acts() {
    const l = this._acts, p = this.player; l.length = 0;
    if (!p) return l;
    for (const T of this.towers) {
      if (!T.alive || T.rise < 1) continue;
      if (!T.act) {
        T.act = { pos: T.ladderBase, r: 1.5, label: () => `Climb tower ${T.i + 1} (${T.floors} floor${T.floors > 1 ? 's' : ''})`, act: () => this._climbTower(T, true) };
        T.actDown = { pos: T.ladderTop, r: T.half + 0.8, label: () => 'Climb down the ladder', act: () => this._climbTower(T, false) };
      }
      l.push(T.act, T.actDown);
    }
    for (const W of this.walls) {
      if (!W.alive || W.gate || W.rise < 1) continue;
      if (!W.act) {
        const o = W.t / 2 + 0.75;
        W.act = { pos: new THREE.Vector3(W.mx + W.nx * o, W.y, W.mz + W.nz * o), r: Math.min(W.len / 2, 3.2), label: () => 'Climb up onto the wall', act: () => this._climbWall(W, true) };
      }
      l.push(W.act);
    }
    // on a wall top: climb down (inside) from wherever you are
    const wi = this.wallAt(p.pos);
    if (wi >= 0 && p.mode === 'foot') {
      const W = this.walls[wi];
      this._down = this._down || { pos: new THREE.Vector3(), r: 2, label: () => 'Climb down (inside the castle)', act: () => this._climbWall(this._downW, false) };
      this._downW = W; this._down.pos.set(p.pos.x, p.pos.y, p.pos.z);
      l.push(this._down);
    }
    return l;
  }
  _climbTower(T, up) {
    const p = this.player, V = (x, y, z) => new THREE.Vector3(x, y, z);
    if (up) {
      p.startTween([V(T.x, T.y, T.z - T.half - 0.7)], { dur: 0.4, yaw: 0, done: () => {
        p.startTween([V(T.x, T.top - 0.9, T.z - T.half - 0.62)], { dur: Math.max(1.2, (T.top - T.y) / 2.4), anim: 'climb', yaw: 0, done: () => {
          p.startTween([V(T.x, T.top, T.z - T.half + 0.6)], { dur: 0.5, yaw: 0, done: () => { p.mode = 'foot'; p.grounded = true; p.vy = 0; } });
        } });
      } });
    } else {
      p.startTween([V(T.x, T.top, T.z - T.half + 0.25), V(T.x, T.top - 0.9, T.z - T.half - 0.62)], { dur: 0.7, yaw: 0, done: () => {
        p.startTween([V(T.x, T.y, T.z - T.half - 0.7)], { dur: Math.max(1.2, (T.top - T.y) / 2.4), anim: 'climb', yaw: 0, done: () => { p.mode = 'foot'; p.grounded = true; p.vy = 0; p.yaw = Math.PI; } });
      } });
    }
  }
  _climbWall(W, up) {
    const p = this.player, o = W.t / 2 + 0.45;
    const along = clamp((p.pos.x - W.ax) * W.dx + (p.pos.z - W.az) * W.dz, 0.6, W.len - 0.6);
    const bx = W.ax + W.dx * along, bz = W.az + W.dz * along, face = Math.atan2(-W.nx, -W.nz);
    const ground = new THREE.Vector3(bx + W.nx * o, W.y, bz + W.nz * o), hang = new THREE.Vector3(bx + W.nx * o, W.y + W.h - 0.9, bz + W.nz * o), top = new THREE.Vector3(bx, W.y + W.h + 0.12, bz);
    const dur = Math.max(1, W.h / 2.6);
    if (up) p.startTween([ground], { dur: 0.35, yaw: face, done: () => p.startTween([hang], { dur, anim: 'climb', yaw: face, done: () => p.startTween([top], { dur: 0.45, yaw: face, done: () => { p.mode = 'foot'; p.grounded = true; p.vy = 0; } }) }) });
    else p.startTween([hang], { dur: 0.5, yaw: face, done: () => p.startTween([ground], { dur, anim: 'climb', yaw: face, done: () => { p.mode = 'foot'; p.grounded = true; p.vy = 0; p.yaw = face + Math.PI; } }) });
  }

  /* ---------------- per frame ---------------- */
  update(dt, camPos) {
    for (const S of [...this.towers, ...this.walls]) {
      if (S.rise < 1) {   // rising out of the ground when built
        S.rise = Math.min(1, S.rise + dt / 2.5);
        const k = 1 - Math.pow(1 - S.rise, 3), h = S.kind === 't' ? S.top - S.y : S.h + 1;
        S.group.position.y = S.y - h * (1 - k);
        if (S.rise >= 1) S.group.position.y = S.y;
      }
      if (!S.alive && S.fall !== undefined && S.fall < 1) {   // collapsing
        S.fall = Math.min(1, S.fall + dt / 1.6);
        const k = S.fall * S.fall;
        S.group.rotation.x = (S.kind === 't' ? 0.9 : 0.25) * k * (S.i % 2 ? 1 : -1);
        S.group.position.y = S.y - (S.kind === 't' ? S.top - S.y : S.h) * 0.75 * k;
        if (S.fall >= 1) { S.group.visible = false; this._rubble(S); }
      }
    }
    for (const Tu of this.turrets) if (Tu.rise < 1) { Tu.rise = Math.min(1, Tu.rise + dt / 2.5); Tu.g.position.y = Tu.y - Tu.h * (1 - (1 - Math.pow(1 - Tu.rise, 3))); }
    if (this._bars) {
      this._bars = false;
      for (const S of [...this.towers, ...this.walls]) if (S.alive) drawBar(S.bar, S.hp / S.max, S.kind === 't' ? `Tower ${S.i + 1}` : S.gate ? 'Gate' : 'Wall');
    }
    for (const S of [...this.towers, ...this.walls]) if (S.alive) S.bar.visible = S.hp < S.max && (!camPos || camPos.distanceToSquared(S.bar.position) < 70 * 70);
  }
  _rubble(S) {
    const b = new GeoBuilder(), n = S.kind === 't' ? 7 : Math.ceil(S.len / 1.4);
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n, x = S.kind === 't' ? S.x + (Math.random() - 0.5) * S.half * 2 : S.ax + (S.bx - S.ax) * f, z = S.kind === 't' ? S.z + (Math.random() - 0.5) * S.half * 2 : S.az + (S.bz - S.az) * f;
      if (S.kind === 't') b.box(0.3, 0.3, S.half * 2, x - S.x, 0.15, z - S.z, C.log, 'solid', 0, Math.random() * 3, 0);
      else b.add(new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.4, 0), Math.random() > 0.5 ? C.stone : C.stoneDk, x - S.mx, 0.3, z - S.mz, Math.random(), Math.random(), 0);
    }
    const g = b.build(); g.position.set(S.kind === 't' ? S.x : S.mx, S.y, S.kind === 't' ? S.z : S.mz);
    this.scene.add(g);
  }
}

/* ---------- small helpers ---------- */
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa030 });
let flameId = 0;
function flame() {
  const b = new GeoBuilder();
  b.add(new THREE.ConeGeometry(0.16, 0.42, 5), 0xff8a1e, 0, 0.2, 0);
  b.add(new THREE.ConeGeometry(0.09, 0.28, 5), 0xffd23a, 0, 0.16, 0);
  const g = b.build({ solid: flameMat });
  g.traverse(o => { o.castShadow = false; });
  g.id2 = flameId++;
  return g;
}
function hpBar() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1); s.renderOrder = 5; s.visible = false; s.userData = { c, t };
  return s;
}
function drawBar(s, k, label) {
  const { c, t } = s.userData, g = c.getContext('2d');
  g.clearRect(0, 0, 128, 32);
  g.fillStyle = 'rgba(15,16,22,.8)'; g.fillRect(2, 14, 124, 14);
  g.fillStyle = k > 0.5 ? '#5bd16a' : k > 0.25 ? '#f2c14e' : '#ff5a4a'; g.fillRect(4, 16, 120 * Math.max(0, k), 10);
  g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.textAlign = 'center'; g.fillText(`${label} ${Math.round(k * 100)}%`, 64, 11);
  t.needsUpdate = true;
}
