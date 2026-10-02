import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileScan, Plus, Pencil, Trash2, Loader2, Upload, AlertTriangle, Info, Sparkles } from 'lucide-react'
import { decaService } from '../../services/decaService'
import { reducirImagen } from '../../lib/reducirImagen'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { Checkbox } from '../ui/checkbox'
import { Textarea } from '../ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog'
import { useToast } from '../../context/ToastContext'

// Modelos de documento de la empresa (backend: services/plantillas_service.py).
// Se reconocen solos al subir un documento a una expedición: la IA recibe
// las indicaciones del modelo y se rellenan los datos que ese modelo trae
// siempre igual. Diseñado con documentos reales de un cliente (albarán de un
// exportador, ticket de báscula, hoja de entrada de una cooperativa).

// Mismos que CAMPOS_FIJABLES del backend: lo que un modelo puede traer
// siempre igual (nunca peso, fecha, matrícula ni conductor).
const CAMPOS_FIJABLES = [
  'nombre_cargador', 'nif_cargador',
  'nombre_transportista', 'nif_transportista',
  'nombre_destinatario', 'nif_destinatario',
  'origen', 'destino', 'naturaleza_mercancia',
]

const MAXIMO_INSTRUCCIONES = 1500

const FORM_VACIO = {
  nombre: '', tipo_documento: 'albaran_venta', texto_identificativo: '', instrucciones: '', activo: true,
}

function valoresIniciales(valoresFijos = {}) {
  return Object.fromEntries(CAMPOS_FIJABLES.map((c) => [c, {
    marcado: Boolean(valoresFijos[c]), valor: valoresFijos[c] || '',
  }]))
}

