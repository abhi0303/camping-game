import * as THREE from 'three';
import { Character } from './character.js';
import { itemModel, droneBody } from './items.js';
import { GeoBuilder, dampAngle } from './utils.js';

// Jacket colours per player slot (slot 0 = the classic black jacket)
// Outfit per player slot: jacket + T-shirt + trousers (slot 0 = the classic look from the concept art)
export const PLAYER_COLORS = [
  { jacket: 0x26282d, jacketLt: 0x33363c, shirt: 0xe8e8ea, jeans: 0x3f6fb5, jeansDk: 0x355f9c, css: '#ffd34d' },   // black jacket · white tee · blue jeans
  { jacket: 0x8f2a2a, jacketLt: 0xa63a3a, shirt: 0xf0dfae, jeans: 0x2c2e34, jeansDk: 0x23252a, css: '#ff8a80' },   // red jacket · cream tee · black jeans
  { jacket: 0x2a4f8f, jacketLt: 0x3a62a6, shirt: 0xbcc2cc, jeans: 0xa08a5c, jeansDk: 0x8a764e, css: '#8ab4ff' },   // blue jacket · grey tee · khaki pants
  { jacket: 0x2f7a3c, jacketLt: 0x3c8f4a, shirt: 0xf2b880, jeans: 0x25365e, jeansDk: 0x1e2d4f, css: '#9be39f' },   // green jacket · peach tee · dark denim
  { jacket: 0xb0641e, jacketLt: 0xc47830, shirt: 0x7fd1c7, jeans: 0x6b6f78, jeansDk: 0x5b5f68, css: '#ffc07a' },   // orange jacket · teal tee · grey pants
  { jacket: 0x6a3c9b, jacketLt: 0x7d4fae, shirt: 0xf2a6c2, jeans: 0x7ea3d6, jeansDk: 0x6b8fc2, css: '#d0a8ff' },   // purple jacket · pink tee · light denim
];

function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(250, g.measureText(text).width + 30);
  g.fillStyle = 'rgba(20,22,30,.78)';
  g.beginPath(); g.roundRect ? g.roundRect((256 - w) / 2, 8, w, 46, 14) : g.rect((256 - w) / 2, 8, w, 46); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1); s.renderOrder = 5;
  return s;
}

// Other players: avatars driven by network snapshots (smoothed)
export class Remotes {
  constructor(scene, rvs) { this.scene = scene; this.rvs = rvs; this.map = new Map(); this._v = new THREE.Vector3(); }

  upsert(id, s) {
    let r = this.map.get(id);
    if (!r) {
      const col = PLAYER_COLORS[(s.c || 0) % PLAYER_COLORS.length];
      const char = new Character(col);
      const tag = nameTag(s.n || 'Player', col.css);
      this.scene.add(char.root, tag);
      r = { id, char, tag, s, pos: new THREE.Vector3(s.x, s.y, s.z), yaw: s.yw || 0, item: null, itemType: null, drone: null, color: col.css };
      this.map.set(id, r);
    }
    r.s = s;
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
    const k = 1 - Math.exp(-14 * dt);
    for (const r of this.map.values()) {
      const s = r.s, rv = s.f ? this.rvs[s.rv] : null, parent = rv ? rv.body : this.scene;
      if (r.char.root.parent !== parent) { parent.add(r.char.root); r.pos.set(s.x, s.y, s.z); r.yaw = s.yw; }
      if ((r.pos.x - s.x) ** 2 + (r.pos.z - s.z) ** 2 > 36) r.pos.set(s.x, s.y, s.z);
      r.pos.x += (s.x - r.pos.x) * k; r.pos.y += (s.y - r.pos.y) * k; r.pos.z += (s.z - r.pos.z) * k;
      r.yaw = dampAngle(r.yaw, s.yw, 14, dt);
      r.char.root.position.copy(r.pos);
      r.char.root.rotation.set(s.pi || 0, r.yaw, 0);
      r.char.update(dt, { mode: s.a || 'idle', speed: s.sp || 0, vy: s.vy || 0, steer: s.st || 0, hold: s.hd || null });
      if (s.it !== r.itemType) {
        if (r.item) r.char.hand.remove(r.item);
        r.itemType = s.it; r.item = s.it ? itemModel(s.it) : null;
        if (r.item) r.char.hand.add(r.item);
      }
      r.char.hand.visible = !!s.hv;
      r.char.headAnchor.getWorldPosition(this._v);
      r.tag.position.set(this._v.x, this._v.y + 0.5, this._v.z);
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
