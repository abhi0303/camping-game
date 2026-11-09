// Day and night. Farm World follows the real time in India: the sun rises, crosses the sky and sets where it
// really is for the world's place on Earth, evenings turn orange and pink, and at night the stars and a moon
// come out while the lanterns, windows and torches light up. Zombie Trail keeps its zombie nights (the
// campaign decides when it is dark) and uses the same sky and lamps.
//
// One controller drives all of it from one clock:
//  - the clock: Farm World uses the farm server's clock (FarmEconomy.serverNow, the one the animals use), so
//    every player in a world sees the same sun, sky and lamps — nothing is sent over the network for it;
//  - the sun: its height and direction from the date, the time and DAY_NIGHT.lat / lon (NOAA's solar
//    equations), or from fixed sunrise / sunset times (solar: 'fixed');
//  - the look: sky colours, the sunrise / sunset glow, fog, clouds, the hemisphere light and the sunlight /
//    moonlight (with their shadows) come from a table keyed by the sun's height, so all of it changes smoothly;
//  - the lamps: models mark their light points with GeoBuilder.light(); they are found in the scene and get a
//    soft halo, torches get a flickering flame with a little smoke, and a few real point lights follow the
//    lamps nearest to the player (a handful of lights for the whole world keeps the frame rate up). Lamps
//    switch on one by one around sunset and off again around sunrise.
import * as THREE from 'three';
import { MAT, GeoBuilder, clamp, lerp, smoothstep } from './utils.js';

export const DAY_NIGHT = {
  timeZone: 'Asia/Kolkata',      // the game's clock (an IANA zone): the time on the HUD, and how test times are read
  fallbackOffset: 330,           // minutes ahead of UTC, if the browser can't read time zones (IST = +5:30)
  lat: 22.67, lon: 81.75,        // the world's place on Earth (it sets sunrise, sunset and the sun's path): the Maikal hills, central India
  solar: 'calculated',           // 'calculated': the real sun for lat / lon · 'fixed': the times below
  fixed: { sunrise: '06:00', sunset: '18:00', noon: 65 },   // for 'fixed': sunrise / sunset in timeZone, the sun's height at midday (°)
  shadowAngle: [10, 85],         // the sun's height used for shadows stays in this range (very low sun: shadows stay on screen)
  sunSize: 1.6, moonSize: 2.4,   // drawn sizes in the sky (degrees; bigger than the real ones, easier to see)
  // Farm World's real weather sets these (js/weather/effects.js), all 0..1: clouds dim the sun and grey the sky ·
  // fog: weather fog (grey) · haze: pollution haze from the AQI (yellow-brown, a dimmer warmer sun) · flash:
  // lightning · dark: the gloom under rain clouds. How far you can see is set there too (scene.fog distance).
  weather: { clouds: 0, fog: 0, haze: 0, flash: 0, dark: 0 },
};

const RAD = Math.PI / 180, DEG = 180 / Math.PI, UP = new THREE.Vector3(0, 1, 0);
const DEV = typeof location !== 'undefined' && (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:');

/* ---------------- time ---------------- */
const fmts = new Map();
// the calendar time in a zone: { y, mo, d, h, mi, s }
export function zoneParts(ms, tz = DAY_NIGHT.timeZone) {
  let f = fmts.get(tz);
  if (f === undefined) {
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); }
    catch (e) { f = null; }
    fmts.set(tz, f);
  }
  if (!f) { const d = new Date(ms + DAY_NIGHT.fallbackOffset * 60e3); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }; }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = +x.value;
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}
const zoneOffset = (ms, tz) => { const p = zoneParts(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
// a calendar time in a zone -> ms
export function zoneTime(y, mo, d, h, mi, tz = DAY_NIGHT.timeZone) {
  const local = Date.UTC(y, mo - 1, d, h, mi);
  let ms = local - zoneOffset(local, tz);
  ms = local - zoneOffset(ms, tz);
  return ms;
}
const hm = s => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

// The sun for a moment and a place (NOAA's equations): alt (° above the horizon), az (° from north toward east),
// ha (hour angle, °: negative before solar noon)
export function sunPosition(ms, lat, lon) {
  const T = (ms / 86400e3 + 2440587.5 - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * RAD;
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M) * (0.019993 - 0.000101 * T) + Math.sin(3 * M) * 0.000289;
  const om = (125.04 - 1934.136 * T) * RAD, lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(om)) * RAD;
  const eps = (23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om)) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const y = Math.tan(eps / 2) ** 2, l = L0 * RAD;
  const eqt = 4 * DEG * (y * Math.sin(2 * l) - 2 * e * Math.sin(M) + 4 * e * y * Math.sin(M) * Math.cos(2 * l) - 0.5 * y * y * Math.sin(4 * l) - 1.25 * e * e * Math.sin(2 * M));
  const min = ((ms / 60e3) % 1440 + 1440) % 1440;
  let ha = (min + eqt + 4 * lon) / 4 - 180;
  ha = ((ha + 540) % 360) - 180;
  const H = ha * RAD, la = lat * RAD;
  const alt = Math.asin(clamp(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H), -1, 1)) * DEG;
  const az = (Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) * DEG + 540) % 360;
  return { alt, az, ha };
}
// the same from fixed sunrise / sunset times (the fallback): the sun climbs from the east to `noon` and sets in the west
export function fixedSun(ms, tz, F) {
  const p = zoneParts(ms, tz), t = p.h * 60 + p.mi + p.s / 60, sr = hm(F.sunrise), ss = hm(F.sunset), day = ((ss - sr) % 1440 + 1440) % 1440;
  const since = ((t - sr) % 1440 + 1440) % 1440;
  if (since <= day) { const f = since / day; return { alt: F.noon * Math.sin(Math.PI * f), az: 90 + 180 * f, ha: -90 + 180 * f }; }
  const f = (since - day) / (1440 - day);
  return { alt: -Math.max(F.noon, 50) * Math.sin(Math.PI * f), az: (270 + 180 * f) % 360, ha: 90 + 180 * f };
}
// a direction (east = +x, north = +z, as on the map) from a height and an azimuth
const dirOf = (alt, az, v) => v.set(Math.cos(alt * RAD) * Math.sin(az * RAD), Math.sin(alt * RAD), Math.cos(alt * RAD) * Math.cos(az * RAD));

