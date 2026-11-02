import * as THREE from 'three';
import { GeoBuilder, MAT } from './utils.js';

// use: what happens when you press F / click with the item in hand
// hold: how the character holds it (see Character hold poses)
export const ITEMS = {
  drone: { name: 'Drone', icon: '🚁', use: 'drone', hold: 'carry', desc: 'Fly it outside and look around through its camera.' },
  chainsaw: { name: 'Chainsaw', icon: '🪚', use: 'chop', power: 2, hold: 'saw', desc: 'Cuts fallen trees and jungle trees into logs fast. Loud!' },
  axe: { name: 'Axe', icon: '🪓', use: 'chop', power: 1, hold: 'tool', desc: 'Chop fallen trees and jungle trees for logs.' },
  sledge: { name: 'Sledgehammer', icon: '⚒️', use: 'smash', hold: 'tool', desc: 'Smash rocks blocking the trail (gives stones).' },
  hammer: { name: 'Hammer', icon: '🔨', use: 'swing', hold: 'tool', desc: 'Stakes down the tent — and repairs the RV after zombie attacks (press F next to it).' },
  rope: { name: 'Rope', icon: '🪢', use: 'info', hold: 'carry', desc: 'Guy lines — needed to pitch the tent.' },
  flashlight: { name: 'Flashlight', icon: '🔦', use: 'light', hold: 'aim', desc: 'Toggle a light beam. Great at night.' },
  binoculars: { name: 'Binoculars', icon: '🔭', use: 'zoom', hold: 'carry', desc: 'Zoom in on far-away things.' },
  tent: { name: 'Tent', icon: '⛺', use: 'deploy', hold: 'carry', desc: 'Pitch it outside (needs hammer + rope) and rest inside.' },
  chair: { name: 'Camping chair', icon: '🪑', use: 'deploy', hold: 'carry', desc: 'Unfold it anywhere outside and sit.' },
  sleepingbag: { name: 'Sleeping bag', icon: '🛌', use: 'deploy', hold: 'carry', desc: 'Roll it out and sleep under the stars.' },
  lantern: { name: 'Lantern', icon: '🏮', use: 'deploy', hold: 'carry', desc: 'Glows while carried. Place it on the ground.' },
  water: { name: 'Water bottle', icon: '💧', use: 'consume', hold: 'carry', desc: 'Drink: +25 health and a burst of energy (run faster).' },
  sandwich: { name: 'Sandwich', icon: '🥪', use: 'consume', hold: 'carry', desc: 'Eat: +25 health and a burst of energy (run faster).' },
  soda: { name: 'Soda', icon: '🥤', use: 'consume', hold: 'carry', desc: 'Sugar rush! +25 health and you run faster for a while.' },
};

export const GLOW = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffd890, emissiveIntensity: 1.3 });
const MATS = { ...MAT, glow: GLOW };
const H = Math.PI / 2;

// Drone frame shared by the item model and the flying drone (props optional)
export function droneBody(b, props = true) {
  b.box(0.16, 0.05, 0.2, 0, 0, 0, 0x2f3237);
  b.box(0.12, 0.02, 0.14, 0, 0.033, -0.01, 0x44484f);
  b.box(0.07, 0.04, 0.05, 0, -0.04, 0.08, 0x1b1c1f);
  b.box(0.03, 0.03, 0.01, 0, -0.04, 0.107, 0x3a7fd0);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * H, dx = Math.cos(a), dz = Math.sin(a);
    b.box(0.022, 0.018, 0.2, dx * 0.11, 0.005, dz * 0.11, 0x3a3d42, 'solid', 0, Math.atan2(dx, dz), 0);
    b.cyl(0.022, 0.022, 0.035, 6, dx * 0.2, 0.012, dz * 0.2, 0x1b1c1f);
    if (props) b.box(0.17, 0.005, 0.02, dx * 0.2, 0.033, dz * 0.2, 0x111214, 'solid', 0, a, 0);
  }
}

