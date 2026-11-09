// Real-world weather and air quality for Farm World: the rules shared by the game and the farm server
// (server/src/weather.js imports this file). No Three.js here.
//   - WEATHER: how often the server asks the weather service, how long a weather leader may be away, ...
//   - conditionOf(): the weather service's numbers (WMO weather code, rain, cloud, wind, visibility) -> one
//     condition (clear, partly, cloudy, fog, drizzle, rain, heavy, storm, snow) with a label and an icon
//   - FX / fxOf(): what each condition looks like in the game (clouds, darkness, rain, fog, lightning, wind)
//   - indiaAqi(): India's National AQI (CPCB) from pollutant concentrations: each pollutant's sub-index from
//     its 24-hour average (PM2.5, PM10, NO2, SO2) or its highest 8-hour average (O3, CO); the AQI is the
//     highest sub-index; valid only with at least 3 pollutants including PM2.5 or PM10
//   - AQI_HAZE: how hazy the air looks for each AQI category (pollution haze, kept apart from weather fog)

export const WEATHER = {
  ttlMin: 60,                       // the server asks the weather service again after this long (per world)
  retryMin: [2, 4, 8, 16, 32, 60],  // after failed tries: wait this long before the next one (then 60 min)
  leaderGraceS: 120,                // a weather leader who dropped out keeps the job this long (the game's reconnect window)
  locDecimals: 2,                   // locations are kept rounded (2 decimals ≈ 1 km), never sent to other players
  moveKm: 10,                       // a new location this far from the old one fetches the weather again right away
  gpsMaxAgeH: 12,                   // a phone location older than this: the leader's game sends a fresh one
  aqiScale: 'in',                   // 'in': India's National AQI (CPCB) · 'us': the US EPA AQI (both from the same data)
  clientCheckMin: 10,               // the game checks for a missed update this often (updates normally arrive by themselves)
};

/* ---------- conditions ---------- */
export const CONDITIONS = {
  clear: { label: 'Clear', day: 'sun', night: 'moon' },
  partly: { label: 'Partly cloudy', day: 'cloudSun', night: 'cloudMoon' },
  cloudy: { label: 'Overcast', day: 'cloud', night: 'cloud' },
  fog: { label: 'Foggy', day: 'fog', night: 'fog' },
  drizzle: { label: 'Drizzle', day: 'rain', night: 'rain' },
  rain: { label: 'Rain', day: 'rain', night: 'rain' },
  heavy: { label: 'Heavy rain', day: 'rain', night: 'rain' },
  storm: { label: 'Thunderstorm', day: 'storm', night: 'storm' },
  snow: { label: 'Snow', day: 'cloud', night: 'cloud' },        // (no snowfall in the game for now: shown as overcast)
};
const WINDY_KMH = 30, GUSTY_KMH = 45;

// cur: { code, rain (mm in the last hour), cloud (%), wind (km/h), gusts (km/h), vis (m), isDay }
export function conditionOf(cur) {
  const c = +cur.code, mm = +(cur.rain || 0);
  let key;
  if (c === 95 || c === 96 || c === 99) key = 'storm';
  else if (c >= 71 && c <= 77 || c === 85 || c === 86) key = 'snow';
  else if (c === 65 || c === 82 || ((c >= 61 && c <= 67) || c === 80 || c === 81) && mm >= 7.6) key = 'heavy';
  else if (c >= 61 && c <= 67 || c === 80 || c === 81) key = 'rain';
  else if (c >= 51 && c <= 57) key = 'drizzle';
  else if (c === 45 || c === 48) key = 'fog';
  else if (c === 3) key = 'cloudy';
  else if (c === 2) key = 'partly';
  else key = 'clear';
  if (key === 'clear' && cur.cloud >= 40) key = cur.cloud >= 85 ? 'cloudy' : 'partly';
  const windy = (+cur.wind || 0) >= WINDY_KMH || (+cur.gusts || 0) >= GUSTY_KMH;
  const C = CONDITIONS[key];
  return { key, label: windy && (key === 'clear' || key === 'partly' || key === 'cloudy') ? `${C.label}, windy` : C.label, icon: cur.isDay === false ? C.night : C.day, windy };
}

