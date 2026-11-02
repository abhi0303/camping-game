import * as THREE from 'three';
import { Character } from './character.js';
import { itemModel, droneBody } from './items.js';
import { GeoBuilder, dampAngle } from './utils.js';
import { remoteShot } from './combat.js';

// Jacket colours per player slot (slot 0 = the classic black jacket)
// Outfit per player slot: jacket + T-shirt + trousers (slot 0 = the classic look from the concept art)
export const PLAYER_COLORS = [
  { jacket: 0x26282d, jacketLt: 0x33363c, shirt: 0xe8e8ea, jeans: 0x3f6fb5, jeansDk: 0x355f9c, css: '#ffd34d' },   // black jacket · white tee · blue jeans
  { jacket: 0x8f2a2a, jacketLt: 0xa63a3a, shirt: 0xf0dfae, jeans: 0x2c2e34, jeansDk: 0x23252a, css: '#ff8a80' },   // red jacket · cream tee · black jeans
  { jacket: 0x2a4f8f, jacketLt: 0x3a62a6, shirt: 0xbcc2cc, jeans: 0xa08a5c, jeansDk: 0x8a764e, css: '#8ab4ff' },   // blue jacket · grey tee · khaki pants
  { jacket: 0x2f7a3c, jacketLt: 0x3c8f4a, shirt: 0xf2b880, jeans: 0x25365e, jeansDk: 0x1e2d4f, css: '#9be39f' },   // green jacket · peach tee · dark denim
  { jacket: 0xb0641e, jacketLt: 0xc47830, shirt: 0x7fd1c7, jeans: 0x6b6f78, jeansDk: 0x5b5f68, css: '#ffc07a' },   // orange jacket · teal tee · grey pants
  { jacket: 0x6a3c9b, jacketLt: 0x7d4fae, shirt: 0xf2a6c2, jeans: 0x7ea3d6, jeansDk: 0x6b8fc2, css: '#d0a8ff' },   // purple jacket · pink tee · light denim
  { jacket: 0x1f7f80, jacketLt: 0x2b9596, shirt: 0xf4f1e6, jeans: 0x5a3e2b, jeansDk: 0x4a3223, css: '#7fe0e0' },   // teal jacket · off-white tee · brown pants
  { jacket: 0x6b4a2e, jacketLt: 0x7d5a3a, shirt: 0xd9e86a, jeans: 0x2f4f3a, jeansDk: 0x263f2f, css: '#e8c39a' },   // brown jacket · lime tee · olive pants
];

// Name tag + health bar above a teammate (redrawn only when something on it changes)
function nameTag() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(1.6, 0.6, 1); s.renderOrder = 5; s.userData = { c, t, key: '' };
  return s;
}
function drawTag(s, text, color, hp, down, showHp) {
  const key = text + '|' + color + '|' + Math.round(hp / 4) + '|' + down + '|' + showHp;
  if (s.userData.key === key) return;
  s.userData.key = key;
  const { c, t } = s.userData, g = c.getContext('2d');
  g.clearRect(0, 0, 256, 96);
  g.font = 'bold 30px system-ui, sans-serif';
  const label = down ? '⬇ ' + text : text;
  const w = Math.min(250, g.measureText(label).width + 30);
  g.fillStyle = down ? 'rgba(120,20,20,.85)' : 'rgba(20,22,30,.78)';
  g.beginPath(); g.roundRect ? g.roundRect((256 - w) / 2, 6, w, 46, 14) : g.rect((256 - w) / 2, 6, w, 46); g.fill();
  g.fillStyle = down ? '#ffd0c8' : color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 128, 30);
  if (showHp || down) {
    const k = Math.max(0, Math.min(1, hp / 100));
    g.fillStyle = 'rgba(15,16,22,.85)'; g.fillRect(48, 62, 160, 18);
    g.fillStyle = k > 0.5 ? '#5bd16a' : k > 0.25 ? '#f2c14e' : '#ff5a4a'; g.fillRect(51, 65, 154 * k, 12);
  }
  t.needsUpdate = true;
}
const CARRY_POS = new THREE.Vector3(0.92, 1.56, -0.2), CARRY_ROT = new THREE.Euler(0, 0, Math.PI / 2);
export { CARRY_POS, CARRY_ROT };

// Other players: avatars driven by network snapshots (smoothed)
export class Remotes {
  constructor(scene, rvs) {
    this.scene = scene; this.rvs = rvs; this.map = new Map(); this._v = new THREE.Vector3();
    this.localId = null; this.localRoot = null;      // our own avatar (teammates we carry ride on it)
    this.tracers = null; this.listener = null; this.night = () => false;
  }

