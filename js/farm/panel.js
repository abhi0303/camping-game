// Pause menu in Farm World: the world, its members (registered vs. playing now), invites and owner tools.
import { PLAYER_COLORS } from '../remote.js';

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
    this.el = el; this.c = ctx;
    this.inv = null; this.delOpen = false; this.delText = ''; this.msg = '';
    el.addEventListener('click', e => this._click(e));
    el.addEventListener('input', e => { if (e.target.matches('.fdel input')) this.delText = e.target.value; });
  }

  render() {
    const { farm: f, session: S, net } = this.c;
    if (!f.active || !f.L) return;
    const typing = this.el.querySelector('.fdel input:focus');
    if (typing) return;                                   // don't wipe what the owner is typing
    const info = f.info, L = f.L;
    const roster = S.roster(), bySeat = new Map(roster.map(p => [p.c, p]));
    const hostPeer = net.isHost ? net.id : (net.hostConn ? net.hostConn.peer : null);
    const members = info ? info.members : [{ id: L.memberId, name: L.name, seat: L.seat, isOwner: L.isOwner }];
    const isOnline = m => m.id === L.memberId || bySeat.has(m.seat);
    const nOnline = members.filter(isOnline).length;
    const rows = members.map(m => {
      const me = m.id === L.memberId, p = bySeat.get(m.seat), on = isOnline(m);
      const col = PLAYER_COLORS[m.seat % PLAYER_COLORS.length].css, peer = me ? net.id : p && p.id;
      const st = S.rejoining && me ? '📡 reconnecting…' : on ? `🟢 playing<em class="pping" data-ping="${esc(peer || '')}"></em>` : `⚪ offline${m.lastSeenAt ? ' · ' + ago(m.lastSeenAt) : ''}`;
      const btns = [
        net.isHost && p && !me ? `<button class="rcBtn" data-rc="${esc(p.id)}" title="Ask ${esc(m.name)}'s game to reconnect">↻</button>` : '',
        L.isOwner && !me ? `<button class="fbtn danger" data-f="remove" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Remove</button>` : '',
      ].join('');
      return `<div class="fmem${on ? '' : ' off'}"><i style="background:${col}"></i><span>${esc(m.name)}${me ? ' <em>(you)</em>' : ''}${m.isOwner ? ' <em>👑 owner</em>' : ''}${peer && peer === hostPeer ? ' <em>🏠 host</em>' : ''}</span><span class="st">${st}</span>${btns}</div>`;
    }).join('');
    const max = info ? info.maxMembers : 4;
    const saved = f.role === 'host' && f.lastSaveAt ? `saved ${ago(f.lastSaveAt)}` : info && info.room.savedAt ? `saved ${ago(info.room.savedAt)}` : 'not saved yet';
    const canInvite = L.isOwner && members.length < max;
    this.el.innerHTML = `<div class="fpanel">
      <div class="fp-top"><div><div class="fp-title">🌾 ${esc(L.roomName || 'Farm World')}</div>
        <div class="small dim">code <b class="fp-code">${esc(L.code)}</b> · ${saved}</div></div>
        <div class="fp-counts"><span class="fp-count" title="Registered members (max ${max})">👥 Members ${members.length}/${max}</span><span class="fp-count" title="Playing right now (max 4)">🟢 Online ${nOnline}/4</span></div></div>
      ${this._farmLine()}
      ${rows}
      ${canInvite ? `<button class="fbtn go" data-f="invite">➕ Invite a friend</button>` : L.isOwner ? '<div class="fmsg">All 4 places are taken. Remove a member to invite someone new.</div>' : '<div class="fmsg">Want to add a friend? The owner can invite them from this menu.</div>'}
      ${this.inv ? `<div class="finv"><input readonly value="${esc(this.inv.link)}" /><button class="fbtn" data-f="copyinv">Copy</button></div>
        <div class="fcodes"><span>In the app: <b>Join with an invite</b></span><span>World code <code>${esc(this.inv.code)}</code></span><span>Invite code <code>${esc(this.inv.pretty)}</code></span></div>
        <div class="fmsg">Copy sends the link and both codes · works once · valid for ${this.inv.hours} hours</div>` : ''}
      ${this.msg ? `<div class="fmsg">${esc(this.msg)}</div>` : ''}
      <button class="micBtn wide" data-mic="1"></button>
      <button class="syncBtn wide" data-sync="1">${esc(this.c.syncLabel())}</button>
      <div class="fp-foot"><button class="fbtn" data-f="logout">🚪 Log out on this device</button>${L.isOwner ? '<button class="fbtn danger" data-f="delete">🗑 Delete world…</button>' : ''}</div>
      ${this.delOpen ? `<div class="fdel"><input placeholder="Type “${esc(L.roomName)}” to delete it forever" value="${esc(this.delText)}" /><button class="fbtn sure" data-f="deleteGo">Delete forever</button></div>` : ''}
    </div>`;
    if (this.c.after) this.c.after();
  }

  // production overview: money, animals, what they make per hour, how long the feed lasts
  _farmLine() {
    const e = this.c.eco;
    if (!e || !e.ready) return '';
    const animals = e.items('animal').filter(k => e.count(k.id)).map(k => `${k.icon} ${e.count(k.id)}`).join(' · ') || 'no animals yet';
    const makes = ['egg', 'egg_brown', 'egg_dark', 'goat_milk', 'cow_milk'].filter(p => e.cat(p) && e.makesPerHour(p) > 0).map(p => `${e.cat(p).icon} +${e.makesPerHour(p).toFixed(1)}/h`).join(' · ');
    const hungry = e.hungryCount();
    return `<div class="fp-farm">🏡 Farm · 💰 ₹${e.money} · ${animals}${makes ? ' · ' + makes : ''} · 🌾 ${e.qty('feed')} feed${hungry ? ` · ${hungry} hungry` : ''}</div>`;
  }
  async _click(e) {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const { farm: f, toast } = this.c, act = b.dataset.f;
    const busy = async fn => { b.disabled = true; try { await fn(); } catch (er) { this.msg = '⚠ ' + (er.message || er); } b.disabled = false; this.render(); };
    if (act === 'invite') await busy(async () => { const r = await f.createInvite(); this.inv = r; this.msg = ''; this.c.copy(r.message).then(() => toast('📋 Invite copied (link + codes) — send it to your friend'), () => {}); });
    else if (act === 'copyinv') this.c.copy(this.inv.message).then(() => toast('📋 Invite copied (link + codes)'), () => { const i = this.el.querySelector('.finv input'); if (i) { i.focus(); i.select(); } });
    else if (act === 'remove') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Sure?'; b.classList.add('sure'); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Remove'; b.classList.remove('sure'); } }, 2500); return; }
      await busy(async () => { const r = await f.removeMember(b.dataset.id); this.msg = ''; toast(`🚫 ${r ? r.name : b.dataset.name} is no longer a member of this world`); });
    } else if (act === 'logout') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Log out? Tap again'; b.classList.add('sure'); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = '🚪 Log out on this device'; b.classList.remove('sure'); } }, 2500); return; }
      b.disabled = true; await f.logout();
    } else if (act === 'delete') { this.delOpen = !this.delOpen; this.render(); const i = this.el.querySelector('.fdel input'); if (i) i.focus(); }
    else if (act === 'deleteGo') await busy(() => f.deleteWorld(this.delText));
  }
}
