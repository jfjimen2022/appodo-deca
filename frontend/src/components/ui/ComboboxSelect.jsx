import { useState, useEffect, useRef } from 'react'
import { Search, ChevronDown, Check, XCircle } from 'lucide-react'

/**
 * Selector de UN registro con buscador integrado. Sustituye al `<select>`
 * nativo en cualquier campo que elija de una lista que crece (conductor,
 * transportista, destinatario, tractora, remolque...).
 */
const TAMANOS = {
  sm: { caja: 'h-9 px-3 rounded-md text-sm', hueco: 'gap-1.5' },
  md: { caja: 'h-10 px-3 rounded-lg text-sm', hueco: 'gap-2' },
  lg: { caja: 'h-12 px-4 rounded-xl text-sm', hueco: 'gap-2' },
}

export default function ComboboxSelect({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar...',
  emptyText = 'No hay resultados',
  className = '',
  size = 'lg',
  clearable = true,
  clearLabel = 'Ninguno / Limpiar',
  searchThreshold = 8,
  disabled = false,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)

  const tam = TAMANOS[size] ?? TAMANOS.lg
  const conBuscador = options.length > searchThreshold

  const filtered = query.trim()
    ? options.filter((o) => {
        const q = query.toLowerCase()
        return o.label.toLowerCase().includes(q) || (o.keywords ?? '').toLowerCase().includes(q)
      })
    : options

  const selectedOption = options.find((o) => o.value === value)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  const alternar = () => {
    if (disabled) return
    setOpen((v) => !v)
    setQuery('')
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex ${tam.caja} w-full items-center justify-between border bg-white shadow-sm transition-all ${
          disabled
            ? 'cursor-not-allowed opacity-60 border-gray-200'
            : open
              ? 'cursor-pointer border-[var(--color-marca)] ring-2 ring-[rgb(var(--color-marca-rgb)/0.1)]'
              : 'cursor-pointer border-gray-200 hover:border-[rgb(var(--color-marca-rgb)/0.5)]'
        }`}
        onClick={alternar}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
      >
        <span className={`flex items-center ${tam.hueco} truncate ${selectedOption ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
          {selectedOption?.avatar}
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-[60] mt-2 w-full rounded-xl border border-gray-100 bg-white shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {conBuscador && (
            <div className="flex items-center px-3 border-b border-gray-50 bg-gray-50/50">
              <Search className="h-4 w-4 text-gray-400 shrink-0" />
              <input
                className="w-full h-10 bg-transparent px-3 text-sm focus:outline-none"
                placeholder="Escribe para buscar..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
                autoFocus
              />
            </div>
          )}
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            {clearable && (
              <li
                role="option"
                aria-selected={!selectedOption}
                className="px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 cursor-pointer flex items-center gap-2"
                onClick={() => { onChange(''); setOpen(false); setQuery('') }}
              >
                <XCircle className="h-4 w-4" /> {clearLabel}
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-gray-400 text-center">{emptyText}</li>
            ) : (
              filtered.map((opt) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={value === opt.value}
                  className={`px-4 py-2.5 text-sm cursor-pointer flex items-center justify-between transition-colors ${value === opt.value ? 'bg-[rgb(var(--color-marca-rgb)/0.1)] text-[var(--color-marca)] font-bold' : 'text-gray-700 hover:bg-gray-50 hover:text-[var(--color-marca)]'}`}
                  onClick={() => { onChange(opt.value); setOpen(false); setQuery('') }}
                >
                  <div className="flex items-center gap-3 truncate">
                    {opt.avatar}
                    <span className="truncate">{opt.label}</span>
                  </div>
                  {value === opt.value && <Check className="h-4 w-4 shrink-0" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
