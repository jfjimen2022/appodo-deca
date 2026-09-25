import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Standalone Appodo DeCa: sin PWA/service worker (eso era específico del ERP
// origen para fichaje offline, no aplica aquí). Proxy de /api al backend
// Django en dev; en build real se usa VITE_API_URL (ver .env.example) o el
// mismo origen si el backend sirve el SPA detrás del mismo dominio/nginx.
export default defineConfig({
  plugins: [react()],
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
