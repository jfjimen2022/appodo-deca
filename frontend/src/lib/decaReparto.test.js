import { describe, it, expect } from 'vitest'
import { repartirPorPosicion } from './decaReparto'

const VACIO = {}
// Albarán real del bug: empresa, cliente (Distrinorte) y transportista (Romero).
const REGEX = { nifs_encontrados: ['B11223344', 'A91234567', 'A91000000'], matriculas_encontradas: ['4821LKP', 'R1234BCD'] }

describe('repartirPorPosicion', () => {
  it('sin agenda ni IA reparte por orden, salta el CIF propio y lo marca a revisar', () => {
    const { cambios, aRevisar } = repartirPorPosicion({ form: VACIO, regex: REGEX, cifPropio: 'B11223344' })
    expect(cambios.nif_destinatario).toBe('A91234567')
    expect(cambios.nif_transportista).toBe('A91000000')
    expect(aRevisar).toEqual(['nif_destinatario', 'nif_transportista'])
  })

  it('la agenda manda: cada NIF va al papel que tiene en la agenda, sin marcarlo', () => {
    const { cambios, aRevisar } = repartirPorPosicion({
      form: VACIO, regex: REGEX,
      nifsAgenda: { A91000000: ['transportista'], A91234567: ['cargador', 'destinatario'] },
    })
    expect(cambios.nif_transportista).toBe('A91000000')
    expect(aRevisar).not.toContain('nif_transportista')
  })

  it('un NIF de la agenda nunca acaba en el hueco de otro papel (el bug del ejemplo)', () => {
    // Sin CIF propio configurado: antes B11223344 iba al destinatario y A91234567 al transportista.
    const { cambios } = repartirPorPosicion({
      form: VACIO, regex: REGEX,
      nifsAgenda: { A91000000: ['transportista'], A91234567: ['destinatario'], B11223344: ['cargador'] },
    })
    expect(cambios.nif_transportista).toBe('A91000000')
    expect(cambios.nif_destinatario).toBe('A91234567')
  })

  it('la agenda nunca rellena sola el cargador (es quien contrata, no se deduce del NIF)', () => {
    const { cambios } = repartirPorPosicion({
      form: VACIO, regex: REGEX, cifPropio: 'B11223344',
      nifsAgenda: { B11223344: ['cargador'], A91000000: ['transportista'], A91234567: ['destinatario'] },
    })
    expect(cambios.nif_cargador).toBeUndefined()
  })

  it('si la IA dice de quién es un NIF, el reparto no toca ese campo', () => {
    const { cambios } = repartirPorPosicion({
      form: VACIO, regex: REGEX, cifPropio: 'B11223344',
      ia: { nif_transportista: 'A91000000', nif_destinatario: 'A91234567' },
    })
    expect(cambios.nif_transportista).toBeUndefined()
    expect(cambios.nif_destinatario).toBeUndefined()
  })

  it('nunca pisa lo que ya está escrito', () => {
    const { cambios } = repartirPorPosicion({ form: { nif_destinatario: 'X1' }, regex: REGEX, cifPropio: 'B11223344' })
    expect(cambios.nif_destinatario).toBeUndefined()
  })

  it('la matrícula con R va al remolque y conserva la R', () => {
    const { cambios } = repartirPorPosicion({ form: VACIO, regex: { matriculas_encontradas: ['R1234BCD', '4821LKP'] } })
    expect(cambios.matricula_remolque).toBe('R1234BCD')
    expect(cambios.matricula_tractor).toBe('4821LKP')
  })
})
