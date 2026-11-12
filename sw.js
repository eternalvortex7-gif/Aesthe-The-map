/* aesthe service worker
   - App files: network first (so updates arrive), saved copy when offline or slow.
   - Map tiles, glyphs and sprites: saved copy first, so areas you looked at or saved open offline.
   - Style and tile index (TileJSON): network first, saved copy as fallback.
   - Everything else (search, directions, nearby places, photos) goes straight to the network and is never stored here.
   A new version waits until the person taps "Reload" in the app, so a page is never swapped half way through. */
importScripts('config.js');
const BUILD = '__BUILD__';                       // stamped with a content hash by scripts/build.mjs
const SHELL_CACHE = 'aesthe-shell-' + BUILD, TILE_CACHE = 'aesthe-tiles-v1', TILE_LIMIT = 2000;
const CFG = self.AESTHE_CONFIG || {};
let TILE_HOST = 'tiles.openfreemap.org';
try { TILE_HOST = new URL(CFG.style, self.location.href).host; } catch (e) {}
let SAT_HOSTS = [];
try {
  const sat = CFG.satellite || {}, sh = sat.sharp || {};
  for (const t of [...(sat.tiles || []), ...(sh.tiles || []), ...(sh.hosts || []), ...(sh.url ? [sh.url] : [])]) { try { SAT_HOSTS.push(new URL(String(t).replace(/\{[a-z-]+\}/g, '0')).host); } catch (e) {} }
} catch (e) {}
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'motion.js', 'life.js', 'trains.js', 'compass.js', 'weather.js', 'satellite.js', 'config.js', 'privacy.html', 'manifest.webmanifest',
  'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('aesthe-shell-') && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

let trimAt = 0;
async function trim() {
  const now = Date.now(); if (now - trimAt < 20000) return; trimAt = now;
  const c = await caches.open(TILE_CACHE), ks = await c.keys();
  for (let i = 0; i < ks.length - TILE_LIMIT; i++) await c.delete(ks[i]);
}
async function netFirst(e, name, ms) {
  const req = e.request, c = await caches.open(name);
  const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()).catch(() => {}); return r; });
  e.waitUntil(net.catch(() => {}));
  const stale = async () => (await c.match(req)) || (req.mode === 'navigate' && ((await c.match('index.html')) || (await c.match('./')))) || null;
  try {
    const r = await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]);
    if (r.ok) return r;
    return (await stale()) || r;                    // server error: prefer the saved copy
  } catch (err) {
    const hit = await stale(); if (hit) return hit; throw err;
  }
}
async function cacheFirst(e, name, limit) {
  const req = e.request, c = await caches.open(name), hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req);
  if (r && r.ok) e.waitUntil(c.put(req, r.clone()).then(() => limit && trim()).catch(() => {}));
  return r;
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (/\/(vendor|icons)\//.test(u.pathname)) e.respondWith(cacheFirst(e, SHELL_CACHE, false));
    else e.respondWith(netFirst(e, SHELL_CACHE, 3500));
    return;
  }
  if (u.host === TILE_HOST) {
    const live = u.pathname === '/planet' || u.pathname.startsWith('/styles/') || /\.json$/.test(u.pathname);
    e.respondWith(live ? netFirst(e, TILE_CACHE, 4000) : cacheFirst(e, TILE_CACHE, true));
  }
  else if (SAT_HOSTS.includes(u.host)) {                                                      // satellite pictures: looked-at areas open again offline
    e.respondWith(/\.json$/.test(u.pathname) ? netFirst(e, TILE_CACHE, 4000) : cacheFirst(e, TILE_CACHE, true));   // the provider's tile index (TileJSON) stays fresh
  }
  // anything else is not touched
});
