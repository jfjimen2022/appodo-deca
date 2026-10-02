"""La lectura que aprende (fase 1, 2026-09-28): registro de lecturas,
sinónimos aprendidos al corregir, candidatos cerrados para lo manuscrito y
matrículas con letras confundidas. Ver services/aprendizaje_service.py."""
import io
import json
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework import status


from .models import (
    AliasAgendaDeca, EmpresaTransportistaDeca, ExpedicionDeca, LecturaCampoDeca, PlantillaDocumentoDeca,
    TractoraDeca,
)
from .services import aprendizaje_service
from .tests import DecaAPITestCase

ROMERO = 'Transportes Romero Ruiz S.L.'
NIF_ROMERO = 'A91000000'


class AprendizajeLecturaDecaTests(DecaAPITestCase):

    def _crear(self, **extra):
        crear = self.client.post('/api/v1/deca/expediciones/', {**self._datos_expedicion_validos(), **extra})
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        return crear.data['id']

    def _subir(self, expedicion_id):
        return self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_con_texto('CARTA DE PORTE CMR INTERNACIONAL ' * 8, 'cmr.pdf')},
            format='multipart',
        )

    def _corregir_y_generar(self, expedicion_id):
        patch_ = self.client.patch(f'/api/v1/deca/expediciones/{expedicion_id}/', {
            'nombre_transportista': ROMERO, 'nif_transportista': NIF_ROMERO, 'matricula_tractor': '4821LKP',
        }, format='json')
        self.assertEqual(patch_.status_code, status.HTTP_200_OK, patch_.data)
        self.assertEqual(self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/').status_code, 200)
        generar = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')
        self.assertEqual(generar.status_code, status.HTTP_200_OK, generar.data)

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_ciclo_completo_leer_corregir_aprender_y_reconocer(self, mock_texto, mock_vision):
        """Lo que la persona corrige una vez se reconoce la siguiente (para
        revisar); tras dos confirmaciones, directamente."""
        mock_texto.return_value = json.dumps({
            'nombre_transportista': 'TTES. ROMERO', 'matricula_tractor': '4B21LKP',
            'campos_dudosos': ['nombre_transportista', 'matricula_tractor'],
        })

        # 1) Primera vez: se registra lo leído y la matrícula se repara.
        primera = self._crear()
        subir = self._subir(primera)
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        self.assertNotIn('_registro', subir.data)  # nunca llega al navegador
        self.assertEqual(subir.data['campos_sugeridos_ia']['matricula_tractor'], '4821LKP')
        self.assertIn('matricula_tractor', subir.data['campos_a_revisar'])
        lectura = LecturaCampoDeca.objects.get(expedicion_id=primera, campo='nombre_transportista')
        self.assertEqual(lectura.valor_leido, 'TTES. ROMERO')
        self.assertTrue(lectura.dudoso)
        self.assertIsNone(lectura.corregido)

        # 2) La persona corrige y genera: se resuelve y se aprende.
        self._corregir_y_generar(primera)
        lectura.refresh_from_db()
        self.assertTrue(lectura.corregido)
        self.assertEqual(lectura.valor_final, ROMERO)
        alias = AliasAgendaDeca.objects.get(rol='transportista')
        self.assertEqual((alias.nombre, alias.nif, alias.veces_confirmado), (ROMERO, NIF_ROMERO, 1))
        self.assertTrue(AliasAgendaDeca.objects.filter(rol='tractora', nombre='4821LKP').exists())

        # 3) Segunda vez: se reconoce, pero todavía para revisar.
        segunda = self._crear()
        subir = self._subir(segunda)
        ia = subir.data['campos_sugeridos_ia']
        self.assertEqual((ia['nombre_transportista'], ia['nif_transportista']), (ROMERO, NIF_ROMERO))
        self.assertIn('nombre_transportista', subir.data['campos_a_revisar'])
        self._corregir_y_generar(segunda)
        alias.refresh_from_db()
        self.assertEqual(alias.veces_confirmado, 2)

        # 4) Con dos confirmaciones ya es fiable: directo, sin revisar.
        subir = self._subir(self._crear())
        self.assertEqual(subir.data['campos_sugeridos_ia']['nombre_transportista'], ROMERO)
        self.assertNotIn('nombre_transportista', subir.data['campos_a_revisar'])

    def test_no_aprende_cuando_la_persona_elige_otra_empresa(self):
        """Si la IA leyó bien "Distrinorte" pero el cargador era otro, eso no es
        un sinónimo: aprenderlo enseñaría a equivocarse."""
        expedicion = ExpedicionDeca(nombre_transportista='Primaflor S.A.', nif_transportista=NIF_ROMERO)
        self.assertFalse(aprendizaje_service._aprender_sinonimo(expedicion, 'transportista', 'DISTRINORTE', None))
        self.assertFalse(AliasAgendaDeca.objects.exists())

    def test_sinonimo_no_pisa_un_nif_distinto_leido_por_la_ia(self):
        AliasAgendaDeca.objects.create(
            rol='transportista', texto='TTES ROMERO', nombre=ROMERO, nif=NIF_ROMERO,
            veces_confirmado=5,
        )
        cambios, revisar, _ = aprendizaje_service.aplicar_sinonimos(
            self.empresa, {'nombre_transportista': 'Ttes Romero', 'nif_transportista': 'B12345674'},
        )
        self.assertEqual(cambios, {})
        cambios, revisar, _ = aprendizaje_service.aplicar_sinonimos(self.empresa, {'nombre_transportista': 'Ttes. Romero'})
        self.assertEqual(cambios['nif_transportista'], NIF_ROMERO)
        self.assertEqual(revisar, [])  # 5 confirmaciones: fiable

    def test_se_puede_olvidar_un_sinonimo(self):
        propio = AliasAgendaDeca.objects.create(
            rol='conductor', texto='J PEREZ', nombre='Juan Pérez', nif='12345678Z',
        )
        listado = self.client.get('/api/v1/deca/sinonimos/?rol=conductor')
        self.assertEqual(listado.data['count'], 1)
        self.assertFalse(listado.data['results'][0]['fiable'])
        self.assertEqual(self.client.delete(f'/api/v1/deca/sinonimos/{propio.id}/').status_code, 204)

    def test_matriculas_con_letras_confundidas(self):
        TractoraDeca.objects.create(matricula='4821LKP')
        # Contra la Agenda: solo difiere en caracteres confundibles.
        cambios, revisar, _ = aprendizaje_service.corregir_matriculas(self.empresa, {'matricula_tractor': '482I-LKP'})
        self.assertEqual(cambios['matricula_tractor'], '4821LKP')
        self.assertEqual(revisar, ['matricula_tractor'])
        # Sin nada parecido en la Agenda: se repara solo el formato.
        cambios, _, _ = aprendizaje_service.corregir_matriculas(self.empresa, {'matricula_tractor': '5O38LZN'})
        self.assertEqual(cambios['matricula_tractor'], '5038LZN')
        # Una matrícula válida y desconocida se deja tal cual: no se inventa.
        cambios, _, _ = aprendizaje_service.corregir_matriculas(self.empresa, {'matricula_tractor': '9999ZZZ'})
        self.assertEqual(cambios, {})

    def _plantilla(self, **extra):
        return PlantillaDocumentoDeca.objects.create(
            nombre='Albarán Frutas del Sur', texto_identificativo='ALBARAN FRUTAS DEL SUR', **extra,
        )

    def _generada(self, plantilla, **campos):
        expedicion = ExpedicionDeca.objects.create(
            anio=2026, mes=9, estado=ExpedicionDeca.Estado.GENERADO,
            fecha_generacion=timezone.now(), **campos,
        )
        LecturaCampoDeca.objects.create(
            expedicion=expedicion, plantilla=plantilla, campo='bultos', valor_leido='3',
        )
        return expedicion

    def _lectura(self, campo, leido, final, corregido=True, plantilla=None, dudoso=False, empresa=None):
        expedicion = ExpedicionDeca.objects.create(anio=2026, mes=9)
        return LecturaCampoDeca.objects.create(
            expedicion=expedicion, plantilla=plantilla, campo=campo,
            valor_leido=leido, valor_propuesto=leido, valor_final=final, corregido=corregido, dudoso=dudoso,
            fecha_resolucion=timezone.now(),
        )

    def test_propone_valores_fijos_solo_con_suficientes_repeticiones(self):
        plantilla = self._plantilla(valores_fijos={'nombre_cargador': 'Frutas del Sur'})
        for _ in range(4):
            self._generada(plantilla, origen='Vejer', nombre_cargador='Frutas del Sur', destino='Madrid')
        self.assertEqual(aprendizaje_service.sugerencias_valores_fijos(plantilla), [])

        self._generada(plantilla, origen='Vejer', nombre_cargador='Frutas del Sur', destino='Sevilla')
        sugerencias = aprendizaje_service.sugerencias_valores_fijos(plantilla)
        # Origen se repite 5/5; destino cambia; el cargador ya es valor fijo.
        self.assertEqual(sugerencias, [{'campo': 'origen', 'valor': 'Vejer', 'veces': 5}])
        datos = self.client.get(f'/api/v1/deca/plantillas/{plantilla.id}/').data
        self.assertEqual(datos['sugerencias_valores_fijos'][0]['campo'], 'origen')

    def test_precision_de_lectura(self):
        self._lectura('origen', 'Vejer', 'Vejer', corregido=False)
        self._lectura('origen', 'Vejr', 'Vejer')
        self._lectura('nombre_conductor', 'J Perez', 'Juan Pérez', dudoso=True)
        self._lectura('nombre_conductor', 'Ana Ruiz', 'Ana Ruiz', corregido=False, dudoso=True)

        datos = self.client.get('/api/v1/deca/precision-lectura/?dias=30').data
        self.assertEqual((datos['total'], datos['porcentaje']), (4, 50.0))
        self.assertEqual(datos['manuscritas'], {'total': 2, 'porcentaje': 50.0})
        origen = next(c for c in datos['por_campo'] if c['campo'] == 'origen')
        self.assertEqual((origen['total'], origen['corregidas']), (2, 1))
        self.assertEqual(self.client.get('/api/v1/deca/precision-lectura/?dias=abc').status_code, 400)

    # ── Fase 3 ──────────────────────────────────────────────────────────────

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_foto_devuelve_donde_esta_escrito_lo_dudoso(self, mock_texto, mock_vision):
        """Para enseñar el trozo de foto junto a "¿Es este?": solo rectángulos
        válidos y solo de campos dudosos."""
        mock_vision.return_value = json.dumps({
            'nombre_conductor': 'J Perez', 'origen': 'Vejer', 'bultos': 24,
            'campos_dudosos': ['nombre_conductor', 'origen'],
            'zonas': {
                'nombre_conductor': [612, 80, 660, 410],
                'origen': [900, 10, 850, 20],        # ymin > ymax: se descarta
                'bultos': [100, 100, 200, 200],      # no es dudoso: se descarta
            },
        })
        foto = io.BytesIO()
        Image.new('RGB', (120, 80), 'white').save(foto, format='JPEG')
        subir = self.client.post(
            f'/api/v1/deca/expediciones/{self._crear()}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': SimpleUploadedFile('cmr.jpg', foto.getvalue())},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        self.assertEqual(subir.data['zonas'], {'nombre_conductor': [612, 80, 660, 410]})
        self.assertIn('"zonas"', mock_vision.call_args[0][2])  # se le pide a la IA

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_pdf_escaneado_no_devuelve_zonas(self, mock_texto, mock_vision):
        """De un PDF el navegador no tiene la imagen para recortar."""
        mock_vision.return_value = json.dumps({
            'origen': 'Vejer', 'campos_dudosos': ['origen'], 'zonas': {'origen': [10, 10, 50, 50]},
        })
        subir = self.client.post(
            f'/api/v1/deca/expediciones/{self._crear()}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_sin_texto('cmr.pdf')}, format='multipart',
        )
        self.assertEqual(subir.data['zonas'], {})

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_la_ia_no_supone_que_el_remitente_es_el_cargador(self, mock_texto, mock_vision):
        """El cargador del DeCA es quien CONTRATA el transporte (Distrinorte
        mandando su camión a Frutas del Sur), no el remitente de la casilla 1."""
        mock_texto.return_value = '{"bultos": 3}'
        self._subir(self._crear())
        prompt = mock_texto.call_args[0][0]
        self.assertIn('CARGADOR CONTRACTUAL', prompt)
        self.assertNotIn('-> nombre_cargador y nif_cargador', prompt)
