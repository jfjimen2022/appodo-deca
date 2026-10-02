import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  esErrorDeRed, guardarCacheDeca, leerCacheDeca, limpiarCacheDeca,
  guardarEnCola, listarCola, sincronizarCola, nuevaReferenciaOffline, nuevoTokenQr,
  guardarSesionDeca, sincronizarDesdeServiceWorker, servicioFetch, prepararDecaSinConexion, fechaPreparacionDeca,
} from './decaOffline'

const item = (referencia, extra = {}) => ({
  referencia, empresa_id: 1, usuario_id: 7, expedicion_id: null,
  emitido_en: '2026-09-30T06:15:00.000Z', datos: { destino: 'Sevilla' }, fotos: [], ...extra,
})

async function vaciarCola() {
  for (const i of [...await listarCola(1, 7), ...await listarCola(2, 7)]) {
    const { quitarDeCola } = await import('./decaOffline')
    await quitarDeCola(i.referencia)
  }
}

describe('decaOffline', () => {
  beforeEach(async () => {
    await limpiarCacheDeca()
    await vaciarCola()
  })

  it('solo un fallo de red cuenta como sin cobertura, nunca un 403', () => {
    expect(esErrorDeRed(new Error('Network Error'))).toBe(true)
    expect(esErrorDeRed({ response: { status: 503, data: { offline: true } } })).toBe(true)
    expect(esErrorDeRed({ response: { status: 403, data: {} } })).toBe(false)
    expect(esErrorDeRed({ response: { status: 400, data: { nif_cargador: ['x'] } } })).toBe(false)
  })

  it('la caché va por empresa y usuario, y se borra al cerrar sesión', async () => {
    await guardarCacheDeca(1, 7, { cargadores: [{ nif: 'B12345674' }] })
    expect(await leerCacheDeca(1, 7)).toEqual({ cargadores: [{ nif: 'B12345674' }] })
    expect(await leerCacheDeca(2, 7)).toBeNull()
    await limpiarCacheDeca()
    expect(await leerCacheDeca(1, 7)).toBeNull()
  })

  it('la cola no se borra al limpiar la caché y solo muestra la de su sesión', async () => {
    await guardarEnCola(item('OFF-A'))
    await guardarEnCola(item('OFF-B', { empresa_id: 2 }))
    await limpiarCacheDeca()
    expect((await listarCola(1, 7)).map((i) => i.referencia)).toEqual(['OFF-A'])
  })

  it('registra con su referencia y fecha, genera y lo quita de la cola', async () => {
    await guardarEnCola(item('OFF-C'))
    const servicio = {
      crearExpedicion: vi.fn().mockResolvedValue({ data: { id: 'x1', estado: 'borrador' } }),
      subirDocumento: vi.fn(),
      confirmarExpedicion: vi.fn().mockResolvedValue({}),
      generarDeca: vi.fn().mockResolvedValue({}),
    }
    const r = await sincronizarCola({ empresaId: 1, usuarioId: 7, servicio })
    expect(servicio.crearExpedicion).toHaveBeenCalledWith(expect.objectContaining({
      destino: 'Sevilla', referencia_offline: 'OFF-C', emitido_sin_conexion_en: '2026-09-30T06:15:00.000Z',
    }))
    expect(servicio.generarDeca).toHaveBeenCalledWith('x1')
    expect(r.registrados).toBe(1)
    expect(await listarCola(1, 7)).toEqual([])
  })

  it('un borrador empezado con cobertura se completa, no se duplica', async () => {
    await guardarEnCola(item('OFF-D', { expedicion_id: 'b9' }))
    const servicio = {
      crearExpedicion: vi.fn(),
      actualizarExpedicion: vi.fn().mockResolvedValue({ data: { id: 'b9', estado: 'borrador' } }),
      subirDocumento: vi.fn(),
      confirmarExpedicion: vi.fn().mockResolvedValue({}),
      generarDeca: vi.fn().mockResolvedValue({}),
    }
    await sincronizarCola({ empresaId: 1, usuarioId: 7, servicio })
    expect(servicio.crearExpedicion).not.toHaveBeenCalled()
    expect(servicio.actualizarExpedicion).toHaveBeenCalledWith('b9', expect.objectContaining({ referencia_offline: 'OFF-D' }))
  })

  it('sin red se para y deja todo en la cola', async () => {
    await guardarEnCola(item('OFF-E'))
    const servicio = { crearExpedicion: vi.fn().mockRejectedValue(new Error('Network Error')) }
    const r = await sincronizarCola({ empresaId: 1, usuarioId: 7, servicio })
    expect(r.sin_red).toBe(true)
    expect((await listarCola(1, 7)).map((i) => i.referencia)).toEqual(['OFF-E'])
  })

  it('si le falta un dato queda en borrador en Appodo y sale de la cola', async () => {
    await guardarEnCola(item('OFF-F'))
    const servicio = {
      crearExpedicion: vi.fn().mockResolvedValue({ data: { id: 'x2', estado: 'borrador' } }),
      confirmarExpedicion: vi.fn().mockRejectedValue({ response: { status: 400, data: { campos_faltantes: ['bultos'] } } }),
      generarDeca: vi.fn(),
    }
    const r = await sincronizarCola({ empresaId: 1, usuarioId: 7, servicio })
    expect(r.por_completar).toBe(1)
    expect(await listarCola(1, 7)).toEqual([])
  })

  it('un error del servidor lo deja en la cola con el motivo', async () => {
    await guardarEnCola(item('OFF-G'))
    const servicio = { crearExpedicion: vi.fn().mockRejectedValue({ response: { status: 400, data: { nif_cargador: ['no válido'] } } }) }
    const r = await sincronizarCola({ empresaId: 1, usuarioId: 7, servicio })
    expect(r.con_error).toBe(1)
    const [pendiente] = await listarCola(1, 7)
    expect(pendiente.error).toContain('no válido')
  })

  it('si el servidor rechaza un dato, se registra sin él y lo deja en observaciones', async () => {
    await guardarEnCola(item('OFF-H', { datos: { destino: 'Sevilla', nif_cargador: 'B00000001' } }))
    const crearExpedicion = vi.fn()
      .mockRejectedValueOnce({ response: { status: 400, data: { nif_cargador: ['no válido'] } } })
      .mockResolvedValueOnce({ data: { id: 'x3', estado: 'borrador' } })
    const servicio = {
      crearExpedicion,
      confirmarExpedicion: vi.fn().mockRejectedValue({ response: { status: 400, data: { campos_faltantes: ['nif_cargador'] } } }),
      generarDeca: vi.fn(),
    }
    const r = await sincronizarCola({ empresaId: 1, usuarioId: 7, servicio })
    const segundo = crearExpedicion.mock.calls[1][0]
    expect(segundo.nif_cargador).toBeUndefined()
    expect(segundo.comentarios).toContain('nif_cargador: B00000001')
    expect(r.por_completar).toBe(1)
    expect(await listarCola(1, 7)).toEqual([])
  })

  it('si la red se corta a mitad, el reintento completa la misma expedición', async () => {
    await guardarEnCola(item('OFF-I', { fotos: [{ blob: new Blob(['x']), nombre: 'a.jpg', tipo: 'image/jpeg' }] }))
    const servicio = {
      crearExpedicion: vi.fn().mockResolvedValue({ data: { id: 'x4', estado: 'borrador' } }),
      subirDocumento: vi.fn().mockResolvedValue({}),
      confirmarExpedicion: vi.fn().mockRejectedValue(new Error('Network Error')),
    }
    await sincronizarCola({ empresaId: 1, usuarioId: 7, servicio })
    const [pendiente] = await listarCola(1, 7)
    expect(pendiente.expedicion_id).toBe('x4')
    expect(pendiente.fotos).toEqual([])
  })

  it('manda el código del QR impreso al crear, y nunca lo quita al reintentar', async () => {
    await guardarEnCola(item('OFF-J', { token_publico: 'tok-1' }))
    const crearExpedicion = vi.fn().mockRejectedValue({ response: { status: 400, data: { token_publico: ['repetido'] } } })
    const r = await sincronizarCola({ empresaId: 1, usuarioId: 7, servicio: { crearExpedicion } })
    expect(crearExpedicion).toHaveBeenCalledTimes(1)
    expect(crearExpedicion.mock.calls[0][0].token_publico).toBe('tok-1')
    expect(r.con_error).toBe(1)
  })

  it('el código del QR es un UUID v4', () => {
    expect(nuevoTokenQr()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('las referencias empiezan por OFF- y no se repiten', () => {
    const a = nuevaReferenciaOffline()
    expect(a).toMatch(/^OFF-/)
    expect(a).not.toBe(nuevaReferenciaOffline())
  })

  describe('registro con la app cerrada (service worker)', () => {
    const respuesta = (status, data) => ({ ok: status < 400, status, json: async () => data })

    it('sin sesión guardada no envía nada (fail-closed)', async () => {
      await guardarEnCola(item('OFF-SW1'))
      global.fetch = vi.fn()
      expect(await sincronizarDesdeServiceWorker({ base: 'https://x' })).toBeNull()
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('si la sesión de las cookies es de otro usuario, no envía su cola', async () => {
      await guardarSesionDeca(1, 7)
      await guardarEnCola(item('OFF-SW2'))
      global.fetch = vi.fn().mockResolvedValue(respuesta(200, { id: 99, empresa: 1 }))
      expect(await sincronizarDesdeServiceWorker({ base: 'https://x' })).toBeNull()
      expect(global.fetch).toHaveBeenCalledTimes(1) // solo /auth/me/
      expect((await listarCola(1, 7)).map((i) => i.referencia)).toEqual(['OFF-SW2'])
    })

    it('con la sesión de su dueño registra la cola', async () => {
      await guardarSesionDeca(1, 7)
      await guardarEnCola(item('OFF-SW3'))
      global.fetch = vi.fn(async (url) => {
        if (url.endsWith('/auth/me/')) return respuesta(200, { id: 7, empresa: 1 })
        if (url.endsWith('/expediciones/')) return respuesta(201, { id: 'e1', estado: 'borrador' })
        return respuesta(200, { id: 'e1', estado: 'generado' })
      })
      const r = await sincronizarDesdeServiceWorker({ base: 'https://x' })
      expect(r.registrados).toBe(1)
      expect(await listarCola(1, 7)).toEqual([])
    })

    it('limpiar la caché al cerrar sesión borra también la sesión guardada', async () => {
      await guardarSesionDeca(1, 7)
      await limpiarCacheDeca()
      global.fetch = vi.fn()
      expect(await sincronizarDesdeServiceWorker({ base: 'https://x' })).toBeNull()
    })

    it('con el acceso caducado renueva la sesión una vez y reintenta', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(respuesta(401, {}))
        .mockResolvedValueOnce(respuesta(200, {}))
        .mockResolvedValueOnce(respuesta(200, { id: 7 }))
      const { data } = await servicioFetch('https://x').yo()
      expect(data.id).toBe(7)
      expect(global.fetch.mock.calls[1][0]).toBe('https://x/api/v1/auth/token/refresh/')
    })
  })

  it('preparar el DeCA deja la agenda en el móvil y apunta cuándo', async () => {
    const r = (data) => Promise.resolve({ data })
    const servicio = {
      obtenerConfiguracion: () => r({ modo_sin_cobertura: 'imprimir' }),
      buscarConductores: () => r([]), buscarTransportistas: () => r([{ nif: 'A91234567' }]),
      buscarDestinatarios: () => r([]), buscarCargadores: () => r([]),
      buscarTractoras: () => r([]), buscarRemolques: () => r([]),
    }
    expect(await fechaPreparacionDeca(1, 7)).toBeNull()
    await prepararDecaSinConexion({ empresaId: 1, usuarioId: 7, servicio })
    expect((await leerCacheDeca(1, 7)).transportistas).toEqual([{ nif: 'A91234567' }])
    expect(await fechaPreparacionDeca(1, 7)).toBeGreaterThan(0)
  })
})

describe('base de datos del móvil a medias', () => {
  it('si existe sin sus almacenes, los crea y funciona', async () => {
    await new Promise((res) => { const r = indexedDB.deleteDatabase('appodo_deca'); r.onsuccess = res; r.onerror = res; r.onblocked = res })
    await new Promise((res) => { const r = indexedDB.open('appodo_deca', 3); r.onsuccess = () => { r.result.close(); res() } })
    await guardarCacheDeca(1, 7, { x: 1 })
    expect(await leerCacheDeca(1, 7)).toEqual({ x: 1 })
    await guardarEnCola(item('OFF-MEDIAS'))
    expect((await listarCola(1, 7)).map((i) => i.referencia)).toContain('OFF-MEDIAS')
  })
})
