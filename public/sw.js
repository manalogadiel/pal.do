// Pal.do PWA Service Worker
const CACHE_NAME = 'paldo-pwa-v3-pals-logo'

// On a dev server (this computer or the local network) the cache served old copies of the source files, so changes
// never showed. There this worker clears everything, removes itself, and reloads the open tabs onto the real files.
const DEV_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(self.location.hostname)
if (DEV_HOST) {
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)))
      await self.registration.unregister()
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
    })())
  })
}
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
  '/icons/apple-touch-icon.png'
]

if (!DEV_HOST) self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  )
})

if (!DEV_HOST) self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

if (!DEV_HOST) self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Skip non-GET requests and external API/worker streaming
  if (req.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.includes('audio') || url.pathname.endsWith('.wasm')) {
    return
  }

  // Navigation requests: Network-first, fallback to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((res) => res || fetch(req)))
    )
    return
  }

  // Static shell and assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone))
        }
        return response
      }).catch(() => cached)

      return cached || networkFetch
    })
  )
})
