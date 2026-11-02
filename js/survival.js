import * as THREE from 'three';
import { audio } from './audio.js';
import { lerp } from './utils.js';
import { ZMAX } from './zombies.js';
import { GTOTAL } from './giants.js';
import { CARRY_POS, CARRY_ROT } from './remote.js';
import { VALLEY, TOWER_ZONE, GIANT } from './terrain.js';
import { towerCost, towerProblems, castleCost, castleProblems } from './structures.js';

// The survival campaign (the host / a solo player runs it, everyone else follows):
//   trail  -> nights come after 3, then 6, then every 10 minutes; zombies get tougher at every checkpoint
//   tbuild -> Watchtower Valley: 10 minutes to collect materials and build towers
//   siege  -> a 5-minute zombie horde attacks the towers
//   trail2 -> on to the Giant Plateau (normal nights again)
//   cbuild -> 10 minutes to build a stone castle wall
//   giants -> 10 stone-throwing giants (2 first, then one more every 30 s) — fight them with cannons
//   won / lost -> scoreboard
// Health: at 0 you go down; a teammate revives you (hold E) or carries you to safety (X). If nobody does —
// or zombies keep eating you — you die for good and can only spectate. No respawns.
export const NIGHT_LEN = 300, BUILD_LEN = 600, DAYS = [180, 360, 600];
export const STAGES = ['trail', 'tbuild', 'siege', 'trail2', 'cbuild', 'giants', 'won'];
const BLEED_COOP = 45, BLEED_SOLO = 10, REVIVE_TIME = 2.5, REVIVE_HP = 50;
const BITE = 12, RV_BITE = 0.5, TOWER_BITE = 2;
const FIX = { hammer: 4, sledge: 3 };
const PTS = { kill: 10, giant: 150, revive: 50 };
const SEATED = new Set(['sit', 'drive', 'lie']);
const r2 = v => Math.round(v * 100) / 100;
const fmt = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Survival {
  // g: { net, session, player, rvs, remotes, zombies, giants, structures, combat, gear, inv, world, materials, rig, toast, camera, myName, onEnd, onLeave }
  constructor(g) {
    this.g = g; this.net = g.net;
    this.stage = 'trail'; this.ph = 'day'; this.t = DAYS[0]; this.n = 0; this.rh = []; this.wr = [];
    this.spawnT = 3; this.sendT = 0; this.zsT = 0; this.zsLast = 0; this.gsT = 0; this.dirty = true; this.trigT = 0; this.giantT = 0; this.waitMsg = 0;
    this.hurtT = 99; this.bleed = 0; this.reviving = null; this.carryT = 0; this.carryGrace = 0;
    this.score = new Map(); this.sc = []; this.deadCids = new Set(); this.over = null; this.spect = null;
    const $ = id => document.getElementById(id);
    this.ui = { cycle: $('cycle'), team: $('team'), hpFill: $('hpFill'), hpText: $('hpText'), hurt: $('hurt'), downed: $('downed'), downedText: $('downedText'),
      spec: $('spectate'), specName: $('specName'), end: $('endScreen') };
    this.uiT = 0; this.uiKey = ''; this.teamKey = '';
    this._w = new THREE.Vector3(); this._v = new THREE.Vector3();
    this._players = []; this._acts = [];
    const S = () => g.structures;
    this._ctx = { players: this._players, rvs: g.rvs,
      strike: (z, tg) => this._strike(z, tg),
      runOver: (r) => this._credit(r.owner && r.owner !== 'local' ? r.owner : this.myId, 'k'),
      structPos: st => (st < 10 ? (g.rvs[st] ? g.rvs[st].root.position : null) : (S().towers[st - 10] && S().towers[st - 10].alive ? S().towers[st - 10] : null)),
      structDist: (st, z) => (st < 10 ? g.zombies.hullDist(g.rvs[st], z) : S().towerDist(st - 10, z.x, z.z)) };
    this._gctx = { players: this._players, rvs: g.rvs, get structures() { return S(); },
      throwAt: (gi, from, to) => this._throw(gi, from, to), stomp: gi => this._stomp(gi) };
    this._wire();
    $('specLeave').addEventListener('click', () => g.onLeave());
    $('endMenu').addEventListener('click', () => g.onLeave());
    $('endStay').addEventListener('click', () => this.ui.end.classList.add('hidden'));
  }
  get auth() { return !this.net.isGuest; }               // host or solo runs the clock, zombies and giants
  get myId() { return this.net.online ? this.net.id : 'local'; }
  get isNight() { return this.ph === 'night'; }
  at(stage) { return STAGES.indexOf(this.stage) >= STAGES.indexOf(stage); }
  get weapon() { return this.at('cbuild') ? 'cannon' : 'shotgun'; }
  rvHp(i) { const v = this.rh[i]; return v === undefined ? 100 : v; }
  wrecked(i) { return !!this.wr[i]; }
  canDrive(rv) { return this.rvHp(rv.index) >= 100; }
  anyDamaged() { return this.g.rvs.some((r, i) => this.rvHp(i) < 100); }
  get level() { return Math.max(0, ...this.g.rvs.map(r => r.cp)) + (this.stage === 'siege' ? 1 : 0); }

  /* ---------------- saving / joining ---------------- */
  state(forCid) {
    return { st: this.stage, ph: this.ph, t: Math.round(this.t * 10) / 10, n: this.n, ov: this.over,
      rh: this.g.rvs.map((r, i) => Math.round(this.rvHp(i) * 10) / 10), wr: this.g.rvs.map((r, i) => (this.wrecked(i) ? 1 : 0)),
      sc: this._scRows(), ss: this.g.structures.state(), dead: forCid && this.deadCids.has(forCid) ? 1 : 0 };
  }
  applyState(d) {
    if (!d) return;
    const was = this.ph, wasSt = this.stage;
    this.t = d.t; this.n = d.n; this.rh = (d.rh || []).slice(); this.wr = (d.wr || []).map(Boolean);
    if (d.sc) this.sc = d.sc;
    if (d.st) this.stage = d.st;
    if (d.ss) this.g.structures.applyState(d.ss);
    if (d.ph !== was) { this.ph = d.ph; this._onPhase(d.ph, true); }
    if (this.stage !== wasSt) this._onStage(this.stage, true);
    if (d.dead && !this.g.player.dead) this._die(true);
    if (d.ov && !this.over) this._end(d.ov, true);
  }
  reset() {
    this.stage = 'trail'; this.ph = 'day'; this.t = DAYS[0]; this.n = 0; this.rh = []; this.wr = []; this.over = null;
    this.score.clear(); this.sc = []; this.deadCids.clear();
    this.g.zombies.clear(); this.g.giants.reset(); this.g.world.setNight(0, true); this.dirty = true;
  }

  /* ---------------- network ---------------- */
  _wire() {
    const net = this.net, g = this.g;
    net.on('surv', d => { if (net.isGuest) this.applyState(d); });
    net.on('zs', d => { if (net.isGuest) g.zombies.applySnapshot(d); });
    net.on('gs', d => { if (net.isGuest) g.giants.applySnapshot(d); });
    net.on('bould', d => { if (net.isGuest) g.giants.launch(d[0], d[1], d[2], d[3], d[4], d[5], d[6]); });
    net.on('bimp', d => { if (net.isGuest) g.giants.endBoulder(d[0], d[1], d[2], d[3]); });
    net.on('zatk', d => this.damage(d.d, d.k || 'z'));
    net.on('zhit', (d, from) => {
      if (!net.isHost) return;
      for (let i = 0; i + 1 < d.h.length; i += 2) if (g.zombies.hit(d.h[i], d.h[i + 1], d.x, d.z)) this._credit(from, 'k');
    });
    net.on('ghit', (d, from) => { if (net.isHost) for (let i = 0; i + 1 < d.h.length; i += 2) this._giantHit(d.h[i], d.h[i + 1], from); });
    net.on('rfix', d => { if (net.isHost) this._fix(d.i, d.a); });
    net.on('sfix', d => { if (net.isHost) { g.structures.repair(d.k, d.i, d.a); this.dirty = true; } });
    net.on('sbuild', (d, from) => {
      if (!net.isHost) return;
      const err = this.commitBuild(d.kind, d.design, false);
      if (err) net.sendTo(from, 'msg', '🚫 ' + err);
    });
    net.on('sbuilt', d => { if (net.isGuest) this._applyBuild(d.kind, d.design); });
    net.on('ready', () => { if (net.isHost) this.ready(); });
    net.on('revive', (d, from) => { if (net.isHost) this._credit(from, 'r'); if (d.t === this.myId) this._revived(from); });
    net.on('dead', (d, from) => {
      if (net.isHost) { this._credit(from, 'd'); const p = g.session.players.get(from); if (p) this.deadCids.add(p.cid); }
      g.toast(`☠ ${g.session.nameOf(from)} was eliminated`);
    });
    net.on('over', d => { if (net.isGuest) { if (d.sc) this.sc = d.sc; this._end(d.r, true); } });
    net.on('carry', (d, from) => {
      if (d.t !== this.myId) return;
      const p = g.player;
      if (!p.downed || p.carried || p.dead) return;
      p.toWorld(); p.mode = 'foot'; p.tween = null; p.carried = from; this.carryGrace = 1.2;
      g.toast(`🤝 ${g.session.nameOf(from)} is carrying you to safety`);
    });
    net.on('drop', (d, from) => { if (d.t === this.myId && g.player.carried === from) this._placeDropped(d); });
  }
  _say(text, othersOnly = false) {
    if (!othersOnly) this.g.toast(text);
    if (this.net.online) this.net.send('msg', text);
  }
  _net(dt) {
    if (!this.net.isHost) return;
    this.sendT += dt; this.zsT += dt; this.gsT += dt;
    if (this.dirty || this.sendT > 1) { this.sendT = 0; this.dirty = false; this.net.send('surv', this.state()); }
    if (this.zsT >= 0.1) {
      this.zsT = 0;
      const n = this.g.zombies.count;
      if (n || this.zsLast) this.net.send('zs', this.g.zombies.snapshot());
      this.zsLast = n;
    }
    if (this.gsT >= 0.125 && (this.g.giants.list.length || this.stage === 'giants')) { this.gsT = 0; this.net.send('gs', this.g.giants.snapshot()); }
  }

  /* ---------------- scores (the host keeps them) ---------------- */
  // scores are kept per name + slot (stable across reconnects and saves)
  _key(id) {
    let n, c;
    if (id === this.myId || id === 'local') { n = this.g.myName(); c = this.g.session.mySlot; }
    else { const p = this.g.session.players.get(id); n = p ? p.n : this.g.session.nameOf(id); c = p ? p.c : 0; }
    return { key: n + '#' + c, n, c };
  }
  _credit(id, what, extra = 0) {
    if (!this.auth) return;
    const k = this._key(id);
    let s = this.score.get(k.key);
    if (!s) { s = { n: k.n, c: k.c, k: 0, g: 0, r: 0, d: 0, p: 0 }; this.score.set(k.key, s); }
    s.n = k.n; s.c = k.c;
    if (what === 'k') { s.k++; s.p += PTS.kill + 2 * this.level; }
    if (what === 'g') { s.g++; s.p += PTS.giant; }
    if (what === 'r') { s.r++; s.p += PTS.revive; }
    if (what === 'd') s.d++;
    s.p += extra;
    this.dirty = true;
  }
  _scRows() {
    if (this.auth) {
      // everyone currently in the room shows up, even with 0 points
      const k0 = this._key(this.myId); if (!this.score.has(k0.key)) this.score.set(k0.key, { n: k0.n, c: k0.c, k: 0, g: 0, r: 0, d: 0, p: 0 });
      for (const id of this.g.session.players.keys()) { const k = this._key(id); if (!this.score.has(k.key)) this.score.set(k.key, { n: k.n, c: k.c, k: 0, g: 0, r: 0, d: 0, p: 0 }); }
      this.sc = [...this.score.values()].map(s => [s.n, s.c, s.k, s.g, s.r, s.d, s.p]);
    }
    return this.sc;
  }
  scoreRows() { return [...this._scRows()].sort((a, b) => b[6] - a[6]); }
  myPoints() { const me = this.g.myName(); const r = this._scRows().find(x => x[0] === me && x[1] === this.g.session.mySlot); return r ? r[6] : 0; }

  /* ---------------- the campaign clock (host / solo) ---------------- */
  _cycle(dt) {
    const S = this.stage;
    if (this.over) return;
    if (S === 'trail' || S === 'trail2') {
      this.t = Math.max(0, this.t - dt);
      if (this.t <= 0) { if (this.ph === 'day') this._setPhase('night', NIGHT_LEN, this.n + 1); else this._setPhase('day', DAYS[Math.min(this.n, 2)], this.n); }
    } else if (S === 'tbuild') { this.t = Math.max(0, this.t - dt); if (this.t <= 0) this._toStage('siege'); }
    else if (S === 'siege') { this.t = Math.max(0, this.t - dt); if (this.t <= 0) this._toStage('trail2'); }
    else if (S === 'cbuild') { this.t = Math.max(0, this.t - dt); if (this.t <= 0) this._toStage('giants'); }
    else if (S === 'giants') this._giantsTick(dt);
    // arriving at the valley / the plateau starts the build stages (never in the middle of a night)
    if ((this.trigT -= dt) > 0) return;
    this.trigT = 0.5;
    if (S === 'trail' && this._near(VALLEY, 70)) {
      if (this.ph === 'day') this._toStage('tbuild');
      else if ((this.waitMsg -= 0.5) <= 0) { this.waitMsg = 30; this._say('🌙 Survive the night first — the valley build starts at dawn'); }
    }
    if (S === 'trail2' && this._near(GIANT, 60)) {
      if (this.ph === 'day') this._toStage('cbuild');
      else if ((this.waitMsg -= 0.5) <= 0) { this.waitMsg = 30; this._say('🌙 Survive the night first — the castle build starts at dawn'); }
    }
  }
  _near(c, r) {
    if (this.g.rvs.some(rv => Math.hypot(rv.root.position.x - c.x, rv.root.position.z - c.z) < r)) return true;
    return this._players.some(p => !p.dead && Math.hypot(p.x - c.x, p.z - c.z) < r);
  }
  _setPhase(ph, t, n) {
    const was = this.ph;
    this.ph = ph; this.t = t; this.n = n; this.dirty = true;
    if (ph === 'night') this.spawnT = 2;
    if (was !== ph) this._onPhase(ph, false);
  }
  _onPhase(ph, fromNet) {
    const g = this.g, p = g.player;
    g.world.setNight(ph === 'night', true);
    if (ph === 'night') {
      if (this.stage !== 'siege') g.toast(`🌙 Night ${this.n} — zombies are coming! Shotgun: G · safe spots: inside / on top of the RV (ladder at the back)`);
      if (p.mode === 'drive' && !p.rv.headlights) p.rv.toggleHeadlights();
      if (!g.inv.equippedItem() && !p.downed && !p.dead && p.mode === 'foot') g.combat.setOut(true);
      audio.groan(1);
    } else {
      g.toast(this.anyDamaged() ? '☀ Morning! Repair the RV with the hammer — it only drives at 100%' : '☀ Morning! The zombies are gone… for now');
      if (!fromNet && this.auth) g.zombies.burnAll();
    }
  }
  _toStage(st) {
    this.stage = st; this.dirty = true;
    if (st === 'tbuild') { this.t = BUILD_LEN; this._setPhase('day', BUILD_LEN, this.n); }
    if (st === 'siege') { this.t = NIGHT_LEN; this.spawnT = 1; this._setPhase('night', NIGHT_LEN, this.n + 1); }
    if (st === 'trail2') this._setPhase('day', DAYS[Math.min(this.n, 2)], this.n);
    if (st === 'cbuild') { this.t = BUILD_LEN; this._setPhase('day', BUILD_LEN, this.n); }
    if (st === 'giants') { this.t = 0; this._setPhase('day', 0, this.n); this.g.giants.reset(); this.giantT = 30; for (let i = 0; i < 2; i++) this.g.giants.spawn(this._giantHp()); }
    this._onStage(st, false);
  }
  _onStage(st, fromNet) {
    const g = this.g;
    const msg = {
      tbuild: '🛠 Watchtower Valley! You have 10 minutes: collect logs, planks, rope & stone, then design and build towers at the Tower workbench. A zombie horde comes next!',
      siege: '🧟 THE HORDE IS HERE! Climb your towers (E at the ladder) and hold them for 5 minutes. Repair them with the hammer.',
      trail2: '☀ You survived the siege! Drive on to the Giant Plateau.',
      cbuild: '🏰 Giant Plateau! 10 minutes to collect stone and build a castle wall at the Castle workbench. Giants come next — your weapon is now a CANNON.',
      giants: '🗿 GIANTS! They throw boulders — stay behind your walls and blast them with your cannon (G, then click / F).',
    }[st];
    if (msg) g.toast(msg);
    if (st === 'giants' || st === 'cbuild') g.combat.setOut(false);
    if (st === 'siege' && !g.inv.equippedItem() && !g.player.downed && !g.player.dead && g.player.mode === 'foot') g.combat.setOut(true);
    if (!fromNet && st === 'trail2' && this.auth) g.zombies.burnAll();
    g.onStage && g.onStage(st);
  }
  ready() {
    if (this.net.isGuest) { this.net.send('ready', {}, true); return; }
    if ((this.stage === 'tbuild' || this.stage === 'cbuild') && this.t > 10) { this.t = 10; this.dirty = true; this._say(this.stage === 'tbuild' ? '⏩ The team is ready — the horde comes in 10 seconds!' : '⏩ The team is ready — the giants come in 10 seconds!'); }
  }
  canReady(kind) { return (kind === 'towers' && this.stage === 'tbuild') || (kind === 'castle' && this.stage === 'cbuild'); }

  /* ---------------- building (host validates and spends the team's materials) ---------------- */
  commitBuild(kind, design, local) {
    const g = this.g, S = g.structures;
    if (kind === 'towers' && !this.at('tbuild')) return 'Towers are built at Watchtower Valley';
    if (kind === 'castle' && !this.at('cbuild')) return 'The castle is built at the Giant Plateau';
    if (kind === 'towers' ? S.tDesign : S.cDesign) return 'Already built';
    const probs = kind === 'towers' ? towerProblems(design) : castleProblems(design);
    if (probs.length) return probs[0];
    if (this.net.isGuest && local) { this.net.send('sbuild', { kind, design }, true); return null; }
    const cost = kind === 'towers' ? towerCost(design) : castleCost(design);
    if (!g.materials.spend(cost)) return 'Not enough materials';
    this._applyBuild(kind, design);
    if (this.net.online) this.net.send('sbuilt', { kind, design });
    this._say(kind === 'towers' ? '🗼 The towers are going up!' : '🏰 The castle walls are rising!');
    this.dirty = true;
    return null;
  }
  _applyBuild(kind, design) { if (kind === 'towers') this.g.structures.buildTowers(design); else this.g.structures.buildCastle(design); }

  /* ---------------- zombies (host / solo) ---------------- */
  _collect() {
    const out = this._players, g = this.g, p = g.player;
    out.length = 0;
    p.char.root.getWorldPosition(this._w);
    out.push({ id: this.myId, x: this._w.x, y: this._w.y, z: this._w.z, safe: this.safeSpot(), down: p.downed, dead: !!p.dead, seated: SEATED.has(p.anim.a) });
    g.remotes.each((r, w) => out.push({ id: r.id, x: w.x, y: w.y, z: w.z, safe: r.s.sf ?? -1, down: !!r.s.dn, dead: !!r.s.dd, seated: SEATED.has(r.s.a) }));
    return out;
  }
  _spawn(dt) {
    const siege = this.stage === 'siege';
    if (this.ph !== 'night' || this.t < 6 || this.over) return;
    if (!siege && this.stage !== 'trail' && this.stage !== 'trail2') return;
    const g = this.g, players = this._players.filter(p => !p.dead), Z = g.zombies;
    if (!players.length || (this.spawnT -= dt) > 0) return;
    const alive = Z.aliveCount(), np = Math.max(1, players.length), L = this.level;
    const max = Math.min(ZMAX - 2, siege ? 12 + 3 * (np - 1) : 7 + 3 * (np - 1) + 2 * Math.min(this.n - 1, 4) + L);
    const prog = 1 - this.t / NIGHT_LEN;
    this.spawnT = siege ? lerp(1.6, 0.9, prog) : lerp(3.4, 1.7, prog) * (np > 1 ? 0.8 : 1);
    if (alive >= max) return;
    const W = g.world, b = W.bounds;
    const k = 1 + (Math.random() < 0.4 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
    for (let i = 0; i < k && alive + i < max; i++) {
      const c = siege ? { x: TOWER_ZONE.x, z: TOWER_ZONE.z } : players[(Math.random() * players.length) | 0];
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2, d = siege ? 30 + Math.random() * 18 : 24 + Math.random() * 16;
        const x = c.x + Math.sin(a) * d, z = c.z + Math.cos(a) * d;
        if (x < b.minX + 6 || x > b.maxX - 6 || z < b.minZ + 6 || z > b.maxZ - 6) continue;
        if (W.waterDepth(x, z) > 0.15) continue;
        if (players.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < 14 * 14)) continue;
        if (g.rvs.some(r => (r.root.position.x - x) ** 2 + (r.root.position.z - z) ** 2 < 49)) continue;
        const fast = Math.random() < 0.12 + 0.03 * L;
        Z.spawn(x, z, (fast ? 3.0 + Math.random() * 0.6 : 1.4 + Math.random() * 1.0) * (1 + 0.06 * L), Math.round(100 * (1 + 0.35 * L)));
        break;
      }
    }
  }
  _strike(z, tg) {
    const g = this.g, mult = 1 + 0.2 * this.level;
    if (tg.st !== undefined) {
      const st = tg.st;
      if (st < 10) {
        if (!this.wrecked(st)) { this._rvDamage(st, RV_BITE * mult); if (g.camera.position.distanceTo(g.rvs[st].root.position) < 25) audio.thud(85, 0.12); }
        else this._biteOn(st, BITE * mult);
      } else {
        const T = g.structures.towers[st - 10];
        if (T && T.alive) { if (g.structures.damage('t', st - 10, TOWER_BITE * mult)) this._say(`💥 Tower ${st - 9} collapsed!`, true); this.dirty = true; if (g.camera.position.distanceTo(this._v.set(T.x, T.y, T.z)) < 25) audio.thud(120, 0.08); }
        else this._biteOn(st, BITE * mult);
      }
      return;
    }
    const p = this._players.find(q => q.id === tg.id);
    if (!p || p.dead) return;
    if (p.safe >= 0 && this._structOk(p.safe)) return;        // climbed up just in time
    this._bite(p.id, BITE * mult);
  }
  _biteOn(st, d) { const vic = this._players.filter(p => p.safe === st && !p.dead && !p.seated); if (vic.length) this._bite(vic[(Math.random() * vic.length) | 0].id, d); }
  _bite(id, d, kind = 'z') { if (id === this.myId) this.damage(d, kind); else this.net.sendTo(id, 'zatk', { d: Math.round(d), k: kind }); }
  _structOk(sf) { return sf < 10 ? !this.wrecked(sf) : !!(this.g.structures.towers[sf - 10] && this.g.structures.towers[sf - 10].alive); }
  _rvDamage(i, d) {
    const before = this.rvHp(i), after = Math.max(0, before - d);
    this.rh[i] = after; this.dirty = true;
    const p = this.g.player;
    if (before >= 100 && after < 100 && p.mode === 'drive' && p.rv.index === i) p.rv.setEngine(false);
    if (after <= 0 && !this.wr[i]) { this.wr[i] = true; this._say('💥 The RV is wrecked! Zombies can reach you in and on it now — fight, then repair it'); }
    else if (Math.floor(before / 25) !== Math.floor(after / 25) && after > 0) this._say(`🧟 The RV is being smashed! (${Math.round(after)}%)`);
  }
  _fix(i, a) {
    const before = this.rvHp(i);
    this.rh[i] = Math.min(100, before + a);
    if (this.wr[i] && this.rh[i] >= 20) this.wr[i] = false;
    if (before < 100 && this.rh[i] >= 100) this._say('✅ RV fully repaired — it can drive again!');
    this.dirty = true;
  }

  /* ---------------- giants (host / solo) ---------------- */
  _giantHp() { const np = Math.max(1, this._players.filter(p => !p.dead).length); return 900 + 300 * (np - 1); }
  _giantsTick(dt) {
    const G = this.g.giants;
    this.giantT -= dt;
    if (G.spawned < GTOTAL && (this.giantT <= 0 || G.alive === 0)) {
      G.spawn(this._giantHp()); this.giantT = 30; this.dirty = true;
      this._say(`🗿 Another giant is coming! (${G.spawned}/${GTOTAL})`);
    }
    if (G.killed >= GTOTAL) this._end('won');
  }
  _throw(gi, from, to) {
    const G = this.g.giants, a = G.aim(from, to), id = ++G.bseq;
    G.launch(id, from.x, from.y, from.z, a.vx, a.vy, a.vz);
    if (this.net.online) this.net.send('bould', [id, r2(from.x), r2(from.y), r2(from.z), r2(a.vx), r2(a.vy), r2(a.vz)]);
  }
  _stomp(gi) {
    const g = this.g, S = g.structures;
    if (gi.punchW >= 0 && S.walls[gi.punchW] && S.walls[gi.punchW].alive) { if (S.damage('w', gi.punchW, 90)) this._say('💥 A giant smashed through the wall!', true); this.dirty = true; }
    const f = g.giants.frontOf(gi, this._v);
    for (const p of this._players) if (!p.dead && Math.hypot(p.x - f.x, p.z - f.z) < 5 && p.y < gi.y + 5) this._bite(p.id, 30, 'g');
    for (const r of g.rvs) if (r.root.position.distanceTo(f) < 6) this._rvDamage(r.index, 8);
  }
  _boulderHit(b, W, p) {
    const g = this.g;
    if (W) { if (g.structures.damage('w', W.i, 110)) this._say('💥 A boulder broke a wall!', true); this.dirty = true; }
    for (const q of this._players) {
      if (q.dead) continue;
      const d = Math.hypot(q.x - p.x, q.y + 1 - p.y, q.z - p.z);
      if (d < 3.6) this._bite(q.id, (W ? 0.3 : 1) * (34 * (1 - d / 3.6) + 8), 'g');
    }
    for (const r of g.rvs) if (r.root.position.distanceTo(p) < 4.5) this._rvDamage(r.index, 6);
    if (this.net.online) this.net.send('bimp', [b.id, r2(p.x), r2(p.y), r2(p.z)]);
  }
  // our cannonballs hit giants (Map id -> damage)
  onGiantHit(hits) {
    if (this.auth) { for (const [id, d] of hits) this._giantHit(id, d, this.myId); return; }
    const arr = [];
    for (const [id, d] of hits) { arr.push(id, Math.round(d)); const gi = this.g.giants.byId.get(id); if (gi) gi.flash = 1; }
    this.net.send('ghit', { h: arr }, true);
  }
  _giantHit(id, d, from) {
    const G = this.g.giants;
    if (G.hit(id, d)) {
      this._credit(from, 'g');
      this._say(`🗿 ${from === this.myId ? this.g.myName() : this.g.session.nameOf(from)} brought down a giant! (${G.killed}/${GTOTAL})`);
    }
    this.dirty = true;
  }

  /* ---------------- you: health, down, death, revive, carry ---------------- */
  // where you are safe from zombies: inside / on the RV (its index) or on a standing tower (10 + tower)
  safeSpot() {
    const p = this.g.player, rvs = this.g.rvs;
    if (p.carried || p.dead) return -1;
    if (p.frame === 'rv') return rvs.indexOf(p.rv);
    for (let i = 0; i < rvs.length; i++) { const roof = rvs[i].roofHeightAt(p.pos); if (roof !== null && p.pos.y >= roof - 0.35) return i; }
    const t = this.g.structures.towerAt(p.pos);
    return t >= 0 ? 10 + t : -1;
  }
  damage(d, kind = 'z') {
    const g = this.g, p = g.player;
    if (p.dead || this.over === 'won') return;
    const flash = () => { this.hurtT = 0; audio.hurt(); if (g.haptic) g.haptic(p.downed ? 120 : 45); const h = this.ui.hurt; if (h) { h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); } };
    if (p.downed) { this.bleed -= d * 0.7; flash(); if (this.bleed <= 0) this._die(); return; }     // eaten while down
    const sf = this.safeSpot();
    if (kind === 'z' && sf >= 0 && (this._structOk(sf) || SEATED.has(p.anim.a))) return;
    if (kind === 'g' && p.frame === 'rv' && !this.wrecked(g.rvs.indexOf(p.rv))) return;          // boulders can't reach inside the RV
    p.hp = Math.max(0, p.hp - d);
    flash();
    if (p.hp <= 0) this._down();
  }
  _down() {
    const g = this.g, p = g.player;
    if (p.carrying) this._drop();
    if ((p.mode === 'seat' || p.mode === 'lie') && p.frame === 'world') { p.mode = 'foot'; p.seat = null; }
    p.downed = true; p.hp = 0; this.reviving = null;
    if (g.haptic) g.haptic([120, 80, 220]);
    const team = this._teamAlive() > 0;
    this.bleed = team ? BLEED_COOP : BLEED_SOLO;
    g.combat.setOut(false);
    g.toast(team ? '💀 You are down! A teammate can revive you (hold E) or carry you to safety (X) — before you bleed out' : '💀 You are down… nobody can save you');
    if (team) this._say(`💀 ${g.myName()} is down! Hold E next to them to revive — quick!`, true);
  }
  _teamAlive() { let n = 0; this.g.remotes.map.forEach(r => { if (!r.s.dd && !r.s.dn) n++; }); return n; }
  // eliminated for good: watch the others (or leave)
  _die(silent = false) {
    const g = this.g, p = g.player;
    if (p.dead) return;
    if (p.carried) { p.carried = null; p.scene.add(p.char.root); }
    if (p.carrying) this._drop();
    p.dead = true; p.downed = false; p.hp = 0; this.reviving = null;
    g.combat.setOut(false);
    setTimeout(() => { if (p.dead) p.char.root.visible = false; }, 2500);
    if (!silent) {
      g.toast('☠ You were eliminated. You can watch your team (click / tap to switch) or leave the game.');
      if (this.net.online) this.net.send('dead', {});
      if (this.auth) { this._credit(this.myId, 'd'); if (this.net.online) this.deadCids.add(this.net.cid); }
    }
    this._nextSpect(0);
  }
  _revived(from) {
    const g = this.g, p = g.player;
    if (!p.downed || p.dead) return;
    if (p.carried) { p.carried = null; p.scene.add(p.char.root); }
    p.downed = false; p.hp = REVIVE_HP; this.bleed = 0; p.char.land(0.6);
    g.toast(`💚 ${g.session.nameOf(from)} revived you!`);
  }
  _carry(id) {
    const g = this.g, p = g.player;
    if (p.carrying || p.downed || p.dead || p.mode !== 'foot') return;
    p.carrying = id; this.carryT = 0; this.reviving = null;
    g.combat.setOut(false); g.gear.refreshHeld();
    this.net.send('carry', { t: id });
    g.toast(`🤝 You picked up ${g.session.nameOf(id)} — get them to safety (RV, its roof or a tower) · X to put down`);
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
  _startRevive(id) { const p = this.g.player; if (p.downed || p.carrying || p.dead) return; this.reviving = { id, t: 0 }; }
  playerGone(id) {
    const p = this.g.player;
    if (p.carrying === id) { p.carrying = null; this.g.gear.refreshHeld(); }
    if (p.carried === id) this._placeDropped({ f: 0, x: p.pos.x, y: p.pos.y + 0.3, z: p.pos.z });
    if (this.reviving && this.reviving.id === id) this.reviving = null;
    if (this.spect && this.spect.id === id) this._nextSpect(1);
  }
  // spectating (after you died): follow a living teammate
  _nextSpect(step) {
    const alive = [...this.g.remotes.map.values()].filter(r => !r.s.dd);
    if (!alive.length) { this.spect = null; this.g.rig.follow = null; return; }
    let i = this.spect ? alive.indexOf(this.spect) : -1;
    i = ((i < 0 ? 0 : i + step) % alive.length + alive.length) % alive.length;
    this.spect = alive[i]; this.g.rig.follow = this.spect.char.root;
  }

  // world prompts: revive / carry downed teammates
  acts() {
    const l = this._acts, g = this.g, p = g.player;
    l.length = 0;
    if (p.downed || p.carrying || p.dead) return l;
    g.remotes.each((r, w) => {
      if (!r.s.dn || r.s.cb || r.s.dd) return;
      const name = r.s.n || 'teammate';
      if (!r.act) r.act = { pos: new THREE.Vector3(), r: 1.9,
        label: () => (this.reviving && this.reviving.id === r.id ? `Reviving ${name}… ${Math.round((this.reviving.t / REVIVE_TIME) * 100)}%` : `Hold E — revive ${name} (+${PTS.revive} pts)`),
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
    if (this.auth) { for (const [id, d] of hits) if (Z.hit(id, d, dx, dz)) this._credit(this.myId, 'k'); return; }
    const arr = [];
    for (const [id, d] of hits) { arr.push(id, Math.round(d)); Z.predictHit(id, d); }
    this.net.send('zhit', { h: arr, x: r2(dx), z: r2(dz) }, true);
  }
  // hammer / sledgehammer swing: repairs the RV, a tower or a wall next to you
  repair(type) {
    const g = this.g, p = g.player;
    if (p.mode !== 'foot' || p.downed || p.dead) return false;
    const s = g.structures.damagedNear(p.pos);
    if (s) {
      const a = Math.max(8, s.S.max * (type === 'hammer' ? 0.05 : 0.04));
      if (this.auth) { g.structures.repair(s.kind, s.i, a); this.dirty = true; }
      else { g.structures.repair(s.kind, s.i, a); this.net.send('sfix', { k: s.kind, i: s.i, a }, true); }
      audio.thud(320, 0.05); setTimeout(() => audio.thud(520, 0.03), 60);
      g.toast(`🔧 Repairing ${s.kind === 't' ? 'tower ' + (s.i + 1) : s.S.gate ? 'the gate' : 'the wall'}… ${Math.round(s.S.hp / s.S.max * 100)}%`);
      return true;
    }
    const i = this._nearRV(1.7);
    if (i < 0) return false;
    if (this.rvHp(i) >= 100) { g.toast('The RV is in good shape'); return true; }
    const a = FIX[type] || 3;
    if (this.auth) this._fix(i, a);
    else { this.rh[i] = Math.min(100, this.rvHp(i) + a); this.net.send('rfix', { i, a }, true); }
    audio.thud(320, 0.05); setTimeout(() => audio.thud(520, 0.03), 60);
    g.toast(`🔧 Repairing the RV… ${Math.round(this.rvHp(i))}%${this.rvHp(i) < 100 ? ' (it drives again at 100%)' : ''}`);
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

  /* ---------------- game over / victory ---------------- */
  _checkWipe() {
    if (!this.auth || this.over) return;
    if (this._players.length && this._players.every(p => p.dead)) this._end('lost');
  }
  _end(res, fromNet = false) {
    if (this.over) return;
    this.over = res; this.dirty = true;
    if (res === 'won') this.stage = 'won';
    if (this.auth) { this.g.zombies.burnAll(); if (this.net.online) this.net.send('over', { r: res, sc: this._scRows() }); }
    audio.thud(res === 'won' ? 300 : 60, 0.6);
    this.g.onEnd && this.g.onEnd(res);
    setTimeout(() => this.showEnd(), fromNet ? 300 : 1200);
  }
  showEnd() {
    const res = this.over, rows = this.scoreRows(), u = this.ui;
    const best = (i) => rows.reduce((a, r) => (r[i] > (a ? a[i] : 0) ? r : a), null);
    const bk = best(2), br = best(4), bg = best(3);
    u.end.querySelector('.etitle').textContent = res === 'won' ? '🏆 Victory! The giants are defeated' : '💀 Game over';
    u.end.querySelector('.esub').textContent = res === 'won' ? `You survived ${this.n} zombie nights and took down all ${GTOTAL} giants.` : `Everyone was eliminated after ${this.n} night${this.n === 1 ? '' : 's'}.`;
    u.end.querySelector('.ebadges').innerHTML = [bk && bk[2] ? `🧟 Most zombie kills: <b>${esc(bk[0])}</b> (${bk[2]})` : '', bg && bg[3] ? `🗿 Giant slayer: <b>${esc(bg[0])}</b> (${bg[3]})` : '', br && br[4] ? `💚 Best medic: <b>${esc(br[0])}</b> (${br[4]} revives)` : ''].filter(Boolean).map(x => `<span>${x}</span>`).join('');
    u.end.querySelector('tbody').innerHTML = rows.map((r, i) => `<tr${i === 0 ? ' class="top"' : ''}><td>${i + 1}</td><td><i style="background:${this.g.session.colorOf ? this._colorOfSlot(r[1]) : '#fff'}"></i>${esc(r[0])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td><b>${r[6]}</b></td></tr>`).join('');
    u.end.classList.remove('hidden');
    this.g.onEndScreen && this.g.onEndScreen();
  }
  _colorOfSlot(c) { return this.g.colorOfSlot ? this.g.colorOfSlot(c) : '#fff'; }

  /* ---------------- per frame ---------------- */
  update(dt, input) {
    const g = this.g;
    if (this.auth) {
      this._collect();
      this._cycle(dt);
      this._spawn(dt);
      g.zombies.simulate(dt, this._ctx);
      if (this.stage === 'giants' || g.giants.list.length) g.giants.simulate(dt, this._gctx);
      g.giants.stepBoulders(dt, g.structures, (b, W, p) => this._boulderHit(b, W, p));
      this._checkWipe();
    } else {
      if (this.stage === 'trail' || this.stage === 'trail2' || this.stage === 'tbuild' || this.stage === 'cbuild' || this.stage === 'siege') this.t = Math.max(0, this.t - dt);
      g.zombies.follow(dt);
      g.giants.follow(dt);
      g.giants.stepBoulders(dt, g.structures, null);
    }
    g.zombies.render(dt, g.camera.position);
    g.giants.render(dt);
    this._local(dt, input);
    this._net(dt);
    this._hud(dt);
  }
  // host with the game loop asleep (background tab / designer open): keep things going for everyone
  background(dt) {
    if (!this.net.isHost) return;
    const n = Math.max(1, Math.round(dt / 0.1)), h = dt / n, g = this.g;
    for (let i = 0; i < n; i++) {
      this._collect(); this._cycle(h); this._spawn(h);
      g.zombies.simulate(h, this._ctx);
      if (this.stage === 'giants' || g.giants.list.length) g.giants.simulate(h, this._gctx);
      g.giants.stepBoulders(h, g.structures, (b, W, p) => this._boulderHit(b, W, p));
    }
    this._checkWipe();
    this._net(dt);
  }

  _local(dt, input) {
    const g = this.g, p = g.player;
    // dead: spectate (click / tap / F / arrows to switch)
    if (p.dead) {
      if (!this.spect || this.spect.s.dd || !g.remotes.map.has(this.spect.id)) this._nextSpect(0);
      if (input.click || input.wasPressed('KeyF') || input.wasPressed('ArrowRight') || input.wasPressed('KeyE')) this._nextSpect(1);
      if (input.wasPressed('ArrowLeft')) this._nextSpect(-1);
      return;
    }
    // health regeneration: steady in daylight, slow at night and only when safe
    this.hurtT += dt;
    if (!p.downed && p.hp < 100) {
      const rate = this.ph === 'day' ? (this.hurtT > 4 ? 6 : 0) : (this.safeSpot() >= 0 && this.hurtT > 6 ? 1.5 : 0);
      p.hp = Math.min(100, p.hp + rate * dt);
    }
    // knocked down: bleed out unless carried or lying somewhere safe; nobody can help you -> eliminated
    if (p.downed) {
      const sf = this.safeSpot(), safe = sf >= 0 && this._structOk(sf);
      if (!p.carried && !safe) this.bleed -= dt;
      if (this.net.online && this._teamAlive() === 0 && !p.carried) this.bleed -= dt * 3;
      if (this.bleed <= 0) this._die();
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
      if (!r || !r.s.dn || r.s.dd || (this.carryT > 1.5 && r.s.cb !== this.myId)) { p.carrying = null; g.gear.refreshHeld(); }
      else {
        p.prompt = { key: 'X', text: `Put ${r.s.n || 'them'} down${this.safeSpot() >= 0 ? ' (safe here)' : ''}` };
        if (this.carryT > 0.3 && input.wasPressed('KeyX')) this._drop();
      }
    }
    // holding E next to a downed teammate
    if (this.reviving) {
      const rv = this.reviving, r = g.remotes.map.get(rv.id);
      let ok = r && r.s.dn && !r.s.cb && !r.s.dd && (input.isDown('KeyE') || input.touch) && !p.downed && !p.carrying;
      if (ok) { r.char.root.getWorldPosition(this._w); ok = this._w.distanceTo(p.char.root.getWorldPosition(this._v)) < 2.3; }
      if (!ok) this.reviving = null;
      else if ((rv.t += dt) >= REVIVE_TIME) {
        this.net.send('revive', { t: rv.id });
        if (this.auth) this._credit(this.myId, 'r');
        g.toast(`💚 You revived ${r.s.n || 'your teammate'} (+${PTS.revive} pts)`);
        this.reviving = null;
      }
    }
    // repair hints next to a damaged RV / tower / wall
    if (!p.prompt && p.mode === 'foot' && !p.downed && !p.carrying) {
      const eq = g.inv.equippedItem(), tool = eq && FIX[eq.type];
      const s = g.structures.damagedNear(p.pos);
      const i = this._nearRV(1.7);
      const what = s ? `${s.kind === 't' ? 'Tower ' + (s.i + 1) : s.S.gate ? 'Gate' : 'Wall'} ${Math.round(s.S.hp / s.S.max * 100)}%` : i >= 0 && this.rvHp(i) < 100 ? `RV ${Math.round(this.rvHp(i))}%` : null;
      if (what) p.prompt = tool ? { key: 'F', text: `Repair — ${what}` } : { key: '🔨', text: `${what} — hold the hammer (Gear Locker) and press F to repair` };
    }
  }

  /* ---------------- HUD ---------------- */
  _hud(dt) {
    const g = this.g, p = g.player, u = this.ui;
    if ((this.uiT -= dt) > 0) return;
    this.uiT = 0.2;
    const rvTxt = g.rvs.map((r, i) => (this.rvHp(i) < 100 ? ` · 🚐${g.rvs.length > 1 ? i + 1 : ''} ${this.wrecked(i) ? 'WRECKED ' : ''}${Math.round(this.rvHp(i))}%` : '')).join('');
    const S = g.structures, towers = S.towers.length ? ` · 🗼 ${S.towers.filter(t => t.alive).length}/${S.towers.length}` : '', walls = S.walls.length ? ` · 🏰 ${Math.round(100 * S.walls.reduce((a, w) => a + w.hp, 0) / Math.max(1, S.walls.reduce((a, w) => a + w.max, 0)))}%` : '';
    const L = this.level, lv = L ? ` · ⚔ Lv ${L}` : '';
    let txt, cls = '';
    if (this.over === 'won') { txt = `🏆 Victory! All ${GTOTAL} giants defeated`; cls = 'won'; }
    else if (this.over === 'lost') { txt = '💀 Game over'; cls = 'night'; }
    else if (this.stage === 'tbuild') { txt = `🛠 Build your towers! The horde comes in ${fmt(this.t)}${towers}`; cls = 'build'; }
    else if (this.stage === 'siege') { txt = `🧟 SIEGE · hold on ${fmt(this.t)} · 🧟 ${g.zombies.aliveCount()}${towers}${lv}`; cls = 'night'; }
    else if (this.stage === 'cbuild') { txt = `🏰 Build your castle! Giants come in ${fmt(this.t)}${walls}`; cls = 'build'; }
    else if (this.stage === 'giants') { txt = `🗿 Giants remaining ${g.giants.remaining} / ${GTOTAL} · on the field ${g.giants.alive}${walls}`; cls = 'giants'; }
    else if (this.ph === 'night') { txt = `🌙 Night ${this.n} · dawn in ${fmt(this.t)} · 🧟 ${g.zombies.aliveCount()}${rvTxt}${lv}`; cls = 'night'; }
    else { txt = `☀ Day ${this.n + 1} · 🌙 zombies in ${fmt(this.t)}${rvTxt}${lv}`; cls = this.t < 30 ? 'soon' : ''; }
    const key = txt + cls;
    if (key !== this.uiKey) { this.uiKey = key; u.cycle.textContent = txt; u.cycle.className = 'panel ' + cls; }
    // your health
    const hp = Math.round(p.hp);
    u.hpFill.style.width = hp + '%';
    u.hpFill.className = hp > 50 ? '' : hp > 25 ? 'mid' : 'low';
    u.hpText.textContent = p.dead ? '☠' : p.downed ? 'DOWN' : '❤ ' + hp;
    // downed overlay / spectator bar
    if (p.downed !== this._dn) { this._dn = p.downed; u.downed.classList.toggle('hidden', !p.downed); document.body.classList.toggle('downed', p.downed); }
    if (p.downed) {
      const team = this._teamAlive() > 0, sf = this.safeSpot();
      u.downedText.textContent = p.carried ? `${g.session.nameOf(p.carried)} is carrying you…`
        : sf >= 0 && this._structOk(sf) ? `You are safe here — a teammate can revive you (hold E next to you) · ${Math.ceil(this.bleed)} s`
          : team ? `Wait for a teammate to revive you · ${Math.ceil(this.bleed)} s` : `Bleeding out… ${Math.ceil(this.bleed)}`;
    }
    const spec = !!p.dead;
    if (spec !== this._sp) { this._sp = spec; u.spec.classList.toggle('hidden', !spec); document.body.classList.toggle('dead', spec); }
    if (spec) u.specName.textContent = this.spect ? `Watching ${this.spect.s.n || 'a teammate'}` : 'No teammates left to watch';
    // team list (co-op)
    if (!this.net.online) { if (this.teamKey) { this.teamKey = ''; u.team.classList.add('hidden'); } return; }
    const vc = g.voice, pts = name => { const r = this.sc.find(x => x[0] === name); return r ? r[6] : 0; };
    const rows = [{ n: 'You', nm: g.myName(), c: g.session.colorOf(this.net.id), hp: p.hp, dn: p.downed, dd: p.dead, sf: this.safeSpot(), a: p.anim.a, v: vc && vc.micOn ? (vc.meTalking ? '🔊' : '🎙') : '' }];
    g.remotes.map.forEach(r => rows.push({ n: r.s.n || 'Player', nm: r.s.n, c: r.color, hp: r.s.hp ?? 100, dn: !!r.s.dn, dd: !!r.s.dd, sf: r.s.sf ?? -1, a: r.s.a, away: r.away, v: r.talking ? '🔊' : r.s.mc ? '🎙' : '' }));
    const html = rows.map(r => {
      const k = r.dd ? 0 : Math.max(0, Math.min(100, Math.round(r.hp)));
      const st = r.dd ? '☠' : r.dn ? '⬇' : r.a === 'drive' ? '🚐' : r.sf >= 10 ? '🗼' : r.sf >= 0 ? '🛡' : '';
      return `<div class="trow${r.dn ? ' dn' : ''}${r.dd ? ' dd' : ''}${r.away ? ' away' : ''}"><i style="background:${r.c}"></i><span>${esc(r.n)}${r.v ? ' <small>' + r.v + '</small>' : ''}</span><b><u class="${k > 50 ? '' : k > 25 ? 'mid' : 'low'}" style="width:${k}%"></u></b><em>${st}</em><small class="pts">${pts(r.nm)}</small></div>`;
    }).join('');
    if (html !== this.teamKey) { this.teamKey = html; u.team.innerHTML = html; u.team.classList.remove('hidden'); }
  }
}
