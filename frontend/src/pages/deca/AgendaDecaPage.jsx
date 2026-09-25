import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { decaService } from '../../services/decaService'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import {
  Users2, Plus, Pencil, Trash2, Loader2, Search, Archive, ArchiveRestore,
  MoreHorizontal, FileText, FileSpreadsheet, ChevronLeft, ChevronRight,
  Upload, Download, CheckCircle2, AlertCircle,
} from 'lucide-react'
import SortableHeader from '../../components/ui/SortableHeader'
import { useToast } from '../../context/ToastContext'

// Los cuatro catálogos de DeCA en una sola pantalla. Se auto-alimentan al
// guardar expediciones, esto es para corregir una ficha mal escrita,
// borrarla o darla de alta por adelantado.
const CATALOGOS = [
  {
    tipo: 'transportistas',
    etiqueta: 'Transportistas',
    campos: [
      { name: 'nombre', label: 'Nombre o razón social', required: true, placeholder: 'Transportes Ejemplo SL' },
      { name: 'nif', label: 'NIF/CIF', required: true, placeholder: 'B12345674' },
      { name: 'telefono', label: 'Teléfono', placeholder: '600111222' },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'contacto@ejemplo.com' },
    ],
    columnas: ['nombre', 'nif', 'telefono', 'email'],
    principal: 'nombre',
    ordenDefecto: 'nombre',
  },
  {
    tipo: 'destinatarios',
    etiqueta: 'Destinatarios',
    campos: [
      { name: 'nombre', label: 'Nombre o razón social', required: true, placeholder: 'Cliente Ejemplo SA' },
      { name: 'nif', label: 'NIF/CIF', required: true, placeholder: 'B12345674' },
      { name: 'telefono', label: 'Teléfono', placeholder: '600111222' },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'contacto@ejemplo.com' },
    ],
    columnas: ['nombre', 'nif', 'telefono', 'email'],
    principal: 'nombre',
    ordenDefecto: 'nombre',
  },
  {
    tipo: 'conductores',
    etiqueta: 'Conductores',
    campos: [
      { name: 'nombre', label: 'Nombre', required: true, placeholder: 'Juan Pérez López' },
      { name: 'nif', label: 'NIF', required: true, placeholder: '12345678Z' },
      { name: 'telefono', label: 'Teléfono', placeholder: '600111222' },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'conductor@ejemplo.com' },
    ],
    columnas: ['nombre', 'nif', 'telefono', 'email'],
    principal: 'nombre',
    ordenDefecto: 'nombre',
  },
  {
    tipo: 'tractoras',
    etiqueta: 'Tractoras',
    campos: [
      { name: 'matricula', label: 'Matrícula', required: true, placeholder: '1234ABC' },
      { name: 'alias', label: 'Alias (opcional)', placeholder: 'Ej: Tractora 2' },
    ],
    columnas: ['matricula', 'alias'],
    principal: 'matricula',
    ordenDefecto: 'matricula',
  },
  {
    tipo: 'remolques',
    etiqueta: 'Remolques',
    campos: [
      { name: 'matricula', label: 'Matrícula', required: true, placeholder: '5678DEF' },
      { name: 'alias', label: 'Alias (opcional)', placeholder: 'Ej: Camión frío 2' },
    ],
    columnas: ['matricula', 'alias'],
    principal: 'matricula',
    ordenDefecto: 'matricula',
  },
]

const CAMPO_ORDENABLE = new Set(['nombre', 'nif', 'matricula', 'alias'])

const ETIQUETA_COLUMNA = {
  nombre: 'Nombre', nif: 'NIF/CIF', telefono: 'Teléfono', email: 'Email',
  matricula: 'Matrícula', alias: 'Alias',
}

