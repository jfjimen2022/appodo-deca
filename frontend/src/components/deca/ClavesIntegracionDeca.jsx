import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plug, Loader2, Plus, Copy, Check, Ban } from 'lucide-react'
import { decaService } from '../../services/decaService'
import { useToast } from '../../context/ToastContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog'

// Claves de integración: con una, el ERP de la empresa (o un conector
// instalado en su red) envía cada albarán y se genera el DeCA solo
// (backend/deca/views_integracion.py). La clave
// completa se enseña UNA vez, al crearla; después solo se ve su prefijo.
const URL_INGESTA = `${window.location.origin}/api/v1/deca/integracion/expediciones/`

const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export default function ClavesIntegracionDeca() {
  const { t } = useTranslation('deca')
  const toast = useToast()
  const [claves, setClaves] = useState([])
  const [cargando, setCargando] = useState(true)
  const [nombre, setNombre] = useState('')
  const [creando, setCreando] = useState(false)
  const [nueva, setNueva] = useState(null) // { nombre, clave } -- solo mientras el diálogo está abierto
  const [copiada, setCopiada] = useState(false)
  const [aRevocar, setARevocar] = useState(null)
  const [revocando, setRevocando] = useState(false)

  const cargar = useCallback(() => {
    setCargando(true)
    decaService.listarClavesIntegracion()
      .then(({ data }) => setClaves(data))
      .catch(() => toast.error(t('integracion.error_cargar')))
      .finally(() => setCargando(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar() }, [cargar])

  const crear = async (e) => {
    e.preventDefault()
    if (!nombre.trim()) return
    setCreando(true)
    try {
      const { data } = await decaService.crearClaveIntegracion(nombre.trim())
      setNueva({ nombre: data.nombre, clave: data.clave })
      setCopiada(false)
      setNombre('')
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.nombre?.[0] || t('integracion.error_crear'))
    } finally {
      setCreando(false)
    }
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(nueva.clave)
      setCopiada(true)
    } catch {
      toast.error(t('integracion.error_copiar'))
    }
  }

  const revocar = async () => {
    setRevocando(true)
    try {
      await decaService.revocarClaveIntegracion(aRevocar.id)
      toast.success(t('integracion.revocada_ok'))
      setARevocar(null)
      cargar()
    } catch {
      toast.error(t('integracion.error_revocar'))
    } finally {
      setRevocando(false)
    }
  }

  const Estado = ({ c }) => (c.activa ? (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
      {t('integracion.estado_activa')}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
      {t('integracion.estado_revocada')}
    </span>
  ))

  const BotonRevocar = ({ c }) => (c.activa ? (
    <Button
      type="button" variant="outline" size="sm" className="gap-1.5 min-h-[40px]"
      onClick={() => setARevocar(c)}
      aria-label={t('integracion.revocar_aria', { nombre: c.nombre })}
    >
      <Ban className="h-4 w-4" aria-hidden="true" />{t('integracion.revocar')}
    </Button>
  ) : null)

  return (
    <Card id="claves-integracion">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Plug className="h-4 w-4 text-[var(--color-marca)]" aria-hidden="true" /> {t('integracion.titulo')}
        </CardTitle>
        <CardDescription className="mt-1">{t('integracion.descripcion')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <p>{t('integracion.direccion')}</p>
          <p className="mt-1 font-mono text-xs text-gray-900 break-all">POST {URL_INGESTA}</p>
          <p className="mt-1 text-xs text-gray-600">{t('integracion.cabecera')}</p>
        </div>

        <form onSubmit={crear} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px] max-w-sm">
            <Label htmlFor="clave-integracion-nombre">{t('integracion.nombre')}</Label>
            <Input
              id="clave-integracion-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={t('integracion.nombre_placeholder')}
              maxLength={100}
            />
          </div>
          <Button type="submit" disabled={creando || !nombre.trim()} className="gap-1.5">
            {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('integracion.crear')}
          </Button>
        </form>

        {cargando ? (
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-marca)]" />
        ) : claves.length === 0 ? (
          <p className="text-sm text-gray-600">{t('integracion.vacio')}</p>
        ) : (
          <>
            {/* Tabla -- solo tablet/escritorio */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-600 border-b">
                    <th className="py-2 pr-3 font-medium">{t('integracion.col_nombre')}</th>
                    <th className="py-2 pr-3 font-medium">{t('integracion.col_clave')}</th>
                    <th className="py-2 pr-3 font-medium">{t('integracion.col_creada')}</th>
                    <th className="py-2 pr-3 font-medium">{t('integracion.col_ultimo_uso')}</th>
                    <th className="py-2 pr-3 font-medium text-right">{t('integracion.col_recibidas')}</th>
                    <th className="py-2 pr-3 font-medium">{t('integracion.col_estado')}</th>
                    <th className="py-2"><span className="sr-only">{t('integracion.col_acciones')}</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {claves.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 pr-3 text-gray-900">{c.nombre}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-700">deca_{c.prefijo}_…</td>
                      <td className="py-2 pr-3 text-gray-700">{fecha(c.fecha_alta)}{c.creada_por ? ` · ${c.creada_por}` : ''}</td>
                      <td className="py-2 pr-3 text-gray-700">{fecha(c.ultimo_uso)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-700">{c.expediciones_recibidas}</td>
                      <td className="py-2 pr-3"><Estado c={c} /></td>
                      <td className="py-1 text-right"><BotonRevocar c={c} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas -- solo móvil. Misma info, mismas acciones */}
            <div className="md:hidden divide-y rounded-md border">
              {claves.map((c) => (
                <div key={c.id} className="px-3 py-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-gray-900 break-words">{c.nombre}</p>
                    <Estado c={c} />
                  </div>
                  <p className="font-mono text-xs text-gray-700">deca_{c.prefijo}_…</p>
                  <p className="text-xs text-gray-700">
                    {t('integracion.col_creada')}: {fecha(c.fecha_alta)} · {t('integracion.col_ultimo_uso')}: {fecha(c.ultimo_uso)}
                  </p>
                  <p className="text-xs text-gray-700">{t('integracion.col_recibidas')}: {c.expediciones_recibidas}</p>
                  <div className="pt-1"><BotonRevocar c={c} /></div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>

      {/* La clave completa: solo aquí y solo ahora. */}
      <Dialog open={Boolean(nueva)} onOpenChange={(abierto) => { if (!abierto) setNueva(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('integracion.nueva_titulo', { nombre: nueva?.nombre })}</DialogTitle>
            <DialogDescription>{t('integracion.nueva_aviso')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-gray-50 p-3 font-mono text-sm text-gray-900 break-all select-all">
            {nueva?.clave}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copiar} className="gap-1.5">
              {copiada ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiada ? t('integracion.copiada') : t('integracion.copiar')}
            </Button>
            <Button onClick={() => setNueva(null)}>{t('integracion.entendido')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(aRevocar)} onOpenChange={(abierto) => { if (!abierto) setARevocar(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('integracion.revocar_titulo')}</DialogTitle>
            <DialogDescription>{aRevocar && t('integracion.revocar_desc', { nombre: aRevocar.nombre })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setARevocar(null)} disabled={revocando}>{t('expedicion.btn_cancelar')}</Button>
            <Button variant="destructive" onClick={revocar} disabled={revocando} className="gap-1.5">
              {revocando && <Loader2 className="h-4 w-4 animate-spin" />}{t('integracion.revocar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
