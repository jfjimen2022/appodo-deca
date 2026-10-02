import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PrioridadAgendaDeca from './PrioridadAgendaDeca'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

describe('PrioridadAgendaDeca', () => {
  it('explica el orden de fuentes, los avisos y la leyenda', () => {
    render(<PrioridadAgendaDeca config={{ agenda_prioritaria: true }} set={vi.fn()} />)
    for (const f of ['persona', 'agenda', 'lectura', 'orden']) expect(screen.getByText(`agenda_manda.fuente_${f}`)).toBeInTheDocument()
    for (const a of ['distinto', 'ajeno', 'parecido']) expect(screen.getByText(`agenda_manda.aviso_${a}`)).toBeInTheDocument()
    expect(screen.getByText('agenda_manda.leyenda_matriculas')).toBeInTheDocument()
    expect(screen.getByText('agenda_manda.leyenda_naturaleza')).toBeInTheDocument()
  })

  it('el interruptor cambia agenda_prioritaria', () => {
    const set = vi.fn()
    render(<PrioridadAgendaDeca config={{ agenda_prioritaria: true }} set={set} />)
    fireEvent.click(screen.getByLabelText('agenda_manda.titulo'))
    expect(set).toHaveBeenCalledWith('agenda_prioritaria', false)
  })
})
