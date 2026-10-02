import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '../ui/dialog'

// Buscador de la Agenda de DeCA (transportistas, cargadores, destinatarios,
// conductores, tractoras, remolques) para el formulario de ESCRITORIO.
// Sustituye al desplegable de 320 px pegado al botón, "muy pequeño y sin
// centrar" (pedido del usuario 2026-09-29): diálogo centrado y amplio, busca
// por nombre, NIF o matrícula sin distinguir tildes ni mayúsculas, con varias
// palabras, y se maneja con flechas + Enter. El alta móvil tiene su propio
// desplegable (components/deca/movil/AltaDecaMovil.jsx).

const normalizar = (texto) => (texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrarAgenda(opciones, busqueda) {
  const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean)
  if (!palabras.length) return opciones
  return opciones.filter((o) => {
    const texto = normalizar(`${o.label} ${o.keywords || ''}`)
    const compacto = texto.replace(/[\s.-]/g, '')
    return palabras.every((p) => texto.includes(p) || compacto.includes(p.replace(/[\s.-]/g, '')))
  })
}

export default function BuscadorAgendaDialog({ abierto, onCerrar, titulo, opciones, onSeleccionar }) {
  const { t } = useTranslation('deca')
  const [busqueda, setBusqueda] = useState('')
  const [activo, setActivo] = useState(0)
  const refLista = useRef(null)

  useEffect(() => {
    if (abierto) { setBusqueda(''); setActivo(0) }
  }, [abierto])

  const resultados = useMemo(() => filtrarAgenda(opciones, busqueda), [opciones, busqueda])
  useEffect(() => { setActivo(0) }, [busqueda])

  useEffect(() => {
    refLista.current?.querySelector(`[data-indice="${activo}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activo])

  const elegir = (opcion) => {
    if (!opcion) return
    onSeleccionar(opcion.value)
    onCerrar()
  }

  const alPulsar = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((i) => Math.min(i + 1, resultados.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); elegir(resultados[activo]) }
  }

  const idLista = 'buscador-agenda-resultados'

  return (
    <Dialog open={abierto} onOpenChange={(v) => { if (!v) onCerrar() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{t('buscador_agenda.descripcion')}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input
            autoFocus
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={idLista}
            aria-activedescendant={resultados[activo] ? `agenda-opcion-${activo}` : undefined}
            aria-label={t('buscador_agenda.placeholder')}
            placeholder={t('buscador_agenda.placeholder')}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={alPulsar}
            autoComplete="off"
            className="h-12 w-full rounded-lg border border-gray-300 bg-white pl-11 pr-3 text-base text-gray-900 placeholder:text-gray-500 focus:border-[var(--color-marca)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-marca-rgb)/0.2)]"
          />
        </div>

        <p className="text-sm text-gray-600" aria-live="polite">
          {opciones.length === 0
            ? t('buscador_agenda.vacia')
            : t('buscador_agenda.resultados', { count: resultados.length })}
        </p>

        <ul id={idLista} ref={refLista} role="listbox" className="max-h-[55vh] overflow-y-auto divide-y rounded-lg border border-gray-200">
          {resultados.map((o, i) => (
            <li
              key={o.value}
              id={`agenda-opcion-${i}`}
              data-indice={i}
              role="option"
              aria-selected={i === activo}
              onMouseEnter={() => setActivo(i)}
              onClick={() => elegir(o)}
              className={`flex cursor-pointer items-center justify-between gap-4 px-4 py-3 ${i === activo ? 'bg-[rgb(var(--color-marca-rgb)/0.08)]' : 'bg-white'}`}
            >
              <span className="min-w-0 font-medium text-gray-900 break-words">{o.label}</span>
              {o.keywords && o.keywords !== o.label && (
                <span className="shrink-0 font-mono text-sm text-gray-700">{o.keywords}</span>
              )}
            </li>
          ))}
          {opciones.length > 0 && resultados.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-600">{t('buscador_agenda.sin_resultados', { busqueda })}</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
