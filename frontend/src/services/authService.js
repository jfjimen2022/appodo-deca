import api from './api'

// Auth vía JWT en cookies HttpOnly (ver backend/deca/auth_views.py). El login
// no devuelve el usuario en el body -- tras un login OK hay que pedir
// GET /api/v1/auth/me/ para saber quién es y si es admin (is_staff).
export const authService = {
  login: (username, password) => api.post('/api/v1/auth/token/', { username, password }),
  logout: () => api.post('/api/v1/auth/logout/'),
  me: () => api.get('/api/v1/auth/me/'),
}
