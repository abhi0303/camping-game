// Thieves (Farm World): what the players see of a raid and how they catch the thief. The server decides when a
// thief comes and what he takes (server/src/thieves.js): a raid has a start (he comes out of the jungle behind
// the coop), a moment he reaches the coop, and a moment he's gone for good. Everything here follows those times
// and the raid's seed, so every player sees the same thief in the same place.
//   - He sneaks (crouching) from the jungle to the back wall of the coop with the most eggs, crouches there filling
//     his brown sack, then runs off behind the coops and into the trees.
//   - An alarm and a banner tell everyone in the game; the dogs on duty run over and bark (js/farm/dogs.js).
//   - Catching him: run after him and throw your net (F / click, the NET button on a phone) when the needle of the
//     meter crosses the thin perfect mark — while running; standing still the mark is half as wide. Three throws.
//     A hit: the spinning net opens over his head, drops round him and pulls tight — the eggs come back with 10 %
//     more. Three misses: he puts on speed and is gone.
//   - Coming back to the game: a report of every raid since you last looked comes first.
import * as THREE from 'three';
import { Character } from '../character.js';
import { GeoBuilder, MAT } from '../utils.js';
import { limb } from '../flora.js';
import { PLOTS, toWorld } from './layout.js';
import { icon } from '../icons.js';

