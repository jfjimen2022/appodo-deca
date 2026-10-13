import { useEffect, useRef } from 'react'

/**
 * Refresca un listado solo, sin que el usuario pulse F5:
 *  - cada `intervaloMs` mientras la pestaña está visible (en segundo plano no
 *    pide nada: el VPS va justo y una pestaña olvidada no debe sumar carga);
 *  - al volver a la pestaña/ventana, si hace más de `minimoEntreRefrescosMs`.
 *
 * `pausado` congela el refresco mientras el usuario está a mitad de algo
 * (un diálogo abierto, una acción en curso) para no cambiarle la lista debajo.
 * Sin conexión tampoco se intenta: lo cubre useRetryOnReconnect/caché offline.
 *
 * `refrescar` debe ser silencioso (sin spinner ni reset de scroll) -- el hook
 * solo decide CUÁNDO, no cómo se pinta.
 */
export function useAutoRefresh(refrescar, { intervaloMs = 45000, pausado = false, minimoEntreRefrescosMs = 10000 } = {}) {
  const refrescarRef = useRef(refrescar)
  const pausadoRef = useRef(pausado)
  const ultimoRef = useRef(Date.now())

  useEffect(() => { refrescarRef.current = refrescar }, [refrescar])
  useEffect(() => { pausadoRef.current = pausado }, [pausado])

  useEffect(() => {
    const intentar = (forzarMinimo) => {
      if (pausadoRef.current) return
      if (document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (forzarMinimo && Date.now() - ultimoRef.current < minimoEntreRefrescosMs) return
      ultimoRef.current = Date.now()
      refrescarRef.current?.()
    }

    const id = setInterval(() => intentar(false), intervaloMs)
    // visibilitychange y focus suelen llegar juntos al volver: el mínimo
    // entre refrescos evita pedir dos veces lo mismo.
    const alVolver = () => intentar(true)
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [intervaloMs, minimoEntreRefrescosMs])
}