/* ---------- what each condition looks like ---------- */
// clouds: how much of the sky has clouds (0..1, the real cloud cover is used when it's known) · dark: extra gloom
// (sun, sky and ambient light) · rain: how hard it rains (scaled by the real mm per hour) · fog: weather fog
// (not pollution) · lightning: flashes and thunder
export const FX = {
  clear: { clouds: 0.12, dark: 0, rain: 0, fog: 0, lightning: 0 },
  partly: { clouds: 0.45, dark: 0, rain: 0, fog: 0, lightning: 0 },
  cloudy: { clouds: 0.92, dark: 0.28, rain: 0, fog: 0.05, lightning: 0 },
  fog: { clouds: 0.65, dark: 0.18, rain: 0, fog: 0.85, lightning: 0 },
  drizzle: { clouds: 0.88, dark: 0.32, rain: 0.25, fog: 0.15, lightning: 0 },
  rain: { clouds: 0.95, dark: 0.42, rain: 0.6, fog: 0.2, lightning: 0 },
  heavy: { clouds: 1, dark: 0.55, rain: 1, fog: 0.32, lightning: 0 },
  storm: { clouds: 1, dark: 0.62, rain: 1, fog: 0.3, lightning: 1 },
  snow: { clouds: 0.95, dark: 0.35, rain: 0, fog: 0.3, lightning: 0 },
};
// pollution haze for each AQI level (0 Good … 5 Severe): how thick it is (0..1). Haze and weather fog are
// combined in the game so that the stronger one decides and the weaker only adds a little
export const AQI_HAZE = [0, 0.1, 0.28, 0.48, 0.66, 0.82];

const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
// the look the game aims for, from the shared weather (w.cur, w.cond, w.aqi): every value 0..1 (wind in m/s)
export function fxOf(w) {
  if (!w || !w.cur || !w.cond) return null;
  const F = FX[w.cond.key] || FX.clear, cur = w.cur;
  const cover = cur.cloud == null ? F.clouds : Math.max(F.clouds * 0.7, c01(cur.cloud / 100));
  const mmh = +(cur.rain || 0) + +(cur.showers || 0);
  const rain = F.rain ? c01(Math.max(F.rain * 0.55, F.rain * 0.4 + mmh / 10)) : 0;
  // weather fog: the condition's own, or less than 10 km visibility
  const vis = cur.vis == null ? 24000 : +cur.vis;
  const fog = Math.max(F.fog, c01((10000 - vis) / 9000) * 0.8);
  const a = w.aqi && w.aqi.value != null ? w.aqi : null;
  return {
    clouds: cover, dark: F.dark, rain, fog, lightning: F.lightning,
    wind: Math.max(0, +(cur.wind || 0)) / 3.6, gusts: Math.max(0, +(cur.gusts || cur.wind || 0)) / 3.6, windDir: +(cur.windDir || 0),
    haze: a ? hazeOf(a) : 0,
    wet: c01(Math.max(rain > 0 ? 0.55 + rain * 0.45 : 0, (+cur.precip3h || 0) / 2)),
  };
}
// haze from an AQI: the level's haze, eased toward the next level inside the category (no jumps at 100, 200…)
export function hazeOf(a) {
  const L = AQI_LEVELS[a.scale === 'us' ? 'us' : 'in'], v = +a.value;
  let i = 0;
  while (i < L.length - 1 && v > L[i].max) i++;
  const lo = i ? L[i - 1].max : 0, hi = L[i].max, t = c01((v - lo) / Math.max(1, hi - lo));
  const h0 = AQI_HAZE[Math.min(i, AQI_HAZE.length - 1)], h1 = AQI_HAZE[Math.min(i + 1, AQI_HAZE.length - 1)];
  return h0 + (h1 - h0) * t * 0.6;
}

