import { useTranslation } from 'react-i18next'
import { Tractor, Printer, Save, WifiOff, FileText, Scale, BellRing, Info, Smartphone, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'

// Configuración de DeCA → "Trabajo en campo y sin cobertura" (2026-09-30).
// El MODO sin cobertura es uno solo (son formas excluyentes de resolver lo
// mismo: radio). El resto son interruptores independientes (una tarjeta
// cada uno, ver CLAUDE.md "Layout responsive en páginas de configuración").
// Cada opción lleva su explicación y abajo va una leyenda común: la pidió el
// usuario explícitamente, porque quien configura esto no es quien está en
// la finca y tiene que entender qué va a pasar allí.

const MODOS = [
  { valor: 'imprimir', icono: Printer },
  { valor: 'generar_al_volver', icono: Save },
  { valor: 'necesita_red', icono: WifiOff },
]

function Explicacion({ children }) {
  return <p className="text-xs leading-relaxed text-gray-600">{children}</p>
}

function TarjetaInterruptor({ id, icono: Icono, titulo, activo, onCambiar, disabled, children }) {
  return (
    <Card className={disabled ? 'opacity-70' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icono className="h-4 w-4 text-[var(--color-marca)]" aria-hidden="true" />
            <label htmlFor={id}>{titulo}</label>
          </CardTitle>
          <Switch id={id} checked={Boolean(activo)} onCheckedChange={onCambiar} disabled={disabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  )
}

const PASOS = {
  android: 7,
  iphone: 6,
  comun: 6,
}

function ListaPasos({ prefijo, n, t, ordenada = true }) {
  const Lista = ordenada ? 'ol' : 'ul'
  return (
    <Lista className={`${ordenada ? 'list-decimal' : 'list-disc'} space-y-1.5 pl-5 text-sm text-gray-800`}>
      {Array.from({ length: n }, (_, i) => <li key={i}>{t(`campo.${prefijo}_${i + 1}`)}</li>)}
    </Lista>
  )
}

function GuiaMoviles({ t }) {
  return (
    <details className="group rounded-lg border border-gray-300 bg-white" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-base font-semibold text-gray-900">
        <span className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-[var(--color-marca)]" aria-hidden="true" />{t('campo.guia_titulo')}
        </span>
        <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <p className="text-sm text-gray-600">{t('campo.guia_intro')}</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <section className="rounded-lg border border-gray-200 p-3" aria-labelledby="guia-android">
            <h3 id="guia-android" className="mb-1 text-sm font-bold text-gray-900">{t('campo.guia_android_titulo')}</h3>
            <p className="mb-2 text-xs font-semibold text-green-800">{t('campo.guia_android_resumen')}</p>
            <ListaPasos prefijo="guia_android" n={PASOS.android} t={t} />
          </section>
          <section className="rounded-lg border border-gray-200 p-3" aria-labelledby="guia-iphone">
            <h3 id="guia-iphone" className="mb-1 text-sm font-bold text-gray-900">{t('campo.guia_iphone_titulo')}</h3>
            <p className="mb-2 text-xs font-semibold text-amber-800">{t('campo.guia_iphone_resumen')}</p>
            <ListaPasos prefijo="guia_iphone" n={PASOS.iphone} t={t} />
          </section>
        </div>
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-3" aria-labelledby="guia-comun">
          <h3 id="guia-comun" className="mb-2 text-sm font-bold text-gray-900">{t('campo.guia_comun_titulo')}</h3>
          <ListaPasos prefijo="guia_comun" n={PASOS.comun} t={t} ordenada={false} />
        </section>
        <section className="rounded-lg border-2 border-[rgb(var(--color-marca-rgb)/0.3)] p-3" aria-labelledby="guia-prueba">
          <h3 id="guia-prueba" className="mb-2 text-sm font-bold text-gray-900">{t('campo.guia_prueba_titulo')}</h3>
          <ListaPasos prefijo="guia_prueba" n={5} t={t} />
        </section>
      </div>
    </details>
  )
}

export default function TrabajoCampoDeca({ config, set }) {
  const { t } = useTranslation('deca')
  const sinVentana = !Number(config.horas_max_edicion_generado)
  const imprime = config.modo_sin_cobertura === 'imprimir'

  return (
    <section aria-labelledby="titulo-trabajo-campo" className="space-y-4">
      <div>
        <h2 id="titulo-trabajo-campo" className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <Tractor className="h-5 w-5 text-[var(--color-marca)]" aria-hidden="true" />{t('campo.cfg_titulo')}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{t('campo.cfg_subtitulo')}</p>
      </div>

      {/* 1 · Modo sin cobertura: se elige UNO */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('campo.cfg_modo_titulo')}</CardTitle>
          <CardDescription>{t('campo.cfg_modo_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-labelledby="titulo-trabajo-campo" className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {MODOS.map(({ valor, icono: Icono }) => {
              const elegido = config.modo_sin_cobertura === valor
              return (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={elegido}
                  onClick={() => set('modo_sin_cobertura', valor)}
                  className={`flex flex-col gap-1.5 rounded-lg border-2 p-3 text-left transition-colors ${elegido
                    ? 'border-[var(--color-marca)] bg-[rgb(var(--color-marca-rgb)/0.06)]'
                    : 'border-gray-200 bg-white hover:border-gray-400'}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <span
                      className={`grid h-4 w-4 place-items-center rounded-full border-2 ${elegido ? 'border-[var(--color-marca)]' : 'border-gray-400'}`}
                      aria-hidden="true"
                    >
                      {elegido && <span className="h-2 w-2 rounded-full bg-[var(--color-marca)]" />}
                    </span>
                    <Icono className="h-4 w-4" aria-hidden="true" />
                    {t(`campo.modo_${valor}`)}
                    {valor === 'imprimir' && <span className="text-xs font-normal text-gray-600">· {t('campo.por_defecto')}</span>}
                  </span>
                  <span className="text-xs leading-relaxed text-gray-600">{t(`campo.modo_${valor}_desc`)}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 2 · Interruptores independientes */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        <Card className={imprime ? '' : 'opacity-70'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Printer className="h-4 w-4 text-[var(--color-marca)]" aria-hidden="true" />
              <label htmlFor="ejemplares_sin_cobertura">{t('campo.cfg_ejemplares')}</label>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <select
              id="ejemplares_sin_cobertura"
              value={config.ejemplares_sin_cobertura}
              onChange={(e) => set('ejemplares_sin_cobertura', Number(e.target.value))}
              disabled={!imprime}
              className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
            >
              <option value={1}>{t('campo.ejemplares_1')}</option>
              <option value={2}>{t('campo.ejemplares_2')}</option>
              <option value={3}>{t('campo.ejemplares_3')}</option>
            </select>
            <Explicacion>{imprime ? t('campo.cfg_ejemplares_desc') : t('campo.cfg_ejemplares_solo_imprimir')}</Explicacion>
          </CardContent>
        </Card>

        <TarjetaInterruptor
          id="registrar_papel_por_foto"
          icono={FileText}
          titulo={t('campo.cfg_papel')}
          activo={config.registrar_papel_por_foto}
          onCambiar={(v) => set('registrar_papel_por_foto', v)}
        >
          <Explicacion>{t('campo.cfg_papel_desc')}</Explicacion>
        </TarjetaInterruptor>

        <TarjetaInterruptor
          id="deca_anticipado"
          icono={Scale}
          titulo={t('campo.cfg_anticipado')}
          activo={config.deca_anticipado}
          onCambiar={(v) => set('deca_anticipado', v)}
          disabled={sinVentana && !config.deca_anticipado}
        >
          <Explicacion>{t('campo.cfg_anticipado_desc')}</Explicacion>
          <p className="rounded-md border border-amber-400 bg-amber-50 p-2 text-xs font-semibold text-gray-900">
            {t('campo.cfg_anticipado_legal')}
          </p>
          {sinVentana && <p className="text-xs font-semibold text-red-700">{t('campo.cfg_anticipado_sin_ventana')}</p>}
        </TarjetaInterruptor>

        <TarjetaInterruptor
          id="aviso_sin_completar"
          icono={BellRing}
          titulo={t('campo.cfg_aviso')}
          activo={config.aviso_sin_completar}
          onCambiar={(v) => set('aviso_sin_completar', v)}
        >
          <Explicacion>{t('campo.cfg_aviso_desc')}</Explicacion>
          {config.aviso_sin_completar && (
            <div className="space-y-1">
              <Label htmlFor="aviso_sin_completar_dias" className="text-xs text-gray-700">{t('campo.cfg_aviso_dias')}</Label>
              <Input
                id="aviso_sin_completar_dias"
                type="number"
                min="1"
                max="30"
                className="w-24"
                value={config.aviso_sin_completar_dias}
                onChange={(e) => set('aviso_sin_completar_dias', e.target.value)}
              />
            </div>
          )}
        </TarjetaInterruptor>
      </div>

      {/* 3 · Cómo preparar los móviles: procedimiento para el administrador,
          distinto en Android y en iPhone (pedido del usuario 2026-09-30). */}
      <GuiaMoviles t={t} />

      {/* 4 · Leyenda común, abajo */}
      <div className="rounded-lg border border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
        <p className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
          <Info className="h-4 w-4" aria-hidden="true" />{t('campo.leyenda_titulo')}
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>{t('campo.leyenda_modo')}</li>
          <li>{t('campo.leyenda_interruptores')}</li>
          <li>{t('campo.leyenda_defecto')}</li>
          <li>{t('campo.leyenda_norma')}</li>
          <li>{t('campo.leyenda_movil')}</li>
          <li>{t('campo.leyenda_limite')}</li>
        </ul>
      </div>
    </section>
  )
}
