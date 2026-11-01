import * as THREE from 'three';
import { GeoBuilder, canvasTexture } from './utils.js';
import { C, Y, RV_MATS, AXLE_R } from './rvDims.js';

const WELL_Z0 = AXLE_R - 0.62, WELL_Z1 = AXLE_R + 0.62, WELL_TOP = 1.07;  // rear wheel wells

const SEAT_TOP = 0.98;

// Wood cabinet with door seams + knobs. face: '-x' | '+x' | '+z'
function cabinet(b, x0, x1, y0, y1, z0, z1, face, n, knobTop, body = true) {
  if (body) b.boxMM(x0, x1, y0, y1, z0, z1, C.wood);
  const yk = knobTop ? y1 - 0.1 : y0 + 0.1;
  if (face === '+z') {
    for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n; b.boxMM(x - 0.006, x + 0.006, y0 + 0.02, y1 - 0.02, z1, z1 + 0.004, C.woodDk); }
    for (let i = 0; i < n; i++) b.box(0.08, 0.025, 0.02, x0 + (x1 - x0) * (i + 0.5) / n, yk, z1 + 0.012, C.steel);
  } else {
    const fx = face === '-x' ? x0 : x1, s = face === '-x' ? -1 : 1;
    for (let i = 1; i < n; i++) { const z = z0 + (z1 - z0) * i / n; b.boxMM(fx, fx + s * 0.004, y0 + 0.02, y1 - 0.02, z - 0.006, z + 0.006, C.woodDk); }
    for (let i = 0; i < n; i++) b.box(0.02, 0.025, 0.08, fx + s * 0.012, yk, z0 + (z1 - z0) * (i + 0.5) / n, C.steel);
  }
}

// Striped cushion (stripes run across `axis`)
function cushion(b, x0, x1, y0, y1, z0, z1, axis = 'x', n = 6) {
  const cols = [C.cushion, C.cushionA, C.cushion, C.cushionB];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, col = cols[i % 4];
    if (axis === 'x') b.boxMM(x0 + (x1 - x0) * t0, x0 + (x1 - x0) * t1, y0, y1, z0, z1, col);
    else b.boxMM(x0, x1, y0, y1, z0 + (z1 - z0) * t0, z0 + (z1 - z0) * t1, col);
  }
}

function plaid() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#56627c'; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.55;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#2e3548' : '#a9b1c2';
      g.fillRect(i * 16, 0, 7, h); g.fillRect(0, i * 16, w, 7);
    }
    g.globalAlpha = 0.8; g.fillStyle = '#e8e8ea';
    for (let i = 0; i < 4; i++) { g.fillRect(i * 32 + 12, 0, 1.5, h); g.fillRect(0, i * 32 + 12, w, 1.5); }
  });
}

