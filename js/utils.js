import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

// Seeded random so the world looks the same every load
let _seed = 1337;
export function srand(s) { _seed = s; }
export function rand(a = 0, b = 1) {
  _seed = (_seed * 16807) % 2147483647;
  return a + ((_seed - 1) / 2147483646) * (b - a);
}

/* ---------- Materials ---------- */
// One vertex-coloured, flat-shaded material is shared by almost every static mesh.
export const MAT = {
  solid: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  glass: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.5, depthWrite: false }),
  headlight: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffe2a0, emissiveIntensity: 0.25 }),
  taillight: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xff2010, emissiveIntensity: 0.25 }),
  amber: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xff9a20, emissiveIntensity: 0.35 }),
  lamp: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xfff0c8, emissiveIntensity: 0.0 }),
};

/* ---------- Geometry builder ---------- */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// Collects primitives (with a colour each) and merges them into one mesh per material.
export class GeoBuilder {
  constructor() {
    this.buckets = {};
    this.stack = [new THREE.Matrix4()];
  }
  // Run fn with an extra transform applied (for building sub-parts in local space)
  group(x, y, z, rx, ry, rz, fn) {
    _e.set(rx || 0, ry || 0, rz || 0);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e), new THREE.Vector3(1, 1, 1));
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m));
    fn();
    this.stack.pop();
  }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, mat = 'solid', sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
    geo.applyMatrix4(_m);
    geo.applyMatrix4(this.stack[this.stack.length - 1]);
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv2) g.deleteAttribute('uv2');
    if (!g.attributes.normal) g.computeVertexNormals();
    _c.set(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (this.buckets[mat] || (this.buckets[mat] = [])).push(g);
    return g;
  }
  // Axis-aligned box given by size + centre
  box(w, h, d, x, y, z, color, mat = 'solid', rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz, mat);
  }
  // Box given by min/max corners
  boxMM(x0, x1, y0, y1, z0, z1, color, mat = 'solid') {
    return this.box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, color, mat);
  }
  cyl(rt, rb, h, seg, x, y, z, color, rx = 0, ry = 0, rz = 0, mat = 'solid') {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz, mat);
  }
  build(materials = MAT) {
    const group = new THREE.Group();
    for (const key in this.buckets) {
      const list = this.buckets[key];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      list.forEach(g => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[key] || MAT.solid);
      mesh.name = key;
      if (!key.startsWith('glass')) { mesh.castShadow = true; mesh.receiveShadow = true; }
      group.add(mesh);
    }
    this.buckets = {};
    return group;
  }
}

// Extrude a 2D side profile [[z,y],...] across X (centered), optional holes [[[z,y],...]]
export function extrudeX(points, width, holes = []) {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
  holes.forEach(h => shape.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1])))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);      // shape x -> world z, extrude z -> world -x
  g.translate(width / 2, 0, 0);
  return g;
}

// Split a rectangle (0..L, 0..H) into solid rects that avoid the given holes.
// holes: [{u0,u1,v0,v1}] — returns [{u0,u1,v0,v1}]
export function rectsWithHoles(L, H, holes) {
  const us = new Set([0, L]);
  holes.forEach(h => { us.add(clamp(h.u0, 0, L)); us.add(clamp(h.u1, 0, L)); });
  const cols = [...us].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < cols.length - 1; i++) {
    const ua = cols[i], ub = cols[i + 1];
    if (ub - ua < 1e-4) continue;
    const cut = holes.filter(h => h.u0 <= ua + 1e-4 && h.u1 >= ub - 1e-4).map(h => [h.v0, h.v1]).sort((a, b) => a[0] - b[0]);
    let v = 0;
    for (const [v0, v1] of cut) {
      if (v0 > v + 1e-4) out.push({ u0: ua, u1: ub, v0: v, v1: Math.min(v0, H) });
      v = Math.max(v, v1);
    }
    if (v < H - 1e-4) out.push({ u0: ua, u1: ub, v0: v, v1: H });
  }
  // merge vertically-identical neighbouring columns to cut triangle count
  out.sort((a, b) => a.v0 - b.v0 || a.v1 - b.v1 || a.u0 - b.u0);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.v0 - r.v0) < 1e-4 && Math.abs(last.v1 - r.v1) < 1e-4 && Math.abs(last.u1 - r.u0) < 1e-4) last.u1 = r.u1;
    else merged.push({ ...r });
  }
  return merged;
}

// Flat ring sector on the ground (for curved roads)
export function flatArc(cx, cz, r0, r1, a0, a1, seg, y) {
  const pos = [];
  const P = (r, a) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + (a1 - a0) * (i / seg), t1 = a0 + (a1 - a0) * ((i + 1) / seg);
    const A = P(r0, t0), B = P(r1, t0), C = P(r1, t1), D = P(r0, t1);
    pushTri(pos, A, B, C); pushTri(pos, A, C, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
// Push a triangle making sure it faces up (+Y)
function pushTri(arr, a, b, c) {
  const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
  const ny = uz * vx - ux * vz;
  if (ny >= 0) arr.push(...a, ...b, ...c); else arr.push(...a, ...c, ...b);
}

/* ---------- Canvas textures ---------- */
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

export function plateTexture(text) {
  return canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#222'; g.lineWidth = 5; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#1b1b1b'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}
