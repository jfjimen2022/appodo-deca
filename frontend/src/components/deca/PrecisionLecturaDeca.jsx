import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge, Loader2 } from 'lucide-react'
import { decaService } from '../../services/decaService'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

// Cuánto acierta la lectura automática de documentos (fase 2 del aprendizaje,
// apps/deca/services/aprendizaje_service.py::precision_lectura): % de datos
// que nadie tuvo que corregir al generar el DeCA, en total, en lo manuscrito,
// por campo y por modelo. Sirve para ver que las correcciones de la empresa
// hacen que la IA lea mejor mes a mes.
const PERIODOS = [30, 90, 365, 0]

export default function PrecisionLecturaDeca() {
  const { t } = useTranslation('deca')
  const [dias, setDias] = useState(90)
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setCargando(true)
    setError(false)
    decaService.precisionLectura(dias ? { dias } : {})
      .then(({ data }) => setDatos(data))
      .catch(() => setError(true))
      .finally(() => setCargando(false))
  }, [dias])

  const etiquetaCampo = (c) => t(`expedicion.label_campo_${c}`, c)
  const pct = (v) => (v == null ? '—' : `${v.toLocaleString('es-ES')} %`)

  return (
    <Card id="precision-lectura">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4 text-[var(--color-marca)]" aria-hidden="true" /> {t('precision.titulo')}
            </CardTitle>
            <CardDescription className="mt-1">{t('precision.descripcion')}</CardDescription>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            {t('precision.periodo')}
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              {PERIODOS.map((d) => <option key={d} value={d}>{t(`precision.periodo_${d}`)}</option>)}
            </select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cargando && <Loader2 className="h-5 w-5 animate-spin text-[var(--color-marca)]" />}
        {!cargando && error && <p className="text-sm text-red-700">{t('precision.error')}</p>}
        {!cargando && !error && datos && datos.total === 0 && (
          <p className="text-sm text-gray-600">{t('precision.vacio')}</p>
        )}
        {!cargando && !error && datos && datos.total > 0 && (
          <>
            <p className="text-sm text-gray-900">
              {t('precision.resumen', { total: datos.total, porcentaje: pct(datos.porcentaje) })}
              {datos.manuscritas.total > 0 && ` ${t('precision.resumen_manuscritas', { total: datos.manuscritas.total, porcentaje: pct(datos.manuscritas.porcentaje) })}`}
            </p>

            {/* Tabla -- solo tablet/escritorio */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-600 border-b">
                    <th className="py-2 pr-3 font-medium">{t('precision.col_campo')}</th>
                    <th className="py-2 pr-3 font-medium text-right">{t('precision.col_leidos')}</th>
                    <th className="py-2 pr-3 font-medium text-right">{t('precision.col_corregidos')}</th>
                    <th className="py-2 font-medium text-right">{t('precision.col_acierto')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums">
                  {datos.por_campo.map((c) => (
                    <tr key={c.campo}>
                      <td className="py-2 pr-3 text-gray-900">{etiquetaCampo(c.campo)}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{c.total}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{c.corregidas}</td>
                      <td className="py-2 text-right font-semibold text-gray-900">{pct(c.porcentaje)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas -- solo móvil. Misma información */}
            <ul className="md:hidden divide-y">
              {datos.por_campo.map((c) => (
                <li key={c.campo} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 text-gray-900">
                    {etiquetaCampo(c.campo)}
                    <span className="block text-xs text-gray-600">{t('precision.leidos_corregidos', { total: c.total, corregidos: c.corregidas })}</span>
                  </span>
                  <span className="font-semibold tabular-nums text-gray-900">{pct(c.porcentaje)}</span>
                </li>
              ))}
            </ul>

            {datos.por_modelo.length > 1 && (
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">{t('precision.por_modelo')}</p>
                <ul className="text-sm text-gray-800 space-y-1 tabular-nums">
                  {datos.por_modelo.map((m) => (
                    <li key={m.modelo || 'sin-modelo'} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">{m.modelo || t('precision.sin_modelo')}</span>
                      <span>{pct(m.porcentaje)} · {t('precision.datos', { count: m.total })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
