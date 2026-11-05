// Farm World music: a gentle, cheerful country tune, synthesized like every other sound (no audio files).
// A finger-picked guitar plays "boom-chick" (bass note, strum, other bass note, strum) under a whistled
// melody; the second time round a banjo-like pluck plays it, then the guitar plays alone for a while, so it
// never gets tiring. A soft shaker keeps time in the daytime. At night it plays quieter, guitar only, so the
// crickets come through. It fades in and out, follows the Sound on / off setting, and has its own
// Music on / off button in the menu (remembered on this device).
import { audio } from './audio.js';

const BPM = 96, STEP = 60 / BPM / 2;                 // one step = an eighth note
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
// chords: [bass root, other bass note, strum voicing]
const CH = {
  G: [43, 50, [55, 59, 62, 67]], C: [48, 43, [55, 60, 64, 67]], D: [50, 45, [57, 62, 66, 69]],
  Em: [52, 47, [55, 59, 64, 67]], Am: [45, 52, [57, 60, 64, 69]],
};
const A_CHORDS = ['G', 'C', 'G', 'D', 'G', 'C', 'D', 'G'], B_CHORDS = ['C', 'G', 'Am', 'D', 'C', 'G', 'D', 'G'];
// melodies: per bar, [step in the bar (0..7), midi note, length in steps]
const A_MEL = [
  [[0, 74, 2], [2, 71, 1], [3, 74, 1], [4, 79, 3]],
  [[0, 76, 2], [2, 79, 2], [4, 76, 1], [5, 74, 1], [6, 72, 2]],
  [[0, 71, 2], [2, 74, 2], [4, 67, 4]],
  [[0, 69, 2], [2, 71, 1], [3, 72, 1], [4, 74, 2], [6, 69, 2]],
  [[0, 74, 2], [2, 71, 1], [3, 74, 1], [4, 79, 2], [6, 78, 1], [7, 76, 1]],
  [[0, 76, 3], [3, 72, 1], [4, 76, 2], [6, 79, 2]],
  [[0, 78, 2], [2, 76, 1], [3, 74, 1], [4, 69, 2], [6, 72, 2]],
  [[0, 71, 2], [2, 69, 1], [3, 71, 1], [4, 67, 4]],
];
const B_MEL = [
  [[0, 79, 2], [2, 76, 2], [4, 72, 2], [6, 76, 2]],
  [[0, 74, 3], [3, 71, 1], [4, 67, 2], [6, 71, 2]],
  [[0, 72, 2], [2, 76, 2], [4, 81, 3]],
  [[0, 78, 2], [2, 76, 2], [4, 74, 4]],
  [[0, 76, 2], [2, 79, 1], [3, 76, 1], [4, 72, 2], [6, 74, 2]],
  [[0, 71, 2], [2, 74, 2], [4, 79, 2], [6, 74, 2]],
  [[0, 72, 1], [1, 71, 1], [2, 69, 2], [4, 66, 2], [6, 69, 2]],
  [[0, 67, 6]],
];
// the song: 4 sections of 8 bars (about 80 s), then it starts again
const SONG = [{ ch: A_CHORDS, mel: A_MEL, inst: 'whistle' }, { ch: B_CHORDS, mel: B_MEL, inst: 'whistle' },
  { ch: A_CHORDS, mel: A_MEL, inst: 'banjo' }, { ch: A_CHORDS, mel: null }];
const BARS = SONG.length * 8, LEN = BARS * 8;
const VOL = 0.38;                                  // background level: under the engine, a little over the jungle

