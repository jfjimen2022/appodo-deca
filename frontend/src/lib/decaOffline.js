// DeCA SIN COBERTURA (2026-09-30): el responsable de finca da de alta el DeCA
// en el móvil sin red, lo imprime allí mismo (el documento tiene que viajar
// en el camión, Orden FOM/2861/2012 art. 3) y al volver la cobertura se
// registra solo en Appodo.
//
// Dos almacenes, con las reglas de CLAUDE.md para cachés sin conexión:
// - `cache`: lo que hace falta para rellenar sin red (obligatorios de la
//   empresa, agenda). Clave por EMPRESA y USUARIO, y se BORRA al cerrar
//   sesión (limpiarCacheDeca) -- nunca se sirve a otra empresa.
// - `cola`: los DeCA hechos sin cobertura. Cada uno guarda de qué empresa y
//   usuario es, solo se envía con esa misma sesión, y NUNCA se borra al
//   cerrar sesión: es un documento que ya viajó en un camión.

const DB_NAME = 'appodo_deca'
const ALMACENES = { cache: 'clave', cola: 'referencia' }

function abrirVersion(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      for (const [nombre, clave] of Object.entries(ALMACENES)) {
        if (!db.objectStoreNames.contains(nombre)) db.createObjectStore(nombre, { keyPath: clave })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // Otra pestaña (o este mismo código) necesita subir de versión: se cede.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    // Nunca quedarse colgado esperando a otra conexión.
    req.onblocked = () => reject(new Error('Base de datos del móvil ocupada por otra pestaña'))
  })
}

// Abre la base del móvil y, si le falta algún almacén (una base creada a
// medias, o por otra versión), la sube de versión para crearlo: si no, TODAS
// las escrituras fallarían en silencio para siempre y no habría ni agenda sin
// red ni cola. Nunca borra nada de lo que ya hay.
async function abrir() {
  const db = await abrirVersion()
  const faltan = Object.keys(ALMACENES).some((n) => !db.objectStoreNames.contains(n))
  if (!faltan) return db
  const siguiente = db.version + 1
  db.close()
  return abrirVersion(siguiente)
}

