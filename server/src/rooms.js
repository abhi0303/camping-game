// Farm World rooms: create, log in, invite, members, the live-session host lease, saving the world.
// Every request that touches a world is checked against the member's login token. Times come from
// the database clock (now()), never from the player's device.
import { ApiError, badInput, json, rateLimit, readJson } from './http.js';
import { one, rows, tx, isUniqueViolation } from './db.js';
import { b64urlText, fromB64urlText, hmacHex, randomCode, randomToken, safeEqual, sha256Hex, b64url, randomBytes } from './crypto.js';

export const MAX_MEMBERS = 4;
const HOST_STALE_S = 35;        // no host heartbeat for this long = the host is gone (heartbeat every 15 s)
const HOST_GRACE_S = 10;        // a brand-new host gets this long to come online before others may replace it
const INVITE_HOURS = 72;
const TICKET_MS = 10 * 60 * 1000;
const PIN_TRIES = 5, PIN_LOCK_MIN = 15;
const WORLD_MAX = 200000;       // characters of JSON
const TOKENS_PER_MEMBER = 6;    // logins kept per member (phone, laptop...)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roomNotFound = () => new ApiError(404, 'room_not_found', 'No world with that code. Check the code and try again.');

/* ---------- input ---------- */
export function cleanCode(v) {
  const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6}$/.test(c)) throw new ApiError(400, 'bad_code', 'World codes have 6 letters and numbers.');
  return c;
}
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function needName(v) {
  const n = cleanText(v, 16);
  if (!n) throw badInput('Type your name (1–16 letters).');
  return n;
}
function needPin(v) {
  const p = String(v ?? '');
  if (!/^\d{4,6}$/.test(p)) throw badInput('The PIN must be 4 to 6 digits.');
  return p;
}
function secret(env) {
  if (!env.SERVER_SECRET || String(env.SERVER_SECRET).length < 16) throw new ApiError(503, 'not_configured', 'The Farm World server is not set up yet (no server secret).');
  return env.SERVER_SECRET;
}

/* ---------- PINs, tokens, invites, tickets ---------- */
// PINs are short, so the real protection is the lockout after 5 wrong tries. The keyed hash means a
// copy of the database alone can't be used to guess them.
const pinHash = (env, salt, pin) => hmacHex(secret(env), `pin:${salt}:${pin}`);
const inviteHash = (env, code) => hmacHex(secret(env), `invite:${code}`);

async function newToken(c, memberId) {
  const token = randomToken();
  await c.rows('INSERT INTO member_tokens (token_hash, member_id) VALUES ($1, $2)', [await sha256Hex(token), memberId]);
  // keep the newest few logins of this member
  await c.rows(`DELETE FROM member_tokens WHERE member_id = $1 AND token_hash NOT IN
    (SELECT token_hash FROM member_tokens WHERE member_id = $1 ORDER BY created_at DESC LIMIT $2)`, [memberId, TOKENS_PER_MEMBER]);
  return token;
}

// ticket = proof for the host that a PeerJS guest is this member (checked through /verify)
async function makeTicket(env, code, memberId) {
  const payload = b64urlText(JSON.stringify({ c: code, m: memberId, e: Date.now() + TICKET_MS }));
  return payload + '.' + await hmacHex(secret(env), 'ticket:' + payload);
}
async function readTicket(env, ticket) {
  const [payload, sig] = String(ticket || '').split('.');
  if (!payload || !sig || !safeEqual(sig, await hmacHex(secret(env), 'ticket:' + payload))) return null;
  try { const t = JSON.parse(fromB64urlText(payload)); return t && t.e > Date.now() ? t : null; } catch (e) { return null; }
}

/* ---------- who is calling ---------- */
// Bearer token in the header (or "token" in the body, for the save sent while a page closes)
export async function member(db, req, code, body) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('Authorization') || '');
  const token = m ? m[1] : (body && typeof body.token === 'string' && body.token.length <= 100 ? body.token : '');
  if (!token) throw new ApiError(401, 'login_needed', 'Please log in to this world.');
  const me = await one(db, `SELECT m.id, m.room_id, m.seat, m.name, m.is_owner, r.code, r.name AS room_name
      FROM member_tokens t JOIN room_members m ON m.id = t.member_id JOIN rooms r ON r.id = m.room_id
      WHERE t.token_hash = $1`, [await sha256Hex(token)]);
  if (!me) {
    if (!(await one(db, 'SELECT 1 FROM rooms WHERE code = $1', [code]))) throw roomNotFound();
    throw new ApiError(401, 'login_needed', 'Your login for this world has ended. Log in again with your name and PIN.');
  }
  if (me.code !== code) throw new ApiError(403, 'not_member', 'You are not a member of this world.');
  return me;
}
const ownerOnly = me => { if (!me.is_owner) throw new ApiError(403, 'owner_only', 'Only the owner of this world can do that.'); };

