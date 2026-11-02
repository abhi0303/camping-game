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

// One id per browser tab. It survives a refresh, so the host can replace the stale copy of a player who reloads.
function tabId() {
  let id = null;
  try { id = sessionStorage.getItem('rv-tab-id'); } catch (e) { /* storage blocked */ }
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try { sessionStorage.setItem('rv-tab-id', id); } catch (e) { /* ignore */ }
  }
  return id;
}

const GUEST_SILENT_MS = 15000;   // host drops a guest it hasn't heard from for this long
const HOST_SILENT_MS = 20000;    // guest gives up on a host that went quiet

export class Net {
  constructor() {
    this.mode = 'solo';          // solo | host | guest
    this.peer = null; this.id = 'local'; this.code = '';
    this.conns = []; this.hostConn = null; this.handlers = {};
    this.cid = tabId(); this.hostSeen = 0;
    // hidden tabs can lose the broker connection; reconnect when the player comes back
    document.addEventListener('visibilitychange', () => {
      const p = this.peer;
      if (!document.hidden && p && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch (e) { /* ignore */ } }
    });
    // closing or refreshing the tab = leaving the room right away (no ghost player left behind)
    const bye = () => this.leave();
    addEventListener('pagehide', bye);
    addEventListener('beforeunload', bye);
    setInterval(() => this._watch(), 1000);
  }
  get online() { return this.mode !== 'solo'; }
  get isHost() { return this.mode === 'host'; }
  get isGuest() { return this.mode === 'guest'; }
  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, data, from) { const h = this.handlers[type]; if (h) { try { h(data, from); } catch (e) { console.error(e); } } }

  host(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) { reject(new Error('Multiplayer library could not load (check your internet).')); return; }
      const peer = this.peer = new window.Peer(PREFIX + code, peerOptions());
      let opened = false;
      peer.on('open', id => { opened = true; this.mode = 'host'; this.id = id; this.code = code; resolve(code); });
      peer.on('connection', c => {
        c.on('open', () => { c._seen = performance.now(); this.conns.push(c); this._wire(c); });
        c.on('error', () => this._drop(c));
      });
      peer.on('error', e => { if (!opened) reject(e); else this._emit('error', e); });
      peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* ignore */ } });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) { reject(new Error('Multiplayer library could not load (check your internet).')); return; }
      const peer = this.peer = new window.Peer(peerOptions());
      const fail = e => { clearTimeout(t); try { peer.destroy(); } catch (_) { /* ignore */ } if (this.peer === peer) this.peer = null; reject(e); };
      const t = setTimeout(() => fail(new Error('Could not reach that room. Check the code and that the host is online.')), 20000);
      peer.on('open', id => {
        this.id = id;
        const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        c.on('open', () => { clearTimeout(t); this.mode = 'guest'; this.code = code; this.hostConn = c; this.hostSeen = performance.now(); this._wire(c); resolve(); });
        c.on('error', fail);
      });
      peer.on('error', e => { if (this.mode !== 'guest') fail(e.type === 'peer-unavailable' ? new Error('No room with that code.') : e); else this._emit('error', e); });
    });
  }

  _wire(c) {
    c.on('data', msg => {
      if (!msg || !msg.t) return;
      if (this.isHost) {
        if (c._gone) return;
        c._seen = performance.now();
        if (msg.t === 'bye') { this._drop(c); return; }
        if (!c._ok && msg.t !== 'hello') return;               // not let in yet (or refused)
        if (!msg.h) for (const o of this.conns) if (o !== c && o.open && o._ok && !o._gone) o.send(msg);   // relay to the other guests
        this._emit(msg.t, msg.d, c.peer);
      } else {
        this.hostSeen = performance.now();
        if (msg.t === 'bye') { this._lost(); return; }
        this._emit(msg.t, msg.d, msg.f || c.peer);
      }
    });
    c.on('close', () => { if (this.isHost) this._drop(c); else if (c === this.hostConn) this._lost(); });
  }

  // host: forget a guest connection (closed, timed out, said bye, kicked) and tell the game once
  _drop(c, silent = false) {
    if (c._gone) return;
    c._gone = true;
    this.conns = this.conns.filter(x => x !== c);
    try { c.close(); } catch (e) { /* ignore */ }
    if (!silent && this.isHost) this._emit('leave', null, c.peer);
  }
  // host: this guest was let in (only accepted guests get the room's updates)
  accept(peerId) { const c = this.conns.find(x => x.peer === peerId); if (c) c._ok = true; }
  dropPeer(peerId, silent = true, delay = 0) {
    const c = this.conns.find(x => x.peer === peerId);
    if (!c) return;
    if (delay) { c._gone = true; setTimeout(() => { c._gone = false; this._drop(c, silent); }, delay); }   // let a last message go out first
    else this._drop(c, silent);
  }
  // guest: the host is gone
  _lost() {
    if (!this.isGuest) return;
    const c = this.hostConn;
    this.hostConn = null; this.mode = 'solo';
    try { if (c) c.close(); } catch (e) { /* ignore */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
    this.peer = null;
    this._emit('lost');
  }
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
    if (this.isHost) { for (const c of [...this.conns]) if (!c._gone && now - (c._seen || 0) > GUEST_SILENT_MS) this._drop(c); }
    else if (this.isGuest && now - this.hostSeen > HOST_SILENT_MS) this._lost();
  }

  // host: to every guest · guest: to the host (relayed to the others unless hostOnly)
  send(type, data, hostOnly = false) {
    const msg = { t: type, d: data, f: this.id, h: hostOnly ? 1 : 0 };
    if (this.isHost) { for (const c of this.conns) if (c.open && !c._gone && c._ok) c.send(msg); }
    else if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  }
  sendTo(peerId, type, data) {
    const c = this.conns.find(x => x.peer === peerId);
    if (c && c.open) c.send({ t: type, d: data, f: this.id, h: 1 });
  }
  get peerCount() { return this.isHost ? this.conns.length + 1 : 0; }
}
