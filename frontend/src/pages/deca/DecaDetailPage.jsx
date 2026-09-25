import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import QRCode from 'react-qr-code'
import {
  ArrowLeft, Loader2, Truck, Package, User, Building2, MapPin,
  Copy, Download, Ban, FileText, History, ShieldCheck, ShieldAlert, Mail,
} from 'lucide-react'
import { decaService } from '../../services/decaService'
import EnviarEmailDecaDialog from '../../components/deca/EnviarEmailDecaDialog'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import { useToast } from '../../context/ToastContext'

const ESTADO_BADGE = {
  borrador: 'secondary',
  confirmado: 'default',
  generado: 'success',
  anulado: 'destructive',
}

const TIPO_EVENTO_KEY = {
  creada: 'evento_creada',
  documento_subido: 'evento_documento_subido',
  editada: 'evento_editada',
  confirmada: 'evento_confirmada',
  generada: 'evento_generada',
  descarga_publica: 'evento_descarga_publica',
  anulada: 'evento_anulada',
}

function Campo({ label, value }) {
  const { t } = useTranslation('deca')
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 break-words">
        {value || <span className="text-gray-400 font-normal">{t('detalle.sin_datos')}</span>}
      </p>
    </div>
  )
}

export default function DecaDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation('deca')
  const toast = useToast()

  const [expedicion, setExpedicion] = useState(null)
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalAnularAbierto, setModalAnularAbierto] = useState(false)
  const [motivoAnular, setMotivoAnular] = useState('')
  const [anulando, setAnulando] = useState(false)
  const [modalEmailAbierto, setModalEmailAbierto] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await decaService.obtenerExpedicion(id)

      // Solo esta página muestra ficha de solo lectura -- borrador/confirmado
      // todavía se editan desde el formulario, así que redirigimos ahí.
      if (data.estado === 'borrador' || data.estado === 'confirmado') {
        navigate(`/deca/nuevo?id=${id}`, { replace: true })
        return
      }

      setExpedicion(data)

      try {
        const { data: eventosData } = await decaService.listarEventos(id)
        setEventos(Array.isArray(eventosData) ? eventosData : (eventosData?.results ?? []))
      } catch {
        toast.error(t('detalle.error_cargar_eventos'))
      }
    } catch {
      setError(t('detalle.error_cargar'))
    } finally {
      setLoading(false)
    }
  }, [id, navigate, t, toast])

  useEffect(() => { cargar() }, [cargar])

  const formatearFecha = (valor) => {
    if (!valor) return null
    return new Date(valor).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'UTC',
    })
  }

  const handleCopiarEnlace = async () => {
    const url = decaService.urlDescargaPublica(expedicion.token_publico)
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('detalle.enlace_copiado'))
    } catch {
      toast.error(t('detalle.enlace_copiado'))
    }
  }

  const handleAnular = async () => {
    setAnulando(true)
    try {
      const { data } = await decaService.anularExpedicion(id, motivoAnular)
      setExpedicion(data)
      setModalAnularAbierto(false)
      setMotivoAnular('')
      toast.success(t('detalle.anulada_ok'))
      cargar()
    } catch {
      toast.error(t('detalle.error_anular'))
    } finally {
      setAnulando(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">{t('detalle.cargando')}</p>
      </div>
    )
  }

  if (error || !expedicion) {
    return (
      <div className="w-full max-w-3xl mx-auto space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
          {error || t('detalle.error_cargar')}
        </div>
        <Link to="/deca" className="text-sm text-[var(--color-marca)] hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> {t('detalle.volver')}
        </Link>
      </div>
    )
  }

  const urlPublica = expedicion.token_publico ? decaService.urlDescargaPublica(expedicion.token_publico) : null

  return (
    <div className="w-full max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto space-y-4 pb-8">
      <div>
        <Link to="/deca" className="text-sm text-gray-500 hover:text-[var(--color-marca)] inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="h-4 w-4" /> {t('detalle.volver')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">
            {expedicion.numero_albaran || `#${expedicion.id}`}
          </h1>
          <Badge variant={ESTADO_BADGE[expedicion.estado] ?? 'secondary'}>
            {t(`estados.${expedicion.estado}`, expedicion.estado)}
          </Badge>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {t('detalle.creado_por', { nombre: expedicion.creado_por || t('detalle.sin_creador') })}
          {expedicion.fecha_generacion && ` · ${t('detalle.creado_el', { fecha: formatearFecha(expedicion.fecha_generacion) })}`}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_transporte')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Campo label={t('detalle.label_matricula_tractor')} value={expedicion.matricula_tractor} />
              <Campo label={t('detalle.label_matricula_remolque')} value={expedicion.matricula_remolque} />
              <Campo label={t('detalle.label_origen')} value={expedicion.origen} />
              <Campo label={t('detalle.label_destino')} value={expedicion.destino} />
              <Campo label={t('detalle.label_fecha_transporte')} value={formatearFecha(expedicion.fecha_hora_transporte)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_mercancia')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Campo label={t('detalle.label_naturaleza')} value={expedicion.naturaleza_mercancia} />
              <Campo label={t('detalle.label_peso')} value={expedicion.peso_kg ? `${expedicion.peso_kg} kg` : null} />
              <Campo label={t('detalle.label_bultos')} value={expedicion.bultos} />
              {expedicion.volumen_m3 != null && (
                <Campo label={t('detalle.label_volumen')} value={`${expedicion.volumen_m3} m³`} />
              )}
              {expedicion.codigo_mercancia && (
                <Campo label={t('detalle.label_codigo_mercancia')} value={expedicion.codigo_mercancia} />
              )}
              {expedicion.numero_pedido && (
                <Campo label={t('detalle.label_numero_pedido')} value={expedicion.numero_pedido} />
              )}
              {expedicion.numero_cmr && (
                <Campo label={t('expedicion.label_numero_cmr', 'Nº de CMR')} value={expedicion.numero_cmr} />
              )}
            </CardContent>
          </Card>

          {(expedicion.instrucciones_conductor || expedicion.contacto_emergencias || expedicion.tipo_contenedor
            || expedicion.instrucciones_expedidor || expedicion.instrucciones_pago || expedicion.comentarios) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_adicional')}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {expedicion.instrucciones_conductor && (
                  <Campo label={t('detalle.label_instrucciones_conductor')} value={expedicion.instrucciones_conductor} />
                )}
                {expedicion.contacto_emergencias && (
                  <Campo label={t('detalle.label_contacto_emergencias')} value={expedicion.contacto_emergencias} />
                )}
                {expedicion.tipo_contenedor && (
                  <Campo label={t('detalle.label_tipo_contenedor')} value={expedicion.tipo_contenedor} />
                )}
                {expedicion.instrucciones_expedidor && (
                  <Campo label={t('detalle.label_instrucciones_expedidor')} value={expedicion.instrucciones_expedidor} />
                )}
                {expedicion.instrucciones_pago && (
                  <Campo label={t('detalle.label_instrucciones_pago')} value={expedicion.instrucciones_pago} />
                )}
                {expedicion.comentarios && (
                  <Campo label={t('detalle.label_comentarios')} value={expedicion.comentarios} />
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_cargador')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Campo label={t('detalle.label_nombre')} value={expedicion.nombre_cargador} />
                <Campo label={t('detalle.label_nif')} value={expedicion.nif_cargador} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_transportista')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Campo label={t('detalle.label_nombre')} value={expedicion.nombre_transportista} />
                <Campo label={t('detalle.label_nif')} value={expedicion.nif_transportista} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_destinatario')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Campo label={t('detalle.label_nombre')} value={expedicion.nombre_destinatario} />
                <Campo label={t('detalle.label_nif')} value={expedicion.nif_destinatario} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <User className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_conductor')}
                  </span>
                  {expedicion.estado === 'generado' && (
                    <Button
                      variant="ghost" size="sm" className="gap-1.5 h-7 px-2 text-xs"
                      onClick={() => setModalEmailAbierto(true)}
                    >
                      <Mail className="h-3.5 w-3.5" /> {t('lista.btn_enviar_email', 'Enviar por email')}
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Campo label={t('detalle.label_nombre')} value={expedicion.nombre_conductor} />
                <Campo label={t('detalle.label_nif')} value={expedicion.nif_conductor} />
                <div className="grid grid-cols-2 gap-3">
                  <Campo label={t('detalle.label_telefono')} value={expedicion.telefono_conductor} />
                  <Campo label={t('detalle.label_email')} value={expedicion.email_conductor} />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_documentos')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expedicion.documentos_origen?.length ? (
                <div className="divide-y">
                  {expedicion.documentos_origen.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between py-2 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{doc.nombre_original}</p>
                        <p className="text-xs text-gray-500">
                          {t(`tipos.${doc.tipo_documento === 'albaran_venta' ? 'alb_venta' : doc.tipo_documento}`, doc.tipo_documento)}
                          {' · '}{formatearFecha(doc.fecha_alta)}
                        </p>
                      </div>
                      <a
                        href={doc.archivo}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-sm text-[var(--color-marca)] hover:underline"
                      >
                        {t('detalle.ver_documento')}
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">{t('detalle.sin_documentos')}</p>
              )}
            </CardContent>
          </Card>

          {expedicion.transportistas_sucesivos?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_transportistas_sucesivos')}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="py-1.5 pr-3 font-medium">{t('detalle.col_orden')}</th>
                      <th className="py-1.5 pr-3 font-medium">{t('detalle.col_nombre')}</th>
                      <th className="py-1.5 pr-3 font-medium">{t('detalle.col_nif')}</th>
                      <th className="py-1.5 font-medium">{t('detalle.col_matricula')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {expedicion.transportistas_sucesivos.map((ts) => (
                      <tr key={ts.id}>
                        <td className="py-1.5 pr-3">{ts.orden}</td>
                        <td className="py-1.5 pr-3">{ts.nombre}</td>
                        <td className="py-1.5 pr-3">{ts.nif}</td>
                        <td className="py-1.5">{ts.matricula || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4 text-[var(--color-marca)]" /> {t('detalle.seccion_auditoria')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {eventos.length ? (
                <ol className="space-y-3">
                  {eventos.map((ev) => (
                    <li key={ev.id} className="flex gap-3">
                      <div className="mt-1 h-2 w-2 rounded-full bg-[var(--color-marca)] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {t(`detalle.${TIPO_EVENTO_KEY[ev.tipo_evento] ?? 'evento_editada'}`)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {ev.usuario || t('detalle.evento_usuario_sistema')} · {formatearFecha(ev.fecha_alta)}
                        </p>
                        {ev.detalle && <p className="text-xs text-gray-500 mt-0.5">{ev.detalle}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-gray-400">{t('detalle.sin_eventos')}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {expedicion.estado === 'generado' && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {expedicion.acceso_publico_vigente ? (
                    <ShieldCheck className="h-4 w-4 text-green-600" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                  )}
                  {t('detalle.seccion_acceso_publico')}
                </CardTitle>
                <div className="text-sm text-muted-foreground">
                  <Badge variant={expedicion.acceso_publico_vigente ? 'success' : 'secondary'}>
                    {expedicion.acceso_publico_vigente ? t('detalle.acceso_vigente') : t('detalle.acceso_caducado')}
                  </Badge>
                  {expedicion.fecha_expiracion_publica && (
                    <span className="block mt-1.5 text-xs">
                      {t('detalle.acceso_expira_el', { fecha: formatearFecha(expedicion.fecha_expiracion_publica) })}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-center p-3 bg-white border rounded-xl">
                  <QRCode value={urlPublica} size={160} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">{t('detalle.enlace_publico')}</Label>
                  <p className="text-xs text-gray-600 break-all bg-gray-50 border rounded p-2">{urlPublica}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={handleCopiarEnlace}>
                    <Copy className="h-4 w-4" /> {t('detalle.btn_copiar_enlace')}
                  </Button>
                  <Button size="sm" className="gap-2" asChild>
                    <a href={urlPublica} target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4" /> {t('detalle.btn_descargar_pdf')}
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setModalEmailAbierto(true)}>
                    <Mail className="h-4 w-4" /> {t('lista.btn_enviar_email', 'Enviar por email')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {expedicion.estado !== 'anulado' && (
            <Card>
              <CardContent className="pt-5">
                <Button
                  variant="outline"
                  className="w-full gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setModalAnularAbierto(true)}
                >
                  <Ban className="h-4 w-4" /> {t('detalle.btn_anular')}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={modalAnularAbierto} onOpenChange={setModalAnularAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('detalle.modal_anular_titulo')}</DialogTitle>
            <DialogDescription>{t('detalle.modal_anular_descripcion')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">{t('detalle.label_motivo')}</Label>
            <Textarea
              value={motivoAnular}
              onChange={(e) => setMotivoAnular(e.target.value)}
              placeholder={t('detalle.placeholder_motivo')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalAnularAbierto(false)} disabled={anulando}>
              {t('detalle.btn_cancelar_modal')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleAnular}
              disabled={anulando}
              className="gap-2"
            >
              {anulando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              {anulando ? t('detalle.btn_anulando') : t('detalle.btn_anular_confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EnviarEmailDecaDialog
        expedicion={modalEmailAbierto ? expedicion : null}
        onOpenChange={setModalEmailAbierto}
      />
    </div>
  )
}
