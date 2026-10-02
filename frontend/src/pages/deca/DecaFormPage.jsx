import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { decaService } from '../../services/decaService'
import { reducirImagen } from '../../lib/reducirImagen'
import { useIsMobile } from '../../hooks/useIsMobile'
import AltaDecaMovil from '../../components/deca/movil/AltaDecaMovil'
import BuscadorAgendaDialog from '../../components/deca/BuscadorAgendaDialog'
import AyudaCuandoDeca from '../../components/deca/AyudaCuandoDeca'
import DecaImprimibleSinConexion from '../../components/deca/DecaImprimibleSinConexion'
import { validarIdentificadorFiscal } from '../../lib/validacionFiscal'
import { repartirPorPosicion } from '../../lib/decaReparto'
import {
  esErrorDeRed, guardarCacheDeca, leerCacheDeca, guardarEnCola, nuevaReferenciaOffline, nuevoTokenQr,
  pedirSincronizacionEnSegundoPlano, fechaPreparacionDeca,
} from '../../lib/decaOffline'
import { useToast } from '../../context/ToastContext'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent } from '../../components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import {
  ArrowLeft, Save, CheckCircle2, FileText, Upload, Trash2, Plus, X, AlertCircle,
  Truck, Package, MapPin, Sparkles, Lock, ExternalLink, Loader2, ChevronDown,
  ChevronUp, User as UserIcon, Building2, QrCode, Search, Users, Route,
  AlertTriangle, FileScan, Info,
} from 'lucide-react'

// Tipos/estados fijos en el backend (deca/models.py) -- catálogo CERRADO de
// 3-4 valores, por eso van como <select> nativo y no como ComboboxSelect.
const TIPOS_DOCUMENTO = ['albaran_venta', 'cmr', 'otro']

// Valor mientras llega la configuración: el de fábrica del backend (la norma
// no exige nada del destinatario). La lista REAL la manda el servidor en
// `configuracion.campos_obligatorios` (apps/deca/services/obligatorios_service.py),
// según `exigir_datos_destinatario` -- nunca se decide aquí por separado.
// Orden FOM/2861/2012 art. 6 vigente (revisado con el BOE 2026-09-30):
// también domicilio del cargador, remolque (salvo camión rígido) y peso; los
// bultos, por decisión del usuario.
const CAMPOS_OBLIGATORIOS_DEFECTO = [
  'nif_cargador', 'nombre_cargador', 'domicilio_cargador',
  'nif_transportista', 'nombre_transportista',
  'matricula_tractor', 'matricula_remolque', 'origen', 'destino',
  'fecha_hora_transporte', 'naturaleza_mercancia', 'peso_kg', 'bultos',
]

// Mismo CAMPOS_OBLIGATORIOS repartido por sección -- alimenta el contador
// "X/N" de cada acordeón. Conductor no tiene entrada aquí porque no lleva
// ningún campo obligatorio.
const CAMPOS_OBLIGATORIOS_POR_SECCION = {
  cargador: ['nif_cargador', 'nombre_cargador', 'domicilio_cargador'],
  transportista: ['nif_transportista', 'nombre_transportista'],
  destinatario: ['nif_destinatario', 'nombre_destinatario'],
  transporte: ['matricula_tractor', 'matricula_remolque', 'origen', 'destino', 'fecha_hora_transporte'],
  mercancia: ['naturaleza_mercancia', 'peso_kg', 'bultos'],
}

function contarCompletos(campos, form) {
  const total = campos.length
  const hechos = campos.filter((c) => String(form[c] ?? '').trim() !== '').length
  return { hechos, total }
}

const FORM_VACIO = {
  numero_albaran: '', numero_cmr: '',
  nif_cargador: '', nombre_cargador: '', domicilio_cargador: '',
  nif_transportista: '', nombre_transportista: '',
  nif_destinatario: '', nombre_destinatario: '',
  matricula_tractor: '', matricula_remolque: '', sin_remolque: false, autorizacion_especial: '',
  origen: '', destino: '',
  fecha_hora_transporte: '',
  naturaleza_mercancia: '', peso_kg: '', peso_estimado: false, bultos: '', volumen_m3: '', codigo_mercancia: '',
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

function formatearFechaLimite(iso) {
  if (!iso) return ''
  // Mismo criterio que DecaDetailPage.jsx::formatearFecha -- timeZone
  // 'UTC' fijo para que coincida siempre con el resto de fechas del módulo.
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  })
}

