// Hook para elegir entre la variante de escritorio y la de móvil de una
// pantalla (p. ej. el alta de DeCA), escuchando el cambio de tamaño.
import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

/** true por debajo del breakpoint `md` de Tailwind (768px). */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
