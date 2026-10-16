"""Datos SIGPAC de la parcela de origen (polígono, parcela, recinto): se guardan,
salen en el PDF oficial solo si hay alguno y quedan en el historial al corregir."""
import io

from django.contrib.auth import get_user_model
from django.utils import timezone
from pypdf import PdfReader
from rest_framework import status
from rest_framework.test import APIClient, APITestCase


from .models import ExpedicionDeca

User = get_user_model()


class SigpacDecaTests(APITestCase):
    def setUp(self):
        usuario = User.objects.create_user(username='admin@sigpac.test', email='admin@sigpac.test',
                                           password='Admin123!', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=usuario)

    def _datos(self, **extra):
        return {
            'numero_albaran': 'A-1', 'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL',
            'domicilio_cargador': 'Calle Mayor 1, 04001 Almería', 'nif_transportista': 'B12345674',
            'nombre_transportista': 'Transportes SL', 'nif_destinatario': 'B12345674', 'nombre_destinatario': 'Cliente SA',
            'matricula_tractor': '1234bbb', 'matricula_remolque': '5678ccc', 'origen': 'Almería', 'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(), 'naturaleza_mercancia': 'Tomate',
            'peso_kg': '12000.00', 'bultos': 500, **extra,
        }

    def _generar_y_leer_pdf(self, datos):
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        exp_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{exp_id}/confirmar/')
        generar = self.client.post(f'/api/v1/deca/expediciones/{exp_id}/generar/')
        self.assertEqual(generar.status_code, status.HTTP_200_OK, generar.data)
        exp = ExpedicionDeca.objects.get(id=exp_id)
        texto = ' '.join(p.extract_text() for p in PdfReader(io.BytesIO(exp.pdf_generado.read())).pages)
        return exp, texto

    def test_se_guarda_y_sale_en_el_pdf(self):
        exp, texto = self._generar_y_leer_pdf(self._datos(sigpac_poligono='12', sigpac_parcela='0345', sigpac_recinto='2'))
        self.assertEqual((exp.sigpac_poligono, exp.sigpac_parcela, exp.sigpac_recinto), ('12', '0345', '2'))
        self.assertIn('SIGPAC', texto)
        self.assertIn('12 / 0345 / 2', texto)

    def test_en_blanco_no_sale_en_el_pdf(self):
        _exp, texto = self._generar_y_leer_pdf(self._datos())
        self.assertNotIn('SIGPAC', texto)

    def test_uno_solo_relleno_marca_los_demas_con_raya(self):
        _exp, texto = self._generar_y_leer_pdf(self._datos(sigpac_parcela='77'))
        self.assertIn('— / 77 / —', texto)
