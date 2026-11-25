// How goats and chickens move. Positions and what each animal does come only from the shared (server) clock
// and the animals' ids, so every player sees the same thing without sending anything over the network.
//   Goats: when a pen (or the store's goat field) has two or more goats, the same two always butt heads —
//   10 s of fighting, 10 s rest, 5 s of fighting, 10 s rest, again and again: they walk up to each other,
//   back off, rear up and clash. The other goats walk between the feed trough and the water trough and eat
//   or drink there, with a little wander in between. A goat alone does the same.
//   Chickens: walks and stops in an uneven rhythm, quick steps and a bobbing head; they peck at the ground in random
//   taps (single ones, two or three in a row), hop up a little with a flap of the wings or just stretch and flap them,
//   all at random moments.
//   Horses: graze and wander, and now and then (2–30 s apart, at random) one rears up on its hind legs, front legs
//   pawing the air, for about three seconds.
// "Random" here is the same on every screen: it comes from the shared clock and the animal's id (rnd).
// The legs, head and wings move on the graphics card (rigMaterial): the models tag those parts (aRig, see
// js/farm/polyRig.js) and each animal gets iAnim = [step phase, leg swing, head down, head forward] and
// iAnim2 = [wing flap / tail swish, rearing up].
import * as THREE from 'three';
import { toWorld } from './layout.js';
import { PEN } from './layout.js';
import { TROUGH_FEED, TROUGH_WATER } from './models.js';
import { rigOf } from './polyRig.js';

const TAU = Math.PI * 2;
const ease = k => k * k * (3 - 2 * k);
const c01 = v => Math.max(0, Math.min(1, v));
const mod = (a, n) => ((a % n) + n) % n;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/* ---------- the shader: legs swing from the hip, the head turns down from the neck base, wings flap ---------- */
const RIG_GLSL = `
attribute vec4 aRig; attribute vec4 aRig2; attribute vec4 iAnim; attribute vec2 iAnim2;
vec2 rigRot(vec2 p, vec2 o, float a) { vec2 d = p - o; float c = cos(a), s = sin(a); return o + vec2(d.x * c - d.y * s, d.x * s + d.y * c); }`;
// kinds (aRig.x): 1 leg (swings from the hip) · 2 neck (turns down from its base) · 3 wing / tail (flaps, swishes;
//   aRig.w: how much of the flap — a one-piece chicken's wing bends out of its body)
//   4.x lower leg: swings with the leg and also bends at the knee (height (x - 4) * 2) while the hoof comes forward
//   5.x head on a long neck: turns down with the neck (base y (x - 5) * 4, z aRig.y) and nods back at the poll
//       (aRig.zw), so a grazing horse gets its nose down to the grass
//   6   neck and head of a one-piece model (js/farm/polyRig.js): turns down about the neck's base (aRig.zw) by aRig.y
//       of the head's angle (0 at the shoulder … 1 at the head), so the neck bends; aRig2 = [poll y, poll z, head
//       weight, nod]: a horse's head nods back at the poll as the neck goes down, so it stays nearly upright; a
//       chicken's head bobs forward (iAnim.w) with the neck's weight
// iAnim2.y: rearing up (a horse on its hind legs) — the front legs (pivot z > 0) fold at the knees and paw the air
const RIG_VERTEX = `#include <begin_vertex>
  float rk = aRig.x, rear = aRig.w > 0.05 ? iAnim2.y : 0.0, paw = sin(iAnim.x + aRig.y);
  if (rk > 0.5 && rk < 1.5) transformed.yz = rigRot(transformed.yz, aRig.zw, paw * iAnim.y - rear * (0.55 + 0.3 * paw));
  else if (rk > 1.5 && rk < 2.5) { transformed.z += iAnim.w; transformed.yz = rigRot(transformed.yz, aRig.zw, iAnim.z); }
  else if (rk > 2.5 && rk < 3.5) transformed.xy = rigRot(transformed.xy, aRig.yz, iAnim2.x * sign(aRig.y) * (aRig.w > 0.0 ? aRig.w : 1.0));
  else if (rk > 3.5 && rk < 4.99) { float ph = iAnim.x + aRig.y;
    transformed.yz = rigRot(transformed.yz, vec2((rk - 4.0) * 2.0, aRig.w), max(0.0, -cos(ph)) * iAnim.y * 1.6 + rear * (1.7 + 0.5 * max(0.0, -cos(ph))));
    transformed.yz = rigRot(transformed.yz, aRig.zw, sin(ph) * iAnim.y - rear * (0.55 + 0.3 * paw)); }
  else if (rk >= 4.99 && rk < 5.5) { transformed.z += iAnim.w;
    transformed.yz = rigRot(transformed.yz, aRig.zw, -iAnim.z * 0.62);
    transformed.yz = rigRot(transformed.yz, vec2((rk - 5.0) * 4.0, aRig.y), iAnim.z); }
  else if (rk >= 5.5) {
    if (aRig2.z > 0.0) transformed.yz = rigRot(transformed.yz, aRig2.xy, -iAnim.z * aRig2.w * aRig2.z);
    transformed.z += iAnim.w * aRig.y;
    transformed.yz = rigRot(transformed.yz, aRig.zw, iAnim.z * aRig.y); }`;
