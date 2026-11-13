// Farm screens: the floating bag / order buttons (drawn by notebook.js), the small production panel shown at a plot, and the popups:
// the Farm Store (the farmer's menu), the Market (selling hall + prices + trade log), the farm storage
// (store logs/stones, upgrade), a plot (build), a shelter (animals and timers), the feeding trough and the
// Fish Market (its screens are in js/fishing/marketui.js).
// Every button asks the server; the numbers on screen always come from the server's answer.
import { fishMarketView, fishHead } from '../fishing/marketui.js';
import { icon } from '../icons.js';
import { mineView, flourView, machineClick } from './machines/machineUI.js';
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
// a timer as on a clock: 02:15 · 1:05:30
export const clock = ms => {
  if (!isFinite(ms)) return '--:--';
  const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
};
const eggsText = n => (n === 1 ? '1 Egg Ready to Collect' : `${n} Eggs Ready to Collect`);
// the numbers of a shelter: label / value rows in the small HUD panel, a grid of tiles in the popups
function stats(compact) {
  const tiles = [];
  return {
    row: (l, v, cls = '') => (compact ? `<div class="fi-r ${cls}"><span>${l}</span><b>${v}</b></div>` : (tiles.push(`<div class="fi-tile ${cls}"><b>${v}</b><small>${l}</small></div>`), '')),
    tiles: () => (tiles.length ? `<div class="fi-tiles">${tiles.join('')}</div>` : ''),
  };
}
const BUY_STEP = { feed: 10, wood: 10, stone: 10, wheatin: 10 };
const FARM_TITLE = { coop: 'CHICKEN FARM', goat_shed: 'GOAT FARM', barn: 'COW FARM', stable: 'HORSE STABLE' };
const NOUN = { egg: 'egg', egg_brown: 'egg', egg_dark: 'egg', goat_milk: 'milk', cow_milk: 'milk' };
const plural = name => name.toLowerCase() + (/s$/.test(name) ? '' : 's');
// what a shelter's animals are called (a coop holds every chicken variety)
const kind = a => (a.nest ? 'Chicken' : a.grow ? 'Horse' : a.name);
const coat = k => (k && k.coat ? `<i class="coat" style="background:${k.coat}"></i>` : '');
// the farmer's menu
const STORE_MENU = [
  ['animals', '🐔', 'Buy animals', 'chickens, goats, cows, horses'],
  ['sell', '💰', 'Sell produce', 'eggs and milk'],
  ['feed', '🌾', 'Buy feed', 'for every animal · bones and treats for dogs'],
  ['dogs', '🐕', 'Guard dogs', 'keep thieves away from your eggs'],
  ['materials', '🧱', 'Building materials', 'wood and stone'],
  ['orders', '📜', 'Customer orders', '10% extra · daily streak'],
  ['fields', '🌾', 'Fields, seeds & scarecrows', 'grow wheat by the big windmill'],
  ['clothes', '👒', 'Clothes', 'the farmer outfit'],
];
const VEHICLES_UNLOCKED = false;      // (vehicles are not sold yet — the menu shows them once they are)

