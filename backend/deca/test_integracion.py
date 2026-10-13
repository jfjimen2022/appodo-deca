"""Integración del DeCA con el ERP de la empresa (views_integracion.py).

Se prueba haciendo las peticiones reales, con la clave en la cabecera, igual
que lo hará el conector instalado en la red del cliente."""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import (
    ClaveIntegracionDeca, EmpresaTransportistaDeca, EventoExpedicionDeca, ExpedicionDeca,
)
from .services import integracion_service

User = get_user_model()

URL_INGESTA = '/api/v1/deca/integracion/expediciones/'
URL_CLAVES = '/api/v1/deca/integracion/claves/'


def _empresa_con_deca(nombre: str, activo: bool = True):
    """Standalone: no hay Empresa ni módulos (una instalación = una empresa).
    Se conserva la función para que los tests portados del ERP no cambien."""
    return None


def _envio(referencia: str = 'ALB-2026/4512', **cambios) -> dict:
    datos = {
        'referencia_externa': referencia,
        'numero_albaran': referencia,
        'nif_cargador': 'B12345674',
        'nombre_cargador': 'Fabrica SL',
        'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
        'nif_transportista': 'B12345674',
        'nombre_transportista': 'Transportes SL',
        'nif_destinatario': 'B12345674',
        'nombre_destinatario': 'Cliente SA',
        'matricula_tractor': '1234KLM',
        'matricula_remolque': 'R5678BBC',
        'origen': 'Almería',
        'destino': 'Riba-roja de Túria',
        'fecha_hora_transporte': '2026-10-06T10:00:00',
        'naturaleza_mercancia': 'Aguacate',
        'peso_kg': '14200.00',
        'bultos': 1260,
    }
    datos.update(cambios)
    return datos


