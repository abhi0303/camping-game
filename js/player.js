import * as THREE from 'three';
import { Character } from './character.js';
import { ANCHOR, Y, ROOF_TOP } from './rvDims.js';
import { clamp, damp, dampAngle, lerp, wrapAngle } from './utils.js';
import { audio } from './audio.js';

const WALK = 2.1, RUN = 5.6, CROUCH = 1.2, GRAV = 22, JUMP_V = 6.5, R = 0.28, RIN = 0.24;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const NO_INPUT = { axis: () => 0, isDown: () => false, wasPressed: () => false, click: false };

// Walkable interior (RV local XZ) and furniture blocks
const IN_RECTS = [{ x0: -1.12, x1: 1.12, z0: -2.0, z1: 1.88 }, { x0: -0.35, x1: 0.35, z0: 1.8, z1: 2.22 }];
const IN_OBST = [
  { x0: 0.6, x1: 1.2, z0: -1.97, z1: -0.43 }, { x0: 0.45, x1: 1.2, z0: -0.43, z1: 0.3 },
  { x0: -1.2, x1: -0.59, z0: -1.97, z1: -0.78 }, { x0: -1.2, x1: -0.38, z0: 0.25, z1: 1.9 }, { x0: 0.6, x1: 1.2, z0: 0.28, z1: 1.9 },
];
// Side entry door: walk-through doorway + steps (RV local)
const DOOR_Z = -0.25;
const DOOR_RECT = { x0: -2.25, x1: -0.3, z0: -0.69, z1: 0.19 };
const floorAt = x => (x >= -1.2 ? Y.floor : x >= -1.47 ? 0.37 : x >= -1.74 ? 0.19 : 0);

const SEAT_EXIT = {
  driverSeat: [0.1, Y.floor, 1.85], passengerSeat: [-0.1, Y.floor, 1.85], dinetteA: [-0.12, Y.floor, 0.5],
  dinetteB: [-0.12, Y.floor, 1.55], sofa: [0.3, Y.floor, 1.42], bed: [0, Y.floor, -1.7], bunk: [0, Y.floor, 1.6],
};

export class Player {
  constructor(scene, world, rv) {
    this.scene = scene; this.world = world; this.rv = rv;
    this.char = new Character();
    scene.add(this.char.root);
    this.pos = new THREE.Vector3(-2.6, 0, -8.2);
    this.yaw = -1.89; this.visY = 0; this.doorHold = 0; this.doorState = false;
    this.pitch = 0; this.pitchTarget = 0;
    this.vel = new THREE.Vector2(); this.vy = 0; this.grounded = true; this.crouch = false;
    this.mode = 'foot'; this.frame = 'world'; this.seat = null; this.tween = null;
    this.prompt = null; this.timers = []; this.toast = null;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
    this.rvs = [rv]; this.canUseSeat = () => null; this.onDrive = null; this.anim = { a: 'idle', sp: 0, st: 0, hd: null };
    this.gear = null; this.extraActs = []; this.worldActs = null; this.boost = false; this.seatExit = null; this.lieT = 0; this.swimming = false;
    // survival: health, knocked down, carried by / carrying a teammate (peer ids), shotgun aim
    this.hp = 100; this.downed = false; this.dead = false; this.carried = null; this.carrying = null; this.aiming = false; this.aimPitch = 0;
    this.canDrive = () => true; this.netExtra = null;
    this.fishing = null;          // set by main: while fishing the player stands still at the dock (js/fishing)
    this._buildInteractions();
  }

