"""Paginación del listado de Expediciones (2026-10-06): el selector de filas
del pie (20/50/100) no llegaba al servidor, que paginaba siempre de 50 en 50."""

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient, APITestCase

from .models import ExpedicionDeca
from .test_integracion import _empresa_con_deca

User = get_user_model()
URL = '/api/v1/deca/expediciones/'


class PaginacionExpedicionesTests(APITestCase):
    def setUp(self):
        self.empresa = _empresa_con_deca('Paginada')
        admin = User.objects.create_user(username='admin@paginada.test', email='admin@paginada.test', password='Admin123!', is_staff=True)
        self.cliente = APIClient()
        self.cliente.force_authenticate(user=admin)
        ExpedicionDeca.objects.bulk_create([
            ExpedicionDeca(anio=2026, mes=10, numero_albaran=f'A-{i:03}') for i in range(65)
        ])

    def test_las_paginas_de_la_pantalla_cuadran_con_las_del_servidor(self):
        vistos = []
        for pagina in (1, 2, 3, 4):
            respuesta = self.cliente.get(URL, {'page': pagina, 'page_size': 20})
            self.assertEqual(respuesta.status_code, 200, pagina)
            self.assertEqual(respuesta.data['count'], 65)
            vistos += [e['numero_albaran'] for e in respuesta.data['results']]
        self.assertEqual(len(vistos), 65)
        self.assertEqual(len(set(vistos)), 65)

    def test_respeta_las_filas_elegidas_y_tiene_tope(self):
        self.assertEqual(len(self.cliente.get(URL, {'page_size': 50}).data['results']), 50)
        self.assertEqual(len(self.cliente.get(URL).data['results']), 20)
        self.assertEqual(self.cliente.get(URL, {'page_size': 1000}).data['count'], 65)
        self.assertEqual(len(self.cliente.get(URL, {'page_size': 1000}).data['results']), 65)