export class Music {
  constructor() {
    this.on = true; this.want = false; this.night = false; this.ready = false; this.pos = 0; this.next = 0; this.idle = 0;
    try { this.on = localStorage.getItem('rv-music') !== 'off'; } catch (e) { /* storage unavailable */ }
  }
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('rv-music', this.on ? 'on' : 'off'); } catch (e) { /* storage unavailable */ }
    this._tick();
    return this.on;
  }
  // every frame: is a Farm World running, and how dark is it (0 day .. 1 night)
  update(active, dark) {
    this.want = !!active;
    this.night = dark > 0.6;
    if (this.want && this.on && !this.ready) this._setup();
  }
  _setup() {
    const ctx = audio.context(), out = audio.out && audio.out();
    if (!ctx || !out) return;
    this.ctx = ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0;
    // a little room: a soft echo, low-passed
    const dly = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), lp = ctx.createBiquadFilter();
    dly.delayTime.value = 0.21; fb.gain.value = 0.22; wet.gain.value = 0.22; lp.type = 'lowpass'; lp.frequency.value = 2200;
    this.bus.connect(out); this.bus.connect(dly); dly.connect(lp); lp.connect(fb); fb.connect(dly); lp.connect(wet); wet.connect(out);
    // a plucked-string tone: harmonics falling off
    const re = new Float32Array(9), im = new Float32Array(9);
    [0, 1, 0.55, 0.35, 0.22, 0.14, 0.08, 0.05, 0.03].forEach((v, i) => { im[i] = v; });
    this.pluckWave = ctx.createPeriodicWave(re, im);
    const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    this.ready = true;
    setInterval(() => this._tick(), 60);
  }
  _tick() {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime, play = this.want && this.on && !audio.muted;
    this.bus.gain.setTargetAtTime(play ? VOL * (this.night ? 0.55 : 1) : 0, now, play ? 1.2 : 0.6);
    if (!play) { this.idle += 0.06; if (this.idle > 3) this.next = 0; return; }
    if (this.idle > 3) this.pos = 0;                       // after a long silence the song starts from the top
    this.idle = 0;
    if (this.next < now - 0.2 || !this.next) this.next = now + 0.08;     // (the tab was asleep: carry on from now)
    while (this.next < now + 0.3) { this._step(this.pos, this.next); this.pos = (this.pos + 1) % LEN; this.next += STEP; }
  }
  // play everything that starts on step k (of the whole song) at time t
  _step(k, t) {
    const bar = Math.floor(k / 8), s = k % 8, sec = SONG[Math.floor(bar / 8)], ch = CH[sec.ch[bar % 8]];
    const swing = s % 2 ? STEP * 0.12 : 0, tt = t + swing;
    // guitar: boom (bass) on 1 and 3, chick (strum) on 2 and 4, a light upstroke after
    if (s === 0) this._pluck(ch[0], tt, 0.16, 1.1, 900);
    else if (s === 4) this._pluck(ch[1], tt, 0.13, 1.0, 900);
    else if (s === 2 || s === 6) this._strum(ch[2], tt, 0.05, false);
    else if ((s === 3 || s === 7) && !this.night) this._strum(ch[2].slice(1), tt, 0.028, true);
    // shaker on the off-beats (daytime)
    if (!this.night && s % 2 === 1) this._shake(tt, s === 3 || s === 7 ? 0.014 : 0.009);
    // the melody
    if (sec.mel && !this.night) for (const [st, m, len] of sec.mel[bar % 8]) if (st === s) {
      if (sec.inst === 'whistle') this._whistle(m, tt, len * STEP);
      else this._pluck(m, tt, 0.09, 0.45, 3200, true);
    }
  }
  _pluck(m, t, vol, dur, bright, banjo = false) {
    const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.setPeriodicWave(this.pluckWave); o.frequency.value = mtof(m);
    f.type = 'lowpass'; f.Q.value = banjo ? 2.5 : 0.7;
    f.frequency.setValueAtTime(bright * (banjo ? 1.4 : 2.2), t); f.frequency.exponentialRampToValueAtTime(Math.max(200, bright * 0.35), t + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
  }
  _strum(notes, t, vol, up) {
    const list = up ? notes.slice().reverse() : notes;
    list.forEach((m, i) => this._pluck(m, t + i * 0.012, vol, 0.55, 1600));
  }
  _whistle(m, t, len) {
    const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain(), f = mtof(m);
    o.type = 'sine'; o.frequency.value = f; o2.type = 'triangle'; o2.frequency.value = f * 2; g2.gain.value = 0.12;
    vib.frequency.value = 5.4; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.3, len));
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const end = t + len * 0.95;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.075, t + 0.04);
    g.gain.setValueAtTime(0.075 * 0.85, Math.max(t + 0.05, end - 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.06);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.bus);
    for (const x of [o, o2, vib]) { x.start(t); x.stop(end + 0.1); }
  }
  _shake(t, vol) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 6500;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    s.connect(f); f.connect(g); g.connect(this.bus); s.start(t); s.stop(t + 0.08);
  }
}
