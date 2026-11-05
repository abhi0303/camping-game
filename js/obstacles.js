import * as THREE from 'three';
import { GeoBuilder, MAT, rand } from './utils.js';
import { audio } from './audio.js';
import { fallenTreeHalf, lumpGeo } from './flora.js';

const TOOL = { tree: ['chainsaw', 'axe'], rock: ['sledge'], pile: ['sledge'] };
const POWER = { chainsaw: 2, axe: 1, sledge: 1 };
const HP = { tree: 8, rock: 6, pile: 4 };
const GIVE = { tree: ['logs', 4], rock: ['stone', 4], pile: ['stone', 3] };
const NAME = { tree: 'Fallen tree', rock: 'Rockfall', pile: 'Boulders' };

// Road blocks: fallen trees (chainsaw / axe) and rocks (sledgehammer).
export class Obstacles {
  constructor(scene, world, materials, toast) {
    this.scene = scene; this.world = world; this.materials = materials; this.toast = toast;
    this.list = []; this.fx = []; this.net = null; this.onChange = null;
    const r = world.T.road, sA = r.sA, sB = r.sB;
    const at = (s, off = 0) => { const p = r.pointAt(s); return { x: p.x + p.tz * off, z: p.z - p.tx * off, tx: p.tx, tz: p.tz }; };
    this._add('tree', at(95), 0.25);
    this._add('rock', at(sA * 0.66));
    this._add('pile', at(sA - 34, 10));
    this._add('pile', at(sA - 60, -11));
    this._add('tree', at(sB + 62), -0.3);
    this._add('rock', at(sB + (r.sCamp - sB) * 0.62));
    // highlands: road blocks on the way north + stone piles at the plateau (stone for the castle)
    const sC = r.sCamp, sV = r.sValley, sG = r.sGiant;
    this._add('tree', at(sC + 70), 0.2);
    this._add('rock', at(sC + (sV - sC) * 0.62));
    this._add('tree', at(sV + 60), -0.25);
    this._add('rock', at(sV + (sG - sV) * 0.55));
    for (const [ds, off] of [[30, 15], [30, -15], [58, 13], [58, -13], [12, 22], [12, -22]]) this._add('pile', at(sG - ds, off));
  }

  _add(type, p, skew = 0) {
    const y = this.world.heightAt(p.x, p.z);
    const g = new THREE.Group();
    g.position.set(p.x, y, p.z);
    g.rotation.y = Math.atan2(p.tx, p.tz) + skew;         // local X runs across the road
    const o = { type, pos: new THREE.Vector3(p.x, y, p.z), group: g, parts: [], colliders: [], hp: HP[type], state: 'blocking', t: 0 };
    if (type === 'tree') this._tree(o); else this._rocks(o, type === 'pile' ? 3 : 5);
    g.updateMatrixWorld(true);
    for (const c of o.colliders) { const w = new THREE.Vector3(c.lx, 0, c.lz).applyMatrix4(g.matrixWorld); c.x = w.x; c.z = w.z; this.world.addCollider(c); }
    this.scene.add(g);
    this.list.push(o);
  }

  _tree(o) {
    for (const side of [-1, 1]) {
      const b = new GeoBuilder(), jit = [rand(-0.2, 0.2), rand(-0.2, 0.2), rand(-0.2, 0.2), rand(-0.2, 0.2)];   // (4 numbers a side, as always)
      fallenTreeHalf(b, side, jit);                   // root plate on one side, the crown on the other (js/flora.js)
      const part = b.build(); part.userData.side = side;
      o.group.add(part); o.parts.push(part);
    }
    for (let x = -5.5; x <= 5.5; x += 1.0) o.colliders.push({ lx: x, lz: 0, r: 0.75, obstacle: o });
  }

  _rocks(o, n) {
    for (let i = 0; i < n; i++) {
      const s = o.type === 'pile' ? rand(0.8, 1.2) : rand(0.9, 1.5), lx = (i - (n - 1) / 2) * 2.0 + rand(-0.3, 0.3), lz = rand(-0.8, 0.8);
      const b = new GeoBuilder(), rx = rand(0, 3), ry = rand(0, 3);
      b.add(lumpGeo(1, 0.16, 300 + i * 7 + Math.round(s * 10)), i % 2 ? 0xa3a8b1 : 0xb2b7c0, 0, s * 0.62, 0, rx * 0.15, ry, 0, 'solid', s * 1.1, s * 0.85, s);
      b.add(lumpGeo(0, 0.14, 400 + i), 0x8a909a, s * 0.85, 0.16, s * 0.5, 0, ry, 0, 'solid', s * 0.34, s * 0.28, s * 0.32);
      b.add(lumpGeo(0, 0.14, 500 + i), 0x969ca6, -s * 0.7, 0.1, -s * 0.45, 0.3, rx, 0, 'solid', s * 0.2, s * 0.17, s * 0.2);
      const part = b.build(); part.position.set(lx, 0, lz);
      o.group.add(part); o.parts.push(part);
      o.colliders.push({ lx, lz, r: s * 0.95, obstacle: o, rock: true });
    }
  }

  // Nearest blocking obstacle in reach (distance to its closest collider)
  near(x, z, maxD = 2.2) {
    let best = null, bd = maxD;
    for (const o of this.list) {
      if (o.state !== 'blocking' || o.pos.distanceToSquared({ x, y: o.pos.y, z }) > 100) continue;
      for (const c of o.colliders) { const d = Math.hypot(c.x - x, c.z - z) - c.r; if (d < bd) { bd = d; best = o; } }
    }
    return best;
  }

