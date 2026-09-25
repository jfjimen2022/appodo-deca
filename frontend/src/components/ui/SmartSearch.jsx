import React, { useState, useRef, useEffect } from 'react'
import { Search, Filter, Layers, Star, X, Check, ChevronDown, Save, Plus, Loader2, ArrowUpDown, CalendarRange } from 'lucide-react'
import { Input } from './input'
import { Button } from './button'
import { Badge } from './badge'
import { DateInput } from './DateInput'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './dropdown-menu'
import { busquedasGuardadasService } from '../../services/busquedasGuardadas'

const DATE_RANGE_VACIO = { desde: '', hasta: '' }

/**
 * SmartSearch Component (Odoo-style)
 *
 * @param {string} placeholder - Texto del buscador
 * @param {Array} config - { filters: [], groups: [], sorts: [] }
 * @param {Object} activeState - { search: '', filters: [], group: null, sort: null,
 *   dateRange: { desde: '', hasta: '' } }
 * @param {Function} onChange - Callback cuando cambia cualquier parámetro
 * @param {string} pagina - Clave única de esta pantalla (favoritos, ver
 *   services/busquedasGuardadas.js -- en este standalone es 100% local,
 *   localStorage, sin backend detrás)
 */
export function SmartSearch({
  placeholder = "Buscar...",
  config = { filters: [], groups: [], sorts: [] },
  activeState = { search: '', filters: [], group: null, sort: null },
  onChange,
  pagina,
  defaultSort,
}) {
  const [searchValue, setSearchValue] = useState(activeState.search || '')
  const [isOpen, setIsOpen] = useState(false)
  const [favorites, setFavorites] = useState([])
  const [guardandoFavorito, setGuardandoFavorito] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const pillRef = useRef(null)
  const [restingHeight, setRestingHeight] = useState(40)
  useEffect(() => {
    if (!pillRef.current || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver((entries) => {
      const h = entries[0]?.target?.getBoundingClientRect().height
      if (h) setRestingHeight(h)
    })
    obs.observe(pillRef.current)
    return () => obs.disconnect()
  }, [])
  const customFilters = activeState.customFilters || []
  const dateRange = activeState.dateRange || DATE_RANGE_VACIO

  const cargarFavoritos = () => {
    if (!pagina) return
    busquedasGuardadasService.listar(pagina)
      .then(({ data }) => setFavorites(data.results ?? data))
      .catch(() => {})
  }

  useEffect(() => { cargarFavoritos() }, [pagina])

  const ULTIMO_FILTRO_PREFIX = 'smartsearch_ultimo_'
  useEffect(() => {
    if (!pagina) return
    try {
      const raw = localStorage.getItem(ULTIMO_FILTRO_PREFIX + pagina)
      if (!raw) return
      const guardado = JSON.parse(raw)
      const vacio = !guardado.search && !(guardado.filters || []).length && !guardado.group && !guardado.sort
        && !(guardado.customFilters || []).length && !guardado.dateRange?.desde && !guardado.dateRange?.hasta
      if (!vacio) onChange(guardado)
    } catch { /* localStorage corrupto o inaccesible: ignorar */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina])

  useEffect(() => {
    if (!pagina) return
    try {
      localStorage.setItem(ULTIMO_FILTRO_PREFIX + pagina, JSON.stringify({
        search: activeState.search || '',
        filters: activeState.filters || [],
        group: activeState.group || null,
        sort: activeState.sort || null,
        customFilters: activeState.customFilters || [],
        dateRange: activeState.dateRange || DATE_RANGE_VACIO,
      }))
    } catch { /* cuota de localStorage llena u otro error: no es crítico */ }
  }, [pagina, JSON.stringify(activeState)])

  const aplicarFavorito = (fav) => {
    onChange(fav.filtros)
    setIsOpen(false)
  }

  const eliminarFavorito = async (e, id) => {
    e.stopPropagation()
    setFavorites(prev => prev.filter(f => f.id !== id))
    try { await busquedasGuardadasService.eliminar(id) } catch { cargarFavoritos() }
  }

  const guardarFavoritoActual = async () => {
    if (!pagina) return
    const nombre = window.prompt('Nombre para esta búsqueda:')
    if (!nombre?.trim()) return
    setGuardandoFavorito(true)
    try {
      const { search, filters, group, sort, customFilters: cf, dateRange: dr } = activeState
      const { data } = await busquedasGuardadasService.crear(pagina, nombre.trim(), { search, filters, group, sort, customFilters: cf, dateRange: dr })
      setFavorites(prev => [...prev, data])
    } catch {
      alert('No se ha podido guardar la búsqueda.')
    } finally {
      setGuardandoFavorito(false)
    }
  }
  const customFields = config.customFields || []
  const [addingCustom, setAddingCustom] = useState(false)
  const [customFieldId, setCustomFieldId] = useState('')
  const [customOperator, setCustomOperator] = useState('eq')
  const [customValue, setCustomValue] = useState('')
  const customFieldDef = customFields.find((f) => f.field === customFieldId)

  useEffect(() => {
    setSearchValue(activeState.search || '')
  }, [activeState.search])

  useEffect(() => {
    return () => clearTimeout(debounceRef.current)
  }, [])

  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearchValue(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange({ ...activeState, search: val })
    }, 300)
  }

  const toggleFilter = (filterId) => {
    const newFilters = activeState.filters.includes(filterId)
      ? activeState.filters.filter(id => id !== filterId)
      : [...activeState.filters, filterId]
    onChange({ ...activeState, filters: newFilters })
  }

  const setGroup = (groupId) => {
    const newGroup = activeState.group === groupId ? null : groupId
    onChange({ ...activeState, group: newGroup })
  }

  const setSort = (sortId) => {
    onChange({ ...activeState, sort: sortId })
  }

  const removeFilter = (filterId) => {
    onChange({ ...activeState, filters: activeState.filters.filter(id => id !== filterId) })
  }

  const addCustomFilter = () => {
    if (!customFieldDef || !customValue.trim()) return
    const nuevo = {
      id: `custom_${customFieldDef.field}_${Date.now()}`,
      field: customFieldDef.field,
      label: customFieldDef.label,
      type: customFieldDef.type,
      operator: customFieldDef.type === 'number' ? customOperator : 'contains',
      value: customValue.trim(),
    }
    onChange({ ...activeState, customFilters: [...customFilters, nuevo] })
    setCustomFieldId('')
    setCustomOperator('eq')
    setCustomValue('')
    setAddingCustom(false)
  }

  const removeCustomFilter = (id) => {
    onChange({ ...activeState, customFilters: customFilters.filter((f) => f.id !== id) })
  }

  const aplicarPresetFecha = (preset) => {
    onChange({ ...activeState, dateRange: preset.rango ? preset.rango() : DATE_RANGE_VACIO })
  }

  const setDateRangeManual = (campo, valor) => {
    onChange({ ...activeState, dateRange: { ...dateRange, [campo]: valor } })
  }

  const clearDateRange = () => {
    onChange({ ...activeState, dateRange: DATE_RANGE_VACIO })
  }

  const presetActivo = config.dateFilter?.presets.find((p) => {
    const r = p.rango ? p.rango() : DATE_RANGE_VACIO
    return r.desde === dateRange.desde && r.hasta === dateRange.hasta
  })
  const dateRangeLabel = dateRange.desde || dateRange.hasta
    ? (presetActivo?.label ?? `${dateRange.desde || '…'} → ${dateRange.hasta || '…'}`)
    : null

  const clearAll = () => {
    clearTimeout(debounceRef.current)
    onChange({ search: '', filters: [], group: null, sort: null, customFilters: [], dateRange: DATE_RANGE_VACIO })
    setSearchValue('')
  }

  const OPERATOR_LABEL = { eq: '=', gte: '≥', lte: '≤', contains: 'contiene' }

  const hasActiveState = !!(activeState.search || activeState.filters.length > 0 || activeState.group || customFilters.length > 0 || dateRangeLabel)
  const sortActivoId = activeState.sort || defaultSort || null
  const sortActivoLabel = config.sorts?.find((s) => s.id === sortActivoId)?.label
  const compactResting = !hasActiveState
  const ANCHO_REPOSO = 'w-[320px]'

  return (
    <div
      className={`relative shrink-0 ${compactResting ? ANCHO_REPOSO : 'w-fit max-w-4xl'}`}
      style={compactResting ? { height: restingHeight } : undefined}
    >
      <div
        className={`group transition-[width] duration-150 ${
          compactResting
            ? `absolute left-0 top-0 z-20 ${ANCHO_REPOSO} focus-within:w-[min(56rem,92vw)]`
            : 'relative w-fit max-w-4xl focus-within:w-[min(56rem,92vw)]'
        }`}
      >
      <div ref={pillRef} className="relative flex items-center bg-white border border-gray-200 rounded-lg shadow-sm group-focus-within:shadow-xl hover:border-gray-300 focus-within:border-[var(--color-marca)] focus-within:ring-1 focus-within:ring-[rgb(var(--color-marca-rgb)/0.2)] transition-all overflow-hidden p-1">

        <div className="pl-3 pr-2 text-gray-400">
          <Search className="w-4 h-4" />
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          {activeState.filters.map(fid => {
            const f = config.filters.find(f => f.id === fid)
            if (!f) return null
            return (
              <Badge
                key={fid}
                variant="secondary"
                className="bg-[rgb(var(--color-marca-rgb)/0.1)] text-[var(--color-marca)] border-[rgb(var(--color-marca-rgb)/0.2)] flex items-center gap-1 pr-1 pl-2 h-7"
              >
                <span className="text-[11px] font-medium uppercase tracking-wider">{f.label}</span>
                <button
                  onClick={() => removeFilter(fid)}
                  className="hover:bg-[rgb(var(--color-marca-rgb)/0.2)] rounded-full p-0.5 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )
          })}

          {activeState.group && (
            <Badge
              variant="secondary"
              className="bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1 pr-1 pl-2 h-7"
            >
              <Layers className="w-3 h-3" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Agrupado: {config.groups?.find(g => g.id === activeState.group)?.label}</span>
              <button
                onClick={() => setGroup(activeState.group)}
                className="hover:bg-blue-200 rounded-full p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}

          {activeState.sort && sortActivoLabel && (
            <Badge
              variant="secondary"
              className="bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1 pr-1 pl-2 h-7"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Orden: {sortActivoLabel}</span>
              {defaultSort && (
                <button
                  onClick={() => setSort(null)}
                  className="hover:bg-emerald-200 rounded-full p-0.5 transition-colors"
                  title="Volver al orden por defecto"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </Badge>
          )}

          {dateRangeLabel && (
            <Badge
              variant="secondary"
              className="bg-[rgb(var(--color-marca-rgb)/0.08)] text-[var(--color-marca)] border-[rgb(var(--color-marca-rgb)/0.2)] flex items-center gap-1 pr-1 pl-2 h-7"
            >
              <CalendarRange className="w-3 h-3" />
              <span className="text-[11px] font-medium uppercase tracking-wider">{config.dateFilter?.label ?? 'Fecha'}: {dateRangeLabel}</span>
              <button
                onClick={clearDateRange}
                className="hover:bg-[rgb(var(--color-marca-rgb)/0.15)] rounded-full p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}

          {customFilters.map((cf) => (
            <Badge
              key={cf.id}
              variant="secondary"
              className="bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1 pr-1 pl-2 h-7"
            >
              <span className="text-[11px] font-medium">
                {cf.label} {OPERATOR_LABEL[cf.operator]} {cf.value}
              </span>
              <button
                onClick={() => removeCustomFilter(cf.id)}
                className="hover:bg-amber-200 rounded-full p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}

          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-1.5 min-w-[150px] placeholder:text-gray-400"
            placeholder={placeholder}
            value={searchValue}
            onChange={handleSearchChange}
          />
        </div>

        <div className="flex items-center gap-1 pr-1">
          {hasActiveState && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-400 hover:text-gray-600"
              onClick={clearAll}
              aria-label="Quitar filtros de búsqueda"
              title="Quitar filtros de búsqueda"
            >
              <X className="w-4 h-4" />
            </Button>
          )}

          <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 transition-colors ${isOpen ? 'text-[var(--color-marca)] bg-[rgb(var(--color-marca-rgb)/0.05)]' : 'text-gray-400'}`}
                aria-label="Filtros, agrupar y ordenar"
                title="Filtros, agrupar y ordenar"
              >
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-fit max-w-[95vw] p-0 overflow-hidden shadow-2xl border-gray-200">
              <div className="grid grid-cols-[repeat(3,minmax(11rem,max-content))] divide-x divide-gray-100 bg-white">

                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[var(--color-marca)] font-bold text-xs uppercase tracking-widest pb-1 border-b border-gray-50">
                    <Filter className="w-3.5 h-3.5" />
                    Filtros
                  </div>
                  <div className="space-y-1">
                    {config.filters.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => toggleFilter(f.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors ${activeState.filters.includes(f.id) ? 'bg-[rgb(var(--color-marca-rgb)/0.05)] text-[var(--color-marca)] font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        {f.label}
                        {activeState.filters.includes(f.id) && <Check className="w-4 h-4" />}
                      </button>
                    ))}
                    {customFields.length > 0 && !addingCustom && (
                      <button
                        onClick={() => setAddingCustom(true)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-[var(--color-marca)] italic transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Añadir filtro personalizado...
                      </button>
                    )}
                    {addingCustom && (
                      <div className="space-y-2 p-2 rounded-md bg-gray-50 border border-gray-100">
                        <select
                          value={customFieldId}
                          onChange={(e) => { setCustomFieldId(e.target.value); setCustomOperator('eq'); setCustomValue('') }}
                          className="w-full text-sm rounded-md border border-gray-200 px-2 py-1.5 bg-white"
                        >
                          <option value="">Elige un campo...</option>
                          {customFields.map((f) => (
                            <option key={f.field} value={f.field}>{f.label}</option>
                          ))}
                        </select>
                        {customFieldDef?.type === 'number' && (
                          <select
                            value={customOperator}
                            onChange={(e) => setCustomOperator(e.target.value)}
                            className="w-full text-sm rounded-md border border-gray-200 px-2 py-1.5 bg-white"
                          >
                            <option value="eq">es igual a</option>
                            <option value="gte">mayor o igual que</option>
                            <option value="lte">menor o igual que</option>
                          </select>
                        )}
                        {customFieldDef && (
                          <input
                            type={customFieldDef.type === 'number' ? 'number' : 'text'}
                            value={customValue}
                            onChange={(e) => setCustomValue(e.target.value)}
                            placeholder="Valor..."
                            className="w-full text-sm rounded-md border border-gray-200 px-2 py-1.5 bg-white"
                          />
                        )}
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => { setAddingCustom(false); setCustomFieldId(''); setCustomValue('') }}
                            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            Cancelar
                          </button>
                          <Button size="sm" className="h-7 text-xs" disabled={!customFieldDef || !customValue.trim()} onClick={addCustomFilter}>
                            Añadir
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {config.dateFilter && (
                    <>
                      <div className="flex items-center gap-2 text-[var(--color-marca)] font-bold text-xs uppercase tracking-widest pb-1 pt-2 border-t border-b border-gray-50">
                        <CalendarRange className="w-3.5 h-3.5" />
                        {config.dateFilter.label ?? 'Fecha'}
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {config.dateFilter.presets.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => aplicarPresetFecha(p)}
                            className={`px-2.5 py-1.5 text-xs rounded-md transition-colors text-left ${presetActivo?.id === p.id ? 'bg-[rgb(var(--color-marca-rgb)/0.08)] text-[var(--color-marca)] font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <div>
                          <label className="text-[10px] text-gray-400 uppercase tracking-wide">Desde</label>
                          <DateInput className="h-8 text-xs w-full" value={dateRange.desde} onChange={(e) => setDateRangeManual('desde', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 uppercase tracking-wide">Hasta</label>
                          <DateInput className="h-8 text-xs w-full" value={dateRange.hasta} onChange={(e) => setDateRangeManual('hasta', e.target.value)} />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="p-4 space-y-3 bg-gray-50/30">
                  {config.groups?.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 text-blue-600 font-bold text-xs uppercase tracking-widest pb-1 border-b border-gray-100">
                        <Layers className="w-3.5 h-3.5" />
                        Agrupar por
                      </div>
                      <div className="space-y-1">
                        {config.groups.map((g) => (
                          <button
                            key={g.id}
                            onClick={() => setGroup(g.id)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors ${activeState.group === g.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                          >
                            {g.label}
                            {activeState.group === g.id && <Check className="w-4 h-4" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {config.sorts?.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest pb-1 pt-2 border-t border-b border-gray-100">
                        <ArrowUpDown className="w-3.5 h-3.5" />
                        Ordenar por
                      </div>
                      <div className="space-y-1">
                        {config.sorts.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setSort(s.id)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors ${sortActivoId === s.id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                          >
                            {s.label}
                            {sortActivoId === s.id && <Check className="w-4 h-4" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-500 font-bold text-xs uppercase tracking-widest pb-1 border-b border-gray-50">
                    <Star className="w-3.5 h-3.5" />
                    Favoritos
                  </div>
                  <div className="space-y-1">
                    {!pagina ? (
                      <p className="px-3 py-2 text-xs text-gray-400 italic">Favoritos no disponibles aquí</p>
                    ) : favorites.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-gray-400 italic">No hay búsquedas guardadas</p>
                    ) : (
                      favorites.map((fav) => (
                        <button
                          key={fav.id}
                          onClick={() => aplicarFavorito(fav)}
                          className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md flex items-center justify-between group/fav"
                        >
                          <span className="flex items-center gap-1.5">
                            {fav.nombre}
                            {fav.es_defecto && <Badge className="text-[9px] h-4">Default</Badge>}
                          </span>
                          <span
                            role="button"
                            onClick={(e) => eliminarFavorito(e, fav.id)}
                            className="opacity-0 group-hover/fav:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
                          >
                            <X className="w-3.5 h-3.5" />
                          </span>
                        </button>
                      ))
                    )}
                    <DropdownMenuSeparator />
                    <button
                      onClick={guardarFavoritoActual}
                      disabled={!pagina || guardandoFavorito}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 rounded-md font-medium transition-colors disabled:opacity-50"
                    >
                      {guardandoFavorito ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Guardar búsqueda actual
                    </button>
                  </div>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      </div>
    </div>
  )
}