function expedicionAForm(exp) {
  return {
    numero_albaran: exp.numero_albaran ?? '', numero_cmr: exp.numero_cmr ?? '',
    nif_cargador: exp.nif_cargador ?? '', nombre_cargador: exp.nombre_cargador ?? '',
    domicilio_cargador: exp.domicilio_cargador ?? '',
    nif_transportista: exp.nif_transportista ?? '', nombre_transportista: exp.nombre_transportista ?? '',
    nif_destinatario: exp.nif_destinatario ?? '', nombre_destinatario: exp.nombre_destinatario ?? '',
    matricula_tractor: exp.matricula_tractor ?? '', matricula_remolque: exp.matricula_remolque ?? '',
    sin_remolque: Boolean(exp.sin_remolque), autorizacion_especial: exp.autorizacion_especial ?? '',
    origen: exp.origen ?? '', destino: exp.destino ?? '',
    fecha_hora_transporte: isoADatetimeLocal(exp.fecha_hora_transporte),
    naturaleza_mercancia: exp.naturaleza_mercancia ?? '',
    peso_kg: exp.peso_kg ?? '', peso_estimado: Boolean(exp.peso_estimado), bultos: exp.bultos ?? '',
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

// Botón "Buscar en agenda" junto al título de cada bloque, sin navegar a
// ningún sitio ni perder lo ya escrito (2026-09-24: antes era una fila fija
// por encima de cada bloque). Desde 2026-09-29 abre un diálogo centrado y amplio con buscador
// (components/deca/BuscadorAgendaDialog.jsx) en vez del desplegable de 320 px
// pegado al botón -- "muy pequeño y sin centrar" según el usuario.
function BuscarAgendaBoton({ label, opciones, onSeleccionar, disabled }) {
  const [abierto, setAbierto] = useState(false)

  if (disabled) return null
  return (
    <div className="relative">
      {/* Texto oculto en móvil -- con 2 de estos botones en la misma
          cabecera (Transporte: tractoras + remolques) el texto completo no
          cabe junto al título y al chevron de colapsar, y todo se apilaba en
          4 filas verticales (bug real detectado 2026-09-25 probando en
          producción con Playwright en 390px). Solo icono en móvil, aria-label
          conserva el texto para lector de pantalla. */}
      <Button type="button" variant="outline" size="sm" className="h-8 w-8 sm:w-auto p-0 sm:px-3 gap-1.5 text-xs" onClick={() => setAbierto(true)} aria-label={label}>
        <Search className="h-3.5 w-3.5 shrink-0" /> <span className="hidden sm:inline">{label}</span>
      </Button>
      <BuscadorAgendaDialog
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={label}
        opciones={opciones}
        onSeleccionar={onSeleccionar}
      />
    </div>
  )
}

export default function DecaFormPage() {
  const { t } = useTranslation('deca')
  const navigate = useNavigate()
  const toast = useToast()
  const { empresa, user } = useAuth()
  const { id: idRuta } = useParams()
  const [searchParams] = useSearchParams()
  // DecaDetailPage redirige aquí con `?id=` (query) cuando una expedición
  // en borrador/confirmado se abre para editar -- esta página no tiene una
  // ruta `/deca/nuevo/:id` propia, así que hay que aceptar el id por las
  // dos vías (parámetro de ruta futuro, o query actual) sin romper ninguna.
  const id = idRuta || searchParams.get('id') || undefined
  const manual = searchParams.get('manual') === '1'
  const fileInputRef = useRef(null)
  const formRef = useRef(null)

  const [expedicion, setExpedicion] = useState(null) // objeto completo devuelto por la API (incluye estado, documentos_origen, transportistas_sucesivos)
  const [form, setForm] = useState(FORM_VACIO)
  // Último formulario pintado, para leerlo desde funciones asíncronas sin
  // quedarse con una copia vieja del closure (ver aplicarCamposIA).
  const formActualRef = useRef(form)
  formActualRef.current = form
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [generando, setGenerando] = useState(false)
  // Borrar el borrador -- equivocación al teclear o cambio de última hora.
  // Solo mientras está en borrador (el backend ya lo exige).
  const [dialogBorrarAbierto, setDialogBorrarAbierto] = useState(false)
  const [borrandoExpedicion, setBorrandoExpedicion] = useState(false)
  const [error, setError] = useState('')
  // Sin cobertura: el DeCA se hace e imprime en el móvil y se registra solo
  // en Appodo cuando vuelve la red (lib/decaOffline.js).
  const [sinConexion, setSinConexion] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  const [fotosSinConexion, setFotosSinConexion] = useState([])
  const [decaParaImprimir, setDecaParaImprimir] = useState(null)
  // Configuración de DeCA → Trabajo en campo (valores por defecto = los de
  // fábrica, por si la configuración no llega).
  const [opcionesCampo, setOpcionesCampo] = useState({ modo: 'imprimir', ejemplares: 2, papel: false, anticipado: false })
  const [modoPapel, setModoPapel] = useState(false)
  // Motivo de la corrección de un DeCA ya generado (obligatorio por norma).
  const [motivoCorreccion, setMotivoCorreccion] = useState('')
  // Cuándo quedó preparado este móvil para trabajar sin red (agenda y
  // configuración guardadas); null = nunca; undefined = aún comprobándolo
  // (sin esto, al abrir sin red se veía un momento "no está preparado").
  const [preparadoEn, setPreparadoEn] = useState(undefined)
  const avisoSalirSinConexion = useRef(false)
  useEffect(() => {
    const alPerder = () => setSinConexion(true)
    const alRecuperar = () => setSinConexion(false)
    window.addEventListener('offline', alPerder)
    window.addEventListener('online', alRecuperar)
    return () => {
      window.removeEventListener('offline', alPerder)
      window.removeEventListener('online', alRecuperar)
    }
  }, [])
  const [fieldErrors, setFieldErrors] = useState({})

  // Documentos -- catálogo de conductores/transportistas para el combobox de
  // conveniencia (autocompletar), buscador local sobre la primera página.
  const [conductores, setConductores] = useState([])
  const [transportistasCatalogo, setTransportistasCatalogo] = useState([])
  const [destinatariosCatalogo, setDestinatariosCatalogo] = useState([])
  const [cargadoresCatalogo, setCargadoresCatalogo] = useState([])
  const [rolHabitual, setRolHabitual] = useState(null) // 'cargador' | 'transportista'
  const [camposObligatorios, setCamposObligatorios] = useState(CAMPOS_OBLIGATORIOS_DEFECTO)
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
  // Diferencias entre el documento y la Agenda (Configuración de DeCA → "La
  // agenda manda"): se usó la Agenda y se avisa para que una persona lo mire.
  const [avisosAgenda, setAvisosAgenda] = useState([])
  // Campos que la Agenda corrigió (coincidencia exacta) y NIF repartidos por
  // orden de aparición: se marcan para revisar, cada uno con SU explicación
  // (no la de "coincidencia parecida" de camposARevisar).
  const [camposAgenda, setCamposAgenda] = useState([])
  const [camposPorOrden, setCamposPorOrden] = useState([])
  const mostrarAvisosAgenda = (avisos, campos = []) => {
    setAvisosAgenda(avisos)
    setCamposAgenda(campos)
    avisos.forEach((a) => toast.info(a, 12000))
  }
  // Campos (nif_<rol> Y nombre_<rol>) que el backend rellenó por una
  // coincidencia DIFUSA con el catálogo (similar, no idéntica -- posible
  // error de OCR/transcripción de la IA, o una empresa distinta que se
  // parece) -- se marcan en rojo para que el usuario los confirme antes de
  // guardar. Pedido explícito del usuario 2026-09-25.
  const [camposARevisar, setCamposARevisar] = useState([])
  // Leídos por la IA de letra a mano o de una zona poco clara (distinto de
  // camposARevisar, que viene de la Agenda) y modelo de documento reconocido
  // (Configuración → Modelos de documento). v4.28.0.
  const [camposDudosos, setCamposDudosos] = useState([])
  const [plantillaAplicada, setPlantillaAplicada] = useState(null)
  // Dónde está escrito en la foto cada dato dudoso ({campo: {documentoId,
  // caja: [ymin, xmin, ymax, xmax] 0-1000]}): el móvil enseña ese trozo
  // ampliado junto a "¿Es este?" (fase 3 del aprendizaje, 2026-09-28).
  const [zonasDudosas, setZonasDudosas] = useState({})
  const anotarZonas = (documentoId, zonas) => {
    if (!zonas || !Object.keys(zonas).length) return
    setZonasDudosas((prev) => ({
      ...prev,
      ...Object.fromEntries(Object.entries(zonas).map(([campo, caja]) => [campo, { documentoId, caja }])),
    }))
  }

  const [sucesivos, setSucesivos] = useState([])
  const [nuevoSucesivo, setNuevoSucesivo] = useState({ nif: '', nombre: '', matricula: '' })
  const [guardandoSucesivo, setGuardandoSucesivo] = useState(false)

  const [dialogGenerarAbierto, setDialogGenerarAbierto] = useState(false)
  const [ayudaDecaAbierta, setAyudaDecaAbierta] = useState(false)

  const set = (campo) => (val) => {
    setForm((f) => ({ ...f, [campo]: val }))
    // En cuanto el usuario toca a mano un campo marcado "a revisar", ya lo
    // ha revisado -- quita el aviso de ESE campo en vez de obligarle a
    // cerrar toda la tarjeta para que desaparezca.
    setCamposARevisar((prev) => (prev.includes(campo) ? prev.filter((c) => c !== campo) : prev))
    setCamposDudosos((prev) => (prev.includes(campo) ? prev.filter((c) => c !== campo) : prev))
    // Al tocar un campo con error, su error se va (el rojo y el motivo); el
    // servidor lo vuelve a comprobar al guardar.
    setFieldErrors((prev) => {
      if (!(campo in prev)) return prev
      const { [campo]: _quitado, ...resto } = prev
      return resto
    })
  }
  // Borde rojo en el propio campo cuando el valor viene de una coincidencia
  // DIFUSA con el catálogo (ver camposARevisar) -- refuerza visualmente el
  // aviso de la tarjeta de arriba justo donde el usuario tiene que corregir.
  const claseSiRevisar = (campo) => (
    camposARevisar.includes(campo) || camposDudosos.includes(campo) || camposAgenda.includes(campo) || camposPorOrden.includes(campo) ? 'border-red-400 focus-visible:ring-red-400' : ''
  )

  // Campos obligatorios para Confirmar: FONDO AMARILLO siempre, relleno o no,
  // para saber de un vistazo cuáles son (pedido del usuario 2026-09-29; antes
  // esta función existía pero ningún campo la usaba). Franja a la izquierda:
  // ámbar mientras está vacío, verde una vez relleno. No depende solo del
  // color: el asterisco, la leyenda de arriba del formulario y
  // `aria-required` dicen lo mismo en texto.
  const obligatoriosEfectivos = camposObligatorios.filter((c) => !(c === 'matricula_remolque' && form.sin_remolque))
  const esObligatorio = (campo) => obligatoriosEfectivos.includes(campo)
  const claseCampo = (campo, extra = '') => {
    // Con un error del servidor (formato inválido, o falta al confirmar), el
    // campo se ve en rojo además de enseñar el motivo debajo (errorCampo).
    if (fieldErrors[campo]) return `${extra} border-2 border-red-500 bg-red-50 focus-visible:ring-red-400`.trim()
    const revisar = claseSiRevisar(campo)
    if (revisar || !esObligatorio(campo)) return `${extra} ${revisar}`.trim()
    return String(form[campo] ?? '').trim()
      ? `${extra} bg-[#FFF3C4] border-l-4 border-l-emerald-500`.trim()
      : `${extra} bg-[#FFF3C4] border-l-4 border-l-amber-500`.trim()
  }
  const marcaObligatorio = (campo) => (esObligatorio(campo)
    ? <span className="text-red-600 font-bold" aria-hidden="true"> *</span>
    : null)
  const contadorSeccion = (seccion) => {
    const campos = CAMPOS_OBLIGATORIOS_POR_SECCION[seccion].filter(esObligatorio)
    return campos.length ? contarCompletos(campos, form) : null
  }

  // `puede_editar` lo calcula siempre el backend (ExpedicionDecaSerializer.get_puede_editar):
  // false en anulado, y en generado solo dentro del plazo de gracia
  // configurado (ConfiguracionDeca.horas_max_edicion_generado) -- nunca se
  // recalculan las horas aquí, para que frontend y backend no puedan divergir.
  const readOnly = expedicion != null && expedicion.puede_editar === false
  const corrigiendoGenerado = expedicion?.estado === 'generado' && expedicion.puede_editar === true
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
    // `id` es un UUID (texto) -- comparar con `Number(id)` daba siempre NaN
    // y esta guarda nunca protegía nada: cada `navigate(..., {replace:true})`
    // tras crear la expedición (ver handleSeleccionArchivo) disparaba una
    // recarga de más, que si llegaba DESPUÉS del propio refresco del
    // flujo de subida pisaba el estado correcto y el documento recién
    // subido desaparecía de la pantalla hasta la siguiente acción (bug
    // real reportado 2026-09-25: la foto no aparecía hasta adjuntar otro
    // documento, que disparaba un refresco limpio sin esta carrera).
    if (expedicion?.id === id) return // ya cargada tras un guardado inicial (crear -> navigate replace)
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
  // habitual de la empresa (Configuración de DeCA) decide en qué campo se
  // precarga su propio NIF: antes se asumía siempre "cargador" y a una
  // empresa de transporte se le metía su CIF en la casilla equivocada.
  //
  // Configuración y agenda se guardan también en el móvil (decaOffline, por
  // empresa y usuario) para poder rellenar un DeCA SIN COBERTURA en la finca:
  // la copia solo se usa si la petición falla por red, nunca ante un 401/403.
  const aplicarConfiguracion = (data) => {
    setRolHabitual(data?.rol_habitual || 'cargador')
    if (Array.isArray(data?.campos_obligatorios)) setCamposObligatorios(data.campos_obligatorios)
    setOpcionesCampo({
      modo: data?.modo_sin_cobertura || 'imprimir',
      ejemplares: data?.ejemplares_sin_cobertura || 2,
      papel: Boolean(data?.registrar_papel_por_foto),
      anticipado: Boolean(data?.deca_anticipado),
    })
  }
  const aplicarAgenda = (agenda) => {
    if (agenda.conductores) setConductores(agenda.conductores)
    if (agenda.transportistas) setTransportistasCatalogo(agenda.transportistas)
    if (agenda.destinatarios) setDestinatariosCatalogo(agenda.destinatarios)
    if (agenda.cargadores) setCargadoresCatalogo(agenda.cargadores)
    if (agenda.tractoras) setTractorasCatalogo(agenda.tractoras)
    if (agenda.remolques) setRemolquesCatalogo(agenda.remolques)
  }
  useEffect(() => {
    let cancelado = false
    const lista = (r) => r.data.results || r.data
    const peticiones = {
      configuracion: decaService.obtenerConfiguracion().then((r) => r.data),
      conductores: decaService.buscarConductores().then(lista),
      transportistas: decaService.buscarTransportistas().then(lista),
      destinatarios: decaService.buscarDestinatarios().then(lista),
      cargadores: decaService.buscarCargadores().then(lista),
      tractoras: decaService.buscarTractoras().then(lista),
      remolques: decaService.buscarRemolques().then(lista),
    }
    const claves = Object.keys(peticiones)
    Promise.allSettled(Object.values(peticiones)).then(async (resultados) => {
      if (cancelado) return
      const buenos = {}
      let fallosDeRed = 0
      resultados.forEach((r, i) => {
        if (r.status === 'fulfilled') buenos[claves[i]] = r.value
        else if (esErrorDeRed(r.reason)) fallosDeRed += 1
      })
      if (fallosDeRed > 0) {
        setSinConexion(true)
        const copia = await leerCacheDeca(empresa?.id, user?.id)
        if (cancelado) return
        if (copia) {
          aplicarConfiguracion(buenos.configuracion || copia.configuracion)
          aplicarAgenda({ ...copia, ...buenos })
          setPreparadoEn(await fechaPreparacionDeca(empresa?.id, user?.id))
          return
        }
      }
      aplicarConfiguracion(buenos.configuracion)
      aplicarAgenda(buenos)
      if (fallosDeRed === 0 && resultados.every((r) => r.status === 'fulfilled')) {
        await guardarCacheDeca(empresa?.id, user?.id, buenos)
      }
      if (!cancelado) setPreparadoEn(await fechaPreparacionDeca(empresa?.id, user?.id))
    })
    return () => { cancelado = true }
  }, [empresa?.id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Solo se precarga cuando la empresa es TRANSPORTISTA (con su camión casi
  // siempre acierta). Como cargador ya NO: el cargador es quien contrata el
  // transporte, y muchas veces lo contrata el cliente (Distrinorte manda su
  // camión a recoger a Frutas del Sur). Precargarlo dejaba un DeCA con todo en verde
  // y el cargador equivocado, sin ningún aviso -- decisión del usuario
  // 2026-09-28: si no está claro, se deja en blanco y se elige con un toque
  // ("Nosotros" / "El cliente", ver atajosCargador).
  useEffect(() => {
    if (id || rolHabitual !== 'transportista' || !empresa?.cif || !empresa?.nombre) return
    const campoNif = 'nif_transportista'
    const campoNombre = 'nombre_transportista'
    setForm((f) => (
      // Nunca pisar lo que el usuario (o la extracción) ya haya puesto: el
      // rol llega de forma asíncrona y puede hacerlo después de escribir.
      f[campoNif] || f[campoNombre]
        ? f
        : { ...f, [campoNif]: soloMayusculasSinEspacios(empresa.cif), [campoNombre]: empresa.nombre }
    ))
  }, [id, rolHabitual, empresa?.cif, empresa?.nombre])

  // ── Guardar (crear/actualizar) ────────────────────────────────────────────
  const construirPayload = () => ({
    numero_albaran: form.numero_albaran.trim(),
    numero_cmr: form.numero_cmr.trim(),
    nif_cargador: soloMayusculasSinEspacios(form.nif_cargador),
    nombre_cargador: form.nombre_cargador.trim(),
    domicilio_cargador: form.domicilio_cargador.trim(),
    nif_transportista: soloMayusculasSinEspacios(form.nif_transportista),
    nombre_transportista: form.nombre_transportista.trim(),
    nif_destinatario: soloMayusculasSinEspacios(form.nif_destinatario),
    nombre_destinatario: form.nombre_destinatario.trim(),
    matricula_tractor: soloMayusculasSinEspacios(form.matricula_tractor),
    // Camión rígido: sin remolque, y la matrícula de remolque se vacía.
    matricula_remolque: form.sin_remolque ? '' : soloMayusculasSinEspacios(form.matricula_remolque),
    sin_remolque: Boolean(form.sin_remolque),
    autorizacion_especial: form.autorizacion_especial.trim(),
    origen: form.origen.trim(),
    destino: form.destino.trim(),
    fecha_hora_transporte: form.fecha_hora_transporte || null,
    naturaleza_mercancia: form.naturaleza_mercancia.trim(),
    peso_kg: form.peso_kg === '' ? null : form.peso_kg,
    // Solo se manda si la empresa trabaja con DeCA anticipado (el servidor lo rechaza si no).
    ...(opcionesCampo.anticipado || form.peso_estimado ? { peso_estimado: Boolean(form.peso_estimado) } : {}),
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
    for (const campo of obligatoriosEfectivos) {
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
    // Devuelve el motivo concreto ("El NIF/CIF del transportista «...» no es
    // válido...") para enseñarlo también en el aviso, no solo "No se pudo
    // guardar" (pedido del usuario 2026-09-29).
    return mensaje
  }

  // Obligatorios aún vacíos, con su etiqueta legible.
  const obligatoriosPendientes = () => obligatoriosEfectivos
    .filter((campo) => !form[campo] || !String(form[campo]).trim())
    .map((campo) => t(`expedicion.label_campo_${campo}`, campo))

  const handleGuardar = async (e) => {
    e?.preventDefault()
    // Un BORRADOR se guarda aunque falten obligatorios (pedido explícito del
    // usuario 2026-09-26): la extracción a veces no encuentra un NIF, y se
    // completa cuando se consigue sin volver a subir ni extraer el documento.
    // Los obligatorios se exigen al Confirmar (aquí y en el backend,
    // CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR). Una expedición ya confirmada o
    // generada sí se sigue validando entera al guardar.
    const esBorrador = !expedicion?.id || expedicion.estado === 'borrador'
    if (!esBorrador) {
      const errorObligatorio = validarObligatorios()
      if (errorObligatorio) { setError(errorObligatorio); toast.error(errorObligatorio); return }
    }
    const pendientes = esBorrador ? obligatoriosPendientes() : []
    const avisarGuardado = () => {
      if (pendientes.length > 0) {
        toast.info(t('mensajes.borrador_guardado_incompleto', {
          n: pendientes.length,
          campos: pendientes.join(', '),
          defaultValue: 'Borrador guardado. Para poder confirmarlo faltan {{n}} datos: {{campos}}. Puedes completarlos más tarde, sin volver a subir el documento.',
        }), 10000)
      } else {
        toast.success(t('mensajes.guardado_ok'))
      }
    }
    setSaving(true)
    setError('')
    setFieldErrors({})
    const estadoAntes = expedicion?.estado
    try {
      const payload = construirPayload()
      // Corregir un DeCA ya generado exige motivo (Resolución de 5-jun-2026,
      // apartado quinto): va al propio PDF junto a los datos anteriores.
      if (corrigiendoGenerado) {
        if (!motivoCorreccion.trim()) {
          setFieldErrors({ motivo_modificacion: t('campo.motivo_obligatorio') })
          setError(t('campo.motivo_obligatorio'))
          setSaving(false)
          document.getElementById('campo-motivo_modificacion')?.focus()
          return
        }
        payload.motivo_modificacion = motivoCorreccion.trim()
      }
      if (expedicion?.id) {
        const { data } = await decaService.actualizarExpedicion(expedicion.id, payload)
        if (corrigiendoGenerado) setMotivoCorreccion('')
        setExpedicion(data)
        setForm(expedicionAForm(data))
        // Editar una expedición ya CONFIRMADA la devuelve a BORRADOR en el
        // backend (medida de seguridad deliberada).
        if (estadoAntes === 'confirmado' && data.estado === 'borrador') {
          toast.info(t('mensajes.guardado_revertido_borrador'), 9000)
        } else if (estadoAntes === 'generado' && data.estado === 'generado') {
          toast.success(t('mensajes.correccion_guardada', 'Corrección guardada. El PDF se ha regenerado.'))
        } else {
          avisarGuardado()
        }
      } else {
        const { data } = await decaService.crearExpedicion(payload)
        setExpedicion(data)
        setForm(expedicionAForm(data))
        // Mismo motivo que en handleSeleccionArchivo: quedarse en el formulario
        // (un borrador se edita aquí), sin ida y vuelta por DecaDetailPage.
        navigate(`/deca/nuevo?id=${data.id}`, { replace: true })
        avisarGuardado()
      }
    } catch (err) {
      // El detalle va en el aviso rojo junto a los botones y en el propio campo.
        aplicarErroresBackend(err.response?.data)
        toast.error(t('expedicion.error_guardar_ver_aviso'))
    } finally {
      setSaving(false)
    }
  }

  // `silencioso`: desde el móvil confirmar y generar son un solo botón, y dos
  // avisos seguidos ("confirmada" + "generado") solo tapan la pantalla.
  const handleConfirmar = async ({ silencioso = false } = {}) => {
    if (!expedicion?.id) return false
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
        // Un NIF/CIF o matrícula con formato inválido corta aquí, y se
        // marca el campo concreto -- mucho más útil que el genérico
        // "faltan datos obligatorios" que devolvería el confirmar después.
        // El detalle va en el aviso rojo junto a los botones y en el propio campo.
        aplicarErroresBackend(errGuardado.response?.data)
        toast.error(t('expedicion.error_guardar_ver_aviso'))
        setConfirmando(false)
        return false
      }

      const { data } = await decaService.confirmarExpedicion(expedicion.id)
      setExpedicion(data)
      setForm(expedicionAForm(data))
      if (!silencioso) toast.success(t('mensajes.confirmada_ok'))
      return true
    } catch (err) {
      const d = err.response?.data
      if (d?.campos_faltantes?.length) {
        // "Falta rellenar: el NIF/CIF del transportista" -- directo, diciendo
        // qué dato y de quién (pedido del usuario 2026-09-29).
        const nombres = d.campos_faltantes.map((c) => t(`expedicion.label_campo_${c}`, c)).join(', ')
        const msg = t('mensajes.faltan_para_confirmar', { count: d.campos_faltantes.length, campos: nombres })
        // Cada dato que falta, marcado en su propio campo (y "Ir al campo").
        setFieldErrors(Object.fromEntries(d.campos_faltantes.map((c) => [c, t('expedicion.falta_este_dato')])))
        setError(msg)
        toast.error(msg, 9000)
      } else {
        setError(t('mensajes.error_confirmacion'))
        toast.error(t('mensajes.error_confirmacion'))
      }
      return false
    } finally {
      setConfirmando(false)
    }
  }

  const [generandoPrevia, setGenerandoPrevia] = useState(false)

  // Registrar un DeCA del talonario de papel con su foto (sin PDF ni QR: el
  // documento que viajó es el papel). Mismos datos obligatorios que un DeCA
  // de Appodo y al menos una foto del papel (RegistrarPapelExpedicionDecaView).
  const [registrandoPapel, setRegistrandoPapel] = useState(false)
  const handleRegistrarPapel = async () => {
    if (!expedicion?.id) return
    if (sinConexion) { setError(t('campo.papel_necesita_red')); return }
    setRegistrandoPapel(true)
    setError('')
    setFieldErrors({})
    try {
      if (expedicion.estado === 'borrador') {
        try {
          await decaService.actualizarExpedicion(expedicion.id, construirPayload())
        } catch (errGuardado) {
          aplicarErroresBackend(errGuardado.response?.data)
          return
        }
      }
      await decaService.registrarPapel(expedicion.id)
      toast.success(t('campo.papel_registrado_ok'))
      navigate('/deca')
    } catch (err) {
      const d = err.response?.data
      if (d?.campos_faltantes?.length) {
        const nombres = d.campos_faltantes.map((c) => t(`expedicion.label_campo_${c}`, c)).join(', ')
        setFieldErrors(Object.fromEntries(d.campos_faltantes.map((c) => [c, t('expedicion.falta_este_dato')])))
        setError(t('mensajes.faltan_para_confirmar', { count: d.campos_faltantes.length, campos: nombres }))
      } else if (d?.documentos_origen) {
        setError(t('campo.papel_falta_foto'))
      } else {
        setError(d?.detail || t('campo.papel_error'))
      }
    } finally {
      setRegistrandoPapel(false)
    }
  }

  const handleVistaPrevia = async () => {
    if (!expedicion?.id) return
    // `window.open` DESPUÉS de un `await` ya no cuenta como "respuesta
    // directa a un clic" para el navegador -- se abre la pestaña en blanco
    // AQUÍ, de forma síncrona dentro del propio clic, y se navega a la URL
    // real en cuanto el PDF llega.
    const ventana = window.open('', '_blank')
    setGenerandoPrevia(true)
    try {
      // Con lo que hay en pantalla, sin guardar (v4.31.2, pedido del usuario
      // 2026-09-29): antes se guardaba primero y el servidor pintaba lo de
      // BD -- si el guardado fallaba (un NIF o una matrícula con formato
      // inválido), la vista previa salía vacía o desfasada. Ahora el
      // servidor aplica estos datos solo en memoria, sin validar el formato
      // (la vista previa es justo para ver cómo queda), y nunca guarda nada.
      const { data } = await decaService.vistaPreviaConDatos(expedicion.id, construirPayload())
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
    if (nuevas.nombre_conductor) acc.nombre_conductor = nuevas.nombre_conductor
    if (nuevas.nif_conductor) acc.nif_conductor = nuevas.nif_conductor
    if (nuevas.peso_kg != null) acc.peso_kg = nuevas.peso_kg
    if (nuevas.bultos != null) acc.bultos = nuevas.bultos
    if (nuevas.fecha_hora_transporte) acc.fecha_hora_transporte = nuevas.fecha_hora_transporte
    return acc
  }

  // Rellena el formulario directamente con lo extraído del documento, sin
  // pedirle al usuario que pulse "Usar como X" campo a campo (pedido
  // explícito 2026-09-23: "quiero que rellene todos los campos... no
  // quiero trabajar"). Nunca pisa un campo que el usuario ya haya rellenado
  // a mano -- solo entra en los que están vacíos. Como el Cargador ya viene
  // precargado desde la propia empresa (ver efecto de arriba), el primer
  // NIF nuevo encontrado en el documento se asume Destinatario (el cliente,
  // el dato que más falta en un albarán/CMR) y el segundo, Transportista.
  const autorellenarDesdeSugerencias = (nuevas, ia = {}, nifsAgenda = {}) => {
    // NIF y matrículas sin papel: la Agenda manda, luego la IA, y el reparto
    // por orden es el último recurso (lib/decaReparto.js). Se calcula sobre el
    // último formulario pintado, fuera del updater (mismo motivo que en
    // aplicarCamposIA), para poder devolver qué campos hay que revisar.
    const { cambios, aRevisar } = repartirPorPosicion({
      form: formActualRef.current,
      regex: nuevas,
      ia,
      nifsAgenda,
      cifPropio: empresa?.cif ? soloMayusculasSinEspacios(empresa.cif) : null,
      rolHabitual,
    })
    setForm((f) => {
      const siguiente = { ...f }
      for (const [campo, valor] of Object.entries(cambios)) {
        if (!siguiente[campo]) siguiente[campo] = valor
      }
      if (!siguiente.peso_kg && nuevas.peso_kg != null) siguiente.peso_kg = String(nuevas.peso_kg)
      if (!siguiente.bultos && nuevas.bultos != null) siguiente.bultos = String(nuevas.bultos)
      if (!siguiente.fecha_hora_transporte && nuevas.fecha_hora_transporte) {
        const convertida = isoADatetimeLocal(nuevas.fecha_hora_transporte)
        if (convertida) siguiente.fecha_hora_transporte = convertida
      }
      if (!siguiente.nombre_conductor && nuevas.nombre_conductor) siguiente.nombre_conductor = nuevas.nombre_conductor
      if (!siguiente.nif_conductor && nuevas.nif_conductor) siguiente.nif_conductor = soloMayusculasSinEspacios(nuevas.nif_conductor)
      return siguiente
    })
    return aRevisar
  }

  // Complemento por IA -- solo llega `campos_sugeridos_ia` cuando el regex
  // se quedó corto (ver DocumentoOrigenDecaUploadView/extraction_ia_service.py).
  // A diferencia del regex, estos campos ya vienen atribuidos por rol
  // (nif_cargador/nif_transportista/nif_destinatario directamente, no una
  // lista sin decidir quién es quién) -- se aplican tal cual, sin
  // heurística, y solo en los campos que sigan vacíos.
  // Qué valor de la IA se escribiría en cada campo (null si no aplica).
  const valorIA = (campo, valor) => {
    if (valor == null || valor === '') return null
    if (campo === 'fecha_hora_transporte') {
      return isoADatetimeLocal(/Z$/.test(valor) ? valor : `${valor}Z`) || null
    }
    if (/^(nif_|matricula_)/.test(campo)) return soloMayusculasSinEspacios(String(valor))
    return String(valor)
  }
  const aplicarCamposIA = (campos) => {
    if (!campos) return []
    // La lista de aplicados se calcula FUERA del updater de setForm, sobre el
    // último formulario pintado: React no ejecuta el updater al momento si ya
    // hay otra actualización en cola (aquí siempre, por setExtrayendoDocId),
    // así que contarlos dentro devolvía [] y salía "No se han podido leer
    // datos" con los campos recién rellenados por la IA (bug real encontrado
    // 2026-09-28 probando la fase 3 en el navegador).
    const actual = formActualRef.current
    const aplicados = Object.entries(campos)
      .filter(([campo, valor]) => !actual[campo] && valorIA(campo, valor) !== null)
      .map(([campo]) => campo)
    setForm((f) => {
      const siguiente = { ...f }
      for (const [campo, valor] of Object.entries(campos)) {
        const nuevo = valorIA(campo, valor)
        if (nuevo !== null && !siguiente[campo]) siguiente[campo] = nuevo
      }
      return siguiente
    })
    return aplicados
  }

  const handleSeleccionArchivo = async (fileList) => {
    let archivos = Array.from(fileList || [])
    if (archivos.length === 0) return
    // .heic/.heif: fotos de iPhone -- el servidor las convierte a JPEG
    // (core/validacion_ficheros.py::preparar_documento).
    const permitidos = /\.(pdf|jpg|jpeg|png|heic|heif)$/i
    for (const f of archivos) {
      if (!permitidos.test(f.name)) { toast.error(t('expedicion.error_archivo_tipo')); return }
    }

    // iOS Safari, al volver de la Cámara/Fototeca, puede dejar la pestaña
    // en segundo plano el tiempo suficiente para liberar de memoria los
    // bytes del File ya seleccionado -- las cabeceras del POST se siguen
    // formando bien (multipart con boundary válido) pero el cuerpo llega
    // vacío al backend (diagnosticado en producción 2026-09-25: ni
    // siquiera `tipo_documento`, un campo de texto, llegaba). Forzamos la
    // lectura a memoria AQUÍ, justo tras la selección, para no depender de
    // que el navegador la difiera hasta construir la petición.
    try {
      archivos = await Promise.all(archivos.map(async (f) => {
        const buffer = await f.arrayBuffer()
        return new File([buffer], f.name, { type: f.type })
      }))
    } catch {
      toast.error(t('expedicion.error_subir_doc'))
      return
    }

    // Fotos grandes (iPhone de 24-48 MP: 10-15 MB) -> máx. 3000 px en JPEG.
    // El límite de 10 MB se comprueba DESPUÉS, sobre lo que de verdad se sube:
    // antes se comprobaba sobre el original y una foto de 12 MB se rechazaba
    // sin intentarlo (bug real en producción, 2026-09-26).
    archivos = await Promise.all(archivos.map((f) => reducirImagen(f)))
    for (const f of archivos) {
      if (f.size > 10 * 1024 * 1024) { toast.error(t('expedicion.error_archivo_tamano')); return }
    }

    // Sin cobertura: la foto se queda en el móvil y se sube al registrar el
    // DeCA. Sin red no hay lectura automática: se rellena a mano.
    const guardarFotosEnMovil = (lista) => {
      setSinConexion(true)
      setFotosSinConexion((prev) => [...prev, ...lista])
      setAltaManualMovil(true)
      toast.info(t('offline.foto_guardada'), 7000)
    }
    if (sinConexion || navigator.onLine === false) { guardarFotosEnMovil(archivos); return }

    let expedicionId = expedicion?.id
    if (!expedicionId) {
      setSaving(true)
      try {
        const { data } = await decaService.crearExpedicion(construirPayload())
        setExpedicion(data)
        setForm(expedicionAForm(data))
        // A `/deca/nuevo?id=`, NUNCA a `/deca/<id>`: esa ruta es DecaDetailPage,
        // así que ESTA página se desmontaba con la subida aún en marcha, la
        // ficha redirigía de vuelta aquí por ser borrador y el formulario
        // nuevo cargaba la expedición ANTES de que el documento terminara de
        // subir -- el documento no se veía y lo extraído por la IA se perdía
        // en un componente ya desmontado (bug real, 2026-09-26; el arreglo de
        // v4.26.1 no lo cubría porque su guarda vive en la instancia que muere).
        navigate(`/deca/nuevo?id=${data.id}`, { replace: true })
        expedicionId = data.id
      } catch (err) {
        if (esErrorDeRed(err)) { setSaving(false); guardarFotosEnMovil(archivos); return }
        // El detalle va en el aviso rojo junto a los botones y en el propio campo.
        aplicarErroresBackend(err.response?.data)
        toast.error(t('expedicion.error_guardar_ver_aviso'))
        setSaving(false)
        return
      }
      setSaving(false)
    }

    setSubiendoDoc(true)
    const acumuladas = { nifs_encontrados: [], matriculas_encontradas: [], peso_kg: null, bultos: null, fecha_hora_transporte: null, nombre_conductor: null, nif_conductor: null }
    let nifsAgendaAcum = {}
    const avisosAgendaAcum = []
    const camposAgendaAcum = []
    let acumuladasIA = {}
    const acumuladasARevisar = new Set()
    const acumuladosDudosos = new Set()
    let plantillaReconocida = null
    const documentosSubidos = []
    let huboExito = false
    let iaError = null
    // Paso 1 -- SUBIR, sin extraer: rápido, y el documento aparece en la lista
    // en cuanto está guardado. Antes subida y lectura con IA iban en la misma
    // petición y el documento no se veía hasta que la IA terminaba (decenas de
    // segundos con una foto; en móvil, a veces la respuesta ni llegaba).
    for (const file of archivos) {
      try {
        const { data } = await decaService.subirDocumento(expedicionId, file, tipoNuevoDoc)
        huboExito = true
        if (data.documento) documentosSubidos.push(data.documento)
      } catch (err) {
        if (esErrorDeRed(err)) { guardarFotosEnMovil([file]); continue }
        // Antes se descartaba el error real y solo se veía el toast genérico
        // -- sin esto, diagnosticar un fallo de subida (móvil, tamaño, tipo)
        // exige entrar por SSH a los logs de producción cada vez.
        console.error('Error al subir documento DeCA:', err.response?.data || err.message)
        // El backend explica POR QUÉ rechaza un fichero (no es un PDF real,
        // lleva JavaScript, está dañado...): enseñarlo, con el nombre.
        const motivo = [].concat(err.response?.data?.archivo || [])[0]
        toast.error(motivo ? `${file.name}: ${motivo}` : t('expedicion.error_subir_doc'), motivo ? 9000 : undefined)
      }
    }
    setSubiendoDoc(false)
    if (huboExito) {
      toast.success(t('mensajes.guardado_ok'))
      // El documento recién subido YA viene en la propia respuesta de la
      // subida (`data.documento`) -- se añade directamente al estado en
      // vez de depender EXCLUSIVAMENTE de una segunda petición GET que
      // puede fallar en silencio con una conexión móvil inestable justo
      // después de una subida grande (bug real reportado 2026-09-25: la
      // subida funcionaba perfectamente en el servidor, pero el documento
      // no aparecía en pantalla). El refresco de abajo sigue intentándose
      // como sincronización best-effort, ya no como única fuente de verdad.
      setExpedicion((prev) => (prev ? {
        ...prev,
        documentos_origen: [...(prev.documentos_origen || []), ...documentosSubidos],
      } : prev))
      try {
        const { data } = await decaService.obtenerExpedicion(expedicionId)
        setExpedicion(data)
      } catch { /* no crítico -- el estado ya se actualizó arriba */ }
    }

    // Paso 2 -- LEER con regex + IA, documento a documento, con el indicador
    // "extrayendo" en su propia fila (mismo endpoint que el botón "Extraer
    // datos"). Si falla, el documento ya está subido y a la vista.
    if (extraerNuevoDoc) {
      for (const doc of documentosSubidos) {
        setExtrayendoDocId(doc.id)
        try {
          const { data } = await decaService.extraerDocumento(doc.id)
          if (data.campos_sugeridos) fusionarSugerencias(acumuladas, data.campos_sugeridos)
          if (data.campos_sugeridos_ia) acumuladasIA = { ...acumuladasIA, ...data.campos_sugeridos_ia }
          if (data.nifs_agenda) nifsAgendaAcum = { ...nifsAgendaAcum, ...data.nifs_agenda }
          data.avisos_agenda?.forEach((a) => avisosAgendaAcum.push(a))
          data.campos_agenda?.forEach((c) => camposAgendaAcum.push(c))
          data.campos_a_revisar?.forEach((c) => acumuladasARevisar.add(c))
          data.campos_dudosos?.forEach((c) => acumuladosDudosos.add(c))
          anotarZonas(doc.id, data.zonas)
          if (data.plantilla_aplicada) plantillaReconocida = data.plantilla_aplicada
          if (data.ia_error) iaError = data.ia_error
        } catch (err) {
          console.error('Error al extraer datos del documento DeCA:', err.response?.data || err.message)
          iaError = iaError || t('expedicion.error_extraer_tras_subir', 'El documento se ha subido, pero no se ha podido leer ahora. Prueba con el botón "Extraer datos".')
        }
      }
      setExtrayendoDocId(null)
    }

    const huboRegex = acumuladas.nifs_encontrados.length || acumuladas.matriculas_encontradas.length
      || acumuladas.peso_kg || acumuladas.bultos || acumuladas.fecha_hora_transporte
      || acumuladas.nombre_conductor || acumuladas.nif_conductor
    if (huboRegex) {
      setSugerencias(acumuladas)
      setCamposPorOrden(autorellenarDesdeSugerencias(acumuladas, acumuladasIA, nifsAgendaAcum))
    }
    mostrarAvisosAgenda(avisosAgendaAcum, camposAgendaAcum)
    if (acumuladasARevisar.size > 0) setCamposARevisar([...acumuladasARevisar])
    if (acumuladosDudosos.size > 0) setCamposDudosos([...acumuladosDudosos])
    if (plantillaReconocida) setPlantillaAplicada(plantillaReconocida)
    let camposAplicadosIA = []
    if (Object.keys(acumuladasIA).length > 0) {
      camposAplicadosIA = aplicarCamposIA(acumuladasIA)
      if (camposAplicadosIA.length > 0) {
        setCamposCompletadosIA(camposAplicadosIA)
        toast.info(t('expedicion.ia_completo_campos', 'La IA ha completado algunos campos que el regex no encontró -- revísalos.'))
      }
    }
    // Ni el regex ni la IA encontraron nada -- documento no legible (foto
    // borrosa, escaneo de mala calidad, formato muy distinto al habitual).
    // Antes esto pasaba en silencio: el documento se subía bien (toast
    // "Guardado") pero el formulario se quedaba vacío sin explicar por qué,
    // así que parecía que algo había fallado. Pedido explícito del usuario
    // 2026-09-24: decir claramente que toca rellenar a mano.
    if (iaError) {
      avisarIANoDisponible(iaError)
    } else if (huboExito && extraerNuevoDoc && !huboRegex && camposAplicadosIA.length === 0) {
      toast.info(t(
        'expedicion.extraccion_sin_resultado_manual',
        'No se han podido leer datos de este documento (puede ser una foto borrosa, un escaneo de baja calidad o un formato distinto al habitual) -- rellena los campos a mano. Puedes volver a intentar la extracción con el botón "Extraer datos" de la lista de documentos.',
      ), 9000)
    }
  }

  // La IA FALLÓ (cuota agotada, servicio saturado...) -- no es lo mismo que
  // "leyó el documento y no encontró nada". Antes ambos casos enseñaban el
  // mensaje de "foto borrosa", y el usuario buscaba el problema en la foto o
  // en el móvil cuando era la cuota de Gemini (2026-09-25). El motivo viene
  // ya redactado del backend (core/ai.py).
  const avisarIANoDisponible = (motivo) => {
    toast.error(`${t('expedicion.ia_no_disponible', 'La IA no ha podido leer el documento.')} ${motivo}`, 12000)
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
        || data.campos_sugeridos.nombre_conductor || data.campos_sugeridos.nif_conductor
      )
      if (huboRegex) {
        setSugerencias(data.campos_sugeridos)
        setCamposPorOrden(autorellenarDesdeSugerencias(data.campos_sugeridos, data.campos_sugeridos_ia || {}, data.nifs_agenda || {}))
      }
      mostrarAvisosAgenda(data.avisos_agenda || [], data.campos_agenda || [])
      if (data.campos_sugeridos_ia) {
        const camposAplicados = aplicarCamposIA(data.campos_sugeridos_ia)
        if (camposAplicados.length > 0) setCamposCompletadosIA(camposAplicados)
      }
      if (data.campos_a_revisar?.length > 0) setCamposARevisar(data.campos_a_revisar)
      if (data.campos_dudosos?.length > 0) setCamposDudosos(data.campos_dudosos)
      anotarZonas(doc.id, data.zonas)
      if (data.plantilla_aplicada) setPlantillaAplicada(data.plantilla_aplicada)
      if (data.ia_error) {
        avisarIANoDisponible(data.ia_error)
      } else if (!huboRegex && !data.campos_sugeridos_ia) {
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
  const opcionesCargadores = cargadoresCatalogo.map((c) => ({ value: c.id, label: c.nombre, keywords: c.nif || '', meta: c }))
  const opcionesTractoras = tractorasCatalogo.map((v) => ({ value: v.id, label: v.alias || v.matricula, keywords: v.matricula || '', meta: v }))
  const opcionesRemolques = remolquesCatalogo.map((v) => ({ value: v.id, label: v.alias || v.matricula, keywords: v.matricula || '', meta: v }))

  const seleccionarConductor = (val) => {
    const c = conductores.find((x) => x.id === val)
    if (!c) return
    setForm((f) => ({ ...f, nombre_conductor: c.nombre, nif_conductor: c.nif, telefono_conductor: c.telefono || '', email_conductor: c.email || '' }))
    quitarDeRevisar('nombre_conductor', 'nif_conductor')
  }
  // Elegir a mano en "Buscar en agenda" también cuenta como revisado --
  // quita el aviso rojo del par nombre/nif de ese rol si lo tuviera.
  const quitarDeRevisar = (...campos) => setCamposARevisar((prev) => prev.filter((c) => !campos.includes(c)))
  const seleccionarTransportista = (val) => {
    const tr = transportistasCatalogo.find((x) => x.id === val)
    if (!tr) return
    setForm((f) => ({ ...f, nombre_transportista: tr.nombre, nif_transportista: tr.nif }))
    quitarDeRevisar('nombre_transportista', 'nif_transportista')
  }
  const seleccionarDestinatario = (val) => {
    const d = destinatariosCatalogo.find((x) => x.id === val)
    if (!d) return
    setForm((f) => ({ ...f, nombre_destinatario: d.nombre, nif_destinatario: d.nif }))
    quitarDeRevisar('nombre_destinatario', 'nif_destinatario')
  }
  const seleccionarCargador = (val) => {
    const c = cargadoresCatalogo.find((x) => x.id === val)
    if (!c) return
    setForm((f) => ({ ...f, nombre_cargador: c.nombre, nif_cargador: c.nif, domicilio_cargador: c.domicilio || f.domicilio_cargador }))
    quitarDeRevisar('nombre_cargador', 'nif_cargador')
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

  // ── Alta desde el MÓVIL (components/deca/movil/AltaDecaMovil.jsx) ─────────
  // Pantalla propia a pantalla completa, pensada para el muelle a pleno sol
  // (rediseño elegido por el usuario 2026-09-27, ver docs/marketing/deca/).
  // Reutiliza TODO el estado y los handlers de esta página -- solo cambia la
  // presentación. Corregir un DeCA ya generado o verlo en solo lectura sigue
  // usando el formulario de siempre, que ya se adapta a móvil.
  const isMobile = useIsMobile()
  const altaMovil = isMobile && !readOnly && !corrigiendoGenerado
  const [altaManualMovil, setAltaManualMovil] = useState(false)
  const [estadoGuardado, setEstadoGuardado] = useState('guardado')
  const ultimoGuardado = useRef(null)
  const creandoBorrador = useRef(false)

  // Guardado automático del borrador (solo móvil): sin botón "Guardar", el
  // trabajador no tiene que acordarse de nada. Solo en BORRADOR -- un PATCH
  // sobre una expedición confirmada la devolvería a borrador.
  const guardarBorradorMovil = async () => {
    const payload = construirPayload()
    const firma = JSON.stringify(payload)
    if (firma === ultimoGuardado.current) { setEstadoGuardado('guardado'); return true }
    if (creandoBorrador.current) return false
    setEstadoGuardado('guardando')
    try {
      if (expedicion?.id) {
        await decaService.actualizarExpedicion(expedicion.id, payload)
      } else {
        creandoBorrador.current = true
        const { data } = await decaService.crearExpedicion(payload)
        setExpedicion(data)
        navigate(`/deca/nuevo?id=${data.id}`, { replace: true })
      }
      ultimoGuardado.current = firma
      setFieldErrors({})
      setEstadoGuardado('guardado')
      return true
    } catch (err) {
      // Sin cobertura: lo escrito sigue en pantalla; se registra al generar.
      if (esErrorDeRed(err)) {
        setSinConexion(true)
        ultimoGuardado.current = firma
        setEstadoGuardado('sin_conexion')
        return false
      }
      // Un NIF o una matrícula con formato inválido: se marca en su campo,
      // sin cartel de error general (el trabajador sigue escribiendo).
      const campos = {}
      for (const [campo, valor] of Object.entries(err.response?.data || {})) {
        if (campo !== 'detail' && campo !== 'non_field_errors') campos[campo] = [].concat(valor).join(' ')
      }
      setFieldErrors(campos)
      setEstadoGuardado('error')
      return false
    } finally {
      creandoBorrador.current = false
    }
  }

  useEffect(() => {
    if (!altaMovil || saving || subiendoDoc || extrayendoDocId || confirmando || generando) return undefined
    const esBorrador = expedicion?.id ? expedicion.estado === 'borrador' : altaManualMovil
    if (!esBorrador) return undefined
    // Lo primero que se ve de un borrador ya existente cuenta como guardado.
    if (ultimoGuardado.current === null && expedicion?.id) {
      ultimoGuardado.current = JSON.stringify(construirPayload())
      return undefined
    }
    if (JSON.stringify(construirPayload()) === ultimoGuardado.current) return undefined
    setEstadoGuardado('pendiente')
    const temporizador = setTimeout(guardarBorradorMovil, 1500)
    return () => clearTimeout(temporizador)
  }, [form, altaMovil, expedicion?.id, expedicion?.estado, altaManualMovil, saving, subiendoDoc, extrayendoDocId, confirmando, generando]) // eslint-disable-line react-hooks/exhaustive-deps

  const empezarManualMovil = () => {
    // El formulario de partida (con el CIF propio ya precargado) no se
    // guarda solo: el borrador nace con el primer dato que escriba.
    ultimoGuardado.current = JSON.stringify(construirPayload())
    setAltaManualMovil(true)
  }

  const salirMovil = async () => {
    // Sin cobertura, salir pierde lo escrito (no hay borrador en el servidor):
    // se avisa una vez, y un segundo toque sale igualmente.
    if (sinConexion && !avisoSalirSinConexion.current && (altaManualMovil || fotosSinConexion.length)) {
      avisoSalirSinConexion.current = true
      setError(t('offline.salir_aviso'))
      return
    }
    if (sinConexion) { navigate('/deca'); return }
    if (expedicion?.estado === 'borrador' || (!expedicion?.id && altaManualMovil)) {
      const ok = await guardarBorradorMovil()
      if (!ok && expedicion?.id) return // queda el aviso en el campo, no se pierde nada
    }
    navigate('/deca')
  }

  const confirmarCampoMovil = (campo) => {
    setCamposARevisar((prev) => prev.filter((c) => c !== campo))
    setCamposDudosos((prev) => prev.filter((c) => c !== campo))
    setCamposCompletadosIA((prev) => prev.filter((c) => c !== campo))
  }

  // Domicilio de la propia empresa (EMPRESA_DOMICILIO del .env), para "Lo
  // contratamos nosotros": el domicilio del cargador es obligatorio (art. 6.a).
  const domicilioPropio = [empresa?.direccion, [empresa?.cp, empresa?.municipio].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')
  // Domicilio de un cargador ya guardado en la agenda, por NIF.
  const domicilioEnAgenda = (nif) => cargadoresCatalogo.find((x) => x.nif === nif)?.domicilio || ''

  const CAMPOS_POR_AGENDA = {
    cargadores: ['nombre_cargador', 'nif_cargador', 'domicilio_cargador'],
    transportistas: ['nombre_transportista', 'nif_transportista'],
    destinatarios: ['nombre_destinatario', 'nif_destinatario'],
    conductores: ['nombre_conductor', 'nif_conductor'],
    tractoras: ['matricula_tractor'],
    remolques: ['matricula_remolque'],
  }
  const elegirAgendaMovil = (tipo, valor) => {
    const seleccionar = {
      cargadores: seleccionarCargador,
      transportistas: seleccionarTransportista,
      destinatarios: seleccionarDestinatario,
      conductores: seleccionarConductor,
      tractoras: seleccionarTractora,
      remolques: seleccionarRemolque,
    }[tipo]
    seleccionar?.(valor)
    // Elegirlo de la agenda es una decisión de una persona: cuenta como revisado.
    ;(CAMPOS_POR_AGENDA[tipo] || []).forEach(confirmarCampoMovil)
  }

  // Sin cobertura: se comprueba aquí lo mismo que comprobaría el servidor
  // (obligatorios, NIF/CIF con su dígito de control, matrículas), porque el
  // papel sale ya y no hay vuelta atrás. Se guarda en la cola del móvil y se
  // abre la hoja para imprimir; al volver la red se registra solo.
  const generarSinConexion = async () => {
    setError('')
    // La empresa ha elegido no hacer DeCA sin red (Configuración de DeCA).
    if (opcionesCampo.modo === 'necesita_red') { setError(t('campo.necesita_red_error')); return }
    const faltan = obligatoriosEfectivos.filter((c) => !String(form[c] ?? '').trim())
    if (faltan.length) {
      const nombres = faltan.map((c) => t(`expedicion.label_campo_${c}`, c)).join(', ')
      setFieldErrors(Object.fromEntries(faltan.map((c) => [c, t('expedicion.falta_este_dato')])))
      setError(t('mensajes.faltan_para_confirmar', { count: faltan.length, campos: nombres }))
      return
    }
    const malos = {}
    for (const c of ['nif_cargador', 'nif_transportista', 'nif_destinatario', 'nif_conductor']) {
      if (String(form[c] ?? '').trim() && !validarIdentificadorFiscal(form[c], 'otro')) malos[c] = t('offline.nif_no_valido')
    }
    for (const c of ['matricula_tractor', 'matricula_remolque']) {
      const v = soloMayusculasSinEspacios(form[c] || '')
      if (v && !/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{4,10}$/.test(v)) malos[c] = t('offline.matricula_no_valida')
    }
    if (Object.keys(malos).length) {
      setFieldErrors(malos)
      setError(Object.keys(malos).map((c) => `${t(`expedicion.label_campo_${c}`, c)}: ${malos[c]}`).join(' · '))
      return
    }
    const item = {
      referencia: nuevaReferenciaOffline(),
      empresa_id: empresa?.id,
      usuario_id: user?.id,
      expedicion_id: expedicion?.id && expedicion.estado === 'borrador' ? expedicion.id : null,
      // El QR va impreso: si el borrador ya existe en Appodo se usa su código;
      // si no, lo genera el móvil y el servidor lo adopta al registrarlo.
      token_publico: (expedicion?.id && expedicion.estado === 'borrador' && expedicion.token_publico) || nuevoTokenQr(),
      emitido_en: new Date().toISOString(),
      datos: construirPayload(),
      fotos: fotosSinConexion.map((f) => ({ blob: f, nombre: f.name, tipo: f.type })),
    }
    try {
      await guardarEnCola(item)
      // Que se registre solo al volver la red, aunque la app esté cerrada.
      pedirSincronizacionEnSegundoPlano()
    } catch {
      // Sin IndexedDB no se puede guardar para después, pero el papel sigue
      // siendo válido (art. 5, libre edición): se imprime igualmente.
      toast.error(t('offline.no_se_pudo_guardar'), 9000)
    }
    setFieldErrors({})
    setFotosSinConexion([])
    setDecaParaImprimir({ ...item, solo_guardado: opcionesCampo.modo === 'generar_al_volver' })
  }

  // "Generar DeCA" en móvil es un solo botón: guarda, confirma y genera.
  const generarMovil = async () => {
    if (sinConexion || navigator.onLine === false) { await generarSinConexion(); return }
    if (expedicion?.estado === 'borrador') {
      const ok = await handleConfirmar({ silencioso: true })
      if (!ok) return
    }
    await handleGenerar()
  }

  const textoOcupadoMovil = (saving && !expedicion?.id) ? t('movil.preparando')
    : subiendoDoc ? t('movil.subiendo')
      : extrayendoDocId ? t('movil.leyendo')
        : (confirmando || generando) ? t('movil.generando')
          : borrandoExpedicion ? t('movil.borrando')
            : null

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-marca)]" />
      </div>
    )
  }

  if (decaParaImprimir) {
    return (
      <DecaImprimibleSinConexion
        item={decaParaImprimir}
        ejemplares={opcionesCampo.ejemplares}
        soloGuardado={decaParaImprimir.solo_guardado}
        empresaNombre={empresa?.nombre}
        onCerrar={() => navigate('/deca')}
      />
    )
  }

  if (altaMovil) {
    return (
      <AltaDecaMovil
        sinConexion={sinConexion}
        fotosSinConexion={fotosSinConexion.length}
        modoSinCobertura={opcionesCampo.modo}
        preparadoEn={preparadoEn}
        permitirPapel={opcionesCampo.papel}
        permitirPesoEstimado={opcionesCampo.anticipado}
        modoPapel={modoPapel}
        onEmpezarPapel={() => { setModoPapel(true); setAltaManualMovil(true) }}
        onRegistrarPapel={handleRegistrarPapel}
        form={form}
        onCambiarCampo={(campo, valor) => set(campo)(valor)}
        onConfirmarCampo={confirmarCampoMovil}
        camposObligatorios={obligatoriosEfectivos}
        camposRevisar={[...new Set([...camposARevisar, ...camposDudosos, ...camposCompletadosIA, ...camposAgenda, ...camposPorOrden])]}
        zonas={zonasDudosas}
        fieldErrors={fieldErrors}
        error={error}
        expedicion={expedicion}
        empezarEnLista={Boolean(expedicion?.id) || manual || altaManualMovil}
        ocupado={textoOcupadoMovil}
        onArchivos={handleSeleccionArchivo}
        onEmpezarManual={empezarManualMovil}
        agenda={{
          cargadores: opcionesCargadores,
          transportistas: opcionesTransportistas,
          destinatarios: opcionesDestinatarios,
          conductores: opcionesConductores,
          tractoras: opcionesTractoras,
          remolques: opcionesRemolques,
        }}
        onElegirAgenda={elegirAgendaMovil}
        onBorrarDocumento={handleBorrarDocumento}
        onCambiarTipoDocumento={(doc, tipo) => handleActualizarDocumento(doc, 'tipo_documento', tipo)}
        onReleerDocumento={handleExtraerDocumento}
        estadoGuardado={estadoGuardado}
        onSalir={salirMovil}
        onVistaPrevia={handleVistaPrevia}
        onBorrarBorrador={handleBorrarExpedicion}
        onGenerar={generarMovil}
        empresaPropia={empresa?.cif && empresa?.nombre ? { nif: soloMayusculasSinEspacios(empresa.cif), nombre: empresa.nombre, domicilio: domicilioPropio } : null}
        sucesivos={sucesivos}
        nuevoSucesivo={nuevoSucesivo}
        setNuevoSucesivo={setNuevoSucesivo}
        onAgregarSucesivo={handleAgregarSucesivo}
        onBorrarSucesivo={handleBorrarSucesivo}
        guardandoSucesivo={guardandoSucesivo}
      />
    )
  }

  // ── Errores: dónde está cada uno ──────────────────────────────────────────
  // Orden de pantalla y sección de cada campo, para llevar al primero que
  // falla aunque su sección esté plegada.
  const SECCION_DE_CAMPO = {
    nif_cargador: 'cargador', nombre_cargador: 'cargador', domicilio_cargador: 'cargador',
    nif_transportista: 'transportista', nombre_transportista: 'transportista',
    nif_destinatario: 'destinatario', nombre_destinatario: 'destinatario',
    matricula_tractor: 'transporte', matricula_remolque: 'transporte', origen: 'transporte',
    destino: 'transporte', fecha_hora_transporte: 'transporte',
    naturaleza_mercancia: 'mercancia', peso_kg: 'mercancia', bultos: 'mercancia',
    nombre_conductor: 'conductor', nif_conductor: 'conductor',
  }
  const primerCampoConError = Object.keys(SECCION_DE_CAMPO).find((c) => fieldErrors[c])

  const irAlCampo = (campo) => {
    const seccion = SECCION_DE_CAMPO[campo]
    if (seccion) setSeccionesAbiertas((s) => ({ ...s, [seccion]: true }))
    // Tras abrir la sección, en el siguiente pintado ya existe el campo.
    setTimeout(() => {
      const el = document.getElementById(`campo-${campo}`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      el.focus({ preventScroll: true })
    }, 50)
  }

  // El aviso con el motivo concreto y un botón para ir al campo que falla.
  // Sale arriba y también abajo, junto a los botones de guardar/confirmar
  // (pedido del usuario 2026-09-29: antes había que subir a buscarlo).
  const avisoError = (junto_a_botones) => error && (
    <div
      role={junto_a_botones ? 'alert' : undefined}
      className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm font-medium text-red-800">{error}</p>
      </div>
      {/* Debajo del texto y a la izquierda: a la derecha lo tapaba el aviso
          emergente de la esquina. */}
      {primerCampoConError && (
        <Button type="button" variant="outline" size="sm" className="self-start ml-8 border-red-300 text-red-800 hover:bg-red-100" onClick={() => irAlCampo(primerCampoConError)}>
          {t('expedicion.ir_al_campo')}
        </Button>
      )}
    </div>
  )

  // El error de un campo, debajo del propio campo.
  const errorCampo = (campo) => (fieldErrors[campo]
    ? <p id={`error-${campo}`} className="text-sm font-medium text-red-700">{fieldErrors[campo]}</p>
    : null)

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

      {corrigiendoGenerado && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-xl flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 shrink-0" />
          <p className="text-sm font-medium text-blue-800">
            {t('expedicion.corrigiendo_generado', 'Este DeCA ya se generó. Puedes corregir un dato hasta las {{fecha}} -- el PDF se regenerará automáticamente y quedará registrado en el historial quién hizo el cambio.', {
              fecha: formatearFechaLimite(expedicion.fecha_limite_edicion),
            })}
          </p>
        </div>
      )}

      {readOnly && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-xl flex items-center gap-3">
          <Lock className="h-5 w-5 text-amber-600 shrink-0" />
          <p className="text-sm font-medium text-amber-800">
            {expedicion?.estado === 'anulado'
              ? t('expedicion.solo_lectura_anulada', 'Esta expedición está anulada y no se puede editar.')
              : expedicion?.estado === 'generado'
                ? t('expedicion.solo_lectura_plazo_vencido', 'El plazo para corregir este DeCA ya venció. Para cambiar un dato, anúlalo desde su ficha de detalle y crea una expedición nueva.')
                : t('expedicion.solo_lectura_generada', 'Esta expedición ya se generó y no se puede editar. Consulta el PDF y el QR desde su ficha de detalle.')}
          </p>
        </div>
      )}

      {avisoError(false)}

      {/* noValidate: los `required` de los campos marcan lo que exige la
          norma para CONFIRMAR (y lo anuncian a lectores de pantalla), pero no
          deben impedir guardar un borrador incompleto -- la validación del
          navegador lo bloqueaba antes de llegar a handleGuardar. */}
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm text-gray-700">
            <span className="inline-block h-4 w-6 rounded border border-amber-300 border-l-4 border-l-amber-500 bg-[#FFF3C4]" aria-hidden="true" />
            {t('expedicion.leyenda_obligatorios')}
          </p>
          {/* Si el transporte necesita DeCA (una furgoneta pequeña o el cliente
              con su propio vehículo, no). Pedido del usuario 2026-09-30. */}
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setAyudaDecaAbierta(true)}>
            <Info className="h-4 w-4" aria-hidden="true" />{t('ayuda_deca.boton')}
          </Button>
        </div>
      )}
      <Dialog open={ayudaDecaAbierta} onOpenChange={setAyudaDecaAbierta}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('ayuda_deca.titulo')}</DialogTitle>
            <DialogDescription className="sr-only">{t('ayuda_deca.intro')}</DialogDescription>
          </DialogHeader>
          <AyudaCuandoDeca />
        </DialogContent>
      </Dialog>
      <form ref={formRef} onSubmit={handleGuardar} noValidate className="space-y-6">

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
                    {/* Botón dedicado "Hacer foto" (capture="environment")
                        quitado a petición del usuario 2026-09-25: en iOS
                        Safari, tras varios fixes, seguía sin refrescar la
                        lista de documentos de forma fiable. El selector de
                        "Subir" de abajo ya ofrece "Tomar foto" como opción
                        nativa del propio picker del móvil -- no se pierde
                        la función, solo el botón directo que daba problemas. */}
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
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
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

        {/* Resumen de lo extraído -- los campos YA se han autorrellenado
            (ver autorellenarDesdeSugerencias) sin necesitar ningún clic;
            esto es solo para que el usuario sepa de dónde salió cada dato
            y pueda corregirlo directamente en su campo si hace falta.
            Nunca se guarda nada sin pasar por "Guardar"/"Confirmar". */}
        {(sugerencias || camposCompletadosIA.length > 0 || camposARevisar.length > 0 || camposDudosos.length > 0 || avisosAgenda.length > 0 || plantillaAplicada) && !readOnly && (
          <Card className="border-[rgb(var(--color-marca-rgb)/0.3)] bg-[rgb(var(--color-marca-rgb)/0.03)]">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[var(--color-marca)] font-bold text-sm">
                  <Sparkles className="h-4 w-4" /> {t('expedicion.datos_extraidos')}
                </div>
                <button
                  type="button"
                  onClick={() => { setSugerencias(null); setCamposCompletadosIA([]); setCamposARevisar([]); setCamposDudosos([]); setPlantillaAplicada(null) }}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label={t('expedicion.cerrar_resumen_extraccion', 'Cerrar resumen de datos extraídos')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500">
                {t('expedicion.autorrellenado_desc', 'Ya se ha rellenado el formulario con estos datos -- revisa y corrige cualquier campo si hace falta antes de confirmar.')}
              </p>

              {plantillaAplicada && (
                <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                  <FileScan className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-800">
                    {t('expedicion.plantilla_reconocida', 'Modelo de documento reconocido:')}{' '}
                    <strong>{plantillaAplicada}</strong>
                    {' — '}{t('expedicion.plantilla_reconocida_desc', 'se ha leído con sus indicaciones y se han rellenado sus datos fijos.')}
                  </p>
                </div>
              )}

              {camposDudosos.length > 0 && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">
                    {t('expedicion.campos_dudosos', 'Leído de letra a mano o de una zona poco clara, compruébalo en el documento:')}{' '}
                    {[...new Set(camposDudosos)].map((c) => t(`expedicion.label_campo_${c}`, c)).join(', ')}
                  </p>
                </div>
              )}

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
                  {sugerencias.nombre_conductor && (
                    <span className="text-sm bg-white border border-gray-200 rounded px-2 py-1">{t('expedicion.label_campo_nombre_conductor')}: <strong>{sugerencias.nombre_conductor}</strong></span>
                  )}
                  {sugerencias.nif_conductor && (
                    <span className="text-sm font-mono bg-white border border-gray-200 rounded px-2 py-1">{sugerencias.nif_conductor}</span>
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

              {camposPorOrden.length > 0 && (
                <div role="status" className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg p-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-xs text-gray-900">
                    {t('expedicion.nifs_por_orden')}{' '}
                    <strong>{camposPorOrden.map((c) => t(`expedicion.label_campo_${c}`, c)).join(', ')}</strong>
                  </p>
                </div>
              )}

              {avisosAgenda.length > 0 && (
                <div role="status" className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg p-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-xs text-gray-900">
                    <p className="font-semibold">{t('expedicion.agenda_manda_titulo')}</p>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5">
                      {avisosAgenda.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {camposARevisar.length > 0 && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">
                    {t(
                      'expedicion.catalogo_coincidencia_dudosa',
                      'Estos datos vienen de una coincidencia parecida (no exacta) con tu Agenda -- puede que la IA se haya equivocado leyendo el nombre, o que sea una empresa distinta. Confírmalos:',
                    )}{' '}
                    {[...new Set(camposARevisar)].map((c) => t(`expedicion.label_campo_${c}`, c)).join(', ')}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Cargador */}
        <SeccionFormulario
          icono={Building2}
          titulo={t('expedicion.bloque_cargador', 'Cargador — quien contrata el transporte')}
          contador={contarCompletos(CAMPOS_OBLIGATORIOS_POR_SECCION.cargador, form)}
          abierta={seccionesAbiertas.cargador}
          onToggle={() => alternarSeccion('cargador')}
          accionExtra={!readOnly && (
            <BuscarAgendaBoton
              label={t('expedicion.buscar_cargador_catalogo', 'Buscar en agenda de cargadores')}
              placeholder={t('expedicion.placeholder_buscar_cargador', 'Buscar cargador guardado...')}
              opciones={opcionesCargadores}
              onSeleccionar={seleccionarCargador}
              disabled={readOnly}
            />
          )}
        >
          {/* Qué es el "cargador" en el DeCA (pedido explícito del usuario
              2026-09-27): el cargador CONTRACTUAL (Orden FOM/2861/2012, Ley
              15/2009), quien contrata el transporte -- no el dueño de la
              mercancía ni el sitio de carga. Se confundía con el remitente. */}
          <div className="flex items-start gap-2.5 rounded-lg border border-[rgb(var(--color-marca-rgb)/0.2)] bg-[rgb(var(--color-marca-rgb)/0.05)] p-3 text-sm text-gray-800">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-[var(--color-marca)]" aria-hidden="true" />
            <div className="space-y-2">
              <p>
                {t('expedicion.ayuda_cargador')}{' '}
                <span className="text-gray-700">{t('expedicion.ejemplo_cargador')}</span>
              </p>
              {/* Ya no se precarga el cargador (puede serlo el cliente): se
                  elige con un clic, igual que en el alta móvil. */}
              {!readOnly && !form.nif_cargador && !form.nombre_cargador && (
                <div className="flex flex-wrap gap-2">
                  {empresa?.cif && empresa?.nombre && (
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setForm((f) => ({ ...f, nif_cargador: soloMayusculasSinEspacios(empresa.cif), nombre_cargador: empresa.nombre, domicilio_cargador: domicilioPropio || f.domicilio_cargador })); quitarDeRevisar('nif_cargador', 'nombre_cargador') }}
                    >
                      {t('expedicion.cargador_somos_nosotros', { nombre: empresa.nombre })}
                    </Button>
                  )}
                  {form.nif_destinatario && form.nombre_destinatario && (
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setForm((f) => ({ ...f, nif_cargador: f.nif_destinatario, nombre_cargador: f.nombre_destinatario, domicilio_cargador: domicilioEnAgenda(f.nif_destinatario) || f.domicilio_cargador })); quitarDeRevisar('nif_cargador', 'nombre_cargador') }}
                    >
                      {t('expedicion.cargador_es_el_cliente', { nombre: form.nombre_destinatario })}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
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
              <Input value={form.nif_cargador} onChange={(e) => set('nif_cargador')(e.target.value)} placeholder={t('expedicion.placeholder_nif_remitente')} disabled={readOnly} required={esObligatorio('nif_cargador')} aria-required={esObligatorio('nif_cargador')} id={`campo-nif_cargador`} aria-describedby={fieldErrors.nif_cargador ? 'error-nif_cargador' : undefined} className={claseCampo('nif_cargador')} />
              {errorCampo('nif_cargador')}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nombre_remitente')} <span className="text-red-500">*</span></Label>
              <Input value={form.nombre_cargador} onChange={(e) => set('nombre_cargador')(e.target.value)} placeholder={t('expedicion.placeholder_nombre_remitente')} disabled={readOnly} required={esObligatorio('nombre_cargador')} aria-required={esObligatorio('nombre_cargador')} id={`campo-nombre_cargador`} aria-describedby={fieldErrors.nombre_cargador ? 'error-nombre_cargador' : undefined} className={claseCampo('nombre_cargador')} />
              {errorCampo('nombre_cargador')}
            </div>
          </div>
          {/* Art. 6.a de la Orden FOM/2861/2012: domicilio del cargador. */}
          <div className="space-y-1.5">
            <Label htmlFor="campo-domicilio_cargador">{t('expedicion.label_domicilio_cargador')}{marcaObligatorio('domicilio_cargador')}</Label>
            <Input id="campo-domicilio_cargador" aria-describedby={fieldErrors.domicilio_cargador ? 'error-domicilio_cargador' : undefined} value={form.domicilio_cargador} onChange={(e) => set('domicilio_cargador')(e.target.value)} placeholder={t('expedicion.placeholder_domicilio_cargador')} disabled={readOnly} aria-required={esObligatorio('domicilio_cargador')} className={claseCampo('domicilio_cargador')} />
            {errorCampo('domicilio_cargador')}
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
              <Input value={form.nif_transportista} onChange={(e) => set('nif_transportista')(e.target.value)} placeholder={t('expedicion.placeholder_nif_transportista')} disabled={readOnly} required={esObligatorio('nif_transportista')} aria-required={esObligatorio('nif_transportista')} id={`campo-nif_transportista`} aria-describedby={fieldErrors.nif_transportista ? 'error-nif_transportista' : undefined} className={claseCampo('nif_transportista')} />
              {errorCampo('nif_transportista')}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nombre_transportista')} <span className="text-red-500">*</span></Label>
              <Input value={form.nombre_transportista} onChange={(e) => set('nombre_transportista')(e.target.value)} placeholder={t('expedicion.placeholder_nombre_transportista')} disabled={readOnly} required={esObligatorio('nombre_transportista')} aria-required={esObligatorio('nombre_transportista')} id={`campo-nombre_transportista`} aria-describedby={fieldErrors.nombre_transportista ? 'error-nombre_transportista' : undefined} className={claseCampo('nombre_transportista')} />
              {errorCampo('nombre_transportista')}
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
              <Label>{t('expedicion.label_nif_destinatario')}{marcaObligatorio('nif_destinatario')}</Label>
              <Input value={form.nif_destinatario} onChange={(e) => set('nif_destinatario')(e.target.value)} placeholder={t('expedicion.placeholder_nif_destinatario')} disabled={readOnly} required={esObligatorio('nif_destinatario')} aria-required={esObligatorio('nif_destinatario')} id={`campo-nif_destinatario`} aria-describedby={fieldErrors.nif_destinatario ? 'error-nif_destinatario' : undefined} className={claseCampo('nif_destinatario')} />
              {errorCampo('nif_destinatario')}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_nombre_destinatario')}{marcaObligatorio('nombre_destinatario')}</Label>
              <Input value={form.nombre_destinatario} onChange={(e) => set('nombre_destinatario')(e.target.value)} placeholder={t('expedicion.placeholder_nombre_destinatario')} disabled={readOnly} required={esObligatorio('nombre_destinatario')} aria-required={esObligatorio('nombre_destinatario')} id={`campo-nombre_destinatario`} aria-describedby={fieldErrors.nombre_destinatario ? 'error-nombre_destinatario' : undefined} className={claseCampo('nombre_destinatario')} />
              {errorCampo('nombre_destinatario')}
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
              <Input value={form.matricula_tractor} onChange={(e) => set('matricula_tractor')(e.target.value)} placeholder={t('expedicion.placeholder_matricula_tractor')} disabled={readOnly} required aria-required id={`campo-matricula_tractor`} aria-describedby={fieldErrors.matricula_tractor ? 'error-matricula_tractor' : undefined} className={claseCampo('matricula_tractor')} />
              {errorCampo('matricula_tractor')}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campo-matricula_remolque">{t('expedicion.label_matricula_remolque')}{marcaObligatorio('matricula_remolque')}</Label>
              <Input id="campo-matricula_remolque" aria-describedby={fieldErrors.matricula_remolque ? 'error-matricula_remolque' : undefined} value={form.sin_remolque ? '' : form.matricula_remolque} onChange={(e) => set('matricula_remolque')(e.target.value)} placeholder={form.sin_remolque ? t('expedicion.sin_remolque_placeholder') : t('expedicion.placeholder_matricula_remolque')} disabled={readOnly || form.sin_remolque} aria-required={esObligatorio('matricula_remolque')} className={claseCampo('matricula_remolque')} />
              {/* Art. 6.g: en un conjunto articulado, tractora Y remolque. Un
                  camión rígido lo marca aquí y el remolque deja de pedirse. */}
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input type="checkbox" checked={Boolean(form.sin_remolque)} onChange={(e) => set('sin_remolque')(e.target.checked)} disabled={readOnly} className="h-4 w-4" />
                {t('expedicion.sin_remolque')}
              </label>
              {errorCampo('matricula_remolque')}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_numero_pedido')}</Label>
              <Input value={form.numero_pedido} onChange={(e) => set('numero_pedido')(e.target.value)} placeholder={t('expedicion.placeholder_numero_pedido')} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_origen')} <span className="text-red-500">*</span></Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
                <Input id={`campo-origen`} aria-describedby={fieldErrors.origen ? 'error-origen' : undefined} className={claseCampo('origen', 'pl-9')} aria-required value={form.origen} onChange={(e) => set('origen')(e.target.value)} placeholder={t('expedicion.placeholder_origen')} disabled={readOnly} required />
              </div>
              {errorCampo('origen')}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_destino')} <span className="text-red-500">*</span></Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
                <Input id={`campo-destino`} aria-describedby={fieldErrors.destino ? 'error-destino' : undefined} className={claseCampo('destino', 'pl-9')} aria-required value={form.destino} onChange={(e) => set('destino')(e.target.value)} placeholder={t('expedicion.placeholder_destino')} disabled={readOnly} required />
              </div>
              {errorCampo('destino')}
            </div>
            <div className="space-y-1.5">
              <Label>{t('expedicion.label_fecha_hora')} <span className="text-red-500">*</span></Label>
              <Input type="datetime-local" value={form.fecha_hora_transporte} onChange={(e) => set('fecha_hora_transporte')(e.target.value)} disabled={readOnly} required aria-required id={`campo-fecha_hora_transporte`} aria-describedby={fieldErrors.fecha_hora_transporte ? 'error-fecha_hora_transporte' : undefined} className={claseCampo('fecha_hora_transporte')} />
              {errorCampo('fecha_hora_transporte')}
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
            <Textarea rows={2} value={form.naturaleza_mercancia} onChange={(e) => set('naturaleza_mercancia')(e.target.value)} placeholder={t('expedicion.placeholder_naturaleza')} disabled={readOnly} required aria-required id={`campo-naturaleza_mercancia`} aria-describedby={fieldErrors.naturaleza_mercancia ? 'error-naturaleza_mercancia ayuda-naturaleza_mercancia' : 'ayuda-naturaleza_mercancia'} className={claseCampo('naturaleza_mercancia')} />
            <p id="ayuda-naturaleza_mercancia" className="text-xs text-gray-600">{t('expedicion.ayuda_naturaleza')}</p>
            {errorCampo('naturaleza_mercancia')}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="campo-peso_kg">{t('expedicion.label_peso')}{marcaObligatorio('peso_kg')}</Label>
              <div className="relative">
                <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
                <Input id="campo-peso_kg" aria-describedby={fieldErrors.peso_kg ? 'error-peso_kg' : undefined} className={claseCampo('peso_kg', 'pl-9')} type="number" step="0.01" min="0" value={form.peso_kg} onChange={(e) => set('peso_kg')(e.target.value)} placeholder={t('expedicion.placeholder_peso')} disabled={readOnly} aria-required={esObligatorio('peso_kg')} />
              </div>
              {errorCampo('peso_kg')}
              {/* DeCA anticipado (Configuración de DeCA): peso previsto que se
                  corrige con el real ANTES de que salga el camión. */}
              {(opcionesCampo.anticipado || form.peso_estimado) && (
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={Boolean(form.peso_estimado)} onChange={(e) => set('peso_estimado')(e.target.checked)} disabled={readOnly} className="h-4 w-4" />
                  {t('campo.peso_estimado')}
                </label>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campo-bultos">{t('expedicion.label_bultos')}{marcaObligatorio('bultos')}</Label>
              <Input id="campo-bultos" aria-describedby={fieldErrors.bultos ? 'error-bultos' : undefined} className={claseCampo('bultos')} type="number" min="0" step="1" value={form.bultos} onChange={(e) => set('bultos')(e.target.value)} placeholder={t('expedicion.placeholder_bultos')} disabled={readOnly} aria-required={esObligatorio('bultos')} />
              {errorCampo('bultos')}
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
              <Input id="campo-nombre_conductor" value={form.nombre_conductor} onChange={(e) => set('nombre_conductor')(e.target.value)} disabled={readOnly} className={claseSiRevisar('nombre_conductor')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">NIF</Label>
              <Input id="campo-nif_conductor" value={form.nif_conductor} onChange={(e) => set('nif_conductor')(e.target.value)} disabled={readOnly} className={claseSiRevisar('nif_conductor')} />
              {errorCampo('nif_conductor')}
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
                    <Label htmlFor="campo-autorizacion_especial">{t('expedicion.label_autorizacion_especial')}</Label>
                    <Input id="campo-autorizacion_especial" value={form.autorizacion_especial} onChange={(e) => set('autorizacion_especial')(e.target.value)} placeholder={t('expedicion.placeholder_autorizacion_especial')} disabled={readOnly} />
                  </div>
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
                        <Input className="sm:flex-1" value={s.nombre} onChange={(e) => handleActualizarSucesivo(s, 'nombre', e.target.value)} placeholder={t('expedicion.label_campo_nombre_transportista')} />
                        <Input className="sm:w-40" value={s.nif} onChange={(e) => handleActualizarSucesivo(s, 'nif', e.target.value)} placeholder="NIF/CIF" />
                        <Input className="sm:w-36" value={s.matricula} onChange={(e) => handleActualizarSucesivo(s, 'matricula', e.target.value)} placeholder={t('expedicion.placeholder_matricula_remolque')} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => handleBorrarSucesivo(s)} className="text-red-400 hover:text-red-600 shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center pt-2">
                      <span className="text-xs font-bold text-gray-300 w-6 shrink-0">#{sucesivos.length + 1}</span>
                      <Input className="sm:flex-1" value={nuevoSucesivo.nombre} onChange={(e) => setNuevoSucesivo((n) => ({ ...n, nombre: e.target.value }))} placeholder={t('expedicion.label_campo_nombre_transportista')} />
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

        {/* Acciones -- mb-16 en móvil para que la barra flotante de abajo
            (mismo botón primario, siempre visible) no tape "Cancelar"/
            "Borrar borrador" cuando se llega hasta aquí haciendo scroll. */}
        {/* El mismo aviso de error, también aquí abajo junto a los botones:
            antes solo salía arriba y había que subir a buscar el detalle
            (pedido del usuario 2026-09-29). */}
        {!readOnly && avisoError(true)}
        {corrigiendoGenerado && (
          <div className="space-y-1.5 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
            <Label htmlFor="campo-motivo_modificacion" className="font-semibold text-gray-900">
              {t('campo.motivo_label')}<span className="text-red-600 font-bold" aria-hidden="true"> *</span>
            </Label>
            <Textarea
              id="campo-motivo_modificacion"
              value={motivoCorreccion}
              onChange={(e) => setMotivoCorreccion(e.target.value)}
              rows={2}
              aria-required="true"
              aria-describedby="ayuda-motivo_modificacion"
              placeholder={t('campo.motivo_placeholder')}
              className="bg-white"
            />
            <p id="ayuda-motivo_modificacion" className="text-xs text-gray-700">{t('campo.motivo_ayuda')}</p>
            {errorCampo('motivo_modificacion')}
          </div>
        )}
        {!readOnly && (
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 mb-16 md:mb-0">
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
                  : corrigiendoGenerado
                    ? t('expedicion.btn_guardar_correccion', 'Guardar corrección')
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

            {/* Talonario de papel (Configuración de DeCA → Trabajo en campo):
                el papel ya viajó; aquí solo se registra con su foto. */}
            {opcionesCampo.papel && (puedeConfirmar || puedeGenerar) && (
              <Button type="button" variant="outline" disabled={registrandoPapel} onClick={handleRegistrarPapel} className="w-full sm:w-auto">
                {registrandoPapel ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                {t('campo.btn_registrar_papel')}
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

      {/* Botón primario flotante -- SOLO móvil (md:hidden, mismo criterio de
          visibilidad que BottomNav). Antes el único "Guardar"/"Crear
          expedición" estaba al final de un formulario de ~4300px de scroll
          en un iPhone (Documentos->Cargador->Transportista->Destinatario->
          Transporte->Mercancía->Conductor->2 tarjetas opcionales), así que
          guardar a medio rellenar exigía bajar toda la pantalla cada vez --
          bug de usabilidad real detectado 2026-09-25 auditando la pantalla
          en producción con Playwright a 390px de ancho. Dispara el mismo
          `handleGuardar` que el submit normal, vía `requestSubmit()` sobre
          el propio <form> (conserva la validación/estado nativos, no
          duplica lógica). `bottom-14` = altura exacta de BottomNav
          (`h-14`, ver components/layout/BottomNav.jsx) para quedar pegado
          justo encima, nunca debajo ni tapándolo. */}
      {!readOnly && (
        <div className="md:hidden fixed bottom-14 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <Button
            type="button"
            disabled={saving}
            onClick={() => formRef.current?.requestSubmit()}
            className="w-full"
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {saving
              ? t('expedicion.btn_guardando')
              : expedicion?.estado === 'confirmado'
                ? t('expedicion.btn_guardar_confirmado', 'Corregir (vuelve a borrador)')
                : corrigiendoGenerado
                  ? t('expedicion.btn_guardar_correccion', 'Guardar corrección')
                  : (expedicion?.id ? t('expedicion.btn_guardar') : t('expedicion.btn_crear'))}
          </Button>
        </div>
      )}

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
                'Se generarán el PDF y el QR oficiales, normalmente cuando el camión ya está saliendo. Después solo podrás corregir un dato dentro del plazo de corrección que tenga configurado tu empresa; pasado ese plazo, habrá que anular la expedición y crear una nueva. Si todavía no estás seguro de los datos, usa "Vista previa". ¿Continuar?',
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
