/* TRU HQ service worker.
 *
 * Its ONLY jobs are (a) make the app installable as a real standalone app, and
 * (b) show something useful instead of a browser error when the phone drops
 * signal mid-1:1.
 *
 * It is deliberately NOT an aggressive cache. The failure mode everyone hates —
 * "I deployed but my phone still shows the old version" — comes from serving a
 * cached HTML shell while online, so this never does that:
 *
 *   - the page shell is network-FIRST, cache only as an offline fallback
 *   - /assets/* is cache-first, which is safe because Vite content-hashes those
 *     filenames: a new build produces new names, so a cached one can never be
 *     stale, only orphaned (and old caches are dropped on activate)
 *   - anything cross-origin is never touched — Supabase and the sync Worker must
 *     always hit the network, or a leader could act on stale lead data
 *   - non-GET is never touched, so nothing that writes is ever replayed
 */

const VERSION = 'tru-hq-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// The hero video is ~3MB of decoration; caching it would eat a phone's storage
// budget for no benefit.
const SKIP = [/\.mp4$/i, /\.webm$/i];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(['/', '/manifest.webmanifest']).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      // Take over open tabs right away rather than waiting for every one to close.
      .then(() => self.clients.claim()),
  );
});

// Lets a future build tell an already-running worker to step aside immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase / Worker: always live
  if (SKIP.some((re) => re.test(url.pathname))) return;

  // ── The page itself: always try the network first. ──
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(SHELL).then((c) => c.put('/', res.clone())).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // ── Hashed build output: safe to serve from cache, then top up. ──
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
        if (res.ok) caches.open(ASSETS).then((c) => c.put(req, res.clone())).catch(() => undefined);
        return res;
      })),
    );
    return;
  }

  // ── Everything else same-origin (icons, poster image): network, then cache. ──
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(ASSETS).then((c) => c.put(req, res.clone())).catch(() => undefined);
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? Response.error())),
  );
});
