// Farm screens: the money bar above the hotbar, and the popups for the market, the farm store,
// an empty plot (build a shelter) and a shelter (its animals). Every button asks the server; the
// numbers on screen always come from the server's answer.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hrs = h => (!isFinite(h) ? '' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
const ago = t => { const s = (Date.now() - Date.parse(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const BUY_STEP = { feed: 10, wood: 10, stone: 10 };

export class FarmUI {
  // g: { eco, materials, toast, hooks: { onOpen, onClose } }
  constructor(g) {
    this.g = g; this.isOpen = false; this.view = null; this.tab = 'buy'; this.qty = {}; this.msg = ''; this.msgErr = false; this.busy = false; this.hist = null;
    this.root = $('farmUI'); this.title = $('fuTitle'); this.body = $('fuBody'); this.bar = $('farmBar');
    $('fuClose').addEventListener('click', () => this.close());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); else this._click(e); });
    document.addEventListener('keydown', e => { if (this.isOpen && (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'Tab')) { e.preventDefault(); this.close(); } });
  }
  get eco() { return this.g.eco; }

  open(view, arg) {
    if (!this.eco.ready) { this.g.toast('🌾 The farm is still loading…'); this.eco.load(); return; }
    this.view = view; this.arg = arg; this.msg = ''; this.qty = {}; this.hist = null;
    if (view === 'market') this.tab = 'buy';
    if (!this.isOpen) { this.isOpen = true; this.root.classList.remove('hidden'); this.g.hooks.onOpen && this.g.hooks.onOpen(); }
    this.render();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false; this.root.classList.add('hidden');
    this.g.hooks.onClose && this.g.hooks.onClose();
  }

  /* ---------- HUD: money and goods ---------- */
  renderBar(active) {
    const e = this.eco;
    if (!active || !e.ready) { this.bar.classList.add('hidden'); return; }
    const parts = [`<span title="Farm money (shared)">💰 ₹${e.money}</span>`];
    const fh = e.feedHours();
    parts.push(`<span title="Animal feed${isFinite(fh) ? ` — lasts about ${hrs(fh)}` : ''}" class="${isFinite(fh) && fh < 3 ? 'low' : ''}">🌾 ${e.qty('feed')}${isFinite(fh) ? ` <small>${hrs(fh)}</small>` : ''}</span>`);
    for (const k of ['egg', 'goat_milk', 'cow_milk', 'wood', 'stone']) {
      const n = e.qty(k), c = e.cat(k);
      if (n || (c && e.makesPerHour(k) > 0)) parts.push(`<span title="${esc(c.name)}">${c.icon} ${n}</span>`);
    }
    const html = parts.join('');
    if (html !== this._bar) { this._bar = html; this.bar.innerHTML = html; }
    this.bar.classList.remove('hidden');
  }

  /* ---------- popups ---------- */
  render() {
    if (!this.isOpen) return;
    const e = this.eco, head = `<div class="fu-head"><span class="fu-chip">💰 ₹${e.money}</span><span class="fu-chip">🌾 ${e.qty('feed')} feed</span><span class="fu-chip">🪵 ${e.qty('wood')}</span><span class="fu-chip">🪨 ${e.qty('stone')}</span></div>`;
    let html = '';
    if (this.view === 'market') { this.title.textContent = '🛒 Market'; html = head + this._market(); }
    else if (this.view === 'store') { this.title.textContent = '🪵 Farm store'; html = head + this._store(); }
    else if (this.view === 'plot') { this.title.textContent = `🌱 Plot ${this.arg + 1}`; html = head + this._plot(this.arg); }
    else if (this.view === 'shelter') {
      const bd = e.st.buildings.find(b => b.id === this.arg.id) || this.arg, k = e.cat(bd.type);
      this.title.textContent = `${k.icon} ${k.name} · plot ${bd.plot + 1}`; html = head + this._shelter(bd);
    }
    this.body.innerHTML = html + `<div class="fu-msg ${this.msgErr ? 'err' : 'ok'}">${esc(this.msg)}</div>`;
  }
  _q(key, def) { return this.qty[key] ?? def; }
  _stepper(key, val, max) {
    return `<span class="fu-qty"><button data-x="dec" data-k="${key}" ${val <= 1 ? 'disabled' : ''}>−</button><b>${val}</b><button data-x="inc" data-k="${key}" data-max="${max}" ${val >= max ? 'disabled' : ''}>+</button></span>`;
  }
  _market() {
    const e = this.eco, tabs = `<div class="fu-tabs">${[['buy', '🛍 Buy'], ['sell', '💰 Sell'], ['log', '📜 Recent']].map(([t, l]) => `<button data-x="tab" data-t="${t}" class="${this.tab === t ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (this.tab === 'log') {
      if (!this.hist) { this.eco.history().then(h => { this.hist = h; this.render(); }, () => { this.hist = []; this.render(); }); return tabs + '<div class="fu-sub">Loading…</div>'; }
      return tabs + `<div class="fu-hist">${this.hist.length ? this.hist.map(h => `<div><span>${esc(h.message)}</span> <small>${ago(h.at)}</small></div>`).join('') : '<div class="fu-sub">Nothing bought or sold yet.</div>'}</div>`;
    }
    if (this.tab === 'sell') {
      const rows = e.items('good').filter(k => k.sell).map(k => {
        const have = e.qty(k.id), q = Math.min(this._q('s:' + k.id, have), have);
        return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)}</span><span class="fu-sub">₹${k.sell} each · the farm has ${have}</span></span>
          ${have ? this._stepper('s:' + k.id, q, have) : ''}<button class="fu-go sell" data-x="sell" data-i="${k.id}" data-q="${q}" ${!have || this.busy ? 'disabled' : ''}>${have ? `Sell for ₹${k.sell * q}` : 'None yet'}</button></div>`;
      }).join('');
      return tabs + rows + '<div class="fu-sub">Eggs and milk come from your animals, even while nobody is playing.</div>';
    }
    const animals = e.items('animal').map(k => {
      const free = e.freeFor(k.id), home = e.cat(k.shelter), q = Math.min(this._q('b:' + k.id, 1), Math.max(1, free));
      const what = k.product ? `makes ${e.cat(k.product).name.toLowerCase()} · eats ${k.feed} feed/h` : `eats ${k.feed} feed/h · rides and pulls carts later`;
      const note = free ? `${free} free place${free > 1 ? 's' : ''} in your ${home.name.toLowerCase()}s` : `needs a ${home.name.toLowerCase()} with room (build one on a plot)`;
      return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)} · ₹${k.buy}</span><span class="fu-sub">${what} · ${note}</span></span>
        ${free ? this._stepper('b:' + k.id, q, free) : ''}<button class="fu-go" data-x="buy" data-i="${k.id}" data-q="${q}" ${!free || e.money < k.buy * q || this.busy ? 'disabled' : ''}>Buy ${q} · ₹${k.buy * q}</button></div>`;
    }).join('');
    const goods = e.items('good').filter(k => k.buy).map(k => {
      const step = BUY_STEP[k.id] || 1, room = Math.max(0, (k.cap || 1e9) - e.qty(k.id)), q = Math.min(this._q('b:' + k.id, step), Math.max(1, room));
      return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)} · ₹${k.buy}</span><span class="fu-sub">the farm has ${e.qty(k.id)}${k.cap ? ` / ${k.cap}` : ''}</span></span>
        ${room ? this._stepper('b:' + k.id, q, room) : ''}<button class="fu-go" data-x="buy" data-i="${k.id}" data-q="${q}" ${!room || e.money < k.buy * q || this.busy ? 'disabled' : ''}>Buy ${q} · ₹${k.buy * q}</button></div>`;
    }).join('');
    return tabs + animals + goods;
  }
  _store() {
    const e = this.eco, m = this.g.materials, logs = m.get('logs'), stones = m.get('stone');
    const w = Math.min(50, logs), s = Math.min(50, stones);
    return `<div class="fu-row"><span class="fu-ico">🎒</span><span class="fu-main"><span class="fu-name">Your team's materials</span><span class="fu-sub">🪵 ${logs} logs · 🪨 ${stones} stones (from chopping trees, rockfalls and crates)</span></span></div>
      <div class="fu-row"><span class="fu-ico">🏡</span><span class="fu-main"><span class="fu-name">In the farm</span><span class="fu-sub">🪵 ${e.qty('wood')} wood · 🪨 ${e.qty('stone')} stone — used to build shelters</span></span></div>
      <button class="fu-go wide" data-x="deposit" ${(!w && !s) || this.busy ? 'disabled' : ''}>${w || s ? `Put ${[w && `${w} logs`, s && `${s} stones`].filter(Boolean).join(' and ')} in the farm` : 'Nothing to put in — chop trees for logs'}</button>
      <div class="fu-sub">Logs become wood, stones stay stones (up to 50 of each at a time). Planks stay with you for the bridge.</div>`;
  }
  _plot(i) {
    const e = this.eco;
    const rows = e.items('building').map(k => {
      const miss = [];
      if (e.money < k.buy) miss.push(`₹${k.buy - e.money}`);
      if (e.qty('wood') < (k.wood || 0)) miss.push(`${k.wood - e.qty('wood')} wood`);
      if (e.qty('stone') < (k.stone || 0)) miss.push(`${k.stone - e.qty('stone')} stone`);
      const cost = [`₹${k.buy}`, k.wood && `🪵 ${k.wood}`, k.stone && `🪨 ${k.stone}`].filter(Boolean).join(' · ');
      const a = e.cat(k.animal);
      return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)}</span><span class="fu-sub">${cost} · room for ${k.capacity} ${a.icon} ${a.name.toLowerCase()}s${miss.length ? ` · <b class="fu-need">need ${miss.join(', ')} more</b>` : ''}</span></span>
        <button class="fu-go" data-x="build" data-t="${k.id}" ${miss.length || this.busy ? 'disabled' : ''}>Build</button></div>`;
    }).join('');
    return rows + '<div class="fu-sub">Wood: chop trees and put the logs in the Farm store, or buy wood at the Market.</div>';
  }
  _shelter(bd) {
    const e = this.eco, k = e.cat(bd.type), a = e.cat(k.animal), list = e.animalsIn(bd.id), free = k.capacity - list.length;
    const bar = (v, c) => `<span class="fu-bar"><u style="width:${Math.max(0, Math.min(100, v))}%;background:${c}"></u></span>`;
    const rows = list.map((x, n) => {
      const st = x.hunger >= 100 ? '😣 starving' : x.hunger > 50 ? '😕 hungry' : x.health < 40 ? '🤒 weak' : a.product ? `🙂 making ${e.cat(a.product).name.toLowerCase()}` : '🙂 happy';
      return `<div class="fu-row small"><span class="fu-ico">${a.icon}</span><span class="fu-main"><span class="fu-name">${a.name} ${n + 1}</span><span class="fu-sub">${st}</span></span>
        <span class="fu-sub">❤ ${bar(x.health, x.health > 50 ? '#5bd16a' : x.health > 25 ? '#f2c14e' : '#ff5a4a')}</span><span class="fu-sub">🍽 ${bar(100 - x.hunger, '#d8b24e')}</span></div>`;
    }).join('');
    const prod = a.product ? `${e.cat(a.product).icon} about ${(list.reduce((t, x) => t + a.rate * x.health / 100, 0)).toFixed(1)} ${e.cat(a.product).name.toLowerCase()} per hour` : '';
    const fh = e.feedHours();
    return `<div class="fu-sub">${list.length}/${k.capacity} ${a.name.toLowerCase()}s${prod ? ' · ' + prod : ''} · animals eat from the farm's feed (${isFinite(fh) ? `lasts about ${hrs(fh)}` : 'no animals eating'}). Hungry animals stop producing and get weak.</div>
      ${rows || `<div class="fu-sub">No ${a.name.toLowerCase()}s yet.</div>`}
      ${free > 0 ? `<button class="fu-go wide" data-x="buy" data-i="${k.animal}" data-q="1" ${e.money < a.buy || this.busy ? 'disabled' : ''}>Buy a ${a.name.toLowerCase()} · ₹${a.buy}</button>` : '<div class="fu-sub">This shelter is full. Build another on an empty plot.</div>'}
      <button class="fu-go wide alt" data-x="market">🛒 Open the market (feed, selling)</button>`;
  }

  /* ---------- buttons ---------- */
  async _click(ev) {
    const b = ev.target.closest('[data-x]');
    if (!b || b.disabled) return;
    ev.preventDefault(); ev.stopPropagation();
    const x = b.dataset.x;
    if (x === 'tab') { this.tab = b.dataset.t; this.msg = ''; if (this.tab === 'log') this.hist = null; this.render(); return; }
    if (x === 'inc' || x === 'dec') {
      const k = b.dataset.k, step = k.startsWith('b:') ? (BUY_STEP[k.slice(2)] || 1) : 1, cur = Number(b.parentElement.querySelector('b').textContent);
      this.qty[k] = Math.max(1, Math.min(Number(b.dataset.max || 1e9), cur + (x === 'inc' ? step : -step)));
      this.render(); return;
    }
    if (x === 'market') { this.open('market'); return; }
    if (x === 'buy') await this._do({ action: 'buy', item: b.dataset.i, qty: Number(b.dataset.q) });
    else if (x === 'sell') await this._do({ action: 'sell', item: b.dataset.i, qty: Number(b.dataset.q) }, () => { delete this.qty['s:' + b.dataset.i]; });
    else if (x === 'build') await this._do({ action: 'build', type: b.dataset.t, plot: this.arg }, r => { const bd = r.buildings.find(q => q.plot === this.arg); if (bd) { this.view = 'shelter'; this.arg = bd; } });
    else if (x === 'deposit') await this._deposit();
  }
  async _do(body, after) {
    if (this.busy) return;
    this.busy = true; this.msg = 'Working…'; this.msgErr = false; this.render();
    try {
      const r = await this.eco.act(body);
      this.msg = '✅ ' + r.message; this.msgErr = false; this.hist = null;
      this.g.toast('✅ ' + r.message);
      if (after) after(r);
    } catch (e) { this.msg = '⚠ ' + (e.message || e); this.msgErr = true; }
    this.busy = false; this.render();
  }
  // logs / stones leave the team's materials first; whatever the farm couldn't take comes back
  async _deposit() {
    const m = this.g.materials, w = Math.min(50, m.get('logs')), s = Math.min(50, m.get('stone'));
    if (!w && !s) return;
    m.delta({ logs: -w, stone: -s });
    let back = { logs: w, stone: s };
    await this._do({ action: 'deposit', items: { wood: w, stone: s } }, r => { back = { logs: w - (r.result.wood || 0), stone: s - (r.result.stone || 0) }; });
    if (back.logs || back.stone) m.delta(back);
  }
}