export function buildInterior(B, m) {
  const b = B.base;
  RV_MATS.mw = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffd27a, emissiveIntensity: 0 });
  m.parts.mwMat = RV_MATS.mw;

  /* ----- bedroom ----- */
  // bed base: right part solid; left part holds the outdoor storage bay (opened from outside)
  const BX0 = 0.25, BZ0 = -3.45, BZ1 = -2.6, BTOP = 0.92, LIN = 0x3a3c41;
  b.boxMM(-0.72, BX0, Y.floor, 0.95, -3.645, -2.05, C.wood);
  b.boxMM(-1.15, -0.72, Y.floor, 0.95, -3.645, WELL_Z0, C.wood);
  b.boxMM(BX0, 0.72, Y.floor, 0.95, BZ1, -2.05, C.wood);
  b.boxMM(0.72, 1.15, Y.floor, 0.95, BZ1, WELL_Z0, C.wood);
  b.boxMM(BX0, 1.15, Y.floor, 0.95, -3.645, BZ0, C.wood);
  b.boxMM(BX0, 1.15, BTOP, 0.95, BZ0, BZ1, C.wood);
  b.boxMM(BX0, 1.17, Y.floor, Y.floor + 0.02, BZ0, BZ1, LIN);          // bay carpet
  b.boxMM(BX0, BX0 + 0.02, Y.floor, BTOP, BZ0, BZ1, LIN);
  b.boxMM(BX0, 1.17, Y.floor, BTOP, BZ0, BZ0 + 0.02, LIN);
  b.boxMM(BX0, 1.17, Y.floor, BTOP, BZ1 - 0.02, BZ1, LIN);
  b.boxMM(BX0, 1.17, BTOP - 0.02, BTOP, BZ0, BZ1, LIN);
  b.boxMM(BX0 + 0.02, BX0 + 0.03, BTOP - 0.1, BTOP - 0.06, BZ0 + 0.1, BZ1 - 0.1, 0xfff4d6, 'lamp');
  for (const x of [-0.24, 0.24]) b.boxMM(x - 0.006, x + 0.006, 0.6, 0.9, -2.05, -2.046, C.woodDk);
  for (const x of [-0.48, 0, 0.48]) b.box(0.1, 0.025, 0.02, x, 0.86, -2.035, C.steel);
  b.boxMM(-1.13, 1.13, 0.95, 1.13, -3.62, -2.07, 0xf1efe9);
  const blanketMat = new THREE.MeshLambertMaterial({ map: plaid() });
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.05, 1.58), blanketMat);
  blanket.position.set(-0.27, 1.15, -2.845); blanket.receiveShadow = true;
  const flap = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.22, 0.03), blanketMat);
  flap.position.set(-0.27, 1.06, -2.05);
  m.extras.push({ obj: blanket, group: 'base' }, { obj: flap, group: 'base' });
  b.box(0.36, 0.14, 0.62, 0.86, 1.2, -3.22, 0xf7f7f2, 'solid', 0, 0.06, 0.12);
  b.box(0.36, 0.14, 0.62, 0.86, 1.2, -2.5, 0xf7f7f2, 'solid', 0, -0.05, 0.12);
  b.boxMM(1.09, 1.145, 1.1, 1.65, -3.6, -2.1, 0x6b4a32);
  cabinet(B.rear, -1.15, 1.15, 2.55, Y.ceil, -3.645, -3.3, '+z', 4, false);

  /* ----- kitchen (left side) ----- */
  b.boxMM(0.6, 1.15, WELL_TOP, 1.43, -1.95, WELL_Z1, C.wood);   // sits on top of the wheel well
  b.boxMM(0.6, 1.15, Y.floor, 1.43, WELL_Z1, -0.45, C.wood);
  cabinet(b, 0.6, 1.15, WELL_TOP, 1.43, -1.95, -1.05, '-x', 2, true, false);
  b.boxMM(0.57, 1.15, 1.43, 1.48, -1.97, -0.43, C.counter);
  b.boxMM(0.7, 1.02, 1.48, 1.485, -1.78, -1.32, 0x9aa0a6);
  b.boxMM(0.73, 0.99, 1.485, 1.488, -1.75, -1.35, 0x6d7379);
  b.cyl(0.015, 0.015, 0.2, 5, 1.06, 1.58, -1.55, C.steel);
  b.boxMM(0.9, 1.06, 1.66, 1.69, -1.565, -1.535, C.steel);
  b.boxMM(0.68, 1.08, 1.48, 1.49, -1.05, -0.6, 0x222326);
  for (const z of [-0.93, -0.72]) {
    b.cyl(0.07, 0.07, 0.012, 8, 0.88, 1.495, z, 0x55575b);
    b.boxMM(0.8, 0.96, 1.495, 1.505, z - 0.006, z + 0.006, 0x1a1a1a);
  }
  b.boxMM(0.585, 0.6, 0.68, 1.3, -1.05, -0.6, 0x2d2f33);
  b.boxMM(0.58, 0.585, 0.8, 1.12, -0.98, -0.67, 0x111214);
  b.boxMM(0.56, 0.575, 1.2, 1.23, -0.98, -0.67, C.steel);
  for (const z of [-0.95, -0.825, -0.7]) b.cyl(0.02, 0.02, 0.02, 6, 0.575, 1.37, z, 0x1a1a1a, 0, 0, Math.PI / 2);
  cabinet(B.left, 0.8, 1.15, 2.55, Y.ceil, -1.95, -0.45, '-x', 3, false);
  B.left.boxMM(0.82, 1.15, 2.45, 2.55, -1.05, -0.6, C.steel);
  cabinet(B.left, 0.8, 1.15, 2.45, Y.ceil, -0.42, 0.25, '-x', 1, false);
  // sink water + stove flames (toggled)
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.75 }));
  water.position.set(0.92, 1.58, -1.55); water.visible = false;
  const flames = new THREE.Group();
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x3f9bff });
  for (const z of [-0.93, -0.72]) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 3, 10), flameMat);
    f.rotation.x = Math.PI / 2; f.position.set(0.88, 1.515, z); flames.add(f);
  }
  flames.visible = false;
  m.extras.push({ obj: water, group: 'base' }, { obj: flames, group: 'base' });
  m.parts.sinkWater = water; m.parts.stoveFlames = flames;

  /* ----- fridge (hollow) + door ----- */
  const fx0 = 0.5, fz0 = -0.42, fz1 = 0.25, fy0 = Y.floor, fy1 = 2.4;
  b.boxMM(1.1, 1.15, fy0, fy1, fz0, fz1, C.fridge);
  b.boxMM(fx0, 1.1, fy0, fy1, fz0, fz0 + 0.04, C.fridge);
  b.boxMM(fx0, 1.1, fy0, fy1, fz1 - 0.04, fz1, C.fridge);
  b.boxMM(fx0, 1.1, fy1 - 0.05, fy1, fz0 + 0.04, fz1 - 0.04, C.fridge);
  b.boxMM(fx0, 1.1, fy0, fy0 + 0.08, fz0 + 0.04, fz1 - 0.04, C.fridge);
  b.boxMM(1.09, 1.1, fy0 + 0.08, fy1 - 0.05, fz0 + 0.04, fz1 - 0.04, 0xf4f6f8);
  b.boxMM(fx0, 1.1, 1.93, 1.97, fz0 + 0.04, fz1 - 0.04, C.fridge);
  for (const y of [1.05, 1.5]) b.boxMM(0.53, 1.09, y, y + 0.015, fz0 + 0.04, fz1 - 0.04, 0xdfe6ea);
  b.boxMM(0.65, 0.95, 1.97, 2.1, -0.3, 0.1, 0xb7dff2);
  const fd = new GeoBuilder();
  fd.group(-fx0, 0, -fz1, 0, 0, 0, () => {
    fd.boxMM(0.45, 0.5, fy0 + 0.01, fy1 - 0.01, fz0, fz1, C.fridge);
    fd.boxMM(0.446, 0.45, 1.935, 1.965, fz0, fz1, 0x8e9196);
    fd.boxMM(0.41, 0.435, 1.3, 1.85, -0.39, -0.36, C.steel);
    fd.boxMM(0.41, 0.435, 2.03, 2.3, -0.39, -0.36, C.steel);
    fd.boxMM(0.5, 0.52, fy0 + 0.05, fy1 - 0.05, fz0 + 0.03, fz1 - 0.03, 0xeef1f3);
    for (const y of [1.2, 1.65]) fd.boxMM(0.52, 0.6, y, y + 0.1, fz0 + 0.06, fz1 - 0.06, 0xd5dde2);
  });
  const fridgeDoor = new THREE.Group();
  fridgeDoor.position.set(fx0, 0, fz1); fridgeDoor.add(fd.build(RV_MATS));
  fridgeDoor.userData.openAngle = 1.7;
  m.extras.push({ obj: fridgeDoor, group: 'base' });
  m.pivots.fridgeDoor = fridgeDoor;

  /* ----- gear locker (floor to ceiling, between fridge and sofa) ----- */
  buildLocker(b, m);

  /* ----- TV on the side of the locker, facing the lounge ----- */
  const tvZ = LOCK.z1;
  b.boxMM(0.62, 1.1, 1.72, 2.08, tvZ, tvZ + 0.04, 0x141416);
  const tvCanvas = document.createElement('canvas'); tvCanvas.width = 128; tvCanvas.height = 80;
  const tvCtx = tvCanvas.getContext('2d');
  tvCtx.fillStyle = '#0b0d10'; tvCtx.fillRect(0, 0, 128, 80);
  const tvTex = new THREE.CanvasTexture(tvCanvas); tvTex.colorSpace = THREE.SRGBColorSpace;
  const tvMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.3), new THREE.MeshBasicMaterial({ map: tvTex }));
  tvMesh.position.set(0.86, 1.9, tvZ + 0.042);
  m.extras.push({ obj: tvMesh, group: 'base' });
  m.parts.tv = { mesh: tvMesh, ctx: tvCtx, tex: tvTex, on: false, t: 0, acc: 0 };

  /* ----- right side cabinet + microwave ----- */
  b.boxMM(-1.15, -0.62, WELL_TOP, 1.43, -1.95, WELL_Z1, C.wood);
  b.boxMM(-1.15, -0.62, Y.floor, 1.43, WELL_Z1, -0.8, C.wood);
  cabinet(b, -1.15, -0.62, WELL_TOP, 1.43, -1.95, -0.8, '+x', 2, true, false);
  b.boxMM(-1.17, -0.59, 1.43, 1.48, -1.97, -0.78, C.counter);
  b.boxMM(-1.13, -0.75, 1.48, 1.76, -1.75, -1.25, 0xdedede);
  b.boxMM(-0.75, -0.744, 1.53, 1.71, -1.7, -1.4, 0x2a2410, 'mw');
  b.boxMM(-0.75, -0.744, 1.53, 1.71, -1.37, -1.29, 0x333538);
  cabinet(B.right, -1.15, -0.8, 2.55, Y.ceil, -1.95, -0.8, '+x', 2, false);

  /* ----- dinette (right side, front) ----- */
  b.boxMM(-1.15, -0.38, Y.floor, 0.86, 0.25, 0.75, C.wood);
  cushion(b, -1.15, -0.38, 0.86, SEAT_TOP, 0.37, 0.75);
  cushion(b, -1.15, -0.38, SEAT_TOP, 1.72, 0.25, 0.37);
  b.boxMM(-1.15, -0.38, Y.floor, 0.86, 1.37, 1.87, C.wood);
  cushion(b, -1.15, -0.38, 0.86, SEAT_TOP, 1.37, 1.75);
  cushion(b, -1.15, -0.38, SEAT_TOP, 1.72, 1.75, 1.87);
  b.boxMM(-1.15, -0.42, 1.25, 1.29, 0.82, 1.3, 0xe6d9bf);
  b.boxMM(-1.15, -0.42, 1.22, 1.25, 0.84, 1.28, C.wood);
  b.cyl(0.04, 0.05, 0.68, 6, -0.8, 0.89, 1.06, C.steel);
  b.cyl(0.18, 0.18, 0.02, 8, -0.8, 0.56, 1.06, C.steel);
  b.cyl(0.03, 0.035, 0.12, 6, -0.6, 1.35, 1.0, 0xffffff);
  b.cyl(0.035, 0.03, 0.1, 6, -0.95, 1.34, 1.15, 0xc54a3a);
  cabinet(B.right, -1.15, -0.8, 2.55, Y.ceil, 0.25, 1.87, '+x', 3, false);

  /* ----- sofa (left side, front) ----- */
  b.boxMM(0.62, 1.15, Y.floor, 0.86, 1.0, 1.85, C.wood);
  cushion(b, 0.62, 1.0, 0.86, SEAT_TOP, 1.05, 1.8, 'z', 6);
  cushion(b, 1.0, 1.13, SEAT_TOP, 1.62, 1.05, 1.8, 'z', 6);
  b.boxMM(0.62, 1.15, 0.86, 1.2, 1.0, 1.07, C.woodDk);
  b.boxMM(0.62, 1.15, 0.86, 1.2, 1.78, 1.85, C.woodDk);
  b.box(0.12, 0.3, 0.3, 1.04, 1.18, 1.3, 0xd9b26a, 'solid', 0, 0, -0.2);
  cabinet(B.left, 0.8, 1.15, 2.55, Y.ceil, 1.0, 1.85, '-x', 2, false);
  // rug
  b.boxMM(-0.32, 0.42, Y.floor, Y.floor + 0.006, -1.75, 0.15, 0x7a3b2e);
  b.boxMM(-0.24, 0.34, Y.floor, Y.floor + 0.008, -1.67, 0.07, 0xb06a45);

  /* ----- cab: seats, dash, wheel, console ----- */
  for (const x of [0.55, -0.55]) {
    b.boxMM(x - 0.18, x + 0.18, Y.floor, 0.82, 1.98, 2.36, 0x3a3a3c);
    b.boxMM(x - 0.25, x + 0.25, 0.82, SEAT_TOP, 1.92, 2.42, C.seat);
    b.boxMM(x - 0.26, x + 0.26, 0.9, 1.0, 2.38, 2.43, C.seatDk);
    b.add(new THREE.BoxGeometry(0.5, 0.78, 0.13), C.seat, x, 1.38, 1.9, -0.12, 0, 0);
    b.add(new THREE.BoxGeometry(0.52, 0.06, 0.15), C.seatDk, x, 1.02, 1.93, -0.12, 0, 0);
    b.add(new THREE.BoxGeometry(0.3, 0.2, 0.1), C.seatDk, x, 1.9, 1.85, -0.12, 0, 0);
  }
  b.boxMM(-1.03, 1.03, 1.0, 1.44, 2.62, 2.95, C.dash);
  b.add(new THREE.BoxGeometry(2.06, 0.05, 0.4), C.dashDk, 0, 1.46, 2.77, -0.25, 0, 0);
  b.boxMM(0.3, 0.8, 1.44, 1.56, 2.6, 2.74, C.dashDk);
  for (const x of [0.43, 0.67]) {
    b.cyl(0.075, 0.075, 0.012, 10, x, 1.37, 2.615, 0x0f0f10, Math.PI / 2, 0, 0);
    b.box(0.008, 0.06, 0.004, x, 1.39, 2.607, 0xff6a3a, 'solid', 0, 0, 0.6);
  }
  b.boxMM(-0.18, 0.18, 1.16, 1.34, 2.6, 2.625, 0x1d1e21);
  for (let i = 0; i < 4; i++) b.box(0.05, 0.025, 0.01, -0.12 + i * 0.08, 1.2, 2.597, 0x5d6066);
  b.boxMM(-0.12, 0.12, 1.26, 1.31, 2.596, 2.6, 0x3fd2a0);
  for (const x of [-0.85, -0.3, 0.3, 0.9]) b.boxMM(x - 0.08, x + 0.08, 1.33, 1.39, 2.605, 2.62, 0x18191b);
  b.boxMM(-0.95, -0.4, 1.1, 1.24, 2.615, 2.62, C.dashDk);
  b.boxMM(-0.22, 0.22, Y.floor, 0.85, 2.25, 2.75, C.dashDk);
  b.boxMM(-0.18, 0.18, 0.85, 0.88, 2.3, 2.5, 0x2a2420);
  b.cyl(0.012, 0.012, 0.25, 4, 0, 0.98, 2.62, 0x222222, 0.3, 0, 0);
  b.box(0.05, 0.05, 0.05, 0, 1.1, 2.58, 0x111111);
  for (const x of [0.45, 0.62]) b.boxMM(x - 0.05, x + 0.05, 0.58, 0.7, 2.83, 2.86, 0x1a1a1a);
  b.cyl(0.035, 0.035, 0.3, 6, 0.55, 1.37, 2.6, 0x2a2a2a, -0.9, 0, 0);
  // rear-view mirror
  b.boxMM(-0.13, 0.13, 2.18, 2.28, 2.5, 2.53, 0x1a1a1a);
  b.boxMM(-0.01, 0.01, 2.28, 2.38, 2.51, 2.53, 0x1a1a1a);

  const tilt = new THREE.Group();
  tilt.position.set(0.55, 1.47, 2.48); tilt.rotation.x = 0.67;
  const wb = new GeoBuilder();
  wb.add(new THREE.TorusGeometry(0.19, 0.022, 5, 14), 0x1d1d1f);
  wb.box(0.36, 0.035, 0.02, 0, 0, 0, 0x2a2a2c);
  wb.box(0.035, 0.18, 0.02, 0, -0.09, 0, 0x2a2a2c);
  wb.cyl(0.06, 0.06, 0.05, 8, 0, 0, 0, 0x3a3a3d, Math.PI / 2, 0, 0);
  const steering = wb.build(RV_MATS);
  tilt.add(steering);
  m.extras.push({ obj: tilt, group: 'base' });
  m.parts.steering = steering;

  /* ----- entry steps (outside, under the door) ----- */
  b.boxMM(-1.47, -1.2, 0.31, 0.37, -0.62, 0.12, 0x6a6d72);
  b.boxMM(-1.74, -1.47, 0.13, 0.19, -0.62, 0.12, 0x6a6d72);
  for (const z of [-0.64, 0.12]) b.boxMM(-1.74, -1.2, 0.1, 0.37, z, z + 0.02, C.trim);
  for (const x of [-1.4, -1.3, -1.67, -1.57]) b.boxMM(x - 0.01, x + 0.01, x > -1.47 ? 0.37 : 0.19, (x > -1.47 ? 0.37 : 0.19) + 0.004, -0.6, 0.1, 0x45484c);
}

