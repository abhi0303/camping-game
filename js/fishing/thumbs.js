// Small 3D pictures of the rods and fish for the Fish Market screens (rendered once, kept as images).
// A tiny renderer of its own draws them, then lets its WebGL context go after a few idle seconds.
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';
import { FARM_MAT } from '../farm/props.js';
import { buildRod, buildFish } from './models.js';

const cache = new Map();
let R = null, idleT = 0;
function renderer() {
  if (!R) {
    const canvas = document.createElement('canvas');
    const gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    gl.setPixelRatio(1); gl.setSize(240, 150, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
    R = { gl, scene, cam: new THREE.PerspectiveCamera(30, 240 / 150, 0.01, 50) };
  }
  clearTimeout(idleT);
  idleT = setTimeout(() => { if (R) { R.gl.dispose(); R.gl.forceContextLoss(); R = null; } }, 5000);
  return R;
}
// key: 'rod1' | 'rod2' | 'rod3' | 'fish_small' | 'fish_medium' | 'fish_large' -> a data: URL ('' if WebGL fails)
export function thumb(key) {
  if (cache.has(key)) return cache.get(key);
  let url = '';
  try {
    const { gl, scene, cam } = renderer(), b = new GeoBuilder();
    if (key.startsWith('rod')) buildRod(b, Number(key.slice(3))); else buildFish(b, key);
    const obj = b.build(FARM_MAT), pivot = new THREE.Group();
    pivot.add(obj);
    // rods lie diagonally (drawn thicker, or they'd be a thin line), fish show their side
    if (key.startsWith('rod')) { obj.scale.set(3.2, 3.2, 1); obj.rotation.z = 0.5; pivot.rotation.set(0, Math.PI / 2, 0.42); }
    else pivot.rotation.set(0.12, Math.PI / 2 + 0.35, 0);
    scene.add(pivot); pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const d = Math.max(size.x / cam.aspect, size.y) / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.12;
    cam.position.set(c.x, c.y, c.z + d + size.z / 2); cam.lookAt(c);
    gl.setClearColor(0x000000, 0); gl.render(scene, cam);
    url = gl.domElement.toDataURL('image/png');
    scene.remove(pivot); obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  } catch (e) { url = ''; }
  cache.set(key, url);
  return url;
}
