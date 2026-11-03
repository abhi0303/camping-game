// Fishing at the docks: walk onto a dock, E casts (one worm), wait for a bite, then the tug of war:
// hold S (or PULL on a phone) when the fish bites and while it is tired, let go while it fights, until it's
// landed. The game runs the same challenge as the server (sim.js) and records only when the button went
// down / up; the server replays that and decides — a client can't just claim a fish. Other players see
// your rod, line, bobber and catches through the normal player updates (PeerJS).
import * as THREE from 'three';
import { RODS, FISH, WHY, STEP, SAFE, DANGER, startChallenge, step } from './sim.js';
import { rodRig, bobberModel, fishModel, rodTip } from './models.js';
import { thumb } from './thumbs.js';

const FISH_NAME = { fish_small: 'Small Fish', fish_medium: 'Medium Fish', fish_large: 'Large Fish' };
const FISH_CODE = { fish_small: 1, fish_medium: 2, fish_large: 3 }, CODE_FISH = { 1: 'fish_small', 2: 'fish_medium', 3: 'fish_large' };
const PH = { ready: 1, cast: 2, wait: 3, fight: 4, reel: 5, result: 6 };
const SERVER_WHY = {
  nothing: 'Nothing is biting… try again.',
  too_fast: 'That catch came in faster than the clock allows — it didn\'t count.',
  timeout: 'You took too long — the fish escaped.',
  storage_full: 'The fish storage is full — sell some fish at the Fish Market. This one got away.',
};
const $ = id => document.getElementById(id);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const v3 = () => new THREE.Vector3();
const LINE_PTS = 16;

export class Fishing {
  // g: { scene, area, eco, player, gear, remotes, input, audio, toast, haptic, beforeStart(), onCatch(result) }
  constructor(g) {
    this.g = g; this.phase = null; this.spot = null; this.t = 0; this.msg = ''; this.busy = false;
    this.bend = 0; this.bob = v3(); this.tip = v3(); this.castFrom = v3(); this.held = null;
    this.line = this._makeLine(0xf2f2ea); g.scene.add(this.line);
    this.bobber = bobberModel(); this.bobber.visible = false; g.scene.add(this.bobber);
    this.caught = new Map();               // fish models shown on the hook
    this.remote = new Map();               // other players' lines and bobbers
    this._v = v3(); this._w = v3();
    this._hud();
  }
  get active() { return !!this.phase; }
  get locked() { return !!this.phase; }
  get rodLevel() { const f = this.g.eco.st && this.g.eco.st.fishing; return (f && f.rod) || 1; }
  worms() { return this.g.eco.qty('worms'); }

  /* ---------- things to walk up to ---------- */
  acts() {
    const A = this.g.area;
    if (!A.on) return [];
    if (!this._acts) {
      this._acts = A.spots.map(sp => ({ pos: sp.stand, r: 1.7, label: () => this._spotLabel(sp), act: () => this.start(sp) }));
      for (const p of A.marketSpots) this._acts.push({ pos: p, r: 2.7, label: () => '🐟 Fish Market — talk to the fisherman (worms · rods · sell fish)', act: () => this.g.openMarket() });
    }
    return this._acts;
  }
  _spotLabel(sp) {
    const who = this.takenBy(sp.i);
    if (who) return `🎣 ${who} is fishing here — try another dock`;
    if (!this.g.eco.ready) return '🎣 Fishing spot (the farm is loading…)';
    const w = this.worms();
    return w ? `🎣 Start Fishing  (🪱 ${w} worm${w > 1 ? 's' : ''})` : '🎣 Fishing spot — you need worms (Fish Market)';
  }
  takenBy(i) {
    let who = null;
    for (const r of this.g.remotes.map.values()) if (r.s.fs && r.s.fs[0] === i && !r.away) who = r.s.n || 'Someone';
    return who;
  }

