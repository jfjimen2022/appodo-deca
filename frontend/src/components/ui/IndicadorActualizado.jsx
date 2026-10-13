import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

/**
 * "Actualizado hace 20 s" + botón de refrescar a mano. Acompaña a
 * useAutoRefresh para que el usuario sepa si lo que ve está al día.
 */
export default function IndicadorActualizado({ fecha, onRefrescar, refrescando = false }) {
  const { t } = useTranslation('common')
  const [, setTick] = useState(0)

  // Re-render periódico solo para que el "hace X" avance.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10000)
    return () => clearInterval(id)
  }, [])

  let texto = ''
  if (fecha) {
    const seg = Math.max(0, Math.round((Date.now() - fecha.getTime()) / 1000))
    if (seg < 10) texto = t('common.actualizado_ahora')
    else if (seg < 60) texto = t('common.actualizado_hace_segundos', { count: seg })
    else texto = t('common.actualizado_hace_minutos', { count: Math.floor(seg / 60) })
  }

  return (
    <div className="flex items-center gap-1 text-xs text-gray-500">
      {/* Sin aria-live a propósito: cambia cada 10 s y un lector de pantalla lo anunciaría sin parar. */}
      {texto && <span>{texto}</span>}
      <button
        type="button"
        onClick={onRefrescar}
        disabled={refrescando}
        aria-label={t('common.refrescar')}
        title={t('common.refrescar')}
        className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${refrescando ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )
}
