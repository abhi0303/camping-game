import * as THREE from 'three';
import { clamp, damp, dampAngle } from './utils.js';

const SENS = 0.0026;

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 1.45; this.pitch = 0.28;
    this.dist = 6; this.distTarget = 6;
    this.driveDist = 12;
    this.firstPerson = false;
    this.driveView = 'chase';   // 'chase' | 'cockpit'
    this.lookYaw = 0; this.lookPitch = 0.22;   // cockpit look offsets
    this.target = new THREE.Vector3(); this.has = false;
    this.drone = null; this.gear = null; this.droneView = 'cam'; this._wasZoom = false;
    this.idle = 0;
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._l = new THREE.Vector3();
  }

  toggle(player) {
    if (this.drone && this.drone.active) { this.droneView = this.droneView === 'cam' ? 'chase' : 'cam'; return this.droneView === 'cam' ? 'Drone camera' : 'Drone chase view'; }
    if (player.mode === 'drive') { this.driveView = this.driveView === 'chase' ? 'cockpit' : 'chase'; this.lookYaw = 0; this.lookPitch = 0.22; return this.driveView === 'cockpit' ? 'Cockpit view' : 'Chase view'; }
    this.firstPerson = !this.firstPerson;
    if (this.firstPerson) this.pitch = 0.05;
    else this.pitch = 0.3;
    return this.firstPerson ? 'First person' : 'Third person';
  }

  _fov(f) { if (this.cam.fov !== f) { this.cam.fov = f; this.cam.updateProjectionMatrix(); } }

  update(dt, input, player, rv) {
    const cam = this.cam;
    const driving = player.mode === 'drive';
    const cockpit = driving && this.driveView === 'cockpit';
    const fp = !driving && this.firstPerson;
    const mouse = input.dx !== 0 || input.dy !== 0;
    this.idle = mouse ? 0 : this.idle + dt;

    // flying the drone: camera rides on the drone (or chases it)
    const drone = this.drone;
    if (drone && drone.active) {
      const h = drone.yaw, fx = Math.sin(h), fz = Math.cos(h);
      if (this.droneView === 'cam') {
        drone.camPos(cam.position);
        const p = drone.camPitch;
        this._d.set(fx * Math.cos(p), -Math.sin(p), fz * Math.cos(p));
        cam.lookAt(this._l.copy(cam.position).add(this._d));
        this._fov(75);
      } else {
        this._v.set(drone.pos.x - fx * 3.2, drone.pos.y + 1.2, drone.pos.z - fz * 3.2);
        cam.position.lerp(this._v, 1 - Math.exp(-6 * dt));
        cam.lookAt(this._l.set(drone.pos.x + fx, drone.pos.y, drone.pos.z + fz));
        this._fov(65);
      }
      this.yaw = h + Math.PI; this.has = false;
      player.char.setHeadVisible(true);
      rv.setCutaway(cam.position, false, false);
      return;
    }
    // binoculars: zoomed first-person view
    if (this.gear && this.gear.zooming) {
      if (!this._wasZoom) { this._wasZoom = true; this.pitch = 0.02; }
      this.yaw -= input.dx * SENS * 0.25;
      this.pitch = clamp(this.pitch + input.dy * SENS * 0.25, -1.2, 1.2);
      player.headWorld(cam.position);
      const p = this.pitch;
      this._d.set(-Math.sin(this.yaw) * Math.cos(p), -Math.sin(p), -Math.cos(this.yaw) * Math.cos(p));
      cam.lookAt(this._l.copy(cam.position).add(this._d));
      this._fov(14);
      player.yaw = this.yaw + Math.PI - (player.frame === 'rv' ? rv.heading : 0);
      player.char.setHeadVisible(false);
      rv.setCutaway(cam.position, false, false);
      return;
    }
    if (this._wasZoom) { this._wasZoom = false; if (!this.firstPerson) this.pitch = 0.3; }

    if (cockpit) {
      this.lookYaw = clamp(this.lookYaw - input.dx * SENS, -2.2, 2.2);
      this.lookPitch = clamp(this.lookPitch + input.dy * SENS, -0.6, 0.8);
      if (this.idle > 2 && Math.abs(rv.speed) > 2) { this.lookYaw = damp(this.lookYaw, 0, 2, dt); this.lookPitch = damp(this.lookPitch, 0.22, 2, dt); }
      player.headWorld(this._v);
      // sit the eye point a little behind/below the head so dash + wheel fill the lower half
      cam.position.copy(this._v); cam.position.y -= 0.06;
      cam.position.x -= rv.forward.x * 0.22; cam.position.z -= rv.forward.z * 0.22;
      const h = rv.heading + this.lookYaw, p = this.lookPitch;
      this._d.set(Math.sin(h) * Math.cos(p), -Math.sin(p), Math.cos(h) * Math.cos(p));
      this._fov(72);
      cam.lookAt(this._l.copy(cam.position).add(this._d));
      this.yaw = h + Math.PI;
      player.char.setHeadVisible(false);
      rv.setCutaway(cam.position, false, false);
      return;
    }

    this._fov(60);
    this.yaw -= input.dx * SENS;
    this.pitch = clamp(this.pitch + input.dy * SENS, fp ? -1.3 : -0.25, fp ? 1.3 : 1.35);

    if (fp) {
      player.headWorld(this._v);
      cam.position.copy(this._v);
      const p = this.pitch;
      this._d.set(-Math.sin(this.yaw) * Math.cos(p), -Math.sin(p), -Math.cos(this.yaw) * Math.cos(p));
      cam.position.addScaledVector(this._d, 0.12);
      cam.lookAt(this._l.copy(cam.position).add(this._d));
      player.char.setHeadVisible(false);
      rv.setCutaway(cam.position, false, false);
      return;
    }
    player.char.setHeadVisible(true);

    // orbit / chase
    if (input.wheel) {
      if (driving) this.driveDist = clamp(this.driveDist + input.wheel * 1.2, 7, 24);
      else this.distTarget = clamp(this.distTarget + input.wheel * 0.6, 2.2, 14);
    }
    const inRV = player.isInRV();
    let goal;
    if (driving) {
      goal = this._v.copy(rv.root.position).addScaledVector(rv.forward, 0.6); goal.y += 2.4;
      if (this.idle > 1.2 && Math.abs(rv.speed) > 1) {
        this.yaw = dampAngle(this.yaw, rv.heading + Math.PI, 2.5, dt);
        this.pitch = damp(this.pitch, 0.26, 1.5, dt);
      }
      this.dist = damp(this.dist, this.driveDist, 4, dt);
    } else {
      goal = player.focusWorld(this._v);
      let maxD = this.distTarget, minP = -0.25;
      if (inRV) { maxD = Math.min(maxD, 4.6); minP = 0.55; }
      if (this.pitch < minP) this.pitch = minP - (minP - this.pitch) * Math.exp(-6 * dt); // ease up when stepping inside
      this.dist = damp(this.dist, maxD, 6, dt);
    }
    if (!this.has) { this.target.copy(goal); this.has = true; }
    else this.target.lerp(goal, 1 - Math.exp(-(driving ? 14 : 12) * dt));

    const cp = Math.cos(this.pitch);
    this._d.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    let d = this.dist;
    // keep the camera out of the RV body when the player is outside it
    if (!inRV && !driving) {
      for (let i = 1; i <= 10; i++) {
        const t = (d * i) / 10;
        this._l.copy(this.target).addScaledVector(this._d, t);
        const lp = rv.toLocal(this._l, this._l);
        if (Math.abs(lp.x) < 1.35 && lp.z > -4.0 && lp.z < 4.25 && lp.y < 3.45 && lp.y > -0.2) { d = Math.max(0.6, (d * (i - 1)) / 10); break; }
      }
    }
    cam.position.copy(this.target).addScaledVector(this._d, d);
    const gmin = this.world ? this.world.heightAt(cam.position.x, cam.position.z) + 0.4 : 0.35;
    if (cam.position.y < gmin) cam.position.y = gmin;
    cam.lookAt(this.target);
    rv.setCutaway(cam.position, inRV && !driving, player.hideAlcove());
  }
}
