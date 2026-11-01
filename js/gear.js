import * as THREE from 'three';
import { ITEMS, itemModel, deployedModel } from './items.js';
import { audio } from './audio.js';

const CHOP_HITS = 4;

// Everything that happens with the item in your hand.
export class Gear {
  constructor(scene, world, rv, player, inv, drone, toast) {
    this.scene = scene; this.world = world; this.rv = rv; this.player = player; this.inv = inv; this.drone = drone;
    this.toast = toast;
    this.held = null; this.heldType = null;
    this.flashOn = false; this.zooming = false; this.boostT = 0; this.sawT = 0; this.skipFrame = false;
    this.deployed = []; this.chop = new Map(); this.hints = {};
    this._v = new THREE.Vector3(); this._h = new THREE.Vector3(); this._acts = [];
    const hand = player.char.hand;
    // Lights live in the scene permanently (intensity 0 when unused) so shaders never recompile
    this.flash = new THREE.SpotLight(0xfff4dc, 0, 30, 0.42, 0.45, 1);
    this.flash.position.set(0, -0.2, 0); this.flash.target.position.set(0, -6, 0);
    hand.add(this.flash, this.flash.target);
    this.lanternLight = new THREE.PointLight(0xffc870, 0, 9, 1.6);
    hand.add(this.lanternLight);
    this.controller = itemModel('controller');
    this.obstacles = null; this.materials = null;   // set by main
    this.netId = 'l'; this.depSeq = 0; this.onDeploy = null; this.onPack = null;
    this._fireAct = { pos: world.firePos, r: 2.8, label: () => 'Throw a log on the campfire', act: () => this._feedFire() };
  }

  get locked() { return this.drone.active ? 'drone' : this.zooming ? 'zoom' : null; }
  lockPrompt() {
    if (this.drone.active) return this.drone.state === 'returning' ? { key: '…', text: 'Drone returning' } : { key: 'E', text: 'Bring the drone back' };
    return { key: 'F', text: 'Lower binoculars' };
  }
  holdPose() {
    if (this.drone.active) return 'controller';
    if (this.zooming) return 'binoculars';
    const it = this.inv.equippedItem();
    return it ? ITEMS[it.type].hold : null;
  }

  refreshHeld() {
    const it = this.inv.equippedItem();
    const type = this.drone.active ? 'controller' : (it ? it.type : null);
    if (!it || it.type !== 'flashlight') this.flashOn = false;
    if (this.zooming && (!it || it.type !== 'binoculars')) this.zooming = false;
    if (type === this.heldType) return;
    const hand = this.player.char.hand;
    if (this.held) hand.remove(this.held);
    this.heldType = type;
    this.held = type ? (type === 'controller' ? this.controller : itemModel(type)) : null;
    if (this.held) hand.add(this.held);
  }

  /* ---------- using the held item (F / click) ---------- */
  use() {
    const it = this.inv.equippedItem();
    if (!it) return false;
    const def = ITEMS[it.type], p = this.player;
    this.skipFrame = true;
    switch (def.use) {
      case 'chop': if (p.char.swing(it.type === 'chainsaw' ? 'saw' : 'chop')) this._chop(it.type); break;
      case 'swing': if (p.char.swing('chop')) { audio.thud(240, 0.06); this._hint('hammer', 'The hammer is needed to stake down the tent.'); } break;
      case 'smash':
        if (p.char.swing('chop')) { if (!(p.mode === 'foot' && this.obstacles.hit(p.pos.x, p.pos.z, 'sledge'))) { audio.thud(250, 0.06); this._hint('smash', 'Walk up to rocks blocking the trail and smash them (gives stones).'); } }
        break;
      case 'info': this.toast(def.desc); break;
      case 'light': this.flashOn = !this.flashOn; audio.click(); this.toast('Flashlight ' + (this.flashOn ? 'on' : 'off')); break;
      case 'zoom': this.zooming = true; audio.click(); this.toast('Binoculars — mouse to look, F to lower'); break;
      case 'deploy': this._deploy(it); break;
      case 'consume':
        this.inv.removeItem(it); this.boostT = 30; audio.thud(320, 0.08);
        this.toast(`${def.name}: energy boost! You run faster for 30 s`); break;
      case 'drone': this._launchDrone(); break;
    }
    return true;
  }

  _hint(key, msg) { if (!this.hints[key]) { this.hints[key] = true; this.toast(msg); } }

