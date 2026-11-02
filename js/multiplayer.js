import { makeRoomCode } from './net.js';
import { PLAYER_COLORS } from './remote.js';

export const MAX_PLAYERS = 4;   // a room holds 4 players; the 5th gets "room full"
export const PER_RV = 4;        // ...and all 4 travel together in one RV
const MAX_RVS = 1;
const SEND_HZ = 10;

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
    this.pending = null;              // guest: waiting for the host to accept us
    this.myName = 'Player'; this.mySlot = 0;
    this.tP = 0; this.tR = 0; this.tW = 0; this.tB = 0; this.dirty = true;
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
    this.myName = name;
    await this.net.join(code);
    this._roles();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => done(new Error('The host did not answer. Try again.')), 15000);
      const done = err => {
        clearTimeout(t); this.pending = null;
        if (!err) { resolve(); return; }
        this.net.leave(); this._toSolo();
        reject(err);
      };
      this.pending = done;
      this.net.send('hello', { n: name, cid: this.net.cid }, true);
    });
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
  myState() { return { ...this.g.player.netState(), n: this.myName, c: this.mySlot }; }

  // host: a player is gone (left, refreshed, timed out, kicked)
  _drop(id, quiet = false) {
    const g = this.g, p = this.players.get(id);
    if (!p) return;
    this.players.delete(id); this.states.delete(id);
    g.remotes.remove(id);
    for (const r of g.rvs) if (r.owner === id) r.owner = this.net.id;
    g.onPlayerGone && g.onPlayerGone(id);
    this.net.send('roster', this.roster());
    if (!quiet) g.toast(`👋 ${p.n} left`);
    g.onRoster();
  }
  kick(id) {
    const p = this.players.get(id);
    if (!this.net.isHost || !p || id === this.net.id) return;
    this.banned.add(p.cid);
    this.net.sendTo(id, 'kick', { r: 'kick' });
    this.net.dropPeer(id, true, 400);
    this._drop(id, true);
    this.g.toast(`🚫 ${p.n} was removed from the room`);
  }

  _wire() {
    const net = this.net, g = this.g;
    net.on('hello', (d, from) => {                       // host: someone wants in
      if (!net.isHost) return;
      const cid = String(d.cid || from);
      if (this.banned.has(cid)) { net.sendTo(from, 'kick', { r: 'ban' }); net.dropPeer(from, true, 400); return; }
      // the same tab coming back after a refresh: throw away its old copy first
      for (const [id, p] of [...this.players]) if (id !== from && p.cid === cid) { net.dropPeer(id, true); this._drop(id, true); }
      let me = this.players.get(from);
      if (!me) {
        const used = new Set([...this.players.values()].map(p => p.c));
        let slot = 1; while (used.has(slot)) slot++;
        if (slot >= MAX_PLAYERS) { net.sendTo(from, 'full', { max: MAX_PLAYERS }); net.dropPeer(from, true, 400); return; }
        me = { n: (d.n || 'Player').slice(0, 16), c: slot, cid };
        this.players.set(from, me);
        g.toast(`👋 ${me.n} joined`);
      }
      this._ensureRVs(this.rvFor(me.c) + 1);
      net.accept(from);
      net.sendTo(from, 'welcome', { slot: me.c, world: this.worldState(), rvs: g.rvs.map(r => r.netState()), st: this.storages(),
        roster: this.roster(), ps: this.allStates(), dep: this.deployedList(), sv: g.survivalState ? g.survivalState() : null });
      net.send('roster', this.roster());
      g.onRoster();
    });
    net.on('welcome', d => {                             // guest: we're in
      this.mySlot = d.slot;
      g.player.char.setColors(PLAYER_COLORS[d.slot % PLAYER_COLORS.length]);   // you wear your slot's outfit too
      this.applyWorld(d.world);
      d.rvs.forEach(s => { this._ensureRVs(s.i + 1); g.rvs[s.i].applyNet(s); });
      d.st.forEach(s => g.inv.applyStorage(s.rv, s.id, s.s));
      (d.dep || []).forEach(x => g.gear.addRemote(x));
      this.players = new Map(d.roster.map(p => [p.id, { n: p.n, c: p.c }]));
      this._applyStates(d.ps);
      if (d.sv && g.applySurvival) g.applySurvival(d.sv);
      g.player.rv = g.rvs[this.rvFor(d.slot)];
      g.player.spawnBesideRV(d.slot % PER_RV);          // teammates stand side by side, not on top of each other
      this._send(1, true);
      g.toast(`✅ Joined! Up to ${PER_RV} players ride together in the RV`);
      g.onRoster();
      if (this.pending) this.pending();
    });
    net.on('full', d => { if (this.pending) this.pending(new Error(`That room is full (${(d && d.max) || MAX_PLAYERS} players max).`)); });
    net.on('kick', d => {
      const msg = d && d.r === 'ban' ? 'The host removed you from this room.' : 'You were removed from the room by the host.';
      if (this.pending) { this.pending(new Error(msg)); return; }
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
    net.on('leave', (d, from) => this._drop(from));
    net.on('lost', () => {
      if (this.pending) { this.pending(new Error('Lost the connection to the room.')); return; }
      this._toSolo();
      g.toast('⚠ The host left or the connection dropped — you are playing solo now');
    });
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
    if (!this.online) return;
    const net = this.net, g = this.g;
    this.tP += dt; this.tR += dt; this.tW += dt; this.tB += dt;
    if (force) this.dirty = true;
    if (this.tP >= 1 / SEND_HZ) {
      this.tP = 0;
      if (net.isHost) net.send('pp', this.allStates());
      else net.send('p', this.myState(), true);
    }
    if (this.tR >= 1 / 15) { this.tR = 0; for (const r of g.rvs) if (r.isLocal(net)) { if (!r.owner) r.owner = net.id; net.send('rv', r.netState()); } }
    if (net.isHost) {
      if (this.dirty || this.tW > 2) { this.tW = 0; this.dirty = false; net.send('world', this.worldState()); }
      if (g.bridgeWorld.sim && this.tB >= 0.1) { this.tB = 0; net.send('bridgeSnap', g.bridgeWorld.snapshot()); }
    }
  }
}
