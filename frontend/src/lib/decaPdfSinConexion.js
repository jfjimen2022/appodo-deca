// PDF del DeCA hecho SIN COBERTURA, generado en el propio móvil (2026-10-14).
//
// Por qué existe: el botón "Imprimir" de DecaImprimibleSinConexion llama a
// window.print(), y hay móviles donde eso no hace NADA -- el iPhone con la app
// añadida a la pantalla de inicio y algunos Android con la app instalada. Sin
// impresora ni diálogo de impresión no había forma de sacar el papel (caso
// real en una finca, en modo avión). Este PDF se genera sin red y se comparte
// (WhatsApp, correo, Archivos) o se descarga: el transportista lo lleva en su
// móvil o le hace una foto.
//
// Mismo contenido que la hoja imprimible (un ejemplar por página). Usa las
// fuentes estándar de jsPDF (Helvetica, juego WinAnsi: acentos y ñ sí, flechas
// y emojis no).

import { jsPDF } from 'jspdf'

const MARGEN = 15
const ANCHO_PAGINA = 210

function fechaLegible(valor) {
  if (!valor) return ''
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return String(valor)
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function juntar(...partes) {
  return partes.filter((p) => p !== null && p !== undefined && p !== '').join(' · ')
}

/** Filas [etiqueta, valor] del DeCA; las vacías no salen (igual que en la hoja). */
export function filasDeca(datos, t) {
  const d = datos || {}
  const kg = (v) => (v != null && v !== '' ? `${v} kg` : '—')
  return [
    [t('offline.imp.cargador'), juntar(d.nombre_cargador, d.nif_cargador)],
    [t('offline.imp.domicilio_cargador'), d.domicilio_cargador],
    [t('offline.imp.transportista'), juntar(d.nombre_transportista, d.nif_transportista)],
    [t('offline.imp.destinatario'), juntar(d.nombre_destinatario, d.nif_destinatario)],
    [t('offline.imp.origen'), d.origen],
    [t('offline.imp.destino'), d.destino],
    [t('offline.imp.fecha'), fechaLegible(d.fecha_hora_transporte)],
    [t('offline.imp.tractora'), d.matricula_tractor],
    [t('offline.imp.remolque'), d.sin_remolque ? t('offline.imp.sin_remolque') : d.matricula_remolque],
    [t('offline.imp.mercancia'), d.naturaleza_mercancia],
    [t('offline.imp.peso'), `${kg(d.peso_kg)} · ${t('offline.imp.peso_bruto')}: ${kg(d.peso_bruto_kg)}`],
    [t('offline.imp.bultos'), d.bultos],
    [t('offline.imp.autorizacion'), d.autorizacion_especial],
    [t('offline.imp.sigpac'), [d.sigpac_poligono, d.sigpac_parcela, d.sigpac_recinto].some(Boolean)
      ? [d.sigpac_poligono, d.sigpac_parcela, d.sigpac_recinto].map((x) => x || '—').join(' / ') : ''],
    [t('offline.imp.conductor'), juntar(d.nombre_conductor, d.nif_conductor)],
    [t('offline.imp.albaran'), juntar(d.numero_albaran, d.numero_cmr)],
    [t('offline.imp.observaciones'), d.comentarios],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '')
}

/**
 * Genera el PDF y lo devuelve como Blob.
 * @param {object} p
 * @param {object} p.item          DeCA de la cola sin conexión ({referencia, datos, emitido_en, token_publico})
 * @param {string} p.empresaNombre
 * @param {string[]} p.copias      Rótulo de cada ejemplar ("Ejemplar del transportista"...)
 * @param {string|null} p.qrPng    QR como data URL PNG (o null si no hay)
 * @param {string|null} p.urlQr    Dirección que lleva el QR (se escribe debajo)
 * @param {Function} p.t           i18n (namespace deca)
 */
export function generarPdfSinConexion({ item, empresaNombre, copias, qrPng, urlQr, t }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const anchoUtil = ANCHO_PAGINA - 2 * MARGEN
  const filas = filasDeca(item.datos, t)

  copias.forEach((copia, i) => {
    if (i > 0) doc.addPage()
    let y = MARGEN

    // Cabecera: a la izquierda, uno debajo de otro, título, norma, ejemplar y
    // referencia; a la derecha, el QR. La altura es la de lo que ocupe más.
    const anchoTexto = anchoUtil - (qrPng ? 34 : 0)
    const y0 = y
    doc.setFont('helvetica', 'bold').setFontSize(15)
    const titulo = doc.splitTextToSize(t('offline.imp.titulo'), anchoTexto)
    doc.text(titulo, MARGEN, y + 5)
    y += 5 + (titulo.length - 1) * 6 + 5
    doc.setFont('helvetica', 'normal').setFontSize(9)
    const norma = doc.splitTextToSize(t('offline.imp.norma'), anchoTexto)
    doc.text(norma, MARGEN, y)
    y += norma.length * 4 + 3
    doc.setFont('helvetica', 'bold').setFontSize(10)
    const rotulo = doc.splitTextToSize(copia, anchoTexto)
    doc.text(rotulo, MARGEN, y)
    y += rotulo.length * 4.5
    doc.setFont('courier', 'bold').setFontSize(11)
    doc.text(item.referencia || '', MARGEN, y)
    if (qrPng) doc.addImage(qrPng, 'PNG', ANCHO_PAGINA - MARGEN - 30, y0, 30, 30)
    y = Math.max(y + 3, y0 + (qrPng ? 33 : 0))
    doc.setLineWidth(0.6).line(MARGEN, y, ANCHO_PAGINA - MARGEN, y)
    y += 4

    // Aviso de emisión sin conexión (recuadro).
    doc.setFont('helvetica', 'bold').setFontSize(10)
    const aviso = doc.splitTextToSize(
      t('offline.imp.emitido_sin_conexion', { fecha: fechaLegible(item.emitido_en), empresa: empresaNombre || '' }),
      anchoUtil - 4,
    )
    doc.setLineWidth(0.3).rect(MARGEN, y, anchoUtil, aviso.length * 4.5 + 3)
    doc.text(aviso, MARGEN + 2, y + 5)
    y += aviso.length * 4.5 + 6

    // Tabla de datos: etiqueta 38 %, valor el resto, con ajuste de línea.
    const anchoEtiqueta = anchoUtil * 0.38
    doc.setFontSize(10)
    for (const [etiqueta, valor] of filas) {
      doc.setFont('helvetica', 'bold')
      const lE = doc.splitTextToSize(String(etiqueta), anchoEtiqueta - 3)
      doc.setFont('helvetica', 'normal')
      const lV = doc.splitTextToSize(String(valor), anchoUtil - anchoEtiqueta - 3)
      const alto = Math.max(lE.length, lV.length) * 4.5 + 2.5
      doc.rect(MARGEN, y, anchoEtiqueta, alto)
      doc.rect(MARGEN + anchoEtiqueta, y, anchoUtil - anchoEtiqueta, alto)
      doc.setFont('helvetica', 'bold').text(lE, MARGEN + 1.5, y + 4.5)
      doc.setFont('helvetica', 'normal').text(lV, MARGEN + anchoEtiqueta + 1.5, y + 4.5)
      y += alto
    }
    y += 5

    // Firmas.
    const anchoFirma = (anchoUtil - 6) / 2
    doc.rect(MARGEN, y, anchoFirma, 28)
    doc.rect(MARGEN + anchoFirma + 6, y, anchoFirma, 28)
    doc.setFontSize(9).text(t('offline.imp.firma_cargador'), MARGEN + 1.5, y + 4.5)
    doc.text(t('offline.imp.firma_transportista'), MARGEN + anchoFirma + 7.5, y + 4.5)
    y += 33

    doc.setFontSize(8)
    if (urlQr) {
      const lineas = doc.splitTextToSize(`${t('offline.imp.qr_explicacion')} ${urlQr}`, anchoUtil)
      doc.text(lineas, MARGEN, y)
      y += lineas.length * 3.6 + 1
    }
    doc.text(doc.splitTextToSize(t('offline.imp.pie'), anchoUtil), MARGEN, y)
  })

  return doc.output('blob')
}

/** QR (SVG ya pintado en pantalla) -> PNG en data URL, sin red. */
export function svgAPng(svg, lado = 400) {
  return new Promise((resolve, reject) => {
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = lado
      canvas.height = lado
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, lado, lado)
      ctx.drawImage(img, 0, 0, lado, lado)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  })
}

/**
 * Comparte el PDF (menú del móvil: WhatsApp, correo, Archivos...) o, si el
 * navegador no sabe compartir ficheros, lo descarga. Devuelve 'compartido',
 * 'descargado' o 'cancelado'.
 */
export async function compartirODescargar(blob, nombre, titulo) {
  const fichero = new File([blob], nombre, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [fichero] })) {
    try {
      await navigator.share({ files: [fichero], title: titulo })
      return 'compartido'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelado'
      // Cualquier otro fallo al compartir: se descarga, que siempre funciona.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'descargado'
}
