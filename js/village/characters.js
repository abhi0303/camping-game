// Sonpur's villagers: their bodies, clothes and looks. Built like the players' Character (js/character.js) —
// faceted boxes on a skeleton of hips, spine, head, shoulders, elbows, hips, knees and ankles — but all the
// villagers of one body (adults, children) are ONE instanced mesh, posed on the graphics card: every vertex
// knows its bone (aPart.x), its colour slot (aPart.y) and whether it belongs to a variant (aPart.z: a hair
// style, a hat, a tool in the hand, something carried, a piece of clothing). Each villager gets its joint
// angles (iP0..iP3, 16 numbers, js/village/animations.js), which variants it shows (iLook) and its colours
// (iCol0/iCol1, 0xRRGGBB as numbers), so 30 people cost two draw calls (and two for their shadows).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tbox } from '../character.js';

export const BONE = { HIPS: 0, SPINE: 1, HEAD: 2, SHL: 3, ELL: 4, SHR: 5, ELR: 6, HIPL: 7, KNL: 8, ANL: 9, HIPR: 10, KNR: 11, ANR: 12, SKIRT: 13, SKIRT2: 14 };
// colour slots: 0..6 per villager, 7..9 darker shades of them, 10.. fixed colours
const S_ = { skin: 0, top: 1, bottom: 2, hair: 3, shoes: 4, accent: 5, accent2: 6, skinD: 7, topD: 8, bottomD: 9, black: 10, white: 11, wood: 12, woodD: 13, metal: 14, basket: 15, clay: 16, straw: 17, green: 18, grain: 19, mouth: 20, red: 21, water: 22 };
const PALETTE = [0x1b1714, 0xf4f1ea, 0x9a6a3e, 0x5e3c22, 0x9aa0a6, 0xc49a5a, 0xb4532a, 0xd9be6a, 0x3f8a4a, 0xe8c85a, 0x8a3a32, 0xd02a2a, 0x4f86b8];
export const FLAG = { SKIRT: 0, KURTA: 1, SHORT: 2, SHORTS: 3, VEST: 4, SCARF: 5, SHAWL: 6, SARI: 7, BELLY: 8, MOUSTACHE: 9, BEARD: 10, GLASSES: 11, BINDI: 12, FROCK: 13 };
export const HAIR = { crop: 0, quiff: 1, bald: 2, braid: 3, bun: 4, pigtails: 5, spiky: 6, bob: 7, none: 8, long: 9 };
export const HAT = { none: 0, turban: 1, cap: 2, straw: 3, veil: 4, scarf: 5, ballcap: 6 };
export const ITEM = { none: 0, hoe: 1, can: 2, bucket: 3, broom: 4, axe: 5, stick: 6, cup: 7, ladle: 8, fork: 9 };
export const CARRY = { none: 0, basket: 1, pot: 2, wood: 3, bowl: 4, hay: 5, handBasket: 6 };
const V = { hair: i => 32 + i, hat: i => 64 + i, item: i => 96 + i, carry: i => 128 + i, on: f => 160 + f, off: f => 192 + f };

// skeletons: where the joints are (the adult matches the players' Character)
export const SKEL = {
  adult: { hipY: 0.94, legX: 0.095, thigh: 0.46, shin: 0.375, foot: 0.085, pelvis: 0.2, spine: 0.09, torso: 0.48, tw: 0.38, td: 0.21, shX: 0.255, shY: 0.43, upper: 0.29, fore: 0.3, neck: 0.07, headH: 0.25, headW: 0.2, headD: 0.22, limb: 1, k: 1 },
  child: { hipY: 0.62, legX: 0.07, thigh: 0.29, shin: 0.25, foot: 0.06, pelvis: 0.15, spine: 0.06, torso: 0.33, tw: 0.29, td: 0.17, shX: 0.185, shY: 0.3, upper: 0.2, fore: 0.2, neck: 0.04, headH: 0.235, headW: 0.195, headD: 0.215, limb: 0.78, k: 0.75 },
};
export function pivots(S) {
  const sp = S.hipY + S.spine, sh = sp + S.shY, el = sh - S.upper, hp = S.hipY - 0.02, kn = hp - S.thigh, an = kn - S.shin;
  return [[0, S.hipY, 0], [0, sp, 0], [0, sp + S.torso, 0], [S.shX, sh, -0.01], [S.shX, el, -0.01], [-S.shX, sh, -0.01], [-S.shX, el, -0.01],
    [S.legX, hp, 0], [S.legX, kn, 0], [S.legX, an, 0], [-S.legX, hp, 0], [-S.legX, kn, 0], [-S.legX, an, 0], [0, hp, 0], [0, kn, 0]];
}

/* ---------- building a body ---------- */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
class Parts {
  constructor() { this.list = []; this.stack = [new THREE.Matrix4()]; }
  get top() { return this.stack[this.stack.length - 1]; }
  group(x, y, z, rx, ry, rz, fn) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(1, 1, 1));
    this.stack.push(this.top.clone().multiply(_m)); fn(); this.stack.pop();
  }
  add(geo, bone, slot, v = 0, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(this.top.clone().multiply(_m));
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = bone; a[i * 3 + 1] = slot; a[i * 3 + 2] = v; }
    g.setAttribute('aPart', new THREE.BufferAttribute(a, 3));
    this.list.push(g);
    return g;
  }
  box(w, h, d, x, y, z, bone, slot, v = 0, rx = 0, ry = 0, rz = 0) { return this.add(new THREE.BoxGeometry(w, h, d), bone, slot, v, x, y, z, rx, ry, rz); }
  tb(wt, dt, wb, db, h, x, y, z, bone, slot, v = 0, rx = 0, ry = 0, rz = 0) { return this.add(tbox(wt, dt, wb, db, h), bone, slot, v, x, y, z, rx, ry, rz); }
  cyl(rt, rb, h, seg, x, y, z, bone, slot, v = 0, rx = 0, ry = 0, rz = 0) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), bone, slot, v, x, y, z, rx, ry, rz); }
  ico(r, x, y, z, bone, slot, v = 0, sx = 1, sy = 1, sz = 1) { return this.add(new THREE.IcosahedronGeometry(r, 0), bone, slot, v, x, y, z, 0, 0, 0, sx, sy, sz); }
  dode(r, x, y, z, bone, slot, v = 0, sx = 1, sy = 1, sz = 1) { return this.add(new THREE.DodecahedronGeometry(r, 0), bone, slot, v, x, y, z, 0, 0, 0, sx, sy, sz); }
  build() { const g = mergeGeometries(this.list); g.computeBoundingSphere(); return g; }
}

