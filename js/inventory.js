import { ITEMS, itemModel, placeInSlot, STORE_ROT } from './items.js';
import { audio } from './audio.js';

const BACKPACK_SIZE = 6;
const TOUCH = () => document.body.classList.contains('touch');
let uid = 0;
const newItem = type => ({ uid: ++uid, type });
const fill = (n, types) => Array.from({ length: n }, (_, i) => (types[i] ? newItem(types[i]) : null));

// Slot positions are in RV body-local space (where each item model sits on its shelf)
function lockerSlots() {
  const s = [], x = 0.86;
  for (const z of [0.46, 0.79]) s.push([x, 0.62, z, 0.3, 0.5]);
  for (const y of [1.165, 1.765]) for (const z of [0.42, 0.625, 0.83]) s.push([x, y, z, 0.18, 0.55]);
  for (const z of [0.46, 0.79]) s.push([x, 2.365, z, 0.3, 0.5]);
  return s;
}
function fridgeSlots() {
  const s = [];
  for (const y of [0.63, 1.065, 1.515]) for (const z of [-0.24, 0.06]) s.push([0.84, y, z, 0.2, 0.36]);
  return s;
}
function baySlots() {
  const s = [];
  for (const z of [-3.24, -3.02, -2.8]) for (const x of [0.95, 0.52]) s.push([x, 0.57, z, 0.4, 0.33]);
  return s;
}

export class Inventory {
  constructor(hooks) {
    this.hooks = hooks; this.sets = []; this.player = null;
    this.backpack = new Array(BACKPACK_SIZE).fill(null);
    this.equipped = -1;
    this.openSt = null;
    this._buildUI();
    this.renderHotbar();
  }

  // every RV has its own locker / fridge / storage bay
  addRV(rv) {
    const set = [
      { id: 'locker', name: 'Gear Locker', icon: '🧰', doors: ['lockerA', 'lockerB'], slotPos: lockerSlots(),
        slots: fill(10, ['chainsaw', 'axe', 'drone', 'sledge', 'hammer', 'flashlight', 'rope', 'binoculars']) },
      { id: 'fridge', name: 'Fridge', icon: '🧊', doors: ['fridge'], slotPos: fridgeSlots(), slots: fill(6, ['water', 'soda', 'sandwich', 'water']) },
      { id: 'bay', name: 'Outdoor Storage Bay', icon: '🏕️', doors: ['bay'], slotPos: baySlots(), slots: fill(6, ['tent', 'chair', 'sleepingbag', 'lantern']) },
    ];
    set.forEach(st => { st.rv = rv; st.rvIndex = rv.index; st.meshes = st.slots.map(() => null); this.syncVisuals(st); });
    this.sets[rv.index] = set;
  }
  current() { const i = this.player ? this.player.rvs.indexOf(this.player.rv) : 0; return this.sets[i] || this.sets[0]; }
  types(st) { return st.slots.map(it => (it ? it.type : null)); }
  // replace a storage's contents (from the network or a save)
  applyStorage(rvIndex, id, types) {
    const set = this.sets[rvIndex], st = set && set.find(x => x.id === id);
    if (!st) return;
    types.forEach((t, i) => { if ((st.slots[i] ? st.slots[i].type : null) !== t) st.slots[i] = t ? newItem(t) : null; });
    this.syncVisuals(st);
    if (this.openSt === st) this.renderModal();
  }
  setBackpack(types) { this.backpack = types.map(t => (t ? newItem(t) : null)); this.equipped = -1; this._changed(); }

  get isOpen() { return !!this.openSt; }
  storage(id) { return this.current().find(s => s.id === id); }
  equippedItem() { return this.equipped >= 0 ? this.backpack[this.equipped] : null; }
  has(type) { return this.backpack.some(it => it && it.type === type); }
  freeSlots() { return this.backpack.filter(it => !it).length; }

  // Interactions the player can trigger near each storage (RV local positions)
  acts() {
    return [
      { where: 'in', at: [0.25, 0.62], r: 0.65, label: () => 'Open Gear Locker', act: () => this.openStorage(this.storage('locker')) },
      { where: 'in', at: [0.2, -0.1], r: 0.7, label: () => 'Open fridge', act: () => this.openStorage(this.storage('fridge')) },
      { where: 'out', at: [1.75, -3.02], r: 1.3, label: () => 'Open storage bay', act: () => this.openStorage(this.storage('bay')) },
    ];
  }

  /* ---------- backpack ---------- */
  addItem(it) {
    const i = this.backpack.indexOf(null);
    if (i < 0) return false;
    this.backpack[i] = it; this._changed(); return true;
  }
  add(type) { return this.addItem(newItem(type)); }
  removeItem(it) {
    const i = this.backpack.indexOf(it);
    if (i < 0) return;
    this.backpack[i] = null;
    if (this.equipped === i) this.equipped = -1;
    this._changed();
  }
  removeType(type) { const it = this.backpack.find(x => x && x.type === type); if (it) this.removeItem(it); return !!it; }
  equip(i) {
    if (i < 0 || i >= BACKPACK_SIZE) return;
    this.equipped = (this.equipped === i || !this.backpack[i]) ? -1 : i;
    audio.click(); this._changed();
  }
  _changed() { this.renderHotbar(); if (this.openSt) this.renderModal(); this.hooks.onChange && this.hooks.onChange(); }

