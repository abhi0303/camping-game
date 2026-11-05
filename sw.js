// Service worker: makes the game installable and quick to start, and lets solo play work offline.
// - Game files (same origin): network first, so new versions show up right away; falls back to the
//   cached copy when offline or when the network is very slow.
// - Libraries from the CDN (versioned URLs, never change): cache first.
// Multiplayer (WebRTC / PeerJS broker) always needs the internet; the worker never touches it.
// (new game files are cached automatically on the first visit; this list just makes the first install offline-ready)
const SHELL = 'rv-shell-v1', CDN = 'rv-cdn-v1';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/icon.svg', './icons/favicon-32.png',
  ...['main', 'world', 'day-night', 'terrain', 'rv', 'rvModel', 'rvInterior', 'rvDims', 'player', 'character', 'camera', 'input', 'touch', 'audio', 'inventory',
    'items', 'gear', 'drone', 'bridge', 'bridgeEditor', 'obstacles', 'materials', 'minimap', 'net', 'multiplayer', 'remote', 'save', 'utils',
    'zombies', 'survival', 'combat', 'voice', 'structures', 'designer', 'giants', 'app', 'icons', 'ambience', 'birds', 'grass', 'music', 'flora',
    'farm/config', 'farm/api', 'farm/logins', 'farm/farm', 'farm/menu', 'farm/panel',
    'farm/layout', 'farm/props', 'farm/models', 'farm/npc', 'farm/farmland', 'farm/economy', 'farm/farmui', 'farm/notebook', 'farm/animals', 'village/layout', 'village/houses', 'village/gardens', 'village/props', 'village/animals', 'village/characters', 'village/animations', 'village/navigation', 'village/schedule', 'village/interactions', 'village/ai', 'village/index',
    'fishing/sim', 'fishing/models', 'fishing/thumbs', 'fishing/area', 'fishing/fishing', 'fishing/marketui'].map(f => `./js/${f}.js`),
];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.all(FILES.map(f => shell.add(new Request(f, { cache: 'reload' })).catch(() => {})));
    const cdn = await caches.open(CDN);
    await Promise.all(LIBS.map(u => cdn.match(u).then(hit => hit || cdn.add(u)).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== CDN) await caches.delete(k);
    await self.clients.claim();
  })());
});

const scopeURL = new URL('./', self.registration.scope).href;
// every visit to the page (with or without ?room=...) is the same index.html
const keyOf = req => (req.mode === 'navigate' ? scopeURL + 'index.html' : req.url.split('#')[0]);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === 'cdn.jsdelivr.net') e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL), key = keyOf(req);
  const net = fetch(req).then(res => { if (res.ok && res.type === 'basic') cache.put(key, res.clone()); return res; });
  const cached = await cache.match(key, { ignoreSearch: true });
  if (!cached) return net;
  // prefer the fresh file, but don't keep a phone on a bad connection waiting more than 4 s
  return Promise.race([net.catch(() => cached), new Promise(r => setTimeout(() => r(cached), 4000))]);
}
async function cacheFirst(req) {
  const cache = await caches.open(CDN);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