export default function AgendaDecaPage() {
  const { t } = useTranslation('deca')
  const toast = useToast()

  const [tipoActivo, setTipoActivo] = useState(CATALOGOS[0].tipo)
  const [fichas, setFichas] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [ordering, setOrdering] = useState({ field: CATALOGOS[0].ordenDefecto, dir: 'asc' })
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [dialogAbierto, setDialogAbierto] = useState(false)
  const [editando, setEditando] = useState(null) // null = alta nueva
  const [form, setForm] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [erroresCampo, setErroresCampo] = useState({})
  const [aBorrar, setABorrar] = useState(null)
  const [exportando, setExportando] = useState(false)

  const [dialogImportarAbierto, setDialogImportarAbierto] = useState(false)
  const [archivoImportar, setArchivoImportar] = useState(null)
  const [importando, setImportando] = useState(false)
  const [resultadoImportar, setResultadoImportar] = useState(null)
  const [errorImportar, setErrorImportar] = useState('')

  const catalogo = CATALOGOS.find((c) => c.tipo === tipoActivo)

  const buildParams = useCallback((incluirPaginacion) => {
    const params = {}
    if (busqueda) params.q = busqueda
    if (ordering?.field) params.ordering = ordering.dir === 'desc' ? `-${ordering.field}` : ordering.field
    if (incluirPaginacion) {
      params.page = page
      params.page_size = pageSize
    } else {
      params.page_size = 500
    }
    return params
  }, [busqueda, ordering, page, pageSize])

  const cargar = useCallback(() => {
    setCargando(true)
    decaService.listarCatalogo(tipoActivo, buildParams(true))
      .then(({ data }) => {
        setFichas(data.results ?? data)
        setTotal(data.count ?? (Array.isArray(data) ? data.length : 0))
      })
      .catch(() => toast.error(t('agenda.error_cargar', 'No se pudo cargar la agenda.')))
      .finally(() => setCargando(false))
  }, [tipoActivo, buildParams]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => { setPage(1) }, [busqueda, tipoActivo])

  const handleCambiarTipo = (tipo) => {
    setTipoActivo(tipo)
    setBusqueda('')
    setOrdering({ field: CATALOGOS.find((c) => c.tipo === tipo).ordenDefecto, dir: 'asc' })
  }

  const handleSort = (field) => {
    if (!CAMPO_ORDENABLE.has(field)) return
    setOrdering((prev) => prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' })
    setPage(1)
  }

  const handleExportar = async (formato) => {
    setExportando(true)
    try {
      if (formato === 'pdf') await decaService.exportarAgendaPDF(tipoActivo, buildParams(false))
      else await decaService.exportarAgendaExcel(tipoActivo, buildParams(false))
    } catch (err) {
      toast.error(err.message || t('agenda.error_exportar', 'No se pudo generar la exportación.'))
    } finally {
      setExportando(false)
    }
  }

  const abrirImportar = () => {
    setArchivoImportar(null)
    setResultadoImportar(null)
    setErrorImportar('')
    setDialogImportarAbierto(true)
  }

  const handleDescargarPlantilla = () => {
    const headers = catalogo.campos.map((c) => c.name)
    const fila = catalogo.campos.map((c) => c.placeholder || '')
    const csv = headers.join(',') + '\n' + fila.join(',')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plantilla_agenda_deca_${tipoActivo}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImportar = async () => {
    if (!archivoImportar) return
    setImportando(true)
    setErrorImportar('')
    setResultadoImportar(null)
    try {
      const { data } = await decaService.importarAgendaCSV(tipoActivo, archivoImportar)
      setResultadoImportar(data)
      setArchivoImportar(null)
      if (data.creados > 0 || data.actualizados > 0) cargar()
    } catch (err) {
      setErrorImportar(err.response?.data?.detail || t('agenda.error_importar', 'No se pudo importar el archivo.'))
    } finally {
      setImportando(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const abrirAlta = () => {
    setEditando(null)
    setForm(Object.fromEntries(catalogo.campos.map((c) => [c.name, ''])))
    setErroresCampo({})
    setDialogAbierto(true)
  }

  const abrirEdicion = (ficha) => {
    setEditando(ficha)
    setForm(Object.fromEntries(catalogo.campos.map((c) => [c.name, ficha[c.name] ?? ''])))
    setErroresCampo({})
    setDialogAbierto(true)
  }

  const handleGuardar = async () => {
    setGuardando(true)
    setErroresCampo({})
    try {
      if (editando) {
        await decaService.actualizarEnCatalogo(tipoActivo, editando.id, form)
      } else {
        await decaService.crearEnCatalogo(tipoActivo, form)
      }
      setDialogAbierto(false)
      toast.success(t('mensajes.guardado_ok'))
      cargar()
    } catch (err) {
      const datos = err.response?.data
      if (datos && typeof datos === 'object') {
        setErroresCampo(Object.fromEntries(
          Object.entries(datos).map(([k, v]) => [k, Array.isArray(v) ? v.join(' ') : String(v)]),
        ))
      }
      toast.error(t('agenda.error_guardar', 'No se pudo guardar la ficha.'))
    } finally {
      setGuardando(false)
    }
  }

  // Archivar en vez de borrar cuando la ficha ya se usó: el borrado deja
  // intactas las expediciones (guardan NIF/nombre como texto congelado, son
  // un documento legal), pero archivar permite recuperarla.
  const handleArchivar = async (ficha) => {
    try {
      await decaService.actualizarEnCatalogo(tipoActivo, ficha.id, { activo: !ficha.activo })
      cargar()
    } catch {
      toast.error(t('agenda.error_guardar', 'No se pudo guardar la ficha.'))
    }
  }

  const handleBorrar = async () => {
    if (!aBorrar) return
    try {
      await decaService.borrarDeCatalogo(tipoActivo, aBorrar.id)
      setABorrar(null)
      toast.success(t('agenda.borrado_ok', 'Ficha eliminada.'))
      cargar()
    } catch {
      toast.error(t('agenda.error_borrar', 'No se pudo eliminar la ficha.'))
    }
  }

  const etiquetaDe = (ficha) => ficha[catalogo.principal] || '—'

  return (
    <div className="flex flex-col gap-4 w-full h-full min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <Users2 className="h-6 w-6 text-[var(--color-marca)]" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('agenda.title', 'Agenda')}</h1>
            <p className="text-sm text-gray-500">
              {t('agenda.subtitle', 'Transportistas, destinatarios, conductores y vehículos habituales. Se rellena sola al guardar expediciones.')}
            </p>
          </div>
        </div>
        <Button onClick={abrirAlta} className="gap-1.5 shrink-0">
          <Plus className="h-4 w-4" /> {t('agenda.btn_nuevo', 'Añadir ficha')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 shrink-0">
        {CATALOGOS.map((c) => (
          <button
            key={c.tipo}
            type="button"
            onClick={() => handleCambiarTipo(c.tipo)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              c.tipo === tipoActivo
                ? 'bg-[var(--color-marca)] text-white border-[var(--color-marca)]'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
            aria-pressed={c.tipo === tipoActivo}
          >
            {t(`agenda.tab_${c.tipo}`, c.etiqueta)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t('agenda.buscar', 'Buscar...')}
            aria-label={t('agenda.buscar', 'Buscar...')}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" disabled={exportando}>
              {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
              {t('agenda.btn_mas_acciones', 'Más acciones')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={abrirImportar} className="gap-2 cursor-pointer">
              <Upload className="h-4 w-4" /> {t('agenda.btn_importar_csv', 'Importar CSV')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExportar('pdf')} className="gap-2 cursor-pointer">
              <FileText className="h-4 w-4" /> {t('agenda.btn_exportar_pdf', 'Exportar PDF')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExportar('excel')} className="gap-2 cursor-pointer">
              <FileSpreadsheet className="h-4 w-4" /> {t('agenda.btn_exportar_excel', 'Exportar Excel')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Card className="flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
          {cargando ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-marca)]" />
            </div>
          ) : fichas.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-12 text-sm text-gray-400 px-4 text-center">
              {t('agenda.vacio', 'Todavía no hay fichas aquí. Se irán creando solas al guardar expediciones, o puedes añadirlas a mano.')}
            </div>
          ) : (
            <>
              {/* Tabla -- SOLO tablet/escritorio */}
              <div
                className="hidden md:block overflow-x-auto flex-1 min-h-0 overflow-y-auto"
                tabIndex={0}
                role="region"
                aria-label={t('agenda.title', 'Agenda')}
              >
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      {catalogo.columnas.map((col) => (
                        CAMPO_ORDENABLE.has(col) ? (
                          <SortableHeader
                            key={col}
                            label={t(`agenda.col_${col}`, ETIQUETA_COLUMNA[col] || col)}
                            field={col}
                            ordering={ordering}
                            onSort={handleSort}
                            className="font-semibold text-gray-600"
                          />
                        ) : (
                          <th key={col} className="text-left font-semibold text-gray-600 px-4 py-2.5">
                            {t(`agenda.col_${col}`, ETIQUETA_COLUMNA[col] || col)}
                          </th>
                        )
                      ))}
                      <th className="px-4 py-2.5 text-right font-semibold text-gray-600">
                        {t('agenda.col_acciones', 'Acciones')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {fichas.map((ficha) => (
                      <tr key={ficha.id} className={ficha.activo ? '' : 'opacity-50'}>
                        {catalogo.columnas.map((col) => (
                          <td key={col} className="px-4 py-2.5">{ficha[col] || '—'}</td>
                        ))}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <AccionesFicha
                              ficha={ficha}
                              onEditar={abrirEdicion}
                              onArchivar={handleArchivar}
                              onBorrar={setABorrar}
                              etiqueta={etiquetaDe(ficha)}
                              t={t}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas -- SOLO móvil. Misma info, MISMAS acciones */}
              <div className="md:hidden divide-y divide-gray-100 flex-1 min-h-0 overflow-y-auto">
                {fichas.map((ficha) => (
                  <div key={ficha.id} className={`p-4 ${ficha.activo ? '' : 'opacity-50'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{etiquetaDe(ficha)}</p>
                        {catalogo.columnas.filter((c) => c !== catalogo.principal).map((col) => (
                          ficha[col] ? (
                            <p key={col} className="text-xs text-gray-500 truncate">
                              {t(`agenda.col_${col}`, ETIQUETA_COLUMNA[col] || col)}: {ficha[col]}
                            </p>
                          ) : null
                        ))}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <AccionesFicha
                          ficha={ficha}
                          onEditar={abrirEdicion}
                          onArchivar={handleArchivar}
                          onBorrar={setABorrar}
                          etiqueta={etiquetaDe(ficha)}
                          t={t}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600 flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">{t('lista.filas_label')}</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-gray-400">{t('agenda.total_fichas', { defaultValue: '{{total}} fichas', total })}</span>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2">{t('lista.paginacion', { page, totalPages })}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Alta / edición */}
      <Dialog open={dialogAbierto} onOpenChange={setDialogAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editando
                ? t('agenda.editar_ficha', 'Editar ficha')
                : t('agenda.nueva_ficha', 'Nueva ficha')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {catalogo.campos.map((campo) => (
              <div key={campo.name} className="space-y-1.5">
                <Label htmlFor={`agenda-${campo.name}`}>
                  {t(`agenda.campo_${campo.name}`, campo.label)}
                  {campo.required && <span className="text-red-500"> *</span>}
                </Label>
                <Input
                  id={`agenda-${campo.name}`}
                  type={campo.type || 'text'}
                  value={form[campo.name] ?? ''}
                  placeholder={campo.placeholder}
                  onChange={(e) => setForm((f) => ({ ...f, [campo.name]: e.target.value }))}
                />
                {erroresCampo[campo.name] && (
                  <p className="text-xs text-red-600">{erroresCampo[campo.name]}</p>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAbierto(false)}>
              {t('expedicion.btn_cancelar')}
            </Button>
            <Button onClick={handleGuardar} disabled={guardando} className="gap-1.5">
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('expedicion.btn_guardar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de borrado -- pantalla propia, nunca window.confirm */}
      <Dialog open={Boolean(aBorrar)} onOpenChange={(abierto) => !abierto && setABorrar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('agenda.confirmar_borrado', 'Eliminar ficha')}</DialogTitle>
            <DialogDescription>
              {t(
                'agenda.confirmar_borrado_desc',
                'Se elimina solo de la agenda. Las expediciones ya creadas no cambian: guardan el NIF y el nombre tal cual, porque son un documento legal.',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setABorrar(null)}>{t('expedicion.btn_cancelar')}</Button>
            <Button onClick={handleBorrar} className="bg-red-600 hover:bg-red-700">
              {t('agenda.btn_borrar', 'Eliminar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Importar CSV -- alta masiva sobre el catálogo activo */}
      <Dialog open={dialogImportarAbierto} onOpenChange={setDialogImportarAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('agenda.importar_titulo', { defaultValue: 'Importar {{catalogo}}', catalogo: t(`agenda.tab_${tipoActivo}`, catalogo.etiqueta) })}
            </DialogTitle>
            <DialogDescription>
              {t('agenda.importar_desc', 'CSV con cabecera. Si una fila ya existe (mismo NIF, o misma matrícula tractora en Vehículos) se actualiza en vez de duplicarse.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <button
              type="button"
              onClick={handleDescargarPlantilla}
              className="flex items-center gap-2 text-sm text-[var(--color-marca)] hover:text-[rgb(var(--color-marca-dark-rgb))] font-medium"
            >
              <Download className="h-4 w-4" /> {t('agenda.btn_descargar_plantilla', 'Descargar plantilla CSV')}
            </button>

            <input
              type="file"
              accept=".csv"
              onChange={(e) => setArchivoImportar(e.target.files[0] || null)}
              aria-label={t('agenda.btn_importar_csv', 'Importar CSV')}
              className="block w-full text-sm text-gray-500
                file:mr-3 file:py-2 file:px-3
                file:rounded-full file:border-0
                file:text-sm file:font-semibold
                file:bg-[rgb(var(--color-marca-rgb)/0.1)] file:text-[var(--color-marca)]
                hover:file:bg-[rgb(var(--color-marca-rgb)/0.18)] cursor-pointer"
            />

            {errorImportar && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex gap-2 items-start">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>{errorImportar}</p>
              </div>
            )}

            {resultadoImportar && (
              <div className="p-3 bg-green-50 text-green-800 text-sm rounded-lg space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  {t('agenda.importar_resultado_titulo', 'Importación completada')}
                </div>
                <ul className="list-disc list-inside">
                  <li>{t('agenda.importar_creados', { defaultValue: '{{count}} fichas nuevas', count: resultadoImportar.creados })}</li>
                  <li>{t('agenda.importar_actualizados', { defaultValue: '{{count}} fichas actualizadas', count: resultadoImportar.actualizados })}</li>
                </ul>
                {resultadoImportar.errores?.length > 0 && (
                  <div className="text-red-600">
                    <p className="font-semibold mb-1">{t('agenda.importar_errores_titulo', 'Filas no importadas:')}</p>
                    <ul className="list-disc list-inside max-h-32 overflow-y-auto text-xs">
                      {resultadoImportar.errores.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogImportarAbierto(false)}>
              {t('expedicion.btn_cancelar')}
            </Button>
            <Button onClick={handleImportar} disabled={!archivoImportar || importando} className="gap-1.5">
              {importando && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('agenda.btn_importar_csv', 'Importar CSV')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Repetido entre la tabla de escritorio y las tarjetas de móvil -- extraído
// a propósito para que no se desincronicen.
function AccionesFicha({ ficha, onEditar, onArchivar, onBorrar, etiqueta, t }) {
  return (
    <>
      <button
        type="button"
        onClick={() => onEditar(ficha)}
        className="p-2 text-gray-400 hover:text-[var(--color-marca)]"
        aria-label={t('agenda.editar_aria', { defaultValue: 'Editar {{nombre}}', nombre: etiqueta })}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onArchivar(ficha)}
        className="p-2 text-gray-400 hover:text-amber-600"
        aria-label={ficha.activo
          ? t('agenda.archivar_aria', { defaultValue: 'Archivar {{nombre}}', nombre: etiqueta })
          : t('agenda.desarchivar_aria', { defaultValue: 'Recuperar {{nombre}}', nombre: etiqueta })}
      >
        {ficha.activo ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => onBorrar(ficha)}
        className="p-2 text-gray-400 hover:text-red-600"
        aria-label={t('agenda.borrar_aria', { defaultValue: 'Eliminar {{nombre}}', nombre: etiqueta })}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </>
  )
}