  _chop(type) {
    const p = this.player;
    if (type === 'chainsaw') { audio.hum('saw', true, 'sawtooth', 115, 0.06); this.sawT = 0.6; }
    if (p.mode !== 'foot') { this._hint('chopIn', 'Go outside to find trees.'); return; }
    if (this.obstacles.hit(p.pos.x, p.pos.z, type)) return;      // fallen trees / rocks on the trail
    const best = this.world.nearestTree(p.pos.x, p.pos.z, Math.sin(p.yaw), Math.cos(p.yaw), 2.2);
    if (type !== 'chainsaw') audio.thud(best ? 190 : 260, 0.08);
    if (!best) { this._hint('chop', 'Walk up to a tree and use it to collect logs.'); return; }
    const hits = (this.chop.get(best) || 0) + (ITEMS[type].power || 1);
    if (hits >= CHOP_HITS) { this.chop.set(best, 0); this.materials.add('logs', 1); this.toast('+1 Log 🪵 (for planks at the workbench, or the campfire)'); }
    else { this.chop.set(best, hits); this.toast(`Chopping… ${hits}/${CHOP_HITS}`); }
  }

  _feedFire() {
    if (!this.materials.spend({ logs: 1 })) return;
    this.world.boostFire(60);
    audio.thud(80, 0.35);
    this.toast('🔥 The fire roars! (+60 s)');
  }

  _launchDrone() {
    const p = this.player;
    if (p.mode !== 'foot') { this.toast('Go outside to fly the drone'); return; }
    this.drone.launch(p.pos, p.yaw);
    this.refreshHeld();
    this.toast('Drone up! WASD fly · Space/Shift up/down · V camera · E bring back');
  }

  /* ---------- camping gear you can set up ---------- */
  _deploy(it) {
    const p = this.player, type = it.type;
    if (p.mode !== 'foot' || p.swimming || p.pos.y > this.world.heightAt(p.pos.x, p.pos.z) + 0.3) { this.toast('Set it up outside, on the ground'); return; }
    if (type === 'tent' && !(this.inv.has('hammer') && this.inv.has('rope'))) {
      this.toast('Pitching the tent needs a hammer and rope in your backpack (Gear Locker)'); return;
    }
    const dist = type === 'tent' ? 2.7 : type === 'sleepingbag' ? 1.6 : 1.2;
    const pos = new THREE.Vector3(p.pos.x + Math.sin(p.yaw) * dist, 0, p.pos.z + Math.cos(p.yaw) * dist);
    pos.y = this.world.heightAt(pos.x, pos.z);
    if (this.world.waterDepth(pos.x, pos.z) > 0.2) { this.toast('Not in the water!'); return; }
    const rad = { tent: 1.3, chair: 0.4, sleepingbag: 0.5, lantern: 0.15 }[type];
    if (!this._spotFree(pos, rad)) { this.toast('Not enough space here — try somewhere open'); return; }
    const d = this._spawn(type, pos, p.yaw + Math.PI, it, `${this.netId}-${++this.depSeq}`);
    this.onDeploy && this.onDeploy(d);
    this.inv.removeItem(it);
    audio.thud(type === 'tent' ? 200 : 140, 0.12);
    this.toast({ tent: '⛺ Tent pitched! Walk up to the entrance to rest.', chair: 'Chair unfolded — walk up to sit.', sleepingbag: 'Sleeping bag rolled out.', lantern: 'Lantern placed.' }[type]);
  }

  _spawn(type, pos, yaw, item, id) {
    const d = { id, item, type, pos, yaw, mesh: deployedModel(type), circle: null, act: null };
    d.mesh.position.copy(pos);
    if (type === 'lantern') d.mesh.position.y = pos.y + 0.275;
    d.mesh.rotation.y = yaw;
    this.scene.add(d.mesh);
    if (type === 'tent' || type === 'chair') d.circle = this.world.addCollider({ x: pos.x, z: pos.z, r: type === 'tent' ? 1.0 : 0.3 });
    this.deployed.push(d);
    return d;
  }
  // a teammate set something up / packed it away
  addRemote(m) { if (!this.deployed.some(d => d.id === m.id)) this._spawn(m.type, new THREE.Vector3(m.x, m.y, m.z), m.yaw, null, m.id); }
  removeRemote(id) { const d = this.deployed.find(x => x.id === id); if (d) this._remove(d); }
  _remove(d) {
    if (this.lanternLight.parent === d.mesh) this.player.char.hand.add(this.lanternLight);
    this.scene.remove(d.mesh);
    if (d.circle) this.world.removeCollider(d.circle);
    this.deployed.splice(this.deployed.indexOf(d), 1);
  }

