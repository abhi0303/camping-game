// Real-world weather and air quality for each Farm World (the farm server is the only source of it).
//
// - The weather leader: the first member to join the live game. Its place sets the weather for the whole world.
//   The host's heartbeat (every 15 s, js/farm/farm.js) says who is in the game; each member's live presence
//   starts when they come in (live_since = their place in the join order) and is kept while they stay
//   (live_seen_at). A leader who drops out keeps the job for WEATHER.leaderGraceS (the game's reconnect
//   window); after that the member who joined earliest among those still playing takes over. All of it
//   happens with the world's row locked (the same lock the host election uses), so there is only ever one
//   leader.
// - The leader's game sends a location (the phone / browser location, or a city the leader picked). It is
//   kept rounded to about 1 km and never sent to anyone; the others only see the leader's name (and the
//   city's name if one was picked).
// - The weather service (Open-Meteo: weather + CAMS air quality) is asked at most once an hour per world
//   (WEATHER.ttlMin), when the host's heartbeat or a player's request finds the data old. A lock in the
//   world's row makes sure only one request asks at a time; the others get the saved data. Cloudflare's
//   cache shares the answer between worlds at the same place. When the service fails, the last good
//   weather stays and the next try waits longer each time (2, 4, 8 … 60 min).
// - Every change (new weather, new leader, new location) raises weather_rev; the host's heartbeat answer
//   carries the new weather and the host passes it to everyone in the game.
import { ApiError, badInput, json, rateLimit, readJson } from './http.js';
import { one, rows, tx } from './db.js';
import { member, HOST_STALE_S } from './rooms.js';
import { WEATHER, conditionOf, indiaAqi, aqiLevel, kmBetween } from '../../js/weather/rules.js';

const MIN_GAP_S = 60;             // never ask the weather service for one world more often than this
const FETCH_TIMEOUT_MS = 8000;
const EDGE_CACHE_S = 900;         // Cloudflare keeps an answer for a place this long (other worlds nearby share it)
const round = v => Math.round(v * 10 ** WEATHER.locDecimals) / 10 ** WEATHER.locDecimals;
const ttlMin = env => Number(env.WEATHER_TTL_MIN) || WEATHER.ttlMin;

/* ---------- who is in the game, and who leads the weather ---------- */
// ids just seen in the live game: a member back after more than the grace period starts a new place in the line
export async function markLive(c, ids) {
  if (!ids || !ids.length) return;
  await c.rows(`UPDATE room_members SET
      live_since = CASE WHEN live_since IS NULL OR live_seen_at IS NULL OR live_seen_at < now() - make_interval(secs => $2) THEN now() ELSE live_since END,
      live_seen_at = now() WHERE id = ANY($1::uuid[])`, [ids, WEATHER.leaderGraceS]);
}
// with the world's row locked: keep the leader while they're here (or within the grace period), otherwise the
// earliest to join among those playing now (same moment: the lower seat)
export async function electLeader(c, roomId, onlineIds) {
  const r = await c.one('SELECT weather_leader FROM rooms WHERE id = $1', [roomId]);
  const ms = await c.rows(`SELECT id, seat, live_since, (live_seen_at IS NOT NULL AND live_seen_at > now() - make_interval(secs => $2)) AS recent
      FROM room_members WHERE room_id = $1`, [roomId, WEATHER.leaderGraceS]);
  const online = new Set(onlineIds || []), here = m => online.has(m.id) || m.recent;
  const cur = ms.find(m => m.id === r.weather_leader);
  if (cur && here(cur)) return { id: cur.id, changed: false };
  let pool = ms.filter(m => online.has(m.id));
  if (!pool.length) pool = ms.filter(here);
  pool.sort((a, b) => (a.live_since ? +a.live_since : Infinity) - (b.live_since ? +b.live_since : Infinity) || a.seat - b.seat);
  const next = pool.length ? pool[0].id : null;
  if (next === (r.weather_leader || null)) return { id: next, changed: false };
  await c.rows('UPDATE rooms SET weather_leader = $2, weather_rev = weather_rev + 1 WHERE id = $1', [roomId, next]);
  return { id: next, changed: true };
}

