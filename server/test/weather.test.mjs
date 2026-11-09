// Real-world weather (server/src/weather.js) against a real Postgres, with a pretend weather service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import worker from '../src/index.js';
import { migrate } from '../src/migrations.js';
import { THIEVES } from '../src/thieves.js';
import { indiaAqi, subIndex, conditionOf } from '../../js/weather/rules.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
const DB = 'rvwxtest_' + Math.random().toString(36).slice(2, 8);
let pool, env;

// the pretend weather service: what it answers, and every call it got
const svc = { calls: [], down: false, airDown: false, code: 0, rain: 0, cloud: 5, pm25: 70, delay: 0 };
const hourly = (v, n = 25) => Array.from({ length: n }, () => v);
async function fakeFetch(url) {
  const u = new URL(url);
  svc.calls.push(u.host + u.pathname + '?' + u.searchParams.get('latitude') + ',' + u.searchParams.get('longitude'));
  if (svc.delay) await new Promise(r => setTimeout(r, svc.delay));
  const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname.endsWith('/search')) return ok({ results: [{ name: 'Pune', admin1: 'Maharashtra', country_code: 'IN', latitude: 18.51957, longitude: 73.85535 }] });
  if (u.host.startsWith('air')) {
    if (svc.airDown) return new Response('down', { status: 503 });
    return ok({ current: { us_aqi: 160, pm2_5: svc.pm25, pm10: 120 }, hourly: { pm2_5: hourly(svc.pm25), pm10: hourly(120), nitrogen_dioxide: hourly(30), sulphur_dioxide: hourly(10), ozone: hourly(60), carbon_monoxide: hourly(800) } });
  }
  if (svc.down) return new Response('down', { status: 502 });
  return ok({ timezone: 'Asia/Kolkata', timezone_abbreviation: 'IST',
    current: { time: '2026-11-09T14:00', weather_code: svc.code, temperature_2m: 24.4, apparent_temperature: 25.1, relative_humidity_2m: 70, is_day: 1, precipitation: svc.rain, rain: svc.rain, showers: 0, snowfall: 0,
      cloud_cover: svc.cloud, wind_speed_10m: 12, wind_direction_10m: 240, wind_gusts_10m: 20, visibility: 24000 },
    hourly: { time: ['2026-11-09T11:00', '2026-11-09T12:00', '2026-11-09T13:00', '2026-11-09T14:00'], precipitation: [0, svc.rain, svc.rain, svc.rain] },
    daily: { sunrise: ['2026-11-09T06:31'], sunset: ['2026-11-09T17:52'] } });
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const u = new URL(ADMIN_URL); u.pathname = '/' + DB;
  pool = new pg.Pool({ connectionString: u.toString(), max: 16 });
  await migrate(pool);
  THIEVES.on = false;
  env = { __pool: pool, __fetch: fakeFetch, SERVER_SECRET: 'test-secret-0123456789', ADMIN_SECRET: 'admin-xyz', RATE_SCALE: 50 };
});
after(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.end();
});