  /* ---------- start / stop ---------- */
  start(sp) {
    const e = this.g.eco;
    if (this.phase) return;
    if (!e.ready) { this.g.toast('🌾 The farm is still loading…'); return; }
    const who = this.takenBy(sp.i);
    if (who) { this.g.toast(`🎣 ${who} is fishing at this dock — try another one`); return; }
    if (this.worms() < 1) { this.g.toast('🪱 You need worms to start fishing — buy them at the Fish Market (10 for ₹1)'); return; }
    this.g.beforeStart();
    this.spot = sp; this.phase = 'ready'; this.skip = true; this.result = null;
    const p = this.g.player;
    p.pos.set(sp.stand.x, sp.stand.y, sp.stand.z); p.vel.set(0, 0); p.yaw = sp.yaw;
    this._rig();
    this._show(true);
    this.cast();
  }
  stop(why) {
    if (!this.phase) return;
    if (this.phase === 'fight' && this.cur) this._send(true);       // walking away mid-fight: the fish is lost
    this.phase = null; this.spot = null; this.cur = null; this.ch = null;
    this.bobber.visible = false; this.line.visible = false; this._hideCatch();
    if (this.rig) { this.rig.root.removeFromParent(); }
    if (this.g.gear.held) this.g.gear.held.visible = true;
    this.g.audio.hum('reel', false);
    this._show(false); this._card(null);
    if (why) this.g.toast(why);
  }
  _rig() {
    const lv = this.rodLevel;
    if (!this.rig || this.rigLevel !== lv) { if (this.rig) this.rig.root.removeFromParent(); this.rig = rodRig(lv); this.rigLevel = lv; }
    this.g.player.char.hand.add(this.rig.root);
    this.rig.root.rotation.set(0, 0, 0);
  }

  /* ---------- casting ---------- */
  async cast() {
    if (this.busy || !this.spot) return;
    if (this.worms() < 1) { this.phase = 'ready'; this._say('You need worms to start fishing — buy them at the Fish Market.', true); return; }
    this._hideCatch(); this._card(null);
    this.phase = 'cast'; this.castT = 0; this.cur = null; this.ch = null; this.busy = true; this.landed = false;
    this._rig();
    this.bobber.visible = false;
    this._say('Casting…');
    try {
      const r = await this.g.eco.act({ action: 'cast', spot: this.spot.i });
      if (this.phase !== 'cast') return;                   // left meanwhile
      const d = r.result;
      this.cur = { id: d.cast, fish: d.fish, pulls: d.pulls, seed: d.seed, rod: d.rod, biteAt: d.biteAt ? Date.parse(d.biteAt) : null, giveUpAt: Date.parse(d.giveUpAt), nibble: 1 + Math.random() * 2 };
      this.answered = true;
    } catch (er) {
      if (this.phase !== 'cast') return;
      this.phase = 'ready'; this.bobber.visible = false; this.line.visible = false;
      const m = er.code === 'bad_input' && /Unknown farm action/.test(er.message || '') ? 'Fishing isn\'t switched on on the server yet.' : (er.message || String(er));
      this._say('⚠ ' + m, true); this.g.toast('⚠ ' + m);
    } finally { this.busy = false; }
  }

  /* ---------- the fight ---------- */
  _fight() {
    const c = this.cur;
    this.ch = startChallenge({ seed: c.seed, fish: c.fish, rod: c.rod, pulls: c.pulls });
    this.log = []; this.lastIn = 0; this.acc = 0; this.phase = 'fight'; this.splashT = 0;
    this.g.area.splash(this.bob.x, this.bob.z, 14, 1.1);
    this.g.audio.splash(1); this.g.haptic(120);
  }
  _stepFight(dt, pulling) {
    const s = this.ch;
    this.acc += dt * 1000;
    let n = 0;
    while (this.acc >= STEP && !s.done && n++ < 40) {
      const v = pulling ? 1 : 0;
      if (v !== this.lastIn) { this.log.push([s.t, v]); this.lastIn = v; }
      const before = s.pulls, phase = s.phase;
      step(s, !!v);
      this.acc -= STEP;
      if (s.pulls > before) { this.g.audio.click(); this.g.haptic(30); }
      if (phase !== s.phase && s.phase === 'resist') { this.g.audio.splash(0.5); this.g.area.splash(this.bob.x, this.bob.z, 6, 0.6); }
    }
    if (s.done) this._send(false);
  }
  // the challenge is over here: the server replays the log and says whether the fish is landed
  async _send(leaving) {
    const c = this.cur, log = this.log || [];
    if (!c) return;
    this.cur = null;
    if (!leaving) { this.phase = 'reel'; this._say(this.ch && this.ch.ok ? 'Reeling in…' : 'The fish is getting away…'); }
    this.g.audio.hum('reel', false);
    let r = null, err = null;
    try { r = (await this.g.eco.act({ action: 'reel', cast: c.id, log })).result; } catch (e) { err = e; }
    if (leaving || this.phase !== 'reel') return;
    this.phase = 'result'; this.resultT = 0;
    if (r && r.caught) {
      this.result = { ok: true, fish: r.fish, weight: r.weight, value: r.value };
      this._showCatch(r.fish);
      this.g.area.splash(this.bob.x, this.bob.z, 16, 1.2); this.g.audio.splash(1); this.g.haptic([60, 40, 60]);
      const msg = `You caught a ${FISH_NAME[r.fish]}! Selling Value: ₹${r.value}`;
      this._say('🎉 ' + msg); this.g.toast('🎣 ' + msg);
      this._card(this.result);
      this.g.onCatch && this.g.onCatch(r);
    } else {
      const why = err ? 'Couldn\'t reach the farm server — the fish got away.' : SERVER_WHY[r.why] || WHY[r.why] || 'The fish escaped.';
      this.result = { ok: false, why: r ? r.why : 'error' };
      this.bobber.visible = false; this.line.visible = false;
      const msg = r && r.why === 'nothing' ? why : `The fish escaped! Try again. ${why}`;
      this._say('💨 ' + msg, true); this.g.toast('💨 ' + msg);
      this._card(this.result, msg);
    }
  }