function buildBody(S) {
  const B = new Parts(), L = S.limb, k = S.k, P = pivots(S), { HIPS, SPINE, HEAD, SKIRT, SKIRT2 } = BONE;
  const sy = P[1][1], th = S.torso, hp = P[13][1], kn = P[14][1];
  /* hips and legs */
  B.tb(S.tw * 0.87, S.td, S.tw * 0.9, S.td * 0.95, S.pelvis, 0, S.hipY, 0, HIPS, S_.bottom);
  B.box(S.tw * 0.91, 0.035 * L, S.td * 1.03, 0, S.hipY + S.pelvis * 0.42, 0, HIPS, S_.accent2);
  for (const s of [1, -1]) {
    const [hb, kb, ab] = s > 0 ? [7, 8, 9] : [10, 11, 12], x = s * S.legX, T = S.thigh, Sh = S.shin;
    B.tb(0.17 * L, 0.19 * L, 0.16 * L, 0.175 * L, T * 0.62, x, hp - T * 0.31, 0, hb, S_.bottom);
    B.tb(0.16 * L, 0.175 * L, 0.15 * L, 0.165 * L, T * 0.42, x, hp - T * 0.8, 0, hb, S_.bottom, V.off(FLAG.SHORTS));
    B.tb(0.13 * L, 0.15 * L, 0.12 * L, 0.14 * L, T * 0.42, x, hp - T * 0.8, 0, hb, S_.skin, V.on(FLAG.SHORTS));
    B.tb(0.15 * L, 0.165 * L, 0.13 * L, 0.145 * L, Sh * 0.94, x, kn - Sh * 0.47, 0, kb, S_.bottomD, V.off(FLAG.SHORTS));
    B.tb(0.12 * L, 0.13 * L, 0.105 * L, 0.115 * L, Sh * 0.94, x, kn - Sh * 0.47, 0, kb, S_.skin, V.on(FLAG.SHORTS));
    B.box(0.13 * L, 0.075 * L, 0.25 * L, x, S.foot * 0.55, 0.045 * L, ab, S_.shoes);
    B.box(0.135 * L, 0.025 * L, 0.265 * L, x, 0.0125, 0.048 * L, ab, S_.woodD);
  }
  /* torso and clothes */
  B.tb(S.tw, S.td, S.tw * 0.84, S.td * 0.92, th, 0, sy + th / 2, 0, SPINE, S_.top);
  for (const s of [1, -1]) B.box(0.1 * L, 0.07 * L, S.td * 0.95, s * (S.tw / 2 - 0.02), sy + th - 0.03, 0, SPINE, S_.top);
  B.box(0.12 * L, 0.05 * L, 0.02, 0, sy + th - 0.035, S.td / 2 + 0.002, SPINE, S_.skin);                          // neckline
  B.box(0.024 * L, th * 0.42, 0.012, 0, sy + th * 0.68, S.td / 2 + 0.005, SPINE, S_.topD, V.off(FLAG.SARI));        // placket
  for (let i = 0; i < 3; i++) B.box(0.014, 0.014, 0.01, 0, sy + th * (0.55 + i * 0.12), S.td / 2 + 0.011, SPINE, S_.white, V.on(FLAG.KURTA));
  B.ico(1, 0, sy + th * 0.3, S.td * 0.3, SPINE, S_.top, V.on(FLAG.BELLY), S.tw * 0.44, th * 0.32, S.td * 0.42);
  // a kurta's long tails, a long skirt (in two parts that fold like the legs) with a border, a child's frock
  B.tb(S.tw * 0.95, S.td * 1.08, S.tw * 1.14, S.td * 1.22, T_(S) * 0.75, 0, hp - T_(S) * 0.33, 0, SKIRT, S_.top, V.on(FLAG.KURTA));
  B.tb(S.tw * 0.94, S.td * 1.0, S.tw * 1.06, S.td * 1.08, hp - kn + 0.08, 0, (hp + kn) / 2 + 0.04, 0, SKIRT, S_.bottom, V.on(FLAG.SKIRT));
  B.tb(S.tw * 1.06, S.td * 1.08, S.tw * 1.2, S.td * 1.3, kn - 0.07, 0, (kn + 0.07) / 2 + 0.005, 0, SKIRT2, S_.bottom, V.on(FLAG.SKIRT));
  B.tb(S.tw * 1.21, S.td * 1.31, S.tw * 1.22, S.td * 1.32, 0.045, 0, 0.09, 0, SKIRT2, S_.accent2, V.on(FLAG.SKIRT));
  B.tb(S.tw * 0.96, S.td * 1.1, S.tw * 1.4, S.td * 1.5, (hp - kn) * 0.86, 0, hp - (hp - kn) * 0.4, 0, SKIRT, S_.top, V.on(FLAG.FROCK));
  B.tb(S.tw * 1.41, S.td * 1.51, S.tw * 1.42, S.td * 1.52, 0.03, 0, hp - (hp - kn) * 0.82, 0, SKIRT, S_.white, V.on(FLAG.FROCK));
  // a sari's pallu: across the chest to the left shoulder and down the back, with its border
  B.box(0.14 * L, th * 1.18, 0.03, 0.015, sy + th * 0.52, S.td / 2 + 0.014, SPINE, S_.bottom, V.on(FLAG.SARI), 0, 0, -0.5);
  B.box(0.03 * L, th * 1.18, 0.034, 0.075, sy + th * 0.5, S.td / 2 + 0.016, SPINE, S_.accent2, V.on(FLAG.SARI), 0, 0, -0.5);
  B.box(0.17 * L, th * 1.35, 0.03, S.tw * 0.26, sy + th * 0.36, -S.td / 2 - 0.014, SPINE, S_.bottom, V.on(FLAG.SARI), 0, 0, 0.12);
  B.box(0.13 * L, 0.03, S.td + 0.05, S.tw * 0.3, sy + th + 0.004, 0, SPINE, S_.bottom, V.on(FLAG.SARI));
  // a sleeveless vest, open at the front
  B.tb(S.tw * 1.06, S.td * 0.55, S.tw * 0.9, S.td * 0.5, th * 0.9, 0, sy + th * 0.54, -S.td * 0.24, SPINE, S_.accent, V.on(FLAG.VEST));
  for (const s of [1, -1]) B.tb(0.11 * L, S.td * 0.55, 0.1 * L, S.td * 0.5, th * 0.9, s * S.tw * 0.37, sy + th * 0.54, S.td * 0.24, SPINE, S_.accent, V.on(FLAG.VEST));
  // a gamchha / dupatta over the left shoulder
  B.box(0.1 * L, th * 0.75, 0.025, S.tw * 0.3, sy + th * 0.6, S.td / 2 + 0.013, SPINE, S_.accent2, V.on(FLAG.SCARF));
  B.box(0.1 * L, th * 0.8, 0.025, S.tw * 0.3, sy + th * 0.58, -S.td / 2 - 0.013, SPINE, S_.accent2, V.on(FLAG.SCARF));
  B.box(0.11 * L, 0.03, S.td + 0.05, S.tw * 0.3, sy + th + 0.006, 0, SPINE, S_.accent2, V.on(FLAG.SCARF));
  // an old person's shawl round the shoulders
  B.tb(S.tw * 1.14, S.td * 1.3, S.tw * 1.22, S.td * 1.34, th * 0.44, 0, sy + th * 0.79, 0, SPINE, S_.accent, V.on(FLAG.SHAWL));
  for (const s of [1, -1]) B.box(0.05 * L, th * 0.26, 0.025, s * S.tw * 0.26, sy + th * 0.52, S.td / 2 + 0.03, SPINE, S_.accent, V.on(FLAG.SHAWL));
  /* neck and head */
  const hy = P[2][1] + S.neck + S.headH / 2, hw = S.headW, hd = S.headD, Ht = hy + S.headH / 2;
  B.cyl(0.055 * L, 0.06 * L, S.neck + 0.06, 6, 0, P[2][1] + S.neck * 0.4, 0, HEAD, S_.skin);
  B.tb(hw, hd, hw * 0.95, hd * 0.92, S.headH, 0, hy, 0, HEAD, S_.skin);
  for (const s of [1, -1]) {
    B.box(0.03, 0.06, 0.045, s * (hw / 2 + 0.006), hy, -0.01, HEAD, S_.skinD);                               // ear
    B.box(0.03, 0.032, 0.012, s * hw * 0.23, hy + 0.024, hd / 2 + 0.002, HEAD, S_.black);                   // eye
    B.box(0.012, 0.012, 0.006, s * hw * 0.23 + s * 0.006, hy + 0.03, hd / 2 + 0.009, HEAD, S_.white);       // a glint
    B.box(0.046, 0.012, 0.012, s * hw * 0.23, hy + 0.058, hd / 2 + 0.003, HEAD, S_.hair);                  // eyebrow
    B.box(0.06, 0.042, 0.008, s * hw * 0.23, hy + 0.024, hd / 2 + 0.012, HEAD, S_.black, V.on(FLAG.GLASSES)); // glasses
    B.box(0.008, 0.012, 0.12, s * (hw / 2 + 0.004), hy + 0.035, hd * 0.2, HEAD, S_.black, V.on(FLAG.GLASSES));
  }
  B.box(0.03, 0.01, 0.01, 0, hy + 0.03, hd / 2 + 0.014, HEAD, S_.black, V.on(FLAG.GLASSES));
  B.box(0.03, 0.05, 0.036, 0, hy - 0.006, hd / 2 + 0.012, HEAD, S_.skinD);                                    // nose
  B.box(0.06, 0.013, 0.01, 0, hy - 0.06, hd / 2 + 0.002, HEAD, S_.mouth);                                      // mouth
  B.box(0.095, 0.024, 0.022, 0, hy - 0.038, hd / 2 + 0.009, HEAD, S_.hair, V.on(FLAG.MOUSTACHE));
  B.box(hw * 1.03, 0.075, 0.05, 0, hy - 0.088, hd / 2 - 0.016, HEAD, S_.hair, V.on(FLAG.BEARD));
  for (const s of [1, -1]) B.box(0.022, 0.1, hd * 0.55, s * (hw / 2 + 0.004), hy - 0.04, hd * 0.12, HEAD, S_.hair, V.on(FLAG.BEARD));
  B.box(0.017, 0.017, 0.006, 0, hy + 0.074, hd / 2 + 0.004, HEAD, S_.red, V.on(FLAG.BINDI));
  hairStyles(B, hy, Ht, hw, hd, HEAD);
  hats(B, Ht, hw, hd, HEAD, k);
  /* arms */
  for (const s of [1, -1]) {
    const [sb, eb] = s > 0 ? [3, 4] : [5, 6], x = s * S.shX, shy = P[3][1], ely = P[4][1], up = S.upper, fo = S.fore;
    B.tb(0.125 * L, 0.125 * L, 0.105 * L, 0.11 * L, up * 0.98, x, shy - up * 0.47, 0, sb, S_.top, V.off(FLAG.SHORT));
    B.tb(0.13 * L, 0.13 * L, 0.12 * L, 0.122 * L, up * 0.42, x, shy - up * 0.19, 0, sb, S_.top, V.on(FLAG.SHORT));
    B.tb(0.1 * L, 0.1 * L, 0.09 * L, 0.09 * L, up * 0.64, x, shy - up * 0.67, 0, sb, S_.skin, V.on(FLAG.SHORT));
    B.tb(0.11 * L, 0.112 * L, 0.1 * L, 0.102 * L, fo * 0.28, x, ely - fo * 0.12, 0, eb, S_.top, V.off(FLAG.SHORT));
    B.tb(0.085 * L, 0.085 * L, 0.07 * L, 0.07 * L, fo * 0.74, x, ely - fo * 0.5, 0, eb, S_.skin);
    B.box(0.09 * L, 0.022, 0.085 * L, x, ely - fo * 0.82, 0, eb, S_.accent2, V.on(FLAG.BINDI));                 // bangles
    B.box(0.075 * L, 0.095 * L, 0.06 * L, x, ely - fo - 0.01, 0.005, eb, S_.skin);                              // hand
    B.box(0.028 * L, 0.05 * L, 0.03 * L, x - s * 0.044 * L, ely - fo, 0.03 * L, eb, S_.skin);                   // thumb
  }
  items(B, S, P, k, Ht);
  return B.build();
}
const T_ = S => S.thigh;

