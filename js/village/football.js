// Football on the village green (Farm World): a real match on the fenced pitch, against or with the village kids,
// or with friends.
//   - Walk onto the pitch: "Play football" (E). Alone, the match starts at once: you and a village keeper (Blue)
//     against two village kids, a forward and a keeper (Red). With friends online you pick the teams first: together
//     against the kids, one against one (each with a village keeper), two against one plus a keeper… A team has two
//     places; a village kid takes any place nobody plays, and a kid alone with a player keeps goal.
//   - Run onto the ball to dribble it, F / click to shoot (the way you face), E to pass to your team-mate, Q to leave.
//     On a phone: KICK, PASS and the leave button.
//   - Three minutes; a goal brings everyone back for a kick-off from the centre, the team that let it in kicks off.
//     Village people come and watch from the benches; the kids in the match wear their team's colour.
// The player who starts the match runs it: the ball and the village kids are worked out on their screen and sent
// to everyone 15 times a second; the others send their kicks to them. Everyone moves their own player as usual.
import * as THREE from 'three';
import { MAT } from '../utils.js';
import { football as ballGeo } from './props.js';
import { PITCH } from './interactions.js';

const { HL, HW, GOAL } = PITCH;
const DUR = 180, BALL_R = 0.11, BODY_R = 0.34, FRICTION = 2.3, GRAV = 9.8, SEND_MS = 66;
export const TEAMS = { A: { name: 'Blue', col: 0x2f6fd8, css: '#4a86ee' }, B: { name: 'Red', col: 0xd8402a, css: '#ee5a44' } };
const KO = { fw: [-1.9, 0.3], fw2: [-3.3, -1.6], gk: [-HL + 0.55, 0] };      // team A's kick-off places (B: mirrored)
const NPC_SPEED = { fw: 3.3, fw2: 3.0, gk: 3.0 };
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ACT = ['stand', 'kick', 'catch', 'celebrate', 'run'];

