import { makeRoomCode } from './net.js';
import { PLAYER_COLORS } from './remote.js';

export const MAX_PLAYERS = 4;   // a room holds 4 players; the 5th gets "room full"
export const PER_RV = 4;        // ...and all 4 travel together in one RV
const MAX_RVS = 1;
const SEND_HZ = 10;
const REJOIN_FOR = 90000;        // a dropped guest keeps trying to get back in for this long
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Co-op session glue: who's here, and keeping the shared world in sync.
// The host is the authority for shared things (road blocks, bridge, materials, crates, zombies, day/night).
// Guests send their avatar to the host; the host sends everyone ONE snapshot with all players in it,
// so every screen always shows exactly the players the host has (no missing or ghost players).
export class Session {
  constructor(g) {
    this.g = g;                       // game context (net, player, rvs, addRV, remotes, ...)
    this.net = g.net;
    this.players = new Map();         // id -> { n: name, c: slot, cid: tab id }
    this.states = new Map();          // host: id -> latest avatar state of each guest
    this.banned = new Set();          // host: tab ids kicked from this room
    this.recent = new Map();          // host: tab id -> { c: slot, t } of players who dropped (they get their slot back)
    this.pending = null;              // guest: waiting for the host to accept us
    this.myName = 'Player'; this.mySlot = 0; this.lastCode = ''; this.rejoining = false; this.rtt = 0; this.joined = false;
    this.tP = 0; this.tR = 0; this.tW = 0; this.tB = 0; this.tPing = 0; this.fullT = 0; this.dirty = true;
    this.sentP = new Map(); this.sentMe = '';     // last avatar states sent (only changes go out, plus a full refresh each second)
    this.lastTick = performance.now();
    this._wire();
    // Background tabs stop requestAnimationFrame (the game loop). Keep the connection alive and
    // keep teammates updated from a timer so you never 'vanish' from their screen.
    setInterval(() => {
      if (!this.online || performance.now() - this.lastTick < 1200) return;
      this.g.onBackground && this.g.onBackground(1);
      this._send(1, true);
    }, 1000);
  }
  get online() { return this.net.online; }
  roster() { return [...this.players.entries()].map(([id, p]) => ({ id, n: p.n, c: p.c })).sort((a, b) => a.c - b.c); }
  get isFull() { return this.players.size >= MAX_PLAYERS; }

