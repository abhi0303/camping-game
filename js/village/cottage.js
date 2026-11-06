// The ivy cottage: an L-shaped storybook cottage. A front block with a steep gable facing the lane — its wall of
// rough cream stones round an arched stone doorway, the gable above in dusty-pink plaster with dark timbers, an
// attic window and heavy barge boards — and a lower side wing with its ridge along the front (plaster with stone
// patches, a timber band under the eaves, windows, a slatted vent, a round window in its far gable). Both roofs
// are covered in big rounded clay tiles, laid row on row. Ivy climbs the gable, runs along the top of the
// stone wall and hangs down the corners; a flower basket hangs by the door; a thin chimney pipe on the ridge.
// In front of the wing a raised vegetable bed with tomatoes on stakes, lettuces and clay pots; a spade and a
// pitchfork lean on the wall. Local frame like every house: the front block's middle at floor level, the door at
// x = 0 on the front (+z); the wing is its side room (spec.annex), so paths, steps and collisions know it.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { limb } from '../flora.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const hull = pts => new ConvexGeometry(pts.map(p => V(...p)));
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const COL = {
  plaster: 0xe9dfcd, pink: 0xc99f99, stone: [0xe2d8c4, 0xd6cbb5, 0xcfc4ad, 0xe8e0cf, 0xc8bca4, 0xdcd2bf], timber: 0x6a4a32, barge: 0x7a5a3e,
  tiles: [0xa45a4e, 0xb0665a, 0x9a5046, 0xb87062, 0xa8604f, 0x95493f], under: 0x5e4232, door: 0x6f7d6c, frame: 0x7a5a3e, glass: 0x4f6170,
  leaf: [0x4f9a3a, 0x6cb84a, 0x3e7f30, 0x5aa840], soil: 0x6b4a2c, bedWood: 0xd8b884, pot: 0xb8653e, iron: 0x3a3a3e,
};
export const COTTAGE = { w: 4.2, d: 5.6, wing: { w: 4.6, d: 4.4, h: 2.4 } };