const RANGE = 14;                 // the net reaches this far (m)
const NETS = 3;                   // throws per thief
const NEEDLE_S = 0.9;             // seconds for the needle to cross the meter
const ZONE_RUN = [0.075, 0.05];   // the perfect mark's width (share of the meter) close up / at full reach, while running
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sm = k => k * k * (3 - 2 * k);
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const tri = x => { const f = x - Math.floor(x); return f < 0.5 ? f * 2 : 2 - f * 2; };
function mulberry(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const eggsOf = taken => Object.values(taken || {}).reduce((t, n) => t + (n > 0 ? n : 0), 0);

/* ---------- models ---------- */
// the thief: the players' character in a white shirt with black stripes, dark trousers, a black beanie and an
// eye mask (the "glasses" in black), a brown sack over his shoulder
function thiefModel() {
  const ch = new Character({ jacket: 0xf4f4f2, jacketLt: 0xe8e8e6, shirt: 0xf4f4f2, jeans: 0x2b2d35, jeansDk: 0x24262d, skin: 0xb98058, skinDk: 0xa06c48,
    hair: 0x1a1612, glass: 0x0c0c0e, shoe: 0x1c1c1e, shoeGrey: 0x2c2c30, sole: 0x111113, belt: 0x5a3a22, watch: 0x1a1a1a });
  const add = (parent, fn) => { const b = new GeoBuilder(); fn(b); const m = b.build(); m.traverse(o => { if (o.isMesh) o.castShadow = true; }); parent.add(m); return m; };
  const j = ch.j, K = 0x18181c;
  add(j.spine, b => { for (const y of [0.07, 0.17, 0.27, 0.37]) b.box(0.448, 0.045, 0.25, 0, y, -0.012, K); b.box(0.2, 0.03, 0.03, 0, 0.44, 0.105, K); });
  for (const sh of [j.shL, j.shR]) add(sh, b => { for (const y of [-0.06, -0.16, -0.25]) b.box(0.138, 0.032, 0.125, 0, y, 0, K); });
  add(j.head, b => { b.box(0.232, 0.08, 0.252, 0, 0.27, -0.005, K); b.box(0.236, 0.035, 0.256, 0, 0.225, -0.005, 0x2a2a30); b.box(0.24, 0.05, 0.04, 0, 0.165, 0.1, K); });
  // the sack (it fills up when he has the eggs) and its strap
  const sack = new THREE.Group(); sack.position.set(0.06, 0.32, -0.2); j.spine.add(sack);
  add(sack, b => { b.add(new THREE.IcosahedronGeometry(1, 1), 0x8a5a30, 0, -0.04, -0.02, 0, 0, 0, 'solid', 0.17, 0.22, 0.13); b.cyl(0.05, 0.08, 0.1, 6, 0, 0.17, -0.02, 0x7a4a26); b.box(0.12, 0.03, 0.1, 0, 0.22, -0.02, 0x5a3a1c); });
  add(j.spine, b => b.box(0.05, 0.6, 0.02, 0.0, 0.26, 0.112, 0x6a4424, 'solid', 0, 0, 0.6));
  // his own material, so he can fade away
  ch.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; } });
  return { ch, sack };
}
const ROPE = 0xd8c39a, ROPE_D = 0xa88a5a, LEAD = 0x55585e;
// the net as it flies: a round mesh of rope with lead weights at the edge (radius 0.75, flat in xz)
function flyingNet() {
  const b = new GeoBuilder(), R = 0.95;
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; limb(b, [0, 0, 0], [Math.cos(a) * R, -0.1, Math.sin(a) * R], 0.024, 0.02, ROPE, 4); }
  for (const [r, y] of [[0.3, -0.03], [0.62, -0.07], [R, -0.1]]) for (let i = 0; i < 14; i++) {
    const a0 = i / 14 * Math.PI * 2, a1 = (i + 1) / 14 * Math.PI * 2;
    limb(b, [Math.cos(a0) * r, y, Math.sin(a0) * r], [Math.cos(a1) * r, y, Math.sin(a1) * r], 0.02, 0.02, r === R ? ROPE_D : ROPE, 4);
  }
  for (let i = 0; i < 10; i++) { const a = (i + 0.5) / 10 * Math.PI * 2; b.add(new THREE.DodecahedronGeometry(0.05, 0), LEAD, Math.cos(a) * R, -0.1, Math.sin(a) * R); }
  b.add(new THREE.DodecahedronGeometry(0.07, 0), ROPE_D, 0, 0, 0);
  return b.build();
}
// the net round a caught thief: draped from over his head to the ground, weights at the bottom
function trapNet() {
  const b = new GeoBuilder(), top = 1.95, R = 0.62, n = 10;
  const ring = (y, r, col) => { for (let i = 0; i < n * 2; i++) { const a0 = i / (n * 2) * Math.PI * 2, a1 = (i + 1) / (n * 2) * Math.PI * 2; limb(b, [Math.cos(a0) * r, y, Math.sin(a0) * r], [Math.cos(a1) * r, y, Math.sin(a1) * r], 0.018, 0.018, col, 4); } };
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; limb(b, [0, top, 0], [Math.cos(a) * R * 0.75, 1.1, Math.sin(a) * R * 0.75], 0.02, 0.02, ROPE, 4); limb(b, [Math.cos(a) * R * 0.75, 1.1, Math.sin(a) * R * 0.75], [Math.cos(a) * R, 0.04, Math.sin(a) * R], 0.02, 0.02, ROPE, 4); }
  ring(1.6, 0.36, ROPE); ring(1.1, R * 0.75, ROPE); ring(0.6, R * 0.9, ROPE); ring(0.05, R, ROPE_D);
  for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2; b.add(new THREE.DodecahedronGeometry(0.038, 0), LEAD, Math.cos(a) * R, 0.05, Math.sin(a) * R); }
  return b.build();
}

