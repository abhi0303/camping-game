// Guard dogs (Farm World): they guard the coops. The server decides what they do against thieves
// (server/src/thieves.js); this draws them. At most two, each with a kennel just outside the west end of the walkway.
//   level 1  a Cane Corso: trots about, tail wagging
//   level 2  a German Shepherd: stands straight, its tail still, watching
//   level 3  a Boxer: a trained guard dog
// Each is its model with its own textures (js/farm/dogModels.js).
// On duty they bark every 10 s for 3 s (standing where they are, head up), then go on with their patrol.
// On duty (fed: a bone keeps a dog on duty 4 hours, a treat 24) they patrol the walkway and stand guard; hungry
// (off duty) they lie asleep in front of the kennel. When a thief comes they run to the coop he's at and bark.
// Where they are comes from the shared clock and the server's numbers, so every player sees the same dogs.
// Feeding: E at a kennel opens its panel (js/farm/farmui.js). A fed dog runs to its bowl, lies down and chews (a bone or a
// meaty treat in the bowl), then walks back to its patrol — the feeder's game tells the others ('dogEat').
// Legs, head and tail move on the graphics card like the other animals (js/farm/animals.js).
import * as THREE from 'three';
import { GeoBuilder } from '../utils.js';
import { rigTexMaterial, rigDepthMaterial, addAnimAttributes } from './animals.js';
import { rigGeometry } from './polyRig.js';
import { loadDog } from './dogModels.js';
import { PLOTS, toWorld } from './layout.js';

// the kennels (their doors face the walkway) and each dog's patrol line along the walkway
export const KENNELS = [{ x: -110.4, z: -184.9, yaw: Math.PI / 2 }, { x: -110.4, z: -172.1, yaw: Math.PI / 2 }];
// (they turn back well before the farm storage at the east end: its steps come down to x ≈ -57.5)
const PATROL = [{ x0: -102.5, x1: -62, z: -179.7 }, { x0: -101.5, x1: -63, z: -177.3 }];
// the model dogs: where their parts are (js/farm/polyRig.js rigGeometry) and how they step: leg (from where it
// swings: a step is as long as the paws really go), the legs' swing walking / running
export const DOG_RIGS = {
  1: { legs: [[0.11, 0.29], [-0.185, 0.29], [0.15, -0.32], [-0.145, -0.33]], hw: 0.066, hd: 0.1, cut: 0.27, knee: [0.13, 0.15],
    neck: { y: 0.55, z: 0.25, z0: 0.22, z1: 0.45, minY: 0.42 }, tail: { hw: 0.09, z: -0.36, top: 0.52, minY: 0.3 } },
  2: { legs: [[0.065, 0.245], [-0.065, 0.245], [0.08, -0.28], [-0.08, -0.28]], hw: 0.052, hd: 0.08, cut: 0.27, knee: [0.12, 0.16],
    neck: { y: 0.55, z: 0.22, z0: 0.2, z1: 0.4, minY: 0.42 }, tail: { hw: 0.07, z: -0.36, top: 0.62, minY: 0.45 } },
  3: { legs: [[0.05, 0.27], [-0.05, 0.27], [0.05, -0.27], [-0.05, -0.27]], hw: 0.042, hd: 0.1, cut: 0.28, knee: [0.13, 0.15],
    neck: { y: 0.55, z: 0.2, z0: 0.18, z1: 0.36, minY: 0.45 }, tail: { hw: 0.04, z: -0.33, top: 0.5, minY: 0.38 } },
};
const DOG_GAIT = { 1: { leg: 0.27, walk: 0.45, run: 0.75 }, 2: { leg: 0.27, walk: 0.45, run: 0.75 }, 3: { leg: 0.28, walk: 0.45, run: 0.75 } };
// barking on duty: every 10 s, 3 s of barks (three bursts of three), the dog standing still; a second to walk on
const BARK_EVERY = 10, BARK_FOR = 3;
const ease = k => k * k * (3 - 2 * k);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const dampA = (a, b, k) => a + wrap(b - a) * k;

