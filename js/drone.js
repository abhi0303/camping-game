import * as THREE from 'three';
import { GeoBuilder, clamp, damp } from './utils.js';
import { droneBody } from './items.js';
import { audio } from './audio.js';

const SPEED = 12, CLIMB = 6, RANGE = 150, MAX_ALT = 90, FLIGHT_TIME = 180, SENS = 0.0022;

export class Drone {
  constructor(scene, world, rv) {
    this.world = world; this.rvs = [rv];
    this.group = new THREE.Group(); this.group.rotation.order = 'YXZ';
    const b = new GeoBuilder(); droneBody(b, false);
    const body = b.build(); body.scale.setScalar(1.6); this.group.add(body);
    this.props = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, pb = new GeoBuilder();
      pb.box(0.17, 0.005, 0.02, 0, 0, 0, 0x111214); pb.box(0.02, 0.005, 0.17, 0, 0, 0, 0x111214);
      const p = pb.build(); p.position.set(Math.cos(a) * 0.32, 0.055, Math.sin(a) * 0.32); p.scale.setScalar(1.6);
      this.group.add(p); this.props.push(p);
    }
    const led = (c, x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, 0, 0.17); return m; };
    this.group.add(led(0x2bff6a, 0.06), led(0xff3030, -0.06));
    this.group.visible = false;
    scene.add(this.group);
    this.state = 'stowed';           // stowed | flying | returning
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.camPitch = 0.2; this.battery = 1; this.warn = ''; this.t = 0;
    this._v = new THREE.Vector3();
  }

  get active() { return this.state !== 'stowed'; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  launch(from, yaw) {
    this.state = 'flying';
    this.yaw = yaw; this.camPitch = 0.15;
    this.pos.set(from.x + Math.sin(yaw) * 0.8, from.y + 1.1, from.z + Math.cos(yaw) * 0.8);
    this.vel.set(0, 2.5, 0);
    this.group.visible = true;
    audio.hum('drone', true, 'sawtooth', 190, 0.035);
  }
  recall() { if (this.state === 'flying') this.state = 'returning'; }

  // home = where the pilot is standing (world)
  update(dt, input, home) {
    if (this.state === 'stowed') { this.battery = Math.min(1, this.battery + dt / 60); return; }
    this.t += dt;
    for (const p of this.props) p.rotation.y += dt * 55;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.warn = '';
    if (this.state === 'flying') {
      this.yaw -= input.dx * SENS;
      this.camPitch = clamp(this.camPitch + input.dy * SENS, -0.35, 1.45);
      const iz = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      const ix = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
      const iy = (input.isDown('Space') ? 1 : 0) - (input.isDown('ShiftLeft', 'ShiftRight', 'KeyC') ? 1 : 0);
      const tx = (fx * iz - fz * ix) * SPEED, tz = (fz * iz + fx * ix) * SPEED;
      this.vel.x = damp(this.vel.x, tx, 2.5, dt); this.vel.z = damp(this.vel.z, tz, 2.5, dt);
      this.vel.y = damp(this.vel.y, iy * CLIMB, 3, dt);
      this.battery -= dt / FLIGHT_TIME;
      if (this.battery < 0.15) this.warn = 'Low battery';
      if (this.battery <= 0) { this.battery = 0; this.state = 'returning'; this.warn = 'Battery empty — returning'; }
    } else { // returning to the pilot
      const d = this._v.set(home.x, home.y + 1.3, home.z).sub(this.pos), dist = d.length();
      if (dist < 0.7) { this._stow(); return; }
      d.multiplyScalar(Math.min(14, dist * 2.2) / dist);
      this.vel.lerp(d, 1 - Math.exp(-5 * dt));
      this.yaw = Math.atan2(d.x, d.z);
    }
    this.pos.addScaledVector(this.vel, dt);
    // ground / RV roof / ceiling / range limits
    let minY = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + 0.35;
    for (const r of this.rvs) { const roof = r.roofHeightAt(this.pos); if (roof !== null) minY = Math.max(minY, roof + 0.3); }
    if (this.pos.y < minY) { this.pos.y = minY; this.vel.y = Math.max(0, this.vel.y); }
    if (this.pos.y > MAX_ALT) { this.pos.y = MAX_ALT; this.vel.y = Math.min(0, this.vel.y); }
    const ox = this.pos.x - home.x, oz = this.pos.z - home.z, od = Math.hypot(ox, oz);
    if (od > RANGE) { this.pos.x = home.x + ox / od * RANGE; this.pos.z = home.z + oz / od * RANGE; this.warn = 'Signal limit reached'; }
    // visual tilt follows velocity
    const fv = this.vel.x * fx + this.vel.z * fz, sv = this.vel.x * fz - this.vel.z * fx;
    this.group.position.copy(this.pos); this.group.position.y += Math.sin(this.t * 3) * 0.02;
    this.group.rotation.set(fv * 0.025, this.yaw, sv * 0.025);
    audio.humSet('drone', 190 + this.speed * 9 + Math.abs(this.vel.y) * 10, 0.035);
  }

  _stow() {
    this.state = 'stowed'; this.group.visible = false; this.vel.set(0, 0, 0);
    audio.hum('drone', false);
  }

  camPos(out) { return out.set(this.pos.x + Math.sin(this.yaw) * 0.2, this.pos.y - 0.12, this.pos.z + Math.cos(this.yaw) * 0.2); }
}
