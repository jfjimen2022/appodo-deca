// Expediciones: pantalla principal. Listado paginado en servidor de todos los
// DeCA con buscador, filtro por estado, columnas configurables y ordenables y
// exportación a PDF/Excel con los mismos filtros (una sola función arma los
// parámetros para el listado y para la exportación, así no divergen). Arriba,
// los DeCA hechos sin cobertura en este móvil pendientes de registrar.
// Tabla en escritorio y tarjetas en móvil, con las mismas acciones.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { decaService } from '../../services/decaService'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog'
import { Textarea } from '../../components/ui/textarea'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import {
  Truck, Plus, FileEdit, MoreVertical, Eye, Ban, Lock, LockOpen,
  ChevronLeft, ChevronRight, Loader2, MoreHorizontal, FileText, FileSpreadsheet, Trash2,
  Download, Copy, Mail, Columns, AlertTriangle, Plug,
} from 'lucide-react'
import SortableHeader from '../../components/ui/SortableHeader'
import ColumnPickerPanel from '../../components/ui/ColumnPickerPanel'
import { useColumnasVisibles } from '../../hooks/useColumnasVisibles'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import IndicadorActualizado from '../../components/ui/IndicadorActualizado'
import { SmartSearch } from '../../components/ui/SmartSearch'
import EnviarEmailDecaDialog from '../../components/deca/EnviarEmailDecaDialog'
import PendientesSinConexionDeca from '../../components/deca/PendientesSinConexionDeca'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/utils'

// Colores de estado -- cada estado del ciclo de vida de la expedición
// (borrador -> confirmado -> generado -> anulado) tiene su propio color.
const ESTADO_BADGE = {
  borrador: { variant: 'secondary' },
  confirmado: { variant: 'default' },
  generado: { variant: 'success' },
  anulado: { variant: 'destructive' },
}

function formatFechaHora(value, locale) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  // OJO: `fecha_hora_transporte` NO es un timestamp real de servidor -- es
  // la hora que logística tecleó tal cual (ver DecaFormPage.jsx::isoADatetimeLocal
  // y el PDF generado en el backend, que la imprime con strftime sin
  // conversión). Por eso aquí se fuerza `timeZone: 'UTC'` en vez de
  // convertir a una zona horaria concreta.
  const fecha = formatDate(value, { locale, timeZone: 'UTC' })
  const hora = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  return `${fecha} ${hora}`
}

