"""Filtro «Hechas por mí» del listado (?creado_por=yo) y su reflejo en la exportación."""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from .models import EventoExpedicionDeca, ExpedicionDeca
from .reportes import resumen_filtros_legible_expediciones

User = get_user_model()


class FiltroMiasTests(APITestCase):
    def setUp(self):
        self.yo = User.objects.create_user(username='yo', email='yo@filtros.test', password='Admin123!',
                                           first_name='Ana', last_name='López')
        otro = User.objects.create_user(username='otro', email='otro@filtros.test', password='Admin123!')
        self.client = APIClient()
        for usuario, albaran in ((self.yo, 'MIA-1'), (otro, 'OTRA-1'), (self.yo, 'ERP-1')):
            self.client.force_authenticate(user=usuario)
            resp = self.client.post('/api/v1/deca/expediciones/', {
                'numero_albaran': albaran, 'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL',
                'origen': 'Almería', 'destino': 'Barcelona', 'fecha_hora_transporte': timezone.now().isoformat(),
            })
            self.assertEqual(resp.status_code, 201, resp.data)
        # Lo recibido por la integración no lo crea ninguna persona.
        ExpedicionDeca.objects.filter(numero_albaran='ERP-1').update(creado_por=None)
        self.client.force_authenticate(user=self.yo)

    def _albaranes(self, **params):
        resp = self.client.get('/api/v1/deca/expediciones/', params)
        self.assertEqual(resp.status_code, 200, resp.data)
        datos = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        return sorted(e['numero_albaran'] for e in datos)

    def test_solo_las_mias(self):
        self.assertEqual(self._albaranes(creado_por='yo'), ['MIA-1'])

    def test_la_del_erp_es_de_quien_la_genera(self):
        # Llega del ERP sin creado_por y la genera alguien de logística.
        erp = ExpedicionDeca.objects.get(numero_albaran='ERP-1')
        EventoExpedicionDeca.objects.create(
            expedicion=erp, usuario=self.yo, tipo_evento=EventoExpedicionDeca.TipoEvento.GENERADA)
        # Editarla sin generarla no la hace tuya.
        otra = ExpedicionDeca.objects.get(numero_albaran='OTRA-1')
        EventoExpedicionDeca.objects.create(
            expedicion=otra, usuario=self.yo, tipo_evento=EventoExpedicionDeca.TipoEvento.EDITADA)
        self.assertEqual(self._albaranes(creado_por='yo'), ['ERP-1', 'MIA-1'])

    def test_sin_filtro_salen_todas(self):
        self.assertEqual(self._albaranes(), ['ERP-1', 'MIA-1', 'OTRA-1'])

    def test_columna_usuario_en_las_del_erp(self):
        # Sin generar: no hay usuario. Generada: el usuario es quien la generó.
        erp = ExpedicionDeca.objects.get(numero_albaran='ERP-1')
        fila = lambda: next(e for e in self.client.get('/api/v1/deca/expediciones/').data['results']
                            if e['numero_albaran'] == 'ERP-1')
        self.assertIsNone(fila()['generado_por'])
        EventoExpedicionDeca.objects.create(
            expedicion=erp, usuario=self.yo, tipo_evento=EventoExpedicionDeca.TipoEvento.GENERADA)
        self.assertEqual(fila()['generado_por'], 'Ana López')
        self.assertEqual(self.client.get(f'/api/v1/deca/expediciones/{erp.id}/').data['generado_por'],
                         'Ana López')

    def test_cabecera_del_informe(self):
        self.assertIn('Hechas por mí', resumen_filtros_legible_expediciones({'creado_por': 'yo'}))
