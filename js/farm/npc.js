// The farmer who runs the Farm Store: an elderly man in a white shirt, brown trousers and a straw hat, made
// with the same low-poly Character as the players. He stands behind the counter, turns to whoever comes
// near and greets them with a speech bubble. (Talking to him — E — opens the store menu; see farmland.js.)
import * as THREE from 'three';
import { Character } from '../character.js';
import { GeoBuilder, canvasTexture, dampAngle } from '../utils.js';

const LINES = ['How can I help you?', 'Do you want to purchase or sell anything?'];
const FARMER = {
  jacket: 0xf1ede2, jacketLt: 0xddd6c6, shirt: 0xf7f3ea, jeans: 0x6b4a2e, jeansDk: 0x5a3d25, belt: 0x3a2412,
  skin: 0xb98058, skinDk: 0xa06c48, hair: 0xd9d5ce, shoe: 0x4a3020, shoeGrey: 0x3a2618, sole: 0x2a1a10, watch: 0x6a5a3a,
};
// straw hat with a red band
function strawHat(b) {
  b.cyl(0.25, 0.27, 0.025, 12, 0, 0.29, -0.005, 0xd8b862);
  b.cyl(0.29, 0.29, 0.012, 12, 0, 0.285, -0.005, 0xc8a650);
  b.cyl(0.118, 0.135, 0.14, 10, 0, 0.36, -0.005, 0xe2c672);
  b.cyl(0.137, 0.137, 0.035, 10, 0, 0.315, -0.005, 0x9a3a2a);
  b.cyl(0.1, 0.118, 0.012, 10, 0, 0.432, -0.005, 0xd0b060);
}
const NEAR = 7;          // the bubble shows within this distance

export function bubbleTexture(text) {
  return canvasTexture(512, 150, (c, w, h) => {
    const r = 34, bw = w - 8, bh = h - 40;
    c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, w, h);
    c.fillStyle = '#fffaf0'; c.strokeStyle = '#5b3a1e'; c.lineWidth = 6;
    c.beginPath();
    c.moveTo(4 + r, 4); c.lineTo(4 + bw - r, 4); c.quadraticCurveTo(4 + bw, 4, 4 + bw, 4 + r); c.lineTo(4 + bw, 4 + bh - r);
    c.quadraticCurveTo(4 + bw, 4 + bh, 4 + bw - r, 4 + bh); c.lineTo(w / 2 + 22, 4 + bh); c.lineTo(w / 2, h - 4); c.lineTo(w / 2 - 14, 4 + bh);
    c.lineTo(4 + r, 4 + bh); c.quadraticCurveTo(4, 4 + bh, 4, 4 + bh - r); c.lineTo(4, 4 + r); c.quadraticCurveTo(4, 4, 4 + r, 4);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#3a2412'; c.textAlign = 'center'; c.textBaseline = 'middle';
    let size = 44; c.font = `bold ${size}px Arial, sans-serif`;
    while (c.measureText(text).width > bw - 40 && size > 22) { size -= 2; c.font = `bold ${size}px Arial, sans-serif`; }
    c.fillText(text, w / 2, 4 + bh / 2);
  });
}

export class FarmerNPC {
  // at: { x, y, z, yaw } — where he stands (y = floor height). opts: { colors, hat(b), lines } for other
  // shopkeepers (the Fish Market's fisherman)
  constructor(scene, at, opts = {}) {
    this.char = new Character(opts.colors || FARMER);
    const b = new GeoBuilder();
    (opts.hat || strawHat)(b);
    const hat = b.build(); hat.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.char.j.head.add(hat);
    this.root = this.char.root;
    this.root.position.set(at.x, at.y, at.z);
    this.home = at.yaw; this.yaw = at.yaw; this.root.rotation.y = at.yaw;
    scene.add(this.root);
    this.lines = opts.lines || LINES;
    this.tex = this.lines.map(bubbleTexture);
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[0], transparent: true, depthWrite: false, opacity: 0 }));
    this.bubble.scale.set(1.9, 0.56, 1);
    this.bubble.position.set(at.x, at.y + 2.35, at.z);
    this.bubble.renderOrder = 5;
    scene.add(this.bubble);
    this.line = 0; this.lineT = 0; this.near = false; this.t = 0;
  }
  get pos() { return this.root.position; }
  // p: the local player's position (or null)
  update(dt, p) {
    this.t += dt;
    const d = p ? Math.hypot(p.x - this.pos.x, p.z - this.pos.z) : Infinity;
    const near = d < NEAR && Math.abs(p.y - this.pos.y) < 3;
    if (near && !this.near) { this.line = 0; this.lineT = 0; this.bubble.material.map = this.tex[0]; }
    this.near = near;
    // the two greetings take turns while someone is near
    if (near) {
      this.lineT += dt;
      if (this.lineT > 3.5) { this.lineT = 0; this.line = (this.line + 1) % this.lines.length; this.bubble.material.map = this.tex[this.line]; }
    }
    const m = this.bubble.material;
    m.opacity = Math.max(0, Math.min(1, m.opacity + (near ? dt * 6 : -dt * 3)));
    this.bubble.visible = m.opacity > 0.01;
    this.bubble.position.y = this.pos.y + 2.35 + Math.sin(this.t * 2) * 0.03;
    // turn to the visitor (not more than ~100° from where he stands), back home when alone
    let want = this.home;
    if (near) {
      const a = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
      let diff = Math.atan2(Math.sin(a - this.home), Math.cos(a - this.home));
      diff = Math.max(-1.7, Math.min(1.7, diff));
      want = this.home + diff;
    }
    this.yaw = dampAngle(this.yaw, want, 4, dt);
    this.root.rotation.y = this.yaw;
    this.char.update(dt, { mode: 'idle', speed: 0 });
    this.char.j.spine.rotation.x += 0.12;            // a little stooped
    this.char.j.neck.rotation.x -= 0.08;
    if (near) { this.char.j.shR.rotation.x = -0.2 + Math.sin(this.t * 3) * 0.05; }   // a small wave of the hand
  }
}
