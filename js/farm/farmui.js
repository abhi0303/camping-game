// Farm screens: the money bar above the hotbar, the small production panel shown at a plot, and the popups:
// the Farm Store (the farmer's menu), the Market (selling hall + prices + trade log), the farm storage
// (store logs/stones, upgrade), a plot (build), a shelter (animals and timers) and the feeding trough.
// Every button asks the server; the numbers on screen always come from the server's answer.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = t => { const s = (Date.now() - Date.parse(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
// a countdown: 18m 05s · 1h 20m · 2d 3h
export const left = ms => {
  if (!isFinite(ms)) return '—';
  if (ms <= 1000) return 'now';
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
};
const BUY_STEP = { feed: 10, wood: 10, stone: 10 };
const FARM_TITLE = { coop: 'CHICKEN FARM', goat_shed: 'GOAT FARM', barn: 'COW FARM', stable: 'HORSE STABLE' };
const NOUN = { egg: 'egg', egg_brown: 'egg', egg_dark: 'egg', goat_milk: 'milk', cow_milk: 'milk' };
const plural = name => name.toLowerCase() + (/s$/.test(name) ? '' : 's');
// the farmer's menu
const STORE_MENU = [
  ['animals', '🐔', 'Purchase animals', 'chickens, Desi chickens, goats, cows, horses'],
  ['sell', '💰', 'Sell farm products', 'eggs and milk'],
  ['feed', '🌾', 'Purchase animal feed', 'for every animal on the farm'],
  ['supplies', '🧰', 'Purchase farming supplies', 'seeds and tools'],
  ['materials', '🧱', 'Purchase construction materials', 'wood and stone for shelters'],
];
const VEHICLES_UNLOCKED = false;      // (vehicles are not sold yet — the menu shows them once they are)