function rigged(mat, key) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + RIG_GLSL).replace('#include <begin_vertex>', RIG_VERTEX);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
// (two-sided for the models with thin parts that show from both sides: a horse's mane)
export const rigMaterial = (twoSided = false) => rigged(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: twoSided ? THREE.DoubleSide : THREE.FrontSide }), 'animal-rig-v4');
// the same with a texture (the guard dogs keep their models' own textures); cut: a see-through texture (fur fringes)
// drawn with its alpha cut out, from both sides
export const rigTexMaterial = (map, cut = false) => rigged(new THREE.MeshLambertMaterial({ map, flatShading: true, alphaTest: cut ? 0.5 : 0, side: cut ? THREE.DoubleSide : THREE.FrontSide }), cut ? 'animal-rig-tex-cut-v4' : 'animal-rig-tex-v4');
export const rigDepthMaterial = () => rigged(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 'animal-rig-depth-v4');
// add the per-animal animation values to an instanced mesh's geometry
export function addAnimAttributes(mesh, n) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), b = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  a.setUsage(THREE.DynamicDrawUsage); b.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('iAnim', a); mesh.geometry.setAttribute('iAnim2', b);
}
// gait per kind: leg swing (radians at full walk), walking speed for a full swing (m/s), and either the leg's
// length (from where it swings: a step is as long as the hooves really go, js/farm/farmland.js) or one full step
// cycle (m) · feet: half the distance between the left and right feet and between the front and hind ones (it
// stands on the ground under them, tipped with the slope)
export const GAIT = { goat: { amp: 0.55, ref: 0.5, leg: 0.29, feet: [0.09, 0.25] }, chicken: { amp: 0.75, cycle: 0.24, ref: 0.32 },
  cow: { amp: 0.42, ref: 0.32, leg: 0.47, feet: [0.18, 0.66] }, cow_bw: { amp: 0.42, ref: 0.32, leg: 0.45, feet: [0.16, 0.63] },
  cow_black: { amp: 0.42, ref: 0.32, leg: 0.47, feet: [0.16, 0.67] }, pig: { amp: 0.5, ref: 0.4, leg: 0.21, feet: [0.1, 0.29] } };
// the horses (hind: where the hind hooves are — it rears up about them); a recoloured coat walks like its model
const HORSE_GAIT = { horse_bay: { amp: 0.36, ref: 0.42, leg: 0.74, feet: [0.11, 0.5], hind: -0.565 },
  horse_black: { amp: 0.36, ref: 0.42, leg: 0.88, feet: [0.19, 0.62], hind: -0.7 }, horse_chestnut: { amp: 0.36, ref: 0.42, leg: 0.75, feet: [0.12, 0.61], hind: -0.665 } };
Object.assign(GAIT, HORSE_GAIT, { horse: HORSE_GAIT.horse_bay, horse_white: HORSE_GAIT.horse_black, horse_palomino: HORSE_GAIT.horse_chestnut, horse_pinto: HORSE_GAIT.horse_chestnut });

