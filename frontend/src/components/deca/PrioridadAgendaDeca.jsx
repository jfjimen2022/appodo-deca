import { useTranslation } from 'react-i18next'
import { BookUser, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Switch } from '../ui/switch'

// Configuración de DeCA → "Lectura de documentos: la agenda manda"
// (2026-10-01, pedido del usuario). Explica al administrador del módulo de
// dónde sale cada dato cuando se lee un albarán o CMR y en qué orden se fía
// Appodo de cada fuente. Backend: catalogo_service.aplicar_prioridad_agenda;
// frontend: lib/decaReparto.js.
const FUENTES = ['persona', 'agenda', 'lectura', 'orden']
const AVISOS = ['distinto', 'ajeno', 'parecido', 'varios']

export default function PrioridadAgendaDeca({ config, set }) {
  const { t } = useTranslation('deca')
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BookUser className="h-4 w-4 text-[var(--color-marca)]" aria-hidden="true" />
              <label htmlFor="agenda_prioritaria">{t('agenda_manda.titulo')}</label>
            </CardTitle>
            <CardDescription className="mt-1">{t('agenda_manda.desc')}</CardDescription>
          </div>
          <Switch
            id="agenda_prioritaria"
            checked={Boolean(config.agenda_prioritaria)}
            onCheckedChange={(v) => set('agenda_prioritaria', v)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-gray-800">
        <div>
          <p className="font-semibold text-gray-900">{t('agenda_manda.orden_titulo')}</p>
          <ol className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200">
            {FUENTES.map((f, i) => (
              <li key={f} className="grid grid-cols-[28px_1fr] gap-2 p-2.5">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[rgb(var(--color-marca-rgb)/0.1)] text-xs font-bold text-[var(--color-marca)]">{i + 1}</span>
                <span>
                  <span className="font-semibold text-gray-900">{t(`agenda_manda.fuente_${f}`)}</span>{' '}
                  <span className="text-gray-700">{t(`agenda_manda.fuente_${f}_desc`)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <p className="font-semibold text-gray-900">{t('agenda_manda.avisos_titulo')}</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {AVISOS.map((a) => <li key={a}>{t(`agenda_manda.aviso_${a}`)}</li>)}
          </ul>
        </div>

        <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
          <p className="mb-1.5 flex items-center gap-2 font-semibold text-gray-900">
            <Info className="h-4 w-4" aria-hidden="true" />{t('agenda_manda.leyenda_titulo')}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-gray-700">
            <li>{t('agenda_manda.leyenda_apagado')}</li>
            <li>{t('agenda_manda.leyenda_agenda')}</li>
            <li>{t('agenda_manda.leyenda_matriculas')}</li>
            <li>{t('agenda_manda.leyenda_naturaleza')}</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
