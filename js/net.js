// Peer-to-peer multiplayer (works on static hosting like GitHub Pages).
// PeerJS's free public broker only introduces players; game data flows browser-to-browser over WebRTC.
// Star layout: the host relays every guest message to the other guests.
const PREFIX = 'rv-jungle-trail-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// PeerJS defaults (Google STUN + PeerJS TURN relay) plus a few more STUN servers for tricky networks
function peerOptions() {
  const base = (window.peerjs && window.peerjs.util && window.peerjs.util.defaultConfig && window.peerjs.util.defaultConfig.iceServers) || [];
  return { debug: 0, config: { iceServers: [...base, { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] }, { urls: 'stun:global.stun.twilio.com:3478' }] } };
}
// "abcd e", "abcde", or a whole invite link -> "ABCDE"
export function cleanRoomCode(v) {
  const m = /room=([A-Za-z0-9]+)/.exec(v || '');
  return (m ? m[1] : (v || '')).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function makeRoomCode() { let s = ''; for (let i = 0; i < 5; i++) s += ALPHA[(Math.random() * ALPHA.length) | 0]; return s; }

// One id per browser tab. It survives a refresh (so the host can swap out a stale copy of you after
// a reload), but a tab that was copied from another one (duplicate tab, link opened in a new tab)
// gets its own id, so two tabs never knock each other out of the room.
function tabId() {
  let id = null, keep = false;
  try { const nav = performance.getEntriesByType('navigation')[0]; keep = !!nav && nav.type === 'reload'; } catch (e) { /* old browser */ }
  try {
    if (sessionStorage.getItem('rv-tab-keep')) { keep = true; sessionStorage.removeItem('rv-tab-keep'); }
    if (keep) id = sessionStorage.getItem('rv-tab-id');
  } catch (e) { /* storage blocked */ }
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try { sessionStorage.setItem('rv-tab-id', id); } catch (e) { /* ignore */ }
  }
  return id;
}

const GUEST_SILENT_MS = 20000;   // host drops a guest it hasn't heard from for this long
const HOST_SILENT_MS = 15000;    // guest reconnects when the host went quiet this long
const STUCK_MS = 10000;          // a link whose network path is down (or that can't send anything) this long is dead
const BUSY_BYTES = 64 * 1024;    // a link with this much data waiting to go out is congested
const BROKER_RETRY_MS = 4000;    // how often to retry the PeerJS server when we lost it
const PART = 7000;               // PeerJS refuses JSON messages over ~16 KB: bigger ones go in parts
// Snapshots that the next one replaces a moment later. On a congested link they are skipped instead
// of queued: PeerJS queues up to 8 MB per link, so on a slow link queued snapshots made everything
// arrive later and later (one player stopped seeing the others while the other side looked fine).
const VOLATILE = new Set(['p', 'pp', 'rv', 'zs', 'gs', 'bridgeSnap', 'surv', 'world']);
// bytes waiting to go out on a link (WebRTC's queue + PeerJS's own queue)
const backlog = c => ((c.dataChannel && c.dataChannel.bufferedAmount) || 0) + (c.bufferSize || 0) * 4096;
const iceState = c => (c.peerConnection && c.peerConnection.iceConnectionState) || '';