  /* ---------- every frame ---------- */
  update(dt, input) {
    this.t += dt;
    this._remotes(dt);
    if (!this.phase) return;
    const p = this.g.player, sp = this.spot;
    if (p.mode !== 'foot' || p.downed || p.dead) { this.stop(); return; }
    // stay on the dock end, facing the water
    p.pos.x = sp.stand.x; p.pos.z = sp.stand.z; p.yaw = sp.yaw;
    if (this.g.gear.held) this.g.gear.held.visible = false;
    const skip = this.skip; this.skip = false;
    const E = !skip && input.wasPressed('KeyE'), Q = !skip && (input.wasPressed('KeyQ') || input.wasPressed('Escape'));
    const pulling = input.isDown('KeyS', 'ArrowDown');
    const moving = input.isDown('KeyW', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowRight') || (input.stick.active && Math.hypot(input.stick.x, input.stick.y) > 0.6);
    if (Q || ((this.phase === 'ready' || this.phase === 'result') && moving)) { this.stop(); return; }
    const W = this.g.area.W, now = this.g.eco.serverNow();
    // the rod tip (world)
    this.rig.root.updateMatrixWorld(true);
    this.rig.tip.getWorldPosition(this.tip);
    let bendTo = 0.06, sag = 0.5, pose = 'rod';
    switch (this.phase) {
      case 'ready':
        this.bobber.visible = false; this.line.visible = false;
        if (E) this.cast();
        break;
      case 'cast': {
        this.castT += dt;
        pose = this.castT < 0.4 ? 'rodCast' : 'rod';
        const k = Math.min(1, Math.max(0, (this.castT - 0.45) / 0.7));
        if (this.castT >= 0.45) {
          if (!this.bobber.visible) { this.castFrom.copy(this.tip); this.bobber.visible = true; this.line.visible = true; this.g.audio.thud(520, 0.08); }
          this.bob.lerpVectors(this.castFrom, sp.water, k); this.bob.y += Math.sin(k * Math.PI) * 2.2;
          if (k >= 1 && !this.landed) { this.landed = true; this.g.area.splash(sp.water.x, sp.water.z, 5, 0.5); this.g.audio.splash(0.4); }
        }
        if (k >= 1 && this.cur) { this.phase = 'wait'; this._say('Waiting for a bite…'); }
        break;
      }
      case 'wait': {
        const c = this.cur;
        this.bob.set(sp.water.x + Math.sin(this.t * 0.4) * 0.15, W + 0.02 + Math.sin(this.t * 2.3) * 0.015, sp.water.z);
        // little nibbles before the bite
        c.nibble -= dt;
        if (c.nibble < 0) { c.nibble = 1.2 + Math.random() * 2.5; this.dip = 0.25; this.g.area.ripple(this.bob.x, this.bob.z, 0.4, 0.9); }
        if (this.dip > 0) { this.dip -= dt; this.bob.y -= 0.05 * Math.sin(this.dip / 0.25 * Math.PI); }
        if (E) { this.phase = 'ready'; this.cur = null; this._say('Reeled in. Press E to cast again.'); break; }
        if (c.biteAt && now >= c.biteAt + 250) this._fight();
        else if (!c.biteAt && now >= c.giveUpAt) { this.ch = null; this.log = []; this._send(false); }
        break;
      }
      case 'fight': {
        const s = this.ch;
        if (E) { this._send(true); this.phase = 'ready'; this._say('You let the fish go.', true); break; }
        this._stepFight(dt, pulling);
        pose = pulling ? 'rodPull' : 'rod';
        const fightK = s.phase === 'resist' ? 1 : s.phase === 'hook' ? 0.7 : 0.35;
        bendTo = 0.3 + s.tension * 0.9 + Math.sin(this.t * (s.phase === 'resist' ? 17 : 8)) * 0.07 * fightK;
        sag = 0.02;
        const near = Math.min(0.75, (s.pulls + (s.phase === 'tired' ? s.pp : 0)) / Math.max(1, s.need) * 0.75);
        this._v.lerpVectors(sp.water, this._w.set(sp.stand.x, W, sp.stand.z), near);
        const side = Math.sin(this.t * (s.phase === 'resist' ? 2.6 : 1.1)) * (s.phase === 'resist' ? 1.2 : 0.4);
        this.bob.set(this._v.x + Math.cos(sp.yaw) * side, W - 0.06 + Math.sin(this.t * 9) * 0.03, this._v.z - Math.sin(sp.yaw) * side);
        if (s.phase === 'resist' && (this.splashT -= dt) < 0) { this.splashT = 0.45; this.g.area.splash(this.bob.x, this.bob.z, 4, 0.55); }
        this.g.audio.hum('reel', pulling && s.phase === 'tired', 'square', 24, 0.025);
        break;
      }
      case 'reel':
        bendTo = 0.4; sag = 0.05; pose = 'rodPull';
        break;
      case 'result': {
        this.resultT += dt;
        if (this.result && this.result.ok) {
          bendTo = 0.35; pose = 'rodPull';
          const f = this.caught.get(this.result.fish);
          if (f) {
            f.position.set(this.tip.x, this.tip.y - 0.65 - FISH[this.result.fish].strength * 0.1, this.tip.z);
            f.rotation.set(Math.PI / 2 + Math.sin(this.t * 7) * 0.15, this.t * 1.3, Math.sin(this.t * 11) * 0.3);
            this.bob.set(f.position.x, f.position.y + 0.25, f.position.z);
          }
        }
        if (E) { this.phase = 'ready'; this._card(null); this._hideCatch(); this.cast(); }
        break;
      }
    }
    this.pose = pose;
    this.bend = damp(this.bend, bendTo, 10, dt);
    this.rig.bend(this.bend);
    this.rig.root.rotation.x = pose === 'rodPull' ? -0.35 : 0;
    if (this.bobber.visible || this.line.visible) {
      if (this.phase !== 'result' || !this.result || !this.result.ok) this.bobber.position.copy(this.bob);
      else this.bobber.visible = false;
      this._lineTo(this.line, this.tip, this.bob, sag);
    }
    this._hudUpdate();
  }
  holdPose() { return this.phase ? this.pose || 'rod' : null; }
  prompt() {
    const ph = this.phase;
    if (ph === 'ready') return { key: 'E', text: `Cast (🪱 ${this.worms()} worms)    [Q] Leave` };
    if (ph === 'wait') return { key: 'E', text: 'Reel in    [Q] Leave' };
    if (ph === 'fight') return { key: 'S', text: 'Hold to pull · let go when the fish fights' };
    if (ph === 'result') return { key: 'E', text: this.result && this.result.ok ? 'Collect & cast again    [Q] Leave' : 'Cast again    [Q] Leave' };
    return null;
  }
  // what other players need to draw this player's fishing: [spot, phase, rod, bobber x, y, z, tension %, fish]
  netExtra() {
    if (!this.phase) return { fs: 0 };
    const r = x => Math.round(x * 100) / 100, ok = this.phase === 'result' && this.result && this.result.ok;
    return { it: 'rod' + this.rodLevel, fs: [this.spot.i, PH[this.phase], this.rodLevel, r(this.bob.x), r(this.bob.y), r(this.bob.z),
      this.ch && this.phase === 'fight' ? Math.round(this.ch.tension * 100) : 0, ok ? FISH_CODE[this.result.fish] : 0, this.bobber.visible || this.line.visible ? 1 : 0] };
  }

  /* ---------- other players ---------- */
  _remotes(dt) {
    const seen = new Set();
    for (const r of this.g.remotes.map.values()) {
      const f = r.s.fs;
      if (!f || r.away) continue;
      seen.add(r.id);
      let o = this.remote.get(r.id);
      if (!o) { o = { line: this._makeLine(0xf2f2ea), bob: bobberModel(), pos: new THREE.Vector3(f[3], f[4], f[5]), fish: null, ph: 0 }; this.g.scene.add(o.line, o.bob); this.remote.set(r.id, o); }
      o.pos.lerp(this._v.set(f[3], f[4], f[5]), 1 - Math.exp(-12 * dt));
      const tipOk = r.item && r.itemType === 'rod' + f[2];
      if (tipOk) { r.item.updateMatrixWorld(true); r.item.localToWorld(this._w.copy(rodTip(f[2]))); } else r.char.root.getWorldPosition(this._w).y += 1.6;
      const show = !!f[8];
      o.bob.visible = show && !f[7]; o.bob.position.copy(o.pos); o.line.visible = show;
      if (show) this._lineTo(o.line, this._w, o.pos, f[1] === PH.fight ? 0.02 : 0.5);
      // their catch hangs on the line (and everyone hears about it)
      const fish = f[1] === PH.result && f[7] ? CODE_FISH[f[7]] : null;
      if (fish && o.ph !== PH.result) this.g.toast(`🎣 ${r.s.n || 'A teammate'} caught a ${FISH_NAME[fish].toLowerCase()}!`);
      o.ph = f[1];
      if (fish) {
        if (!o.fish || o.fishType !== fish) { if (o.fish) this.g.scene.remove(o.fish); o.fish = fishModel(fish); o.fishType = fish; this.g.scene.add(o.fish); }
        o.fish.visible = true; o.fish.position.set(this._w.x, this._w.y - 0.7, this._w.z); o.fish.rotation.set(Math.PI / 2, this.t, Math.sin(this.t * 9) * 0.3);
        this._lineTo(o.line, this._w, o.fish.position, 0.02); o.line.visible = true;
      } else if (o.fish) o.fish.visible = false;
    }
    for (const [id, o] of this.remote) if (!seen.has(id)) { this.g.scene.remove(o.line, o.bob); if (o.fish) this.g.scene.remove(o.fish); this.remote.delete(id); }
  }

  /* ---------- drawing helpers ---------- */
  _makeLine(color) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_PTS * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    l.frustumCulled = false; l.visible = false;
    return l;
  }
  _lineTo(line, a, b, sag) {
    const pos = line.geometry.attributes.position, d = a.distanceTo(b);
    for (let i = 0; i < LINE_PTS; i++) {
      const k = i / (LINE_PTS - 1);
      pos.setXYZ(i, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k - sag * d * 0.12 * 4 * k * (1 - k), a.z + (b.z - a.z) * k);
    }
    pos.needsUpdate = true;
  }
  _showCatch(type) {
    let f = this.caught.get(type);
    if (!f) { f = fishModel(type); this.caught.set(type, f); this.g.scene.add(f); }
    f.visible = true;
  }
  _hideCatch() { for (const f of this.caught.values()) f.visible = false; }