const BUILD = {
  sledge: b => {
    b.cyl(0.02, 0.024, 0.78, 6, 0, 0, 0.28, 0x8a5a2b, H, 0, 0);
    b.box(0.09, 0.22, 0.09, 0, 0.0, 0.66, 0x4a4d52);
    b.box(0.1, 0.05, 0.1, 0, 0.12, 0.66, 0x6a6e74); b.box(0.1, 0.05, 0.1, 0, -0.12, 0.66, 0x6a6e74);
  },
  hammer: b => {
    b.cyl(0.016, 0.018, 0.32, 6, 0, 0, 0.12, 0x8a5a2b, H, 0, 0);
    b.box(0.04, 0.14, 0.045, 0, 0.02, 0.29, 0x55585c);
    b.box(0.034, 0.05, 0.05, 0, -0.06, 0.29, 0x6a6e74);
  },
  axe: b => {
    b.cyl(0.017, 0.02, 0.6, 6, 0, 0, 0.2, 0x9a6a3c, H, 0, 0);
    b.box(0.025, 0.12, 0.1, 0, 0.06, 0.46, 0x8c9096);
    b.box(0.02, 0.15, 0.02, 0, 0.07, 0.515, 0xd8dce0);
  },
  chainsaw: b => {
    b.box(0.13, 0.17, 0.3, 0, 0.02, 0.17, 0xe86a1e);
    b.box(0.135, 0.06, 0.12, 0, 0.12, 0.1, 0x2b2b2b);
    b.box(0.03, 0.03, 0.14, 0, -0.04, 0.0, 0x2b2b2b);
    b.box(0.03, 0.12, 0.03, 0, 0.0, -0.06, 0x2b2b2b);
    b.box(0.16, 0.03, 0.03, 0, 0.16, 0.24, 0x2b2b2b);
    b.box(0.025, 0.07, 0.45, 0, -0.02, 0.54, 0xa9adb3);
    b.box(0.03, 0.08, 0.02, 0, -0.02, 0.765, 0x2b2b2b);
  },
  rope: b => {
    b.add(new THREE.TorusGeometry(0.1, 0.028, 4, 12), 0xc9a66b, 0, -0.13, 0, 0, H, 0);
    b.add(new THREE.TorusGeometry(0.09, 0.026, 4, 12), 0xb8945a, 0.035, -0.13, 0, 0, H, 0);
    b.box(0.07, 0.05, 0.03, 0.02, -0.03, 0, 0x8a6a3a);
  },
  flashlight: b => {
    b.cyl(0.022, 0.022, 0.16, 8, 0, -0.06, 0, 0x1e1f22);
    b.cyl(0.034, 0.024, 0.05, 8, 0, -0.165, 0, 0x2b2c30);
    b.cyl(0.03, 0.03, 0.006, 8, 0, -0.192, 0, 0xfff2c0, 0, 0, 0, 'glow');
  },
  binoculars: b => {
    for (const s of [1, -1]) {
      b.cyl(0.028, 0.03, 0.12, 8, s * 0.04, 0, 0.05, 0x26282d, H, 0, 0);
      b.cyl(0.024, 0.024, 0.006, 8, s * 0.04, 0, 0.112, 0x4a6fa0, H, 0, 0);
    }
    b.box(0.06, 0.02, 0.05, 0, 0, 0.04, 0x3a3c40);
  },
  drone: b => droneBody(b, true),
  // pump shotgun: barrel runs along the forearm (-y), top of the gun = +z
  shotgun: b => {
    b.box(0.05, 0.2, 0.075, 0, -0.03, 0.035, 0x2c2e33);                      // receiver
    b.cyl(0.018, 0.018, 0.5, 7, 0, -0.38, 0.062, 0x24262a);                  // barrel
    b.cyl(0.013, 0.013, 0.36, 6, 0, -0.32, 0.026, 0x1e2024);                 // magazine tube
    b.cyl(0.025, 0.025, 0.17, 7, 0, -0.33, 0.03, 0x6a3c1c);                  // pump
    b.box(0.048, 0.3, 0.07, 0, 0.2, 0.0, 0x7a4a26, 'solid', 0.2, 0, 0);      // stock
    b.box(0.05, 0.05, 0.085, 0, 0.36, -0.03, 0x4a2c16, 'solid', 0.2, 0, 0);  // butt pad
    b.box(0.03, 0.05, 0.05, 0, 0.03, -0.02, 0x1e2024);                       // trigger guard
    b.box(0.012, 0.015, 0.015, 0, -0.62, 0.085, 0xd8d2c0);                    // front bead
  },
  controller: b => {
    b.box(0.17, 0.03, 0.09, 0, 0.0, 0.05, 0x2a2b2e);
    for (const s of [1, -1]) b.cyl(0.008, 0.01, 0.025, 5, s * 0.05, 0.025, 0.05, 0x111111);
    b.box(0.07, 0.004, 0.04, 0, 0.017, 0.07, 0x3fd2a0);
    b.box(0.01, 0.01, 0.12, 0.06, 0.02, -0.03, 0x111111, 'solid', 0.5, 0, 0);
  },
  tent: b => {
    b.cyl(0.1, 0.1, 0.48, 8, 0, -0.14, 0, 0x3f7a3a, 0, 0, H);
    for (const x of [-0.15, 0.15]) b.cyl(0.104, 0.104, 0.03, 8, x, -0.14, 0, 0x22301f, 0, 0, H);
    b.box(0.02, 0.06, 0.02, 0, -0.03, 0, 0x22301f);
  },
  chair: b => {
    b.cyl(0.065, 0.065, 0.62, 8, 0, -0.33, 0, 0x2f5f9a);
    b.cyl(0.068, 0.068, 0.04, 8, 0, -0.04, 0, 0x1d3a60);
    b.box(0.02, 0.05, 0.02, 0, 0, 0, 0x1d3a60);
  },
  sleepingbag: b => {
    b.cyl(0.13, 0.13, 0.42, 9, 0, -0.16, 0, 0xb33a2e, 0, 0, H);
    for (const x of [-0.12, 0.12]) b.cyl(0.134, 0.134, 0.03, 9, x, -0.16, 0, 0x2a2a2a, 0, 0, H);
    b.box(0.02, 0.05, 0.02, 0, -0.02, 0, 0x2a2a2a);
  },
  lantern: b => {
    b.add(new THREE.TorusGeometry(0.045, 0.006, 3, 8, Math.PI), 0x2a2a2a, 0, -0.075, 0);
    b.cyl(0.035, 0.06, 0.04, 8, 0, -0.095, 0, 0x2e5d3a);
    b.cyl(0.045, 0.045, 0.12, 8, 0, -0.175, 0, 0xffe2a0, 0, 0, 0, 'glow');
    b.cyl(0.06, 0.065, 0.04, 8, 0, -0.255, 0, 0x2e5d3a);
  },
  water: b => { b.cyl(0.035, 0.035, 0.2, 8, 0, -0.08, 0, 0x6fb7e8); b.cyl(0.018, 0.018, 0.03, 6, 0, 0.035, 0, 0xffffff); },
  sandwich: b => {
    b.box(0.12, 0.025, 0.11, 0, -0.05, 0, 0xe0b878); b.box(0.13, 0.012, 0.12, 0, -0.033, 0, 0x6fbf4a);
    b.box(0.12, 0.025, 0.11, 0, -0.016, 0, 0xe0b878);
  },
  soda: b => { b.cyl(0.033, 0.033, 0.12, 8, 0, -0.06, 0, 0xd8463a); b.cyl(0.03, 0.03, 0.006, 8, 0, 0.003, 0, 0xb9bec4); },
  firewood: b => {
    for (const [y, z] of [[-0.1, -0.05], [-0.1, 0.05], [-0.18, 0]]) b.cyl(0.05, 0.05, 0.42, 6, 0, y, z, 0x8a5a33, 0, 0, H);
    b.cyl(0.11, 0.11, 0.025, 6, 0, -0.13, 0, 0xc9a66b, 0, 0, H);
  },
};

