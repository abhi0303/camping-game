// Small low-poly props for the farm (crates, barrels, egg crates, milk cans, hay, lanterns, sacks,
// shelves, wood and stone piles, wheels...). Each one adds parts to a GeoBuilder in its local space.
// Wood is made of planks in slightly different shades, which gives the "wooden texture" in this
// flat-shaded art style; lantern glass and lit windows go into the 'glow' material.
import * as THREE from 'three';
import { MAT } from '../utils.js';

export const C = {
  wood: 0x8a5a33, woodD: 0x6e4626, woodL: 0xa8743f, woodXL: 0xc08a52, woodG: 0x7a6248,
  red: 0xa83a2c, redD: 0x8e2f24, white: 0xf0ece0, roof: 0x5b3a24, roofD: 0x4a2f1d, roofG: 0x6a6c70, roofGD: 0x55575b,
  stone: 0x8a877f, stoneD: 0x6f6c66, stoneL: 0x9e9b92, hay: 0xd8b24e, hayD: 0xc49c3c, metal: 0xc9ced3, metalD: 0x9aa1a8,
  egg: 0xf2ece0, eggB: 0xc98a52, eggD: 0x6e5a48, milk: 0xe8ecef, glow: 0xffd27a, glass: 0x9cc6dd, rope: 0xc8b28a,
  dirt: 0x8b6a45, dirtD: 0x6f5233, dirtL: 0xa3825a, grass: 0x55893a, grassD: 0x467a30, sack: 0xd9c49a, iron: 0x3a3a3e,
};
// the shared materials plus an unlit one for lantern glass / lit windows
export const FARM_MAT = { ...MAT, glow: new THREE.MeshBasicMaterial({ vertexColors: true }) };

const shade = (c, k) => { const o = new THREE.Color(c); o.multiplyScalar(k); return o.getHex(); };

