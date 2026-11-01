import * as THREE from 'three';
import { MAT } from './utils.js';

// RV local space: +Z = front, +X = left (driver side), -X = right (door side). Units = metres.
export const C = {
  body: 0xebe3d1, stripe: 0x8e2f22, stripeLt: 0xb5483a, trim: 0x3a3c40, dark: 0x26272a,
  win: 0x18212a, frame: 0x2f3236, chrome: 0xb3b7bd, rack: 0x5b5f66,
  wall: 0xe8d2a6, ceiling: 0xf1e6cc, wood: 0x8f5a32, woodDk: 0x6a3f22, floor: 0x9b6a3f, floorLine: 0x7a502c,
  counter: 0xe8e2d4, steel: 0xb9bec4, fridge: 0xc9ccd1, cushion: 0x8b4a36, cushionA: 0x6a3326, cushionB: 0xb87a52,
  seat: 0xc9ae84, seatDk: 0xa88e66, dash: 0x5b4a3c, dashDk: 0x3f342b, tire: 0x2a2622, hub: 0x8f897d, doorCard: 0x7a6650,
};
export const Z = { rear: -3.7, cab: 1.9, nose: 2.95, front: 3.95 };
export const Y = { bottom: 0.45, floor: 0.55, ceil: 3.08, alcove: 2.42, roof: 3.2 };
export const BW = 1.2;   // half width of living box
export const CW = 1.08;  // half width of cab
export const AXLE_F = 3.05, AXLE_R = -1.8, WHEEL_R = 0.45;
export const WHEELBASE = AXLE_F - AXLE_R;

export const RV_MATS = {
  ...MAT,
  glassLight: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false }),
  ilamp: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xfff0cc, emissiveIntensity: 0.0 }),
};

// Interaction / pose anchors (all in RV body-local space)
export const ANCHOR = {
  driverSeat: { pos: [0.55, 0.13, 2.12], yaw: 0 },
  passengerSeat: { pos: [-0.55, 0.13, 2.12], yaw: 0 },
  dinetteA: { pos: [-0.77, 0.13, 0.5], yaw: 0 },
  dinetteB: { pos: [-0.77, 0.13, 1.62], yaw: Math.PI },
  sofa: { pos: [0.82, 0.13, 1.42], yaw: -Math.PI / 2 },
  bed: { pos: [-0.85, 1.28, -2.85], yaw: -Math.PI / 2 },
  bunk: { pos: [-0.85, 2.77, 2.42], yaw: -Math.PI / 2 },
  driverOutside: [1.85, 0, 2.3], passengerOutside: [-1.85, 0, 2.3],
  ladderBottom: [-0.8, 0, -4.2], ladderTop: [-0.8, Y.roof + 0.06, -3.25],
};
export const ROOF_TOP = Y.roof + 0.06;
