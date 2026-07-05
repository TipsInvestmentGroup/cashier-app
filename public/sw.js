// MyPos service worker — push notifications (shows a real OS-level
// notification even when this tab is backgrounded or the app isn't open)
// plus limited offline app-shell caching, so the PWA can still OPEN with
// zero connectivity (previously Safari/Chrome would show their own native
// "not connected to the internet" error before any app code ever ran —
// once the app has loaded, lib/offline-queue.ts and lib/offline-cache.ts
// handle actual data/interaction resilience; this only gets the shell open).
//
// This caches at RUNTIME, not at build time: Next.js hashes JS/CSS
// filenames on every deploy, so rather than precaching a manifest (fragile
// against this repo's non-standard Next.js build, per AGENTS.md), it caches
// whatever a device actually visits while online and serves that back only
// when the network is genuinely unreachable. Scoped deliberately narrow —
// only full-page navigations and static assets under /_next/static/ — to
// avoid caching Next's client-side RSC data fetches, which reuse the same
// URL with different headers for a different payload shape; caching those
// under a plain URL key could serve the wrong shape back and break hydration.
const CACHE_NAME = 'mypos-shell-v1'
const SHELL_URL = '/mypos' // manifest.json's start_url — the PWA's cold-launch fallback

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // API routes are handled at the JS layer (lib/offline-cache.ts,
  // lib/offline-queue.ts) — never cache them here, that logic already
  // decides what's safe to serve stale and mutations must never be cached.
  if (url.pathname.startsWith('/api/')) return

  const isNavigation = request.mode === 'navigate'
  const isStaticAsset = url.pathname.startsWith('/_next/static/')
  if (!isNavigation && !isStaticAsset) return

  event.respondWith((async () => {
    try {
      // Network-first: normal operation always prefers fresh code, so the
      // cache only matters in the narrow window where there's truly no
      // connection — minimizes the risk of ever serving stale JS/HTML.
      const fresh = await fetch(request)
      if (fresh.ok) {
        const cache = await caches.open(CACHE_NAME)
        cache.put(request, fresh.clone())
      }
      return fresh
    } catch {
      const cached = await caches.match(request)
      if (cached) return cached
      // Never visited this exact URL while online — for a full navigation,
      // fall back to the cached app shell so it can still boot, rather than
      // the browser's native offline error.
      if (isNavigation) {
        const shell = await caches.match(SHELL_URL)
        if (shell) return shell
      }
      throw new Error('offline and nothing cached for this request')
    }
  })())
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* ignore */ }
  const title = data.title || 'Tips MyPos'
  const url = data.url || '/mypos'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/tips-logo.png',
      badge: '/tips-logo.png',
      tag: url,
      renotify: true,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/mypos'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      if (clients.length > 0 && 'focus' in clients[0]) {
        clients[0].navigate(url)
        return clients[0].focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
