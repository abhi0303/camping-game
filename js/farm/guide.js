// Farm World's guide: the goal card on the left of the screen.
//   - "Now": something that needs doing straight away — hungry animals, full nests, a thief who has noticed the
//     eggs, a guard dog asleep from hunger, a full storage.
//   - "Next goal": the first step of the farm's growth that isn't done yet (coop → chickens → feeding → selling →
//     a guard dog → goats → a full coop → a bigger storage → fishing → a cow → a horse → training the dog → a
//     second dog → Sonpur and its football), with how many of the steps are done.
// Everything is read from the farm's saved state (the same for every player of the world), so a step never comes
// back once it's done, and steps done out of order are skipped.
import { PLOTS, STORE, MARKET, STORAGE, FISH_MARKET, FARM_CENTER, inFarm } from './layout.js';
import { BOUNDS as VILLAGE } from '../village/layout.js';

const plural = n => (/s$/.test(n) ? n : n + 's');
const has = (s, type) => s.buildings.some(b => b.type === type);
const KIND = { coop: 'chicken', goat_shed: 'goat', barn: 'cow', stable: 'horse' };
const count = (s, pre) => s.animals.filter(a => a.type.startsWith(pre)).length;

export class FarmGuide {
  // g: { eco, where() -> { x, z }, fishArea, village }
  constructor(g) {
    this.g = g;
    try { this.visited = localStorage.getItem('rv-sonpur') === '1'; } catch (e) { this.visited = false; }
    const eco = () => this.g.eco, plotOf = type => { const s = eco().st, b = s && s.buildings.find(q => q.type === type); return b ? PLOTS[b.plot] : PLOTS[0]; };
    const freePlot = () => { const s = eco().st, used = new Set(s ? s.buildings.map(b => b.plot) : []); return PLOTS.find((P, i) => !used.has(i)) || FARM_CENTER; };
    this.steps = [
      { text: 'Walk to the farm east of the trailhead (follow the FARM sign by the road)', done: s => this._inFarm() || s.buildings.length > 0, at: () => FARM_CENTER },
      { text: 'Get 20 wood: chop trees and store the logs at the farm storage — or buy wood at the Farm Store across the road', done: s => (s.inventory.wood || 0) >= 20 || s.buildings.length > 0, at: () => STORAGE },
      { text: 'Build a chicken coop: walk up to a plot sign and press E', done: s => has(s, 'coop'), at: () => PLOTS[0] },
      { text: 'Buy chickens (and feed) from the farmer at the Farm Store, across the road', done: s => count(s, 'chicken') > 0, at: () => STORE },
      { text: 'Feed your chickens: open the pen gate, walk to the trough and press E — fed chickens lay eggs', done: s => s.animals.some(a => a.fedUntil), at: () => plotOf('coop') },
      { text: 'Collect the eggs at the nest boxes, then sell them at the Market', done: s => (s.totalEarned || 0) > 0, at: () => (Object.values(eco().eggsReady()).some(n => n > 0) ? plotOf('coop') : MARKET) },
      { text: s => (s.money < 1000 ? 'Save up ₹1000 for a guard dog — thieves come for eggs left in the nests' : 'Buy a guard dog at the Farm Store (Guard dogs) — it keeps thieves away from your eggs'),
        done: s => !s.thieves || s.thieves.dogs.length > 0, at: () => STORE },
      { text: 'Build a goat shed on a free plot and buy goats — goat milk sells well', done: s => count(s, 'goat') > 0, at: () => (has(eco().st, 'goat_shed') ? STORE : freePlot()) },
      { text: 'Fill the coop: six chickens lay twice the eggs of three', done: s => count(s, 'chicken') >= 6, at: () => STORE },
      { text: 'Upgrade the farm storage, so more eggs, milk and wood fit', done: s => (s.storageLevel || 1) >= 2, at: () => STORAGE },
      { text: 'Go fishing: buy worms at the Fish Market, follow the path to the river docks and land a fish', done: s => eco().fished || !!(s.fishing && s.fishing.mine),
        at: () => (eco().qty('worms') && this.g.fishArea.spots[1] ? this.g.fishArea.spots[1].stand : FISH_MARKET) },
      { text: 'Build a cow barn and buy a cow — cow milk is worth the most', done: s => count(s, 'cow') > 0, at: () => (has(eco().st, 'barn') ? STORE : freePlot()) },
      { text: s => (!s.fields || !s.fields.list.length ? 'Buy a field by the big windmill (east of the road) and grow wheat: seeds, sow, water, harvest' : 'Grow wheat: sow a field (seed bags at the Farm Store), water it, and harvest it after 2 hours'),
        done: s => !s.fields || (s.inventory.wheat || 0) > 0, at: () => this.g.fieldsAt ? this.g.fieldsAt() : FARM_CENTER },
      { text: 'Collect gold coins at the gold mine south of the windmill — it works by itself at night (7 PM – 4 AM)',
        done: s => !s.machines || s.machines.gold > 0 || !!s.machines.flour || s.machines.mine.level > 1, at: () => (this.g.mineAt ? this.g.mineAt() : FARM_CENTER) },
      { text: 'Buy the flour machine (10 gold) across the road from the Farm Store, and grind your wheat into flour',
        done: s => !s.machines || !!s.machines.flour, at: () => (this.g.flourAt ? this.g.flourAt() : STORE) },
      { text: 'Build a horse stable and raise a horse — grown horses can be rented out', done: s => count(s, 'horse') > 0, at: () => (has(eco().st, 'stable') ? STORE : freePlot()) },
      { text: 'Train your guard dog to level 2 at the Farm Store — it stops more thieves', done: s => !s.thieves || s.thieves.dogs.some(d => d.level >= 2), at: () => STORE },
      { text: 'Get a second guard dog: two dogs guard the farm better than one', done: s => !s.thieves || s.thieves.dogs.length >= 2, at: () => STORE },
      { text: 'Visit Sonpur village behind the Market — and play football with the kids on the green', done: () => this.visited,
        at: () => (this.g.village.people && this.g.village.people.field ? this.g.village.people.field : this.g.village.spots.square) },
    ];
    this.plotOf = plotOf;
  }
  _inFarm() { const p = this.g.where(); return inFarm(p.x, p.z); }
  // what needs doing right now (null: nothing)
  _urgent(s) {
    const e = this.g.eco, now = e.serverNow(), T = e.thieves();
    // a thief has noticed the eggs (he comes unless they're collected)
    if (T && T.dueAt && Date.parse(T.dueAt) > now && !e.liveRaid(now)) {
      const min = Math.max(1, Math.round((Date.parse(T.dueAt) - now) / 60000));
      return { text: `A thief has noticed your eggs — collect them before he comes (about ${min} min)`, at: this.plotOf('coop'), tone: 'bad' };
    }
    let full = null;
    for (const b of s.buildings) {
      const info = e.shelterInfo(b);
      if (!info.count) continue;
      const nm = KIND[b.type] || 'animal', one = info.hungry === 1;
      if (info.hungry) {
        const who = info.hungry === info.count ? `Your ${one ? nm : plural(nm)}` : `${info.hungry} of your ${plural(nm)}`;
        return { text: `${who} on plot ${b.plot + 1} ${one && info.count === 1 ? 'is' : info.hungry === info.count ? 'are' : one ? 'is' : 'are'} hungry — feed ${one ? 'it' : 'them'} at the trough`, at: PLOTS[b.plot], tone: 'warn' };
      }
      if (!full && info.nestsFull) full = { text: `${info.nestsFull} ${info.nestsFull === 1 ? 'nest is' : 'nests are'} full on plot ${b.plot + 1} — collect the eggs so the hens keep laying`, at: PLOTS[b.plot], tone: 'warn' };
      if (!full && info.full) full = { text: `The storage is full of ${info.products.map(p => (e.cat(p) || {}).name || p).join(' and ').toLowerCase()} — sell some at the Market`, at: MARKET, tone: 'warn' };
    }
    if (full) return full;
    if (T && T.dogs.length && !T.dogs.some(d => e.dogOnDuty(d, now))) return { text: `Your guard dog${T.dogs.length > 1 ? 's are' : ' is'} hungry and asleep — give ${T.dogs.length > 1 ? 'them' : 'it'} a bone or a treat (Farm Store)`, at: STORE, tone: 'warn' };
    return null;
  }
  // { urgent, step: { text, at }, n (steps done), total, allDone }
  get() {
    const s = this.g.eco.st;
    if (!this.visited) { const p = this.g.where(); if (p.x > VILLAGE.x0 && p.x < VILLAGE.x1 && p.z > VILLAGE.z0 && p.z < VILLAGE.z1) { this.visited = true; try { localStorage.setItem('rv-sonpur', '1'); } catch (e) { /* storage off */ } } }
    if (!s) return { urgent: null, step: { text: 'The farm is loading…', at: FARM_CENTER }, n: 0, total: this.steps.length, allDone: false };
    let n = 0, step = null;
    for (const st of this.steps) { if (st.done(s)) n++; else if (!step) step = st; }
    return { urgent: this._urgent(s), step: step && { text: typeof step.text === 'function' ? step.text(s) : step.text, at: step.at() }, n, total: this.steps.length, allDone: !step };
  }
}
