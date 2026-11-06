// Farm World on-screen helpers:
//  · two floating buttons (under the map on phones, bottom-right on computers):
//      the bag  — with a badge showing the farm's money; opens the Farm Notebook
//      the slip — with a badge counting the order items still missing; opens the Order Slip
//  · the Farm Notebook: an open spiral notebook with everything the farm has (money, feed, produce,
//    animals, fishing rod and worms, the team's materials)
//  · the Order Slip: a paper copy of today's order, so nobody has to walk back to the Market to check it.
//    Items you already have enough of are ticked and crossed out; what's still missing stays on top.
// N opens the notebook, O the order slip (the buttons on phones). Esc, E or a tap outside closes them.
import { icon, itemIcon, noEmoji } from '../icons.js';
import { RODS } from '../fishing/sim.js';

const $ = id => document.getElementById(id);
const esc = s => noEmoji(String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = ms => {
  if (!isFinite(ms)) return '--:--';
  const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
};
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const PRODUCE = ['egg', 'egg_brown', 'egg_dark', 'goat_milk', 'cow_milk', 'wheat', 'flour'];
const BUILD = ['wood', 'stone'];
const FISH = ['fish_small', 'fish_medium', 'fish_large'];
const MATS = [['logs', 'Logs'], ['planks', 'Planks'], ['rope', 'Rope'], ['stone', 'Stones']];

export class Notebook {
  // g: { eco, materials, hooks: { onOpen, onClose }, worldName(), dateText(), beforeOpen() }
  constructor(g) {
    this.g = g; this.view = null; this._fab = '';
    const hud = $('hud');
    const fabs = this.fabs = document.createElement('div');
    fabs.id = 'farmFabs'; fabs.className = 'hidden';
    fabs.innerHTML = `<button id="fabBag" class="fab" title="Farm notebook (N)" aria-label="Farm notebook">${icon('bag')}<span class="fab-badge"></span><i class="fab-dot hidden"></i></button>
      <button id="fabOrder" class="fab" title="Order slip (O)" aria-label="Order slip">${icon('slip')}<span class="fab-badge hidden"></span></button>`;
    hud.appendChild(fabs);
    this.bagBadge = fabs.querySelector('#fabBag .fab-badge'); this.bagDot = fabs.querySelector('#fabBag .fab-dot');
    this.ordBtn = fabs.querySelector('#fabOrder'); this.ordBadge = fabs.querySelector('#fabOrder .fab-badge');
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    fabs.querySelector('#fabBag').addEventListener('click', e => { stop(e); this.toggle('book'); });
    this.ordBtn.addEventListener('click', e => { stop(e); this.toggle('slip'); });
    for (const b of fabs.querySelectorAll('.fab')) b.addEventListener('pointerdown', e => e.stopPropagation());

    const root = this.root = document.createElement('div');
    root.id = 'notebookUI'; root.className = 'hidden';
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      if (e.target === root || e.target.closest('[data-nb="close"]')) { stop(e); this.close(); return; }
      const sw = e.target.closest('[data-nb-go]');
      if (sw) { stop(e); this.open(sw.dataset.nbGo); }
    });
    document.addEventListener('keydown', e => {
      if (!this.isOpen) return;
      if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); this.close(); }
      else if (e.code === 'KeyN' || e.code === 'KeyO') { e.preventDefault(); this.toggle(e.code === 'KeyN' ? 'book' : 'slip'); }
    });
    setInterval(() => this._tick(), 1000);
  }
  get eco() { return this.g.eco; }
  get isOpen() { return !!this.view; }

  toggle(view) { if (this.view === view) this.close(); else this.open(view); }
  open(view) {
    if (!this.eco.ready) return;
    const was = this.view;
    this.view = view;
    if (!was) { this.g.beforeOpen && this.g.beforeOpen(); this.root.classList.remove('hidden'); this.g.hooks.onOpen && this.g.hooks.onOpen(); }
    this.render();
  }
  close() {
    if (!this.view) return;
    this.view = null; this.root.classList.add('hidden'); this.root.innerHTML = ''; this._html = '';
    this.g.hooks.onClose && this.g.hooks.onClose();
  }

  /* ---------- the floating buttons ---------- */
  renderFabs(active) {
    const e = this.eco;
    if (!active || !e.ready) { if (!this.fabs.classList.contains('hidden')) this.fabs.classList.add('hidden'); return; }
    const hungry = e.hungryCount(), nests = Object.values(e.eggsReady()).reduce((t, v) => t + v, 0);
    const o = this._order(), offer = this._offers().length;
    const key = [e.money, hungry, nests, o.state, o.missing, offer].join('|');
    this.fabs.classList.remove('hidden');
    if (key === this._fab) return;
    this._fab = key;
    this.bagBadge.textContent = money(e.money);
    this.bagDot.classList.toggle('hidden', !hungry && !nests);
    this.bagDot.className = 'fab-dot' + (hungry ? ' bad' : nests ? ' blue' : ' hidden');
    this.ordBtn.classList.toggle('hidden', o.state === 'none');
    this.ordBtn.classList.toggle('ready', o.state === 'ready' && !o.missing);
    const b = this.ordBadge;
    if (o.state === 'ready') { b.classList.remove('hidden'); b.innerHTML = o.missing ? String(o.missing) : icon('check'); b.className = 'fab-badge' + (o.missing ? ' warn' : ' ok'); }
    else if (offer) { b.classList.remove('hidden'); b.textContent = String(offer); b.className = 'fab-badge warn'; }
    else b.classList.add('hidden');
  }
  // today's order, from this device's point of view
  _order() {
    const e = this.eco, o = e.orderNow();
    if (!o.O) return { state: 'none', missing: 0, o };
    if (!o.ready) return { state: o.next ? 'wait' : 'done', missing: 0, o };
    const missing = o.ready.items.filter(it => e.qty(it.item) < it.qty).length;
    return { state: 'ready', missing, o };
  }
  _offers() {
    const e = this.eco, now = e.serverNow();
    return (e.rentals() || []).filter(r => r.status === 'offer' && Date.parse(r.expiresAt) > now);
  }

  /* ---------- pages ---------- */
  render() {
    if (!this.view || !this.eco.ready) return;
    const html = this.view === 'slip' ? this._slip() : this._book();
    if (html === this._html) return;
    this._html = html;
    const sc = this.root.querySelector('.nb-scroll'), top = sc ? sc.scrollTop : 0;
    this.root.innerHTML = html;
    const sc2 = this.root.querySelector('.nb-scroll'); if (sc2) sc2.scrollTop = top;
  }
  _tick() {
    if (!this.view) return;
    let due = false;
    for (const el of this.root.querySelectorAll('[data-cd]')) {
      const ms = Date.parse(el.dataset.cd) - this.eco.serverNow();
      if (ms <= 0) due = true;
      const t = clock(ms); if (el.textContent !== t) el.textContent = t;
    }
    if (due) this.render();
  }
  _line(id, name, val, cls = '') {
    return `<div class="nb-line ${cls}">${itemIcon(id)}<span class="nb-name">${esc(name)}</span><i class="nb-dots"></i><b>${val}</b></div>`;
  }
  _book() {
    const e = this.eco, st = e.st, cap = id => st.caps && st.caps[id];
    const hungry = e.hungryCount(), nests = Object.values(e.eggsReady()).reduce((t, v) => t + v, 0);
    const name = id => (e.cat(id) || {}).name || id;
    const qtyCap = id => `${e.qty(id)}${cap(id) ? `<small> / ${cap(id)}</small>` : ''}`;
    const produce = PRODUCE.filter(id => e.cat(id) && (e.qty(id) || e.makesPerHour(id) > 0 || id === 'egg' || id === 'wheat' || (id === 'flour' && e.flourNow && e.flourNow())));
    // left page: money, feed, produce, building materials
    let L = `<div class="nb-money">${icon('coin')}<div><b>${money(e.money)}</b><small>Farm money · shared by every member</small></div></div>`;
    const MC = e.machines ? e.machines() : null;
    if (MC) L += `<div class="nb-money gold">${icon('gold')}<div><b>${MC.gold} gold</b><small>Gold coins · from the mine, for the machines</small></div></div>`;
    L += this._line('feed', 'Animal feed', qtyCap('feed'), hungry ? 'bad' : '');
    if (hungry) L += `<div class="nb-note bad">${icon('warn')} ${hungry} animal${hungry > 1 ? 's are' : ' is'} hungry — feed them at the trough</div>`;
    const T = e.thieves ? e.thieves() : null, many = T && nests > T.rules.threshold;
    if (nests) L += `<div class="nb-note ${many ? 'bad' : 'blue'}">${icon('egg')} ${nests} egg${nests > 1 ? 's' : ''} waiting in the nest boxes${many ? ` — more than ${T.rules.threshold}: thieves come for them! Collect them` : ''}</div>`;
    L += `<h4>Produce</h4>` + produce.map(id => this._line(id, name(id), qtyCap(id))).join('');
    L += `<h4>Building</h4>` + BUILD.filter(id => e.cat(id)).map(id => this._line(id, name(id), qtyCap(id))).join('');
    L += `<div class="nb-foot">Farm storage · level ${e.storageLevel}</div>`;
    // right page: animals, fishing, the team's bag
    const counts = {};
    for (const a of st.animals) counts[a.type] = (counts[a.type] || 0) + 1;
    const animals = Object.entries(counts).map(([id, n]) => this._line(id, name(id), n)).join('');
    let R = `<h4>Animals</h4>` + (animals || `<div class="nb-empty">No animals yet — build a shelter on a plot, then buy them at the Farm Store.</div>`);
    if (MC) {
      const m = e.mineNow(), f = e.flourNow();
      R += `<h4>Machines</h4>` + this._line('gold', `Gold mine · Level ${m.level}`, m.ready ? `${m.ready} to collect` : m.running ? 'running' : 'stopped', m.ready ? 'blue' : '')
        + this._line('flour', f ? `Flour machine · Level ${f.level}` : 'Flour machine', f ? (f.ready ? `${f.ready} packets` : f.grinding ? 'grinding' : 'idle') : 'not bought');
    }
    if (T && (T.dogs.length || e.qty('bone') || e.qty('dog_treat'))) {
      R += `<h4>Guard dogs</h4>` + T.dogs.map(d => this._line('guard_dog', `Dog ${d.slot + 1} · Level ${d.level}`, e.dogOnDuty(d) ? 'on duty' : 'asleep', e.dogOnDuty(d) ? '' : 'bad')).join('')
        + this._line('bone', 'Dog bones', qtyCap('bone')) + this._line('dog_treat', 'Dog treats', qtyCap('dog_treat'));
    }
    const f = st.fishing || {}, lv = f.rod || 1, rod = RODS[lv];
    if (e.cat('worms') || f.rod) {
      R += `<h4>Fishing</h4>` + this._line('rod', rod ? rod.name : 'Fishing rod', `Lv ${lv}`) + this._line('worms', 'Worms', qtyCap('worms'));
      R += FISH.filter(id => e.cat(id)).map(id => this._line(id, name(id), qtyCap(id))).join('');
    }
    const m = this.g.materials;
    if (m) R += `<h4>Your team's bag</h4>` + MATS.map(([k, n]) => this._line(k === 'stone' ? 'stone' : k, n, m.get(k) || 0)).join('');
    const o = this._order();
    const tab = (v, t, ic) => `<button class="nb-tab${this.view === v ? ' on' : ''}" data-nb-go="${v}">${icon(ic)}<span>${t}</span></button>`;
    return `<div class="nb">
      <div class="nb-tabs">${tab('book', 'Notebook', 'book')}${o.state !== 'none' ? tab('slip', 'Order slip', 'slip') : ''}</div>
      <button class="nb-x" data-nb="close" aria-label="Close">${icon('close')}</button>
      <div class="nb-head"><div class="nb-title">Farm Notebook</div><div class="nb-sub">${esc(this.g.worldName ? this.g.worldName() : '')}${this.g.dateText ? ' · ' + esc(this.g.dateText()) : ''}</div></div>
      <div class="nb-scroll"><div class="nb-pages"><div class="nb-page">${L}</div><div class="nb-ring" aria-hidden="true"></div><div class="nb-page">${R}</div></div></div>
    </div>`;
  }
  _slip() {
    const e = this.eco, { state, o } = this._order(), O = o.O;
    const tab = (v, t, ic) => `<button class="nb-tab${this.view === v ? ' on' : ''}" data-nb-go="${v}">${icon(ic)}<span>${t}</span></button>`;
    let body = '';
    if (!O) body = '<div class="sl-wait">Customer orders start once the farm server is updated.</div>';
    else {
      const x = o.ready;
      if (state === 'ready') {
        const rows = x.items.map(it => {
          const k = e.cat(it.item) || {}, have = e.qty(it.item), ok = have >= it.qty;
          return { ok, html: `<div class="sl-item ${ok ? 'ok' : 'need'}"><i class="sl-box">${ok ? icon('check') : ''}</i>${itemIcon(it.item)}<span class="sl-name">${esc(k.name || it.item)}</span>
            <b>${Math.min(have, it.qty)} / ${it.qty}</b>${ok ? '' : `<em>need ${it.qty - have} more</em>`}</div>` };
        });
        const missing = rows.filter(r => !r.ok).length;
        body = `<div class="sl-meta"><span>Order <b>${x.n}</b> of ${O.perDay}</span><span>From <b>${esc(x.customer)}</b></span></div>
          <div class="sl-items">${rows.filter(r => !r.ok).concat(rows.filter(r => r.ok)).map(r => r.html).join('')}</div>
          <div class="sl-sum ${missing ? 'need' : 'ok'}">${missing ? `${missing} item${missing > 1 ? 's' : ''} still to collect` : `${icon('checkCircle')} Everything's ready — deliver it at the Market`}</div>
          <div class="sl-pay"><span>Pays</span><b>${money(x.pay)}</b><small>+${Math.round(O.extra * 100)}% over market price</small></div>`;
      } else if (state === 'wait') body = `<div class="sl-wait">${icon('hourglass')} The next order arrives in <b data-cd="${o.next.availableAt}">${clock(Date.parse(o.next.availableAt) - e.serverNow())}</b></div>`;
      else body = `<div class="sl-wait ok">${icon('checkCircle')} All ${O.perDay} orders delivered today — new orders tomorrow.</div>`;
      const cycle = O.streak.days ? ((O.streak.days - 1) % O.streakDays) + 1 : 0;
      const dots = Array.from({ length: O.streakDays }, (_, i) => `<i class="${i < cycle ? 'on' : ''}"></i>`).join('');
      body += `<div class="sl-streak">${icon('fire')}<span>${O.streak.days ? `${O.streak.days}-day streak` : 'No streak yet'}</span><span class="sl-dots">${dots}</span></div>
        <div class="sl-done">${o.done.map(d => `<div>${icon('check')} Order ${d.n} · ${esc(d.customer)} · ${money(d.pay)}</div>`).join('')}</div>
        <div class="sl-ends">Today's orders end in <b data-cd="${O.endsAt}">${clock(o.endsMs)}</b></div>`;
    }
    const offers = this._offers();
    if (offers.length) {
      body += `<div class="sl-rent"><div class="sl-h">${icon('horse')} Horse rental requests</div>${offers.map(r => {
        const k = r.variety && e.cat(r.variety), free = e.freeHorses(r.variety), ok = free >= r.horses;
        return `<div class="sl-item ${ok ? 'ok' : 'need'}"><i class="sl-box">${ok ? icon('check') : ''}</i><span class="sl-name">${esc(r.renter)}: ${r.horses} ${k ? esc(k.name.toLowerCase()) : 'horse'}${r.horses > 1 ? 's' : ''} · ${r.hours} h</span><b>${money(r.pay)}</b>${ok ? '' : `<em>${free} of ${r.horses} ready</em>`}</div>`;
      }).join('')}</div>`;
    }
    return `<div class="slipwrap">
      <div class="nb-tabs">${tab('book', 'Notebook', 'book')}${tab('slip', 'Order slip', 'slip')}</div>
      <div class="slip"><button class="nb-x" data-nb="close" aria-label="Close">${icon('close')}</button>
        <div class="sl-head"><div class="sl-title">ORDER SLIP</div><div class="sl-sub">Deliver at the Market</div></div>
        <div class="nb-scroll">${body}</div>
      </div></div>`;
  }
}
