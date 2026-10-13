import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ClavesIntegracionDeca from './ClavesIntegracionDeca'
import { decaService } from '../../services/decaService'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../context/ToastContext', () => ({ useToast: () => toast }))

vi.mock('../../services/decaService', () => ({
  decaService: {
    listarClavesIntegracion: vi.fn(),
    crearClaveIntegracion: vi.fn(),
    revocarClaveIntegracion: vi.fn(),
  },
}))

const ACTIVA = {
  id: 'c1', nombre: 'ERP - oficina', prefijo: 'ab12cd34', activa: true,
  fecha_alta: '2026-10-06T08:00:00Z', creada_por: 'Juan', ultimo_uso: null,
  revocada_en: null, revocada_por: null, expediciones_recibidas: 3,
}

describe('ClavesIntegracionDeca', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    decaService.listarClavesIntegracion.mockResolvedValue({ data: [ACTIVA] })
  })

  it('lista las claves sin enseñar nunca la clave completa', async () => {
    render(<ClavesIntegracionDeca />)
    expect((await screen.findAllByText('ERP - oficina')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('deca_ab12cd34_…').length).toBeGreaterThan(0)
  })

  it('al crear enseña la clave una vez, en un diálogo', async () => {
    decaService.crearClaveIntegracion.mockResolvedValue({
      data: { ...ACTIVA, id: 'c2', nombre: 'Nueva', clave: 'deca_ff00ff00_secreto' },
    })
    render(<ClavesIntegracionDeca />)
    await screen.findAllByText('ERP - oficina')

    const boton = screen.getByRole('button', { name: /integracion.crear/ })
    expect(boton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('integracion.nombre'), { target: { value: 'Nueva' } })
    fireEvent.click(boton)

    await waitFor(() => expect(decaService.crearClaveIntegracion).toHaveBeenCalledWith('Nueva'))
    expect(await screen.findByText('deca_ff00ff00_secreto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'integracion.entendido' }))
    await waitFor(() => expect(screen.queryByText('deca_ff00ff00_secreto')).not.toBeInTheDocument())
  })

  it('revocar pide confirmación', async () => {
    decaService.revocarClaveIntegracion.mockResolvedValue({ data: { ...ACTIVA, activa: false } })
    render(<ClavesIntegracionDeca />)
    const [revocar] = await screen.findAllByRole('button', { name: 'integracion.revocar_aria' })
    fireEvent.click(revocar)
    expect(decaService.revocarClaveIntegracion).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'integracion.revocar' }))
    await waitFor(() => expect(decaService.revocarClaveIntegracion).toHaveBeenCalledWith('c1'))
  })
})