function hairStyles(B, hy, Ht, hw, hd, HEAD) {
  const H = S_.hair;
  const top = i => B.box(hw + 0.016, 0.055, hd + 0.016, 0, Ht + 0.006, -0.004, HEAD, H, V.hair(i));
  const back = (i, h = 0.15) => B.box(hw + 0.016, h, 0.04, 0, Ht - h / 2 + 0.002, -hd / 2 - 0.006, HEAD, H, V.hair(i));
  const sides = (i, h = 0.085, z = 0.6) => { for (const s of [1, -1]) B.box(0.022, h, hd * z, s * (hw / 2 + 0.006), Ht - h / 2 - 0.008, -hd * 0.18, HEAD, H, V.hair(i)); };
  // 0 short crop
  top(0); back(0); sides(0);
  // 1 a raised front
  top(1); back(1); sides(1); B.box(hw * 0.8, 0.05, 0.08, 0, Ht + 0.035, hd * 0.28, HEAD, H, V.hair(1), -0.25, 0, 0);
  // 2 bald on top, a fringe round the back and sides
  B.box(hw + 0.012, 0.09, 0.04, 0, Ht - 0.1, -hd / 2 - 0.006, HEAD, H, V.hair(2));
  for (const s of [1, -1]) B.box(0.02, 0.07, hd * 0.55, s * (hw / 2 + 0.005), Ht - 0.085, -hd * 0.15, HEAD, H, V.hair(2));
  // 3 a long plait down the back
  top(3); back(3, 0.2); sides(3, 0.11);
  for (let i = 0; i < 4; i++) B.box(0.055 - i * 0.004, 0.1, 0.05, 0, Ht - 0.24 - i * 0.095, -hd / 2 - 0.035 + i * 0.004, HEAD, H, V.hair(3));
  B.box(0.04, 0.03, 0.04, 0, Ht - 0.59, -hd / 2 - 0.022, HEAD, S_.accent, V.hair(3));
  // 4 a bun
  top(4); back(4, 0.17); sides(4, 0.1); B.dode(0.066, 0, Ht - 0.05, -hd / 2 - 0.05, HEAD, H, V.hair(4));
  // 5 two pigtails with ribbons
  top(5); back(5); sides(5);
  for (const s of [1, -1]) { B.box(0.045, 0.14, 0.045, s * (hw / 2 + 0.035), Ht - 0.14, -hd * 0.25, HEAD, H, V.hair(5), 0, 0, s * 0.2); B.box(0.05, 0.03, 0.05, s * (hw / 2 + 0.028), Ht - 0.07, -hd * 0.25, HEAD, S_.accent, V.hair(5)); }
  // 6 spiky
  back(6, 0.12); sides(6, 0.07); B.box(hw + 0.012, 0.04, hd + 0.012, 0, Ht + 0.0, -0.004, HEAD, H, V.hair(6));
  for (const [x, z] of [[0, 0.05], [-0.05, 0], [0.05, 0], [0, -0.05], [-0.04, -0.07], [0.04, -0.07]]) B.add(new THREE.ConeGeometry(0.032, 0.075, 4), HEAD, H, V.hair(6), x, Ht + 0.05, z, -z * 2, 0, x * 3);
  // 7 a bob with a fringe
  top(7); back(7, 0.19);
  for (const s of [1, -1]) B.box(0.024, 0.17, hd * 0.86, s * (hw / 2 + 0.008), Ht - 0.09, -hd * 0.05, HEAD, H, V.hair(7));
  B.box(hw * 0.92, 0.035, 0.03, 0, Ht - 0.026, hd / 2 + 0.006, HEAD, H, V.hair(7));
  // 9 long, open
  top(9); B.box(hw + 0.024, 0.36, 0.045, 0, Ht - 0.17, -hd / 2 - 0.01, HEAD, H, V.hair(9));
  for (const s of [1, -1]) B.box(0.024, 0.22, hd * 0.5, s * (hw / 2 + 0.008), Ht - 0.11, -hd * 0.22, HEAD, H, V.hair(9));
}