/* ---------- air quality ---------- */
export const AQI_LEVELS = {
  in: [{ max: 50, name: 'Good' }, { max: 100, name: 'Satisfactory' }, { max: 200, name: 'Moderate' }, { max: 300, name: 'Poor' }, { max: 400, name: 'Very Poor' }, { max: 1e9, name: 'Severe' }],
  us: [{ max: 50, name: 'Good' }, { max: 100, name: 'Moderate' }, { max: 150, name: 'Unhealthy for sensitive groups' }, { max: 200, name: 'Unhealthy' }, { max: 300, name: 'Very unhealthy' }, { max: 1e9, name: 'Hazardous' }],
};
export const AQI_COLORS = ['#3fbf5a', '#9acd32', '#f2c14e', '#ff8a3d', '#e0362a', '#8e1f3a'];
export function aqiLevel(value, scale = 'in') {
  const L = AQI_LEVELS[scale === 'us' ? 'us' : 'in'];
  let i = 0;
  while (i < L.length - 1 && value > L[i].max) i++;
  return { level: i, name: L[i].name, color: AQI_COLORS[i] };
}

// CPCB breakpoints (µg/m³; CO in mg/m³): the concentration where each AQI band (0, 50, 100, 200, 300, 400, 500) ends.
// The Severe band (400–500) is as wide as the Very Poor one, as in CPCB's own calculator; above it the AQI stays 500.
const CPCB = {
  pm25: [0, 30, 60, 90, 120, 250, 380],
  pm10: [0, 50, 100, 250, 350, 430, 510],
  no2: [0, 40, 80, 180, 280, 400, 520],
  so2: [0, 40, 80, 380, 800, 1600, 2400],
  o3: [0, 50, 100, 168, 208, 748, 1288],
  co: [0, 1, 2, 10, 17, 34, 51],
};
const BANDS = [0, 50, 100, 200, 300, 400, 500];
export function subIndex(kind, c) {
  const B = CPCB[kind];
  if (!B || c == null || !isFinite(c) || c < 0) return null;
  for (let i = 1; i < B.length; i++) if (c <= B[i]) return Math.round(BANDS[i - 1] + (BANDS[i] - BANDS[i - 1]) * (c - B[i - 1]) / (B[i] - B[i - 1]));
  return 500;
}
const mean = a => { const v = a.filter(x => x != null && isFinite(x)); return v.length >= Math.ceil(a.length * 0.66) ? v.reduce((s, x) => s + x, 0) / v.length : null; };
// the highest 8-hour average in a day of hourly values
const max8 = a => { let best = null; for (let i = 0; i + 8 <= a.length; i++) { const m = mean(a.slice(i, i + 8)); if (m != null && (best == null || m > best)) best = m; } return best; };
// h: the last 24 hours (or fewer) of hourly concentrations { pm2_5: [...], pm10, nitrogen_dioxide, sulphur_dioxide, ozone, carbon_monoxide } (µg/m³)
export function indiaAqi(h) {
  if (!h) return null;
  const last = k => (Array.isArray(h[k]) ? h[k].slice(-24) : []);
  const conc = {
    pm25: mean(last('pm2_5')), pm10: mean(last('pm10')), no2: mean(last('nitrogen_dioxide')), so2: mean(last('sulphur_dioxide')),
    o3: max8(last('ozone')), co: (v => (v == null ? null : v / 1000))(max8(last('carbon_monoxide'))),     // CO: µg/m³ -> mg/m³
  };
  const subs = {};
  for (const k in conc) { const s = subIndex(k, conc[k]); if (s != null) subs[k] = s; }
  const keys = Object.keys(subs);
  if (keys.length < 3 || (subs.pm25 == null && subs.pm10 == null)) return null;
  const dominant = keys.reduce((a, b) => (subs[b] > subs[a] ? b : a));
  return { value: subs[dominant], dominant, subs, conc };
}
export const POLLUTANT_NAMES = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', so2: 'SO₂', o3: 'O₃', co: 'CO' };

// distance between two places (km)
export function kmBetween(a, b) {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
