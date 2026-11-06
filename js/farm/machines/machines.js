// The industrial machines in Farm World (the gold mine by the windmill, the flour mill across from the Farm Store):
// builds both sites, shows them as the farm server says they are, the E prompts that open their panels
// (js/farm/machines/machineUI.js), turning the level 1 millstone by hand, the particles (sparks, smoke, flour dust,
// flying coins) and the machines' sounds. New machines plug in the same way: a site class with build() / update().
import * as THREE from 'three';
import { MineSite, MINE_POS } from './mining.js';
import { FlourMill, FLOUR_POS } from './flour.js';

const FX_MAX = 420;
// the little flying bits: one instanced mesh for all of them
class Bits {
  constructor(scene) {
    this.list = []; this.acc = {};
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }), FX_MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FX_MAX * 3), 3);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }
  // n bits a call (fractions carry over) of a kind at a point in `group`'s frame
  emit(group, at, kind, n) {
    const a = (this.acc[kind] || 0) + n;
    let k = Math.floor(a); this.acc[kind] = a - k;
    if (!k) return;
    const p = this._v.set(at[0], at[1], at[2]); group.localToWorld(p);
    while (k-- > 0 && this.list.length < FX_MAX - 10) {
      const r = Math.random, ang = r() * Math.PI * 2;
      if (kind === 'spark') this.list.push({ x: p.x, y: p.y, z: p.z, vx: Math.cos(ang) * (1 + r() * 2), vy: 1.5 + r() * 2.5, vz: Math.sin(ang) * (1 + r() * 2), t: 0.5 + r() * 0.4, g: 9, kind, s: 0.6 });
      else if (kind === 'smoke') this.list.push({ x: p.x, y: p.y, z: p.z, vx: (r() - 0.5) * 0.3, vy: 0.8 + r() * 0.4, vz: (r() - 0.5) * 0.3, t: 2.2, g: -0.1, kind, s: 1.6, grow: 1.1 });
      else if (kind === 'flour') this.list.push({ x: p.x + (r() - 0.5) * 0.1, y: p.y, z: p.z + (r() - 0.5) * 0.1, vx: (r() - 0.5) * 0.4, vy: -0.2 - r() * 0.4, vz: (r() - 0.5) * 0.4, t: 0.9, g: 1.5, kind, s: 0.8, grow: 0.8 });
    }
  }
  // coins flying from a point to a target (the player), in an arc
  coins(from, to, n) {
    for (let i = 0; i < n && this.list.length < FX_MAX - 4; i++) this.list.push({ kind: 'coin', a: from.clone(), b: to, u: -i * 0.06, t: 2, s: 1.6 });
  }
  update(dt) {
    const m = this._m, L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const b = L[i];
      if (b.kind === 'coin') { b.u += dt * 1.6; if (b.u >= 1) { L.splice(i, 1); continue; } continue; }
      b.t -= dt; b.vy -= b.g * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; if (b.grow) b.s += b.grow * dt;
      if (b.t <= 0) L.splice(i, 1);
    }
    let n = 0;
    for (const b of L) {
      if (b.kind === 'coin') {
        const u = Math.max(0, b.u), x = b.a.x + (b.b.x - b.a.x) * u, z = b.a.z + (b.b.z - b.a.z) * u, y = b.a.y + (b.b.y + 1.2 - b.a.y) * u + Math.sin(u * Math.PI) * 1.4;
        if (b.u < 0) continue;
        m.compose(this._v.set(x, y, z), this._q.identity(), this._s.set(b.s, 0.5, b.s));
        this.mesh.setColorAt(n, this._c.set(0xffd23a));
      } else {
        m.compose(this._v.set(b.x, b.y, b.z), this._q.identity(), this._s.setScalar(b.s * (b.kind === 'smoke' ? Math.min(1, b.t) : 1)));
        this.mesh.setColorAt(n, this._c.set(b.kind === 'spark' ? 0xffc23a : b.kind === 'smoke' ? 0x6e6a66 : 0xf6f2ea));
      }
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
}

export class Machines {
  // g: { world, eco, player, touch, toast, hud, act(body) -> Promise, openPanel(view), sound: Ambience }
  constructor(scene, g) { this.scene = scene; this.g = g; this.on = false; this.turn = null; }
  enable() {
    if (this.on) return;
    this.on = true;
    this.fx = new Bits(this.scene);
    this.mine = new MineSite(this.scene, this.g.world, this.fx); this.mine.build();
    this.flour = new FlourMill(this.scene, this.g.world, this.fx); this.flour.build();
    this.meter = document.createElement('div'); this.meter.id = 'turnMeter'; this.meter.className = 'hidden'; this.g.hud.appendChild(this.meter);
  }
  get minePos() { return MINE_POS; }
  get flourPos() { return FLOUR_POS; }
  // E near a machine: its panel
  acts() {
    if (!this.on || !this.g.eco.ready || !this.g.eco.machines()) return [];
    const e = this.g.eco, m = e.mineNow(), f = e.flourNow(), y = p => this.g.world.heightAt(p.x, p.z);
    const out = [{ pos: { x: this.mine.centre.x, y: y(this.mine.centre), z: this.mine.centre.z }, r: 4.2,
      label: () => `Gold mine · level ${m.level}${m.ready ? ` — ${m.ready} coin${m.ready > 1 ? 's' : ''} to collect` : m.running ? ' — running' : ' — works 7 PM – 4 AM'}`, act: () => this.g.openPanel('mine') }];
    if (!this.turn) out.push({ pos: { x: this.flour.centre.x, y: y(this.flour.centre), z: this.flour.centre.z }, r: 3.6,
      label: () => (f ? `Flour machine · level ${f.level}${f.ready ? ` — ${f.ready} packets to collect` : ''}` : 'Flour machine — 10 gold coins'), act: () => this.g.openPanel('flour') });
    return out;
  }

