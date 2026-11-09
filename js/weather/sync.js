// The world's real weather in this game (the farm server decides it: server/src/weather.js).
//   - Opening Farm World: ask the server once. After that new weather arrives by itself: the host's heartbeat
//     brings it (js/farm/farm.js) and the host passes it to everyone over the live game ('wx'). A newer
//     version always wins, so every player ends up with the same weather.
//   - A check every few minutes (and when the tab comes back) asks the server again only if an update was missed.
//   - The weather leader's game sends the leader's place when the server asks for it: the browser's location
//     (asked with an in-game question first; once allowed, it's used without asking), or a city picked by hand
//     (when location is turned off, or the leader prefers). "Not now" stops the questions; the last weather stays.
//     What this device chose is remembered, so the browser's location prompt never comes back again and again.
import { api } from '../farm/api.js';
import { WEATHER } from './rules.js';

const PREF_KEY = 'rv-weather-place';    // { mode: 'gps' } | { mode: 'city', label, lat, lon } | { mode: 'off' } | { mode: 'denied' }
const readPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (e) { return null; } };
const writePref = v => { try { localStorage.setItem(PREF_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } };

export class WeatherSync {
  // g: { farm, net, toast, now() (server clock ms), onChange(w, prev), ask(kind, opts) (js/weather/ui.js: the questions) }
  constructor(g) {
    this.g = g; this.w = null; this.on = false; this.busy = false; this.fails = 0; this.retryAt = 0; this.askedFor = null; this.sending = false;
    g.net.on('wx', d => { if (this.on && d && d.w) this.apply(d.w); });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) this._check(); });
    setInterval(() => this._check(), WEATHER.clientCheckMin * 60e3);
  }
  get rev() { return this.w ? this.w.rev : -1; }
  get me() { const L = this.g.farm.L; return L ? L.memberId : null; }
  get isLeader() { return !!(this.w && this.w.leader && this.w.leader.id === this.me); }
  get pref() { return readPref(); }

  start() { this.on = true; this.w = null; this.askedFor = null; this.fails = 0; this.retryAt = 0; this.fetch(); }
  stop() { if (!this.on) return; this.on = false; const prev = this.w; this.w = null; this.g.onChange(null, prev); }

  // newer weather (from the server, the host, or another player): show it; the host passes the server's on
  apply(w, pass = false) {
    if (!this.on || !w || typeof w.rev !== 'number' || (this.w && w.rev <= this.w.rev)) return false;
    const prev = this.w; this.w = w;
    if (pass) try { this.g.net.send('wx', { w }); } catch (e) { /* playing alone */ }
    this.g.onChange(w, prev);
    this._leaderDuty();
    return true;
  }
  fromHeartbeat(w) { if (this.apply(w) && this.g.net.isHost) try { this.g.net.send('wx', { w }); } catch (e) { /* alone */ } }

  async fetch() {
    if (this.busy || !this.on || !this.g.farm.L) return;
    this.busy = true;
    try {
      const r = await api.weather(this.g.farm.L);
      this.fails = 0; this.retryAt = 0;
      this.apply(r.weather);
    } catch (e) {
      this.fails++; this.retryAt = Date.now() + Math.min(60, 2 ** this.fails) * 60e3;      // 2, 4, 8 … 60 min
    } finally { this.busy = false; }
  }
  // a missed update? (the weather should have been refreshed by now)
  _check() {
    if (!this.on || (typeof document !== 'undefined' && document.hidden) || Date.now() < this.retryAt) return;
    const w = this.w, now = this.g.now ? this.g.now() : Date.now();
    if (!w || (w.next && now > Date.parse(w.next) + 3 * 60e3)) this.fetch();
  }

  /* ---------- the weather leader ---------- */
  async _leaderDuty() {
    const w = this.w;
    if (!this.isLeader || !w.need || this.sending || this.askedFor === w.leader.id) return;
    this.askedFor = w.leader.id;                               // once a game per leadership (no nagging)
    const pref = readPref();
    if (pref && pref.mode === 'city' && isFinite(pref.lat)) { this.send({ op: 'place', lat: pref.lat, lon: pref.lon, label: pref.label }); return; }
    if (pref && pref.mode === 'off') { this.send({ op: 'skip' }); return; }
    const perm = await geoPermission();
    if (perm === 'granted' || (pref && pref.mode === 'gps' && perm !== 'denied')) { this.useLocation(); return; }
    if (perm === 'denied' || perm === 'unsupported' || (pref && pref.mode === 'denied')) { this.g.ask('city', { why: 'denied' }); return; }
    this.g.ask('choose', { first: !w.cur });
  }
  // the browser's location (the browser may ask first)
  useLocation() {
    return new Promise(done => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) { this.g.ask('city', { why: 'denied' }); done(false); return; }
      navigator.geolocation.getCurrentPosition(p => {
        writePref({ mode: 'gps' });
        this.send({ op: 'gps', lat: p.coords.latitude, lon: p.coords.longitude }).then(done);
      }, err => {
        if (err && err.code === 1) { writePref({ mode: 'denied' }); this.g.ask('city', { why: 'denied' }); }
        else this.g.toast('📍 Could not find your location — the weather stays as it is. Pick a city from the weather panel instead.');
        done(false);
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 30 * 60e3 });
    });
  }
  pickCity(p) { writePref({ mode: 'city', label: p.label, lat: p.lat, lon: p.lon }); return this.send({ op: 'place', lat: p.lat, lon: p.lon, label: p.label }); }
  notNow() { writePref({ mode: 'off' }); return this.send({ op: 'skip' }); }
  places(q) { return api.weatherPlaces(this.g.farm.L, q).then(r => r.places || []); }
  async send(body) {
    if (!this.g.farm.L) return false;
    this.sending = true;
    try {
      const r = await api.weatherSet(this.g.farm.L, body);
      this.apply(r.weather, true);
      return true;
    } catch (e) {
      if (e.code === 'not_leader') { this.askedFor = null; this.fetch(); }
      else this.g.toast('⚠ ' + (e.message || 'Could not update the weather place'));
      return false;
    } finally { this.sending = false; }
  }
}

async function geoPermission() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  try { if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (e) { /* not supported */ }
  return 'prompt';
}
