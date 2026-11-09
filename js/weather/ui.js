// The weather on screen (Farm World): a small chip in the top bar (icon, temperature, AQI), a panel with the
// details when you tap it, the weather leader's questions (share a location / pick a city / not now), and a
// short message when the weather leader changes, the weather turns, or the air quality changes category.
import { icon } from '../icons.js';
import { CONDITIONS, POLLUTANT_NAMES } from './rules.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeIST = iso => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = d => COMPASS[Math.round((((+d || 0) % 360) + 360) % 360 / 45) % 8];
const r0 = v => (v == null ? '–' : Math.round(v));
const GROUP = { clear: 'fair', partly: 'fair', cloudy: 'cloudy', fog: 'fog', drizzle: 'rain', rain: 'rain', heavy: 'rain', storm: 'storm', snow: 'snow' };
const TURN = { rain: '🌧 It has started raining on the farm', storm: '⛈ A thunderstorm has reached the farm', fog: '🌫 Fog is rolling over the farm', cloudy: '☁ The sky over the farm has clouded over', snow: '☁ It is snowing where the weather comes from', fair: '🌤 The sky over the farm is clearing' };

export class WeatherUI {
  // g: { sync (WeatherSync), toast, touch() (true on phones) }
  constructor(g) {
    this.g = g; this.open = false;
    const top = document.getElementById('topc'), sync = document.getElementById('syncBtn');
    this.btn = document.createElement('button'); this.btn.id = 'wxBtn'; this.btn.className = 'panel hidden'; this.btn.title = 'Weather on the farm';
    (sync && sync.parentNode === top ? sync : top.lastChild).after(this.btn);
    this.panel = document.createElement('div'); this.panel.id = 'wxPanel'; this.panel.className = 'panel hidden';
    this.ask = document.createElement('div'); this.ask.id = 'wxAsk'; this.ask.className = 'panel hidden';
    document.getElementById('hud').append(this.panel, this.ask);
    this.btn.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    this.panel.addEventListener('click', e => this._click(e));
    this.ask.addEventListener('click', e => this._click(e));
    this.ask.addEventListener('input', e => { if (e.target.id === 'wxQ') this._search(e.target.value); });
    for (const el of [this.panel, this.ask]) for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) el.addEventListener(ev, e => e.stopPropagation());
    document.addEventListener('pointerdown', e => { if (this.open && !this.panel.contains(e.target) && e.target !== this.btn) this.toggle(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape') { if (!this.ask.classList.contains('hidden')) this.closeAsk(); else if (this.open) this.toggle(false); } });
  }
  get w() { return this.g.sync.w; }
  show(on) { this.btn.classList.toggle('hidden', !on); if (!on) { this.toggle(false); this.closeAsk(); } }
  toggle(on = !this.open) { this.open = on; this.panel.classList.toggle('hidden', !on); if (on) this.renderPanel(); }

  /* ---------- the chip ---------- */
  render() {
    const w = this.w, S = this.g.sync;
    let h;
    if (!w || !w.cur || !w.cond) {
      const mine = S.isLeader && w && w.status === 'no_location';
      h = mine ? `${icon('pin')}<span class="lbl">Set weather</span>` : `${icon('cloud')}<span class="lbl dim">${w && w.status === 'loading' ? 'Weather…' : 'Weather'}</span>`;
      this.btn.classList.toggle('nudge', !!mine);
    } else {
      const a = w.aqi;
      h = `${icon(w.cond.icon)}<b>${r0(w.cur.temp)}°</b>${a ? `<span class="wx-aqi" style="--c:${a.color}" title="AQI ${a.value} · ${esc(a.cat)}">AQI ${a.value}</span>` : ''}`;
      this.btn.classList.remove('nudge');
      this.btn.title = `${w.cond.label}, ${r0(w.cur.temp)}°C${a ? ` · AQI ${a.value} (${a.cat})` : ''} — tap for details`;
    }
    this.btn.classList.toggle('stale', !!(w && w.status === 'error'));
    if (this.btn.dataset.h !== h) { this.btn.dataset.h = h; this.btn.innerHTML = h; }
    if (this.open) this.renderPanel();
  }

  /* ---------- the details ---------- */
  renderPanel() {
    const w = this.w, S = this.g.sync, me = S.isLeader;
    const parts = [];
    if (w && w.cur && w.cond) {
      const c = w.cur;
      parts.push(`<div class="wx-head">${icon(w.cond.icon, 'big')}<div><b>${esc(w.cond.label)}</b><span>${r0(c.temp)}°C · feels like ${r0(c.feels)}°</span></div><button class="wx-x" data-wx="close" title="Close">${icon('close')}</button></div>`);
      parts.push(`<div class="wx-grid">
        <div>${icon('drop')}<span>Humidity</span><b>${r0(c.humidity)}%</b></div>
        <div>${icon('wind')}<span>Wind</span><b>${r0(c.wind)} km/h ${compass(c.windDir)}</b></div>
        <div>${icon('cloud')}<span>Clouds</span><b>${r0(c.cloud)}%</b></div>
        <div>${icon('rain')}<span>Rain</span><b>${c.precip == null ? '–' : (+c.precip).toFixed(1)} mm</b></div>
        <div>${icon('fog')}<span>Visibility</span><b>${c.vis == null ? '–' : c.vis >= 10000 ? Math.round(c.vis / 1000) + ' km' : (c.vis / 1000).toFixed(1) + ' km'}</b></div>
        <div>${icon('sunrise')}<span>${c.sunrise || '–'}</span>${icon('sunset')}<b>${c.sunset || '–'}</b></div></div>`);
      const a = w.aqi;
      if (a) {
        const pm = [a.pm25 != null ? `PM2.5 ${r0(a.pm25)}` : '', a.pm10 != null ? `PM10 ${r0(a.pm10)}` : ''].filter(Boolean).join(' · ');
        parts.push(`<div class="wx-aqirow" style="--c:${a.color}"><span class="wx-aqibig">${a.value}</span><div><b>AQI · ${esc(a.cat)}</b><small>${a.scale === 'in' ? 'India AQI (CPCB)' : 'US AQI'}${a.dominant ? ` · mainly ${POLLUTANT_NAMES[a.dominant] || a.dominant}` : ''}</small>${pm ? `<small>Now: ${pm} µg/m³</small>` : ''}</div></div>`);
      } else parts.push(`<div class="wx-note">${icon('air')}${esc(w.aqiNote || 'Air quality is not available here right now')} — no haze shown.</div>`);
    } else {
      parts.push(`<div class="wx-head">${icon('cloud', 'big')}<div><b>Real weather</b><span>${w && w.status === 'loading' ? 'Getting the weather…' : 'Not set up yet'}</span></div><button class="wx-x" data-wx="close" title="Close">${icon('close')}</button></div>`);
    }
    // where it comes from
    if (w && w.leader) {
      const myName = S.g.farm.L ? S.g.farm.L.name : '', who = n => (n && n === myName ? 'you' : `<b>${esc(n || 'the leader')}</b>`);
      if (w.loc) {
        const from = w.loc.source === 'city' && w.loc.label ? `<b>${esc(w.loc.label)}</b> · picked by ${who(w.loc.by)}` : w.loc.by === myName ? 'your location' : `${who(w.loc.by)}’s location`;
        parts.push(`<div class="wx-where">${icon('pin')}<span>Weather from ${from}${w.at ? ` · updated ${timeIST(w.at)}` : ''}</span></div>`);
      }
      else parts.push(`<div class="wx-where">${icon('pin')}<span>${me ? 'You are the weather leader — share your location or pick a city to bring your real weather to the farm.' : `Waiting for <b>${esc(w.leader.name)}</b> (the weather leader) to share a location — the farm shows its usual sky.`}</span></div>`);
      if (w.loc && w.need && !me) parts.push(`<div class="wx-note">${icon('info')}<b>${esc(w.leader.name)}</b> leads the weather now; it stays as it is until they share their place.</div>`);
      if (me) parts.push(`<div class="wx-acts"><span class="wx-lead">${icon('pin')}You lead the weather</span><button class="fu-go" data-wx="gps">${icon('pin')}Use my location</button><button class="fu-go alt" data-wx="city">Choose a city</button></div>`);
    }
    if (w && w.status === 'error') parts.push(`<div class="wx-note warn">${icon('warn')}The weather service can't be reached${w.at ? ` — showing the weather from ${timeIST(w.at)}` : ''}. Trying again soon.</div>`);
    parts.push(`<div class="wx-src">Weather data by <b>Open-Meteo.com</b> (CC BY 4.0) · air quality: CAMS / Copernicus (model data). The farm's sun and clock still follow the time in India.</div>`);
    this.panel.innerHTML = parts.join('');
  }

  /* ---------- questions for the weather leader ---------- */
  showAsk(kind, opts = {}) {
    this.toggle(false);
    if (kind === 'choose') {
      this.ask.innerHTML = `<div class="wx-askh">${icon('cloudSun', 'big')}<b>Bring your real weather to the farm?</b></div>
        <p>You ${opts.first ? 'are the first one here' : 'lead the weather now'}, so everyone's farm will show the weather where you are — rain, clouds, wind and air quality. Your location is only used to look up the weather; other players never see it.</p>
        <div class="wx-acts"><button class="fu-go" data-wx="gps">${icon('pin')}Use my location</button><button class="fu-go alt" data-wx="city">Choose a city</button><button class="fu-go alt" data-wx="skip">Not now</button></div>`;
    } else {
      this.ask.innerHTML = `<div class="wx-askh">${icon('pin', 'big')}<b>Pick a city for the farm's weather</b></div>
        ${opts.why === 'denied' ? '<p>Location is turned off for this game in your browser, so pick the nearest town or city instead.</p>' : '<p>The farm will show the weather in this place.</p>'}
        <input id="wxQ" type="text" placeholder="Type a town or city…" autocomplete="off" maxlength="60">
        <div id="wxList" class="wx-list"></div>
        <div class="wx-acts"><button class="fu-go alt" data-wx="${opts.why === 'denied' ? 'skip' : 'cancel'}">${opts.why === 'denied' ? 'Not now' : 'Cancel'}</button></div>`;
      setTimeout(() => { const q = document.getElementById('wxQ'); if (q) q.focus(); }, 30);
    }
    this.ask.classList.remove('hidden');
  }
  closeAsk() { this.ask.classList.add('hidden'); this.ask.innerHTML = ''; }
  _search(text) {
    clearTimeout(this.qT);
    const list = document.getElementById('wxList');
    if (!list) return;
    if (text.trim().length < 2) { list.innerHTML = ''; return; }
    this.qT = setTimeout(async () => {
      list.innerHTML = '<div class="wx-dim">Searching…</div>';
      try {
        const ps = await this.g.sync.places(text.trim());
        this.found = ps;
        list.innerHTML = ps.length ? ps.map((p, i) => `<button class="wx-place" data-wx="pick" data-i="${i}">${icon('pin')}${esc(p.label)}</button>`).join('') : '<div class="wx-dim">No place with that name</div>';
      } catch (e) { list.innerHTML = `<div class="wx-dim">${esc(e.message || 'Could not search right now')}</div>`; }
    }, 350);
  }
  async _click(e) {
    const b = e.target.closest('[data-wx]');
    if (!b) return;
    const S = this.g.sync, k = b.dataset.wx;
    if (k === 'close') this.toggle(false);
    else if (k === 'gps') { this.closeAsk(); this.toggle(false); this.g.toast('📍 Looking up your location for the weather…'); if (await S.useLocation()) this.g.toast('🌦 The farm now shows the weather where you are'); }
    else if (k === 'city') this.showAsk('city', {});
    else if (k === 'skip') { this.closeAsk(); S.notNow(); this.g.toast('🌦 OK — the farm keeps its current weather. Set it any time from the weather chip at the top.'); }
    else if (k === 'cancel') this.closeAsk();
    else if (k === 'pick') {
      const p = (this.found || [])[+b.dataset.i];
      if (!p) return;
      this.closeAsk();
      if (await S.pickCity(p)) this.g.toast(`🌦 The farm now shows the weather in ${p.name}`);
    }
  }

  /* ---------- messages when something changes ---------- */
  notify(w, prev) {
    if (!w || !prev) return;
    const S = this.g.sync, T = this.g.toast;
    if (w.leader && (!prev.leader || prev.leader.id !== w.leader.id)) T(S.isLeader ? '🌦 You lead the weather now — the farm will follow your place' : `🌦 The farm's weather now follows ${w.leader.name}'s place`);
    if (w.cond && prev.cond && GROUP[w.cond.key] !== GROUP[prev.cond.key]) T(TURN[GROUP[w.cond.key]] || `🌦 The weather turned: ${CONDITIONS[w.cond.key].label}`);
    if (w.aqi && prev.aqi && w.aqi.level !== prev.aqi.level) T(`🌫 Air quality is now ${w.aqi.cat} (AQI ${w.aqi.value})`);
  }
}