  /* ---------- turning the level 1 millstone by hand ---------- */
  startTurning() {
    const p = this.g.player, h = this.flour.handleW(), F = FLOUR_POS;
    this.turn = { t: 0, need: (this.g.eco.machines().rules.flour.grindS) || 15, hold: 0, done: false };
    p.startTween([new THREE.Vector3(h.x, h.y, h.z)], { dur: 0.4, yaw: F.yaw + Math.PI, done: () => { p.mode = 'foot'; p.grounded = true; } });
    if (this.g.touch) this.g.touch.setTurn(true);
    this.g.toast(this.g.touch && this.g.touch.enabled ? 'Hold TURN to turn the millstone' : 'Hold Space (or F / the mouse) to turn the millstone');
  }
  stopTurning(msg) {
    if (!this.turn) return;
    this.turn = null; this.flour.turning = false;
    this.g.player.char.cranking = false;
    this.meter.className = 'hidden';
    if (this.g.touch) this.g.touch.setTurn(false);
    if (msg) this.g.toast(msg);
  }
  input(input) {
    if (!this.turn) return;
    if (input.isDown('Space', 'KeyF') || input.click) this.turn.hold = 0.25;
    input.pressed.delete('Space'); input.pressed.delete('KeyF'); input.click = false;
  }
  _turning(dt) {
    const T = this.turn;
    if (!T) return;
    const p = this.g.player, h = this.flour.handleW();
    if (p.mode === 'tween') return;
    if (Math.hypot(p.pos.x - h.x, p.pos.z - h.z) > 1.6 || p.mode !== 'foot') { this.stopTurning('Stopped turning the millstone — press E at the machine to go on'); return; }
    T.hold = Math.max(0, T.hold - dt);
    const on = T.hold > 0 && !T.done;
    this.flour.turning = on; p.char.cranking = on;
    if (on) { T.t += dt; p.yaw = FLOUR_POS.yaw + Math.PI; }
    const pct = Math.min(1, T.t / T.need), tip = on ? 'Turning…' : (this.g.touch && this.g.touch.enabled ? 'Hold TURN' : 'Hold Space (or click)') + ' to turn';
    this.meter.className = '';
    this.meter.innerHTML = `<div class="sm-top"><span>⚙ Turning the millstone</span><b>${T.t.toFixed(1)} / ${T.need} s</b></div><div class="sm-bar"><i style="width:${pct * 100}%"></i></div><div class="sm-hint">${tip} · up to 100 wheat a turn</div>`;
    if (T.t >= T.need && !T.done) {
      T.done = true;
      this.g.act({ action: 'machine', machine: 'flour', op: 'turn' }).then(r => { this.stopTurning('🥡 ' + r.message); }, er => {
        if (er && /too_fast|Keep turning/.test(er.message || '')) { T.done = false; T.t = T.need - 1.5; } else this.stopTurning('⚠ ' + (er.message || er));
      });
    }
  }

  /* ---------- collecting coins: they fly from the box to you ---------- */
  collectFx(n) {
    if (!this.on) return;
    const c = this.mine.chestW, y = this.g.world.heightAt(c.x, c.z) + 0.8;
    this.fx.coins(new THREE.Vector3(c.x, y, c.z), this.g.player.pos, Math.min(16, Math.max(3, n)));
    if (this.g.sound) this.g.sound.jingle(true);
  }

  /* ---------- every frame ---------- */
  update(dt) {
    if (!this.on) return;
    const e = this.g.eco, M = e.ready && e.machines() ? e : null, m = M ? e.mineNow() : null, f = M ? e.flourNow() : null;
    this.mine.update(dt, m);
    this.flour.update(dt, f);
    this._turning(dt);
    this.fx.update(dt);
    // sounds: the mine's hum at night, the flour machine's motor (or the stone under the hand)
    const S = this.g.sound, p = this.g.player.pos;
    if (S && S.machineLoop) {
      const dm = Math.hypot(p.x - MINE_POS.x, p.z - MINE_POS.z), df = Math.hypot(p.x - FLOUR_POS.x, p.z - FLOUR_POS.z);
      S.machineLoop('mine', m && m.running ? 0.11 * this.mine.run * Math.max(0, 1 - dm / 45) : 0, 55 + (m ? m.level : 1) * 6, 1);
      const fl = f && (f.grinding || this.flour.turning) ? Math.max(0, 1 - df / 30) : 0;
      S.machineLoop('flour', fl * (f && !f.manual ? 0.08 : 0.07), f && !f.manual ? 90 + f.level * 8 : 40, f && f.manual ? 2 : 1);
    }
  }
}
