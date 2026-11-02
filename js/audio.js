// Tiny synthesized sounds (no audio files). Starts on first user gesture.
let ctx = null, master = null, eng = null, hornNodes = null;

export const audio = {
  muted: false,
  context() { return ctx; },
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.45; master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  },
  toggleMute() {
    this.muted = !this.muted;
    if (master) master.gain.setTargetAtTime(this.muted ? 0 : 0.45, ctx.currentTime, 0.05);
    return this.muted;
  },
  engineStart() {
    if (!ctx || eng) return;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = 38; o2.frequency.value = 19;
    f.type = 'lowpass'; f.frequency.value = 320; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    g.gain.setTargetAtTime(0.11, ctx.currentTime, 0.2);
    eng = { o1, o2, f, g };
    this.thud(70, 0.25);
  },
  engineStop() {
    if (!eng) return;
    const e = eng; eng = null;
    e.g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => { try { e.o1.stop(); e.o2.stop(); } catch (_) {} }, 800);
  },
  engineSet(rpm01, load) {
    if (!eng) return;
    const t = ctx.currentTime, f = 36 + rpm01 * 85;
    eng.o1.frequency.setTargetAtTime(f, t, 0.08);
    eng.o2.frequency.setTargetAtTime(f / 2, t, 0.08);
    eng.f.frequency.setTargetAtTime(260 + rpm01 * 500 + load * 200, t, 0.1);
    eng.g.gain.setTargetAtTime(0.08 + load * 0.06 + rpm01 * 0.04, t, 0.1);
  },
  horn(on) {
    if (!ctx) return;
    if (on && !hornNodes) {
      const g = ctx.createGain(); g.gain.value = 0.12; g.connect(master);
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = b.type = 'square'; a.frequency.value = 392; b.frequency.value = 494;
      a.connect(g); b.connect(g); a.start(); b.start();
      hornNodes = { a, b, g };
    } else if (!on && hornNodes) {
      const h = hornNodes; hornNodes = null;
      h.g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => { try { h.a.stop(); h.b.stop(); } catch (_) {} }, 150);
    }
  },
  thud(freq = 110, dur = 0.12) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'triangle'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  },
  click() { this.thud(900, 0.04); },
  // shotgun: noise blast + low boom, then the pump (vol 0..1 for far-away shots)
  shot(vol = 1) {
    if (!ctx || vol <= 0.02) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise(); f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.28);
    g.gain.setValueAtTime(0.85 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + 0.4);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    og.gain.setValueAtTime(0.6 * vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.32);
    for (const [dt, fr] of [[0.42, 1400], [0.56, 900]]) {           // pump: chk-chk
      const c = ctx.createOscillator(), cg = ctx.createGain();
      c.type = 'square'; c.frequency.setValueAtTime(fr, t + dt);
      cg.gain.setValueAtTime(0.0001, t); cg.gain.setValueAtTime(0.09 * vol, t + dt); cg.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.04);
      c.connect(cg); cg.connect(master); c.start(t + dt); c.stop(t + dt + 0.05);
    }
  },
  // zombie groan: wobbly low sawtooth through a lowpass
  groan(vol = 0.6) {
    if (!ctx || vol <= 0.02) return;
    const t = ctx.currentTime, d = 0.7 + Math.random() * 0.6, o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    const base = 70 + Math.random() * 45;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 0.75, t + d);
    lfo.frequency.value = 5 + Math.random() * 4; lg.gain.value = 9; lfo.connect(lg); lg.connect(o.frequency);
    f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.12); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
  },
  hurt() { this.thud(170, 0.16); this.thud(95, 0.22); },
  // cannon: deep boom + rumble
  boom(vol = 1) {
    if (!ctx || vol <= 0.02) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    g.gain.setValueAtTime(0.9 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + 0.4);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    og.gain.setValueAtTime(0.8 * vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.72);
  },
  // Named looping tones (drone buzz, chainsaw)
  hum(name, on, type = 'sawtooth', freq = 200, gain = 0.04) {
    if (!ctx) return;
    const h = hums[name];
    if (on && !h) {
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 1400; g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(master); o.start();
      g.gain.setTargetAtTime(gain, ctx.currentTime, 0.08);
      hums[name] = { o, g };
    } else if (!on && h) {
      delete hums[name];
      h.g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => { try { h.o.stop(); } catch (_) {} }, 500);
    }
  },
  humSet(name, freq, gain) {
    const h = hums[name];
    if (!h) return;
    h.o.frequency.setTargetAtTime(freq, ctx.currentTime, 0.06);
    if (gain !== undefined) h.g.gain.setTargetAtTime(gain, ctx.currentTime, 0.06);
  },
};
const hums = {};
let noiseBuf = null;
function noise() {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  return noiseBuf;
}