export class Thieves {
  // g: { eco, world, player, touch, toast, alarm(), whoosh(), jingle(good), seen(), openReport(), hud }
  constructor(scene, g) {
    this.scene = scene; this.g = g; this.on = false; this.raid = null; this.paths = new Map(); this.done = new Set(); this.reported = new Set();
    this.needle = 0; this.zone = { c: 0.5 }; this.nets = NETS; this.flying = null; this.trap = null; this.vanish = null; this.t = 0;
  }
  enable() {
    if (this.on) return;
    this.on = true;
    const T = thiefModel();
    this.ch = T.ch; this.sack = T.sack; this.ch.root.visible = false; this.scene.add(this.ch.root);
    this.net = flyingNet(); this.net.visible = false; this.scene.add(this.net);
    this.trapMesh = trapNet(); this.trapMesh.visible = false; this.scene.add(this.trapMesh);
    this.lost = flyingNet(); this.lost.visible = false; this.scene.add(this.lost);
    // the banner and the net meter (in the HUD)
    const hud = this.g.hud;
    this.banner = document.createElement('div'); this.banner.id = 'thiefAlert'; this.banner.className = 'hidden'; hud.appendChild(this.banner);
    this.meter = document.createElement('div'); this.meter.id = 'netMeter'; this.meter.className = 'hidden';
    this.meter.innerHTML = `<div class="nm-top"><span class="nm-nets"></span><span class="nm-dist"></span></div><div class="nm-bar"><i class="nm-zone"></i><i class="nm-needle"></i></div><div class="nm-hint"></div>`;
    hud.appendChild(this.meter);
    this.mNets = this.meter.querySelector('.nm-nets'); this.mDist = this.meter.querySelector('.nm-dist'); this.mZone = this.meter.querySelector('.nm-zone');
    this.mNeedle = this.meter.querySelector('.nm-needle'); this.mHint = this.meter.querySelector('.nm-hint');
    this._newZone();
  }
  _newZone() { this.zone = { c: 0.2 + Math.random() * 0.6 }; }

