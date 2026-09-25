// TODO(standalone): en el ERP origen esto llamaba a un endpoint genérico del
// backend (/api/v1/busquedas-guardadas/) compartido por toda la app, que no
// existe en este backend standalone (solo expone /api/v1/deca/...). En vez
// de eliminar la funcionalidad de "Favoritos" de SmartSearch (columna del
// desplegable de filtros), se sustituye por una versión igual de útil pero
// 100% local (localStorage, por pantalla) -- si más adelante se añade un
// endpoint real al backend, esto se puede volver a apuntar ahí sin tocar
// SmartSearch.jsx en absoluto (mismo contrato: listar/crear/eliminar).
const LS_PREFIX = 'deca_busquedas_guardadas_'

function leer(pagina) {
  try {
    return JSON.parse(localStorage.getItem(LS_PREFIX + pagina) || '[]')
  } catch {
    return []
  }
}

function escribir(pagina, lista) {
  try {
    localStorage.setItem(LS_PREFIX + pagina, JSON.stringify(lista))
  } catch { /* localStorage lleno o inaccesible: no es crítico */ }
}

export const busquedasGuardadasService = {
  listar: (pagina) => Promise.resolve({ data: leer(pagina) }),
  crear: (pagina, nombre, filtros) => {
    const lista = leer(pagina)
    const nueva = { id: Date.now(), pagina, nombre, filtros, es_defecto: false }
    lista.push(nueva)
    escribir(pagina, lista)
    return Promise.resolve({ data: nueva })
  },
  eliminar: (id) => {
    // Sin `pagina` no sabemos en qué lista está -- se busca en todas las
    // claves de localStorage que usa este servicio.
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key?.startsWith(LS_PREFIX)) continue
      const pagina = key.slice(LS_PREFIX.length)
      const lista = leer(pagina).filter((f) => f.id !== id)
      escribir(pagina, lista)
    }
    return Promise.resolve()
  },
}
