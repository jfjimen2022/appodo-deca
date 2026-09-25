import api from './api'

// Descarga un blob de exportación (PDF/Excel) y lanza el `<a download>` --
// mismo patrón que en el ERP origen.
async function _descargarExportacion(url, params, nombreArchivo, extension) {
  let response
  try {
    response = await api.get(url, { params, responseType: 'blob' })
  } catch (err) {
    if (err.response?.data instanceof Blob) {
      try {
        const text = await err.response.data.text()
        const json = JSON.parse(text)
        throw new Error(json.detail || json.error || `Error ${err.response.status}`)
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) throw new Error(`Error ${err.response?.status ?? ''} al generar la exportación.`)
        throw parseErr
      }
    }
    throw err
  }
  const blob = response.data
  if (!blob || blob.size === 0) throw new Error('El archivo generado está vacío.')
  const objectUrl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = `${nombreArchivo}_${new Date().toISOString().split('T')[0]}.${extension}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(objectUrl)
}

export const decaService = {
  // Configuración (una fila única en esta instancia, se crea sola en el GET)
  obtenerConfiguracion: () => api.get('/api/v1/deca/configuracion/'),
  actualizarConfiguracion: (data) => api.patch('/api/v1/deca/configuracion/', data),

  // Catálogos reutilizables -- se alimentan solos al crear/editar una
  // expedición (ver backend deca/services/catalogo_service.py), aquí solo se leen.
  buscarConductores: (q = '') => api.get('/api/v1/deca/conductores/', { params: { solo_activos: 'true', page_size: 500, ...(q ? { q } : {}) } }),
  buscarTransportistas: (q = '') => api.get('/api/v1/deca/transportistas/', { params: { solo_activos: 'true', page_size: 500, ...(q ? { q } : {}) } }),
  buscarDestinatarios: (q = '') => api.get('/api/v1/deca/destinatarios/', { params: { solo_activos: 'true', page_size: 500, ...(q ? { q } : {}) } }),
  buscarTractoras: (q = '') => api.get('/api/v1/deca/tractoras/', { params: { solo_activos: 'true', page_size: 500, ...(q ? { q } : {}) } }),
  buscarRemolques: (q = '') => api.get('/api/v1/deca/remolques/', { params: { solo_activos: 'true', page_size: 500, ...(q ? { q } : {}) } }),

  // CRUD de la Agenda (pantalla de gestión de los catálogos). `tipo` es uno
  // de: conductores | transportistas | destinatarios | tractoras | remolques.
  listarCatalogo: (tipo, params = {}) => api.get(`/api/v1/deca/${tipo}/`, { params }),
  crearEnCatalogo: (tipo, data) => api.post(`/api/v1/deca/${tipo}/`, data),
  actualizarEnCatalogo: (tipo, id, data) => api.patch(`/api/v1/deca/${tipo}/${id}/`, data),
  borrarDeCatalogo: (tipo, id) => api.delete(`/api/v1/deca/${tipo}/${id}/`),

  // Expediciones (CRUD)
  listarExpediciones: (params = {}) => api.get('/api/v1/deca/expediciones/', { params }),
  obtenerExpedicion: (id) => api.get(`/api/v1/deca/expediciones/${id}/`),
  crearExpedicion: (data) => api.post('/api/v1/deca/expediciones/', data),
  actualizarExpedicion: (id, data) => api.patch(`/api/v1/deca/expediciones/${id}/`, data),
  borrarExpedicion: (id) => api.delete(`/api/v1/deca/expediciones/${id}/`),

  // Exportación de Expediciones -- mismo filtro/orden que el listado en
  // pantalla (los `params` son los mismos que `listarExpediciones`).
  exportarExpedicionesPDF: (params = {}) =>
    _descargarExportacion('/api/v1/deca/expediciones/exportar-pdf/', params, 'expediciones_deca', 'pdf'),
  exportarExpedicionesExcel: (params = {}) =>
    _descargarExportacion('/api/v1/deca/expediciones/exportar-excel/', params, 'expediciones_deca', 'xlsx'),

  // Exportación de la Agenda -- `tipo` es uno de: conductores |
  // transportistas | destinatarios | tractoras | remolques.
  exportarAgendaPDF: (tipo, params = {}) =>
    _descargarExportacion(`/api/v1/deca/agenda/${tipo}/exportar-pdf/`, params, `agenda_deca_${tipo}`, 'pdf'),
  exportarAgendaExcel: (tipo, params = {}) =>
    _descargarExportacion(`/api/v1/deca/agenda/${tipo}/exportar-excel/`, params, `agenda_deca_${tipo}`, 'xlsx'),

  // Importación CSV de la Agenda -- alta masiva de fichas, `tipo` igual que
  // en el resto de endpoints de Agenda. Upsert por NIF (o matrícula
  // tractora en vehículos), mismo criterio que el backend.
  importarAgendaCSV: (tipo, archivo) => {
    const form = new FormData()
    form.append('archivo', archivo)
    return api.post(`/api/v1/deca/agenda/${tipo}/importar-csv/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // Documentos de origen (albarán, CMR...) -- `extraer: true` pide además
  // que el backend intente adivinar campos del PDF subido (solo sugerencia,
  // nunca se guarda sin que el usuario confirme).
  subirDocumento: (expedicionId, archivo, tipoDocumento, { extraer = false } = {}) => {
    const form = new FormData()
    form.append('archivo', archivo)
    form.append('tipo_documento', tipoDocumento)
    return api.post(`/api/v1/deca/expediciones/${expedicionId}/documentos/`, form, {
      params: extraer ? { extraer: 'true' } : {},
    })
  },
  // CRUD sobre un documento ya subido (renombrar, cambiar tipo, borrar) --
  // solo mientras la expedición está en borrador.
  actualizarDocumento: (id, data) => api.patch(`/api/v1/deca/documentos/${id}/`, data),
  borrarDocumento: (id) => api.delete(`/api/v1/deca/documentos/${id}/`),
  // Reintenta la extracción (regex + IA) sobre un documento ya subido, sin
  // tener que volver a subirlo.
  extraerDocumento: (id) => api.post(`/api/v1/deca/documentos/${id}/extraer/`),

  // Vista previa (borrador/confirmado): PDF con marca de agua, nunca se
  // persiste ni toca el hash/estado -- se puede pedir tantas veces como
  // haga falta mientras se corrige. Blob para abrir/descargar en el navegador.
  vistaPreviaExpedicion: (id) =>
    api.get(`/api/v1/deca/expediciones/${id}/vista-previa/`, { responseType: 'blob' }),

  // Transiciones de estado
  confirmarExpedicion: (id) => api.post(`/api/v1/deca/expediciones/${id}/confirmar/`),
  generarDeca: (id) => api.post(`/api/v1/deca/expediciones/${id}/generar/`),
  anularExpedicion: (id, motivo = '') => api.post(`/api/v1/deca/expediciones/${id}/anular/`, { motivo }),
  enviarEmailExpedicion: (id, { destinatario, asunto = '', cuerpo = '' }) =>
    api.post(`/api/v1/deca/expediciones/${id}/enviar-email/`, { destinatario, asunto, cuerpo }),

  // Cadena de transportistas sucesivos (subcontratación) -- solo editable
  // mientras la expedición está en borrador.
  listarTransportistasSucesivos: (expedicionId) =>
    api.get(`/api/v1/deca/expediciones/${expedicionId}/transportistas-sucesivos/`),
  crearTransportistaSucesivo: (expedicionId, data) =>
    api.post(`/api/v1/deca/expediciones/${expedicionId}/transportistas-sucesivos/`, data),
  actualizarTransportistaSucesivo: (id, data) =>
    api.patch(`/api/v1/deca/transportistas-sucesivos/${id}/`, data),
  borrarTransportistaSucesivo: (id) => api.delete(`/api/v1/deca/transportistas-sucesivos/${id}/`),

  // Auditoría (histórico append-only de una expedición)
  listarEventos: (expedicionId) => api.get(`/api/v1/deca/expediciones/${expedicionId}/eventos/`),

  // Descarga pública por QR -- endpoint sin login, aquí solo se construye la
  // URL (para el botón "copiar enlace"/mostrar QR), nunca se llama por axios.
  urlDescargaPublica: (tokenPublico) => {
    const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
    return `${base}/api/v1/deca/publico/${tokenPublico}/`
  },
}