export class FarmUI {
  // g: { eco, materials, toast, hooks: { onOpen, onClose } }
  constructor(g) {
    this.g = g; this.isOpen = false; this.view = null; this.tab = null; this.qty = {}; this.msg = ''; this.msgErr = false; this.busy = false; this.hist = null;
    this.root = $('farmUI'); this.title = $('fuTitle'); this.body = $('fuBody'); this.bar = $('farmBar'); this.info = $('farmInfo');
    $('fuClose').addEventListener('click', () => this.close());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); else this._click(e); });
    document.addEventListener('keydown', e => { if (this.isOpen && (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'Tab')) { e.preventDefault(); this.close(); } });
    setInterval(() => this._tick(), 1000);
  }
  get eco() { return this.g.eco; }

  open(view, arg) {
    if (!this.eco.ready) { this.g.toast('🌾 The farm is still loading…'); this.eco.load(); return; }
    this.view = view; this.arg = arg; this.msg = ''; this.qty = {}; this.hist = null;
    this.tab = view === 'market' ? 'sell' : null;
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
    const hungry = e.hungryCount();
    const parts = [`<span title="Farm money (shared)">💰 ₹${e.money}</span>`,
      `<span title="Animal feed in the farm storage${hungry ? ` — ${hungry} animal${hungry > 1 ? 's' : ''} hungry` : ''}" class="${hungry ? 'low' : ''}">🌾 ${e.qty('feed')}${hungry ? ` <small>${hungry} hungry</small>` : ''}</span>`];
    for (const k of ['egg', 'egg_brown', 'egg_dark', 'goat_milk', 'cow_milk', 'wood', 'stone']) {
      const n = e.qty(k), c = e.cat(k);
      if (c && (n || e.makesPerHour(k) > 0)) parts.push(`<span title="${esc(c.name)}">${c.icon} ${n}</span>`);
    }
    const html = parts.join('');
    if (html !== this._bar) { this._bar = html; this.bar.innerHTML = html; }
    this.bar.classList.remove('hidden');
  }
  // the small production panel while standing at a plot with a shelter (plot: from farmland.plotAt)
  renderInfo(plot) {
    const bd = plot && plot.bd && this.eco.ready ? this.eco.st.buildings.find(b => b.id === plot.bd.id) : null;
    this._infoBd = bd && !this.isOpen ? bd : null;
    if (!this._infoBd) { if (!this.info.classList.contains('hidden')) this.info.classList.add('hidden'); return; }
    const html = this._infoBox(this._infoBd, true);
    if (html !== this._infoHtml) { this._infoHtml = html; this.info.innerHTML = html; }
    this.info.classList.remove('hidden');
  }
  // timers move every second (the numbers come from the server's time stamps)
  _tick() {
    if (this._infoBd) this.renderInfo({ bd: this._infoBd });
    if (this.isOpen) for (const el of this.body.querySelectorAll('.fi-live')) {
      const bd = this.eco.st.buildings.find(b => b.id === el.dataset.b);
      if (bd) { const h = this._infoBox(bd); if (el.innerHTML !== h) el.innerHTML = h; }
    }
    if (this.isOpen && this.view === 'shelter') for (const el of this.body.querySelectorAll('[data-fu]')) {
      const ms = Date.parse(el.dataset.fu) - this.eco.serverNow();
      el.textContent = ms > 0 ? `fed · ${left(ms)} left` : 'hungry — needs feed';
      el.className = ms > 0 ? 'fu-sub' : 'fu-sub fu-need';
    }
  }
  _infoBox(bd, compact = false) {
    const e = this.eco, k = e.cat(bd.type), a = e.cat(k.animal), I = e.shelterInfo(bd);
    const prods = I.products.length ? I.products : (a.product ? [a.product] : []), noun = NOUN[prods[0]] || 'product';
    const row = (l, v, cls = '') => `<div class="fi-r ${cls}"><span>${l}</span><b>${v}</b></div>`;
    let h = `<div class="fi-t">${a.icon} ${FARM_TITLE[bd.type] || k.name.toUpperCase()} <small>plot ${bd.plot + 1}</small></div>`;
    h += row(`Total ${plural(a.name)}`, `${I.count} / ${k.capacity}`);
    if (!I.count) return h + `<div class="fi-note">No ${plural(a.name)} yet — buy some from the farmer at the Farm Store.</div>`;
    if (prods.length) {
      if (I.paused) h += `<div class="fi-warn">⏸ Production Paused – Feed Required</div>`;
      else if (I.full) h += `<div class="fi-warn">📦 Storage full — sell or upgrade the storage</div>`;
      else h += row(`Next ${noun} in`, isFinite(I.nextMs) ? left(I.nextMs) : 'feed first');
    }
    h += row('Feed due in', I.dueMs <= 0 ? `now · ${I.hungry} hungry` : left(I.dueMs), I.dueMs <= 0 ? 'bad' : I.dueMs < 15 * 60e3 ? 'warn' : '');
    h += row('Feeding duration', compact ? `${I.feedHours} h` : `${I.feedHours} h · ${I.feedCost} feed each`, compact ? 'fi-opt' : '');
    if (prods.length) h += row(`${noun === 'egg' ? 'Eggs' : 'Milk'} available`, prods.map(p => `${e.cat(p).icon} ${e.qty(p)}`).join(' · '));
    if (!compact) h += row('Feed in storage', `🌾 ${e.qty('feed')}`, e.qty('feed') < I.need ? 'warn' : '');
    return h;
  }

  /* ---------- popups ---------- */
  render() {
    if (!this.isOpen) return;
    const e = this.eco, head = `<div class="fu-head"><span class="fu-chip">💰 ₹${e.money}</span><span class="fu-chip">🌾 ${e.qty('feed')} feed</span><span class="fu-chip">🪵 ${e.qty('wood')}</span><span class="fu-chip">🪨 ${e.qty('stone')}</span></div>`;
    let html = '';
    if (this.view === 'store') { this.title.textContent = '🏪 Farm Store'; html = head + this._store(); }
    else if (this.view === 'market') { this.title.textContent = '🛒 Market'; html = head + this._market(); }
    else if (this.view === 'storage') { this.title.textContent = `📦 Farm storage · level ${e.storageLevel}`; html = head + this._storage(); }
    else if (this.view === 'plot') { this.title.textContent = `🌱 Plot ${this.arg + 1}`; html = head + this._plot(this.arg); }
    else if (this.view === 'shelter' || this.view === 'feed') {
      const bd = e.st.buildings.find(b => b.id === this.arg.id);
      if (!bd) { this.close(); return; }
      const k = e.cat(bd.type);
      this.title.textContent = this.view === 'feed' ? `🌾 Feeding trough · plot ${bd.plot + 1}` : `${k.icon} ${k.name} · plot ${bd.plot + 1}`;
      html = head + (this.view === 'feed' ? this._feed(bd) : this._shelter(bd));
    }
    this.body.innerHTML = html + `<div class="fu-msg ${this.msgErr ? 'err' : 'ok'}">${esc(this.msg)}</div>`;
  }
  _q(key, def) { return this.qty[key] ?? def; }
  _stepper(key, val, max) {
    return `<span class="fu-qty"><button data-x="dec" data-k="${key}" ${val <= 1 ? 'disabled' : ''}>−</button><b>${val}</b><button data-x="inc" data-k="${key}" data-max="${max}" ${val >= max ? 'disabled' : ''}>+</button></span>`;
  }
  _tabs(list) { return `<div class="fu-tabs">${list.map(([t, l]) => `<button data-x="tab" data-t="${t}" class="${this.tab === t ? 'on' : ''}">${l}</button>`).join('')}</div>`; }

  // the farmer's store: a menu, then one section
  _store() {
    if (!this.tab) {
      const menu = STORE_MENU.concat(VEHICLES_UNLOCKED ? [['vehicles', '🚜', 'Purchase vehicles', 'carts and tractors']] : []);
      return `<div class="fu-npc"><span class="fu-ico">🧑‍🌾</span><span><b>Farmer:</b> “How can I help you? Do you want to purchase or sell anything?”</span></div>
        <div class="fu-menu">${menu.map(([t, i, l, s]) => `<button data-x="tab" data-t="${t}"><span class="fu-ico">${i}</span><span><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>
        <div class="fu-sub">Selling in bulk, today's prices and the trade log are at the Market next door.</div>`;
    }
    const back = `<button class="fu-back" data-x="tab" data-t="">‹ Back to the menu</button>`;
    if (this.tab === 'animals') return back + this.eco.items('animal').map(k => this._animalRow(k)).join('');
    if (this.tab === 'sell') return back + this._sellRows();
    if (this.tab === 'feed') return back + this._goodRows(['feed']) + '<div class="fu-sub">Each animal eats its feed at the trough: one feeding keeps it fed (and producing) for 2 hours.</div>';
    if (this.tab === 'materials') return back + this._goodRows(['wood', 'stone']) + '<div class="fu-sub">Or chop trees and break rocks, then store the logs and stones at the farm storage — it\'s free.</div>';
    if (this.tab === 'supplies') return back + '<div class="fu-row"><span class="fu-ico">🌱</span><span class="fu-main"><span class="fu-name">Nothing in stock yet</span><span class="fu-sub">Seeds and tools come with the crop fields. Feed is under “Purchase animal feed”.</span></span></div>';
    return back;
  }
  // one animal for sale (shelter: put it in this shelter first)
  _animalRow(k, shelter) {
    const e = this.eco, free = e.freeFor(k.id), home = e.cat(k.shelter), open = e.unlocked(k.id);
    const p = k.product && e.cat(k.product);
    const every = k.rate ? 1 / k.rate : 0, pace = !every ? '' : every === 1 ? '1 an hour' : every < 1 ? `1 every ${Math.round(every * 60)} min` : `1 every ${+every.toFixed(1)} h`;
    const what = p ? `${p.name.toLowerCase()}: ${pace} while fed · ₹${p.sell} each` : 'rides and pulls carts later';
    const feed = `eats ${k.feedCost || 1} feed / ${k.feedHours || 2} h`;
    if (!open) {
      const pct = Math.min(100, Math.round((e.st.totalEarned || 0) / k.unlock * 100));
      return `<div class="fu-row locked"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)} · ₹${k.buy} 🔒</span>
        <span class="fu-sub">${what} · ${feed}</span><span class="fu-sub">Unlocks when the farm has earned ₹${k.unlock} from sales (₹${e.st.totalEarned || 0} so far) <span class="fu-bar wide"><u style="width:${pct}%;background:#f2c14e"></u></span></span></span></div>`;
    }
    const q = Math.min(this._q('b:' + k.id, 1), Math.max(1, free));
    const note = free ? `${free} free place${free > 1 ? 's' : ''} in your ${plural(home.name)}` : `needs a ${home.name.toLowerCase()} with room (build one on a plot)`;
    return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)} · ₹${k.buy}</span><span class="fu-sub">${what} · ${feed} · ${note}</span></span>
      ${free ? this._stepper('b:' + k.id, q, free) : ''}<button class="fu-go" data-x="buy" data-i="${k.id}" data-q="${q}" ${shelter ? `data-s="${shelter}"` : ''} ${!free || e.money < k.buy * q || this.busy ? 'disabled' : ''}>Buy ${q} · ₹${k.buy * q}</button></div>`;
  }
  _goodRows(ids) {
    const e = this.eco;
    return ids.map(id => e.cat(id) && { id, ...e.cat(id) }).filter(k => k && k.buy).map(k => {
      const step = BUY_STEP[k.id] || 1, cap = e.st.caps[k.id], room = Math.max(0, (cap || 1e9) - e.qty(k.id)), q = Math.min(this._q('b:' + k.id, step), Math.max(1, room));
      return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)} · ₹${k.buy}</span><span class="fu-sub">the farm has ${e.qty(k.id)}${cap ? ` / ${cap} (storage limit)` : ''}</span></span>
        ${room ? this._stepper('b:' + k.id, q, room) : ''}<button class="fu-go" data-x="buy" data-i="${k.id}" data-q="${q}" ${!room || e.money < k.buy * q || this.busy ? 'disabled' : ''}>${room ? `Buy ${q} · ₹${k.buy * q}` : 'Storage full'}</button></div>`;
    }).join('');
  }
  _sellRows() {
    const e = this.eco;
    return e.items('good').filter(k => k.sell).map(k => {
      const have = e.qty(k.id), q = Math.min(this._q('s:' + k.id, have), have);
      return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)}</span><span class="fu-sub">₹${k.sell} each · the farm has ${have}</span></span>
        ${have ? this._stepper('s:' + k.id, q, have) : ''}<button class="fu-go sell" data-x="sell" data-i="${k.id}" data-q="${q}" ${!have || this.busy ? 'disabled' : ''}>${have ? `Sell for ₹${k.sell * q}` : 'None yet'}</button></div>`;
    }).join('');
  }
  // the Market: where the farm's produce is sold; prices and the trade log (buying is at the Farm Store)
  _market() {
    const e = this.eco, tabs = this._tabs([['sell', '💰 Sell produce'], ['prices', '📈 Prices'], ['log', '📜 Trade log']]);
    if (this.tab === 'log') {
      if (!this.hist) { this.eco.history().then(h => { this.hist = h; this.render(); }, () => { this.hist = []; this.render(); }); return tabs + '<div class="fu-sub">Loading…</div>'; }
      return tabs + `<div class="fu-hist">${this.hist.length ? this.hist.map(h => `<div><span>${esc(h.message)}</span> <small>${ago(h.at)}</small></div>`).join('') : '<div class="fu-sub">Nothing bought or sold yet.</div>'}</div>`;
    }
    if (this.tab === 'prices') {
      const rows = Object.entries(e.st.catalog).filter(([, k]) => k.kind === 'good' || k.kind === 'animal').map(([id, k]) => `<tr><td>${k.icon} ${esc(k.name)}</td><td>${k.buy ? '₹' + k.buy : '—'}</td><td>${k.sell ? '₹' + k.sell : '—'}</td><td>${k.kind === 'good' ? e.qty(id) : e.count(id)}</td></tr>`).join('');
      return tabs + `<div class="fu-sub">The farm has earned <b>₹${e.st.totalEarned || 0}</b> from sales. Buying is at the Farm Store; selling is here or at the store.</div>
        <table class="fu-table"><tr><th>Item</th><th>Buy</th><th>Sell</th><th>Farm has</th></tr>${rows}</table>`;
    }
    return tabs + this._sellRows() + '<div class="fu-sub">Eggs and milk come from your animals while they are fed — even while nobody is playing.</div>';
  }
  // the farm storage: what it holds, the next level, and storing logs / stones from the team's materials
  _storage() {
    const e = this.eco, lv = e.storageLevel, levels = e.storageLevels(), cur = levels.find(l => l.level === lv) || { mult: 1 }, next = levels.find(l => l.level === lv + 1);
    const goods = e.items('good').filter(k => k.cap);
    const caps = goods.map(k => `<span class="fu-cap">${k.icon} ${e.qty(k.id)} / ${e.st.caps[k.id]}</span>`).join('');
    let up;
    if (next) {
      const miss = [];
      if (e.money < (next.money || 0)) miss.push(`₹${next.money - e.money}`);
      if (e.qty('wood') < (next.wood || 0)) miss.push(`${next.wood - e.qty('wood')} wood`);
      if (e.qty('stone') < (next.stone || 0)) miss.push(`${next.stone - e.qty('stone')} stone`);
      const exp = goods.map(k => `${k.icon} ${Math.round(e.st.caps[k.id] / (cur.mult || 1) * next.mult)}`).join(' · ');
      up = `<div class="fu-row"><span class="fu-ico">⬆️</span><span class="fu-main"><span class="fu-name">Next upgrade: level ${next.level}</span>
          <span class="fu-sub">Cost: ₹${next.money || 0}${next.wood ? ` · 🪵 ${next.wood} wood` : ''}${next.stone ? ` · 🪨 ${next.stone} stone` : ''}</span>
          <span class="fu-sub">Expected capacity: ${exp}</span>${miss.length ? `<span class="fu-sub"><b class="fu-need">Need ${miss.join(', ')} more</b></span>` : ''}</span>
        <button class="fu-go" data-x="upgrade" data-l="${next.level}" ${miss.length || this.busy ? 'disabled' : ''}>Upgrade</button></div>`;
    } else up = `<div class="fu-sub">This is the biggest storage for now.</div>`;
    const m = this.g.materials, logs = m.get('logs'), stones = m.get('stone'), w = Math.min(50, logs), s = Math.min(50, stones);
    return `<div class="fu-row"><span class="fu-ico">📦</span><span class="fu-main"><span class="fu-name">Level ${lv} · capacity</span><span class="fu-caps">${caps}</span></span></div>${up}
      <div class="fu-row"><span class="fu-ico">🎒</span><span class="fu-main"><span class="fu-name">Your team's materials</span><span class="fu-sub">🪵 ${logs} logs · 🪨 ${stones} stones (from chopping trees, rockfalls and crates)</span></span></div>
      <button class="fu-go wide" data-x="deposit" ${(!w && !s) || this.busy ? 'disabled' : ''}>${w || s ? `Store ${[w && `${w} logs`, s && `${s} stones`].filter(Boolean).join(' and ')} in the farm` : 'Nothing to store — chop trees for logs'}</button>
      <div class="fu-sub">Logs become wood, stones stay stones (up to 50 of each at a time). Wood and stone build shelters and upgrade the storage.</div>`;
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
      return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)}</span><span class="fu-sub">${cost} · room for ${k.capacity} ${a.icon} ${plural(a.name)}${miss.length ? ` · <b class="fu-need">need ${miss.join(', ')} more</b>` : ''}</span></span>
        <button class="fu-go" data-x="build" data-t="${k.id}" ${miss.length || this.busy ? 'disabled' : ''}>Build</button></div>`;
    }).join('');
    return rows + '<div class="fu-sub">Wood: chop trees and store the logs at the farm storage, or buy wood from the farmer at the Farm Store.</div>';
  }
  _shelter(bd) {
    const e = this.eco, k = e.cat(bd.type), a = e.cat(k.animal), list = e.animalsIn(bd.id), free = k.capacity - list.length, now = e.serverNow();
    const bar = (v, c) => `<span class="fu-bar"><u style="width:${Math.max(0, Math.min(100, v))}%;background:${c}"></u></span>`;
    const rows = list.map(x => {
      const c = e.cat(x.type), fu = x.fedUntil ? Date.parse(x.fedUntil) : 0, fed = fu > now;
      return `<div class="fu-row small"><span class="fu-ico">${c.icon}</span><span class="fu-main"><span class="fu-name">${esc(c.name)}</span>
        <span data-fu="${x.fedUntil || ''}" class="fu-sub${fed ? '' : ' fu-need'}">${fed ? `fed · ${left(fu - now)} left` : 'hungry — needs feed'}</span></span>
        <span class="fu-sub">❤ ${bar(x.health, x.health > 50 ? '#5bd16a' : x.health > 25 ? '#f2c14e' : '#ff5a4a')}</span></div>`;
    }).join('');
    const kinds = e.items('animal').filter(x => x.shelter === bd.type);
    return `<div class="fi-box fi-live" data-b="${bd.id}">${this._infoBox(bd)}</div>
      <div class="fu-sub">🌾 Feed them at the trough inside the pen: open the gate, walk to the trough and press E. Fed animals produce for ${a.feedHours || 2} h; hungry ones stop and get weak after a day.</div>
      ${rows || ''}
      ${free > 0 ? `<div class="fu-sub" style="margin-top:8px"><b>Add ${plural(a.name)} to this ${k.name.toLowerCase()} (${free} free)</b></div>${kinds.map(x => this._animalRow(x, bd.id)).join('')}` : '<div class="fu-sub">This shelter is full. Build another on an empty plot.</div>'}`;
  }
  // the feeding trough: feed everyone, or only some (the hungriest first). The server checks the feed.
  _feed(bd) {
    const e = this.eco, k = e.cat(bd.type), a = e.cat(k.animal), I = e.shelterInfo(bd), feed = e.qty('feed'), cost = I.feedCost;
    if (!I.count) return `<div class="fi-box fi-live" data-b="${bd.id}">${this._infoBox(bd)}</div>`;
    const canAll = Math.min(I.count, Math.floor(feed / cost)), q = Math.min(this._q('f', Math.max(1, I.hungry || 1)), I.count);
    return `<div class="fi-box fi-live" data-b="${bd.id}">${this._infoBox(bd)}</div>
      <div class="fu-sub">Each ${a.name.toLowerCase()} eats ${cost} feed and stays fed ${I.feedHours} h longer (up to a day ahead). The hungriest are fed first.${feed < cost * I.count ? ` <b class="fu-need">The storage has feed for ${canAll} of ${I.count}.</b>` : ''}</div>
      <button class="fu-go wide" data-x="feedall" ${feed < cost || this.busy ? 'disabled' : ''}>🌾 Feed all ${I.count} ${plural(a.name)} · uses up to ${cost * I.count} feed</button>
      <div class="fu-row"><span class="fu-ico">🐣</span><span class="fu-main"><span class="fu-name">Feed selected</span><span class="fu-sub">how many to feed</span></span>
        ${this._stepper('f', q, I.count)}<button class="fu-go" data-x="feedn" data-q="${q}" ${feed < cost || this.busy ? 'disabled' : ''}>Feed ${q} · ${q * cost} feed</button></div>
      ${feed < cost ? '<div class="fu-sub fu-need">No feed left — buy feed from the farmer at the Farm Store (across the road).</div>' : ''}`;
  }

  /* ---------- buttons ---------- */
  async _click(ev) {
    const b = ev.target.closest('[data-x]');
    if (!b || b.disabled) return;
    ev.preventDefault(); ev.stopPropagation();
    const x = b.dataset.x;
    if (x === 'tab') { this.tab = b.dataset.t || null; this.msg = ''; this.qty = {}; if (this.tab === 'log') this.hist = null; this.render(); return; }
    if (x === 'inc' || x === 'dec') {
      const k = b.dataset.k, step = k.startsWith('b:') ? (BUY_STEP[k.slice(2)] || 1) : 1, cur = Number(b.parentElement.querySelector('b').textContent);
      this.qty[k] = Math.max(1, Math.min(Number(b.dataset.max || 1e9), cur + (x === 'inc' ? step : -step)));
      this.render(); return;
    }
    if (x === 'buy') await this._do({ action: 'buy', item: b.dataset.i, qty: Number(b.dataset.q), ...(b.dataset.s ? { shelter: b.dataset.s } : {}) });
    else if (x === 'sell') await this._do({ action: 'sell', item: b.dataset.i, qty: Number(b.dataset.q) }, () => { delete this.qty['s:' + b.dataset.i]; });
    else if (x === 'build') await this._do({ action: 'build', type: b.dataset.t, plot: this.arg }, r => { const bd = r.buildings.find(q => q.plot === this.arg); if (bd) { this.view = 'shelter'; this.arg = bd; } });
    else if (x === 'upgrade') await this._do({ action: 'upgrade', target: 'storage', level: Number(b.dataset.l) });
    else if (x === 'feedall') await this._do({ action: 'feed', shelter: this.arg.id, all: true });
    else if (x === 'feedn') await this._do({ action: 'feed', shelter: this.arg.id, count: Number(b.dataset.q) }, () => { delete this.qty.f; });
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