// a wooden kennel with a gable roof, its door toward +z, a bowl in front
function kennel(b) {
  b.box(0.9, 0.62, 1.0, 0, 0.33, 0, 0x9a6a3e);
  for (let i = 0; i < 4; i++) b.box(0.92, 0.02, 1.02, 0, 0.12 + i * 0.15, 0, 0x7a5030);
  for (const s of [-1, 1]) b.group(s * 0.25, 0.86, 0, 0, 0, -s * 0.62, () => b.box(0.62, 0.05, 1.12, 0, 0, 0, 0xb5452f));
  b.box(0.08, 0.06, 1.14, 0, 1.05, 0, 0x8e3424);
  b.box(0.42, 0.4, 0.02, 0, 0.32, 0.505, 0x1e1510); b.cyl(0.21, 0.21, 0.02, 10, 0, 0.52, 0.505, 0x1e1510, Math.PI / 2, 0, 0);
  b.box(0.3, 0.08, 0.02, 0, 0.82, 0.51, 0xe8dcc0);                                                     // the name board
  b.cyl(0.12, 0.1, 0.06, 10, 0.32, 0.03, 0.75, 0x8a8f96); b.cyl(0.1, 0.1, 0.01, 10, 0.32, 0.06, 0.75, 0x4f86b8);   // water bowl
  b.cyl(0.12, 0.1, 0.06, 10, -0.32, 0.03, 0.75, 0x8a3a2a);
}

// what a dog gets in its bowl: a bone, or a meaty treat
function bowlFood(b, treat) {
  if (treat) { b.add(new THREE.IcosahedronGeometry(0.065, 0), 0x9a3a28, 0, 0.06, 0, 0, 0, 0, 'solid', 1.2, 0.7, 1); b.cyl(0.014, 0.014, 0.14, 5, 0.06, 0.07, 0, 0xf2ead8, 0, 0, Math.PI / 2); }
  else { b.cyl(0.016, 0.016, 0.16, 5, 0, 0.065, 0, 0xf2ead8, 0, 0, Math.PI / 2); for (const s of [-1, 1]) for (const t of [-1, 1]) b.add(new THREE.SphereGeometry(0.022, 6, 4), 0xf2ead8, s * 0.08, 0.065, t * 0.016); }
}
const EAT_S = 6, RUN_V = 4.5, WALK_V = 1.4;     // how long a dog eats; how fast it comes to the bowl / goes back to its patrol

