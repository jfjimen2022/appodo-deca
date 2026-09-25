import api from './api'

// CRUD de usuarios (django.contrib.auth.User estándar) -- admin-only, ver
// backend/deca/views_usuarios.py. Solo dos roles: is_staff true/false.
export const usuariosService = {
  listar: (params = {}) => api.get('/api/v1/deca/usuarios/', { params }),
  obtener: (id) => api.get(`/api/v1/deca/usuarios/${id}/`),
  crear: (data) => api.post('/api/v1/deca/usuarios/', data),
  actualizar: (id, data) => api.patch(`/api/v1/deca/usuarios/${id}/`, data),
  borrar: (id) => api.delete(`/api/v1/deca/usuarios/${id}/`),
}