export class FarmUI {
  // g: { eco, materials, toast, hooks: { onOpen, onClose }, beforeOpen() } · this.book: the notebook (floating buttons)
  constructor(g) {
    this.g = g; this.isOpen = false; this.view = null; this.tab = null; this.qty = {}; this.msg = ''; this.msgErr = false; this.busy = false; this.hist = null;
    this.root = $('farmUI'); this.title = $('fuTitle'); this.body = $('fuBody'); this.info = $('farmInfo');
    $('fuClose').addEventListener('click', () => this.close());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); else this._click(e); });
    document.addEventListener('keydown', e => { if (this.isOpen && (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'Tab')) { e.preventDefault(); this.close(); } });
    setInterval(() => this._tick(), 1000);
  }
  get eco() { return this.g.eco; }

  open(view, arg) {
    if (!this.eco.ready) { this.g.toast('🌾 The farm is still loading…'); this.eco.load(); return; }
    if (this.g.beforeOpen) this.g.beforeOpen();
    this.view = view; this.arg = arg; this.msg = ''; this.qty = {}; this.hist = null; this._confirm = null;
    this.tab = view === 'market' ? 'orders' : null;
    if (!this.isOpen) { this.isOpen = true; this.root.classList.remove('hidden'); this.g.hooks.onOpen && this.g.hooks.onOpen(); }
    this.render();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false; this.root.classList.add('hidden');
    this.g.hooks.onClose && this.g.hooks.onClose();
  }

  /* ---------- HUD: the floating bag (money) and order-slip buttons (js/farm/notebook.js) ---------- */
  renderBar(active) {
    this._barOn = active;
    if (this.book) this.book.renderFabs(active);
  }
  // the small production panel while standing at a plot with a shelter (plot: from farmland.plotAt)
  renderInfo(plot) {
    const bd = plot && plot.bd && this.eco.ready ? this.eco.st.buildings.find(b => b.id === plot.bd.id) : null;
    this._infoBd = bd && !this.isOpen ? bd : null;
    if (!this._infoBd) { if (!this.info.classList.contains('hidden')) this.info.classList.add('hidden'); return; }
    const html = this._infoBox(this._infoBd, true);
    if (html !== this._infoHtml) { this._infoHtml = html; this.info.innerHTML = html; }
    this.info.classList.remove('hidden');
    // phones: the touch buttons fill the right side, so the panel sits on the left, under the team list
    if (document.body.classList.contains('touch')) {
      const t = $('team'), ref = t && !t.classList.contains('hidden') ? t : $('objective');
      const top = Math.round(ref.getBoundingClientRect().bottom - $('hud').getBoundingClientRect().top + 6) + 'px';
      if (this.info.style.top !== top) this.info.style.top = top;
    }
  }
  // timers move every second (the numbers come from the server's time stamps)
  _tick() {
    if (this._infoBd) this.renderInfo({ bd: this._infoBd });
    if (this.isOpen) for (const el of this.body.querySelectorAll('.fi-live')) {
      const bd = this.eco.st.buildings.find(b => b.id === el.dataset.b);
      if (bd) { const h = this._infoBox(bd); if (el._h !== h) { el._h = h; el.innerHTML = h; } }
    }
    if (this.isOpen) for (const el of this.body.querySelectorAll('.fu-animals')) {
      const bd = this.eco.st.buildings.find(b => b.id === el.dataset.b);
      if (bd) { const h = this._animalRows(bd); if (el._h !== h) { el._h = h; el.innerHTML = h; } }
    }
    if (this.isOpen) {
      let due = false;
      for (const el of this.body.querySelectorAll('[data-cd]')) {
        const ms = Date.parse(el.dataset.cd) - this.eco.serverNow();
        if (ms <= 0 && el.dataset.re) due = true;
        const t = clock(ms); if (el.textContent !== t) el.textContent = t;
      }
      if (due) this.render();
    }
    if (this.isOpen && this.view === 'field' && !this.busy && (this._ft = (this._ft || 0) + 1) % 5 === 0) this.render();   // (the growing bar moves on)
    if (this.isOpen && (this.view === 'mine' || this.view === 'flour') && !this.busy && (this._mt = (this._mt || 0) + 1) % 2 === 0) this.render();
    if (this._barOn) { this.renderBar(true); this._orderAlert(); }
  }
  // a new order is ready: tell the players once
  _orderAlert() {
    const R = this.eco.rentals(), now = this.eco.serverNow();
    for (const r of R || []) {
      if (r.status !== 'offer' || Date.parse(r.expiresAt) <= now || (this._alerted || (this._alerted = new Set())).has(r.id)) continue;
      this._alerted.add(r.id);
      this.g.toast(`🐎 ${r.renter} wants ${r.horses} horse${r.horses > 1 ? 's' : ''} for ${r.hours} h — ₹${r.pay}. Hand ${r.horses > 1 ? 'them' : 'it'} over at the Market (Orders)`);
    }
    const { ready } = this.eco.orderNow();
    if (!ready || (this._alerted || (this._alerted = new Set())).has(ready.id)) return;
    this._alerted.add(ready.id);
    const e = this.eco, what = ready.items.map(x => `${x.qty} ${(e.cat(x.item) || {}).name || x.item}`.toLowerCase()).join(', ');
    this.g.toast(`📜 New order at the Market from ${ready.customer}: ${what} — pays ₹${ready.pay}`);
  }
  _infoBox(bd, compact = false) {
    const e = this.eco, k = e.cat(bd.type), a = e.cat(k.animal), I = e.shelterInfo(bd);
    if (I.nests) return this._coopBox(bd, k, a, I, compact);
    if (a && a.grow) return this._stableBox(bd, k, a, I, compact);
    const prods = I.products.length ? I.products : (a.product ? [a.product] : []), noun = NOUN[prods[0]] || 'product';
    const S = stats(compact), row = S.row;
    let h = `<div class="fi-t">${a.icon} ${FARM_TITLE[bd.type] || k.name.toUpperCase()} <small>plot ${bd.plot + 1}</small></div>`, warn = '';
    h += row(compact ? `Total ${plural(a.name)}` : plural(a.name), `${I.count} / ${k.capacity}`);
    if (!I.count) return h + S.tiles() + `<div class="fi-note">No ${plural(a.name)} yet — buy some from the farmer at the Farm Store.</div>`;
    if (prods.length) {
      if (I.paused) warn = `<div class="fi-warn">⏸ Production paused — feed required</div>`;
      else if (I.full) warn = `<div class="fi-warn">📦 Storage full — sell or upgrade the storage</div>`;
      else h += row(`Next ${noun} in`, isFinite(I.nextMs) ? left(I.nextMs) : 'feed first');
    }
    h += row('Feed due in', I.dueMs <= 0 ? `now · ${I.hungry} hungry` : left(I.dueMs), I.dueMs <= 0 ? 'bad' : I.dueMs < 15 * 60e3 ? 'warn' : '');
    if (compact) h += row('Feeding duration', `${I.feedHours} h`, 'fi-opt');
    if (prods.length) h += row(compact ? `${noun === 'egg' ? 'Eggs' : 'Milk'} available` : 'in storage', prods.map(p => `${e.cat(p).icon} ${e.qty(p)}`).join(' · '));
    if (!compact) h += row('feed in store', `🌾 ${e.qty('feed')}`, e.qty('feed') < I.need ? 'warn' : '');
    return compact ? h + warn : h + warn + S.tiles();
  }

  // the chicken farm: every chicken has its own egg timer and nest box; the panel shows the shortest timer
  // (the next egg), the eggs waiting to be collected and the feeding. Colours: green laying · yellow an egg
  // is almost there · blue eggs ready · red feed required.
  _coopBox(bd, k, a, I, compact) {
    const e = this.eco, feed = e.qty('feed'), S = stats(compact), row = S.row;
    let h = `<div class="fi-t">${a.icon} ${FARM_TITLE[bd.type]} <small>plot ${bd.plot + 1}</small></div>`;
    h += row(compact ? 'Total chickens' : 'chickens', `${I.count} / ${k.capacity}`);
    if (!I.count) return h + S.tiles() + `<div class="fi-note">No chickens yet — buy some from the farmer at the Farm Store.</div>`;
    const st = I.paused ? ['red', '⚠ Feed required'] : I.ready ? ['blue', compact ? `🥚 ${I.ready} egg${I.ready > 1 ? 's' : ''} ready` : `🥚 ${eggsText(I.ready)}`]
      : I.soon ? ['yellow', `⏳ Next egg in ${clock(I.nextMs)}`] : isFinite(I.nextMs) ? ['green', '🐣 Laying eggs'] : ['red', '⚠ Feed required'];
    h += `<div class="fi-st ${st[0]}">${st[1]}</div>`;
    const kinds = Object.entries(I.kinds).map(([t, n]) => { const c = e.cat(t); return compact ? `${c.icon} ${n}` : `${c.icon} ${n} ${esc(c.variety || c.name)}`; });
    h += row(compact ? 'Eggs ready' : 'eggs ready', I.ready ? Object.entries(I.readyBy).filter(([, n]) => n).map(([p, n]) => `${e.cat(p).icon} ${n}`).join(' · ') : '0', I.ready ? 'blue' : '');
    const allFull = I.nestsFull && I.nestsFull >= I.fed;
    h += row(compact ? 'Next egg in' : 'next egg', isFinite(I.nextMs) ? clock(I.nextMs) : allFull && !I.paused ? 'nests full' : 'feed first', isFinite(I.nextMs) ? (I.soon ? 'yellow' : 'green') : allFull && !I.paused ? 'blue' : 'bad');
    h += row(compact ? 'Feeding left' : 'fed for', I.dueMs <= 0 ? `hungry · ${I.hungry}` : clock(I.dueMs), I.dueMs <= 0 ? 'bad' : I.dueMs < 15 * 60e3 ? 'warn' : 'green');
    h += row(compact ? 'Feed needed' : 'feed needed · in store', `${I.need} · 🌾 ${feed}`, feed < I.need ? 'bad' : '');
    h += row(compact ? 'Varieties' : 'varieties', kinds.join(compact ? ' ' : ' · '), compact ? 'fi-opt' : 'fi-wrap');
    const warn = I.nestsFull ? `<div class="fi-warn blue">🪺 ${I.nestsFull} nest${I.nestsFull > 1 ? 's' : ''} full — collect the eggs so ${I.nestsFull > 1 ? 'they keep' : 'it keeps'} laying</div>` : '';
    if (compact) return h + warn;
    return h + S.tiles() + warn + `<button class="fu-go wide collect" data-x="collect" data-b="${bd.id}" ${!I.ready || this.busy ? 'disabled' : ''}>${I.ready ? `🥚 Collect ${I.ready} egg${I.ready > 1 ? 's' : ''}` : '🪺 No eggs to collect yet'}</button>`;
  }
  // the animals of a shelter, one row each (moved every second while the popup is open)
  _animalRows(bd) {
    const e = this.eco, now = e.serverNow(), list = e.animalsIn(bd.id);
    const bar = (v, c) => `<span class="fu-bar"><u style="width:${Math.max(0, Math.min(100, v))}%;background:${c}"></u></span>`;
    const health = x => `<span class="fu-sub">❤ ${bar(x.health, x.health > 50 ? '#5bd16a' : x.health > 25 ? '#f2c14e' : '#ff5a4a')}</span>`;
    return list.map((x, i) => {
      const c = e.cat(x.type), fu = x.fedUntil ? Date.parse(x.fedUntil) : 0, fed = fu > now;
      if (c.grow) {                                   // a horse: its level, growing while fed; out on rent; sell it
        const hs = e.horseOf(x, now), price = e.horsePrice(c, hs.level), at = ms => new Date(e.serverNow() + ms).toISOString();
        const col = hs.away ? 'blue' : hs.ready ? 'blue' : !hs.fed ? 'red' : 'green';
        const what = hs.away ? `Out on rent — back in <b data-cd="${x.rentedUntil}" data-re="1">${clock(hs.backMs)}</b>` : hs.ready ? 'Ready to rent or sell'
          : !hs.fed ? 'Hungry — not growing' : `Level ${hs.level + 1} in <b data-cd="${at(hs.nextMs)}" data-re="1">${clock(hs.nextMs)}</b>`;
        const sell = hs.away ? '' : this._confirm === x.id ? `<button class="fu-go sell" data-x="sellhorse" data-a="${x.id}" ${this.busy ? 'disabled' : ''}>Sure? Sell · ₹${price}</button>`
          : `<button class="fu-go alt" data-x="sellask" data-a="${x.id}">Sell · ₹${price}</button>`;
        return `<div class="fu-row small hen ${col}"><span class="fu-ico">🐎</span><span class="fu-main"><span class="fu-name">${coat(c)}${esc(c.variety || c.name)} <small>#${i + 1} · Level ${hs.level} / ${hs.max}${hs.level <= 3 ? ' · baby' : ''}</small></span>
          <span class="fu-sub"><span class="hen-t">${what}</span> ${bar(hs.pct * 100, { blue: '#5aa9ff', red: '#ff5a4a', green: '#5bd16a' }[col])}</span>
          <span class="fu-sub">${hs.away ? 'looked after by the renter' : hs.fed ? `fed ${clock(hs.fedMs)}` : '<b class="fu-need">hungry</b>'}</span></span>${health(x)}${sell}</div>`;
      }
      if (c.nest) {                                   // a chicken: its own egg timer and nest box
        const n = e.nestOf(x, now), col = !n.fed ? 'red' : n.full ? 'blue' : n.nextMs < 30e3 ? 'yellow' : 'green';
        const what = !n.fed ? 'Feed required' : n.full ? 'Nest full — collect the eggs' : `Next egg in ${clock(n.nextMs)}`;
        return `<div class="fu-row small hen ${col}"><span class="fu-ico">${c.icon}</span><span class="fu-main"><span class="fu-name">${esc(c.variety || c.name)} <small>#${i + 1} · 1 egg / ${c.eggMinutes} min</small></span>
          <span class="fu-sub"><b class="hen-t">${what}</b> ${bar(n.pct * 100, { red: '#ff5a4a', blue: '#5aa9ff', yellow: '#f2c14e', green: '#5bd16a' }[col])}</span>
          <span class="fu-sub">🪺 ${n.ready} / ${n.nest} eggs · ${n.fed ? `fed ${clock(n.fedMs)}` : '<b class="fu-need">hungry</b>'}</span></span>${health(x)}</div>`;
      }
      return `<div class="fu-row small"><span class="fu-ico">${c.icon}</span><span class="fu-main"><span class="fu-name">${esc(c.name)}</span>
        <span class="fu-sub${fed ? '' : ' fu-need'}">${fed ? `fed · ${left(fu - now)} left` : 'hungry — needs feed'}</span></span>${health(x)}</div>`;
    }).join('');
  }
  // collect a coop's eggs (from its panel, or at the nest boxes in the pen)
  async collect(bd) {
    if (this._collecting) return;
    this._collecting = true;
    try { const r = await this.eco.act({ action: 'collect', shelter: bd.id }); this.g.toast('🥚 ' + r.message); this.g.onCollect && this.g.onCollect(r); }
    catch (er) { this.g.toast('⚠ ' + (er.message || er)); }
    this._collecting = false;
  }

  /* ---------- popups ---------- */
  render() {
    if (!this.isOpen) return;
    const e = this.eco, head = `<div class="fu-head"><span class="fu-chip">💰 ₹${e.money}</span><span class="fu-chip">🌾 ${e.qty('feed')} feed</span><span class="fu-chip">🪵 ${e.qty('wood')}</span><span class="fu-chip">🪨 ${e.qty('stone')}</span>${e.machines() ? `<span class="fu-chip gold">${icon('gold')} ${e.gold} gold</span>` : ''}</div>`;
    let html = '';
    if (this.view === 'store') { this.title.textContent = '🏪 Farm Store'; html = head + this._store(); }
    else if (this.view === 'market') { this.title.textContent = '🛒 Market'; html = head + this._market(); }
    else if (this.view === 'fish') { this.title.textContent = '🐟 Fish Market'; html = fishHead(this) + fishMarketView(this); }
    else if (this.view === 'storage') { this.title.textContent = `📦 Farm storage · level ${e.storageLevel}`; html = head + this._storage(); }
    else if (this.view === 'mine') { this.title.textContent = '⛏ Gold mine'; html = head + mineView(this); }
    else if (this.view === 'flour') { this.title.textContent = '🌾 Flour machine · Aata Chakki'; html = head + flourView(this); }
    else if (this.view === 'field') { this.title.textContent = `🌾 Field ${this.arg + 1} · by the windmill`; html = head + this._field(this.arg); }
    else if (this.view === 'kennel') { this.title.textContent = `🐕 Guard dog ${this.arg + 1} · kennel`; html = head + this._kennel(this.arg); }
    else if (this.view === 'thefts') { this.title.textContent = '🚨 Thieves came to the farm'; html = this._thefts(); }
    else if (this.view === 'football') { this.title.textContent = '⚽ Football on the village green'; html = this._football(); }
    else if (this.view === 'plot') { this.title.textContent = `🌱 Plot ${this.arg + 1}`; html = head + this._plot(this.arg); }
    else if (this.view === 'shelter' || this.view === 'feed') {
      const bd = e.st.buildings.find(b => b.id === this.arg.id);
      if (!bd) { this.close(); return; }
      const k = e.cat(bd.type);
      // (k.icon is an SVG picture: the title is HTML here)
      this.title.innerHTML = this.view === 'feed' ? `🌾 Feeding trough · plot ${bd.plot + 1}` : `${k.icon} ${esc(k.name)} · plot ${bd.plot + 1}`;
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
      return `<div class="fu-npc"><span class="fu-ico">🧑‍🌾</span><span class="fu-say"><b>Farmer</b>“Morning! Buying or selling today?”</span></div>
        <div class="fu-menu">${menu.map(([t, i, l, s]) => `<button data-x="tab" data-t="${t}"><span class="fu-ico">${i}</span><span><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>
        <div class="fu-sub fu-c">Prices and the trade log are at the Market next door.</div>`;
    }
    const back = `<button class="fu-back" data-x="tab" data-t="">‹ Back</button>`;
    if (this.tab === 'animals') return back + this.eco.items('animal').map(k => this._animalRow(k)).join('');
    if (this.tab === 'sell') return back + this._sellRows();
    if (this.tab === 'feed') return back + this._goodRows(['feed']) + '<div class="fu-sub">Each animal eats its feed at the trough: one feeding keeps it fed (and producing) for 2 hours.</div>'
      + (this.eco.cat('bone') ? '<div class="fu-h">For guard dogs</div>' + this._goodRows(['bone', 'dog_treat']) + '<div class="fu-sub">A bone keeps a guard dog on duty for 4 hours; a treat for a whole day (24 hours) — cheaper than six bones. Give them at “Guard dogs”.</div>' : '');
    if (this.tab === 'dogs') return back + this._dogs();
    if (this.tab === 'materials') return back + this._goodRows(['wood', 'stone']) + '<div class="fu-sub">Or chop trees and break rocks, then store the logs and stones at the farm storage — it\'s free.</div>';
    if (this.tab === 'orders') return back + this._orders();
    if (this.tab === 'fields') return back + this._fieldsShop();
    if (this.tab === 'clothes') return back + this._clothes();
    return back;
  }
  // guard dogs: the ones the farm has (on duty or asleep, feed, train) and one to buy
  _dogs() {
    const e = this.eco, k = e.cat('guard_dog'), T = e.thieves();
    if (!k || !T) return '<div class="fu-sub">Guard dogs come with the next server update.</div>';
    const now = e.serverNow(), max = k.max || 2, L = lv => (k.levels || []).find(l => l.level === lv) || {};
    const cut = lv => { const c = L(lv).cut || [0, 0]; return c[0] === c[1] ? `${Math.round(c[0] * 100)}%` : `${Math.round(c[0] * 100)}–${Math.round(c[1] * 100)}%`; };
    const LOOK = { 1: 'a young dog — friendly, tail always wagging', 2: 'spiked collar — strict and focused', 3: 'golden collar and tactical vest — fierce, well trained' };
    let html = `<div class="fu-npc"><span class="fu-ico">${k.icon}</span><span class="fu-say"><b>Farmer</b>“Thieves come for eggs left waiting in the nests — more than ${T.rules.threshold}. A good dog keeps them off.”</span></div>`;
    for (const d of T.dogs) {
      const on = e.dogOnDuty(d, now), next = L(d.level + 1);
      html += `<div class="fu-row dog"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">Guard dog ${d.slot + 1} · Level ${d.level}</span>
        <span class="fu-sub">${LOOK[d.level] || ''} · saves ${cut(d.level)} of what a thief takes · thieves at most ${L(d.level).raids}× a day</span>
        <span class="fu-sub ${on ? 'fu-ok' : 'fu-need'}">${on ? `On duty · <b data-cd="${d.fedUntil}" data-re="1">${clock(Date.parse(d.fedUntil) - now)}</b> left` : 'Asleep — hungry. Give a bone or a treat to put it on duty'}</span></span>
        <span class="fu-col">
          <button class="fu-go" data-x="dogfeed" data-d="${d.id}" data-s="${d.slot}" data-f="bone" ${!e.qty('bone') || this.busy ? 'disabled' : ''}>Bone · +4 h <small>(${e.qty('bone')})</small></button>
          <button class="fu-go alt" data-x="dogfeed" data-d="${d.id}" data-s="${d.slot}" data-f="dog_treat" ${!e.qty('dog_treat') || this.busy ? 'disabled' : ''}>Treat · +24 h <small>(${e.qty('dog_treat')})</small></button>
          ${next.cost ? `<button class="fu-go sell" data-x="dogtrain" data-d="${d.id}" data-l="${d.level + 1}" ${e.money < next.cost || this.busy ? 'disabled' : ''}>Train to L${d.level + 1} · ₹${next.cost}</button>` : '<span class="fu-sub fu-c">Top level</span>'}
        </span></div>`;
    }
    if (T.dogs.length < max) html += `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.breed || 'Guard dog')} · ₹${k.buy}</span>
      <span class="fu-sub">Guards your coops. Level 1 saves ${cut(1)} of what a thief takes, Level 2 ${cut(2)}, Level 3 ${cut(3)}. Arrives on duty for ${k.hours || 4} h · ${T.dogs.length}/${max} dogs</span></span>
      <button class="fu-go" data-x="dogbuy" ${e.money < k.buy || this.busy ? 'disabled' : ''}>Buy · ₹${k.buy}</button></div>`;
    else html += `<div class="fu-sub">The farm has its ${max} guard dogs — the most it can keep.</div>`;
    if (!e.qty('bone') && !e.qty('dog_treat') && T.dogs.length) html += `<div class="fu-sub fu-need">No bones or treats — they're under “Buy feed” (bone ₹${(e.cat('bone') || {}).buy}, treat ₹${(e.cat('dog_treat') || {}).buy}).</div>`;
    html += `<div class="fu-sub">Training: Level 2 ₹${L(2).cost} (saves ${cut(2)}; thieves twice a day at most) · Level 3 ₹${L(3).cost} (saves ${cut(3)}; once a day). Without a dog on duty a thief can come 3 times a day.</div>`;
    return html;
  }
  // at a kennel (E): this dog — awake or asleep, its food (give it, or buy some right here), training
  _kennel(slot) {
    const e = this.eco, k = e.cat('guard_dog'), T = e.thieves(), d = T && T.dogs.find(x => x.slot === slot);
    if (!k || !d) return '<div class="fu-sub">No dog lives here yet — buy one at the Farm Store (Guard dogs).</div>';
    const now = e.serverNow(), on = e.dogOnDuty(d, now), L = lv => (k.levels || []).find(l => l.level === lv) || {}, next = L(d.level + 1), busy = this.busy ? 'disabled' : '';
    const left = on ? Date.parse(d.fedUntil) - now : 0, ahead = (T.rules && T.rules.aheadH) || 48;
    let html = `<div class="fu-row dog"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">Guard dog ${d.slot + 1} · Level ${d.level}</span>
      <span class="fu-sub ${on ? 'fu-ok' : 'fu-need'}">${on ? `On duty · <b data-cd="${d.fedUntil}" data-re="1">${clock(left)}</b> left before it's hungry` : 'Asleep — hungry. Feed it to put it back on duty'}</span></span></div>
      <div class="fu-h">Feed</div>`;
    for (const [id, word, hrs] of [['bone', 'a bone', 4], ['dog_treat', 'a treat', 24]]) {
      const f = e.cat(id);
      if (!f) continue;
      const have = e.qty(id), h = f.dogHours || hrs, full = left + h * 3600e3 > ahead * 3600e3;
      html += `<div class="fu-row"><span class="fu-ico">${f.icon}</span><span class="fu-main"><span class="fu-name">${esc(f.name)} · ₹${f.buy} each</span>
        <span class="fu-sub">${h} more hours on duty · ${have} in the farm storage${full ? ` · it's fed for long enough now (at most ${ahead} h ahead)` : ''}</span></span>
        <span class="fu-col"><button class="fu-go${id === 'bone' ? '' : ' alt'}" data-x="dogfeed" data-d="${d.id}" data-s="${d.slot}" data-f="${id}" ${!have || full ? 'disabled' : busy}>Give ${word}</button>
        ${have < 3 ? `<button class="fu-go alt" data-x="buy" data-i="${id}" data-q="1" ${e.money < f.buy ? 'disabled' : busy}>Buy 1 · ₹${f.buy}</button>` : ''}</span></div>`;
    }
    html += next.cost ? `<div class="fu-h">Training</div><div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">Train to level ${d.level + 1} · ₹${next.cost}</span>
      <span class="fu-sub">${d.level + 1 === 2 ? 'A spiked collar — strict and focused' : 'A golden collar and a tactical vest — a fierce, trained guard dog'} · saves more of what a thief takes</span></span>
      <button class="fu-go sell" data-x="dogtrain" data-d="${d.id}" data-l="${d.level + 1}" ${e.money < next.cost ? 'disabled' : busy}>Train · ₹${next.cost}</button></div>` : '<div class="fu-sub">Top level — fully trained.</div>';
    return html + '<div class="fu-sub">A fed dog eats at its bowl, then goes back to guarding the coops. Hungry dogs sleep and let thieves in.</div>';
  }
  /* ---------- crop fields (js/farm/fields.js, server/src/fields.js) ---------- */
  // one field's panel: buy it, sow, water, watch it grow, harvest; its scarecrow
  _field(slot) {
    const e = this.eco, FS = e.fields(), F = e.cat('field'), crop = e.cat('crop_wheat'), seeds = e.cat('wheat_seeds'), wheat = e.cat('wheat');
    if (!FS || !F || !crop) return '<div class="fu-sub">The fields open with the next farm server update.</div>';
    const I = this.g.fieldInfo(slot), busy = this.busy ? 'disabled' : '', n = slot + 1;
    const steps = `<div class="fd-steps">${['Buy the field', 'Sow seeds', 'Water', `Grow ${crop.growH} h`, 'Harvest'].map((t, i) => `<span class="${this._fieldStep(I) > i ? 'done' : this._fieldStep(I) === i ? 'now' : ''}">${t}</span>`).join('')}</div>`;
    if (!I.owned) {
      return steps + `<div class="fu-npc"><span class="fu-ico">🧑‍🌾</span><span class="fu-say"><b>Farmer</b>“A good field, plowed and fenced. Sow wheat in it: one bag of ${seeds.seeds || 100} seeds for the whole field, water it, and in ${crop.growH} hours you'll cut about ${crop.yield} wheat.”</span></div>
        <div class="fu-row"><span class="fu-ico">${F.icon}</span><span class="fu-main"><span class="fu-name">Field ${n} · ₹${F.buy}</span><span class="fu-sub">Yours for good — sow it again after every harvest. Six fields round the windmill.</span></span>
        <button class="fu-go" data-x="fieldbuy" data-s="${slot}" ${e.money < F.buy ? 'disabled' : busy}>Buy · ₹${F.buy}</button></div>`;
    }
    let h = steps;
    if (I.stage === 'empty' || I.stage === 'sowing') {
      const have = e.qty('wheat_seeds');
      h += `<div class="fu-row"><span class="fu-ico">${seeds.icon}</span><span class="fu-main"><span class="fu-name">Sow wheat</span>
          <span class="fu-sub">Uses 1 seed bag (${seeds.seeds || 100} seeds) · the farm has <b>${have}</b>. Then walk all over the field scattering them for ${crop.sowS} s — hold Space, F or the mouse (SOW on a phone).</span></span>
          <span class="fu-col">${have ? '' : `<button class="fu-go alt" data-x="buy" data-i="wheat_seeds" data-q="1" ${e.money < seeds.buy ? 'disabled' : busy}>Buy a bag · ₹${seeds.buy}</button>`}
          <button class="fu-go" data-x="fieldsow" data-s="${slot}" ${have ? busy : 'disabled'}>🌱 Start sowing</button></span></div>`;
      if (I.stage === 'sowing') h += '<div class="fu-sub">Someone started sowing here — start again if nobody finished it.</div>';
    } else if (I.stage === 'sown') {
      h += `<div class="fu-row"><span class="fu-ico">💧</span><span class="fu-main"><span class="fu-name">Water the field · ₹${crop.water}</span><span class="fu-sub">The seeds are in. Water them and the wheat starts growing — ready in ${crop.growH} hours (it grows while nobody plays, too).</span></span>
        <button class="fu-go" data-x="fieldwater" data-s="${slot}" ${e.money < crop.water ? 'disabled' : busy}>💧 Water · ₹${crop.water}</button></div>`;
    } else if (I.stage === 'growing') {
      const room = Math.max(0, (e.st.caps.wheat || 1e9) - e.qty('wheat')), left = I.f.yield !== null && I.f.yield !== undefined ? I.f.yield - I.f.harvested : null;
      const est = I.scarecrow >= 2 ? `${crop.yield}` : I.scarecrow === 1 ? `${Math.round(crop.yield * 0.8)}–${Math.round(crop.yield * 0.9)}` : `${Math.round(crop.yield * 0.7)}–${Math.round(crop.yield * 0.9)}`;
      h += `<div class="fd-grow"><div class="fd-stage">${esc(I.growLabel)}</div><div class="fd-bar"><i style="width:${Math.round(I.pct * 100)}%"></i></div>
        <div class="fu-sub">${I.ready ? 'Ripe!' : `Ready in <b data-cd="${I.f.readyAt}" data-re="1">${clock(I.msLeft)}</b>`} · harvest: ${left !== null ? `${left} wheat waiting` : `about ${est} wheat`}${I.scarecrow >= 2 ? '' : ' (the birds take their share)'}</div></div>`;
      if (I.ready) h += `<button class="fu-go wide collect" data-x="fieldharvest" data-s="${slot}" ${room ? busy : 'disabled'}>${room ? `🌾 Harvest the wheat` : 'The storage is full of wheat — upgrade it'}</button>
        <div class="fu-sub">Wheat goes into the farm storage (it holds ${e.st.caps.wheat}; the farm has ${e.qty('wheat')}).</div>`;
    }
    return h + this._scarecrowRow(slot, I);
  }
  _fieldStep(I) { return !I.owned ? 0 : I.stage === 'empty' || I.stage === 'sowing' ? 1 : I.stage === 'sown' ? 2 : I.ready ? 4 : 3; }
  // a field's scarecrow: buy (level 1), dress it up (level 2)
  _scarecrowRow(slot, I) {
    const e = this.eco, k = e.cat('scarecrow');
    if (!k || !I.owned) return '';
    const L2 = (k.levels || []).find(l => l.level === 2) || {}, busy = this.busy ? 'disabled' : '', crop = e.cat('crop_wheat') || { yield: 500 };
    const y = (a, b) => (a === b ? `${Math.round(crop.yield * a)}` : `${Math.round(crop.yield * a)}–${Math.round(crop.yield * b)}`), none = k.none || [0.7, 0.9], l1 = ((k.levels || [])[0] || {}).share || [0.8, 0.9];
    if (!I.scarecrow) return `<div class="fu-row scare"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">Scarecrow · ₹${k.buy}</span>
        <span class="fu-sub">Crows eat from a field without one: a harvest is only ${y(...none)} wheat. A scarecrow keeps most of them off (${y(...l1)}); dressed up to level 2, every grain is yours (${crop.yield}).</span></span>
        <button class="fu-go" data-x="scare" data-s="${slot}" data-l="1" ${e.money < k.buy ? 'disabled' : busy}>Put one up · ₹${k.buy}</button></div>`;
    if (I.scarecrow === 1) return `<div class="fu-row scare"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">Scarecrow · level 1</span>
        <span class="fu-sub">Keeps most crows off — harvests of ${y(...l1)} wheat. Level 2 (a red patched coat, a bigger hat) keeps them all off: the full ${crop.yield}.</span></span>
        <button class="fu-go sell" data-x="scare" data-s="${slot}" data-l="2" ${e.money < L2.cost ? 'disabled' : busy}>Level 2 · ₹${L2.cost}</button></div>`;
    return `<div class="fu-row scare"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">Scarecrow · level 2</span><span class="fu-sub">No crow comes near — every harvest is the full ${crop.yield} wheat.</span></span></div>`;
  }
  // the Farm Store: seed bags, and a scarecrow for each field the farm has
  _fieldsShop() {
    const e = this.eco, FS = e.fields(), k = e.cat('scarecrow'), F = e.cat('field');
    if (!FS || !F) return '<div class="fu-sub">The fields open with the next farm server update.</div>';
    let h = `<div class="fu-npc"><span class="fu-ico">🧑‍🌾</span><span class="fu-say"><b>Farmer</b>“The fields are round the big windmill, east of the road — ₹${F.buy} each. Bring seeds, sow, water, and keep the crows off.”</span></div>`;
    h += this._goodRows(['wheat_seeds']) + `<div class="fu-sub">One bag sows a whole field. You have ${FS.list.length} of ${FS.slots} fields.</div>`;
    if (k) {
      h += '<div class="fu-h">Scarecrows</div>';
      if (!FS.list.length) h += `<div class="fu-sub">Buy a field first (walk up to one by the windmill and press E) — then put a scarecrow in it for ₹${k.buy}.</div>`;
      for (const f of FS.list) h += this._scarecrowRow(f.slot, this.g.fieldInfo(f.slot)).replace('Scarecrow ·', `Field ${f.slot + 1} · Scarecrow ·`);
    }
    return h;
  }
  // clothes: the farmer outfit (yours once bought; put it on or take it off)
  _clothes() {
    const e = this.eco, k = e.cat('farmer_outfit'), W = e.wardrobe();
    if (!k || !e.fields()) return '<div class="fu-sub">Clothes come with the next farm server update.</div>';
    const own = W.owned.includes('farmer_outfit'), on = W.wearing === 'farmer_outfit', busy = this.busy ? 'disabled' : '';
    const btn = !own ? `<button class="fu-go" data-x="outfit" data-o="buy" ${e.money < k.buy ? 'disabled' : busy}>Buy · ₹${k.buy}</button>`
      : on ? `<button class="fu-go alt" data-x="outfit" data-o="off" ${busy}>Take it off</button>` : `<button class="fu-go" data-x="outfit" data-o="wear" ${busy}>Put it on</button>`;
    return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)}${own ? '' : ` · ₹${k.buy}`}</span>
        <span class="fu-sub">A wide straw hat, a work shirt and long blue denim overalls with the legs turned up — everyone sees you in it. ${own ? (on ? '<b class="fu-ok">You\'re wearing it.</b>' : 'It\'s yours.') : 'Bought with the farm\'s money, it\'s yours to wear.'}</span></span>${btn}</div>`;
  }
  // the report when you come back: every thief since you last looked
  _thefts() {
    const e = this.eco, list = this.arg || [], k = e.cat('guard_dog');
    const when = t => new Date(t).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const eggs = r => Object.values(r.taken || {}).reduce((t, n) => t + (n > 0 ? n : 0), 0);
    const lost = list.reduce((t, r) => t + (r.status === 'caught' ? 0 : eggs(r)), 0);
    const rows = list.map(r => {
      const n = eggs(r), what = Object.entries(r.taken || {}).filter(([, q]) => q > 0).map(([p, q]) => `${q} ${(e.cat(p) || {}).name || p}`.toLowerCase()).join(', ');
      const [ico, line] = r.status === 'caught' ? [icon('net'), `<b>${esc(r.caughtBy || 'Someone')}</b> caught him — the eggs came back with 10% extra`]
        : r.status === 'scared' || !n ? [k ? k.icon : '', 'Your guard dog scared him off — he got nothing']
          : [icon('thief'), `Stole <b>${n} eggs</b> (${esc(what)})${r.saved ? ` · your guard dog saved ${r.saved}` : ''}`];
      return `<div class="fu-row theft ${r.status}"><span class="fu-ico">${ico}</span><span class="fu-main"><span class="fu-name">${when(r.at)}</span><span class="fu-sub">${line}</span></span></div>`;
    }).join('');
    const dogs = e.thieves() ? e.thieves().dogs : [], tips = [];
    tips.push(`Collect your eggs before more than ${(e.thieves() || { rules: {} }).rules.threshold || 40} are waiting in the nests.`);
    if (!dogs.length) tips.push('A guard dog (Farm Store → Guard dogs) saves a share of what a thief takes — and keep it fed with bones or treats.');
    else if (!dogs.some(d => e.dogOnDuty(d))) tips.push('Your guard dog is asleep — hungry. Give it a bone or a treat to put it back on duty.');
    return `<div class="fu-npc thief"><span class="fu-ico">${icon('thief')}</span><span class="fu-say"><b>While you were away</b>“${list.length === 1 ? 'A thief came' : `${list.length} thieves came`} to the farm${lost ? ` and got away with ${lost} eggs` : ''}.”</span></div>
      ${rows}<div class="fu-sub">${tips.join(' ')}</div><button class="fu-go wide" data-x="seenok">OK</button>`;
  }
  // a football match: who plays with whom (js/village/football.js) · arg: { opts: [{ label, sub }], pick(opt) }
  _football() {
    const rows = (this.arg.opts || []).map((o, k) => `<div class="fu-row fb-opt"><span class="fu-ico">${icon('ball')}</span><span class="fu-main"><span class="fu-name">${esc(o.label)}</span><span class="fu-sub">${esc(o.sub || '')}</span></span><button class="fu-go" data-x="fbpick" data-i="${k}">Play</button></div>`).join('');
    return `<div class="fu-sub">Two a side. A village kid takes every place nobody plays — and keeps goal for a player on their own. Three minutes; kick-off from the centre.</div>${rows}`;
  }
  // one animal for sale (shelter: put it in this shelter first)
  _animalRow(k, shelter) {
    const e = this.eco, free = e.freeFor(k.id), home = e.cat(k.shelter), open = e.unlocked(k.id);
    if (k.grow && k.foal) {                           // a horse: buy a baby (Level 1) or a grown one (Level 10)
      const note = free ? `${free} free place${free > 1 ? 's' : ''} in your stables` : 'needs a horse stable with room (build one on a plot)';
      const off = p => (!free || e.money < p || this.busy ? 'disabled' : '');
      return `<div class="fu-row"><span class="fu-ico">🐎</span><span class="fu-main"><span class="fu-name">${coat(k)}${esc(k.name)} <small>${esc(k.tier || '')}</small></span>
        <span class="fu-sub">A baby grows to Level ${k.maxLevel} in about ${Math.round((k.maxLevel - 1) / k.grow)} h of feeding (${k.feedCost} feed / ${k.feedHours} h) · rents for ₹${k.rent} per 2 h · sells for up to ₹${e.horsePrice(k, k.maxLevel)}</span>
        <span class="fu-sub">${note}</span></span>
        <button class="fu-go alt" data-x="buy" data-i="${k.id}" data-q="1" data-age="foal" ${shelter ? `data-s="${shelter}"` : ''} ${off(k.foal)}>Baby · ₹${k.foal}</button>
        <button class="fu-go" data-x="buy" data-i="${k.id}" data-q="1" ${shelter ? `data-s="${shelter}"` : ''} ${off(k.buy)}>Grown · ₹${k.buy}</button></div>`;
    }
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
    const e = this.eco, tabs = this._tabs([['orders', '📜 Orders'], ['sell', '💰 Sell produce'], ['prices', '📈 Prices'], ['log', '🧾 Trade log']]);
    if (this.tab === 'orders') return tabs + this._orders();
    if (this.tab === 'log') {
      if (!this.hist) { this.eco.history().then(h => { this.hist = h; this.render(); }, () => { this.hist = []; this.render(); }); return tabs + '<div class="fu-sub">Loading…</div>'; }
      return tabs + `<div class="fu-hist">${this.hist.length ? this.hist.map(h => `<div><span>${esc(h.message)}</span> <small>${ago(h.at)}</small></div>`).join('') : '<div class="fu-sub">Nothing bought or sold yet.</div>'}</div>`;
    }
    if (this.tab === 'prices') {
      const rows = Object.entries(e.st.catalog).filter(([, k]) => k.kind === 'good' || k.kind === 'animal').map(([id, k]) => `<tr><td>${k.icon} ${esc(k.name)}</td><td>${k.buy ? '₹' + k.buy : '—'}</td><td>${k.sell ? '₹' + k.sell : '—'}</td><td>${k.kind === 'good' ? e.qty(id) : e.count(id)}</td></tr>`).join('');
      return tabs + `<div class="fu-sub">The farm has earned <b>₹${e.st.totalEarned || 0}</b> from sales. Buying is at the Farm Store; selling is here or at the store.</div>
        <table class="fu-table"><tr><th>Item</th><th>Buy</th><th>Sell</th><th>Farm has</th></tr>${rows}</table>`;
    }
    return tabs + this._sellRows() + '<div class="fu-sub">Fed chickens lay into their nest boxes (collect the eggs at the coop); milk goes straight into the farm storage — even while nobody is playing.</div>';
  }
  // customer orders (Market / farmer's menu): the order to deliver now, the next one's arrival, the streak
  _orders() {
    const e = this.eco, o = e.orderNow(), O = o.O;
    if (!O) return '<div class="fu-sub">Customer orders start as soon as the farm server is updated.</div>';
    const cycle = O.streak.days ? ((O.streak.days - 1) % O.streakDays) + 1 : 0;
    const dots = Array.from({ length: O.streakDays }, (_, i) => `<i class="${i < cycle ? 'on' : ''}"></i>`).join('');
    let h = `<div class="or-head">📜 Today's orders <small>· ends at midnight (India time) in <b data-cd="${O.endsAt}">${clock(o.endsMs)}</b></small></div>
      <div class="or-streak"><span>🔥 ${O.streak.days ? `${O.streak.days}-day streak` : 'Start a streak'}</span><span class="or-dots">${dots}</span>
        <small>${O.streak.today ? 'today ✓ — come back tomorrow' : O.streak.days ? 'deliver an order today to keep it' : 'deliver an order every day'} · ₹${O.bonus} bonus every ${O.streakDays}th day</small></div>`;
    const card = (x, live) => {
      let have = true;
      const rows = x.items.map(it => {
        const k = e.cat(it.item) || {}, n = e.qty(it.item), ok = n >= it.qty; have = have && ok;
        return `<div class="or-item ${ok ? 'ok' : 'need'}"><span>${k.icon || ''} ${esc(k.name || it.item)}</span><b>${Math.min(n, it.qty)} / ${it.qty}</b></div>`;
      }).join('');
      const base = x.items.reduce((t, it) => t + ((e.cat(it.item) || {}).sell || 0) * it.qty, 0);
      return `<div class="or-card${live ? '' : ' done'}"><div class="or-t">Order ${x.n} of ${O.perDay} · ${esc(x.customer)}</div>${rows}
        <div class="or-pay">Pays <b>₹${x.pay}</b> <small>(₹${base} + ${Math.round(O.extra * 100)}% for the order)</small></div>
        ${live ? `<button class="fu-go wide" data-x="order" data-o="${x.id}" ${!have || this.busy ? 'disabled' : ''}>${have ? `📦 Deliver order · ₹${x.pay}` : 'Collect the goods first — they go from the farm storage'}</button>` : ''}</div>`;
    };
    if (o.ready) h += card(o.ready, true);
    else if (o.next) h += `<div class="or-wait">⏳ The next order arrives in <b data-cd="${o.next.availableAt}" data-re="1">${clock(Date.parse(o.next.availableAt) - e.serverNow())}</b></div>`;
    else if (o.done.length >= O.perDay) h += `<div class="or-wait done">✅ All ${O.perDay} orders delivered today — new orders tomorrow.</div>`;
    for (const x of o.done) h += `<div class="or-past">✓ Order ${x.n} · ${esc(x.customer)} · ₹${x.pay}${x.doneBy ? ` · delivered by ${esc(x.doneBy)}` : ''}</div>`;
    h += '<div class="fu-sub">Orders ask for what your farm can make — eggs, milk and fish. Deliver at least one a day to build the streak.</div>';
    const R = e.rentals();
    return R ? h + this._rentals(R) : h;
  }
  // horse rental requests: hand the horses over (the farm is paid at once); horses out on rent and when they're back
  _rentals(R) {
    const e = this.eco, now = e.serverNow();
    const offers = R.filter(r => r.status === 'offer' && Date.parse(r.expiresAt) > now), away = R.filter(r => r.status === 'active' && Date.parse(r.returnsAt) > now);
    let h = '<div class="or-head" style="margin-top:12px">🐎 Horse rental requests</div>';
    for (const r of offers) {
      const k = r.variety && e.cat(r.variety), free = e.freeHorses(r.variety), ok = free >= r.horses, what = `${k ? esc(k.name.toLowerCase()) : 'horse'}${r.horses > 1 ? 's' : ''}`;
      h += `<div class="or-card horse"><div class="or-t">${esc(r.renter)} wants ${r.horses} ${what} for ${r.hours} h</div>
        <div class="fu-sub">${esc(r.purpose)}${k ? ` — it has to be ${coat(k)}${esc(k.variety)}` : ' — any colour'} · the request ends in <b data-cd="${r.expiresAt}" data-re="1">${clock(Date.parse(r.expiresAt) - now)}</b></div>
        <div class="or-pay">Pays <b>₹${r.pay}</b> <small>now, when you hand ${r.horses > 1 ? 'them' : 'it'} over</small></div>
        <button class="fu-go wide" data-x="rent" data-r="${r.id}" ${!ok || this.busy ? 'disabled' : ''}>${ok ? `🐎 Hand over ${r.horses} horse${r.horses > 1 ? 's' : ''} · ₹${r.pay}` : `Needs ${r.horses} Level 10 ${what} at home — you have ${free}`}</button></div>`;
    }
    for (const r of away) h += `<div class="or-past">🐎 ${r.horses} horse${r.horses > 1 ? 's' : ''} with ${esc(r.renter)} — back in <b data-cd="${r.returnsAt}" data-re="1">${clock(Date.parse(r.returnsAt) - now)}</b>${r.by ? ` · handed over by ${esc(r.by)}` : ''}</div>`;
    if (!offers.length) h += `<div class="fu-sub">${e.freeHorses() ? 'Customers ask to rent horses now and then (about every 1–2 hours) while you have Level 10 horses at home.' : 'Raise a horse to Level 10 at a stable (or buy a grown one) — then customers ask here to rent it.'}</div>`;
    return h;
  }
  // a stable: horses, how many are ready (Level 10 at home), out on rent, the next level, feeding
  _stableBox(bd, k, a, I, compact) {
    const e = this.eco, now = e.serverNow(), feed = e.qty('feed'), hs = e.animalsIn(bd.id).map(x => e.horseOf(x, now)), S = stats(compact), row = S.row;
    let h = `<div class="fi-t">🐎 ${FARM_TITLE[bd.type] || k.name.toUpperCase()} <small>plot ${bd.plot + 1}</small></div>`;
    h += row(compact ? 'Total horses' : 'horses', `${I.count} / ${k.capacity}`);
    if (!I.count) return h + S.tiles() + '<div class="fi-note">No horses yet — buy a baby horse or a grown one from the farmer at the Farm Store.</div>';
    const ready = hs.filter(x => x.ready).length, away = hs.filter(x => x.away).length, next = Math.min(...hs.map(x => x.nextMs));
    const growing = hs.filter(x => x.level < x.max).length;
    const st = I.paused ? ['red', '⚠ Feed required'] : ready ? ['blue', `🐎 ${ready} ready to rent or sell`] : isFinite(next) ? ['green', '🌱 Growing'] : ['red', '⚠ Feed required'];
    h += `<div class="fi-st ${st[0]}">${st[1]}</div>`;
    h += row(compact ? 'Levels' : 'levels', hs.map(x => x.level).join(' · '), compact ? 'fi-opt' : 'fi-wrap');
    h += row(compact ? 'Ready (Lv 10)' : 'ready (Lv 10)', ready, ready ? 'blue' : '');
    if (away) h += row(compact ? 'Out on rent' : 'out on rent', away, 'blue');
    if (growing) h += row(compact ? 'Next level in' : 'next level', isFinite(next) ? clock(next) : 'feed first', isFinite(next) ? 'green' : 'bad');
    h += row(compact ? 'Feeding left' : 'fed for', I.dueMs <= 0 ? `Feed required · ${I.hungry} hungry` : clock(I.dueMs), I.dueMs <= 0 ? 'bad' : I.dueMs < 15 * 60e3 ? 'warn' : 'green');
    h += row(compact ? 'Feed needed' : 'feed needed · in store', `${I.need} · 🌾 ${feed}`, feed < I.need ? 'bad' : '');
    return compact ? h : h + S.tiles();
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
      const exp = goods.map(k => `${k.icon} ${k.capStep ? e.st.caps[k.id] + k.capStep : Math.round(e.st.caps[k.id] / (cur.mult || 1) * next.mult)}`).join(' · ');
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
      return `<div class="fu-row"><span class="fu-ico">${k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)}</span><span class="fu-sub">${cost} · room for ${k.capacity} ${a.icon} ${plural(kind(a))}${miss.length ? ` · <b class="fu-need">need ${miss.join(', ')} more</b>` : ''}</span></span>
        <button class="fu-go" data-x="build" data-t="${k.id}" ${miss.length || this.busy ? 'disabled' : ''}>Build</button></div>`;
    }).join('');
    return rows + '<div class="fu-sub">Wood: chop trees and store the logs at the farm storage, or buy wood from the farmer at the Farm Store.</div>';
  }
  _shelter(bd) {
    const e = this.eco, k = e.cat(bd.type), a = e.cat(k.animal), list = e.animalsIn(bd.id), free = k.capacity - list.length;
    const kinds = e.items('animal').filter(x => x.shelter === bd.type);
    const how = a.nest ? `Feed them at the trough in the pen (open the gate, press E). Fed hens lay into their nest boxes — collect the eggs before a nest fills up (${a.nest} each).`
      : a.grow ? `Feed them at the trough (E). A fed horse grows a level every ${Math.round(1 / a.grow)} h up to Level ${a.maxLevel}; then rent it out (Market → Orders) or sell it here.`
      : `Feed them at the trough in the pen (E). Fed animals produce for ${a.feedHours || 2} h; hungry ones stop.`;
    return `<div class="fi-box fi-live" data-b="${bd.id}">${this._infoBox(bd)}</div>
      <div class="fu-tip">🌾 ${how}</div>
      <div class="${a.grow ? 'fu-horses' : 'fu-animals'}" data-b="${bd.id}">${this._animalRows(bd)}</div>
      ${free > 0 ? `<div class="fu-sub" style="margin-top:8px"><b>Add ${plural(kind(a))} to this ${k.name.toLowerCase()} (${free} free)</b></div>${kinds.map(x => this._animalRow(x, bd.id)).join('')}` : '<div class="fu-sub">This shelter is full. Build another on an empty plot.</div>'}`;
  }
  // the feeding trough: feed everyone, or only some (the hungriest first). The server checks the feed.
  _feed(bd) {
    const e = this.eco, k = e.cat(bd.type), a = e.cat(k.animal), I = e.shelterInfo(bd), feed = e.qty('feed'), cost = I.feedCost;
    if (!I.count) return `<div class="fi-box fi-live" data-b="${bd.id}">${this._infoBox(bd)}</div>`;
    const canAll = Math.min(I.count, Math.floor(feed / cost)), q = Math.min(this._q('f', Math.max(1, I.hungry || 1)), I.count);
    const allFed = !I.hungry ? `<div class="fi-st green">✅ All ${a.nest ? 'chickens' : plural(a.name)} are currently fed${isFinite(I.dueMs) ? ` · the first gets hungry in ${clock(I.dueMs)}` : ''}</div>` : '';
    return `<div class="fi-box fi-live" data-b="${bd.id}">${this._infoBox(bd)}</div>${allFed}
      <div class="fu-sub">Each ${kind(a).toLowerCase()} eats ${cost} feed and stays fed ${I.feedHours} h longer (up to a day ahead). The hungriest are fed first.${feed < cost * I.count ? ` <b class="fu-need">The storage has feed for ${canAll} of ${I.count}.</b>` : ''}</div>
      <button class="fu-go wide" data-x="feedall" ${feed < cost || this.busy ? 'disabled' : ''}>🌾 Feed all ${I.count} ${plural(kind(a))} · uses up to ${cost * I.count} feed</button>
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
      this.qty[k] = Math.max(k === 'b:wheatin' ? 10 : 1, Math.min(Number(b.dataset.max || 1e9), cur + (x === 'inc' ? step : -step)));
      this.render(); return;
    }
    if (x === 'sellask') { this._confirm = b.dataset.a; this.render(); return; }
    if (x === 'buy') await this._do({ action: 'buy', item: b.dataset.i, qty: Number(b.dataset.q), ...(b.dataset.s ? { shelter: b.dataset.s } : {}), ...(b.dataset.age ? { age: b.dataset.age } : {}) });
    else if (x === 'sellhorse') await this._do({ action: 'sellhorse', animal: b.dataset.a }, () => { this._confirm = null; });
    else if (x === 'rent') await this._do({ action: 'rent', offer: b.dataset.r });
    else if (x === 'sell') await this._do({ action: 'sell', item: b.dataset.i, qty: Number(b.dataset.q) }, () => { delete this.qty['s:' + b.dataset.i]; });
    else if (x === 'build') await this._do({ action: 'build', type: b.dataset.t, plot: this.arg }, r => { const bd = r.buildings.find(q => q.plot === this.arg); if (bd) { this.view = 'shelter'; this.arg = bd; } });
    else if (x === 'upgrade') await this._do({ action: 'upgrade', target: 'storage', level: Number(b.dataset.l) });
    else if (x === 'rod') await this._do({ action: 'rod', level: Number(b.dataset.l) });
    else if (x === 'order') await this._do({ action: 'order', order: b.dataset.o });
    else if (x === 'dogbuy') await this._do({ action: 'dog', op: 'buy' });
    else if (x === 'dogfeed') { const slot = Number(b.dataset.s), food = b.dataset.f; await this._do({ action: 'dog', op: 'feed', dog: b.dataset.d, food }, () => this.g.onDogFed && this.g.onDogFed(slot, food)); }
    else if (x === 'dogtrain') await this._do({ action: 'dog', op: 'train', dog: b.dataset.d, level: Number(b.dataset.l) });
    else if (x === 'seenok') { this.close(); if (this.g.onSeen) this.g.onSeen(); }
    else if (await machineClick(this, x, b)) { /* the machines' buttons (machines/machineUI.js) */ }
    else if (x === 'fieldbuy') await this._do({ action: 'field', op: 'buy', slot: Number(b.dataset.s) });
    else if (x === 'fieldsow') { const slot = Number(b.dataset.s); await this._do({ action: 'field', op: 'sowstart', slot, crop: 'wheat' }, () => { this.close(); if (this.g.onSow) this.g.onSow(slot); }); }
    else if (x === 'fieldwater') await this._do({ action: 'field', op: 'water', slot: Number(b.dataset.s) });
    else if (x === 'fieldharvest') await this._do({ action: 'field', op: 'harvest', slot: Number(b.dataset.s) }, () => this.g.onHarvest && this.g.onHarvest());
    else if (x === 'scare') await this._do({ action: 'field', op: 'scarecrow', slot: Number(b.dataset.s), level: Number(b.dataset.l) });
    else if (x === 'outfit') await this._do({ action: 'outfit', op: b.dataset.o, item: 'farmer_outfit' });
    else if (x === 'fbpick') { const A = this.arg, o = A && A.opts[Number(b.dataset.i)]; this.close(); if (o) A.pick(o); }
    else if (x === 'feedall') await this._do({ action: 'feed', shelter: this.arg.id, all: true }, null, () => this._started());
    else if (x === 'feedn') await this._do({ action: 'feed', shelter: this.arg.id, count: Number(b.dataset.q) }, () => { delete this.qty.f; }, () => this._started());
    else if (x === 'collect') await this._do({ action: 'collect', shelter: b.dataset.b }, r => this.g.onCollect && this.g.onCollect(r));
    else if (x === 'deposit') await this._deposit();
  }
  // after feeding chickens: "Egg production started" (and when the next egg comes)
  _started() {
    const bd = this.eco.st.buildings.find(q => q.id === this.arg.id), I = bd && this.eco.shelterInfo(bd);
    return I && I.nests && I.fed ? ` · 🐣 Egg production started${isFinite(I.nextMs) ? ` · Next egg in ${clock(I.nextMs)}` : ''}` : '';
  }
  async _do(body, after, more) {
    if (this.busy) return;
    this.busy = true; this.msg = 'Working…'; this.msgErr = false; this.render();
    try {
      const r = await this.eco.act(body), extra = more ? more(r) : '';
      this.msg = '✅ ' + r.message + extra; this.msgErr = false; this.hist = null;
      this.g.toast('✅ ' + r.message + extra);
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
