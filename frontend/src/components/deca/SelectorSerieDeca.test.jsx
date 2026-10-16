import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SelectorSerieDeca from './SelectorSerieDeca'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k, d) => (typeof d === 'string' ? d : k) }) }))

const SERIES = [
  { id: 'g', nombre: 'General', prefijo: 'DECA-', por_defecto: true, activa: true },
  { id: 't', nombre: 'Tomates', prefijo: 'DECA_TOM-', por_defecto: false, activa: true },
  { id: 'v', nombre: 'Vieja', prefijo: 'V-', por_defecto: false, activa: false },
]

describe('SelectorSerieDeca', () => {
  it('con una sola serie activa no se pinta', () => {
    const { container } = render(<SelectorSerieDeca series={SERIES.slice(0, 1)} value="" onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('por defecto enseña la serie por defecto y el desplegable sale al marcar «Elegir serie»', () => {
    const onChange = vi.fn()
    render(<SelectorSerieDeca series={SERIES} value="" onChange={onChange} />)
    expect(screen.getByText('General (DECA-)')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByLabelText('Elegir serie'))
    const select = screen.getByRole('combobox')
    // Las desactivadas no se ofrecen.
    expect(screen.queryByText(/Vieja/)).toBeNull()
    fireEvent.change(select, { target: { value: 't' } })
    expect(onChange).toHaveBeenCalledWith('t')
  })

  it('al desmarcar «Elegir serie» vuelve a la de por defecto', () => {
    const onChange = vi.fn()
    render(<SelectorSerieDeca series={SERIES} value="t" onChange={onChange} />)
    // Con otra serie ya elegida, el desplegable sale abierto.
    expect(screen.getByRole('combobox')).toHaveValue('t')
    fireEvent.click(screen.getByLabelText('Elegir serie'))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