// Tall gear locker: hollow body with shelves + two hinged doors (items are added by the inventory)
export const LOCK = { x0: 0.6, x1: 1.15, z0: 0.3, z1: 0.95 };
function buildLocker(b, m) {
  const { x0, x1, z0, z1 } = LOCK, y0 = Y.floor, y1 = Y.ceil, COL = 0x6f4426, IN = 0xcaa57a;
  b.boxMM(1.1, x1, y0, y1, z0, z1, COL);
  b.boxMM(x0, 1.1, y0, y1, z0, z0 + 0.03, COL);
  b.boxMM(x0, 1.1, y0, y1, z1 - 0.03, z1, COL);
  b.boxMM(x0, 1.1, y0, 0.62, z0 + 0.03, z1 - 0.03, COL);
  b.boxMM(x0, 1.1, y1 - 0.04, y1, z0 + 0.03, z1 - 0.03, COL);
  b.boxMM(1.09, 1.1, 0.62, y1 - 0.04, z0 + 0.03, z1 - 0.03, IN);
  for (const y of [1.15, 1.75, 2.35]) b.boxMM(x0 + 0.03, 1.09, y, y + 0.015, z0 + 0.03, z1 - 0.03, C.woodDk);
  for (const y of [1.5, 2.1]) for (const z of [0.45, 0.62, 0.8]) b.box(0.03, 0.03, 0.01, 1.08, y, z, C.steel);   // hooks
  const half = (z1 - z0) / 2;
  const door = (hz, dir, label) => {
    const g = new GeoBuilder();
    const za = dir > 0 ? 0.004 : -half + 0.004, zb = dir > 0 ? half - 0.004 : -0.004;
    g.boxMM(-0.03, 0, y0 + 0.07, y1 - 0.05, za, zb, C.wood);
    for (const y of [0.75, 0.82, 0.89, 2.75, 2.82, 2.89]) g.boxMM(-0.033, -0.03, y, y + 0.025, za + 0.06, zb - 0.06, 0x3a2414);
    const hzEdge = dir > 0 ? zb - 0.05 : za + 0.05;
    g.boxMM(-0.06, -0.03, 1.45, 1.85, hzEdge - 0.012, hzEdge + 0.012, C.steel);
    if (label) { g.boxMM(-0.034, -0.03, 2.05, 2.2, za + 0.06, zb - 0.06, 0xf2c14e); g.boxMM(-0.036, -0.034, 2.1, 2.15, za + 0.09, zb - 0.09, 0x2a2a2a); }
    const p = new THREE.Group(); p.position.set(x0, 0, hz); p.add(g.build(RV_MATS));
    p.userData.openAngle = dir > 0 ? -1.6 : 1.6;
    m.extras.push({ obj: p, group: 'base' });
    return p;
  };
  m.pivots.lockerA = door(z0, 1, true);
  m.pivots.lockerB = door(z1, -1, false);
}