const memberOut = m => ({ id: m.id, name: m.name, seat: m.seat, isOwner: !!m.is_owner });
const roomOut = r => ({ code: r.code, name: r.name });

/* ---------- create a world ---------- */
export async function createRoom(req, env, db) {
  rateLimit(req, 'create', 10, 3600e3, env);
  const b = await readJson(req);
  const name = needName(b.name), pin = needPin(b.pin);
  const worldName = cleanText(b.world, 32) || `${name}'s farm`;
  for (let i = 0; i < 8; i++) {
    const code = randomCode(6);
    try {
      return await tx(db, async c => {
        const r = await c.one('INSERT INTO rooms (code, name) VALUES ($1, $2) RETURNING id, code, name', [code, worldName]);
        const salt = b64url(randomBytes(16));
        const m = await c.one(`INSERT INTO room_members (room_id, seat, name, pin_salt, pin_hash, is_owner, last_seen_at)
            VALUES ($1, 0, $2, $3, $4, true, now()) RETURNING id, seat, name, is_owner`, [r.id, name, salt, await pinHash(env, salt, pin)]);
        const token = await newToken(c, m.id);
        return json({ token, room: roomOut(r), member: memberOut(m) }, 201);
      });
    } catch (e) { if (!isUniqueViolation(e, 'rooms_code')) throw e; }   // code taken: try another
  }
  throw new ApiError(500, 'server_error', 'Could not make a world code. Try again.');
}

/* ---------- log in (any device) ---------- */
export async function login(req, env, db, code) {
  rateLimit(req, 'login', 30, 600e3, env);
  const b = await readJson(req);
  const name = needName(b.name), pin = needPin(b.pin);
  const room = await one(db, 'SELECT id, code, name FROM rooms WHERE code = $1', [code]);
  if (!room) throw roomNotFound();
  // the failed-try counter must be saved even when the login fails, so the result is returned (not thrown) from the transaction
  const out = await tx(db, async c => {
    const m = await c.one(`SELECT id, seat, name, is_owner, pin_salt, pin_hash, failed_pins,
        (locked_until IS NOT NULL AND locked_until > now()) AS locked, ceil(extract(epoch FROM locked_until - now()) / 60)::int AS lock_min
        FROM room_members WHERE room_id = $1 AND lower(name) = lower($2) FOR UPDATE`, [room.id, name]);
    if (!m) return { err: new ApiError(401, 'wrong_login', 'Wrong name or PIN for this world.') };
    if (m.locked) return { err: new ApiError(429, 'locked', `Too many wrong PINs. Try again in ${Math.max(1, m.lock_min)} minute${m.lock_min > 1 ? 's' : ''}.`) };
    if (!safeEqual(await pinHash(env, m.pin_salt, pin), m.pin_hash)) {
      const n = m.failed_pins + 1;
      if (n >= PIN_TRIES) {
        await c.rows(`UPDATE room_members SET failed_pins = 0, locked_until = now() + make_interval(mins => $2) WHERE id = $1`, [m.id, PIN_LOCK_MIN]);
        return { err: new ApiError(429, 'locked', `Too many wrong PINs. Try again in ${PIN_LOCK_MIN} minutes.`) };
      }
      await c.rows('UPDATE room_members SET failed_pins = $2 WHERE id = $1', [m.id, n]);
      return { err: new ApiError(401, 'wrong_login', `Wrong name or PIN for this world (${PIN_TRIES - n} ${PIN_TRIES - n === 1 ? 'try' : 'tries'} left).`) };
    }
    await c.rows('UPDATE room_members SET failed_pins = 0, locked_until = NULL, last_seen_at = now() WHERE id = $1', [m.id]);
    return { token: await newToken(c, m.id), member: memberOut(m) };
  });
  if (out.err) throw out.err;
  return json({ token: out.token, room: roomOut(room), member: out.member });
}