export default function PlantillasDocumentoDeca() {
  const { t } = useTranslation('deca')
  const toast = useToast()
  const inputArchivoRef = useRef(null)

  const [plantillas, setPlantillas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [dialogAbierto, setDialogAbierto] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_VACIO)
  const [fijos, setFijos] = useState(valoresIniciales())
  const [analizando, setAnalizando] = useState(false)
  const [analisis, setAnalisis] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [aBorrar, setABorrar] = useState(null)

  const etiquetaCampo = (c) => t(`expedicion.label_campo_${c}`, c)
  const etiquetaTipo = (tipo) => ({
    albaran_venta: t('plantillas.tipo_albaran', 'Albarán de venta'),
    cmr: t('plantillas.tipo_cmr', 'CMR'),
    otro: t('plantillas.tipo_otro', 'Otro (ticket, hoja de salida...)'),
  }[tipo] || tipo)

  // `toast` es un objeto nuevo en cada render del ToastProvider: por ref, o
  // cada aviso volvería a disparar la carga.
  const toastRef = useRef(toast)
  toastRef.current = toast

  const cargar = useCallback(() => {
    setCargando(true)
    decaService.listarPlantillas()
      .then(({ data }) => setPlantillas(data.results ?? data))
      .catch(() => toastRef.current.error(t('plantillas.error_cargar', 'No se pudieron cargar los modelos de documento.')))
      .finally(() => setCargando(false))
  }, [t])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => {
    setEditando(null)
    setForm(FORM_VACIO)
    setFijos(valoresIniciales())
    setAnalisis(null)
    setDialogAbierto(true)
  }

  const abrirEdicion = (plantilla) => {
    setEditando(plantilla)
    setForm({
      nombre: plantilla.nombre, tipo_documento: plantilla.tipo_documento,
      texto_identificativo: plantilla.texto_identificativo, instrucciones: plantilla.instrucciones,
      activo: plantilla.activo,
    })
    setFijos(valoresIniciales(plantilla.valores_fijos))
    setAnalisis(null)
    setDialogAbierto(true)
  }

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }))
  const setFijo = (campo, cambios) => setFijos((f) => ({ ...f, [campo]: { ...f[campo], ...cambios } }))

  const handleEjemplo = async (fileList) => {
    let archivo = fileList?.[0]
    if (!archivo) return
    setAnalizando(true)
    setAnalisis(null)
    try {
      archivo = new File([await archivo.arrayBuffer()], archivo.name, { type: archivo.type })
      archivo = await reducirImagen(archivo)
      const { data } = await decaService.analizarEjemploPlantilla(archivo)
      setAnalisis(data)
      if (data.ia_error) toast.error(`${t('expedicion.ia_no_disponible', 'La IA no ha podido leer el documento.')} ${data.ia_error}`, 12000)
      // Se proponen los datos leídos, sin marcar: marcar "siempre igual" es
      // una decisión de la persona, no de la IA.
      setFijos((previos) => {
        const siguiente = { ...previos }
        for (const c of CAMPOS_FIJABLES) {
          const leido = data.campos?.[c]
          if (leido && !siguiente[c].valor) siguiente[c] = { ...siguiente[c], valor: String(leido) }
        }
        return siguiente
      })
      setForm((f) => ({
        ...f,
        texto_identificativo: f.texto_identificativo || data.texto_identificativo_sugerido || '',
        nombre: f.nombre || (data.campos?.nombre_cargador
          ? `${t('plantillas.nombre_sugerido', 'Documento de')} ${data.campos.nombre_cargador}` : ''),
      }))
    } catch (err) {
      toast.error(err.response?.data?.archivo?.[0] || t('plantillas.error_analizar', 'No se pudo leer el documento de ejemplo.'))
    } finally {
      setAnalizando(false)
      if (inputArchivoRef.current) inputArchivoRef.current.value = ''
    }
  }

  const handleGuardar = async () => {
    if (!form.nombre.trim()) {
      toast.error(t('plantillas.error_nombre', 'Ponle un nombre al modelo.'))
      return
    }
    const valores_fijos = Object.fromEntries(
      CAMPOS_FIJABLES.filter((c) => fijos[c].marcado && fijos[c].valor.trim()).map((c) => [c, fijos[c].valor.trim()]),
    )
    setGuardando(true)
    try {
      const payload = { ...form, valores_fijos }
      if (editando) await decaService.actualizarPlantilla(editando.id, payload)
      else await decaService.crearPlantilla(payload)
      toast.success(t('plantillas.guardado', 'Modelo de documento guardado.'))
      setDialogAbierto(false)
      cargar()
    } catch (err) {
      const datos = err.response?.data
      const mensaje = datos && typeof datos === 'object'
        ? Object.values(datos).flat().join(' ')
        : t('plantillas.error_guardar', 'No se pudo guardar el modelo.')
      toast.error(mensaje)
    } finally {
      setGuardando(false)
    }
  }

  const handleActivo = async (plantilla, activo) => {
    setPlantillas((lista) => lista.map((p) => (p.id === plantilla.id ? { ...p, activo } : p)))
    try {
      await decaService.actualizarPlantilla(plantilla.id, { activo })
    } catch {
      toast.error(t('plantillas.error_guardar', 'No se pudo guardar el modelo.'))
      cargar()
    }
  }

  const handleBorrar = async () => {
    try {
      await decaService.borrarPlantilla(aBorrar.id)
      toast.success(t('plantillas.borrado', 'Modelo eliminado.'))
      setABorrar(null)
      cargar()
    } catch {
      toast.error(t('plantillas.error_borrar', 'No se pudo eliminar el modelo.'))
    }
  }

  const sugerencias = plantillas.flatMap((p) => (p.sugerencias_valores_fijos || []).map((s) => ({ plantilla: p, ...s })))

  const handleFijarSugerencia = async (plantilla, campo, valor) => {
    try {
      await decaService.actualizarPlantilla(plantilla.id, {
        valores_fijos: { ...(plantilla.valores_fijos || {}), [campo]: valor },
      })
      toast.success(t('plantillas.fijado', { campo: etiquetaCampo(campo) }))
      cargar()
    } catch {
      toast.error(t('plantillas.error_guardar', 'No se pudo guardar el modelo.'))
    }
  }

  const reconocidoPor = (p) => p.texto_identificativo
    || t('plantillas.reconoce_ia', 'Lo reconoce la IA por su aspecto')

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <FileScan className="h-4 w-4 text-[var(--color-marca)]" /> {t('plantillas.titulo', 'Modelos de documento')}
            </CardTitle>
            <CardDescription className="mt-1">
              {t('plantillas.descripcion', 'Da de alta los documentos que recibes o emites siempre con el mismo formato (tu albarán, el ticket de la báscula, la hoja de un cliente...). Al subir uno a una expedición se reconoce solo y se lee mejor. El CMR no hace falta: se lee igual para todas las empresas.')}
            </CardDescription>
          </div>
          <Button type="button" size="sm" className="gap-1.5 shrink-0" onClick={abrirNuevo}>
            <Plus className="h-4 w-4" /> {t('plantillas.nuevo', 'Nuevo modelo')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {cargando && <Loader2 className="h-5 w-5 animate-spin text-[var(--color-marca)]" />}
        {!cargando && plantillas.length === 0 && (
          <p className="text-sm text-gray-500">
            {t('plantillas.vacio', 'Todavía no hay modelos. Pulsa "Nuevo modelo" y sube un documento de ejemplo.')}
          </p>
        )}
        {!cargando && plantillas.length > 0 && (
          <>
            {/* Tabla -- SOLO tablet/escritorio */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="py-2 pr-3 font-medium">{t('plantillas.col_nombre', 'Modelo')}</th>
                    <th className="py-2 pr-3 font-medium">{t('plantillas.col_tipo', 'Tipo')}</th>
                    <th className="py-2 pr-3 font-medium">{t('plantillas.col_reconoce', 'Se reconoce por')}</th>
                    <th className="py-2 pr-3 font-medium">{t('plantillas.col_usos', 'Veces usado')}</th>
                    <th className="py-2 pr-3 font-medium">{t('plantillas.col_activo', 'Activo')}</th>
                    <th className="py-2 font-medium sr-only">{t('plantillas.col_acciones', 'Acciones')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {plantillas.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 font-medium text-gray-900">{p.nombre}</td>
                      <td className="py-2 pr-3 text-gray-600">{etiquetaTipo(p.tipo_documento)}</td>
                      <td className="py-2 pr-3 text-gray-600 max-w-xs truncate">{reconocidoPor(p)}</td>
                      <td className="py-2 pr-3 text-gray-600">{p.veces_aplicada}</td>
                      <td className="py-2 pr-3">
                        <Switch
                          checked={p.activo} onCheckedChange={(v) => handleActivo(p, v)}
                          aria-label={`${t('plantillas.col_activo', 'Activo')}: ${p.nombre}`}
                        />
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button
                          type="button" variant="ghost" size="icon" className="h-10 w-10"
                          onClick={() => abrirEdicion(p)} aria-label={`${t('plantillas.editar', 'Editar')}: ${p.nombre}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button" variant="ghost" size="icon" className="h-10 w-10 text-red-600"
                          onClick={() => setABorrar(p)} aria-label={`${t('plantillas.borrar', 'Eliminar')}: ${p.nombre}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas -- SOLO móvil. Misma info, mismas acciones */}
            <div className="md:hidden divide-y">
              {plantillas.map((p) => (
                <div key={p.id} className="py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 break-words">{p.nombre}</p>
                    <p className="text-xs text-gray-500">{etiquetaTipo(p.tipo_documento)} · {t('plantillas.col_usos', 'Veces usado')}: {p.veces_aplicada}</p>
                    <p className="text-xs text-gray-500 break-words">{reconocidoPor(p)}</p>
                  </div>
                  <Switch
                    checked={p.activo} onCheckedChange={(v) => handleActivo(p, v)}
                    aria-label={`${t('plantillas.col_activo', 'Activo')}: ${p.nombre}`}
                  />
                  <Button
                    type="button" variant="ghost" size="icon" className="h-10 w-10"
                    onClick={() => abrirEdicion(p)} aria-label={`${t('plantillas.editar', 'Editar')}: ${p.nombre}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button" variant="ghost" size="icon" className="h-10 w-10 text-red-600"
                    onClick={() => setABorrar(p)} aria-label={`${t('plantillas.borrar', 'Eliminar')}: ${p.nombre}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Propuestas de valores fijos -- fase 2 del aprendizaje
                (deca/services/aprendizaje_service.py): datos que han
                salido iguales en los últimos DeCA de un modelo. Nunca se
                aplican solos: los fija el administrador con un clic.
                Bloque único para tabla y tarjetas, no se duplica. */}
            {sugerencias.length > 0 && (
              <div className="mt-4 rounded-lg border border-[rgb(var(--color-marca-rgb)/0.25)] bg-[rgb(var(--color-marca-rgb)/0.04)] p-3 space-y-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Sparkles className="h-4 w-4 text-[var(--color-marca)]" aria-hidden="true" />
                  {t('plantillas.sugerencias_titulo')}
                </p>
                <ul className="space-y-2">
                  {sugerencias.map(({ plantilla, campo, valor, veces }) => (
                    <li key={`${plantilla.id}-${campo}`} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-800">
                      <span className="min-w-0 break-words">
                        {t('plantillas.sugerencia', { modelo: plantilla.nombre, campo: etiquetaCampo(campo), valor, veces })}
                      </span>
                      <Button type="button" size="sm" variant="outline" onClick={() => handleFijarSugerencia(plantilla, campo, valor)}>
                        {t('plantillas.fijar')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={dialogAbierto} onOpenChange={setDialogAbierto}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editando ? t('plantillas.titulo_editar', 'Editar modelo de documento') : t('plantillas.titulo_nuevo', 'Nuevo modelo de documento')}
            </DialogTitle>
            <DialogDescription>
              {t('plantillas.ayuda_dialogo', 'Sube un documento real de ejemplo: lo leemos y te proponemos los datos. Marca los que este modelo trae SIEMPRE iguales.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-gray-300 p-3">
              <input
                ref={inputArchivoRef} id="ejemplo_plantilla" type="file" className="sr-only"
                accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/*"
                onChange={(e) => handleEjemplo(e.target.files)}
              />
              <Button
                type="button" variant="outline" size="sm" className="gap-1.5" disabled={analizando}
                onClick={() => inputArchivoRef.current?.click()}
              >
                {analizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {analizando ? t('plantillas.leyendo', 'Leyendo el documento...') : t('plantillas.subir_ejemplo', 'Subir documento de ejemplo')}
              </Button>
              <p className="text-xs text-gray-500 mt-1.5">
                {t('plantillas.ayuda_ejemplo', 'No se guarda el fichero, solo lo que marques aquí.')}
              </p>
              {analisis?.plantilla_aplicada && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {t('plantillas.ya_reconocido', 'Este documento ya lo reconoce el modelo')} «{analisis.plantilla_aplicada}».
                </p>
              )}
              {analisis && !analisis.tiene_texto && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-indigo-700">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {t('plantillas.es_foto', 'Es una foto o un escaneo: la IA lo reconocerá por su aspecto. Describe en "Cómo leerlo" qué lo distingue (título, logotipo, empresa que lo emite).')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="plantilla_nombre">{t('plantillas.label_nombre', 'Nombre del modelo')}</Label>
                <Input
                  id="plantilla_nombre" value={form.nombre} maxLength={120}
                  placeholder={t('plantillas.placeholder_nombre', 'Ej. Albarán de Frutas del Sur')}
                  onChange={(e) => set('nombre', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plantilla_tipo">{t('plantillas.label_tipo', 'Tipo de documento')}</Label>
                <Select value={form.tipo_documento} onValueChange={(v) => set('tipo_documento', v)}>
                  <SelectTrigger id="plantilla_tipo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['albaran_venta', 'cmr', 'otro'].map((tipo) => (
                      <SelectItem key={tipo} value={tipo}>{etiquetaTipo(tipo)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plantilla_identificativo">{t('plantillas.label_identificativo', 'Se reconoce porque aparece')}</Label>
              <Input
                id="plantilla_identificativo" value={form.texto_identificativo} maxLength={255}
                placeholder={t('plantillas.placeholder_identificativo', 'Ej. V98765431, ALBARAN DE VENTA')}
                onChange={(e) => set('texto_identificativo', e.target.value)}
              />
              <p className="text-xs text-gray-500">
                {t('plantillas.ayuda_identificativo', 'Palabras separadas por comas que salen siempre en este documento, como el CIF de quien lo emite. Solo sirve en PDF con texto; las fotos y escaneos los reconoce la IA.')}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plantilla_instrucciones">{t('plantillas.label_instrucciones', 'Cómo leerlo (opcional)')}</Label>
              <Textarea
                id="plantilla_instrucciones" rows={3} value={form.instrucciones} maxLength={MAXIMO_INSTRUCCIONES}
                placeholder={t('plantillas.placeholder_instrucciones', 'Ej. El peso es el que pone NETO, no los dos pesos de la báscula. El destino es el que pone "Destino:".')}
                onChange={(e) => set('instrucciones', e.target.value)}
              />
              <p className="text-xs text-gray-500 text-right">{form.instrucciones.length}/{MAXIMO_INSTRUCCIONES}</p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-700">
                {t('plantillas.label_fijos', 'Datos que este modelo trae siempre iguales')}
              </legend>
              <p className="text-xs text-gray-500">
                {t('plantillas.ayuda_fijos', 'Se rellenarán solos cada vez que se reconozca el modelo. No marques lo que cambia en cada envío.')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CAMPOS_FIJABLES.map((c) => (
                  <div key={c} className="flex items-center gap-2">
                    <Checkbox
                      id={`fijo_${c}`} checked={fijos[c].marcado}
                      onCheckedChange={(v) => setFijo(c, { marcado: Boolean(v) })}
                    />
                    <div className="flex-1 min-w-0">
                      <Label htmlFor={`fijo_valor_${c}`} className="text-xs text-gray-600">{etiquetaCampo(c)}</Label>
                      <Input
                        id={`fijo_valor_${c}`} value={fijos[c].valor} maxLength={255} className="h-9"
                        onChange={(e) => setFijo(c, { valor: e.target.value, marcado: fijos[c].marcado || Boolean(e.target.value) })}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {analisis?.campos_dudosos?.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {t('plantillas.dudosos', 'Leído de letra a mano o poco clara, compruébalo:')}{' '}
                  {analisis.campos_dudosos.map(etiquetaCampo).join(', ')}
                </p>
              )}
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.activo} onCheckedChange={(v) => set('activo', v)} />
              {t('plantillas.label_activo', 'Modelo activo')}
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogAbierto(false)}>
              {t('plantillas.cancelar', 'Cancelar')}
            </Button>
            <Button type="button" onClick={handleGuardar} disabled={guardando || analizando} className="gap-1.5">
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('plantillas.guardar', 'Guardar modelo')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(aBorrar)} onOpenChange={(abierto) => !abierto && setABorrar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('plantillas.confirmar_borrado', 'Eliminar modelo de documento')}</DialogTitle>
            <DialogDescription>
              {t('plantillas.confirmar_borrado_desc', 'Los documentos ya subidos no cambian. Los próximos de este tipo se leerán sin las indicaciones del modelo. Si solo quieres pausarlo, desactívalo.')}
              {aBorrar && <strong className="block mt-1">{aBorrar.nombre}</strong>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setABorrar(null)}>
              {t('plantillas.cancelar', 'Cancelar')}
            </Button>
            <Button type="button" variant="destructive" onClick={handleBorrar}>
              {t('plantillas.borrar', 'Eliminar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
