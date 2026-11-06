// The game's icons: small hand-drawn SVGs (24 x 24) instead of emoji, so every phone shows the same art.
// Item icons are coloured; UI icons are single-colour (they take the text colour, "currentColor").
//   icon('egg')          -> '<svg ...>' for innerHTML
//   itemIcon('fish_small') -> the icon for a farm / backpack / material item id
//   iconImage('rv')      -> an <img> (for drawing on a canvas, e.g. the minimap)
//   noEmoji(text)        -> the text without emoji (for toasts and server messages)

const OL = '#2b2118';                 // outline colour of the coloured icons
const s = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" stroke="${OL}" stroke-width="1.1" stroke-linejoin="round"${extra}/>`;
const f = (d, fill) => `<path d="${d}" fill="${fill}"/>`;
const ln = (d, col = OL, w = 1.3) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ci = (cx, cy, r, fill, stroke = OL, sw = 1.1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`;
const el = (cx, cy, rx, ry, fill, stroke = OL, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.1"` : ''}${extra}/>`;

// ---------- coloured pictures ----------
const egg = (shell, spot, shine = 'rgba(255,255,255,.75)') => s('M12 3.2c3.4 0 6.4 5.4 6.4 10.1 0 4.2-2.8 7.4-6.4 7.4s-6.4-3.2-6.4-7.4C5.6 8.6 8.6 3.2 12 3.2z', shell)
  + (spot ? ci(14.6, 13.5, 0.9, spot, null) + ci(10.2, 16.2, 0.7, spot, null) + ci(13, 17.6, 0.5, spot, null) : '')
  + ln('M8.6 9.4c.6-1.8 1.6-3.2 2.6-3.8', shine, 1.6);
const bottle = (cap, label) => s('M9.5 2.8h5v3.1l1.6 2.6v11.6a1.8 1.8 0 0 1-1.8 1.8H9.7a1.8 1.8 0 0 1-1.8-1.8V8.5l1.6-2.6z', '#f4f6fa')
  + s('M9.2 2.2h5.6v2.4H9.2z', cap) + s('M7.9 11.6h8.2v5.6H7.9z', label) + ln('M10 9.4v9.2', 'rgba(255,255,255,.9)', 1.2);
const fish = (body, fin, belly, size = 1) => {
  const k = size;
  return `<g transform="translate(12 12) scale(${k}) translate(-12 -12)">`
    + s('M3.2 12c2.6-4 6.4-5.6 10-5.6 3.2 0 5.6 2 6.6 5.6-1 3.6-3.4 5.6-6.6 5.6-3.6 0-7.4-1.6-10-5.6z', body)
    + s('M3.4 12L.9 8.4v7.2z', fin) + s('M11 6.8c1-1.8 2.8-2.6 4.6-2.4l-1 2.4', fin)
    + f('M6 13.4c2.4 2.2 5 3 7.4 3 2.4 0 4.6-1.2 5.8-3.6-3 1-8.6 1.6-13.2.6z', belly)
    + ci(16.6, 10.8, 1, '#fff', OL, 0.8) + ci(16.8, 10.8, 0.45, OL, null) + ln('M13 9.2c.8 1.6.8 3.6 0 5.6', OL, 1) + '</g>';
};
const hen = (body, wing, comb = '#e0362a') => s('M5.5 13.5c0-4 2.6-6.6 6-6.6l1-2.6c1.2-1.4 3.6-1 4 .8.3 1.2-.3 2.4.3 3.4 1.6 2.4 2.4 4.4 2.4 6.8 0 3.6-3 6.2-6.8 6.2-4 0-6.9-3-6.9-8z', body)
  + s('M13 3.8c.6-1.4 1.8-1.6 2.4-.8.8-.8 2 0 1.6 1.2', comb) + s('M17.9 7.4l2.6 1-2.4 1.2z', '#f2b33a') + s('M17 10.2c.6.8.6 1.8 0 2.4-.6-.6-.8-1.6 0-2.4z', comb)
  + s('M7.6 13.4c1.6-.6 4.6-.4 6.2 1.4-1 2.4-3.4 3.4-5.6 2.6z', wing) + ci(15.6, 7.6, 0.75, OL, null)
  + ln('M10.4 20.6v1.8M13.4 20.6v1.8', '#d58a1e', 1.4);
const horse = (coat, mane, blaze = '') => s('M7 21.2c-.4-3.6.4-6.4 2-8.6L6.6 9.6c-.6-1 .2-2.2 1.4-1.8l2.4.8c.8-1.6 2.2-3 4-3.8l.4-2.4 1.6 2 1.2-1.6.2 2.6c1.6 1.2 2.4 3.4 2.2 5.6l-.8 3.2-1.6.4-1.6-2-2 1.4-.4 7.2z', coat)
  + s('M14.4 4.6c-1.6 1.6-2.6 3.6-3 6l-1.8 2.4c.4-2.8 1.6-6 4.8-8.4z', mane) + blaze
  + ci(15.8, 7.4, 0.75, OL, null) + ci(18.2, 13.4, 0.5, OL, null);
const shed = (wall, roof, door) => s('M3 10.5L12 4l9 6.5', roof) + s('M4.6 10v10.4h14.8V10L12 4.9z', wall) + s('M9.4 13.6h5.2v6.8H9.4z', door)
  + ln('M9.4 13.6l5.2 6.8M14.6 13.6l-5.2 6.8', OL, 0.9) + s('M2.2 11.2L12 3.8l9.8 7.4-1 1.2L12 6 3.2 12.4z', roof);

// a German Shepherd's head: tan with a black saddle and muzzle, ears up
const dogHead = (collar = '') => s('M5.2 9.6L4.6 2.8l4.4 4.4M18.8 9.6l.6-6.8L15 7.2', '#2b2420') + s('M5 9.4c0-3 3.2-5 7-5s7 2 7 5l-.6 4.6-3.6 5.4H9.2l-3.6-5.4z', '#c98a3e')
  + f('M7.4 5.8c1.4-1 3-1.4 4.6-1.4s3.2.4 4.6 1.4l-1.2 3.4H8.6z', '#2b2420') + s('M8.6 13.6c0-1.6 1.6-2.6 3.4-2.6s3.4 1 3.4 2.6l-.8 4.6c-.6 1.2-1.6 1.8-2.6 1.8s-2-.6-2.6-1.8z', '#e0b070')
  + s('M10.4 15.4h3.2l-.4 1.4h-2.4z', '#1c1714') + ci(9.2, 10.6, 0.8, OL, null) + ci(14.8, 10.6, 0.8, OL, null) + collar;
const PICS = {
  dog: dogHead(), guard_dog: dogHead(s('M7.6 20.2c2.6 1.2 6.2 1.2 8.8 0l-.4 1.6c-2.6 1-5.4 1-8 0z', '#d4a82a')),
  bone: s('M7.4 14.2l5.8-5.8c-.4-1.4.2-2.8 1.6-3 1.2-.2 2 .6 2.2 1.6 1-.2 1.8.6 1.6 1.8-.2 1.4-1.6 2-3 1.6l-5.8 5.8c.4 1.4-.2 2.8-1.6 3-1.2.2-2-.6-2.2-1.6-1 .2-1.8-.6-1.6-1.8.2-1.4 1.6-2 3-1.6z', '#f2ead8'),
  dog_treat: s('M10.6 15.6l-3.4 3.4c.4 1.2-.2 2.4-1.4 2.6-.9.1-1.6-.5-1.7-1.3-.8-.1-1.4-.8-1.3-1.7.2-1.2 1.4-1.8 2.6-1.4l3.4-3.4z', '#f2ead8')
    + s('M14.6 2.8c3.6 0 6.6 3 6.6 6.6 0 3.8-3.4 6.8-7.2 6.4-1.6-.2-3-1-4-2.2-.6-.8-1-1.8-1.2-2.8-.4-4.2 2-8 5.8-8z', '#b8572e')
    + ln('M13.2 5.6c1.6-.4 3.4.2 4.4 1.6', 'rgba(255,255,255,.6)', 1.4) + ci(16.6, 10.6, 0.7, '#8a3a1c', null) + ci(13.4, 11.6, 0.55, '#8a3a1c', null),
  thief: s('M4.6 21c.4-4.6 3.4-7.2 7.4-7.2s7 2.6 7.4 7.2z', '#f4f4f4') + f('M5.2 18.4h13.6v1.4H5.2zM6.2 16h11.6v1.4H6.2z', '#1c1c20')
    + s('M7 9.4c0-3.2 2.2-5.4 5-5.4s5 2.2 5 5.4-2.2 5-5 5-5-1.8-5-5z', '#c99468') + s('M6.6 7.6c.6-2.8 2.8-4.4 5.4-4.4s4.8 1.6 5.4 4.4z', '#1c1c20')
    + s('M6.6 8.8h10.8v2.4H6.6z', '#1c1c20') + ci(9.6, 10, 0.7, '#fff', null) + ci(14.4, 10, 0.7, '#fff', null) + s('M17.6 14.4c1.8 0 3 1.4 3 3.2s-1.4 3.4-3.2 3.4', '#8a5a30'),
  net: ln('M4 6c5-3 11-3 16 0M3 12h18M4 18c5 3 11 3 16 0M6 4.4c-1.6 5-1.6 10 0 15.2M12 3v18M18 4.4c1.6 5 1.6 10 0 15.2', '#c8a868', 1.5) + ci(4, 6, 1.1, '#6a6a70') + ci(20, 6, 1.1, '#6a6a70') + ci(4, 18, 1.1, '#6a6a70') + ci(20, 18, 1.1, '#6a6a70'),
  // a football: white with dark patches
  ball: ci(12, 12, 9.2, '#f6f4ee', '#3a3a40', 1.2) + f('M12 8.2l3.2 2.3-1.2 3.8h-4l-1.2-3.8z', '#26262c')
    + f('M12 2.8c1.2 0 2.4.3 3.4.8L12 5.6 8.6 3.6c1-.5 2.2-.8 3.4-.8zM20.8 10.2c.2 1.2.1 2.6-.3 3.8l-2.6-2.2 1-3.6c.9.6 1.5 1.3 1.9 2zM3.2 10.2c.4-.7 1-1.4 1.9-2l1 3.6L3.5 14c-.4-1.2-.5-2.6-.3-3.8zM8 20.2l1.4-3h5.2l1.4 3c-1.2.6-2.6 1-4 1s-2.8-.4-4-1z', '#26262c')
    + ln('M12 5.6v2.6M15.2 10.5l2.7-.8M14 14.3l1.6 2.6M10 14.3l-1.6 2.6M8.8 10.5l-2.7-.8', '#3a3a40', 1),
  coin: ci(12, 12, 9.2, '#f2c14e', '#a87a1c', 1.3) + ci(12, 12, 6.8, 'none', '#c99a2e', 1) + ln('M8.8 8.2h6.4M8.8 10.8h6.4M10.2 8.2c3.3 0 3.3 5.4 0 5.4H9l4.8 4.6', '#7a5412', 1.5),
  feed: s('M7.4 8.6C5 11.6 4.4 15.6 5.4 18.4c.8 2 3 2.8 6.6 2.8s5.8-.8 6.6-2.8c1-2.8.4-6.8-2-9.8z', '#d9b77a') + s('M7 6.6h10l-.6 2.4H7.6z', '#b48a4a')
    + ln('M12 6.6V2.4', '#8a6a2a', 1.2) + el(10.4, 3.4, 1.1, 0.6, '#f0c94a', '#8a6a2a') + el(13.6, 3.4, 1.1, 0.6, '#f0c94a', '#8a6a2a') + el(10.6, 5.2, 1.1, 0.6, '#f0c94a', '#8a6a2a') + el(13.4, 5.2, 1.1, 0.6, '#f0c94a', '#8a6a2a')
    + ln('M8.6 13.6c2 .8 4.8.8 6.8 0', '#a07a3a', 1.1),
  egg: egg('#fbf6ea', ''), egg_brown: egg('#c98a55', '#9a5f30'), egg_dark: egg('#3d3a48', '#57536a', 'rgba(255,255,255,.4)'),
  goat_milk: bottle('#5bb36a', '#dff3e2') + ln('M10 14.4h4', '#3f8a4c', 1.2),
  cow_milk: bottle('#3f7fd6', '#dde9fb') + ci(10.6, 14.4, 0.8, OL, null) + ci(13.2, 13.6, 0.6, OL, null),
  wood: s('M3.4 14.6l11-5.4 4 7.2-11 5.4z', '#a8743f') + el(18.4, 12.8, 2.6, 3.8, '#e8c088', OL, ' transform="rotate(-27 18.4 12.8)"') + el(18.4, 12.8, 1.1, 1.8, 'none', '#b07c40', ' transform="rotate(-27 18.4 12.8)"')
    + s('M2.6 9.4l9.6-4.6 3.4 6-9.6 4.6z', '#95622f') + el(13.9, 7.8, 2.2, 3.4, '#e8c088', OL, ' transform="rotate(-27 13.9 7.8)"') + ci(13.9, 7.8, 0.7, '#b07c40', null),
  stone: s('M2.8 18.6l2.6-6.2 4.4-2.4 3.4 2.2 1.4 6.6z', '#9aa1a8') + s('M10.6 19.2l2.2-8.6 4.6-3.6 3.8 3.4.6 8.8z', '#b9bfc5') + ln('M15 12l1.6 2.6M6.4 14.6l1.6 1.4', '#7d848c', 1),
  worms: ln('M4 17.4c1.6-3 4-3 5 0s3.4 3 5 0 3.4-3 5.4-.6', '#b4566a', 4.2) + ln('M4 17.4c1.6-3 4-3 5 0s3.4 3 5 0 3.4-3 5.4-.6', '#ef8fa0', 2.6) + ci(19.6, 16.6, 0.5, OL, null),
  fish_small: fish('#8fb6c9', '#5f8ba3', '#d8e7ee', 0.8), fish_medium: fish('#f29a4a', '#d0672a', '#ffe0bf', 0.92), fish_large: fish('#4f9a7a', '#2f6e55', '#cfe8c8', 1.04),
  chicken: hen('#f7f3ea', '#e2dccc'), chicken_brown: hen('#b76a35', '#8f4e24'), chicken_dark: hen('#3a3842', '#55525f'),
  goat: s('M6.4 7.4C4 6.4 2.4 4 2.6 2.6c1.6.6 3.6 1.8 5 3.6M17.6 7.4c2.4-1 4-3.4 3.8-4.8-1.6.6-3.6 1.8-5 3.6', '#cdbb94')
    + s('M7 8.4c0-1.6 2.2-3.2 5-3.2s5 1.6 5 3.2l-1 7.6c-.4 2.6-2 4.6-4 4.6s-3.6-2-4-4.6z', '#e9e4da') + s('M4.6 9.6l2.6-.6.4 1.8-2 .6zM19.4 9.6l-2.6-.6-.4 1.8 2 .6z', '#d8d0c0')
    + ci(9.8, 10.6, 0.8, OL, null) + ci(14.2, 10.6, 0.8, OL, null) + s('M10.4 16.6h3.2l-.6 1.6h-2z', '#e6a3a3') + s('M11 20.4l1 2.4 1-2.4', '#cfc6b4'),
  cow: s('M3 8.2c1.6-.4 3.2.2 4 1.2M21 8.2c-1.6-.4-3.2.2-4 1.2', '#e9e4da') + s('M5.8 6.4c-.6-1.4-.4-2.6.4-3.2M18.2 6.4c.6-1.4.4-2.6-.4-3.2', 'none')
    + s('M6.4 9c0-2.4 2.6-4 5.6-4s5.6 1.6 5.6 4l-.6 6H7z', '#f4f1ea') + f('M7.6 6.8c1.4-1 3-1.2 4 .2.4 1.4-.8 2.8-2.6 2.6-1.2-.2-1.8-1.6-1.4-2.8zM15.6 10.6c1-.2 1.8.4 1.6 1.6l-.2 1.4c-1 0-2-.8-1.4-3z', '#2f2c33')
    + ci(9.6, 10.6, 0.8, OL, null) + ci(14.4, 10.6, 0.8, OL, null) + s('M6.8 14.2h10.4c.6 3.4-1.8 6.4-5.2 6.4s-5.8-3-5.2-6.4z', '#f0a8a8') + ci(10, 17.2, 0.8, '#b06060', null) + ci(14, 17.2, 0.8, '#b06060', null)
    + s('M7.8 5.6L6.4 3M16.2 5.6L17.6 3', 'none'),
  horse: horse('#8b4a2b', '#2b1d14'), horse_bay: horse('#8b4a2b', '#2b1d14'), horse_chestnut: horse('#b5602e', '#7a3a18'), horse_black: horse('#2e2b31', '#141216'),
  horse_white: horse('#f1ede4', '#c9c2b4'), horse_palomino: horse('#d9a441', '#f4ead0'),
  horse_pinto: horse('#f1ede4', '#3a2a20', f('M8.6 15.4c1.2-1.4 3-1.2 3.6.4.4 1.6-.6 3.6-2.2 4.6l-1.4.4c-.4-1.8-.6-3.8 0-5.4zM16 9.6c1 .2 1.6 1.2 1.2 2.2l-1.4.4c-.6-.8-.6-2 .2-2.6z', '#7a4a2a')),
  coop: shed('#d9583f', '#7a3a24', '#f2d6a8'), goat_shed: shed('#b88a52', '#5f4a32', '#e8d2a8'), barn: shed('#c7362e', '#f1ede4', '#f1ede4'),
  stable: shed('#a8743f', '#4f3a28', '#e8d2a8') + s('M10 15.4a2 2 0 1 1 4 0v3.2h-1.2v-3a.8.8 0 1 0-1.6 0v3H10z', '#c9ccd2'),
  storage: s('M3.6 8.4L12 4.4l8.4 4v10L12 22.4l-8.4-4z', '#c99a5a') + s('M3.6 8.4L12 12.4l8.4-4L12 4.4z', '#e3b97a') + ln('M12 12.4v10M7.8 6.4l8.4 4', OL, 1.1),
  rod: ln('M3.4 20.6L18.6 3.4', '#7a4a24', 1.8) + ln('M18.6 3.4c1.4 3 1.6 7.4.6 11.6', '#e8e4da', 0.8) + s('M18.4 15.2c.9 0 1.6.8 1.6 1.7 0 1.2-1 2.2-1.6 2.9-.6-.7-1.6-1.7-1.6-2.9 0-.9.7-1.7 1.6-1.7z', '#e0362a') + ci(6.6, 17.4, 1.6, '#3a3f55'),
  // backpack items (Zombie Trail) and materials
  logs: '', planks: s('M3 8.4l18-2.4v3.6L3 12z', '#d9a66a') + s('M3 12.8l18-2.4V14L3 16.4z', '#c48f52') + s('M3 17.2l18-2.4v3.6L3 20.8z', '#d9a66a'),
  rope: s('M12 4.4c4.4 0 7.4 2.6 7.4 5.8s-3 5.8-7.4 5.8-7.4-2.6-7.4-5.8 3-5.8 7.4-5.8z', 'none') + ln('M12 4.4c4.4 0 7.4 2.6 7.4 5.8s-3 5.8-7.4 5.8-7.4-2.6-7.4-5.8 3-5.8 7.4-5.8z', '#c99a5a', 3.4) + ln('M12 7.4c2.6 0 4.4 1.2 4.4 2.8S14.6 13 12 13s-4.4-1.2-4.4-2.8S9.4 7.4 12 7.4z', '#c99a5a', 2.6) + ln('M7.4 15l-2 5.6M9.6 15.8l-.6 5', '#a8783a', 2.2),
  drone: s('M8 10.6h8l1 3H7z', '#4a5068') + ln('M7.6 11.4L4.4 8.6M16.4 11.4l3.2-2.8M7.6 13l-3.2 2.8M16.4 13l3.2 2.8', '#2f3448', 1.6) + el(4.2, 8.2, 2.6, 0.7, '#9fd3ff') + el(19.8, 8.2, 2.6, 0.7, '#9fd3ff') + el(4.2, 16.2, 2.6, 0.7, '#9fd3ff') + el(19.8, 16.2, 2.6, 0.7, '#9fd3ff') + ci(12, 14.6, 1, '#e0362a'),
  chainsaw: s('M9.6 8.4h11.2a1.6 1.6 0 0 1 0 3.2H9.6z', '#c9ccd2') + ln('M10.6 8.4v3.2M13 8.4v3.2M15.4 8.4v3.2M17.8 8.4v3.2', '#7d848c', .8) + s('M2.8 7.4h7.6v7.2H4.4a1.6 1.6 0 0 1-1.6-1.6z', '#f28a2a') + s('M4 14.6l.6 3.6h4.4l1-3.6', '#3a3f55'),
  axe: ln('M6 21L16.4 6.4', '#9a6a3a', 2.2) + s('M13.4 4.6c2.2-1.6 5.2-1.6 7 0l-1 1.2c-.6 2.2-.4 4.4.6 6.4-2.4.4-4.6-.4-6-2l1.4-2.2z', '#c9ccd2'),
  sledge: ln('M5 21L14.6 8.4', '#9a6a3a', 2.2) + s('M10.6 6.6l4.2-3.4 6 7.2-4.2 3.4z', '#7d848c'),
  hammer: ln('M5.4 20.6l8.8-9.4', '#9a6a3a', 2.2) + s('M11 6.2l3.4-2.8 2 1.8 3-.4 1.2 1.4-3 2.2-1.4 4.4-1.8 1.4z', '#9aa1a8'),
  flashlight: s('M4.6 15.8l7-7 3.6 3.6-7 7a2.5 2.5 0 0 1-3.6-3.6z', '#3a3f55') + s('M11.6 8.8l2.8-4.2 5 5-4.2 2.8z', '#9aa1a8') + f('M15.6 4l5.6-2v8.6l-1.8 1.4z', 'rgba(255,230,140,.85)'),
  binoculars: ci(7, 15.4, 4, '#3a3f55') + ci(17, 15.4, 4, '#3a3f55') + ci(7, 15.4, 2.2, '#9fd3ff', null) + ci(17, 15.4, 2.2, '#9fd3ff', null) + s('M5 11.6l1.4-6h3l1 6M19 11.6l-1.4-6h-3l-1 6', '#4a5068') + s('M10 9.6h4v3h-4z', '#2f3448'),
  tent: s('M12 3.6L2.4 20.4h19.2z', '#3fa36a') + s('M12 3.6l-3.2 16.8h6.4z', '#2c7a4c') + s('M12 10.4l-2 10h4z', '#173f28') + ln('M1.8 20.6h20.4', OL, 1.3),
  chair: s('M6 4.4h12l-1 7.2H7z', '#3f7fd6') + s('M5.4 11.6h13.2v2.4H5.4z', '#2f5a9a') + ln('M7 14l-1.6 6.6M17 14l1.6 6.6M8.4 14l7.2 6.6M15.6 14l-7.2 6.6', '#4a5068', 1.3),
  sleepingbag: s('M3.4 9.4c0-2.2 1.8-3.8 4-3.8h13.2v11.6H7.4c-2.2 0-4-1.6-4-3.8z', '#e07a3a') + s('M3.4 9.4c0-2.2 1.8-3.8 4-3.8h2.4v11.6H7.4c-2.2 0-4-1.6-4-3.8z', '#f2c14e') + ln('M13 5.6v11.6M16.6 5.6v11.6', '#b85a24', 1),
  lantern: s('M9 3.6h6l1 2.2H8z', '#4a5068') + s('M7.6 5.8h8.8l-1 12.4H8.6z', 'rgba(255,214,110,.95)') + ci(12, 12, 2.4, '#fff3c4', null) + s('M7.6 18.2h8.8v2.4H7.6z', '#4a5068') + ln('M10 3.6c0-1.6 4-1.6 4 0', OL, 1.1),
  water: s('M12 2.8c3 4.2 6 7.6 6 11.2a6 6 0 0 1-12 0c0-3.6 3-7 6-11.2z', '#5aa9ff') + ln('M9.2 13.4c0 2 1.2 3.6 3 4', 'rgba(255,255,255,.85)', 1.5),
  sandwich: s('M3 13.4L12 6l9 7.4z', '#f0cf8a') + s('M2.6 13.4h18.8v2.2H2.6z', '#5bb36a') + s('M3 15.6h18v1.8H3z', '#e0362a') + s('M3 17.4h18l-1 2.4H4z', '#f0cf8a'),
  soda: s('M7.4 5.4h9.2l-1.2 15.2H8.6z', '#e0362a') + s('M7.6 9.6h8.8l-.4 4.8H8z', '#fff') + ln('M12.6 5.4l1.6-3.2 2.4-.4', '#4a5068', 1.3),
  locker: s('M3 9h18v10.6H3z', '#e0362a') + s('M3 9h18v3H3z', '#b82a20') + s('M9 6.2h6V9H9z', 'none') + s('M10 12h4v2.4h-4z', '#c9ccd2'),
  fridge: s('M6 2.8h12v18.4H6z', '#dfe8ef') + ln('M6 9.6h12M8.4 5v2.6M8.4 12v3.6', '#7d848c', 1.3),
  // map places
  flag: ln('M6 21.4V3', OL, 1.8) + s('M6 3.6h12l-2.8 4 2.8 4H6z', '#e0362a'),
  tools: hammerX(),
  bridge: s('M2 14h20v2.6H2z', '#a8743f') + ln('M4 14V9M20 14V9M4 9c4 4 12 4 16 0M8 14v-2.8M12 14v-2.2M16 14v-2.8', '#5f4a32', 1.4) + f('M2 18.4c2 1.6 4 1.6 6 0s4-1.6 6 0 4 1.6 6 0v3H2z', '#5aa9ff'),
  warn: s('M12 3.4l9.6 17H2.4z', '#f2c14e') + ln('M12 9.6v5.4', OL, 2) + ci(12, 17.6, 1.1, OL, null),
  tree: s('M12 2.6l6.6 9.4h-3l4.2 6H4.2l4.2-6h-3z', '#3f8f3a') + s('M10.6 18h2.8v3.6h-2.8z', '#7a4a24'),
  rock: s('M3 19.4l2.8-7.4 5-3.6 4.4 1.6 4.4 4.2 1.4 5.2z', '#9aa1a8') + ln('M10.8 8.4l1.2 5.2 3.2-3.6M12 13.6l-3.6 5.8', '#7d848c', 1),
  crate: s('M3.4 5.4h17.2v14.2H3.4z', '#c99a5a') + ln('M3.4 5.4l17.2 14.2M20.6 5.4L3.4 19.6', '#8a6430', 1.4) + s('M3.4 5.4h17.2v2.4H3.4zM3.4 17.2h17.2v2.4H3.4z', '#a8783a'),
  camp: s('M12 4L3 19.4h18z', '#e07a3a') + s('M12 10.6l-3 8.8h6z', '#5f2e14') + s('M17.6 20.4c-.6-1.6 0-2.8 1-3.6.2 1 .8 1.4 1.4 1.8.6.8.4 1.6-.2 1.8z', '#f2c14e'),
  tower: s('M7 21.4l1.4-12h7.2l1.4 12z', '#a8743f') + s('M5.6 5.4h12.8v4H5.6z', '#8a5a2a') + ln('M5.6 5.4V3.2M9.8 5.4V3.2M14.2 5.4V3.2M18.4 5.4V3.2', OL, 1.4) + s('M10.6 14.6h2.8v6.8h-2.8z', '#5f3a1a'),
  castle: s('M3 21h18V9.4h-2.4v2.2h-2.2V9.4h-2.2v2.2h-4.4V9.4H7.6v2.2H5.4V9.4H3z', '#9aa1a8') + s('M9.8 21v-4.4a2.2 2.2 0 0 1 4.4 0V21z', '#5f4a32') + ln('M12 9.4V3.2', OL, 1.2) + s('M12 3.2h4.6L15.2 5l1.4 1.8H12z', '#e0362a'),
  giant: s('M6.4 8.6c0-3.4 2.4-5.6 5.6-5.6s5.6 2.2 5.6 5.6v6c0 3.6-2.4 6.6-5.6 6.6s-5.6-3-5.6-6.6z', '#8a9098') + s('M8.4 9.6h2.8v1.8H8.4zM12.8 9.6h2.8v1.8h-2.8z', '#2b2f38') + ln('M9.6 16h4.8M12 11.6v2.4', '#2b2f38', 1.4),
  rv: s('M2 15.6V7.4c0-1 .8-1.8 1.8-1.8h12.6c.8 0 1.4.4 1.8 1l2.8 4.4c.4.6.6 1.2.6 2v2.6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z', '#f1ede4') + s('M17 7.6h-2.6v4h5.2z', '#9fd3ff') + s('M4.4 8h3.6v3H4.4zM9.4 8h3.6v3H9.4z', '#9fd3ff')
    + f('M2 12.8h19.6v1.4H2z', '#3f7fd6') + ci(6.4, 17.4, 2, '#3a3f55') + ci(16.6, 17.4, 2, '#3a3f55') + ci(6.4, 17.4, 0.8, '#c9ccd2', null) + ci(16.6, 17.4, 0.8, '#c9ccd2', null),
  store: s('M3.6 10.4h16.8v10H3.6z', '#c7362e') + s('M2.4 10.4l2-5.6h15.2l2 5.6z', '#f1ede4') + ln('M6 4.8l-.6 5.6M10 4.8l-.4 5.6M14 4.8l.4 5.6M18 4.8l.6 5.6', '#c7362e', 1.6) + s('M9.4 14h5.2v6.4H9.4z', '#f2d6a8'),
  market: s('M3.6 11h16.8v9.4H3.6z', '#d9a66a') + s('M2.4 11l1.6-5.4h16l1.6 5.4z', '#3fa36a') + ln('M7.4 5.6L6.8 11M12 5.6V11M16.6 5.6l.6 5.4', '#f1ede4', 1.6) + el(8, 15.6, 2, 1.6, '#e0362a') + el(13, 15.8, 1.8, 1.6, '#f2c14e') + el(16.8, 16, 1.6, 1.4, '#5bb36a'),
  plot: s('M2.4 19.4l4-6.4h11.2l4 6.4z', '#8a5a2a') + ln('M12 13V6.6', '#3f8f3a', 1.6) + s('M12 9.4C10 9.4 8.2 8 8 5.6c2.2 0 3.8 1.2 4 3.8zM12 8c.2-2.4 1.8-3.8 4-3.8-.2 2.4-1.8 3.8-4 3.8z', '#5bb36a'),
  farmer: s('M5 21c0-3.8 3.2-6.4 7-6.4s7 2.6 7 6.4z', '#3f7fd6') + ci(12, 10, 3.6, '#f0c49a') + s('M4.6 8.4c1.6-.6 3.4-.8 4-1.2.6-2.4 1.8-3.8 3.4-3.8s2.8 1.4 3.4 3.8c.6.4 2.4.6 4 1.2-2.2 1.2-12.6 1.2-14.8 0z', '#e8c46a') + ln('M10.4 21v-6.2M13.6 21v-6.2', '#2c5aa0', 1.2),
  fisher: s('M5 21c0-3.8 3.2-6.4 7-6.4s7 2.6 7 6.4z', '#f2c14e') + ci(12, 10.2, 3.6, '#e8b48a') + s('M8.4 9.4c.4-3 1.8-4.6 3.6-4.6s3.2 1.6 3.6 4.6z', '#3fa36a') + s('M8.6 11.6c.8 2.6 2 3.6 3.4 3.6s2.6-1 3.4-3.6c-1 .8-5.8.8-6.8 0z', '#7a4a24'),
};
// a hammer and a wrench, crossed (the workbench)
function hammerX() {
  return ln('M5 19L16 8', '#9a6a3a', 2.2) + s('M13.6 4.4l3-2.4 4.8 4.8-2.4 3z', '#9aa1a8') + ln('M19 19L9.4 9.4', '#7d848c', 2.2) + s('M5.2 4.2a3.4 3.4 0 0 0 4.4 4.4l-1.6-.4-1.4-1.4-.4-1.6z', '#9aa1a8');
}
PICS.logs = PICS.wood;
PICS.worm_pack = PICS.worms;
PICS.chicken_white = PICS.chicken;

// ---------- single-colour UI icons (stroke = currentColor) ----------
const U = (d, extra = '') => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${extra}`;
const UF = d => `<path d="${d}" fill="currentColor"/>`;
const UI = {
  sun: U('M12 2.6v2.2M12 19.2v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6', '<circle cx="12" cy="12" r="4.4" fill="currentColor"/>'),
  moon: UF('M20 14.6A8.4 8.4 0 0 1 9.4 4a8.4 8.4 0 1 0 10.6 10.6z'),
  sunrise: U('M12 3v4.4M9.6 5.4L12 3l2.4 2.4M4.2 11.4l1.4 1.4M19.8 11.4l-1.4 1.4M2 19h20M5 21.4h14', '<path d="M7 19a5 5 0 0 1 10 0z" fill="currentColor"/>'),
  sunset: U('M12 7.4V3M9.6 5L12 7.4 14.4 5M4.2 11.4l1.4 1.4M19.8 11.4l-1.4 1.4M2 19h20M5 21.4h14', '<path d="M7 19a5 5 0 0 1 10 0z" fill="currentColor"/>'),
  clock: U('M12 7v5l3.2 2', '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'),
  users: U('M2.6 20c0-3.4 2.8-5.8 6.4-5.8s6.4 2.4 6.4 5.8M15.4 14.4c3.2.2 5.8 2.4 6 5.6M15 4.6a3.6 3.6 0 0 1 0 7', '<circle cx="9" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/>'),
  user: U('M4.4 20.6c0-4 3.4-6.6 7.6-6.6s7.6 2.6 7.6 6.6', '<circle cx="12" cy="7.8" r="4" fill="none" stroke="currentColor" stroke-width="2"/>'),
  mic: U('M5.6 11a6.4 6.4 0 0 0 12.8 0M12 17.4V21M8.6 21h6.8', '<rect x="8.6" y="2.6" width="6.8" height="11.4" rx="3.4" fill="currentColor"/>'),
  micOff: U('M5.6 11a6.4 6.4 0 0 0 10.4 5M18.4 11c0 .8-.2 1.6-.4 2.4M12 17.4V21M8.6 21h6.8M3 3l18 18', '<path d="M15.4 10.4V6a3.4 3.4 0 0 0-6.6-1.2zM8.6 9.6V11a3.4 3.4 0 0 0 5.4 2.8z" fill="currentColor"/>'),
  music: U('M9 17.5V5.6l11-2.3v12', '<circle cx="6.4" cy="17.5" r="2.7" fill="currentColor"/><circle cx="17.4" cy="15.3" r="2.7" fill="currentColor"/>'),
  speaker: U('M15.6 8.6a5 5 0 0 1 0 6.8M18.4 5.8a9 9 0 0 1 0 12.4', '<path d="M3 9.4h3.8L12 5v14l-5.2-4.4H3z" fill="currentColor"/>'),
  speakerOff: U('M16 9.4l5 5.2M21 9.4l-5 5.2', '<path d="M3 9.4h3.8L12 5v14l-5.2-4.4H3z" fill="currentColor"/>'),
  refresh: U('M20.4 12a8.4 8.4 0 0 1-14.6 5.6M3.6 12a8.4 8.4 0 0 1 14.6-5.6M18.6 2.6v4h-4M5.4 21.4v-4h4'),
  target: U('', '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>'),
  check: U('M4.4 12.6l4.8 4.8L19.8 6.8'),
  checkCircle: U('M7.6 12.4l3 3 6-6.4', '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2"/>'),
  close: U('M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4'),
  warn: U('M12 9.4v4.4', '<path d="M10.3 3.9L2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="17.2" r="1.2" fill="currentColor"/>'),
  info: U('M12 11v5.6', '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7.6" r="1.2" fill="currentColor"/>'),
  lock: U('M7.4 10.4V7.6a4.6 4.6 0 0 1 9.2 0v2.8', '<rect x="4.6" y="10.4" width="14.8" height="10.6" rx="2.2" fill="currentColor"/>'),
  bag: U('M8.6 7.4V5.8a3.4 3.4 0 0 1 6.8 0v1.6', '<path d="M5.2 8.6c0-.7.5-1.2 1.2-1.2h11.2c.7 0 1.2.5 1.2 1.2l1 11a1.6 1.6 0 0 1-1.6 1.8H5.8a1.6 1.6 0 0 1-1.6-1.8z" fill="currentColor"/><path d="M8.6 11.4v1.4M15.4 11.4v1.4" stroke="rgba(0,0,0,.45)" stroke-width="2" stroke-linecap="round"/>'),
  book: U('M12 6.6C10.2 5 7.6 4.4 3.4 4.6v14c4.2-.2 6.8.4 8.6 2 1.8-1.6 4.4-2.2 8.6-2v-14c-4.2-.2-6.8.4-8.6 2zM12 6.6v14'),
  slip: U('M8.4 8.6h7.2M8.4 12h7.2M8.4 15.4h4.4', '<path d="M5 2.6h14v18.8l-2.4-1.6-2.4 1.6-2.2-1.6-2.2 1.6-2.4-1.6L5 21.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  heart: UF('M12 20.6l-1.3-1.2C5.6 14.8 2.4 12 2.4 8.4A4.9 4.9 0 0 1 7.4 3.4c1.7 0 3.4.8 4.6 2.1 1.2-1.3 2.9-2.1 4.6-2.1a4.9 4.9 0 0 1 5 5c0 3.6-3.2 6.4-8.3 11z'),
  store: U('M3.6 9.6h16.8M5 9.6V20.4h14V9.6M9.6 20.4v-5.6h4.8v5.6', '<path d="M3 9.6L5 4h14l2 5.6c0 1.4-1.2 2.4-2.6 2.4s-2.4-1-2.4-2.4c0 1.4-1.2 2.4-2.6 2.4-1.4 0-2.4-1-2.4-2.4 0 1.4-1 2.4-2.4 2.4S7 11 7 9.6c0 1.4-1.2 2.4-2.6 2.4S3 11 3 9.6z" fill="currentColor"/>'),
  cart: U('M2.4 3.6h2.8l2.4 11.6h10.6l2.2-8H6.2', '<circle cx="9" cy="19.4" r="1.7" fill="currentColor"/><circle cx="17" cy="19.4" r="1.7" fill="currentColor"/>'),
  box: U('M3.6 7.6L12 3.4l8.4 4.2v8.8L12 20.6l-8.4-4.2zM3.6 7.6L12 11.8l8.4-4.2M12 11.8v8.8'),
  sprout: U('M12 21.4V11', '<path d="M12 12.6C8.6 12.6 6 10.2 5.8 6.4c3.6 0 6 2.2 6.2 6.2zM12 10.4c.2-3.8 2.6-6 6.2-6-.2 3.8-2.6 6-6.2 6z" fill="currentColor"/>'),
  wheat: U('M12 21.4V8.4', '<path d="M12 9.4c-2-.2-3.2-1.6-3.2-3.6 2 .2 3.2 1.6 3.2 3.6zM12 9.4c2-.2 3.2-1.6 3.2-3.6-2 .2-3.2 1.6-3.2 3.6zM12 13.6c-2-.2-3.2-1.6-3.2-3.6 2 .2 3.2 1.6 3.2 3.6zM12 13.6c2-.2 3.2-1.6 3.2-3.6-2 .2-3.2 1.6-3.2 3.6zM12 17.8c-2-.2-3.2-1.6-3.2-3.6 2 .2 3.2 1.6 3.2 3.6zM12 17.8c2-.2 3.2-1.6 3.2-3.6-2 .2-3.2 1.6-3.2 3.6zM12 5.6c-.8-1-.8-2.2 0-3.2.8 1 .8 2.2 0 3.2z" fill="currentColor"/>'),
  door: U('M14.4 3.4H5.6v17.2h8.8M10.4 12h10.4M17.4 8.4L21 12l-3.6 3.6'),
  crown: UF('M3 8l4.4 3.6L12 4.4l4.6 7.2L21 8l-1.8 10.4H4.8zM4.8 19.8h14.4v1.8H4.8z'),
  home: U('M3.4 11.4L12 4l8.6 7.4M5.6 9.6v11h12.8v-11M10 20.6v-5.8h4v5.8'),
  plus: U('M12 5v14M5 12h14'),
  minus: U('M5 12h14'),
  logout: U('M9.6 3.6H4.6v16.8h5M15.4 7.6L20 12l-4.6 4.4M20 12H9'),
  trash: U('M4 6.6h16M9.4 6.6V4h5.2v2.6M6.2 6.6l1 14h9.6l1-14M10.2 10.4v6.4M13.8 10.4v6.4'),
  trophy: U('M7.4 4h9.2v5.4a4.6 4.6 0 0 1-9.2 0zM7.4 6H4c0 3 1.4 4.6 3.8 4.8M16.6 6H20c0 3-1.4 4.6-3.8 4.8M12 14v3.4M8 20.6h8M9.4 17.4h5.2v3.2H9.4z'),
  skull: U('M9 21v-2.4M15 21v-2.4M12 21v-2.4', '<path d="M12 2.8c-4.8 0-8 3.4-8 7.6 0 2.6 1.2 4.4 3 5.6v2.6h10V16c1.8-1.2 3-3 3-5.6 0-4.2-3.2-7.6-8-7.6z" fill="currentColor"/><circle cx="8.8" cy="11" r="1.9" fill="rgba(0,0,0,.75)"/><circle cx="15.2" cy="11" r="1.9" fill="rgba(0,0,0,.75)"/>'),
  down: U('M12 4v14.4M6 12.6l6 6 6-6'),
  signal: U('M4 20v-3M9.4 20v-6.4M14.6 20V10M20 20V5.6'),
  link: U('M10.4 13.6a4 4 0 0 0 6 .4l3-3a4.2 4.2 0 0 0-6-6l-1.6 1.6M13.6 10.4a4 4 0 0 0-6-.4l-3 3a4.2 4.2 0 0 0 6 6l1.6-1.6'),
  copy: U('M5 15V6a2 2 0 0 1 2-2h9', '<rect x="9" y="8" width="11" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>'),
  fire: UF('M12 21.6c-4 0-7-2.8-7-6.8 0-3.4 2.2-5.4 3.6-7.6.4 1.8 1.2 2.8 2.4 3.4C11 6.8 12.6 4 15.6 2.4c-.6 3 .6 4.8 2 6.8 1.2 1.6 1.8 3.4 1.4 5.8-.6 4-3.4 6.6-7 6.6zm0-2c1.6 0 3-1.2 3-3 0-1.4-.8-2.4-1.8-3.6-.4 1-1.2 1.6-2.2 1.8-.6-1-.6-2-.2-3-1.8 1.2-1.8 3.4-1.8 4.8 0 1.8 1.4 3 3 3z'),
  hourglass: U('M6.4 2.8h11.2M6.4 21.2h11.2M7.6 2.8c0 4.6 4.4 6 4.4 9.2s-4.4 4.6-4.4 9.2M16.4 2.8c0 4.6-4.4 6-4.4 9.2s4.4 4.6 4.4 9.2'),
  pause: UF('M6.6 4.4h3.8v15.2H6.6zM13.6 4.4h3.8v15.2h-3.8z'),
  play: UF('M7 4.2v15.6L19.6 12z'),
  fullscreen: U('M3.6 9V3.6H9M15 3.6h5.4V9M20.4 15v5.4H15M9 20.4H3.6V15'),
  phone: U('M10.6 18.4h2.8', '<rect x="6.2" y="2.4" width="11.6" height="19.2" rx="2.4" fill="none" stroke="currentColor" stroke-width="2"/>'),
  share: U('M12 3v12.4M7.6 7.4L12 3l4.4 4.4M5.4 12.4v7.4a1.4 1.4 0 0 0 1.4 1.4h10.4a1.4 1.4 0 0 0 1.4-1.4v-7.4'),
  star: UF('M12 2.6l2.9 6 6.5.8-4.8 4.5 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.6 9.4l6.5-.8z'),
  leaf: UF('M20.4 3.6c-9.6-.6-15.6 3.6-15.6 10.4 0 1.6.4 3 1 4.2L3.6 20.4l1.4 1.4 2.4-2.4c1.2.8 2.8 1.2 4.4 1.2 6.4 0 9.4-6.4 8.6-17zM8.4 17.4c1.6-3.6 4.4-6.6 8-8.6-3 2.6-5.4 5.6-6.6 9.4z'),
  rod: U('M3.6 20.4L18.4 3.6M18.4 3.6c1.6 3.2 1.6 7.4.6 11.4', '<path d="M19 15c1 0 1.6.8 1.6 1.6 0 1.2-1 2.2-1.6 3-.6-.8-1.6-1.8-1.6-3 0-.8.6-1.6 1.6-1.6z" fill="currentColor"/>'),
  fish: UF('M2.6 12c2.8-4 6.4-5.6 10-5.6 3.4 0 6 2 7.4 5.6-1.4 3.6-4 5.6-7.4 5.6-3.6 0-7.2-1.6-10-5.6zm-.6 0L0 8.4v7.2zM16 10.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z'),
  invite: U('M2.6 20c0-3.4 2.8-5.8 6.4-5.8s6.4 2.4 6.4 5.8M19 8v6M16 11h6', '<circle cx="9" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/>'),
  key: U('M14 10l7-7M18 6l2.4 2.4M16 8l2 2', '<circle cx="8.6" cy="15.4" r="5" fill="none" stroke="currentColor" stroke-width="2"/>'),
  wave: U('M2.4 9c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 3.2-1.6 4.8 0 3.2 1.6 4.8 0M2.4 15c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 3.2-1.6 4.8 0 3.2 1.6 4.8 0'),
  dot: '<circle cx="12" cy="12" r="5.4" fill="currentColor"/>',
  ring: '<circle cx="12" cy="12" r="5.4" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  arrowUp: U('M12 20V4.6M6 10.6l6-6 6 6'),
  back: U('M15 5l-7 7 7 7'),
  shield: U('M12 2.8l7.6 3v5.6c0 4.6-3.2 8.4-7.6 9.8-4.4-1.4-7.6-5.2-7.6-9.8V5.8z'),
  bolt: UF('M13.4 2.4L4.6 13.6h6l-1.2 8 8.8-11.2h-6z'),
  bubble: U('', '<circle cx="9" cy="14" r="4.4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16.4" cy="7.4" r="2.8" fill="none" stroke="currentColor" stroke-width="2"/>'),
};

const NAME_OF = { money: 'coin', rupee: 'coin', worm: 'worms', fish: 'fish_medium', locker: 'locker', bay: 'camp', milk: 'cow_milk' };

/** an icon as an <svg> string: a coloured picture (items, animals, places) or a single-colour UI icon */
export function icon(name, cls = '') {
  const n = NAME_OF[name] && !PICS[name] && !UI[name] ? NAME_OF[name] : name;
  const body = PICS[n] || UI[n];
  if (!body) return '';
  return `<svg class="ic${PICS[n] ? ' pic' : ''}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
/** prefer the UI (single-colour) version of a name that exists in both sets */
export function uiIcon(name, cls = '') {
  return UI[name] ? `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${UI[name]}</svg>` : icon(name, cls);
}
/** the picture for an item id (farm catalog, backpack item, material) */
export function itemIcon(id, cls = '') {
  if (!id) return '';
  if (PICS[id]) return icon(id, cls);
  if (/^horse/.test(id)) return icon('horse', cls);
  if (/^chicken/.test(id)) return icon('chicken', cls);
  if (/^egg/.test(id)) return icon('egg', cls);
  if (/^fish/.test(id)) return icon('fish_medium', cls);
  return icon('box', cls);
}
export const hasIcon = name => !!(PICS[name] || UI[name]);

// canvas use: an <img> per icon, cached (ready after the first frame)
const imgs = new Map();
export function iconImage(name, color = '#fff') {
  const key = name + color;
  let im = imgs.get(key);
  if (!im) {
    const body = PICS[name] || UI[name];
    if (!body) return null;
    im = new Image();
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" color="${color}" style="color:${color}">${body}</svg>`);
    imgs.set(key, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

// strip emoji (and the space after one; ☰ stays, it is the menu sign) from text: toasts, server messages, names in the catalog
const EMOJI = /(?:(?![\u2630])[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][\u{FE0F}\u{FE0E}\u{20E3}\u{1F3FB}-\u{1F3FF}]*(?:\u{200D}[\p{Extended_Pictographic}][\u{FE0F}\u{FE0E}]*)*|[\u{FE0F}\u{FE0E}\u{200D}])[  ]?/gu;
export const noEmoji = t => (t == null ? t : String(t).replace(EMOJI, '').replace(/^\s+/, ''));

// ---------- emoji in the game's text become icons ----------
// Older screens and server messages still write emoji. Whatever lands in the page is swapped for the matching
// icon here (or dropped when there is none), so no emoji is ever shown. 'ui:' = single-colour, else a picture;
// '.cls' adds a class (dots are coloured by CSS).
const EMOJI_ICON = {
  '🌾': 'ui:wheat', '🔄': 'ui:refresh', '⚠': 'ui:warn', '🎣': 'rod', '✅': 'ui:checkCircle', '💥': 'ui:bolt', '📡': 'ui:signal', '🧟': 'ui:skull',
  '🐎': 'horse', '🐴': 'horse', '☠': 'ui:skull', '💀': 'ui:skull', '🐟': 'fish_small', '🐠': 'fish_medium', '🎏': 'fish_large', '🗿': 'giant', '🪨': 'stone', '🧱': 'stone',
  '🪱': 'worms', '🌙': 'ui:moon', '🪵': 'wood', '💰': 'coin', '🎙': 'ui:mic', '🎤': 'ui:mic', '🔊': 'ui:speaker', '🔇': 'ui:speakerOff', '🗼': 'tower', '🏰': 'castle',
  '🚪': 'ui:door', '📋': 'ui:copy', '📦': 'ui:box', '🪺': 'egg', '🥚': 'egg', '🐣': 'egg', '🟤': 'egg_brown', '⚫': 'egg_dark', '🔨': 'hammer', '🟢': 'ui:dot.green',
  '🟡': 'ui:dot.yellow', '🔴': 'ui:dot.red', '⚪': 'ui:ring', '🚫': 'ui:close', '❌': 'ui:close', '✖': 'ui:close', '💚': 'ui:heart.green', '❤': 'ui:heart.red',
  '👥': 'ui:users', '🤝': 'ui:user', '💾': 'ui:checkCircle', '🚐': 'rv', '🚜': 'rv', '📜': 'ui:slip', '🧾': 'ui:slip', '⬇': 'ui:down', '⬆': 'ui:arrowUp', '🏠': 'ui:home',
  '🏡': 'ui:home', '🌉': 'bridge', '🏆': 'ui:trophy', '🎉': 'ui:star', '☀': 'ui:sun', '🌅': 'ui:sunrise', '🌇': 'ui:sunset', '🌱': 'ui:sprout', '▶': 'ui:play',
  '⏩': 'ui:play', '⏸': 'ui:pause', '🛠': 'tools', '🔧': 'tools', '⛶': 'ui:fullscreen', '✔': 'ui:check', '📲': 'ui:phone', '📱': 'ui:phone', '⏳': 'ui:hourglass',
  '💌': 'ui:invite', '➕': 'ui:plus', '🛒': 'ui:cart', '🏪': 'ui:store', '🔥': 'ui:fire', '🔒': 'ui:lock', '🔑': 'ui:key', '🚩': 'flag', '🧑‍🌾': 'farmer', '🧔': 'fisher',
  '🪚': 'chainsaw', '🪓': 'axe', '⚒': 'sledge', '🪢': 'rope', '🔦': 'flashlight', '🔭': 'binoculars', '⛺': 'tent', '🪑': 'chair', '🛌': 'sleepingbag', '🏮': 'lantern',
  '💧': 'water', '🥪': 'sandwich', '🥤': 'soda', '🚁': 'drone', '🧰': 'locker', '🧊': 'fridge', '🏕': 'camp', '🌲': 'tree', '🌊': 'ui:wave', '📖': 'ui:book', '🎯': 'ui:target',
  '🟫': 'planks', '🗑': 'ui:trash', '👑': 'ui:crown', '🛡': 'ui:shield', '⚔': 'ui:shield', '🎒': 'ui:bag', '💣': 'ui:bolt', '💪': 'ui:bolt', '📶': 'ui:signal', '📈': 'ui:signal',
  '🐕': 'dog', '🐶': 'dog', '🦮': 'dog', '🦴': 'bone', '🍖': 'dog_treat', '🥷': 'thief', '🕸': 'net', '🚨': 'ui:warn',
  '🐔': 'chicken', '🐓': 'chicken_brown', '🐦‍⬛': 'chicken_dark', '🐐': 'goat', '🐄': 'cow', '🥛': 'goat_milk', '🍼': 'cow_milk', '🏚': 'barn', '🛖': 'goat_shed',
};
export function emojiIcon(e) {
  const k = EMOJI_ICON[e] || EMOJI_ICON[e.replace(/[\u{FE0F}\u{FE0E}]/gu, '')];
  if (!k) return '';
  const ui = k.startsWith('ui:'), [n, cls] = (ui ? k.slice(3) : k).split('.');
  return ui ? uiIcon(n, cls || '') : icon(n, cls || '');
}
const EMOJI1 = /(?![☰])[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][\u{FE0F}\u{FE0E}\u{20E3}\u{1F3FB}-\u{1F3FF}]*(?:\u{200D}[\p{Extended_Pictographic}][\u{FE0F}\u{FE0E}]*)*/u;
const EMOJI_G = new RegExp(EMOJI1.source, 'gu');
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION', 'SELECT', 'INPUT', 'TITLE', 'CANVAS']);
function fixText(node) {
  const t = node.nodeValue;
  if (!t || !EMOJI1.test(t)) return;
  const p = node.parentNode;
  if (!p || SKIP.has(p.nodeName) || p.closest && p.closest('svg')) return;
  if (p.nodeName === 'SELECT' || (p.closest && p.closest('option, select'))) { node.nodeValue = noEmoji(t); return; }
  const frag = document.createDocumentFragment();
  let last = 0;
  t.replace(EMOJI_G, (m, at) => {
    if (at > last) frag.appendChild(document.createTextNode(t.slice(last, at)));
    const svg = emojiIcon(m);
    if (svg) { const tpl = document.createElement('template'); tpl.innerHTML = svg; frag.appendChild(tpl.content.firstChild); }
    last = at + m.length;
    if (!svg && t[last] === ' ') last++;
    return m;
  });
  if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
  p.replaceChild(frag, node);
}
function fixTree(root) {
  if (root.nodeType === 3) { fixText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName) || root.namespaceURI === 'http://www.w3.org/2000/svg') return;
  for (const a of ['title', 'placeholder', 'aria-label']) { const v = root.getAttribute(a); if (v && EMOJI1.test(v)) root.setAttribute(a, noEmoji(v)); }
  if (!EMOJI1.test(root.textContent) && !root.querySelector('[title],[placeholder]')) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (EMOJI1.test(n.nodeValue)) list.push(n);
  list.forEach(fixText);
  for (const el of root.querySelectorAll('[title],[placeholder],[aria-label]')) for (const a of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(a); if (v && EMOJI1.test(v)) el.setAttribute(a, noEmoji(v)); }
}
/** watch the page: every emoji written into it becomes an icon (call once at start) */
export function startIconizer(root = document.body) {
  fixTree(root);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target);
      else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v && EMOJI1.test(v)) m.target.setAttribute(m.attributeName, noEmoji(v)); }
      else for (const n of m.addedNodes) fixTree(n);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
}
