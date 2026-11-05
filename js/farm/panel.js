// Pause menu in Farm World: the world, its members (registered vs. playing now), invites and owner tools.
import { PLAYER_COLORS } from '../remote.js';
import { icon } from '../icons.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ago(t) {
  const s = (Date.now() - (typeof t === 'number' ? t : Date.parse(t))) / 1000;
  if (!(s >= 0)) return '';
  if (s < 60) return `${Math.max(1, Math.round(s))} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export class FarmPanel {
  // ctx: { farm, session, net, toast, copy(text) -> Promise, syncLabel(), after() (fills the mic button) }
  constructor(el, ctx) {
    this.el = el; this.c = ctx; this.head = document.getElementById('pauseHead');
    this.inv = null; this.delOpen = false; this.delText = ''; this.msg = '';
    el.addEventListener('click', e => this._click(e));
    el.addEventListener('input', e => { if (e.target.matches('.fm-del input')) this.delText = e.target.value; });
    if (this.head) this.head.addEventListener('click', e => this._click(e));
  }

  render() {
    const { farm: f, session: S, net } = this.c;
    if (!f.active || !f.L) return;
    const typing = this.el.querySelector('.fm-del input:focus');
    if (typing) return;                                   // don't wipe what the owner is typing
    const info = f.info, L = f.L;
    const roster = S.roster(), bySeat = new Map(roster.map(p => [p.c, p]));
    const hostPeer = net.isHost ? net.id : (net.hostConn ? net.hostConn.peer : null);
    const members = info ? info.members : [{ id: L.memberId, name: L.name, seat: L.seat, isOwner: L.isOwner }];
    const isOnline = m => m.id === L.memberId || bySeat.has(m.seat);
    const nOnline = members.filter(isOnline).length;
    const max = info ? info.maxMembers : 4;
    const saved = f.role === 'host' && f.lastSaveAt ? `saved ${ago(f.lastSaveAt)}` : info && info.room.savedAt ? `saved ${ago(info.room.savedAt)}` : 'not saved yet';
    // the sign at the top: the world's name, its code and when it was saved
    if (this.head) {
      const h = `<div class="fm-sign"><div class="fm-name">${icon('wheat')}<span>${esc(L.roomName || 'Farm World')}</span>${icon('wheat')}</div>
        <div class="fm-meta"><span class="fm-code" title="World code — friends need it to join">${esc(L.code)}</span>
        <button class="fm-copy" data-f="copycode" title="Copy the world code">${icon('copy')}</button><span class="fm-saved">${saved}</span></div></div>`;
      if (this.head.dataset.h !== h) { this.head.dataset.h = h; this.head.innerHTML = h; }
    }
    const rows = members.map(m => {
      const me = m.id === L.memberId, p = bySeat.get(m.seat), on = isOnline(m);
      const col = PLAYER_COLORS[m.seat % PLAYER_COLORS.length].css, peer = me ? net.id : p && p.id;
      const badges = (m.isOwner ? `<span class="fm-badge">${icon('crown')}owner</span>` : '') + (peer && peer === hostPeer ? `<span class="fm-badge">${icon('home')}host</span>` : '');
      const st = S.rejoining && me ? `<span class="fm-st wait">reconnecting…</span>`
        : on ? `<span class="fm-st on">playing<em class="pping" data-ping="${esc(peer || '')}"></em></span>` : `<span class="fm-st">offline${m.lastSeenAt ? ' · ' + ago(m.lastSeenAt) : ''}</span>`;
      const btns = (net.isHost && p && !me ? `<button class="rcBtn fm-mini" data-rc="${esc(p.id)}" title="Ask ${esc(m.name)}'s game to reconnect">${icon('refresh')}</button>` : '')
        + (L.isOwner && !me ? `<button class="fm-mini danger" data-f="remove" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Remove</button>` : '');
      return `<div class="fm-mem${on ? '' : ' off'}"><i class="fm-av" style="background:${col}">${esc((m.name || '?').trim().charAt(0).toUpperCase())}</i>
        <div class="fm-who"><b>${esc(m.name)}${me ? ' <em>(you)</em>' : ''}</b><span class="fm-badges">${badges}</span></div>${st}${btns}</div>`;
    }).join('');
    const canInvite = L.isOwner && members.length < max;
    const syncShort = net.isHost ? 'Sync everyone' : net.online ? 'Reconnect' : 'Rejoin';
    this.el.innerHTML = `<div class="fm">
      ${this._stats()}
      <div class="fm-h"><span>Farmhands</span><small>${members.length} of ${max} · ${nOnline} online</small></div>
      <div class="fm-mems">${rows}</div>
      ${canInvite ? `<button class="fm-btn go" data-f="invite">${icon('invite')} Invite a friend</button>` : `<div class="fm-note">${L.isOwner ? 'All 4 places are taken. Remove a farmhand to invite someone new.' : 'Want to add a friend? The owner can invite them from this menu.'}</div>`}
      ${this.inv ? `<div class="fm-inv"><input readonly value="${esc(this.inv.link)}" /><button class="fm-btn" data-f="copyinv">${icon('copy')} Copy</button></div>
        <div class="fm-codes"><span>In the app: <b>Join with an invite</b></span><span>World <code>${esc(this.inv.code)}</code></span><span>Invite <code>${esc(this.inv.pretty)}</code></span></div>
        <div class="fm-note">Copy sends the link and both codes · works once · valid for ${this.inv.hours} hours</div>` : ''}
      ${this.msg ? `<div class="fm-note warn">${esc(this.msg)}</div>` : ''}
      <div class="fm-row2"><button class="micBtn fm-btn" data-mic="1"></button><button class="syncBtn fm-btn" data-sync="1" title="${esc(this.c.syncLabel())}">${icon('refresh')} ${syncShort}</button></div>
      <div class="fm-foot"><button class="fm-link" data-f="logout">${icon('logout')} Log out on this device</button>${L.isOwner ? `<button class="fm-link danger" data-f="delete">${icon('trash')} Delete world…</button>` : ''}</div>
      ${this.delOpen ? `<div class="fm-del"><input placeholder="Type “${esc(L.roomName)}” to delete it forever" value="${esc(this.delText)}" /><button class="fm-btn danger" data-f="deleteGo">Delete forever</button></div>` : ''}
    </div>`;
    if (this.c.after) this.c.after();
  }

  // the farm at a glance: money, the animals, what they make per hour, the feed
  _stats() {
    const e = this.c.eco;
    if (!e || !e.ready) return '';
    const tile = (ic, val, label, cls = '') => `<div class="fm-tile ${cls}">${ic}<b>${val}</b><small>${label}</small></div>`;
    const tiles = [tile(icon('coin'), '₹' + Number(e.money).toLocaleString('en-IN'), 'money')];
    const ANIMAL = { chicken: 'hens', chicken_brown: 'desi hens', chicken_dark: 'black hens', goat: 'goats', cow: 'cows', horse: 'horses' };
    for (const k of e.items('animal')) { const n = e.count(k.id); if (n) tiles.push(tile(k.icon, n, ANIMAL[k.id] || esc(k.name.toLowerCase()))); }
    const MAKES = { egg: 'eggs / h', egg_brown: 'desi eggs / h', egg_dark: 'black eggs / h', goat_milk: 'goat milk / h', cow_milk: 'cow milk / h' };
    for (const p of Object.keys(MAKES)) {
      const r = e.cat(p) && e.makesPerHour(p);
      if (r > 0) tiles.push(tile(e.cat(p).icon, '+' + (r >= 10 ? Math.round(r) : r.toFixed(1)), MAKES[p]));
    }
    const hungry = e.hungryCount();
    tiles.push(tile(icon('feed'), e.qty('feed'), hungry ? `feed · ${hungry} hungry` : 'feed', hungry || e.qty('feed') < 5 ? 'warn' : ''));
    return `<div class="fm-h"><span>Your farm</span></div><div class="fm-tiles">${tiles.join('')}</div>`;
  }
  async _click(e) {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const { farm: f, toast } = this.c, act = b.dataset.f;
    const busy = async fn => { b.disabled = true; try { await fn(); } catch (er) { this.msg = '⚠ ' + (er.message || er); } b.disabled = false; this.render(); };
    if (act === 'copycode') { this.c.copy(f.L.code).then(() => toast(`World code ${f.L.code} copied`), () => {}); return; }
    if (act === 'invite') await busy(async () => { const r = await f.createInvite(); this.inv = r; this.msg = ''; this.c.copy(r.message).then(() => toast('📋 Invite copied (link + codes) — send it to your friend'), () => {}); });
    else if (act === 'copyinv') this.c.copy(this.inv.message).then(() => toast('📋 Invite copied (link + codes)'), () => { const i = this.el.querySelector('.fm-inv input'); if (i) { i.focus(); i.select(); } });
    else if (act === 'remove') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Sure?'; b.classList.add('sure'); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Remove'; b.classList.remove('sure'); } }, 2500); return; }
      await busy(async () => { const r = await f.removeMember(b.dataset.id); this.msg = ''; toast(`🚫 ${r ? r.name : b.dataset.name} is no longer a member of this world`); });
    } else if (act === 'logout') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Log out? Tap again'; b.classList.add('sure'); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.innerHTML = `${icon('logout')} Log out on this device`; b.classList.remove('sure'); } }, 2500); return; }
      b.disabled = true; await f.logout();
    } else if (act === 'delete') { this.delOpen = !this.delOpen; this.render(); const i = this.el.querySelector('.fm-del input'); if (i) i.focus(); }
    else if (act === 'deleteGo') await busy(() => f.deleteWorld(this.delText));
  }
}