  _spotFree(pos, r) {
    for (const rv of this.player.rvs) { const l = rv.toLocal(pos, this._v); if (Math.abs(l.x) < 1.3 + r && l.z > -4.0 - r && l.z < 4.2 + r) return false; }
    let free = true;
    this.world.forNear(pos.x, pos.z, c => { if (Math.hypot(c.x - pos.x, c.z - pos.z) < c.r + r) free = false; });
    return free;
  }

  _pack(d) {
    if (!(d.item ? this.inv.addItem(d.item) : this.inv.add(d.type))) { this.toast('Backpack full'); return; }
    this._remove(d);
    this.onPack && this.onPack(d);
    audio.thud(130, 0.1);
    this.toast(`Packed up the ${ITEMS[d.type].name.toLowerCase()}`);
  }

  _actFor(d) {
    const p = this.player, at = d.pos, f = new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    const P = (k, y) => { const v = at.clone().addScaledVector(f, k); return v.setY(this.world.heightAt(v.x, v.z) + y); };
    const pack = { label: () => `Pack up ${ITEMS[d.type].name.toLowerCase()}`, act: () => this._pack(d) };
    switch (d.type) {
      case 'tent': return { pos: P(1.3, 0), r: 1.5, label: () => 'Rest in the tent', act: () => p.lieWorld(P(0.75, 0.17), d.yaw, P(1.8, 0), 'tent'), alt: pack };
      case 'chair': return { pos: at, r: 1.3, label: () => 'Sit on the chair', act: () => p.sitWorld(P(-0.04, -0.4), d.yaw, P(0.8, 0)), alt: pack };
      case 'sleepingbag': return { pos: at, r: 1.4, label: () => 'Sleep in the sleeping bag', act: () => p.lieWorld(P(0.95, 0.2), d.yaw, P(1.6, 0), 'bag'), alt: pack };
      default: return { pos: at, r: 1.2, label: () => 'Pick up the lantern', act: () => this._pack(d) };
    }
  }

  // World-anchored interactions for the player (deployed gear + campfire)
  worldActs() {
    const list = this._acts; list.length = 0;
    for (const d of this.deployed) list.push(d.act || (d.act = this._actFor(d)));
    if (this.materials.get('logs') > 0) list.push(this._fireAct);
    return list;
  }

  /* ---------- per frame ---------- */
  update(dt, input) {
    const p = this.player;
    const skip = this.skipFrame; this.skipFrame = false;
    // drone piloting
    const home = p.char.root.getWorldPosition(this._h);
    if (this.drone.active && !skip && this.drone.state === 'flying' && (input.wasPressed('KeyE') || input.wasPressed('KeyF') || input.click)) {
      this.drone.recall(); this.toast('Drone returning to you');
    }
    const wasActive = this.drone.active;
    this.drone.update(dt, input, home);
    if (wasActive && !this.drone.active) { this.refreshHeld(); this.toast('Drone landed and packed away'); }
    // binoculars
    if (this.zooming && !skip && (input.wasPressed('KeyF') || input.wasPressed('KeyE') || input.click)) this.zooming = false;
    if (this.zooming && p.mode !== 'foot' && p.mode !== 'inside') this.zooming = false;
    // chainsaw sound, energy boost
    if (this.sawT > 0) { this.sawT -= dt; if (this.sawT <= 0) audio.hum('saw', false); }
    this.boostT = Math.max(0, this.boostT - dt);
    p.boost = this.boostT > 0;
    // hand + lights
    const m = p.mode, hand = p.char.hand;
    const handVis = m === 'foot' || m === 'inside' || (m === 'tween' && p.tween && p.tween.anim === 'walk');
    hand.visible = handVis;
    const eq = this.inv.equippedItem(), eqType = eq ? eq.type : null;
    this.flash.intensity = this.flashOn && eqType === 'flashlight' && handVis ? 30 : 0;
    const placed = this.deployed.find(d => d.type === 'lantern');
    if (placed) {
      if (this.lanternLight.parent !== placed.mesh) { placed.mesh.add(this.lanternLight); this.lanternLight.position.set(0, -0.17, 0); }
      this.lanternLight.intensity = 2.4;
    } else {
      if (this.lanternLight.parent !== hand) { hand.add(this.lanternLight); }
      this.lanternLight.position.set(0, -0.18, 0);
      this.lanternLight.intensity = eqType === 'lantern' && handVis ? 2.4 : 0;
    }
  }
}