export async function logout(req, env, db, code) {
  const me = await member(db, req, code);
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') || '');
  if (m) await rows(db, 'DELETE FROM member_tokens WHERE token_hash = $1 AND member_id = $2', [await sha256Hex(m[1]), me.id]);
  return json({ ok: true });
}

/* ---------- invites (owner) ---------- */
export async function createInvite(req, env, db, code) {
  rateLimit(req, 'invite', 30, 3600e3, env);
  const me = await member(db, req, code);
  ownerOnly(me);
  return tx(db, async c => {
    await c.one('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [me.room_id]);
    const n = (await c.one('SELECT count(*)::int AS n FROM room_members WHERE room_id = $1', [me.room_id])).n;
    if (n >= MAX_MEMBERS) throw new ApiError(409, 'members_full', `This world already has ${MAX_MEMBERS} members. Remove someone first to invite a new friend.`);
    await c.rows('DELETE FROM room_invites WHERE room_id = $1 AND (expires_at < now() OR used_at IS NOT NULL)', [me.room_id]);
    const open = (await c.one('SELECT count(*)::int AS n FROM room_invites WHERE room_id = $1', [me.room_id])).n;
    if (open >= 10) throw new ApiError(429, 'too_many_invites', 'You already have 10 open invites. Wait for them to be used or expire.');
    const invite = randomCode(8);
    const r = await c.one(`INSERT INTO room_invites (code_hash, room_id, created_by, expires_at)
        VALUES ($1, $2, $3, now() + make_interval(hours => $4)) RETURNING expires_at`, [await inviteHash(env, invite), me.room_id, me.id, INVITE_HOURS]);
    return json({ invite, expiresAt: r.expires_at, hours: INVITE_HOURS }, 201);
  });
}

const inviteInvalid = () => new ApiError(404, 'invite_invalid', 'This invite is not valid any more (already used or expired). Ask the owner for a new one.');

export async function invitePreview(req, env, db, code, invite) {
  rateLimit(req, 'join', 40, 600e3, env);
  const room = await one(db, 'SELECT id, code, name FROM rooms WHERE code = $1', [code]);
  if (!room) throw roomNotFound();
  const inv = await one(db, `SELECT 1 FROM room_invites WHERE code_hash = $1 AND room_id = $2 AND used_at IS NULL AND expires_at > now()`,
    [await inviteHash(env, String(invite || '').toUpperCase()), room.id]);
  if (!inv) throw inviteInvalid();
  const n = (await one(db, 'SELECT count(*)::int AS n FROM room_members WHERE room_id = $1', [room.id])).n;
  return json({ room: roomOut(room), members: n, maxMembers: MAX_MEMBERS });
}

// redeem an invite: become a permanent member of the world
export async function joinWithInvite(req, env, db, code) {
  rateLimit(req, 'join', 40, 600e3, env);
  const b = await readJson(req);
  const name = needName(b.name), pin = needPin(b.pin);
  const invite = String(b.invite || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const room = await one(db, 'SELECT id, code, name FROM rooms WHERE code = $1', [code]);
  if (!room) throw roomNotFound();
  const ih = await inviteHash(env, invite);
  try {
    return await tx(db, async c => {
      await c.one('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [room.id]);   // one join at a time per world
      const inv = await c.one(`SELECT code_hash FROM room_invites WHERE code_hash = $1 AND room_id = $2 AND used_at IS NULL AND expires_at > now()`, [ih, room.id]);
      if (!inv) throw inviteInvalid();
      const taken = (await c.rows('SELECT seat, lower(name) AS n FROM room_members WHERE room_id = $1', [room.id]));
      if (taken.length >= MAX_MEMBERS) throw new ApiError(409, 'members_full', `This world already has ${MAX_MEMBERS} members.`);
      if (taken.some(t => t.n === name.toLowerCase())) throw new ApiError(409, 'name_taken', 'Someone in this world already uses that name. Pick another one.');
      let seat = 0;
      while (taken.some(t => t.seat === seat)) seat++;
      const salt = b64url(randomBytes(16));
      const m = await c.one(`INSERT INTO room_members (room_id, seat, name, pin_salt, pin_hash, last_seen_at)
          VALUES ($1, $2, $3, $4, $5, now()) RETURNING id, seat, name, is_owner`, [room.id, seat, name, salt, await pinHash(env, salt, pin)]);
      await c.rows('UPDATE room_invites SET used_by = $2, used_at = now() WHERE code_hash = $1', [ih, m.id]);
      const token = await newToken(c, m.id);
      return json({ token, room: roomOut(room), member: memberOut(m) }, 201);
    });
  } catch (e) {
    if (isUniqueViolation(e, 'room_members_name')) throw new ApiError(409, 'name_taken', 'Someone in this world already uses that name. Pick another one.');
    throw e;
  }
}

/* ---------- world info, members ---------- */
export async function roomInfo(req, env, db, code) {
  const me = await member(db, req, code);
  const r = await one(db, `SELECT code, name, created_at, last_played_at, host_member_id, online, world_saved_at,
      (host_seen_at IS NOT NULL AND host_seen_at > now() - make_interval(secs => $2)) AS live FROM rooms WHERE id = $1`, [me.room_id, HOST_STALE_S]);
  const ms = await rows(db, 'SELECT id, name, seat, is_owner, last_seen_at FROM room_members WHERE room_id = $1 ORDER BY seat', [me.room_id]);
  const online = new Set(r.live ? r.online : []);
  return json({
    room: { code: r.code, name: r.name, createdAt: r.created_at, lastPlayedAt: r.last_played_at, savedAt: r.world_saved_at },
    me: memberOut(me),
    members: ms.map(m => ({ ...memberOut(m), online: online.has(m.id), lastSeenAt: m.last_seen_at })),
    online: online.size, maxMembers: MAX_MEMBERS, maxOnline: MAX_MEMBERS,
    host: r.live && r.host_member_id ? { id: r.host_member_id, name: (ms.find(m => m.id === r.host_member_id) || {}).name || '' } : null,
  });
}

export async function removeMember(req, env, db, code, id) {
  const me = await member(db, req, code);
  ownerOnly(me);
  if (!UUID_RE.test(id)) throw new ApiError(404, 'member_not_found', 'That member is not in this world.');
  if (id === me.id) throw badInput('The owner cannot remove themselves.');
  const gone = await rows(db, 'DELETE FROM room_members WHERE id = $1 AND room_id = $2 RETURNING name', [id, me.room_id]);
  if (!gone.length) throw new ApiError(404, 'member_not_found', 'That member is not in this world.');
  return json({ ok: true, removed: { id, name: gone[0].name } });
}

export async function deleteRoom(req, env, db, code) {
  const b = await readJson(req);
  const me = await member(db, req, code);
  ownerOnly(me);
  if (cleanText(b.confirm, 32).toLowerCase() !== me.room_name.toLowerCase()) throw badInput(`Type the world name "${me.room_name}" to confirm.`);
  await rows(db, 'DELETE FROM rooms WHERE id = $1', [me.room_id]);
  return json({ ok: true });
}

/* ---------- live session: who hosts the PeerJS game ---------- */
// The first member to open the world hosts it; the others join the host. When the host is gone
// (left, crashed, or its heartbeat stopped), the next member to ask becomes the host.
export async function openSession(req, env, db, code) {
  const b = await readJson(req);
  const me = await member(db, req, code);
  const out = await tx(db, async c => {
    const r = await c.one(`SELECT id, world, world_rev, host_member_id, host_peer, host_epoch,
        (host_seen_at IS NOT NULL AND host_seen_at > now() - make_interval(secs => $2)) AS live,
        (host_since IS NOT NULL AND host_since > now() - make_interval(secs => $3)) AS young
        FROM rooms WHERE id = $1 FOR UPDATE`, [me.room_id, HOST_STALE_S, HOST_GRACE_S]);
    let take = !r.host_member_id || !r.live || r.host_member_id === me.id;    // free, gone, or my own other device
    // a guest that lost the host and could not find it on the PeerJS server
    if (!take && b.hostGone === r.host_epoch && b.unavailable === true && !r.young) take = true;
    await c.rows('UPDATE room_members SET last_seen_at = now() WHERE id = $1', [me.id]);
    if (take) {
      const epoch = r.host_epoch + 1;
      const peer = `rvfarm-${code.toLowerCase()}-${epoch}-${randomCode(5).toLowerCase()}`;
      await c.rows(`UPDATE rooms SET host_member_id = $2, host_peer = $3, host_epoch = $4, host_since = now(), host_seen_at = now(),
          online = ARRAY[$2]::uuid[], last_played_at = now() WHERE id = $1`, [r.id, me.id, peer, epoch]);
      return { role: 'host', epoch, hostPeer: peer, world: r.world, worldRev: r.world_rev };
    }
    const host = await c.one('SELECT name FROM room_members WHERE id = $1', [r.host_member_id]);
    return { role: 'guest', epoch: r.host_epoch, hostPeer: r.host_peer, hostName: host ? host.name : '' };
  });
  if (out.role === 'guest') out.ticket = await makeTicket(env, code, me.id);
  return json({ ...out, me: memberOut(me), room: { code, name: me.room_name } });
}

// host, every ~15 s: "I'm still hosting, these members are online" (+ the world snapshot when it changed).
// release: the host is leaving; the next member to open the world takes over right away.
export async function heartbeat(req, env, db, code) {
  const b = await readJson(req);
  const me = await member(db, req, code, b);
  let world = null;
  if (b.world !== undefined && b.world !== null) {
    if (typeof b.world !== 'object' || Array.isArray(b.world) || b.world.v !== 1) throw badInput('Bad world snapshot');
    if (JSON.stringify(b.world).length > WORLD_MAX) throw new ApiError(413, 'too_large', 'The world snapshot is too large');
    world = b.world;
  }
  const ids = Array.isArray(b.online) ? b.online.filter(x => typeof x === 'string' && UUID_RE.test(x)).slice(0, MAX_MEMBERS * 2) : [];
  return tx(db, async c => {
    const r = await c.one('SELECT host_member_id, host_epoch, world_rev FROM rooms WHERE id = $1 FOR UPDATE', [me.room_id]);
    if (r.host_member_id !== me.id || r.host_epoch !== b.epoch) {
      const h = r.host_member_id ? await c.one('SELECT name FROM room_members WHERE id = $1', [r.host_member_id]) : null;
      return json({ ok: false, superseded: true, hostId: r.host_member_id, hostName: h ? h.name : '' });
    }
    const online = (await c.rows('SELECT id FROM room_members WHERE room_id = $1 AND (id = ANY($2::uuid[]) OR id = $3)', [me.room_id, ids, me.id])).map(x => x.id);
    const rel = b.release === true;
    const w = await c.one(`UPDATE rooms SET
        host_seen_at = CASE WHEN $3 THEN NULL ELSE now() END,
        host_member_id = CASE WHEN $3 THEN NULL ELSE host_member_id END,
        online = CASE WHEN $3 THEN '{}'::uuid[] ELSE $2::uuid[] END,
        last_played_at = now(),
        world = COALESCE($4::jsonb, world),
        world_rev = world_rev + CASE WHEN $4::jsonb IS NULL THEN 0 ELSE 1 END,
        world_saved_at = CASE WHEN $4::jsonb IS NULL THEN world_saved_at ELSE now() END
        WHERE id = $1 RETURNING world_rev, world_saved_at`, [me.room_id, online, rel, world ? JSON.stringify(world) : null]);
    await c.rows('UPDATE room_members SET last_seen_at = now() WHERE id = ANY($1::uuid[])', [online]);
    // players in the live game who are no longer members (removed by the owner): the host puts them out
    const gone = ids.filter(id => !online.includes(id));
    return json({ ok: true, worldRev: w.world_rev, savedAt: w.world_saved_at, online: online.length, gone });
  });
}

// host: is this PeerJS guest really a member? (their ticket came from /session)
export async function verifyTicket(req, env, db, code) {
  const b = await readJson(req);
  const me = await member(db, req, code);
  const r = await one(db, 'SELECT host_member_id FROM rooms WHERE id = $1', [me.room_id]);
  if (r.host_member_id !== me.id) throw new ApiError(409, 'not_host', 'Only the current host checks players.');
  const t = await readTicket(env, b.ticket);
  if (!t || t.c !== code || !UUID_RE.test(t.m)) throw new ApiError(403, 'bad_ticket', 'That player is not a member of this world.');
  const m = await one(db, 'SELECT id, name, seat, is_owner FROM room_members WHERE id = $1 AND room_id = $2', [t.m, me.room_id]);
  if (!m) throw new ApiError(403, 'bad_ticket', 'That player is not a member of this world.');
  return json({ member: memberOut(m) });
}