/* ---------- cows, horses and pigs ---------- */
// standing, they graze: the head goes down to the grass for a while (nodding a little as they crop it), comes
// up to look about, goes down again; walking, the head is carried low and bobs. The tail swishes now and then,
// with a quick flick from time to time (flies). A pig roots about with quick little nods, and its curly tail
// twitches. head: how far down (radians) · tail: the swish angle
// how far the neck turns down to graze, so the nose is in the grass (a horse's head nods back as it goes)
const GRAZE = { horse: 1.85, cow: 1.06, cow_bw: 1.19, cow_black: 1.16, pig: 0.5 };
export function grazePose(a, ms, walking, out) {
  const t = ms / 1000, k = a.k, u = (t + k * 97) % 16, kind = a.type.startsWith('horse') ? 'horse' : a.type, pig = kind === 'pig';
  const down = walking ? 0.25 : u < 10 ? Math.min(1, u / 1.2, (10 - u) / 1.2) : 0;
  const nod = pig ? Math.sin(t * 6.5 + k * 3) * 0.1 : Math.sin(t * 2.4 + k * 3) * 0.07;
  out.head = walking ? (pig ? 0.1 : 0.22) + Math.sin(t * 3.2 + k * 9) * 0.05 : ease(Math.max(0, down)) * ((rigOf(a.type) || {}).graze || GRAZE[kind] || GRAZE.cow) + (down > 0.9 ? nod : -0.08);
  const flick = (t + k * 31) % 7 < 0.9 ? Math.sin(t * 11) * 0.45 : 0;
  out.tail = pig ? Math.sin(t * 9 + k * 5) * ((t + k * 13) % 5 < 1.6 ? 0.4 : 0.08) : Math.sin(t * 1.7 + k * 5) * 0.22 + flick;
  return out;
}