// a roof slope: in its own frame x runs along the ridge, +z goes down the slope from the ridge (z = 0) to the eave
// (z = len), +y is out of the roof. Big rounded tiles in staggered rows from the eave up; skip(tx, tz) leaves
// out tiles that would be hidden (under the other roof).
function slope(b, L, len, R, skip) {
  b.box(L, 0.07, len, 0, -0.04, len / 2, COL.under);
  const rows = Math.round(len / 0.33), cols = Math.round(L / 0.42), tw = L / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols + 1; c++) {
    const tz = len - 0.17 - r * (len - 0.2) / rows, tx = -L / 2 + (c + (r % 2 ? 0 : 0.5)) * tw;
    if (Math.abs(tx) > L / 2 - tw * 0.3 || (skip && skip(tx, tz))) continue;
    // (six-sided, a flat edge at the bottom, drawn out down the slope: a rounded clay tile)
    b.add(new THREE.CylinderGeometry(tw * 0.52, tw * 0.52, 0.04, 6, 1, false, Math.PI / 6), COL.tiles[Math.floor(R() * COL.tiles.length)],
      tx + (R() - 0.5) * 0.03, 0.03 + r * 0.003, tz, -0.13 - R() * 0.05, (R() - 0.5) * 0.08, 0, 'solid', 1, 1, 1.3);
  }
}
// rough stones over a wall face (local x along it, +z out), from x0..x1, y0..y1, leaving holes [[x0, x1, y0, y1]]
function rubble(b, x0, x1, y0, y1, R, holes = [], keep = 1) {
  for (let y = y0 + 0.02, row = 0; y < y1 - 0.12; row++) {
    const h = 0.24 + R() * 0.16;
    for (let x = x0 + (row % 2 ? 0.18 : 0.02); x < x1 - 0.12;) {
      const w = 0.32 + R() * 0.42, cx = Math.min(x + w / 2, x1 - w / 2 + 0.05), cy = Math.min(y + h / 2, y1 - h / 2);
      const hit = holes.some(([a, c, d, e]) => cx + w / 2 > a && cx - w / 2 < c && cy + h / 2 > d && cy - h / 2 < e);
      if (!hit && R() < keep) b.add(new THREE.BoxGeometry(w - 0.05, h - 0.05, 0.08 + R() * 0.06), COL.stone[Math.floor(R() * COL.stone.length)], cx, cy, 0.02, (R() - 0.5) * 0.12, (R() - 0.5) * 0.12, (R() - 0.5) * 0.18);
      x += w;
    }
    y += h;
  }
}
// ivy: leaves along a line on a wall (local x, y on the face; z out), denser where k is high; strands hang from it
function ivy(b, pts, R, density = 1) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) * 9 * density));
    for (let k = 0; k < n; k++) {
      const t = (k + R()) / n, x = ax + (bx - ax) * t + (R() - 0.5) * 0.16, y = ay + (by - ay) * t + (R() - 0.5) * 0.16, s = 0.07 + R() * 0.05;
      b.add(new THREE.OctahedronGeometry(1, 0), COL.leaf[Math.floor(R() * COL.leaf.length)], x, y, 0.07 + R() * 0.05, 0, 0, R() * 3, 'solid', s, s * 1.1, s * 0.35);
    }
  }
}
const hang = (x, y0, len) => [[x, y0], [x + 0.06, y0 - len * 0.5], [x - 0.04, y0 - len]];
// a window with a wooden frame, a cross of glazing bars and a sill (x along the face, y: bottom of the glass)
function windowAt(b, x, y, ww, wh, bucket) {
  b.box(ww + 0.18, wh + 0.18, 0.1, x, y + wh / 2, 0.04, COL.frame);
  b.box(ww, wh, 0.04, x, y + wh / 2, 0.08, COL.glass, bucket);
  b.box(0.05, wh, 0.03, x, y + wh / 2, 0.11, COL.frame); b.box(ww, 0.05, 0.03, x, y + wh * 0.5, 0.11, COL.frame);
  b.box(ww + 0.32, 0.08, 0.2, x, y - 0.06, 0.1, shade(COL.frame, 0.9));
}
// a gable end (a triangle of wall in the x = 0 plane facing +x after the caller's turn): half-timbered plaster
function gableEnd(b, half, y0, rise, t, col) {
  b.add(hull([[-half, y0, 0], [half, y0, 0], [0, y0 + rise, 0], [-half, y0, -t], [half, y0, -t], [0, y0 + rise, -t]]), col);
  b.box(half * 2, 0.14, 0.08, 0, y0 + 0.07, 0.04, COL.timber);                                         // tie beam
  b.box(0.12, rise - 0.15, 0.07, 0, y0 + (rise - 0.15) / 2, 0.04, COL.timber);                          // king post
  for (const s of [-1, 1]) limb(b, [s * half * 0.62, y0 + 0.1, 0.04], [s * 0.08, y0 + rise * 0.62, 0.04], 0.05, 0.05, COL.timber, 4);   // braces
}
// barge boards along a gable's two roof edges (in the gable's plane, a little out from it)
function barge(b, half, y0, rise, z, over) {
  const a = Math.atan2(rise, half), L = Math.hypot(half + over, (half + over) * rise / half);
  for (const s of [-1, 1]) b.box(L, 0.2, 0.09, s * (half + over) / 2, y0 + rise - (half + over) / 2 * rise / half - 0.02, z, COL.barge, 'solid', 0, 0, -s * a);
  b.box(0.12, 0.5, 0.12, 0, y0 + rise + 0.08, z, COL.barge);                                            // the finial at the peak
}

