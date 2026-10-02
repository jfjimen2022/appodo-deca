// "Instalar Appodo en este móvil" desde el ERP (2026-09-30, DeCA en campo).
// Chrome ofrece la instalación con el evento `beforeinstallprompt`, que llega
// una sola vez y pronto; se captura aquí, a nivel de módulo, en cuanto se
// importa (desde Layout), para poder ofrecerlo después en cualquier pantalla.
// Instalada, la app arranca sin red de forma fiable y el navegador permite la
// comprobación periódica en segundo plano (ver lib/decaOffline.js).

let aviso = null
const oyentes = new Set()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    aviso = e
    oyentes.forEach((fn) => fn(true))
  })
  window.addEventListener('appinstalled', () => {
    aviso = null
    oyentes.forEach((fn) => fn(false))
  })
}

export function yaInstalada() {
  return typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)
}

export function puedeInstalar() {
  return Boolean(aviso) && !yaInstalada()
}

export function alCambiarInstalable(fn) {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

export async function instalar() {
  if (!aviso) return false
  aviso.prompt()
  const { outcome } = await aviso.userChoice
  aviso = null
  oyentes.forEach((fn) => fn(false))
  return outcome === 'accepted'
}
