import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BuscadorAgendaDialog, { filtrarAgenda } from './BuscadorAgendaDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (opts && opts.count != null ? `${key}:${opts.count}` : key) }),
}))

const AGENDA = [
  { value: 1, label: 'Transportes Romero Ruiz S.L.', keywords: 'A91000000' },
  { value: 2, label: 'Logística Ruiz S.A.', keywords: 'B12345674' },
  { value: 3, label: 'Tractora azul', keywords: '4821LKP' },
]

describe('BuscadorAgendaDialog', () => {
  it('busca por nombre sin tildes, por NIF, por matrícula con espacios y con varias palabras', () => {
    expect(filtrarAgenda(AGENDA, 'logistica').map((o) => o.value)).toEqual([2])
    expect(filtrarAgenda(AGENDA, 'a9100').map((o) => o.value)).toEqual([1])
    expect(filtrarAgenda(AGENDA, '4821 lkp').map((o) => o.value)).toEqual([3])
    expect(filtrarAgenda(AGENDA, 'romero ruiz').map((o) => o.value)).toEqual([1])
    expect(filtrarAgenda(AGENDA, '').length).toBe(3)
  })

  it('se elige con el teclado: flecha abajo y Enter', () => {
    const onSeleccionar = vi.fn()
    const onCerrar = vi.fn()
    render(<BuscadorAgendaDialog abierto titulo="Transportistas" opciones={AGENDA} onSeleccionar={onSeleccionar} onCerrar={onCerrar} />)
    const buscador = screen.getByRole('combobox')
    expect(screen.getByText('buscador_agenda.resultados:3')).toBeInTheDocument()
    fireEvent.keyDown(buscador, { key: 'ArrowDown' })
    fireEvent.keyDown(buscador, { key: 'Enter' })
    expect(onSeleccionar).toHaveBeenCalledWith(2)
    expect(onCerrar).toHaveBeenCalled()
  })

  it('sin coincidencias lo dice', () => {
    render(<BuscadorAgendaDialog abierto titulo="Transportistas" opciones={AGENDA} onSeleccionar={vi.fn()} onCerrar={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.getByText('buscador_agenda.sin_resultados')).toBeInTheDocument()
  })
})
