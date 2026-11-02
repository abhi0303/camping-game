// Worlds this device is logged in to (one login per world). Only the login token is kept here;
// the world itself always lives on the server.
const KEY = 'rv-farm-logins';

function read() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.code && x.token) : []; }
  catch (e) { return []; }
}
function write(a) { try { localStorage.setItem(KEY, JSON.stringify(a.slice(0, 8))); } catch (e) { /* private mode: login lasts this visit only */ } }

export const Logins = {
  all: read,
  get: code => read().find(x => x.code === code) || null,
  save(r) {   // r = server answer { token, room: { code, name }, member: { id, name, seat, isOwner } }
    const L = { code: r.room.code, roomName: r.room.name, token: r.token, memberId: r.member.id, name: r.member.name, seat: r.member.seat, isOwner: !!r.member.isOwner, at: Date.now() };
    write([L, ...read().filter(x => x.code !== L.code)]);
    return L;
  },
  touch(code, patch) { write(read().map(x => (x.code === code ? { ...x, ...patch, at: Date.now() } : x))); },
  forget(code) { write(read().filter(x => x.code !== code)); },
};
