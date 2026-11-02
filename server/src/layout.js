// Farm layout shared with the game (js/farm/layout.js has the same numbers — keep them in sync).
// 8 building plots in two rows near the trailhead, facing a walkway between the rows.
export const PLOTS = Array.from({ length: 8 }, (_, i) => {
  const col = i % 4, row = Math.floor(i / 4);
  return { x: -98 + col * 12, z: -186 + row * 14, yaw: row === 0 ? 0 : Math.PI };
});
