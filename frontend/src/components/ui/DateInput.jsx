import { useState, useEffect, useRef, useMemo, useId } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

// Reemplazo de <input type="date"> -- el widget nativo del navegador ignora
// cualquier locale que se le pase desde JS/CSS. value/onChange reciben y
// devuelven 'YYYY-MM-DD'.
//
// Simplificado del ERP origen: allí el orden de los segmentos (DD/MM/AAAA,
// MM/DD/AAAA...) dependía del país de la empresa (multi-tenant). Appodo DeCa
// es single-tenant y fija el orden español (día/mes/año, separador '/') --
// si se quiere otro formato, cambiar ORDEN_FIJO/SEPARADOR_FIJO aquí.
const ORDEN_FIJO = ['day', 'month', 'year']
const SEPARADOR_FIJO = '/'

function pad(n) {
  return String(n).padStart(2, '0')
}

function partesDesdeISO(value) {
  const m = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  if (!m) return { day: '', month: '', year: '' }
  return { day: m[3], month: m[2], year: m[1] }
}

function esValido({ day, month, year }) {
  if (!day || !month || !year || year.length !== 4) return false
  const d = Number(day)
  const mo = Number(month)
  const y = Number(year)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const fecha = new Date(Date.UTC(y, mo - 1, d))
  return fecha.getUTCFullYear() === y && fecha.getUTCMonth() === mo - 1 && fecha.getUTCDate() === d
}

function aISO({ day, month, year }) {
  return `${year.padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function CalendarioPopover({ value, onSelect, onClose, anchorRef }) {
  const inicial = value ? new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1)) : new Date()
  const [mesVisible, setMesVisible] = useState(new Date(Date.UTC(inicial.getUTCFullYear(), inicial.getUTCMonth(), 1)))
  const popRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  const dias = useMemo(() => {
    const anio = mesVisible.getUTCFullYear()
    const mes = mesVisible.getUTCMonth()
    const primerDia = new Date(Date.UTC(anio, mes, 1))
    const offset = (primerDia.getUTCDay() + 6) % 7
    return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(anio, mes, 1 - offset + i)))
  }, [mesVisible])

  const hoyISO = new Date().toISOString().slice(0, 10)

  return (
    <div
      ref={popRef}
      className="absolute z-50 top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setMesVisible((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
          className="p-1 rounded hover:bg-gray-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-gray-800">
          {mesVisible.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </span>
        <button
          type="button"
          onClick={() => setMesVisible((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
          className="p-1 rounded hover:bg-gray-100"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DIAS_SEMANA.map((d) => (
          <span key={d} className="text-[10px] font-bold text-gray-400 text-center">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map((dia) => {
          const iso = dia.toISOString().slice(0, 10)
          const delMes = dia.getUTCMonth() === mesVisible.getUTCMonth()
          const seleccionado = iso === value
          const esHoy = iso === hoyISO
          return (
            <button
              type="button"
              key={iso}
              onClick={() => onSelect(iso)}
              className={cn(
                'h-7 w-7 text-xs rounded-full flex items-center justify-center transition-colors',
                !delMes && 'text-gray-300',
                delMes && !seleccionado && 'text-gray-700 hover:bg-gray-100',
                seleccionado && 'bg-[var(--color-marca)] text-white font-bold',
                !seleccionado && esHoy && delMes && 'border border-[var(--color-marca)]',
              )}
            >
              {dia.getUTCDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DateInput({
  value,
  onChange,
  disabled,
  required,
  min: _min, // eslint-disable-line no-unused-vars -- aceptado por compatibilidad con <input type="date">, no validado aún
  max: _max, // eslint-disable-line no-unused-vars
  className,
  id,
  name,
  ...rest
}) {
  const orden = ORDEN_FIJO
  const separador = SEPARADOR_FIJO
  const reactId = useId()
  const inputId = id || reactId

  const [partes, setPartes] = useState(() => partesDesdeISO(value))
  const [abierto, setAbierto] = useState(false)
  const refs = { day: useRef(null), month: useRef(null), year: useRef(null) }
  const anchorRef = useRef(null)

  useEffect(() => {
    setPartes(partesDesdeISO(value))
  }, [value])

  const emitir = (siguientesPartes) => {
    if (esValido(siguientesPartes)) {
      onChange?.({ target: { value: aISO(siguientesPartes), id: inputId, name } })
    } else if (!siguientesPartes.day && !siguientesPartes.month && !siguientesPartes.year) {
      onChange?.({ target: { value: '', id: inputId, name } })
    }
  }

  const cambiarSegmento = (campo, maxLen, siguienteCampo) => (e) => {
    const digitos = e.target.value.replace(/\D/g, '').slice(0, maxLen)
    const nuevas = { ...partes, [campo]: digitos }
    setPartes(nuevas)
    emitir(nuevas)
    if (digitos.length === maxLen && siguienteCampo) refs[siguienteCampo].current?.focus()
  }

  const backspaceVacio = (campo, campoAnterior) => (e) => {
    if (e.key === 'Backspace' && !partes[campo] && campoAnterior) refs[campoAnterior].current?.focus()
  }

  const seleccionarCalendario = (iso) => {
    setPartes(partesDesdeISO(iso))
    onChange?.({ target: { value: iso, id: inputId, name } })
    setAbierto(false)
  }

  const anchoYear = 'w-11 sm:w-12'
  const anchoCorto = 'w-7 sm:w-8'

  const segmentoProps = (campo, maxLen, prevCampo, nextCampo) => ({
    ref: refs[campo],
    type: 'text',
    inputMode: 'numeric',
    value: partes[campo],
    placeholder: campo === 'year' ? 'aaaa' : campo === 'month' ? 'mm' : 'dd',
    disabled,
    onChange: cambiarSegmento(campo, maxLen, nextCampo),
    onKeyDown: backspaceVacio(campo, prevCampo),
    className: cn(
      'text-center bg-transparent focus:outline-none placeholder:text-gray-300 text-sm',
      campo === 'year' ? anchoYear : anchoCorto,
    ),
  })

  return (
    <div
      ref={anchorRef}
      className={cn(
        'relative flex items-center gap-0 sm:gap-0.5 h-10 rounded-md border border-input bg-background px-1 sm:px-3 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      {orden.map((campo, i) => {
        const maxLen = campo === 'year' ? 4 : 2
        const prevCampo = i > 0 ? orden[i - 1] : null
        const nextCampo = i < orden.length - 1 ? orden[i + 1] : null
        return (
          <span key={campo} className="flex items-center gap-0 sm:gap-0.5">
            <input {...segmentoProps(campo, maxLen, prevCampo, nextCampo)} />
            {i < orden.length - 1 && <span className="text-gray-400 text-sm">{separador}</span>}
          </span>
        )
      })}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAbierto((v) => !v)}
        aria-label="Abrir calendario"
        className="ml-auto shrink-0 p-0.5 text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed"
        tabIndex={-1}
      >
        <CalendarIcon className="h-4 w-4" />
      </button>
      {abierto && !disabled && (
        <CalendarioPopover
          value={esValido(partes) ? aISO(partes) : ''}
          onSelect={seleccionarCalendario}
          onClose={() => setAbierto(false)}
          anchorRef={anchorRef}
        />
      )}
      {required && <input tabIndex={-1} aria-hidden className="sr-only" required value={value || ''} onChange={() => {}} />}
    </div>
  )
}

export default DateInput