function hats(B, Ht, hw, hd, HEAD, k) {
  const A = S_.accent;
  // 1 a turban (pagri)
  B.cyl(hw * 0.6, hw * 0.63, 0.12, 8, 0, Ht + 0.035, -0.005, HEAD, A, V.hat(1));
  B.cyl(hw * 0.67, hw * 0.67, 0.04, 8, 0, Ht - 0.008, -0.005, HEAD, A, V.hat(1));
  B.box(hw * 0.95, 0.035, 0.05, 0, Ht + 0.04, hd * 0.38, HEAD, S_.accent2, V.hat(1), 0.2, 0, 0.35);
  B.box(0.06, 0.2, 0.025, 0.03, Ht - 0.1, -hd * 0.6, HEAD, A, V.hat(1), 0.1, 0, 0);
  // 2 a white cap (topi)
  B.tb(0.05, hd * 1.02, hw * 0.96, hd * 1.04, 0.075, 0, Ht + 0.022, 0, HEAD, S_.white, V.hat(2));
  // 3 a straw hat with a band
  B.cyl(0.26 * k + 0.02, 0.27 * k + 0.02, 0.02, 12, 0, Ht - 0.004, -0.004, HEAD, S_.straw, V.hat(3));
  B.cyl(0.115 * k + 0.02, 0.13 * k + 0.02, 0.13, 10, 0, Ht + 0.06, -0.004, HEAD, S_.straw, V.hat(3));
  B.cyl(0.133 * k + 0.021, 0.133 * k + 0.021, 0.032, 10, 0, Ht + 0.012, -0.004, HEAD, A, V.hat(3));
  // 4 a veil (dupatta over the head), with a border
  B.box(hw + 0.05, 0.03, hd + 0.05, 0, Ht + 0.012, -0.01, HEAD, A, V.hat(4));
  B.box(hw + 0.07, 0.34, 0.03, 0, Ht - 0.16, -hd / 2 - 0.022, HEAD, A, V.hat(4));
  for (const s of [1, -1]) B.box(0.026, 0.26, hd * 0.78, s * (hw / 2 + 0.026), Ht - 0.12, -hd * 0.08, HEAD, A, V.hat(4));
  B.box(hw + 0.054, 0.018, 0.02, 0, Ht + 0.004, hd / 2 + 0.018, HEAD, S_.accent2, V.hat(4));
  // 5 a headscarf tied at the back
  B.box(hw + 0.03, 0.05, hd + 0.03, 0, Ht + 0.008, -0.006, HEAD, A, V.hat(5));
  B.box(hw + 0.03, 0.12, 0.035, 0, Ht - 0.05, -hd / 2 - 0.012, HEAD, A, V.hat(5));
  B.box(0.06, 0.05, 0.04, 0, Ht - 0.03, -hd / 2 - 0.04, HEAD, A, V.hat(5));
  // 6 a cap with a peak
  B.tb(hw * 0.9, hd * 0.9, hw + 0.02, hd + 0.02, 0.07, 0, Ht + 0.012, 0, HEAD, A, V.hat(6));
  B.box(hw * 0.86, 0.016, 0.09, 0, Ht - 0.012, hd / 2 + 0.04, HEAD, A, V.hat(6));
}