export class Football {
  // g: { village, world, player, net, session, remotes, touch, toast, hud, sound: { kick(), whistle(), cheer() }, openOptions(options, pick) }
  constructor(scene, g) {
    this.scene = scene; this.g = g; this.m = null; this.on = false; this.sendT = 0; this.t = 0;
  }
  get people() { return this.g.village.people; }
  get field() { return this.people && this.people.field; }
  get active() { return !!this.m; }
  myId() { return this.g.net.online ? this.g.net.id : 'me'; }
  nameOf(id) { if (id === this.myId()) return 'You'; const p = this.g.session && this.g.session.players && this.g.session.players.get(id); return p ? p.n : 'A friend'; }
  enable() {
    if (this.on || !this.field || this.field.node < 0) return;
    this.on = true;
    this.ball = new THREE.Mesh(ballGeo(), MAT.solid); this.ball.castShadow = true; this.ball.visible = false; this.scene.add(this.ball);
    // a ring of the team's colour under every player in the match
    const ring = new THREE.RingGeometry(0.42, 0.52, 20).rotateX(-Math.PI / 2);
    this.rings = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false })); m.visible = false; m.renderOrder = 2; this.scene.add(m); return m; });
    // the scoreboard, big messages, the keys
    const hud = this.g.hud;
    this.board = document.createElement('div'); this.board.id = 'fbBoard'; this.board.className = 'hidden'; hud.appendChild(this.board);
    this.msg = document.createElement('div'); this.msg.id = 'fbMsg'; this.msg.className = 'hidden'; hud.appendChild(this.msg);
    this.hint = document.createElement('div'); this.hint.id = 'fbHint'; this.hint.className = 'hidden'; hud.appendChild(this.hint);
    const net = this.g.net;
    net.on('fbStart', (d, from) => this._onStart(d, from));
    net.on('fbS', d => this._onState(d));
    net.on('fbK', d => { if (this.m && this.isHost && d && d.id === this.m.id) this._kick(this.m.slots[d.slot], d.kind, d.dir, true); });
    net.on('fbLeave', d => { if (this.m && d && d.id === this.m.id && this.isHost) { const s = this.m.slots[d.slot]; if (s && s.who === d.who) { s.who = null; s.init = false; this._say(`${this.nameOf(d.who)} left the match — a village kid plays instead`); } } });
    net.on('fbEnd', d => { if (this.m && d && d.id === this.m.id) this._finish(d.sc, d.why); });
    this._q = new THREE.Quaternion(); this._ax = new THREE.Vector3();
  }
  get isHost() { return this.m && this.m.host === this.myId(); }
  // field-local <-> world
  _local(x, z) { const F = this.field, c = Math.cos(F.yaw), s = Math.sin(F.yaw), dx = x - F.x, dz = z - F.z; return [dx * c - dz * s, dx * s + dz * c]; }
  _world(lx, lz) { return this.field.at(lx, lz); }
  _dirW(ux, uz) { const c = Math.cos(this.field.yaw), s = Math.sin(this.field.yaw); return [ux * c + uz * s, -ux * s + uz * c]; }
  _dirL(wx, wz) { const c = Math.cos(this.field.yaw), s = Math.sin(this.field.yaw); return [wx * c - wz * s, wx * s + wz * c]; }
  _onPitch(x, z, pad = 1.2) { const [lx, lz] = this._local(x, z); return Math.abs(lx) < HL + pad && Math.abs(lz) < HW + pad; }

  /* ---------- starting ---------- */
  // the "Play football" prompt on the pitch
  acts() {
    if (!this.on || this.m) return [];
    const F = this.field, y = this.g.world.heightAt(F.x, F.z);
    return [{ pos: { x: F.x, y, z: F.z }, r: Math.max(HL, HW) + 1.5, label: () => (this._friends().length ? 'Play football (pick the teams)' : 'Play football with the village kids'), act: () => this.choose() }];
  }
  _friends() {
    const S = this.g.session;
    if (!this.g.net.online || !S || !S.players) return [];
    return [...S.players.keys()].filter(id => id !== this.myId());
  }
  // alone: play at once; friends online: pick the teams
  choose() {
    const me = this.myId(), fr = this._friends(), N = (id, w) => ({ who: id, role: w });
    const npcs = [{ label: 'Play with the village kids', sub: 'You + a village keeper (Blue) vs two village kids (Red)', A: [N(me, 'fw'), N(null, 'gk')], B: [N(null, 'fw'), N(null, 'gk')] }];
    if (!fr.length) { this.start(npcs[0]); return; }
    const opts = [...npcs];
    for (const f of fr) opts.push({ label: `You and ${this.nameOf(f)} vs the village kids`, sub: 'Two of you (Blue) against a village forward and keeper (Red)', A: [N(me, 'fw'), N(f, 'fw2')], B: [N(null, 'fw'), N(null, 'gk')] });
    for (const f of fr) opts.push({ label: `You vs ${this.nameOf(f)}`, sub: 'One on one — each with a village kid in goal', A: [N(me, 'fw'), N(null, 'gk')], B: [N(f, 'fw'), N(null, 'gk')] });
    if (fr.length >= 2) for (const f of fr) { const rest = fr.filter(x => x !== f); if (rest.length === 1) opts.push({ label: `You + ${this.nameOf(f)} vs ${this.nameOf(rest[0])} + a village keeper`, sub: 'Two against one (and a village kid in goal)', A: [N(me, 'fw'), N(f, 'fw2')], B: [N(rest[0], 'fw'), N(null, 'gk')] }); }
    if (fr.length === 2) opts.push({ label: `You + a village keeper vs ${this.nameOf(fr[0])} + ${this.nameOf(fr[1])}`, sub: 'You alone (with a village kid in goal) against both friends', A: [N(me, 'fw'), N(null, 'gk')], B: [N(fr[0], 'fw'), N(fr[1], 'fw2')] });
    if (fr.length >= 3) for (const f of fr) { const rest = fr.filter(x => x !== f); opts.push({ label: `You + ${this.nameOf(f)} vs ${rest.map(x => this.nameOf(x)).join(' + ')}`, sub: 'Two against two', A: [N(me, 'fw'), N(f, 'fw2')], B: [N(rest[0], 'fw'), N(rest[1], 'fw2')] }); }
    this.g.openOptions(opts, o => this.start(o));
  }
  start(opt) {
    if (this.m || !this.on) return;
    const slots = [...opt.A.map(s => ({ team: 'A', ...s })), ...opt.B.map(s => ({ team: 'B', ...s }))].map((s, i) => ({ i, team: s.team, role: s.role, who: s.who }));
    const d = { id: Math.random().toString(36).slice(2, 10), host: this.myId(), slots: slots.map(s => [s.team, s.role, s.who]) };
    this._onStart(d, this.myId());
    try { this.g.net.send('fbStart', d); } catch (e) { /* alone */ }
  }
  _onStart(d, from) {
    if (!this.on || !d || !d.slots) return;
    if (this.m && this.m.id !== d.id) { if (this.m.host === this.myId()) return; this._cleanup(); }
    const me = this.myId(), kids = this.people.npcs.filter(n => n.age === 'child');
    const slots = d.slots.map(([team, role, who], i) => ({ i, team, role, who, x: 0, z: 0, vx: 0, vz: 0, face: 0, act: 'stand', kickT: 0, cool: 0, init: false }));
    let k = 0;
    for (const s of slots) if (!s.who) s.npc = kids[k++] || null;           // the village kids who play (the same ones on every screen)
    for (const s of slots) if (!s.npc && kids[k]) s.spare = kids[k++];       // (a kid ready to take a place someone leaves)
    const m = this.m = { id: d.id, host: d.host, slots, sc: [0, 0], clk: DUR, ph: 'intro', pt: 0, ko: 0, kt: 'A', ball: { x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0 }, ev: 0, seenEv: 0, last: performance.now() };
    // the kids run in from the gate; the watchers take their seats
    const [gx, gz] = this._local(this.field.gate.x, this.field.gate.z);
    for (const s of slots) { s.x = gx + (s.i % 2 ? 0.6 : -0.6); s.z = gz; }
    this._dress(true);
    this.people.matchOn = true;
    const mine = slots.find(s => s.who === me);
    if (mine) {
      const p = this.g.player;
      if (p.mode !== 'foot') { this._leave(true); this.g.toast(`⚽ ${this.nameOf(d.host)} started a football match — you can join from the pitch`); return; }
      this._toKickoff(mine);
      this.g.toast(mine.team === 'A' ? '⚽ Football! You play for Blue — Q to leave' : '⚽ Football! You play for Red — Q to leave');
    } else if (from !== me) this.g.toast(`⚽ ${this.nameOf(d.host)} started a football match on the village green`);
    this.g.sound.whistle();
  }
  // the village kids in the match wear their team's colour (and their own clothes again afterwards)
  _dress(on) {
    const P = this.people;
    for (const s of this.m.slots) for (const n of [s.npc, s.spare]) if (n) P.crowd.look(n.kind, n.idx, on && n === s.npc ? { ...n.L, top: TEAMS[s.team].col } : n.L);
  }
  _kickoffSpot(s) {
    const m = this.m, base = KO[s.role] || KO.fw, sgn = s.team === 'A' ? 1 : -1;
    if (s.role === 'fw' && m.kt === s.team) return [-sgn * 0.42, 0];
    return [base[0] * sgn, base[1] * sgn];
  }
  // your own player to your kick-off place, facing the other goal
  _toKickoff(s) {
    const p = this.g.player, [lx, lz] = this._kickoffSpot(s), [x, z] = this._world(lx, lz);
    if (p.mode !== 'foot') return;
    p.pos.set(x, this.g.world.heightAt(x, z), z); p.vel.set(0, 0); p.vy = 0;
    const [wx, wz] = this._dirW(s.team === 'A' ? 1 : -1, 0); p.yaw = Math.atan2(wx, wz);
  }

  /* ---------- your keys ---------- */
  input(input) {
    if (!this.m) return;
    const mine = this.m.slots.find(s => s.who === this.myId());
    if (!mine) return;
    const take = code => { if (input.wasPressed(code)) { input.pressed.delete(code); return true; } return false; };
    if (take('KeyQ')) { this._leave(); return; }
    const shot = take('KeyF') || (input.click && !(input.click = false));
    const pass = take('KeyE');
    if (this.m.ph !== 'play' || this.g.player.mode !== 'foot') return;
    if (shot || pass) {
      const p = this.g.player, [ux, uz] = this._dirL(Math.sin(p.yaw), Math.cos(p.yaw));
      const kind = pass ? 'pass' : 'shot';
      if (this.isHost) this._kick(mine, kind, [ux, uz]);
      else { try { this.g.net.send('fbK', { id: this.m.id, slot: mine.i, kind, dir: [ux, uz] }); } catch (e) { /* lost */ } }
      if (p.char && p.char.swing) p.char.swing('kick');
    }
  }
  _leave(silent) {
    const m = this.m;
    if (!m) return;
    if (this.isHost) { this._broadcastEnd('left'); this._finish(m.sc, 'left'); return; }
    const mine = m.slots.find(s => s.who === this.myId());
    if (mine) { try { this.g.net.send('fbLeave', { id: m.id, slot: mine.i, who: mine.who }); } catch (e) { /* lost */ } mine.who = null; }
    if (!silent) this.g.toast('You left the match — you can watch from the side');
  }

  /* ---------- the match (on the screen of the player who started it) ---------- */
  _bodies(dt) {
    const me = this.myId();
    for (const s of this.m.slots) {
      if (!s.who) continue;
      const p = s.who === me ? this.g.player.pos : (this.g.remotes.map.get(s.who) || {}).pos;
      if (!p) continue;
      const [lx, lz] = this._local(p.x, p.z);
      s.vx = s.init && dt > 0 ? (lx - s.x) / dt : 0; s.vz = s.init && dt > 0 ? (lz - s.z) / dt : 0;
      if (Math.hypot(s.vx, s.vz) > 15) { s.vx = 0; s.vz = 0; }
      s.x = lx; s.z = lz; s.init = true;
    }
  }
  _sim(dt) {
    const m = this.m;
    m.pt += dt;
    for (const s of m.slots) { s.cool = Math.max(0, s.cool - dt); s.kickT = Math.max(0, s.kickT - dt); }
    this._bodies(dt);
    if (m.ph === 'intro' || m.ph === 'kickoff') {
      m.ball = { x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0 };
      for (const s of m.slots) if (!s.who) { const [tx, tz] = this._kickoffSpot(s); this._move(s, tx, tz, 3.6, dt); s.act = null; s.face = this._faceL(s.team === 'A' ? 1 : -1, 0); }
      if (m.pt > (m.ph === 'intro' ? 4.5 : 3)) { m.ph = 'play'; m.pt = 0; this._event('whistle'); }
    } else if (m.ph === 'play') {
      m.clk = Math.max(0, m.clk - dt);
      this._ai(dt);
      for (let k = 0; k < 2; k++) this._ballStep(dt / 2);
      if (m.clk <= 0 && m.ph === 'play') { m.ph = 'over'; m.pt = 0; this._event('end'); }
    } else if (m.ph === 'goal') {
      for (const s of m.slots) if (!s.who) { s.act = s.team === m.scorer ? 'celebrate' : 'stand'; this._move(s, s.x, s.z, 0, dt); }
      for (let k = 0; k < 2; k++) this._ballStep(dt / 2);
      if (m.pt > 3.2) {
        if (m.clk <= 0) { m.ph = 'over'; m.pt = 0; this._event('end'); }
        else {
          m.ph = 'kickoff'; m.pt = 0; m.ko++; m.kt = m.scorer === 'A' ? 'B' : 'A';
          const mine = m.slots.find(s => s.who === this.myId());
          if (mine) this._toKickoff(mine);                                   // (friends go back when they hear of it)
        }
      }
    } else if (m.ph === 'over') {
      for (const s of m.slots) if (!s.who) { s.act = m.sc[0] === m.sc[1] ? 'stand' : (s.team === 'A') === (m.sc[0] > m.sc[1]) ? 'celebrate' : 'stand'; this._move(s, s.x, s.z, 0, dt); }
      if (m.pt > 6) { this._broadcastEnd('time'); this._finish(m.sc, 'time'); return; }
    }
    // tell the others
    if ((this.sendT -= dt * 1000) <= 0 && this.g.net.online) {
      this.sendT = SEND_MS;
      const b = m.ball, r = v => Math.round(v * 100) / 100;
      try {
        this.g.net.send('fbS', { id: m.id, ph: m.ph, pt: r(m.pt), clk: r(m.clk), sc: m.sc, ko: m.ko, kt: m.kt, ev: m.ev, et: m.et, sg: m.scorer || null, b: [r(b.x), r(b.z), r(b.y), r(b.vx), r(b.vz), r(b.vy)],
          n: m.slots.filter(s => !s.who).map(s => [s.i, r(s.x), r(s.z), r(s.face), ACT.indexOf(s.act || 'run'), r(s.kickT)]), w: m.slots.map(s => s.who) });
      } catch (e) { /* lost */ }
    }
  }
  _faceL(ux, uz) { const [wx, wz] = this._dirW(ux, uz); return Math.atan2(wx, wz); }
  _move(s, tx, tz, speed, dt) {
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz), step = Math.min(d, speed * dt);
    const vx = d > 0.02 ? dx / d * speed : 0, vz = d > 0.02 ? dz / d * speed : 0;
    s.vx += (vx - s.vx) * c01(dt * 8); s.vz += (vz - s.vz) * c01(dt * 8);
    if (d > 0.02) { s.x += dx / d * step; s.z += dz / d * step; }
    if (Math.hypot(s.vx, s.vz) > 0.4) s.face = this._faceL(s.vx, s.vz);
  }
  // the village kids: the keeper guards the goal and clears; the forward chases the ball, dribbles and shoots
  _ai(dt) {
    const m = this.m, b = m.ball;
    for (const s of m.slots) {
      if (s.who) continue;
      const att = s.team === 'A' ? 1 : -1, own = -att * HL, d = Math.hypot(b.x - s.x, b.z - s.z);
      let tx, tz, speed = NPC_SPEED[s.role] || 3.2;
      if (s.role === 'gk') {
        tx = own + att * 0.55; tz = clamp(b.z * 0.75, -GOAL + 0.2, GOAL - 0.2);
        const inBox = Math.abs(b.x - own) < 2 && Math.abs(b.z) < GOAL + 0.9, slow = Math.hypot(b.vx, b.vz) < 2.6;
        if (inBox && slow) { tx = b.x - att * 0.36; tz = b.z; }
        if (d < 0.8 && b.y < 1.4 && s.cool <= 0) {
          const fast = Math.hypot(b.vx, b.vz) > 8;
          if (Math.random() < (fast ? 0.55 : 0.88)) { this._npcKick(s, 'clear'); s.act = 'catch'; }
          else s.cool = 0.7;                                                            // too quick for him
        }
        this._move(s, tx, tz, speed, dt);
        if (s.kickT <= 0) s.act = Math.hypot(s.vx, s.vz) > 0.4 ? null : (s.act === 'catch' && s.cool > 0.2 ? 'catch' : 'stand');
        if (Math.hypot(s.vx, s.vz) <= 0.4) s.face = this._faceL(att, 0);
        continue;
      }
      // a forward: the one of its team nearest the ball goes for it
      const mates = m.slots.filter(o => o.team === s.team && o.role !== 'gk');
      const chaser = mates.reduce((best, o) => (Math.hypot(b.x - o.x, b.z - o.z) < Math.hypot(b.x - best.x, b.z - best.z) ? o : best), mates[0]);
      if (chaser === s) {
        tx = b.x - att * 0.42; tz = b.z;
        if (d < 0.6 && s.cool <= 0 && b.y < 0.8) this._npcKick(s, Math.abs(att * HL - b.x) < 5.6 ? 'shot' : 'dribble');
      } else { tx = clamp(b.x * 0.5 + att * 1.6, -HL + 1, HL - 1); tz = b.z > 0 ? -1.4 : 1.4; speed = 2.2; }
      this._move(s, tx, tz, speed, dt);
      if (s.kickT <= 0) s.act = Math.hypot(s.vx, s.vz) > 0.4 ? null : 'stand';
      if (Math.hypot(s.vx, s.vz) <= 0.4) s.face = Math.atan2(...this._dirW(b.x - s.x, b.z - s.z));
    }
  }
  _npcKick(s, how) {
    const att = s.team === 'A' ? 1 : -1, b = this.m.ball;
    let ux, uz, sp, vy;
    if (how === 'clear') {
      const mate = this.m.slots.find(o => o.team === s.team && o !== s);
      if (mate && Math.random() < 0.5) { ux = mate.x - s.x; uz = mate.z - s.z; sp = clamp(Math.hypot(ux, uz) * 1.4 + 2.5, 5, 10); vy = 0.8; }
      else { ux = att; uz = (Math.random() - 0.5) * 1.2; sp = 8.5 + Math.random() * 2; vy = 2.4; }
    } else if (how === 'shot') {
      const tz = (Math.random() < 0.5 ? -1 : 1) * (GOAL - 0.25 - Math.random() * 0.4);
      ux = att * HL - b.x; uz = tz - b.z; sp = 9.5 + Math.random() * 2.5; vy = 0.6 + Math.random() * 1.6;
    } else { ux = att; uz = (Math.random() - 0.5) * 0.9 - b.z * 0.08; sp = 3.4; vy = 0; }
    const l = Math.hypot(ux, uz) || 1;
    this._apply(s, ux / l, uz / l, sp, vy);
  }
  // a player's kick (yours, a friend's): only with the ball at their feet
  _kick(s, kind, dir, remote) {
    if (!s || !this.m || this.m.ph !== 'play') return false;
    const b = this.m.ball, d = Math.hypot(b.x - s.x, b.z - s.z);
    if (d > (remote ? 1.9 : 1.5) || b.y > 1.2 || s.cool > 0) return false;
    let [ux, uz] = dir, l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
    if (kind === 'pass') {
      const mates = this.m.slots.filter(o => o.team === s.team && o !== s);
      const mate = mates.sort((p, q) => Math.hypot(p.x - s.x, p.z - s.z) - Math.hypot(q.x - s.x, q.z - s.z))[0];
      if (mate) { const dx = mate.x - s.x, dz = mate.z - s.z, L = Math.hypot(dx, dz) || 1; this._apply(s, dx / L, dz / L, clamp(L * 1.45 + 2.4, 4.5, 11), 0.5); return true; }
      this._apply(s, ux, uz, 6, 0.4); return true;
    }
    this._apply(s, ux, uz, 12.5, 2.4);
    return true;
  }
  _apply(s, ux, uz, sp, vy) {
    const b = this.m.ball;
    b.vx = ux * sp; b.vz = uz * sp; b.vy = vy; b.x = s.x + ux * (BODY_R + BALL_R + 0.03); b.z = s.z + uz * (BODY_R + BALL_R + 0.03); b.y = Math.max(b.y, 0.02);
    s.cool = 0.35; s.kickT = 0.32; s.act = 'kick';
    this._event('kick');
  }
  _event(type) { const m = this.m; m.ev++; m.et = type; this._play(type, m); }
  // the ball: rolling (slowing down), in the air (gravity, bounces), off bodies, posts and the fence; goals
  _ballStep(dt) {
    const m = this.m, b = m.ball, F = this.field.fence;
    if (b.y > 0 || b.vy > 0) { b.vy -= GRAV * dt; b.y += b.vy * dt; if (b.y <= 0) { b.y = 0; b.vy = b.vy < -1.6 ? -b.vy * 0.45 : 0; b.vx *= 0.88; b.vz *= 0.88; } }
    else { const sp = Math.hypot(b.vx, b.vz), ns = Math.max(0, sp - FRICTION * dt); if (sp > 0) { b.vx *= ns / sp; b.vz *= ns / sp; } }
    const px = b.x; b.x += b.vx * dt; b.z += b.vz * dt;
    // bodies (players and kids): a moving one carries the ball along (dribbling), a still one blocks it
    for (const s of m.slots) {
      const dx = b.x - s.x, dz = b.z - s.z, d = Math.hypot(dx, dz);
      if (d >= BODY_R + BALL_R || b.y > 0.7) continue;
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0, sp = Math.hypot(s.vx, s.vz);
      b.x = s.x + nx * (BODY_R + BALL_R); b.z = s.z + nz * (BODY_R + BALL_R);
      const rel = (b.vx - s.vx) * nx + (b.vz - s.vz) * nz;
      if (rel < 0) { b.vx -= 1.3 * rel * nx; b.vz -= 1.3 * rel * nz; }
      if (sp > 0.8 && (s.vx * nx + s.vz * nz) / sp > 0.2) { b.vx = s.vx * 1.18 + nx * 0.3; b.vz = s.vz * 1.18 + nz * 0.3; }
    }
    // the posts
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const dx = b.x - sx * HL, dz = b.z - sz * GOAL, d = Math.hypot(dx, dz), rr = 0.06 + BALL_R;
      if (d < rr && b.y < 1.15) { const nx = dx / (d || 1), nz = dz / (d || 1), vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; } b.x = sx * HL + nx * rr; b.z = sz * GOAL + nz * rr; this._event('post'); }
    }
    // the goal line: in (a goal), off the bar, or wide
    const mouth = Math.abs(b.z) < GOAL - BALL_R;
    if (!m.scored && m.ph === 'play' && mouth && Math.abs(px) <= HL && Math.abs(b.x) > HL) {
      if (b.y < 1.06) { m.scored = true; m.scorer = b.x > 0 ? 'A' : 'B'; m.sc[m.scorer === 'A' ? 0 : 1]++; m.ph = 'goal'; m.pt = 0; this._event('goal'); }
      else if (b.y < 1.22) { b.vx *= -0.5; b.x = Math.sign(b.x) * (HL - 0.01); b.vy = -Math.abs(b.vy) * 0.5; this._event('post'); }
    }
    if (m.scored || (mouth && Math.abs(b.x) > HL)) {                                  // inside the net
      if (Math.abs(b.x) > HL + 0.62) { b.x = Math.sign(b.x) * (HL + 0.62); b.vx *= -0.15; b.vz *= 0.5; }
      if (Math.abs(b.x) > HL && Math.abs(b.z) > GOAL - BALL_R) { b.z = Math.sign(b.z) * (GOAL - BALL_R); b.vz *= -0.3; }
    }
    // the fence
    if (Math.abs(b.x) > F.x - 0.22) { b.x = Math.sign(b.x) * (F.x - 0.22); b.vx *= -0.55; }
    if (Math.abs(b.z) > F.z - 0.22) { b.z = Math.sign(b.z) * (F.z - 0.22); b.vz *= -0.55; }
    if (m.ph !== 'goal') m.scored = false;
  }
  _broadcastEnd(why) { try { this.g.net.send('fbEnd', { id: this.m.id, sc: this.m.sc, why }); } catch (e) { /* alone */ } }

  /* ---------- on everyone else's screen ---------- */
  _onState(d) {
    const m = this.m;
    if (!m || !d || d.id !== m.id || this.isHost) return;
    m.last = performance.now();
    if (d.ko !== m.ko) { m.ko = d.ko; m.kt = d.kt; const mine = m.slots.find(s => s.who === this.myId()); if (mine && d.ph === 'kickoff') this._toKickoff(mine); }
    Object.assign(m, { ph: d.ph, pt: d.pt, clk: d.clk, sc: d.sc, kt: d.kt, scorer: d.sg });
    m.ball = { x: d.b[0], z: d.b[1], y: d.b[2], vx: d.b[3], vz: d.b[4], vy: d.b[5] }; m.ballAt = performance.now();
    if (d.w) d.w.forEach((who, i) => { if (m.slots[i]) m.slots[i].who = who; });
    for (const [i, x, z, face, act, kick] of d.n) { const s = m.slots[i]; if (!s) continue; s.tx = x; s.tz = z; s.face = face; s.act = ACT[act] === 'run' ? null : ACT[act]; s.kickT = kick; if (!s.init) { s.x = x; s.z = z; s.init = true; } }
    if (d.ev > m.seenEv) { m.seenEv = d.ev; this._play(d.et, m); }
  }
  // sounds and words for what just happened
  _play(type, m) {
    const S = this.g.sound;
    if (type === 'kick' || type === 'post') S.kick(type === 'post' ? 0.6 : 1);
    else if (type === 'whistle') { S.whistle(); this._say(m.ko ? 'Play!' : 'Kick-off!', 1200); }
    else if (type === 'goal') { S.cheer(); S.whistle(); const t = TEAMS[m.scorer]; this._say(`<b style="color:${t.css}">GOAL!</b> ${t.name} scores · ${m.sc[0]} – ${m.sc[1]}`, 3000); }
    else if (type === 'end') { S.whistle(); S.whistle(); const [a, b] = m.sc; this._say(a === b ? `Full time — a draw, ${a} – ${b}` : `Full time — <b style="color:${TEAMS[a > b ? 'A' : 'B'].css}">${TEAMS[a > b ? 'A' : 'B'].name} wins</b> ${a} – ${b}`, 6000); }
  }
  _say(html, ms = 2500) { this.msg.innerHTML = html; this.msg.className = 'show'; clearTimeout(this.msgT); this.msgT = setTimeout(() => { this.msg.className = 'hidden'; }, ms); }

  /* ---------- every frame ---------- */
  update(dt) {
    if (!this.on) return;
    this.t += dt;
    const m = this.m;
    if (!m) { this._hud(false); return; }
    if (this.isHost) this._sim(dt);
    else {
      if (performance.now() - m.last > 5000) { this._finish(m.sc, 'lost'); return; }
      // smooth the kids toward where the match says they are; the ball runs on a little between updates
      for (const s of m.slots) if (!s.who && s.tx !== undefined) { const k = c01(dt * 14); const ox = s.x, oz = s.z; s.x += (s.tx - s.x) * k; s.z += (s.tz - s.z) * k; s.vx = (s.x - ox) / Math.max(dt, 1e-3); s.vz = (s.z - oz) / Math.max(dt, 1e-3); }
      const b = m.ball, since = m.ballAt ? Math.min(0.12, (performance.now() - m.ballAt) / 1000) : 0;
      m.view = { x: b.x + b.vx * since, z: b.z + b.vz * since, y: Math.max(0, b.y + b.vy * since) };
    }
    if (!this.m) return;
    this._render(dt);
    this._hud(true);
  }
  _render(dt) {
    const m = this.m, P = this.people, W = this.g.world, ov = P.override || (P.override = new Map());
    ov.clear();
    // the kids who play
    for (const s of m.slots) {
      if (s.who || !s.npc) continue;
      const [x, z] = this._world(s.x, s.z), moving = Math.hypot(s.vx, s.vz) > 0.4;
      ov.set(s.npc.i, { x, z, face: s.face, act: s.kickT > 0 ? 'kick' : moving ? null : (s.act || 'stand'), kick: s.kickT > 0 ? c01(1 - s.kickT / 0.32) * 2 - 1 : 0, run: true });
    }
    // people watching from the benches and the side
    const seats = (P.seats || []).filter(S => S.where === 'field'), elders = P.npcs.filter(n => n.age === 'elder'), kids = P.npcs.filter(n => n.age === 'child');
    const [bx, bz] = this._world(this.m.view ? this.m.view.x : m.ball.x, this.m.view ? this.m.view.z : m.ball.z);
    const pp = this.g.player.pos, mine = S => this.g.player.mode === 'seat' && Math.hypot(pp.x - S.seat.x, pp.z - S.seat.z) < 0.6;   // (not on your seat)
    seats.filter(S => !mine(S)).slice(0, 3).forEach((S, k) => { const n = elders[k]; if (n) ov.set(n.i, { x: S.seat.x, z: S.seat.z, y: S.seat.y, seatH: S.seat.h / n.L.sy, face: S.yaw, act: 'watchSit', item: n.item0, look: clamp(Math.atan2(bx - S.seat.x, bz - S.seat.z) - S.yaw, -1, 1) }); });
    (P.watchSpots || []).slice(0, 3).forEach((S, k) => { const n = kids[5 + k]; if (n && !m.slots.some(s => s.npc === n)) ov.set(n.i, { x: S.x, z: S.z, face: Math.atan2(bx - S.x, bz - S.z), act: 'watch' }); });
    // the ball
    const v = this.isHost ? m.ball : m.view || m.ball, [x, z] = this._world(v.x, v.z), y = W.heightAt(x, z) + BALL_R + v.y;
    if (this.lastB) { const dx = x - this.lastB[0], dz = z - this.lastB[1], d = Math.hypot(dx, dz); if (d > 1e-4 && d < 2) { this._ax.set(dz / d, 0, -dx / d); this._q.setFromAxisAngle(this._ax, d / BALL_R); this.ball.quaternion.premultiply(this._q); } }
    this.ball.position.set(x, y, z); this.ball.visible = true; this.lastB = [x, z];
    P.matchBall = [x, z];
    // team rings under everyone in the match
    m.slots.forEach((s, k) => {
      const r = this.rings[k];
      let px, pz;
      if (s.who === this.myId()) { px = this.g.player.pos.x; pz = this.g.player.pos.z; }
      else if (s.who) { const R = this.g.remotes.map.get(s.who); if (!R) { r.visible = false; return; } px = R.pos.x; pz = R.pos.z; }
      else [px, pz] = this._world(s.x, s.z);
      r.visible = true; r.material.color.setHex(TEAMS[s.team].col); r.position.set(px, W.heightAt(px, pz) + 0.04, pz);
    });
    for (let k = m.slots.length; k < 4; k++) this.rings[k].visible = false;
  }
  _hud(on) {
    if (!on) { if (!this.board.classList.contains('hidden')) { this.board.className = 'hidden'; this.hint.className = 'hidden'; if (this.g.touch) this.g.touch.setFootball(false); } return; }
    const m = this.m, t = Math.ceil(m.clk), clk = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const mine = m.slots.find(s => s.who === this.myId());
    const cd = (m.ph === 'intro' || m.ph === 'kickoff') ? Math.ceil((m.ph === 'intro' ? 4.5 : 3) - m.pt) : 0;
    const html = `<span class="fb-team" style="--c:${TEAMS.A.css}">${TEAMS.A.name}</span><b>${m.sc[0]}</b><span class="fb-dash">–</span><b>${m.sc[1]}</b><span class="fb-team" style="--c:${TEAMS.B.css}">${TEAMS.B.name}</span><span class="fb-clk">${cd > 0 ? `Kick-off in ${cd}` : clk}</span>${mine ? `<span class="fb-you" style="--c:${TEAMS[mine.team].css}">You: ${TEAMS[mine.team].name}</span>` : ''}`;
    if (this.board._h !== html) { this.board._h = html; this.board.innerHTML = html; }
    this.board.className = '';
    const touch = this.g.touch && this.g.touch.enabled;
    this.hint.className = mine && !touch ? '' : 'hidden';
    if (mine && !touch) { const h = 'Run onto the ball to dribble · <b>F</b> / click shoot · <b>E</b> pass · <b>Q</b> leave'; if (this.hint._h !== h) { this.hint._h = h; this.hint.innerHTML = h; } }
    if (this.g.touch) this.g.touch.setFootball(!!mine);
  }
  // the match is over (or left): everyone back to normal
  _finish(sc, why) {
    if (!this.m) return;
    if (why === 'lost') this.g.toast('⚽ The match ended — lost touch with the player running it');
    else if (why === 'left') this.g.toast('⚽ The match was stopped');
    this._cleanup();
  }
  _cleanup() {
    if (!this.m) return;
    this._dress(false);
    const P = this.people;
    if (P.override) P.override.clear();
    P.matchOn = false; P.matchBall = null;
    this.ball.visible = false; for (const r of this.rings) r.visible = false;
    this.m = null; this.lastB = null;
    this._hud(false);
  }
}
