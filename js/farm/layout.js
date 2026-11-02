// Farm layout: 8 building plots near the trailhead (same plot numbers as server/src/layout.js — keep in sync),
// the market stall, the farm store and the cleared ground. Each plot has its own frame: the building
// stands at the back (local z −6.5 … −1.5), the animals' pen is in front, the gate faces the walkway.
export const PLOTS = Array.from({ length: 8 }, (_, i) => {
  const col = i % 4, row = Math.floor(i / 4);
  return { i, x: -98 + col * 12, z: -186 + row * 14, yaw: row === 0 ? 0 : Math.PI };
});
export const PLOT_HW = 5.5, PLOT_HD = 6.5;
export const PEN = { x0: -4.2, x1: 4.2, z0: -0.6, z1: 5.6 };   // where animals walk (local)
export const MARKET = { x: -109, z: -173.5, yaw: Math.PI / 2 };
export const STORE = { x: -109, z: -184.5, yaw: Math.PI / 2 };
export const SIGN = { x: -114.5, z: -149 };                       // by the road, pointing to the farm
export const CLEAR = [{ x0: -116, x1: -54, z0: -196, z1: -161 }, { x0: -122, x1: -106, z0: -163, z1: -139 }];
export const FARM_CENTER = { x: -82, z: -178 };

// local plot coordinates -> world
export function toWorld(P, lx, lz) {
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
  return { x: P.x + lx * c + lz * s, z: P.z - lx * s + lz * c };
}
export const inFarm = (x, z) => CLEAR.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