// Deployed (set-up) versions
const DEPLOYED = {
  tent: b => {
    const L = 2.2, Wd = 1.7, Ht = 1.25, T = Math.atan2(Ht, Wd / 2), side = Math.hypot(Ht, Wd / 2);
    b.box(Wd, 0.03, L, 0, 0.015, 0, 0x2f5a2c);
    for (const s of [1, -1]) b.box(0.04, side, L, s * Wd / 4, Ht / 2, 0, s > 0 ? 0x4c8a42 : 0x447d3b, 'solid', 0, 0, s * (Math.PI / 2 - T));
    b.add(extrudeTri(Wd, Ht), 0x3c7034, 0, 0, -L / 2 + 0.02);
    for (const s of [1, -1]) b.add(extrudeTri(Wd / 2.2, Ht * 0.92), 0x5a9a4e, s * Wd * 0.2, 0, L / 2 + 0.25, 0, -s * 0.9, 0);
    b.cyl(0.02, 0.02, L + 0.1, 5, 0, Ht, 0, 0x6a6e74, H, 0, 0);
    for (const z of [-L / 2, L / 2]) b.cyl(0.015, 0.015, Ht, 5, 0, Ht / 2, z, 0x6a6e74);
    for (const [x, z] of [[1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3]]) {
      b.box(0.01, 0.01, 1.2, x * 0.7, Ht * 0.5, z * 0.7, 0xd9d0b0, 'solid', -Math.sign(z) * 0.75, Math.atan2(x, z), 0);
      b.cyl(0.012, 0.006, 0.12, 4, x, 0.04, z, 0x8c9096);
    }
  },
  chair: b => {
    b.box(0.5, 0.04, 0.45, 0, 0.45, 0, 0x2f5f9a);
    b.box(0.5, 0.5, 0.04, 0, 0.72, -0.24, 0x2f5f9a, 'solid', -0.15, 0, 0);
    for (const s of [1, -1]) {
      b.box(0.04, 0.03, 0.42, s * 0.27, 0.62, -0.02, 0x1d3a60);
      b.cyl(0.012, 0.012, 0.66, 5, s * 0.25, 0.3, 0.12, 0x9aa0a6, 0.5, 0, 0);
      b.cyl(0.012, 0.012, 0.66, 5, s * 0.25, 0.3, -0.12, 0x9aa0a6, -0.5, 0, 0);
    }
    b.cyl(0.03, 0.03, 0.08, 6, 0.27, 0.66, 0.15, 0x7cc2e8);
  },
  sleepingbag: b => {
    b.box(0.8, 0.1, 1.9, 0, 0.05, 0.05, 0xb33a2e);
    b.box(0.82, 0.12, 0.35, 0, 0.06, -0.95, 0x8f2b22);
    b.box(0.5, 0.08, 0.3, 0, 0.13, -0.9, 0xf2efe6);
    b.box(0.04, 0.105, 1.6, 0.25, 0.055, 0.15, 0x2a2a2a);
  },
};

