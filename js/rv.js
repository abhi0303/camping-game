import * as THREE from 'three';
import { buildRV } from './rvModel.js';
import { drawTV, clearTV } from './rvInterior.js';
import { MAT, clamp, damp, dampAngle } from './utils.js';
import { AXLE_R, AXLE_F, WHEELBASE, WHEEL_R, RV_MATS, BW, Z, ROOF_TOP } from './rvDims.js';
import { audio } from './audio.js';

const HX = 1.24, CZ = 0.12, HZ = 4.02;   // collision box (local)
const DOORS = ['entry', 'driver', 'passenger', 'fridge', 'lockerA', 'lockerB', 'bay'];
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

export class RV {
  constructor(scene, world, index = 0) {
    this.world = world; this.index = index;
    this.owner = null; this.net = null; this.audible = true; this.onCheckpoint = null;
    this.m = buildRV();
    this.root = this.m.root; this.body = this.m.body;
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);
    this.parts = this.m.parts;
    this.speed = 0; this.steer = 0; this.accel = 0; this.roll = 0; this.pitch = 0; this.dist = 0;
    this.heading = 0; this.rear = new THREE.Vector3();
    this.y = 0; this.vy = 0; this.tPitch = 0; this.tRoll = 0; this.grounded = true; this.stuck = false;
    this.forward = new THREE.Vector3(0, 0, 1); this.right = new THREE.Vector3(-1, 0, 0);
    this.engineOn = false; this.headlights = false; this.interiorLights = false; this.braking = false;
    this.throttle = 0; this.mwTimer = 0; this.onMsg = null;
    this.inv = new THREE.Matrix4();
    const r = world.T.road;
    // trailhead, before the bridge, after the bridge, hilltop camp, Watchtower Valley, Giant Plateau
    this.checkpoints = [12, r.sA - 16, r.sB + 14, r.sCamp - 16, r.sValley - 26, r.sGiant - 16];
    this.cp = 0; this.cpT = 0; this.roadS = 0;

