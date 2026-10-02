import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './i18n.js'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Service worker (src/sw.js): precarga la app para abrirla sin red y registra
// los DeCA hechos sin cobertura al volver la conexión. Solo en el build de
// producción: con el servidor de desarrollo de Vite no existe /sw.js.
// Requiere HTTPS (o localhost), como cualquier service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
