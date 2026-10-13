"""Tres fallos pendientes de la auditoría del 2026-10-09 (ver
docs/calidad/auditoria-codigo/2026-10-09_deca_visitas.md):

1. Texto del usuario sin escapar en los PDF (un `<` o `&` en un nombre o en
   la búsqueda rompía `doc.build()`) y valores que empiezan por '=' que el
   Excel guardaba como fórmula.
2. `tipo_documento` de un documento subido no se validaba.
3. El listado de claves de integración hacía un COUNT por clave.
"""
import io

import openpyxl
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status

from django.contrib.auth import get_user_model
from django.utils import timezone
from reportlab.pdfgen import canvas
from rest_framework.test import APIClient, APITestCase

from .services import integracion_service

TEXTO_PELIGROSO = '<b>Tomates & Co <font'


class Base(APITestCase):
    """Base propia, sin tests. No hereda de tests.DecaAPITestCase porque esa
    clase tiene sus propios tests y se volverían a ejecutar en cada hija."""

    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = get_user_model().objects.create_user(username='admin@robustez.test', email='admin@robustez.test', password='Admin123!', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _pdf_con_texto(self, texto, nombre):
        buffer = io.BytesIO()
        c = canvas.Canvas(buffer)
        c.drawString(50, 750, texto)
        c.save()
        return SimpleUploadedFile(nombre, buffer.getvalue(), content_type='application/pdf')

    def _datos_expedicion_validos(self):
        return {
            'numero_albaran': 'A-000123', 'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL',
            'domicilio_cargador': 'Calle Mayor 1, 04001 Almería', 'nif_transportista': 'B12345674',
            'nombre_transportista': 'Transportes SL', 'nif_destinatario': 'B12345674',
            'nombre_destinatario': 'Cliente SA', 'matricula_tractor': '1234bbb', 'matricula_remolque': '5678ccc',
            'origen': 'Almería', 'destino': 'Barcelona', 'fecha_hora_transporte': timezone.now().isoformat(),
            'naturaleza_mercancia': 'Tomate', 'peso_kg': '12000.00', 'bultos': 500,
        }


class InformesConTextoRaroTests(Base):
    def setUp(self):
        super().setUp()
        datos = self._datos_expedicion_validos()
        datos.update({
            'nombre_cargador': TEXTO_PELIGROSO, 'nombre_destinatario': TEXTO_PELIGROSO,
            'naturaleza_mercancia': '=HYPERLINK("http://malo.example","clic")',
            'origen': TEXTO_PELIGROSO, 'destino': TEXTO_PELIGROSO,
        })
        r = self.client.post('/api/v1/deca/expediciones/', datos, format='json')
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.exp_id = r.data['id']

    def test_el_pdf_del_listado_se_genera_con_texto_raro_y_busqueda_rara(self):
        r = self.client.get('/api/v1/deca/expediciones/exportar-pdf/', {'q': '<i>&'})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(b''.join(r.streaming_content if r.streaming else [r.content]).startswith(b'%PDF'))

    def test_el_pdf_de_auditoria_se_genera_con_texto_raro(self):
        r = self.client.get(f'/api/v1/deca/expediciones/{self.exp_id}/auditoria/exportar-pdf/')
        self.assertEqual(r.status_code, 200)

    def test_en_el_excel_un_valor_con_igual_no_es_formula(self):
        r = self.client.get('/api/v1/deca/expediciones/exportar-excel/')
        self.assertEqual(r.status_code, 200)
        contenido = b''.join(r.streaming_content) if r.streaming else r.content
        hoja = openpyxl.load_workbook(io.BytesIO(contenido)).active
        celdas = [c for fila in hoja.iter_rows() for c in fila
                  if isinstance(c.value, str) and c.value.startswith('=HYPERLINK')]
        for c in celdas:
            self.assertEqual(c.data_type, 's', 'Un valor del usuario no puede guardarse como fórmula.')


class TipoDocumentoTests(Base):
    def test_tipo_de_documento_inventado_da_400_y_no_guarda_nada(self):
        exp_id = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json').data['id']
        r = self.client.post(
            f'/api/v1/deca/expediciones/{exp_id}/documentos/',
            {'tipo_documento': 'esto_no_es_un_tipo_valido_y_es_largo',
             'archivo': self._pdf_con_texto('Documento', 'doc.pdf')},
            format='multipart',
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('tipo_documento', r.data)

    def test_sin_tipo_se_guarda_como_otro(self):
        exp_id = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json').data['id']
        r = self.client.post(
            f'/api/v1/deca/expediciones/{exp_id}/documentos/',
            {'archivo': self._pdf_con_texto('Documento', 'doc.pdf')}, format='multipart',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)


class ClavesSinConsultaPorClaveTests(Base):
    def _consultas_del_listado(self):
        with CaptureQueriesContext(connection) as ctx:
            r = self.client.get('/api/v1/deca/integracion/claves/')
        self.assertEqual(r.status_code, 200)
        return len(ctx.captured_queries), r

    def test_el_numero_de_consultas_no_crece_con_las_claves(self):
        integracion_service.crear_clave('Clave 1')
        una, _ = self._consultas_del_listado()
        for i in range(2, 6):
            integracion_service.crear_clave(f'Clave {i}')
        cinco, r = self._consultas_del_listado()
        self.assertEqual(una, cinco)
        self.assertTrue(all(c['expediciones_recibidas'] == 0 for c in r.data))
