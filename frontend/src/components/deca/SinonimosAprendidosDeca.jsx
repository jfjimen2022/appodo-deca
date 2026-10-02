import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Loader2, Trash2, CheckCircle2, Sparkles } from 'lucide-react'
import { decaService } from '../../services/decaService'
import { useToast } from '../../context/ToastContext'
import { Card, CardContent } from '../ui/card'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog'

// Pestaña "Sinónimos aprendidos" de la Agenda de DeCA: cómo aparece escrita
// en los documentos cada ficha ("TTES ROMERO" = Transportes Romero Ruiz
// S.L.). Se aprenden solos al generar DeCA en los que alguien corrigió lo que
// leyó la IA (apps/deca/services/aprendizaje_service.py); aquí solo se
// consultan y se olvidan los que estén mal. Fase 1 del aprendizaje, 2026-09-28.
const ROLES = ['', 'transportista', 'cargador', 'destinatario', 'conductor', 'tractora', 'remolque']

export default function SinonimosAprendidosDeca() {
  const { t } = useTranslation('deca')
  const toast = useToast()
  const [sinonimos, setSinonimos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [rol, setRol] = useState('')
  const [aOlvidar, setAOlvidar] = useState(null)
  const [olvidando, setOlvidando] = useState(false)

  const cargar = useCallback(() => {
    setCargando(true)
    const params = { page_size: 500 }
    if (busqueda) params.q = busqueda
    if (rol) params.rol = rol
    decaService.listarSinonimos(params)
      .then(({ data }) => setSinonimos(data.results ?? data))
      .catch(() => toast.error(t('sinonimos.error_cargar')))
      .finally(() => setCargando(false))
  }, [busqueda, rol]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar() }, [cargar])

  const olvidar = async () => {
    setOlvidando(true)
    try {
      await decaService.borrarSinonimo(aOlvidar.id)
      toast.success(t('sinonimos.olvidado'))
      setAOlvidar(null)
      cargar()
    } catch {
      toast.error(t('sinonimos.error_olvidar'))
    } finally {
      setOlvidando(false)
    }
  }

  const Estado = ({ s }) => (s.fiable ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{t('sinonimos.estado_fiable')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{t('sinonimos.estado_aprendiendo')}
    </span>
  ))

  const BotonOlvidar = ({ s }) => (
    <button
      type="button"
      onClick={() => setAOlvidar(s)}
      className="p-2.5 text-gray-500 hover:text-red-600"
      aria-label={t('sinonimos.olvidar_aria', { texto: s.texto_original || s.texto })}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  )

  return (
    <>
      <p className="text-sm text-gray-600 shrink-0 max-w-3xl">{t('sinonimos.explicacion')}</p>

      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" aria-hidden="true" />
          <Input
            className="pl-9"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t('agenda.buscar', 'Buscar...')}
            aria-label={t('agenda.buscar', 'Buscar...')}
          />
        </div>
        <label className="sr-only" htmlFor="sinonimos-rol">{t('sinonimos.filtro_rol')}</label>
        <select
          id="sinonimos-rol"
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          {ROLES.map((r) => <option key={r || 'todos'} value={r}>{t(`sinonimos.rol_${r || 'todos'}`)}</option>)}
        </select>
      </div>

      <Card id="sinonimos-aprendidos" className="flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
          {cargando ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-marca)]" />
            </div>
          ) : sinonimos.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-12 px-4 text-center text-sm text-gray-600">
              {t('sinonimos.vacio')}
            </div>
          ) : (
            <>
              {/* Tabla -- solo tablet/escritorio */}
              <div className="hidden md:block overflow-x-auto flex-1 min-h-0 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">{t('sinonimos.col_se_lee')}</th>
                      <th className="px-4 py-2.5 font-semibold">{t('sinonimos.col_es')}</th>
                      <th className="px-4 py-2.5 font-semibold">{t('sinonimos.col_tipo')}</th>
                      <th className="px-4 py-2.5 font-semibold">{t('sinonimos.col_confirmado')}</th>
                      <th className="px-4 py-2.5"><span className="sr-only">{t('sinonimos.col_acciones')}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sinonimos.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2.5 font-mono text-gray-900">{s.texto_original || s.texto}</td>
                        <td className="px-4 py-2.5 text-gray-900">
                          {s.nombre}{s.nif && <span className="ml-2 font-mono text-xs text-gray-600">{s.nif}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700">{t(`sinonimos.rol_${s.rol}`)}</td>
                        <td className="px-4 py-2.5">
                          <span className="mr-2 text-gray-700">{t('sinonimos.veces', { count: s.veces_confirmado })}</span>
                          <Estado s={s} />
                        </td>
                        <td className="px-2 py-1 text-right"><BotonOlvidar s={s} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas -- solo móvil. Misma info, mismas acciones */}
              <div className="md:hidden divide-y flex-1 min-h-0 overflow-y-auto">
                {sinonimos.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-gray-900 break-words">{s.texto_original || s.texto}</p>
                      <p className="text-sm text-gray-900 break-words">= {s.nombre}{s.nif ? ` · ${s.nif}` : ''}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-700">
                        {t(`sinonimos.rol_${s.rol}`)} · {t('sinonimos.veces', { count: s.veces_confirmado })} <Estado s={s} />
                      </p>
                    </div>
                    <BotonOlvidar s={s} />
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(aOlvidar)} onOpenChange={(abierto) => { if (!abierto) setAOlvidar(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sinonimos.olvidar_titulo')}</DialogTitle>
            <DialogDescription>
              {aOlvidar && t('sinonimos.olvidar_desc', { texto: aOlvidar.texto_original || aOlvidar.texto, nombre: aOlvidar.nombre })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAOlvidar(null)} disabled={olvidando}>{t('expedicion.btn_cancelar')}</Button>
            <Button variant="destructive" onClick={olvidar} disabled={olvidando} className="gap-1.5">
              {olvidando && <Loader2 className="h-4 w-4 animate-spin" />}{t('sinonimos.olvidar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
