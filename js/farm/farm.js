// Farm World session: a permanent world saved on the server, played live over PeerJS.
// - Opening the world asks the server who hosts it right now: nobody -> you host it (and load the saved
//   world); someone -> you join their game with a ticket they check with the server.
// - The host sends a heartbeat every 15 s (who is online + the world snapshot when it changed, at most
//   every 25 s, or soon after important events) and a last save when the page closes.
// - When the host goes away, the players left ask the server again and one of them becomes the host.
import { api, ApiError, LOGIN_GONE } from './api.js';
import { Logins } from './logins.js';

const HEARTBEAT_MS = 15000, WORLD_EVERY_MS = 25000, SAVE_SOON_MS = 1500, REOPEN_FOR_MS = 120000;
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Farm {
  // g: { net, session, toast, collectWorld, applyWorld, freshWorld, onGone(msg, forget), onRoster, onHosting }
  constructor(g) {
    this.g = g;
    this.L = null;            // login: { code, token, memberId, name, seat, isOwner, canInvite, roomName }
    this.active = false; this.role = null; this.epoch = 0; this.live = false;
    this.savedJs = ''; this.savedAt = -1e9; this.lastSaveAt = 0; this.fails = 0;
    this.reopening = false; this.info = null; this.infoAt = -1e9;
    addEventListener('pagehide', () => this._bye());
    const net = g.net;
    // the owner (maybe not the host) removed a member or deleted the world: everyone checks with the server
    net.on('farmRemoved', d => { if (this.active && net.isHost && d && isUuid(d.id)) this._checkRemoved(d.id); });
    net.on('farmDeleted', () => { if (this.active) this.refreshInfo(true).catch(() => {}); });
    // the owner changed who can invite, or handed the world over: everyone asks the server who's who now
    net.on('farmRoles', () => { if (this.active) this._rolesChanged(); });
  }
  get isOwner() { return !!(this.L && this.L.isOwner); }
  // the owner, or a member the owner lets invite friends
  get canInvite() { return !!(this.L && (this.L.isOwner || this.L.canInvite)); }
  get code() { return this.L ? this.L.code : ''; }

  /* ---------- open the world (from the menu) ---------- */
  async enter(L, status = () => {}) {
    this.L = L; this.active = true;
    const g = this.g;
    let report = {};
    try {
      for (let tries = 1; tries <= 6; tries++) {
        const s = await api.session(L, report);
        this._remember(s);
        g.freshWorld();
        if (s.role === 'host') {
          if (s.world) g.applyWorld(s.world);
          await this._host(s);
          return { role: 'host', fresh: !s.world };
        }
        status(`Joining ${s.hostName || 'your friend'}'s game…`);
        try { await this._join(s); return { role: 'guest', hostName: s.hostName }; }
        catch (e) {
          if (e.fatal && !e.unavailable) throw e;              // not let in
          report = { hostGone: s.epoch, unavailable: !!e.unavailable };
          status(`${s.hostName || 'The host'} can't be reached — trying again…`);
          await sleep(1000 * tries);
        }
      }
      throw new ApiError('host_unreachable', 'Could not connect to the player who is hosting this world. Try again in a minute.');
    } catch (e) {
      this.active = false; this.role = null; this._stopBeat();
      try { g.net.leave(); } catch (_) { /* ignore */ }
      if (LOGIN_GONE.has(e.code)) Logins.forget(L.code);
      throw e;
    }
  }

  _remember(s) {
    if (s && s.me) {
      const me = { name: s.me.name, seat: s.me.seat, isOwner: s.me.isOwner, canInvite: !!(s.me.canInvite || s.me.isOwner) };
      Object.assign(this.L, me); Logins.touch(this.L.code, me);
    }
    if (s && s.room && s.room.name) { this.L.roomName = s.room.name; Logins.touch(this.L.code, { roomName: s.room.name }); }
  }

  async _host(s) {
    const g = this.g;
    this.role = 'host'; this.epoch = s.epoch;
    try {
      await g.session.hostFarm({ code: this.L.code, peerId: s.hostPeer, name: this.L.name, seat: this.L.seat, memberId: this.L.memberId });
      this.live = true;
    } catch (e) {
      // no PeerJS server: play and keep saving; friends can join after a Reconnect when it works again
      this.live = false;
      g.net.mode = 'solo'; g.session.rejoining = false; g.session.leftHosting();
      g.toast('⚠ The live session could not start (PeerJS server unreachable). Your progress still saves; press 🔄 later so friends can join.');
    }
    this.savedJs = '';                        // first heartbeat saves the world (a new host may have fresher state)
    this._startBeat();
    g.onHosting && g.onHosting();
  }

  async _join(s) {
    this.role = 'guest'; this.epoch = s.epoch; this._stopBeat();
    await this.g.session.joinFarm({ code: this.L.code, name: this.L.name, peerId: s.hostPeer, ticket: s.ticket, memberId: this.L.memberId });
  }

  /* ---------- host: heartbeat + saving ---------- */
  _startBeat() { this._stopBeat(); this.hbT = setInterval(() => this.beat(), HEARTBEAT_MS); this.beat(true); }
  _stopBeat() { clearInterval(this.hbT); this.hbT = 0; clearTimeout(this.soonT); }
  online() {
    const ids = this.live ? [...this.g.session.players.values()].map(p => p.cid).filter(isUuid) : [];
    if (!ids.includes(this.L.memberId)) ids.push(this.L.memberId);
    return ids;
  }
  async beat(withWorld = false) {
    if (this.role !== 'host' || !this.active) return;
    if (this.beating) { this.again = this.again || withWorld; return; }
    const snap = this.g.collectWorld(), js = JSON.stringify(snap), now = performance.now();
    const world = js !== this.savedJs && (withWorld || now - this.savedAt >= WORLD_EVERY_MS) ? snap : null;
    const epoch = this.epoch;
    this.beating = true;
    try {
      const r = await api.heartbeat(this.L, { epoch, online: this.online(), world });
      if (epoch !== this.epoch || this.role !== 'host') return;
      if (r.superseded) { this._superseded(r); return; }
      // someone in the game is no longer a member (removed while their kick message got lost): put them out
      for (const id of r.gone || []) this.g.session.kickMember(id, 'removed');
      if (world) { this.savedJs = js; this.savedAt = now; this.lastSaveAt = Date.now(); }
      if (this.fails >= 2) this.g.toast('✅ Connected to the Farm World server again — progress saved');
      this.fails = 0;
    } catch (e) {
      if (LOGIN_GONE.has(e.code)) { this.gone(e.message, true); return; }
      if (++this.fails === 2) this.g.toast('⚠ Can\'t reach the Farm World server — your progress will be saved when it\'s back');
    } finally {
      this.beating = false;
      if (this.again) { this.again = false; setTimeout(() => this.beat(true), 0); }
    }
  }
  // after important events (bridge built, checkpoint, objective...): save in a moment
  saveSoon() {
    if (!this.active || this.role !== 'host') return false;
    clearTimeout(this.soonT);
    this.soonT = setTimeout(() => this.beat(true), SAVE_SOON_MS);
    return true;
  }
  // page closing: last save + hand the world over (the next player to open it hosts right away)
  _bye() {
    if (!this.active || this.role !== 'host') return;
    this._stopBeat();
    const snap = this.g.collectWorld(), js = JSON.stringify(snap);
    const body = { epoch: this.epoch, online: [], release: true };
    if (js !== this.savedJs && js.length < 60000) body.world = snap;      // beacons are limited to ~64 KB
    api.beacon(this.L, body);
    this.role = null;
  }
  // "Leave world" in the menu: same, but waits for the save
  async leave() {
    if (this.active && this.role === 'host') {
      this._stopBeat();
      try { await api.heartbeat(this.L, { epoch: this.epoch, online: [], release: true, world: this.g.collectWorld() }); } catch (e) { /* the beacon below is the fallback */ }
      this.role = null;
    }
    this.active = false;
  }

  /* ---------- host changes ---------- */
  _superseded(r) {
    this._stopBeat(); this.role = null;
    if (r.hostId === this.L.memberId) { this.gone('You opened this world on another device, so it closed here.', false); return; }
    this.g.toast(`🔄 ${r.hostName || 'Another player'} is hosting the world now — joining their game…`);
    try { this.g.net.leave(); } catch (e) { /* ignore */ }        // our guests find the new host by themselves
    this.g.session.leftHosting();
    this.reopen({});
  }
  // guest: the link to the host is gone ('bye' = host left, 'manual' = 🔄 pressed)
  hostLost(reason) {
    if (!this.active) return;
    this.reopen({ hostGone: this.role === 'guest' ? this.epoch : undefined, manual: reason === 'manual', bye: reason === 'bye' });
  }
  async reopen(o = {}) {
    if (this.reopening || !this.active) return;
    this.reopening = true;
    const g = this.g, S = g.session;
    S.rejoining = true; g.net.mode = 'rejoin';
    g.toast(o.manual ? '🔄 Reconnecting to the world and syncing everything…'
      : o.bye ? '🏠 The host left — passing the world to another player…' : '📡 Connection dropped — reconnecting to the world…');
    g.onRoster();
    let done = false;
    try { done = await this._reopenLoop(o); } finally { this.reopening = false; S.rejoining = false; }
    if (!done && this.active) {
      g.net.mode = 'solo'; S._toSolo();
      g.toast('⚠ Could not get back into the world. Press Esc → Rejoin to try again.');
    }
    g.onRoster();
  }
  // true = back in (hosting or joined); false = gave up, kicked, or the login ended
  async _reopenLoop(o) {
    const g = this.g, t0 = performance.now();
    let report = o.hostGone ? { hostGone: o.hostGone } : {};
    for (let tries = 1; this.active && performance.now() - t0 < REOPEN_FOR_MS; tries++) {
      try {
        const s = await api.session(this.L, report);
        this._remember(s);
        if (s.role === 'host') {
          g.session.rejoining = false;
          await this._host(s);
          g.toast(this.live ? '🏠 You are hosting the world now — friends can keep playing with you' : '🏠 You have the world now');
          return true;
        }
        try {
          await this._join(s);
          g.toast(o.manual ? '✅ Reconnected — players, world and voice are synced again' : `✅ Back in the world (${s.hostName || 'a friend'} is hosting)`);
          return true;
        } catch (e) {
          if (e.fatal && !e.unavailable) return false;                  // kicked: the page goes back to the menu
          report = { hostGone: s.epoch, unavailable: !!e.unavailable };
        }
      } catch (e) {
        if (LOGIN_GONE.has(e.code)) { this.gone(e.message, true); return false; }
        // server unreachable: keep trying
      }
      await sleep(Math.min(5000, 600 * tries));
    }
    return false;
  }

  // host: is this PeerJS guest really a member? Throws ApiError (bad_ticket = not a member)
  async verify(ticket) {
    if (!this.active || this.role !== 'host') throw new ApiError('not_host', 'Not hosting');
    return (await api.verify(this.L, ticket)).member;
  }

  gone(msg, forget) {
    this.active = false; this.role = null; this._stopBeat();
    if (forget && this.L) Logins.forget(this.L.code);
    this.g.onGone(msg);
  }

  /* ---------- world info + owner actions (pause menu) ---------- */
  async refreshInfo(force = false) {
    if (!this.active) return this.info;
    if (!force && this.info && performance.now() - this.infoAt < 10000) return this.info;
    try {
      this.info = await api.info(this.L);
      this.infoAt = performance.now();
      this._remember({ me: this.info.me, room: this.info.room });
    } catch (e) {
      if (LOGIN_GONE.has(e.code)) this.gone(e.code === 'room_not_found' ? 'This world was deleted by its owner.' : e.message, true);
      throw e;
    }
    return this.info;
  }
  inviteLink(invite) {
    const keep = new URLSearchParams(location.search).get('api');
    return `${location.origin}${location.pathname}?farm=${this.L.code}&invite=${invite}${keep && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '&api=' + encodeURIComponent(keep) : ''}`;
  }
  async createInvite() {
    const r = await api.invite(this.L);
    const link = this.inviteLink(r.invite), pretty = r.invite.replace(/(.{4})(?=.)/g, '$1 ');
    // the message to send: the link (browser) and the two codes (the installed app can't open links)
    const message = `Join my farm "${this.L.roomName || 'Farm World'}" in RV Van 🌾\n${link}\n\nIn the app: Farm World → Join with an invite\nWorld code: ${this.L.code}\nInvite code: ${pretty}\n(works once, for ${r.hours} hours)`;
    return { link, invite: r.invite, pretty, code: this.L.code, hours: r.hours, message };
  }
  async removeMember(id) {
    const r = await api.removeMember(this.L, id);
    // whoever hosts kicks them out of the live game
    if (this.g.net.isHost) this.g.session.kickMember(id, 'removed');
    else this.g.net.send('farmRemoved', { id });
    await this.refreshInfo(true).catch(() => {});
    return r.removed;
  }
  // the owner lets a member invite friends (or stops them), or hands the world over to them
  async setCanInvite(id, on) {
    const r = await api.setPermissions(this.L, id, on);
    this.g.net.send('farmRoles', {});
    await this.refreshInfo(true).catch(() => {});
    return r.member;
  }
  async makeOwner(id) {
    const r = await api.makeOwner(this.L, id);
    this.g.net.send('farmRoles', {});
    await this.refreshInfo(true).catch(() => {});
    return r.owner;
  }
  async _rolesChanged() {
    const was = { owner: this.isOwner, invite: this.canInvite };
    try { await this.refreshInfo(true); } catch (e) { return; }
    if (this.isOwner && !was.owner) this.g.toast('👑 You are now the owner of this world — you can invite, remove members and choose who can invite');
    else if (!this.isOwner && this.canInvite && !was.invite) this.g.toast('💌 The owner lets you invite friends now — Esc → Invite a friend');
    else if (!this.canInvite && was.invite) this.g.toast('The owner turned off your invites');
    if (this.g.onRoles) this.g.onRoles();
  }
  async _checkRemoved(id) {
    try { const info = await this.refreshInfo(true); if (!info.members.some(m => m.id === id)) this.g.session.kickMember(id, 'removed'); }
    catch (e) { /* can't check now */ }
  }
  async deleteWorld(confirm) {
    await api.deleteWorld(this.L, confirm);
    try { this.g.net.send('farmDeleted', {}); } catch (e) { /* ignore */ }
    this.gone('The world was deleted.', true);
  }
  async logout() {
    await this.leave();
    try { await api.logout(this.L); } catch (e) { /* the login is forgotten here anyway */ }
    this.gone('You logged out of this world on this device.', true);
  }
}