  /* ---------------- interactions ---------------- */
  _buildInteractions() {
    const rv = this.rv;
    const onOff = (b) => b ? 'off' : 'on';
    this.acts = [
      { where: 'out', at: [1.85, 2.3], r: 1.4, label: () => 'Drive RV', act: () => this.enterDriver(true) },
      { where: 'out', at: [-1.85, 2.3], r: 1.3, label: () => 'Sit in passenger seat', act: () => this.enterPassenger() },
      { where: 'out', at: [-0.8, -4.25], r: 1.1, label: () => 'Climb ladder to roof', act: () => this.climbUp() },
      { where: 'roof', at: [-0.8, -3.35], r: 0.9, label: () => 'Climb down ladder', act: () => this.climbDown() },
      { where: 'in', at: [0.15, 1.92], r: 0.7, label: () => 'Sit in driver seat', act: () => this.enterDriver(false) },
      { where: 'in', at: [-0.15, 1.92], r: 0.7, label: () => 'Sit in passenger seat', act: () => this.sitAt('passengerSeat') },
      { where: 'in', at: [-0.15, 0.55], r: 0.65, label: () => 'Sit at dinette', act: () => this.sitAt('dinetteA') },
      { where: 'in', at: [-0.15, 1.5], r: 0.6, label: () => 'Sit at dinette (facing back)', act: () => this.sitAt('dinetteB') },
      { where: 'in', at: [0.3, 1.45], r: 0.6, label: () => 'Sit on sofa', act: () => this.sitAt('sofa') },
      { where: 'in', at: [0.0, -1.72], r: 0.8, label: () => 'Lie down on bed', act: () => this.lieAt('bed') },
      { where: 'in', at: [0.0, 1.62], r: 0.45, label: () => 'Climb into over-cab bunk', act: () => this.lieAt('bunk') },
      { where: 'in', at: [0.3, -0.83], r: 0.55, label: () => 'Turn stove ' + onOff(rv.parts.stoveFlames.visible), act: () => rv.toggleStove() },
      { where: 'in', at: [0.3, -1.55], r: 0.55, label: () => 'Turn tap ' + onOff(rv.parts.sinkWater.visible), act: () => rv.toggleSink() },
      { where: 'in', at: [-0.3, -1.5], r: 0.55, label: () => 'Use microwave', act: () => rv.microwave() },
      { where: 'in', at: [0.1, 1.02], r: 0.45, label: () => 'Turn TV ' + onOff(rv.parts.tv.on), act: () => rv.toggleTV() },
    ];
  }

