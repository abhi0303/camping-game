import { icon } from './icons.js';
// Building materials (stack counts, separate from the 6-slot backpack)
export const MAT_INFO = {
  logs: { icon: icon('wood'), name: 'Logs' }, planks: { icon: icon('planks'), name: 'Planks' }, rope: { icon: icon('rope'), name: 'Rope' }, stone: { icon: icon('stone'), name: 'Stones' },
};

export class Materials {
  constructor() {
    this.c = { logs: 0, planks: 0, rope: 0, stone: 0 };
    this.el = document.getElementById('matsBar');
    this.listeners = [];
    this.net = null;          // in co-op the pool is shared; guests send changes to the host
    this.render();
  }
  get(k) { return this.c[k] || 0; }
  add(k, n) { this.delta({ [k]: n }); }
  addAll(obj) { this.delta(obj); }
  has(cost) { return Object.keys(cost).every(k => this.get(k) >= cost[k]); }
  spend(cost) { if (!this.has(cost)) return false; const d = {}; for (const k in cost) d[k] = -cost[k]; this.delta(d); return true; }
  delta(d, fromNet = false) {
    for (const k in d) this.c[k] = Math.max(0, (this.c[k] || 0) + d[k]);
    if (!fromNet && this.net && this.net.isGuest) this.net.send('mat', d, true);
    this._changed();
  }
  setAll(obj) {
    if (Object.keys(obj).every(k => this.c[k] === obj[k])) return;
    this.c = { ...this.c, ...obj }; this._changed();
  }
  onChange(fn) { this.listeners.push(fn); }
  _changed() { this.render(); this.listeners.forEach(f => f()); }
  render() {
    const any = Object.values(this.c).some(v => v > 0);
    this.el.classList.toggle('hidden', !any);
    this.el.innerHTML = Object.keys(MAT_INFO).map(k => `<span title="${MAT_INFO[k].name}">${MAT_INFO[k].icon} ${this.c[k]}</span>`).join('');
  }
}