export class GuardDogs {
  // g: { eco, world, bark(x, z, n, deep), openKennel(slot) }
  constructor(scene, g) {
    this.scene = scene; this.g = g; this.on = false; this.st = [{}, {}];
  }
  enable() {
    if (this.on) return;
    this.on = true;
    const depth = rigDepthMaterial();
    const mesh = (g, mat) => {
      const m = new THREE.InstancedMesh(g, mat, 2);
      addAnimAttributes(m, 2); m.customDepthMaterial = depth;
      m.castShadow = true; m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m); return m;
    };
    // the three models, drawn once they've loaded (a dog of that level waits till then); a material per texture
    this.meshes = [null, null, null];
    for (const lv of [1, 2, 3]) loadDog(lv).then(d => { this.meshes[lv - 1] = mesh(rigGeometry(d.geometry, DOG_RIGS[lv]), d.textures.map(t => rigTexMaterial(t.texture, t.alpha))); })
      .catch(e => console.warn('dog model', lv, e));
    this.kennels = KENNELS.map(K => {
      const b = new GeoBuilder(); kennel(b);
      const k = b.build(); k.position.set(K.x, this.g.world.heightAt(K.x, K.z), K.z); k.rotation.y = K.yaw; k.visible = false;
      k.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(k); return k;
    });
    for (const K of KENNELS) this.g.world.addCollider({ x: K.x, z: K.z, r: 0.6 });
    // the food in the bowl while a dog eats (the red bowl, at the kennel's front left)
    this.food = KENNELS.map(K => {
      const out = {};
      for (const kind of ['bone', 'dog_treat']) {
        const b = new GeoBuilder(); bowlFood(b, kind === 'dog_treat');
        const m = b.build(), p = toWorld(K, -0.32, 0.75);
        m.position.set(p.x, this.g.world.heightAt(p.x, p.z), p.z); m.rotation.y = K.yaw + 0.5; m.visible = false;
        this.scene.add(m); out[kind] = m;
      }
      return out;
    });
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._up = new THREE.Vector3(0, 1, 0);
  }
  // E at a kennel: its dog's panel (feed it, train it)
  acts() {
    if (!this.on || !this.g.eco.ready) return [];
    const e = this.g.eco, dogs = e.dogs ? e.dogs() : [];
    return dogs.filter(d => KENNELS[d.slot]).map(d => {
      const K = KENNELS[d.slot], p = toWorld(K, 0, 1.25);
      return { pos: { x: p.x, y: this.g.world.heightAt(p.x, p.z), z: p.z }, r: 2.4,
        label: () => { const x = (e.dogs() || []).find(o => o.slot === d.slot); return x && e.dogOnDuty(x) ? `Guard dog ${d.slot + 1} · on duty — feed or train it` : `Feed guard dog ${d.slot + 1} — it's hungry and asleep`; },
        act: () => this.g.openKennel && this.g.openKennel(d.slot) };
    });
  }
  // a dog was fed (here, or in another player's game: the same start time on the shared clock)
  eat(slot, t0, food) {
    const st = this.st[slot] || (this.st[slot] = {});
    st.feed = { t0: t0 ?? this.t ?? 0, food: food === 'dog_treat' ? 'dog_treat' : 'bone' };
  }
  // where the guard spot is for a raid: on the walkway in front of the coop he's at
  guardSpot(raid, slot) {
    const bd = this.g.eco.st && this.g.eco.st.buildings.find(b => b.id === raid.shelter);
    if (!bd) return null;
    const p = toWorld(PLOTS[bd.plot], slot ? 1.1 : -1.1, 7.6);
    return { x: p.x, z: p.z, face: Math.atan2(PLOTS[bd.plot].x - p.x, PLOTS[bd.plot].z - p.z) };
  }
  // a dog on its patrol at time t (s): walking up and down its line, stopping to stand guard at the ends
  _patrol(slot, level, t, out) {
    const L = PATROL[slot], len = L.x1 - L.x0, v = level === 1 ? 1.25 : 0.95, walk = len / v, stop = level === 1 ? 9 : 16, per = 2 * (walk + stop);
    const u = (t + slot * 37) % per;
    let k, moving = true, dir = 1;
    if (u < walk) k = u / walk;
    else if (u < walk + stop) { k = 1; moving = false; }
    else if (u < 2 * walk + stop) { k = 1 - (u - walk - stop) / walk; dir = -1; }
    else { k = 0; moving = false; dir = -1; }
    out.x = L.x0 + len * k; out.z = L.z + Math.sin((t + slot * 11) * 0.21) * 0.35;
    out.moving = moving;
    // standing guard at an end of the walkway: facing out and looking round (the trained ones barely move)
    out.face = moving ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (k > 0.5 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(t * (level === 1 ? 0.9 : 0.35) + slot) * (level === 1 ? 0.9 : 0.5);
    return out;
  }
  // every frame. now: the shared clock (ms) · me: where this player is (for barking sounds)
  update(dt, now) {
    if (!this.on) return;
    const eco = this.g.eco, dogs = eco.dogs ? eco.dogs() : [], t = now / 1000;
    this.t = t;
    for (const f of this.food) { f.bone.visible = false; f.dog_treat.visible = false; }
    const raid = eco.liveRaid ? eco.liveRaid(now) : null;
    const counts = [0, 0, 0];
    this.kennels.forEach((k, i) => { k.visible = dogs.some(d => d.slot === i); });
    for (const d of dogs) {
      const lv = Math.min(3, Math.max(1, d.level)), m = this.meshes[lv - 1];
      if (!m) continue;                                   // (its model is still loading)
      const i = counts[lv - 1]++, st = this.st[d.slot] || (this.st[d.slot] = {});
      const K = KENNELS[d.slot], duty = eco.dogOnDuty(d, now);
      let x, z, face, moving = false, sleep = false, bark = false, run = false;
      const spot = raid && duty ? this.guardSpot(raid, d.slot) : null;
      let eating = false;
      if (st.feed && (spot || t < st.feed.t0 - 2 || t > st.feed.t0 + 120)) st.feed = null;   // a thief comes first; an old feeding is over
      if (st.feed && !spot) {
        // fed: run to the bowl, eat, then walk back to the patrol
        const F = st.feed, bowl = toWorld(K, -0.32, 1.5);
        if (!F.from) { F.from = st.init ? { x: st.x, z: st.z } : { x: bowl.x, z: bowl.z }; F.run = Math.hypot(bowl.x - F.from.x, bowl.z - F.from.z) / RUN_V; }
        const u = t - F.t0;
        if (u < F.run) {
          const k = u / Math.max(0.01, F.run); x = F.from.x + (bowl.x - F.from.x) * k; z = F.from.z + (bowl.z - F.from.z) * k;
          face = Math.atan2(bowl.x - F.from.x, bowl.z - F.from.z); moving = run = true;
        } else if (u < F.run + EAT_S) {
          x = bowl.x; z = bowl.z; face = K.yaw + Math.PI; eating = true;
          const m = this.food[d.slot][F.food]; m.visible = true; m.scale.setScalar(Math.max(0.25, 1 - (u - F.run) / EAT_S * 0.75));
        } else if (duty) {
          const p = raid ? null : this._patrol(d.slot, lv, t, {}), dist = p ? Math.hypot(p.x - bowl.x, p.z - bowl.z) : 0, k = p ? Math.min(1, (u - F.run - EAT_S) * WALK_V / Math.max(0.1, dist)) : 1;
          if (k >= 1) st.feed = null;
          else { x = bowl.x + (p.x - bowl.x) * k; z = bowl.z + (p.z - bowl.z) * k; face = Math.atan2(p.x - bowl.x, p.z - bowl.z); moving = true; }
        } else st.feed = null;
      }
      if (st.feed && !spot) { /* (the feeding above has placed it) */ }
      else if (!duty) {                                     // off duty: asleep in front of the kennel
        const p = toWorld(K, 0, 0.95); x = p.x; z = p.z; face = K.yaw + 0.4; sleep = true;
      } else if (spot) {                               // a thief: run to his coop and bark at him
        const p0 = this._patrol(d.slot, lv, Date.parse(raid.at) / 1000, {}), dist = Math.hypot(spot.x - p0.x, spot.z - p0.z), k = Math.min(1, (t - Date.parse(raid.at) / 1000) * 5.2 / Math.max(0.1, dist));
        x = p0.x + (spot.x - p0.x) * k; z = p0.z + (spot.z - p0.z) * k;
        run = k < 1; moving = run; face = run ? Math.atan2(spot.x - p0.x, spot.z - p0.z) : spot.face; bark = !run;
      } else {
        const p = this._patrol(d.slot, lv, t, {}), u = (t + d.slot * 4.3) % BARK_EVERY;
        x = p.x; z = p.z; face = p.face; moving = p.moving;
        if (u < BARK_FOR + 1) {                         // barking: it stops where it was, then walks on
          const h = this._patrol(d.slot, lv, t - u, {}), k = u < BARK_FOR ? 0 : ease(u - BARK_FOR);
          x = h.x + (p.x - h.x) * k; z = h.z + (p.z - h.z) * k; face = k ? p.face : h.face; moving = k > 0 && p.moving;
          if (u < BARK_FOR) {
            bark = true;
            const win = Math.floor((t + d.slot * 4.3) / BARK_EVERY), due = Math.min(3, Math.floor(u) + 1);   // a burst of three barks each second
            if (st.pbWin !== win) { st.pbWin = win; st.pbN = 0; }
            while (st.pbN < due) { st.pbN++; if (this.g.bark) this.g.bark(x, z, 3, lv === 1 ? 1.1 : lv === 3 ? 1.0 : 1.15); }
            st.barkT = t + 1;                           // (no thief's barking on top of it)
          }
        }
      }
      // steps from the distance really moved (no sliding): a step is as long as the paws really go
      const moved = st.init ? Math.hypot(x - st.x, z - st.z) : 0, DG = DOG_GAIT[lv];
      const stepLen = 4 * DG.leg * Math.sin(Math.max(0.12, (run ? DG.run : DG.walk) * (st.w || 0)));
      if (moved < 3) st.ph = (st.ph || 0) + moved / stepLen * Math.PI * 2;
      st.w = (st.w || 0) + ((moving ? 1 : 0) - (st.w || 0)) * (1 - Math.exp(-8 * dt));
      st.x = x; st.z = z; st.init = true;
      st.yaw = st.yaw === undefined ? face : dampA(st.yaw, face, 1 - Math.exp(-(run ? 10 : 5) * dt));
      // the head, the tail
      let head, fwd = 0, tail, lift = 0;
      if (sleep) { head = 0.55; tail = Math.sin(t * 0.4) * 0.03; lift = -0.34 + Math.sin(t * 1.3) * 0.006; }
      else if (eating) { head = 0.74 + Math.max(0, Math.sin(t * 7 + d.slot)) * 0.12; fwd = 0.02; tail = Math.sin(t * 14) * 0.45; lift = -0.32; }   // lying at the bowl chewing, tail wagging
      else if (bark) { const b = Math.max(0, Math.sin(t * 7 + d.slot)); head = -0.28 + b * 0.18; fwd = b * 0.03; tail = lv === 1 ? Math.sin(t * 16) * 0.3 : Math.sin(t * 3) * 0.08; }
      else if (lv === 1) { head = 0.02 + Math.sin(t * 8) * 0.03; tail = Math.sin(t * 15) * 0.5; }            // panting, wagging
      else { head = -0.12 + (moving ? 0.04 : 0); tail = Math.sin(t * 1.4 + d.slot) * 0.05; }                    // alert, still
      const bob = Math.abs(Math.sin(st.ph)) * 0.02 * st.w;
      const y = this.g.world.heightAt(x, z) + 0.01 + bob + lift;
      m.setMatrixAt(i, this._m.compose(this._p.set(x, y, z), this._q.setFromAxisAngle(this._up, st.yaw), this._s.set(1, 1, 1)));
      const A = m.geometry.attributes.iAnim, A2 = m.geometry.attributes.iAnim2;
      A.setXYZW(i, st.ph, (run ? 0.75 : 0.45) * st.w, head, fwd); A2.setX(i, tail);
      // barks (the sound)
      if (bark && this.g.bark && t > (st.barkT || 0)) { st.barkT = t + (lv === 3 ? 1.3 : 1.8) + Math.random() * 0.8; this.g.bark(x, z, lv === 3 ? 2 : 3, lv === 1 ? 0.85 : 1.15); }
    }
    this.meshes.forEach((m, k) => { if (!m) return; m.count = counts[k]; m.instanceMatrix.needsUpdate = true; m.geometry.attributes.iAnim.needsUpdate = true; m.geometry.attributes.iAnim2.needsUpdate = true; });
  }
}