  async host(name) {
    const code = makeRoomCode();
    await this.net.host(code);
    this.myName = name; this.mySlot = 0;
    this.players.clear(); this.states.clear(); this.banned.clear();
    this.players.set(this.net.id, { n: name, c: 0, cid: this.net.cid });
    for (const r of this.g.rvs) r.owner = this.net.id;
    this._roles();
    this.g.onRoster();
    return code;
  }
  // resolves once the host has let us in; rejects with a readable reason (room full, removed, no answer)
  async join(code, name) {
    this.myName = name; this.lastCode = code; this.joined = false;
    try { await this._joinOnce(code, 20000); }
    catch (e) { this._toSolo(); throw e; }
  }
  async _joinOnce(code, timeout) {
    await this.net.join(code, timeout);
    this._roles();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => done(new Error('The host did not answer. Try again.')), 15000);
      const done = err => {
        clearTimeout(t); this.pending = null;
        if (!err) { resolve(); return; }
        this.net.leave();
        reject(err);
      };
      this.pending = done;
      this.net.send('hello', { n: this.myName, cid: this.net.cid }, true);
    });
  }
  // the link to the host dropped (phone app switch, Wi-Fi hiccup...): get back into the same room by
  // ourselves. Meanwhile you keep your place; the others see you again within a few seconds.
  async _reconnect() {
    if (this.rejoining) return;
    const g = this.g, code = this.lastCode, t0 = performance.now();
    this.rejoining = true; this.net.mode = 'rejoin';
    g.toast('📡 Connection dropped — reconnecting to the room…');
    g.onRoster();
    let tries = 0, why = 'the host did not answer';
    while (performance.now() - t0 < REJOIN_FOR) {
      tries++;
      this.net.mode = 'rejoin';
      try {
        await this._joinOnce(code, 12000);
        this.rejoining = false;
        g.toast('✅ Reconnected — you are back in the room');
        g.onRoster();
        return;
      } catch (e) {
        why = e.message || String(e);
        if (e.fatal) break;
        await sleep(Math.min(5000, 1200 * tries));
      }
    }
    this.rejoining = false; this.net.mode = 'solo';
    this._toSolo();
    g.toast(`⚠ Could not get back into room ${code} (${why}). Playing solo — Esc → "Rejoin room" to try again`);
  }
  // pause menu button after a failed reconnect
  async rejoin() {
    if (this.net.online || !this.lastCode) return;
    this.net.mode = 'rejoin'; this.rejoining = false;
    this._roles();
    await this._reconnect();
  }
  _roles() {
    const { net } = this, g = this.g;
    g.materials.net = net; g.obstacles.net = net;
    g.bridgeWorld.role = net.isHost ? 'host' : 'guest';
    g.editor.hooks.remoteBuild = net.isGuest ? d => net.send('buildReq', { d }, true) : null;
  }
  _toSolo() {
    const g = this.g;
    for (const id of [...g.remotes.map.keys()]) g.remotes.remove(id);
    this.players.clear(); this.states.clear();
    g.materials.net = null; g.obstacles.net = null; g.bridgeWorld.role = 'solo'; g.editor.hooks.remoteBuild = null;
    for (const r of g.rvs) r.owner = null;
    g.onRoster();
  }
  rvFor(slot) { return Math.min(Math.floor(slot / PER_RV), MAX_RVS - 1); }
  _ensureRVs(n) { while (this.g.rvs.length < n) this.g.addRV(); }

  worldState() {
    const g = this.g, bw = g.bridgeWorld;
    return { obst: g.obstacles.stateArray(), crates: g.world.crates.map(c => (c.taken ? 1 : 0)), mats: g.materials.c,
      br: bw.design ? { d: bw.design, st: bw.state, sp: bw.spent } : null, rvn: g.rvs.length, obj: g.getObj() };
  }
  applyWorld(d) {
    const g = this.g, bw = g.bridgeWorld;
    this._ensureRVs(d.rvn);
    g.obstacles.applyStateArray(d.obst, true);
    d.crates.forEach((t, i) => { if (g.world.crates[i]) g.world.crates[i].taken = !!t; });
    g.materials.setAll(d.mats);
    if (d.br && JSON.stringify(d.br.d) !== JSON.stringify(bw.design)) { bw.build(d.br.d); g.toast('🌉 The bridge was built!'); }
    if (d.br) bw.spent = d.br.sp;
    if (d.obj > g.getObj()) g.setObj(d.obj);
  }
  storages() { const g = this.g; return g.inv.sets.map((set, i) => set.map(st => ({ rv: i, id: st.id, s: g.inv.types(st) }))).flat(); }
  deployedList() { return this.g.gear.deployed.map(d => ({ id: d.id, type: d.type, x: d.pos.x, y: d.pos.y, z: d.pos.z, yaw: d.yaw })); }

  // host: everyone's latest avatar (the host's own included)
  allStates() {
    const all = { [this.net.id]: this.myState() };
    for (const [id, s] of this.states) if (this.players.has(id)) all[id] = s;
    return all;
  }
  myState() { return { ...this.g.player.netState(), n: this.myName, c: this.mySlot, pg: Math.round(this.rtt) }; }

  // host: a player is gone (left, refreshed, timed out, kicked)
  _drop(id, quiet = false, why = 'left') {
    const g = this.g, p = this.players.get(id);
    if (!p) return;
    this.players.delete(id); this.states.delete(id); this.sentP.delete(id);
    if (why !== 'kick') this.recent.set(p.cid, { c: p.c, t: performance.now() });
    g.remotes.remove(id);
    for (const r of g.rvs) if (r.owner === id) r.owner = this.net.id;
    g.onPlayerGone && g.onPlayerGone(id);
    this.net.send('roster', this.roster());
    if (!quiet) g.toast(why === 'timeout' ? `📡 ${p.n} lost connection (they will reconnect automatically)` : `👋 ${p.n} left`);
    g.onRoster();
  }
  kick(id) {
    const p = this.players.get(id);
    if (!this.net.isHost || !p || id === this.net.id) return;
    this.banned.add(p.cid);
    this.net.sendTo(id, 'kick', { r: 'kick' });
    this.net.dropPeer(id, true, 400);
    this._drop(id, true, 'kick');
    this.g.toast(`🚫 ${p.n} was removed from the room`);
  }

  _wire() {
    const net = this.net, g = this.g;
    net.on('hello', (d, from) => {                       // host: someone wants in
      if (!net.isHost) return;
      let cid = String(d.cid || from);
      if (this.banned.has(cid)) { net.sendTo(from, 'kick', { r: 'ban' }); net.dropPeer(from, true, 400); return; }
      // the same tab coming back (refresh / reconnect): throw away its old, silent copy first.
      // If that copy is still alive it's really another tab with a copied id: let both play.
      for (const [id, p] of [...this.players]) {
        if (id === from || p.cid !== cid) continue;
        const c = net.connOf(id);
        if (!c || !c.open || performance.now() - (c._seen || 0) > 2500) { net.dropPeer(id, true); this._drop(id, true); }
        else cid = cid + '~' + from.slice(0, 6);
      }
      let me = this.players.get(from);
      if (!me) {
        const used = new Set([...this.players.values()].map(p => p.c)), back = this.recent.get(cid);
        let slot = back && !used.has(back.c) ? back.c : 1;
        while (used.has(slot)) slot++;
        if (slot >= MAX_PLAYERS) { net.sendTo(from, 'full', { max: MAX_PLAYERS }); net.dropPeer(from, true, 400); return; }
        me = { n: (d.n || 'Player').slice(0, 16), c: slot, cid };
        this.players.set(from, me); this.recent.delete(cid);
        g.toast(back ? `🔄 ${me.n} is back` : `👋 ${me.n} joined`);
      }
      this._ensureRVs(this.rvFor(me.c) + 1);
      net.accept(from);
      net.sendTo(from, 'welcome', { slot: me.c, world: this.worldState(), rvs: g.rvs.map(r => r.netState()), st: this.storages(),
        roster: this.roster(), ps: this.allStates(), dep: this.deployedList(), sv: g.survivalState ? g.survivalState() : null });
      net.send('roster', this.roster());
      g.onRoster();
    });
    net.on('welcome', d => {                             // guest: we're in (or back in)
      const again = this.joined;
      this.mySlot = d.slot;
      g.player.char.setColors(PLAYER_COLORS[d.slot % PLAYER_COLORS.length]);   // you wear your slot's outfit too
      this.applyWorld(d.world);
      const drivingRV = g.player.mode === 'drive' ? g.player.rv : null;
      d.rvs.forEach(s => { this._ensureRVs(s.i + 1); if (g.rvs[s.i] !== drivingRV) g.rvs[s.i].applyNet(s); });
      d.st.forEach(s => g.inv.applyStorage(s.rv, s.id, s.s));
      (d.dep || []).forEach(x => g.gear.addRemote(x));
      this.players = new Map(d.roster.map(p => [p.id, { n: p.n, c: p.c }]));
      for (const id of [...g.remotes.map.keys()]) if (!this.players.has(id)) { g.remotes.remove(id); g.onPlayerGone && g.onPlayerGone(id); }
      this._applyStates(d.ps);
      if (d.sv && g.applySurvival) g.applySurvival(d.sv);
      if (!again) {
        g.player.rv = g.rvs[this.rvFor(d.slot)];
        g.player.spawnBesideRV(d.slot % PER_RV);          // teammates stand side by side, not on top of each other
        g.toast(`✅ Joined! Up to ${PER_RV} players ride together in the RV`);
      } else if (drivingRV) this.claimRV(drivingRV);     // reconnected while driving: keep the wheel
      this.joined = true; this.sentMe = '';
      this._send(1, true);
      g.onRoster();
      if (this.pending) this.pending();
    });
    net.on('full', d => { if (this.pending) { const e = new Error(`That room is full (${(d && d.max) || MAX_PLAYERS} players max).`); e.fatal = true; this.pending(e); } });
    net.on('kick', d => {
      const msg = d && d.r === 'ban' ? 'The host removed you from this room.' : 'You were removed from the room by the host.';
      if (this.pending && !this.joined) { const e = new Error(msg); e.fatal = true; this.pending(e); return; }
      if (this.pending) this.pending(Object.assign(new Error(msg), { fatal: true }));
      this.net.leave(); this._toSolo();
      g.onKicked && g.onKicked(msg);
    });
    net.on('roster', d => {
      if (!net.isGuest) return;
      this.players = new Map(d.map(p => [p.id, { n: p.n, c: p.c }]));
      for (const id of [...g.remotes.map.keys()]) if (!this.players.has(id)) { g.remotes.remove(id); g.onPlayerGone && g.onPlayerGone(id); }
      g.onRoster();
    });
    net.on('p', (d, from) => {                           // host: a guest's avatar
      if (!net.isHost || !this.players.has(from)) return;
      this.states.set(from, d);
      g.remotes.upsert(from, d);
    });
    net.on('pp', d => { if (net.isGuest) this._applyStates(d); });   // guest: everyone's avatars
    net.on('rv', d => {
      this._ensureRVs(d.i + 1);
      const r = g.rvs[d.i];
      if (d.o === net.id) return;
      if (g.player.mode === 'drive' && g.player.rv === r) return;   // we're driving it
      r.applyNet(d);
    });
    net.on('world', d => { if (net.isGuest) this.applyWorld(d); });
    net.on('bridgeSnap', d => { if (net.isGuest) g.bridgeWorld.applySnapshot(d); });
    net.on('obstHit', d => { if (net.isHost) { g.obstacles.hostHit(d.i, d.tool); this.dirty = true; } });
    net.on('mat', d => { if (net.isHost) { g.materials.delta(d, true); this.dirty = true; } });
    net.on('crate', d => {
      if (!net.isHost) return;
      const c = g.world.crates[d.i];
      if (c && !c.taken) { c.taken = true; g.materials.addAll(c.give); this.dirty = true; }
    });
    net.on('buildReq', (d, from) => {
      if (!net.isHost) return;
      const err = g.editor.commit(d.d, false);
      if (err) net.sendTo(from, 'msg', '🚫 ' + err);
      this.dirty = true;
    });
    net.on('msg', d => g.toast(d));
    net.on('storage', d => g.inv.applyStorage(d.rv, d.id, d.s));
    net.on('dep', d => g.gear.addRemote(d));
    net.on('undep', d => g.gear.removeRemote(d.id));
    net.on('leave', (why, from) => this._drop(from, false, why));
    net.on('lost', reason => {
      if (this.pending) { this.pending(new Error('Lost the connection to the room.')); return; }
      if (reason === 'bye' || !this.lastCode) {
        this._toSolo();
        g.toast('⚠ The host closed the room — you are playing solo now');
        return;
      }
      this._reconnect();
    });
    // connection quality (shown in the room bar)
    net.on('ping', (d, from) => { if (net.isHost) net.sendTo(from, 'pong', d); });
    net.on('pong', d => { const r = performance.now() - d.t; this.rtt = this.rtt ? this.rtt * 0.7 + r * 0.3 : r; });
  }
  _applyStates(all) {
    const g = this.g;
    for (const id in all) if (id !== this.net.id && this.players.has(id)) g.remotes.upsert(id, all[id]);
  }

  claimRV(rv) { rv.owner = this.net.id; if (this.online) this.net.send('rv', rv.netState()); }
  // events from the local game
  sendStorage(st) { if (this.online) this.net.send('storage', { rv: st.rvIndex, id: st.id, s: this.g.inv.types(st) }); }
  sendDeploy(d) { if (this.online) this.net.send('dep', { id: d.id, type: d.type, x: d.pos.x, y: d.pos.y, z: d.pos.z, yaw: d.yaw }); }
  sendPack(d) { if (this.online) this.net.send('undep', { id: d.id }); }
  colorOf(id) { const p = this.players.get(id); return PLAYER_COLORS[(p ? p.c : 0) % PLAYER_COLORS.length].css; }
  nameOf(id) { const p = this.players.get(id); return p ? p.n : 'Player'; }

  tick(dt) { this.lastTick = performance.now(); this._send(dt, false); }
  _send(dt, force) {
    if (!this.net.connected) return;
    const net = this.net, g = this.g;
    this.tP += dt; this.tR += dt; this.tW += dt; this.tB += dt; this.fullT += dt; this.tPing += dt;
    if (force) this.dirty = true;
    if (this.tP >= 1 / SEND_HZ) {
      this.tP = 0;
      // only avatars that changed, plus everything once a second (keeps traffic low on phones / slow Wi-Fi)
      const full = force || this.fullT >= 1;
      if (full) this.fullT = 0;
      if (net.isHost) {
        const all = this.allStates(), out = {};
        let n = 0;
        for (const id in all) {
          const js = JSON.stringify(all[id]);
          if (full || this.sentP.get(id) !== js) { out[id] = all[id]; this.sentP.set(id, js); n++; }
        }
        if (n) net.send('pp', out);
      } else {
        const me = this.myState(), js = JSON.stringify(me);
        if (full || js !== this.sentMe) { this.sentMe = js; net.send('p', me, true); }
      }
    }
    if (net.isGuest && this.tPing >= 2) { this.tPing = 0; net.send('ping', { t: performance.now() }, true); }
    if (this.tR >= 1 / 15) { this.tR = 0; for (const r of g.rvs) if (r.isLocal(net)) { if (!r.owner) r.owner = net.id; net.send('rv', r.netState()); } }
    if (net.isHost) {
      if (this.dirty || this.tW > 2) { this.tW = 0; this.dirty = false; net.send('world', this.worldState()); }
      if (g.bridgeWorld.sim && this.tB >= 0.1) { this.tB = 0; net.send('bridgeSnap', g.bridgeWorld.snapshot()); }
    }
  }
}