/* ---------- what the players get (no coordinates) ---------- */
function needLocation(r) {
  const lead = r.weather_leader, loc = r.weather_loc;
  if (!lead) return false;
  if (loc && loc.skipBy === lead) return false;                       // the leader said "not now"
  if (!loc || loc.lat == null) return true;
  if (loc.by !== lead) return true;                                   // a new leader: their own place
  return loc.source === 'gps' && Date.now() - Date.parse(loc.at) > WEATHER.gpsMaxAgeH * 3600e3;
}
export async function publicWeather(db, roomId) {
  const r = await one(db, `SELECT weather, weather_rev, weather_leader, weather_loc, weather_at, weather_next, weather_status FROM rooms WHERE id = $1`, [roomId]);
  const ms = await rows(db, 'SELECT id, name FROM room_members WHERE room_id = $1', [roomId]);
  const name = id => (ms.find(m => m.id === id) || {}).name || '';
  const W = r.weather || {}, loc = r.weather_loc;
  return {
    rev: r.weather_rev, status: r.weather_status,
    leader: r.weather_leader ? { id: r.weather_leader, name: name(r.weather_leader) } : null,
    loc: loc && loc.lat != null ? { source: loc.source, label: loc.source === 'city' ? loc.label || null : null, by: name(loc.by) } : null,
    need: needLocation(r),
    at: r.weather_at, next: r.weather_next,
    cond: W.cond || null, cur: W.cur || null, aqi: W.aqi || null, aqiNote: W.aqiNote || null, src: W.src || null,
  };
}
export async function weatherIfNew(db, roomId, rev) {
  const r = await one(db, 'SELECT weather_rev FROM rooms WHERE id = $1', [roomId]);
  return r && r.weather_rev !== rev ? publicWeather(db, roomId) : null;
}

