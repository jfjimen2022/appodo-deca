import axios from 'axios'

// Instancia axios única, autenticación por cookies HttpOnly (access_token/
// refresh_token), igual patrón que el ERP origen pero simplificado:
// sin multi-tenant (no hay 'empresa' en localStorage) y sin el interceptor
// de reintento transitorio / broadcast entre pestañas (específicos del ERP,
// no imprescindibles para un módulo standalone).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

api.interceptors.request.use(
  (config) => {
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type']
    }
    return config
  },
  (error) => Promise.reject(error),
)

let isRefreshing = false
let failedQueue = []

const processQueue = (error) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error)
    else prom.resolve()
  })
  failedQueue = []
}

const clearSession = () => {
  localStorage.removeItem('user')
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      })
        .then(() => api(originalRequest))
        .catch((err) => Promise.reject(err))
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      // El refresh token se lee automáticamente de la cookie HttpOnly.
      await axios.post(
        `${import.meta.env.VITE_API_URL ?? ''}/api/v1/auth/token/refresh/`,
        {},
        { withCredentials: true },
      )
      processQueue(null)
      return api(originalRequest)
    } catch (refreshError) {
      processQueue(refreshError)
      clearSession()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

export default api