export class Net {
  constructor() {
    this.mode = 'solo';          // solo | host | guest | rejoin (guest trying to get back in)
    this.peer = null; this.id = 'local'; this.code = '';
    this.conns = []; this.hostConn = null; this.handlers = {};
    this.cid = tabId(); this.hostSeen = 0; this.partSeq = 0; this.parts = new Map(); this.brokerTry = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const p = this.peer;
      // hidden tabs can lose the broker connection; reconnect when the player comes back
      if (p && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch (e) { /* ignore */ } }
      // phone came back from another app and the host has been quiet: reconnect now, don't wait
      if (this.mode === 'guest' && performance.now() - this.hostSeen > 5000) this._lost('timeout');
    });
    // closing or refreshing the tab = leaving the room right away (no ghost player left behind)
    const bye = () => this.leave();
    addEventListener('pagehide', bye);
    addEventListener('beforeunload', bye);
    setInterval(() => this._watch(), 1000);
  }
  get online() { return this.mode !== 'solo'; }
  get isHost() { return this.mode === 'host'; }
  get isGuest() { return this.mode === 'guest' || this.mode === 'rejoin'; }
  get connected() { return this.isHost || (this.mode === 'guest' && !!this.hostConn && this.hostConn.open); }
  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, data, from) { const h = this.handlers[type]; if (h) { try { h(data, from); } catch (e) { console.error(e); } } }

  // peerId: Farm World hosts use the id the server gave them (a new one for every host)
  host(code, peerId = PREFIX + code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) { reject(new Error('Multiplayer library could not load (check your internet).')); return; }
      const peer = this.peer = new window.Peer(peerId, peerOptions());
      let opened = false;
      peer.on('open', id => { opened = true; this.mode = 'host'; this.id = id; this.code = code; resolve(code); });
      peer.on('connection', c => {
        c.on('open', () => { c._seen = performance.now(); this.conns.push(c); this._wire(c); });
        c.on('error', e => console.warn('guest link:', e && (e.type || e.message)));   // only 'close' or silence ends a link
      });
      peer.on('call', call => this._emit('call', call));
      peer.on('error', e => {
        if (opened) { this._emit('error', e); return; }
        try { peer.destroy(); } catch (_) { /* ignore */ }
        if (this.peer === peer) this.peer = null;
        reject(e);
      });
      peer.on('disconnected', () => this._brokerLost());
    });
  }

  join(code, timeout = 20000, peerId = PREFIX + code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) { reject(new Error('Multiplayer library could not load (check your internet).')); return; }
      const peer = this.peer = new window.Peer(peerOptions());
      let done = false;
      const fail = e => { if (done) return; done = true; clearTimeout(t); try { peer.destroy(); } catch (_) { /* ignore */ } if (this.peer === peer) this.peer = null; reject(e); };
      const t = setTimeout(() => fail(new Error('Could not reach that room. Check the code and that the host is online.')), timeout);
      peer.on('open', id => {
        this.id = id;
        const c = peer.connect(peerId, { reliable: true, serialization: 'json' });
        c.on('open', () => { if (done) return; done = true; clearTimeout(t); this.mode = 'guest'; this.code = code; this.hostConn = c; this.hostSeen = performance.now(); this._wire(c); resolve(); });
        c.on('error', e => { if (!done) fail(e); else console.warn('host link:', e && (e.type || e.message)); });
      });
      peer.on('call', call => this._emit('call', call));
      peer.on('error', e => {
        // peer-unavailable: nobody is registered under that id on the PeerJS server (the host is gone)
        if (!done) { const gone = e && e.type === 'peer-unavailable'; const err = gone ? new Error('No room with that code (the host may have left).') : e; if (gone) { err.fatal = true; err.unavailable = true; } fail(err); }
        else this._emit('error', e);
      });
      peer.on('disconnected', () => { if (this.peer === peer) this._brokerLost(); });
    });
  }

  _wire(c) {
    c.on('data', raw => {
      if (!raw || !raw.t) return;
      let msg = raw;
      if (this.isHost) {
        if (c._gone) return;
        c._seen = performance.now();
        if (raw.t === 'bye') { this._drop(c); return; }
        if (raw.t === 'rc') { this._drop(c, false, 'reconnect'); return; }   // they pressed Reconnect: a fresh link comes next
        if (!c._ok && raw.t !== 'hello') return;               // not let in yet (or refused)
        if (!raw.h) {                                          // relay to the other guests
          const vol = VOLATILE.has(raw.t);
          for (const o of this.conns) if (o !== c && o.open && o._ok && !o._gone && !(vol && backlog(o) > BUSY_BYTES)) o.send(raw);
        }
        if (raw.t === '_p' && !(msg = this._unpart(raw, c.peer))) return;
        this._emit(msg.t, msg.d, c.peer);
      } else {
        if (c !== this.hostConn) return;
        this.hostSeen = performance.now();
        if (raw.t === 'bye') { this._lost('bye'); return; }
        if (raw.t === '_p' && !(msg = this._unpart(raw, raw.f || 'h'))) return;
        this._emit(msg.t, msg.d, msg.f || c.peer);
      }
    });
    c.on('close', () => { if (this.isHost) this._drop(c); else if (c === this.hostConn) this._lost('closed'); });
  }
  // big message -> several parts (and back)
  _pack(msg) {
    const s = JSON.stringify(msg);
    if (s.length <= 12000) return [msg];
    const id = ++this.partSeq, n = Math.ceil(s.length / PART), out = [];
    for (let i = 0; i < n; i++) out.push({ t: '_p', d: { id, i, n, s: s.slice(i * PART, (i + 1) * PART) }, f: msg.f, h: msg.h });
    return out;
  }
  _unpart(m, from) {
    const d = m.d, key = from + ':' + d.id;
    let e = this.parts.get(key);
    if (!e) { e = { n: d.n, got: 0, s: [], t: performance.now() }; this.parts.set(key, e); }
    if (e.s[d.i] === undefined) { e.s[d.i] = d.s; e.got++; }
    if (e.got < e.n) return null;
    this.parts.delete(key);
    try { return JSON.parse(e.s.join('')); } catch (err) { return null; }
  }

  // host: forget a guest connection (closed, timed out, said bye, kicked) and tell the game once
  _drop(c, silent = false, why = 'left') {
    if (c._gone) return;
    c._gone = true;
    this.conns = this.conns.filter(x => x !== c);
    try { c.close(); } catch (e) { /* ignore */ }
    if (!silent && this.isHost) this._emit('leave', why, c.peer);
  }
  connOf(peerId) { return this.conns.find(x => x.peer === peerId) || null; }
  // host: this guest was let in (only accepted guests get the room's updates)
  accept(peerId) { const c = this.connOf(peerId); if (c) c._ok = true; }
  dropPeer(peerId, silent = true, delay = 0, why = 'left') {
    const c = this.connOf(peerId);
    if (!c) return;
    if (delay) { c._gone = true; setTimeout(() => { c._gone = false; this._drop(c, silent, why); }, delay); }   // let a last message go out first
    else this._drop(c, silent, why);
  }
  // guest: the link to the host is gone ('bye' = host closed the room; otherwise the game tries to reconnect)
  _lost(reason) {
    if (this.mode !== 'guest') return;
    const c = this.hostConn, p = this.peer;
    this.hostConn = null; this.peer = null; this.mode = 'solo';
    try { if (c) c.close(); } catch (e) { /* ignore */ }
    try { if (p) p.destroy(); } catch (e) { /* ignore */ }
    this._emit('lost', reason);
  }
  // guest: the Reconnect button. Tell the host (so it frees our old copy right away), then drop the
  // link; the session joins the room again and gets a fresh copy of everything.
  reconnectNow() {
    if (this.mode !== 'guest') return false;
    try { if (this.hostConn && this.hostConn.open) this.hostConn.send({ t: 'rc', d: {}, f: this.id, h: 1 }); } catch (e) { /* ignore */ }
    setTimeout(() => this._lost('manual'), 150);
    return true;
  }
  // is this link in trouble? (nothing heard for a few seconds, network path down, or a send queue piling up)
  weak(c) {
    if (!c || !c.open) return true;
    const st = iceState(c), seen = this.isHost ? c._seen : this.hostSeen;
    return performance.now() - (seen || 0) > 4000 || st === 'disconnected' || st === 'failed' || backlog(c) > BUSY_BYTES;
  }
  get hostWeak() { return this.mode === 'guest' && this.weak(this.hostConn); }
  // leave on purpose (tab closing, kicked, join refused): say bye, then shut everything
  leave() {
    if (!this.online && !this.peer) return;
    try { this.send('bye', {}, true); } catch (e) { /* ignore */ }
    const p = this.peer, conns = [...this.conns, this.hostConn].filter(Boolean);
    this.mode = 'solo'; this.conns = []; this.hostConn = null; this.peer = null;
    // close the WebRTC links right now (timers don't run while a page unloads): the other side
    // then sees the connection end immediately instead of waiting ~30 s for a network timeout
    for (const c of conns) { try { c._gone = true; c.close(); } catch (e) { /* ignore */ } }
    try { if (p) p.destroy(); } catch (e) { /* ignore */ }
  }
  // heartbeat watchdog: silent peers are gone even if WebRTC never reports it
  _watch() {
    const now = performance.now();
    if (this.isHost) {
      for (const c of [...this.conns]) if (!c._gone && (now - (c._seen || 0) > GUEST_SILENT_MS || this._stuck(c, now))) this._drop(c, false, 'timeout');
    } else if (this.mode === 'guest' && (now - this.hostSeen > HOST_SILENT_MS || this._stuck(this.hostConn, now))) this._lost('timeout');
    // the PeerJS server link is needed to reconnect and to start voice calls: keep retrying it
    // (PeerJS tries only once, so one failed try used to leave a player unreachable for good)
    const p = this.peer;
    if (p && p.disconnected && !p.destroyed && now - this.brokerTry > BROKER_RETRY_MS) {
      this.brokerTry = now;
      try { p.reconnect(); } catch (e) { /* ignore */ }
    }
    for (const [k, e] of this.parts) if (now - e.t > 20000) this.parts.delete(k);
  }
  _brokerLost() { this.brokerTry = performance.now() - BROKER_RETRY_MS + 1000; }   // retry in about a second
  // the link's network path has been down, or its send queue full, for a long time (data still
  // trickling in or not, nothing useful gets through): treat it as lost so a fresh link is made
  _stuck(c, now) {
    if (!c) return false;
    const st = iceState(c);
    if (st === 'disconnected' || st === 'failed' || backlog(c) > BUSY_BYTES) { if (!c._badAt) c._badAt = now; }
    else c._badAt = 0;
    return !!c._badAt && now - c._badAt > STUCK_MS;
  }

  // host: to every guest · guest: to the host (relayed to the others unless hostOnly)
  send(type, data, hostOnly = false) {
    const out = this._pack({ t: type, d: data, f: this.id, h: hostOnly ? 1 : 0 }), vol = VOLATILE.has(type);
    if (this.isHost) { for (const c of this.conns) if (c.open && !c._gone && c._ok) this._out(c, out, vol); }
    else if (this.hostConn && this.hostConn.open) this._out(this.hostConn, out, vol);
  }
  // a snapshot on a congested link is skipped (the next one replaces it); everything else always goes
  _out(c, msgs, vol) {
    if (vol && backlog(c) > BUSY_BYTES) return;
    for (const m of msgs) c.send(m);
  }
  sendTo(peerId, type, data) {
    const c = this.connOf(peerId);
    if (c && c.open) for (const m of this._pack({ t: type, d: data, f: this.id, h: 1 })) c.send(m);
  }
  get peerCount() { return this.isHost ? this.conns.length + 1 : 0; }
}
