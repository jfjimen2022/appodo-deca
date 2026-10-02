// Service worker de Appodo DeCa -- portado del ERP Appodo, solo con lo que
// necesita DeCA: precarga de la app para abrirla sin red y registro de los
// DeCA hechos sin cobertura cuando vuelve la conexión (Background Sync y
// Periodic Sync en Android/Chrome). vite-plugin-pwa (modo injectManifest)
// compila este fichero e inyecta la lista de precarga en self.__WB_MANIFEST.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { sincronizarDesdeServiceWorker } from './lib/decaOffline'

// Precarga de TODO el bundle (JS/CSS/HTML): basta con UNA visita con red para
// que la app abra después en un muelle o una finca sin cobertura. Esa primera
// visita con red no la puede evitar ningún service worker.
precacheAndRoute(self.__WB_MANIFEST)

const CACHE_NAME = 'appodo-deca-shell-v1'
const SHELL_URLS = ['/', '/index.html', '/manifest.json']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)))
  self.skipWaiting()
})

// OJO: la precarga de Workbox vive en su PROPIA caché ("workbox-precache-…").
// Si este `activate` borrara toda caché que no se llame CACHE_NAME, se
// llevaría por delante la precarga recién hecha y abrir la app SIN RED daría
// pantalla en blanco (bug real del ERP origen, detectado probando el DeCA sin
// cobertura). Las cachés de Workbox las gestiona `cleanupOutdatedCaches()`.
cleanupOutdatedCaches()

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && !k.startsWith('workbox-'))
          .map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Lo que sirve Django directamente (admin, estáticos, media) nunca es parte
  // del SPA: se deja pasar sin tocar, sin caché ni fallback.
  if (
    url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/static/') ||
    url.pathname.startsWith('/media/')
  ) {
    return
  }

  // API → siempre red. Sin red, un 503 con `offline: true` para que la app
  // lo trate como "sin cobertura" (lib/decaOffline.js::esErrorDeRed) y no
  // como un rechazo del servidor.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(request).catch(() => new Response(
      JSON.stringify({ detail: 'Sin conexión con el servidor.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )))
    return
  }

  // Navegación del SPA → red primero; sin red, el index.html precargado.
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match('/index.html')))
    return
  }

  // Resto de assets → caché primero. El .catch final evita una promesa
  // rechazada sin capturar dentro de respondWith() cuando no hay ni caché
  // ni red (el navegador lo reporta como "network error response").
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => new Response(null, { status: 504, statusText: 'Offline (SW)' }))
    }),
  )
})

// ── DeCA hechos sin cobertura ─────────────────────────────────────────────
// Al volver la red, el navegador despierta este service worker aunque la app
// esté CERRADA (Background Sync, Android/Chrome). Si hay una ventana abierta,
// lo hace ella (así no se envía dos veces a la vez); si no, lo hace el SW con
// las cookies de sesión. En iPhone no hay Background Sync: se registran al
// abrir la app con red (ver components/layout/Layout.jsx).
async function syncDeca({ refrescarAgenda = false } = {}) {
  const ventanas = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
  if (ventanas.length) {
    ventanas.forEach((c) => c.postMessage({ type: 'SW_SYNC_DECA' }))
    return
  }
  const r = await sincronizarDesdeServiceWorker({ base: self.location.origin, refrescarAgenda })
  if (r?.sin_red) throw new Error('sin red') // el navegador reintenta el sync más tarde
  const hechos = (r?.registrados || 0) + (r?.por_completar || 0)
  if (hechos && self.Notification?.permission === 'granted') {
    await self.registration.showNotification('Appodo DeCa', {
      body: r.por_completar
        ? `${hechos} DeCA hechos sin cobertura registrados; ${r.por_completar} necesitan completar algún dato.`
        : `${hechos} DeCA hechos sin cobertura ya están registrados.`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/deca' },
      tag: 'deca-sin-cobertura',
    })
  }
}

// Comprobación periódica (solo con la app instalada en Android/Chrome): además
// de enviar la cola, refresca la agenda guardada en el móvil.
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'deca-periodico') e.waitUntil(syncDeca({ refrescarAgenda: true }).catch(() => {}))
})

self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-deca') e.waitUntil(syncDeca())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existente = clients.find((c) => c.url.includes(url))
      return existente ? existente.focus() : self.clients.openWindow(url)
    }),
  )
})