export default function ExpedicionesDecaPage() {
  const { t, i18n } = useTranslation('deca')
  const toast = useToast()
  const navigate = useNavigate()
  const locale = i18n.language === 'en' ? 'en-GB' : 'es-ES'

  // Series de numeración, para el filtro por serie.
  const [series, setSeries] = useState([])
  useEffect(() => {
    decaService.listarSeries().then(({ data }) => setSeries((data.results ?? data).filter((x) => x.activa || x.ultimo_numero))).catch(() => {})
  }, [])

  const DECA_SEARCH_CONFIG = {
    // Filtros del mismo `field` se excluyen entre sí (ver handleSearch): la
    // API solo admite un valor por parámetro. 'todas' no filtra nada; existe
    // para poder quitar el 'mias' por defecto y que se recuerde la elección.
    filters: [
      { id: 'mias', label: t('lista.filtro_mias'), field: 'creado_por', value: 'yo' },
      { id: 'todas', label: t('lista.filtro_todas'), field: 'creado_por', value: null },
      { id: 'estado_borrador', label: t('lista.filtro_borrador'), field: 'estado', value: 'borrador' },
      { id: 'estado_confirmado', label: t('lista.filtro_confirmado'), field: 'estado', value: 'confirmado' },
      { id: 'estado_generado', label: t('lista.filtro_generado'), field: 'estado', value: 'generado' },
      { id: 'estado_anulado', label: t('lista.filtro_anulado'), field: 'estado', value: 'anulado' },
      // Integración con el ERP: de dónde viene y qué revisar.
      { id: 'origen_erp', label: t('lista.filtro_origen_erp'), field: 'origen', value: 'erp' },
      { id: 'origen_appodo', label: t('lista.filtro_origen_appodo'), field: 'origen', value: 'appodo' },
      { id: 'modificado_erp', label: t('lista.filtro_modificado_erp'), field: 'modificado_erp', value: 'true' },
      { id: 'incompletas', label: t('lista.filtro_incompletas'), field: 'incompletas', value: 'true' },
      // Una por serie de numeración (actividad), solo si hay más de una.
      ...(series.length > 1 ? series.map((serie) => (
        { id: `serie_${serie.id}`, label: t('lista.filtro_serie', { nombre: serie.nombre }), field: 'serie', value: serie.id }
      )) : []),
    ],
  }

  // Columnas visibles + orden, persistidas por navegador. numero_albaran y
  // acciones se quedan fijas, fuera del picker.
  const COLUMNAS_CONFIG = [
    { id: 'estado', labelKey: 'col_estado', defaultVisible: true, sortField: 'estado' },
    // Nº del DeCA en su serie (todo DeCA generado desde v4.56.0 lo lleva).
    { id: 'numero_interno', labelKey: 'col_numero_deca', defaultVisible: true, sortField: 'numero_interno' },
    { id: 'nombre_cargador', labelKey: 'col_cargador', defaultVisible: true, sortField: 'nombre_cargador' },
    { id: 'nombre_transportista', labelKey: 'col_transportista', defaultVisible: true, sortField: 'nombre_transportista' },
    { id: 'nombre_destinatario', labelKey: 'col_destinatario', defaultVisible: true, sortField: 'nombre_destinatario' },
    { id: 'matricula_tractor', labelKey: 'col_matricula', defaultVisible: true, sortField: 'matricula_tractor' },
    { id: 'fecha_hora_transporte', labelKey: 'col_fecha_transporte', defaultVisible: true, sortField: 'fecha_hora_transporte' },
    // acceso_publico_vigente y creado_por son SerializerMethodField en el
    // backend (calculados, no columnas reales de BD) -- no ordenables sin
    // anotar la query.
    { id: 'acceso_publico', labelKey: 'col_acceso_publico', defaultVisible: true, numeric: true },
    { id: 'creado_por', labelKey: 'col_creado_por', defaultVisible: true },
    // Referencia del envío en el ERP (solo los recibidos por la integración).
    { id: 'referencia_externa', labelKey: 'col_referencia_externa', defaultVisible: false, sortField: 'referencia_externa' },
  ]

  const [expediciones, setExpediciones] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  // Por defecto cada usuario ve las suyas; SmartSearch restaura después el
  // último filtro que dejó puesto (p. ej. «Todas»).
  const [searchState, setSearchState] = useState({ search: '', filters: ['mias'], group: null, customFilters: [] })
  const [ordering, setOrdering] = useState({ field: 'fecha_hora_transporte', dir: 'desc' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [procesandoAccionId, setProcesandoAccionId] = useState(null)

  // Anular -- pide motivo con un Dialog propio, nunca window.confirm.
  const [expedicionAnular, setExpedicionAnular] = useState(null)
  const [motivoAnular, setMotivoAnular] = useState('')
  const [anulando, setAnulando] = useState(false)

  // Borrar -- solo se ofrece en anuladas que nunca llegaron a generar el
  // DeCA oficial; una que sí se generó se conserva siempre por auditoría.
  const [expedicionBorrar, setExpedicionBorrar] = useState(null)
  const [borrando, setBorrando] = useState(false)

  const [expedicionEmail, setExpedicionEmail] = useState(null)

  const [exportando, setExportando] = useState(false)

  const { columnasOrden, panelOpen, setPanelOpen, panelRef, toggleColumna, handleDragEnd, visible, columnasActivas } =
    useColumnasVisibles('deca-expediciones', COLUMNAS_CONFIG)

  // decaService.listarExpediciones no acepta AbortSignal (contrato fijo) --
  // se evita una respuesta obsoleta pisando una más reciente con un
  // contador de petición en vuelo, en vez de un AbortController real.
  const cargarSeqRef = useRef(0)

  const filtrosActivos = useCallback(() => {
    const params = {}
    if (searchState.search) params.q = searchState.search
    searchState.filters.forEach((fid) => {
      const f = DECA_SEARCH_CONFIG.filters.find((x) => x.id === fid)
      if (f?.value) params[f.field] = f.value
    })
    return params
    // `series`: un filtro de serie restaurado antes de cargar las series se aplica al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchState, series])

  const [ultimaActualizacion, setUltimaActualizacion] = useState(null)
  const [refrescando, setRefrescando] = useState(false)

  // `silencioso`: refresco automático o manual sobre la lista ya pintada --
  // sin spinner (desmontaría la tabla y perdería el scroll) y sin tapar la
  // lista con un error si falla una vez: la próxima vuelta lo reintenta.
  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    const seq = ++cargarSeqRef.current
    if (silencioso) setRefrescando(true)
    else {
      setLoading(true)
      setError('')
    }
    try {
      const params = { ...filtrosActivos(), page, page_size: pageSize }
      if (ordering?.field) params.ordering = ordering.dir === 'desc' ? `-${ordering.field}` : ordering.field
      const { data } = await decaService.listarExpediciones(params)
      if (seq !== cargarSeqRef.current) return
      setExpediciones(data.results ?? data)
      setTotal(data.count ?? (Array.isArray(data) ? data.length : 0))
      setError('')
      setUltimaActualizacion(new Date())
    } catch (err) {
      if (seq !== cargarSeqRef.current) return
      if (!silencioso) setError(err.response?.status === 403 ? t('lista.error_403') : t('lista.error_cargar'))
    } finally {
      // Siempre ambos: un refresco silencioso puede adelantar a una carga
      // normal en vuelo, y entonces es él quien debe quitar el spinner.
      if (seq === cargarSeqRef.current) {
        setLoading(false)
        setRefrescando(false)
      }
    }
  }, [page, pageSize, ordering, filtrosActivos, t])

  useEffect(() => { cargar() }, [cargar])

  const refrescarSilencioso = useCallback(() => cargar({ silencioso: true }), [cargar])

  // Otro usuario (o el mismo en otra pestaña) crea una expedición: que aparezca
  // sin F5. Pausado mientras hay un diálogo abierto o una acción en curso, para
  // no cambiar la lista debajo de quien está trabajando en ella.
  useAutoRefresh(refrescarSilencioso, {
    pausado: (modulosActivos.length > 0 && !activo) || loading || exportando || panelOpen
      || !!procesandoAccionId || !!expedicionAnular || !!expedicionBorrar || !!expedicionEmail,
  })

  useEffect(() => { setPage(1) }, [searchState])

  // Al marcar un filtro se desmarcan los de su mismo campo (dos estados a la
  // vez no se pueden pedir: antes ganaba el último en silencio).
  const handleSearch = (newSearchState) => {
    const nuevos = newSearchState.filters.filter((id) => !searchState.filters.includes(id))
    const campoDe = (id) => DECA_SEARCH_CONFIG.filters.find((x) => x.id === id)?.field
    const filters = newSearchState.filters.filter((id) =>
      nuevos.includes(id) || !nuevos.some((n) => campoDe(n) === campoDe(id)))
    setSearchState({ ...newSearchState, filters })
  }

  const handleSort = (field) => {
    setOrdering((prev) => prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' })
    setPage(1)
  }

  const abrirDialogAnular = (expedicion) => {
    setExpedicionAnular(expedicion)
    setMotivoAnular('')
  }

  const confirmarAnular = async () => {
    if (!expedicionAnular) return
    setAnulando(true)
    try {
      await decaService.anularExpedicion(expedicionAnular.id, motivoAnular)
      toast.success(t('lista.anular_ok'))
      setExpedicionAnular(null)
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.detail || t('lista.error_anular'))
    } finally {
      setAnulando(false)
    }
  }

  const confirmarBorrar = async () => {
    if (!expedicionBorrar) return
    setBorrando(true)
    try {
      await decaService.borrarExpedicion(expedicionBorrar.id)
      toast.success(t('lista.borrar_ok'))
      setExpedicionBorrar(null)
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.detail || t('lista.error_borrar'))
    } finally {
      setBorrando(false)
    }
  }

  // Mismo `buildParams` que `cargar()`, sin paginar -- así la exportación
  // nunca se desincroniza de lo que se ve en pantalla.
  const exportParams = () => {
    const params = filtrosActivos()
    if (ordering?.field) params.ordering = ordering.dir === 'desc' ? `-${ordering.field}` : ordering.field
    return params
  }

  const handleCopiarEnlace = async (exp) => {
    const url = decaService.urlDescargaPublica(exp.token_publico)
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('lista.enlace_copiado'))
    } catch {
      toast.error(t('lista.enlace_copiado'))
    }
  }

  const handleExportar = async (formato) => {
    setExportando(true)
    try {
      if (formato === 'pdf') await decaService.exportarExpedicionesPDF(exportParams())
      else await decaService.exportarExpedicionesExcel(exportParams())
    } catch (err) {
      toast.error(err.message || t('lista.error_exportar'))
    } finally {
      setExportando(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const renderMenuAcciones = (exp, triggerClassName = '') => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={triggerClassName}
          title={t('lista.btn_mas_acciones')}
          aria-label={t('lista.btn_mas_acciones')}
          disabled={procesandoAccionId === exp.id}
        >
          {procesandoAccionId === exp.id ? <Loader2 className="h-4 w-4 animate-spin text-gray-500" /> : <MoreVertical className="h-4 w-4 text-gray-500" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => navigate(`/deca/${exp.id}`)} className="gap-2 cursor-pointer">
          <Eye className="h-4 w-4" /> {t('lista.btn_ver_detalle')}
        </DropdownMenuItem>
        {exp.estado === 'generado' && (
          <>
            {/* <a> real, no window.open() -- un window.open tras un clic de
                menú puede caer fuera del "gesto de usuario" y bloquearse. */}
            <DropdownMenuItem asChild className="gap-2 cursor-pointer">
              <a href={decaService.urlDescargaPublica(exp.token_publico)} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4" /> {t('lista.btn_descargar_pdf')}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleCopiarEnlace(exp)} className="gap-2 cursor-pointer">
              <Copy className="h-4 w-4" /> {t('lista.btn_copiar_enlace')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setExpedicionEmail(exp)} className="gap-2 cursor-pointer">
              <Mail className="h-4 w-4" /> {t('lista.btn_enviar_email')}
            </DropdownMenuItem>
          </>
        )}
        {/* Anular = "esto se emitió oficialmente y se cancela" -- un
            borrador nunca llegó a confirmarse ni generarse, así que ese
            concepto no aplica (2026-09-25; el backend también lo rechaza,
            ver AnularExpedicionDecaView). Para descartar un borrador está
            "Borrar borrador" más abajo. */}
        {exp.estado !== 'anulado' && exp.estado !== 'borrador' && (
          <DropdownMenuItem onClick={() => abrirDialogAnular(exp)} className="gap-2 cursor-pointer text-red-600">
            <Ban className="h-4 w-4" /> {t('lista.btn_anular')}
          </DropdownMenuItem>
        )}
        {/* Borrador (equivocación al teclear, cambio de última hora) o
            anulada sin haber llegado a generar el DeCA oficial. Una
            anulada que SÍ se generó se conserva siempre por auditoría. */}
        {(exp.estado === 'borrador' || (exp.estado === 'anulado' && !exp.tiene_pdf_generado)) && (
          <DropdownMenuItem onClick={() => setExpedicionBorrar(exp)} className="gap-2 cursor-pointer text-red-600">
            <Trash2 className="h-4 w-4" /> {t('lista.btn_borrar')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const TH_BASE = 'text-left px-4 py-3 font-bold uppercase tracking-wide text-[11px] text-gray-600'

  const renderColHeader = (col) => {
    if (col.sortField) {
      return (
        <SortableHeader
          key={col.id}
          label={t(`lista.${col.labelKey}`)}
          field={col.sortField}
          ordering={ordering}
          onSort={handleSort}
          className={`${TH_BASE} ${col.numeric ? '!text-center' : ''}`}
        />
      )
    }
    return (
      <th key={col.id} className={`${TH_BASE} ${col.numeric ? 'text-center' : 'text-left'}`}>
        {t(`lista.${col.labelKey}`)}
      </th>
    )
  }

  // El ERP cambió el envío después de emitir el DeCA (no se ha aplicado).
  // Texto visible, no solo color (WCAG: el color nunca es la única pista).
  const EtiquetaCambiosErp = ({ exp }) => (exp.cambios_erp?.length ? (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800"
      title={t('erp.etiqueta_titulo')}
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('erp.etiqueta')}
    </span>
  ) : null)

  // Llegó del ERP y sigue en borrador: alguien tiene que completarlo antes de
  // que salga el camión. Fondo rojo + etiqueta con texto (no solo color).
  const pendienteErp = (exp) => Boolean(exp.recibida_de) && exp.estado === 'borrador'
  const EtiquetaPendienteErp = ({ exp }) => (pendienteErp(exp) ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-white px-2 py-0.5 text-xs font-semibold text-red-800">
      <Plug className="h-3.5 w-3.5" aria-hidden="true" />{t('erp.etiqueta_pendiente', 'Del ERP · por completar')}
    </span>
  ) : null)

  const renderColCelda = (col, exp) => {
    switch (col.id) {
      case 'estado':
        return (
          <td key={col.id} className="px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={ESTADO_BADGE[exp.estado]?.variant || 'secondary'}>
                {t(`lista.estado_${exp.estado}`)}
              </Badge>
              <EtiquetaCambiosErp exp={exp} />
              <EtiquetaPendienteErp exp={exp} />
            </div>
          </td>
        )
      case 'nombre_cargador':
        return <td key={col.id} className="px-4 py-3.5 text-gray-600">{exp.nombre_cargador || '—'}</td>
      case 'nombre_transportista':
        return <td key={col.id} className="px-4 py-3.5 text-gray-600">{exp.nombre_transportista || '—'}</td>
      case 'nombre_destinatario':
        return <td key={col.id} className="px-4 py-3.5 text-gray-600">{exp.nombre_destinatario || '—'}</td>
      case 'matricula_tractor':
        return <td key={col.id} className="px-4 py-3.5 text-gray-600 font-mono text-xs">{exp.matricula_tractor || '—'}</td>
      case 'fecha_hora_transporte':
        return <td key={col.id} className="px-4 py-3.5 text-gray-600 whitespace-nowrap">{formatFechaHora(exp.fecha_hora_transporte, locale)}</td>
      case 'acceso_publico':
        return (
          <td key={col.id} className="px-4 py-3.5 text-center" title={exp.acceso_publico_vigente ? t('lista.acceso_vigente') : t('lista.acceso_caducado')}>
            {exp.acceso_publico_vigente
              ? <LockOpen className="h-4 w-4 text-emerald-600 mx-auto" />
              : <Lock className="h-4 w-4 text-gray-400 mx-auto" />}
          </td>
        )
      case 'numero_interno':
        return (
          <td key={col.id} className="px-4 py-3.5 font-mono text-xs text-gray-600 whitespace-nowrap">{exp.numero_interno || '—'}</td>
        )
      case 'creado_por':
        // Lo recibido por la integración no lo creó una persona: el usuario es
        // quien lo generó; si aún nadie, se dice de qué ERP vino.
        return (
          <td key={col.id} className="px-4 py-3.5 text-gray-500">
            {exp.creado_por || exp.generado_por
              || (exp.recibida_de ? t('lista.creado_por_erp', { nombre: exp.recibida_de }) : '—')}
          </td>
        )
      case 'referencia_externa':
        return <td key={col.id} className="px-4 py-3.5 text-gray-600 font-mono text-xs">{exp.referencia_externa || '—'}</td>
      default:
        return <td key={col.id} className="px-4 py-3.5" />
    }
  }

  const renderFila = (exp) => (
    <tr
      key={exp.id}
      className={`border-b last:border-0 transition-colors cursor-pointer ${pendienteErp(exp)
        ? 'bg-red-50 hover:bg-red-100 shadow-[inset_4px_0_0_0_rgb(220_38_38)]'
        : 'odd:bg-white even:bg-gray-50/60 hover:bg-gray-100'}`}
      onClick={() => navigate(`/deca/${exp.id}`)}
    >
      <td className="px-4 py-3.5 font-medium text-gray-900">{exp.numero_albaran || '—'}</td>
      {columnasActivas.map((col) => renderColCelda(col, exp))}
      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-1">
          {renderMenuAcciones(exp)}
        </div>
      </td>
    </tr>
  )

  const renderTarjeta = (exp) => (
    // `role="button"` en un <div>, no un <button> real: la tarjeta ya lleva
    // dentro el botón "⋮" del menú de acciones, y un <button> anidado en
    // otro <button> es HTML inválido.
    <div
      key={exp.id}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/deca/${exp.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/deca/${exp.id}`)
        }
      }}
      aria-label={`${t('lista.col_numero')} ${exp.numero_albaran || '—'}`}
      className={`w-full text-left flex items-stretch border-b last:border-0 cursor-pointer ${pendienteErp(exp)
        ? 'bg-red-50 active:bg-red-100 border-l-4 border-l-red-600'
        : 'active:bg-gray-50'}`}
    >
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900">{exp.numero_albaran || '—'}</span>
          <Badge variant={ESTADO_BADGE[exp.estado]?.variant || 'secondary'}>
            {t(`lista.estado_${exp.estado}`)}
          </Badge>
          <EtiquetaCambiosErp exp={exp} />
          <EtiquetaPendienteErp exp={exp} />
          {exp.acceso_publico_vigente
            ? <LockOpen className="h-3.5 w-3.5 text-emerald-600" />
            : <Lock className="h-3.5 w-3.5 text-gray-400" />}
        </div>
        <p className="text-xs text-gray-500 truncate">{exp.nombre_cargador} → {exp.nombre_destinatario}</p>
        <p className="text-xs text-gray-400">{exp.nombre_transportista} · {exp.matricula_tractor}</p>
        <p className="text-xs text-gray-400">{formatFechaHora(exp.fecha_hora_transporte, locale)}</p>
      </div>
      <span className="shrink-0 flex items-center justify-center pr-1" onClick={(e) => e.stopPropagation()}>
        {renderMenuAcciones(exp, 'h-11 w-11')}
      </span>
    </div>
  )

  return (
    <div className="flex flex-col gap-4 w-full h-full min-h-0">
      <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
        <h1 className="hidden md:flex items-center gap-2 text-xl md:text-2xl font-bold text-gray-900">
          <Truck className="h-6 w-6 text-[var(--color-marca)]" />
          {t('lista.title')}
        </h1>
      </div>

      <PendientesSinConexionDeca onRegistrados={cargar} />

      <Card className="p-3 border-gray-100 shadow-sm flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <SmartSearch
            placeholder={t('lista.buscar_placeholder')}
            config={DECA_SEARCH_CONFIG}
            activeState={searchState}
            onChange={handleSearch}
            pagina="deca-expediciones"
            compact
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" disabled={exportando}>
                {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                {t('lista.btn_mas_acciones_toolbar')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => handleExportar('pdf')} className="gap-2 cursor-pointer">
                <FileText className="h-4 w-4" /> {t('lista.btn_exportar_pdf')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportar('excel')} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4" /> {t('lista.btn_exportar_excel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="relative" ref={panelRef}>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPanelOpen((v) => !v)}>
              <Columns className="h-4 w-4" />
              <span className="hidden sm:inline">{t('lista.selector_columnas')}</span>
            </Button>
            {panelOpen && (
              <ColumnPickerPanel
                columnasOrden={columnasOrden}
                columnasConfig={COLUMNAS_CONFIG}
                visible={visible}
                toggleColumna={toggleColumna}
                handleDragEnd={handleDragEnd}
                getLabel={(col) => t(`lista.${col.labelKey}`)}
              />
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <IndicadorActualizado fecha={ultimaActualizacion} onRefrescar={refrescarSilencioso} refrescando={refrescando} />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate('/deca/nuevo?manual=1')}>
            <FileEdit className="h-4 w-4" />
            {t('lista.btn_manual')}
          </Button>
          <Button size="sm" className="gap-2" onClick={() => navigate('/deca/nuevo')}>
            <Plus className="h-4 w-4" />
            {t('lista.btn_nuevo')}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm shrink-0">{error}</div>
      )}

      <Card className="flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-marca)]" />
            </div>
          ) : expediciones.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Truck className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p>{t('lista.empty')}</p>
            </div>
          ) : (
            <>
              {/* Tabla -- SOLO tablet/escritorio */}
              <div className="hidden md:block overflow-x-auto flex-1 min-h-0 overflow-y-auto" tabIndex={0} role="region" aria-label="Tabla con desplazamiento horizontal">
                <table className="w-full text-sm">
                  {/* Fondo opaco: con el tinte solo (6 %), las filas se veían a través al hacer scroll. */}
                  <thead className="sticky top-0 z-10 bg-white bg-[linear-gradient(rgb(var(--color-marca-rgb)/0.06),rgb(var(--color-marca-rgb)/0.06))]">
                    <tr className="border-b-2 border-[rgb(var(--color-marca-rgb)/0.25)]">
                      <SortableHeader label={t('lista.col_numero')} field="numero_albaran" ordering={ordering} onSort={handleSort} className={TH_BASE} />
                      {columnasActivas.map(renderColHeader)}
                      <th className="text-right px-4 py-3 font-bold uppercase tracking-wide text-[11px] text-gray-600">{t('lista.col_acciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expediciones.map(renderFila)}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas -- SOLO móvil. Misma información y misma acción
                  (⋮ Más acciones) que la tabla. */}
              <div className="md:hidden flex-1 min-h-0 overflow-y-auto">
                {expediciones.map(renderTarjeta)}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600 flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-2">
            {/* WCAG: el selector necesita nombre accesible (antes era un
                combobox mudo) y los textos del pie, contraste >= 4.5:1 sobre
                el fondo del listado (gray-500/400 se quedaban en 4.4 y 2.3). */}
            <span id="deca-filas-label" className="text-gray-700">{t('lista.filas_label')}</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}>
              <SelectTrigger className="h-8 w-20 text-xs" aria-labelledby="deca-filas-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-gray-600">{t('lista.total_expediciones', { total })}</span>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('lista.pagina_anterior')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2">{t('lista.paginacion', { page, totalPages })}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label={t('lista.pagina_siguiente')}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Anular expedición -- pide motivo con un Dialog propio, nunca
          window.confirm. */}
      <Dialog open={!!expedicionAnular} onOpenChange={(v) => !v && setExpedicionAnular(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Ban className="h-5 w-5" />
              {t('lista.dialog_anular_titulo')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 -mt-2">
            {t('lista.dialog_anular_desc', { numero: expedicionAnular?.numero_albaran || '' })}
          </p>
          <Textarea
            value={motivoAnular}
            onChange={(e) => setMotivoAnular(e.target.value)}
            placeholder={t('lista.dialog_anular_placeholder')}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpedicionAnular(null)} disabled={anulando}>
              {t('lista.dialog_anular_cancelar')}
            </Button>
            <Button variant="destructive" onClick={confirmarAnular} disabled={anulando}>
              {anulando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('lista.dialog_anular_confirmar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Borrar expedición -- solo anuladas que nunca llegaron a generar el
          DeCA oficial. Dialog propio, nunca window.confirm. */}
      <Dialog open={!!expedicionBorrar} onOpenChange={(v) => !v && setExpedicionBorrar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Trash2 className="h-5 w-5" />
              {t('lista.dialog_borrar_titulo')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 -mt-2">
            {t('lista.dialog_borrar_desc', { numero: expedicionBorrar?.numero_albaran || '' })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpedicionBorrar(null)} disabled={borrando}>
              {t('lista.dialog_anular_cancelar')}
            </Button>
            <Button variant="destructive" onClick={confirmarBorrar} disabled={borrando}>
              {borrando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('lista.btn_borrar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EnviarEmailDecaDialog
        expedicion={expedicionEmail}
        onOpenChange={(v) => !v && setExpedicionEmail(null)}
      />
    </div>
  )
}