// H: the placed house ({ spec, ... }) · gAt(lx, lz): ground under a local point, relative to the floor
export function buildCottage(b, H, gAt, R, bucket) {
  const S = H.spec, w = S.w, d = S.d, A = S.annex, fy = 0.12, wallH = 2.5, eave = fy + wallH;
  const ax = A.side * (w / 2 + A.w / 2), az = -d / 2 + A.d / 2 + 0.2, wEave = fy + A.h;
  // stone foundations under both blocks, down to the ground
  const lo = Math.min(...[[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [ax - A.w / 2, az - A.d / 2], [ax - A.w / 2, az + A.d / 2]].map(([x, z]) => gAt(x, z)));
  const ph = Math.max(0.35, -lo + 0.3);
  b.box(w + 0.32, ph, d + 0.32, 0, 0.12 - ph / 2, 0, 0x8a877f); b.box(w + 0.42, 0.1, d + 0.42, 0, 0.1, 0, 0x9e9b92);
  b.box(A.w + 0.3, ph, A.d + 0.3, ax, 0.12 - ph / 2, az, 0x8a877f); b.box(A.w + 0.38, 0.1, A.d + 0.38, ax, 0.1, az, 0x9e9b92);

  /* ---- the front block ---- */
  b.box(w, wallH, d, 0, fy + wallH / 2, 0, COL.plaster);
  // the front: rough stone all over, an arched stone doorway, the door
  const DW = 0.98, DH = 2.0;
  b.group(0, 0, d / 2, 0, 0, 0, () => {
    rubble(b, -w / 2, w / 2, fy, eave, R, [[-DW / 2 - 0.25, DW / 2 + 0.25, fy, fy + DH + 0.62]]);
    for (let i = 0; i <= 8; i++) {                                                                        // the arch: wedge stones round the top
      const a = Math.PI * i / 8, r = DW / 2 + 0.17;
      b.add(new THREE.BoxGeometry(0.3, 0.2, 0.14), COL.stone[i % COL.stone.length], Math.cos(a) * r, fy + DH - 0.25 + Math.sin(a) * r, 0.05, 0, 0, a - Math.PI / 2);
    }
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) b.add(new THREE.BoxGeometry(0.3, 0.38, 0.14), COL.stone[(k + 2) % COL.stone.length], s * (DW / 2 + 0.16), fy + 0.2 + k * 0.42, 0.05, 0, 0, (R() - 0.5) * 0.1);   // jambs
    b.box(DW, DH - 0.25, 0.06, 0, fy + (DH - 0.25) / 2, 0.03, COL.door);
    b.add(new THREE.CircleGeometry(DW / 2, 10, 0, Math.PI), COL.door, 0, fy + DH - 0.25, 0.031);
    for (let i = 1; i < 4; i++) b.box(0.025, DH - 0.35, 0.02, -DW / 2 + i * DW / 4, fy + (DH - 0.3) / 2, 0.07, shade(COL.door, 0.8));
    for (const y of [0.45, 1.35]) b.box(DW * 0.7, 0.05, 0.03, -0.05, fy + y, 0.075, COL.iron);           // hinges
    b.box(0.05, 0.12, 0.06, DW * 0.32, fy + 1.0, 0.09, 0xc79a4a);                                       // latch
    b.box(1.5, 0.12, 0.6, 0, 0.08, 0.32, 0x9e9b92);                                                     // doorstep slab
    // a flower basket hanging from a bracket, left of the door
    b.box(0.04, 0.04, 0.34, -1.0, fy + 2.15, 0.17, COL.iron); b.box(0.02, 0.24, 0.02, -1.0, fy + 2.03, 0.33, COL.iron);
    b.add(new THREE.SphereGeometry(0.2, 7, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x6e4626, -1.0, fy + 1.92, 0.33);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; b.add(new THREE.IcosahedronGeometry(0.06, 0), [0xf08ab0, 0xb06ad6, 0xf7f6ef][k % 3], -1.0 + Math.cos(a) * 0.13, fy + 1.95, 0.33 + Math.sin(a) * 0.13); }
    b.group(0, 0, 0.2, 0, 0, 0, () => { ivy(b, hang(-1.12, fy + 1.85, 0.75), R, 0.8); ivy(b, hang(-0.86, fy + 1.85, 0.55), R, 0.8); });
    // ivy along the top of the wall and down both corners and over the arch
    ivy(b, [[-w / 2 + 0.1, eave - 0.12], [-0.6, eave - 0.05], [0.6, eave - 0.18], [w / 2 - 0.1, eave - 0.1]], R, 1.2);
    ivy(b, hang(-w / 2 + 0.22, eave - 0.1, 1.5), R); ivy(b, hang(w / 2 - 0.25, eave - 0.1, 1.9), R); ivy(b, [[-0.75, eave - 0.1], [-0.72, fy + DH + 0.2]], R, 0.7);
    // tools leaning on the wall, a potted fern by the door (on the ground, wherever it is)
    const gf = gAt(w / 2 - 0.45, d / 2 + 0.42), gs = gAt(-w / 2 + 0.35, d / 2 + 0.4), gp = gAt(-1.25, d / 2 + 0.55);
    limb(b, [w / 2 - 0.45, gf, 0.42], [w / 2 - 0.35, gf + 1.33, 0.08], 0.022, 0.022, 0x8a6a3a, 5);           // pitchfork
    for (const s of [-1, 0, 1]) limb(b, [w / 2 - 0.47 + s * 0.05, gf + 0.02, 0.43], [w / 2 - 0.46 + s * 0.05, gf + 0.3, 0.35], 0.008, 0.008, 0x9aa1a8, 3);
    limb(b, [-w / 2 + 0.35, gs + 0.18, 0.38], [-w / 2 + 0.42, gs + 1.28, 0.08], 0.022, 0.022, 0x8a6a3a, 5);   // spade
    b.add(new THREE.BoxGeometry(0.2, 0.26, 0.02), 0x9aa1a8, -w / 2 + 0.34, gs + 0.08, 0.41, 0.26, 0, 0);
    b.cyl(0.2, 0.15, 0.3, 7, -1.25, gp + 0.15, 0.55, COL.pot);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; limb(b, [-1.25, gp + 0.28, 0.55], [-1.25 + Math.cos(a) * 0.42, gp + 0.55, 0.55 + Math.sin(a) * 0.42], 0.03, 0.01, COL.leaf[k % 4], 3); }
  });
  // the sides and back: plaster with stone patches and a timber band under the eaves; a window each
  for (const [face, len] of [['right', d], ['back', w]]) {
    const ry = face === 'right' ? Math.PI / 2 : Math.PI, ox = face === 'right' ? w / 2 : 0, oz = face === 'back' ? -d / 2 : 0;
    b.group(ox, 0, oz, 0, ry, 0, () => {
      b.box(len + 0.04, 0.16, 0.08, 0, eave - 0.08, 0.03, COL.timber);
      for (const s of [-1, 1]) b.box(0.14, wallH, 0.08, s * (len / 2 - 0.07), fy + wallH / 2, 0.03, COL.timber);
      windowAt(b, face === 'right' ? 0.6 : 0, fy + 0.95, 0.85, 0.95, bucket);
      rubble(b, -len / 2 + 0.15, -len / 2 + 1.1, fy, fy + 1.3, R, [], 0.8);
      rubble(b, len / 2 - 1.0, len / 2 - 0.15, fy + 1.4, eave - 0.3, R, [], 0.55);
    });
  }
  // the steep gable roof (ridge front to back), the gables at both ends, barge boards, the ridge cap
  const pitch = 0.91, run = w / 2 + 0.45, rise = (w / 2) * Math.tan(pitch), ridgeY = eave + rise, sl = run / Math.cos(pitch), L = d + 0.9;
  for (const s of [1, -1]) b.group(0, ridgeY + 0.06, 0, 0, s * Math.PI / 2, 0, () => b.group(0, 0, 0, pitch, 0, 0, () => slope(b, L, sl, R)));
  for (let z = -L / 2 + 0.2; z < L / 2; z += 0.4) b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 6), COL.tiles[Math.floor(R() * 6)], 0, ridgeY + 0.12, z, Math.PI / 2, 0, 0);   // ridge tiles
  for (const s of [1, -1]) b.group(0, 0, s * d / 2, 0, s > 0 ? 0 : Math.PI, 0, () => {
    gableEnd(b, w / 2, eave, rise, 0.2, COL.pink);
    barge(b, w / 2, eave, rise, 0.45, 0.45);
    if (s > 0) {                                                                                        // the attic window, ivy round the gable
      b.box(0.78, 1.0, 0.1, 0, eave + 0.95, 0.06, COL.frame);
      b.box(0.62, 0.84, 0.04, 0, eave + 0.95, 0.1, 0x3f4c58, bucket);
      for (const x of [-0.16, 0.16]) b.box(0.05, 0.84, 0.03, x, eave + 0.95, 0.13, COL.frame);
      for (const y of [0.7, 1.2]) b.box(0.62, 0.05, 0.03, 0, eave + y, 0.13, COL.frame);
      b.box(0.95, 0.08, 0.22, 0, eave + 0.41, 0.12, shade(COL.frame, 0.9));
      ivy(b, [[-w / 2 + 0.2, eave + 0.1], [-w / 4, eave + rise * 0.5], [-0.3, eave + rise - 0.4]], R, 1.1);
      ivy(b, [[w / 2 - 0.2, eave + 0.1], [w / 4, eave + rise * 0.5], [0.35, eave + rise - 0.5]], R, 1.1);
      ivy(b, hang(-0.55, eave + 0.55, 0.6), R, 0.8); ivy(b, hang(0.6, eave + 0.65, 0.7), R, 0.8);
    }
  });
  // the chimney: a thin pipe up through the back of the roof, with a cap
  b.cyl(0.075, 0.075, 1.6, 7, 0.55, ridgeY - 0.25, -1.6, 0x4a4a50); b.add(new THREE.ConeGeometry(0.15, 0.14, 7), 0x3a3a40, 0.55, ridgeY + 0.6, -1.6);

  /* ---- the side wing ---- */
  b.group(ax, 0, az, 0, 0, 0, () => {
    const ww = A.w, wd = A.d, h = A.h;
    b.box(ww, h, wd, 0, fy + h / 2, 0, COL.plaster);
    const faces = [['front', ww, 0, wd / 2, 0], ['back', ww, 0, -wd / 2, Math.PI], ['left', wd, -ww / 2, 0, -Math.PI / 2]];
    for (const [face, len, ox, oz, ry] of faces) b.group(ox, 0, oz, 0, ry, 0, () => {
      b.box(len + 0.04, 0.16, 0.08, 0, fy + h - 0.08, 0.03, COL.timber);                                // the band under the eaves
      b.box(len + 0.04, 0.1, 0.07, 0, fy + h - 0.62, 0.03, COL.timber);
      for (let x = -len / 2 + 0.07; x <= len / 2 - 0.06; x += (len - 0.14) / 4) b.box(0.1, 0.54, 0.07, x, fy + h - 0.35, 0.03, COL.timber);
      if (face === 'front') {
        windowAt(b, -0.85, fy + 0.85, 0.9, 0.95, bucket);
        b.box(0.66, 0.82, 0.08, 1.45, fy + 1.2, 0.04, COL.frame);                                         // a slatted vent by the front block
        for (let k = 0; k < 5; k++) b.box(0.56, 0.06, 0.06, 1.45, fy + 0.9 + k * 0.15, 0.08, shade(COL.frame, 1.12), 'solid', -0.4, 0, 0);
        rubble(b, -len / 2 + 0.1, -len / 2 + 0.9, fy, fy + 1.5, R, [], 0.75); rubble(b, 0.2, 1.0, fy + 0.2, fy + 0.9, R, [], 0.6);
        ivy(b, hang(-len / 2 + 0.25, fy + h - 0.1, 1.6), R); ivy(b, hang(0.15, fy + h - 0.1, 0.9), R, 0.8);
        ivy(b, [[-len / 2 + 0.2, fy + h - 0.1], [-0.4, fy + h - 0.05]], R, 0.7);
      } else if (face === 'back') windowAt(b, 0.4, fy + 0.9, 0.85, 0.9, bucket);
      else { rubble(b, -len / 2 + 0.1, len / 2 - 0.1, fy, fy + 0.9, R, [], 0.7); ivy(b, hang(len / 2 - 0.3, fy + h - 0.1, 1.2), R); }
    });
    // its roof: ridge along x, from the far gable to where it meets the front block's roof; tiles under that roof left out
    const p2 = 0.79, run2 = wd / 2 + 0.4, rise2 = (wd / 2) * Math.tan(p2), ry2 = fy + h + rise2, sl2 = run2 / Math.cos(p2);
    const x0 = -ww / 2 - 0.4, x1 = A.side * 0.45 - ax, L2 = x1 - x0, cx2 = (x0 + x1) / 2;          // (the wing is on the -x side)
    const mainY = X => ridgeY - Math.abs(X) * Math.tan(pitch);                                            // the front block's roof over world-local x
    for (const s of [1, -1]) b.group(cx2, ry2 + 0.06, 0, 0, s > 0 ? 0 : Math.PI, 0, () => b.group(0, 0, 0, p2, 0, 0, () => slope(b, L2, sl2, R, (tx, tz) => {
      const X = ax + cx2 + (s > 0 ? tx : -tx), Y = ry2 - tz * Math.sin(p2);
      return Math.abs(X) < w / 2 + 0.5 && Y < mainY(X) + 0.05;
    })));
    for (let x = x0 + 0.2; x < x1 - 0.2; x += 0.4) { if (fy + h + rise2 + 0.1 < mainY(ax + x)) continue; b.add(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 6), COL.tiles[Math.floor(R() * 6)], x, ry2 + 0.11, 0, 0, 0, Math.PI / 2); }
    // the far gable: pink plaster, timbers, a round window, barge boards
    b.group(-ww / 2, 0, 0, 0, -Math.PI / 2, 0, () => {
      gableEnd(b, wd / 2, fy + h, rise2, 0.2, COL.pink);
      barge(b, wd / 2, fy + h, rise2, 0.4, 0.4);
      b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10), COL.frame, 0, fy + h + 0.85, 0.06, Math.PI / 2, 0, 0);
      b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10), 0x3f4c58, 0, fy + h + 0.85, 0.1, Math.PI / 2, 0, 0, bucket);
      b.box(0.04, 0.44, 0.03, 0, fy + h + 0.85, 0.14, COL.frame);
      ivy(b, [[wd / 2 - 0.2, fy + h + 0.1], [wd / 4, fy + h + rise2 * 0.45]], R, 0.9);
    });
  });

  /* ---- the vegetable bed in front of the wing ---- */
  const bx0 = ax - A.w / 2 + 0.3, bx1 = -w / 2 - 0.25, bz0 = az + A.d / 2 + 0.2, bz1 = d / 2 - 0.05, by = gAt((bx0 + bx1) / 2, (bz0 + bz1) / 2);
  if (bz1 - bz0 > 0.5) {
    for (const z of [bz0, bz1]) b.box(bx1 - bx0, 0.26, 0.06, (bx0 + bx1) / 2, by + 0.1, z, COL.bedWood);
    for (const x of [bx0, bx1]) b.box(0.06, 0.26, bz1 - bz0, x, by + 0.1, (bz0 + bz1) / 2, COL.bedWood);
    b.box(bx1 - bx0 - 0.08, 0.18, bz1 - bz0 - 0.08, (bx0 + bx1) / 2, by + 0.08, (bz0 + bz1) / 2, COL.soil);
    const zm = (bz0 + bz1) / 2;
    for (let x = bx0 + 0.45, k = 0; x < bx1 - 0.3; x += 0.75, k++) {
      // a tomato plant on its stake
      const z = zm - 0.12;
      b.cyl(0.015, 0.015, 1.45, 4, x, by + 0.85, z, 0xc8a868);
      for (let j = 0; j < 7; j++) { const y = by + 0.35 + j * 0.15, a = j * 2.4 + k; b.add(new THREE.OctahedronGeometry(1, 0), COL.leaf[(j + k) % 4], x + Math.cos(a) * 0.14, y, z + Math.sin(a) * 0.14, 0, a, 0.5, 'solid', 0.13, 0.05, 0.1); }
      for (let j = 0; j < 3; j++) b.add(new THREE.IcosahedronGeometry(0.045, 0), 0xd8342a, x + (j - 1) * 0.08, by + 0.55 + j * 0.2, z + 0.1);
      // a lettuce in front
      for (let j = 0; j < 5; j++) { const a = j / 5 * Math.PI * 2; b.add(new THREE.OctahedronGeometry(1, 0), j % 2 ? 0x8cc85a : 0x6cb84a, x + 0.3 + Math.cos(a) * 0.08, by + 0.22, zm + 0.18 + Math.sin(a) * 0.08, 0.6 * Math.cos(a), a, 0, 'solid', 0.1, 0.05, 0.12); }
    }
    // clay pots with plants along the bed's front
    for (const [x, s] of [[bx0 + 0.35, 1], [(bx0 + bx1) / 2, 0.8], [bx1 - 0.6, 1.1]]) {
      const z = bz1 + 0.35, y = gAt(x, z);
      b.cyl(0.15 * s, 0.11 * s, 0.24 * s, 7, x, y + 0.12 * s, z, COL.pot);
      b.add(new THREE.IcosahedronGeometry(0.16 * s, 0), COL.leaf[Math.floor(x * 10) & 3], x, y + 0.3 * s, z);
    }
  }
  // steps down from the door when the ground in front is lower
  const front = gAt(0, d / 2 + 0.6), steps = Math.max(0, Math.ceil((0.12 - front) / 0.22));
  for (let i = 1; i <= steps; i++) b.box(1.4, 0.22, 0.34, 0, 0.12 - i * 0.22 + 0.11, d / 2 + i * 0.32 - 0.12, 0x9e9b92);
  return { ridgeY };
}