  upsert(id, s) {
    let r = this.map.get(id);
    if (!r) {
      const col = PLAYER_COLORS[(s.c || 0) % PLAYER_COLORS.length];
      const char = new Character(col);
      const tag = nameTag();
      this.scene.add(char.root, tag);
      r = { id, char, tag, s, pos: new THREE.Vector3(s.x, s.y, s.z), yaw: s.yw || 0, item: null, itemType: null, drone: null, color: col.css, shots: s.sh || 0 };
      this.map.set(id, r);
    }
    r.s = s; r.last = performance.now();
    return r;
  }
  remove(id) {
    const r = this.map.get(id);
    if (!r) return;
    r.char.root.removeFromParent(); r.tag.removeFromParent(); if (r.drone) r.drone.removeFromParent();
    this.map.delete(id);
  }
  // is a remote player using this seat of RV #i ?
  seatTaken(i, seat) { for (const r of this.map.values()) if (r.s.f && r.s.rv === i && r.s.se === seat) return r.s.n || 'Someone'; return null; }

  tick(dt) {
    const k = 1 - Math.exp(-14 * dt), now = performance.now();
    const night = this.night();
    for (const r of this.map.values()) {
      const away = now - (r.last || now) > 4000;
      if (away !== r.away) { r.away = away; r.tag.material.opacity = away ? 0.45 : 1; }
      const s = r.s;
      // carried by a teammate (or by us): ride on their shoulders
      const carrier = s.dn && s.cb ? (s.cb === this.localId ? this.localRoot : (this.map.get(s.cb) || {}).char?.root) : null;
      if (carrier) {
        if (r.char.root.parent !== carrier) carrier.add(r.char.root);
        r.char.root.position.copy(CARRY_POS); r.char.root.rotation.copy(CARRY_ROT);
        r.char.root.getWorldPosition(r.pos);
      } else {
        const rv = s.f ? this.rvs[s.rv] : null, parent = rv ? rv.body : this.scene;
        if (r.char.root.parent !== parent) { parent.add(r.char.root); r.pos.set(s.x, s.y, s.z); r.yaw = s.yw; }
        if ((r.pos.x - s.x) ** 2 + (r.pos.z - s.z) ** 2 > 36) r.pos.set(s.x, s.y, s.z);
        r.pos.x += (s.x - r.pos.x) * k; r.pos.y += (s.y - r.pos.y) * k; r.pos.z += (s.z - r.pos.z) * k;
        r.yaw = dampAngle(r.yaw, s.yw, 14, dt);
        r.char.root.position.copy(r.pos);
        r.char.root.rotation.set(s.pi || 0, r.yaw, 0);
      }
      r.char.update(dt, { mode: s.a || 'idle', speed: s.sp || 0, vy: s.vy || 0, steer: s.st || 0, hold: s.hd || null, aim: s.ap || 0 });
      if (s.it !== r.itemType) {
        if (r.item) r.char.hand.remove(r.item);
        r.itemType = s.it; r.item = s.it ? itemModel(s.it) : null;
        if (r.item) r.char.hand.add(r.item);
      }
      r.char.hand.visible = !!s.hv;
      // they fired: flash + pellet streaks + sound here too
      if ((s.sh || 0) !== r.shots) {
        const fired = (s.sh || 0) > r.shots; r.shots = s.sh || 0;
        if (fired && r.item && s.it === 'shotgun' && this.tracers) { r.char.root.updateMatrixWorld(true); remoteShot(r.item, r.yaw, s.ap || 0, this.tracers, this.listener); r.char.recoil(); }
      }
      r.char.headAnchor.getWorldPosition(this._v);
      r.tag.position.set(this._v.x, this._v.y + (s.dn ? 0.75 : 0.55), this._v.z);
      const hp = s.hp ?? 100;
      drawTag(r.tag, s.n || 'Player', r.color, hp, !!s.dn, night || hp < 100);
      if (s.dr) {
        if (!r.drone) { const b = new GeoBuilder(); droneBody(b, true); r.drone = b.build(); r.drone.scale.setScalar(1.6); this.scene.add(r.drone); r.drone.position.set(s.dr[0], s.dr[1], s.dr[2]); }
        r.drone.visible = true;
        r.drone.position.lerp(this._v.set(s.dr[0], s.dr[1], s.dr[2]), k);
        r.drone.rotation.y = s.dr[3];
      } else if (r.drone) r.drone.visible = false;
    }
  }
  // world position of each remote player
  each(fn) { for (const r of this.map.values()) { r.char.root.getWorldPosition(this._v); fn(r, this._v); } }
  get count() { return this.map.size; }
}