  // Called when the player swings a tool. Returns true if an obstacle took the hit.
  hit(x, z, tool) {
    const o = this.near(x, z);
    if (!o) return false;
    if (!TOOL[o.type].includes(tool)) {
      this.toast(o.type === 'tree' ? 'This tree needs a chainsaw or axe' : 'Rocks need the sledgehammer (Gear Locker)');
      return true;
    }
    if (this.net && this.net.isGuest) {               // the host decides; show feedback right away
      this.net.send('obstHit', { i: this.list.indexOf(o), tool }, true);
      o.hp = Math.max(0.01, o.hp - (POWER[tool] || 1));
      audio.thud(o.type === 'tree' ? 170 : 240, 0.1);
      this.toast(`${o.type === 'tree' ? 'Cutting' : 'Smashing'} the ${NAME[o.type].toLowerCase()}… ${Math.round(HP[o.type] - o.hp)}/${HP[o.type]}`);
      return true;
    }
    this._applyHit(o, tool);
    return true;
  }
  hostHit(i, tool) { const o = this.list[i]; if (o && o.state === 'blocking') this._applyHit(o, tool, true); }
  _applyHit(o, tool, remote) {
    o.hp -= POWER[tool] || 1;
    audio.thud(o.type === 'tree' ? 170 : 240, 0.1);
    o.group.position.x += rand(-0.03, 0.03);
    if (o.hp <= 0) this._clear(o);
    else if (!remote) this.toast(`${o.type === 'tree' ? 'Cutting' : 'Smashing'} the ${NAME[o.type].toLowerCase()}… ${HP[o.type] - o.hp}/${HP[o.type]}`);
    this.onChange && this.onChange();
  }
  // sync / save helpers: hp per obstacle, -1 = cleared
  stateArray() { return this.list.map(o => (o.state === 'blocking' ? Math.round(o.hp * 100) / 100 : -1)); }
  applyStateArray(a, animate) {
    this.list.forEach((o, i) => {
      if (a[i] === undefined) return;
      if (a[i] < 0 && o.state === 'blocking') animate ? this._clear(o, false) : this.clearInstant(o);
      else if (a[i] >= 0 && o.state === 'blocking') o.hp = a[i];
    });
  }
  clearInstant(o) {
    if (o.state !== 'blocking') return;
    for (const c of o.colliders) this.world.removeCollider(c);
    o.state = 'cleared'; this.scene.remove(o.group);
  }

  _clear(o, reward = true) {
    o.state = 'breaking'; o.t = 0;
    for (const c of o.colliders) this.world.removeCollider(c);
    const [mat, n] = GIVE[o.type];
    if (reward) this.materials.add(mat, n);
    audio.thud(o.type === 'tree' ? 90 : 60, 0.4);
    this.toast(`${NAME[o.type]} cleared! +${n} ${mat === 'logs' ? 'logs 🪵' : 'stones 🪨'}`);
    if (o.type !== 'tree') {
      for (let i = 0; i < 14; i++) {
        const b = new GeoBuilder(); b.add(new THREE.DodecahedronGeometry(rand(0.15, 0.35), 0), 0x7d7b74, 0, 0, 0);
        const m = b.build(); m.position.copy(o.pos).add(new THREE.Vector3(rand(-3, 3), rand(0.5, 1.5), rand(-1, 1)));
        this.scene.add(m);
        this.fx.push({ m, v: new THREE.Vector3(rand(-4, 4), rand(3, 7), rand(-4, 4)), t: 0 });
      }
    }
  }

  // Interaction prompts near obstacles (shown on foot)
  acts(equippedType) {
    const out = [];
    for (const o of this.list) {
      if (o.state !== 'blocking') continue;
      const ok = equippedType && TOOL[o.type].includes(equippedType);
      if (!o.act) o.act = { pos: o.pos, r: 6.5 };
      o.act.key = ok ? 'F' : 'E';
      o.act.label = ok ? () => `${o.type === 'tree' ? 'Cut' : 'Smash'} the ${NAME[o.type].toLowerCase()} (${HP[o.type] - o.hp}/${HP[o.type]})`
        : () => `${NAME[o.type]} — needs ${o.type === 'tree' ? 'a chainsaw or axe' : 'the sledgehammer'}`;
      o.act.act = () => this.toast(o.type === 'tree' ? 'Get the chainsaw or axe from the Gear Locker, hold it (1-6) and press F' : 'Get the sledgehammer from the Gear Locker, hold it (1-6) and press F');
      out.push(o.act);
    }
    return out;
  }

  get cleared() { return this.list.filter(o => o.type !== 'pile' && o.state !== 'blocking').length; }

  update(dt) {
    for (const o of this.list) {
      if (o.state !== 'breaking') continue;
      o.t += dt;
      const k = Math.min(1, o.t / 1.6);
      if (o.type === 'tree') {
        for (const p of o.parts) { const s = p.userData.side; p.position.x = s * k * 5; p.rotation.y = s * k * 0.5; p.position.y = -Math.max(0, k - 0.6) * 4; }
      } else for (const p of o.parts) p.scale.setScalar(Math.max(0.001, 1 - k));
      if (k >= 1) { o.state = 'cleared'; this.scene.remove(o.group); }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t += dt; f.v.y -= 9.8 * dt; f.m.position.addScaledVector(f.v, dt); f.m.rotation.x += dt * 5;
      if (f.t > 1.4) { this.scene.remove(f.m); this.fx.splice(i, 1); }
    }
  }
}
