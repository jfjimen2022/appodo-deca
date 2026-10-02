// ¿Está la foto de un albarán movida o quemada por un reflejo? Se comprueba en
// el propio móvil ANTES de subirla (fase 3 del aprendizaje de DeCA,
// 2026-09-28): repetir la foto en el muelle cuesta un segundo; descubrir
// después que la IA no pudo leerla cuesta cuota de IA y otra vuelta.
//
// Solo AVISA: el trabajador siempre puede "Usar igualmente". Los umbrales son
// conservadores a propósito (mejor dejar pasar una foto regular que frenar
// una buena) y se deberían ajustar con fotos reales de clientes.

// Varianza del laplaciano por debajo de la cual la imagen está tan movida o
// desenfocada que el texto no se distingue (medida sobre la foto reducida a
// ANCHO_ANALISIS px de ancho, en escala de grises 0-255).
export const UMBRAL_NITIDEZ = 25
// Parte de la imagen completamente blanca (quemada): un reflejo de sol sobre
// el papel o el plástico de la funda. El papel normal en una foto no llega a
// 255 salvo en esas manchas.
export const UMBRAL_QUEMADO = 0.12
// Por encima de esto no es un reflejo sino un documento DIGITAL (captura de
// pantalla, albarán exportado a JPG): fondo blanco puro en casi toda la
// imagen. Un reflejo es una mancha, no el documento entero.
export const MAXIMO_QUEMADO_REFLEJO = 0.6
const VALOR_QUEMADO = 252
const ANCHO_ANALISIS = 480

// `gris`: array de luminancias 0-255, fila a fila.
export function nitidez(gris, ancho, alto) {
  if (ancho < 3 || alto < 3) return Infinity
  let suma = 0
  let sumaCuadrados = 0
  let n = 0
  for (let y = 1; y < alto - 1; y += 1) {
    for (let x = 1; x < ancho - 1; x += 1) {
      const i = y * ancho + x
      const lap = gris[i - ancho] + gris[i + ancho] + gris[i - 1] + gris[i + 1] - 4 * gris[i]
      suma += lap
      sumaCuadrados += lap * lap
      n += 1
    }
  }
  const media = suma / n
  return sumaCuadrados / n - media * media
}

export function proporcionQuemada(gris) {
  if (!gris.length) return 0
  let quemados = 0
  for (let i = 0; i < gris.length; i += 1) if (gris[i] >= VALOR_QUEMADO) quemados += 1
  return quemados / gris.length
}

export function evaluar(gris, ancho, alto) {
  const valorNitidez = nitidez(gris, ancho, alto)
  const quemado = proporcionQuemada(gris)
  return {
    movida: valorNitidez < UMBRAL_NITIDEZ,
    reflejos: quemado > UMBRAL_QUEMADO && quemado < MAXIMO_QUEMADO_REFLEJO,
    nitidez: valorNitidez,
    quemado,
  }
}

// Analiza un File de imagen. Devuelve null si no se puede (no es una imagen,
// el navegador no la decodifica, falta canvas...): en ese caso no se avisa de
// nada y la foto se sube tal cual.
export async function analizarFoto(file) {
  const esImagen = /^image\//i.test(file?.type || '') || /\.(jpe?g|png)$/i.test(file?.name || '')
  if (!esImagen || typeof createImageBitmap !== 'function') return null
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const escala = Math.min(1, ANCHO_ANALISIS / bitmap.width)
    const ancho = Math.max(3, Math.round(bitmap.width * escala))
    const alto = Math.max(3, Math.round(bitmap.height * escala))
    const canvas = document.createElement('canvas')
    canvas.width = ancho
    canvas.height = alto
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, ancho, alto)
    const { data } = ctx.getImageData(0, 0, ancho, alto)
    const gris = new Uint8ClampedArray(ancho * alto)
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gris[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    return evaluar(gris, ancho, alto)
  } catch {
    return null
  } finally {
    bitmap?.close?.()
  }
}
