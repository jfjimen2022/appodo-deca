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
  buscarCargadores: (q = '') => api.get('/api/v1/deca/cargadores/', { params: { solo_activos: 'true', page_size: 500, ...(q ? { q } : {}) } }),
  buscarTractoras: (q = '') => api.get('/api/v1/deca/tractoras/', { params: { solo_activos: 'true', page_size: 500, ...(q ? { q } : {}) } }),
  buscarRemolques: (q = '') => api.get('/api/v1/deca/remolques/', { params: { solo_activos: 'true', page_size: 500, ...(q ? { q } : {}) } }),

  // CRUD de la Agenda (pantalla de gestión de los catálogos). `tipo` es uno
  // de: conductores | transportistas | destinatarios | cargadores | tractoras | remolques.
  listarCatalogo: (tipo, params = {}) => api.get(`/api/v1/deca/${tipo}/`, { params }),
  crearEnCatalogo: (tipo, data) => api.post(`/api/v1/deca/${tipo}/`, data),
  actualizarEnCatalogo: (tipo, id, data) => api.patch(`/api/v1/deca/${tipo}/${id}/`, data),
  borrarDeCatalogo: (tipo, id) => api.delete(`/api/v1/deca/${tipo}/${id}/`),

  // Modelos de documento (plantillas por emisor): se reconocen solos al
  // subir un documento y mejoran lo que se lee. `analizarEjemploPlantilla`
  // lee un ejemplo sin guardarlo, para dar de alta el modelo a partir de él.
  // Sinónimos aprendidos al corregir lecturas ("TTES ROMERO" = Transportes
  // Romero Ruiz S.L.) -- solo se listan y se olvidan; se crean solos.
  listarSinonimos: (params = {}) => api.get('/api/v1/deca/sinonimos/', { params }),
  borrarSinonimo: (id) => api.delete(`/api/v1/deca/sinonimos/${id}/`),
  precisionLectura: (params = {}) => api.get('/api/v1/deca/precision-lectura/', { params }),
  listarPlantillas: () => api.get('/api/v1/deca/plantillas/', { params: { page_size: 500 } }),
  crearPlantilla: (data) => api.post('/api/v1/deca/plantillas/', data),
  actualizarPlantilla: (id, data) => api.patch(`/api/v1/deca/plantillas/${id}/`, data),
  borrarPlantilla: (id) => api.delete(`/api/v1/deca/plantillas/${id}/`),
  analizarEjemploPlantilla: (archivo) => {
    const form = new FormData()
    form.append('archivo', archivo, archivo.name || 'ejemplo.jpg')
    return api.post('/api/v1/deca/plantillas/analizar/', form)
  },

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
  // transportistas | destinatarios | cargadores | tractoras | remolques.
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
    // El tercer argumento (nombre de archivo) es obligatorio aquí -- una foto
    // tomada con la cámara en iOS Safari (input capture="environment") puede
    // no llevar el nombre embebido de forma fiable al serializar el FormData,
    // y sin él el backend recibe la parte multipart SIN filename: Django la
    // trata como campo de texto normal en vez de fichero y `request.FILES`
    // llega vacío -- error real reproducido en producción, iPhone, 2026-09-25.
    form.append('archivo', archivo, archivo.name || 'documento.jpg')
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
  // Con lo que hay en pantalla, sin guardar nada (el servidor lo aplica solo
  // en memoria para pintar el PDF de vista previa).
  vistaPreviaConDatos: (id, datos) =>
    api.post(`/api/v1/deca/expediciones/${id}/vista-previa/`, datos, { responseType: 'blob' }),

  // Transiciones de estado
  confirmarExpedicion: (id) => api.post(`/api/v1/deca/expediciones/${id}/confirmar/`),
  generarDeca: (id) => api.post(`/api/v1/deca/expediciones/${id}/generar/`),
  anularExpedicion: (id, motivo = '') => api.post(`/api/v1/deca/expediciones/${id}/anular/`, { motivo }),
  // DeCA del talonario de papel, registrado con su foto (sin PDF ni QR).
  registrarPapel: (id) => api.post(`/api/v1/deca/expediciones/${id}/registrar-papel/`),
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

  // Informe de auditoría de UNA expedición (historial completo) -- distinto
  // de exportarExpedicionesPDF/Excel, que exportan el LISTADO de varias.
  exportarAuditoriaExpedicionPDF: (expedicionId) =>
    _descargarExportacion(`/api/v1/deca/expediciones/${expedicionId}/auditoria/exportar-pdf/`, {}, 'auditoria_deca', 'pdf'),
  exportarAuditoriaExpedicionExcel: (expedicionId) =>
    _descargarExportacion(`/api/v1/deca/expediciones/${expedicionId}/auditoria/exportar-excel/`, {}, 'auditoria_deca', 'xlsx'),

  // Descarga pública por QR -- endpoint sin login, aquí solo se construye la
  // URL (para el botón "copiar enlace"/mostrar QR), nunca se llama por axios.
  // SIEMPRE absoluta: va dentro de un QR que se escanea con otro móvil. En
  // producción VITE_API_URL está vacío (mismo dominio) y la URL salía como
  // "/api/v1/..." sin dominio -- el QR de pantalla no llevaba a ninguna parte
  // (detectado 2026-09-30; el QR del PDF lo pinta el servidor y sí iba bien).
  urlDescargaPublica: (tokenPublico) => {
    const base = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '')
    return `${base}/api/v1/deca/publico/${tokenPublico}/`
  },
}
