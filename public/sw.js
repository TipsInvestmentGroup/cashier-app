// MyPos push service worker — shows a real OS-level notification even when
// this tab is backgrounded or the app isn't open, and focuses/opens the
// relevant order when tapped.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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
