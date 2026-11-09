// What the real weather looks like in Farm World (the data comes from js/weather/sync.js; the rules for each
// condition from js/weather/rules.js). It adds to the time of day (js/day-night.js), it never moves the sun
// or the clock:
//   - clouds: low-poly clouds drifting with the wind, more of them (bigger, greyer) the cloudier it is
//   - rain: streaks falling around the camera, drawn by the GPU (one draw call, nothing made per frame);
//     how many depends on how hard it rains and the graphics setting
//   - wet ground and puddles: the ground darkens while it rains and dries slowly after; puddles on the
//     roads and flat ground fill up, with rings when the rain hits them
//   - thunderstorms: lightning bolts far away with the sky lighting up, thunder a few seconds later. The
//     moments come from the shared clock, so every player sees the same flashes
//   - wind: trees, bushes and grass sway harder, leaves fly by on a strong wind
//   - fog and haze: weather fog (grey) and pollution haze (yellow-brown, from the AQI) are separate inputs;
//     the stronger one sets how far you can see, the weaker only adds a little (no double fog)
// Everything eases toward the new weather over a while (no sudden switches, no flicker).
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';
import { fxOf } from './rules.js';

const QUALITY = { low: { rain: 1500, leaves: 24 }, medium: { rain: 3400, leaves: 48 }, high: { rain: 5600, leaves: 72 } };
const MAX_RAIN = 5600, MAX_LEAVES = 72, CLOUDS = 54, CLOUD_FIELD = 1000, PUDDLES = 46;
// the farm's default sky when there's no real weather yet: what Farm World always looked like
const NEUTRAL = { clouds: 0.3, dark: 0, rain: 0, fog: 0, haze: 0, wind: 2.2, gusts: 3.5, windDir: 240, lightning: 0, wet: 0 };
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const rng = seed => { let s = seed % 2147483647; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

const RAIN_VS = `attribute vec4 aDrop; attribute float aEnd;
uniform float uTime, uLen, uAmt; uniform vec3 uCam; uniform vec2 uWind; uniform vec3 uBox;
varying float vA;
void main() {
  float sp = 10.0 + aDrop.w * 5.0;
  float y = mod(aDrop.y * uBox.y - uTime * sp, uBox.y);
  vec2 xz = mod(aDrop.xz * uBox.xz + uWind * uTime - uCam.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
  vec3 p = vec3(uCam.x + xz.x, uCam.y - uBox.y * 0.45 + y, uCam.z + xz.y);
  vec3 dir = normalize(vec3(uWind.x, -sp, uWind.y));
  p -= dir * uLen * aEnd;
  vA = uAmt * (1.0 - aEnd * 0.75) * smoothstep(uBox.x * 0.5, uBox.x * 0.2, length(xz)) * smoothstep(0.0, 2.0, y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FS = `uniform vec3 uColor; varying float vA;
void main() { gl_FragColor = vec4(uColor, vA); }`;

export class WeatherFX {
  // g: { world, grass, now() (the shared clock, ms), inside() (true: the player is in the RV) }
  constructor(scene, g) {
    this.scene = scene; this.g = g; this.world = g.world; this.on = false; this.built = false;
    this.cur = { ...NEUTRAL }; this.tgt = { ...NEUTRAL }; this.first = true; this.t = 0; this.Q = QUALITY.medium;
    this.flash = 0; this.slot = 0; this.bolt = null; this.boltT = 0;
    this.audio = { rain: 0, heavy: 0, wind: 0, thunder: [] };
    this.cloudOff = new THREE.Vector2(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._e = new THREE.Euler(); this._c = new THREE.Color();
  }
  setQuality(name) { this.Q = QUALITY[name] || QUALITY.medium; }

  /* ---------- on / off (Farm World only) ---------- */
  enable() {
    if (this.on) return;
    this.on = true;
    if (!this.built) this._build();
    for (const o of [this.clouds, this.rain, this.puddles, this.leaves]) o.visible = true;
    if (this.world.cloudGroup) this.world.cloudGroup.visible = false;      // (the old still clouds: back in Zombie Trail)
    this.first = true;
  }
  disable() {
    if (!this.on) return;
    this.on = false;
    for (const o of [this.clouds, this.rain, this.puddles, this.leaves, this.bolt]) if (o) o.visible = false;
    if (this.world.cloudGroup) this.world.cloudGroup.visible = true;
    Object.assign(this.world.dayNight.weather, { clouds: 0, fog: 0, haze: 0, flash: 0, dark: 0 });
    const f = this.world.scene.fog, base = this.world.fogBase || 300;
    f.far = base; f.near = base * 0.25;
    this._uniforms(NEUTRAL, 0);
    this.audio.rain = this.audio.heavy = 0; this.audio.wind = 0; this.audio.thunder.length = 0;
    this.cur = { ...NEUTRAL }; this.tgt = { ...NEUTRAL };
  }
  // the shared weather (null: none yet — the farm's usual sky)
  set(w) {
    const f = fxOf(w);
    this.tgt = f ? { ...f } : { ...NEUTRAL };
    if (this.first && f) { this.cur = { ...this.tgt }; this.first = false; }       // opening the world: the weather is just there
  }

  /* ---------- building (once) ---------- */
  _build() {
    this.built = true;
    const W = this.world;
    // clouds: three shapes, instanced
    this.clouds = new THREE.Group();
    this.cloudList = [];
    const R = rng(4711);
    for (let v = 0; v < 3; v++) {
      const b = new GeoBuilder();
      for (let k = 0; k < 4 + v; k++) b.add(new THREE.IcosahedronGeometry(7 + R() * 6, 0), 0xffffff, (k - (3 + v) / 2) * 9 + R() * 4, R() * 3, R() * 8 - 4, 0, R() * 3, 0, 'solid', 1.4, 0.55, 1);
      const geo = b.build().children[0].geometry;
      const im = new THREE.InstancedMesh(geo, W.cloudMat, CLOUDS / 3);
      im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false;
      this.clouds.add(im);
      for (let i = 0; i < CLOUDS / 3; i++) this.cloudList.push({ im, i, x: R(), z: R(), y: 92 + R() * 40, s: 0.8 + R() * 0.6, yaw: R() * 6.28, order: R() });
    }
    this.cloudList.sort((a, b) => a.order - b.order);                          // which clouds come first as the sky fills
    this.scene.add(this.clouds);
    // rain: line streaks moved by the vertex shader
    const pos = new Float32Array(MAX_RAIN * 2 * 3), drop = new Float32Array(MAX_RAIN * 2 * 4), end = new Float32Array(MAX_RAIN * 2);
    for (let i = 0; i < MAX_RAIN; i++) {
      const d = [R(), R(), R(), R()];
      for (let k = 0; k < 2; k++) { drop.set(d, (i * 2 + k) * 4); end[i * 2 + k] = k; }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('aDrop', new THREE.BufferAttribute(drop, 4)); rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uLen: { value: 0.9 }, uAmt: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uBox: { value: new THREE.Vector3(30, 22, 30) }, uColor: { value: new THREE.Color(0xdde6f0) } } });
    this.rain = new THREE.LineSegments(rg, this.rainMat); this.rain.frustumCulled = false; this.rain.renderOrder = 2;
    rg.setDrawRange(0, 0);
    this.scene.add(this.rain);
    // puddles: on the roads and on flat open ground around the farm, the store, the windmill and the village
    this._buildPuddles(R);
    // leaves blown by a strong wind
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.08, 0.06, 0, 0.05, -0.06, 0, 0.05], 3)); lg.computeVertexNormals();
    this.leaves = new THREE.InstancedMesh(lg, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), MAX_LEAVES);
    this.leaves.frustumCulled = false; this.leaves.count = 0;
    const greens = [0x6f8f2e, 0x8a9a3a, 0xa08a3a, 0x5d7a2a, 0xb07a34];
    for (let i = 0; i < MAX_LEAVES; i++) this.leaves.setColorAt(i, this._c.set(greens[i % greens.length]));
    this.leafList = Array.from({ length: MAX_LEAVES }, () => ({ x: 0, y: -999, z: 0, ph: R() * 6.28, sp: 0.7 + R() * 0.6 }));
    this.scene.add(this.leaves);
  }
  _buildPuddles(R) {
    const W = this.world, T = W.T, spots = [];
    for (let tries = 0; tries < 6000 && spots.length < PUDDLES; tries++) {
      const x = -200 + R() * 240, z = -235 + R() * 210;
      if (T.riverDistAt(x, z) < 8) continue;
      const road = T.roadDistAt(x, z) < 2.6;
      if (!road && R() > 0.35) continue;
      const h = T.heightAt(x, z);
      let flat = true;
      for (let a = 0; a < 6 && flat; a++) if (Math.abs(T.heightAt(x + Math.cos(a) * 1.4, z + Math.sin(a) * 1.4) - h) > 0.14) flat = false;
      if (!flat) continue;
      let blocked = false;
      W.forNear(x, z, c => { if (!blocked && Math.hypot(c.x - x, c.z - z) < (c.r || 0.5) + 1.6) blocked = true; });
      if (blocked || spots.some(s => Math.hypot(s.x - x, s.z - z) < 7)) continue;
      spots.push({ x, z, y: h + 0.05, sx: 0.7 + R() * 1.0, sz: 0.5 + R() * 0.7, yaw: R() * 6.28 });
    }
    const pg = new THREE.CircleGeometry(1, 10);
    const p = pg.attributes.position;
    for (let i = 1; i < p.count; i++) { const k = 0.8 + R() * 0.35; p.setX(i, p.getX(i) * k); p.setY(i, p.getY(i) * k); }
    pg.rotateX(-Math.PI / 2);
    this.puddleMat = new THREE.MeshLambertMaterial({ color: 0x3e4a55, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.rippleU = { uRT: { value: 0 }, uRA: { value: 0 } };
    this.puddleMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.rippleU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPL;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPL = position.xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPL; uniform float uRT, uRA;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 cell = floor(vPL * 2.5); vec2 f = fract(vPL * 2.5) - 0.5;
          float ph = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float t = fract(uRT * 0.9 + ph), ring = smoothstep(0.06, 0.0, abs(length(f) - t * 0.45)) * (1.0 - t);
          diffuseColor.rgb += ring * uRA * 0.35;`);
    };
    this.puddleMat.customProgramCacheKey = () => 'puddle-v1';
    this.puddles = new THREE.InstancedMesh(pg, this.puddleMat, Math.max(1, spots.length));
    spots.forEach((s, i) => this.puddles.setMatrixAt(i, this._m.compose(this._v.set(s.x, s.y, s.z), this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), this._s.set(s.sx, 1, s.sz))));
    this.puddles.count = spots.length; this.puddles.receiveShadow = true; this.puddles.renderOrder = 1;
    this.puddles.computeBoundingSphere();
    this.scene.add(this.puddles);
  }

  /* ---------- every frame ---------- */
  update(dt, camera) {
    if (!this.on) return;
    this.t += dt;
    const C = this.cur, T = this.tgt, ease = (k, tau) => { C[k] += (T[k] - C[k]) * (1 - Math.exp(-dt / tau)); };
    ease('clouds', 30); ease('dark', 25); ease('fog', 30); ease('haze', 40); ease('rain', 8); ease('wind', 10); ease('gusts', 10); ease('lightning', 5);
    ease('wet', T.wet > C.wet ? 90 : 900);                                     // wet in a minute or two, dry over a quarter of an hour
    const da = ((T.windDir - C.windDir + 540) % 360) - 180; C.windDir += da * (1 - Math.exp(-dt / 15));
    const W = this.world, dn = W.dayNight, cam = camera.position;
    // gusts: the wind rises and falls
    const gust = c01(0.5 + 0.35 * Math.sin(this.t * 0.37) + 0.25 * Math.sin(this.t * 1.13 + 1.7));
    const wind = C.wind + (C.gusts - C.wind) * gust, wa = (C.windDir + 180) * Math.PI / 180;       // (blows toward windDir + 180°)
    const wx = Math.sin(wa), wz = Math.cos(wa);
    // lightning (thunderstorms): the same moments for everyone, from the shared clock
    this._lightning(dt, cam);
    // sky, light, fog and haze
    const overcast = c01((C.clouds - 0.4) / 0.6) * 0.78 + C.dark * 0.3;
    Object.assign(dn.weather, { clouds: c01(overcast), fog: C.fog, haze: C.haze, flash: this.flash, dark: C.dark });
    const k = c01(Math.max(C.fog, C.haze) + 0.3 * Math.min(C.fog, C.haze)), base = W.fogBase || 300, fog = W.scene.fog;
    fog.far = Math.max(55, base * (1 - 0.78 * k)); fog.near = fog.far * (0.25 - 0.17 * k);
    W.cloudMat.color.setRGB(1, 1, 1).lerp(this._c.setRGB(0.5, 0.53, 0.58), c01(C.dark * 1.3));
    // clouds drift with the wind (faster up high), more of them on a cloudy day
    this.cloudOff.x += wx * (3 + wind * 0.9) * dt; this.cloudOff.y += wz * (3 + wind * 0.9) * dt;
    const shown = Math.round(c01(C.clouds) * CLOUDS), big = 1 + c01((C.clouds - 0.6) / 0.4) * 0.9;
    const m = this._m;
    this.cloudList.forEach((c, n) => {
      const on = n < shown;
      const x = ((c.x * CLOUD_FIELD + this.cloudOff.x - cam.x) % CLOUD_FIELD + CLOUD_FIELD * 1.5) % CLOUD_FIELD - CLOUD_FIELD / 2;
      const z = ((c.z * CLOUD_FIELD + this.cloudOff.y - cam.z) % CLOUD_FIELD + CLOUD_FIELD * 1.5) % CLOUD_FIELD - CLOUD_FIELD / 2;
      const s = on ? c.s * big : 0;
      c.im.setMatrixAt(c.i, m.compose(this._v.set(cam.x + x, c.y - (big - 1) * 12, cam.z + z), this._q.setFromAxisAngle(this._v2 || (this._v2 = new THREE.Vector3(0, 1, 0)), c.yaw), this._s.set(s, s * (1 - (big - 1) * 0.25), s)));
    });
    for (const im of this.clouds.children) im.instanceMatrix.needsUpdate = true;
    // rain
    const inside = this.g.inside && this.g.inside();
    const drops = Math.round(this.Q.rain * c01(C.rain * 1.15));
    this.rain.visible = drops > 30 && !inside;
    this.rain.geometry.setDrawRange(0, drops * 2);
    const ru = this.rainMat.uniforms, lit = 0.35 + 0.65 * (1 - dn.dark) + this.flash * 0.8;
    ru.uTime.value = this.t; ru.uCam.value.copy(cam); ru.uWind.value.set(wx * wind * 0.35, wz * wind * 0.35);
    ru.uAmt.value = (0.5 + C.rain * 0.35) * Math.min(1.2, lit); ru.uLen.value = 0.9 + C.rain * 0.8;
    // wet ground, puddles
    const g = W.T.mesh.material.userData.ground;
    if (g && g.uWet) g.uWet.value = C.wet;
    this.puddleMat.opacity = c01(C.wet * 1.4 - 0.25) * 0.72;
    this.puddles.visible = this.puddleMat.opacity > 0.01;
    this.puddleMat.emissive.copy(dn.look.hor).multiplyScalar(0.28);
    this.rippleU.uRT.value = this.t; this.rippleU.uRA.value = c01(C.rain * 1.3);
    // wind: trees, bushes, grass, leaves
    this._uniforms(C, wind);
    this._leaves(dt, cam, wind, wx, wz);
    // for the sounds (js/ambience.js)
    this.audio.rain = inside ? C.rain * 0.4 : C.rain; this.audio.heavy = c01((C.rain - 0.55) / 0.45) * (inside ? 0.5 : 1);
    this.audio.wind = c01((wind - 3) / 12);
  }
  _uniforms(C, wind) {
    const W = this.world, amp = 0.12 + c01(wind / 14) * 1.05;
    if (W.windU) { W.windU.uWA.value = amp; const a = ((C.windDir || 0) + 180) * Math.PI / 180; W.windU.uWD.value.set(Math.sin(a), Math.cos(a)); }
    if (this.g.grass && this.g.grass.wind) { this.g.grass.wind.value = 0.7 + c01(wind / 12) * 2.3; }
  }
  _leaves(dt, cam, wind, wx, wz) {
    const want = Math.round(this.Q.leaves * c01((wind - 6) / 8));
    const L = this.leafList, m = this._m, B = 26;
    let n = 0;
    for (let i = 0; i < want; i++) {
      const l = L[i];
      if (l.y < -900 || Math.abs(l.x - cam.x) > B || Math.abs(l.z - cam.z) > B || l.y < this.world.heightAt(l.x, l.z) - 0.2) {
        // a new leaf upwind of the player
        const side = (Math.random() - 0.5) * 2 * B;
        l.x = cam.x - wx * B * 0.9 + -wz * side; l.z = cam.z - wz * B * 0.9 + wx * side; l.y = this.world.heightAt(l.x, l.z) + 1 + Math.random() * 7;
      }
      const sp = wind * 0.75 * l.sp;
      l.x += (wx * sp + Math.sin(this.t * 2.1 + l.ph) * 0.6) * dt; l.z += (wz * sp + Math.cos(this.t * 1.7 + l.ph) * 0.6) * dt;
      l.y += (Math.sin(this.t * 3 + l.ph) * 0.8 - 0.45) * dt;
      this._e.set(this.t * 3.1 + l.ph, this.t * 2.3 + l.ph * 2, this.t * 4.2);
      this.leaves.setMatrixAt(n++, m.compose(this._v.set(l.x, l.y, l.z), this._q.setFromEuler(this._e), this._s.setScalar(1.6)));
    }
    for (let i = want; i < L.length; i++) L[i].y = -999;
    this.leaves.count = n;
    if (n) this.leaves.instanceMatrix.needsUpdate = true;
  }
  // a bolt somewhere around the farm about every 10–20 s in a thunderstorm (the same for every player: the
  // shared clock picks the moments), a double flash of the sky, thunder after a few seconds
  _lightning(dt, cam) {
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.bolt && this.bolt.visible && (this.boltT -= dt) <= 0) this.bolt.visible = false;
    if (this.flash2 > 0 && (this.flash2 -= dt) <= 0) this.flash = Math.max(this.flash, 0.7);
    const now = this.g.now ? this.g.now() : Date.now(), s = Math.floor(now / 1000);
    if (s === this.slot) return;
    const was = this.slot; this.slot = s;
    if (!was || this.cur.lightning < 0.5 || hash(s) > 0.075) return;
    const a = hash(s + 0.5) * Math.PI * 2, d = 140 + hash(s + 0.25) * 170, far = hash(s + 0.75);
    this.flash = 0.85 + far * 0.15; this.flash2 = 0.12; this.flashes = (this.flashes || 0) + 1;
    this._boltAt(cam.x + Math.cos(a) * d, cam.z + Math.sin(a) * d, s);
    this.audio.thunder.push({ at: performance.now() + (1.2 + far * 4.5) * 1000, vol: 0.55 - far * 0.3 });
    if (this.audio.thunder.length > 4) this.audio.thunder.shift();             // (sound off: don't pile them up)
  }
  _boltAt(x, z, seed) {
    if (!this.bolt) {
      this.boltMat = new THREE.MeshBasicMaterial({ color: 0xe8eeff, fog: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
      this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat); this.bolt.frustumCulled = false;
      this.scene.add(this.bolt);
    }
    const R = rng(Math.floor(seed) + 7), top = 150, ground = this.world.heightAt(x, z), pts = [];
    let px = x, pz = z;
    for (let i = 0; i <= 14; i++) { pts.push([px, top - (top - ground) * i / 14, pz]); px += (R() - 0.5) * 9; pz += (R() - 0.5) * 9; }
    const pos = [], w = 1.1;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
      pos.push(ax - w, ay, az, ax + w, ay, az, bx + w, by, bz, ax - w, ay, az, bx + w, by, bz, bx - w, by, bz);
      pos.push(ax, ay, az - w, ax, ay, az + w, bx, by, bz + w, ax, ay, az - w, bx, by, bz + w, bx, by, bz - w);
    }
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry(); this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.bolt.visible = true; this.boltT = 0.22;
  }
}
