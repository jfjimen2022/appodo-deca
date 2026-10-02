import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AltaDecaMovil from './AltaDecaMovil'
import { analizarFoto } from '../../../lib/calidadFoto'

vi.mock('../../../lib/calidadFoto', () => ({ analizarFoto: vi.fn() }))

// t() devuelve la clave (con el `count` pegado cuando lo hay), igual que el
// resto de tests del proyecto -- así se comprueba QUÉ mensaje sale sin
// depender de la redacción del JSON.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts && opts.count != null ? `${key}:${opts.count}` : key),
  }),
}))

const OBLIGATORIOS = [
  'nif_cargador', 'nombre_cargador', 'nif_transportista', 'nombre_transportista',
  'matricula_tractor', 'origen', 'destino', 'fecha_hora_transporte', 'naturaleza_mercancia',
]

const LEIDO = {
  nif_cargador: 'B11223344', nombre_cargador: 'Hortofrutícola Ejemplo S.L.',
  nif_transportista: 'B72345678', nombre_transportista: 'Transportes Romero Ruiz S.L.',
  matricula_tractor: '', origen: 'Vejer de la Frontera', destino: 'Mercamadrid',
  fecha_hora_transporte: '', naturaleza_mercancia: 'Aguacate Hass',
}

function montar(props = {}) {
  const base = {
    form: LEIDO,
    onCambiarCampo: vi.fn(),
    onConfirmarCampo: vi.fn(),
    camposObligatorios: OBLIGATORIOS,
    camposRevisar: ['nombre_transportista'],
    fieldErrors: {},
    error: '',
    expedicion: { id: 'exp-1', estado: 'borrador', documentos_origen: [{ id: 'd1', nombre_original: 'albaran.jpg', tipo_documento: 'albaran_venta', archivo: '/media/a.jpg' }] },
    empezarEnLista: true,
    ocupado: null,
    onArchivos: vi.fn(),
    onEmpezarManual: vi.fn(),
    agenda: { tractoras: [{ value: 1, label: 'Volvo azul', keywords: '4821LKP' }] },
    onElegirAgenda: vi.fn(),
    onBorrarDocumento: vi.fn(),
    onCambiarTipoDocumento: vi.fn(),
    onReleerDocumento: vi.fn(),
    estadoGuardado: 'guardado',
    onSalir: vi.fn(),
    onVistaPrevia: vi.fn(),
    onBorrarBorrador: vi.fn(),
    onGenerar: vi.fn(),
    sucesivos: [],
    nuevoSucesivo: { nombre: '', nif: '', matricula: '' },
    setNuevoSucesivo: vi.fn(),
    onAgregarSucesivo: vi.fn(),
    onBorrarSucesivo: vi.fn(),
    guardandoSucesivo: false,
    ...props,
  }
  const utils = render(<AltaDecaMovil {...base} />)
  return { ...utils, props: base }
}

