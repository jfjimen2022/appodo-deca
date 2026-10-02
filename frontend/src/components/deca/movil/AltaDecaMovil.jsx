import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { analizarFoto } from '../../../lib/calidadFoto'
import AyudaCuandoDeca from '../AyudaCuandoDeca'
import { useTranslation } from 'react-i18next'
import {
  Camera, Upload, Check, AlertTriangle, X, Building2, Truck, Route, Package,
  Clock, ChevronRight, ArrowLeft, Plus, QrCode, FileText, Pencil, List,
  MoreVertical, Loader2, Trash2, Eye, Users, AlertCircle, RefreshCw, Search, Info,
  WifiOff, Printer, Save, Download,
} from 'lucide-react'
import { puedeInstalar, alCambiarInstalable, instalar } from '../../../lib/instalarApp'

// Alta de DeCA en MÓVIL -- rediseño "Cámara + lista" con la pantalla de
// comprobación final del modelo "Asistente por pasos" (elegido entre tres
// maquetas, 2026-09-27).
//
// Quien da de alta un DeCA suele ser el trabajador del muelle, de pie y con
// el sol reflejándose en la pantalla. De ahí las reglas de este componente,
// que NO siguen la paleta gris del resto del ERP a propósito:
// - Texto negro sobre blanco, contraste AAA (≥ 7:1), nada de grises claros.
// - Letra ≥ 17 px en negrita en todo lo que haya que leer.
// - Objetivos táctiles de 56-66 px, bordes de 2-3 px.
// - Estado siempre con icono + palabra (Listo / Revisar / Falta), nunca solo color.
//
// Este componente es solo PRESENTACIÓN y navegación entre pasos: todo el
// estado del formulario y las llamadas a la API siguen viviendo en
// DecaFormPage (mismos handlers que la versión de escritorio), para que las
// dos pantallas no puedan divergir en reglas de negocio.

const BLOQUES = [
  { id: 'cargador', icono: Building2, campos: ['nombre_cargador', 'nif_cargador', 'domicilio_cargador'] },
  { id: 'transportista', icono: Truck, campos: ['nombre_transportista', 'nif_transportista'] },
  { id: 'destinatario', icono: Users, campos: ['nombre_destinatario', 'nif_destinatario'] },
  // Tractora y remolque juntos (art. 6.g: en un conjunto articulado se
  // piden las dos matrículas); peso y bultos con la mercancía.
  { id: 'transporte', icono: Route, campos: ['matricula_tractor', 'matricula_remolque', 'origen', 'destino', 'fecha_hora_transporte'] },
  { id: 'mercancia', icono: Package, campos: ['naturaleza_mercancia', 'peso_kg', 'bultos'] },
]

// Cómo se pinta y se escribe cada campo. `agenda` = qué catálogo sugiere
// valores mientras se escribe (se filtra con lo tecleado en el propio campo,
// sin un desplegable aparte de letra pequeña).
const CAMPOS = {
  // `ayuda`: "Ver ejemplo" desplegable bajo la etiqueta (movil.ejemplo_<campo>).
  // El cargador del DeCA es quien CONTRATA el transporte -- lo dice ya la
  // propia etiqueta -- y se confundía con el dueño de la mercancía o con el
  // sitio de carga (pedido explícito del usuario 2026-09-27).
  nombre_cargador: { agenda: 'cargadores', ayuda: true },
  nif_cargador: { mono: true, mayus: true, agenda: 'cargadores' },
  domicilio_cargador: {},
  autorizacion_especial: { mono: true },
  nombre_transportista: { agenda: 'transportistas' },
  nif_transportista: { mono: true, mayus: true, agenda: 'transportistas' },
  nombre_destinatario: { agenda: 'destinatarios' },
  nif_destinatario: { mono: true, mayus: true, agenda: 'destinatarios' },
  matricula_tractor: { mono: true, mayus: true, agenda: 'tractoras', matricula: true },
  matricula_remolque: { mono: true, mayus: true, agenda: 'remolques', matricula: true },
  origen: {},
  destino: {},
  fecha_hora_transporte: { tipo: 'datetime-local', ahora: true },
  naturaleza_mercancia: { ayuda: true },
  numero_pedido: { mono: true },
  peso_kg: { mono: true, inputMode: 'decimal' },
  bultos: { mono: true, inputMode: 'numeric' },
  volumen_m3: { mono: true, inputMode: 'decimal' },
  codigo_mercancia: { mono: true },
  nombre_conductor: { agenda: 'conductores' },
  nif_conductor: { mono: true, mayus: true, agenda: 'conductores' },
  telefono_conductor: { mono: true, tipo: 'tel' },
  email_conductor: { tipo: 'email' },
  numero_albaran: { mono: true },
  numero_cmr: { mono: true },
  instrucciones_conductor: { largo: true },
  contacto_emergencias: {},
  tipo_contenedor: {},
  instrucciones_expedidor: { largo: true },
  instrucciones_pago: { largo: true },
  comentarios: { largo: true },
}

// Lo que no exige la norma, detrás de "Más datos (opcional)". Un campo que la
// empresa haya marcado obligatorio en Configuración (el destinatario, p. ej.)
// sale de aquí solo y pasa a la lista principal.
const GRUPOS_OPCIONALES = [
  // El remolque ya no es opcional: va con la tractora (o se marca "sin remolque").
  { id: 'vehiculo', campos: ['numero_pedido', 'autorizacion_especial'] },
  { id: 'destinatario', campos: ['nombre_destinatario', 'nif_destinatario'] },
  { id: 'carga', campos: ['volumen_m3', 'codigo_mercancia'] },
  { id: 'conductor', campos: ['nombre_conductor', 'nif_conductor', 'telefono_conductor', 'email_conductor'] },
  { id: 'documento', campos: ['numero_albaran', 'numero_cmr'] },
  { id: 'instrucciones', campos: ['instrucciones_conductor', 'contacto_emergencias', 'tipo_contenedor', 'instrucciones_expedidor', 'instrucciones_pago', 'comentarios'] },
]

const TIPOS_DOCUMENTO = ['albaran_venta', 'cmr', 'otro']

const vacio = (v) => !String(v ?? '').trim()

// Hora de la pared del dispositivo, sin zona -- el mismo formato que teclea
// el usuario en un <input type="datetime-local">.
function ahoraLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function fechaLegible(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '')
  return m ? `${m[3]}/${m[2]}/${m[1]} · ${m[4]}:${m[5]}` : (v || '')
}

// ── Piezas visuales ─────────────────────────────────────────────────────────

const ESTILO_ESTADO = {
  ok: { borde: 'border-[#08622F]', pastilla: 'bg-[#D6F2DD] text-[#08532A]', icono: Check },
  revisar: { borde: 'border-[#C98A00]', pastilla: 'bg-[#FFD24A] text-[#2E2000]', icono: AlertTriangle },
  falta: { borde: 'border-[#B3121B]', pastilla: 'bg-[#B3121B] text-white', icono: X },
  error: { borde: 'border-[#B3121B]', pastilla: 'bg-[#B3121B] text-white', icono: AlertCircle },
}

function Pastilla({ estado, t }) {
  if (!estado) return null
  const e = ESTILO_ESTADO[estado]
  const Icono = e.icono
  return (
    <span className={`inline-flex items-center gap-1 rounded-full pl-2 pr-2.5 py-1 text-[15px] font-bold whitespace-nowrap ${e.pastilla}`}>
      <Icono className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
      {t(`movil.estado_${estado}`)}
    </span>
  )
}