let n = 0;
async function call(method, path, body, token) {
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.0.' + (n++ % 250) };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('http://api.test' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
async function world(name = 'Abhi') {
  const r = await call('POST', '/v1/rooms', { name, pin: '1234', world: 'Weather Farm' });
  const w = { code: r.body.room.code, token: r.body.token, id: r.body.member.id, name };
  w.room = (await q('SELECT id FROM rooms WHERE code = $1', [w.code]))[0].id;
  return w;
}
async function addMember(w, name) {
  const inv = await call('POST', `/v1/rooms/${w.code}/invites`, {}, w.token);
  const j = await call('POST', `/v1/rooms/${w.code}/join`, { invite: inv.body.invite, name, pin: '5555' });
  assert.equal(j.status, 201, JSON.stringify(j.body));
  return { code: w.code, token: j.body.token, id: j.body.member.id, name };
}
const session = p => call('POST', `/v1/rooms/${p.code}/session`, {}, p.token);
const beat = (host, epoch, online, wxRev) => call('POST', `/v1/rooms/${host.code}/heartbeat`, { epoch, online: online.map(p => p.id), wxRev }, host.token);
const wx = p => call('GET', `/v1/rooms/${p.code}/weather`, undefined, p.token);
const setLoc = (p, body) => call('POST', `/v1/rooms/${p.code}/weather`, body, p.token);
const due = w => q(`UPDATE rooms SET weather_next = now() - interval '1 second', weather_tried_at = now() - interval '1 hour' WHERE id = $1`, [w.room]);
// a member left this long ago (seconds)
const away = (p, s) => q(`UPDATE room_members SET live_seen_at = now() - make_interval(secs => $2) WHERE id = $1`, [p.id, s]);
const reset = () => Object.assign(svc, { calls: [], down: false, airDown: false, code: 0, rain: 0, cloud: 5, pm25: 70, delay: 0 });

test('India AQI (CPCB) from concentrations; weather codes to conditions', () => {
  assert.equal(subIndex('pm25', 30), 50); assert.equal(subIndex('pm25', 60), 100); assert.equal(subIndex('pm25', 75), 150); assert.equal(subIndex('pm25', 250), 400);
  assert.equal(subIndex('pm10', 300), 250); assert.equal(subIndex('co', 1.5), 75); assert.equal(subIndex('pm25', 5000), 500);
  const a = indiaAqi({ pm2_5: hourly(70), pm10: hourly(120), nitrogen_dioxide: hourly(30), sulphur_dioxide: hourly(10), ozone: hourly(60), carbon_monoxide: hourly(800) });
  assert.equal(a.dominant, 'pm25'); assert.equal(a.value, 133);              // PM2.5 70 µg/m³ -> 100 + 100 × 10/30
  assert.equal(indiaAqi({ pm2_5: hourly(70), ozone: hourly(60) }), null);     // fewer than 3 pollutants: no AQI (not invented)
  assert.equal(indiaAqi({ nitrogen_dioxide: hourly(30), ozone: hourly(60), carbon_monoxide: hourly(800) }), null);   // no PM2.5 / PM10
  assert.equal(conditionOf({ code: 0, cloud: 5 }).key, 'clear'); assert.equal(conditionOf({ code: 2 }).key, 'partly'); assert.equal(conditionOf({ code: 3 }).key, 'cloudy');
  assert.equal(conditionOf({ code: 45 }).key, 'fog'); assert.equal(conditionOf({ code: 53 }).key, 'drizzle'); assert.equal(conditionOf({ code: 63, rain: 3 }).key, 'rain');
  assert.equal(conditionOf({ code: 63, rain: 9 }).key, 'heavy'); assert.equal(conditionOf({ code: 95 }).key, 'storm'); assert.equal(conditionOf({ code: 73 }).key, 'snow');
  assert.equal(conditionOf({ code: 1, wind: 40 }).label, 'Clear, windy');
});

test('the first player leads the weather; a location brings real weather + India AQI to everyone, without coordinates', async () => {
  reset();
  const A = await world('Asha');
  const s = await session(A); assert.equal(s.body.role, 'host');
  let r = await beat(A, s.body.epoch, [A], -1);
  assert.equal(r.body.weather.leader.id, A.id); assert.equal(r.body.weather.need, true); assert.equal(r.body.weather.status, 'no_location');
  assert.equal(svc.calls.length, 0);                                        // no location yet: nobody asks the weather service
  r = await setLoc(A, { op: 'gps', lat: 18.519573, lon: 73.855351 });
  assert.equal(r.status, 200, r.text);
  const W = r.body.weather;
  assert.equal(svc.calls.length, 2);                                        // forecast + air quality, once
  assert.ok(svc.calls[0].endsWith('?18.52,73.86'));                         // the service only gets the rounded place
  assert.equal(W.status, 'ok'); assert.equal(W.cond.key, 'clear'); assert.equal(W.cur.temp, 24.4); assert.equal(W.cur.sunrise, '06:31');
  assert.equal(W.aqi.scale, 'in'); assert.equal(W.aqi.value, 133); assert.equal(W.aqi.cat, 'Moderate'); assert.equal(W.aqi.us, 160); assert.equal(W.need, false);
  assert.equal(W.loc.by, 'Asha'); assert.equal(W.loc.label, null);
  assert.ok(!/18\.5|73\.8/.test(r.text), 'no coordinates in what players get');
  const row = (await q('SELECT weather_loc FROM rooms WHERE id = $1', [A.room]))[0].weather_loc;
  assert.equal(row.lat, 18.52); assert.equal(row.lon, 73.86);               // kept rounded (~1 km)
  // the host's next heartbeat: unchanged weather is not sent again; an old rev gets it
  assert.equal((await beat(A, s.body.epoch, [A], W.rev)).body.weather, undefined);
  assert.equal((await beat(A, s.body.epoch, [A], W.rev - 1)).body.weather.rev, W.rev);
  assert.equal(svc.calls.length, 2);                                        // still fresh: no new calls
});

test('four players see the same weather; the leader hands over in join order after the reconnect grace', async () => {
  reset();
  const A = await world('Asha'), B = await addMember(A, 'Bina'), C = await addMember(A, 'Chetan'), D = await addMember(A, 'Dev');
  const s = await session(A);
  await beat(A, s.body.epoch, [A]);
  await new Promise(r => setTimeout(r, 15)); await session(B); await beat(A, s.body.epoch, [A, B]);
  await new Promise(r => setTimeout(r, 15)); await session(C); await new Promise(r => setTimeout(r, 15)); await session(D);
  await beat(A, s.body.epoch, [A, B, C, D]);
  await setLoc(A, { op: 'gps', lat: 18.52, lon: 73.86 });
  // not the leader: can't set the place
  assert.equal((await setLoc(B, { op: 'gps', lat: 28.6, lon: 77.2 })).body.error.code, 'not_leader');
  const all = await Promise.all([A, B, C, D].map(wx));
  for (const x of all) { assert.equal(x.body.weather.leader.name, 'Asha'); assert.equal(x.body.weather.rev, all[0].body.weather.rev); assert.equal(x.body.weather.cond.key, 'clear'); }
  assert.equal(svc.calls.length, 2);                                        // four players, one call each kind
  const release = (p, epoch) => call('POST', `/v1/rooms/${p.code}/heartbeat`, { epoch, online: [], release: true }, p.token);
  // A's tab closes (A was hosting): B takes over hosting. A could be reloading: still the leader during the grace period
  await release(A, s.body.epoch);
  const hb = await session(B); assert.equal(hb.body.role, 'host');
  let r = await beat(B, hb.body.epoch, [B, C, D], -1);
  assert.equal(r.body.weather.leader.name, 'Asha');
  // after the grace period (120 s): the next to join (B) leads and is asked for its place; the weather stays meanwhile
  await away(A, 200);
  r = await beat(B, hb.body.epoch, [B, C, D], -1);
  assert.equal(r.body.weather.leader.name, 'Bina'); assert.equal(r.body.weather.need, true); assert.equal(r.body.weather.cond.key, 'clear');
  assert.equal((await wx(D)).body.weather.leader.name, 'Bina');
  assert.equal(svc.calls.length, 2);                                        // a new leader doesn't throw the weather away
  // B shares a place 1 km away: no new call
  r = await setLoc(B, { op: 'gps', lat: 18.53, lon: 73.86 });
  assert.equal(r.body.weather.need, false); assert.equal(svc.calls.length, 2);
  // B leaves too: C hosts, and after the grace period C leads (C joined before D)
  await release(B, hb.body.epoch); await away(B, 200);
  const hc = await session(C); assert.equal(hc.body.role, 'host');
  r = await beat(C, hc.body.epoch, [C, D], -1);
  assert.equal(r.body.weather.leader.name, 'Chetan');
  // C picks a city instead of sharing a location: the city's name is shown, the weather comes from there
  r = await setLoc(C, { op: 'place', lat: 28.61, lon: 77.21, label: 'New Delhi, Delhi, IN' });
  assert.equal(r.body.weather.loc.label, 'New Delhi, Delhi, IN'); assert.equal(r.body.weather.loc.source, 'city');
  // a place more than 10 km away: asked again (at most once a minute per world; the host's next heartbeat does it)
  await q(`UPDATE rooms SET weather_tried_at = now() - interval '61 seconds' WHERE id = $1`, [A.room]);
  r = await beat(C, hc.body.epoch, [C, D], -1);
  assert.equal(svc.calls.length, 4); assert.ok(svc.calls[3].endsWith('?28.61,77.21'));
});

test('the leader coming back within the grace period keeps the job and their place in line', async () => {
  reset();
  const A = await world('Asha'), B = await addMember(A, 'Bina');
  const s = await session(A); await beat(A, s.body.epoch, [A]);
  await new Promise(r => setTimeout(r, 15)); await session(B); await beat(A, s.body.epoch, [A, B]);
  const before = (await q('SELECT live_since FROM room_members WHERE id = $1', [A.id]))[0].live_since;
  await away(A, 60);                                                        // a minute away (< 120 s)
  await session(A);                                                         // back
  await beat(A, (await q('SELECT host_epoch FROM rooms WHERE id = $1', [A.room]))[0].host_epoch, [A, B]);
  const after = (await q('SELECT live_since FROM room_members WHERE id = $1', [A.id]))[0].live_since;
  assert.equal(+after, +before);
  assert.equal((await wx(B)).body.weather.leader.name, 'Asha');
});

test('no location (denied / not now), the weather service down, air quality missing, sunny to rainy, many players at once', async () => {
  reset();
  const A = await world('Asha'), B = await addMember(A, 'Bina');
  const s = await session(A); await beat(A, s.body.epoch, [A]);
  await new Promise(r => setTimeout(r, 15)); await session(B); await beat(A, s.body.epoch, [A, B]);
  // "not now": the leader isn't asked again; no weather yet (the game keeps its own sky)
  let r = await setLoc(A, { op: 'skip' });
  assert.equal(r.body.weather.need, false); assert.equal(r.body.weather.status, 'no_location'); assert.equal(r.body.weather.cond, null);
  // the service down on the first try: no weather, retry in 2 minutes
  svc.down = true;
  r = await setLoc(A, { op: 'gps', lat: 22.72, lon: 75.86 });
  assert.equal(r.body.weather.status, 'error'); assert.equal(r.body.weather.cond, null);
  let row = (await q(`SELECT weather_fails, round(extract(epoch FROM weather_next - now())) AS wait FROM rooms WHERE id = $1`, [A.room]))[0];
  assert.equal(row.weather_fails, 1); assert.ok(+row.wait > 100 && +row.wait <= 120);
  // back, but air quality missing: weather shown, no AQI (and no haze)
  svc.down = false; svc.airDown = true; await due(A);
  r = await wx(B);
  assert.equal(r.body.weather.status, 'ok'); assert.equal(r.body.weather.cond.key, 'clear'); assert.equal(r.body.weather.aqi, null); assert.ok(r.body.weather.aqiNote);
  // an hour later it rains; the service fails the next time: the rain stays (not switched to sunny), backoff grows
  svc.airDown = false; svc.code = 63; svc.rain = 3.2; svc.cloud = 100; await due(A);
  const rev0 = r.body.weather.rev;
  r = await beat(A, s.body.epoch, [A, B], rev0);
  assert.equal(r.body.weather.cond.key, 'rain'); assert.equal(r.body.weather.cur.precip3h, 6.4); assert.equal(r.body.weather.aqi.value, 133);
  svc.down = true; await due(A);
  r = await wx(B);
  assert.equal(r.body.weather.status, 'error'); assert.equal(r.body.weather.cond.key, 'rain');
  await due(A); await wx(B);
  row = (await q(`SELECT weather_fails, round(extract(epoch FROM weather_next - now())) AS wait FROM rooms WHERE id = $1`, [A.room]))[0];
  assert.equal(row.weather_fails, 2); assert.ok(+row.wait > 200 && +row.wait <= 240);   // 2 min, then 4 min…
  // ten requests at the same moment when it's due: the service is asked once
  svc.down = false; svc.delay = 120; svc.calls = []; await due(A);
  const many = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? wx(A) : wx(B))));
  assert.equal(svc.calls.length, 2);
  assert.ok(many.every(x => x.status === 200));
  r = await wx(A); assert.equal(r.body.weather.status, 'ok');
});

test('places: search by name (for choosing a city by hand)', async () => {
  reset();
  const A = await world('Asha');
  const r = await call('GET', `/v1/rooms/${A.code}/weather/places?q=Pune`, undefined, A.token);
  assert.equal(r.status, 200); assert.deepEqual(r.body.places[0], { name: 'Pune', label: 'Pune, Maharashtra, IN', lat: 18.52, lon: 73.86 });
  assert.equal((await call('GET', `/v1/rooms/${A.code}/weather/places?q=P`, undefined, A.token)).body.places.length, 0);
  assert.equal((await call('GET', `/v1/rooms/${A.code}/weather/places?q=Pune`)).status, 401);
});