describe('AltaDecaMovil', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('en un alta nueva empieza por la cámara, sin ningún campo a la vista', () => {
    montar({ expedicion: null, empezarEnLista: false, form: {} })
    expect(screen.getByText('movil.foto_albaran')).toBeInTheDocument()
    expect(screen.getByText('movil.rellenar_a_mano')).toBeInTheDocument()
    expect(screen.queryByText('movil.solo_esto')).not.toBeInTheDocument()
  })

  it('tras leer el documento solo pide lo que falta o hay que revisar, y cuenta lo que falta', () => {
    montar()
    // 6 de 9 listos: faltan matrícula y salida, y el transportista está por revisar.
    expect(screen.getByText('6/9')).toBeInTheDocument()
    expect(screen.getByLabelText('movil.campo_matricula_tractor')).toBeInTheDocument()
    expect(screen.getByLabelText('movil.campo_fecha_hora_transporte')).toBeInTheDocument()
    expect(screen.getByText('movil.pregunta_es_este')).toBeInTheDocument()
    // Lo ya leído no se enseña como campo editable hasta que se pide.
    expect(screen.queryByLabelText('movil.campo_origen')).not.toBeInTheDocument()
    // El botón de abajo dice cuántos faltan (los que están vacíos, no los de revisar).
    expect(screen.getByText('movil.faltan_datos:2')).toBeInTheDocument()
  })

  it('"Sí, es este" confirma el dato dudoso', () => {
    const { props } = montar()
    fireEvent.click(screen.getByText('movil.si_es_este'))
    expect(props.onConfirmarCampo).toHaveBeenCalledWith('nombre_transportista')
  })

  it('la agenda no se enseña sola: se abre con "+", se busca y elegir aplica y cierra', () => {
    const agenda = {
      tractoras: [{ value: 1, label: 'Volvo azul', keywords: '4821LKP' }, { value: 2, label: 'Scania', keywords: '9034MHT' }],
    }
    const { props } = montar({ agenda })
    expect(screen.queryByText('Volvo azul')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('movil.elegir_de_agenda'))
    expect(screen.getByText('Volvo azul')).toBeInTheDocument()
    expect(screen.getByText('Scania')).toBeInTheDocument()

    // El buscador filtra por nombre y por matrícula/NIF.
    fireEvent.change(screen.getByLabelText('movil.buscar_en_agenda'), { target: { value: '9034' } })
    expect(screen.queryByText('Volvo azul')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('movil.buscar_en_agenda'), { target: { value: 'nadie' } })
    expect(screen.getByText('movil.agenda_sin_resultados')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('movil.buscar_en_agenda'), { target: { value: 'volvo' } })

    fireEvent.click(screen.getByText('Volvo azul'))
    expect(props.onElegirAgenda).toHaveBeenCalledWith('tractoras', 1)
    expect(screen.queryByLabelText('movil.buscar_en_agenda')).not.toBeInTheDocument()
  })

  it('el cargador vacío no se rellena solo: se elige con un toque entre nosotros y el cliente', () => {
    const { props } = montar({
      form: { ...LEIDO, nombre_cargador: '', nif_cargador: '', nombre_destinatario: 'Distrinorte S.A.', nif_destinatario: 'A91234567' },
      empresaPropia: { nif: 'B11223344', nombre: 'Frutas del Sur S.L.' },
    })
    expect(screen.getByText('Frutas del Sur S.L.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Distrinorte S.A.'))
    expect(props.onCambiarCampo).toHaveBeenCalledWith('nombre_cargador', 'Distrinorte S.A.')
    expect(props.onCambiarCampo).toHaveBeenCalledWith('nif_cargador', 'A91234567')
    expect(props.onConfirmarCampo).toHaveBeenCalledWith('nombre_cargador')
  })

  it('junto a "¿Es este?" enseña el trozo de la foto donde está escrito', () => {
    montar({ zonas: { nombre_transportista: { documentoId: 'd1', caja: [600, 80, 660, 400] } } })
    expect(screen.getByText('movil.en_el_papel_pone')).toBeInTheDocument()
    expect(screen.getByAltText('movil.recorte_alt')).toHaveAttribute('src', '/media/a.jpg')
  })

  it('una foto movida avisa antes de subirla y se puede usar igualmente o repetir', async () => {
    analizarFoto.mockResolvedValue({ movida: true, reflejos: false })
    const { props, container } = montar({ expedicion: null, empezarEnLista: false, form: {} })
    const foto = new File(['x'], 'albaran.jpg', { type: 'image/jpeg' })
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]'), { target: { files: [foto] } })

    await waitFor(() => expect(screen.getByText('movil.calidad_movida')).toBeInTheDocument())
    expect(props.onArchivos).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('movil.usar_igualmente'))
    expect(props.onArchivos).toHaveBeenCalledTimes(1)
    expect(props.onArchivos.mock.calls[0][0][0].name).toBe('albaran.jpg')
  })

  it('al segundo intento fallido sugiere rellenar a mano', async () => {
    analizarFoto.mockResolvedValue({ movida: true, reflejos: false })
    const { props, container } = montar({ expedicion: null, empezarEnLista: false, form: {} })
    const input = container.ownerDocument.querySelector('input[type="file"]')
    const foto = () => new File(['x'], 'albaran.jpg', { type: 'image/jpeg' })

    fireEvent.change(input, { target: { files: [foto()] } })
    await waitFor(() => expect(screen.getByText('movil.calidad_movida')).toBeInTheDocument())
    expect(screen.queryByText('movil.segundo_intento:9')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('movil.cerrar'))

    fireEvent.change(input, { target: { files: [foto()] } })
    await waitFor(() => expect(screen.getByText('movil.segundo_intento:9')).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('movil.rellenar_a_mano').at(-1))
    expect(props.onEmpezarManual).toHaveBeenCalledTimes(1)
    expect(props.onArchivos).not.toHaveBeenCalled()
  })

  it('con dos fotos que no se leen, anima a rellenar a mano los que faltan', () => {
    const doc = (id) => ({ id, nombre_original: `${id}.jpg`, tipo_documento: 'cmr', archivo: `/media/${id}.jpg` })
    montar({ form: {}, camposRevisar: [], expedicion: { id: 'e', estado: 'borrador', documentos_origen: [doc('a'), doc('b')] } })
    expect(screen.getByText('movil.lectura_no_ayuda:9')).toBeInTheDocument()
  })

  it('con una sola foto todavía no insiste', () => {
    montar({ form: {}, camposRevisar: [] })
    expect(screen.queryByText(/movil.lectura_no_ayuda/)).not.toBeInTheDocument()
  })

  it('una foto buena se sube sin preguntar', async () => {
    analizarFoto.mockResolvedValue({ movida: false, reflejos: false })
    const { props, container } = montar({ expedicion: null, empezarEnLista: false, form: {} })
    const foto = new File(['x'], 'albaran.jpg', { type: 'image/jpeg' })
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]'), { target: { files: [foto] } })
    await waitFor(() => expect(props.onArchivos).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('movil.calidad_titulo')).not.toBeInTheDocument()
  })

  it('"Camión sin remolque" se marca y se deshace con un toque', () => {
    const { props } = montar()
    fireEvent.click(screen.getByText('movil.camion_sin_remolque'))
    expect(props.onCambiarCampo).toHaveBeenCalledWith('sin_remolque', true)
  })

  it('con "sin remolque" marcado se ve y se puede deshacer', () => {
    const { props } = montar({ form: { ...LEIDO, sin_remolque: true } })
    expect(screen.getByText('movil.sin_remolque_valor')).toBeInTheDocument()
    fireEvent.click(screen.getByText('movil.si_lleva_remolque'))
    expect(props.onCambiarCampo).toHaveBeenCalledWith('sin_remolque', false)
  })

  it('desde el inicio se puede consultar si el transporte necesita DeCA', () => {
    montar({ expedicion: null, empezarEnLista: false, form: {} })
    fireEvent.click(screen.getByText('ayuda_deca.boton'))
    expect(screen.getByText('ayuda_deca.intro')).toBeInTheDocument()
    expect(screen.getByText('ayuda_deca.no_titulo')).toBeInTheDocument()
  })

  it('un campo sin agenda no lleva botón "+"', () => {
    montar({ agenda: {} })
    expect(screen.queryByLabelText('movil.elegir_de_agenda')).not.toBeInTheDocument()
  })

  it('"Ahora" pone la hora de salida del dispositivo', () => {
    const { props } = montar()
    fireEvent.click(screen.getByText('movil.ahora'))
    const [campo, valor] = props.onCambiarCampo.mock.calls[0]
    expect(campo).toBe('fecha_hora_transporte')
    expect(valor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('con todo listo pasa a comprobar y desde ahí pide confirmación antes de generar', () => {
    const { props } = montar({
      form: { ...LEIDO, matricula_tractor: '4821LKP', fecha_hora_transporte: '2026-09-27T07:45' },
      camposRevisar: [],
    })
    fireEvent.click(screen.getByText('movil.siguiente_comprobar'))
    expect(screen.getByText('movil.comprueba_y_genera')).toBeInTheDocument()
    expect(screen.getByText('27/09/2026 · 07:45')).toBeInTheDocument()

    fireEvent.click(screen.getByText('movil.generar_deca'))
    expect(props.onGenerar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('movil.si_generar'))
    expect(props.onGenerar).toHaveBeenCalledTimes(1)
  })

  it('sin cobertura avisa, cuenta las fotos del móvil y el botón genera e imprime', () => {
    const { props } = montar({
      form: { ...LEIDO, matricula_tractor: '4821LKP', fecha_hora_transporte: '2026-09-27T07:45' },
      camposRevisar: [],
      sinConexion: true,
      fotosSinConexion: 2,
    })
    expect(screen.getByText('offline.banner')).toBeInTheDocument()
    expect(screen.getByText('offline.fotos_en_movil:2')).toBeInTheDocument()
    expect(screen.getByText('offline.sin_cobertura_corto')).toBeInTheDocument()
    fireEvent.click(screen.getByText('movil.siguiente_comprobar'))
    fireEvent.click(screen.getByText('offline.generar_imprimir'))
    expect(screen.getByText('offline.generar_desc')).toBeInTheDocument()
    fireEvent.click(screen.getByText('offline.si_imprimir'))
    expect(props.onGenerar).toHaveBeenCalledTimes(1)
  })

  it('si la empresa exige red, sin cobertura no deja generar', () => {
    const { props } = montar({
      form: { ...LEIDO, matricula_tractor: '4821LKP', fecha_hora_transporte: '2026-09-27T07:45' },
      camposRevisar: [], sinConexion: true, modoSinCobertura: 'necesita_red',
    })
    expect(screen.getByText('campo.necesita_red_banner')).toBeInTheDocument()
    fireEvent.click(screen.getByText('movil.siguiente_comprobar'))
    expect(screen.getByText('campo.necesita_red_barra')).toBeInTheDocument()
    expect(screen.queryByText('offline.generar_imprimir')).toBeNull()
    expect(props.onGenerar).not.toHaveBeenCalled()
  })

  it('guardar para luego cambia el botón de generar', () => {
    montar({
      form: { ...LEIDO, matricula_tractor: '4821LKP', fecha_hora_transporte: '2026-09-27T07:45' },
      camposRevisar: [], sinConexion: true, modoSinCobertura: 'generar_al_volver',
    })
    expect(screen.getByText('campo.generar_al_volver_banner')).toBeInTheDocument()
    fireEvent.click(screen.getByText('movil.siguiente_comprobar'))
    fireEvent.click(screen.getByText('campo.guardar_para_luego'))
    expect(screen.getByText('campo.guardar_para_luego_desc')).toBeInTheDocument()
  })

  it('DeCA de papel: se empieza desde el inicio y al final se registra, no se genera', () => {
    const onEmpezarPapel = vi.fn()
    const inicio = montar({ empezarEnLista: false, expedicion: null, permitirPapel: true, onEmpezarPapel })
    fireEvent.click(screen.getByText('campo.movil_registrar_papel'))
    expect(onEmpezarPapel).toHaveBeenCalled()
    inicio.unmount()

    const { props } = montar({
      form: { ...LEIDO, matricula_tractor: '4821LKP', fecha_hora_transporte: '2026-09-27T07:45' },
      camposRevisar: [], modoPapel: true, onRegistrarPapel: vi.fn(),
    })
    expect(screen.getByText('campo.movil_papel_banner')).toBeInTheDocument()
    fireEvent.click(screen.getByText('movil.siguiente_comprobar'))
    fireEvent.click(screen.getByText('campo.btn_registrar_papel'))
    expect(props.onRegistrarPapel).toHaveBeenCalled()
    expect(props.onGenerar).not.toHaveBeenCalled()
  })

  it('peso estimado solo aparece si la empresa usa DeCA anticipado', () => {
    const sin = montar()
    expect(screen.queryByText('campo.movil_peso_es_estimado')).toBeNull()
    sin.unmount()
    const { props } = montar({ permitirPesoEstimado: true })
    fireEvent.click(screen.getByText('campo.movil_peso_es_estimado'))
    expect(props.onCambiarCampo).toHaveBeenCalledWith('peso_estimado', true)
  })

  it('en el inicio dice si el móvil está listo para trabajar sin cobertura', () => {
    const listo = montar({ empezarEnLista: false, expedicion: null, preparadoEn: Date.now() })
    expect(screen.getByText('campo.listo_sin_cobertura')).toBeInTheDocument()
    listo.unmount()
    const sinPreparar = montar({ empezarEnLista: false, expedicion: null, preparadoEn: null, sinConexion: true })
    expect(screen.getByText('campo.no_preparado_sin_red')).toBeInTheDocument()
    sinPreparar.unmount()
    montar({ empezarEnLista: false, expedicion: null, preparadoEn: Date.now() - 10 * 86400000 })
    expect(screen.getByText('campo.agenda_vieja:10')).toBeInTheDocument()
  })

  it('mientras comprueba si está preparado no afirma nada', () => {
    montar({ empezarEnLista: false, expedicion: null, preparadoEn: undefined, sinConexion: true })
    expect(screen.queryByText('campo.no_preparado_sin_red')).toBeNull()
    expect(screen.queryByText('campo.listo_sin_cobertura')).toBeNull()
  })

  it('lo opcional vive en "Más datos" y un campo que la empresa exige sale de ahí', () => {
    montar({ camposObligatorios: [...OBLIGATORIOS, 'nombre_destinatario', 'nif_destinatario'] })
    fireEvent.click(screen.getByText('movil.mas_datos'))
    expect(screen.getByLabelText('movil.campo_volumen_m3')).toBeInTheDocument()
    // Peso, bultos y remolque ya no son opcionales (BOE, 2026-09-30).
    expect(screen.queryByText('movil.campo_matricula_remolque')).not.toBeInTheDocument()
    expect(screen.getByLabelText('movil.campo_autorizacion_especial')).toBeInTheDocument()
    expect(screen.queryByLabelText('movil.campo_nombre_destinatario')).toBeInTheDocument()
    // ...pero en la lista principal (pendiente), no en el grupo opcional.
    expect(screen.queryByText('movil.grupo_destinatario')).not.toBeInTheDocument()
  })

  it('mientras sube o lee el documento tapa la pantalla con el aviso', () => {
    montar({ ocupado: 'Leyendo el documento…' })
    const avisos = screen.getAllByRole('status').map((el) => el.textContent)
    expect(avisos).toContain('Leyendo el documento…')
  })
})