/* ---------- goats ---------- */
// The goat is the fat-tailed sheep model (js/farm/polyRig.js): its neck turns down from the withers, so about 0.45
// puts its nose in a trough and about 1.05 down to the grass. Standing, it grazes, now and then looking up.
const GOAT_GRAZE = 1.05;
function goatGraze(a, t) {
  const u = (t + a.k * 97) % 13, down = u < 9 ? Math.min(1, u / 1.3, (9 - u) / 1.3) : 0;
  return ease(Math.max(0, down)) * GOAT_GRAZE + (down > 0.9 ? Math.sin(t * 2.6 + a.k * 3) * 0.06 : 0.05);
}
const FIGHT = 35, WINDOWS = [[0, 10], [20, 5]];        // a 35 s cycle: butting 0–10 s, rest 10 s, butting 20–25 s, rest 10 s
const APPROACH = 3;                                   // they walk up to each other in the 3 s before a round
const BUTT = 1.6;                                     // one butt: back off, rear up, lunge, clash
const CONTACT = 0.7, BACK = 0.38;                     // half the distance between the two goats at the clash / backed off
// where things are in a goat's home (local coordinates of its pen or field)
function home(a, land) {
  if (a.home) return a.home;                         // a village pen (js/village/animals.js)
  if (a.field) return { F: land.goatField.F, R: land.goatField.pen, fight: { x: 0, z: 0.4 },
    eat: [{ x: 3.1, z: -3.75, yaw: Math.PI }, { x: 3.9, z: -3.75, yaw: Math.PI }], drink: [{ x: -2.95, z: 3.8, yaw: 0 }, { x: -2.05, z: 3.8, yaw: 0 }] };
  return { F: land.plotFrame(a.plot), R: PEN, fight: { x: 0, z: 1.4 },
    eat: [{ x: TROUGH_FEED.x - 0.42, z: 3.82, yaw: 0 }, { x: TROUGH_FEED.x + 0.42, z: 3.82, yaw: 0 }],
    drink: [{ x: TROUGH_WATER.x - 0.42, z: 3.82, yaw: 0 }, { x: TROUGH_WATER.x + 0.42, z: 3.82, yaw: 0 }] };
}
// walking from one spot to another: eased, facing the way it goes, turning to the end yaw on arrival
function travel(from, to, toYaw, tIn, D, out) {
  const k = c01(tIn / D), e = ease(k), dir = Math.atan2(to.x - from.x, to.z - from.z), far = Math.hypot(to.x - from.x, to.z - from.z) > 0.15;
  out.x = from.x + (to.x - from.x) * e; out.z = from.z + (to.z - from.z) * e;
  out.yaw = !far ? toYaw : k < 0.8 ? dir : lerpAngle(dir, toYaw, (k - 0.8) / 0.2);
  return out;
}
const walkTime = (a, b) => Math.max(1.4, Math.min(6, Math.hypot(b.x - a.x, b.z - a.z) / 0.8));
// a goat's pose at a moment of the shared clock (local x, z, yaw; head: how far down; lift: rearing up)
export function goatPose(a, ms, land, out) {
  const H = home(a, land), t = ms / 1000;
  out.F = H.F; out.head = 0.1; out.lift = 0; out.clash = -1;
  if (a.partner) {                                                   // one of the two fighters
    const side = a.gi === 0 ? -1 : 1, u = mod(t + a.gk * FIGHT, FIGHT), yawF = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const spot = { x: H.fight.x + side * CONTACT, z: H.fight.z };
    for (const [fs, len] of WINDOWS) {
      // walking up to each other in the APPROACH seconds before the round (from where it wandered then)
      const ua = mod(u - (fs - APPROACH), FIGHT);
      if (ua < APPROACH) { const from = land.wanderLocal(a, (t - ua) * 1000); travel(from, spot, yawF, ua, APPROACH, out); return out; }
      if (u >= fs && u < fs + len) {                                 // the round: butting heads
        const bt = u - fs, s = mod(bt, BUTT) / BUTT;
        // back off, hold (rearing up), lunge, a little recoil from the clash, heads together
        const off = s < 0.35 ? BACK * ease(s / 0.35) : s < 0.55 ? BACK : s < 0.68 ? BACK * (1 - ease((s - 0.55) / 0.13)) : s < 0.8 ? 0.05 * Math.sin((s - 0.68) / 0.12 * Math.PI) : 0;
        out.x = H.fight.x + side * (CONTACT + off); out.z = H.fight.z; out.yaw = yawF;
        out.lift = s < 0.3 ? 0 : s < 0.55 ? -0.42 * ease((s - 0.3) / 0.25) : s < 0.68 ? -0.42 * (1 - ease((s - 0.55) / 0.13)) : 0;
        out.head = s < 0.5 ? 0.12 : s < 0.68 ? 0.12 + 0.45 * ease((s - 0.5) / 0.18) : s < 0.85 ? 0.57 : 0.12 + 0.45 * (1 - ease((s - 0.85) / 0.15));
        out.clash = Math.floor(bt / BUTT) + (s >= 0.68 ? 1 : 0);    // counts the clashes (the sound plays when it goes up)
        return out;
      }
      if (u >= fs + len && u < fs + len + 2.5) {                     // the round is over: walk off
        const wn = land.wanderLocal(a, ms);
        travel(spot, wn, wn.yaw, u - fs - len, 2.5, out); return out;
      }
    }
    const wn = land.wanderLocal(a, ms);
    out.x = wn.x; out.z = wn.z; out.yaw = wn.yaw; out.head = wn.walking ? 0.12 : goatGraze(a, t);
    return out;
  }
  // eating and drinking: 40 s — eat 16 s, wander 6 s, drink 12 s, wander 6 s
  const P = 40, u = mod(t + (a.gi || 0) * 13 + a.gk * P, P), slot = (a.gi || 0) % 2;
  const stints = [[0, 16, H.eat[slot], 'eat'], [22, 12, H.drink[slot], 'drink']];
  for (const [s0, len, spot, what] of stints) {
    if (u >= s0 && u < s0 + len) {
      const t0 = (t - (u - s0)) * 1000, from = land.wanderLocal(a, t0), D = walkTime(from, spot), ti = u - s0;
      if (ti < D) { travel(from, spot, spot.yaw, ti, D, out); return out; }
      out.x = spot.x; out.z = spot.z; out.yaw = spot.yaw; out.lift = 0.05;             // leaning in
      out.head = what === 'eat' ? 0.44 + 0.07 * Math.sin(t * 5 + a.k * 7) : 0.5 + 0.05 * Math.max(0, Math.sin(t * 3.2 + a.k * 4));
      return out;
    }
    if (u >= s0 + len && u < s0 + len + 2.5) {                                          // leaving the trough
      const wn = land.wanderLocal(a, ms);
      travel(spot, wn, wn.yaw, u - s0 - len, 2.5, out); return out;
    }
  }
  const wn = land.wanderLocal(a, ms);
  out.x = wn.x; out.z = wn.z; out.yaw = wn.yaw; out.head = wn.walking ? 0.12 : goatGraze(a, t);
  return out;
}

