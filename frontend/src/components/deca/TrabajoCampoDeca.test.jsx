import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TrabajoCampoDeca from './TrabajoCampoDeca'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

const CONFIG = {
  modo_sin_cobertura: 'imprimir',
  ejemplares_sin_cobertura: 2,
  registrar_papel_por_foto: false,
  deca_anticipado: false,
  aviso_sin_completar: true,
  aviso_sin_completar_dias: 2,
  horas_max_edicion_generado: 24,
}

describe('TrabajoCampoDeca', () => {
  it('el modo sin cobertura es de elección única', () => {
    const set = vi.fn()
    render(<TrabajoCampoDeca config={CONFIG} set={set} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1)
    fireEvent.click(screen.getByText('campo.modo_necesita_red'))
    expect(set).toHaveBeenCalledWith('modo_sin_cobertura', 'necesita_red')
  })

  it('cada opción lleva su explicación y abajo la leyenda', () => {
    render(<TrabajoCampoDeca config={CONFIG} set={vi.fn()} />)
    expect(screen.getByText('campo.cfg_papel_desc')).toBeInTheDocument()
    expect(screen.getByText('campo.cfg_anticipado_legal')).toBeInTheDocument()
    expect(screen.getByText('campo.leyenda_titulo')).toBeInTheDocument()
    expect(screen.getByText('campo.leyenda_modo')).toBeInTheDocument()
  })

  it('los ejemplares solo se eligen con "Imprimir en el móvil"', () => {
    const { rerender } = render(<TrabajoCampoDeca config={CONFIG} set={vi.fn()} />)
    expect(screen.getByLabelText('campo.cfg_ejemplares')).not.toBeDisabled()
    rerender(<TrabajoCampoDeca config={{ ...CONFIG, modo_sin_cobertura: 'necesita_red' }} set={vi.fn()} />)
    expect(screen.getByLabelText('campo.cfg_ejemplares')).toBeDisabled()
    expect(screen.getByText('campo.cfg_ejemplares_solo_imprimir')).toBeInTheDocument()
  })

  it('el DeCA anticipado no se puede encender sin horas de corrección', () => {
    render(<TrabajoCampoDeca config={{ ...CONFIG, horas_max_edicion_generado: 0 }} set={vi.fn()} />)
    expect(screen.getByLabelText('campo.cfg_anticipado')).toBeDisabled()
    expect(screen.getByText('campo.cfg_anticipado_sin_ventana')).toBeInTheDocument()
  })

  it('explica cómo preparar los móviles, distinto en Android y en iPhone', () => {
    render(<TrabajoCampoDeca config={CONFIG} set={vi.fn()} />)
    expect(screen.getByText('campo.guia_titulo')).toBeInTheDocument()
    expect(screen.getByText('campo.guia_android_titulo')).toBeInTheDocument()
    expect(screen.getByText('campo.guia_android_7')).toBeInTheDocument()
    expect(screen.getByText('campo.guia_iphone_2')).toBeInTheDocument()
    expect(screen.getByText('campo.guia_comun_6')).toBeInTheDocument()
    expect(screen.getByText('campo.guia_prueba_5')).toBeInTheDocument()
  })
})