  _findAction() {
    if (this.mode !== 'foot' && this.mode !== 'inside') return null;
    let best = null, bestScore = 1e9;
    const consider = (a, dx, dz, fx, fz) => {
      const d = Math.hypot(dx, dz);
      if (d > a.r) return;
      const score = d - (d > 0.01 ? 0.35 * (dx * fx + dz * fz) / d : 0);
      if (score < bestScore) { bestScore = score; best = a; }
    };
    if (this.mode === 'foot' && this.worldActs) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      for (const a of this.worldActs()) if (Math.abs(this.pos.y - a.pos.y) < 1.5) consider(a, a.pos.x - this.pos.x, a.pos.z - this.pos.z, fx, fz);
    }
    let where, lp;
    if (this.mode === 'foot') {
      lp = this.rv.toLocal(this.pos, this._v);
      if (Math.abs(lp.x) > 4 || Math.abs(lp.z) > 6) return best;
      where = lp.y > ROOF_TOP - 0.4 ? 'roof' : (lp.y < 1 ? 'out' : null);
      if (!where) return best;
    } else { lp = this.pos; where = 'in'; }
    const yaw = this.frame === 'world' ? this.yaw - this.rv.heading : this.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const a of this.acts) if (a.where === where) consider(a, a.at[0] - lp.x, a.at[1] - lp.z, fx, fz);
    for (const a of this.extraActs) if (a.where === where) consider(a, a.at[0] - lp.x, a.at[1] - lp.z, fx, fz);
    return best;
  }

  /* ---------------- frame switching ---------------- */
  toRV() {
    if (this.frame === 'rv') return;
    this.pos.copy(this.rv.toLocal(this.pos, this._w));
    this.yaw -= this.rv.heading; this._rotVel(-this.rv.heading); this.rv.body.add(this.char.root); this.frame = 'rv';
  }
  toWorld() {
    if (this.frame === 'world') return;
    this.pos.copy(this.rv.toWorld(this.pos, this._w));
    this.yaw += this.rv.heading; this._rotVel(this.rv.heading); this.scene.add(this.char.root); this.frame = 'world';
  }
  _rotVel(a) { const c = Math.cos(a), s = Math.sin(a), x = this.vel.x, z = this.vel.y; this.vel.set(x * c + z * s, -x * s + z * c); }
  later(t, fn) { this.timers.push({ t, fn }); }

  // Scripted walk along points (current frame). opts: dur, anim, yaw (final), pitch, done
  startTween(points, opts) {
    const pts = [this.pos.clone(), ...points];
    const lens = [0]; let total = 0;
    for (let i = 1; i < pts.length; i++) { total += pts[i].distanceTo(pts[i - 1]); lens.push(total); }
    this.tween = { pts, lens, total: Math.max(total, 1e-3), t: 0, dur: opts.dur || Math.max(0.5, total / 1.6), anim: opts.anim || 'walk',
      yaw0: this.yaw, yaw: opts.yaw, pitch0: this.pitch, pitch: opts.pitch ?? 0, done: opts.done, speed: opts.speed ?? 1.6 };
    this.mode = 'tween'; this.vel.set(0, 0); this.vy = 0; this.crouch = false;
  }
  _stepTween(dt) {
    const tw = this.tween;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const s = tw.t * tw.total;
    let i = 1; while (i < tw.lens.length - 1 && tw.lens[i] < s) i++;
    const a = tw.pts[i - 1], b = tw.pts[i], seg = Math.max(tw.lens[i] - tw.lens[i - 1], 1e-4);
    const k = clamp((s - tw.lens[i - 1]) / seg, 0, 1);
    this.pos.lerpVectors(a, b, k);
    const hx = b.x - a.x, hz = b.z - a.z;
    if (tw.anim !== 'climb' && hx * hx + hz * hz > 0.01 && tw.t < 0.8) this.yaw = dampAngle(this.yaw, Math.atan2(hx, hz), 10, dt);
    if (tw.yaw !== undefined && tw.t > 0.6) this.yaw = dampAngle(this.yaw, tw.yaw, 12, dt);
    this.pitch = lerp(tw.pitch0, tw.pitch, tw.t);
    if (tw.t >= 1) {
      if (tw.yaw !== undefined) this.yaw = tw.yaw;
      this.tween = null; tw.done && tw.done();
    }
  }

  /* ---------------- actions ---------------- */
  // The side door opens by itself when you walk up to it (from outside or from inside)
  _autoDoor(dt) {
    let want = false;
    if (this.mode === 'foot' || this.mode === 'inside') {
      const l = this.mode === 'inside' ? this.pos : this.rv.toLocal(this.pos, this._v);
      const dx = l.x + 1.2, dz = l.z - DOOR_Z;
      if (l.x < -1.2) want = l.y < 1.2 && dx * dx + dz * dz < 2.2 * 2.2;
      else want = this.mode === 'inside' && l.x < -0.3 && Math.abs(dz) < 0.75;
    }
    this.doorHold = want ? 0.6 : this.doorHold - dt;
    const open = this.doorHold > 0;
    if (open !== this.doorState) { this.doorState = open; this.rv.setDoor('entry', open); audio.thud(open ? 150 : 115, 0.1); }
  }
  _pickRV() {
    let best = this.rv, bd = 1e9;
    for (const r of this.rvs) { const d = r.root.position.distanceToSquared(this.pos); if (d < bd) { bd = d; best = r; } }
    this.rv = best;
  }
  _seatFree(name) {
    if (this.mode === 'tween' || this.downed) return false;
    if (this.carrying) { this.toastMsg('Put your teammate down first (X)'); return false; }
    const who = this.canUseSeat(this.rv, name);
    if (who) this.toastMsg(`${who} is already using that seat`);
    return !who;
  }
  // compact state for multiplayer
  netState() {
    const a = this.anim, eq = this.gear && this.gear.inv.equippedItem(), d = this.gear && this.gear.drone;
    const r2 = v => Math.round(v * 100) / 100;
    return { f: this.frame === 'rv' ? 1 : 0, rv: this.rvs.indexOf(this.rv), x: r2(this.pos.x), y: r2(this.visY), z: r2(this.pos.z), yw: r2(this.yaw), pi: r2(this.pitch),
      a: a.a, sp: r2(a.sp), vy: r2(this.vy), st: r2(a.st), hd: a.hd, it: this.gear && this.gear.gunOut ? this.gear.gunType : eq ? eq.type : null, hv: this.char.hand.visible ? 1 : 0, se: this.seat,
      dr: d && d.active ? [r2(d.pos.x), r2(d.pos.y), r2(d.pos.z), r2(d.yaw)] : 0,
      hp: Math.round(this.hp), dn: this.downed ? 1 : 0, dd: this.dead ? 1 : 0, cb: this.carried || 0, cr: this.carrying || 0, ap: r2(this.aimPitch), ...(this.netExtra ? this.netExtra() : null) };
  }
  // stand next to the RV's side door, facing it
  spawnBesideRV(k = 0) {
    this.toWorld();
    const spot = [[-3.2, 0.6], [-3.2, -1.3], [-4.7, 0.6], [-4.7, -1.3]][k % 4];
    this.pos.copy(this.rv.toWorld(new THREE.Vector3(spot[0], 0, spot[1])));
    this.pos.y = this.world.groundAt(this.pos.x, this.pos.z);
    this.visY = this.pos.y; this.yaw = this.rv.heading + Math.PI / 2; this.mode = 'foot'; this.grounded = true;
  }
  placeInside() { this.toRV(); this.pos.set(-0.55, Y.floor, DOOR_Z); this.visY = Y.floor; this.mode = 'inside'; this.grounded = true; }
  enterDriver(fromOutside) {
    if (!this._seatFree('driverSeat')) return;
    if (!this.canDrive(this.rv)) { this.toastMsg('🔧 The RV only drives when it is 100% repaired — use the hammer (Gear Locker) next to it'); return; }
    this.seat = 'driverSeat';            // reserve it right away so teammates can't take it
    this.toRV();
    const seat = ANCHOR.driverSeat, sp = V(seat.pos);
    const done = () => { this.mode = 'drive'; this.seat = 'driverSeat'; this.onDrive && this.onDrive(this.rv); this.rv.setEngine(true); this.toastMsg('Engine on — W/S to drive'); if (fromOutside) this.later(0.3, () => { this.rv.setDoor('driver', false); audio.thud(120, 0.1); }); };
    if (fromOutside) { this.rv.setDoor('driver', true); audio.thud(140, 0.1); this.startTween([V(ANCHOR.driverOutside), V([1.3, Y.floor, 2.22]), sp], { dur: 1.5, yaw: seat.yaw, done }); }
    else this.startTween([V([0.1, Y.floor, 1.9]), sp], { dur: 0.9, yaw: seat.yaw, done });
  }
  exitDriverOutside() {
    if (Math.abs(this.rv.speed) > 1.5) { this.toastMsg('Slow down to get out'); return; }
    this.rv.setEngine(false); this.rv.setDoor('driver', true); audio.thud(140, 0.1);
    this.startTween([V([1.3, Y.floor, 2.22]), V([1.95, 0, 2.3])], { dur: 1.1, done: () => { this.toWorld(); this.mode = 'foot'; this.seat = null; this.later(0.35, () => this.rv.setDoor('driver', false)); } });
  }
  driverToBack() {
    if (Math.abs(this.rv.speed) > 1.5) { this.toastMsg('Stop the RV first'); return; }
    this.rv.setEngine(false); this.seat = null;
    this.startTween([V([0.1, Y.floor, 1.85]), V([0, Y.floor, 1.3])], { dur: 1.0, done: () => { this.mode = 'inside'; } });
  }
  enterPassenger() {
    if (!this._seatFree('passengerSeat')) return;
    this.seat = 'passengerSeat';
    this.toRV(); this.rv.setDoor('passenger', true); audio.thud(140, 0.1);
    const s = ANCHOR.passengerSeat;
    this.startTween([V(ANCHOR.passengerOutside), V([-1.3, Y.floor, 2.22]), V(s.pos)], { dur: 1.5, yaw: s.yaw, anim: 'walk',
      done: () => { this.mode = 'seat'; this.seat = 'passengerSeat'; this.later(0.3, () => this.rv.setDoor('passenger', false)); } });
  }
  sitAt(name) {
    if (!this._seatFree(name)) return;
    this.seat = name;
    const s = ANCHOR[name];
    this.startTween([V(s.pos)], { dur: 0.7, yaw: s.yaw, anim: 'sit', done: () => { this.mode = 'seat'; this.seat = name; } });
  }
  lieAt(name) {
    if (!this._seatFree(name)) return;
    this.seat = name;
    const s = ANCHOR[name];
    const pre = name === 'bed' ? [V([-0.2, Y.floor, -1.8])] : [V([0, Y.floor, 1.75])];
    this.startTween([...pre, V(s.pos)], { dur: 1.1, yaw: s.yaw, anim: 'lie', pitch: -Math.PI / 2, done: () => { this.mode = 'lie'; this.seat = name; this.lieT = 0; } });
  }
  sitWorld(pos, yaw, exit) {
    this.seatExit = exit;
    this.startTween([pos], { dur: 0.7, yaw, anim: 'sit', done: () => { this.mode = 'seat'; this.seat = 'chair'; } });
  }
  lieWorld(pos, yaw, exit, tag) {
    this.seatExit = exit;
    this.startTween([pos], { dur: 1.0, yaw, anim: 'lie', pitch: -Math.PI / 2, done: () => { this.mode = 'lie'; this.seat = tag; this.lieT = 0; } });
  }
  standUp() {
    if (this.frame === 'world') {
      const wasLie = this.mode === 'lie';
      this.startTween([this.seatExit.clone()], { dur: wasLie ? 1.0 : 0.6, anim: 'walk', pitch: 0, done: () => { this.mode = 'foot'; this.seat = null; this.grounded = true; } });
      return;
    }
    const ex = SEAT_EXIT[this.seat] || [0, Y.floor, 0];
    const wasLie = this.mode === 'lie';
    this.startTween([V(ex)], { dur: wasLie ? 1.0 : 0.6, anim: 'walk', pitch: 0, done: () => { this.mode = 'inside'; this.seat = null; } });
  }
  climbUp() {
    this.toRV();
    const b = ANCHOR.ladderBottom;
    this.startTween([V([b[0], 0, -4.15])], { dur: 0.5, yaw: 0, done: () => {
      this.startTween([V([b[0], 2.9, -4.15])], { dur: 2.0, anim: 'climb', yaw: 0, done: () => {
        this.startTween([V([b[0], ROOF_TOP + 0.15, -3.95]), V(ANCHOR.ladderTop)], { dur: 0.8, yaw: 0, done: () => { this.toWorld(); this.mode = 'foot'; this.grounded = true; } });
      } });
    } });
  }
  climbDown() {
    this.toRV();
    const t = ANCHOR.ladderTop;
    this.startTween([V(t), V([t[0], ROOF_TOP + 0.15, -3.95])], { dur: 0.7, yaw: Math.PI, done: () => {
      this.yaw = 0;
      this.startTween([V([t[0], 2.9, -4.15]), V([t[0], 0, -4.15])], { dur: 2.0, anim: 'climb', yaw: 0, done: () => {
        this.toWorld(); this.mode = 'foot'; this.grounded = true; this.yaw += Math.PI;
      } });
    } });
  }
  toastMsg(t) { this.toast = t; }

  /* ---------------- per-frame ---------------- */
  update(dt, input, cam) {
    // eliminated: no body, no control (the camera spectates a teammate)
    if (this.dead) { this.prompt = null; this.aiming = false; this.anim.a = 'downed'; audio.horn(false); return null; }
    // safety net: never let a bad frame leave the player at NaN
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.yaw)) {
      this.vel.set(0, 0); this.vy = 0; this.yaw = Number.isFinite(this.yaw) ? this.yaw : 0;
      if (this._good && this._good.frame === this.frame) this.pos.copy(this._good.p); else { this.tween = null; this.spawnBesideRV(); }
    } else if (this.mode === 'foot' || this.mode === 'inside') (this._good || (this._good = { p: new THREE.Vector3(), frame: '' })).p.copy(this.pos), this._good.frame = this.frame;
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    if (this.frame === 'world' && !this.tween && this.rvs.length > 1) this._pickRV();
    this._autoDoor(dt);
    let animMode = 'idle', animSpeed = 0, steer = 0;
    const E = input.wasPressed('KeyE');
    let driveCtrl = null;

    if (this.downed && (this.mode === 'foot' || this.mode === 'inside')) {
      // knocked down: no control, just gravity (or riding on a teammate's shoulders)
      if (!this.carried) this._move(dt, NO_INPUT, cam);
      this.vel.set(0, 0);
      this.pitch = damp(this.pitch, -Math.PI / 2, 9, dt);
      animMode = 'downed'; this.prompt = null;
    } else if (this.mode === 'foot' || this.mode === 'inside') {
      if (this.pitch !== 0) this.pitch = Math.abs(this.pitch) < 0.02 ? 0 : damp(this.pitch, 0, 10, dt);   // getting back up
      const fishing = this.fishing && this.fishing.locked;
      const locked = (this.gear && this.gear.locked) || fishing;   // flying the drone / looking through binoculars / fishing
      this._move(dt, locked ? NO_INPUT : input, cam);
      const hs = this.vel.length();
      animMode = !this.grounded ? 'jump' : this.crouch ? 'crouch' : hs > 3.2 ? 'run' : hs > 0.15 ? 'walk' : 'idle';
      animSpeed = hs;
      if (locked) this.prompt = fishing ? this.fishing.prompt() : this.gear.lockPrompt();
      else {
        if ((input.wasPressed('KeyF') || input.click) && !(this.gear && this.gear.gunOut) && !this.carrying) {   // the shotgun fires in Combat
          if (this.gear && this.gear.inv.equippedItem()) this.gear.use();
          else if (this.char.punch()) audio.thud(220, 0.06);
        }
        const a = this._findAction();
        this.prompt = a ? { key: a.key || 'E', text: a.label(), alt: a.alt ? { key: 'X', text: a.alt.label() } : null } : null;
        if (a && E) a.act();
        else if (a && a.alt && input.wasPressed('KeyX')) a.alt.act();
        if (this.mode === 'inside' && input.wasPressed('KeyL')) this.toastMsg('Interior lights ' + (this.rv.toggleInteriorLights() ? 'on' : 'off'));
      }
    } else if (this.mode === 'seat' || this.mode === 'lie') {
      animMode = this.mode === 'lie' ? 'lie' : 'sit';
      this.prompt = { key: 'E', text: this.mode === 'lie' ? 'Get up' : 'Stand up' };
      if (E || input.wasPressed('Space')) this.standUp();
      if (this.frame === 'rv' && input.wasPressed('KeyT')) this.rv.toggleTV();
      if (this.frame === 'rv' && input.wasPressed('KeyL')) this.toastMsg('Interior lights ' + (this.rv.toggleInteriorLights() ? 'on' : 'off'));
      // resting heals you (no sleeping through a zombie night)
      if (this.mode === 'lie') {
        this.lieT += dt;
        if (this.hp < 100) { this.hp = Math.min(100, this.hp + 5 * dt); this.prompt = { key: 'E', text: `Get up    (resting… ❤ ${Math.round(this.hp)})` }; }
      }
    } else if (this.mode === 'drive') {
      animMode = 'drive';
      driveCtrl = {
        throttle: input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
        steer: input.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
        handbrake: input.isDown('Space'),
      };
      steer = this.rv.steer / 0.6;
      audio.horn(input.isDown('KeyH'));
      if (input.wasPressed('KeyL')) this.toastMsg('Headlights ' + (this.rv.toggleHeadlights() ? 'on' : 'off'));
      this.prompt = Math.abs(this.rv.speed) < 1.5 ? { key: 'E', text: 'Get out    [Q] Go to the back' } : null;
      if (E) { audio.horn(false); this.exitDriverOutside(); }
      else if (input.wasPressed('KeyQ')) { audio.horn(false); this.driverToBack(); }
    } else if (this.mode === 'tween') {
      this.prompt = null;
      this._stepTween(dt);
      if (this.tween) { animMode = this.tween.anim; animSpeed = this.tween.speed; }
      else animMode = this.mode === 'drive' ? 'drive' : this.mode === 'lie' ? 'lie' : this.mode === 'seat' ? 'sit' : 'idle';
    }
    if (this.mode !== 'drive') audio.horn(false);

    // place the character (a carried player is parented to the carrier's avatar instead)
    const r = this.char.root;
    const onFeet = (this.mode === 'foot' || this.mode === 'inside') && this.grounded;
    const lift = this.downed ? 0.13 * Math.min(1, -this.pitch / 1.4) : 0;     // lying on your back sits a bit higher
    this.visY = onFeet ? damp(this.visY, this.pos.y + lift, 18, dt) : this.pos.y + lift;
    if (!this.carried) {
      r.position.set(this.pos.x, this.visY, this.pos.z);
      r.rotation.set(this.pitch, this.yaw, 0);
    }
    const hold = (this.mode === 'foot' || this.mode === 'inside') && !this.downed && this.gear ? (this.fishing && this.fishing.active ? this.fishing.holdPose() : this.gear.holdPose()) : null;
    this.char.update(dt, { mode: animMode, speed: animSpeed, vy: this.vy, steer, hold, aim: this.aimPitch });
    const A = this.anim; A.a = animMode; A.sp = animSpeed; A.st = steer; A.hd = hold;
    return driveCtrl;
  }

  _move(dt, input, cam) {
    const inside = this.mode === 'inside';
    const ix = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    const iz = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    const cy = cam.yaw;
    let mx = -Math.sin(cy) * iz + Math.cos(cy) * ix;
    let mz = -Math.cos(cy) * iz - Math.sin(cy) * ix;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    if (inside) { // world direction -> RV local
      const h = this.rv.heading, c = Math.cos(h), s = Math.sin(h);
      const lx = mx * c - mz * s, lz = mx * s + mz * c; mx = lx; mz = lz;
    }
    if (input.wasPressed('KeyC') && this.grounded) this.crouch = !this.crouch;
    const running = input.isDown('ShiftLeft', 'ShiftRight') && !this.crouch;
    if (running && this.crouch) this.crouch = false;
    const spd = (this.crouch ? CROUCH : running ? RUN : WALK) * (inside ? 0.8 : 1) * (this.boost ? 1.35 : 1) * (this.swimming ? 0.45 : 1) * (this.carrying ? 0.72 : 1) * (this.aiming && running ? 0.85 : 1);
    const k = this.grounded ? 12 : 2.5;
    this.vel.x = damp(this.vel.x, mx * spd, k, dt);
    this.vel.y = damp(this.vel.y, mz * spd, k, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.y * dt;
    if (cam.firstPerson || this.aiming) this.yaw = cy + Math.PI - (inside ? this.rv.heading : 0);   // aiming: face where the crosshair is
    else if (Math.hypot(mx, mz) > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), 12, dt);

    if (input.wasPressed('Space') && this.grounded && !this.swimming) {
      if (this.crouch) this.crouch = false;
      else { this.vy = inside ? 4.2 : JUMP_V; this.grounded = false; }
    }
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;

    if (inside) {
      const fl = floorAt(this.pos.x);
      if (this.pos.x > -1.2 && this.pos.y > Y.floor + 0.55) { this.pos.y = Y.floor + 0.55; this.vy = Math.min(this.vy, 0); }
      if (this.pos.y <= fl) { if (!this.grounded && this.vy < -3) this.char.land(0.5); this.pos.y = fl; this.vy = 0; this.grounded = true; }
      else if (this.grounded && this.vy <= 0 && this.pos.y - fl < 0.3) { this.pos.y = fl; this.vy = 0; } // step down
      else this.grounded = false;
      this._collideInside();
      if (this.pos.x < -0.9 && Math.abs(this.vel.x) > 0.3) this.pos.z = damp(this.pos.z, DOOR_Z, 6, dt);
      if (this.pos.x < -1.96) { this.toWorld(); this.mode = 'foot'; }
    } else {
      // ground = terrain or bridge deck; RV roof when standing on it; float when the water is deep — only in the
      // river itself: dry hollows lower than the river's water level are walked on, not swum over
      let g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
      for (const r of this.rvs) { const roof = r.roofHeightAt(this.pos); if (roof !== null && this.pos.y >= roof - 0.3) g = Math.max(g, roof); }
      const W = this.world.W;
      this.swimming = g < W - 1.15 && this.pos.y < W - 0.5 && this.world.waterDepth(this.pos.x, this.pos.z) > 0;
      if (this.swimming) g = W - 1.15;
      if (this.pos.y <= g) {
        if (!this.grounded && this.vy < -4) { this.char.land(clamp(-this.vy / 14, 0.3, 1)); audio.thud(90, 0.08); }
        this.pos.y = g; this.vy = 0; this.grounded = true;
      } else this.grounded = false;
      this.world.collide(this.pos, R);
      for (const r of this.rvs) r.pushOut(this.pos, R);
      if (this.world.constrain) this.world.constrain(this.pos);       // stay on tower tops / wall walkways
      this._doorApproach(dt);
    }
  }

  _doorApproach(dt) {
    const door = this.rv.doors.entry;
    if (door.open < 0.15) return;
    const l = this.rv.toLocal(this.pos, this._v);
    if (l.y > 0.5 || l.x < -2.9 || l.x > -1.2 || Math.abs(l.z - DOOR_Z) > 0.75) return;
    const h = this.rv.heading;
    const lvx = this.vel.x * Math.cos(h) - this.vel.y * Math.sin(h);
    if (lvx > 0.3) { // walking toward the RV: ease into the doorway
      l.z = damp(l.z, DOOR_Z, 6, dt);
      const w = this.rv.toWorld(l, this._w); this.pos.x = w.x; this.pos.z = w.z;
    }
    if (door.open > 0.5 && l.x > -1.92 && Math.abs(l.z - DOOR_Z) < 0.38) { this.toRV(); this.mode = 'inside'; }
  }

  _collideInside() {
    const p = this.pos;
    for (const o of IN_OBST) {
      const x0 = o.x0 - RIN, x1 = o.x1 + RIN, z0 = o.z0 - RIN, z1 = o.z1 + RIN;
      if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1) continue;
      const pen = [p.x - x0, x1 - p.x, p.z - z0, z1 - p.z];
      const m = Math.min(...pen), i = pen.indexOf(m);
      if (i === 0) p.x = x0; else if (i === 1) p.x = x1; else if (i === 2) p.z = z0; else p.z = z1;
    }
    let best = null, bestD = 1e9;
    const rects = this.rv.doors.entry.open > 0.5 ? [...IN_RECTS, DOOR_RECT] : IN_RECTS;
    for (const r of rects) {
      const cx = clamp(p.x, r.x0 + RIN, r.x1 - RIN), cz = clamp(p.z, r.z0 + RIN, r.z1 - RIN);
      const d = (cx - p.x) ** 2 + (cz - p.z) ** 2;
      if (d < bestD) { bestD = d; best = [cx, cz]; }
    }
    if (best) { p.x = best[0]; p.z = best[1]; }
  }

  // Helpers for camera / HUD
  isInRV() { const p = this.pos; return this.frame === 'rv' && Math.abs(p.x) < 1.18 && p.z > -3.7 && p.z < 2.95 && p.y < 3.0; }
  inCab() { return this.frame === 'rv' && this.pos.z > 1.85 && this.seat !== 'bunk' && this.pos.y < 1.5; }
  hideAlcove() { return this.frame === 'rv' && this.pos.z > 1.7 && this.seat !== 'bunk' && !(this.tween && this.tween.anim === 'lie'); }
  headWorld(out) { return this.char.headAnchor.getWorldPosition(out); }
  focusWorld(out) {
    const r = this.char.root;
    r.updateWorldMatrix(true, false);
    if (this.mode === 'lie') { r.localToWorld(out.set(0, 0.9, 0)); out.y += 0.3; return out; }
    const h = (this.mode === 'seat' || this.mode === 'drive') ? 1.25 : this.crouch ? 0.95 : 1.45;
    return r.localToWorld(out.set(0, h, 0));
  }
}