function Boton({ variante = 'marca', alto = 'l', className = '', children, ...props }) {
  const colores = {
    marca: 'bg-[var(--color-marca)] text-white',
    verde: 'bg-[#08622F] text-white',
    rojo: 'bg-[#B3121B] text-white',
    ambar: 'bg-[#FFD24A] text-[#2E2000] border-2 border-[#8A5A00]',
    borde: 'bg-white text-[#111] border-2 border-[#111]',
    peligro: 'bg-white text-[#B3121B] border-2 border-[#B3121B]',
  }
  const altos = { xl: 'min-h-[66px] text-[21px]', l: 'min-h-[56px] text-[19px]', m: 'min-h-[48px] text-[17px] px-3.5' }
  return (
    <button
      type="button"
      className={`flex items-center justify-center gap-2.5 rounded-[14px] font-bold text-center transition-transform active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none ${colores[variante]} ${altos[alto]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

function Hoja({ titulo, onCerrar, pie, children, t }) {
  const refCerrar = useRef(null)
  useEffect(() => {
    refCerrar.current?.focus()
    const alPulsar = (e) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [onCerrar])
  return (
    <>
      <div className="absolute inset-0 z-20 bg-[rgba(20,10,18,0.55)]" onClick={onCerrar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="absolute inset-x-0 bottom-0 z-30 flex max-h-[90%] flex-col rounded-t-[22px] bg-[#F1EEF0] animate-[hoja-sube_280ms_cubic-bezier(0.2,0.9,0.3,1)] motion-reduce:animate-none"
      >
        <div className="mx-auto mt-2.5 mb-1 h-1.5 w-12 rounded-full bg-[#8A7F88]" aria-hidden="true" />
        <div className="flex items-center justify-between pl-4 pr-2 pb-2">
          <h2 className="text-[22px] font-bold text-[#111]">{titulo}</h2>
          <button ref={refCerrar} type="button" onClick={onCerrar} className="grid h-12 w-12 place-items-center rounded-xl text-[#111]" aria-label={t('movil.cerrar')}>
            <X className="h-7 w-7" strokeWidth={2.8} />
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-3.5 pb-3.5">{children}</div>
        {pie && <div className="grid gap-2.5 border-t-2 border-[#111] bg-white px-3.5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">{pie}</div>}
      </div>
    </>
  )
}

// El trozo de la foto donde está escrito un dato dudoso, ampliado (fase 3 del
// aprendizaje, 2026-09-28): la IA dice dónde lo leyó ([ymin, xmin, ymax, xmax]
// en 0-1000) y aquí se enseña ese rectángulo, con un poco de margen, para que
// la persona lea la letra con sus propios ojos antes de pulsar "Sí, es este".
// Si la imagen no carga, simplemente no se enseña nada.
const ALTO_MAXIMO_RECORTE = 170

function RecorteZona({ src, caja, etiqueta, t }) {
  const refCaja = useRef(null)
  const [natural, setNatural] = useState(null)
  const [ancho, setAncho] = useState(0)
  const [fallo, setFallo] = useState(false)
  useEffect(() => { setAncho(refCaja.current?.clientWidth || 0) }, [])
  if (!src || fallo) return null

  const [ymin, xmin, ymax, xmax] = caja
  const margenX = (xmax - xmin) * 0.15
  const margenY = (ymax - ymin) * 0.6
  const x0 = Math.max(0, xmin - margenX) / 1000
  const x1 = Math.min(1000, xmax + margenX) / 1000
  const y0 = Math.max(0, ymin - margenY) / 1000
  const y1 = Math.min(1000, ymax + margenY) / 1000

  let estiloImagen = { position: 'absolute', width: 1, opacity: 0 }
  let estiloVentana = { height: 0 }
  if (natural && ancho) {
    const escala = Math.min(ancho / ((x1 - x0) * natural.w), ALTO_MAXIMO_RECORTE / ((y1 - y0) * natural.h))
    const anchoImagen = natural.w * escala
    const altoImagen = natural.h * escala
    estiloImagen = {
      position: 'absolute', width: anchoImagen, height: altoImagen, maxWidth: 'none',
      left: -x0 * anchoImagen, top: -y0 * altoImagen,
    }
    estiloVentana = { width: (x1 - x0) * anchoImagen, height: (y1 - y0) * altoImagen }
  }

  return (
    <figure ref={refCaja} className="m-0 flex flex-col gap-1">
      <figcaption className="text-[15px] font-bold uppercase tracking-wide text-[#3B333A]">{t('movil.en_el_papel_pone')}</figcaption>
      <div className="relative mx-auto overflow-hidden rounded-lg border-2 border-[#111] bg-white" style={estiloVentana}>
        <img
          src={src}
          alt={t('movil.recorte_alt', { campo: etiqueta })}
          style={estiloImagen}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFallo(true)}
        />
      </div>
    </figure>
  )
}

// Desplegable de la agenda (cargadores, transportistas, destinatarios,
// conductores, tractoras, remolques): se abre SOLO con el botón "+" del campo
// y trae su propio buscador. Antes las coincidencias salían siempre debajo del
// campo, y con el campo vacío aparecía media agenda sin haberla pedido
// (pedido explícito del usuario 2026-09-27).
function DesplegableAgenda({ id, opciones, matricula, onElegir, onCerrar, t }) {
  const [busqueda, setBusqueda] = useState('')
  const refBuscar = useRef(null)
  useEffect(() => { refBuscar.current?.focus({ preventScroll: true }) }, [])

  const q = busqueda.trim().toLowerCase()
  const filtradas = q
    ? opciones.filter((o) => o.label.toLowerCase().includes(q) || (o.keywords || '').toLowerCase().includes(q))
    : opciones

  return (
    <div id={id} className="flex flex-col gap-2 rounded-xl border-2 border-[#111] bg-[#F1EEF0] p-2.5" onKeyDown={(e) => { if (e.key === 'Escape') onCerrar() }}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-6 w-6 -translate-y-1/2 text-[#111]" aria-hidden="true" />
        <input
          ref={refBuscar}
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={t('movil.buscar_en_agenda')}
          aria-label={t('movil.buscar_en_agenda')}
          autoComplete="off"
          className="h-[56px] w-full rounded-xl border-2 border-[#111] bg-white pl-12 pr-3.5 text-[19px] font-bold text-[#111] placeholder:font-normal placeholder:text-[#5E5560]"
        />
      </div>
      <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
        {filtradas.length === 0 && (
          <p className="px-1 py-2 text-[17px] font-bold text-[#111]">{t('movil.agenda_sin_resultados')}</p>
        )}
        {filtradas.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onElegir(o.value)}
            className="flex min-h-[56px] shrink-0 items-center gap-3 rounded-xl border-2 border-[#111] bg-white px-3 py-2 text-left text-[#111]"
          >
            {matricula ? (
              <>
                <span className="inline-flex min-h-[40px] items-stretch overflow-hidden rounded-md border-2 border-[#111] font-mono text-[18px] font-semibold">
                  <span className="grid w-5 place-items-end justify-center bg-[#1D3F9A] pb-1 text-[11px] text-white" aria-hidden="true">E</span>
                  <span className="grid place-items-center px-2.5">{o.keywords || o.label}</span>
                </span>
                {o.keywords && o.label !== o.keywords && <span className="text-[17px] font-bold">{o.label}</span>}
              </>
            ) : (
              <span>
                <span className="block text-[18px] font-bold">{o.label}</span>
                {o.keywords && <span className="block font-mono text-[16px] text-[#3B333A]">{o.keywords}</span>}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// Un campo "a pleno sol": etiqueta grande, estado y caja de 58 px, con un
// botón "+" para elegir de la agenda cuando el campo tiene una. Si el dato
// vino de una lectura dudosa, primero se pregunta "¿Es este?" con dos
// botones en vez de dejar un borde rojo sin explicación.
function CampoGrande({ campo, obligatorio, estado, valor, onCambiar, onConfirmar, agenda, onElegirAgenda, error, atajos, recorte, t }) {
  const cfg = CAMPOS[campo] || {}
  const [cambiando, setCambiando] = useState(false)
  const [agendaAbierta, setAgendaAbierta] = useState(false)
  const [verEjemplo, setVerEjemplo] = useState(false)
  const idInput = `movil-${campo}`
  const idAyuda = cfg.ayuda ? `ayuda-${campo}` : undefined
  const idAgenda = `agenda-${campo}`
  const etiqueta = t(`movil.campo_${campo}`)
  const estadoVisible = obligatorio ? estado : (estado === 'revisar' || estado === 'error' ? estado : null)
  const borde = estadoVisible ? ESTILO_ESTADO[estadoVisible].borde : 'border-[#111]'
  const conAgenda = Boolean(agenda?.length)

  const preguntar = estado === 'revisar' && !cambiando && !vacio(valor)
  // Obligatorio = fondo amarillo claro, para saber de un vistazo cuáles son
  // (pedido del usuario 2026-09-29, igual que en escritorio). Texto negro
  // sobre #FFF3C4: contraste AAA de sobra a pleno sol.
  const claseInput = `h-[58px] w-full min-w-0 rounded-xl border-2 border-[#111] ${obligatorio ? 'bg-[#FFF3C4]' : 'bg-white'} px-3.5 text-[20px] font-bold text-[#111] placeholder:font-normal placeholder:text-[#5E5560] ${cfg.mono ? 'font-mono tracking-wide' : ''}`

  return (
    <div id={`campo-${campo}`} className={`flex scroll-mt-4 flex-col gap-2.5 rounded-2xl border-[3px] bg-white p-3.5 ${borde}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={idInput} className="text-[19px] font-bold text-[#111]">{etiqueta}</label>
        <Pastilla estado={estadoVisible} t={t} />
      </div>

      {cfg.ayuda && (
        <div className="-mt-1 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setVerEjemplo((v) => !v)}
            aria-expanded={verEjemplo}
            className="min-h-[40px] self-start text-[16px] font-bold text-[#111] underline underline-offset-4"
          >
            {verEjemplo ? t('movil.ocultar_ejemplo') : t('movil.ver_ejemplo')}
          </button>
          {verEjemplo && <p id={idAyuda} className="rounded-xl bg-[#F1EEF0] p-3 text-[16px] font-bold text-[#111]">{t(`movil.ejemplo_${campo}`)}</p>}
        </div>
      )}

      {preguntar ? (
        <>
          {recorte && <RecorteZona src={recorte.src} caja={recorte.caja} etiqueta={etiqueta} t={t} />}
          <div className={`rounded-xl bg-[#FFF6D6] p-3 text-[20px] font-bold text-[#111] break-words ${cfg.mono ? 'font-mono' : ''}`}>
            {cfg.tipo === 'datetime-local' ? fechaLegible(valor) : valor}
          </div>
          <p className="flex items-start gap-2 text-[16px] font-bold text-[#2E2000]">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#8A5A00]" aria-hidden="true" />
            {t('movil.pregunta_es_este')}
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <Boton variante="verde" onClick={() => onConfirmar(campo)}><Check className="h-6 w-6" strokeWidth={3} />{t('movil.si_es_este')}</Boton>
            <Boton variante="borde" onClick={() => setCambiando(true)}>{t('movil.cambiar')}</Boton>
          </div>
        </>
      ) : (
        <>
          {cfg.largo ? (
            <textarea
              id={idInput}
              rows={3}
              value={valor}
              onChange={(e) => onCambiar(campo, e.target.value)}
              className="w-full rounded-xl border-2 border-[#111] bg-white p-3.5 text-[19px] font-bold text-[#111]"
            />
          ) : (
            // Fecha + hora no caben junto a un botón en 360 px: "Ahora" va debajo.
            <div className={`flex gap-2 ${cfg.ahora ? 'flex-col' : ''}`}>
              <input
                id={idInput}
                type={cfg.tipo || 'text'}
                inputMode={cfg.inputMode}
                autoComplete="off"
                autoCapitalize={cfg.mayus ? 'characters' : 'sentences'}
                value={valor}
                onChange={(e) => onCambiar(campo, cfg.mayus ? e.target.value.toUpperCase() : e.target.value)}
                className={claseInput}
                aria-required={obligatorio || undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={verEjemplo ? idAyuda : undefined}
              />
              {conAgenda && (
                <button
                  type="button"
                  onClick={() => setAgendaAbierta((v) => !v)}
                  aria-expanded={agendaAbierta}
                  aria-controls={idAgenda}
                  aria-label={agendaAbierta ? t('movil.cerrar_agenda') : t('movil.elegir_de_agenda')}
                  className={`grid h-[58px] w-[58px] shrink-0 place-items-center rounded-xl border-2 border-[#111] transition-transform active:scale-[0.95] motion-reduce:transition-none ${agendaAbierta ? 'bg-[#111] text-white' : 'bg-white text-[#111]'}`}
                >
                  {agendaAbierta ? <X className="h-7 w-7" strokeWidth={2.8} /> : <Plus className="h-8 w-8" strokeWidth={2.8} />}
                </button>
              )}
              {cfg.ahora && (
                <Boton variante="borde" className="w-full" onClick={() => { onCambiar(campo, ahoraLocal()); onConfirmar(campo) }}>
                  <Clock className="h-6 w-6" />{t('movil.ahora')}
                </Boton>
              )}
            </div>
          )}
          {atajos?.length > 0 && (
            <div className="flex flex-col gap-2">
              {atajos.map((a) => (
                <Boton key={a.clave} variante="borde" className="justify-start px-3.5 text-left" onClick={a.onElegir}>
                  <span className="min-w-0">
                    <span className="block text-[15px] uppercase tracking-wide text-[#3B333A]">{a.titulo}</span>
                    <span className="block break-words">{a.nombre}</span>
                  </span>
                </Boton>
              ))}
            </div>
          )}
          {conAgenda && agendaAbierta && (
            <DesplegableAgenda
              id={idAgenda}
              opciones={agenda}
              matricula={cfg.matricula}
              onElegir={(valorAgenda) => { onElegirAgenda(cfg.agenda, valorAgenda); setAgendaAbierta(false) }}
              onCerrar={() => setAgendaAbierta(false)}
              t={t}
            />
          )}
        </>
      )}
      {error && <p className="flex items-start gap-2 text-[16px] font-bold text-[#B3121B]"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />{error}</p>}
    </div>
  )
}

// ── Pantalla ────────────────────────────────────────────────────────────────

export default function AltaDecaMovil({
  form, onCambiarCampo, onConfirmarCampo, camposObligatorios, camposRevisar, zonas, fieldErrors, error,
  expedicion, empezarEnLista, ocupado, onArchivos, onEmpezarManual,
  agenda, onElegirAgenda, onBorrarDocumento, onCambiarTipoDocumento, onReleerDocumento,
  estadoGuardado, onSalir, onVistaPrevia, onBorrarBorrador, onGenerar, empresaPropia,
  sucesivos, nuevoSucesivo, setNuevoSucesivo, onAgregarSucesivo, onBorrarSucesivo, guardandoSucesivo,
  sinConexion = false, fotosSinConexion = 0,
  modoSinCobertura = 'imprimir', permitirPapel = false, permitirPesoEstimado = false,
  modoPapel = false, onEmpezarPapel, onRegistrarPapel, preparadoEn,
}) {
  // La empresa ha elegido no hacer DeCA sin red (Configuración de DeCA).
  const bloqueadoSinRed = sinConexion && modoSinCobertura === 'necesita_red'
  const { t } = useTranslation('deca')
  const refCamara = useRef(null)
  const refArchivo = useRef(null)
  const refContenido = useRef(null)

  useEffect(() => {
    const raiz = document.getElementById('root')
    if (!raiz) return undefined
    raiz.setAttribute('inert', '')
    return () => raiz.removeAttribute('inert')
  }, [])

  const [enInicio, setEnInicio] = useState(!empezarEnLista)
  const [paso, setPaso] = useState(expedicion?.estado === 'confirmado' ? 'comprobar' : 'lista')
  const [hoja, setHoja] = useState(null) // {tipo:'bloque', id} | {tipo:'mas'} | {tipo:'docs'} | {tipo:'menu'} | {tipo:'generar'} | {tipo:'borrar'}
  const [verLeidos, setVerLeidos] = useState(false)
  const [editandoLeido, setEditandoLeido] = useState(null)
  // Campos que se quedan en "Solo esto" aunque ya estén bien: se van poniendo
  // en verde a la vista del trabajador en vez de desaparecer de golpe.
  const [fijados, setFijados] = useState([])
  // Fotos que el aviso de calidad ha frenado: al segundo intento se sugiere
  // rellenar a mano en vez de seguir repitiendo.
  const intentosFallidos = useRef(0)

  const documentos = expedicion?.documentos_origen || []
  // 'error' = el servidor ha rechazado el formato (NIF con dígito de control mal,
  // matrícula imposible): tiene valor, pero no vale -- no puede salir en verde.
  const estadoDe = (c) => (vacio(form[c]) ? 'falta' : fieldErrors[c] ? 'error' : camposRevisar.includes(c) ? 'revisar' : 'ok')
  // Orden de pantalla = orden de los bloques (nombre antes que NIF: al elegir
  // el nombre de la agenda el NIF se rellena solo), no el de la configuración.
  const obligatorios = useMemo(() => {
    const orden = BLOQUES.flatMap((b) => b.campos)
    const pos = (c) => (orden.includes(c) ? orden.indexOf(c) : orden.length)
    return [...camposObligatorios].sort((a, b) => pos(a) - pos(b))
  }, [camposObligatorios])
  const pendientes = obligatorios.filter((c) => estadoDe(c) !== 'ok')
  const faltan = pendientes.filter((c) => estadoDe(c) !== 'revisar').length
  const listos = obligatorios.length - pendientes.length

  useEffect(() => { if (empezarEnLista) setEnInicio(false) }, [empezarEnLista])

  // La lista "Solo esto" se fija cuando termina la lectura del documento (o
  // al abrir un borrador), no mientras la IA va rellenando.
  const claveRevisar = camposRevisar.join(',')
  useEffect(() => {
    if (ocupado || enInicio) return
    setFijados((prev) => {
      const nuevos = obligatorios.filter((c) => estadoDe(c) !== 'ok' && !prev.includes(c))
      return nuevos.length ? [...prev, ...nuevos] : prev
    })
  }, [form, claveRevisar, obligatorios, ocupado, enInicio]) // eslint-disable-line react-hooks/exhaustive-deps

  const fijadosOrdenados = obligatorios.filter((c) => fijados.includes(c))
  const leidos = obligatorios.filter((c) => !fijados.includes(c))
  const opcionales = GRUPOS_OPCIONALES
    .map((g) => ({ ...g, campos: g.campos.filter((c) => !obligatorios.includes(c)) }))
    .filter((g) => g.campos.length)
  const opcionalesRellenos = opcionales.flatMap((g) => g.campos).filter((c) => !vacio(form[c])).length

  const subirArchivos = (lista) => {
    setEnInicio(false)
    onArchivos(lista)
  }

  // Antes de subir, ¿la foto está movida o quemada por un reflejo? Se
  // comprueba aquí (lib/calidadFoto.js) para repetirla en el momento en vez
  // de gastar cuota de IA en una foto ilegible. Solo avisa: siempre se puede
  // "Usar igualmente". Fase 3 del aprendizaje, 2026-09-28.
  const elegirArchivos = async (files) => {
    if (!files?.length) return
    let lista = Array.from(files) // antes de cualquier await: el input se vacía justo después
    try {
      // Copia en memoria ya: en iOS el fichero original puede dejar de ser
      // legible mientras se analiza (mismo motivo que en handleSeleccionArchivo).
      lista = await Promise.all(lista.map(async (f) => new File([await f.arrayBuffer()], f.name, { type: f.type })))
    } catch { /* se sube tal cual; handleSeleccionArchivo avisa si falla */ }
    const resultados = await Promise.all(lista.map((f) => analizarFoto(f)))
    const movida = resultados.some((r) => r?.movida)
    const reflejos = resultados.some((r) => r?.reflejos)
    if (movida || reflejos) {
      intentosFallidos.current += 1
      setHoja({ tipo: 'calidad', archivos: lista, movida, reflejos, intento: intentosFallidos.current })
      return
    }
    subirArchivos(lista)
  }

  const subirArriba = () => { if (refContenido.current) refContenido.current.scrollTop = 0 }

  const irAPendiente = () => {
    const primero = pendientes[0]
    if (!primero) return
    if (paso === 'comprobar') {
      const bloque = BLOQUES.find((b) => b.campos.includes(primero))
      setHoja({ tipo: 'bloque', id: bloque?.id })
      return
    }
    const el = document.getElementById(`campo-${primero}`)
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      setTimeout(() => el.querySelector('input,textarea')?.focus({ preventScroll: true }), 350)
    }
  }

  const volver = () => {
    if (hoja) { setHoja(null); return }
    if (paso === 'comprobar' && expedicion?.estado !== 'confirmado') { setPaso('lista'); subirArriba(); return }
    onSalir()
  }

  // El cargador nunca se rellena solo (quien contrata el transporte puede ser
  // la propia empresa o el cliente): se decide con un toque, "Nosotros" o
  // "El cliente" (el destinatario ya leído del documento).
  // El domicilio (obligatorio, art. 6.a) viene de la empresa o, para el
  // cliente, de su ficha en la agenda de cargadores si ya existe.
  const rellenarCargador = (nif, nombre, domicilio) => {
    onCambiarCampo('nombre_cargador', nombre)
    onCambiarCampo('nif_cargador', nif)
    if (domicilio) onCambiarCampo('domicilio_cargador', domicilio)
    onConfirmarCampo('nombre_cargador')
    onConfirmarCampo('nif_cargador')
  }
  const domicilioEnAgenda = (nif) => agenda.cargadores?.find((o) => o.keywords === nif)?.meta?.domicilio || ''
  const recorteDe = (c) => {
    const zona = zonas?.[c]
    const documento = zona && documentos.find((d) => d.id === zona.documentoId)
    return documento?.archivo ? { src: documento.archivo, caja: zona.caja } : undefined
  }

  const atajosCargador = []
  if (vacio(form.nombre_cargador) && vacio(form.nif_cargador)) {
    if (empresaPropia?.nif && empresaPropia?.nombre) {
      atajosCargador.push({ clave: 'propia', titulo: t('movil.atajo_nosotros'), nombre: empresaPropia.nombre, onElegir: () => rellenarCargador(empresaPropia.nif, empresaPropia.nombre, empresaPropia.domicilio) })
    }
    if (!vacio(form.nombre_destinatario) && !vacio(form.nif_destinatario) && form.nif_destinatario !== empresaPropia?.nif) {
      atajosCargador.push({ clave: 'cliente', titulo: t('movil.atajo_el_cliente'), nombre: form.nombre_destinatario, onElegir: () => rellenarCargador(form.nif_destinatario, form.nombre_destinatario, domicilioEnAgenda(form.nif_destinatario)) })
    }
  }

  const campo = (c, obligatorio = true) => (
    <CampoGrande
      key={c}
      campo={c}
      obligatorio={obligatorio}
      estado={estadoDe(c)}
      valor={form[c] ?? ''}
      onCambiar={onCambiarCampo}
      onConfirmar={onConfirmarCampo}
      agenda={agenda[CAMPOS[c]?.agenda]}
      onElegirAgenda={onElegirAgenda}
      error={fieldErrors[c]}
      atajos={c === 'nombre_cargador' ? atajosCargador : undefined}
      recorte={recorteDe(c)}
      t={t}
    />
  )

  // ── Cabecera ──
  const indicadorGuardado = sinConexion ? (
    <span className="flex items-center gap-1 text-[15px] font-bold text-[#111]" role="status">
      <WifiOff className="h-4 w-4" aria-hidden="true" />{t('offline.sin_cobertura_corto')}
    </span>
  ) : expedicion?.id && estadoGuardado && (
    <span className="flex items-center gap-1 text-[15px] font-bold text-[#3B333A]" role="status">
      {estadoGuardado === 'guardando' || estadoGuardado === 'pendiente'
        ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{t('movil.guardando')}</>
        : estadoGuardado === 'error'
          ? <><AlertCircle className="h-4 w-4 text-[#B3121B]" /><span className="text-[#B3121B]">{t('movil.sin_guardar')}</span></>
          : <><Check className="h-4 w-4 text-[#08622F]" strokeWidth={3} />{t('movil.guardado')}</>}
    </span>
  )

  // ── Contenido por pantalla ──
  let contenido
  let barra = null

  if (enInicio) {
    contenido = (
      <>
        <button
          type="button"
          onClick={() => refCamara.current?.click()}
          className="flex min-h-[250px] flex-col items-center justify-center gap-2 rounded-[20px] bg-[var(--color-marca)] text-white transition-transform active:scale-[0.98] motion-reduce:transition-none"
        >
          <Camera className="h-20 w-20" strokeWidth={1.8} aria-hidden="true" />
          <span className="text-[25px] font-bold">{t('movil.foto_albaran')}</span>
          <span className="text-[17px]">{t('movil.o_del_cmr')}</span>
        </button>
        <Boton variante="borde" onClick={() => refArchivo.current?.click()}>
          <Upload className="h-6 w-6" />{t('movil.subir_archivo')}
        </Boton>
        <button type="button" onClick={() => { setEnInicio(false); onEmpezarManual() }} className="min-h-[52px] text-[18px] font-bold text-[#111] underline underline-offset-4">
          {t('movil.rellenar_a_mano')}
        </button>
        {/* Talonario de papel (Configuración de DeCA → Trabajo en campo):
            se hace la foto del DeCA rellenado a bolígrafo y se registra. */}
        {permitirPapel && (
          <Boton
            variante="borde"
            onClick={() => {
              if (sinConexion) return
              onEmpezarPapel?.()
              refCamara.current?.click()
            }}
            disabled={sinConexion}
          >
            <FileText className="h-6 w-6" aria-hidden="true" />{t('campo.movil_registrar_papel')}
          </Boton>
        )}
        {permitirPapel && sinConexion && (
          <p className="text-[16px] font-bold text-[#3B333A]">{t('campo.papel_necesita_red')}</p>
        )}
        <EstadoSinCobertura preparadoEn={preparadoEn} sinConexion={sinConexion} t={t} />
        {/* ¿Hace falta DeCA? (una furgoneta pequeña o el cliente con su
            propio vehículo, no). Pedido del usuario 2026-09-30. */}
        <Boton variante="borde" alto="m" className="self-center" onClick={() => setHoja({ tipo: 'ayuda' })}>
          <Info className="h-5 w-5" aria-hidden="true" />{t('ayuda_deca.boton')}
        </Boton>
      </>
    )
  } else if (paso === 'lista') {
    const radio = 40
    const circ = 2 * Math.PI * radio
    const progreso = obligatorios.length ? listos / obligatorios.length : 0
    contenido = (
      <>
        <div className="grid grid-cols-[96px_1fr] items-center gap-3.5 rounded-[18px] border-2 border-[#111] bg-white p-3.5">
          <div className="relative h-24 w-24">
            <svg viewBox="0 0 96 96" className="h-24 w-24 -rotate-90" aria-hidden="true">
              <circle cx="48" cy="48" r={radio} stroke="#E4DDE2" strokeWidth="12" fill="none" />
              <circle cx="48" cy="48" r={radio} stroke={pendientes.length ? 'var(--color-marca)' : '#08622F'} strokeWidth="12" fill="none" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - progreso)} />
            </svg>
            <b className="absolute inset-0 grid place-items-center font-mono text-[24px] text-[#111]">{listos}/{obligatorios.length}</b>
          </div>
          <div>
            <h2 className="text-[21px] font-bold text-[#111]">{documentos.length ? t('movil.documento_leido') : t('movil.rellenando_a_mano')}</h2>
            <p className="mt-1 text-[17px] font-bold text-[#111]">
              {pendientes.length ? t('movil.te_faltan', { count: pendientes.length }) : t('movil.todo_listo')}
            </p>
          </div>
        </div>

        <FilaDocumentos documentos={documentos} onAbrir={() => setHoja({ tipo: 'docs' })} onOtro={() => refCamara.current?.click()} t={t} />

        {/* Dos fotos y la lectura casi no ha sacado nada: mejor a mano que
            una tercera foto (pedido del usuario 2026-09-28). */}
        {documentos.length >= 2 && listos <= 1 && pendientes.length > 0 && (
          <p role="status" className="flex items-start gap-2.5 rounded-2xl border-[3px] border-[#111] bg-white p-3.5 text-[18px] font-bold text-[#111]">
            <Pencil className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
            {t('movil.lectura_no_ayuda', { count: pendientes.length })}
          </p>
        )}

        {fijadosOrdenados.length > 0 && (
          <>
            <h2 className="mt-1 text-[23px] font-bold text-[#111]">{pendientes.length ? t('movil.solo_esto') : t('movil.hecho')}</h2>
            {fijadosOrdenados.map((c) => campo(c))}
          </>
        )}

        {/* Camión rígido: sin remolque (art. 6.g solo pide las dos matrículas
            en un conjunto articulado). Se puede deshacer en cualquier momento. */}
        {form.sin_remolque ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-[#111] bg-white p-3.5">
            <span className="text-[18px] font-bold text-[#111]">{t('movil.sin_remolque_valor')}</span>
            <Boton variante="borde" alto="m" onClick={() => onCambiarCampo('sin_remolque', false)}>{t('movil.si_lleva_remolque')}</Boton>
          </div>
        ) : (
          <Boton variante="borde" onClick={() => onCambiarCampo('sin_remolque', true)}>
            <Truck className="h-6 w-6" aria-hidden="true" />{t('movil.camion_sin_remolque')}
          </Boton>
        )}

        {/* DeCA anticipado: el peso es el previsto y se corrige con el real
            antes de que salga el camión. */}
        {permitirPesoEstimado && (
          form.peso_estimado ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-[#C98A00] bg-[#FFF6D6] p-3.5">
              <span className="text-[18px] font-bold text-[#111]">{t('campo.movil_peso_estimado_valor')}</span>
              <Boton variante="borde" alto="m" onClick={() => onCambiarCampo('peso_estimado', false)}>{t('campo.movil_peso_real')}</Boton>
            </div>
          ) : (
            <Boton variante="borde" onClick={() => onCambiarCampo('peso_estimado', true)}>
              <Package className="h-6 w-6" aria-hidden="true" />{t('campo.movil_peso_es_estimado')}
            </Boton>
          )
        )}

        {leidos.length > 0 && (
          <>
            <Boton variante="borde" onClick={() => { setVerLeidos((v) => !v); setEditandoLeido(null) }} aria-expanded={verLeidos}>
              <List className="h-6 w-6" />{verLeidos ? t('movil.ocultar_leidos') : t('movil.ver_leidos', { count: leidos.length })}
            </Boton>
            {verLeidos && (
              <div className="flex flex-col overflow-hidden rounded-2xl border-2 border-[#111] bg-white">
                {leidos.map((c, i) => (editandoLeido === c ? (
                  <div key={c} className="p-2.5">{campo(c)}</div>
                ) : (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditandoLeido(c)}
                    className={`grid min-h-[64px] grid-cols-[1fr_auto] items-center gap-2 bg-white px-3.5 py-3 text-left ${i ? 'border-t-2 border-[#E4DDE2]' : ''}`}
                  >
                    <span>
                      <span className="block text-[15px] font-bold text-[#3B333A]">{t(`movil.campo_${c}`)}</span>
                      <strong className={`block break-words text-[18px] text-[#111] ${CAMPOS[c]?.mono ? 'font-mono' : ''}`}>
                        {CAMPOS[c]?.tipo === 'datetime-local' ? fechaLegible(form[c]) : form[c]}
                      </strong>
                    </span>
                    <Pencil className="h-5 w-5 text-[#111]" aria-label={t('movil.cambiar')} />
                  </button>
                )))}
              </div>
            )}
          </>
        )}

        <Boton variante="borde" onClick={() => setHoja({ tipo: 'mas' })}>
          <Plus className="h-6 w-6" strokeWidth={2.6} />
          {t('movil.mas_datos')}{opcionalesRellenos ? ` · ${opcionalesRellenos}` : ''}
        </Boton>
      </>
    )
    barra = pendientes.length ? null : (
      <Boton variante="marca" alto="xl" className="w-full" onClick={() => { setPaso('comprobar'); subirArriba() }}>
        {t('movil.siguiente_comprobar')}<ChevronRight className="h-7 w-7" strokeWidth={2.6} />
      </Boton>
    )
  } else {
    contenido = (
      <>
        <h2 className="text-[23px] font-bold text-[#111]">{t('movil.comprueba_y_genera')}</h2>
        {BLOQUES.map((b) => {
          const campos = b.campos.filter((c) => obligatorios.includes(c))
          if (!campos.length) return null
          const Icono = b.icono
          return (
            <div key={b.id} className="flex flex-col gap-2 rounded-2xl border-2 border-[#111] bg-white p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <b className="flex items-center gap-2 text-[19px] text-[#111]"><Icono className="h-6 w-6" aria-hidden="true" />{t(`movil.bloque_${b.id}`)}</b>
                </span>
                <Boton variante="borde" alto="m" onClick={() => setHoja({ tipo: 'bloque', id: b.id })}><Pencil className="h-5 w-5" />{t('movil.cambiar')}</Boton>
              </div>
              {campos.map((c) => (
                <div key={c}>
                  <span className="flex items-center gap-2 text-[15px] font-bold text-[#3B333A]">
                    {t(`movil.campo_${c}`)}
                    {estadoDe(c) !== 'ok' && <Pastilla estado={estadoDe(c)} t={t} />}
                  </span>
                  <strong className={`block break-words text-[19px] text-[#111] ${CAMPOS[c]?.mono ? 'font-mono' : ''}`}>
                    {CAMPOS[c]?.tipo === 'datetime-local' ? fechaLegible(form[c]) : (form[c] || '—')}
                  </strong>
                </div>
              ))}
              {b.id === 'transporte' && form.sin_remolque && (
                <div>
                  <span className="text-[15px] font-bold text-[#3B333A]">{t('movil.campo_matricula_remolque')}</span>
                  <strong className="block text-[19px] text-[#111]">{t('movil.sin_remolque_valor')}</strong>
                </div>
              )}
            </div>
          )
        })}
        <FilaDocumentos documentos={documentos} onAbrir={() => setHoja({ tipo: 'docs' })} onOtro={() => refCamara.current?.click()} t={t} />
        <Boton variante="borde" onClick={() => setHoja({ tipo: 'mas' })}>
          <Plus className="h-6 w-6" strokeWidth={2.6} />
          {t('movil.mas_datos')}{opcionalesRellenos ? ` · ${opcionalesRellenos}` : ''}
        </Boton>
      </>
    )
    barra = pendientes.length ? null : modoPapel ? (
      <Boton variante="verde" alto="xl" className="w-full" onClick={() => onRegistrarPapel?.()}>
        <FileText className="h-7 w-7" />{t('campo.btn_registrar_papel')}
      </Boton>
    ) : bloqueadoSinRed ? (
      <p role="status" className="flex items-start gap-2.5 rounded-2xl border-[3px] border-[#111] bg-white p-3.5 text-[18px] font-bold text-[#111]">
        <WifiOff className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />{t('campo.necesita_red_barra')}
      </p>
    ) : (
      <Boton variante="verde" alto="xl" className="w-full" onClick={() => setHoja({ tipo: 'generar' })}>
        {sinConexion
          ? (modoSinCobertura === 'generar_al_volver'
            ? <><Save className="h-7 w-7" />{t('campo.guardar_para_luego')}</>
            : <><Printer className="h-7 w-7" />{t('offline.generar_imprimir')}</>)
          : <><QrCode className="h-7 w-7" />{t('movil.generar_deca')}</>}
      </Boton>
    )
  }

  // Con datos pendientes, el mismo botón de abajo lleva al primero que falta.
  if (!enInicio && pendientes.length) {
    barra = (
      <Boton variante={faltan ? 'rojo' : 'ambar'} alto="xl" className="w-full" onClick={irAPendiente}>
        {faltan ? <AlertCircle className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
        {faltan ? t('movil.faltan_datos', { count: faltan }) : t('movil.revisa_datos', { count: pendientes.length })}
      </Boton>
    )
  }

  // ── Hojas inferiores ──
  let hojaUI = null
  const cerrar = () => setHoja(null)
  if (hoja?.tipo === 'bloque') {
    const b = BLOQUES.find((x) => x.id === hoja.id)
    hojaUI = (
      <Hoja titulo={t(`movil.bloque_${b.id}`)} onCerrar={cerrar} t={t} pie={<Boton alto="xl" onClick={cerrar}>{t('movil.listo')}</Boton>}>
        {b.campos.filter((c) => obligatorios.includes(c)).map((c) => campo(c))}
      </Hoja>
    )
  } else if (hoja?.tipo === 'mas') {
    hojaUI = (
      <Hoja titulo={t('movil.mas_datos')} onCerrar={cerrar} t={t} pie={<Boton alto="xl" onClick={cerrar}>{t('movil.listo')}</Boton>}>
        {opcionales.map((g) => (
          <section key={g.id} className="flex flex-col gap-2.5">
            <h3 className="mt-1 text-[15px] font-bold uppercase tracking-wide text-[#3B333A]">{t(`movil.grupo_${g.id}`)}</h3>
            {g.campos.map((c) => campo(c, false))}
          </section>
        ))}
        <section className="flex flex-col gap-2.5">
          <h3 className="mt-1 text-[15px] font-bold uppercase tracking-wide text-[#3B333A]">{t('movil.grupo_sucesivos')}</h3>
          {!expedicion?.id || expedicion.estado !== 'borrador' ? (
            <p className="text-[17px] font-bold text-[#3B333A]">{t('movil.sucesivos_no_disponible')}</p>
          ) : (
            <>
              {sucesivos.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-2xl border-2 border-[#111] bg-white p-3">
                  <span className="flex-1 text-[17px] font-bold text-[#111]">
                    #{s.orden} {s.nombre}
                    <span className="block font-mono text-[16px]">{s.nif}{s.matricula ? ` · ${s.matricula}` : ''}</span>
                  </span>
                  <button type="button" onClick={() => onBorrarSucesivo(s)} className="grid h-12 w-12 place-items-center rounded-xl border-2 border-[#B3121B] text-[#B3121B]" aria-label={t('movil.borrar_sucesivo', { nombre: s.nombre })}>
                    <Trash2 className="h-6 w-6" />
                  </button>
                </div>
              ))}
              <div className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-[#111] bg-white p-3">
                {['nombre', 'nif', 'matricula'].map((k) => (
                  <label key={k} className="flex flex-col gap-1 text-[17px] font-bold text-[#111]">
                    {t(`movil.sucesivo_${k}`)}
                    <input
                      value={nuevoSucesivo[k]}
                      onChange={(e) => setNuevoSucesivo((n) => ({ ...n, [k]: k === 'nombre' ? e.target.value : e.target.value.toUpperCase() }))}
                      className={`h-[56px] rounded-xl border-2 border-[#111] px-3.5 text-[19px] font-bold ${k === 'nombre' ? '' : 'font-mono'}`}
                      autoComplete="off"
                    />
                  </label>
                ))}
                <Boton variante="borde" disabled={guardandoSucesivo || vacio(nuevoSucesivo.nombre) || vacio(nuevoSucesivo.nif)} onClick={onAgregarSucesivo}>
                  {guardandoSucesivo ? <Loader2 className="h-6 w-6 animate-spin" /> : <Plus className="h-6 w-6" />}{t('movil.anadir_sucesivo')}
                </Boton>
              </div>
            </>
          )}
        </section>
      </Hoja>
    )
  } else if (hoja?.tipo === 'docs') {
    hojaUI = (
      <Hoja titulo={t('movil.documentos')} onCerrar={cerrar} t={t} pie={<Boton alto="xl" onClick={() => { cerrar(); refCamara.current?.click() }}><Camera className="h-7 w-7" />{t('movil.anadir_foto')}</Boton>}>
        {documentos.length === 0 && <p className="text-[18px] font-bold text-[#111]">{t('movil.sin_documentos')}</p>}
        {documentos.map((d) => (
          <div key={d.id} className="flex flex-col gap-2.5 rounded-2xl border-2 border-[#111] bg-white p-3">
            <span className="flex items-center gap-2 text-[17px] font-bold text-[#111] break-all">
              <FileText className="h-6 w-6 shrink-0" aria-hidden="true" />{d.nombre_original}
            </span>
            <label className="flex flex-col gap-1 text-[16px] font-bold text-[#3B333A]">
              {t('movil.tipo_documento')}
              <select
                value={d.tipo_documento}
                onChange={(e) => onCambiarTipoDocumento(d, e.target.value)}
                className="h-[56px] rounded-xl border-2 border-[#111] bg-white px-3 text-[19px] font-bold text-[#111]"
              >
                {TIPOS_DOCUMENTO.map((tipo) => (
                  <option key={tipo} value={tipo}>{t(`tipos.${tipo === 'albaran_venta' ? 'alb_venta' : tipo}`)}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <a href={d.archivo} target="_blank" rel="noopener noreferrer" className="flex min-h-[52px] flex-col items-center justify-center rounded-xl border-2 border-[#111] text-[15px] font-bold text-[#111]">
                <Eye className="h-5 w-5" />{t('movil.ver')}
              </a>
              <button type="button" onClick={() => { cerrar(); onReleerDocumento(d) }} className="flex min-h-[52px] flex-col items-center justify-center rounded-xl border-2 border-[#111] text-[15px] font-bold text-[#111]">
                <RefreshCw className="h-5 w-5" />{t('movil.leer_otra_vez')}
              </button>
              <button type="button" onClick={() => onBorrarDocumento(d)} className="flex min-h-[52px] flex-col items-center justify-center rounded-xl border-2 border-[#B3121B] text-[15px] font-bold text-[#B3121B]">
                <Trash2 className="h-5 w-5" />{t('movil.quitar')}
              </button>
            </div>
          </div>
        ))}
      </Hoja>
    )
  } else if (hoja?.tipo === 'menu') {
    hojaUI = (
      <Hoja titulo={t('movil.opciones')} onCerrar={cerrar} t={t}>
        <Boton variante="borde" onClick={() => { cerrar(); onVistaPrevia() }}><Eye className="h-6 w-6" />{t('movil.vista_previa')}</Boton>
        <Boton variante="borde" onClick={() => setHoja({ tipo: 'docs' })}><FileText className="h-6 w-6" />{t('movil.documentos')} · {documentos.length}</Boton>
        {expedicion?.estado === 'borrador' && (
          <Boton variante="peligro" onClick={() => setHoja({ tipo: 'borrar' })}><Trash2 className="h-6 w-6" />{t('movil.borrar_borrador')}</Boton>
        )}
      </Hoja>
    )
  } else if (hoja?.tipo === 'borrar') {
    hojaUI = (
      <Hoja
        titulo={t('movil.borrar_borrador_titulo')}
        onCerrar={cerrar}
        t={t}
        pie={<>
          <Boton variante="rojo" alto="xl" onClick={() => { cerrar(); onBorrarBorrador() }}><Trash2 className="h-7 w-7" />{t('movil.si_borrar')}</Boton>
          <Boton variante="borde" onClick={cerrar}>{t('movil.no_volver')}</Boton>
        </>}
      >
        <p className="text-[19px] font-bold text-[#111]">{t('movil.borrar_borrador_desc')}</p>
      </Hoja>
    )
  } else if (hoja?.tipo === 'ayuda') {
    hojaUI = (
      <Hoja titulo={t('ayuda_deca.titulo')} onCerrar={cerrar} t={t} pie={<Boton alto="xl" onClick={cerrar}>{t('movil.listo')}</Boton>}>
        <AyudaCuandoDeca grande />
      </Hoja>
    )
  } else if (hoja?.tipo === 'calidad') {
    const { archivos } = hoja
    hojaUI = (
      <Hoja
        titulo={t('movil.calidad_titulo')}
        onCerrar={cerrar}
        t={t}
        pie={<>
          <Boton alto="xl" onClick={() => { cerrar(); refCamara.current?.click() }}><Camera className="h-7 w-7" />{t('movil.repetir_foto')}</Boton>
          <Boton variante="borde" onClick={() => { cerrar(); subirArchivos(archivos) }}>{t('movil.usar_igualmente')}</Boton>
        </>}
      >
        {hoja.movida && (
          <p className="flex items-start gap-2.5 rounded-xl border-2 border-[#C98A00] bg-[#FFF6D6] p-3 text-[18px] font-bold text-[#111]">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-[#8A5A00]" aria-hidden="true" />{t('movil.calidad_movida')}
          </p>
        )}
        {hoja.reflejos && (
          <p className="flex items-start gap-2.5 rounded-xl border-2 border-[#C98A00] bg-[#FFF6D6] p-3 text-[18px] font-bold text-[#111]">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-[#8A5A00]" aria-hidden="true" />{t('movil.calidad_reflejos')}
          </p>
        )}
        {/* Segundo intento fallido: no seguir peleándose con la cámara (pedido
            del usuario 2026-09-28 -- "es de lógica, pero habrá gente que no cae"). */}
        {hoja.intento >= 2 && (
          <div className="flex flex-col gap-2.5 rounded-xl border-2 border-[#111] bg-white p-3">
            <p className="text-[18px] font-bold text-[#111]">{t('movil.segundo_intento', { count: obligatorios.length })}</p>
            <Boton variante="borde" onClick={() => { cerrar(); if (enInicio) { setEnInicio(false); onEmpezarManual() } }}>
              <Pencil className="h-6 w-6" />{t('movil.rellenar_a_mano')}
            </Boton>
          </div>
        )}
      </Hoja>
    )
  } else if (hoja?.tipo === 'generar') {
    hojaUI = (
      <Hoja
        titulo={t('movil.generar_titulo')}
        onCerrar={cerrar}
        t={t}
        pie={<>
          <Boton variante="verde" alto="xl" onClick={() => { cerrar(); onGenerar() }}>
            {!sinConexion ? <><QrCode className="h-7 w-7" />{t('movil.si_generar')}</>
              : modoSinCobertura === 'generar_al_volver' ? <><Save className="h-7 w-7" />{t('campo.si_guardar_para_luego')}</>
                : <><Printer className="h-7 w-7" />{t('offline.si_imprimir')}</>}
          </Boton>
          <Boton variante="borde" onClick={cerrar}>{t('movil.todavia_no')}</Boton>
        </>}
      >
        {sinConexion ? (
          <p className="text-[19px] font-bold text-[#111]">{modoSinCobertura === 'generar_al_volver' ? t('campo.guardar_para_luego_desc') : t('offline.generar_desc')}</p>
        ) : (
          <>
            <p className="text-[19px] font-bold text-[#111]">{t('movil.generar_desc')}</p>
            <p className="flex items-center gap-2 rounded-xl border-2 border-[#C98A00] bg-[#FFF6D6] p-3 text-[17px] font-bold text-[#111]">
              <Clock className="h-6 w-6 shrink-0" aria-hidden="true" />{t('movil.generar_plazo')}
            </p>
          </>
        )}
      </Hoja>
    )
  }

  // Pantalla completa DE VERDAD: fuera del árbol de la app (portal) y con el
  // resto marcado `inert` mientras está abierta. Sin esto, la barra inferior y
  // la cabecera del ERP seguían tapadas pero alcanzables con el tabulador y por
  // un lector de pantalla (lo detectó axe-core al auditar esta pantalla).
  return createPortal(
    <div className="fixed inset-0 z-[55] flex flex-col bg-[#F1EEF0] pt-[env(safe-area-inset-top,0px)] text-[#111]">
      <input ref={refCamara} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => { elegirArchivos(e.target.files); e.target.value = '' }} />
      <input ref={refArchivo} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif" multiple className="hidden" onChange={(e) => { elegirArchivos(e.target.files); e.target.value = '' }} />

      <header className="flex h-[60px] shrink-0 items-center gap-1 border-b-2 border-[#111] bg-white px-2">
        <button type="button" onClick={volver} className="grid h-12 w-12 place-items-center rounded-xl text-[#111]" aria-label={t('movil.volver')}>
          <ArrowLeft className="h-7 w-7" strokeWidth={2.6} />
        </button>
        <h1 className="flex-1 truncate text-[21px] font-bold">{t('movil.titulo')}</h1>
        {indicadorGuardado}
        {expedicion?.id && (
          <button type="button" onClick={() => setHoja({ tipo: 'menu' })} className="grid h-12 w-12 place-items-center rounded-xl text-[#111]" aria-label={t('movil.opciones')}>
            <MoreVertical className="h-7 w-7" strokeWidth={2.6} />
          </button>
        )}
      </header>

      <main ref={refContenido} className={`flex flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 pt-4 ${barra ? 'pb-28' : 'pb-6'}`}>
        {/* Sin cobertura en la finca: se sigue trabajando. El DeCA se imprime
            aquí y se registra solo en Appodo cuando vuelve la red. */}
        {modoPapel && (
          <div role="status" className="flex items-start gap-2.5 rounded-2xl border-[3px] border-[#111] bg-white p-3.5 text-[17px] font-bold text-[#111]">
            <FileText className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />{t('campo.movil_papel_banner')}
          </div>
        )}
        {sinConexion && (
          <div role="status" className="flex items-start gap-2.5 rounded-2xl border-[3px] border-[#111] bg-[#FFF3C4] p-3.5 text-[17px] font-bold text-[#111]">
            <WifiOff className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
            <span>
              {bloqueadoSinRed ? t('campo.necesita_red_banner') : modoSinCobertura === 'generar_al_volver' ? t('campo.generar_al_volver_banner') : t('offline.banner')}
              {fotosSinConexion > 0 && <span className="mt-1 block">{t('offline.fotos_en_movil', { count: fotosSinConexion })}</span>}
            </span>
          </div>
        )}
        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-2xl border-[3px] border-[#B3121B] bg-white p-3.5 text-[17px] font-bold text-[#B3121B]">
            <AlertCircle className="mt-0.5 h-6 w-6 shrink-0" />{error}
          </div>
        )}
        {contenido}
      </main>

      {barra && (
        <div className="absolute inset-x-0 bottom-0 z-10 border-t-2 border-[#111] bg-white px-3.5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
          {barra}
        </div>
      )}

      {hojaUI}

      {ocupado && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-white/95 text-center" role="status" aria-live="polite">
          <div>
            <div className="relative mx-auto mb-5 h-[150px] w-[120px] overflow-hidden rounded-[10px] border-[3px] border-[#111] bg-[#FAF7F0]" aria-hidden="true">
              <div className="absolute inset-x-4 top-6 h-[70px] bg-[repeating-linear-gradient(#111_0_3px,transparent_3px_14px)] opacity-50" />
              <div className="absolute inset-x-0 top-1/2 h-1.5 animate-pulse bg-[var(--color-marca)] motion-reduce:animate-none" />
            </div>
            <b className="text-[23px]">{ocupado}</b>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

// ¿Está este móvil listo para trabajar sin cobertura? Se prepara solo al
// iniciar sesión con red (Layout); aquí se enseña para comprobarlo de un
// vistazo antes de salir al campo, junto con la opción de instalar la app.
const DIAS_AGENDA_VIEJA = 7

function EstadoSinCobertura({ preparadoEn, sinConexion, t }) {
  const [instalable, setInstalable] = useState(puedeInstalar())
  useEffect(() => alCambiarInstalable(setInstalable), [])
  // undefined = todavía se está comprobando: no se afirma nada.
  if (preparadoEn === undefined) return null
  const dias = preparadoEn ? Math.floor((Date.now() - preparadoEn) / 86400000) : null
  const fecha = preparadoEn
    ? new Date(preparadoEn).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''
  let icono = <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#08622F]" strokeWidth={3} aria-hidden="true" />
  let texto = t('campo.listo_sin_cobertura', { fecha })
  if (!preparadoEn) {
    icono = <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#8A5A00]" aria-hidden="true" />
    texto = sinConexion ? t('campo.no_preparado_sin_red') : t('campo.preparando')
  } else if (dias >= DIAS_AGENDA_VIEJA) {
    icono = <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#8A5A00]" aria-hidden="true" />
    texto = t('campo.agenda_vieja', { count: dias })
  }
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="flex items-start gap-2 text-[16px] font-bold text-[#111]">{icono}{texto}</p>
      {instalable && (
        <Boton variante="borde" alto="m" onClick={() => instalar()}>
          <Download className="h-5 w-5" aria-hidden="true" />{t('campo.instalar_app')}
        </Boton>
      )}
      {instalable && <p className="text-[15px] font-bold text-[#3B333A]">{t('campo.instalar_app_desc')}</p>}
    </div>
  )
}

function FilaDocumentos({ documentos, onAbrir, onOtro, t }) {
  if (!documentos.length) {
    return (
      <Boton variante="borde" onClick={onOtro}><Camera className="h-6 w-6" />{t('movil.anadir_foto')}</Boton>
    )
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-[#111] bg-white p-2.5">
      <button type="button" onClick={onAbrir} className="flex flex-1 items-center gap-3 text-left" aria-label={t('movil.ver_documentos')}>
        <span className="grid h-[66px] w-[54px] shrink-0 place-items-center rounded-md border-2 border-[#111] bg-[#FAF7F0]"><FileText className="h-7 w-7" aria-hidden="true" /></span>
        <span>
          <b className="block text-[18px] text-[#111]">{t('movil.n_documentos', { count: documentos.length })}</b>
          <span className="flex items-center gap-1 text-[16px] font-bold text-[#08532A]"><Check className="h-4 w-4" strokeWidth={3} />{t('movil.subido')}</span>
        </span>
      </button>
      <Boton variante="borde" alto="m" onClick={onOtro}><Plus className="h-5 w-5" strokeWidth={2.6} />{t('movil.otro')}</Boton>
    </div>
  )
}
