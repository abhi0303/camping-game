// Small crypto helpers on WebCrypto (works in Cloudflare Workers and Node 20+).
const enc = new TextEncoder();

export const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L: easy to read out loud

export function randomBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlText(text) { return b64url(enc.encode(text)); }
export function fromB64urlText(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// login tokens: 256 random bits
export const randomToken = () => b64url(randomBytes(32));
// room codes / invite codes from ALPHA, without modulo bias
export function randomCode(n) {
  let out = '';
  while (out.length < n) for (const b of randomBytes(n * 2)) { if (b < 248 && out.length < n) out += ALPHA[b % 31]; }
  return out;
}

export async function sha256Hex(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

const keys = new Map();
async function hmacKey(secret) {
  let k = keys.get(secret);
  if (!k) { k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); keys.set(secret, k); }
  return k;
}
export async function hmacHex(secret, msg) { return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg))); }

// compare without leaking where the strings differ
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  let r = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}