/* ---------------- the look of the world for a height of the sun ---------------- */
// top / hor: the sky overhead and at the horizon · glow: the colour toward the sun near the horizon (gk: how
// much) · sun / si: sunlight colour and strength · hs / hg / hi: hemisphere light (sky, ground, strength) ·
// cl / ci: the clouds' own glow. [morning, evening] where they differ.
const LOOK = [
  { alt: -18, top: 0x060b1c, hor: 0x111a30, glow: 0x111a30, gk: 0, sun: 0xff7a3a, si: 0, hs: 0x7f95cf, hg: 0x1c281e, hi: 0.5, cl: 0x1c2440, ci: 0.4 },
  { alt: -10, top: 0x0c1636, hor: [0x252c52, 0x2a2a4c], glow: [0x40385e, 0x55304e], gk: 0.4, sun: 0xff7a3a, si: 0, hs: 0x8390c4, hg: 0x222c22, hi: 0.55, cl: [0x30365a, 0x3a2a4a], ci: 0.4 },
  { alt: -5, top: 0x1d3070, hor: [0x8a7a9c, 0x8c5c6e], glow: [0xf0a070, 0xe0703c], gk: 0.75, sun: 0xff6a30, si: 0, hs: [0xa4a6cc, 0x9c8cb2], hg: 0x2f3a2a, hi: 0.66, cl: [0xa08aa8, 0xa8506a], ci: 0.45 },
  { alt: -1, top: 0x38599f, hor: [0xe6b8a6, 0xe08868], glow: [0xffa868, 0xff7a3a], gk: 0.95, sun: [0xff8a4a, 0xff7434], si: 0.04, hs: [0xd8c8d0, 0xd2a8a8], hg: 0x3f4a32, hi: 0.82, cl: [0xe8b0a0, 0xe48060], ci: 0.5 },
  { alt: 3, top: 0x4672b6, hor: [0xf0d2bc, 0xf2b282], glow: [0xffc080, 0xffa050], gk: 0.8, sun: [0xffb070, 0xff9a52], si: 1.0, hs: [0xe8d8d0, 0xe8c8b0], hg: 0x485a36, hi: 1.02, cl: [0xf0c8b0, 0xf0a070], ci: 0.45 },
  { alt: 8, top: 0x5082c6, hor: [0xe6e0d2, 0xf0d2aa], glow: [0xffd8a0, 0xffc080], gk: 0.45, sun: [0xffd0a0, 0xffc282], si: 1.75, hs: 0xe0e2e8, hg: 0x4d6438, hi: 1.26, cl: 0xc8b8b8, ci: 0.46 },
  { alt: 16, top: 0x4a8cd2, hor: 0xd8e4ea, glow: 0xffe0b0, gk: 0.12, sun: 0xffe6c8, si: 2.15, hs: 0xd6e4f8, hg: 0x4d6b38, hi: 1.42, cl: 0xa8b4c8, ci: 0.5 },
  { alt: 28, top: 0x4a8fd6, hor: 0xd3e6f0, glow: 0xd3e6f0, gk: 0, sun: 0xfff0d8, si: 2.3, hs: 0xd6e8ff, hg: 0x4d6b38, hi: 1.5, cl: 0x9db0c8, ci: 0.5 },
  { alt: 60, top: 0x3f87d8, hor: 0xcde3f2, glow: 0xcde3f2, gk: 0, sun: 0xfff4e4, si: 2.5, hs: 0xd8eaff, hg: 0x4d6b38, hi: 1.55, cl: 0x9db0c8, ci: 0.5 },
];
const COLS = ['top', 'hor', 'glow', 'sun', 'hs', 'hg', 'cl'], NUMS = ['gk', 'si', 'hi', 'ci'];
for (const k of LOOK) for (const c of COLS) { const v = Array.isArray(k[c]) ? k[c] : [k[c], k[c]]; k[c] = [new THREE.Color(v[0]), new THREE.Color(v[1])]; }
const MOONLIGHT = new THREE.Color(0x9fb4e8), CLASSIC_DIR = new THREE.Vector3(34, 60, 20).normalize();
const DAY_GLASS = new THREE.Color(0x4f6170), NIGHT_WINDOW = new THREE.Color(0xffc773), GLASS_DAY = new THREE.Color(0.55, 0.52, 0.48), GLASS_NIGHT = new THREE.Color(1, 0.97, 0.9);
const DAY_SKY = { top: new THREE.Color(0x4a8fd6), hor: new THREE.Color(0xd3e6f0), fog: new THREE.Color(0xa9cbe0), night: new THREE.Color(0x0c1220) };
const HAZE_DAY = new THREE.Color(0xa99c7e), HAZE_NIGHT = new THREE.Color(0x2b2822), HAZY_SUN = new THREE.Color(0xffc48a), FLASH = new THREE.Color(0xdce4ff);

