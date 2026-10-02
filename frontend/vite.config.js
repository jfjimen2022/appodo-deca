import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// PWA mínima para el DeCA sin cobertura: nuestro src/sw.js está escrito a mano
// (sincronización de la cola de DeCA hechos sin red); el modo injectManifest
// solo le inyecta la lista de precarga del build, no genera un SW nuevo.
// Proxy de /api al backend Django en dev; en build real se usa VITE_API_URL
// (ver .env.example) o el mismo origen si nginx hace de proxy (lo normal).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: false, // se sirve public/manifest.json tal cual
      injectRegister: null, // el registro se hace a mano en src/main.jsx
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
