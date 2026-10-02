// Preparación común de los tests de vitest: matchers de jest-dom, IndexedDB en
// memoria (la cola y la caché offline de DeCA viven ahí) y las APIs del
// navegador que jsdom no trae.
import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'

Object.defineProperty(globalThis.navigator, 'onLine', { value: true, writable: true, configurable: true })

if (!globalThis.navigator.serviceWorker) {
  globalThis.navigator.serviceWorker = {
    ready: Promise.resolve({ sync: { register: () => Promise.resolve() } }),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto.randomUUID = () => `uuid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}
