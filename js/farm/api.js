// Calls to the Farm World server. Errors come back as ApiError with a code and a message for the player.
import { API_BASE } from './config.js';

export class ApiError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}
// errors that mean "this login / world is gone": go back to the menu instead of retrying
export const LOGIN_GONE = new Set(['login_needed', 'not_member', 'room_not_found']);
export const apiReady = () => !!API_BASE;

async function req(method, path, { body, token, timeout = 15000 } = {}) {
  if (!API_BASE) throw new ApiError('not_set', 'Farm World is not switched on yet (the server address is missing).');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: 'no-store' });
  } catch (e) {
    throw new ApiError('network', 'Could not reach the Farm World server. Check your internet and try again.');
  } finally { clearTimeout(t); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const er = (data && data.error) || {};
    throw new ApiError(er.code || 'server_error', er.message || 'The Farm World server had a problem. Try again in a moment.', res.status);
  }
  return data;
}

const enc = encodeURIComponent;
export const api = {
  create: (name, pin, world) => req('POST', '/v1/rooms', { body: { name, pin, world } }),
  login: (code, name, pin) => req('POST', `/v1/rooms/${enc(code)}/login`, { body: { name, pin } }),
  invitePreview: (code, invite) => req('GET', `/v1/rooms/${enc(code)}/invites/${enc(invite)}`),
  join: (code, invite, name, pin) => req('POST', `/v1/rooms/${enc(code)}/join`, { body: { invite, name, pin } }),
  info: L => req('GET', `/v1/rooms/${enc(L.code)}`, { token: L.token }),
  session: (L, extra = {}) => req('POST', `/v1/rooms/${enc(L.code)}/session`, { token: L.token, body: extra }),
  heartbeat: (L, body) => req('POST', `/v1/rooms/${enc(L.code)}/heartbeat`, { token: L.token, body, timeout: 20000 }),
  verify: (L, ticket) => req('POST', `/v1/rooms/${enc(L.code)}/verify`, { token: L.token, body: { ticket } }),
  invite: L => req('POST', `/v1/rooms/${enc(L.code)}/invites`, { token: L.token, body: {} }),
  removeMember: (L, id) => req('DELETE', `/v1/rooms/${enc(L.code)}/members/${enc(id)}`, { token: L.token }),
  setPermissions: (L, id, canInvite) => req('POST', `/v1/rooms/${enc(L.code)}/members/${enc(id)}/permissions`, { token: L.token, body: { canInvite } }),
  makeOwner: (L, id) => req('POST', `/v1/rooms/${enc(L.code)}/members/${enc(id)}/owner`, { token: L.token, body: { confirm: true } }),
  logout: L => req('POST', `/v1/rooms/${enc(L.code)}/logout`, { token: L.token, body: {} }),
  deleteWorld: (L, confirm) => req('DELETE', `/v1/rooms/${enc(L.code)}`, { token: L.token, body: { confirm } }),
  // farm economy: state (counts production up to now), one action, recent history
  farm: L => req('GET', `/v1/rooms/${enc(L.code)}/farm`, { token: L.token }),
  farmAct: (L, body) => req('POST', `/v1/rooms/${enc(L.code)}/farm`, { token: L.token, body }),
  farmHistory: L => req('GET', `/v1/rooms/${enc(L.code)}/farm/history`, { token: L.token }),
  // last save while the page closes: a beacon can't carry headers, so the token goes in the body
  beacon(L, body) {
    if (!API_BASE || !navigator.sendBeacon) return false;
    try { return navigator.sendBeacon(`${API_BASE}/v1/rooms/${enc(L.code)}/heartbeat`, new Blob([JSON.stringify({ ...body, token: L.token })], { type: 'text/plain' })); }
    catch (e) { return false; }
  },
};