/* ---------------- lamps ---------------- */
// kinds of light point: colour, strength of the real light (when one of the pool's lights is on it), its reach,
// the halo's size; flame: a torch (flickers, has a flame and smoke); fire: the camp fire (own light, always lit a little)
const KINDS = {
  lamp: { color: 0xffc47a, power: 5, range: 11, halo: 1.0 },
  street: { color: 0xffc47a, power: 7, range: 14, halo: 1.3 },
  ceiling: { color: 0xffd9a0, power: 5, range: 10, halo: 0.55 },
  flame: { color: 0xff9338, power: 8, range: 14, halo: 1.7, flame: true, smoke: true, flicker: true },
  fire: { color: 0xff8a30, power: 0, range: 0, halo: 3.4, smoke: true, flicker: true, always: 0.3 },
  lantern: { color: 0xffb35a, power: 4.5, range: 9, halo: 0.75, flicker: true },       // a hurricane lantern somebody carries
};
const POOL = { low: 2, medium: 4, high: 6 };
const hash = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
const flick = (t, s) => 1 + 0.12 * Math.sin(t * 11.3 + s * 40) + 0.07 * Math.sin(t * 23.1 + s * 91) + 0.05 * Math.sin(t * 37.7 + s * 17);

// a flambeau: a torch on a wooden pole with an iron fire bowl — its flame, glow and smoke come at dusk
export function flambeau(b, x, y, z, h = 1.75) {
  b.cyl(0.05, 0.075, h + 0.3, 6, x, y + (h - 0.3) / 2, z, 0x5a3b22);
  b.cyl(0.075, 0.075, 0.06, 6, x, y + h * 0.55, z, 0x2e2e32);
  b.cyl(0.18, 0.08, 0.16, 7, x, y + h + 0.06, z, 0x2e2e32);
  for (let i = 0; i < 5; i++) { const a = i * 1.2566 + 0.3; b.box(0.025, 0.18, 0.025, x + Math.cos(a) * 0.16, y + h + 0.2, z + Math.sin(a) * 0.16, 0x2e2e32, 'solid', Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); }
  b.add(new THREE.DodecahedronGeometry(0.1, 0), 0x2a1d14, x, y + h + 0.14, z);
  b.light(x, y + h + 0.16, z, 'flame');
}

/* ---------------- shaders ---------------- */
const SKY_VS = `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `uniform vec3 uTop, uHor, uGlow, uSun, uSunDir; uniform float uGlowK, uSunVis, uSunCos;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHor, uTop, pow(h, 0.6));
  float side = clamp(dot(d.xz, normalize(uSunDir.xz + vec2(1e-4))) / max(length(d.xz), 1e-3) * 0.5 + 0.5, 0.0, 1.0);
  c = mix(c, uGlow, clamp(uGlowK * side * side * side * (1.0 - smoothstep(0.0, 0.5, h)), 0.0, 1.0));
  float s = dot(d, uSunDir);
  c += uSun * (smoothstep(uSunCos - 0.0005, uSunCos, s) * 1.3 + pow(max(s, 0.0), 300.0) * 0.45) * uSunVis;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
const STAR_VS = `uniform float uVis, uTime, uPx; attribute float aSize, aPhase; varying float vA;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec3 w = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vA = uVis * (0.72 + 0.28 * sin(uTime * (1.1 + aPhase) + aPhase * 17.0)) * smoothstep(-0.02, 0.14, w.y);
  gl_PointSize = aSize * uPx;
}`;
const STAR_FS = `varying float vA;
void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float a = max(0.0, 1.0 - dot(p, p)); gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * a * a * vA, 1.0); }`;
// camera-facing quads, one per instance: the instance matrix holds the centre and the size (scale)
const BB_VS = `uniform float uFar; varying vec2 vUv; varying vec3 vCol;
void main() {
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = length(instanceMatrix[0].xyz), d = -c.z;
  c.xyz += normalize(-c.xyz) * min(size * 0.45, d * 0.5);
  c.xy += position.xy * size;
  gl_Position = projectionMatrix * c;
  vUv = position.xy * 2.0;
  vCol = instanceColor * (1.0 - smoothstep(uFar * 0.6, uFar, d)) * smoothstep(0.5, 2.0, d);
}`;
const GLOW_FS = `varying vec2 vUv; varying vec3 vCol;
void main() {
  float a = max(0.0, 1.0 - length(vUv));
  gl_FragColor = vec4(vCol * a * a, 1.0);
  #include <colorspace_fragment>
}`;
const SMOKE_FS = `uniform vec3 uColor; varying vec2 vUv; varying vec3 vCol;
void main() {
  gl_FragColor = vec4(uColor, smoothstep(1.0, 0.15, length(vUv)) * vCol.r);
  #include <colorspace_fragment>
}`;

