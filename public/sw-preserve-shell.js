/* global self, caches, URL */
// Keep the public lazy chunks needed by clients of the previous worker before
// Workbox removes superseded precache entries during activation. No API, HTML,
// grant or song response is copied. History serves exact hashed asset URLs.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const history = await caches.open('zpevnik-shell-history-v1');
    for (const name of await caches.keys()) {
      if (!name.includes('precache')) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.origin !== self.location.origin || !/\/assets\/[^/]+\.(?:js|mjs|css)$/.test(url.pathname) || /music-renderer/.test(url.pathname)) continue;
        const response = await cache.match(request);
        if (response?.ok && /javascript|text\/css/.test(response.headers.get('content-type') ?? '')) {
          url.search = '';
          await history.put(url.href, response);
        }
      }
    }
  })());
});