/* ---------- chance, the same on every screen ---------- */
// a number in [0, 1) for an animal (k), a turn of time (j) and a purpose (s): random-looking, the same everywhere
const rnd = (k, j, s) => { const v = Math.sin(k * 9301.7 + j * 49.297 + s * 233.11) * 43758.5453; return v - Math.floor(v); };

/* ---------- chickens ---------- */
// What a hen does comes in short turns of time, each decided by chance: standing, most turns bring a quick tap of the
// beak on the ground (now and then two or three in a row, sometimes a pause); walking, it now and then stops to peck;
// every so often it hops up a little with a flap of its wings, or just stretches and flaps them.
//   head: how far the neck turns down (peck: the beak on the ground) · lean: the body tips in with a peck (radians) ·
//   hop: how high (m) · flap: the wings' angle
export function chickenExtras(a, ms, walking, out, peck = 1.1) {
  const t = ms / 1000 + a.k * 100;
  out.head = 0.06 + 0.05 * Math.sin(t * 1.9 + a.k * 7); out.hop = 0; out.flap = 0; out.lean = 0;
  // pecks: in turns of 0.6 s, a tap of 0.24 s (down fast, up again) at a random moment of the turn
  const P = 0.6, j = Math.floor(t / P), u = t - j * P, at = rnd(a.k, j, 1) * (P - 0.26);
  if (rnd(a.k, j, 2) < (walking ? 0.1 : 0.6) && u >= at && u < at + 0.24) {
    const s = (u - at) / 0.24, d = s < 0.35 ? ease(s / 0.35) : 1 - ease((s - 0.35) / 0.65);
    out.head = 0.06 + (peck - 0.06) * d; out.lean = 0.3 * d;
  }
  // in turns of 1.3 s: a hop with a wing flap (about one every 15 s) or a wing stretch (about one every 20 s)
  const Q = 1.3, i = Math.floor(t / Q), v = t - i * Q, r = rnd(a.k, i, 3), o = rnd(a.k, i, 4) * (Q - 0.72);
  if (r < 0.085 && v >= o && v < o + 0.46) {
    const s = (v - o) / 0.46, b = Math.sin(s * Math.PI);
    out.hop = (0.06 + 0.07 * rnd(a.k, i, 5)) * b; out.flap = (0.6 + 0.4 * Math.sin(s * 42)) * b * 0.95; out.head = 0.04; out.lean = -0.12 * b;
  } else if (r > 0.935 && v >= o && v < o + 0.7) {
    const s = (v - o) / 0.7;
    out.flap = (0.55 + 0.45 * Math.sin(s * 30)) * Math.sin(s * Math.PI) * 0.75;
  }
  return out;
}

/* ---------- horses ---------- */
// Now and then a horse rears up on its hind legs, the front legs folded and pawing the air, for 2.6–3.4 s. Time is
// cut in turns of 19 s with one rear each at a random moment, so two rears are 2.6–29 s apart, at random. It stops
// where it is for the rear (at: the moment it started, to hold the spot) and then catches up with its walk.
const REAR = 19, CATCH = 1.2;
export function rearOf(a, ms) {
  const T = ms / 1000 + a.k * 1000, j = Math.floor(T / REAR), u = T - j * REAR;
  const len = 2.6 + rnd(a.k, j, 7) * 0.8, at = 0.5 + rnd(a.k, j, 6) * 13;
  if (u < at || u >= at + len + CATCH) return null;
  const start = ms - (u - at) * 1000;
  return u < at + len ? { s: (u - at) / len, at: start } : { s: 1, at: start, back: ease((u - at - len) / CATCH) };
}
// how high it is (0 … 1): up quickly, held while the front legs paw, down again
export const rearHeight = s => (s < 0.26 ? ease(s / 0.26) : s < 0.74 ? 1 : 1 - ease((s - 0.74) / 0.26));
export { TAU };
