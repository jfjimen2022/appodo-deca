import { describe, it, expect } from 'vitest'
import { filasDeca, generarPdfSinConexion } from './decaPdfSinConexion'

const t = (clave, vars) => (vars ? `${clave} ${JSON.stringify(vars)}` : clave)

const ITEM = {
  referencia: 'OFF-ABC-1234',
  emitido_en: '2026-09-30T06:15:00.000Z',
  datos: {
    nombre_cargador: 'Cargas del Sur S.L.', nif_cargador: 'B12345674', domicilio_cargador: 'Calle Mayor 1, Almería',
    nombre_transportista: 'Transportes Martín S.L.', nif_transportista: 'B87654321',
    origen: 'Finca Los Llanos', destino: 'Almacén Norte', fecha_hora_transporte: '2026-09-30T06:00:00Z',
    matricula_tractor: '1234BCD', sin_remolque: true, naturaleza_mercancia: 'Aguacate Hass en cajas de 4 kg',
    peso_kg: '18000', peso_bruto_kg: '', bultos: 30, comentarios: '',
  },
}

// jsdom no implementa Blob.arrayBuffer(): se lee con FileReader.
function textoDe(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new TextDecoder('latin1').decode(r.result))
    r.onerror = reject
    r.readAsArrayBuffer(blob)
  })
}

describe('decaPdfSinConexion', () => {
  it('las filas son las de la hoja impresa y las vacías no salen', () => {
    const filas = Object.fromEntries(filasDeca(ITEM.datos, t))
    expect(filas['offline.imp.cargador']).toBe('Cargas del Sur S.L. · B12345674')
    expect(filas['offline.imp.remolque']).toBe('offline.imp.sin_remolque')
    expect(filas['offline.imp.peso']).toBe('18000 kg · offline.imp.peso_bruto: —')
    expect(filas).not.toHaveProperty('offline.imp.observaciones')
    expect(filas).not.toHaveProperty('offline.imp.destinatario')
    expect(filas).not.toHaveProperty('offline.imp.sigpac')
  })

  it('SIGPAC en una fila, con raya en lo que falte', () => {
    const filas = Object.fromEntries(filasDeca({ ...ITEM.datos, sigpac_poligono: '12', sigpac_recinto: '3' }, t))
    expect(filas['offline.imp.sigpac']).toBe('12 / — / 3')
  })

  it('un ejemplar por página, con la referencia y los datos legibles', async () => {
    const blob = generarPdfSinConexion({
      item: ITEM, empresaNombre: 'Fábrica Ejemplo', copias: ['Ejemplar transportista', 'Ejemplar cargador'],
      qrPng: null, urlQr: 'https://deca.ejemplo/api/v1/deca/publico/xyz/', t,
    })
    expect(blob.type).toBe('application/pdf')
    const pdf = await textoDe(blob)
    expect(pdf.startsWith('%PDF')).toBe(true)
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2)
    expect(pdf).toContain('OFF-ABC-1234')
    expect(pdf).toContain('Ejemplar cargador')
    expect(pdf).toContain('1234BCD')
    expect(pdf).toContain('Almer\xeda') // acento en WinAnsi, sin caracteres raros
  })
})
