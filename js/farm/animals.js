// How goats and chickens move. Positions and what each animal does come only from the shared (server) clock
// and the animals' ids, so every player sees the same thing without sending anything over the network.
//   Goats: when a pen (or the store's goat field) has two or more goats, the same two always butt heads —
//   10 s of fighting, 10 s rest, 5 s of fighting, 10 s rest, again and again: they walk up to each other,
//   back off, rear up and clash. The other goats walk between the feed trough and the water trough and eat
//   or drink there, with a little wander in between. A goat alone does the same.
//   Chickens: short walks with quick steps and a bobbing head, peck at the ground when they stop, and now and
//   then a little hop with a flap of the wings.
// The legs, head and wings move on the graphics card (rigMaterial): the models tag those parts (aRig, see
// js/farm/models.js rigOf) and each animal gets iAnim = [step phase, leg swing, head down, head forward] and
// iAnim2 = [wing flap].
import * as THREE from 'three';
import { toWorld } from './layout.js';
import { PEN } from './layout.js';
import { TROUGH_FEED, TROUGH_WATER } from './models.js';

const TAU = Math.PI * 2;
const ease = k => k * k * (3 - 2 * k);
const c01 = v => Math.max(0, Math.min(1, v));
const mod = (a, n) => ((a % n) + n) % n;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/* ---------- the shader: legs swing from the hip, the head turns down from the neck base, wings flap ---------- */
const RIG_GLSL = `
attribute vec4 aRig; attribute vec4 iAnim; attribute vec2 iAnim2;
vec2 rigRot(vec2 p, vec2 o, float a) { vec2 d = p - o; float c = cos(a), s = sin(a); return o + vec2(d.x * c - d.y * s, d.x * s + d.y * c); }`;
const RIG_VERTEX = `#include <begin_vertex>
  if (aRig.x > 0.5 && aRig.x < 1.5) transformed.yz = rigRot(transformed.yz, aRig.zw, sin(iAnim.x + aRig.y) * iAnim.y);
  else if (aRig.x > 1.5 && aRig.x < 2.5) { transformed.z += iAnim.w; transformed.yz = rigRot(transformed.yz, aRig.zw, iAnim.z); }
  else if (aRig.x > 2.5) transformed.xy = rigRot(transformed.xy, aRig.yz, iAnim2.x * sign(aRig.y));`;
function rigged(mat, key) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + RIG_GLSL).replace('#include <begin_vertex>', RIG_VERTEX);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
export const rigMaterial = () => rigged(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'animal-rig-v1');
export const rigDepthMaterial = () => rigged(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 'animal-rig-depth-v1');
// add the per-animal animation values to an instanced mesh's geometry
export function addAnimAttributes(mesh, n) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), b = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  a.setUsage(THREE.DynamicDrawUsage); b.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('iAnim', a); mesh.geometry.setAttribute('iAnim2', b);
}
// gait per kind: leg swing (radians at full walk), one full step cycle (m), walking speed for a full swing (m/s)
export const GAIT = { goat: { amp: 0.5, cycle: 0.95, ref: 0.55 }, chicken: { amp: 0.75, cycle: 0.24, ref: 0.32 } };

/* ---------- goats ---------- */
const FIGHT = 35, WINDOWS = [[0, 10], [20, 5]];        // a 35 s cycle: butting 0–10 s, rest 10 s, butting 20–25 s, rest 10 s
const APPROACH = 3;                                   // they walk up to each other in the 3 s before a round
const BUTT = 1.6;                                     // one butt: back off, rear up, lunge, clash
const CONTACT = 0.52, BACK = 0.38;                    // half the distance between the two goats at the clash / backed off
// where things are in a goat's home (local coordinates of its pen or field)
function home(a, land) {
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
    out.x = wn.x; out.z = wn.z; out.yaw = wn.yaw; out.head = wn.walking ? 0.1 : 0.75 + 0.15 * Math.sin(t * 1.3 + a.k * 9);   // grazing
    return out;
  }
  // eating and drinking: 40 s — eat 16 s, wander 6 s, drink 12 s, wander 6 s
  const P = 40, u = mod(t + (a.gi || 0) * 13 + a.gk * P, P), slot = (a.gi || 0) % 2;
  const stints = [[0, 16, H.eat[slot], 'eat'], [22, 12, H.drink[slot], 'drink']];
  for (const [s0, len, spot, what] of stints) {
    if (u >= s0 && u < s0 + len) {
      const t0 = (t - (u - s0)) * 1000, from = land.wanderLocal(a, t0), D = walkTime(from, spot), ti = u - s0;
      if (ti < D) { travel(from, spot, spot.yaw, ti, D, out); return out; }
      out.x = spot.x; out.z = spot.z; out.yaw = spot.yaw; out.lift = 0.1;              // leaning in
      out.head = what === 'eat' ? 1.08 + 0.1 * Math.sin(t * 5 + a.k * 7) : 1.12 + 0.06 * Math.max(0, Math.sin(t * 3.2 + a.k * 4));
      return out;
    }
    if (u >= s0 + len && u < s0 + len + 2.5) {                                          // leaving the trough
      const wn = land.wanderLocal(a, ms);
      travel(spot, wn, wn.yaw, u - s0 - len, 2.5, out); return out;
    }
  }
  const wn = land.wanderLocal(a, ms);
  out.x = wn.x; out.z = wn.z; out.yaw = wn.yaw; out.head = wn.walking ? 0.1 : 0.7;
  return out;
}

/* ---------- chickens ---------- */
// head down for a peck while standing; a little hop with a wing flap every few seconds
export function chickenExtras(a, ms, walking, out) {
  const t = ms / 1000;
  out.head = 0.08; out.hop = 0; out.flap = 0;
  if (!walking) {                                         // pecking: quick dips, sometimes two in a row
    const p = mod(t * 1.7 + a.k * 9, 1), q = mod(t * 1.7 + a.k * 9, 2);
    out.head = p < 0.14 ? 0.08 + 1.05 * Math.sin(p / 0.14 * Math.PI) : (q > 1.2 && q < 1.34) ? 0.08 + 0.9 * Math.sin((q - 1.2) / 0.14 * Math.PI) : 0.12 + 0.05 * Math.sin(t * 2 + a.k);
  }
  const hp = 6 + a.k * 7, h = mod(t + a.k * 50, hp);     // a hop now and then
  if (h < 0.42) { const k = h / 0.42; out.hop = 0.085 * Math.sin(k * Math.PI); out.flap = (0.55 + 0.45 * Math.sin(h * 52)) * Math.sin(k * Math.PI) * 1.1; }
  return out;
}
export { TAU };
