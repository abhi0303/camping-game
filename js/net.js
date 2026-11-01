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

export class Net {
  constructor() {
    this.mode = 'solo';          // solo | host | guest
    this.peer = null; this.id = 'local'; this.code = '';
    this.conns = []; this.hostConn = null; this.handlers = {};
    // hidden tabs can lose the broker connection; reconnect when the player comes back
    document.addEventListener('visibilitychange', () => {
      const p = this.peer;
      if (!document.hidden && p && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch (e) { /* ignore */ } }
    });
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
      peer.on('connection', c => c.on('open', () => { this.conns.push(c); this._wire(c); this._emit('join', null, c.peer); }));
      peer.on('error', e => { if (!opened) reject(e); else this._emit('error', e); });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) { reject(new Error('Multiplayer library could not load (check your internet).')); return; }
      const peer = this.peer = new window.Peer(peerOptions());
      const fail = e => { clearTimeout(t); reject(e); };
      const t = setTimeout(() => fail(new Error('Could not reach that room. Check the code and that the host is online.')), 20000);
      peer.on('open', id => {
        this.id = id;
        const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        c.on('open', () => { clearTimeout(t); this.mode = 'guest'; this.code = code; this.hostConn = c; this._wire(c); resolve(); });
        c.on('error', fail);
      });
      peer.on('error', e => { if (this.mode !== 'guest') fail(e.type === 'peer-unavailable' ? new Error('No room with that code.') : e); else this._emit('error', e); });
    });
  }

  _wire(c) {
    c.on('data', msg => {
      if (!msg || !msg.t) return;
      if (this.isHost && !msg.h) for (const o of this.conns) if (o !== c && o.open) o.send(msg);   // relay
      this._emit(msg.t, msg.d, msg.f || c.peer);
    });
    c.on('close', () => {
      this.conns = this.conns.filter(x => x !== c);
      if (this.isHost) this._emit('leave', null, c.peer);
      else { this.mode = 'solo'; this._emit('lost'); }
    });
  }

  // host: to every guest · guest: to the host (relayed to the others unless hostOnly)
  send(type, data, hostOnly = false) {
    const msg = { t: type, d: data, f: this.id, h: hostOnly ? 1 : 0 };
    if (this.isHost) { for (const c of this.conns) if (c.open) c.send(msg); }
    else if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  }
  sendTo(peerId, type, data) {
    const c = this.conns.find(x => x.peer === peerId);
    if (c && c.open) c.send({ t: type, d: data, f: this.id, h: 1 });
  }
  get peerCount() { return this.isHost ? this.conns.length + 1 : 0; }
}