// a panel of vertical planks (w × h, facing +z), alternating shades
export function planks(b, w, h, x, y, z, color, n = Math.max(2, Math.round(w / 0.35)), ry = 0, depth = 0.08) {
  const pw = w / n;
  b.group(x, y, z, 0, ry, 0, () => {
    for (let i = 0; i < n; i++) b.box(pw * 0.96, h * (0.985 + (i % 3) * 0.008), depth, -w / 2 + pw * (i + 0.5), 0, 0, shade(color, [1, 0.93, 1.06, 0.97][i % 4]));
  });
}
// horizontal boards (a fence rail look, or a lap-sided wall)
export function boards(b, w, h, x, y, z, color, n = Math.max(2, Math.round(h / 0.28)), ry = 0, depth = 0.08) {
  const bh = h / n;
  b.group(x, y, z, 0, ry, 0, () => {
    for (let i = 0; i < n; i++) b.box(w, bh * 0.94, depth + (i % 2) * 0.012, 0, -h / 2 + bh * (i + 0.5), 0, shade(color, [1, 0.92, 1.05][i % 3]));
  });
}
export function crate(b, x, y, z, s = 0.6, color = C.woodL, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.box(s, s, s, 0, s / 2, 0, color);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.07, s + 0.01, 0.07, sx * (s / 2 - 0.03), s / 2, sz * (s / 2 - 0.03), C.woodD);
    for (const yy of [0.06, s - 0.06]) { b.box(s + 0.02, 0.07, 0.04, 0, yy, s / 2, C.woodD); b.box(s + 0.02, 0.07, 0.04, 0, yy, -s / 2, C.woodD); }
    b.box(0.05, s * 1.25, 0.04, 0, s / 2, s / 2 + 0.01, C.woodD, 'solid', 0, 0, 0.78);
  });
}
export function barrel(b, x, y, z, color = C.wood) {
  b.cyl(0.32, 0.28, 0.9, 10, x, y + 0.45, z, color);
  b.cyl(0.33, 0.33, 0.06, 10, x, y + 0.18, z, C.iron); b.cyl(0.33, 0.33, 0.06, 10, x, y + 0.72, z, C.iron);
  b.cyl(0.29, 0.29, 0.03, 10, x, y + 0.91, z, C.woodD);
}
// an open egg crate with eggs in rows
export function eggCrate(b, x, y, z, egg = C.egg, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.box(0.62, 0.14, 0.44, 0, 0.07, 0, C.woodXL);
    b.box(0.58, 0.02, 0.4, 0, 0.13, 0, C.sack);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) b.add(new THREE.SphereGeometry(0.045, 6, 4), egg, -0.22 + i * 0.11, 0.17, -0.12 + j * 0.12, 0, 0, 0, 'solid', 1, 1.25, 1);
  });
}
export function eggStack(b, x, y, z, n = 3, ry = 0, eggs = [C.egg, C.eggB, C.egg]) { for (let i = 0; i < n; i++) eggCrate(b, x, y + i * 0.16, z, eggs[i % eggs.length], ry + (i % 2) * 0.06); }
export function milkCan(b, x, y, z, s = 1) {
  b.cyl(0.16 * s, 0.17 * s, 0.5 * s, 10, x, y + 0.25 * s, z, C.milk);
  b.cyl(0.11 * s, 0.16 * s, 0.1 * s, 10, x, y + 0.55 * s, z, C.metal);
  b.cyl(0.08 * s, 0.08 * s, 0.12 * s, 8, x, y + 0.66 * s, z, C.metal);
  b.cyl(0.1 * s, 0.1 * s, 0.03 * s, 8, x, y + 0.73 * s, z, C.metalD);
  b.box(0.04 * s, 0.03 * s, 0.32 * s, x, y + 0.62 * s, z, C.metalD);
  b.cyl(0.172 * s, 0.172 * s, 0.03 * s, 10, x, y + 0.12 * s, z, C.metalD);
}
export function hayBale(b, x, y, z, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.box(1.0, 0.5, 0.6, 0, 0.25, 0, C.hay);
    for (const xx of [-0.25, 0.25]) b.box(0.04, 0.52, 0.62, xx, 0.25, 0, C.rope);
    b.box(1.02, 0.08, 0.62, 0, 0.47, 0, C.hayD);
  });
}
export function sack(b, x, y, z, ry = 0, c = C.sack) {
  b.group(x, y, z, 0, ry, 0, () => { b.box(0.45, 0.6, 0.3, 0, 0.3, 0, c); b.box(0.3, 0.12, 0.22, 0, 0.66, 0, shade(c, 0.9)); b.box(0.32, 0.03, 0.24, 0, 0.6, 0, C.rope); });
}
export function lantern(b, x, y, z) {
  b.box(0.2, 0.04, 0.2, x, y + 0.36, z, C.iron);
  b.box(0.14, 0.24, 0.14, x, y + 0.2, z, C.glow, 'glow');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.02, 0.26, 0.02, x + sx * 0.08, y + 0.2, z + sz * 0.08, C.iron);
  b.box(0.18, 0.04, 0.18, x, y + 0.06, z, C.iron);
  b.cyl(0.01, 0.01, 0.12, 4, x, y + 0.44, z, C.iron);
}
// a lamp post with a hanging lantern
export function lampPost(b, x, y, z, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.box(0.14, 2.6, 0.14, 0, 1.3, 0, C.woodD);
    b.box(0.5, 0.08, 0.08, 0.22, 2.55, 0, C.woodD);
    b.box(0.07, 0.4, 0.07, 0.1, 2.38, 0, C.woodD, 'solid', 0, 0, 0.8);
    lantern(b, 0.42, 2.0, 0);
  });
}
// logs stacked in a pyramid, lying along z (the light end rings show at both ends)
export function woodPile(b, x, y, z, rows = 3, len = 1.6, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    for (let r = 0; r < rows; r++) {
      const n = rows - r;
      for (let i = 0; i < n; i++) {
        const xx = (i - (n - 1) / 2) * 0.33, yy = 0.17 + r * 0.29;
        b.cyl(0.16, 0.16, len, 7, xx, yy, 0, shade(C.wood, 0.9 + ((i + r) % 3) * 0.07), Math.PI / 2, 0, 0);
        b.cyl(0.12, 0.12, len + 0.02, 7, xx, yy, 0, C.woodXL, Math.PI / 2, 0, 0);
      }
    }
  });
}
export function stonePile(b, x, y, z, n = 6, s = 0.32) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.39, r = (i % 3) * 0.22;
    b.add(new THREE.DodecahedronGeometry(s * (0.75 + (i % 4) * 0.12), 0), [C.stone, C.stoneD, C.stoneL][i % 3], x + Math.cos(a) * r, y + s * 0.6 + (i > 3 ? s * 0.8 : 0), z + Math.sin(a) * r, a, a * 0.7, 0);
  }
}
// a bin (open box) full of stones
export function stoneBin(b, x, y, z, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.box(1.1, 0.08, 0.8, 0, 0.04, 0, C.woodD);
    for (const s of [-1, 1]) { boards(b, 1.1, 0.5, 0, 0.3, s * 0.38, C.wood, 2, 0, 0.05); boards(b, 0.8, 0.5, s * 0.53, 0.3, 0, C.wood, 2, Math.PI / 2, 0.05); }
    stonePile(b, 0, 0.12, 0, 7, 0.2);
  });
}
export function wheel(b, x, y, z, r = 0.55, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    b.add(new THREE.TorusGeometry(r, 0.06, 5, 14), C.woodD, 0, 0, 0);
    for (let i = 0; i < 6; i++) b.box(0.05, r * 2, 0.05, 0, 0, 0, C.wood, 'solid', 0, 0, i * Math.PI / 6);
    b.cyl(0.1, 0.1, 0.12, 8, 0, 0, 0, C.woodD, Math.PI / 2, 0, 0);
  });
}
export function bench(b, x, y, z, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    boards(b, 1.6, 0.06, 0, 0.45, 0, C.woodL, 1, 0, 0.36);
    b.box(1.6, 0.36, 0.06, 0, 0.75, -0.17, C.woodL);
    for (const s of [-0.65, 0.65]) { b.box(0.08, 0.45, 0.32, s, 0.22, 0, C.woodD); b.box(0.06, 0.8, 0.06, s, 0.6, -0.17, C.woodD); }
  });
}
// open shelf unit (w wide, d deep, `levels` boards), back against -z
export function shelf(b, x, y, z, w = 1.8, h = 2.0, d = 0.5, levels = 4, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    for (const s of [-1, 1]) b.box(0.06, h, d, s * (w / 2 - 0.03), h / 2, 0, C.woodD);
    b.box(w, h, 0.04, 0, h / 2, -d / 2 + 0.02, C.wood);
    for (let i = 0; i < levels; i++) b.box(w - 0.08, 0.05, d, 0, 0.1 + i * ((h - 0.2) / (levels - 1)), 0, C.woodL);
  });
}
// fill a shelf's boards with goods
export function stockShelf(b, x, y, z, w, h, levels, kinds, ry = 0) {
  b.group(x, y, z, 0, ry, 0, () => {
    for (let i = 0; i < levels - 1; i++) {
      const yy = 0.13 + i * ((h - 0.2) / (levels - 1)), kind = kinds[i % kinds.length];
      const n = Math.max(1, Math.floor((w - 0.1) / (kind === 'can' ? 0.4 : kind === 'egg' ? 0.66 : 0.5)));
      for (let k = 0; k < n; k++) {
        const xx = -w / 2 + (k + 0.5) * (w / n);
        if (kind === 'egg') eggCrate(b, xx, yy, 0, k % 3 === 1 ? C.eggB : C.egg);
        else if (kind === 'can') milkCan(b, xx, yy, 0, 0.75);
        else if (kind === 'sack') sack(b, xx, yy, 0, k * 0.3);
        else if (kind === 'jar') { b.cyl(0.08, 0.08, 0.2, 8, xx, yy + 0.1, 0, [0xd8a040, 0xb85030, 0x80a040][k % 3]); b.cyl(0.085, 0.085, 0.04, 8, xx, yy + 0.22, 0, C.metalD); }
        else crate(b, xx, yy, 0, 0.36, C.woodXL, k * 0.2);
      }
    }
  });
}
// a short fence run between two points (posts + 2 rails), standing on the ground given by hAt(x, z)
export function fenceRun(b, x0, z0, x1, z1, hAt, opts = {}) {
  const h = opts.h || 1.15, spacing = opts.spacing || 1.8, color = opts.color || C.wood;
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / spacing)), a = Math.atan2(x1 - x0, z1 - z0);
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; pts.push([x, z, hAt(x, z)]); }
  for (const [i, [x, z, g]] of pts.entries()) {
    const thick = (i === 0 || i === n) && opts.corners !== false ? 0.17 : 0.13;
    b.box(thick, h + 0.5, thick, x, g + (h - 0.5) / 2, z, i % 2 ? C.woodD : shade(C.woodD, 1.08), 'solid', 0, a, 0);
    b.add(new THREE.ConeGeometry(thick * 0.75, 0.14, 4), C.woodD, x, g + h + 0.07, z, 0, a + Math.PI / 4, 0);
  }
  for (let i = 0; i < n; i++) {
    const [xa, za, ga] = pts[i], [xb, zb, gb] = pts[i + 1], seg = Math.hypot(xb - xa, zb - za), tilt = Math.atan2(gb - ga, seg);
    // turn the rail to face along the run, then tilt it with the slope
    for (const [k, yy] of [[0, h * 0.38], [1, h * 0.8]]) b.group((xa + xb) / 2, (ga + gb) / 2 + yy, (za + zb) / 2, 0, a, 0, () => b.box(0.07, 0.11, seg + 0.06, 0, 0, 0, shade(color, k ? 1 : 0.94), 'solid', -tilt, 0, 0));
  }
}
