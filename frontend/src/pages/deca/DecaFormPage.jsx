import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { decaService } from '../../services/decaService'
import { useToast } from '../../context/ToastContext'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent } from '../../components/ui/card'
import ComboboxSelect from '../../components/ui/ComboboxSelect'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import {
  ArrowLeft, Save, CheckCircle2, FileText, Upload, Trash2, Plus, X, AlertCircle,
  Truck, Package, MapPin, Sparkles, Lock, ExternalLink, Loader2, ChevronDown,
  ChevronUp, User as UserIcon, Building2, QrCode, Search, Users, Route, Camera,
} from 'lucide-react'

// Tipos/estados fijos en el backend (deca/models.py) -- catálogo CERRADO de
// 3-4 valores, por eso van como <select> nativo y no como ComboboxSelect.
const TIPOS_DOCUMENTO = ['albaran_venta', 'cmr', 'otro']

const CAMPOS_OBLIGATORIOS = [
  'nif_cargador', 'nombre_cargador',
  'nif_transportista', 'nombre_transportista',
  'nif_destinatario', 'nombre_destinatario',
  'matricula_tractor', 'origen', 'destino',
  'fecha_hora_transporte', 'naturaleza_mercancia',
]

// Mismo CAMPOS_OBLIGATORIOS repartido por sección -- alimenta el contador
// "X/N" de cada acordeón. Conductor no tiene entrada aquí porque no lleva
// ningún campo obligatorio.
const CAMPOS_OBLIGATORIOS_POR_SECCION = {
  cargador: ['nif_cargador', 'nombre_cargador'],
  transportista: ['nif_transportista', 'nombre_transportista'],
  destinatario: ['nif_destinatario', 'nombre_destinatario'],
  transporte: ['matricula_tractor', 'origen', 'destino', 'fecha_hora_transporte'],
  mercancia: ['naturaleza_mercancia'],
}

function contarCompletos(campos, form) {
  const total = campos.length
  const hechos = campos.filter((c) => String(form[c] ?? '').trim() !== '').length
  return { hechos, total }
}

const FORM_VACIO = {
  numero_albaran: '', numero_cmr: '',
  nif_cargador: '', nombre_cargador: '',
  nif_transportista: '', nombre_transportista: '',
  nif_destinatario: '', nombre_destinatario: '',
  matricula_tractor: '', matricula_remolque: '',
  origen: '', destino: '',
  fecha_hora_transporte: '',
  naturaleza_mercancia: '', peso_kg: '', bultos: '', volumen_m3: '', codigo_mercancia: '',
  nombre_conductor: '', nif_conductor: '', telefono_conductor: '', email_conductor: '',
  numero_pedido: '', instrucciones_conductor: '', contacto_emergencias: '', tipo_contenedor: '',
  instrucciones_expedidor: '', instrucciones_pago: '', comentarios: '',
}

function soloMayusculasSinEspacios(v) {
  return (v || '').toUpperCase().replace(/\s+/g, '')
}

function isoADatetimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  // El envío (más abajo, `fecha_hora_transporte: form.fecha_hora_transporte`)
  // manda el valor del input tal cual, sin conversión -- el backend lo trata
  // como UTC literal. Para que el valor no se desplace al recargar, esta
  // función tiene que ser la inversa exacta: leer los componentes UTC,
  // nunca los locales.
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function expedicionAForm(exp) {
  return {
    numero_albaran: exp.numero_albaran ?? '', numero_cmr: exp.numero_cmr ?? '',
    nif_cargador: exp.nif_cargador ?? '', nombre_cargador: exp.nombre_cargador ?? '',
    nif_transportista: exp.nif_transportista ?? '', nombre_transportista: exp.nombre_transportista ?? '',
    nif_destinatario: exp.nif_destinatario ?? '', nombre_destinatario: exp.nombre_destinatario ?? '',
    matricula_tractor: exp.matricula_tractor ?? '', matricula_remolque: exp.matricula_remolque ?? '',
    origen: exp.origen ?? '', destino: exp.destino ?? '',
    fecha_hora_transporte: isoADatetimeLocal(exp.fecha_hora_transporte),
    naturaleza_mercancia: exp.naturaleza_mercancia ?? '',
    peso_kg: exp.peso_kg ?? '', bultos: exp.bultos ?? '',
    volumen_m3: exp.volumen_m3 ?? '', codigo_mercancia: exp.codigo_mercancia ?? '',
    nombre_conductor: exp.nombre_conductor ?? '', nif_conductor: exp.nif_conductor ?? '',
    telefono_conductor: exp.telefono_conductor ?? '', email_conductor: exp.email_conductor ?? '',
    numero_pedido: exp.numero_pedido ?? '', instrucciones_conductor: exp.instrucciones_conductor ?? '',
    contacto_emergencias: exp.contacto_emergencias ?? '', tipo_contenedor: exp.tipo_contenedor ?? '',
    instrucciones_expedidor: exp.instrucciones_expedidor ?? '', instrucciones_pago: exp.instrucciones_pago ?? '',
    comentarios: exp.comentarios ?? '',
  }
}

// Cabecera común de cada sección del formulario: icono + título + contador
// de obligatorios (si los tiene) + hueco para una acción extra (el botón de
// "Buscar en agenda") + el propio interruptor de plegar/desplegar.
function SeccionFormulario({ icono: Icono, titulo, contador, abierta, onToggle, accionExtra, children }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-0">
        <div className="w-full flex items-center justify-between gap-3 flex-wrap">
          <button type="button" className="flex items-center gap-2.5 min-w-0" onClick={onToggle}>
            <Icono className="h-5 w-5 text-[var(--color-marca)] shrink-0" />
            <h2 className="font-bold text-gray-900 truncate">{titulo}</h2>
            {contador && (
              <span className={`text-xs font-medium shrink-0 ${contador.hechos === contador.total ? 'text-emerald-600' : 'text-gray-400'}`}>
                {contador.hechos}/{contador.total}
              </span>
            )}
          </button>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            {accionExtra}
            <button
              type="button"
              onClick={onToggle}
              aria-label={abierta ? 'Contraer sección' : 'Expandir sección'}
              className="text-gray-400 hover:text-gray-600 p-1"
            >
              {abierta ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {abierta && <div className="pt-4 mt-4 border-t border-gray-100 space-y-4">{children}</div>}
      </CardContent>
    </Card>
  )
}