// tools in the right hand, things carried on the head, the shoulder or in the left hand
function items(B, S, P, k, Ht) {
  const R = [-S.shX, P[6][1] - S.fore - 0.01, 0.005], Lh = [S.shX, P[4][1] - S.fore - 0.01, 0.005], ER = BONE.ELR, EL = BONE.ELL;
  const it = i => V.item(i), ca = i => V.carry(i), [hx, hy, hz] = R, X = Math.PI / 2;
  // 1 hoe (handle along the hand's forward axis, blade down at the far end)
  B.cyl(0.018, 0.02, 1.3 * k, 6, hx, hy, hz + 0.3 * k, ER, S_.wood, it(1), X);
  B.box(0.17 * k, 0.17 * k, 0.025, hx, hy - 0.08 * k, hz + 0.93 * k, ER, S_.metal, it(1), 0.25);
  // 2 watering can
  B.cyl(0.1 * k, 0.11 * k, 0.2 * k, 8, hx, hy - 0.2 * k, hz + 0.02, ER, S_.green, it(2));
  B.box(0.03, 0.03, 0.2 * k, hx, hy - 0.02, hz, ER, S_.green, it(2));
  B.cyl(0.015, 0.02, 0.28 * k, 5, hx, hy - 0.15 * k, hz + 0.2 * k, ER, S_.green, it(2), 0.9);
  B.cyl(0.04 * k, 0.025, 0.04, 6, hx, hy - 0.06 * k, hz + 0.31 * k, ER, S_.green, it(2), 0.9);
  // 3 bucket with water
  B.cyl(0.12 * k, 0.1 * k, 0.22 * k, 8, hx, hy - 0.28 * k, hz, ER, S_.metal, it(3));
  B.cyl(0.125 * k, 0.125 * k, 0.02, 8, hx, hy - 0.17 * k, hz, ER, S_.metal, it(3));
  B.cyl(0.11 * k, 0.11 * k, 0.01, 8, hx, hy - 0.2 * k, hz, ER, S_.water, it(3));
  for (const s of [1, -1]) B.box(0.012, 0.15 * k, 0.012, hx + s * 0.06 * k, hy - 0.08 * k, hz, ER, S_.woodD, it(3), 0, 0, s * 0.5);
  // 4 a short broom (jhadu)
  B.cyl(0.026, 0.022, 0.16, 6, hx, hy - 0.06, hz + 0.01, ER, S_.accent2, it(4));
  B.tb(0.05, 0.05, 0.13 * k + 0.02, 0.06, 0.44 * k, hx, hy - 0.36 * k, hz + 0.04, ER, S_.straw, it(4), 0.12);
  // 5 axe
  B.cyl(0.017, 0.02, 0.8 * k, 6, hx, hy, hz + 0.2 * k, ER, S_.wood, it(5), X);
  B.box(0.035, 0.14 * k, 0.13 * k, hx, hy - 0.05 * k, hz + 0.56 * k, ER, S_.metal, it(5));
  // 6 walking stick
  B.cyl(0.018, 0.021, hy + 0.05, 6, hx, hy / 2 - 0.02, hz + 0.04, ER, S_.woodD, it(6), -0.05);
  B.box(0.036, 0.036, 0.11, hx, hy + 0.03, hz + 0.03, ER, S_.woodD, it(6));
  // 7 a glass of tea
  B.cyl(0.028, 0.024, 0.075, 7, hx, hy - 0.01, hz + 0.045, ER, S_.metal, it(7));
  // 8 a ladle
  B.cyl(0.012, 0.012, 0.5 * k, 5, hx, hy - 0.22 * k, hz + 0.02, ER, S_.woodD, it(8));
  B.cyl(0.045, 0.03, 0.035, 7, hx, hy - 0.47 * k, hz + 0.02, ER, S_.metal, it(8));
  // 9 pitchfork
  B.cyl(0.018, 0.02, 1.3 * k, 6, hx, hy, hz + 0.3 * k, ER, S_.wood, it(9), X);
  B.box(0.16 * k, 0.025, 0.025, hx, hy, hz + 0.95 * k, ER, S_.metal, it(9));
  for (const s of [-1, 0, 1]) B.cyl(0.008, 0.005, 0.24 * k, 4, hx + s * 0.065 * k, hy, hz + 1.07 * k, ER, S_.metal, it(9), X);
  /* carried */
  // 1 basket of vegetables on the head
  B.cyl(0.085 * k, 0.085 * k, 0.025, 8, 0, Ht + 0.012, 0, BONE.HEAD, S_.accent, ca(1));
  B.cyl(0.2 * k, 0.15 * k, 0.13 * k, 10, 0, Ht + 0.024 + 0.065 * k, 0, BONE.HEAD, S_.basket, ca(1));
  B.cyl(0.205 * k, 0.205 * k, 0.025, 10, 0, Ht + 0.024 + 0.13 * k, 0, BONE.HEAD, S_.woodD, ca(1));
  for (const [x, z, c] of [[0.06, 0.04, S_.red], [-0.07, 0.03, S_.green], [0.0, -0.08, S_.grain], [-0.03, 0.1, S_.red], [0.09, -0.06, S_.green]]) B.ico(0.055 * k, x * k, Ht + 0.03 + 0.14 * k, z * k, BONE.HEAD, c, ca(1));
  // 2 a clay water pot on the head
  B.cyl(0.085 * k, 0.085 * k, 0.025, 8, 0, Ht + 0.012, 0, BONE.HEAD, S_.accent, ca(2));
  B.dode(0.15 * k, 0, Ht + 0.03 + 0.13 * k, 0, BONE.HEAD, S_.clay, ca(2), 1, 0.9, 1);
  B.cyl(0.06 * k, 0.08 * k, 0.07 * k, 8, 0, Ht + 0.03 + 0.27 * k, 0, BONE.HEAD, S_.clay, ca(2));
  B.cyl(0.08 * k, 0.08 * k, 0.025, 8, 0, Ht + 0.03 + 0.31 * k, 0, BONE.HEAD, S_.clay, ca(2));
  // 3 a bundle of firewood on the right shoulder
  const wy = P[5][1] + 0.1 * k, wx = -S.shX * 0.72;
  for (const [dx, dy, c] of [[0, 0, S_.wood], [0.06, 0.02, S_.woodD], [-0.06, 0.02, S_.woodD], [0.03, 0.07, S_.wood], [-0.03, 0.07, S_.wood]]) B.cyl(0.034 * k, 0.034 * k, 0.95 * k, 5, wx + dx * k, wy + dy * k, 0.05, BONE.SPINE, c, ca(3), X);
  for (const z of [-0.25, 0.3]) B.box(0.17 * k, 0.12 * k, 0.03, wx, wy + 0.03 * k, z * k, BONE.SPINE, S_.accent2, ca(3));
  // 4 a bowl of grain in the left hand
  B.cyl(0.1 * k, 0.065 * k, 0.06 * k, 8, Lh[0], Lh[1] - 0.02, Lh[2] + 0.05 * k, EL, S_.clay, ca(4), X);
  B.cyl(0.088 * k, 0.088 * k, 0.01, 8, Lh[0], Lh[1] - 0.02, Lh[2] + 0.075 * k, EL, S_.grain, ca(4), X);
  // 5 a bundle of hay on the head
  B.box(0.52 * k, 0.16 * k, 0.32 * k, 0, Ht + 0.09 * k, 0, BONE.HEAD, S_.straw, ca(5), 0, 0.2, 0);
  B.box(0.4 * k, 0.1 * k, 0.26 * k, 0, Ht + 0.2 * k, 0, BONE.HEAD, S_.straw, ca(5), 0, -0.3, 0.1);
  // 6 a small basket in the left hand
  B.cyl(0.13 * k, 0.1 * k, 0.14 * k, 8, Lh[0], Lh[1] - 0.22 * k, Lh[2], EL, S_.basket, ca(6));
  for (const s of [1, -1]) B.box(0.012, 0.15 * k, 0.012, Lh[0] + s * 0.07 * k, Lh[1] - 0.09 * k, Lh[2], EL, S_.woodD, ca(6), 0, 0, s * 0.45);
  for (const [x, z, c] of [[0.04, 0.03, S_.red], [-0.04, -0.02, S_.green], [0, 0.0, S_.grain]]) B.ico(0.045 * k, Lh[0] + x * k, Lh[1] - 0.14 * k, Lh[2] + z * k, EL, c, ca(6));
}

