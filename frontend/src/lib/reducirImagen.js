// Reduce una foto antes de subirla (lado mayor <= maxLado, JPEG).
//
// Por qué: las fotos de un iPhone reciente (24-48 MP) pesan 10-15 MB y chocan
// con el límite de 10 MB de las subidas -- y con datos móviles tardan una
// eternidad. Para leer un albarán o un CMR, 3000 px de lado sobran (bug real
// en producción, DeCA, 2026-09-26: la foto de 12 MB no llegaba a subirse).
//
// Nunca empeora las cosas: si el navegador no sabe decodificar el formato
// (HEIC fuera de Safari -- el servidor ya lo convierte), si falla algo, o si
// el resultado pesa más que el original, devuelve el fichero tal cual.
export async function reducirImagen(file, { maxLado = 3000, calidad = 0.85, umbralBytes = 4 * 1024 * 1024 } = {}) {
  const esImagen = /^image\/(jpeg|png)$/i.test(file.type) || /\.(jpe?g|png)$/i.test(file.name)
  if (!esImagen || typeof createImageBitmap !== 'function') return file

  let bitmap
  try {
    // 'from-image' aplica la orientación EXIF: la foto sale derecha y el
    // JPEG resultante ya no necesita EXIF para mostrarse bien.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file
  }
  try {
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
    if (escala === 1 && file.size <= umbralBytes) return file

    const ancho = Math.round(bitmap.width * escala)
    const alto = Math.round(bitmap.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = ancho
    canvas.height = alto
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#fff' // un PNG con transparencia no debe salir con fondo negro
    ctx.fillRect(0, 0, ancho, alto)
    ctx.drawImage(bitmap, 0, 0, ancho, alto)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad))
    if (!blob || blob.size >= file.size) return file
    const nombre = (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}