  /* ---------- storage ---------- */
  syncVisuals(st) {
    const parent = st.rv.m.groups.base;
    st.slots.forEach((it, i) => {
      const cur = st.meshes[i];
      if (cur && (!it || cur.userData.uid !== it.uid)) { parent.remove(cur); st.meshes[i] = null; }
      if (it && !st.meshes[i]) {
        const m = itemModel(it.type), p = st.slotPos[i];
        placeInSlot(m, p[0], p[1], p[2], p[3], p[4], STORE_ROT[it.type]);
        m.userData.uid = it.uid;
        parent.add(m); st.meshes[i] = m;
      }
    });
  }
  openStorage(st) {
    if (this.openSt) return;
    this.openSt = st;
    st.doors.forEach(d => st.rv.setDoor(d, true));
    audio.thud(150, 0.1);
    this.ui.root.classList.remove('hidden');
    this.renderModal();
    this.hooks.onOpen && this.hooks.onOpen();
  }
  closeStorage() {
    const st = this.openSt;
    if (!st) return;
    this.openSt = null;
    st.doors.forEach(d => st.rv.setDoor(d, false));
    audio.thud(120, 0.1);
    this.ui.root.classList.add('hidden');
    this.hooks.onClose && this.hooks.onClose();
  }
  take(i) {
    const st = this.openSt, it = st && st.slots[i];
    if (!it) return;
    const j = this.backpack.indexOf(null);
    if (j < 0) { this._info('Your backpack is full — put something back first.'); return; }
    st.slots[i] = null; this.backpack[j] = it;
    if (this.equipped < 0) this.equipped = j;
    audio.click(); this.syncVisuals(st); this._changed(); this.hooks.onStorage && this.hooks.onStorage(st);
    this._info(TOUCH() ? `Took ${ITEMS[it.type].name}. Tap slot ${j + 1} below to hold it.` : `Took ${ITEMS[it.type].name}. Press ${j + 1} to hold it, F to use.`);
  }
  put(j) {
    const st = this.openSt, it = this.backpack[j];
    if (!st || !it) return;
    const i = st.slots.indexOf(null);
    if (i < 0) { this._info(`The ${st.name.toLowerCase()} is full.`); return; }
    this.backpack[j] = null; st.slots[i] = it;
    if (this.equipped === j) this.equipped = -1;
    audio.click(); this.syncVisuals(st); this._changed(); this.hooks.onStorage && this.hooks.onStorage(st);
    this._info(`Put back ${ITEMS[it.type].name}.`);
  }
  takeAll() { const st = this.openSt; if (!st) return; st.slots.forEach((it, i) => { if (it && this.backpack.includes(null)) this.take(i); }); }

  /* ---------- UI ---------- */
  _buildUI() {
    const $ = id => document.getElementById(id);
    this.ui = { root: $('storageUI'), title: $('sTitle'), sCap: $('sCap'), bCap: $('bCap'), sGrid: $('sGrid'), bGrid: $('bGrid'), info: $('sInfo'), hotbar: $('hotbar'), hbName: $('hbName') };
    $('sClose').addEventListener('click', () => this.closeStorage());
    this.ui.root.addEventListener('click', e => { if (e.target === this.ui.root) this.closeStorage(); });   // tap outside = close
    this.ui.hotbar.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) this.equip(+b.dataset.i); });
    $('sTakeAll').addEventListener('click', () => this.takeAll());
    this.ui.sGrid.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) this.take(+b.dataset.i); });
    this.ui.bGrid.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) this.put(+b.dataset.i); });
    const hover = e => { const b = e.target.closest('[data-type]'); if (b) this._info(ITEMS[b.dataset.type].desc); };
    this.ui.sGrid.addEventListener('mouseover', hover); this.ui.bGrid.addEventListener('mouseover', hover);
    document.addEventListener('keydown', e => {
      if (!this.openSt) return;
      if (e.code === 'KeyE' || e.code === 'Escape' || e.code === 'Tab') { e.preventDefault(); this.closeStorage(); }
    });
  }
  _info(t) { this.ui.info.textContent = t; }
  _slotsHTML(slots, action) {
    return slots.map((it, i) => it
      ? `<button class="slot" data-i="${i}" data-type="${it.type}" title="${action} ${ITEMS[it.type].name}"><span class="ico">${ITEMS[it.type].icon}</span><span class="nm">${ITEMS[it.type].name}</span></button>`
      : `<div class="slot empty"></div>`).join('');
  }
  renderModal() {
    const st = this.openSt, u = this.ui;
    if (!st) return;
    const used = st.slots.filter(Boolean).length;
    u.title.textContent = `${st.icon} ${st.name}`;
    const verb = TOUCH() ? 'tap' : 'click';
    u.sCap.textContent = `Storage ${used}/${st.slots.length} — ${verb} to take`;
    u.bCap.textContent = `Backpack ${BACKPACK_SIZE - this.freeSlots()}/${BACKPACK_SIZE} — ${verb} to put back`;
    u.sGrid.innerHTML = this._slotsHTML(st.slots, 'Take');
    u.bGrid.innerHTML = this._slotsHTML(this.backpack, 'Put back');
  }
  renderHotbar() {
    const u = this.ui;
    u.hotbar.innerHTML = this.backpack.map((it, i) =>
      `<div data-i="${i}" class="hb${i === this.equipped ? ' sel' : ''}${it ? '' : ' empty'}"><span class="n">${i + 1}</span>${it ? ITEMS[it.type].icon : ''}</div>`).join('');
    const eq = this.equippedItem();
    u.hbName.textContent = eq ? `${ITEMS[eq.type].name}${TOUCH() ? '' : ' — F to use'}` : (this.backpack.some(Boolean) ? (TOUCH() ? 'Tap a slot to hold an item' : 'Press 1-6 to hold an item') : '');
  }
}
