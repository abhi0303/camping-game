// The crop fields round the big windmill (Farm World): six fenced fields of plowed earth, each with a signboard at
// its gate. What's in them comes from the farm server (server/src/fields.js) and the crops from js/farm/crops.js:
//   - for sale → bought (empty, plowed) → sowing: the player walks over it scattering seeds (Space / F / click, the
//     SOW button on a phone) for 10 s — the seeds show where they've been — → sown (seeds in the soil) → watered:
//     the crop grows on the shared clock through its stages (shoots, half grown, ripe) → harvest → empty again.
//   - A scarecrow (two levels) stands in the middle of a field that has one. Without one, crows come down and peck
//     at the crops (a level 1 scarecrow keeps most of them off now and then, level 2 all of them).
//   - Everyone sees the same fields: the stage comes from the server's times, the crops sway in the wind.
//   - You can tell the farm's own fields from far away: a field for sale is rough, grassy, unplowed land with weeds;
//     once it's bought it's plowed, and gets an arch over its gate with the farm's name on a green board, a tall
//     waving flag (it goes up when you buy the field), pennants on the four corners and two lanterns lit at night.
import * as THREE from 'three';
import { GeoBuilder, MAT } from '../utils.js';
import { limb } from '../flora.js';
import { MILL } from './dutchmill.js';
import { CROPS, stageAt } from './crops.js';
import { scarecrowGeometry, crowGeometry } from './scarecrow.js';
import { lantern } from './props.js';

