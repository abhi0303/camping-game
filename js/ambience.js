// The jungle around you, made of synthesized sounds (no audio files):
//   night    — a cricket chorus with single crickets chirping close by, toads trilling (more near the river),
//              and now and then a distant owl
//   morning  — lots of birdsong (fewer birds later in the day), from the birds sitting in the trees nearby
//   river    — flowing water when you're near it; at the docks while fishing, water lapping, little bubbles
//              and fish jumping out of the water
//   footsteps — soft steps on grass, gravel on the road, hollow knocks on wooden docks and the RV floor
// Everything is quiet and low-passed so it sits under the game. Inside the RV it sounds muffled.
import { audio } from './audio.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// left / right of a sound at (x, z) for a listener at L = { x, z, fx, fz } (the camera's forward direction):
// the camera's right is (-fz, fx)
const panOf = (L, x, z) => { const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz) || 1; return clamp((-L.fz * dx + L.fx * dz) / d * 0.9, -0.9, 0.9); };

export class Ambience {
  constructor() { this.ready = false; this.t = 0; this.stepT = 0; this.foot = 0; this.timers = { cricket: [], toad: 2, owl: 30, bird: 1, bubble: 2, lap: 0 }; }

  _setup() {
    const ctx = audio.context(), out = audio.out && audio.out();
    if (!ctx || !out) return false;
    this.ctx = ctx;
    // ambience bus -> muffle filter (inside the RV) -> master
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000; this.muffle.Q.value = 0.4;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.9;
    this.bus.connect(this.muffle); this.muffle.connect(out);
    this.fx = ctx.createGain(); this.fx.gain.value = 1; this.fx.connect(out);      // footsteps: not muffled
    // noise buffers: white (2 s) and brown (4 s), looped for the beds
    const mk = (sec, fn) => { const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0); fn(d); return b; };
    this.white = mk(2, d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk(4, d => { let v = 0; for (let i = 0; i < d.length; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = v * 3.5; } });
    const loop = (buf, nodes, gain) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = 0; s.loopEnd = buf.duration;
      let n = s; for (const x of nodes) { n.connect(x); n = x; }
      const g = ctx.createGain(); g.gain.value = 0; n.connect(g); g.connect(this.bus);
      s.start(0, Math.random() * buf.duration); return { s, g, target: gain };
    };
    const bp = (f, q) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; return b; };
    const lp = f => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; return b; };
    const hp = f => { const b = ctx.createBiquadFilter(); b.type = 'highpass'; b.frequency.value = f; return b; };
    // wind through the leaves: very soft
    this.wind = loop(this.brown, [lp(700), hp(90)], 0);
    // river: a low rush + a brighter babble whose filter wanders (lapping)
    this.river = loop(this.brown, [bp(420, 0.6), hp(120)], 0);
    this.babbleF = bp(1300, 1.4);
    this.babble = loop(this.white, [this.babbleF, lp(2600)], 0);
    // cricket chorus far away: a few 4-5 kHz tones pulsed fast and swelling slowly
    this.chorus = ctx.createGain(); this.chorus.gain.value = 0; this.chorus.connect(this.bus);
    for (const [fr, rate, sw] of [[4300, 24, 0.31], [4720, 29, 0.47], [5050, 21, 0.23]]) {
      const o = ctx.createOscillator(), am = ctx.createGain(), lfo = ctx.createOscillator(), lfoG = ctx.createGain(), swell = ctx.createOscillator(), swG = ctx.createGain(), g = ctx.createGain();
      o.frequency.value = fr; lfo.type = 'square'; lfo.frequency.value = rate; lfoG.gain.value = 0.5; am.gain.value = 0.5;
      lfo.connect(lfoG); lfoG.connect(am.gain);
      swell.frequency.value = sw; swG.gain.value = 0.5; g.gain.value = 0.5; swell.connect(swG); swG.connect(g.gain);
      o.connect(am); am.connect(g); g.connect(this.chorus);
      o.start(); lfo.start(); swell.start();
    }
    for (let i = 0; i < 4; i++) this.timers.cricket.push({ next: rnd(0, 3), f: rnd(4200, 5200), pan: rnd(-0.9, 0.9), left: 0 });
    this.ready = true;
    return true;
  }
  _pan(p) { const n = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null; if (n) n.pan.value = clamp(p, -1, 1); return n; }
  _env(g, t, peak, a, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  _wire(src, g, pan, dest = this.bus) { const p = this._pan(pan); src.connect(g); if (p) { g.connect(p); p.connect(dest); } else g.connect(dest); }

  /* ---------- single sounds ---------- */
  cricket(c, vol) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = c.f; g.gain.value = 0;
    const n = 3 + (Math.random() < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) { const s = t + k * 0.034; g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(vol, s + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.024); }
    this._wire(o, g, c.pan); o.start(t); o.stop(t + n * 0.034 + 0.05);
  }
  toad(vol, pan) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02, d = rnd(0.5, 1.6), o = ctx.createOscillator(), f = ctx.createBiquadFilter(), am = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    const base = rnd(150, 260);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * rnd(0.92, 1.06), t + d);
    f.type = 'lowpass'; f.frequency.value = base * 4; f.Q.value = 3;
    lfo.type = 'square'; lfo.frequency.value = rnd(26, 42); lg.gain.value = 0.5; am.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.06); g.gain.setValueAtTime(vol, t + d - 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(f); f.connect(am); this._wire(am, g, pan);
    o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
  }
  owl(vol, pan) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    [[0, 0.32], [0.55, 0.18], [0.82, 0.5]].forEach(([dt, d]) => {
      const t = t0 + dt, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(410, t); o.frequency.linearRampToValueAtTime(370, t + d);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.07); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      this._wire(o, g, pan); o.start(t); o.stop(t + d + 0.05);
    });
  }
  // birdsong: a few different songs
  bird(vol, pan) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02, kind = Math.floor(Math.random() * 4);
    const note = (t, f0, f1, d, v = vol, vib = 0) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
      if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vib; lg.gain.value = f0 * 0.06; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + d + 0.02); }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.02, d * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      this._wire(o, g, pan); o.start(t); o.stop(t + d + 0.03);
    };
    if (kind === 0) {                                  // whistled phrase: up, up, down
      const b = rnd(2200, 3000); [[0, 1, 1.25], [0.16, 1.1, 1.4], [0.34, 1.5, 1.1]].forEach(([dt, a, z]) => note(t0 + dt, b * a, b * z, 0.12));
    } else if (kind === 1) {                           // chip-chip-chip
      const b = rnd(4200, 5200), n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) note(t0 + i * 0.11, b, b * 0.7, 0.05, vol * 0.8);
    } else if (kind === 2) {                           // trill
      note(t0, rnd(3200, 3900), rnd(3000, 3600), rnd(0.4, 0.7), vol * 0.7, rnd(22, 30));
    } else {                                           // two sweet notes, the second lower ("tee-yoo")
      const b = rnd(2600, 3400); note(t0, b, b * 1.15, 0.16); note(t0 + 0.22, b * 1.05, b * 0.72, 0.22);
    }
  }
  bubble(vol, pan) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02, n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rnd(0.06, 0.16), o = ctx.createOscillator(), g = ctx.createGain(), f = rnd(380, 700);
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rnd(2, 2.8), t + 0.05);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      this._wire(o, g, pan); o.start(t); o.stop(t + 0.08);
    }
  }
  // a fish jumping out (small) or falling back in (bigger): a "plop" and a short splash
  fishJump(vol, pan, landing) {
    if (vol < 0.004) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(landing ? 260 : 420, t); o.frequency.exponentialRampToValueAtTime(landing ? 70 : 140, t + 0.09);
    this._env(og, t, vol * (landing ? 1 : 0.6), 0.005, 0.12); this._wire(o, og, pan); o.start(t); o.stop(t + 0.16);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.white; f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.setValueAtTime(landing ? 1800 : 2600, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.3);
    s.connect(f); this._env(g, t, vol * (landing ? 1.1 : 0.5), 0.01, landing ? 0.32 : 0.16); this._wire(f, g, pan);
    s.start(t, Math.random() * 1.5); s.stop(t + 0.4);
  }
  // one footstep. surface: grass | gravel | wood
  step(surface, vol) {
    const ctx = this.ctx, t = ctx.currentTime + 0.005, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.white; s.playbackRate.value = rnd(0.85, 1.15);
    const pan = (this.foot ^= 1) ? -0.08 : 0.08;
    if (surface === 'wood') {
      f.type = 'bandpass'; f.frequency.value = rnd(700, 900); f.Q.value = 1.2;
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(rnd(120, 150), t); o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
      this._env(og, t, vol * 1.3, 0.004, 0.1); this._wire(o, og, pan, this.fx); o.start(t); o.stop(t + 0.14);
      s.connect(f); this._env(g, t, vol * 0.45, 0.003, 0.05);
    } else if (surface === 'gravel') {
      f.type = 'bandpass'; f.frequency.value = rnd(1500, 2100); f.Q.value = 0.8;
      s.connect(f); this._env(g, t, vol * 0.7, 0.006, 0.09);
    } else {
      f.type = 'lowpass'; f.frequency.value = rnd(900, 1300); f.Q.value = 0.5;
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.setValueAtTime(rnd(85, 100), t); o.frequency.exponentialRampToValueAtTime(50, t + 0.07);
      this._env(og, t, vol * 0.7, 0.004, 0.07); this._wire(o, og, pan, this.fx); o.start(t); o.stop(t + 0.1);
      s.connect(f); this._env(g, t, vol * 0.8, 0.008, 0.08);
    }
    this._wire(f, g, pan, this.fx);
    s.start(t, Math.random() * 1.6); s.stop(t + 0.18);
  }

  /* ---------- every frame ----------
     s: { dark 0..1, phase, water: metres to the river, fishing, muffled (inside the RV), paused,
          walk: { speed m/s, surface } or null, listener: { x, z, fx, fz }, birds: [positions] } */
  update(dt, s) {
    if (audio.muted) return;
    if (!this.ready && !this._setup()) return;
    const ctx = this.ctx, now = ctx.currentTime, T = this.timers;
    this.t += dt;
    const night = clamp((s.dark - 0.35) / 0.5, 0, 1), day = 1 - clamp(s.dark / 0.5, 0, 1);
    const morning = s.phase === 'morning' ? 1 : s.phase === 'evening' ? 0.45 : s.phase === 'night' ? 0 : 0.5;
    const near = clamp(1 - (s.water - 6) / 45, 0, 1);
    const set = (bed, v, k = 1.5) => bed.g.gain.setTargetAtTime(v, now, k);
    // beds
    set(this.wind, 0.022 + 0.012 * Math.sin(this.t * 0.13), 2);
    set(this.river, (0.05 + (s.fishing ? 0.03 : 0)) * near, 1);
    set(this.babble, (0.012 + (s.fishing ? 0.022 : 0)) * near, 1);
    if ((T.lap -= dt) < 0) { T.lap = rnd(0.15, 0.5); this.babbleF.frequency.setTargetAtTime(rnd(800, 2000), now, 0.15); }
    this.chorus.gain.setTargetAtTime(0.009 * night, now, 2);
    this.muffle.frequency.setTargetAtTime(s.muffled ? 700 : 18000, now, 0.2);
    this.bus.gain.setTargetAtTime(s.muffled ? 0.5 : 0.9, now, 0.3);
    // a direction for a sound at (x, z): -1 left .. 1 right (from where the camera looks)
    const L = s.listener, panAt = p => (!L || !p ? rnd(-0.8, 0.8) : panOf(L, p.x, p.z));
    const distVol = p => (!L || !p ? 1 : clamp(1 - Math.hypot(p.x - L.x, p.z - L.z) / 70, 0.15, 1));
    // night: crickets close by, toads, an owl
    if (night > 0.05) {
      for (const c of T.cricket) {
        if ((c.next -= dt) > 0) continue;
        if (c.left <= 0) { c.left = Math.floor(rnd(4, 14)); c.pan = rnd(-0.9, 0.9); c.f = rnd(4200, 5200); }
        this.cricket(c, 0.026 * night * rnd(0.6, 1));
        c.left--; c.next = c.left > 0 ? rnd(0.42, 0.62) : rnd(2, 7);
      }
      if ((T.toad -= dt) < 0) { T.toad = rnd(3, 9) / (1 + near); this.toad(0.05 * night * (0.6 + near * 0.6), rnd(-0.85, 0.85)); }
      if ((T.owl -= dt) < 0) { T.owl = rnd(35, 80); if (Math.random() < 0.6) this.owl(0.03 * night, rnd(-0.7, 0.7)); }
    }
    // day: birdsong, busiest in the morning
    if (day > 0.2 && (T.bird -= dt) < 0) {
      T.bird = (morning > 0.9 ? rnd(0.8, 2.6) : morning > 0.4 ? rnd(2.5, 6) : rnd(4, 9));
      const b = s.birds && s.birds.length && Math.random() < 0.75 ? s.birds[Math.floor(Math.random() * s.birds.length)] : null;
      this.bird(0.036 * day * (b ? distVol(b) : rnd(0.35, 0.7)), panAt(b));
    }
    // fishing: little bubbles now and then, very quiet
    if (s.fishing && (T.bubble -= dt) < 0) { T.bubble = rnd(1.4, 4.2); this.bubble(0.016, rnd(-0.3, 0.3)); }
    // footsteps
    const w = s.walk;
    if (w && w.speed > 0.6) {
      const iv = clamp(0.72 - w.speed * 0.075, 0.3, 0.6);
      this.stepT += dt;
      if (this.stepT >= iv) { this.stepT = 0; this.step(w.surface, (w.speed > 4 ? 0.055 : 0.038) * rnd(0.85, 1.1)); }
    } else this.stepT = 0.3;
  }
  // a fish jumped at (x, z) (from the fishing area)
  onFishJump(x, z, landing, listener, fishing) {
    if (!this.ready || audio.muted) return;
    const d = listener ? Math.hypot(x - listener.x, z - listener.z) : 30;
    const v = clamp(1 - d / 40, 0, 1) * (fishing ? 0.07 : 0.05);
    this.fishJump(v, listener ? panOf(listener, x, z) : 0, landing);
  }
}
