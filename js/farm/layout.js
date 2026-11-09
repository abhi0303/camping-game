// Farm layout (Farm World). The main road separates the two halves:
//  - south of the road: the farm — 8 building plots in two rows facing an 8 m walkway (same plot numbers as
//    server/src/layout.js — keep in sync) and the farm storage closing the east end of the walkway;
//  - north of the road: the Farm Store (with the farmer), the Market, the delivery truck and the goat field.
// Each plot has its own frame: the building at the back (local z −6.5 … −1.5), the pen in front with its
// gate on the walkway side (local z = 6), the plot's signboard next to the gate.
export const PLOTS = Array.from({ length: 8 }, (_, i) => {
  const col = i % 4, row = Math.floor(i / 4);
  return { i, x: -98 + col * 12, z: row === 0 ? -189 : -168, yaw: row === 0 ? 0 : Math.PI };
});
export const PLOT_HW = 5.5, PLOT_HD = 6.5;
export const PEN = { x0: -4.3, x1: 4.3, z0: -1.0, z1: 3.9 };     // where animals walk (local)
export const PEN_BOX = { x0: -5, x1: 5, z0: -1.7, z1: 6 };        // inside the pen fence (local)
export const GATE = { x: -1.25, z: 6, w: 2.5 };                   // hinge at x, opening to x + w
export const SIGN_AT = { x: 3.3, z: 7.1 };                        // the plot's signboard (local)
export const STORAGE = { x: -51, z: -178.5, yaw: -Math.PI / 2 };   // faces west, down the walkway

// across the road: a frame along the road (u: along it, v: away from the farm) at road distance s = 108
const R0 = { x: -101.82, z: -136.77 }, RT = { x: 0.925, z: 0.381 }, RN = { x: -0.381, z: 0.925 };
const uv = (u, v, yaw = 2.7512) => ({ x: R0.x + RT.x * u + RN.x * v, z: R0.z + RT.z * u + RN.z * v, yaw });
export const STORE = uv(0, 19);           // front (porch, steps) toward the road
export const MARKET = uv(17, 16);
export const TRUCK = uv(-12.5, 13.5);
export const GOATS = { c: uv(-21.5, 20.5), hu: 5.5, hv: 6.5 };    // fenced goat field (half sizes along u / v)
export const LAMPS = [uv(-8, 9), uv(8, 9), uv(13, 10), uv(22, 10)];
export const ROAD_U = { x: RT.x, z: RT.z }, ROAD_V = { x: RN.x, z: RN.z };
export const SIGN = { x: -114.5, z: -149 };                       // by the road on the farm side, pointing to the farm
export const STORE_SIGN = uv(-6.5, 7.6);                          // by the road on the store side
export const FISH_MARKET = uv(29, 31);    // east of the Market, set back from the road; the docks path leaves behind it
export const FISH_SIGN = uv(35.5, 19.5, 2.7512 + 0.6);                  // by the road, pointing to the Fish Market
export const CLEAR = [
  { x0: -116, x1: -42, z0: -196, z1: -161 },                      // the farm
  { x0: -122, x1: -106, z0: -163, z1: -139 },                     // path from the road
  { x0: -141, x1: -80, z0: -134, z1: -99 },                       // store, market, goat field
  { x0: -101, x1: -72, z0: -112, z1: -83 },                       // the Fish Market
];
export const FARM_CENTER = { x: -82, z: -178 };
export const STORE_CENTER = { x: STORE.x, z: STORE.z };

// local frame -> world (P: { x, z, yaw })
export function toWorld(P, lx, lz) {
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
  return { x: P.x + lx * c + lz * s, z: P.z - lx * s + lz * c };
}
// world -> local frame
export function toLocal(P, x, z) {
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw), dx = x - P.x, dz = z - P.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
export const inFarm = (x, z) => CLEAR.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