// Animated TV picture (drawn at a low rate to stay cheap)
export function drawTV(tv, dt) {
  tv.t += dt; tv.acc += dt;
  if (tv.acc < 1 / 12) return;
  tv.acc = 0;
  const g = tv.ctx, t = tv.t;
  const sky = g.createLinearGradient(0, 0, 0, 80);
  sky.addColorStop(0, '#2b6fd6'); sky.addColorStop(1, '#9fd2ff');
  g.fillStyle = sky; g.fillRect(0, 0, 128, 80);
  g.fillStyle = '#f7d35a'; g.beginPath(); g.arc(100, 18, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3e8e41'; g.fillRect(0, 56, 128, 24);
  g.fillStyle = '#555a62'; g.fillRect(0, 62, 128, 9);
  for (let i = 0; i < 6; i++) { const x = ((i * 30 - t * 40) % 150 + 150) % 150 - 10; g.fillStyle = '#f2f2ee'; g.fillRect(x, 66, 12, 1.5); }
  for (let i = 0; i < 4; i++) {
    const x = ((i * 40 - t * 12) % 170 + 170) % 170 - 20;
    g.fillStyle = '#7d91ad'; g.fillRect(x, 30 - (i % 2) * 10, 14, 26 + (i % 2) * 10);
  }
  const vx = 40 + Math.sin(t * 0.8) * 6;
  g.fillStyle = '#ebe3d1'; g.fillRect(vx, 48, 30, 13); g.fillRect(vx + 26, 52, 9, 9);
  g.fillStyle = '#8e2f22'; g.fillRect(vx, 55, 35, 2);
  g.fillStyle = '#18212a'; g.fillRect(vx + 5, 50, 7, 4); g.fillRect(vx + 15, 50, 7, 4);
  g.fillStyle = '#1e1e20'; g.beginPath(); g.arc(vx + 7, 62, 2.6, 0, 7); g.arc(vx + 29, 62, 2.6, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, 44, 11);
  g.fillStyle = '#fff'; g.font = 'bold 8px Arial'; g.fillText('RV TV  LIVE', 3, 8);
  tv.tex.needsUpdate = true;
}

export function clearTV(tv) {
  tv.ctx.fillStyle = '#0b0d10'; tv.ctx.fillRect(0, 0, 128, 80); tv.tex.needsUpdate = true;
}