class IngestaIntegracionDecaTests(APITestCase):
    def setUp(self):
        self.empresa = _empresa_con_deca('Fabrica')
        self.clave, self.texto = integracion_service.crear_clave('ERP - oficina')
        self.cliente = APIClient()
        self.cliente.credentials(HTTP_X_API_KEY=self.texto)

    # ── Autenticación ──

    def test_sin_clave_401(self):
        respuesta = APIClient().post(URL_INGESTA, _envio(), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(ExpedicionDeca.objects.exists())

    def test_clave_inventada_o_con_otro_secreto_401(self):
        for texto in ('deca_00000000_inventado', f'{self.texto}x', 'Bearer algo', f'deca_{self.clave.prefijo}_'):
            cliente = APIClient()
            cliente.credentials(HTTP_X_API_KEY=texto)
            respuesta = cliente.post(URL_INGESTA, _envio(), format='json')
            self.assertEqual(respuesta.status_code, status.HTTP_401_UNAUTHORIZED, texto)
        self.assertFalse(ExpedicionDeca.objects.exists())

    def test_clave_revocada_deja_de_funcionar(self):
        integracion_service.revocar(self.clave)
        respuesta = self.cliente.post(URL_INGESTA, _envio(), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_la_clave_no_se_guarda_en_claro(self):
        self.clave.refresh_from_db()
        self.assertNotIn(self.texto, (self.clave.hash_clave, self.clave.prefijo))
        self.assertEqual(len(self.clave.hash_clave), 64)

    # ── Ingesta ──

    def test_envio_completo_genera_el_deca(self):
        respuesta = self.cliente.post(URL_INGESTA, _envio(), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)
        self.assertEqual(respuesta.data['estado'], 'generado')
        self.assertEqual(respuesta.data['campos_faltantes'], [])
        self.assertFalse(respuesta.data['ya_existia'])

        expedicion = ExpedicionDeca.objects.get()
        self.assertEqual(expedicion.referencia_externa, 'ALB-2026/4512')
        self.assertEqual(expedicion.clave_integracion, self.clave)
        self.assertIsNone(expedicion.creado_por)
        self.assertTrue(expedicion.pdf_generado)
        self.assertEqual(len(expedicion.hash_sha256), 64)
        self.assertIn(str(expedicion.token_publico), respuesta.data['url_publica'])

        # El QR abre el PDF de verdad.
        publico = APIClient().get(respuesta.data['url_publica'])
        self.assertEqual(publico.status_code, status.HTTP_200_OK)

        # El historial dice de dónde vino.
        generado = expedicion.eventos.get(tipo_evento=EventoExpedicionDeca.TipoEvento.GENERADA)
        self.assertIn('ERP - oficina', generado.detalle)
        self.clave.refresh_from_db()
        self.assertIsNotNone(self.clave.ultimo_uso)

    def test_si_falta_un_obligatorio_queda_en_borrador_y_se_completa_al_reenviar(self):
        respuesta = self.cliente.post(URL_INGESTA, _envio(matricula_tractor=''), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)
        self.assertEqual(respuesta.data['estado'], 'borrador')
        self.assertTrue(respuesta.data['campos_faltantes'])
        self.assertIsNone(respuesta.data['url_publica'])

        # El ERP ya tiene la matrícula: el mismo envío otra vez la completa.
        respuesta = self.cliente.post(URL_INGESTA, _envio(), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
        self.assertEqual(respuesta.data['estado'], 'generado')
        self.assertTrue(respuesta.data['ya_existia'])
        self.assertEqual(ExpedicionDeca.objects.count(), 1)

    def test_reenviar_un_deca_generado_no_lo_duplica_ni_lo_cambia(self):
        self.cliente.post(URL_INGESTA, _envio(), format='json')
        hash_original = ExpedicionDeca.objects.get().hash_sha256

        respuesta = self.cliente.post(URL_INGESTA, _envio(peso_kg='99.00'), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertTrue(respuesta.data['ya_existia'])
        expedicion = ExpedicionDeca.objects.get()
        self.assertEqual(expedicion.hash_sha256, hash_original)
        self.assertEqual(str(expedicion.peso_kg), '14200.00')

    def test_generar_false_deja_el_borrador_para_revisar(self):
        respuesta = self.cliente.post(URL_INGESTA, _envio(generar=False), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        self.assertEqual(respuesta.data['estado'], 'borrador')
        self.assertEqual(respuesta.data['campos_faltantes'], [])

    def test_dato_con_formato_malo_400_sin_crear_nada(self):
        respuesta = self.cliente.post(URL_INGESTA, _envio(nif_cargador='B12345678'), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('nif_cargador', respuesta.data)
        self.assertFalse(ExpedicionDeca.objects.exists())

    def test_sin_referencia_400(self):
        respuesta = self.cliente.post(URL_INGESTA, _envio(referencia_externa=''), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('referencia_externa', respuesta.data)

    def test_no_se_puede_forzar_estado_ni_token(self):
        token = '11111111-1111-4111-8111-111111111111'
        respuesta = self.cliente.post(
            URL_INGESTA, _envio(generar=False, estado='generado', token_publico=token, peso_estimado=True),
            format='json',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)
        expedicion = ExpedicionDeca.objects.get()
        self.assertEqual(expedicion.estado, 'borrador')
        self.assertNotEqual(str(expedicion.token_publico), token)
        self.assertFalse(expedicion.peso_estimado)

    def test_consultar_estado_por_referencia(self):
        self.cliente.post(URL_INGESTA, _envio(), format='json')
        respuesta = self.cliente.get(URL_INGESTA, {'referencia': 'ALB-2026/4512'})
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['estado'], 'generado')

    # ── Peso neto y bruto, los dos en el DeCA ──

    def _con_pesos(self, **pesos):
        envio = _envio(**pesos)
        envio.pop('peso_kg')
        respuesta = self.cliente.post(URL_INGESTA, envio, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)
        return respuesta, ExpedicionDeca.objects.get()

    def test_neto_y_bruto_van_cada_uno_a_su_sitio_sin_tocar_comentarios(self):
        _r, expedicion = self._con_pesos(peso_neto_kg='14200.50', peso_bruto_kg='15320', comentarios='Refrigerada')
        self.assertEqual(str(expedicion.peso_kg), '14200.50')
        self.assertEqual(str(expedicion.peso_bruto_kg), '15320.00')
        self.assertEqual(expedicion.comentarios, 'Refrigerada')
        self.assertEqual(expedicion.estado, 'generado')

    def test_solo_con_el_bruto_tambien_se_genera(self):
        respuesta, expedicion = self._con_pesos(peso_bruto_kg='15320')
        self.assertIsNone(expedicion.peso_kg)
        self.assertEqual(respuesta.data['estado'], 'generado', respuesta.data)

    def test_sin_ningun_peso_queda_en_borrador(self):
        respuesta, _e = self._con_pesos()
        self.assertEqual(respuesta.data['estado'], 'borrador')
        self.assertIn('peso_kg', respuesta.data['campos_faltantes'])

    def test_peso_kg_explicito_manda_sobre_peso_neto_kg(self):
        self.cliente.post(URL_INGESTA, _envio(generar=False, peso_kg='999', peso_neto_kg='1'), format='json')
        self.assertEqual(str(ExpedicionDeca.objects.get().peso_kg), '999.00')

    def test_peso_que_no_es_un_numero_400(self):
        envio = _envio(peso_neto_kg='mucho')
        envio.pop('peso_kg')
        respuesta = self.cliente.post(URL_INGESTA, envio, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('peso_kg', respuesta.data)

    def test_el_pdf_lleva_neto_y_bruto_en_la_misma_linea(self):
        import io

        from pypdf import PdfReader

        from .services import pdf_service, qr_service

        _r, expedicion = self._con_pesos(peso_neto_kg='14200.50', peso_bruto_kg='15320')
        pdf = pdf_service.generar_pdf_deca(expedicion, qr_service.generar_qr_png('https://x'), borrador=True)
        texto = ' '.join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
        self.assertIn('Peso neto', texto)
        # La etiqueta va en su celda; el neto y el bruto, juntos en la de al lado.
        linea = next(lin for lin in texto.splitlines() if '14200.50 kg' in lin)
        self.assertIn('Peso bruto', linea)
        self.assertIn('15320.00 kg', linea)

    # ── NIF que falta, desde la Agenda ──

    def _transportista_en_agenda(self):
        EmpresaTransportistaDeca.objects.create(nif='B12345674', nombre='Transportes Martin e Hijos S.L.')

    def test_nif_del_transportista_desde_la_agenda_si_el_nombre_coincide(self):
        self._transportista_en_agenda()
        respuesta = self.cliente.post(
            URL_INGESTA, _envio(nif_transportista='', nombre_transportista='TRANSPORTES MARTIN E HIJOS'), format='json',
        )
        self.assertEqual(respuesta.data['estado'], 'generado', respuesta.data)
        self.assertEqual(respuesta.data['avisos'], [])
        self.assertEqual(ExpedicionDeca.objects.get().nif_transportista, 'B12345674')

    def test_nombre_con_errata_completa_el_nif_pero_deja_borrador_y_no_toca_la_agenda(self):
        self._transportista_en_agenda()
        respuesta = self.cliente.post(
            URL_INGESTA, _envio(nif_transportista='', nombre_transportista='TRANSPORTES MARTN E HIJOS'), format='json',
        )
        self.assertEqual(respuesta.data['estado'], 'borrador', respuesta.data)
        self.assertEqual(len(respuesta.data['avisos']), 1)
        self.assertEqual(ExpedicionDeca.objects.get().nif_transportista, 'B12345674')
        self.assertEqual(EmpresaTransportistaDeca.objects.filter().count(), 1)

    def test_reenviar_un_borrador_sin_cambios_no_ensucia_el_historial(self):
        self.cliente.post(URL_INGESTA, _envio(matricula_tractor=''), format='json')
        eventos = EventoExpedicionDeca.objects.count()
        for _ in range(3):
            respuesta = self.cliente.post(URL_INGESTA, _envio(matricula_tractor=''), format='json')
            self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(EventoExpedicionDeca.objects.count(), eventos)

    # ── Modificado en el ERP después de generar ──

    def test_cambio_en_el_erp_tras_generar_se_avisa_sin_tocar_el_deca(self):
        self.cliente.post(URL_INGESTA, _envio(), format='json')
        hash_original = ExpedicionDeca.objects.get().hash_sha256

        respuesta = self.cliente.post(URL_INGESTA, _envio(matricula_tractor='9999XYZ'), format='json')
        self.assertEqual(respuesta.data['cambios_erp'], [
            {'campo': 'matricula_tractor', 'en_deca': '1234KLM', 'en_erp': '9999XYZ'},
        ])
        expedicion = ExpedicionDeca.objects.get()
        self.assertEqual(expedicion.matricula_tractor, '1234KLM')
        self.assertEqual(expedicion.hash_sha256, hash_original)
        self.assertIsNotNone(expedicion.cambios_erp_en)
        self.assertEqual(expedicion.eventos.filter(tipo_evento='cambio_erp').count(), 1)

        # Reenvíos con lo mismo: ni un evento más.
        self.cliente.post(URL_INGESTA, _envio(matricula_tractor='9999XYZ'), format='json')
        self.assertEqual(expedicion.eventos.filter(tipo_evento='cambio_erp').count(), 1)

        # El ERP vuelve a coincidir: el aviso se quita solo.
        self.cliente.post(URL_INGESTA, _envio(), format='json')
        self.assertEqual(ExpedicionDeca.objects.get().cambios_erp, [])

    def test_dato_que_el_erp_no_tiene_no_cuenta_como_cambio(self):
        self.cliente.post(URL_INGESTA, _envio(), format='json')
        respuesta = self.cliente.post(URL_INGESTA, _envio(nif_transportista='', nombre_conductor=''), format='json')
        self.assertEqual(respuesta.data['cambios_erp'], [])

    def test_descartar_el_aviso_y_que_solo_vuelva_si_cambia_otra_cosa(self):
        admin = User.objects.create_user(username='a@fabrica.test', email='a@fabrica.test', password='x', is_staff=True)
        erp_app = APIClient()
        erp_app.force_authenticate(user=admin)
        self.cliente.post(URL_INGESTA, _envio(), format='json')
        self.cliente.post(URL_INGESTA, _envio(bultos=1300), format='json')
        expedicion = ExpedicionDeca.objects.get()
        self.assertTrue(expedicion.cambios_erp)

        respuesta = erp_app.post(f'/api/v1/deca/expediciones/{expedicion.id}/descartar-cambios-erp/')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['cambios_erp'], [])

        self.cliente.post(URL_INGESTA, _envio(bultos=1300), format='json')
        self.assertEqual(ExpedicionDeca.objects.get().cambios_erp, [])
        self.cliente.post(URL_INGESTA, _envio(bultos=1400), format='json')
        self.assertEqual(ExpedicionDeca.objects.get().cambios_erp[0]['en_erp'], '1400')

    def test_borrador_se_actualiza_sin_aviso(self):
        self.cliente.post(URL_INGESTA, _envio(matricula_tractor=''), format='json')
        respuesta = self.cliente.post(URL_INGESTA, _envio(matricula_tractor='', bultos=1300), format='json')
        self.assertEqual(respuesta.data['cambios_erp'], [])
        self.assertEqual(ExpedicionDeca.objects.get().bultos, 1300)




class FiltrosListadoIntegracionDecaTests(APITestCase):
    """Filtros de Expediciones para lo que llega del ERP: origen, modificados
    en el ERP, les falta algo y búsqueda por referencia. Valen también para
    las exportaciones (mismo get_queryset)."""

    URL = '/api/v1/deca/expediciones/'

    def setUp(self):
        self.empresa = _empresa_con_deca('Fabrica')
        _clave, texto = integracion_service.crear_clave('ERP')
        self.erp = APIClient()
        self.erp.credentials(HTTP_X_API_KEY=texto)
        self.admin = User.objects.create_user(username='a@s.test', email='a@s.test', password='x', is_staff=True)
        self.app = APIClient()
        self.app.force_authenticate(user=self.admin)

        self.erp.post(URL_INGESTA, _envio('ENV-1'), format='json')                          # generado
        self.erp.post(URL_INGESTA, _envio('ENV-2', matricula_tractor=''), format='json')    # borrador, le falta
        self.erp.post(URL_INGESTA, _envio('ENV-1', bultos=999), format='json')             # ENV-1 cambia en el ERP
        self.app.post(self.URL, {'numero_albaran': 'MANUAL-1'}, format='json')             # hecho en Appodo

    def _refs(self, **params):
        respuesta = self.app.get(self.URL, {'page_size': 50, **params})
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
        return sorted(e['referencia_externa'] or e['numero_albaran'] for e in respuesta.data['results'])

    def test_origen(self):
        self.assertEqual(self._refs(origen='erp'), ['ENV-1', 'ENV-2'])
        self.assertEqual(self._refs(origen='appodo'), ['MANUAL-1'])

    def test_modificados_en_el_erp(self):
        self.assertEqual(self._refs(modificado_erp='true'), ['ENV-1'])

    def test_les_falta_algo(self):
        # El manual también: es un borrador vacío.
        self.assertEqual(self._refs(incompletas='true'), ['ENV-2', 'MANUAL-1'])

    def test_busqueda_por_referencia_del_erp(self):
        self.assertEqual(self._refs(q='ENV-2'), ['ENV-2'])

    def test_les_falta_algo_coincide_con_lo_que_exige_generar(self):
        """q_incompletas() es faltantes() en consulta: si divergen, el filtro
        enseñaría como completo algo que no se puede generar (o al revés)."""
        from .services import obligatorios_service

        casos = [
            {}, {'peso_kg': None, 'peso_bruto_kg': 15000}, {'peso_kg': 0}, {'matricula_remolque': '', 'sin_remolque': True},
            {'matricula_remolque': ''}, {'bultos': 0}, {'domicilio_cargador': ''}, {'fecha_hora_transporte': None},
        ]
        base = ExpedicionDeca.objects.get(referencia_externa='ENV-1')
        for i, cambios in enumerate(casos):
            datos = {
                f.name: getattr(base, f.name) for f in ExpedicionDeca._meta.concrete_fields
                if f.name in obligatorios_service.CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR
                or f.name in ('peso_bruto_kg', 'sin_remolque', 'anio', 'mes')
            }
            exp = ExpedicionDeca.objects.create(
                **{**datos, **cambios}, referencia_externa=f'CASO-{i}',
            )
            en_filtro = ExpedicionDeca.objects.filter(
                obligatorios_service.q_incompletas(None), pk=exp.pk,
            ).exists()
            self.assertEqual(en_filtro, bool(obligatorios_service.faltantes(exp)), cambios)

    def test_la_exportacion_respeta_los_filtros(self):
        respuesta = self.app.get('/api/v1/deca/expediciones/exportar-excel/', {'origen': 'erp', 'incompletas': 'true'})
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)


class GestionClavesIntegracionDecaTests(APITestCase):
    def setUp(self):
        self.empresa = _empresa_con_deca('Fabrica')
        self.admin = User.objects.create_user(username='admin@fabrica.test', email='admin@fabrica.test', password='Admin123!', is_staff=True)
        self.cliente = APIClient()
        self.cliente.force_authenticate(user=self.admin)

    def test_crear_ensena_la_clave_una_sola_vez_y_funciona(self):
        respuesta = self.cliente.post(URL_CLAVES, {'nombre': 'ERP'}, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)
        texto = respuesta.data['clave']
        self.assertTrue(texto.startswith('deca_'))

        lista = self.cliente.get(URL_CLAVES)
        self.assertEqual(len(lista.data), 1)
        self.assertNotIn('clave', lista.data[0])
        self.assertNotIn('hash_clave', lista.data[0])

        conector = APIClient()
        conector.credentials(HTTP_X_API_KEY=texto)
        self.assertEqual(conector.post(URL_INGESTA, _envio(), format='json').status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.cliente.get(URL_CLAVES).data[0]['expediciones_recibidas'], 1)

    def test_revocar(self):
        texto = self.cliente.post(URL_CLAVES, {'nombre': 'ERP'}, format='json').data['clave']
        clave = ClaveIntegracionDeca.objects.get()
        respuesta = self.cliente.post(f'{URL_CLAVES}{clave.id}/revocar/')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertFalse(respuesta.data['activa'])

        conector = APIClient()
        conector.credentials(HTTP_X_API_KEY=texto)
        self.assertEqual(conector.post(URL_INGESTA, _envio(), format='json').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_nombre_obligatorio(self):
        respuesta = self.cliente.post(URL_CLAVES, {'nombre': '  '}, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)

    def test_un_usuario_que_no_es_admin_no_gestiona_claves(self):
        usuario = User.objects.create_user(username='user@fabrica.test', email='user@fabrica.test', password='User123!', is_staff=False)
        cliente = APIClient()
        cliente.force_authenticate(user=usuario)
        self.assertEqual(cliente.get(URL_CLAVES).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            cliente.post(URL_CLAVES, {'nombre': 'x'}, format='json').status_code, status.HTTP_403_FORBIDDEN,
        )



class DecaHechoAManoTests(APITestCase):
    """Caso típico: logística ya hacía los DeCA a mano y, al conectar el ERP,
    el mismo albarán salía dos veces."""

    def setUp(self):
        self.empresa = _empresa_con_deca('Fabrica')
        self.clave, texto = integracion_service.crear_clave('ERP-almacen')
        self.cliente = APIClient()
        self.cliente.credentials(HTTP_X_API_KEY=texto)

    def _a_mano(self, albaran, estado=ExpedicionDeca.Estado.GENERADO):
        return ExpedicionDeca.objects.create(
            anio=2026, mes=10, numero_albaran=albaran, estado=estado,
            matricula_tractor='1111AAA',
        )

    def test_no_duplica_el_hecho_a_mano_aunque_lleve_espacios(self):
        manual = self._a_mano('AV1 / 481')
        respuesta = self.cliente.post(URL_INGESTA, _envio('ENV-20300', numero_albaran='AV1/481'), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
        self.assertTrue(respuesta.data['ya_existia'])
        self.assertEqual(ExpedicionDeca.objects.count(), 1)
        manual.refresh_from_db()
        self.assertEqual(manual.referencia_externa, 'ENV-20300')
        self.assertEqual(manual.estado, ExpedicionDeca.Estado.GENERADO)
        self.assertEqual(manual.matricula_tractor, '1111AAA')  # el ERP no lo toca

    def test_borra_el_borrador_del_erp_que_duplicaba_uno_hecho_a_mano(self):
        self.cliente.post(URL_INGESTA, _envio('ENV-20302', numero_albaran='AV1/483', nif_transportista=''), format='json')
        self.assertEqual(ExpedicionDeca.objects.get().estado, ExpedicionDeca.Estado.BORRADOR)
        manual = self._a_mano('AV1/483')  # logística lo hace a mano mientras tanto

        self.cliente.post(URL_INGESTA, _envio('ENV-20302', numero_albaran='AV1/483', nif_transportista=''), format='json')
        self.assertEqual(list(ExpedicionDeca.objects.values_list('id', flat=True)), [manual.id])
        manual.refresh_from_db()
        self.assertEqual(manual.referencia_externa, 'ENV-20302')
        self.assertTrue(EventoExpedicionDeca.objects.filter(expedicion=manual, detalle__contains='ENV-20302').exists())

    def test_reenvios_con_datos_distintos_no_marcan_el_hecho_a_mano(self):
        manual = self._a_mano('AV1/479')
        for _ in range(2):
            self.cliente.post(URL_INGESTA, _envio('ENV-20298', numero_albaran='AV1/479'), format='json')
        manual.refresh_from_db()
        self.assertEqual(manual.cambios_erp, [])
        self.assertEqual(ExpedicionDeca.objects.count(), 1)

    def test_uno_anulado_o_de_otro_albaran_no_cuenta(self):
        self._a_mano('AV1/482', estado=ExpedicionDeca.Estado.ANULADO)
        self._a_mano('AV1/1482')
        respuesta = self.cliente.post(URL_INGESTA, _envio('ENV-20301', numero_albaran='AV1/482'), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)
        self.assertEqual(ExpedicionDeca.objects.filter(clave_integracion=self.clave).count(), 1)

    def test_la_hora_del_erp_es_hora_local_de_la_empresa(self):
        self.cliente.post(URL_INGESTA, _envio(fecha_hora_transporte='2026-10-05T07:30:30'), format='json')
        fecha = ExpedicionDeca.objects.get().fecha_hora_transporte
        self.assertEqual((fecha.hour, fecha.minute), (5, 30))  # 07:30 en Madrid (CEST) = 05:30 UTC
    def test_un_borrador_del_erp_borrado_no_vuelve_a_aparecer(self):
        self.cliente.post(URL_INGESTA, _envio('ENV-20301', numero_albaran='AV1/482', nif_transportista=''), format='json')
        expedicion = ExpedicionDeca.objects.get()
        admin = User.objects.create_user(username='admin@fabrica.test', email='admin@fabrica.test', password='Admin123!', is_staff=True)
        persona = APIClient()
        persona.force_authenticate(user=admin)
        self.assertEqual(persona.delete(f'/api/v1/deca/expediciones/{expedicion.id}/').status_code, status.HTTP_204_NO_CONTENT)

        respuesta = self.cliente.post(URL_INGESTA, _envio('ENV-20301', numero_albaran='AV1/482', nif_transportista=''), format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['estado'], 'descartado')
        self.assertFalse(ExpedicionDeca.objects.exists())