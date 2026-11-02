// Address of the Farm World server (the Cloudflare Worker in /server). Filled in when it is deployed.
const DEPLOYED = '';

// On a page opened from this computer (testing), ?api=http://127.0.0.1:8787 picks another server.
// Nowhere else: a shared link must never be able to send your login to someone else's server.
function pick() {
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^https?:\/\//.test(q)) return q.replace(/\/+$/, '');
  } catch (e) { /* ignore */ }
  return DEPLOYED;
}
export const API_BASE = pick();
