// Small animal pens beside some village houses: a chicken coop on stilts with a ramp, a goat lean-to, an open
// cow shed, a horse shelter — each with its fenced yard and a trough. The animals are the farm's own models
// and animation (js/farm/farmland.js, js/farm/animals.js): they are added to the farm's decorative animals
// with a `home` (their pen), so they walk, peck, graze, eat, drink and make their sounds like the farm's —
// but they belong to the village: no feeding, no eggs, nothing in the farm's economy.
import * as THREE from 'three';
import { C, boards, fenceRun, hayBale } from '../farm/props.js';

// the yard (local: x across, z from the shelter at the back to the fence at the front)
export const PEN_SIZE = { hw: 2.4, z0: -2.0, z1: 2.2 };
export const ANIMALS = { chicken: ['chicken', 'chicken', 'chicken_brown'], goat: ['goat', 'goat'], cow: ['cow'], horse: ['horse_chestnut'] };

function coop(b) {
  for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) b.box(0.1, 0.55, 0.1, x, 0.27, z, C.woodD);
  b.box(1.4, 0.95, 1.0, 0, 1.0, 0, C.woodL);
  boards(b, 1.4, 0.95, 0, 1.0, 0.51, C.woodL, 3, 0, 0.03);
  b.box(0.4, 0.4, 0.05, 0.2, 0.85, 0.53, 0x2a1d14);
  for (const s of [-1, 1]) b.group(0, 1.75, s * 0.32, s * 0.7, 0, 0, () => b.box(1.7, 0.08, 0.85, 0, 0, 0, C.red));
  b.group(0.2, 0.32, 0.9, -0.62, 0, 0, () => { b.box(0.36, 0.04, 0.9, 0, 0, 0, C.wood); for (let z = -0.35; z < 0.4; z += 0.18) b.box(0.36, 0.03, 0.03, 0, 0.03, z, C.woodD); });
}
function leanTo(b, w, d, h, hay) {
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) b.box(0.14, z < 0 ? h : h - 0.6, 0.14, x, (z < 0 ? h : h - 0.6) / 2, z, C.woodD);
  boards(b, w, h - 0.3, 0, (h - 0.3) / 2, -d / 2 + 0.05, C.wood, Math.round(h / 0.3), 0, 0.05);
  for (const s of [-1, 1]) b.group(s * w / 2, 0, 0, 0, s * Math.PI / 2, 0, () => boards(b, d, h - 0.9, 0, (h - 0.9) / 2, 0, C.woodL, 3, 0, 0.04));
  const run = d + 0.5, tilt = Math.atan2(0.6, d), wid = run / Math.cos(tilt);
  b.group(0, h - 0.25, 0.05, tilt, 0, 0, () => b.box(w + 0.5, 0.1, wid, 0, 0, 0, 0x6e4a2e));
  if (hay) hayBale(b, -w / 2 + 0.6, 0, -d / 2 + 0.55, 0.2);
}
function openShed(b, w, d, h) {
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) b.box(0.16, h, 0.16, x, h / 2, z, C.woodD);
  for (const s of [-1, 1]) b.group(0, h + 0.35, s * d / 4, s * 0.55, 0, 0, () => b.box(w + 0.5, 0.1, d / 2 / Math.cos(0.55) + 0.35, 0, 0, 0, 0xb5452f));
  b.box(w + 0.5, 0.12, 0.2, 0, h + 0.35 + d / 4 * Math.tan(0.55) + 0.05, 0, 0x8e3424);
  hayBale(b, -w / 2 + 0.7, 0, -d / 2 + 0.5, 0.1); hayBale(b, -w / 2 + 0.7, 0.62, -d / 2 + 0.5, 0.4);
}
function trough(b, water) {
  b.box(1.2, 0.38, 0.45, 0, 0.19, 0, C.wood);
  b.box(1.1, 0.06, 0.36, 0, 0.36, 0, water ? 0x4f86b8 : C.hay, water ? 'glass' : 'solid');
}
// a pen: shelter, troughs and the fence (gAt: the ground in the pen's frame). Returns the animals' home:
// the yard to wander, and the spots to eat, drink and butt heads (goats)
export function buildPen(b, kind, gAt) {
  const { hw, z0, z1 } = PEN_SIZE;
  const at = (x, z, fn) => b.group(x, gAt(x, z), z, 0, 0, 0, fn);
  if (kind === 'chicken') at(-1.2, -1.3, () => coop(b));
  else if (kind === 'goat') at(-0.6, -1.25, () => leanTo(b, 2.8, 1.5, 1.9, true));
  else if (kind === 'cow') at(-0.4, -1.1, () => openShed(b, 3.2, 1.9, 2.0));
  else at(-0.4, -1.15, () => leanTo(b, 3.4, 1.7, 2.4, true));
  const tz = z1 - 0.65;
  if (kind !== 'chicken') { at(-1.3, tz, () => trough(b, false)); at(1.3, tz, () => trough(b, true)); }
  else { at(1.4, tz, () => b.cyl(0.32, 0.36, 0.12, 8, 0, 0.06, 0, 0x8a877f)); at(1.4, tz, () => b.cyl(0.28, 0.28, 0.04, 8, 0, 0.13, 0, 0x4f86b8, 0, 0, 0, 'glass')); }
  // the fence round the yard
  for (const [ax, az, bx, bz] of [[-hw, z1, hw, z1], [-hw, z0, -hw, z1], [hw, z0, hw, z1], [-hw, z0, hw, z0]]) fenceRun(b, ax, az, bx, bz, gAt, { h: kind === 'chicken' ? 0.75 : 1.05, spacing: 1.4 });
  const R = kind === 'chicken' ? { x0: -hw + 0.4, x1: hw - 0.4, z0: -0.2, z1: z1 - 0.4 } : { x0: -hw + 0.6, x1: hw - 0.6, z0: -0.1, z1: z1 - 0.6 };
  return {
    R, fight: { x: 0, z: 0.6 },
    eat: [{ x: -1.3 - 0.3, z: tz - 0.62, yaw: 0 }, { x: -1.3 + 0.3, z: tz - 0.62, yaw: 0 }],
    drink: [{ x: 1.3 - 0.3, z: tz - 0.62, yaw: 0 }, { x: 1.3 + 0.3, z: tz - 0.62, yaw: 0 }],
  };
}
export { THREE };
