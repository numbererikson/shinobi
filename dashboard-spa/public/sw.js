// Minimal service worker: cache the SPA shell for offline read access.
// Network-first for /api/* (must be fresh), cache-first for /assets/* + /.
// On install: precache index.html. On fetch: network first for API, cache
// first for static assets, fall back to cached index.html for navigation
// requests when offline.

const CACHE_NAME = 'shinobi-v1';
const PRECACHE = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Shinobi', body: 'New notification' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_e) {
    // ignore
  }
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: payload,
      actions,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const approvalId = data.approval_id;
  const action = event.action;

  if (approvalId && action && action.startsWith('respond:')) {
    const value = action.slice('respond:'.length);
    event.waitUntil(
      fetch('/api/approvals/' + approvalId + '/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, responded_by: 'push-notification' }),
      }).catch(() => undefined),
    );
    return;
  }

  const url = data.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(url) && 'focus' in w) return w.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Skip cross-origin requests.
  if (url.origin !== location.origin) return;

  // Network-first for /api/* and /health — never stale.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    event.respondWith(fetch(req));
    return;
  }

  // Cache-first for static assets.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icon-')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        });
      }),
    );
    return;
  }

  // Navigation requests: try network, fall back to cached index.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/').then((m) => m ?? new Response('offline', { status: 503 }))),
    );
    return;
  }
});