async function operacion(almacen, modo, fn) {
  const db = await abrir()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(almacen, modo)
    const req = fn(tx.objectStore(almacen))
    // Una conexión por operación, y se CIERRA al acabar: si se quedaban
    // abiertas, cualquier cambio de versión se bloqueaba para siempre.
    tx.oncomplete = () => { db.close(); resolve(req?.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

const claveCache = (empresaId, usuarioId) => `${empresaId}:${usuarioId}`

// ── ¿Hay red? ───────────────────────────────────────────────────────────────
// Un fallo de red (sin respuesta del servidor, o el 503 {offline:true} del
// Service Worker) es "sin cobertura". Un 401/403/400 es el servidor diciendo
// que no: NUNCA se trata como sin cobertura.
export function esErrorDeRed(err) {
  if (!err) return false
  if (err.response?.data?.offline === true) return true
  return !err.response
}

// ── Caché de lectura ────────────────────────────────────────────────────────
export async function guardarCacheDeca(empresaId, usuarioId, datos) {
  if (!empresaId || !usuarioId) return
  try {
    await operacion('cache', 'readwrite', (s) => s.put({ clave: claveCache(empresaId, usuarioId), datos, guardado: Date.now() }))
  } catch { /* sin IndexedDB (modo privado): simplemente no habrá datos sin red */ }
}

export async function leerCacheDeca(empresaId, usuarioId) {
  if (!empresaId || !usuarioId) return null
  try {
    const fila = await operacion('cache', 'readonly', (s) => s.get(claveCache(empresaId, usuarioId)))
    return fila?.datos || null
  } catch {
    return null
  }
}

export async function limpiarCacheDeca() {
  try { await operacion('cache', 'readwrite', (s) => s.clear()) } catch { /* nada que limpiar */ }
}

// ── Cola de DeCA hechos sin cobertura ───────────────────────────────────────
export function nuevaReferenciaOffline() {
  const tiempo = Date.now().toString(36).toUpperCase()
  const azar = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `OFF-${tiempo}-${azar}`
}

// Token del QR que se IMPRIME sin cobertura: lo genera el móvil (UUID v4) y
// el servidor lo adopta al registrar el DeCA, así el QR del papel lleva a su
// DeCA en Appodo en cuanto el móvil vuelve a tener red.
export function nuevoTokenQr() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export async function guardarEnCola(item) {
  await operacion('cola', 'readwrite', (s) => s.put(item))
  return item
}

export async function listarCola(empresaId, usuarioId) {
  try {
    const todos = await operacion('cola', 'readonly', (s) => s.getAll())
    return (todos || []).filter((i) => i.empresa_id === empresaId && i.usuario_id === usuarioId)
  } catch {
    return []
  }
}

export async function quitarDeCola(referencia) {
  await operacion('cola', 'readwrite', (s) => s.delete(referencia))
}

// Registra en Appodo los DeCA hechos sin cobertura de ESTA sesión. Para cada
// uno: crea la expedición con su referencia (idempotente en el servidor: un
// reintento no la duplica), sube sus fotos y, si está completa, la confirma
// y genera. Un fallo de red para el proceso (se reintenta luego); un error del
// servidor deja ese DeCA en la cola con el motivo, para verlo en pantalla.
//
// Se puede llamar desde varios sitios a la vez (Layout al volver la red, la
// lista de Expediciones): una sola sincronización en curso, las demás
// esperan a esa misma.
let sincronizando = null

export function sincronizarCola(opciones) {
  if (!sincronizando) {
    sincronizando = sincronizarColaUnaVez(opciones).finally(() => { sincronizando = null })
  }
  return sincronizando
}

// Si el servidor rechaza algún dato (un NIF que el papel trae mal, por
// ejemplo), se registra igualmente SIN ese dato, en borrador, con lo
// rechazado copiado en observaciones: así consta en Appodo, el aviso de "sin
// completar" lo recoge y nadie tiene que buscar el papel para saber qué ponía.
async function guardarEnServidor(item, servicio) {
  const datos = {
    ...item.datos,
    referencia_offline: item.referencia,
    emitido_sin_conexion_en: item.emitido_en,
    ...(item.token_publico && !item.expedicion_id ? { token_publico: item.token_publico } : {}),
  }
  // Borrador empezado con cobertura: se completa ése, no se crea otro.
  const enviar = (d) => (item.expedicion_id ? servicio.actualizarExpedicion(item.expedicion_id, d) : servicio.crearExpedicion(d))
  try {
    return await enviar(datos)
  } catch (err) {
    const rechazados = err.response?.status === 400 && err.response.data && typeof err.response.data === 'object'
      ? Object.keys(err.response.data).filter((c) => c in datos)
      : []
    // El código del QR ya está impreso en el papel: nunca se registra sin él.
    if (!rechazados.length || rechazados.includes('token_publico')) throw err
    const limpio = { ...datos }
    const nota = rechazados.map((c) => `${c}: ${datos[c]}`).join('; ')
    rechazados.forEach((c) => { delete limpio[c] })
    limpio.comentarios = [datos.comentarios, `Rechazado al registrar el DeCA sin cobertura (${nota})`].filter(Boolean).join('\n')
    return enviar(limpio)
  }
}

async function sincronizarColaUnaVez({ empresaId, usuarioId, servicio }) {
  const resultado = { registrados: 0, por_completar: 0, con_error: 0, sin_red: false }
  const pendientes = await listarCola(empresaId, usuarioId)
  for (const item of pendientes) {
    try {
      const { data: expedicion } = await guardarEnServidor(item, servicio)
      // Lo ya enviado se apunta en la cola: si la red se corta a mitad, el
      // reintento completa esa misma expedición y no repite fotos.
      let enCola = { ...item, expedicion_id: expedicion.id }
      await guardarEnCola(enCola)
      for (const foto of item.fotos || []) {
        const archivo = new File([foto.blob], foto.nombre, { type: foto.tipo })
        try {
          await servicio.subirDocumento(expedicion.id, archivo, 'otro', { extraer: false })
        } catch (err) {
          if (esErrorDeRed(err)) throw err
        }
        enCola = { ...enCola, fotos: enCola.fotos.filter((f) => f !== foto) }
        await guardarEnCola(enCola)
      }
      let generado = expedicion.estado === 'generado'
      if (!generado) {
        try {
          if (expedicion.estado === 'borrador') await servicio.confirmarExpedicion(expedicion.id)
          await servicio.generarDeca(expedicion.id)
          generado = true
        } catch (err) {
          if (esErrorDeRed(err)) throw err
          // Le falta algún dato: queda en borrador en Appodo para completarlo.
        }
      }
      await quitarDeCola(item.referencia)
      if (generado) resultado.registrados += 1
      else resultado.por_completar += 1
    } catch (err) {
      if (esErrorDeRed(err)) { resultado.sin_red = true; break }
      resultado.con_error += 1
      await guardarEnCola({ ...item, error: err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : String(err) })
    }
  }
  return resultado
}

// ── Preparación automática y registro en segundo plano (2026-09-30) ─────────
// Dos olvidos que no dependen de la persona:
// 1) "Hay que abrir el DeCA con red antes de salir": el Layout prepara la
//    agenda y la configuración al iniciar sesión, en cualquier pantalla.
// 2) "Al volver la red no abre la app": el móvil pide al navegador un aviso
//    de conexión (Background Sync) y el service worker registra la cola con
//    la app CERRADA (Android/Chrome; iPhone no lo soporta).

const CLAVE_SESION = '__sesion__'

// Quién es la sesión de este navegador, para que el service worker solo
// envíe la cola de ESTE usuario y empresa. Vive en `cache`: se borra al
// cerrar sesión, y sin sesión el service worker no envía nada.
export async function guardarSesionDeca(empresaId, usuarioId) {
  if (!empresaId || !usuarioId) return
  try {
    await operacion('cache', 'readwrite', (s) => s.put({ clave: CLAVE_SESION, datos: { empresaId, usuarioId } }))
  } catch { /* sin IndexedDB */ }
}

async function leerSesionDeca() {
  try {
    const fila = await operacion('cache', 'readonly', (s) => s.get(CLAVE_SESION))
    return fila?.datos || null
  } catch {
    return null
  }
}

// Cuándo se guardó por última vez la agenda/configuración en este móvil
// (null = nunca: sin red no se podría rellenar con la agenda).
export async function fechaPreparacionDeca(empresaId, usuarioId) {
  if (!empresaId || !usuarioId) return null
  try {
    const fila = await operacion('cache', 'readonly', (s) => s.get(claveCache(empresaId, usuarioId)))
    return fila?.guardado || null
  } catch {
    return null
  }
}

// Descarga configuración + agenda y la deja en el móvil. Solo guarda si TODO
// llegó bien (una agenda a medias es peor que la anterior completa).
export async function prepararDecaSinConexion({ empresaId, usuarioId, servicio }) {
  const lista = (r) => r.data.results || r.data
  const partes = {
    configuracion: () => servicio.obtenerConfiguracion().then((r) => r.data),
    conductores: () => servicio.buscarConductores().then(lista),
    transportistas: () => servicio.buscarTransportistas().then(lista),
    destinatarios: () => servicio.buscarDestinatarios().then(lista),
    cargadores: () => servicio.buscarCargadores().then(lista),
    tractoras: () => servicio.buscarTractoras().then(lista),
    remolques: () => servicio.buscarRemolques().then(lista),
  }
  // En paralelo: cuanto antes quede guardado, menos riesgo de que el
  // trabajador se quede sin red justo después de iniciar sesión.
  const claves = Object.keys(partes)
  const valores = await Promise.all(claves.map((c) => partes[c]()))
  const datos = Object.fromEntries(claves.map((c, i) => [c, valores[i]]))
  await guardarCacheDeca(empresaId, usuarioId, datos)
  return datos
}

// Pide al navegador que avise al service worker cuando haya red, aunque la
// app esté cerrada. Donde no existe (iPhone, Firefox) no pasa nada: se
// registra al abrir la app con red, como antes.
export async function pedirSincronizacionEnSegundoPlano() {
  try {
    const reg = await navigator.serviceWorker?.ready
    await reg?.sync?.register('sync-deca')
  } catch { /* sin Background Sync */ }
}

// Con la app instalada (Android/Chrome), además, una comprobación periódica:
// registra lo pendiente y refresca la agenda aunque nadie abra la app.
export async function pedirComprobacionPeriodica() {
  try {
    const reg = await navigator.serviceWorker?.ready
    if (!reg?.periodicSync) return
    const permiso = await navigator.permissions?.query({ name: 'periodic-background-sync' })
    if (permiso && permiso.state !== 'granted') return
    await reg.periodicSync.register('deca-periodico', { minInterval: 6 * 60 * 60 * 1000 })
  } catch { /* no soportado */ }
}

// ── Servicio con fetch para el service worker (no hay axios allí) ───────────
// Mismas llamadas que decaService, con las cookies de sesión del propio
// dominio. Los errores imitan a axios ({ response: { status, data } }) para
// que sincronizarCola los trate igual; un fallo de red lanza sin `response`.
export function servicioFetch(base) {
  let refrescado = false
  async function llamar(metodo, ruta, cuerpo) {
    const opciones = { method: metodo, credentials: 'include', headers: {} }
    if (cuerpo instanceof FormData) opciones.body = cuerpo
    else if (cuerpo !== undefined) {
      opciones.headers['Content-Type'] = 'application/json'
      opciones.body = JSON.stringify(cuerpo)
    }
    let res = await fetch(`${base}${ruta}`, opciones)
    // Acceso caducado (dura 60 min): se renueva una vez con la cookie de
    // refresco (7 días), igual que hace el interceptor de axios.
    if (res.status === 401 && !refrescado) {
      refrescado = true
      const r = await fetch(`${base}/api/v1/auth/token/refresh/`, { method: 'POST', credentials: 'include' })
      if (r.ok) res = await fetch(`${base}${ruta}`, opciones)
    }
    let data = null
    try { data = await res.json() } catch { /* sin cuerpo */ }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { response: { status: res.status, data } })
    return { data }
  }
  const api = '/api/v1/deca'
  return {
    yo: () => llamar('GET', '/api/v1/auth/me/'),
    crearExpedicion: (d) => llamar('POST', `${api}/expediciones/`, d),
    actualizarExpedicion: (id, d) => llamar('PATCH', `${api}/expediciones/${id}/`, d),
    confirmarExpedicion: (id) => llamar('POST', `${api}/expediciones/${id}/confirmar/`),
    generarDeca: (id) => llamar('POST', `${api}/expediciones/${id}/generar/`),
    subirDocumento: (id, archivo, tipo) => {
      const f = new FormData()
      f.append('archivo', archivo, archivo.name || 'documento.jpg') // sin nombre, Django no lo ve como fichero
      f.append('tipo_documento', tipo)
      return llamar('POST', `${api}/expediciones/${id}/documentos/`, f)
    },
    obtenerConfiguracion: () => llamar('GET', `${api}/configuracion/`),
    buscarConductores: () => llamar('GET', `${api}/conductores/?solo_activos=true&page_size=500`),
    buscarTransportistas: () => llamar('GET', `${api}/transportistas/?solo_activos=true&page_size=500`),
    buscarDestinatarios: () => llamar('GET', `${api}/destinatarios/?solo_activos=true&page_size=500`),
    buscarCargadores: () => llamar('GET', `${api}/cargadores/?solo_activos=true&page_size=500`),
    buscarTractoras: () => llamar('GET', `${api}/tractoras/?solo_activos=true&page_size=500`),
    buscarRemolques: () => llamar('GET', `${api}/remolques/?solo_activos=true&page_size=500`),
  }
}

// Lo que hace el service worker al recibir el aviso de conexión con la app
// cerrada. Fail-closed: sin sesión guardada, o si la sesión de las cookies
// es de OTRO usuario, no envía nada (la cola espera al siguiente inicio de
// sesión de su dueño).
export async function sincronizarDesdeServiceWorker({ base, refrescarAgenda = false }) {
  const sesion = await leerSesionDeca()
  if (!sesion) return null
  const servicio = servicioFetch(base)
  let yo
  try {
    yo = (await servicio.yo()).data
  } catch {
    return null
  }
  const empresaSesion = yo?.empresa && typeof yo.empresa === 'object' ? yo.empresa.id : yo?.empresa
  if (String(yo?.id) !== String(sesion.usuarioId)) return null
  if (empresaSesion != null && String(empresaSesion) !== String(sesion.empresaId)) return null

  const resultado = await sincronizarCola({ empresaId: sesion.empresaId, usuarioId: sesion.usuarioId, servicio })
  if (refrescarAgenda) {
    await prepararDecaSinConexion({ empresaId: sesion.empresaId, usuarioId: sesion.usuarioId, servicio }).catch(() => {})
  }
  return resultado
}