export const FIELD = { w: 10, d: 7.5 };
// the six fields in the windmill's frame (x across, z toward its front): two columns either side, three rows
const LAYOUT = [[-16.5, -10], [-16.5, 0], [-16.5, 10], [16.5, -10], [16.5, 0], [16.5, 10]];
const prng = seed => { let s = (seed % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const SOIL = 0x7a5534, SOIL_D = 0x5e3f24, SOIL_L = 0x8c6440;
// a bought field's colours: the arch's wood, its painted board, gold trim; the flags
const ARCH = { wood: 0x6e4626, woodL: 0x8a5a33, board: 0x24502a, gold: 0xd9b04a, pole: 0xe2dccd };
const PENNANTS = [0xffc93a, 0xd7263d, 0xffc93a, 0xd7263d];
const CONFETTI = [0xffd23a, 0xd7263d, 0xffffff, 0x7fd36a, 0xff8a1f];
const FLAG_TOP = 5.3, FLAG_LOW = 3.8, PEN_Y = 2.2;   // (flag centre when up / lowered, pennant centre: above the ground)

export class FarmFields {
  // g: { world, eco, player, touch, toast, hud, openField(slot), act(body) }
  constructor(scene, g) {
    this.scene = scene; this.g = g; this.on = false; this.t = 0; this.list = []; this.sow = null; this.fx = [];
  }
  // world point of local (lx, lz) in frame F
  static at(F, lx, lz) { const c = Math.cos(F.yaw), s = Math.sin(F.yaw); return { x: F.x + lx * c + lz * s, z: F.z - lx * s + lz * c }; }
  static local(F, x, z) { const c = Math.cos(F.yaw), s = Math.sin(F.yaw), dx = x - F.x, dz = z - F.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; }

  enable() {
    if (this.on) return;
    this.on = true;
    const W = this.g.world, T = W.T, { w, d } = FIELD;
    W.clearArea([{ x0: MILL.x - 29, x1: MILL.x + 29, z0: MILL.z - 29, z1: MILL.z + 29 }]);
    // crops: one material that sways in the wind
    this.cropMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.uTime = { value: 0 };
    this.cropMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float sw = sin(uTime * 1.7 + instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.45) + 0.45 * sin(uTime * 3.3 + instanceMatrix[3].x * 1.4);
          transformed.x += sw * 0.05 * transformed.y * transformed.y; transformed.z += sw * 0.03 * transformed.y * transformed.y;
        #endif`);
    };
    this.cropMat.customProgramCacheKey = () => 'crop-sway-v1';
    this.geos = {};
    for (const [id, C] of Object.entries(CROPS)) { this.geos[id] = {}; for (const [k, fn] of Object.entries(C.geos)) this.geos[id][k] = fn(); }
    this.scareGeo = [null, scarecrowGeometry(1), scarecrowGeometry(2)];
    const fence = new GeoBuilder();
    LAYOUT.forEach(([mx, mz], slot) => {
      const p = FarmFields.at(MILL, mx, mz), F = { x: p.x, z: p.z, yaw: MILL.yaw }, gs = mx < 0 ? 1 : -1;   // gs: the gate's side (toward the windmill)
      const f = { slot, F, gs, gateX: gs * w / 2, stage: null, crop: null, key: '', owned: null, known: false, raise: 0 };
      f.hAt = (lx, lz) => { const q = FarmFields.at(F, lx, lz); return T.heightAt(q.x, q.z); };
      // what a bought field has (plowed earth, the arch, flag poles) and what a field for sale has (rough grassy land)
      f.ownG = new THREE.Group(); f.saleG = new THREE.Group(); f.ownG.visible = false;
      this.scene.add(f.ownG, f.saleG);
      // the plowed ground: ridges and furrows along the field, following the land
      const nx = 12, nz = 44, pos = [], col = [], idx = [], cc = new THREE.Color();
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const lx = -w / 2 + w * i / nx, lz = -d / 2 + d * j / nz, ph = Math.cos((lz + d / 2) / 0.75 * Math.PI * 2), q = FarmFields.at(F, lx, lz);
        const edge = Math.min(lx + w / 2, w / 2 - lx, lz + d / 2, d / 2 - lz) < 0.25;
        pos.push(q.x, T.heightAt(q.x, q.z) + 0.07 + (edge ? 0 : ph * 0.055), q.z);
        cc.set(edge ? SOIL_D : ph > 0.3 ? SOIL_L : ph < -0.3 ? SOIL_D : SOIL); col.push(cc.r, cc.g, cc.b);
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1; idx.push(a, c, b, b, c, e); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
      g.computeVertexNormals();
      f.soilMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      f.ground = new THREE.Mesh(g, f.soilMat); f.ground.receiveShadow = true; f.ownG.add(f.ground); W.addFogCull(f.ground);
      this._buildFallow(f, T);
      W.addGrassBlock((x, z) => { const l = FarmFields.local(F, x, z); return Math.abs(l.x) < w / 2 + 0.5 && Math.abs(l.z) < d / 2 + 0.5; });
      // the fence round it (posts and two rails), open at the gate; you bump into it
      const perim = [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]];
      const fw = w / 2 + 0.25, fd = d / 2 + 0.25, gate = 1.1;
      for (const [ax0, az0, bx0, bz0] of perim) {
        const ax = Math.sign(ax0) * fw, az = Math.sign(az0) * fd, bx = Math.sign(bx0) * fw, bz = Math.sign(bz0) * fd;
        const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 1.3), gateSide = Math.abs(ax - bx) < 0.01 && Math.sign(ax) === gs;
        const pts = [];
        for (let k = 0; k <= n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
        if (gateSide) { pts.push([ax, -gate], [ax, gate]); pts.sort((u, v) => (bz > az ? u[1] - v[1] : v[1] - u[1])); }
        const P = pts.map(([lx, lz]) => { const q = FarmFields.at(F, lx, lz); return { lx, lz, x: q.x, z: q.z, y: T.heightAt(q.x, q.z) }; });
        P.forEach((q, k) => {
          const atGate = gateSide && Math.abs(Math.abs(q.lz) - gate) < 0.01;
          if (!(gateSide && Math.abs(q.lz) < gate - 0.01)) fence.box(atGate ? 0.15 : 0.1, atGate ? 1.25 : 1.0, atGate ? 0.15 : 0.1, q.x, q.y + (atGate ? 0.6 : 0.47), q.z, atGate ? 0x6e4626 : 0x8a5a33);
          const r = P[k + 1];
          if (!r || (gateSide && Math.abs((q.lz + r.lz) / 2) < gate)) return;
          for (const hy of [0.42, 0.8]) limb(fence, [q.x, q.y + hy, q.z], [r.x, r.y + hy, r.z], 0.035, 0.035, hy > 0.6 ? 0xa8743f : 0x8a5a33, 4);
          const L = Math.hypot(r.x - q.x, r.z - q.z), m = Math.max(1, Math.ceil(L / 0.5));
          for (let i = 0; i <= m; i++) W.addCollider({ x: q.x + (r.x - q.x) * i / m, z: q.z + (r.z - q.z) * i / m, r: 0.14 });
        });
      }
      // the signboard by the gate (its text changes with what's in the field)
      const sp = FarmFields.at(F, gs * (w / 2 + 0.9), 1.85), sy = T.heightAt(sp.x, sp.z), yaw = F.yaw + (gs > 0 ? Math.PI / 2 : -Math.PI / 2);
      fence.group(sp.x, sy, sp.z, 0, yaw, 0, () => { fence.box(0.1, 1.5, 0.1, 0, 0.75, -0.05, 0x5b3a24); fence.box(1.2, 0.68, 0.06, 0, 1.3, 0, 0x3e2716); });
      W.addCollider({ x: sp.x, z: sp.z, r: 0.14 });
      f.cv = document.createElement('canvas'); f.cv.width = 384; f.cv.height = 216;
      f.tex = new THREE.CanvasTexture(f.cv); f.tex.colorSpace = THREE.SRGBColorSpace;
      f.sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), new THREE.MeshLambertMaterial({ map: f.tex, emissive: 0xffffff, emissiveMap: f.tex, emissiveIntensity: 0.15 }));
      f.sign.position.set(sp.x + Math.sin(yaw) * 0.035, sy + 1.3, sp.z + Math.cos(yaw) * 0.035); f.sign.rotation.y = yaw;
      this.scene.add(f.sign); W.addFogCull(f.sign);
      f.gatePos = FarmFields.at(F, gs * (w / 2 + 1.0), 0);
      this._buildOwned(f, T);
      // where the crops stand: clumps along the ridges (none in the middle, where the scarecrow goes)
      const R = prng(9001 + slot * 131), C = CROPS.wheat, spots = [];
      for (let lz = -d / 2 + 0.45; lz < d / 2 - 0.35; lz += C.rows) for (let lx = -w / 2 + 0.35; lx < w / 2 - 0.3; lx += C.step) {
        if (Math.hypot(lx, lz) < 0.75) continue;
        const x = lx + (R() - 0.5) * 0.12, z = lz + (R() - 0.5) * 0.08;
        spots.push({ lx: x, lz: z, y: f.hAt(x, z) + 0.12, ry: R() * Math.PI * 2, s: 0.85 + R() * 0.3 });
      }
      f.spots = spots;
      f.crops = new THREE.InstancedMesh(this.geos.wheat.final, this.cropMat, spots.length);
      f.crops.receiveShadow = true; f.crops.visible = false; f.crops.frustumCulled = true;
      this._placeCrops(f, null);
      this.scene.add(f.crops);                                    // (not fog-culled: its visibility follows the crop)
      // the scarecrow (shown when the field has one)
      const cp = FarmFields.at(F, 0, 0);
      f.scare = new THREE.Mesh(this.scareGeo[1], MAT.solid); f.scare.castShadow = true; f.scare.visible = false;
      f.scare.position.set(cp.x, T.heightAt(cp.x, cp.z) + 0.05, cp.z); f.scare.rotation.y = F.yaw + (gs > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.scene.add(f.scare);
      f.scareAt = cp;
      this.list.push(f);
    });
    const fm = fence.build(MAT);
    fm.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.updateMatrixWorld(true); W.addFogCull(o); } });
    this.scene.add(fm);
    // crows, and the little bits that fly: seeds from your hand, water drops, chaff at the harvest
    this.crows = new THREE.InstancedMesh(crowGeometry(), MAT.solid, 30); this.crows.count = 0; this.crows.castShadow = true; this.crows.frustumCulled = false;
    this.scene.add(this.crows);
    this.bits = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 0.035), new THREE.MeshBasicMaterial({ color: 0xffffff }), 400);
    this.bits.count = 0; this.bits.frustumCulled = false; this.bits.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
    this.scene.add(this.bits);
    this._buildFlags();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._e = new THREE.Euler(); this._c = new THREE.Color();
    // the sowing meter on the screen
    this.meter = document.createElement('div'); this.meter.id = 'sowMeter'; this.meter.className = 'hidden'; this.g.hud.appendChild(this.meter);
  }
  // put the crop clumps in place (cells: during your own sowing only the parts you've covered show seeds)
  _placeCrops(f, cells) {
    const m = this._m || new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    f.spots.forEach((p, i) => {
      const show = !cells || cells[this._cell(p.lx, p.lz)];
      const w = FarmFields.at(f.F, p.lx, p.lz);
      m.compose(v.set(w.x, p.y, w.z), q.setFromAxisAngle(up, p.ry), s.setScalar(show ? p.s : 0));
      f.crops.setMatrixAt(i, m);
    });
    f.crops.instanceMatrix.needsUpdate = true;
    f.crops.computeBoundingSphere();
  }
  _cell(lx, lz) { const i = Math.max(0, Math.min(9, Math.floor((lx + FIELD.w / 2) / FIELD.w * 10))), j = Math.max(0, Math.min(5, Math.floor((lz + FIELD.d / 2) / FIELD.d * 6))); return j * 10 + i; }

  /* ---------- how a field looks: for sale (rough land) or the farm's (plowed, with an arch and flags) ---------- */
  // a field for sale: unplowed ground, grass in patches of green, dry yellow and bare earth, weeds, wild flowers, stones
  _buildFallow(f, T) {
    const { w, d } = FIELD, nx = 10, nz = 8, pos = [], col = [], idx = [], cc = new THREE.Color(), R = prng(4242 + f.slot * 77);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const lx = -w / 2 + w * i / nx, lz = -d / 2 + d * j / nz, q = FarmFields.at(f.F, lx, lz);
      const n = Math.sin(lx * 0.9 + f.slot) * Math.cos(lz * 1.3 - f.slot * 0.7) + (R() - 0.5) * 0.9;
      pos.push(q.x, T.heightAt(q.x, q.z) + 0.05 + R() * 0.04, q.z);
      cc.set(n > 0.55 ? 0x8f8a4a : n < -0.75 ? 0x7d6440 : n > 0 ? 0x6b9440 : 0x5e8a36); col.push(cc.r, cc.g, cc.b);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1; idx.push(a, c, b, b, c, e); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, MAT.solid); ground.receiveShadow = true; f.saleG.add(ground); this.g.world.addFogCull(ground);
    // weeds, wild flowers and a few stones
    const b = new GeoBuilder(), spot = m => { const lx = (R() - 0.5) * (w - m), lz = (R() - 0.5) * (d - m), q = FarmFields.at(f.F, lx, lz); return { x: q.x, y: T.heightAt(q.x, q.z) + 0.06, z: q.z }; };
    for (let k = 0; k < 46; k++) {
      const p = spot(0.6), h = 0.3 + R() * 0.3, dry = R() < 0.3;
      for (let i = 0; i < 3; i++) {
        const a = R() * Math.PI * 2;
        b.add(new THREE.ConeGeometry(0.06, h * (0.7 + R() * 0.4), 4), dry ? (i ? 0xb3a452 : 0xa39548) : (i ? 0x77a243 : 0x5f8c34), p.x + Math.cos(a) * 0.06, p.y + h * 0.4, p.z + Math.sin(a) * 0.06, Math.sin(a) * 0.35, R() * 3, Math.cos(a) * 0.35);
      }
    }
    for (let k = 0; k < 16; k++) {
      const p = spot(0.8), h = 0.25 + R() * 0.2;
      b.box(0.02, h, 0.02, p.x, p.y + h / 2, p.z, 0x5f8c34);
      b.box(0.08, 0.05, 0.08, p.x, p.y + h, p.z, k % 3 ? 0xf2d64b : 0xf4f0e6, 'solid', 0, R() * 3, 0);
    }
    for (let k = 0; k < 5; k++) { const p = spot(1); b.add(new THREE.DodecahedronGeometry(0.12 + R() * 0.1, 0), k % 2 ? 0x8a877f : 0x9e9b92, p.x, p.y + 0.02, p.z, R() * 3, R() * 3, 0, 'solid', 1, 0.6, 1); }
    const m = b.build(MAT);
    m.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.updateMatrixWorld(true); this.g.world.addFogCull(o); } });
    f.saleG.add(m);
  }
  // a bought field: an arch over the gate (two tall posts, a beam, a green board with the farm's name between two
  // beams, a lantern hanging from each end of the beam, a flag pole on top) and a pennant pole at each corner.
  // The arch's frame: x along the gate, z out of the field, y up from the ground at the gate.
  _buildOwned(f, T) {
    const fw = FIELD.w / 2 + 0.25, fd = FIELD.d / 2 + 0.25, g0 = FarmFields.at(f.F, f.gs * fw, 0);
    const A = f.A = { x: g0.x, z: g0.z, y: T.heightAt(g0.x, g0.z), yaw: f.F.yaw + (f.gs > 0 ? Math.PI / 2 : -Math.PI / 2) };
    const b = new GeoBuilder(), hp = s => { const q = FarmFields.at(A, s * 1.1, 0); return T.heightAt(q.x, q.z) - A.y; };
    b.group(A.x, A.y, A.z, 0, A.yaw, 0, () => {
      for (const s of [-1, 1]) {
        const y0 = hp(s) - 0.15, top = 3.2;
        b.box(0.22, top - y0, 0.22, s * 1.1, (top + y0) / 2, 0, ARCH.wood);
        b.box(0.28, 0.06, 0.28, s * 1.1, top + 0.03, 0, ARCH.gold);
        b.cyl(0, 0.16, 0.2, 4, s * 1.1, top + 0.16, 0, ARCH.woodL, 0, Math.PI / 4, 0);
        limb(b, [s * 1.1, 1.95, 0], [s * 0.72, 2.3, 0], 0.045, 0.045, ARCH.woodL, 4);             // knee braces
        b.box(0.04, 0.12, 0.04, s * 1.4, 2.86, 0, 0x3a3a3e);
        lantern(b, s * 1.4, 2.32, 0);
      }
      b.box(3.0, 0.2, 0.24, 0, 3.0, 0, ARCH.woodL);                                                // the top beam
      b.box(2.0, 0.13, 0.17, 0, 2.3, 0, ARCH.wood);                                                // the lower beam
      b.box(1.98, 0.54, 0.1, 0, 2.63, 0, ARCH.board);                                              // the board (painted both sides)
      b.cyl(0.04, 0.05, 2.8, 6, 0, 3.1 + 1.4, 0, ARCH.pole);                                        // the flag pole
      b.add(new THREE.SphereGeometry(0.09, 8, 6), ARCH.gold, 0, 5.93, 0);
    });
    f.pens = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const q = FarmFields.at(f.F, sx * fw, sz * fd), y = T.heightAt(q.x, q.z), o = FarmFields.at(f.F, sx * (fw + 1), sz * (fd + 1));
      b.cyl(0.03, 0.04, 2.45, 5, q.x, y + 1.2, q.z, ARCH.pole);
      b.add(new THREE.SphereGeometry(0.06, 6, 4), ARCH.gold, q.x, y + 2.46, q.z);
      f.pens.push({ x: q.x, y: y + PEN_Y, z: q.z, yaw: Math.atan2(-(o.z - q.z), o.x - q.x) });   // the pennant points away from the field
    }
    const m = b.build(MAT);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.updateMatrixWorld(true); this.g.world.addFogCull(o); } });
    f.ownG.add(m);
    // the board's painted faces (the farm's name and the field's number), front and back
    f.acv = document.createElement('canvas'); f.acv.width = 512; f.acv.height = 140;
    f.atex = new THREE.CanvasTexture(f.acv); f.atex.colorSpace = THREE.SRGBColorSpace; f.atex.anisotropy = 4;
    const mat = new THREE.MeshLambertMaterial({ map: f.atex, emissive: 0xffffff, emissiveMap: f.atex, emissiveIntensity: 0.22 });
    for (const side of [1, -1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.5), mat), q = FarmFields.at(A, 0, side * 0.056);
      pl.position.set(q.x, A.y + 2.63, q.z); pl.rotation.y = A.yaw + (side > 0 ? 0 : Math.PI);
      f.ownG.add(pl); this.g.world.addFogCull(pl);
    }
  }
  _drawArch(f) {
    const name = ((this.g.worldName && this.g.worldName()) || 'Our farm').toUpperCase(), key = name;
    if (f.archKey === key) return;
    f.archKey = key;
    const g = f.acv.getContext('2d'), W = f.acv.width, H = f.acv.height;
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#2f6a35'); grd.addColorStop(1, '#1d4422'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e2bd5a'; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
    g.lineWidth = 2; g.strokeRect(18, 18, W - 36, H - 36);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowOffsetY = 3; g.shadowBlur = 3;
    let fs = 52; g.font = `700 ${fs}px Georgia, serif`; while (g.measureText(name).width > W - 70 && fs > 24) { fs -= 2; g.font = `700 ${fs}px Georgia, serif`; }
    g.fillStyle = '#f3cf63'; g.fillText(name, W / 2, 58);
    g.font = '800 27px system-ui, sans-serif'; g.fillStyle = '#f4ecd2'; g.fillText(`✦  FIELD ${f.slot + 1}  ✦`, W / 2, 104);
    f.atex.needsUpdate = true;
  }
  // the flags (one waving flag on each bought field's arch) and pennants (four a field): two instanced meshes,
  // waved by the vertex shader — the further from the pole, the more it flaps
  _buildFlags() {
    const n = this.list.length, wave = sh => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float fp = uTime * 4.2 + instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23, fx = max(transformed.x, 0.0);
          transformed.z += (sin(fp - fx * 4.5) * 0.11 + sin(fp * 1.7 - fx * 8.0) * 0.03) * fx;
          transformed.y -= fx * fx * 0.03 * (1.2 + sin(fp * 0.4));
        #endif`);
    };
    // the flag's cloth: crimson, a cream band at the pole, a gold border and a gold wheat sheaf
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160;
    const g = cv.getContext('2d');
    g.fillStyle = '#c8233a'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#f2ead6'; g.fillRect(0, 0, 22, 160);
    g.strokeStyle = '#f3c84f'; g.lineWidth = 7; g.strokeRect(30, 9, 217, 142);
    g.strokeStyle = '#f3c84f'; g.fillStyle = '#f3c84f'; g.lineWidth = 4; g.lineCap = 'round';
    for (const a of [-0.38, -0.19, 0, 0.19, 0.38]) {
      const tx = 139 + Math.sin(a) * 62, ty = 80 - Math.cos(a) * 52;
      g.beginPath(); g.moveTo(139, 128); g.lineTo(tx, ty); g.stroke();
      for (let k = 0; k < 4; k++) {
        const u = 0.62 + k * 0.11, px = 139 + (tx - 139) * u, py = 128 + (ty - 128) * u;
        for (const s of [-1, 1]) { g.save(); g.translate(px, py); g.rotate(a + s * 0.5); g.beginPath(); g.ellipse(s * 5, 0, 4, 8, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
      }
    }
    g.fillRect(124, 104, 30, 7);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const flagGeo = new THREE.PlaneGeometry(1.7, 1.06, 12, 3); flagGeo.translate(0.89, 0, 0);
    this.flagMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, flatShading: true });
    this.flagMat.onBeforeCompile = wave; this.flagMat.customProgramCacheKey = () => 'flag-wave-v1';
    this.flags = new THREE.InstancedMesh(flagGeo, this.flagMat, n);
    // a pennant: a long thin triangle
    const penGeo = new THREE.PlaneGeometry(0.75, 0.42, 6, 1); penGeo.translate(0.4, 0, 0);
    const pp = penGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setY(i, pp.getY(i) * (1 - (pp.getX(i) - 0.03) / 0.75));
    this.penMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, flatShading: true });
    this.penMat.onBeforeCompile = wave; this.penMat.customProgramCacheKey = () => 'flag-wave-v1';
    this.pens = new THREE.InstancedMesh(penGeo, this.penMat, n * 4);
    for (let i = 0; i < n * 4; i++) this.pens.setColorAt(i, new THREE.Color(PENNANTS[i % 4]));
    for (const m of [this.flags, this.pens]) { m.frustumCulled = false; m.castShadow = true; this.scene.add(m); }
    this._flagsDirty = true;
  }
  _placeFlags() {
    const m = this._m, v = this._v, q = this._q, s = this._s, up = new THREE.Vector3(0, 1, 0);
    for (const f of this.list) {
      const on = f.owned ? 1 : 0, A = f.A, e = 1 - Math.pow(1 - f.raise, 3);
      m.compose(v.set(A.x, A.y + FLAG_LOW + (FLAG_TOP - FLAG_LOW) * e, A.z), q.setFromAxisAngle(up, A.yaw), s.setScalar(on));
      this.flags.setMatrixAt(f.slot, m);
      f.pens.forEach((p, k) => { m.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), s.setScalar(on * Math.min(1, e * 1.5))); this.pens.setMatrixAt(f.slot * 4 + k, m); });
    }
    this.flags.instanceMatrix.needsUpdate = true; this.pens.instanceMatrix.needsUpdate = true;
  }
  // the farm's own fields (for the map)
  ownedSpots() { return this.on ? this.list.filter(f => f.owned).map(f => ({ x: f.F.x, z: f.F.z, label: `Field ${f.slot + 1}` })) : []; }

  /* ---------- what's in a field (from the server) ---------- */
  info(slot, now = this.g.eco.serverNow()) {
    const e = this.g.eco, FS = e.fields(), f = FS && FS.list.find(x => x.slot === slot);
    if (!f) return { owned: false };
    const crop = f.crop ? e.cat('crop_' + f.crop) : null, C = CROPS[f.crop || 'wheat'];
    const out = { owned: true, f, stage: f.stage, crop, C, scarecrow: f.scarecrow };
    if (f.stage === 'growing') {
      const t0 = Date.parse(f.wateredAt), t1 = Date.parse(f.readyAt), pct = c01((now - t0) / Math.max(1, t1 - t0));
      Object.assign(out, { pct, msLeft: Math.max(0, t1 - now), ready: now >= t1, grow: now >= t1 ? 'final' : stageAt(C, pct).key, growLabel: now >= t1 ? 'Ripe — ready to harvest' : stageAt(C, pct).label });
    }
    return out;
  }
  _signText(f, I) {
    const e = this.g.eco, price = (e.cat('field') || {}).buy;
    if (!e.fields() || !price) return [`FIELD ${f.slot + 1}`, 'Opening soon', '#f2c14e'];   // (an older farm server: no fields yet)
    if (!I.owned) return [`FIELD ${f.slot + 1}`, `FOR SALE · ₹${price}`, '#ffffff', 'sale'];
    if (I.stage === 'empty') return [`FIELD ${f.slot + 1}`, 'Ready to sow', '#cfe8a0'];
    if (I.stage === 'sowing') return [`FIELD ${f.slot + 1}`, 'Sowing…', '#cfe8a0'];
    if (I.stage === 'sown') return [`FIELD ${f.slot + 1} · WHEAT`, 'Needs water', '#8fd0ff'];
    if (I.ready) return [`FIELD ${f.slot + 1} · WHEAT`, 'READY TO HARVEST', '#ffd34d'];
    const m = Math.ceil(I.msLeft / 60000);
    return [`FIELD ${f.slot + 1} · WHEAT`, `Ripe in ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`}`, '#e8f0d8'];
  }
  // the signboard: bare weathered wood with a red FOR SALE band for a field for sale, painted green with gold trim
  // once it's the farm's
  _drawSign(f, [title, sub, col, style]) {
    const own = !!f.owned && style !== 'sale', key = title + sub + own;
    if (f.signKey === key) return;
    f.signKey = key;
    const g = f.cv.getContext('2d'), W = f.cv.width, H = f.cv.height;
    const grd = g.createLinearGradient(0, 0, 0, H);
    if (own) { grd.addColorStop(0, '#2f6a35'); grd.addColorStop(1, '#1d4422'); } else { grd.addColorStop(0, '#6e472a'); grd.addColorStop(1, '#4a2e1a'); }
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = 2;
    for (let i = 0; i < 7; i++) { const y = 16 + i * 30; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W * 0.3, y + 5, W * 0.7, y - 5, W, y + 2); g.stroke(); }
    g.strokeStyle = own ? '#e2bd5a' : '#d9b56a'; g.lineWidth = 6; g.strokeRect(12, 12, W - 24, H - 24);
    if (own) { g.lineWidth = 2; g.strokeRect(22, 22, W - 44, H - 44); }
    if (style === 'sale') { g.fillStyle = '#b8262f'; g.fillRect(12, 120, W - 24, 60); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(12, 120, W - 24, 3); }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f7e8c2'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowOffsetY = 3; g.shadowBlur = 4;
    let fs = 50; g.font = `700 ${fs}px Georgia, serif`; while (g.measureText(title).width > W - 60 && fs > 26) { fs -= 2; g.font = `700 ${fs}px Georgia, serif`; }
    g.fillText(title, W / 2, 78);
    g.shadowColor = 'transparent'; g.fillStyle = col; g.font = '800 34px system-ui, sans-serif'; g.fillText(sub, W / 2, 150);
    f.tex.needsUpdate = true;
  }

  /* ---------- every frame ---------- */
  update(dt, now) {
    if (!this.on) return;
    this.t += dt; this.uTime.value = this.t;
    const e = this.g.eco;
    let crowN = 0;
    for (const f of this.list) {
      const I = e.ready ? this.info(f.slot, now) : { owned: false };
      // bought or for sale: plowed with its arch and flags, or rough land. Bought while you're here: the flag goes up
      const owned = !!I.owned;
      if (owned !== f.owned) {
        const seen = f.owned === false && f.known;
        f.owned = owned; f.ownG.visible = owned; f.saleG.visible = !owned;
        f.raise = owned && !seen ? 1 : 0; this._flagsDirty = true;
        if (owned && seen) this._splash(f, 'confetti');
      }
      if (e.ready && e.fields()) f.known = true;
      if (owned && f.raise < 1) { f.raise = Math.min(1, f.raise + dt / 2.5); this._flagsDirty = true; }
      if (owned) this._drawArch(f);
      // what the field shows: nothing (empty / for sale), seeds (sown, or where you've sown), or the growing crop
      const mine = this.sow && this.sow.slot === f.slot;
      const grow = mine ? 'seeds' : I.stage === 'sown' ? 'seeds' : I.stage === 'growing' ? I.grow : null;
      // far from the player: the cheaper shapes (when the crop has them)
      const pp = this.g.player.pos, far = Math.hypot(pp.x - f.F.x, pp.z - f.F.z) > CROPS.wheat.farAt, show = grow && far && this.geos.wheat[grow + 'Far'] ? grow + 'Far' : grow;
      const key = (show || '-') + (mine ? ':mine' : '');
      // something changed for everyone: watered (water drops), harvested (chaff)
      if (f.stage === 'sown' && I.stage === 'growing') this._splash(f, 'water');
      if (f.stage === 'growing' && I.stage && I.stage !== 'growing') this._splash(f, 'chaff');
      if (key !== f.key) {
        f.key = key;
        if (show) { f.crops.geometry = this.geos.wheat[show]; f.crops.visible = true; this._placeCrops(f, mine ? this.sow.cells : null); }
        else f.crops.visible = false;
      }
      f.stage = I.stage || null;
      f.soilMat.color.setScalar(I.stage === 'growing' && I.pct < 0.25 ? 0.72 : 1);       // freshly watered: the earth is dark and wet
      const lv = I.owned ? I.scarecrow : 0;
      if (lv !== f.lv) { f.lv = lv; f.scare.visible = lv > 0; if (lv) f.scare.geometry = this.scareGeo[lv]; }
      this._drawSign(f, this._signText(f, I));
      // crows on a field with something in it and no (good) scarecrow
      if (show && lv < 2) crowN = this._crows(f, lv, crowN);
    }
    this.crows.count = crowN; if (crowN) { this.crows.instanceMatrix.needsUpdate = true; }
    if (this._flagsDirty) { this._flagsDirty = false; this._placeFlags(); }
    this._sowing(dt);
    this._bits(dt);
  }
  // crows: they land, peck, hop to another place, now and then take off and come back. A level 1 scarecrow scares
  // them off most of the time (two come down now and then).
  _crows(f, lv, n) {
    const many = lv ? 2 : 4, T = this.t, m = this._m;
    for (let i = 0; i < many && n < 30; i++) {
      const cyc = 9 + i * 1.7, k = Math.floor((T + i * 3.1 + f.slot * 5) / cyc), u = ((T + i * 3.1 + f.slot * 5) % cyc) / cyc;
      if (lv && (k + i) % 3 !== 0) continue;                                              // scared away for now
      const R = prng(f.slot * 977 + i * 131 + k * 7), lx = (R() - 0.5) * (FIELD.w - 1.5), lz = (R() - 0.5) * (FIELD.d - 1.5), hop = R() * 6.28;
      // fly in (0–12 %), peck about (12–88 %), fly off (88–100 %)
      const air = u < 0.12 ? 1 - u / 0.12 : u > 0.88 ? (u - 0.88) / 0.12 : 0, wander = Math.sin(u * 9 + hop) * 0.6;
      const x = lx + Math.cos(hop) * wander + air * 6 * Math.cos(hop), z = lz + Math.sin(hop) * wander + air * 6 * Math.sin(hop);
      const p = FarmFields.at(f.F, x, z), y = f.hAt(x, z) + 0.14 + air * 5 + (air ? 0 : Math.abs(Math.sin(u * 40)) * 0.04);
      const peck = air ? -0.2 : (Math.sin(u * 55 + i) > 0.6 ? 0.7 : 0);
      this._e.set(peck, f.F.yaw + hop + Math.PI / 2 + Math.cos(u * 9 + hop) * 0.5, 0);
      m.compose(this._v.set(p.x, y, p.z), this._q.setFromEuler(this._e), this._s.setScalar(1));
      this.crows.setMatrixAt(n++, m);
    }
    return n;
  }

  /* ---------- sowing (only on this player's screen; the server just checks the time it took) ---------- */
  startSowing(slot) {
    const f = this.list[slot];
    if (!f) return;
    const crop = this.g.eco.cat('crop_wheat') || {};
    this.sow = { slot, t: 0, need: crop.sowS || 10, cells: new Uint8Array(60), far: 0, spray: 0, done: false, last: this.g.player.pos.clone() };
    f.key = '';                                                                            // (redraw: only the covered parts show seeds)
    if (this.g.touch) this.g.touch.setSow(true);
    this.g.toast(this.g.touch && this.g.touch.enabled ? '🌱 Walk all over the field holding the SOW button to scatter the seeds' : '🌱 Walk all over the field and scatter the seeds — hold Space (or F / click)');
  }
  stopSowing(msg) {
    if (!this.sow) return;
    const f = this.list[this.sow.slot];
    this.sow = null; if (f) f.key = '';
    this.meter.className = 'hidden';
    if (this.g.touch) this.g.touch.setSow(false);
    if (msg) this.g.toast(msg);
  }
  // keys while sowing: Space, F or a click scatter seeds (and don't jump or punch)
  input(input) {
    if (!this.sow) return;
    const held = input.isDown('Space', 'KeyF');
    if (input.click || input.wasPressed('KeyF') || input.wasPressed('Space')) this.sow.spray = 0.7;
    if (held) this.sow.spray = Math.max(this.sow.spray, 0.15);
    input.pressed.delete('Space'); input.pressed.delete('KeyF'); input.click = false;
  }
  _sowing(dt) {
    const S = this.sow;
    if (!S) return;
    const p = this.g.player, f = this.list[S.slot], l = FarmFields.local(f.F, p.pos.x, p.pos.z);
    const inside = Math.abs(l.x) < FIELD.w / 2 && Math.abs(l.z) < FIELD.d / 2;
    const speed = p.pos.distanceTo(S.last) / Math.max(dt, 1e-3); S.last.copy(p.pos);
    S.spray = Math.max(0, S.spray - dt);
    const spraying = S.spray > 0 && p.mode === 'foot';
    if (spraying) this._emit(p.pos, 'seed', 30 * dt);
    if (inside && spraying && speed > 0.6 && !S.done) {
      S.t += dt;
      const c = this._cell(l.x, l.z);
      if (!S.cells[c]) { S.cells[c] = 1; this._placeCrops(f, S.cells); }
    }
    if (!inside) S.far = Math.hypot(l.x, l.z) > 14 ? S.far + dt : 0;
    if (S.far > 2.5 || p.mode !== 'foot') { this.stopSowing('🌱 Sowing stopped — press E at the field to start again'); return; }
    const pct = Math.min(1, S.t / S.need), cov = Math.round(S.cells.reduce((a, b) => a + b, 0) / 60 * 100);
    const tip = !inside ? 'Go into the field' : !spraying ? (this.g.touch && this.g.touch.enabled ? 'Hold SOW' : 'Hold Space (or click)') + ' and keep walking' : speed > 0.6 ? 'Scattering seeds…' : 'Keep walking';
    this.meter.className = '';
    this.meter.innerHTML = `<div class="sm-top"><span>🌱 Sowing field ${S.slot + 1}</span><b>${(S.t).toFixed(1)} / ${S.need} s</b></div><div class="sm-bar"><i style="width:${pct * 100}%"></i></div><div class="sm-hint">${tip} · ${cov}% of the field</div>`;
    if (S.t >= S.need && !S.done) {
      S.done = true;
      this.g.act({ action: 'field', op: 'sow', slot: S.slot }).then(r => { this.stopSowing(); this.g.toast('🌱 ' + r.message); this._splash(f, 'seed'); },
        er => { if (er && /too_fast|Walk all over/.test(er.message || '')) { S.done = false; S.t = S.need - 1.5; } else this.stopSowing('⚠ ' + (er.message || er)); });
    }
  }

  /* ---------- little flying bits ---------- */
  _emit(at, kind, n) {
    this._acc = (this._acc || 0) + n;
    while (this._acc >= 1 && this.fx.length < 380) {
      this._acc -= 1;
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.4;
      this.fx.push({ x: at.x + Math.cos(a) * 0.2, y: at.y + 1.0, z: at.z + Math.sin(a) * 0.2, vx: Math.cos(a) * sp, vy: 1 + Math.random(), vz: Math.sin(a) * sp, t: 1.1, kind });
    }
  }
  // drops over the whole field when it's watered; chaff when it's harvested; seeds settling when it's sown
  _splash(f, kind) {
    if (kind === 'confetti') {
      for (let i = 0; i < 160 && this.fx.length < 390; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5, q = FarmFields.at(f.A, (Math.random() - 0.5) * 2.6, 0);
        this.fx.push({ x: q.x, y: f.A.y + 3.2, z: q.z, vx: Math.cos(a) * sp, vy: 2.5 + Math.random() * 3, vz: Math.sin(a) * sp, t: 3, kind, floor: f.A.y - 0.5, c: CONFETTI[i % CONFETTI.length] });
      }
      return;
    }
    const n = kind === 'water' ? 180 : 120;
    for (let i = 0; i < n && this.fx.length < 390; i++) {
      const lx = (Math.random() - 0.5) * FIELD.w, lz = (Math.random() - 0.5) * FIELD.d, p = FarmFields.at(f.F, lx, lz), y = f.hAt(lx, lz);
      this.fx.push(kind === 'water' ? { x: p.x, y: y + 2.5 + Math.random() * 2.5, z: p.z, vx: 0, vy: -3, vz: 0, t: 2.2, kind, floor: y + 0.1 }
        : { x: p.x, y: y + 0.4 + Math.random() * 0.6, z: p.z, vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 1.5, t: 1.5, kind, floor: y });
    }
  }
  _bits(dt) {
    const m = this._m, col = this._c, list = this.fx;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.t -= dt; b.vy -= (b.kind === 'water' ? 6 : b.kind === 'confetti' ? 4 : 9.8) * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.kind === 'confetti') { b.vx *= 1 - dt * 1.5; b.vz *= 1 - dt * 1.5; if (b.vy < -1.2) b.vy = -1.2; }       // (confetti flutters down)
      if (b.floor !== undefined && b.y < b.floor) b.t = 0;
      if (b.t <= 0) { list.splice(i, 1); continue; }
    }
    for (const b of list) {
      if (n >= 400) break;
      if (b.kind === 'confetti') m.compose(this._v.set(b.x, b.y, b.z), this._q.setFromEuler(this._e.set(b.t * 7 + b.c, b.t * 4, 0)), this._s.set(2.6, 0.4, 2.6));
      else m.compose(this._v.set(b.x, b.y, b.z), this._q.identity(), this._s.set(1, b.kind === 'water' ? 2.5 : 1, 1));
      this.bits.setMatrixAt(n, m);
      this.bits.setColorAt(n, col.set(b.c || (b.kind === 'water' ? 0x7cc4ff : b.kind === 'chaff' ? 0xe9c66a : 0xf0dca8)));
      n++;
    }
    this.bits.count = n;
    if (n) { this.bits.instanceMatrix.needsUpdate = true; this.bits.instanceColor.needsUpdate = true; }
  }

  /* ---------- E: the field's panel ---------- */
  acts() {
    if (!this.on || !this.g.eco.ready || !this.g.eco.fields()) return [];
    const out = [];
    for (const f of this.list) {
      if (this.sow && this.sow.slot === f.slot) continue;
      const I = this.info(f.slot), n = f.slot + 1, cp = FarmFields.at(f.F, 0, 0);
      const label = !I.owned ? `Field ${n} — for sale` : I.stage === 'empty' || I.stage === 'sowing' ? `Field ${n} — sow wheat` : I.stage === 'sown' ? `Field ${n} — water it` : I.ready ? `Field ${n} — harvest the wheat` : `Field ${n} — wheat growing`;
      out.push({ pos: { x: cp.x, y: f.hAt(0, 0), z: cp.z }, r: 6.9, label: () => label, act: () => this.g.openField(f.slot) });
    }
    return out;
  }
}
