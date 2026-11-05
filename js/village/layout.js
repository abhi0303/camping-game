// Sonpur village (Farm World): where it is and how it's laid out. It lies behind the Market and the Fish
// Market, between the main road (east), the river (north) and the ridge (west). The fishing path to the river
// docks runs north through it as its main street; a lane from behind the Market leads in, the village square
// sits on the main street, and lanes branch off east and west. Houses are placed along the lanes by
// placeHouses(): every spot is checked against the ground (not too steep), the roads, the fishing path,
// the farm's buildings, the river and the other houses, so nothing overlaps. Everything is deterministic.
import { CLEAR, MARKET, FISH_MARKET, STORE } from '../farm/layout.js';

export const VILLAGE_NAME = 'Sonpur';
// the village square (paved, with the well in the middle)
export const SQUARE = { x: -101, z: -60, r: 8 };
// lanes: polylines [x, z] with a width. The first one is the fishing path (it stays as it is: the lane is
// painted along it); the others are the village's own dirt lanes.
export const LANES = [
  { id: 'main', w: 3.4, pts: [[-83.4, -89.1], [-91.5, -78], [-93, -45], [-95.5, -10]] },                 // the fishing path = main street
  { id: 'entry', w: 3.2, pts: [[-97.5, -104.5], [-99.5, -96], [-97, -86], [-92.2, -74]] },              // from behind the Market
  { id: 'west', w: 2.6, pts: [[-108.5, -61], [-120, -64], [-132, -70], [-141, -79], [-146, -90]] },
  { id: 'west2', w: 2.2, pts: [[-132, -70], [-136, -58], [-140, -46]] },
  { id: 'east', w: 2.6, pts: [[-92.6, -64], [-82, -61], [-72, -55], [-66, -45]] },
  { id: 'north', w: 2.4, pts: [[-93.6, -38], [-104, -33], [-114, -31]] },
  { id: 'east2', w: 2.2, pts: [[-93.4, -42], [-82, -37], [-73, -30]] },
  { id: 'ne', w: 2.0, pts: [[-73, -30], [-68, -21], [-62, -17]] },
  { id: 'sw', w: 2.0, pts: [[-120, -64], [-124, -80], [-122, -94]] },
];
// the area the village takes (the jungle is cleared here in Farm World)
export const VILLAGE_CLEAR = [
  { x0: -152, x1: -64, z0: -99, z1: -14 },
  { x0: -110, x1: -84, z0: -108, z1: -98 },
  { x0: -88, x1: -58, z0: -68, z1: -14 },
];
export const BOUNDS = { x0: -154, x1: -58, z0: -110, z1: -18 };

/* ---------- geometry helpers ---------- */
export function segDist(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(x - ax - vx * t, z - az - vz * t);
}
// distance from (x, z) to the nearest lane's edge (negative inside a lane), and that lane
export function laneDist(x, z, skip) {
  let best = 1e9, lane = null;
  for (const L of LANES) {
    if (L === skip) continue;
    for (let i = 0; i < L.pts.length - 1; i++) {
      const d = segDist(x, z, L.pts[i][0], L.pts[i][1], L.pts[i + 1][0], L.pts[i + 1][1]) - L.w / 2;
      if (d < best) { best = d; lane = L; }
    }
  }
  return { d: best, lane };
}
// all lane segments (for the ground shader and the map)
export function laneSegments() {
  const out = [];
  for (const L of LANES) for (let i = 0; i < L.pts.length - 1; i++) out.push([L.pts[i][0], L.pts[i][1], L.pts[i + 1][0], L.pts[i + 1][1], L.w]);
  return out;
}
// a point along a polyline at distance s, with its direction
function along(pts, s) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
    if (s <= len || i === pts.length - 2) { const k = Math.min(1, s / len); return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, tx: (bx - ax) / len, tz: (bz - az) / len }; }
    s -= len;
  }
  return null;
}
const polyLen = pts => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
// a house's footprint corners (local x ±w/2, z ±d/2) in world space
export function corners(H, w, d, pad = 0) {
  const c = Math.cos(H.yaw), s = Math.sin(H.yaw), out = [];
  for (const [lx, lz] of [[-w / 2 - pad, -d / 2 - pad], [w / 2 + pad, -d / 2 - pad], [w / 2 + pad, d / 2 + pad], [-w / 2 - pad, d / 2 + pad]]) out.push([H.x + lx * c + lz * s, H.z - lx * s + lz * c]);
  return out;
}
// is world point (x, z) inside house H's footprint grown by pad?
export function inside(H, x, z, w, d, pad = 0) {
  const c = Math.cos(H.yaw), s = Math.sin(H.yaw), dx = x - H.x, dz = z - H.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) < w / 2 + pad && Math.abs(lz) < d / 2 + pad;
}

