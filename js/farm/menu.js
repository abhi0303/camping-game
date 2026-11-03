// Start menu: Zombie Trail / Farm World tabs, and the Farm World screens
// (worlds saved on this device, create a world, log in to a world, accept an invite).
import { api, apiReady, LOGIN_GONE } from './api.js';
import { Logins } from './logins.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const cleanInvite = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
// an invite link pasted anywhere: ...?farm=CODE&invite=XXXX -> { code, invite }
const fromLink = v => { const m = /farm=([A-Za-z0-9]+)/i.exec(v || ''), i = /invite=([A-Za-z0-9-]+)/i.exec(v || ''); return m ? { code: cleanCode(m[1]), invite: i ? cleanInvite(i[1]) : '' } : null; };
const PIN = /^\d{4,6}$/;
const SUBS = {
  zombie: 'Drive through the jungle, clear the trail, rebuild the bridge and reach the hilltop camp — alone or with friends.',
  farm: 'Your own world that keeps going: build it up with up to 3 friends, together or one at a time.',
};

export class FarmMenu {
  // enter(login, status) opens the world and starts the game (throws a readable error)
  constructor({ enter, defaultName, flash }) {
    this.enter = enter; this.busy = false;
    this.ui = { saved: $('fSaved'), status: $('fStatus'), invite: $('fInvite') };
    const name = defaultName() || '';
    for (const id of ['fcName', 'fjName', 'fiName', 'fnName']) $(id).value = name;
    for (const id of ['fcPin', 'fjPin', 'fiPin', 'fnPin']) $(id).addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    // a pasted invite link fills the world code and the invite code (the installed app can't open links)
    const pasted = v => { const l = fromLink(v); if (!l) return false; $('fnCode').value = l.code; if (l.invite) $('fnInvite').value = l.invite; return true; };
    $('fjCode').addEventListener('input', e => { const v = e.target.value, l = fromLink(v); e.target.value = l ? l.code : cleanCode(v); if (l && l.invite) { pasted(v); this.status('That was an invite link: it is filled in under “Join with an invite”.'); $('fnName').focus(); } });
    $('fnCode').addEventListener('input', e => { const v = e.target.value; if (!pasted(v)) e.target.value = cleanCode(v); });
    $('fnInvite').addEventListener('input', e => { const v = e.target.value; if (!pasted(v)) e.target.value = cleanInvite(v); });
    $('fnGo').onclick = () => this.joinCode();
    $('fcGo').onclick = () => this.create();
    $('fjGo').onclick = () => this.login();
    $('fiGo').onclick = () => this.joinInvite();
    const enterKey = (ids, btn) => ids.forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $(btn).click(); } }));
    enterKey(['fcName', 'fcWorld', 'fcPin'], 'fcGo'); enterKey(['fjCode', 'fjName', 'fjPin'], 'fjGo'); enterKey(['fiName', 'fiPin'], 'fiGo'); enterKey(['fnCode', 'fnInvite', 'fnName', 'fnPin'], 'fnGo');
    this.ui.saved.addEventListener('click', e => this._savedClick(e));
    // ?farm=CODE&invite=XXXX (invite link) or ?farm=CODE
    const q = new URLSearchParams(location.search);
    this.fromLink = !!q.get('farm');
    const code = cleanCode(q.get('farm')), invite = String(q.get('invite') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code && invite) this._showInvite(code, invite);
    else if (code) $('fjCode').value = code;
    // tabs
    let mode = 'zombie';
    try { mode = sessionStorage.getItem('rv-mode-next') || localStorage.getItem('rv-mode') || 'zombie'; sessionStorage.removeItem('rv-mode-next'); } catch (e) { /* ignore */ }
    if (q.get('room')) mode = 'zombie';
    if (this.fromLink) mode = 'farm';
    $('modeTabs').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) this.setMode(b.dataset.mode); });
    this.setMode(mode, true);
    if (flash) this.status(flash, true);
  }

  setMode(mode, first = false) {
    this.mode = mode === 'farm' ? 'farm' : 'zombie';
    try { localStorage.setItem('rv-mode', this.mode); } catch (e) { /* ignore */ }
    for (const b of document.querySelectorAll('#modeTabs [data-mode]')) b.classList.toggle('on', b.dataset.mode === this.mode);
    $('overlay').dataset.mode = this.mode;
    $('menuStart').classList.toggle('hidden', this.mode !== 'zombie');
    $('menuFarm').classList.toggle('hidden', this.mode !== 'farm');
    $('mSub').textContent = SUBS[this.mode];
    if (this.mode === 'farm') {
      this.renderSaved();
      if (!apiReady()) this.status('Farm World is not switched on yet (its server address is missing). Zombie Trail works as usual.', true);
      else if (!first) this.status('');
    }
  }
  // hide the start screens once a game runs
  hide() { $('modeTabs').classList.add('hidden'); $('menuFarm').classList.add('hidden'); $('overlay').classList.add('playing'); }

  status(text, err = false) { this.ui.status.textContent = text || ''; this.ui.status.classList.toggle('err', !!err); }
  setBusy(b) {
    this.busy = b;
    for (const el of document.querySelectorAll('#menuFarm button')) el.disabled = b;
  }
  async _run(fn) {
    if (this.busy) return;
    this.setBusy(true);
    try { await fn(); }
    catch (e) { this.status('⚠ ' + ((e && e.message) || e), true); this.setBusy(false); this.renderSaved(); }
  }

  /* ---------- worlds this device is logged in to ---------- */
  renderSaved() {
    const list = Logins.all();
    this.ui.saved.innerHTML = list.map(L => `<div class="fworld" data-code="${esc(L.code)}">
      <div class="fw-main"><div class="fw-name">🌾 ${esc(L.roomName || 'Farm World')}</div>
      <div class="fw-sub">code ${esc(L.code)} · you are ${esc(L.name)}${L.isOwner ? ' (owner)' : ''}<span data-live="${esc(L.code)}"></span></div></div>
      <button class="mbig" data-play="${esc(L.code)}">▶ Play</button><button class="fw-x" data-forget="${esc(L.code)}" title="Forget this world on this device">✕</button></div>`).join('');
    if (apiReady()) for (const L of list) this._live(L);
  }
  async _live(L) {
    const span = this.ui.saved.querySelector(`[data-live="${L.code}"]`);
    try {
      const i = await api.info(L);
      if (span) span.textContent = ` · 👥 ${i.members.length}/${i.maxMembers} members · ${i.online ? `🟢 ${i.online} playing now` : 'nobody playing now'}`;
      Logins.touch(L.code, { roomName: i.room.name, name: i.me.name, seat: i.me.seat, isOwner: i.me.isOwner });
    } catch (e) {
      if (span && LOGIN_GONE.has(e.code)) span.textContent = e.code === 'room_not_found' ? ' · ⚠ this world was deleted' : ' · ⚠ log in again';
    }
  }
  _savedClick(e) {
    const play = e.target.closest('[data-play]'), forget = e.target.closest('[data-forget]');
    if (play) { const L = Logins.get(play.dataset.play); if (L) this._run(() => this._open(L)); return; }
    if (forget) {
      if (!forget.classList.contains('sure')) { forget.classList.add('sure'); forget.textContent = 'Forget?'; setTimeout(() => { if (forget.isConnected) { forget.classList.remove('sure'); forget.textContent = '✕'; } }, 2500); return; }
      Logins.forget(forget.dataset.forget); this.renderSaved();
    }
  }

  /* ---------- create / log in / invite ---------- */
  create() {
    const name = $('fcName').value.trim(), world = $('fcWorld').value.trim(), pin = $('fcPin').value;
    if (!name) { this.status('Type your name.', true); $('fcName').focus(); return; }
    if (!PIN.test(pin)) { this.status('Choose a PIN of 4 to 6 digits (you need it to log in on other devices).', true); $('fcPin').focus(); return; }
    this._run(async () => {
      this.status('Creating your world…');
      const r = await api.create(name, pin, world);
      this._rememberName(name);
      await this._open(Logins.save(r), true);
    });
  }
  login() {
    const code = cleanCode($('fjCode').value), name = $('fjName').value.trim(), pin = $('fjPin').value;
    if (code.length !== 6) { this.status('Type the 6-letter world code.', true); $('fjCode').focus(); return; }
    if (!name) { this.status('Type your name in that world.', true); $('fjName').focus(); return; }
    if (!PIN.test(pin)) { this.status('Type your PIN (4 to 6 digits).', true); $('fjPin').focus(); return; }
    this._run(async () => {
      this.status('Logging in…');
      const r = await api.login(code, name, pin);
      this._rememberName(name);
      await this._open(Logins.save(r));
    });
  }
  async _showInvite(code, invite) {
    this.invite = { code, invite };
    this.ui.invite.classList.remove('hidden');
    $('fiInfo').textContent = 'Checking the invite…';
    if (!apiReady()) { $('fiInfo').textContent = 'Farm World is not switched on yet.'; return; }
    try {
      const p = await api.invitePreview(code, invite);
      $('fiWorld').textContent = p.room.name;
      $('fiInfo').textContent = `${p.members}/${p.maxMembers} members so far · pick your name and a PIN you'll remember`;
    } catch (e) {
      $('fiInfo').textContent = '⚠ ' + e.message;
      $('fiGo').classList.add('hidden');
    }
  }
  joinInvite() {
    if (!this.invite) return;
    const name = $('fiName').value.trim(), pin = $('fiPin').value;
    if (!name) { this.status('Type your name.', true); $('fiName').focus(); return; }
    if (!PIN.test(pin)) { this.status('Choose a PIN of 4 to 6 digits (you need it to log in on other devices).', true); $('fiPin').focus(); return; }
    this._run(async () => {
      this.status('Joining the world…');
      const r = await api.join(this.invite.code, this.invite.invite, name, pin);
      this._rememberName(name);
      this._dropInviteFromUrl();
      this.ui.invite.classList.add('hidden');
      await this._open(Logins.save(r), true);
    });
  }
  // join with the world code + invite code typed in (same as the link, for the installed app)
  joinCode() {
    const code = cleanCode($('fnCode').value), invite = cleanInvite($('fnInvite').value), name = $('fnName').value.trim(), pin = $('fnPin').value;
    if (code.length !== 6) { this.status('Type the 6-letter world code from your invite.', true); $('fnCode').focus(); return; }
    if (invite.length < 6) { this.status('Type the invite code from your invite (8 letters and numbers).', true); $('fnInvite').focus(); return; }
    if (!name) { this.status('Type your name.', true); $('fnName').focus(); return; }
    if (!PIN.test(pin)) { this.status('Choose a PIN of 4 to 6 digits (you need it to log in on other devices).', true); $('fnPin').focus(); return; }
    this._run(async () => {
      this.status('Joining the world…');
      const r = await api.join(code, invite, name, pin);
      this._rememberName(name);
      for (const id of ['fnCode', 'fnInvite', 'fnPin']) $(id).value = '';
      await this._open(Logins.save(r), true);
    });
  }
  async _open(L, isNew = false) {
    this.status(`Opening ${L.roomName || 'the world'}…`);
    try { await this.enter(L, t => this.status(t), isNew); }
    catch (e) {
      if (LOGIN_GONE.has(e.code)) { $('fjCode').value = L.code; $('fjName').value = L.name; this.renderSaved(); }
      throw e;
    }
  }
  _rememberName(n) { try { localStorage.setItem('rv-name', n.slice(0, 16)); } catch (e) { /* ignore */ } }
  // a used invite must not be tried again on refresh (keeps ?api= for local testing)
  _dropInviteFromUrl() {
    try { const u = new URL(location.href); u.searchParams.delete('invite'); u.searchParams.delete('farm'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); } catch (e) { /* ignore */ }
  }
}
