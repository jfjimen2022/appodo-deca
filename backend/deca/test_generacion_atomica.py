"""Generar / corregir un DeCA es todo o nada (generacion_service).

Antes, si el PDF fallaba a mitad, quedaba un número automático consumido sin
DeCA, o una corrección guardada en la BD con el PDF todavía viejo (pantalla
y documento oficial diciendo cosas distintas). Se fuerza el fallo con
mock.patch en distintos puntos y se comprueba que la BD queda como estaba y
que el usuario recibe un mensaje claro en `detail`."""
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import ConfiguracionDeca, EventoExpedicionDeca, ExpedicionDeca, ModificacionDeca
from .services import integracion_service

User = get_user_model()

FALLO_PDF = 'deca.services.pdf_service.generar_pdf_deca'


class GeneracionAtomicaDecaTests(APITestCase):
    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = User.objects.create_user(username='admin@atomica.test', email='admin@atomica.test', password='Admin123!', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _datos(self):
        return {
            'numero_albaran': 'A-000777',
            'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL', 'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
            'nif_transportista': 'B12345674', 'nombre_transportista': 'Transportes SL',
            'nif_destinatario': 'B12345674', 'nombre_destinatario': 'Cliente SA',
            'matricula_tractor': '1234bbb', 'matricula_remolque': '5678ccc',
            'origen': 'Almería', 'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(),
            'naturaleza_mercancia': 'Tomate', 'peso_kg': '12000.00', 'bultos': 500,
        }

    def _confirmada(self):
        exp_id = self.client.post('/api/v1/deca/expediciones/', self._datos(), format='json').data['id']
        self.client.post(f'/api/v1/deca/expediciones/{exp_id}/confirmar/')
        return exp_id

    def _generar(self, exp_id):
        return self.client.post(f'/api/v1/deca/expediciones/{exp_id}/generar/')

    # ── Generar ──

    def test_si_falla_el_pdf_no_se_consume_numero_y_sigue_confirmada(self):
        ConfiguracionDeca.objects.create(identificador_preferido='automatico')
        exp_id = self._confirmada()

        with mock.patch(FALLO_PDF, side_effect=RuntimeError('reportlab roto')):
            r = self._generar(exp_id)

        self.assertEqual(r.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn('No se ha podido generar el PDF', r.data['detail'])
        self.assertNotIn('reportlab', r.data['detail'])  # el detalle técnico no llega al usuario
        exp = ExpedicionDeca.objects.get(id=exp_id)
        self.assertEqual(exp.estado, ExpedicionDeca.Estado.CONFIRMADO)
        self.assertFalse(exp.numero_interno)
        self.assertFalse(exp.pdf_generado)
        self.assertEqual(ConfiguracionDeca.objects.get().ultimo_numero_automatico, 0)
        self.assertFalse(exp.eventos.filter(tipo_evento=EventoExpedicionDeca.TipoEvento.GENERADA).exists())

        # Al reintentar sale el PRIMER número: no quedó ninguno quemado.
        self.assertEqual(self._generar(exp_id).status_code, status.HTTP_200_OK)
        exp.refresh_from_db()
        self.assertTrue(exp.numero_interno.endswith('00001'))

    def test_fallo_despues_de_escribir_el_pdf_no_deja_fichero_huerfano(self):
        exp_id = self._confirmada()
        escrito = {}

        def fallar_tras_guardar(expedicion, *args, **kwargs):
            escrito['nombre'] = expedicion.pdf_generado.name
            raise RuntimeError('fallo al anotar el evento')

        with mock.patch('deca.services.auditoria_service.registrar_evento', side_effect=fallar_tras_guardar):
            r = self._generar(exp_id)

        self.assertEqual(r.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertTrue(escrito.get('nombre'))
        self.assertFalse(default_storage.exists(escrito['nombre']))
        self.assertEqual(ExpedicionDeca.objects.get(id=exp_id).estado, ExpedicionDeca.Estado.CONFIRMADO)

    def test_si_falla_el_aprendizaje_el_deca_se_genera_igual(self):
        exp_id = self._confirmada()
        with mock.patch('deca.services.aprendizaje_service.resolver_lecturas', side_effect=RuntimeError('x')):
            r = self._generar(exp_id)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(ExpedicionDeca.objects.get(id=exp_id).estado, ExpedicionDeca.Estado.GENERADO)

    # ── Corregir un DeCA ya generado ──

    def test_si_falla_regenerar_el_pdf_la_correccion_no_se_guarda(self):
        exp_id = self._confirmada()
        self.assertEqual(self._generar(exp_id).status_code, status.HTTP_200_OK)
        antes = ExpedicionDeca.objects.get(id=exp_id)

        with mock.patch(FALLO_PDF, side_effect=RuntimeError('reportlab roto')):
            r = self.client.patch(f'/api/v1/deca/expediciones/{exp_id}/', {
                'peso_kg': '21000', 'motivo_modificacion': 'Pesada real en báscula',
            }, format='json')

        self.assertEqual(r.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn('No se ha podido regenerar el PDF', r.data['detail'])
        despues = ExpedicionDeca.objects.get(id=exp_id)
        self.assertEqual(despues.peso_kg, antes.peso_kg)
        self.assertEqual(despues.hash_sha256, antes.hash_sha256)
        self.assertEqual(despues.pdf_generado.name, antes.pdf_generado.name)
        self.assertFalse(ModificacionDeca.objects.filter(expedicion_id=exp_id).exists())
        # El PDF original sigue ahí y se sigue sirviendo.
        self.assertTrue(default_storage.exists(antes.pdf_generado.name))


class IngestaGeneracionFallidaDecaTests(APITestCase):
    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        _clave, texto = integracion_service.crear_clave('ERP pruebas')
        self.cliente = APIClient()
        self.cliente.credentials(HTTP_X_API_KEY=texto)

    def test_el_erp_recibe_aviso_y_la_expedicion_queda_confirmada(self):
        envio = {
            'referencia_externa': 'ALB-1', 'numero_albaran': 'ALB-1',
            'nif_cargador': 'B12345674', 'nombre_cargador': 'Export SL', 'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
            'nif_transportista': 'B12345674', 'nombre_transportista': 'Transportes SL',
            'nif_destinatario': 'B12345674', 'nombre_destinatario': 'Cliente SA',
            'matricula_tractor': '1234KLM', 'matricula_remolque': 'R5678BBC',
            'origen': 'Almería', 'destino': 'Valencia', 'fecha_hora_transporte': '2026-10-06T10:00:00',
            'naturaleza_mercancia': 'Aguacate', 'peso_kg': '14200.00', 'bultos': 1260,
        }
        with mock.patch(FALLO_PDF, side_effect=RuntimeError('reportlab roto')):
            r = self.cliente.post('/api/v1/deca/integracion/expediciones/', envio, format='json')

        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data['estado'], 'confirmado')
        self.assertTrue(any('no se ha podido generar el PDF' in a for a in r.data['avisos']))
        self.assertEqual(ExpedicionDeca.objects.get().estado, ExpedicionDeca.Estado.CONFIRMADO)
