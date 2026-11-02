// The farm's shared money and goods on this device. The server is the only one that changes them:
// every purchase / sale / build goes to the server, which answers with the new state. Then the other
// players are told over PeerJS that the farm changed, and they fetch it too. A refresh every minute
// shows what the animals produced in the meantime.
import { api, LOGIN_GONE } from './api.js';

const REFRESH_MS = 60000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

export class FarmEconomy {
  // g: { net, toast, onChange(state), onGone(msg) }
  constructor(g) {
    this.g = g; this.L = null; this.st = null; this.offset = 0; this.busy = 0; this.bestRtt = Infinity; this.syncAt = 0;
    g.net.on('farmRev', d => { if (this.L && d && (!this.st || d.rev > this.st.rev)) this._soon(); });
  }
  start(L) {
    this.L = L;
    clearInterval(this.pollT);
    this.pollT = setInterval(() => this.load(), REFRESH_MS);
    return this.load();
  }
  stop() { clearInterval(this.pollT); this.L = null; }
  _soon() { clearTimeout(this.soonT); this.soonT = setTimeout(() => this.load(), 400); }

  async load() {
    if (!this.L) return null;
    try { const t0 = Date.now(), st = await api.farm(this.L); this._clock(st.at, t0, Date.now()); this._apply(st); return st; }
    catch (e) { if (LOGIN_GONE.has(e.code) && this.g.onGone) this.g.onGone(e.message); return null; }
  }
  _apply(st) {
    if (!st || (this.st && st.at < this.st.at)) return;          // an older answer that arrived late
    this.st = st;
    this.g.onChange(st);
  }
  // The server's clock, seen from here: its time stamp belongs halfway through the request. Quick
  // answers give the best estimate, so a slower one only replaces it after a few minutes.
  _clock(at, t0, t1) {
    const rtt = t1 - t0, now = Date.now();
    if (rtt <= this.bestRtt * 1.5 || now - this.syncAt > 300000) {
      this.offset = Date.parse(at) - (t0 + t1) / 2;
      this.bestRtt = Math.min(rtt, this.bestRtt); this.syncAt = now;
    }
  }
  // the server's clock (animals move by it, so everyone sees the same thing)
  serverNow() { return Date.now() + this.offset; }

  // one action ({ action: 'buy' | 'sell' | 'build' | 'deposit', ... }). A lost connection is retried with the
  // same request id, so the server can never do it twice. Throws ApiError with a readable message.
  async act(body) {
    const requestId = newId();
    this.busy++;
    try {
      for (let i = 0; ; i++) {
        try {
          const t0 = Date.now(), r = await api.farmAct(this.L, { requestId, ...body });
          this._clock(r.at, t0, Date.now());
          if (body.action === 'sell') this.sold = true;
          this._apply(r);
          try { this.g.net.send('farmRev', { rev: r.rev }); } catch (e) { /* playing alone */ }
          return r;
        } catch (e) {
          if (e.code !== 'network' || i >= 2) throw e;
          await sleep(900 * (i + 1));
        }
      }
    } finally { this.busy--; }
  }
  history() { return api.farmHistory(this.L).then(r => r.history); }

  /* ---------- helpers for the screens ---------- */
  get ready() { return !!this.st; }
  get money() { return this.st ? this.st.money : 0; }
  qty(item) { return this.st ? this.st.inventory[item] || 0 : 0; }
  cat(item) { return this.st ? this.st.catalog[item] : null; }
  items(kind) { return this.st ? Object.entries(this.st.catalog).filter(([, v]) => v.kind === kind).map(([k, v]) => ({ id: k, ...v })) : []; }
  animalsIn(buildingId) { return this.st ? this.st.animals.filter(a => a.shelter === buildingId) : []; }
  count(type) { return this.st ? this.st.animals.filter(a => a.type === type).length : 0; }
  // free places for this kind of animal (in all its shelters)
  freeFor(type) {
    const k = this.cat(type); if (!k || !this.st) return 0;
    const home = this.cat(k.shelter);
    return this.st.buildings.filter(b => b.type === k.shelter).reduce((t, b) => t + Math.max(0, home.capacity - this.animalsIn(b.id).length), 0);
  }
  // per hour, with every animal fed and healthy
  feedPerHour() { return this.st ? this.st.animals.reduce((t, a) => t + (this.cat(a.type).feed || 0), 0) : 0; }
  makesPerHour(product) {
    return this.st ? this.st.animals.reduce((t, a) => { const k = this.cat(a.type); return t + (k.product === product ? k.rate * (a.health / 100) : 0); }, 0) : 0;
  }
  feedHours() { const f = this.feedPerHour(); return f > 0 ? Math.max(0, this.qty('feed') - (this.st.feedEaten || 0)) / f : Infinity; }
}
