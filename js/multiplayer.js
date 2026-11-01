import { makeRoomCode } from './net.js';
import { PLAYER_COLORS } from './remote.js';

const MAX_PLAYERS = 6;

// Co-op session glue: who's here, which RV each pair uses, and keeping the shared world in sync.
// The host is the authority for shared things (road blocks, bridge, materials, crates, night).
// Each player sends their own avatar; whoever drives an RV sends that RV.
export class Session {
  constructor(g) {
    this.g = g;                       // game context (net, player, rvs, addRV, remotes, ...)
    this.net = g.net;
    this.players = new Map();         // id -> { n: name, c: slot }
    this.myName = 'Player'; this.mySlot = 0;
    this.tP = 0; this.tR = 0; this.tW = 0; this.tB = 0; this.dirty = true;
    this._wire();
  }
  get online() { return this.net.online; }
  roster() { return [...this.players.entries()].map(([id, p]) => ({ id, ...p })).sort((a, b) => a.c - b.c); }

  async host(name) {
    const code = makeRoomCode();
    await this.net.host(code);
    this.myName = name; this.mySlot = 0;
    this.players.set(this.net.id, { n: name, c: 0 });
    for (const r of this.g.rvs) r.owner = this.net.id;
    this._roles();
    this.g.onRoster();
    return code;
  }
  async join(code, name) {
    this.myName = name;
    await this.net.join(code);
    this._roles();
    this.net.send('hello', { n: name }, true);
  }
  _roles() {
    const { net } = this, g = this.g;
    g.materials.net = net; g.obstacles.net = net;
    g.bridgeWorld.role = net.isHost ? 'host' : 'guest';
    g.editor.hooks.remoteBuild = net.isGuest ? d => net.send('buildReq', { d }, true) : null;
  }
  rvFor(slot) { return Math.min(Math.floor(slot / 2), 2); }
  _ensureRVs(n) { while (this.g.rvs.length < n) this.g.addRV(); }

  worldState() {
    const g = this.g, bw = g.bridgeWorld;
    return { obst: g.obstacles.stateArray(), crates: g.world.crates.map(c => (c.taken ? 1 : 0)), mats: g.materials.c,
      br: bw.design ? { d: bw.design, st: bw.state, sp: bw.spent } : null, night: g.world.nightTarget, rvn: g.rvs.length, obj: g.getObj() };
  }
  applyWorld(d) {
    const g = this.g, bw = g.bridgeWorld;
    this._ensureRVs(d.rvn);
    g.obstacles.applyStateArray(d.obst, true);
    d.crates.forEach((t, i) => { if (g.world.crates[i]) g.world.crates[i].taken = !!t; });
    g.materials.setAll(d.mats);
    if (d.br && JSON.stringify(d.br.d) !== JSON.stringify(bw.design)) { bw.build(d.br.d); g.toast('🌉 The bridge was built!'); }
    if (d.br) bw.spent = d.br.sp;
    if (d.night !== g.world.nightTarget) g.world.setNight(d.night, true);
    if (d.obj > g.getObj()) g.setObj(d.obj);
  }
  storages() { const g = this.g; return g.inv.sets.map((set, i) => set.map(st => ({ rv: i, id: st.id, s: g.inv.types(st) }))).flat(); }

