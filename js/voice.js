import { audio } from './audio.js';

// Voice chat for co-op: every player has a direct audio link to every other player
// (4 players = 6 small links, no server). You always hear your team; your mic stays off
// until you turn it on (B, or the 🎤 button). While it's off the links carry silence.
export class Voice {
  constructor({ net, session, remotes, toast, onChange }) {
    this.net = net; this.session = session; this.remotes = remotes; this.toast = toast; this.onChange = onChange || (() => {});
    this.peers = new Map();          // peer id -> { call, el, an, buf, until, talking, at }
    this.micOn = false; this.mic = null; this.silent = null; this.busy = false;
    this.me = null; this.meTalking = false;
    net.on('call', call => this._incoming(call));
    setInterval(() => this.sync(), 2000);
    setInterval(() => this._levels(), 120);
    // browsers only start playing audio after a tap / key press
    const unlock = () => { for (const p of this.peers.values()) if (p.el && p.el.paused && p.el.srcObject) p.el.play().catch(() => {}); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  }
  get supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection); }
  get count() { let n = 0; for (const p of this.peers.values()) if (p.el) n++; return n; }

  // what we send: the mic when it's on, otherwise a silent track (so links exist before anyone talks)
  _track() {
    if (this.micOn && this.mic) return this.mic.getAudioTracks()[0];
    if (!this.silent) {
      audio.init();
      const ctx = audio.context();
      if (!ctx || !ctx.createMediaStreamDestination) return null;
      this.silent = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
    }
    return this.silent;
  }

  toggle() { return this.setMic(!this.micOn); }
  async setMic(on) {
    if (this.busy || on === this.micOn) return;
    if (on && !this.supported) { this.toast('🎤 Voice chat needs a secure (https) page and a browser with microphone support'); return; }
    if (on && !this.net.online) { this.toast('🎤 Voice chat works in co-op — host or join a room first'); return; }
    this.busy = true;
    try {
      if (on) {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        audio.init();                              // phones can pause web audio when the mic starts
        this.micOn = true;
        const ctx = audio.context();
        if (ctx) { try { const src = ctx.createMediaStreamSource(this.mic), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); this.me = { an, buf: new Float32Array(512), until: 0 }; } catch (e) { this.me = null; } }
      } else {
        this.micOn = false;
        if (this.mic) this.mic.getTracks().forEach(t => t.stop());
        this.mic = null; this.me = null; this.meTalking = false;
      }
      this._applyTrack();
      this.toast(on ? '🎙 Mic on — your team hears you (B to mute)' : '🔇 Mic off');
    } catch (e) {
      this.micOn = false; this.mic = null;
      this.toast(e && e.name === 'NotAllowedError'
        ? '🎤 Microphone blocked — allow it for this site (lock icon next to the address), then press B again'
        : '🎤 Could not start the microphone: ' + ((e && e.message) || e));
    }
    this.busy = false;
    this.onChange();
  }
  _applyTrack() {
    const t = this._track();
    if (!t) return;
    for (const p of this.peers.values()) {
      const pc = p.call && p.call.peerConnection;
      if (pc) for (const s of pc.getSenders()) if (!s.track || s.track.kind === 'audio') s.replaceTrack(t).catch(() => {});
    }
  }

  // keep one link to every player in the room
  sync() {
    const net = this.net;
    if (!net.connected || !net.peer || net.peer.destroyed) { if (this.peers.size) this.closeAll(); return; }
    const me = net.id, ids = new Set([...this.session.players.keys()].filter(id => id !== me));
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this._close(id);
    const now = performance.now();
    for (const id of ids) {
      const p = this.peers.get(id);
      if (p && (p.el || now - p.at < 9000)) continue;   // connected, or still ringing
      if (me < id) this._call(id);                       // the "smaller" id rings, so each pair has exactly one link
      else if (p && now - p.at > 9000) this._close(id, true);
    }
  }
  _call(id) {
    const t = this._track();
    if (!t) return;
    let call = null;
    try { call = this.net.peer.call(id, new MediaStream([t]), { metadata: { voice: 1 } }); } catch (e) { /* peer gone */ }
    if (call) this._wire(id, call);
  }
  _incoming(call) {
    const t = this._track();
    if (!t || !this.net.online) { try { call.close(); } catch (e) { /* ignore */ } return; }
    call.answer(new MediaStream([t]));
    this._wire(call.peer, call);
  }
  _wire(id, call) {
    const old = this.peers.get(id);
    if (old && old.call !== call) this._close(id, true);
    const p = { call, el: null, an: null, buf: null, until: 0, talking: false, at: performance.now() };
    this.peers.set(id, p);
    call.on('stream', st => this._play(p, st));
    const gone = () => { if (this.peers.get(id) === p) this._close(id); };
    call.on('close', gone); call.on('error', gone);
  }
  _play(p, st) {
    if (!p.el) {
      p.el = document.createElement('audio');
      p.el.autoplay = true; p.el.playsInline = true; p.el.setAttribute('playsinline', '');
      document.body.appendChild(p.el);
      this.onChange();
    }
    if (p.el.srcObject !== st) { p.el.srcObject = st; p.el.play().catch(() => {}); }
    const ctx = audio.context();
    if (ctx && !p.an) { try { const src = ctx.createMediaStreamSource(st); p.an = ctx.createAnalyser(); p.an.fftSize = 512; src.connect(p.an); p.buf = new Float32Array(512); } catch (e) { /* no meter */ } }
  }
  _close(id, quiet = false) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    try { p.call.close(); } catch (e) { /* ignore */ }
    if (p.el) { p.el.srcObject = null; p.el.remove(); }
    const r = this.remotes.map.get(id); if (r) r.talking = false;
    if (!quiet) this.onChange();
  }
  closeAll() { for (const id of [...this.peers.keys()]) this._close(id, true); this.onChange(); }

  // who is talking right now (for the 🔊 icons)
  _loud(m) {
    if (!m || !m.an) return false;
    m.an.getFloatTimeDomainData(m.buf);
    let s = 0; for (let i = 0; i < m.buf.length; i++) s += m.buf[i] * m.buf[i];
    const now = performance.now();
    if (Math.sqrt(s / m.buf.length) > 0.018) m.until = now + 350;
    return now < m.until;
  }
  _levels() {
    let changed = false;
    for (const [id, p] of this.peers) {
      const t = this._loud(p);
      if (t !== p.talking) { p.talking = t; changed = true; }
      const r = this.remotes.map.get(id); if (r) r.talking = t;
    }
    const mt = this.micOn && this._loud(this.me);
    if (mt !== this.meTalking) { this.meTalking = mt; changed = true; }
    if (changed) this.onChange();
  }
}
