// Farm layout shared with the game (js/farm/layout.js has the same numbers — keep them in sync).
// 8 building plots in two rows near the trailhead; the rows are 21 m apart so an 8 m walkway runs
// between their gates (each plot is 13 m deep).
export const PLOTS = Array.from({ length: 8 }, (_, i) => {
  const col = i % 4, row = Math.floor(i / 4);
  return { x: -98 + col * 12, z: row === 0 ? -189 : -168, yaw: row === 0 ? 0 : Math.PI };
});
