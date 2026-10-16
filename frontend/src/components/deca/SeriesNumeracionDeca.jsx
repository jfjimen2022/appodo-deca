import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListOrdered, Loader2, Plus, Save } from 'lucide-react'
import { decaService } from '../../services/decaService'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { useToast } from '../../context/ToastContext'

// Series de numeración (2026-10-15): cada actividad con su prefijo y su
// contador ("DECA_ALG-00001", "DECA_TOM-00001"...). Todo DeCA recibe al
// Generar el siguiente número de su serie, tenga o no albarán. El último
// número lo mueve solo el servidor: tocarlo a mano repetiría o saltaría
// números ya emitidos.

const NUEVA = { nombre: '', prefijo: '', digitos: 5 }

function ejemplo(serie) {
  const n = (serie.ultimo_numero || 0) + 1
  return `${serie.prefijo || ''}${String(n).padStart(Number(serie.digitos) || 1, '0')}`
}

export default function SeriesNumeracionDeca() {
  const { t } = useTranslation('deca')
  const toast = useToast()
  const [series, setSeries] = useState([])
  const [cargando, setCargando] = useState(true)
  const [guardandoId, setGuardandoId] = useState(null)
  const [nueva, setNueva] = useState(NUEVA)

  const cargar = useCallback(async () => {
    try {
      const { data } = await decaService.listarSeries()
      setSeries(data.results ?? data)
    } catch {
      toast.error(t('series.error_cargar', 'No se pudieron cargar las series.'))
    } finally {
      setCargando(false)
    }
  }, [t, toast])

  useEffect(() => { cargar() }, [cargar])

  const cambiar = (id, campo, valor) =>
    setSeries((prev) => prev.map((s) => (s.id === id ? { ...s, [campo]: valor, _cambiada: true } : s)))

  const errorDe = (err) => {
    const d = err.response?.data
    if (!d) return t('series.error_guardar', 'No se pudo guardar la serie.')
    if (typeof d.detail === 'string') return d.detail
    return Object.values(d).flat().join(' ')
  }

  const guardar = async (serie) => {
    setGuardandoId(serie.id)
    try {
      await decaService.actualizarSerie(serie.id, {
        nombre: serie.nombre, prefijo: serie.prefijo, digitos: Number(serie.digitos),
        activa: serie.activa, por_defecto: serie.por_defecto,
      })
      toast.success(t('series.guardada', 'Serie guardada.'))
      await cargar()
    } catch (err) {
      toast.error(errorDe(err))
    } finally {
      setGuardandoId(null)
    }
  }

  // Marcar otra serie como «por defecto» se guarda al momento: el servidor
  // desmarca la anterior (solo puede haber una).
  const marcarPorDefecto = async (serie) => {
    setGuardandoId(serie.id)
    try {
      await decaService.actualizarSerie(serie.id, { por_defecto: true })
      await cargar()
    } catch (err) {
      toast.error(errorDe(err))
    } finally {
      setGuardandoId(null)
    }
  }

  const crear = async () => {
    setGuardandoId('nueva')
    try {
      await decaService.crearSerie({ ...nueva, digitos: Number(nueva.digitos) })
      setNueva(NUEVA)
      toast.success(t('series.creada', 'Serie creada.'))
      await cargar()
    } catch (err) {
      toast.error(errorDe(err))
    } finally {
      setGuardandoId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-[var(--color-marca)]" /> {t('series.titulo', 'Series de numeración')}
        </CardTitle>
        <CardDescription>
          {t('series.desc', 'Cada DeCA recibe al generarse el siguiente número de su serie, tenga o no albarán. Crea una serie por actividad (p. ej. Algodón, Tomates) si quieres numerarlas por separado. Al hacer un DeCA se usa la serie por defecto, salvo que se elija otra.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cargando ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-3 font-medium">{t('series.col_nombre', 'Actividad')}</th>
                  <th className="py-2 pr-3 font-medium">{t('series.col_prefijo', 'Prefijo')}</th>
                  <th className="py-2 pr-3 font-medium">{t('series.col_digitos', 'Cifras')}</th>
                  <th className="py-2 pr-3 font-medium">{t('series.col_siguiente', 'Siguiente número')}</th>
                  <th className="py-2 pr-3 font-medium text-center">{t('series.col_defecto', 'Por defecto')}</th>
                  <th className="py-2 pr-3 font-medium text-center">{t('series.col_activa', 'Activa')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <Input value={s.nombre} onChange={(e) => cambiar(s.id, 'nombre', e.target.value)} className="h-8 min-w-[8rem]" />
                    </td>
                    <td className="py-2 pr-3">
                      <Input value={s.prefijo} onChange={(e) => cambiar(s.id, 'prefijo', e.target.value)} className="h-8 w-28" />
                    </td>
                    <td className="py-2 pr-3">
                      <Input type="number" min={1} max={10} value={s.digitos}
                        onChange={(e) => cambiar(s.id, 'digitos', e.target.value)} className="h-8 w-16" />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-gray-600">{ejemplo(s)}</td>
                    <td className="py-2 pr-3 text-center">
                      <input
                        type="radio" name="serie_por_defecto" checked={Boolean(s.por_defecto)}
                        disabled={!s.activa || guardandoId !== null}
                        onChange={() => marcarPorDefecto(s)}
                        aria-label={t('series.col_defecto', 'Por defecto')}
                      />
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <Switch checked={Boolean(s.activa)} disabled={s.por_defecto}
                        onCheckedChange={(v) => cambiar(s.id, 'activa', v)} />
                    </td>
                    <td className="py-2 text-right">
                      {s._cambiada && (
                        <Button size="sm" variant="outline" onClick={() => guardar(s)} disabled={guardandoId !== null}>
                          {guardandoId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-3 pr-3">
                    <Input value={nueva.nombre} placeholder={t('series.ph_nombre', 'Nueva actividad')}
                      onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} className="h-8 min-w-[8rem]" />
                  </td>
                  <td className="pt-3 pr-3">
                    <Input value={nueva.prefijo} placeholder="DECA_ALG-"
                      onChange={(e) => setNueva({ ...nueva, prefijo: e.target.value })} className="h-8 w-28" />
                  </td>
                  <td className="pt-3 pr-3">
                    <Input type="number" min={1} max={10} value={nueva.digitos}
                      onChange={(e) => setNueva({ ...nueva, digitos: e.target.value })} className="h-8 w-16" />
                  </td>
                  <td className="pt-3 pr-3 font-mono text-xs text-gray-400">{nueva.prefijo ? ejemplo({ ...nueva, ultimo_numero: 0 }) : ''}</td>
                  <td colSpan={3} className="pt-3 text-right">
                    <Button size="sm" onClick={crear} disabled={!nueva.nombre.trim() || guardandoId !== null}>
                      {guardandoId === 'nueva' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      <span className="ml-1">{t('series.btn_anadir', 'Añadir serie')}</span>
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-3">
          {t('series.ayuda', 'El número se pone al generar el DeCA (un borrador que se borra no gasta número) y no cambia aunque se corrija después. Una serie que ya se ha usado no se borra: se desactiva.')}
        </p>
      </CardContent>
    </Card>
  )
}