/* ---------- placing the houses along the lanes ---------- */
export const PEN_ROOM = 5.8;                         // the room a pen takes on a house's right side (+x)
// the ground a house needs: the house with a margin, its garden in front, a yard behind, its pen on the right
export function plot(H, S) {
  const w = S.shape === 'round' ? S.r * 2 : S.w, d = S.shape === 'round' ? S.r * 2 : S.d, pen = S.pen ? PEN_ROOM : 0;
  const x0 = -w / 2 - 0.9, x1 = w / 2 + 0.9 + pen, z0 = -d / 2 - 1.4, z1 = d / 2 + S.garden;
  const c = Math.cos(H.yaw), s = Math.sin(H.yaw), ox = (x0 + x1) / 2, oz = (z0 + z1) / 2;
  return { cx: H.x + ox * c + oz * s, cz: H.z - ox * s + oz * c, ax: [c, -s], az: [s, c], hw: (x1 - x0) / 2, hd: (z1 - z0) / 2,
    pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [ox, oz], [0, 0], [(x0 + x1) / 2, z0], [(x0 + x1) / 2, z1], [x0, oz], [x1, oz]].map(([a, b]) => [H.x + a * c + b * s, H.z - a * s + b * c]) };
}
// do two plots overlap? (separating axes)
export function overlap(A, B) {
  const dx = B.cx - A.cx, dz = B.cz - A.cz;
  for (const ax of [A.ax, A.az, B.ax, B.az]) {
    const pa = A.hw * Math.abs(A.ax[0] * ax[0] + A.ax[1] * ax[1]) + A.hd * Math.abs(A.az[0] * ax[0] + A.az[1] * ax[1]);
    const pb = B.hw * Math.abs(B.ax[0] * ax[0] + B.ax[1] * ax[1]) + B.hd * Math.abs(B.az[0] * ax[0] + B.az[1] * ax[1]);
    if (Math.abs(dx * ax[0] + dz * ax[1]) > pa + pb) return false;
  }
  return true;
}
export const inClear = (x, z) => VILLAGE_CLEAR.some(r => x > r.x0 + 0.5 && x < r.x1 - 0.5 && z > r.z0 + 0.5 && z < r.z1 - 0.5);
// specs: [{ w, d, garden, …}]. avoid: plots already taken (the hall). Returns [{ x, z, yaw, spec, lane, base, lo, hi, plot }]
export function placeHouses(T, specs, opts = {}) {
  const placed = [], jit = k => Math.sin(k * 12.9898) * 0.5, taken = [...(opts.avoid || [])];
  const farmBlocked = (x, z) => CLEAR.some((r, i) => i !== 1 && x > r.x0 - 1 && x < r.x1 + 1 && z > r.z0 - 1 && z < r.z1 + 1)
    || Math.hypot(x - MARKET.x, z - MARKET.z) < 11 || Math.hypot(x - FISH_MARKET.x, z - FISH_MARKET.z) < 11 || Math.hypot(x - STORE.x, z - STORE.z) < 14;
  // the spots to try: along every lane (not the entry), both sides, every 1.5 m — around the square first, then outward
  const cands = [];
  for (const L of LANES) {
    if (L.id === 'entry') continue;
    const len = polyLen(L.pts);
    for (let s = 2.5; s < len - 1; s += 1.5) for (const side of [1, -1]) { const P = along(L.pts, s); cands.push({ L, s, side, k: cands.length, P, dsq: Math.hypot(P.x - SQUARE.x, P.z - SQUARE.z) }); }
  }
  cands.sort((a, b) => a.dsq - b.dsq);
  const order = specs.map((s, i) => [s, i]).sort((a, b) => (b[0].w * b[0].d + (b[0].pen ? 20 : 0)) - (a[0].w * a[0].d + (a[0].pen ? 20 : 0)));
  for (const [spec] of order) {
    let done = false;
    const d = spec.shape === 'round' ? spec.r * 2 : spec.d;
    for (const c of cands) {
      if (c.used) continue;
      const P = c.P, nx = -P.tz * c.side, nz = P.tx * c.side, off = c.L.w / 2 + spec.garden + d / 2;
      const H = { x: P.x + nx * off, z: P.z + nz * off, yaw: Math.atan2(-nx, -nz) + jit(c.k) * 0.16 };
      const pl = plot(H, spec);
      if (taken.some(o => overlap(o, pl))) continue;
      if (pl.pts.some(([x, z]) => !inClear(x, z) || T.roadDistAt(x, z) < 6.5 || T.riverDistAt(x, z) < 11 || farmBlocked(x, z)
        || laneDist(x, z, c.L).d < 0.8 || Math.hypot(x - SQUARE.x, z - SQUARE.z) < SQUARE.r + 0.8)) continue;
      const body = corners(H, (spec.shape === 'round' ? spec.r * 2 : spec.w) + 0.8, d + 0.6), hs = body.map(([x, z]) => T.heightAt(x, z));
      const lo = Math.min(...hs), hi = Math.max(...hs);
      if (hi - lo > (spec.big ? 1.4 : 2.0)) continue;
      c.used = true; taken.push(pl);
      placed.push({ ...H, spec, lane: c.L, lo, hi, base: hi + 0.15, plot: pl });
      done = true;
      break;
    }
    if (!done && opts.log) opts.log('no spot for', spec.name);
  }
  return placed;
}
