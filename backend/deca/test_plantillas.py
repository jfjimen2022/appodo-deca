"""Modelos de documento por empresa (v4.28.0): reconocer el modelo, pasar sus
pistas a la IA, rellenar sus valores fijos y marcar lo dudoso. Diseñado sobre
cuatro documentos reales de un cliente (2026-09-27): albarán PDF
con texto, CMR escaneado y dos fotos."""
from unittest.mock import patch

from rest_framework import status


from .models import DocumentoOrigenDeca, PlantillaDocumentoDeca
from .tests import DecaAPITestCase


class PlantillasDocumentoDecaTests(DecaAPITestCase):

    def _crear_plantilla(self, **extra):
        datos = {
            'nombre': 'Albarán Frutas del Sur', 'tipo_documento': 'albaran_venta',
            'texto_identificativo': 'B12345674, albaran', 'instrucciones': 'El peso es el de la fila Suma.',
            'valores_fijos': {'nombre_cargador': 'FRUTAS DEL SUR SAT', 'domicilio_cargador': 'Calle Mayor 1, 04001 Almería', 'origen': 'Vejer de la Frontera'},
        }
        datos.update(extra)
        return PlantillaDocumentoDeca.objects.create(**datos)

    def _subir(self, archivo):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        return self.client.post(
            f'/api/v1/deca/expediciones/{crear.data["id"]}/documentos/?extraer=true',
            {'tipo_documento': 'otro', 'archivo': archivo}, format='multipart',
        )

    def test_crud_valida_claves_y_nif(self):
        base = {'nombre': 'Ticket báscula', 'tipo_documento': 'otro'}
        ok = self.client.post('/api/v1/deca/plantillas/', {
            **base, 'valores_fijos': {'nif_destinatario': 'b12345674', 'origen': 'Secadero'},
        }, format='json')
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)
        self.assertEqual(ok.data['valores_fijos']['nif_destinatario'], 'B12345674')

        clave_prohibida = self.client.post('/api/v1/deca/plantillas/', {
            **base, 'valores_fijos': {'peso_kg': '100'},
        }, format='json')
        self.assertEqual(clave_prohibida.status_code, status.HTTP_400_BAD_REQUEST)

        nif_malo = self.client.post('/api/v1/deca/plantillas/', {
            **base, 'valores_fijos': {'nif_cargador': 'B12345678'},
        }, format='json')
        self.assertEqual(nif_malo.status_code, status.HTTP_400_BAD_REQUEST)

        demasiado_largo = self.client.post('/api/v1/deca/plantillas/', {
            **base, 'instrucciones': 'x' * 1501,
        }, format='json')
        self.assertEqual(demasiado_largo.status_code, status.HTTP_400_BAD_REQUEST)

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_documento_con_texto_reconoce_el_modelo_y_aplica_sus_fijos(self, mock_texto, mock_vision):
        plantilla = self._crear_plantilla()
        self._crear_plantilla(nombre='Otro modelo', texto_identificativo='NO APARECE')
        mock_texto.return_value = '{"nombre_cargador": "Frutas del Sur mal leido", "peso_kg": 116969.0}'

        subir = self._subir(self._pdf_con_texto('ALBARAN DE VENTA C.I.F. B12345674 ' * 6, 'alb.pdf'))

        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        prompt = mock_texto.call_args[0][0]
        self.assertIn('El peso es el de la fila Suma.', prompt)
        self.assertNotIn('Otro modelo', prompt)
        mock_vision.assert_not_called()
        self.assertEqual(subir.data['plantilla_aplicada'], 'Albarán Frutas del Sur')
        self.assertEqual(subir.data['campos_sugeridos_ia']['nombre_cargador'], 'FRUTAS DEL SUR SAT')
        self.assertEqual(subir.data['campos_sugeridos_ia']['origen'], 'Vejer de la Frontera')
        plantilla.refresh_from_db()
        self.assertEqual(plantilla.veces_aplicada, 1)

    @patch('deca.services.extraction_ia_service.call_vision_api')
    def test_foto_la_ia_elige_el_modelo_del_catalogo_y_marca_lo_dudoso(self, mock_vision):
        self._crear_plantilla(nombre='Hoja Cooperativa', texto_identificativo='', valores_fijos={'destino': 'Xeresa'})
        mock_vision.return_value = (
            '{"nombre_conductor": "Rafael", "nif_conductor": "Y1234567X", "modelo_reconocido": 1, '
            '"campos_dudosos": ["nombre_conductor", "destino", "peso_kg", "inventado"]}'
        )

        subir = self._subir(self._pdf_sin_texto('foto.pdf'))

        prompt = mock_vision.call_args[0][2]
        self.assertIn('[1]', prompt)
        self.assertIn('Hoja Cooperativa', prompt)
        self.assertIn('Casilla 16', prompt)  # guía de CMR de serie
        self.assertEqual(subir.data['plantilla_aplicada'], 'Hoja Cooperativa')
        self.assertEqual(subir.data['campos_sugeridos_ia']['destino'], 'Xeresa')
        # Solo campos devueltos y no fijados por el modelo.
        self.assertEqual(subir.data['campos_dudosos'], ['nombre_conductor'])

    @patch('deca.services.extraction_ia_service.call_vision_api')
    def test_numero_de_modelo_invalido_no_aplica_nada(self, mock_vision):
        self._crear_plantilla(texto_identificativo='')
        for valor in ('7', '"abc"', 'null', '0'):
            mock_vision.return_value = '{"bultos": 3, "modelo_reconocido": %s}' % valor
            subir = self._subir(self._pdf_sin_texto('foto.pdf'))
            self.assertIsNone(subir.data['plantilla_aplicada'], valor)
            self.assertNotIn('origen', subir.data['campos_sugeridos_ia'])

    @patch('deca.services.extraction_ia_service.call_vision_api')
    def test_sin_modelos_el_prompt_no_lleva_catalogo(self, mock_vision):
        mock_vision.return_value = '{"bultos": 3}'
        subir = self._subir(self._pdf_sin_texto('foto.pdf'))
        self.assertNotIn('modelo_reconocido', mock_vision.call_args[0][2])
        self.assertIsNone(subir.data['plantilla_aplicada'])
        self.assertEqual(subir.data['campos_dudosos'], [])

    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_instrucciones_con_llaves_no_rompen_el_prompt(self, mock_texto):
        self._crear_plantilla(instrucciones='Formato {raro} con {llaves}')
        mock_texto.return_value = '{"bultos": 3}'
        subir = self._subir(self._pdf_con_texto('ALBARAN DE VENTA C.I.F. B12345674 ' * 6, 'alb.pdf'))
        self.assertIn('Formato {raro} con {llaves}', mock_texto.call_args[0][0])
        self.assertEqual(subir.data['plantilla_aplicada'], 'Albarán Frutas del Sur')

    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_analizar_ejemplo_no_guarda_nada(self, mock_texto):
        plantilla = self._crear_plantilla()
        mock_texto.return_value = '{"nombre_cargador": "FRUTAS DEL SUR SAT", "origen": "Vejer"}'
        respuesta = self.client.post(
            '/api/v1/deca/plantillas/analizar/',
            {'archivo': self._pdf_con_texto('ALBARAN C.I.F. B12345674 ' * 10, 'ejemplo.pdf')},
            format='multipart',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
        self.assertEqual(respuesta.data['texto_identificativo_sugerido'], 'B12345674')
        self.assertTrue(respuesta.data['tiene_texto'])
        self.assertIn('nombre_cargador', respuesta.data['campos_fijables'])
        self.assertEqual(DocumentoOrigenDeca.objects.count(), 0)
        plantilla.refresh_from_db()
        self.assertEqual(plantilla.veces_aplicada, 0)
