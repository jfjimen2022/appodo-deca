import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Serie de numeración de un DeCA (2026-10-15). Por defecto se usa la serie
// marcada en Configuración sin que el usuario haga nada; la casilla «Elegir
// serie» abre el desplegable con las demás. Con una sola serie activa no hay
// nada que elegir y no se pinta. `series` llega con la configuración (que el
// móvil guarda para trabajar sin cobertura).
//
// value = id de la serie elegida, o '' = la de por defecto.
export default function SelectorSerieDeca({ series = [], value = '', onChange, disabled = false, grande = false }) {
  const { t } = useTranslation('deca')
  const activas = series.filter((s) => s.activa)
  const porDefecto = activas.find((s) => s.por_defecto) || activas[0]
  const [manual, setManual] = useState(Boolean(value && value !== porDefecto?.id))
  // Un borrador que se abre con otra serie ya elegida llega después de montar.
  useEffect(() => {
    if (value && porDefecto && value !== porDefecto.id) setManual(true)
  }, [value, porDefecto?.id])

  if (activas.length < 2) return null

  const elegida = activas.find((s) => s.id === value) || porDefecto
  const etiqueta = (s) => `${s.nombre} (${s.prefijo || '—'})`
  const texto = grande ? 'text-base' : 'text-sm'

  const alternar = (marcado) => {
    setManual(marcado)
    if (!marcado) onChange('')
  }

  return (
    <div className={`space-y-2 ${texto}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-gray-600">
          {t('series.serie', 'Serie')}: <strong className="text-gray-800">{etiqueta(elegida)}</strong>
        </span>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none text-gray-600">
          <input
            type="checkbox" checked={manual} disabled={disabled}
            onChange={(e) => alternar(e.target.checked)}
            className={grande ? 'h-5 w-5' : 'h-4 w-4'}
          />
          {t('series.elegir', 'Elegir serie')}
        </label>
      </div>
      {manual && (
        <select
          value={elegida?.id || ''} disabled={disabled}
          onChange={(e) => onChange(e.target.value === porDefecto?.id ? '' : e.target.value)}
          aria-label={t('series.serie', 'Serie')}
          className={`w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 ${grande ? 'h-12' : 'h-9'}`}
        >
          {activas.map((s) => (
            <option key={s.id} value={s.id}>
              {etiqueta(s)}{s.por_defecto ? ` · ${t('series.por_defecto', 'por defecto')}` : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