function extrudeTri(w, h) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
}

const cache = {};
function make(key, fn) {
  if (!cache[key]) {
    const b = new GeoBuilder(); fn(b);
    const g = b.build(MATS);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    cache[key] = g;
  }
  return cache[key].clone();
}
// Small model used in storage, in the hand and in the hotbar world
export function itemModel(type) { return make('i_' + type, BUILD[type]); }
export function deployedModel(type) { return DEPLOYED[type] ? make('d_' + type, DEPLOYED[type]) : itemModel(type); }

// Rotation used when an item sits in a storage slot (long things lie down)
export const STORE_ROT = {
  hammer: [0, H, 0], sledge: [0, H, 0], axe: [0, H, 0], chainsaw: [0, H, 0], binoculars: [0, H, 0], chair: [0, 0, H], flashlight: [0, 0, H],
};

// Fit a model into a slot: centred on x/z, bottom resting on y, scaled down to fit
const _box = new THREE.Box3(), _size = new THREE.Vector3(), _ctr = new THREE.Vector3();
export function placeInSlot(obj, x, y, z, maxW, maxH, rot) {
  obj.position.set(0, 0, 0); obj.scale.setScalar(1);
  obj.rotation.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj); _box.getSize(_size); _box.getCenter(_ctr);
  const s = Math.min(1, maxW / Math.max(_size.x, _size.z, 1e-3), maxH / Math.max(_size.y, 1e-3));
  obj.scale.setScalar(s);
  obj.position.set(x - _ctr.x * s, y - _box.min.y * s, z - _ctr.z * s);
}