// Botón "Buscar en agenda" que abre el mismo ComboboxSelect de siempre en un
// desplegable anclado bajo el propio botón, sin navegar a ningún sitio ni
// perder lo ya escrito.
function BuscarAgendaBoton({ label, placeholder, opciones, onSeleccionar, disabled }) {
  const [abierto, setAbierto] = useState(false)
  const cajaRef = useRef(null)

  useEffect(() => {
    if (!abierto) return
    function alClicarFuera(e) {
      if (cajaRef.current && !cajaRef.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', alClicarFuera)
    return () => document.removeEventListener('mousedown', alClicarFuera)
  }, [abierto])

  if (disabled) return null
  return (
    <div className="relative" ref={cajaRef}>
      <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAbierto((v) => !v)}>
        <Search className="h-3.5 w-3.5" /> {label}
      </Button>
      {abierto && (
        <div className="absolute right-0 z-20 mt-2 w-[min(320px,calc(100vw-32px))]">
          <ComboboxSelect
            value=""
            onChange={(v) => { onSeleccionar(v); setAbierto(false) }}
            options={opciones}
            placeholder={placeholder}
            clearable={false}
            searchThreshold={0}
            size="sm"
          />
        </div>
      )}
    </div>
  )
}

export default function DecaFormPage() {
  const { t } = useTranslation('deca')
  const navigate = useNavigate()
  const toast = useToast()
  const { id: idRuta } = useParams()
  const [searchParams] = useSearchParams()
  // DecaDetailPage redirige aquí con `?id=` (query) cuando una expedición
  // en borrador/confirmado se abre para editar -- esta página no tiene una
  // ruta `/deca/nuevo/:id` propia, así que hay que aceptar el id por las
  // dos vías (parámetro de ruta futuro, o query actual) sin romper ninguna.
  const id = idRuta || searchParams.get('id') || undefined
  const manual = searchParams.get('manual') === '1'
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  const [expedicion, setExpedicion] = useState(null) // objeto completo devuelto por la API (incluye estado, documentos_origen, transportistas_sucesivos)
  const [form, setForm] = useState(FORM_VACIO)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [generando, setGenerando] = useState(false)
  // Borrar el borrador -- equivocación al teclear o cambio de última hora.
  // Solo mientras está en borrador (el backend ya lo exige).
  const [dialogBorrarAbierto, setDialogBorrarAbierto] = useState(false)
  const [borrandoExpedicion, setBorrandoExpedicion] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  // Documentos -- catálogo de conductores/transportistas para el combobox de
  // conveniencia (autocompletar), buscador local sobre la primera página.
  const [conductores, setConductores] = useState([])
  const [transportistasCatalogo, setTransportistasCatalogo] = useState([])
  const [destinatariosCatalogo, setDestinatariosCatalogo] = useState([])
  const [rolHabitual, setRolHabitual] = useState(null) // 'cargador' | 'transportista'
  const [tractorasCatalogo, setTractorasCatalogo] = useState([])
  const [remolquesCatalogo, setRemolquesCatalogo] = useState([])

  // Documentos ya subidos vienen embebidos en `expedicion.documentos_origen`.
  // Subir un archivo sin expedición todavía la crea en silencio primero
  // (ver handleSeleccionArchivo) -- no hay estado de "pendiente de guardar".
  const [subiendoDoc, setSubiendoDoc] = useState(false)
  const [extrayendoDocId, setExtrayendoDocId] = useState(null)
  const [mostrarDocumentos, setMostrarDocumentos] = useState(!manual)
  // Información adicional / Transportistas sucesivos -- opcionales,
  // colapsadas por defecto.
  const [mostrarInfoAdicional, setMostrarInfoAdicional] = useState(false)
  const [mostrarSucesivos, setMostrarSucesivos] = useState(false)
  // Cargador/Transportista/Destinatario/Transporte/Mercancía/Conductor llevan
  // datos obligatorios para poder Confirmar -- abiertas por defecto.
  const [seccionesAbiertas, setSeccionesAbiertas] = useState({
    cargador: true, transportista: true, destinatario: true,
    transporte: true, mercancia: true, conductor: true,
  })
  const alternarSeccion = (clave) => setSeccionesAbiertas((s) => ({ ...s, [clave]: !s[clave] }))
  const [tipoNuevoDoc, setTipoNuevoDoc] = useState('albaran_venta')
  const [extraerNuevoDoc, setExtraerNuevoDoc] = useState(true)
  const [sugerencias, setSugerencias] = useState(null)
  // Nombres de campo que se rellenaron vía IA (no regex) -- solo para
  // avisar con transparencia de dónde salió el dato.
  const [camposCompletadosIA, setCamposCompletadosIA] = useState([])

  const [sucesivos, setSucesivos] = useState([])
  const [nuevoSucesivo, setNuevoSucesivo] = useState({ nif: '', nombre: '', matricula: '' })
  const [guardandoSucesivo, setGuardandoSucesivo] = useState(false)

  const [dialogGenerarAbierto, setDialogGenerarAbierto] = useState(false)

  const set = (campo) => (val) => setForm((f) => ({ ...f, [campo]: val }))

  const readOnly = expedicion?.estado === 'generado' || expedicion?.estado === 'anulado'
  const puedeConfirmar = expedicion?.id && expedicion.estado === 'borrador'
  const puedeGenerar = expedicion?.id && expedicion.estado === 'confirmado'

  const hayDatosAdicionales = Boolean(
    form.instrucciones_conductor || form.contacto_emergencias || form.tipo_contenedor
    || form.instrucciones_expedidor || form.instrucciones_pago || form.comentarios,
  )

  // ── Carga inicial (modo edición) ──────────────────────────────────────────
  useEffect(() => {
    if (!id) {
      setExpedicion(null)
      setForm(FORM_VACIO)
      setLoading(false)
      return
    }
    if (expedicion?.id === Number(id)) return // ya cargada tras un guardado inicial (crear -> navigate replace)
    let cancelado = false
    setLoading(true)
    decaService.obtenerExpedicion(id)
      .then(({ data }) => {
        if (cancelado) return
        setExpedicion(data)
        setForm(expedicionAForm(data))
        setSucesivos(data.transportistas_sucesivos || [])
      })
      .catch(() => { if (!cancelado) setError(t('expedicion.error_cargar')) })
      .finally(() => { if (!cancelado) setLoading(false) })
    return () => { cancelado = true }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // El DeCA lo tienen que formalizar TANTO el cargador contractual como el
  // transportista efectivo (Orden FOM/2861/2012 art. 4, responsabilidad
  // solidaria en el art. 7), así que Appodo lo usan los dos lados. El rol
  // habitual (Configuración de DeCA) decide en qué campo se precarga NIF.
  useEffect(() => {
    decaService.obtenerConfiguracion()
      .then(({ data }) => setRolHabitual(data.rol_habitual || 'cargador'))
      .catch(() => setRolHabitual('cargador'))
  }, [])

  // TODO(standalone): en el ERP origen aquí se precargaba automáticamente el
  // NIF/nombre de la EMPRESA propia (multi-tenant, Empresa.cif/nombre) en el
  // campo cargador o transportista según `rolHabitual`. Este backend
  // standalone es de una sola instalación y no expone un CIF propio por API
  // (solo `EMPRESA_NOMBRE` como variable de entorno del servidor, usada en
  // el PDF/email, ver deca/views.py::_nombre_empresa) -- no hay campo de
  // formulario equivalente para precargar aquí. El usuario simplemente
  // rellena su propio NIF/nombre a mano la primera vez (o vía "Buscar en
  // agenda" si ya lo dio de alta como transportista/destinatario habitual).

  useEffect(() => {
    decaService.buscarConductores().then((r) => setConductores(r.data.results || r.data)).catch(() => {})
    decaService.buscarTransportistas().then((r) => setTransportistasCatalogo(r.data.results || r.data)).catch(() => {})
    decaService.buscarDestinatarios().then((r) => setDestinatariosCatalogo(r.data.results || r.data)).catch(() => {})
    decaService.buscarTractoras().then((r) => setTractorasCatalogo(r.data.results || r.data)).catch(() => {})
    decaService.buscarRemolques().then((r) => setRemolquesCatalogo(r.data.results || r.data)).catch(() => {})
  }, [])

  // ── Guardar (crear/actualizar) ────────────────────────────────────────────
  const construirPayload = () => ({
    numero_albaran: form.numero_albaran.trim(),
    numero_cmr: form.numero_cmr.trim(),
    nif_cargador: soloMayusculasSinEspacios(form.nif_cargador),
    nombre_cargador: form.nombre_cargador.trim(),
    nif_transportista: soloMayusculasSinEspacios(form.nif_transportista),
    nombre_transportista: form.nombre_transportista.trim(),
    nif_destinatario: soloMayusculasSinEspacios(form.nif_destinatario),
    nombre_destinatario: form.nombre_destinatario.trim(),
    matricula_tractor: soloMayusculasSinEspacios(form.matricula_tractor),
    matricula_remolque: soloMayusculasSinEspacios(form.matricula_remolque),
    origen: form.origen.trim(),
    destino: form.destino.trim(),
    fecha_hora_transporte: form.fecha_hora_transporte || null,
    naturaleza_mercancia: form.naturaleza_mercancia.trim(),
    peso_kg: form.peso_kg === '' ? null : form.peso_kg,
    bultos: form.bultos === '' ? null : parseInt(form.bultos, 10),
    volumen_m3: form.volumen_m3 === '' ? null : form.volumen_m3,
    codigo_mercancia: form.codigo_mercancia.trim(),
    nombre_conductor: form.nombre_conductor.trim(),
    nif_conductor: soloMayusculasSinEspacios(form.nif_conductor),
    telefono_conductor: form.telefono_conductor.trim(),
    email_conductor: form.email_conductor.trim(),
    numero_pedido: form.numero_pedido.trim(),
    instrucciones_conductor: form.instrucciones_conductor.trim(),
    contacto_emergencias: form.contacto_emergencias.trim(),
    tipo_contenedor: form.tipo_contenedor.trim(),
    instrucciones_expedidor: form.instrucciones_expedidor.trim(),
    instrucciones_pago: form.instrucciones_pago.trim(),
    comentarios: form.comentarios.trim(),
  })

  const validarObligatorios = () => {
    for (const campo of CAMPOS_OBLIGATORIOS) {
      const valor = form[campo]
      if (!valor || !String(valor).trim()) {
        const claveError = `error_${campo}`
        return t(`expedicion.${claveError}`, t('expedicion.error_generico_obligatorio', { campo: t(`expedicion.label_campo_${campo}`, campo) }))
      }
    }
    return null
  }

  const aplicarErroresBackend = (data) => {
    if (!data || typeof data !== 'object') return
    const campos = {}
    let mensaje = ''
    for (const [campo, valor] of Object.entries(data)) {
      const texto = Array.isArray(valor) ? valor.join(' ') : String(valor)
      if (campo === 'detail' || campo === 'non_field_errors') { mensaje = mensaje ? `${mensaje} ${texto}` : texto; continue }
      campos[campo] = texto
    }
    setFieldErrors(campos)
    if (!mensaje && Object.keys(campos).length > 0) {
      mensaje = Object.values(campos).join(' ')
    }
    setError(mensaje || t('expedicion.error_guardar'))
  }

  const handleGuardar = async (e) => {
    e?.preventDefault()
    const errorObligatorio = validarObligatorios()
    if (errorObligatorio) { setError(errorObligatorio); toast.error(errorObligatorio); return }
    setSaving(true)
    setError('')
    setFieldErrors({})
    const estadoAntes = expedicion?.estado
    try {
      const payload = construirPayload()
      if (expedicion?.id) {
        const { data } = await decaService.actualizarExpedicion(expedicion.id, payload)
        setExpedicion(data)
        setForm(expedicionAForm(data))
        // Editar una expedición ya CONFIRMADA la devuelve a BORRADOR en el
        // backend (medida de seguridad deliberada).
        if (estadoAntes === 'confirmado' && data.estado === 'borrador') {
          toast.info(t('mensajes.guardado_revertido_borrador'), 9000)
        } else {
          toast.success(t('mensajes.guardado_ok'))
        }
      } else {
        const { data } = await decaService.crearExpedicion(payload)
        setExpedicion(data)
        setForm(expedicionAForm(data))
        navigate(`/deca/${data.id}`, { replace: true })
        toast.success(t('mensajes.guardado_ok'))
      }
    } catch (err) {
      aplicarErroresBackend(err.response?.data)
      toast.error(t('expedicion.error_guardar'))
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmar = async () => {
    if (!expedicion?.id) return
    setConfirmando(true)
    setError('')
    setFieldErrors({})
    try {
      // Guardar ANTES de confirmar: el servidor comprueba el mínimo legal
      // contra lo que hay en BD, y lo que rellena la extracción vive solo
      // en el estado de React hasta que se guarda.
      try {
        const { data: guardada } = await decaService.actualizarExpedicion(expedicion.id, construirPayload())
        setExpedicion(guardada)
        setForm(expedicionAForm(guardada))
      } catch (errGuardado) {
        aplicarErroresBackend(errGuardado.response?.data)
        toast.error(t('expedicion.error_guardar'))
        setConfirmando(false)
        return
      }

      const { data } = await decaService.confirmarExpedicion(expedicion.id)
      setExpedicion(data)
      setForm(expedicionAForm(data))
      toast.success(t('mensajes.confirmada_ok'))
    } catch (err) {
      const d = err.response?.data
      if (d?.campos_faltantes?.length) {
        const nombres = d.campos_faltantes.map((c) => t(`expedicion.label_campo_${c}`, c)).join(', ')
        const msg = `${t('mensajes.datos_incompletos')} (${nombres})`
        setError(msg)
        toast.error(msg)
      } else {
        setError(t('mensajes.error_confirmacion'))
        toast.error(t('mensajes.error_confirmacion'))
      }
    } finally {
      setConfirmando(false)
    }
  }

  const [generandoPrevia, setGenerandoPrevia] = useState(false)

  const handleVistaPrevia = async () => {
    if (!expedicion?.id) return
    // `window.open` DESPUÉS de un `await` ya no cuenta como "respuesta
    // directa a un clic" para el navegador -- se abre la pestaña en blanco
    // AQUÍ, de forma síncrona dentro del propio clic, y se navega a la URL
    // real en cuanto el PDF llega.
    const ventana = window.open('', '_blank')
    setGenerandoPrevia(true)
    try {
      if (expedicion.estado === 'borrador') {
        try {
          const { data: guardada } = await decaService.actualizarExpedicion(expedicion.id, construirPayload())
          setExpedicion(guardada)
          setForm(expedicionAForm(guardada))
        } catch (errGuardado) {
          aplicarErroresBackend(errGuardado.response?.data)
          toast.error(t('expedicion.aviso_vista_previa_sin_guardar'))
        }
      }

      const { data } = await decaService.vistaPreviaExpedicion(expedicion.id)
      const url = URL.createObjectURL(data)
      if (ventana) {
        ventana.location.href = url
      } else {
        window.location.href = url
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      ventana?.close()
      toast.error(t('expedicion.error_vista_previa'))
    } finally {
      setGenerandoPrevia(false)
    }
  }

  const handleGenerar = async () => {
    if (!expedicion?.id) return
    setGenerando(true)
    setDialogGenerarAbierto(false)
    setError('')
    try {
      const { data } = await decaService.generarDeca(expedicion.id)
      setExpedicion(data)
      toast.success(t('expedicion.deca_generado'))
      navigate(`/deca/${expedicion.id}`, { replace: true })
    } catch (err) {
      const msg = err.response?.data?.detail || t('expedicion.deca_error')
      setError(msg)
      toast.error(msg)
    } finally {
      setGenerando(false)
    }
  }

  const handleBorrarExpedicion = async () => {
    if (!expedicion?.id) return
    setBorrandoExpedicion(true)
    try {
      await decaService.borrarExpedicion(expedicion.id)
      toast.success(t('expedicion.borrado_ok', 'Borrador eliminado.'))
      navigate('/deca', { replace: true })
    } catch (err) {
      toast.error(err.response?.data?.detail || t('expedicion.error_borrar', 'No se pudo borrar el borrador.'))
      setDialogBorrarAbierto(false)
    } finally {
      setBorrandoExpedicion(false)
    }
  }

  // ── Documentos origen ─────────────────────────────────────────────────────
  function fusionarSugerencias(acc, nuevas) {
    if (nuevas.nifs_encontrados?.length) {
      acc.nifs_encontrados = Array.from(new Set([...acc.nifs_encontrados, ...nuevas.nifs_encontrados]))
    }
    if (nuevas.matriculas_encontradas?.length) {
      acc.matriculas_encontradas = Array.from(new Set([...acc.matriculas_encontradas, ...nuevas.matriculas_encontradas]))
    }
    if (nuevas.peso_kg != null) acc.peso_kg = nuevas.peso_kg
    if (nuevas.bultos != null) acc.bultos = nuevas.bultos
    if (nuevas.fecha_hora_transporte) acc.fecha_hora_transporte = nuevas.fecha_hora_transporte
    return acc
  }

  // Rellena el formulario directamente con lo extraído del documento, sin
  // pedirle al usuario que pulse "Usar como X" campo a campo. Nunca pisa un
  // campo que el usuario ya haya rellenado a mano -- solo entra en los que
  // están vacíos.
  //
  // TODO(standalone): en el ERP origen se excluía el CIF de la propia
  // empresa (multi-tenant) de la lista de NIFs encontrados en el documento,
  // para no confundirlo con el del cliente/transportista. Sin una entidad
  // "empresa" en este backend standalone (ver TODO más arriba), esa
  // exclusión no se puede hacer -- se reparten TODOS los NIF encontrados
  // entre destinatario/transportista según `rolHabitual`, así que si el
  // propio NIF aparece en el documento puede colarse en el campo
  // equivocado; revisar siempre el resultado antes de confirmar.
  const autorellenarDesdeSugerencias = (nuevas) => {
    setForm((f) => {
      const siguiente = { ...f }
      const nifsRestantes = nuevas.nifs_encontrados || []
      const ordenRoles = rolHabitual === 'transportista'
        ? ['nif_cargador', 'nif_destinatario']
        : ['nif_destinatario', 'nif_transportista']
      let i = 0
      for (const campo of ordenRoles) {
        if (!siguiente[campo] && nifsRestantes[i]) { siguiente[campo] = nifsRestantes[i]; i += 1 }
      }

      const matriculas = nuevas.matriculas_encontradas || []
      if (!siguiente.matricula_tractor && matriculas[0]) siguiente.matricula_tractor = matriculas[0]
      if (!siguiente.matricula_remolque && matriculas[1]) siguiente.matricula_remolque = matriculas[1]

      if (!siguiente.peso_kg && nuevas.peso_kg != null) siguiente.peso_kg = String(nuevas.peso_kg)
      if (!siguiente.bultos && nuevas.bultos != null) siguiente.bultos = String(nuevas.bultos)
      if (!siguiente.fecha_hora_transporte && nuevas.fecha_hora_transporte) {
        const convertida = isoADatetimeLocal(nuevas.fecha_hora_transporte)
        if (convertida) siguiente.fecha_hora_transporte = convertida
      }
      return siguiente
    })
  }

  // Complemento por IA -- solo llega `campos_sugeridos_ia` cuando el regex
  // se quedó corto. A diferencia del regex, estos campos ya vienen
  // atribuidos por rol -- se aplican tal cual, sin heurística, y solo en
  // los campos que sigan vacíos.
  const aplicarCamposIA = (campos) => {
    if (!campos) return []
    const aplicados = []
    setForm((f) => {
      const siguiente = { ...f }
      for (const [campo, valor] of Object.entries(campos)) {
        if (valor == null || valor === '' || siguiente[campo]) continue
        if (campo === 'fecha_hora_transporte') {
          const iso = /Z$/.test(valor) ? valor : `${valor}Z`
          const convertida = isoADatetimeLocal(iso)
          if (!convertida) continue
          siguiente[campo] = convertida
        } else if (campo === 'nif_cargador' || campo === 'nif_transportista' || campo === 'nif_destinatario') {
          siguiente[campo] = soloMayusculasSinEspacios(String(valor))
        } else if (campo === 'matricula_tractor' || campo === 'matricula_remolque') {
          siguiente[campo] = soloMayusculasSinEspacios(String(valor))
        } else {
          siguiente[campo] = String(valor)
        }
        aplicados.push(campo)
      }
      return siguiente
    })
    return aplicados
  }

  const handleSeleccionArchivo = async (fileList) => {
    const archivos = Array.from(fileList || [])
    if (archivos.length === 0) return
    const permitidos = /\.(pdf|jpg|jpeg|png)$/i
    for (const f of archivos) {
      if (!permitidos.test(f.name)) { toast.error(t('expedicion.error_archivo_tipo')); return }
      if (f.size > 10 * 1024 * 1024) { toast.error(t('expedicion.error_archivo_tamano')); return }
    }

    let expedicionId = expedicion?.id
    if (!expedicionId) {
      setSaving(true)
      try {
        const { data } = await decaService.crearExpedicion(construirPayload())
        setExpedicion(data)
        setForm(expedicionAForm(data))
        navigate(`/deca/${data.id}`, { replace: true })
        expedicionId = data.id
      } catch (err) {
        aplicarErroresBackend(err.response?.data)
        toast.error(t('expedicion.error_guardar'))
        setSaving(false)
        return
      }
      setSaving(false)
    }

    setSubiendoDoc(true)
    const acumuladas = { nifs_encontrados: [], matriculas_encontradas: [], peso_kg: null, bultos: null, fecha_hora_transporte: null }
    let acumuladasIA = {}
    let huboExito = false
    for (const file of archivos) {
      try {
        const { data } = await decaService.subirDocumento(expedicionId, file, tipoNuevoDoc, { extraer: extraerNuevoDoc })
        huboExito = true
        if (data.campos_sugeridos) fusionarSugerencias(acumuladas, data.campos_sugeridos)
        if (data.campos_sugeridos_ia) acumuladasIA = { ...acumuladasIA, ...data.campos_sugeridos_ia }
      } catch {
        toast.error(t('expedicion.error_subir_doc'))
      }
    }
    setSubiendoDoc(false)
    if (huboExito) {
      toast.success(t('mensajes.guardado_ok'))
      try {
        const { data } = await decaService.obtenerExpedicion(expedicionId)
        setExpedicion(data)
      } catch { /* no crítico */ }
    }
    const huboRegex = acumuladas.nifs_encontrados.length || acumuladas.matriculas_encontradas.length
      || acumuladas.peso_kg || acumuladas.bultos || acumuladas.fecha_hora_transporte
    if (huboRegex) {
      setSugerencias(acumuladas)
      autorellenarDesdeSugerencias(acumuladas)
    }
    let camposAplicadosIA = []
    if (Object.keys(acumuladasIA).length > 0) {
      camposAplicadosIA = aplicarCamposIA(acumuladasIA)
      if (camposAplicadosIA.length > 0) {
        setCamposCompletadosIA(camposAplicadosIA)
        toast.info(t('expedicion.ia_completo_campos', 'La IA ha completado algunos campos que el regex no encontró -- revísalos.'))
      }
    }
    if (huboExito && extraerNuevoDoc && !huboRegex && camposAplicadosIA.length === 0) {
      toast.info(t(
        'expedicion.extraccion_sin_resultado_manual',
        'No se han podido leer datos de este documento (puede ser una foto borrosa, un escaneo de baja calidad o un formato distinto al habitual) -- rellena los campos a mano. Puedes volver a intentar la extracción con el botón "Extraer datos" de la lista de documentos.',
      ), 9000)
    }
  }

  const handleActualizarDocumento = async (doc, campo, valor) => {
    if (valor === doc[campo]) return
    setExpedicion((prev) => ({
      ...prev,
      documentos_origen: prev.documentos_origen.map((d) => (d.id === doc.id ? { ...d, [campo]: valor } : d)),
    }))
    try {
      await decaService.actualizarDocumento(doc.id, { [campo]: valor })
    } catch {
      toast.error(t('expedicion.error_guardar'))
      setExpedicion((prev) => ({
        ...prev,
        documentos_origen: prev.documentos_origen.map((d) => (d.id === doc.id ? doc : d)),
      }))
    }
  }

  const handleBorrarDocumento = async (doc) => {
    try {
      await decaService.borrarDocumento(doc.id)
      setExpedicion((prev) => ({
        ...prev,
        documentos_origen: prev.documentos_origen.filter((d) => d.id !== doc.id),
      }))
    } catch {
      toast.error(t('expedicion.error_guardar'))
    }
  }

  // Reintenta la extracción sobre un documento YA subido, sin volver a
  // subirlo.
  const handleExtraerDocumento = async (doc) => {
    setExtrayendoDocId(doc.id)
    try {
      const { data } = await decaService.extraerDocumento(doc.id)
      const huboRegex = data.campos_sugeridos && (
        data.campos_sugeridos.nifs_encontrados?.length || data.campos_sugeridos.matriculas_encontradas?.length
        || data.campos_sugeridos.peso_kg != null || data.campos_sugeridos.bultos != null
        || data.campos_sugeridos.fecha_hora_transporte
      )
      if (huboRegex) {
        setSugerencias(data.campos_sugeridos)
        autorellenarDesdeSugerencias(data.campos_sugeridos)
      }
      if (data.campos_sugeridos_ia) {
        const camposAplicados = aplicarCamposIA(data.campos_sugeridos_ia)
        if (camposAplicados.length > 0) setCamposCompletadosIA(camposAplicados)
      }
      if (!huboRegex && !data.campos_sugeridos_ia) {
        toast.info(t(
          'expedicion.extraccion_sin_resultado_manual',
          'No se han podido leer datos de este documento (puede ser una foto borrosa, un escaneo de baja calidad o un formato distinto al habitual) -- rellena los campos a mano. Puedes volver a intentar la extracción con el botón "Extraer datos" de la lista de documentos.',
        ), 9000)
      } else {
        toast.success(t('mensajes.guardado_ok'))
      }
    } catch {
      toast.error(t('expedicion.error_extraccion', 'No se pudo reintentar la extracción.'))
    } finally {
      setExtrayendoDocId(null)
    }
  }

  // ── Combobox de catálogos (conductor / transportista / tractora / remolque) ──
  const opcionesConductores = conductores.map((c) => ({ value: c.id, label: c.nombre, keywords: c.nif || '', meta: c }))
  const opcionesTransportistas = transportistasCatalogo.map((tr) => ({ value: tr.id, label: tr.nombre, keywords: tr.nif || '', meta: tr }))
  const opcionesDestinatarios = destinatariosCatalogo.map((d) => ({ value: d.id, label: d.nombre, keywords: d.nif || '', meta: d }))
  const opcionesTractoras = tractorasCatalogo.map((v) => ({ value: v.id, label: v.alias || v.matricula, keywords: v.matricula || '', meta: v }))
  const opcionesRemolques = remolquesCatalogo.map((v) => ({ value: v.id, label: v.alias || v.matricula, keywords: v.matricula || '', meta: v }))

  const seleccionarConductor = (val) => {
    const c = conductores.find((x) => x.id === val)
    if (!c) return
    setForm((f) => ({ ...f, nombre_conductor: c.nombre, nif_conductor: c.nif, telefono_conductor: c.telefono || '', email_conductor: c.email || '' }))
  }
  const seleccionarTransportista = (val) => {
    const tr = transportistasCatalogo.find((x) => x.id === val)
    if (!tr) return
    setForm((f) => ({ ...f, nombre_transportista: tr.nombre, nif_transportista: tr.nif }))
  }
  const seleccionarDestinatario = (val) => {
    const d = destinatariosCatalogo.find((x) => x.id === val)
    if (!d) return
    setForm((f) => ({ ...f, nombre_destinatario: d.nombre, nif_destinatario: d.nif }))
  }
  const seleccionarTractora = (val) => {
    const v = tractorasCatalogo.find((x) => x.id === val)
    if (!v) return
    setForm((f) => ({ ...f, matricula_tractor: v.matricula }))
  }
  const seleccionarRemolque = (val) => {
    const v = remolquesCatalogo.find((x) => x.id === val)
    if (!v) return
    setForm((f) => ({ ...f, matricula_remolque: v.matricula }))
  }

  // ── Transportistas sucesivos ──────────────────────────────────────────────
  const handleAgregarSucesivo = async () => {
    if (!expedicion?.id || !nuevoSucesivo.nombre.trim() || !nuevoSucesivo.nif.trim()) return
    setGuardandoSucesivo(true)
    try {
      const { data } = await decaService.crearTransportistaSucesivo(expedicion.id, {
        orden: sucesivos.length + 1,
        nif: soloMayusculasSinEspacios(nuevoSucesivo.nif),
        nombre: nuevoSucesivo.nombre.trim(),
        matricula: soloMayusculasSinEspacios(nuevoSucesivo.matricula),
      })
      setSucesivos((prev) => [...prev, data])
      setNuevoSucesivo({ nif: '', nombre: '', matricula: '' })
    } catch (err) {
      toast.error(err.response?.data?.detail || t('expedicion.error_guardar'))
    } finally {
      setGuardandoSucesivo(false)
    }
  }

  const handleActualizarSucesivo = async (item, campo, valor) => {
    const actualizado = { ...item, [campo]: valor }
    setSucesivos((prev) => prev.map((s) => (s.id === item.id ? actualizado : s)))
    try {
      await decaService.actualizarTransportistaSucesivo(item.id, { [campo]: campo === 'nif' || campo === 'matricula' ? soloMayusculasSinEspacios(valor) : valor })
    } catch {
      toast.error(t('expedicion.error_guardar'))
    }
  }

  const handleBorrarSucesivo = async (item) => {
    try {
      await decaService.borrarTransportistaSucesivo(item.id)
      setSucesivos((prev) => prev.filter((s) => s.id !== item.id))
    } catch {
      toast.error(t('expedicion.error_guardar'))
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-marca)]" />
      </div>
    )
  }

  const estadoBadge = expedicion?.estado && (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
      expedicion.estado === 'borrador' ? 'bg-gray-100 text-gray-600'
        : expedicion.estado === 'confirmado' ? 'bg-blue-100 text-blue-700'
          : expedicion.estado === 'generado' ? 'bg-green-100 text-green-700'
            : 'bg-red-100 text-red-700'
    }`}>
      {expedicion.estado === 'generado' && <CheckCircle2 className="h-3.5 w-3.5" />}
      {readOnly && <Lock className="h-3.5 w-3.5" />}
      {t(`estados.${expedicion.estado}`)}
    </span>
  )

  return (
    <div className="w-full max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto space-y-6 pb-20">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/deca')} className="rounded-full h-10 w-10">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              {expedicion?.id ? t('expedicion.editar') : t('expedicion.nueva')}
              {estadoBadge}
            </h1>
            <p className="text-gray-500 text-sm">
              {expedicion?.id ? t('expedicion.subtitle_editar') : t('expedicion.subtitle_nueva')}
            </p>
          </div>
        </div>
      </div>

      {readOnly && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-xl flex items-center gap-3">
          <Lock className="h-5 w-5 text-amber-600 shrink-0" />
          <p className="text-sm font-medium text-amber-800">{t('expedicion.solo_lectura_generada', 'Esta expedición ya se generó y no se puede editar. Consulta el PDF y el QR desde su ficha de detalle.')}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-800">{error}</p>
        </div>
      )}

      <form onSubmit={handleGuardar} className="space-y-6">

        {/* Documentos origen -- PRIMER bloque del formulario: subir aquí
            primero es lo que dispara el autorrelleno del resto de bloques. */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <button
              type="button"
              className="w-full flex items-center justify-between"
              onClick={() => setMostrarDocumentos((v) => !v)}
            >
              <div className="flex items-center gap-2.5">
                <FileText className="h-5 w-5 text-[var(--color-marca)]" />
                <div className="text-left">
                  <h2 className="font-bold text-gray-900">{t('expedicion.documentos')}</h2>
                  <p className="text-xs text-gray-500">{t('documentos.subtitle')}</p>
                </div>
              </div>
              {mostrarDocumentos ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
            </button>

            {mostrarDocumentos && (
              <div className="space-y-4 pt-2 border-t border-gray-100">
                {!readOnly && (
                  <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('documentos.label_tipo')}</Label>
                      <select
                        value={tipoNuevoDoc}
                        onChange={(e) => setTipoNuevoDoc(e.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {TIPOS_DOCUMENTO.map((tipo) => (
                          <option key={tipo} value={tipo}>{t(`tipos.${tipo === 'albaran_venta' ? 'alb_venta' : tipo}`)}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-600 h-10">
                      <input type="checkbox" checked={extraerNuevoDoc} onChange={(e) => setExtraerNuevoDoc(e.target.checked)} />
                      <Sparkles className="h-3.5 w-3.5 text-[var(--color-marca)]" />
                      {t('expedicion.extraer_datos_automaticamente', 'Intentar extraer datos automáticamente')}
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={subiendoDoc || saving}
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      {(subiendoDoc || saving) ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Camera className="h-4 w-4 mr-1.5" />}
                      {t('expedicion.btn_hacer_foto', 'Hacer foto')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={subiendoDoc || saving}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {(subiendoDoc || saving) ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                      {(subiendoDoc || saving) ? t('expedicion.btn_subiendo') : t('expedicion.btn_subir_doc')}
                    </Button>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => { handleSeleccionArchivo(e.target.files); e.target.value = '' }}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => { handleSeleccionArchivo(e.target.files); e.target.value = '' }}
                    />
                  </div>
                )}
                {!readOnly && <p className="text-[11px] text-gray-400">{t('expedicion.doc_tipos')}</p>}
                {!readOnly && (
                  <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
                    <Sparkles className="h-3 w-3 text-gray-300 shrink-0 mt-0.5" />
                    {t(
                      'expedicion.ayuda_extraccion_manual',
                      'La IA intenta rellenar los campos de abajo automáticamente al subir el documento. Si no es legible (foto borrosa, escaneo de baja calidad o un formato distinto al habitual), no encontrará nada -- en ese caso, completa los campos a mano tú mismo, no pasa nada.',
                    )}
                  </p>
                )}

                {expedicion?.documentos_origen?.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {expedicion.documentos_origen.map((doc) => (
                      <div key={doc.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 text-sm">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                          {readOnly ? (
                            <span className="truncate">{doc.nombre_original}</span>
                          ) : (
                            <Input
                              defaultValue={doc.nombre_original}
                              onBlur={(e) => handleActualizarDocumento(doc, 'nombre_original', e.target.value)}
                              className="h-8 text-sm"
                              aria-label={t('documentos.label_nombre', 'Nombre del documento')}
                            />
                          )}
                          {readOnly ? (
                            <span className="text-xs text-gray-400 shrink-0">
                              ({t(`tipos.${doc.tipo_documento === 'albaran_venta' ? 'alb_venta' : doc.tipo_documento}`)})
                            </span>
                          ) : (
                            <select
                              value={doc.tipo_documento}
                              onChange={(e) => handleActualizarDocumento(doc, 'tipo_documento', e.target.value)}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs shrink-0"
                              aria-label={t('documentos.label_tipo')}
                            >
                              {TIPOS_DOCUMENTO.map((tipo) => (
                                <option key={tipo} value={tipo}>{t(`tipos.${tipo === 'albaran_venta' ? 'alb_venta' : tipo}`)}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleExtraerDocumento(doc)}
                              disabled={extrayendoDocId === doc.id}
                              className="flex items-center gap-1 text-[var(--color-marca)] font-medium text-xs disabled:opacity-50"
                              aria-label={t('documentos.extraer_datos', 'Extraer datos de este documento')}
                            >
                              {extrayendoDocId === doc.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Sparkles className="h-3.5 w-3.5" />}
                              {extrayendoDocId === doc.id
                                ? t('documentos.extrayendo', 'Extrayendo...')
                                : t('documentos.extraer_datos_btn', 'Extraer datos')}
                            </button>
                          )}
                          <a href={doc.archivo} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[var(--color-marca)] font-medium text-xs">
                            {t('expedicion.ver_doc')} <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleBorrarDocumento(doc)}
                              className="text-red-400 hover:text-red-600"
                              aria-label={t('documentos.borrar', 'Eliminar documento')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !subiendoDoc ? (
                  <p className="text-sm text-gray-400">{t('expedicion.sin_documentos')}</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Resumen de lo extraído */}
        {(sugerencias || camposCompletadosIA.length > 0) && !readOnly && (
          <Card className="border-[rgb(var(--color-marca-rgb)/0.3)] bg-[rgb(var(--color-marca-rgb)/0.03)]">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[var(--color-marca)] font-bold text-sm">
                  <Sparkles className="h-4 w-4" /> {t('expedicion.datos_extraidos')}
                </div>
                <button type="button" onClick={() => { setSugerencias(null); setCamposCompletadosIA([]) }} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500">
                {t('expedicion.autorrellenado_desc', 'Ya se ha rellenado el formulario con estos datos -- revisa y corrige cualquier campo si hace falta antes de confirmar.')}
              </p>

              {sugerencias && (
                <div className="flex flex-wrap gap-2">
                  {sugerencias.nifs_encontrados?.map((nif) => (
                    <span key={nif} className="text-sm font-mono bg-white border border-gray-200 rounded px-2 py-1">{nif}</span>
                  ))}
                  {sugerencias.matriculas_encontradas?.map((m) => (
                    <span key={m} className="text-sm font-mono bg-white border border-gray-200 rounded px-2 py-1">{m}</span>
                  ))}
                  {sugerencias.peso_kg != null && (
                    <span className="text-sm bg-white border border-gray-200 rounded px-2 py-1">{t('expedicion.label_peso')}: <strong>{sugerencias.peso_kg}</strong></span>
                  )}
                  {sugerencias.bultos != null && (
                    <span className="text-sm bg-white border border-gray-200 rounded px-2 py-1">{t('expedicion.label_bultos')}: <strong>{sugerencias.bultos}</strong></span>
                  )}
                  {sugerencias.fecha_hora_transporte && (
                    <span className="text-sm bg-white border border-gray-200 rounded px-2 py-1">{t('expedicion.label_fecha_hora')}: <strong>{isoADatetimeLocal(sugerencias.fecha_hora_transporte)}</strong></span>
                  )}
                </div>
              )}

              {camposCompletadosIA.length > 0 && (
                <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-100 rounded-lg p-2.5">
                  <Sparkles className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-indigo-700">
                    {t('expedicion.ia_completo_campos_lista', 'Completado también por IA (el regex no lo encontró):')}{' '}
                    {camposCompletadosIA.map((c) => t(`expedicion.label_campo_${c}`, c)).join(', ')}
                    {' — '}{t('expedicion.ia_revisar', 'revisa que sea correcto.')}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Cargador */}
        <SeccionFormulario
          icono={Building2}
          titulo={t('expedicion.bloque_cargador', 'Cargador')}
          contador={contarCompletos(CAMPOS_OBLIGATORIOS_POR_SECCION.cargador, form)}
          abierta={seccionesAbiertas.cargador}
          onToggle={() => alternarSeccion('cargador')}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_numero_alb')}</Label>
              <Input value={form.numero_albaran} onChange={(e) => set('numero_albaran')(e.target.value)} placeholder={t('expedicion.placeholder_numero_alb')} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_numero_cmr', 'Nº de CMR')}</Label>
              <Input value={form.numero_cmr} onChange={(e) => set('numero_cmr')(e.target.value)} placeholder={t('expedicion.placeholder_numero_cmr', 'Solo si el transporte lleva CMR')} disabled={readOnly} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nif_remitente')} <span className="text-red-500">*</span></Label>
              <Input value={form.nif_cargador} onChange={(e) => set('nif_cargador')(e.target.value)} placeholder={t('expedicion.placeholder_nif_remitente')} disabled={readOnly} required />
              {fieldErrors.nif_cargador && <p className="text-xs text-red-600">{fieldErrors.nif_cargador}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nombre_remitente')} <span className="text-red-500">*</span></Label>
              <Input value={form.nombre_cargador} onChange={(e) => set('nombre_cargador')(e.target.value)} placeholder={t('expedicion.placeholder_nombre_remitente')} disabled={readOnly} required />
            </div>
          </div>
        </SeccionFormulario>

        {/* Transportista */}
        <SeccionFormulario
          icono={Truck}
          titulo={t('expedicion.bloque_transportista', 'Transportista')}
          contador={contarCompletos(CAMPOS_OBLIGATORIOS_POR_SECCION.transportista, form)}
          abierta={seccionesAbiertas.transportista}
          onToggle={() => alternarSeccion('transportista')}
          accionExtra={!readOnly && (
            <BuscarAgendaBoton
              label={t('expedicion.buscar_transportista_catalogo', 'Buscar en agenda')}
              placeholder={t('expedicion.placeholder_buscar_transportista', 'Buscar transportista guardado...')}
              opciones={opcionesTransportistas}
              onSeleccionar={seleccionarTransportista}
              disabled={readOnly}
            />
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nif_transportista')} <span className="text-red-500">*</span></Label>
              <Input value={form.nif_transportista} onChange={(e) => set('nif_transportista')(e.target.value)} placeholder={t('expedicion.placeholder_nif_transportista')} disabled={readOnly} required />
              {fieldErrors.nif_transportista && <p className="text-xs text-red-600">{fieldErrors.nif_transportista}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nombre_transportista')} <span className="text-red-500">*</span></Label>
              <Input value={form.nombre_transportista} onChange={(e) => set('nombre_transportista')(e.target.value)} placeholder={t('expedicion.placeholder_nombre_transportista')} disabled={readOnly} required />
            </div>
          </div>
        </SeccionFormulario>

        {/* Destinatario */}
        <SeccionFormulario
          icono={Users}
          titulo={t('expedicion.bloque_destinatario', 'Destinatario')}
          contador={contarCompletos(CAMPOS_OBLIGATORIOS_POR_SECCION.destinatario, form)}
          abierta={seccionesAbiertas.destinatario}
          onToggle={() => alternarSeccion('destinatario')}
          accionExtra={!readOnly && (
            <BuscarAgendaBoton
              label={t('expedicion.buscar_destinatario_catalogo', 'Buscar en agenda')}
              placeholder={t('expedicion.placeholder_buscar_destinatario', 'Buscar destinatario guardado...')}
              opciones={opcionesDestinatarios}
              onSeleccionar={seleccionarDestinatario}
              disabled={readOnly}
            />
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nif_destinatario')} <span className="text-red-500">*</span></Label>
              <Input value={form.nif_destinatario} onChange={(e) => set('nif_destinatario')(e.target.value)} placeholder={t('expedicion.placeholder_nif_destinatario')} disabled={readOnly} required />
              {fieldErrors.nif_destinatario && <p className="text-xs text-red-600">{fieldErrors.nif_destinatario}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nombre_destinatario')} <span className="text-red-500">*</span></Label>
              <Input value={form.nombre_destinatario} onChange={(e) => set('nombre_destinatario')(e.target.value)} placeholder={t('expedicion.placeholder_nombre_destinatario')} disabled={readOnly} required />
            </div>
          </div>
        </SeccionFormulario>

        {/* Transporte -- vehículo y ruta */}
        <SeccionFormulario
          icono={Route}
          titulo={t('expedicion.bloque_transporte', 'Transporte')}
          contador={contarCompletos(CAMPOS_OBLIGATORIOS_POR_SECCION.transporte, form)}
          abierta={seccionesAbiertas.transporte}
          onToggle={() => alternarSeccion('transporte')}
          accionExtra={!readOnly && (
            <div className="flex items-center gap-2 flex-wrap">
              <BuscarAgendaBoton
                label={t('expedicion.buscar_tractora_catalogo', 'Tractora')}
                placeholder={t('expedicion.placeholder_buscar_tractora', 'Buscar tractora guardada...')}
                opciones={opcionesTractoras}
                onSeleccionar={seleccionarTractora}
                disabled={readOnly}
              />
              <BuscarAgendaBoton
                label={t('expedicion.buscar_remolque_catalogo', 'Remolque')}
                placeholder={t('expedicion.placeholder_buscar_remolque', 'Buscar remolque guardado...')}
                opciones={opcionesRemolques}
                onSeleccionar={seleccionarRemolque}
                disabled={readOnly}
              />
            </div>
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_matricula_tractor')} <span className="text-red-500">*</span></Label>
              <Input value={form.matricula_tractor} onChange={(e) => set('matricula_tractor')(e.target.value)} placeholder={t('expedicion.placeholder_matricula_tractor')} disabled={readOnly} required />
              {fieldErrors.matricula_tractor && <p className="text-xs text-red-600">{fieldErrors.matricula_tractor}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_matricula_remolque')}</Label>
              <Input value={form.matricula_remolque} onChange={(e) => set('matricula_remolque')(e.target.value)} placeholder={t('expedicion.placeholder_matricula_remolque')} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_numero_pedido')}</Label>
              <Input value={form.numero_pedido} onChange={(e) => set('numero_pedido')(e.target.value)} placeholder={t('expedicion.placeholder_numero_pedido')} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_origen')} <span className="text-red-500">*</span></Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
                <Input className="pl-9" value={form.origen} onChange={(e) => set('origen')(e.target.value)} placeholder={t('expedicion.placeholder_origen')} disabled={readOnly} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_destino')} <span className="text-red-500">*</span></Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
                <Input className="pl-9" value={form.destino} onChange={(e) => set('destino')(e.target.value)} placeholder={t('expedicion.placeholder_destino')} disabled={readOnly} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_fecha_hora')} <span className="text-red-500">*</span></Label>
              <Input type="datetime-local" value={form.fecha_hora_transporte} onChange={(e) => set('fecha_hora_transporte')(e.target.value)} disabled={readOnly} required />
            </div>
          </div>
        </SeccionFormulario>

        {/* Mercancía */}
        <SeccionFormulario
          icono={Package}
          titulo={t('expedicion.bloque_mercancia', 'Mercancía')}
          contador={contarCompletos(CAMPOS_OBLIGATORIOS_POR_SECCION.mercancia, form)}
          abierta={seccionesAbiertas.mercancia}
          onToggle={() => alternarSeccion('mercancia')}
        >
          <div className="space-y-1.5">
            <Label>{t('expedicion.label_naturaleza')} <span className="text-red-500">*</span></Label>
            <Textarea rows={2} value={form.naturaleza_mercancia} onChange={(e) => set('naturaleza_mercancia')(e.target.value)} placeholder={t('expedicion.placeholder_naturaleza')} disabled={readOnly} required />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_peso')}</Label>
              <div className="relative">
                <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
                <Input className="pl-9" type="number" step="0.01" min="0" value={form.peso_kg} onChange={(e) => set('peso_kg')(e.target.value)} placeholder={t('expedicion.placeholder_peso')} disabled={readOnly} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_bultos')}</Label>
              <Input type="number" min="0" step="1" value={form.bultos} onChange={(e) => set('bultos')(e.target.value)} placeholder={t('expedicion.placeholder_bultos')} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_volumen')}</Label>
              <Input type="number" step="0.01" min="0" value={form.volumen_m3} onChange={(e) => set('volumen_m3')(e.target.value)} placeholder={t('expedicion.placeholder_volumen')} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_codigo_mercancia')}</Label>
              <Input value={form.codigo_mercancia} onChange={(e) => set('codigo_mercancia')(e.target.value)} placeholder={t('expedicion.placeholder_codigo_mercancia')} disabled={readOnly} />
            </div>
          </div>
        </SeccionFormulario>

        {/* Conductor -- sin campos obligatorios, sin contador */}
        <SeccionFormulario
          icono={UserIcon}
          titulo={<>{t('expedicion.bloque_conductor', 'Conductor')} <span className="text-xs text-gray-400 font-normal">{t('expedicion.conductor_opcional', '(opcional)')}</span></>}
          abierta={seccionesAbiertas.conductor}
          onToggle={() => alternarSeccion('conductor')}
          accionExtra={!readOnly && (
            <BuscarAgendaBoton
              label={t('expedicion.buscar_conductor_catalogo', 'Buscar en agenda')}
              placeholder={t('expedicion.placeholder_buscar_conductor', 'Buscar conductor guardado...')}
              opciones={opcionesConductores}
              onSeleccionar={seleccionarConductor}
              disabled={readOnly}
            />
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('expedicion.nombre', 'Nombre')}</Label>
              <Input value={form.nombre_conductor} onChange={(e) => set('nombre_conductor')(e.target.value)} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">NIF</Label>
              <Input value={form.nif_conductor} onChange={(e) => set('nif_conductor')(e.target.value)} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('expedicion.telefono', 'Teléfono')}</Label>
              <Input value={form.telefono_conductor} onChange={(e) => set('telefono_conductor')(e.target.value)} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.email_conductor} onChange={(e) => set('email_conductor')(e.target.value)} disabled={readOnly} />
            </div>
          </div>
        </SeccionFormulario>

        {/* Información adicional y Transportistas sucesivos -- tarjetas
            plegables al final del formulario, colapsadas por defecto. */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <button
              type="button"
              className="w-full flex items-center justify-between"
              onClick={() => setMostrarInfoAdicional((v) => !v)}
            >
              <div className="flex items-center gap-2.5">
                <FileText className="h-5 w-5 text-gray-400" />
                <div className="text-left">
                  <h2 className="font-bold text-gray-900 flex items-center gap-1.5">
                    {t('expedicion.bloque_adicional', 'Información adicional')}
                    {hayDatosAdicionales && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-marca)]" />}
                  </h2>
                  <p className="text-xs text-gray-500">{t('expedicion.bloque_adicional_desc', 'Opcional: si se deja en blanco, no aparece en el PDF.')}</p>
                </div>
              </div>
              {mostrarInfoAdicional ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
            </button>

            {mostrarInfoAdicional && (
              <div className="space-y-3 pt-2 border-t border-gray-100">
                <div className="space-y-1.5">
                  <Label>{t('expedicion.label_instrucciones_conductor')}</Label>
                  <Textarea rows={2} value={form.instrucciones_conductor} onChange={(e) => set('instrucciones_conductor')(e.target.value)} disabled={readOnly} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('expedicion.label_contacto_emergencias')}</Label>
                    <Input value={form.contacto_emergencias} onChange={(e) => set('contacto_emergencias')(e.target.value)} disabled={readOnly} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('expedicion.label_tipo_contenedor')}</Label>
                    <Input value={form.tipo_contenedor} onChange={(e) => set('tipo_contenedor')(e.target.value)} disabled={readOnly} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('expedicion.label_instrucciones_expedidor')}</Label>
                  <Textarea rows={2} value={form.instrucciones_expedidor} onChange={(e) => set('instrucciones_expedidor')(e.target.value)} disabled={readOnly} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('expedicion.label_instrucciones_pago')}</Label>
                  <Textarea rows={2} value={form.instrucciones_pago} onChange={(e) => set('instrucciones_pago')(e.target.value)} disabled={readOnly} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('expedicion.label_comentarios')}</Label>
                  <Textarea rows={2} value={form.comentarios} onChange={(e) => set('comentarios')(e.target.value)} disabled={readOnly} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <button
              type="button"
              className="w-full flex items-center justify-between"
              onClick={() => setMostrarSucesivos((v) => !v)}
            >
              <div className="flex items-center gap-2.5">
                <Truck className="h-5 w-5 text-gray-400" />
                <div className="text-left">
                  <h2 className="font-bold text-gray-900 flex items-center gap-1.5">
                    {t('expedicion.bloque_sucesivos', 'Transportistas sucesivos')}
                    {sucesivos.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-marca)]" />}
                  </h2>
                  <p className="text-xs text-gray-500">{t('expedicion.bloque_sucesivos_desc', 'Opcional: cadena de transportistas posteriores al efectivo (subcontratación).')}</p>
                </div>
              </div>
              {mostrarSucesivos ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
            </button>

            {mostrarSucesivos && (
              <div className="space-y-3 pt-2 border-t border-gray-100">
                {!expedicion?.id ? (
                  <p className="text-sm text-gray-400">{t('expedicion.sucesivos_requiere_guardar', 'Guarda primero el borrador para añadir transportistas sucesivos.')}</p>
                ) : expedicion.estado !== 'borrador' ? (
                  <p className="text-sm text-gray-400">{t('expedicion.sucesivos_solo_borrador', 'Solo se puede editar la cadena mientras la expedición está en borrador.')}</p>
                ) : (
                  <>
                    {sucesivos.map((s) => (
                      <div key={s.id} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                        <span className="text-xs font-bold text-gray-400 w-6 shrink-0">#{s.orden}</span>
                        <Input className="sm:flex-1" value={s.nombre} onChange={(e) => handleActualizarSucesivo(s, 'nombre', e.target.value)} placeholder={t('expedicion.label_nombre_remitente')} />
                        <Input className="sm:w-40" value={s.nif} onChange={(e) => handleActualizarSucesivo(s, 'nif', e.target.value)} placeholder="NIF/CIF" />
                        <Input className="sm:w-36" value={s.matricula} onChange={(e) => handleActualizarSucesivo(s, 'matricula', e.target.value)} placeholder={t('expedicion.placeholder_matricula_remolque')} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => handleBorrarSucesivo(s)} className="text-red-400 hover:text-red-600 shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center pt-2">
                      <span className="text-xs font-bold text-gray-300 w-6 shrink-0">#{sucesivos.length + 1}</span>
                      <Input className="sm:flex-1" value={nuevoSucesivo.nombre} onChange={(e) => setNuevoSucesivo((n) => ({ ...n, nombre: e.target.value }))} placeholder={t('expedicion.label_nombre_remitente')} />
                      <Input className="sm:w-40" value={nuevoSucesivo.nif} onChange={(e) => setNuevoSucesivo((n) => ({ ...n, nif: e.target.value }))} placeholder="NIF/CIF" />
                      <Input className="sm:w-36" value={nuevoSucesivo.matricula} onChange={(e) => setNuevoSucesivo((n) => ({ ...n, matricula: e.target.value }))} placeholder={t('expedicion.placeholder_matricula_remolque')} />
                      <Button type="button" size="sm" disabled={guardandoSucesivo || !nuevoSucesivo.nombre.trim() || !nuevoSucesivo.nif.trim()} onClick={handleAgregarSucesivo} className="shrink-0">
                        <Plus className="h-4 w-4 mr-1" /> {t('expedicion.anadir', 'Añadir')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Acciones */}
        {!readOnly && (
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-4">
            <Button
              type="submit"
              disabled={saving}
              variant={expedicion?.estado === 'confirmado' ? 'outline' : 'default'}
              className="w-full sm:w-auto"
              title={expedicion?.estado === 'confirmado' ? t('expedicion.aviso_guardar_revierte_borrador') : undefined}
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {saving
                ? t('expedicion.btn_guardando')
                : expedicion?.estado === 'confirmado'
                  ? t('expedicion.btn_guardar_confirmado', 'Corregir (vuelve a borrador)')
                  : (expedicion?.id ? t('expedicion.btn_guardar') : t('expedicion.btn_crear'))}
            </Button>

            {puedeConfirmar && (
              <Button type="button" variant="outline" disabled={confirmando} onClick={handleConfirmar} className="w-full sm:w-auto">
                {confirmando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                {t('expedicion.btn_confirmar')}
              </Button>
            )}

            {expedicion?.id && (puedeConfirmar || puedeGenerar) && (
              <Button type="button" variant="outline" disabled={generandoPrevia} onClick={handleVistaPrevia} className="w-full sm:w-auto">
                {generandoPrevia ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                {t('expedicion.btn_vista_previa', 'Vista previa')}
              </Button>
            )}

            {puedeGenerar && (
              <Button type="button" disabled={generando} onClick={() => setDialogGenerarAbierto(true)} className="w-full sm:w-auto bg-green-600 hover:bg-green-700">
                {generando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <QrCode className="h-4 w-4 mr-2" />}
                {generando ? t('expedicion.btn_generando') : t('expedicion.btn_generar_deca')}
              </Button>
            )}

            <Button type="button" variant="ghost" onClick={() => navigate('/deca')} className="w-full sm:w-auto">
              {t('expedicion.btn_cancelar')}
            </Button>

            {expedicion?.id && expedicion.estado === 'borrador' && (
              <Button
                type="button" variant="ghost" onClick={() => setDialogBorrarAbierto(true)}
                className="w-full sm:w-auto text-red-600 hover:text-red-700 hover:bg-red-50 sm:ml-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" /> {t('expedicion.btn_borrar_borrador', 'Borrar borrador')}
              </Button>
            )}
          </div>
        )}
      </form>

      {/* Confirmación de borrado -- pantalla propia, nunca window.confirm */}
      <Dialog open={dialogBorrarAbierto} onOpenChange={setDialogBorrarAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-700">{t('expedicion.dialog_borrar_titulo', 'Borrar este borrador')}</DialogTitle>
            <DialogDescription>
              {t(
                'expedicion.dialog_borrar_desc',
                'Se borra definitivamente, con los documentos adjuntos que tenga. Esta acción no se puede deshacer.',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogBorrarAbierto(false)} disabled={borrandoExpedicion}>
              {t('expedicion.btn_cancelar')}
            </Button>
            <Button variant="destructive" onClick={handleBorrarExpedicion} disabled={borrandoExpedicion} className="gap-2">
              {borrandoExpedicion && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('expedicion.btn_borrar_borrador', 'Borrar borrador')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación -- Generar DeCA bloquea la edición para siempre a partir de aquí */}
      <Dialog open={dialogGenerarAbierto} onOpenChange={setDialogGenerarAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-amber-500" /> {t('expedicion.btn_generar_deca')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'expedicion.confirmar_generar_desc',
                'Se generará el PDF y el QR oficiales -- normalmente cuando el camión ya está saliendo. A partir de este momento la expedición pasa a solo lectura: no podrás modificar ningún dato. Si después descubres un error, tendrás que anular esta expedición y crear una nueva; no se puede corregir un DeCA ya generado. Si todavía no estás seguro de los datos, usa "Vista previa" en vez de generar. ¿Continuar?',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogGenerarAbierto(false)}>{t('expedicion.btn_cancelar')}</Button>
            <Button onClick={handleGenerar} className="bg-green-600 hover:bg-green-700">{t('expedicion.btn_generar_deca')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