  _wire() {
    const net = this.net, g = this.g;
    net.on('hello', (d, from) => {                       // host: a new player
      if (!net.isHost) return;
      const used = new Set([...this.players.values()].map(p => p.c));
      let slot = 1; while (used.has(slot) && slot < MAX_PLAYERS) slot++;
      if (used.has(slot)) { net.sendTo(from, 'full', {}); return; }
      this.players.set(from, { n: (d.n || 'Player').slice(0, 16), c: slot });
      this._ensureRVs(this.rvFor(slot) + 1);
      net.sendTo(from, 'welcome', { slot, world: this.worldState(), rvs: g.rvs.map(r => r.netState()), st: this.storages(), roster: this.roster() });
      net.send('roster', this.roster());
      g.toast(`👋 ${d.n || 'A player'} joined`);
      g.onRoster();
    });
    net.on('welcome', d => {                             // guest: we're in
      this.mySlot = d.slot;
      g.player.char.setColors(PLAYER_COLORS[d.slot % PLAYER_COLORS.length]);   // you wear your slot's outfit too
      this.applyWorld(d.world);
      d.rvs.forEach(s => { this._ensureRVs(s.i + 1); g.rvs[s.i].applyNet(s); });
      d.st.forEach(s => g.inv.applyStorage(s.rv, s.id, s.s));
      this.players = new Map(d.roster.map(p => [p.id, { n: p.n, c: p.c }]));
      g.player.rv = g.rvs[this.rvFor(d.slot)];
      g.player.spawnBesideRV();
      g.toast(`✅ Joined! You share RV ${this.rvFor(d.slot) + 1}`);
      g.onRoster();
    });
    net.on('full', () => g.toast('That room is full (6 players).'));
    net.on('roster', d => { this.players = new Map(d.map(p => [p.id, { n: p.n, c: p.c }])); g.onRoster(); });
    net.on('p', (d, from) => { if (from !== net.id) g.remotes.upsert(from, d); });
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
    net.on('night', d => { g.world.setNight(d, true); this.dirty = true; });
    net.on('dep', d => g.gear.addRemote(d));
    net.on('undep', d => g.gear.removeRemote(d.id));
    net.on('leave', (d, from) => {
      const p = this.players.get(from);
      this.players.delete(from);
      g.remotes.remove(from);
      for (const r of g.rvs) if (r.owner === from) r.owner = net.id;
      net.send('roster', this.roster());
      g.toast(`👋 ${p ? p.n : 'A player'} left`);
      g.onRoster();
    });
    net.on('lost', () => {
      for (const id of [...g.remotes.map.keys()]) g.remotes.remove(id);
      this.players.clear();
      g.materials.net = null; g.obstacles.net = null; g.bridgeWorld.role = 'solo'; g.editor.hooks.remoteBuild = null;
      for (const r of g.rvs) r.owner = null;
      g.toast('⚠ Lost connection to the host — you are playing solo now');
      g.onRoster();
    });
  }

  claimRV(rv) { rv.owner = this.net.id; if (this.online) this.net.send('rv', rv.netState()); }
  // events from the local game
  sendStorage(st) { if (this.online) this.net.send('storage', { rv: st.rvIndex, id: st.id, s: this.g.inv.types(st) }); }
  sendNight(n) { if (!this.online) return; this.net.send('night', n); this.dirty = true; }
  sendDeploy(d) { if (this.online) this.net.send('dep', { id: d.id, type: d.type, x: d.pos.x, y: d.pos.y, z: d.pos.z, yaw: d.yaw }); }
  sendPack(d) { if (this.online) this.net.send('undep', { id: d.id }); }
  colorOf(id) { const p = this.players.get(id); return PLAYER_COLORS[(p ? p.c : 0) % PLAYER_COLORS.length].css; }

  tick(dt) {
    if (!this.online) return;
    const net = this.net, g = this.g;
    this.tP += dt; this.tR += dt; this.tW += dt; this.tB += dt;
    if (this.tP >= 1 / 12) { this.tP = 0; net.send('p', { ...g.player.netState(), n: this.myName, c: this.mySlot }); }
    if (this.tR >= 1 / 15) { this.tR = 0; for (const r of g.rvs) if (r.isLocal(net)) { if (!r.owner) r.owner = net.id; net.send('rv', r.netState()); } }
    if (net.isHost) {
      if (this.dirty || this.tW > 2) { this.tW = 0; this.dirty = false; net.send('world', this.worldState()); }
      if (g.bridgeWorld.sim && this.tB >= 0.1) { this.tB = 0; net.send('bridgeSnap', g.bridgeWorld.snapshot()); }
    }
  }
}