  /* ---------- HUD: rod, worms, bite, tension, pulls, resistance, instructions; the result card ---------- */
  _hud() {
    const hud = $('hud'), box = document.createElement('div');
    box.id = 'fishHud'; box.className = 'panel hidden';
    box.innerHTML = `<div class="fh-top"><span id="fhRod"></span><span id="fhWorms"></span></div>
      <div id="fhStatus" class="fh-status"></div>
      <div id="fhFight" class="hidden">
        <div class="fh-meter"><i class="z1"></i><i class="z2"></i><i class="z3"></i><b id="fhNeedle"></b></div>
        <div class="fh-lbls"><span>Tension</span><span id="fhTension"></span></div>
        <div class="fh-row"><span>Pulls</span><span id="fhPulls"></span></div>
        <div class="fh-row"><span>Fish</span><span id="fhRes"></span></div>
        <div class="fh-pull"><u id="fhPP"></u></div>
      </div>
      <div id="fhTip" class="fh-tip"></div>`;
    hud.appendChild(box);
    const card = document.createElement('div');
    card.id = 'fishCard'; card.className = 'hidden';
    hud.appendChild(card);
    card.addEventListener('click', e => { if (e.target.closest('[data-x="collect"]')) { this._card(null); this._hideCatch(); if (this.phase === 'result') this.phase = 'ready'; } });
    this.el = { box, card, rod: $('fhRod'), worms: $('fhWorms'), status: $('fhStatus'), fight: $('fhFight'), needle: $('fhNeedle'), tension: $('fhTension'), pulls: $('fhPulls'), res: $('fhRes'), pp: $('fhPP'), tip: $('fhTip') };
    this._txt = {};
  }
  _show(on) { this.el.box.classList.toggle('hidden', !on); }
  _say(m, bad = false) { this.msg = m; this.msgBad = bad; }
  _set(k, v, prop = 'textContent') { if (this._txt[k] !== v) { this._txt[k] = v; this.el[k][prop] = v; } }
  _hudUpdate() {
    const s = this.ch, ph = this.phase, R = RODS[this.rodLevel];
    this._set('rod', `🎣 ${R.name} · Lv ${this.rodLevel}`);
    this._set('worms', `🪱 ${this.worms()} worms`);
    let status = this.msg, tip = '', cls = this.msgBad ? 'bad' : '';
    if (ph === 'wait') { status = '🎣 Waiting for a bite…'; tip = 'Watch the float. When a fish bites, hold S (PULL) at once!'; cls = ''; }
    if (ph === 'fight') {
      if (s.phase === 'hook') { status = '🐟 A fish has bitten! Pull now!'; tip = 'Hold S / PULL to set the hook'; cls = 'bite'; }
      else if (s.phase === 'resist') { status = '💥 The fish is fighting — RELEASE!'; tip = 'Let go of S while it fights, or the line snaps'; cls = 'bad'; }
      else { status = '💪 The fish is tired — PULL!'; tip = 'Hold S / PULL until the pull is reeled in'; cls = 'good'; }
    }
    if (ph === 'ready') tip = 'E: cast (uses 1 worm) · Q or move: leave';
    if (ph === 'result') tip = this.result && this.result.ok ? 'E: collect & cast again · Q: leave' : 'E: cast again · Q: leave';
    this._set('status', status);
    if (this._cls !== cls) { this._cls = cls; this.el.status.className = 'fh-status ' + cls; }
    this._set('tip', tip);
    const fighting = ph === 'fight' && s;
    if (fighting !== this._fighting) { this._fighting = fighting; this.el.fight.classList.toggle('hidden', !fighting); }
    if (fighting) {
      const t = Math.min(1, s.tension);
      this.el.needle.style.left = (t * 100).toFixed(1) + '%';
      this._set('tension', t < SAFE ? 'safe' : t < DANGER ? 'tension' : 'DANGER');
      this.el.tension.className = t < SAFE ? 'ok' : t < DANGER ? 'warn' : 'bad';
      this._set('pulls', '●'.repeat(s.pulls) + '○'.repeat(Math.max(0, s.need - s.pulls)) + `  ${s.pulls} / ${s.need}`);
      const size = { fish_small: 'small', fish_medium: 'medium', fish_large: 'LARGE' }[this.cur ? this.cur.fish : ''] || '';
      this._set('res', s.phase === 'resist' ? `🔴 ${size} · resisting — high` : s.phase === 'hook' ? `🟡 ${size} · on the hook` : `🟢 ${size} · tired — low`);
      this.el.pp.style.width = (s.phase === 'tired' ? Math.min(1, s.pp) * 100 : 0).toFixed(0) + '%';
    }
  }
  // the result card (ok: the fish, its weight and value, and a Collect button), or a short failure note
  _card(res, msg) {
    const c = this.el.card;
    clearTimeout(this._cardT);
    if (!res) { c.classList.add('hidden'); return; }
    if (res.ok) {
      const k = this.g.eco.cat(res.fish) || {}, img = thumb(res.fish);
      c.className = 'ok';
      c.innerHTML = `<div class="fc-t">Fishing Result</div>${img ? `<img src="${img}" alt="">` : `<div class="fc-ico">${k.icon || '🐟'}</div>`}
        <div class="fc-big">You caught a ${FISH_NAME[res.fish]}!</div>
        <div class="fc-r">Weight <b>${res.weight} kg</b></div><div class="fc-r">Selling Value <b>₹${res.value}</b></div>
        <div class="fc-r">In the farm storage <b>${k.icon || ''} ${this.g.eco.qty(res.fish)}</b></div>
        <button class="fu-go wide" data-x="collect">Collect</button>`;
    } else {
      c.className = 'bad';
      c.innerHTML = `<div class="fc-t">${res.why === 'nothing' ? 'No bite' : 'The fish escaped!'}</div><div class="fc-msg">${msg}</div>`;
      this._cardT = setTimeout(() => c.classList.add('hidden'), 3200);
    }
  }
}