/* ---------- the weather service ---------- */
function endpoints(env) {
  const key = env.OPEN_METEO_KEY;      // a paid (commercial) plan: its own servers, with the key
  return {
    forecast: env.WEATHER_FORECAST_URL || (key ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast'),
    air: env.WEATHER_AIR_URL || (key ? 'https://customer-air-quality-api.open-meteo.com/v1/air-quality' : 'https://air-quality-api.open-meteo.com/v1/air-quality'),
    geo: env.WEATHER_GEO_URL || (key ? 'https://customer-geocoding-api.open-meteo.com/v1/search' : 'https://geocoding-api.open-meteo.com/v1/search'),
    key,
  };
}
async function getJson(env, url) {
  const f = env.__fetch || fetch, ctl = new AbortController(), t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await f(url, { signal: ctl.signal, cf: { cacheTtl: EDGE_CACHE_S, cacheEverything: true } });
    if (!res.ok) throw new Error('weather service: HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}
const q = (base, p, key) => base + '?' + new URLSearchParams({ ...p, ...(key ? { apikey: key } : {}) }).toString();
const hhmm = s => (typeof s === 'string' && /T(\d\d:\d\d)/.test(s) ? /T(\d\d:\d\d)/.exec(s)[1] : null);
const num = v => (v == null || !isFinite(+v) ? null : +v);

// weather + air quality for a place, in one object (air quality may be missing: then aqi is null)
export async function fetchWeather(env, lat, lon) {
  const E = endpoints(env), at = { latitude: lat.toFixed(2), longitude: lon.toFixed(2) };
  const [fc, aq] = await Promise.allSettled([
    getJson(env, q(E.forecast, { ...at, timezone: 'auto', forecast_days: 1, past_hours: 3, forecast_hours: 1, daily: 'sunrise,sunset', hourly: 'precipitation',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility' }, E.key)),
    getJson(env, q(E.air, { ...at, timezone: 'auto', past_hours: 24, forecast_hours: 1, current: 'us_aqi,pm2_5,pm10',
      hourly: 'pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide' }, E.key)),
  ]);
  if (fc.status !== 'fulfilled' || !fc.value || !fc.value.current) throw new Error('weather service: ' + (fc.reason && fc.reason.message || 'no data'));
  const F = fc.value, c = F.current, H = F.hourly || {}, D = F.daily || {};
  // rain in the last three hours (wet ground stays wet a while after the rain)
  const times = H.time || [], pr = H.precipitation || [], nowH = (c.time || '').slice(0, 13);
  let precip3h = 0;
  times.forEach((t, i) => { if (t.slice(0, 13) < nowH) precip3h += +pr[i] || 0; });
  const cur = {
    code: num(c.weather_code) ?? 0, temp: num(c.temperature_2m), feels: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m),
    cloud: num(c.cloud_cover), precip: num(c.precipitation), rain: num(c.rain), showers: num(c.showers), snow: num(c.snowfall),
    wind: num(c.wind_speed_10m), windDir: num(c.wind_direction_10m), gusts: num(c.wind_gusts_10m), vis: num(c.visibility),
    isDay: c.is_day === 1 || c.is_day === true, precip3h: Math.round(precip3h * 10) / 10,
    sunrise: hhmm((D.sunrise || [])[0]), sunset: hhmm((D.sunset || [])[0]), tz: F.timezone_abbreviation || F.timezone || null,
  };
  let aqi = null, aqiNote = null;
  if (aq.status === 'fulfilled' && aq.value) {
    const A = aq.value, ac = A.current || {}, ind = indiaAqi(A.hourly), us = num(ac.us_aqi);
    const scale = WEATHER.aqiScale === 'us' ? 'us' : 'in', value = scale === 'us' ? us : ind && ind.value;
    if (value != null) {
      const L = aqiLevel(value, scale);
      aqi = { scale, value: Math.round(value), level: L.level, cat: L.name, color: L.color, pm25: num(ac.pm2_5), pm10: num(ac.pm10),
        dominant: ind ? ind.dominant : null, us: us == null ? null : Math.round(us),
        avg: ind ? Object.fromEntries(Object.entries(ind.conc).filter(([, v]) => v != null).map(([k, v]) => [k, Math.round(v * 10) / 10])) : null };
    } else aqiNote = 'Not enough air-quality data for this place right now';
  } else aqiNote = 'Air quality is unavailable right now';
  return { cur, cond: conditionOf(cur), aqi, aqiNote, src: { weather: 'Open-Meteo', air: 'Open-Meteo · CAMS (Copernicus)' } };
}

// with a location and old (or no) data: one request asks the weather service, the others don't wait for it
export async function refreshDue(db, env, roomId) {
  const claim = await one(db, `UPDATE rooms SET weather_lock = now() + interval '30 seconds'
      WHERE id = $1 AND weather_loc->>'lat' IS NOT NULL
        AND (weather_lock IS NULL OR weather_lock < now())
        AND (weather_next IS NULL OR weather_next <= now())
        AND (weather_tried_at IS NULL OR weather_tried_at < now() - make_interval(secs => $2))
      RETURNING weather_loc, weather_fails`, [roomId, MIN_GAP_S]);
  if (!claim) return false;
  const loc = claim.weather_loc;
  try {
    const data = await fetchWeather(env, +loc.lat, +loc.lon);
    await one(db, `UPDATE rooms SET weather = $2, weather_at = now(), weather_tried_at = now(), weather_next = now() + make_interval(mins => $3),
        weather_lock = NULL, weather_fails = 0, weather_status = 'ok', weather_rev = weather_rev + 1 WHERE id = $1`, [roomId, JSON.stringify(data), ttlMin(env)]);
    return true;
  } catch (e) {
    const n = (claim.weather_fails || 0) + 1, wait = WEATHER.retryMin[Math.min(n - 1, WEATHER.retryMin.length - 1)];
    console.warn('weather fetch failed:', e && e.message);
    await one(db, `UPDATE rooms SET weather_tried_at = now(), weather_next = now() + make_interval(mins => $2), weather_lock = NULL, weather_fails = $3,
        weather_rev = weather_rev + CASE WHEN weather_status = 'error' THEN 0 ELSE 1 END,
        weather_status = CASE WHEN weather_at IS NULL AND weather_status = 'no_location' THEN 'no_location' ELSE 'error' END WHERE id = $1`, [roomId, wait, n]);
    return false;
  }
}

/* ---------- routes ---------- */
// the world's room locked: who leads now (the players in the live game, from the host's last heartbeat)
async function elect(db, me) {
  return tx(db, async c => {
    const r = await c.one(`SELECT online, (host_seen_at IS NOT NULL AND host_seen_at > now() - make_interval(secs => $2)) AS live, weather_loc, weather_at
        FROM rooms WHERE id = $1 FOR UPDATE`, [me.room_id, HOST_STALE_S]);
    const L = await electLeader(c, me.room_id, r.live ? r.online : [me.id]);
    return { r, L };
  });
}
// GET /v1/rooms/:code/weather — the world's weather (asks the weather service first when it's due)
export async function weatherGet(req, env, db, code) {
  const me = await member(db, req, code);
  await elect(db, me);
  await refreshDue(db, env, me.room_id).catch(() => false);
  return json({ weather: await publicWeather(db, me.room_id) });
}
// POST /v1/rooms/:code/weather — the leader's location: { op: 'gps', lat, lon } · a city: { op: 'place', lat, lon, label }
// · { op: 'skip' }: not now (the leader isn't asked again; the last weather stays)
export async function weatherPost(req, env, db, code) {
  const b = await readJson(req, 4096);
  const me = await member(db, req, code);
  rateLimit(req, 'weather', 12, 60000, env);
  const op = b.op;
  if (!['gps', 'place', 'skip'].includes(op)) throw badInput('Bad request');
  const lat = Number(b.lat), lon = Number(b.lon);
  if (op !== 'skip' && !(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw badInput('That location looks wrong.');
  await tx(db, async c => {
    const r = await c.one(`SELECT online, (host_seen_at IS NOT NULL AND host_seen_at > now() - make_interval(secs => $2)) AS live, weather_loc
        FROM rooms WHERE id = $1 FOR UPDATE`, [me.room_id, HOST_STALE_S]);
    const L = await electLeader(c, me.room_id, r.live ? r.online : [me.id]);
    if (L.id !== me.id) throw new ApiError(409, 'not_leader', 'Only the weather leader picks where the weather comes from.');
    const old = r.weather_loc;
    if (op === 'skip') {
      await c.rows(`UPDATE rooms SET weather_loc = COALESCE(weather_loc, '{}'::jsonb) || jsonb_build_object('skipBy', $2::text), weather_rev = weather_rev + 1 WHERE id = $1`, [me.room_id, me.id]);
      return;
    }
    const label = op === 'place' ? String(b.label || '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : null;
    const loc = { lat: round(lat), lon: round(lon), source: op === 'place' ? 'city' : 'gps', label, by: me.id, at: new Date().toISOString() };
    const moved = !old || old.lat == null || kmBetween(old, loc) >= WEATHER.moveKm;
    await c.rows(`UPDATE rooms SET weather_loc = $2, weather_rev = weather_rev + 1,
        weather_next = CASE WHEN $3 THEN now() ELSE weather_next END, weather_fails = CASE WHEN $3 THEN 0 ELSE weather_fails END,
        weather_status = CASE WHEN weather_status = 'no_location' THEN 'loading' ELSE weather_status END WHERE id = $1`, [me.room_id, JSON.stringify(loc), moved]);
  });
  await refreshDue(db, env, me.room_id).catch(() => false);
  return json({ weather: await publicWeather(db, me.room_id) });
}
// GET /v1/rooms/:code/weather/places?q=Pune — towns and cities with that name (for picking one by hand)
export async function weatherPlaces(req, env, db, code) {
  await member(db, req, code);
  rateLimit(req, 'places', 30, 60000, env);
  const name = (new URL(req.url).searchParams.get('q') || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  if (name.length < 2) return json({ places: [] });
  const E = endpoints(env);
  let d;
  try { d = await getJson(env, q(E.geo, { name, count: 8, language: 'en', format: 'json' }, E.key)); }
  catch (e) { throw new ApiError(503, 'weather_unavailable', 'Could not search for places right now. Try again in a moment.'); }
  const places = (d && d.results || []).filter(p => isFinite(p.latitude) && isFinite(p.longitude)).map(p => ({
    name: p.name, label: [p.name, p.admin1, p.country_code].filter(Boolean).join(', '), lat: round(p.latitude), lon: round(p.longitude) }));
  return json({ places });
}