    const P = this.m.pivots;
    const door = p => ({ pivot: p, open: 0, target: 0 });
    this.doors = { entry: door(P.entryDoor), driver: door(P.driverDoor), passenger: door(P.passengerDoor), fridge: door(P.fridgeDoor), lockerA: door(P.lockerA), lockerB: door(P.lockerB), bay: door(P.bayHatch) };
    // Lights stay in the scene permanently (intensity 0 when off) so shaders never recompile.
    this.spot = new THREE.SpotLight(0xfff1d0, 0, 55, 0.55, 0.6, 1);
    this.spot.position.set(0, 1.0, 4.0); this.spot.target.position.set(0, 0.2, 25);
    this.body.add(this.spot, this.spot.target);
    this.ilight = new THREE.PointLight(0xffe6b8, 0, 7, 1.5);
    this.ilight.position.set(0, 2.75, -0.6);
    this.body.add(this.ilight);
    this.reset(0);
  }
  isLocal(net) { return !net.online || this.owner === net.id || (!this.owner && net.isHost); }

  // Put the RV back on the road at a checkpoint (default: the last one reached)
  reset(cp = this.cp, slot = this.index) {
    const road = this.world.T.road;
    const p = road.pointAt(Math.max(4, this.checkpoints[cp] - (cp ? 10 * slot : 0)));
    if (!cp && slot) { p.x += p.tz * 6.5 * slot; p.z -= p.tx * 6.5 * slot; }   // extra RVs park side by side at the trailhead
    this.heading = Math.atan2(p.tx, p.tz); this.speed = 0; this.steer = 0; this.vy = 0; this.stuck = false;
    this.rear.set(p.x - p.tx * -AXLE_R, 0, p.z - p.tz * -AXLE_R);
    this.y = this.world.groundAt(p.x, p.z); this.tPitch = 0; this.tRoll = 0;
    this._place(1, true);
  }

  // Park at a spot (x, z: the same reference point reset() uses) facing a heading (Farm World: in front of the store)
  parkAt(x, z, heading) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    this.heading = heading; this.speed = 0; this.steer = 0; this.vy = 0; this.stuck = false;
    this.rear.set(x + fx * AXLE_R, 0, z + fz * AXLE_R);
    this.y = this.world.groundAt(x, z); this.tPitch = 0; this.tRoll = 0;
    this._place(1, true);
  }

  _ground(lx, lz) {
    const f = this.forward, x = this.rear.x + f.x * (lz - AXLE_R) + f.z * lx, z = this.rear.z + f.z * (lz - AXLE_R) - f.x * lx;
    return this.world.groundAt(x, z, this.y + 0.5 + (lz - AXLE_R) * Math.sin(this.tPitch));
  }

  // position + terrain following (pitch/roll from the four wheel contact heights)
  _place(dt, snap = false) {
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(-Math.cos(this.heading), 0, Math.sin(this.heading));
    const fl = this._ground(0.95, AXLE_F), fr = this._ground(-0.95, AXLE_F), rl = this._ground(0.95, AXLE_R), rr = this._ground(-0.95, AXLE_R);
    const front = (fl + fr) / 2, back = (rl + rr) / 2;
    const gy = back + (front - back) * (-AXLE_R / WHEELBASE);
    const tp = Math.atan2(front - back, WHEELBASE), tr = Math.atan2((fl + rl) / 2 - (fr + rr) / 2, 1.9);
    if (snap) { this.y = gy; this.vy = 0; }
    if (this.y > gy + 0.05) {                     // airborne / falling
      this.vy -= 9.81 * dt; this.y += this.vy * dt;
      if (this.y <= gy) { if (this.vy < -5) audio.thud(55, 0.4); this.y = gy; this.vy = 0; }
    } else { this.y = gy; this.vy = 0; }
    this.grounded = this.y - gy < 0.2;
    const k = snap ? 1 : 1 - Math.exp(-(this.grounded ? 10 : 2) * dt);
    this.tPitch += (tp - this.tPitch) * k; this.tRoll += (tr - this.tRoll) * k;
    const rp = this.root.position;
    rp.set(this.rear.x + this.forward.x * -AXLE_R, this.y, this.rear.z + this.forward.z * -AXLE_R);
    this.root.rotation.set(-this.tPitch, this.heading, this.tRoll);
    this.root.updateMatrixWorld(true);
    this.inv.copy(this.root.matrixWorld).invert();
  }

  /* ---------- driving ---------- */
  update(dt, ctrl) {
    const v = this.speed;
    const thr = ctrl && this.grounded && !this.stuck ? ctrl.throttle : 0;
    const steerIn = ctrl ? ctrl.steer : 0, hb = ctrl ? ctrl.handbrake : true;
    let acc = 0; this.braking = false;
    if (thr > 0) { if (v < -0.3) { acc = 12; this.braking = true; } else acc = 5.6 * (1 - clamp(v / 28, 0, 1)); }
    else if (thr < 0) { if (v > 0.3) { acc = -12; this.braking = true; } else acc = -3.4 * (1 - clamp(-v / 7, 0, 1)); }
    if (this.grounded) acc -= 9.81 * Math.sin(this.tPitch);         // hills pull you back
    let nv = v + acc * dt;
    const drag = (0.3 + 0.004 * v * v + (thr === 0 ? 0.6 : 0)) * dt;
    nv -= Math.sign(nv) * Math.min(drag, Math.abs(nv));
    if ((hb || this.stuck) && this.grounded) { const b = (this.stuck ? 20 : 14) * dt; nv = Math.abs(nv) <= b ? 0 : nv - Math.sign(nv) * b; if (Math.abs(v) > 0.5) this.braking = true; }
    this.accel = (nv - v) / Math.max(dt, 1e-4);
    this.speed = nv; this.throttle = thr;

    const maxSteer = 0.6 / (1 + Math.abs(nv) / 10);
    this.steer = damp(this.steer, steerIn * maxSteer, 5, dt);
    const yawRate = this.grounded ? nv * Math.tan(this.steer) / WHEELBASE : 0;
    this.heading += yawRate * dt;
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.rear.addScaledVector(this.forward, nv * dt);
    if (Math.abs(nv) > 0.01) this._collide();
    this._place(dt);

    // stuck in the river?
    const depth = this.world.waterDepth(this.root.position.x, this.root.position.z);
    if (!this.stuck && depth > 1.2 && this.y < this.world.W - 0.6) {
      this.stuck = true; this.speed = 0; this.setEngine(false);
      this.onMsg && this.onMsg('🌊 The RV is stuck in the river! Press R to recover it.');
    }
    // checkpoints along the road
    this.cpT -= dt;
    if (this.cpT <= 0) {
      this.cpT = 0.5;
      const road = this.world.T.road, i = road.nearest(this.root.position.x, this.root.position.z);
      if (Math.hypot(road.x[i] - this.root.position.x, road.z[i] - this.root.position.z) < 9) {
        this.roadS = road.s[i];
        while (this.cp < this.checkpoints.length - 1 && this.roadS >= this.checkpoints[this.cp + 1] && this.grounded && !this.stuck) { this.cp++; this.onCheckpoint && this.onCheckpoint(this, this.cp); }
      }
    }

    this._visuals(dt, nv, thr, yawRate);
  }

  _visuals(dt, nv, thr, yawRate) {
    this.dist += nv * dt;
    for (const w of this.m.wheels) { w.spin.rotation.x += (nv / WHEEL_R) * dt; if (w.front) w.pivot.rotation.y = this.steer; }
    this.parts.steering.rotation.z = -this.steer * 6;
    this.roll = damp(this.roll, clamp(yawRate * nv * 0.012, -0.05, 0.05), 4, dt);
    this.pitch = damp(this.pitch, clamp(-this.accel * 0.005, -0.03, 0.03), 4, dt);
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = Math.sin(this.dist * 2.3) * 0.008 * Math.min(1, Math.abs(nv) / 8);

    MAT.headlight.emissiveIntensity = this.headlights ? 2.2 : 0.25;
    MAT.taillight.emissiveIntensity = this.braking ? 2.0 : (this.headlights ? 0.8 : 0.2);
    this.spot.intensity = this.headlights ? 38 : 0;
    this.ilight.intensity = this.interiorLights ? 3.5 : 0;
    RV_MATS.ilamp.emissiveIntensity = this.interiorLights ? 1.6 : 0;
    for (const k in this.doors) {
      const d = this.doors[k];
      if (Math.abs(d.open - d.target) > 0.001) { d.open = damp(d.open, d.target, 7, dt); d.pivot.rotation[d.pivot.userData.axis || 'y'] = d.open * d.pivot.userData.openAngle; }
    }
    const tv = this.parts.tv;
    if (tv.on) drawTV(tv, dt);
    if (this.mwTimer > 0) { this.mwTimer -= dt; this.parts.mwMat.emissiveIntensity = this.mwTimer > 0 ? 1.2 : 0; if (this.mwTimer <= 0) audio.click(); }
    if (this.engineOn && this.audible) audio.engineSet(Math.min(1, Math.abs(nv) / 26), Math.abs(thr));
  }

  _collide() {
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const rx = this.rear.x + this.forward.x * -AXLE_R, rz = this.rear.z + this.forward.z * -AXLE_R;
    let hit = false;
    this.world.forNear(rx, rz, c => {
      const dx = c.x - rx, dz = c.z - rz, reach = 4.3 + c.r;
      if (dx * dx + dz * dz > reach * reach) return;
      const lx = dx * ch - dz * sh, lz = dx * sh + dz * ch;
      const qx = clamp(lx, -HX, HX), qz = clamp(lz - CZ, -HZ, HZ) + CZ;
      let nx = lx - qx, nz = lz - qz, pen;
      const d = Math.hypot(nx, nz);
      if (d > c.r) return;
      if (d < 1e-4) {
        const px = HX - Math.abs(lx), pz = HZ - Math.abs(lz - CZ);
        if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px + c.r; } else { nx = 0; nz = Math.sign(lz - CZ) || 1; pen = pz + c.r; }
      } else { nx /= d; nz /= d; pen = c.r - d; }
      this.rear.x -= (nx * ch + nz * sh) * pen; this.rear.z -= (-nx * sh + nz * ch) * pen;
      hit = true;
    });
    const b = this.world.bounds;
    const cx = clamp(rx, b.minX + 4, b.maxX - 4), cz = clamp(rz, b.minZ + 4, b.maxZ - 4);
    if (cx !== rx || cz !== rz) { this.rear.x += cx - rx; this.rear.z += cz - rz; hit = true; }
    if (hit) {
      if (Math.abs(this.speed) > 3) audio.thud(60, 0.25);
      this.speed = Math.abs(this.speed) > 2 ? -this.speed * 0.25 : 0;
    }
  }

  /* ---------- queries used by the player / bridge ---------- */
  toLocal(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.inv); }
  toWorld(l, out = new THREE.Vector3()) { return out.copy(l).applyMatrix4(this.root.matrixWorld); }
  axleWorld(lz, out = new THREE.Vector3()) { return out.set(0, 0, lz).applyMatrix4(this.root.matrixWorld); }
  pushOut(p, r) {
    const l = this.toLocal(p, this._tmp || (this._tmp = new THREE.Vector3()));
    if (l.y > ROOF_TOP - 0.35 || l.y < -1.5) return false;
    const ex = HX + r, ez = HZ + r, rz = l.z - CZ;
    if (Math.abs(l.x) >= ex || Math.abs(rz) >= ez) return false;
    const px = ex - Math.abs(l.x), pz = ez - Math.abs(rz);
    if (px < pz) l.x = Math.sign(l.x || 1) * ex; else l.z = CZ + Math.sign(rz || 1) * ez;
    const w = this.toWorld(l);
    p.x = w.x; p.z = w.z;
    return true;
  }
  roofHeightAt(p) {
    const l = this.toLocal(p, this._tmp2 || (this._tmp2 = new THREE.Vector3()));
    if (Math.abs(l.x) < BW + 0.02 && l.z > Z.rear - 0.02 && l.z < Z.nose + 0.1 && l.y > ROOF_TOP - 1.2) return this.toWorld(this._tmp2.set(l.x, ROOF_TOP, l.z)).y;
    return null;
  }
  setCutaway(camPos, inside, hideAlcove) {
    const g = this.m.groups;
    if (!inside) { g.roof.visible = g.left.visible = g.right.visible = g.rear.visible = g.alcove.visible = true; return; }
    const l = this.toLocal(camPos, this._tmp3 || (this._tmp3 = new THREE.Vector3()));
    g.roof.visible = false;
    g.left.visible = !(l.x > BW * 0.8);
    g.right.visible = !(l.x < -BW * 0.8);
    g.rear.visible = !(l.z < Z.rear + 0.3);
    g.alcove.visible = !hideAlcove;
  }

  /* ---------- toggles ---------- */
  setDoor(name, open) { this.doors[name].target = open ? 1 : 0; }
  setEngine(on) { if (on === this.engineOn) return; this.engineOn = on; if (this.audible) on ? audio.engineStart() : audio.engineStop(); }
  setAudible(a) { if (a === this.audible) return; this.audible = a; if (this.engineOn) a ? audio.engineStart() : audio.engineStop(); }

  /* ---------- multiplayer ---------- */
  netState() {
    const p = this.root.position;
    return { i: this.index, o: this.owner, x: r2(p.x), y: r2(this.y), z: r2(p.z), h: r3(this.heading), p: r3(this.tPitch), r: r3(this.tRoll), sp: r2(this.speed), st: r3(this.steer),
      hl: this.headlights ? 1 : 0, br: this.braking ? 1 : 0, e: this.engineOn ? 1 : 0, cp: this.cp, sk: this.stuck ? 1 : 0 };
  }
  applyNet(s) {
    if (!this.net) { this.heading = s.h; this.root.position.set(s.x, s.y, s.z); this.y = s.y; this.tPitch = s.p; this.tRoll = s.r; }
    this.net = s; this.owner = s.o;
    this.headlights = !!s.hl; this.braking = !!s.br; this.stuck = !!s.sk;
    if (s.cp > this.cp) { this.cp = s.cp; this.onCheckpoint && this.onCheckpoint(this, this.cp); }
    this.setEngine(!!s.e);
  }
  // someone else drives this RV: follow their snapshots smoothly
  netUpdate(dt) {
    const s = this.net;
    if (!s) return;
    const k = 1 - Math.exp(-10 * dt), rp = this.root.position;
    if ((rp.x - s.x) ** 2 + (rp.z - s.z) ** 2 > 400) { rp.set(s.x, s.y, s.z); this.heading = s.h; }
    rp.x += (s.x + Math.sin(s.h) * s.sp * 0.05 - rp.x) * k; rp.z += (s.z + Math.cos(s.h) * s.sp * 0.05 - rp.z) * k;
    this.y += (s.y - this.y) * k; rp.y = this.y;
    this.heading = dampAngle(this.heading, s.h, 10, dt);
    this.tPitch += (s.p - this.tPitch) * k; this.tRoll += (s.r - this.tRoll) * k;
    this.speed = s.sp; this.steer += (s.st - this.steer) * k;
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.rear.set(rp.x - this.forward.x * -AXLE_R, 0, rp.z - this.forward.z * -AXLE_R);
    this.root.rotation.set(-this.tPitch, this.heading, this.tRoll);
    this.root.updateMatrixWorld(true);
    this.inv.copy(this.root.matrixWorld).invert();
    this._visuals(dt, this.speed, 0, this.speed * Math.tan(this.steer) / WHEELBASE);
  }
  toggleHeadlights() { this.headlights = !this.headlights; audio.click(); return this.headlights; }
  toggleInteriorLights() { this.interiorLights = !this.interiorLights; audio.click(); return this.interiorLights; }
  toggleTV() { const tv = this.parts.tv; tv.on = !tv.on; tv.acc = 1; if (!tv.on) clearTV(tv); audio.click(); return tv.on; }
  toggleStove() { const f = this.parts.stoveFlames; f.visible = !f.visible; audio.click(); return f.visible; }
  toggleSink() { const w = this.parts.sinkWater; w.visible = !w.visible; audio.click(); return w.visible; }
  toggleFridge() { const d = this.doors.fridge; d.target = d.target ? 0 : 1; audio.thud(160, 0.08); return !!d.target; }
  microwave() { this.mwTimer = 4; audio.click(); }
}
