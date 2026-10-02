import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DecaImprimibleSinConexion from './DecaImprimibleSinConexion'
import { decaService } from '../../services/decaService'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

const ITEM = {
  referencia: 'OFF-ABC-1234',
  emitido_en: '2026-09-30T06:15:00.000Z',
  datos: {
    nombre_cargador: 'Distrinorte S.A.', nif_cargador: 'A91234567', domicilio_cargador: 'C/ Mayor 10, 46000 Valencia',
    nombre_transportista: 'Transportes Romero S.L.', nif_transportista: 'B72345678',
    origen: 'Finca La Janda', destino: 'Almacén Distrinorte Huévar',
    matricula_tractor: '4821LKP', sin_remolque: true, matricula_remolque: '',
    naturaleza_mercancia: 'Aguacate Hass', peso_kg: '18000', bultos: 30,
  },
}

describe('DecaImprimibleSinConexion', () => {
  it('saca dos ejemplares con la referencia, los datos del BOE y las firmas', () => {
    render(<DecaImprimibleSinConexion item={ITEM} empresaNombre="Frutas del Sur" onCerrar={vi.fn()} />)
    expect(screen.getByText('offline.imp.copia_transportista')).toBeInTheDocument()
    expect(screen.getByText('offline.imp.copia_cargador')).toBeInTheDocument()
    expect(screen.getAllByText('OFF-ABC-1234')).toHaveLength(2)
    expect(screen.getAllByText('Distrinorte S.A. · A91234567')).toHaveLength(2)
    expect(screen.getAllByText('18000 kg')).toHaveLength(2)
    expect(screen.getAllByText('offline.imp.sin_remolque')).toHaveLength(2)
    expect(screen.getAllByText('offline.imp.firma_transportista')).toHaveLength(2)
  })

  it('cada ejemplar lleva el QR con la URL completa del DeCA', () => {
    const token = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
    render(<DecaImprimibleSinConexion item={{ ...ITEM, token_publico: token }} empresaNombre="Frutas del Sur" onCerrar={vi.fn()} />)
    expect(screen.getAllByLabelText('offline.imp.qr')).toHaveLength(2)
    const url = decaService.urlDescargaPublica(token)
    expect(url).toMatch(/^https?:\/\/[^/]+\/api\/v1\/deca\/publico\//)
    expect(screen.getAllByText(url)).toHaveLength(2)
  })

  it('el botón imprime y el de volver cierra', () => {
    const onCerrar = vi.fn()
    window.print = vi.fn()
    render(<DecaImprimibleSinConexion item={ITEM} empresaNombre="Frutas del Sur" onCerrar={onCerrar} />)
    fireEvent.click(screen.getByText('offline.imprimir'))
    expect(window.print).toHaveBeenCalled()
    fireEvent.click(screen.getByText('offline.volver_lista'))
    expect(onCerrar).toHaveBeenCalled()
  })

  it('saca los ejemplares configurados, con el del destinatario si son 3', () => {
    render(<DecaImprimibleSinConexion item={ITEM} empresaNombre="Frutas del Sur" ejemplares={3} onCerrar={vi.fn()} />)
    expect(screen.getAllByText('OFF-ABC-1234')).toHaveLength(3)
    expect(screen.getByText('offline.imp.copia_destinatario')).toBeInTheDocument()
  })

  it('con 1 ejemplar solo sale el del transportista', () => {
    render(<DecaImprimibleSinConexion item={ITEM} empresaNombre="Frutas del Sur" ejemplares={1} onCerrar={vi.fn()} />)
    expect(screen.getByText('offline.imp.copia_transportista')).toBeInTheDocument()
    expect(screen.queryByText('offline.imp.copia_cargador')).toBeNull()
  })

  it('guardado para generar luego: no imprime y avisa de que aún no hay DeCA', () => {
    render(<DecaImprimibleSinConexion item={ITEM} empresaNombre="Frutas del Sur" soloGuardado onCerrar={vi.fn()} />)
    expect(screen.getByText('campo.guardado_para_luego_titulo')).toBeInTheDocument()
    expect(screen.getByText('campo.guardado_para_luego_aviso')).toBeInTheDocument()
    expect(screen.queryByText('offline.imprimir')).toBeNull()
    expect(screen.queryByText('offline.imp.copia_transportista')).toBeNull()
  })
})
