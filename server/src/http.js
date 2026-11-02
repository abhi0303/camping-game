// JSON responses, errors with a code the game turns into a message, CORS.

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status; this.code = code; this.extra = extra || null;
  }
}
export const badInput = msg => new ApiError(400, 'bad_input', msg);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorResponse(e) {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message, ...(e.extra || {}) } }, e.status);
  // a table that doesn't exist yet: the new code is live but its migration hasn't run
  if (e && (e.code === '42P01' || e.code === '42703')) return json({ error: { code: 'server_updating', message: 'The Farm World server is being updated. Try again in a minute.' } }, 503);
  console.error('server error:', e && (e.stack || e.message || e));
  return json({ error: { code: 'server_error', message: 'The server had a problem. Try again in a moment.' } }, 500);
}

// The game's pages may call us (GitHub Pages + local testing). CORS is not access control:
// every request that touches a world is checked with the member's login token.
export function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = list.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!ok) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin, Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

// request body as an object (max ~256 KB; world snapshots are well below that)
export async function readJson(req, max = 262144) {
  const text = await req.text();
  if (text.length > max) throw new ApiError(413, 'too_large', 'That request is too large');
  if (!text) return {};
  let v;
  try { v = JSON.parse(text); } catch (e) { throw badInput('Bad request'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badInput('Bad request');
  return v;
}

// Best-effort limit per client IP, kept in this worker's memory (each Cloudflare location has its own).
// Login PINs are protected properly by the per-member lockout in the database.
const buckets = new Map();
export function rateLimit(req, kind, max, perMs, env = {}) {
  max *= Number(env.RATE_SCALE) || 1;
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'local';
  const key = kind + '|' + ip, now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.t > perMs) { b = { t: now, n: 0 }; buckets.set(key, b); }
  if (++b.n > max) throw new ApiError(429, 'slow_down', 'Too many tries — wait a minute and try again.');
  if (buckets.size > 10000) buckets.clear();
}