/* ---------- the shader ---------- */
const GLSL = `
attribute vec3 aPart; attribute vec4 iP0; attribute vec4 iP1; attribute vec4 iP2; attribute vec4 iP3; attribute vec4 iLook; attribute vec4 iCol0; attribute vec4 iCol1;
uniform vec3 uPiv[15]; uniform vec3 uPal[13];
mat3 nRX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 nRY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 nRZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
vec3 nJ(vec3 p, vec3 o, mat3 R) { return R * (p - o) + o; }
bool nFlag(float f) { return mod(floor(iCol1.w / exp2(f) + 0.001), 2.0) > 0.5; }
void npcPose(inout vec3 p) {
  float v = aPart.z;
  if (v > 0.5) {
    float g = floor(v / 32.0 + 0.001), i = v - g * 32.0; bool show;
    if (g < 1.5) show = abs(iLook.x - i) < 0.5;
    else if (g < 2.5) show = abs(iLook.y - i) < 0.5;
    else if (g < 3.5) show = abs(iLook.z - i) < 0.5;
    else if (g < 4.5) show = abs(iLook.w - i) < 0.5;
    else if (g < 5.5) show = nFlag(i);
    else show = !nFlag(i);
    if (!show) { p = vec3(0.0); return; }
  }
  int b = int(aPart.x + 0.5);
  if (b == 9 || b == 12) { float hx = b == 9 ? iP3.x : iP3.z, kn = b == 9 ? iP3.y : iP3.w; p = nJ(p, uPiv[b], nRX(-(hx + kn) * 0.6)); b -= 1; }
  if (b == 8 || b == 11) { p = nJ(p, uPiv[b], nRX(b == 8 ? iP3.y : iP3.w)); b -= 1; }
  if (b == 7 || b == 10) { p = nJ(p, uPiv[b], nRX(b == 7 ? iP3.x : iP3.z) * nRZ(b == 7 ? iP2.w : -iP2.w)); b = 0; }
  if (b == 14) { p = nJ(p, uPiv[14], nRX((iP3.y + iP3.w) * 0.5)); b = 13; }
  if (b == 13) { p = nJ(p, uPiv[13], nRX((iP3.x + iP3.z) * 0.5)); b = 0; }
  if (b == 4 || b == 6) { p = nJ(p, uPiv[b], nRX(b == 4 ? iP1.w : iP2.z)); b -= 1; }
  if (b == 3 || b == 5) { p = nJ(p, uPiv[b], b == 3 ? nRX(iP1.y) * nRZ(iP1.z) : nRX(iP2.x) * nRZ(iP2.y)); b = 1; }
  if (b == 2) { p = nJ(p, uPiv[2], nRY(iP1.x) * nRX(iP0.w)); b = 1; }
  if (b == 1) p = nJ(p, uPiv[1], nRX(iP0.y) * nRY(iP0.z));
  p.y += iP0.x;
}
vec3 nUnpack(float c) {
  float r = floor(c / 65536.0 + 0.0001), g = floor((c - r * 65536.0) / 256.0 + 0.0001), b = c - r * 65536.0 - g * 256.0;
  vec3 s = vec3(r, g, b) / 255.0;
  return mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), step(0.04045, s));
}
vec3 npcColor() {
  float s = aPart.y;
  if (s < 0.5) return nUnpack(iCol0.x);
  if (s < 1.5) return nUnpack(iCol0.y);
  if (s < 2.5) return nUnpack(iCol0.z);
  if (s < 3.5) return nUnpack(iCol0.w);
  if (s < 4.5) return nUnpack(iCol1.x);
  if (s < 5.5) return nUnpack(iCol1.y);
  if (s < 6.5) return nUnpack(iCol1.z);
  if (s < 7.5) return nUnpack(iCol0.x) * 0.8;
  if (s < 8.5) return nUnpack(iCol0.y) * 0.78;
  if (s < 9.5) return nUnpack(iCol0.z) * 0.82;
  return uPal[int(s + 0.5) - 10];
}`;
function npcShader(mat, piv, key, color) {
  const pal = PALETTE.map(h => new THREE.Color(h));
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPiv = { value: piv.map(p => new THREE.Vector3(...p)) };
    sh.uniforms.uPal = { value: pal };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  npcPose(transformed);');
    if (color) sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#if defined( USE_COLOR )\n  vColor = npcColor();\n#endif');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/* ---------- the crowd: one instanced mesh per body ---------- */
const ATTRS = [['iP0', 4], ['iP1', 4], ['iP2', 4], ['iP3', 4], ['iLook', 4], ['iCol0', 4], ['iCol1', 4]];
export class Crowd {
  // counts: { adult: n, child: m }
  constructor(scene, counts, onAdd = o => scene.add(o)) {
    this.meshes = {};
    for (const kind of ['adult', 'child']) {
      const n = Math.max(1, counts[kind] || 0), geo = buildBody(SKEL[kind]), piv = pivots(SKEL[kind]);
      for (const [name, size] of ATTRS) { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); }
      const mat = npcShader(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), piv, 'villager-v1', true);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.customDepthMaterial = npcShader(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), piv, 'villager-depth-v1', false);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, ZERO);
      onAdd(mesh);
      this.meshes[kind] = mesh;
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }
  look(kind, i, L) {
    const g = this.meshes[kind].geometry;
    g.attributes.iLook.setXYZW(i, L.hair, L.hat, 0, 0);
    g.attributes.iCol0.setXYZW(i, L.skin, L.top, L.bottom, L.hairCol);
    g.attributes.iCol1.setXYZW(i, L.shoes, L.accent, L.accent2, L.flags);
    for (const a of ['iLook', 'iCol0', 'iCol1']) g.attributes[a].needsUpdate = true;
  }
  // pose: Float32Array(16) (animations.js) · item: ITEM in the right hand · carry: CARRY
  set(kind, i, x, y, z, yaw, sx, sy, pose, item, carry, hat) {
    const m = this.meshes[kind], g = m.geometry;
    m.setMatrixAt(i, this._m.compose(this._p.set(x, y, z), this._q.setFromAxisAngle(this._up, yaw), this._s.set(sx, sy, sx)));
    g.attributes.iP0.setXYZW(i, pose[0], pose[1], pose[2], pose[3]);
    g.attributes.iP1.setXYZW(i, pose[4], pose[5], pose[6], pose[7]);
    g.attributes.iP2.setXYZW(i, pose[8], pose[9], pose[10], pose[11]);
    g.attributes.iP3.setXYZW(i, pose[12], pose[13], pose[14], pose[15]);
    const L = g.attributes.iLook;
    if (L.getZ(i) !== item || L.getW(i) !== carry || L.getY(i) !== hat) { L.setY(i, hat); L.setZ(i, item); L.setW(i, carry); L.needsUpdate = true; }
  }
  hide(kind, i) { this.meshes[kind].setMatrixAt(i, ZERO); }
  commit() {
    for (const m of Object.values(this.meshes)) {
      m.instanceMatrix.needsUpdate = true;
      for (const a of ['iP0', 'iP1', 'iP2', 'iP3']) m.geometry.attributes[a].needsUpdate = true;
    }
  }
  setVisible(v) { for (const m of Object.values(this.meshes)) m.visible = v; }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/* ---------- looks: who wears what ---------- */
