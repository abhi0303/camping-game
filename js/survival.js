import * as THREE from 'three';
import { audio } from './audio.js';
import { lerp } from './utils.js';
import { ZMAX } from './zombies.js';
import { CARRY_POS, CARRY_ROT } from './remote.js';

// Zombie nights: 3 minutes of day, then 5 minutes of night with zombies.
// Players have health; at 0 they go down and a teammate can revive them (hold E) or carry them (X).
// In or on top of the RV you are safe — but the zombies then attack the RV. In the morning the RV
// must be repaired (hammer); the next night only comes once it is back to 100%.
export const DAY_LEN = 180, NIGHT_LEN = 300;
const BLEED_COOP = 45, BLEED_SOLO = 6, REVIVE_TIME = 2.5, REVIVE_HP = 50, RESPAWN_HP = 50;
const BITE = 12, RV_BITE = 0.5, RV_RUNOVER = 1.5, DRIVE_AGAIN = 20;
const FIX = { hammer: 4, sledge: 3 };
const SEATED = new Set(['sit', 'drive', 'lie']);
const r2 = v => Math.round(v * 100) / 100;
const fmt = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Survival {
  // g: { net, session, player, rvs, remotes, zombies, combat, gear, inv, world, toast, camera, myName }
  constructor(g) {
    this.g = g; this.net = g.net;
    this.ph = 'day'; this.t = DAY_LEN; this.n = 0; this.rh = []; this.wr = []; this.wait = false;
    this.spawnT = 3; this.sendT = 0; this.zsT = 0; this.zsLast = 0; this.dirty = true; this.wipeT = 0;
    this.hurtT = 99; this.bleed = 0; this.reviving = null; this.carryT = 0; this.carryGrace = 0;
    const $ = id => document.getElementById(id);
    this.ui = { cycle: $('cycle'), team: $('team'), hpFill: $('hpFill'), hpText: $('hpText'), vitals: $('vitals'), hurt: $('hurt'), downed: $('downed'), downedText: $('downedText') };
    this.uiT = 0; this.uiKey = ''; this.teamKey = '';
    this._w = new THREE.Vector3(); this._v = new THREE.Vector3();
    this._players = []; this._acts = [];
    this._ctx = { players: this._players, rvs: g.rvs, strike: (z, tg) => this._strike(z, tg), runOver: r => this._rvDamage(r.index, RV_RUNOVER) };
    this._wire();
  }
  get auth() { return !this.net.isGuest; }               // host or solo runs the zombies + clock
  get myId() { return this.net.online ? this.net.id : 'local'; }
  get isNight() { return this.ph === 'night'; }
  rvHp(i) { const v = this.rh[i]; return v === undefined ? 100 : v; }
  wrecked(i) { return !!this.wr[i]; }
  canDrive(rv) { return !this.wrecked(rv.index); }
  anyDamaged() { return this.g.rvs.some((r, i) => this.rvHp(i) < 100); }

  /* ---------------- saving / joining ---------------- */
  state() {
    return { ph: this.ph, t: Math.round(this.t * 10) / 10, n: this.n, w: this.wait ? 1 : 0,
      rh: this.g.rvs.map((r, i) => Math.round(this.rvHp(i) * 10) / 10), wr: this.g.rvs.map((r, i) => (this.wrecked(i) ? 1 : 0)) };
  }
  applyState(d) {
    if (!d) return;
    const was = this.ph;
    this.t = d.t; this.n = d.n; this.rh = (d.rh || []).slice(); this.wr = (d.wr || []).map(Boolean); this.wait = !!d.w;
    if (d.ph !== was) { this.ph = d.ph; this._onPhase(d.ph, true); }
  }
  reset() { this.ph = 'day'; this.t = DAY_LEN; this.n = 0; this.rh = []; this.wr = []; this.wait = false; this.g.zombies.clear(); this.g.world.setNight(0, true); this.dirty = true; }

  /* ---------------- network ---------------- */
  _wire() {
    const net = this.net, g = this.g;
    net.on('surv', d => { if (net.isGuest) this.applyState(d); });
    net.on('zs', d => { if (net.isGuest) g.zombies.applySnapshot(d); });
    net.on('zatk', d => this.damage(d.d));
    net.on('zhit', d => {
      if (!net.isHost) return;
      for (let i = 0; i + 1 < d.h.length; i += 2) g.zombies.hit(d.h[i], d.h[i + 1], d.x, d.z);
    });
    net.on('rfix', d => {
      if (!net.isHost) return;
      this._fix(d.i, d.a);
    });
    net.on('revive', (d, from) => { if (d.t === this.myId) this._revived(from); });
    net.on('carry', (d, from) => {
      if (d.t !== this.myId) return;
      const p = g.player;
      if (!p.downed || p.carried) return;
      p.toWorld(); p.mode = 'foot'; p.tween = null; p.carried = from; this.carryGrace = 1.2;
      g.toast(`🤝 ${g.session.nameOf(from)} is carrying you to safety`);
    });
    net.on('drop', (d, from) => { if (d.t === this.myId && g.player.carried === from) this._placeDropped(d); });
    net.on('wipe', () => { if (g.player.downed) this._respawn('😵 Everyone went down… you all woke up inside the RV'); });
  }
  _say(text, othersOnly = false) {
    if (!othersOnly) this.g.toast(text);
    if (this.net.online) this.net.send('msg', text);
  }
  _net(dt) {
    if (!this.net.isHost) return;
    this.sendT += dt; this.zsT += dt;
    if (this.dirty || this.sendT > 1) { this.sendT = 0; this.dirty = false; this.net.send('surv', this.state()); }
    if (this.zsT >= 0.1) {
      this.zsT = 0;
      const n = this.g.zombies.count;
      if (n || this.zsLast) this.net.send('zs', this.g.zombies.snapshot());
      this.zsLast = n;
    }
  }

  /* ---------------- day / night clock (host / solo) ---------------- */
  _cycle(dt) {
    if (this.ph === 'day') {
      this.t = Math.max(0, this.t - dt);
      const fixed = this.g.rvs.every((r, i) => this.rvHp(i) >= 100);
      const wait = this.t <= 0 && !fixed;
      if (wait !== this.wait) { this.wait = wait; this.dirty = true; if (wait) this._say('🔧 Night is coming — repair the RV to 100% first (hold the hammer, press F next to it)'); }
      if (this.t <= 0 && fixed) this._setPhase('night', NIGHT_LEN, this.n + 1);
    } else {
      this.t = Math.max(0, this.t - dt);
      if (this.t <= 0) this._setPhase('day', DAY_LEN, this.n);
    }
  }
  _setPhase(ph, t, n) {
    const was = this.ph;
    this.ph = ph; this.t = t; this.n = n; this.wait = false; this.dirty = true;
    if (ph === 'night') this.spawnT = 2;
    if (was !== ph) this._onPhase(ph, false);
  }
  _onPhase(ph, fromNet) {
    const g = this.g, p = g.player;
    g.world.setNight(ph === 'night', true);
    if (ph === 'night') {
      g.toast(`🌙 Night ${this.n} — zombies are coming! Shotgun: G · safe spot: the RV roof (ladder at the back)`);
      if (p.mode === 'drive' && !p.rv.headlights) p.rv.toggleHeadlights();
      if (!g.inv.equippedItem() && !p.downed && p.mode === 'foot') g.combat.setOut(true);
      audio.groan(1);
    } else {
      g.toast(this.anyDamaged() ? '☀ Morning! Repair the RV with the hammer — the next night waits until it is fixed' : '☀ Morning! The zombies are gone… for now');
      if (!fromNet && this.auth) g.zombies.burnAll();
    }
  }

  /* ---------------- zombies (host / solo) ---------------- */
  _collect() {
    const out = this._players, g = this.g, p = g.player;
    out.length = 0;
    p.char.root.getWorldPosition(this._w);
    out.push({ id: this.myId, x: this._w.x, y: this._w.y, z: this._w.z, safe: this.safeRV(), down: p.downed, seated: SEATED.has(p.anim.a) });
    g.remotes.each((r, w) => out.push({ id: r.id, x: w.x, y: w.y, z: w.z, safe: r.s.sf ?? -1, down: !!r.s.dn, seated: SEATED.has(r.s.a) }));
    return out;
  }
  _spawn(dt) {
    if (this.ph !== 'night' || this.t < 6) return;
    const g = this.g, players = this._players, Z = g.zombies;
    if ((this.spawnT -= dt) > 0) return;
    const alive = Z.aliveCount(), np = Math.max(1, players.length);
    const max = Math.min(ZMAX - 2, 7 + 3 * (np - 1) + 2 * (this.n - 1));
    const prog = 1 - this.t / NIGHT_LEN;
    this.spawnT = lerp(3.4, 1.7, prog) * (np > 1 ? 0.8 : 1);
    if (alive >= max) return;
    const pool = players.filter(q => !q.down);
    const tgt = (pool.length ? pool : players)[(Math.random() * (pool.length || players.length)) | 0];
    if (!tgt) return;
    const k = 1 + (Math.random() < 0.4 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
    const W = g.world, b = W.bounds;
    for (let i = 0; i < k && alive + i < max; i++) {
      for (let tries = 0; tries < 10; tries++) {
        const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 16;
        const x = tgt.x + Math.sin(a) * d, z = tgt.z + Math.cos(a) * d;
        if (x < b.minX + 6 || x > b.maxX - 6 || z < b.minZ + 6 || z > b.maxZ - 6) continue;
        if (W.waterDepth(x, z) > 0.15) continue;
        if (players.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < 18 * 18)) continue;
        if (g.rvs.some(r => (r.root.position.x - x) ** 2 + (r.root.position.z - z) ** 2 < 49)) continue;
        const fast = Math.random() < 0.12 + 0.04 * this.n;
        Z.spawn(x, z, fast ? 3.0 + Math.random() * 0.6 : 1.4 + Math.random() * 1.0);
        break;
      }
    }
  }
  _strike(z, tg) {
    if (tg.rv !== undefined) {
      const i = tg.rv;
      if (!this.wrecked(i)) { this._rvDamage(i, RV_BITE); if (this.g.camera.position.distanceTo(this.g.rvs[i].root.position) < 25) audio.thud(85, 0.12); }
      else {   // wrecked: they get at the people in and on it
        const vic = this._players.filter(p => p.safe === i && !p.down && !p.seated);
        if (vic.length) this._bite(vic[(Math.random() * vic.length) | 0].id, BITE);
      }
      return;
    }
    const p = this._players.find(q => q.id === tg.id);
    if (!p || p.down) return;
    if (p.safe >= 0 && !this.wrecked(p.safe)) return;        // climbed up just in time
    this._bite(p.id, BITE);
  }
  _bite(id, d) { if (id === this.myId) this.damage(d); else this.net.sendTo(id, 'zatk', { d }); }
  _rvDamage(i, d) {
    const before = this.rvHp(i), after = Math.max(0, before - d);
    this.rh[i] = after; this.dirty = true;
    if (after <= 0 && !this.wr[i]) {
      this.wr[i] = true;
      this._say('💥 The RV is wrecked! Zombies can reach you on it now — fight, then repair it with the hammer');
      const p = this.g.player;
      if (p.mode === 'drive' && p.rv.index === i) p.rv.setEngine(false);
    } else if (Math.floor(before / 25) !== Math.floor(after / 25) && after > 0) this._say(`🧟 Zombies are smashing the RV! (${Math.round(after)}%) — shoot them off`);
  }
  _fix(i, a) {
    const before = this.rvHp(i);
    this.rh[i] = Math.min(100, before + a);
    if (this.wr[i] && this.rh[i] >= DRIVE_AGAIN) { this.wr[i] = false; this._say('🔧 The RV runs again (keep repairing to 100%)'); }
    if (before < 100 && this.rh[i] >= 100) this._say('✅ RV fully repaired!' + (this.ph === 'day' && this.t <= 0 ? ' The night is coming…' : ''));
    this.dirty = true;
  }
  _wipeCheck(dt) {
    const pl = this._players;
    if (!this.net.isHost || pl.length < 2 || !pl.every(p => p.down)) { this.wipeT = 0; return; }
    if ((this.wipeT += dt) > 3) { this.wipeT = 0; this.net.send('wipe', {}); if (this.g.player.downed) this._respawn('😵 Everyone went down… you all woke up inside the RV'); }
  }

  /* ---------------- you: health, down, revive, carry ---------------- */
  // which RV you're safe in / on (-1 = exposed)
  safeRV() {
    const p = this.g.player, rvs = this.g.rvs;
    if (p.carried) return -1;
    if (p.frame === 'rv') return rvs.indexOf(p.rv);
    for (let i = 0; i < rvs.length; i++) { const roof = rvs[i].roofHeightAt(p.pos); if (roof !== null && p.pos.y >= roof - 0.35) return i; }
    return -1;
  }
  damage(d) {
    const g = this.g, p = g.player;
    if (p.downed) return;
    const sf = this.safeRV();
    if (sf >= 0 && (!this.wrecked(sf) || SEATED.has(p.anim.a))) return;
    p.hp = Math.max(0, p.hp - d); this.hurtT = 0;
    audio.hurt();
    const h = this.ui.hurt; if (h) { h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); }
    if (p.hp <= 0) this._down();
  }
  _down() {
    const g = this.g, p = g.player;
    if (p.carrying) this._drop();
    if ((p.mode === 'seat' || p.mode === 'lie') && p.frame === 'world') { p.mode = 'foot'; p.seat = null; }
    p.downed = true; p.hp = 0; this.reviving = null;
    const team = this.net.online && g.remotes.count > 0;
    this.bleed = team ? BLEED_COOP : BLEED_SOLO;
    g.combat.setOut(false);
    g.toast(team ? '💀 You are down! A teammate can revive you (hold E) or carry you to safety (X)' : '💀 You were overwhelmed…');
    if (team) this._say(`💀 ${g.myName()} is down! Hold E next to them to revive`, true);
  }
  _revived(from) {
    const g = this.g, p = g.player;
    if (!p.downed) return;
    if (p.carried) { p.carried = null; p.scene.add(p.char.root); }
    p.downed = false; p.hp = REVIVE_HP; this.bleed = 0; p.char.land(0.6);
    g.toast(`💚 ${g.session.nameOf(from)} revived you!`);
  }
  _respawn(msg) {
    const g = this.g, p = g.player;
    if (p.carried) { p.carried = null; p.scene.add(p.char.root); }
    p.downed = false; p.hp = RESPAWN_HP; p.pitch = 0; p.vel.set(0, 0); p.vy = 0; p.tween = null; p.seat = null; this.bleed = 0;
    p.placeInside();
    g.toast(msg);
  }
  _carry(id) {
    const g = this.g, p = g.player;
    if (p.carrying || p.downed || p.mode !== 'foot') return;
    p.carrying = id; this.carryT = 0; this.reviving = null;
    g.combat.setOut(false); g.gear.refreshHeld();
    this.net.send('carry', { t: id });
    g.toast(`🤝 You picked up ${g.session.nameOf(id)} — get them to safety (RV roof or inside) · X to put down`);
  }
  _drop() {
    const g = this.g, p = g.player, id = p.carrying;
    if (!id) return;
    p.carrying = null; g.gear.refreshHeld();
    const inRV = p.frame === 'rv', yaw = p.yaw, f = inRV ? 0.35 : 0.6;
    this.net.send('drop', { t: id, f: inRV ? 1 : 0, rv: g.rvs.indexOf(p.rv), x: r2(p.pos.x + Math.sin(yaw) * f), y: r2(p.pos.y + 0.3), z: r2(p.pos.z + Math.cos(yaw) * f) });
  }
  _placeDropped(d) {
    const g = this.g, p = g.player;
    p.carried = null;
    p.scene.add(p.char.root); p.frame = 'world';
    if (d.f && g.rvs[d.rv]) { p.rv = g.rvs[d.rv]; p.toRV(); p.pos.set(d.x, d.y, d.z); p.mode = 'inside'; }
    else { p.pos.set(d.x, d.y, d.z); p.mode = 'foot'; }
    p.vy = 0; p.grounded = false; p.visY = p.pos.y;
  }
  _startRevive(id) {
    const p = this.g.player;
    if (p.downed || p.carrying) return;
    this.reviving = { id, t: 0 };
  }
  // a teammate (peer id) left the game
  playerGone(id) {
    const p = this.g.player;
    if (p.carrying === id) { p.carrying = null; this.g.gear.refreshHeld(); }
    if (p.carried === id) this._placeDropped({ f: 0, x: p.pos.x, y: p.pos.y + 0.3, z: p.pos.z });
    if (this.reviving && this.reviving.id === id) this.reviving = null;
  }

  // world prompts for the player: revive / carry downed teammates
  acts() {
    const l = this._acts, g = this.g, p = g.player;
    l.length = 0;
    if (p.downed || p.carrying) return l;
    g.remotes.each((r, w) => {
      if (!r.s.dn || r.s.cb) return;
      const name = r.s.n || 'teammate';
      if (!r.act) r.act = { pos: new THREE.Vector3(), r: 1.9,
        label: () => (this.reviving && this.reviving.id === r.id ? `Reviving ${name}… ${Math.round((this.reviving.t / REVIVE_TIME) * 100)}%` : `Hold E — revive ${name}`),
        act: () => this._startRevive(r.id),
        alt: { label: () => `Carry ${name}`, act: () => this._carry(r.id) } };
      r.act.pos.copy(w);
      l.push(r.act);
    });
    return l;
  }
  // our shotgun pellets hit zombies: host applies it, a guest shows it right away and tells the host
  onHits(hits, dx, dz) {
    const Z = this.g.zombies, l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (this.auth) { for (const [id, d] of hits) Z.hit(id, d, dx, dz); return; }
    const arr = [];
    for (const [id, d] of hits) { arr.push(id, Math.round(d)); Z.predictHit(id, d); }
    this.net.send('zhit', { h: arr, x: r2(dx), z: r2(dz) }, true);
  }
  // hammer / sledgehammer swing next to a damaged RV (from Gear.use)
  repair(type) {
    const g = this.g, p = g.player;
    if (p.mode !== 'foot' || p.downed) return false;
    const i = this._nearRV(1.7);
    if (i < 0) return false;
    if (this.rvHp(i) >= 100) { g.toast('The RV is in good shape'); return true; }
    const a = FIX[type] || 3;
    if (this.auth) this._fix(i, a);
    else { this.rh[i] = Math.min(100, this.rvHp(i) + a); this.net.send('rfix', { i, a }, true); }
    audio.thud(320, 0.05); setTimeout(() => audio.thud(520, 0.03), 60);
    g.toast(`🔧 Repairing the RV… ${Math.round(this.rvHp(i))}%`);
    return true;
  }
  _nearRV(maxD) {
    const p = this.g.player, rvs = this.g.rvs;
    if (p.frame !== 'world') return -1;
    for (let i = 0; i < rvs.length; i++) {
      const l = rvs[i].toLocal(p.pos, this._v);
      if (l.y > 2.4 || l.y < -1.5) continue;
      const ex = Math.max(Math.abs(l.x) - 1.24, 0), ez = Math.max(l.z - 4.14, -3.9 - l.z, 0);
      if (Math.hypot(ex, ez) < maxD) return i;
    }
    return -1;
  }

  /* ---------------- per frame ---------------- */
  update(dt, input) {
    const g = this.g;
    if (this.auth) {
      this._cycle(dt);
      this._collect();
      this._spawn(dt);
      g.zombies.simulate(dt, this._ctx);
      this._wipeCheck(dt);
    } else {
      if (!this.wait) this.t = Math.max(0, this.t - dt);
      g.zombies.follow(dt);
    }
    g.zombies.render(dt, g.camera.position);
    this._local(dt, input);
    this._net(dt);
    this._hud(dt);
  }
  // host with the game loop asleep (background tab / bridge designer open): keep the night going for everyone
  background(dt) {
    if (!this.net.isHost) return;
    const n = Math.max(1, Math.round(dt / 0.1)), h = dt / n;
    for (let i = 0; i < n; i++) { this._cycle(h); this._collect(); this._spawn(h); this.g.zombies.simulate(h, this._ctx); }
    this._net(dt);
  }

  _local(dt, input) {
    const g = this.g, p = g.player;
    // health regeneration: steady in daylight, slow at night and only when safe
    this.hurtT += dt;
    if (!p.downed && p.hp < 100) {
      const rate = this.ph === 'day' ? (this.hurtT > 4 ? 6 : 0) : (this.safeRV() >= 0 && this.hurtT > 6 ? 1.5 : 0);
      p.hp = Math.min(100, p.hp + rate * dt);
    }
    // knocked down: bleed out unless carried or lying somewhere safe
    if (p.downed) {
      const safe = this.safeRV() >= 0 && !this.wrecked(this.safeRV());
      if (!p.carried && !safe) this.bleed -= dt;
      if (this.bleed <= 0) this._respawn(this.net.online && g.remotes.count ? '😵 You blacked out… and woke up inside the RV' : '😵 You blacked out… and woke up inside the RV (50 ❤)');
    }
    // being carried: ride on the carrier's shoulders
    if (p.carried) {
      const c = g.remotes.map.get(p.carried);
      this.carryGrace -= dt;
      if (!c) this._placeDropped({ f: 0, x: p.pos.x, y: p.pos.y + 0.3, z: p.pos.z });
      else if (c.s.cr !== this.myId && this.carryGrace <= 0) { c.char.root.getWorldPosition(this._w); this._placeDropped({ f: 0, x: this._w.x, y: this._w.y + 0.3, z: this._w.z }); }
      else {
        if (p.char.root.parent !== c.char.root) c.char.root.add(p.char.root);
        p.char.root.position.copy(CARRY_POS); p.char.root.rotation.copy(CARRY_ROT);
        c.char.root.getWorldPosition(p.pos); p.visY = p.pos.y;
      }
    }
    // carrying someone
    if (p.carrying) {
      this.carryT += dt;
      const r = g.remotes.map.get(p.carrying);
      if (!r || !r.s.dn || (this.carryT > 1.5 && r.s.cb !== this.myId)) { p.carrying = null; g.gear.refreshHeld(); }
      else {
        p.prompt = { key: 'X', text: `Put ${r.s.n || 'them'} down${this.safeRV() >= 0 ? ' (safe here)' : ''}` };
        if (this.carryT > 0.3 && input.wasPressed('KeyX')) this._drop();
      }
    }
    // holding E next to a downed teammate
    if (this.reviving) {
      const rv = this.reviving, r = g.remotes.map.get(rv.id);
      let ok = r && r.s.dn && !r.s.cb && (input.isDown('KeyE') || input.touch) && !p.downed && !p.carrying;   // phones: a tap is enough
      if (ok) { r.char.root.getWorldPosition(this._w); ok = this._w.distanceTo(p.char.root.getWorldPosition(this._v)) < 2.3; }
      if (!ok) this.reviving = null;
      else if ((rv.t += dt) >= REVIVE_TIME) {
        this.net.send('revive', { t: rv.id });
        g.toast(`💚 You revived ${r.s.n || 'your teammate'}`);
        this.reviving = null;
      }
    }
    // repair hint next to a damaged RV
    if (!p.prompt && p.mode === 'foot' && !p.downed && !p.carrying) {
      const i = this._nearRV(1.7);
      if (i >= 0 && this.rvHp(i) < 100) {
        const eq = g.inv.equippedItem(), tool = eq && FIX[eq.type];
        p.prompt = tool ? { key: 'F', text: `Repair the RV (${Math.round(this.rvHp(i))}%)` } : { key: '🔨', text: `RV ${Math.round(this.rvHp(i))}% — hold the hammer (Gear Locker) and press F to repair` };
      }
    }
  }

  /* ---------------- HUD ---------------- */
  _hud(dt) {
    const g = this.g, p = g.player, u = this.ui;
    if ((this.uiT -= dt) > 0) return;
    this.uiT = 0.2;
    // clock
    const rvTxt = g.rvs.map((r, i) => (this.rvHp(i) < 100 || this.wrecked(i) ? ` · 🚐${g.rvs.length > 1 ? i + 1 : ''} ${this.wrecked(i) ? 'WRECKED ' : ''}${Math.round(this.rvHp(i))}%` : '')).join('');
    let txt, cls;
    if (this.ph === 'night') { txt = `🌙 Night ${this.n} · dawn in ${fmt(this.t)} · 🧟 ${g.zombies.aliveCount()}${rvTxt}`; cls = 'night'; }
    else if (this.wait) { txt = `🔧 Repair the RV to 100% — the night waits${rvTxt}`; cls = 'wait'; }
    else { txt = `☀ Day ${this.n + 1} · 🌙 zombies in ${fmt(this.t)}${rvTxt}`; cls = this.t < 30 ? 'soon' : ''; }
    const key = txt + cls;
    if (key !== this.uiKey) { this.uiKey = key; u.cycle.textContent = txt; u.cycle.className = 'panel ' + cls; }
    // your health
    const hp = Math.round(p.hp);
    u.hpFill.style.width = hp + '%';
    u.hpFill.className = hp > 50 ? '' : hp > 25 ? 'mid' : 'low';
    u.hpText.textContent = p.downed ? 'DOWN' : '❤ ' + hp;
    // downed overlay
    if (p.downed !== this._dn) { this._dn = p.downed; u.downed.classList.toggle('hidden', !p.downed); document.body.classList.toggle('downed', p.downed); }
    if (p.downed) {
      const team = this.net.online && g.remotes.count > 0, sf = this.safeRV();
      u.downedText.textContent = p.carried ? `${g.session.nameOf(p.carried)} is carrying you…`
        : sf >= 0 && !this.wrecked(sf) ? 'You are safe here — a teammate can revive you (hold E next to you)'
          : team ? `Wait for a teammate to revive you · ${Math.ceil(this.bleed)} s` : `Blacking out… ${Math.ceil(this.bleed)}`;
    }
    // team list (co-op)
    if (!this.net.online) { if (this.teamKey) { this.teamKey = ''; u.team.classList.add('hidden'); } return; }
    const rows = [{ n: 'You', c: g.session.colorOf(this.net.id), hp: p.hp, dn: p.downed, sf: this.safeRV(), a: p.anim.a }];
    g.remotes.map.forEach(r => rows.push({ n: r.s.n || 'Player', c: r.color, hp: r.s.hp ?? 100, dn: !!r.s.dn, sf: r.s.sf ?? -1, a: r.s.a, away: r.away }));
    const html = rows.map(r => {
      const k = Math.max(0, Math.min(100, Math.round(r.hp)));
      const st = r.dn ? '⬇' : r.a === 'drive' ? '🚐' : r.sf >= 0 ? '🛡' : '';
      return `<div class="trow${r.dn ? ' dn' : ''}${r.away ? ' away' : ''}"><i style="background:${r.c}"></i><span>${esc(r.n)}</span><b><u class="${k > 50 ? '' : k > 25 ? 'mid' : 'low'}" style="width:${k}%"></u></b><em>${st}</em></div>`;
    }).join('');
    if (html !== this.teamKey) { this.teamKey = html; u.team.innerHTML = html; u.team.classList.remove('hidden'); }
  }
}
