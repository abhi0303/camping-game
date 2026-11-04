// Tiny synthesized sounds (no audio files). Starts on first user gesture.
let ctx = null, master = null, eng = null, hornNodes = null;

export const audio = {
  muted: false,
  context() { return ctx; },
  out() { return master; },
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
  // the RV: a big diesel van engine. A low firing pulse (rich in low harmonics, low-passed) over the
  // crankshaft's sub rumble, a "chug" of noise pulsed at the firing rate, a little diesel clatter under load,
  // all through a soft saturator. The starter motor cranks first.
  engineStart() {
    if (!ctx || eng) return;
    const t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(master);
    const sat = ctx.createWaveShaper(); sat.curve = softClip(); sat.oversample = '2x';
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 220; tone.Q.value = 0.7;
    sat.connect(tone); tone.connect(out);
    // firing pulse: harmonics 1..10 falling off
    const real = new Float32Array(11), imag = new Float32Array(11);
    [0, 1, 0.75, 0.55, 0.42, 0.3, 0.22, 0.16, 0.11, 0.08, 0.05].forEach((v, i) => { imag[i] = v; });
    const fire = ctx.createOscillator(); fire.setPeriodicWave(ctx.createPeriodicWave(real, imag)); fire.frequency.value = 34;
    const fireG = ctx.createGain(); fireG.gain.value = 0.55; fire.connect(fireG); fireG.connect(sat);
    // crankshaft: half the firing rate, pure and deep
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 17;
    const subG = ctx.createGain(); subG.gain.value = 0.7; sub.connect(subG); subG.connect(sat);
    // chug: brown noise, amplitude pulsed at the firing rate
    const nb = ctx.createBufferSource(); nb.buffer = brownNoise(); nb.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 420;
    const am = ctx.createGain(); am.gain.value = 0.25;
    const amO = ctx.createOscillator(); amO.frequency.value = 34; const amD = ctx.createGain(); amD.gain.value = 0.22;
    amO.connect(amD); amD.connect(am.gain);
    nb.connect(nf); nf.connect(am); am.connect(sat);
    // diesel clatter: a faint tick of bright noise at the firing rate (more under load), not saturated
    const cb = ctx.createBufferSource(); cb.buffer = whiteNoise(); cb.loop = true;
    const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 1900; cf.Q.value = 1.6;
    const cam = ctx.createGain(); cam.gain.value = 0; const camD = ctx.createGain(); camD.gain.value = 0.006;
    amO.connect(camD); camD.connect(cam.gain);
    cb.connect(cf); cf.connect(cam); cam.connect(out);
    for (const n of [fire, sub, nb, amO, cb]) n.start(t + 0.55);
    // starter motor: three quick whirrs, then the engine catches with a small rev
    const st = ctx.createOscillator(), stG = ctx.createGain(), stF = ctx.createBiquadFilter();
    st.type = 'sawtooth'; st.frequency.setValueAtTime(11, t); st.frequency.linearRampToValueAtTime(15, t + 0.55);
    stF.type = 'lowpass'; stF.frequency.value = 380; stG.gain.setValueAtTime(0.0001, t); stG.gain.exponentialRampToValueAtTime(0.12, t + 0.06);
    stG.gain.setValueAtTime(0.12, t + 0.5); stG.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    st.connect(stF); stF.connect(stG); stG.connect(master); st.start(t); st.stop(t + 0.65);
    fire.frequency.setValueAtTime(30, t + 0.55); fire.frequency.linearRampToValueAtTime(48, t + 0.8); fire.frequency.setTargetAtTime(34, t + 0.8, 0.25);
    sub.frequency.setValueAtTime(15, t + 0.55); sub.frequency.linearRampToValueAtTime(24, t + 0.8); sub.frequency.setTargetAtTime(17, t + 0.8, 0.25);
    amO.frequency.setValueAtTime(30, t + 0.55); amO.frequency.linearRampToValueAtTime(48, t + 0.8); amO.frequency.setTargetAtTime(34, t + 0.8, 0.25);
    out.gain.setValueAtTime(0, t + 0.5); out.gain.linearRampToValueAtTime(0.16, t + 0.7); out.gain.setTargetAtTime(0.1, t + 0.8, 0.3);
    eng = { out, tone, fire, sub, amO, cam, camD, nodes: [fire, sub, nb, amO, cb] };
  },
  engineStop() {
    if (!eng) return;
    const e = eng, t = ctx.currentTime; eng = null;
    // the engine winds down
    e.fire.frequency.setTargetAtTime(18, t, 0.25); e.sub.frequency.setTargetAtTime(9, t, 0.25); e.amO.frequency.setTargetAtTime(18, t, 0.25);
    e.out.gain.setTargetAtTime(0, t + 0.1, 0.18);
    setTimeout(() => { for (const n of e.nodes) try { n.stop(); } catch (_) { /* already stopped */ } }, 1400);
  },
  // rpm01: 0 idle .. 1 top speed · load: 0 coasting .. 1 full throttle
  engineSet(rpm01, load) {
    if (!eng) return;
    const t = ctx.currentTime, f = 34 + rpm01 * 62 + load * 6;
    eng.fire.frequency.setTargetAtTime(f, t, 0.12);
    eng.sub.frequency.setTargetAtTime(f / 2, t, 0.12);
    eng.amO.frequency.setTargetAtTime(f, t, 0.12);
    eng.tone.frequency.setTargetAtTime(200 + rpm01 * 380 + load * 220, t, 0.15);
    eng.camD.gain.setTargetAtTime(0.004 + load * 0.012, t, 0.15);
    eng.out.gain.setTargetAtTime(0.085 + load * 0.045 + rpm01 * 0.03, t, 0.15);
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
  // water: a short hiss of filtered noise (a cast landing, a fish biting or jumping)
  splash(vol = 1) {
    if (!ctx || vol <= 0.02) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + 0.4);
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
// iPhones pause web audio when the app goes to the background or a call comes in: wake it up again
const wakeAudio = () => { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); };
addEventListener('touchend', wakeAudio, { passive: true });
addEventListener('pointerdown', wakeAudio);
document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeAudio(); });
let noiseBuf = null, brownBuf = null;
function brownNoise() {
  if (brownBuf) return brownBuf;
  brownBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const d = brownBuf.getChannelData(0); let v = 0;
  for (let i = 0; i < d.length; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = v * 3.5; }
  return brownBuf;
}
let whiteBuf = null;
function whiteNoise() {
  if (whiteBuf) return whiteBuf;
  whiteBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const d = whiteBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return whiteBuf;
}
let clipCurve = null;
function softClip() {
  if (clipCurve) return clipCurve;
  clipCurve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; clipCurve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
  return clipCurve;
}
function noise() {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  return noiseBuf;
}