  /* ---------- the thief's way (the same on every screen) ---------- */
  _path(raid) {
    let p = this.paths.get(raid.id);
    if (p) return p;
    const eco = this.g.eco, bd = eco.st && eco.st.buildings.find(b => b.id === raid.shelter), P = PLOTS[bd ? bd.plot : 0], R = mulberry(raid.seed);
    const side = R() < 0.5 ? -1 : 1, W = (lx, lz) => toWorld(P, lx, lz);
    const spawn = W(side * (6 + R() * 4), -6.5 - 22 - R() * 4), target = W((R() - 0.5) * 2.4, -7.35);
    const run = [target, W(-side * 1.5, -12.5), W(-side * (30 + R() * 10), -13.5 - R() * 2), W(-side * (48 + R() * 12), -46 - R() * 6)];
    const cum = [0];
    for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z));
    p = { spawn, target, run, cum, len: cum[cum.length - 1], face: Math.atan2(P.x - target.x, P.z - target.z), plot: bd ? bd.plot : 0 };
    this.paths.set(raid.id, p);
    return p;
  }
  // where he is at time t (ms): { x, z, mode: hidden | sneak | steal | run | gone, speed, face, k (how far he ran) }
  _at(raid, t, out = {}) {
    const p = this._path(raid), at = Date.parse(raid.at), st = Date.parse(raid.stealAt), es = Date.parse(raid.escapeAt), R = this.g.eco.thieves().rules;
    const runAt = st + (R.stealS || 8) * 1000;
    if (t < at) { out.mode = 'hidden'; return out; }
    if (t < st) { const k = (t - at) / (st - at); out.x = p.spawn.x + (p.target.x - p.spawn.x) * k; out.z = p.spawn.z + (p.target.z - p.spawn.z) * k; out.mode = 'sneak'; out.speed = Math.hypot(p.target.x - p.spawn.x, p.target.z - p.spawn.z) / ((st - at) / 1000); out.face = Math.atan2(p.target.x - p.spawn.x, p.target.z - p.spawn.z); return out; }
    if (t < runAt) { out.x = p.target.x; out.z = p.target.z; out.mode = 'steal'; out.speed = 0; out.face = p.face; return out; }
    if (t >= es) { out.mode = 'gone'; return out; }
    const k = (t - runAt) / (es - runAt), s = k * p.len;
    let i = 1; while (i < p.run.length - 1 && p.cum[i] < s) i++;
    const A = p.run[i - 1], B = p.run[i], f = (s - p.cum[i - 1]) / ((p.cum[i] - p.cum[i - 1]) || 1);
    out.x = A.x + (B.x - A.x) * f; out.z = A.z + (B.z - A.z) * f; out.mode = 'run'; out.speed = p.len / ((es - runAt) / 1000); out.face = Math.atan2(B.x - A.x, B.z - A.z); out.k = k;
    return out;
  }

  /* ---------- every frame ---------- */
  // before the player moves: F / click / the NET button throw the net while a thief is in play
  input(input) {
    if (!this.on || !this.canThrow) return;
    if (input.wasPressed('KeyF') || input.click) { input.pressed.delete('KeyF'); input.click = false; this._throw(); }
  }
  update(dt, now) {
    if (!this.on) return;
    this.t += dt;
    const eco = this.g.eco, T = eco.thieves ? eco.thieves() : null;
    if (!T) { this._hide(); return; }
    // a thief has noticed the eggs: tell the players while there's still time to collect them
    if (T.dueAt && this.warnedDue !== T.dueAt && Date.parse(T.dueAt) > now) { this.warnedDue = T.dueAt; this.g.toast(`🥷 More than ${T.rules.threshold} eggs are waiting in the nests — a thief has noticed them! Collect them soon`); }
    // the raid to show: one going on, or one just caught (the net round him for a few seconds)
    let raid = eco.liveRaid(now);
    if (!raid) raid = T.list.find(r => r.status === 'caught' && r.caughtAt && now - Date.parse(r.caughtAt) < 5000 && now - Date.parse(r.at) < 120e3) || null;
    if (this.raid && (!raid || raid.id !== this.raid.id)) this._finish(this.raid, now);
    if (raid && (!this.raid || raid.id !== this.raid.id)) this._begin(raid, now);
    this.raid = raid;
    if (!raid) { this._hide(); this._tickNet(dt); return; }
    // where he is: on his way, caught (here or by someone else), or vanishing after your last miss
    const pos = this._at(raid, now, this._pos || (this._pos = {}));
    if (raid.status === 'caught' && !this.trap) { const at = this._at(raid, Date.parse(raid.caughtAt), {}); if (at.mode !== 'hidden' && at.mode !== 'gone') this._startTrap(at.x, at.z, false); }
    let x = pos.x, z = pos.z, mode = pos.mode, face = pos.face, speed = pos.speed || 0, alpha = 1;
    if (this.trap) { x = this.trap.x; z = this.trap.z; mode = 'trapped'; face = this.trap.face; }
    else if (this.vanish) {
      const k = (now - this.vanish.t0) / 1500;
      x = this.vanish.x + Math.sin(this.vanish.face) * 9 * k * 1.5; z = this.vanish.z + Math.cos(this.vanish.face) * 9 * k * 1.5; face = this.vanish.face; mode = 'run'; speed = 9; alpha = 1 - c01(k);
      if (k >= 1) mode = 'gone';
    } else if (mode === 'run') { const es = Date.parse(raid.escapeAt); alpha = c01((es - now) / 1200); }
    const vis = mode !== 'hidden' && mode !== 'gone';
    this.ch.root.visible = vis;
    if (vis) {
      const y = this.g.world.heightAt(x, z);
      this.ch.root.position.set(x, y, z);
      this.ch.root.rotation.y = face;
      this.ch.root.rotation.z = mode === 'trapped' ? Math.sin(this.t * 13) * 0.06 * (1 - c01((this.t - this.trap.t) / 3)) : 0;
      const am = mode === 'sneak' ? 'crouch' : mode === 'steal' || mode === 'trapped' ? 'crouch' : mode === 'run' ? 'run' : 'idle';
      this.ch.update(dt, { mode: am, speed: mode === 'steal' || mode === 'trapped' ? 0 : speed });
      if (mode === 'steal') { const j = this.ch.j, k = Math.sin(this.t * 5); j.shR.rotation.x = -1.7 + k * 0.35; j.shL.rotation.x = -1.5 - k * 0.3; j.elR.rotation.x = -0.4; j.elL.rotation.x = -0.5; }
      if (mode === 'trapped') { const j = this.ch.j, k = Math.sin(this.t * 11); j.shR.rotation.x = -2.2 + k * 0.4; j.shL.rotation.x = -2.0 - k * 0.4; }
      const full = Date.parse(raid.stealAt) + 3000 < now && eggsOf(raid.taken) > 0;
      this.sack.scale.setScalar(full ? 1.25 : 0.7);
      for (const m of this._mats || (this._mats = this._collectMats())) m.opacity = alpha;
    }
    this.thiefPos = vis ? { x, z } : null;
    // the meter: a thief out there, not caught, nets left, you on foot and near enough to bother
    const me = this.g.player, onFoot = me.mode === 'foot';
    const live = raid.status === 'live' && vis && !this.trap && !this.vanish && (mode === 'sneak' || mode === 'steal' || mode === 'run');
    const d = vis ? Math.hypot(x - me.pos.x, z - me.pos.z) : Infinity;
    this.canThrow = live && onFoot && this.nets > 0 && !this.flying;
    this._meter(live && onFoot && this.nets > 0 && d < 45, d, me, dt);
    if (this.g.touch) this.g.touch.setNet(this.canThrow && d <= RANGE + 6);
    this._banner(raid, mode, now);
    this._tickNet(dt);
  }
  _collectMats() { const out = []; this.ch.root.traverse(o => { if (o.isMesh) out.push(o.material); }); return out; }
  _hide() {
    if (this.ch) this.ch.root.visible = false;
    this.canThrow = false; this.thiefPos = null;
    if (this.meter) this.meter.classList.add('hidden');
    if (this.g.touch) this.g.touch.setNet(false);
    if (this.banner && !this.bannerHold) this.banner.classList.add('hidden');
  }
  // a new raid: the alarm, the banner, three nets
  _begin(raid, now) {
    this.nets = NETS; this.trap = null; this.vanish = null; this.flying = null; this._newZone(); this._mats = null;
    for (const m of this._collectMats()) { m.opacity = 1; }
    this.trapMesh.visible = false;
    if (raid.status === 'live' && now < Date.parse(raid.escapeAt) - 3000) { this.g.alarm(); this.alerted = raid.id; }
  }
  // a raid is over (got away, or caught): say how it went, once, and mark it read
  _finish(raid, now) {
    if (this.done.has(raid.id)) return;
    this.done.add(raid.id);
    const fresh = this.g.eco.thieves().list.find(r => r.id === raid.id) || raid, n = eggsOf(fresh.taken);
    let msg;
    if (fresh.status === 'caught') msg = fresh.caughtBy && fresh.caughtBy !== this.g.myName() ? `🎉 ${fresh.caughtBy} caught the thief — the eggs are back, with 10% extra` : null;
    else if (fresh.status === 'scared' || n === 0) msg = '🐕 Your guard dog scared the thief off — he got nothing';
    else msg = `🥷 The thief got away with ${n} eggs${fresh.saved ? ` — your guard dog saved ${fresh.saved}` : ''}. Collect your eggs before more than 40 pile up`;
    if (msg) { this._flash(msg, fresh.status === 'caught' || n === 0 ? 'good' : 'bad'); this.g.jingle(fresh.status === 'caught' || n === 0); }
    this.reported.add(raid.id);
    this.trapMesh.visible = false; this.trap = null; this.vanish = null;
    this.g.seen();
  }
  // the banner: what's going on
  _banner(raid, mode, now) {
    if (this.bannerHold && now < this.bannerHold) return;
    this.bannerHold = 0;
    if (raid.status !== 'live' || mode === 'hidden' || mode === 'gone' || this.trap) { this.banner.classList.add('hidden'); return; }
    const p = this._path(raid), what = mode === 'sneak' ? `is sneaking up to your chicken coop (plot ${p.plot + 1})` : mode === 'steal' ? `is taking eggs from your coop (plot ${p.plot + 1})!` : 'is running off with your eggs!';
    const html = `<span class="ta-ico">${icon('thief')}</span><span><b>Thief!</b> He ${what} <em>${this.nets > 0 ? 'Catch him with your net' : 'No nets left'}</em></span>`;
    if (this.banner._h !== html) { this.banner._h = html; this.banner.innerHTML = html; }
    this.banner.className = 'live';
  }
  _flash(msg, kind) {
    const html = `<span class="ta-ico">${icon(kind === 'good' ? 'net' : 'thief')}</span><span>${esc(msg)}</span>`;
    this.banner.innerHTML = html; this.banner._h = html; this.banner.className = kind;
    this.bannerHold = this.g.eco.serverNow() + 5000;
    this.g.toast(msg);
  }

  /* ---------- the net ---------- */
  _meter(show, d, me, dt) {
    if (!show) { this.meter.classList.add('hidden'); return; }
    this.needlePh = (this.needlePh || 0) + dt / NEEDLE_S / 2;
    this.needle = tri(this.needlePh);
    const running = me.vel && Math.hypot(me.vel.x, me.vel.z) > 3.2, near = c01((d - 4) / (RANGE - 4));
    this.zone.w = (ZONE_RUN[0] + (ZONE_RUN[1] - ZONE_RUN[0]) * near) * (running ? 1 : 0.5);
    this.meter.classList.remove('hidden');
    this.meter.classList.toggle('far', d > RANGE);
    this.mNeedle.style.left = (this.needle * 100).toFixed(2) + '%';
    this.mZone.style.left = ((this.zone.c - this.zone.w / 2) * 100).toFixed(2) + '%';
    this.mZone.style.width = (this.zone.w * 100).toFixed(2) + '%';
    const nets = `${icon('net')}${'<i class="on"></i>'.repeat(this.nets)}${'<i></i>'.repeat(NETS - this.nets)}`;
    if (this.mNets._h !== nets) { this.mNets._h = nets; this.mNets.innerHTML = nets; }
    this.mDist.textContent = `${Math.round(d)} m`;
    const key = this.g.touch && this.g.touch.enabled ? 'NET' : 'F';
    this.mHint.textContent = d > RANGE ? 'Too far — run closer!' : running ? `Press ${key} on the green mark` : `Running makes the mark wider — press ${key} on the green mark`;
  }
  _throw() {
    const me = this.g.player, th = this.thiefPos, raid = this.raid;
    if (!th || !raid) return;
    const d = Math.hypot(th.x - me.pos.x, th.z - me.pos.z);
    if (d > RANGE) { this.mHint.textContent = 'Too far — run closer!'; this.meter.classList.add('shake'); setTimeout(() => this.meter.classList.remove('shake'), 300); return; }
    const off = Math.abs(this.needle - this.zone.c), hit = off <= this.zone.w / 2 + 0.006;
    this.nets--;
    if (me.char && me.char.swing) me.char.swing('chop');
    this.g.whoosh();
    // where it lands: on him (a hit) or beside him (a miss), aimed where he'll be
    const flight = Math.max(0.32, d / 17), lead = this._at(raid, this.g.eco.serverNow() + flight * 1000, {});
    const tx = lead.mode === 'gone' || lead.mode === 'hidden' ? th.x : lead.x, tz = lead.mode === 'gone' || lead.mode === 'hidden' ? th.z : lead.z;
    const miss = hit ? null : { a: Math.random() * Math.PI * 2, r: 1.3 + Math.min(1.5, off * 6) };
    const fx = me.pos.x + Math.sin(me.yaw || 0) * 0.3, fz = me.pos.z + Math.cos(me.yaw || 0) * 0.3;
    this.flying = { t: 0, T: flight, from: { x: fx, y: me.pos.y + 1.7, z: fz }, to: miss ? { x: tx + Math.cos(miss.a) * miss.r, z: tz + Math.sin(miss.a) * miss.r } : { x: tx, z: tz }, hit, raid: raid.id, d };
    this.flash = off <= this.zone.w / 2 ? 'Perfect!' : off < this.zone.w * 1.6 ? 'So close!' : 'Missed!';
    this._newZone();
  }
  _tickNet(dt) {
    const F = this.flying;
    if (F) {
      F.t += dt;
      const k = c01(F.t / F.T), W = this.g.world, y1 = F.hit ? W.heightAt(F.to.x, F.to.z) + 2.1 : W.heightAt(F.to.x, F.to.z) + 0.1;
      const x = F.from.x + (F.to.x - F.from.x) * k, z = F.from.z + (F.to.z - F.from.z) * k, y = F.from.y + (y1 - F.from.y) * k + Math.sin(k * Math.PI) * (0.5 + F.d * 0.07);
      this.net.visible = true; this.net.position.set(x, y, z);
      this.net.rotation.y += dt * 16; this.net.rotation.x = 0.25 * (1 - k);
      this.net.scale.setScalar(0.55 + 0.55 * sm(k));
      if (k >= 1) {
        this.flying = null; this.net.visible = false;
        if (F.hit && this.raid && this.raid.id === F.raid && this.thiefPos) { this._startTrap(this.thiefPos.x, this.thiefPos.z, true); this._catch(F.raid); }
        else {
          this.lost.visible = true; this.lost.position.set(F.to.x, W.heightAt(F.to.x, F.to.z) + 0.06, F.to.z); this.lost.scale.setScalar(1); this.lostT = 1.6;
          this.mHint.textContent = this.flash;
          if (this.nets <= 0 && this.thiefPos && this.raid) {           // no nets left: he puts on speed and is gone
            const p = this._at(this.raid, this.g.eco.serverNow(), {});
            this.vanish = { t0: this.g.eco.serverNow(), x: this.thiefPos.x, z: this.thiefPos.z, face: p.face ?? 0 };
            this._flash('🥷 Missed three times — the thief is running away fast!', 'bad');
          }
        }
      }
    }
    if (this.lostT > 0) { this.lostT -= dt; if (this.lostT < 0.5) this.lost.scale.setScalar(Math.max(0.01, this.lostT / 0.5)); if (this.lostT <= 0) this.lost.visible = false; }
    // the trap: dropped over his head, pulled tight
    if (this.trap) {
      const k = c01((this.t - this.trap.t) / 0.55), y = this.g.world.heightAt(this.trap.x, this.trap.z);
      this.trapMesh.visible = true; this.trapMesh.position.set(this.trap.x, y + (1 - sm(k)) * 0.9, this.trap.z);
      const s = 1.5 - 0.5 * sm(k) + Math.sin(this.t * 12) * 0.02 * (1 - c01((this.t - this.trap.t) / 3));
      this.trapMesh.scale.set(s, 1, s); this.trapMesh.rotation.y = this.trap.face;
    }
  }
  _startTrap(x, z, mine) {
    this.trap = { x, z, t: this.t, face: this._pos && this._pos.face ? this._pos.face : 0, mine };
    this.canThrow = false; this.meter.classList.add('hidden');
    if (mine) this._flash('🎉 Got him! The net is round the thief…', 'good');
  }
  async _catch(id) {
    try {
      const r = await this.g.eco.act({ action: 'catch', theft: id });
      this.done.add(id); this.reported.add(id);
      this._flash('🎉 ' + r.message.replace(/^.*? caught/, 'You caught'), 'good');
      this.g.jingle(true); this.g.seen();
    } catch (e) {
      this.trap = null; this.trapMesh.visible = false;
      this._flash('⚠ ' + (e.message || e), 'bad');
    }
  }

  /* ---------- the report when you come back ---------- */
  // raids since this player last looked, that they didn't see happen (null: nothing to tell)
  unseen() {
    const T = this.g.eco.thieves && this.g.eco.thieves();
    if (!T || !T.seenAt) return null;
    const since = Date.parse(T.seenAt), list = T.list.filter(r => r.status !== 'live' && Date.parse(r.at) > since && !this.reported.has(r.id));
    return list.length ? list : null;
  }
  markReported(list) { for (const r of list) this.reported.add(r.id); }
}