const SKIN = [0x8d5a3b, 0x9c6644, 0xa86f4a, 0xb57a52, 0xc28860, 0x7a4a30, 0xc99468, 0xa0684a];
const HAIR_DARK = [0x1c1612, 0x241a14, 0x2e2018, 0x16110e, 0x3a2a1e];
const HAIR_GREY = [0xd8d4cc, 0xbfbab0, 0xe8e6e0, 0x9a968e];
const MEN_TOP = [0xf2efe6, 0xe8dcc0, 0x9cc0d8, 0xb8cc9a, 0xd8c28a, 0x8a6a4a, 0x6e8aa8, 0xc0563a, 0x5a7a4a, 0xe6d6b0];
const MEN_BOTTOM = [0xf4f1e8, 0x6b4a2e, 0x4a4e58, 0x2f4a6e, 0x8a7a5a, 0x3a3a3a, 0xece4d0];
const SARI = [0xd23a5a, 0xe0662a, 0xc8283a, 0x3a8a4a, 0xe8b830, 0x2a6ab0, 0x8a3ab0, 0x2aa0a0, 0xf08aa0, 0xd8582a];
const BLOUSE = [0x2a6ab0, 0xe8b830, 0x3a8a4a, 0xc8283a, 0x8a3ab0, 0xf2efe6, 0xe0662a];
const ACCENT = [0xe8a020, 0xd03020, 0xf0e8d0, 0x2a8a8a, 0xc83a7a, 0x4a6ad0, 0xe8d040, 0x9a3a2a];
const KID_TOP = [0xe8402a, 0xf0c020, 0x2a8ae0, 0x30b050, 0xf07ab0, 0x9a5ad0, 0xf08a20, 0x20b0b0];
const KID_BOTTOM = [0x2a4a7a, 0x5a4a3a, 0x3a3a40, 0x8a7a5a, 0x4a6a3a];
const OLD_TOP = [0xf0ece0, 0xe0d8c0, 0xc8c0b0, 0xa8b8c8, 0xece6d6];
const OLD_SARI = [0xf0ece0, 0xe6dccb, 0xb8c4d0, 0xd8c8a8, 0x9a7a8a];
const SHAWL = [0xa8987e, 0x8a7a64, 0xc4b494, 0x9a5a48, 0x7a8a9a];
const SANDAL = [0x5a3a22, 0x3a2a1a, 0x7a5232, 0x2a2a2a];
const flagsOf = (...f) => f.reduce((t, b) => t + (1 << b), 0);
// age: 'child' | 'adult' | 'elder'; female: bool; R: random numbers (0..1) for this villager
export function makeLook(age, female, R) {
  const pick = a => a[Math.floor(R() * a.length) % a.length];
  const L = { skin: pick(SKIN), hairCol: pick(HAIR_DARK), shoes: pick(SANDAL), accent: pick(ACCENT), accent2: pick(ACCENT), hat: HAT.none, flags: 0, sx: 1, sy: 1, stick: false };
  if (R() < 0.2) L.shoes = L.skin;                                                    // barefoot
  if (age === 'child') {
    L.top = pick(KID_TOP); L.bottom = pick(KID_BOTTOM); L.sy = 0.86 + R() * 0.24; L.sx = 0.92 + R() * 0.16; L.shoes = R() < 0.4 ? L.skin : L.shoes;
    if (female) { L.hair = pick([HAIR.pigtails, HAIR.bob, HAIR.braid, HAIR.bob]); L.flags = R() < 0.65 ? flagsOf(FLAG.FROCK, FLAG.SHORT, FLAG.SHORTS) : flagsOf(FLAG.SHORT); if (R() < 0.3) L.flags |= 1 << FLAG.BINDI; }
    else { L.hair = pick([HAIR.spiky, HAIR.crop, HAIR.quiff]); L.flags = flagsOf(FLAG.SHORT, ...(R() < 0.7 ? [FLAG.SHORTS] : [])); if (R() < 0.25) L.hat = HAT.ballcap; }
    return L;
  }
  if (age === 'elder') {
    L.hairCol = pick(HAIR_GREY); L.sy = 0.93 + R() * 0.05; L.sx = 0.95 + R() * 0.12; L.stick = R() < 0.6;
    if (female) { L.top = pick(BLOUSE.slice(5)); L.bottom = pick(OLD_SARI); L.accent = pick(SHAWL); L.hair = HAIR.bun; L.hat = R() < 0.5 ? HAT.veil : HAT.none; L.flags = flagsOf(FLAG.SKIRT, FLAG.SARI, FLAG.BINDI, ...(R() < 0.4 ? [FLAG.GLASSES] : []), ...(R() < 0.4 ? [FLAG.SHAWL] : [FLAG.SHORT])); if (L.hat === HAT.veil) L.accent = L.bottom; }
    else { L.top = pick(OLD_TOP); L.bottom = pick([0xf4f1e8, 0xece4d0, 0xd8d0c0]); L.accent = pick(SHAWL); L.hair = R() < 0.6 ? HAIR.bald : HAIR.crop; L.hat = pick([HAT.none, HAT.cap, HAT.turban, HAT.none]); if (L.hat === HAT.turban) L.accent = pick([0xf0e8d0, 0xe8a020, 0xd03020]); L.flags = flagsOf(FLAG.KURTA, FLAG.MOUSTACHE, ...(R() < 0.45 ? [FLAG.BEARD] : []), ...(R() < 0.5 ? [FLAG.GLASSES] : []), ...(R() < 0.5 ? [FLAG.SHAWL] : [])); }
    return L;
  }
  L.sy = 0.92 + R() * 0.1; L.sx = 0.92 + R() * 0.2;
  if (female) {
    L.bottom = pick(SARI); L.top = pick(BLOUSE); L.accent = R() < 0.5 ? L.bottom : pick(ACCENT); L.hair = pick([HAIR.braid, HAIR.bun, HAIR.long, HAIR.braid]);
    L.hat = pick([HAT.none, HAT.none, HAT.veil, HAT.scarf]); L.flags = flagsOf(FLAG.SKIRT, FLAG.BINDI, FLAG.SHORT, ...(R() < 0.6 ? [FLAG.SARI] : [FLAG.SCARF]));
  } else {
    L.top = pick(MEN_TOP); L.bottom = pick(MEN_BOTTOM); L.hair = pick([HAIR.crop, HAIR.quiff, HAIR.crop]); L.hat = pick([HAT.none, HAT.none, HAT.turban, HAT.straw, HAT.cap]);
    const f = [FLAG.MOUSTACHE];
    if (R() < 0.5) f.push(FLAG.KURTA); else if (R() < 0.6) f.push(FLAG.SHORT);
    if (R() < 0.3) f.push(FLAG.VEST); if (R() < 0.45) f.push(FLAG.SCARF); if (R() < 0.25) f.push(FLAG.BELLY); if (R() < 0.15) f.push(FLAG.BEARD);
    L.flags = flagsOf(...f);
  }
  return L;
}
