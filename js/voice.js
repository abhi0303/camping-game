import { audio } from './audio.js';

const RING_MS = 9000;     // a call that brought no sound after this long is dropped and tried again
const DEAD_MS = 7000;     // a link whose network path is down this long (or that brings no sound while the
                          // other player's mic is on) is restarted
const ASK_MS = 6000;      // the player who doesn't ring asks the other one to ring after this long without a link

// Voice chat for co-op: every player has a direct audio link to every other player
// (4 players = 6 small links, no server). You always hear your team; your mic stays off
// until you turn it on (B, or the 🎤 button). While it's off the links carry silence.
// In each pair only the player with the "smaller" id rings. The other one can't, so when it has no
// working link it asks over the game connection ('vcall'): before, it waited forever and that
// player never heard the other one again.
export class Voice {
  constructor({ net, session, remotes, toast, onChange }) {
    this.net = net; this.session = session; this.remotes = remotes; this.toast = toast; this.onChange = onChange || (() => {});
    this.peers = new Map();          // peer id -> { call, el, an, buf, until, talking, at, badAt, pkts, pktAt, micAt }
    this.wait = new Map();           // peer id -> since when we have no link and wait for their call
    this.micOn = false; this.mic = null; this.silent = null; this.busy = false;
    this.me = null; this.meTalking = false;
    this.mute = new Map();           // peer id -> last time a link was restarted for bringing no sound (max every 20 s)
    net.on('call', call => this._incoming(call));
    net.on('vcall', (d, from) => this._asked(d, from));
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

  // keep one working link to every player in the room
  sync() {
    const net = this.net;
    if (!net.connected || !net.peer || net.peer.destroyed) { if (this.peers.size) this.closeAll(); this.wait.clear(); return; }
    const me = net.id, ids = new Set([...this.session.players.keys()].filter(id => id !== me));
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this._close(id);
    for (const id of [...this.wait.keys()]) if (!ids.has(id)) this.wait.delete(id);
    const now = performance.now();
    for (const id of ids) {
      let p = this.peers.get(id), broke = false;
      if (p && this._dead(p, id, now)) { this._close(id); p = null; broke = true; }
      if (p && (p.el || now - p.at < RING_MS)) { this.wait.delete(id); continue; }   // connected, or still ringing
      if (p) { this._close(id, true); p = null; broke = true; }   // rang too long without sound
      if (me < id) { this._call(id); continue; }          // the "smaller" id rings, so each pair has exactly one link
      const since = this.wait.get(id);                    // the other player rings: ask them if their call doesn't come
      if (broke || (since !== undefined && now - since > ASK_MS)) { this.wait.set(id, now); this._ask(id); }
      else if (since === undefined) this.wait.set(id, now);
    }
    this._stats();
  }
  // the 🔄 button: drop every voice link and make new ones right away
  restart() {
    this.closeAll(); this.wait.clear();
    const net = this.net;
    if (!net.connected || !net.peer || net.peer.destroyed) return;
    const me = net.id, now = performance.now();
    for (const id of this.session.players.keys()) {
      if (id === me) continue;
      if (me < id) this._call(id);
      else { this._ask(id); this.wait.set(id, now); }
    }
  }
  // is this link broken even though it never reported closing?
  _dead(p, id, now) {
    const pc = p.call && p.call.peerConnection, st = pc ? pc.iceConnectionState : 'closed';
    if (st === 'failed' || st === 'closed') return true;
    if (st === 'disconnected') { if (!p.badAt) p.badAt = now; if (now - p.badAt > DEAD_MS) return true; }
    else p.badAt = 0;
    // their mic is on, but no sound has arrived for a while: the link only works one way
    const r = this.remotes.map.get(id), mic = !!(r && r.s && r.s.mc && !r.away);
    if (!mic) { p.micAt = 0; return false; }
    if (!p.micAt) p.micAt = now;
    if (!p.el || now - p.micAt < DEAD_MS || now - (p.pktAt || p.at) < DEAD_MS) return false;
    if (now - (this.mute.get(id) || -1e9) < 20000) return false;   // their mic may just send nothing: don't restart over and over
    this.mute.set(id, now);
    return true;
  }
  // count the sound packets that arrive on each link (what _dead looks at)
  _stats() {
    for (const p of this.peers.values()) {
      const pc = p.call && p.call.peerConnection;
      if (!pc || !p.el || p.statsBusy || !pc.getStats) continue;
      p.statsBusy = true;
      pc.getStats().then(rep => {
        let n = 0;
        rep.forEach(s => { if (s.type === 'inbound-rtp' && (s.kind || s.mediaType) === 'audio') n += s.packetsReceived || 0; });
        if (n !== p.pkts) { p.pkts = n; p.pktAt = performance.now(); }
      }).catch(() => {}).then(() => { p.statsBusy = false; });
    }
  }
  // we can't ring this player (they ring us): ask them to, over the game connection
  _ask(id) { if (this.net.connected) this.net.send('vcall', { to: id }); }
  _asked(d, from) {
    if (!d || d.to !== this.net.id || !from || from === this.net.id) return;
    if (!this.net.connected || !this.net.peer || this.net.peer.destroyed || !this.session.players.has(from)) return;
    const p = this.peers.get(from);
    if (p && performance.now() - p.at < 4000) return;     // a fresh call to them is already on its way
    this._close(from, true);
    this._call(from);
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
    const p = { call, el: null, an: null, buf: null, until: 0, talking: false, at: performance.now(), badAt: 0, pkts: 0, pktAt: 0, micAt: 0 };
    this.peers.set(id, p);
    this.wait.delete(id);
    call.on('stream', st => this._play(p, st));
    // the link closed: the player who rings does so at the next check; the other one asks for a call about a second later
    const gone = () => { if (this.peers.get(id) === p) { this._close(id); this.wait.set(id, performance.now() - ASK_MS + 1000); } };
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