function radial(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) r.addColorStop(o, col);
  g.fillStyle = r; g.fillRect(0, 0, size, size);
  return c;
}
function moonTexture() {
  const c = radial(128, [[0, '#f4f6fb'], [0.8, '#e2e7f2'], [0.97, '#cfd6e6'], [1, 'rgba(207,214,230,0)']]), g = c.getContext('2d');
  g.fillStyle = 'rgba(150,160,185,.35)';
  for (const [x, y, r] of [[48, 44, 13], [80, 60, 9], [58, 82, 16], [86, 88, 7], [40, 70, 6], [74, 34, 5]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class DayNight {
  constructor(world) {
    this.world = world; this.scene = world.scene; this.sun = world.sun; this.hemi = world.hemi;
    this.mode = 'game'; this.clock = () => Date.now(); this.synced = () => true; this._synced = false; this.weather = { ...DAY_NIGHT.weather };
    this.onPhase = null; this.phase = 'day'; this.info = { alt: 56.7, az: 59.5, phase: 'day' };
    this._t = null; this._wall = 0; this._snap = true; this.time = 0; this.override = null;
    this.lamps = []; this.lampDark = 0; this.dark = 0; this.scanT = 0; this.poolT = 0; this.smokeOn = true; this.lightScale = 1;
    this._v = new THREE.Vector3(); this._sunDir = new THREE.Vector3(); this._moonDir = new THREE.Vector3(); this._ld = new THREE.Vector3();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._p = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
    this.look = {}; for (const c of COLS) this.look[c] = new THREE.Color(); this.look.fog = new THREE.Color();
    this._sky(); this._lampMeshes(); this._materials();
    if (DEV && typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search);
      if (q.get('time')) this.setTime(q.get('time'), { date: q.get('date'), speed: +q.get('speed') || 1 });
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { this._snap = true; });
  }

  /* ---------- setup ---------- */
  _sky() {
    const g = new THREE.SphereGeometry(500, 24, 14);
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSun: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlowK: { value: 0 }, uSunVis: { value: 0 }, uSunCos: { value: Math.cos(DAY_NIGHT.sunSize * RAD) } } });
    const dome = this.dome = new THREE.Mesh(g, this.skyMat);
    dome.renderOrder = -1; dome.frustumCulled = false;
    this.scene.add(dome);
    // stars on a sphere that turns with the sky (around the celestial pole)
    const N = this.world.lite ? 520 : 900, pos = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
    let r = 91;
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * 470, u * 470, Math.sin(a) * s * 470], i * 3);
      size[i] = rnd() < 0.08 ? 2.6 + rnd() : 1.1 + rnd() * 1.1; ph[i] = rnd() * 3;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.starMat = new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uVis: { value: 0 }, uTime: { value: 0 }, uPx: { value: Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1) } } });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false; this.stars.visible = false;
    this.poleAxis = new THREE.Vector3(0, Math.sin(DAY_NIGHT.lat * RAD), Math.cos(DAY_NIGHT.lat * RAD));
    dome.add(this.stars);
    // the moon: a disc and a soft halo
    this.moon = new THREE.Group();
    this.moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false }));
    this.moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(radial(64, [[0, 'rgba(190,205,240,.55)'], [0.35, 'rgba(160,180,230,.18)'], [1, 'rgba(150,170,220,0)']])), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    const ms = 2 * 440 * Math.tan(DAY_NIGHT.moonSize / 2 * RAD);
    this.moonDisc.scale.set(ms, ms, 1); this.moonHalo.scale.set(ms * 6, ms * 6, 1);
    this.moon.add(this.moonHalo, this.moonDisc); this.moon.visible = false;
    dome.add(this.moon);
    this.world.dome = dome;
  }
  _lampMeshes() {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.glowMat = new THREE.ShaderMaterial({ vertexShader: BB_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: { uFar: { value: 170 } } });
    this.smokeMat = new THREE.ShaderMaterial({ vertexShader: BB_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false, fog: false, uniforms: { uFar: { value: 70 }, uColor: { value: new THREE.Color(0x4a4643) } } });
    const fb = new GeoBuilder();
    fb.add(new THREE.ConeGeometry(0.15, 0.5, 5), 0xff7a18, 0, 0.25, 0);
    fb.add(new THREE.ConeGeometry(0.09, 0.34, 5), 0xffc23a, 0.01, 0.18, 0.02);
    fb.add(new THREE.ConeGeometry(0.045, 0.16, 4), 0xfff2b0, 0, 0.09, 0.03);
    this.flameGeo = fb.build().children[0].geometry; this.quad = quad;
    this.flameMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.glows = this.flames = this.smoke = null; this.cap = 0;
    this.slots = [];
  }
  _materials() {
    // windows: three sets that light up at slightly different moments; lantern glass; the RV / hut lamps (MAT.lamp)
    this.windowMats = [MAT.window, MAT.window.clone(), MAT.window.clone()];
    this.windowTh = [0.25, 0.42, 0.6];
  }
  // graphics setting: how many real lights follow the lamps, smoke on or off
  setQuality(name) {
    const n = POOL[name] ?? 4;
    this.smokeOn = name !== 'low';
    while (this.slots.length < n) { const l = new THREE.PointLight(0xffc47a, 0, 12, 2); this.scene.add(l); this.slots.push({ light: l, lamp: null, k: 0, out: false }); }
    while (this.slots.length > n) { const s = this.slots.pop(); this.scene.remove(s.light); s.light.dispose(); }
    this.poolT = 0;
  }
  // 'real': the real time (Farm World) · 'game': Zombie Trail's nights (world.night)
  setMode(m) { if (m !== this.mode) { this.mode = m; this._snap = true; } }
  // a test time (on this computer only): '17:30' today in DAY_NIGHT.timeZone, or null for the real time
  setTime(hhmm, { date = null, speed = 1 } = {}) {
    if (!DEV) return false;
    if (!hhmm) { this.override = null; this._snap = true; return true; }
    const now = zoneParts(Date.now()), [y, mo, d] = date ? date.split('-').map(Number) : [now.y, now.mo, now.d], m = hm(hhmm);
    this.override = { base: zoneTime(y, mo, d, Math.floor(m / 60), m % 60), wall: Date.now(), speed: speed || 1 };
    this._snap = true;
    return true;
  }
  now() { const o = this.override; return o ? o.base + (Date.now() - o.wall) * o.speed : this.clock(); }

  /* ---------- per frame ---------- */
  update(dt, focus, camera) {
    this.time += dt;
    // the time shown follows the clock. It jumps straight to it when the server's clock first arrives, after the
    // tab was in the background or the game was paused; later small corrections ease in over a few seconds
    const wall = performance.now(), gap = wall - this._wall, target = this.now(), synced = this.synced();
    this._wall = wall;
    if (synced && !this._synced) this._snap = true;
    this._synced = synced;
    let snapped = false;
    if (this._t === null || this._snap || gap > 1500 || Math.abs(target - this._t) > 3 * 3600e3) { this._t = target; this._snap = false; snapped = true; }
    else this._t += (target - this._t) * (1 - Math.exp(-gap / 1000 * 1.2));

    const L = this.look, sunDir = this._sunDir, moonDir = this._moonDir, W = this.weather;
    let alt, eve, dark, lampDark, starVis, moonVis, sunI, moonI, glowK;
    if (this.mode === 'real') {
      const p = DAY_NIGHT.solar === 'fixed' ? fixedSun(this._t, DAY_NIGHT.timeZone, DAY_NIGHT.fixed) : sunPosition(this._t, DAY_NIGHT.lat, DAY_NIGHT.lon);
      alt = p.alt; eve = 0.5 + 0.5 * Math.sin(p.ha * RAD);
      this.info.az = p.az; this.info.ha = p.ha;
      dirOf(alt, p.az, sunDir); moonDir.copy(sunDir).negate();
      this._lookAt(alt, eve);
      dark = 1 - smoothstep(-8, 3, alt);
      lampDark = 1 - smoothstep(-5, 7, alt);
      starVis = 1 - smoothstep(-13, -3, alt);
      moonVis = (1 - smoothstep(-7, 1, alt)) * smoothstep(-2, 3, -alt);
      sunI = L.si; glowK = L.gk;
      moonI = 0.42 * smoothstep(-1, 14, -alt) * (1 - smoothstep(-6, 0, alt));
      this.world.night = this.world.nightTarget = dark;
      const ph = alt < -4 ? 'night' : p.ha < 0 ? (alt < 18 ? 'morning' : 'day') : (alt < 18 ? 'evening' : 'afternoon');
      if (ph !== this.phase) { const was = this.phase; this.phase = ph; if (!snapped && this.onPhase) this.onPhase(ph, was); }
    } else {
      // Zombie Trail: the classic sun, dimmed by the zombie night
      const n = this.world.night;
      alt = 56.7; sunDir.copy(CLASSIC_DIR); moonDir.copy(CLASSIC_DIR);
      L.top.copy(DAY_SKY.top).multiply(this._c.setRGB(lerp(1, 0.1, n), lerp(1, 0.13, n), lerp(1, 0.25, n)));
      L.hor.copy(DAY_SKY.hor).multiply(this._c);
      L.fog.copy(DAY_SKY.fog).lerp(DAY_SKY.night, n);
      L.glow.copy(L.hor); L.sun.setHex(0xfff0d8); L.hs.setHex(0xd6e8ff).lerp(this._c.setHex(0x8fa6d8), n); L.hg.setHex(0x4d6b38);
      L.cl.setHex(0x9db0c8); L.ci = lerp(0.5, 0.03, n); L.hi = lerp(1.5, 0.32, n);
      dark = lampDark = starVis = moonVis = n; sunI = lerp(2.3, 0.1, n); moonI = 0; glowK = 0;
      this.phase = n > 0.5 ? 'night' : 'day';
    }
    this.info.alt = alt; this.info.phase = this.phase; this.dark = dark; this.lampDark = lampDark;

    // weather (for later): clouds dim the sun and grey the sky
    if (W.clouds > 0) {
      const k = W.clouds;
      sunI *= 1 - 0.75 * k; moonI *= 1 - 0.8 * k; glowK *= 1 - 0.7 * k; starVis *= 1 - k; moonVis *= 1 - 0.85 * k;
      for (const c of [L.top, L.hor, L.fog]) { const g = (c.r + c.g + c.b) / 3 * 0.9; c.lerp(this._c.setRGB(g, g, g), 0.6 * k); }
    }
    if (W.fog > 0) { L.fog.lerp(L.hor, 0.5).lerp(this._c.setRGB(0.55, 0.57, 0.6).multiplyScalar(1 - dark * 0.85), 0.6 * W.fog); L.top.lerp(L.fog, 0.55 * W.fog); L.hor.lerp(L.fog, 0.6 * W.fog); }
    // pollution haze: a dusty veil, the sun dimmer and warmer, fewer stars
    if (W.haze > 0) {
      const k = W.haze, hz = this._c.copy(HAZE_DAY).lerp(HAZE_NIGHT, dark);
      L.fog.lerp(hz, 0.85 * k); L.hor.lerp(hz, 0.75 * k); L.top.lerp(hz, 0.5 * k); L.sun.lerp(HAZY_SUN, 0.5 * k);
      sunI *= 1 - 0.4 * k; starVis *= 1 - 0.8 * k; moonVis *= 1 - 0.45 * k;
    }
    // rain clouds: gloomier light · lightning: the whole sky lights up for a moment
    let hemiK = 1 - 0.45 * (W.dark || 0);
    if (W.dark > 0) for (const c of [L.top, L.hor, L.fog]) c.multiplyScalar(1 - 0.42 * W.dark);
    if (W.flash > 0) { for (const c of [L.top, L.hor, L.fog]) c.lerp(FLASH, 0.65 * W.flash); hemiK += 2.2 * W.flash; }

    // sky, fog, clouds
    const sc = Math.min(1, (camera.far * 0.92) / 500);
    this.dome.scale.setScalar(sc); this.dome.position.copy(camera.position);
    const u = this.skyMat.uniforms;
    u.uTop.value.copy(L.top); u.uHor.value.copy(L.hor); u.uGlow.value.copy(L.glow); u.uGlowK.value = glowK;
    u.uSunDir.value.copy(sunDir); u.uSun.value.copy(L.sun); u.uSunVis.value = (this.mode === 'real' ? smoothstep(-2, 0.5, alt) : 1 - this.world.night) * (1 - 0.97 * W.clouds) * (1 - 0.5 * (W.haze || 0));
    this.scene.background.copy(L.fog); this.scene.fog.color.copy(L.fog);
    if (this.world.cloudMat) { this.world.cloudMat.emissive.copy(L.cl); this.world.cloudMat.emissiveIntensity = L.ci; }
    // stars turn around the celestial pole with the time of day
    this.stars.visible = starVis > 0.003;
    if (this.stars.visible) {
      this.starMat.uniforms.uVis.value = starVis; this.starMat.uniforms.uTime.value = this.time;
      this.stars.quaternion.setFromAxisAngle(this.poleAxis, ((this._t / 86164091) % 1) * Math.PI * 2);
    }
    this.moon.visible = moonVis > 0.003 && moonDir.y > -0.05;
    if (this.moon.visible) {
      this.moon.position.copy(moonDir).multiplyScalar(440);
      this.moonDisc.material.opacity = moonVis; this.moonHalo.material.opacity = moonVis;
    }

    // the light: the sun by day, the moon at night (whichever is stronger); hemisphere light
    const useMoon = moonI > sunI, I = Math.max(sunI, moonI);
    this.sun.intensity = I;
    this.sun.color.copy(useMoon ? MOONLIGHT : L.sun);
    this.hemi.intensity = L.hi * hemiK; this.hemi.color.copy(L.hs); this.hemi.groundColor.copy(L.hg);
    this.sun.shadow.autoUpdate = I > 0.02;           // no light: no need to draw its shadows
    const d = useMoon ? moonDir : sunDir, [a0, a1] = DAY_NIGHT.shadowAngle;
    const el = clamp(Math.asin(clamp(d.y, -1, 1)) * DEG, a0, a1), az = Math.atan2(d.x, d.z);
    this._ld.set(Math.cos(el * RAD) * Math.sin(az), Math.sin(el * RAD), Math.cos(el * RAD) * Math.cos(az));
    this._placeLight(focus, this._ld);

    // lamps
    MAT.lamp.emissiveIntensity = smoothstep(0.15, 0.65, lampDark) * 1.6;
    MAT.lampGlass.color.copy(GLASS_DAY).lerp(GLASS_NIGHT, smoothstep(0.15, 0.6, lampDark));
    this.windowMats.forEach((m, i) => m.color.copy(DAY_GLASS).lerp(NIGHT_WINDOW, smoothstep(this.windowTh[i], this.windowTh[i] + 0.25, lampDark)));
    if (wall >= this.scanT) { this.scanT = wall + 1500; this._scan(); }   // new or removed models (real time, not game time)
    this._lampsFrame(dt, focus);
  }
  // the light's shadow box follows the player in whole shadow-map pixels, so shadow edges don't shimmer
  _placeLight(focus, dir) {
    const sun = this.sun, cam = sun.shadow.camera, texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
    this._x.crossVectors(UP, dir).normalize(); this._y.crossVectors(dir, this._x);
    const u = Math.round(focus.dot(this._x) / texel) * texel, v = Math.round(focus.dot(this._y) / texel) * texel;
    this._p.copy(this._x).multiplyScalar(u).addScaledVector(this._y, v).addScaledVector(dir, focus.dot(dir));
    sun.target.position.copy(this._p);
    sun.position.copy(this._p).addScaledVector(dir, 80);
  }
  // the table's look for a height of the sun (eve: 0 morning … 1 evening)
  _lookAt(alt, eve) {
    let i = 0;
    while (i < LOOK.length - 2 && alt > LOOK[i + 1].alt) i++;
    const A = LOOK[i], B = LOOK[i + 1], t = clamp((alt - A.alt) / (B.alt - A.alt), 0, 1), L = this.look;
    for (const c of COLS) {
      L[c].copy(A[c][0]).lerp(A[c][1], eve);
      this._c.copy(B[c][0]).lerp(B[c][1], eve);
      L[c].lerp(this._c, t);
    }
    for (const k of NUMS) L[k] = lerp(A[k], B[k], t);
    L.fog.copy(L.hor).lerp(L.glow, L.gk * 0.25);
  }

  /* ---------- lamps ---------- */
  // find light points in the scene (models marked with GeoBuilder.light) and windows; drop lamps of removed models
  _scan() {
    let changed = false;
    const scene = this.scene, attached = o => { while (o && o !== scene) o = o.parent; return o === scene; };
    const before = this.lamps.length;
    this.lamps = this.lamps.filter(l => attached(l.owner));
    if (this.lamps.length !== before) changed = true;
    scene.traverse(o => {
      if (o.isMesh && o.material === MAT.window && !o.userData.win) {
        o.userData.win = true;
        o.getWorldPosition(this._v);
        o.material = this.windowMats[Math.floor(hash(this._v.x, 1, this._v.z) * 3)];
      }
      const pts = o.userData.lights;
      if (!pts || o.userData.lit) return;
      o.userData.lit = true; changed = true;
      o.updateWorldMatrix(true, false);
      for (const [x, y, z, kind] of pts) {
        const K = KINDS[kind] || KINDS.lamp, p = new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld), s = hash(p.x, p.y, p.z);
        this.lamps.push({ owner: o, p, kind, K, color: new THREE.Color(K.color), power: K.power, range: K.range, seed: s,
          th: kind === 'fire' ? 0 : 0.1 + s * 0.42, level: 0, vis: true, fl: 1 });
      }
    });
    if (changed) this._layout();
  }
  // a lamp that moves (a lantern somebody carries, js/village/ai.js): `owner` is its model in the scene (hidden:
  // the lamp is off), and whoever carries it moves lamp.p every frame — the halo and the real light follow it
  addMovingLamp(owner, kind = 'lantern') {
    const K = KINDS[kind] || KINDS.lamp, l = { owner, p: new THREE.Vector3(), kind, K, color: new THREE.Color(K.color), power: K.power, range: K.range, seed: 0.37, th: 0.04, level: 0, vis: true, fl: 1, moving: true };
    this.lamps.push(l); this._layout();
    return l;
  }
  // (re)build the halo, flame and smoke instances for the lamps
  _layout() {
    const n = this.lamps.length, flames = this.lamps.filter(l => l.K.flame), smokes = this.lamps.filter(l => l.K.smoke);
    if (n > this.cap || !this.glows) {
      this.cap = Math.max(64, n + 32);
      for (const m of [this.glows, this.flames, this.smoke]) if (m) { this.scene.remove(m); m.dispose(); }
      const mk = (geo, mat, cap, colors) => {
        const m = new THREE.InstancedMesh(geo, mat, cap);
        m.frustumCulled = false; m.castShadow = m.receiveShadow = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (colors) m.setColorAt(0, this._c.setRGB(0, 0, 0));
        m.count = 0; this.scene.add(m); return m;
      };
      this.glows = mk(this.quad, this.glowMat, this.cap, true); this.flames = mk(this.flameGeo, this.flameMat, this.cap, false); this.smoke = mk(this.quad, this.smokeMat, this.cap * 3, true);
      this.smoke.renderOrder = 1;
    }
    this.lamps.forEach((l, i) => {
      this._m.compose(l.p, this._q.identity(), this._s.setScalar(l.K.halo));
      if (l.K.flame) this._m.elements[13] += 0.22;
      this.glows.setMatrixAt(i, this._m);
    });
    this.glows.count = n; this.glows.instanceMatrix.needsUpdate = true;
    this.flameList = flames; this.smokeList = smokes;
    this.poolT = 0;
  }
  _lampsFrame(dt, focus) {
    const t = this.time, ld = this.lampDark, lamps = this.lamps;
    if (!this.glows) return;
    // each lamp's level: on one by one through the dusk (a carried lantern's halo goes where it is)
    let moved = false;
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      if (l.moving) { this._m.compose(l.p, this._q.identity(), this._s.setScalar(l.K.halo)); this.glows.setMatrixAt(i, this._m); moved = true; }
      let o = l.owner; l.vis = true;
      while (o) { if (!o.visible) { l.vis = false; break; } o = o.parent; }
      l.level = Math.max(l.K.always || 0, smoothstep(l.th, l.th + 0.22, ld));
      l.fl = l.K.flicker ? flick(t, l.seed) : 1;
      const k = l.vis ? l.level * l.fl * 0.55 : 0;
      this.glows.setColorAt(i, this._c.copy(l.color).multiplyScalar(k));
    }
    this.glows.instanceColor.needsUpdate = true;
    if (moved) this.glows.instanceMatrix.needsUpdate = true;
    // torch flames (hidden while unlit)
    const F = this.flameList || [];
    F.forEach((l, i) => {
      const s = l.vis ? l.level : 0, f = l.fl;
      this._q.setFromAxisAngle(this._v.set(Math.sin(t * 2.3 + l.seed * 9), 0, Math.cos(t * 1.7 + l.seed * 5)).normalize(), 0.08 * Math.sin(t * 5 + l.seed * 20));
      this._m.compose(l.p, this._q, this._s.set(s * (0.85 + 0.15 * f), s * (0.7 + 0.35 * f), s * (0.85 + 0.15 * f)));
      this.flames.setMatrixAt(i, this._m);
    });
    this.flames.count = F.length; this.flames.instanceMatrix.needsUpdate = true;
    // smoke: three puffs rising from each torch / the camp fire
    const S = this.smokeOn ? this.smokeList || [] : [];
    let j = 0;
    for (const l of S) {
      if (!l.vis || l.level < 0.05) continue;
      const big = l.kind === 'fire' ? 2.2 : 1;
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.3 + k / 3 + l.seed) % 1;
        this._p.set(l.p.x + Math.sin(ph * 4 + l.seed * 7) * 0.15 * big + ph * 0.25, l.p.y + (0.45 + ph * 1.7) * big, l.p.z + Math.cos(ph * 3 + l.seed * 3) * 0.12 * big);
        this._m.compose(this._p, this._q.identity(), this._s.setScalar((0.22 + ph * 0.7) * big));
        this.smoke.setMatrixAt(j, this._m);
        this.smoke.setColorAt(j, this._c.setRGB(Math.sin(Math.PI * ph) * 0.2 * Math.min(1, l.level * 1.5), 0, 0));
        j++;
      }
    }
    this.smoke.count = j; this.smoke.instanceMatrix.needsUpdate = true; if (j) this.smoke.instanceColor.needsUpdate = true;
    // the pool of real lights: the lamps nearest to the player, moving between lamps by fading out and in
    if ((this.poolT -= dt) <= 0) {
      this.poolT = 0.3;
      const cand = [];
      for (const l of lamps) if (l.power && l.vis && l.level > 0.02) { const d = l.p.distanceTo(focus); if (d < 48) cand.push([d / Math.sqrt(l.power / 5), l]); }
      cand.sort((a, b) => a[0] - b[0]);
      this._want = new Set(cand.slice(0, this.slots.length).map(c => c[1]));
    }
    const want = this._want || new Set();
    for (const s of this.slots) {
      if (s.lamp && !want.has(s.lamp)) s.out = true;
      if (s.out) { s.k = Math.max(0, s.k - dt * 4); if (s.k === 0) { s.lamp = null; s.out = false; } }
    }
    for (const l of want) {
      if (this.slots.some(s => s.lamp === l)) continue;
      const s = this.slots.find(x => !x.lamp);
      if (!s) break;
      s.lamp = l; s.k = 0; s.out = false;
      s.light.position.copy(l.p); if (l.K.flame) s.light.position.y += 0.35;
      s.light.color.copy(l.color); s.light.distance = l.range;
    }
    for (const s of this.slots) {
      const l = s.lamp;
      if (l && !s.out) s.k = Math.min(1, s.k + dt * 2.5);
      if (l && l.moving) s.light.position.copy(l.p);
      s.light.intensity = l ? l.power * l.level * l.fl * s.k * this.lightScale : 0;
    }
  }

  /* ---------- for the HUD ---------- */
  clockText() {
    const p = zoneParts(this._t ?? this.now()), h = p.h % 12 || 12;
    return `${h}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
  }
  // the icon for the time of day (js/icons.js)
  phaseIcon() { return { morning: 'sunrise', day: 'sun', afternoon: 'sun', evening: 'sunset', night: 'moon' }[this.phase] || 'sun'; }
  // test helper: where things stand
  state() {
    const p = zoneParts(this._t ?? this.now());
    return { time: `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`, mode: this.mode, phase: this.phase, alt: +this.info.alt.toFixed(2), az: +(this.info.az || 0).toFixed(1),
      dark: +this.dark.toFixed(3), lampDark: +this.lampDark.toFixed(3), sun: +this.sun.intensity.toFixed(3), hemi: +this.hemi.intensity.toFixed(3),
      lamps: this.lamps.length, lit: this.lamps.filter(l => l.level > 0.5).length, lights: this.slots.map(s => +s.light.intensity.toFixed(2)),
      light: this.sun.position.clone().sub(this.sun.target.position).normalize().toArray().map(v => +v.toFixed(3)) };
  }
}
