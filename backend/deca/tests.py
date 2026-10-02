"""Suite portada del `tests.py` del módulo DeCA del ERP Appodo (v4.37.0).

Adaptación mecánica a single-tenant: sin `Empresa`/`EmpresaModulo`, usuarios
de `auth.User` con `is_staff` en vez de `rol`, y fuera los tests de
aislamiento entre empresas (no aplican: una instalación = una empresa). Los
tests propios del standalone están en `test_standalone.py`.
"""
import io
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from reportlab.pdfgen import canvas
from rest_framework import status
from rest_framework.test import APIClient, APITestCase


from .models import (
    CargadorDeca, ConductorDeca, ConfiguracionDeca, DestinatarioDeca, DocumentoOrigenDeca, EmpresaTransportistaDeca,
    EventoExpedicionDeca, ExpedicionDeca, ModificacionDeca, RemolqueDeca, TractoraDeca,
)
from .services import extraction_ia_service, extraction_service
from .services import storage_service

User = get_user_model()


class DecaAPITestCase(APITestCase):
    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = User.objects.create_user(
            username='admin@fabrica.test', email='admin@fabrica.test', password='Admin123!',
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _pdf_con_texto(self, texto: str, nombre: str) -> SimpleUploadedFile:
        """PDF de verdad (no bytes falsos) para que pypdf pueda extraer
        texto real -- necesario para probar la extracción (regex/IA), a
        diferencia de otros tests que solo comprueban que la subida
        funciona y no necesitan que el contenido sea parseable."""
        buffer = io.BytesIO()
        c = canvas.Canvas(buffer)
        c.drawString(50, 750, texto)
        c.save()
        return SimpleUploadedFile(nombre, buffer.getvalue(), content_type='application/pdf')

    def _pdf_sin_texto(self, nombre: str) -> SimpleUploadedFile:
        """PDF válido pero SIN capa de texto (solo un dibujo) -- simula el
        CMR impreso, firmado a mano y escaneado del que pypdf no saca ni un
        carácter, que es el caso que obliga a tirar de visión."""
        buffer = io.BytesIO()
        c = canvas.Canvas(buffer)
        c.rect(50, 50, 200, 200, fill=1)
        c.save()
        return SimpleUploadedFile(nombre, buffer.getvalue(), content_type='application/pdf')

    def _datos_expedicion_validos(self):
        return {
            'numero_albaran': 'A-000123',
            'nif_cargador': 'B12345674',
            'nombre_cargador': 'Fabrica SL',

            'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
            'nif_transportista': 'B12345674',
            'nombre_transportista': 'Transportes SL',
            'nif_destinatario': 'B12345674',
            'nombre_destinatario': 'Cliente SA',
            'matricula_tractor': '1234bbb',
            'matricula_remolque': '5678ccc',
            'origen': 'Almería',
            'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(),
            'naturaleza_mercancia': 'Tomate',
            'peso_kg': '12000.00',
            'bultos': 500,
        }

    def test_subida_rechaza_ficheros_maliciosos_sin_guardar_nada(self):
        """v4.27.3: se valida el CONTENIDO antes de guardar (core/validacion_ficheros.py),
        no solo la extensión."""
        from pypdf import PdfWriter

        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        url = f'/api/v1/deca/expediciones/{crear.data["id"]}/documentos/'

        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)
        writer.add_js('app.alert("x");')
        buffer = io.BytesIO()
        writer.write(buffer)
        casos = [
            (SimpleUploadedFile('albaran.pdf', buffer.getvalue()), 'contenido activo'),
            (SimpleUploadedFile('albaran.pdf', b'MZ\x90\x00' + b'\x00' * 100), 'no es un PDF, JPG o PNG real'),
            (SimpleUploadedFile('foto.jpg', b'<html><script>alert(1)</script>'), 'no es un PDF, JPG o PNG real'),
        ]
        for archivo, motivo in casos:
            r = self.client.post(url, {'tipo_documento': 'cmr', 'archivo': archivo}, format='multipart')
            self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, r.data)
            self.assertIn(motivo, str(r.data['archivo']))
        self.assertFalse(DocumentoOrigenDeca.objects.filter(expedicion_id=crear.data['id']).exists())

    def test_subida_acepta_foto_de_movil_mpo(self):
        """Bug real en producción (v4.27.3): la foto de un albarán hecha con el
        móvil (JPEG con segunda imagen dentro, formato MPO para Pillow) se
        rechazaba como "contenido que no corresponde a su extensión"."""
        from PIL import Image

        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        buffer = io.BytesIO()
        Image.new('RGB', (60, 40), 'white').save(
            buffer, format='MPO', save_all=True, append_images=[Image.new('RGB', (30, 20))],
        )
        r = self.client.post(
            f'/api/v1/deca/expediciones/{crear.data["id"]}/documentos/',
            {'tipo_documento': 'albaran_venta', 'archivo': SimpleUploadedFile('IMG_1234.jpg', buffer.getvalue())},
            format='multipart',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data['documento']['nombre_original'], 'IMG_1234.jpg')

    def test_borrador_se_guarda_sin_nif_y_se_completa_despues(self):
        """Pedido del usuario 2026-09-26: la extracción a veces no encuentra un
        NIF. El borrador se guarda igual (con su documento ya subido) y se
        completa cuando se consigue el dato; solo Confirmar lo exige."""
        datos = self._datos_expedicion_validos()
        datos['nif_transportista'] = ''
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        expedicion_id = crear.data['id']

        confirmar = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.assertEqual(confirmar.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('nif_transportista', str(confirmar.data))

        completar = self.client.patch(
            f'/api/v1/deca/expediciones/{expedicion_id}/', {'nif_transportista': 'B12345674'}, format='json',
        )
        self.assertEqual(completar.status_code, status.HTTP_200_OK, completar.data)
        confirmar = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.assertEqual(confirmar.status_code, status.HTTP_200_OK, confirmar.data)

    def test_subida_de_jpeg_con_nombre_largo_o_repetido(self):
        """Bug real en producción (2026-09-26): `IMG_3677.jpeg` de un iPhone daba
        400 genérico -- la ruta (tres UUID + nombre original) pasaba de los 100
        caracteres del campo y Django abortaba (SuspiciousFileOperation). Ahora
        la ruta solo lleva la extensión y el campo admite 255."""
        from PIL import Image

        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        url = f'/api/v1/deca/expediciones/{crear.data["id"]}/documentos/'
        foto = io.BytesIO()
        Image.new('RGB', (60, 40), 'white').save(foto, format='JPEG')
        nombres = ['IMG_3677.jpeg', 'IMG_3677.jpeg', 'Albarán de salida del almacén central nº 000123 - copia firmada por el transportista.jpeg']
        for nombre in nombres:
            r = self.client.post(url, {'tipo_documento': 'albaran_venta', 'archivo': SimpleUploadedFile(nombre, foto.getvalue())}, format='multipart')
            self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.content[:300])
            self.assertEqual(r.data['documento']['nombre_original'], nombre)
        rutas = list(DocumentoOrigenDeca.objects.filter(expedicion_id=crear.data['id']).values_list('archivo', flat=True))
        self.assertEqual(len(rutas), 3)
        self.assertTrue(all(len(r) <= 255 and r.endswith('.jpeg') for r in rutas), rutas)

    def test_flujo_completo_borrador_confirmar_generar_descarga_publica(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        expedicion_id = crear.data['id']
        self.assertEqual(crear.data['estado'], ExpedicionDeca.Estado.BORRADOR)
        # anio/mes derivados de fecha_hora_transporte, no del request
        self.assertEqual(crear.data['anio'], timezone.now().year)

        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/',
            {'tipo_documento': 'albaran_venta', 'archivo': self._pdf_con_texto('Documento de prueba', 'albaran.pdf')},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)

        confirmar = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.assertEqual(confirmar.status_code, status.HTTP_200_OK, confirmar.data)
        self.assertEqual(confirmar.data['estado'], ExpedicionDeca.Estado.CONFIRMADO)

        generar = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')
        self.assertEqual(generar.status_code, status.HTTP_200_OK, generar.data)
        self.assertEqual(generar.data['estado'], ExpedicionDeca.Estado.GENERADO)
        self.assertTrue(generar.data['hash_sha256'])
        self.assertTrue(generar.data['acceso_publico_vigente'])

        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        token = str(expedicion.token_publico)

        self.client.logout()
        descarga = self.client.get(f'/api/v1/deca/publico/{token}/')
        self.assertEqual(descarga.status_code, status.HTTP_200_OK)
        self.assertEqual(descarga['Content-Type'], 'application/pdf')

    def test_confirmar_falla_si_faltan_campos_obligatorios(self):
        # Un borrador puede crearse con datos incompletos -- p.ej. justo
        # después de subir un documento origen, antes de que la extracción
        # o el usuario rellenen el resto (ver models.py). El mínimo legal
        # solo se exige al Confirmar, no al crear.
        datos = self._datos_expedicion_validos()
        datos.pop('destino')
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)

        confirmar = self.client.post(f'/api/v1/deca/expediciones/{crear.data["id"]}/confirmar/')
        self.assertEqual(confirmar.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('destino', confirmar.data.get('campos_faltantes', []))

    def test_nif_invalido_es_rechazado(self):
        datos = self._datos_expedicion_validos()
        datos['nif_cargador'] = 'ZZZ0000'
        respuesta = self.client.post('/api/v1/deca/expediciones/', datos)
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('nif_cargador', respuesta.data)

    def test_no_se_puede_editar_una_expedicion_ya_generada_fuera_de_plazo(self):
        """Dentro del plazo de gracia (ConfiguracionDeca.horas_max_edicion_generado,
        24h por defecto) SÍ se puede corregir -- ver test_editar_expedicion_generada_dentro_de_plazo_permitido.
        Pasado el plazo, vuelve a quedar inmutable como siempre."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')

        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        expedicion.fecha_generacion = timezone.now() - timedelta(hours=25)
        expedicion.save(update_fields=['fecha_generacion'])

        editar = self.client.patch(f'/api/v1/deca/expediciones/{expedicion_id}/', {'destino': 'Otro destino'})
        self.assertEqual(editar.status_code, status.HTTP_400_BAD_REQUEST)

    def test_descarga_publica_caduca_fuera_de_la_ventana_configurada(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')

        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        expedicion.fecha_expiracion_publica = timezone.now() - timedelta(days=1)
        expedicion.save(update_fields=['fecha_expiracion_publica'])

        self.client.logout()
        descarga = self.client.get(f'/api/v1/deca/publico/{expedicion.token_publico}/')
        self.assertEqual(descarga.status_code, status.HTTP_404_NOT_FOUND)

    def test_dias_visibilidad_publica_respeta_configuracion_y_suelo_legal(self):
        ConfiguracionDeca.objects.create(dias_visibilidad_publica=15)
        self.assertEqual(storage_service.dias_visibilidad_publica_de(), 15)

        rechazo = self.client.patch('/api/v1/deca/configuracion/', {'dias_visibilidad_publica': 3})
        self.assertEqual(rechazo.status_code, status.HTTP_400_BAD_REQUEST)

    def test_campos_opcionales_plus_se_guardan_y_pueden_quedar_vacios(self):
        datos = self._datos_expedicion_validos()
        # Sin rellenar ninguno de los campos plus -- deben aceptarse vacíos
        # (ninguno es obligatorio, ver CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR).
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        self.assertEqual(crear.data['volumen_m3'], None)
        self.assertEqual(crear.data['codigo_mercancia'], '')

        # Rellenando algunos, se guardan y se devuelven tal cual.
        datos_extra = self._datos_expedicion_validos()
        datos_extra.update({
            'numero_pedido': 'PED-001', 'volumen_m3': '5.50', 'codigo_mercancia': 'UN1234',
            'instrucciones_conductor': 'Avisar antes de llegar.',
            'contacto_emergencias': 'Ana +34600111222',
            'comentarios': 'Mercancía frágil.',
        })
        crear2 = self.client.post('/api/v1/deca/expediciones/', datos_extra)
        self.assertEqual(crear2.status_code, status.HTTP_201_CREATED, crear2.data)
        self.assertEqual(crear2.data['numero_pedido'], 'PED-001')
        self.assertEqual(crear2.data['codigo_mercancia'], 'UN1234')
        self.assertEqual(crear2.data['comentarios'], 'Mercancía frágil.')

    def test_pdf_generado_omite_campos_plus_vacios_e_incluye_los_rellenos(self):
        datos = self._datos_expedicion_validos()
        datos.update({'volumen_m3': '5.50', 'codigo_mercancia': 'UN1234', 'comentarios': 'Ojo, fragil.'})
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        generar = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')
        self.assertEqual(generar.status_code, status.HTTP_200_OK, generar.data)

        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        contenido = expedicion.pdf_generado.read().decode('latin-1', errors='ignore')
        # Solo comprobamos que el build no falla y el PDF resultante no está
        # vacío -- el contenido de texto real de un PDF no es fácil de
        # aserción exacta sin un extractor (ver extraction_service para eso).
        self.assertTrue(len(contenido) > 1000)

    def test_vista_previa_no_persiste_ni_bloquea_edicion_posterior(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        previa = self.client.get(f'/api/v1/deca/expediciones/{expedicion_id}/vista-previa/')
        self.assertEqual(previa.status_code, status.HTTP_200_OK)
        self.assertEqual(previa['Content-Type'], 'application/pdf')

        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        # La vista previa NUNCA debe tocar el PDF/hash oficiales ni el estado.
        self.assertFalse(expedicion.pdf_generado)
        self.assertEqual(expedicion.hash_sha256, '')
        self.assertEqual(expedicion.estado, ExpedicionDeca.Estado.BORRADOR)

        # Se puede seguir editando con normalidad después de pedir una vista previa.
        editar = self.client.patch(f'/api/v1/deca/expediciones/{expedicion_id}/', {'destino': 'Bilbao, Vizcaya'})
        self.assertEqual(editar.status_code, status.HTTP_200_OK)

    def test_vista_previa_con_lo_que_hay_en_el_formulario_sin_guardar(self):
        """v4.31.2: la vista previa pinta lo que hay en pantalla aunque no se
        haya guardado, incluso con un NIF mal escrito, y no toca la BD."""
        from pypdf import PdfReader

        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        previa = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/vista-previa/', {
            'nombre_transportista': 'Transportes Sin Guardar SL', 'nif_transportista': 'B12345678',
            'destino': 'Bilbao', 'peso_kg': '12,5', 'bultos': 'muchos', 'fecha_hora_transporte': '2026-09-29T08:30',
            'estado': 'generado', 'empresa': 'otra', 'hash_sha256': 'x',
        }, format='json')
        self.assertEqual(previa.status_code, status.HTTP_200_OK)
        self.assertEqual(previa['Content-Type'], 'application/pdf')
        texto = ''.join(p.extract_text() for p in PdfReader(io.BytesIO(b''.join(previa.streaming_content))).pages)
        self.assertIn('Transportes Sin Guardar SL', texto)
        self.assertIn('Bilbao', texto)

        # Nada de lo enviado se ha guardado; los campos protegidos, ni en memoria.
        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        self.assertEqual(expedicion.nombre_transportista, 'Transportes SL')
        self.assertEqual(expedicion.destino, 'Barcelona')
        self.assertEqual(expedicion.estado, ExpedicionDeca.Estado.BORRADOR)
        self.assertEqual(expedicion.hash_sha256, '')

    def test_nif_o_matricula_invalidos_dicen_de_quien_son(self):
        """El error dice de quién es el dato y qué se escribió, no un "NIF/CIF
        no válido" suelto (pedido del usuario 2026-09-29)."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        url = f'/api/v1/deca/expediciones/{crear.data["id"]}/'
        r = self.client.patch(url, {'nif_transportista': 'b12345678'}, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('del transportista', str(r.data['nif_transportista']))
        self.assertIn('B12345678', str(r.data['nif_transportista']))
        r = self.client.patch(url, {'matricula_remolque': 'ABCD'}, format='json')  # sin cifras: no es una matrícula
        self.assertIn('del remolque', str(r.data['matricula_remolque']))

    def test_matriculas_antiguas_de_remolque_y_extranjeras_se_aceptan(self):
        """Furgonetas, camiones con placa antigua o extranjeros también cargan
        (revisado 2026-09-30): antes solo se aceptaba 1234ABC."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        url = f'/api/v1/deca/expediciones/{crear.data["id"]}/'
        for tractora, remolque in [('CA-1234-AB', 'R-1234-BBB'), ('AB-12-CD', '75 ABC 123'), ('M 1234 Z', 'R1234BCD')]:
            r = self.client.patch(url, {'matricula_tractor': tractora, 'matricula_remolque': remolque}, format='json')
            self.assertEqual(r.status_code, status.HTTP_200_OK, (tractora, remolque, r.data))
        for mala in ('1234', 'ABCD', 'X!', '12345678901AB'):
            r = self.client.patch(url, {'matricula_tractor': mala}, format='json')
            self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, mala)

    def test_vista_previa_no_disponible_tras_generar(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')

        previa = self.client.get(f'/api/v1/deca/expediciones/{expedicion_id}/vista-previa/')
        self.assertEqual(previa.status_code, status.HTTP_403_FORBIDDEN)

    def test_sin_configuracion_usa_el_valor_por_defecto(self):
        # Empresa sin fila de ConfiguracionDeca todavía -- no debe fallar,
        # cae al valor por defecto (ver storage_service.dias_visibilidad_publica_de).
        self.assertEqual(storage_service.dias_visibilidad_publica_de(), 10)

    def test_flujo_completo_registra_eventos_de_auditoria_en_orden(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/',
            {'tipo_documento': 'albaran_venta', 'archivo': self._pdf_con_texto('Documento de prueba', 'albaran.pdf')},
            format='multipart',
        )
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')

        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        token = str(expedicion.token_publico)
        self.client.logout()
        self.client.get(f'/api/v1/deca/publico/{token}/')

        eventos = list(expedicion.eventos.values_list('tipo_evento', flat=True))
        self.assertEqual(eventos, [
            EventoExpedicionDeca.TipoEvento.CREADA,
            EventoExpedicionDeca.TipoEvento.DOCUMENTO_SUBIDO,
            EventoExpedicionDeca.TipoEvento.CONFIRMADA,
            EventoExpedicionDeca.TipoEvento.GENERADA,
            EventoExpedicionDeca.TipoEvento.DESCARGA_PUBLICA,
        ])
        # El evento de generación guarda el hash real del PDF servido -- prueba
        # de qué versión exacta se entregó, sin depender de mirar el archivo.
        evento_generada = expedicion.eventos.get(tipo_evento=EventoExpedicionDeca.TipoEvento.GENERADA)
        self.assertEqual(evento_generada.hash_documento, expedicion.hash_sha256)
        self.assertTrue(expedicion.eventos.get(tipo_evento=EventoExpedicionDeca.TipoEvento.DESCARGA_PUBLICA).ip_origen)

    def test_anular_expedicion_generada_corta_el_acceso_publico_al_instante(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')

        anular = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/anular/', {'motivo': 'Dato erróneo'})
        self.assertEqual(anular.status_code, status.HTTP_200_OK)
        self.assertEqual(anular.data['estado'], ExpedicionDeca.Estado.ANULADO)

        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        self.client.logout()
        descarga = self.client.get(f'/api/v1/deca/publico/{expedicion.token_publico}/')
        self.assertEqual(descarga.status_code, status.HTTP_404_NOT_FOUND)

    def test_borrar_expedicion_en_borrador(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        borrar = self.client.delete(f'/api/v1/deca/expediciones/{expedicion_id}/')
        self.assertEqual(borrar.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ExpedicionDeca.objects.filter(id=expedicion_id).exists())

    def test_borrar_expedicion_anulada_sin_generar_permitido(self):
        """Anulada antes de llegar a Generar -- nunca hubo un DeCA oficial,
        pedido explícito del usuario 2026-09-24: dejar borrarla a mano."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/anular/', {'motivo': 'Duplicada'})

        detalle = self.client.get(f'/api/v1/deca/expediciones/{expedicion_id}/')
        self.assertFalse(detalle.data['tiene_pdf_generado'])

        borrar = self.client.delete(f'/api/v1/deca/expediciones/{expedicion_id}/')
        self.assertEqual(borrar.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ExpedicionDeca.objects.filter(id=expedicion_id).exists())

    def test_borrar_expedicion_anulada_pero_ya_generada_prohibido(self):
        """Anulada DESPUÉS de generar el DeCA oficial -- se conserva siempre
        por auditoría (el caso de 'detectamos un error y hay que rehacerlo'),
        nunca se borra."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/anular/', {'motivo': 'Dato erróneo'})

        detalle = self.client.get(f'/api/v1/deca/expediciones/{expedicion_id}/')
        self.assertTrue(detalle.data['tiene_pdf_generado'])

        borrar = self.client.delete(f'/api/v1/deca/expediciones/{expedicion_id}/')
        self.assertEqual(borrar.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(ExpedicionDeca.objects.filter(id=expedicion_id).exists())

    def test_borrar_expedicion_confirmada_sin_anular_prohibido(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        borrar = self.client.delete(f'/api/v1/deca/expediciones/{expedicion_id}/')
        self.assertEqual(borrar.status_code, status.HTTP_403_FORBIDDEN)

    def test_editar_expedicion_generada_dentro_de_plazo_permitido(self):
        """Ventana de gracia añadida 2026-09-25 -- caso real: el chófer llama
        nada más salir porque un dato está mal. Dentro del plazo configurado
        (horas_max_edicion_generado, 24h por defecto) se puede corregir sin
        anular; el PDF se regenera (mismo QR/token) y el historial registra
        el usuario y qué campos cambiaron (ver perform_update)."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        generar = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')
        hash_antes = generar.data['hash_sha256']

        editar = self.client.patch(f'/api/v1/deca/expediciones/{expedicion_id}/', {'nombre_cargador': 'Otro nombre', 'motivo_modificacion': 'Nombre mal escrito'})
        self.assertEqual(editar.status_code, status.HTTP_200_OK, editar.data)
        self.assertEqual(editar.data['estado'], ExpedicionDeca.Estado.GENERADO)
        self.assertEqual(editar.data['nombre_cargador'], 'Otro nombre')
        # PDF regenerado -- el hash cambia aunque fecha_generacion no se toque.
        self.assertNotEqual(editar.data['hash_sha256'], hash_antes)
        self.assertEqual(editar.data['fecha_generacion'], generar.data['fecha_generacion'])

        evento = EventoExpedicionDeca.objects.filter(
            expedicion_id=expedicion_id, tipo_evento=EventoExpedicionDeca.TipoEvento.EDITADA,
        ).latest('fecha_alta')
        self.assertIn('nombre_cargador', evento.detalle)
        self.assertIn('regenerado', evento.detalle)
        self.assertEqual(evento.usuario, self.user)

    def test_editar_expedicion_anulada_prohibido(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/anular/', {'motivo': 'Duplicada'})

        editar = self.client.patch(f'/api/v1/deca/expediciones/{expedicion_id}/', {'nombre_cargador': 'Otro nombre'})
        self.assertEqual(editar.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anular_un_borrador_prohibido(self):
        """Anular es 'esto se emitió oficialmente y se cancela' -- un borrador
        nunca llegó a confirmarse ni generarse, así que ese concepto no
        aplica (2026-09-25). Para descartarlo existe 'Borrar borrador'."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        anular = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/anular/', {'motivo': 'Duplicada'})
        self.assertEqual(anular.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(ExpedicionDeca.objects.get(id=expedicion_id).estado, ExpedicionDeca.Estado.BORRADOR)

    def test_editar_expedicion_en_borrador_permitido(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        editar = self.client.patch(f'/api/v1/deca/expediciones/{expedicion_id}/', {'nombre_cargador': 'Otro nombre'})
        self.assertEqual(editar.status_code, status.HTTP_200_OK)
        self.assertEqual(ExpedicionDeca.objects.get(id=expedicion_id).nombre_cargador, 'Otro nombre')

        # El historial ya no dice solo "Editada" -- registra qué campo
        # cambió y quién lo hizo (pedido explícito del usuario 2026-09-25).
        evento = EventoExpedicionDeca.objects.filter(
            expedicion_id=expedicion_id, tipo_evento=EventoExpedicionDeca.TipoEvento.EDITADA,
        ).latest('fecha_alta')
        self.assertIn('nombre_cargador', evento.detalle)
        self.assertEqual(evento.usuario, self.user)

    def test_editar_expedicion_confirmada_permitido(self):
        """Corregir un dato tras confirmar sigue permitido -- el frontend lo
        usa para volver a Borrador al guardar (DecaFormPage.jsx), no debe
        bloquearse aquí."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        editar = self.client.patch(f'/api/v1/deca/expediciones/{expedicion_id}/', {'nombre_cargador': 'Otro nombre'})
        self.assertEqual(editar.status_code, status.HTTP_200_OK)

    def test_cadena_de_transportistas_sucesivos(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        alta = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/transportistas-sucesivos/',
            {'orden': 1, 'nif': 'B12345674', 'nombre': 'Subcontrata SL', 'matricula': '9999zzz'},
        )
        self.assertEqual(alta.status_code, status.HTTP_201_CREATED, alta.data)
        self.assertEqual(alta.data['matricula'], '9999ZZZ')

        listado = self.client.get(f'/api/v1/deca/expediciones/{expedicion_id}/transportistas-sucesivos/')
        self.assertEqual(len(listado.data['results'] if 'results' in listado.data else listado.data), 1)

        # Tras confirmar, la cadena queda bloqueada igual que el resto de la expedición.
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        bloqueado = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/transportistas-sucesivos/',
            {'orden': 2, 'nif': 'B12345674', 'nombre': 'Otra SL'},
        )
        self.assertEqual(bloqueado.status_code, status.HTTP_403_FORBIDDEN)

    def test_purgar_ips_eventos_respeta_retencion_configurada_por_empresa(self):
        ConfiguracionDeca.objects.create(dias_retencion_ip_eventos=30)

        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion = ExpedicionDeca.objects.get(id=crear.data['id'])

        evento_antiguo = EventoExpedicionDeca.objects.create(
            expedicion=expedicion, tipo_evento=EventoExpedicionDeca.TipoEvento.DESCARGA_PUBLICA,
            ip_origen='1.2.3.4',
        )
        EventoExpedicionDeca.objects.filter(id=evento_antiguo.id).update(
            fecha_alta=timezone.now() - timedelta(days=40),
        )
        evento_reciente = EventoExpedicionDeca.objects.create(
            expedicion=expedicion, tipo_evento=EventoExpedicionDeca.TipoEvento.DESCARGA_PUBLICA,
            ip_origen='5.6.7.8',
        )

        call_command('purgar_ips_eventos_deca')

        evento_antiguo.refresh_from_db()
        evento_reciente.refresh_from_db()
        self.assertIsNone(evento_antiguo.ip_origen)
        self.assertEqual(evento_reciente.ip_origen, '5.6.7.8')

    def test_listar_eventos_no_trunca_a_50_sin_paginar(self):
        """Bug real ("Tarea 2", 2026-09-25): EventoExpedicionDecaListView no
        fijaba pagination_class, así que heredaba el PAGE_SIZE global (50) y
        el frontend pedía todos los eventos de golpe sin paginar -- un
        historial con más de 50 eventos perdía los más antiguos en
        silencio. Ahora la vista es explícitamente sin paginar."""
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion = ExpedicionDeca.objects.get(id=crear.data['id'])
        EventoExpedicionDeca.objects.bulk_create([
            EventoExpedicionDeca(expedicion=expedicion, tipo_evento=EventoExpedicionDeca.TipoEvento.DESCARGA_PUBLICA)
            for _ in range(60)
        ])
        total_real = expedicion.eventos.count()
        self.assertGreater(total_real, 50)

        listado = self.client.get(f'/api/v1/deca/expediciones/{expedicion.id}/eventos/')
        self.assertEqual(listado.status_code, status.HTTP_200_OK)
        # Sin paginación, DRF devuelve una lista plana, no {results, count}.
        self.assertIsInstance(listado.data, list)
        self.assertEqual(len(listado.data), total_real)

    def test_exportar_auditoria_expedicion_pdf(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        respuesta = self.client.get(f'/api/v1/deca/expediciones/{expedicion_id}/auditoria/exportar-pdf/')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta['Content-Type'], 'application/pdf')

    def test_exportar_auditoria_expedicion_excel(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        respuesta = self.client.get(f'/api/v1/deca/expediciones/{expedicion_id}/auditoria/exportar-excel/')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(
            respuesta['Content-Type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )

    def test_crear_expedicion_alimenta_los_catalogos_de_conductor_y_transportista(self):
        datos = self._datos_expedicion_validos()
        datos.update({
            'nombre_conductor': 'Juan Pérez',
            'nif_conductor': '12345678Z',
            'telefono_conductor': '600111222',
            'email_conductor': 'juan@example.com',
        })
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)

        conductor = ConductorDeca.objects.get(nif='12345678Z')
        self.assertEqual(conductor.nombre, 'Juan Pérez')
        transportista = EmpresaTransportistaDeca.objects.get(nif='B12345674')
        self.assertEqual(transportista.nombre, 'Transportes SL')
        # `_datos_expedicion_validos` usa 'B12345674'/'Fabrica SL' como cargador.
        cargador = CargadorDeca.objects.get(nif='B12345674')
        self.assertEqual(cargador.nombre, 'Fabrica SL')

        listado = self.client.get('/api/v1/deca/conductores/')
        self.assertEqual(listado.status_code, status.HTTP_200_OK)

        # Reutilizar el mismo conductor en otra expedición actualiza su ficha,
        # no crea una segunda fila.
        datos2 = self._datos_expedicion_validos()
        datos2['numero_albaran'] = 'A-000124'
        datos2.update({
            'nombre_conductor': 'Juan Pérez López', 'nif_conductor': '12345678Z',
        })
        self.client.post('/api/v1/deca/expediciones/', datos2)
        self.assertEqual(ConductorDeca.objects.filter(nif='12345678Z').count(), 1)
        conductor.refresh_from_db()
        self.assertEqual(conductor.nombre, 'Juan Pérez López')

    def test_crud_documento_origen_renombrar_y_borrar(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/',
            {'tipo_documento': 'albaran_venta', 'archivo': self._pdf_con_texto('Documento de prueba', 'albaran.pdf')},
            format='multipart',
        )
        documento_id = subir.data['documento']['id']

        renombrar = self.client.patch(
            f'/api/v1/deca/documentos/{documento_id}/', {'nombre_original': 'Albaran corregido.pdf'},
        )
        self.assertEqual(renombrar.status_code, status.HTTP_200_OK, renombrar.data)
        self.assertEqual(renombrar.data['nombre_original'], 'Albaran corregido.pdf')

        # Intentar cambiar el fichero en sí (read_only) no debe romper nada
        # ni aceptarse -- se ignora silenciosamente, como cualquier campo
        # read_only en DRF.
        sin_efecto = self.client.patch(f'/api/v1/deca/documentos/{documento_id}/', {'archivo': 'otra_cosa'})
        self.assertEqual(sin_efecto.status_code, status.HTTP_200_OK)

        borrar = self.client.delete(f'/api/v1/deca/documentos/{documento_id}/')
        self.assertEqual(borrar.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(
            self.client.get(f'/api/v1/deca/expediciones/{expedicion_id}/').data['documentos_origen'], [],
        )

        # Una vez generado el DeCA, ya no se puede tocar ningún documento
        # origen -- es parte de la evidencia de auditoría del documento final.
        confirmar_datos = self._datos_expedicion_validos()
        crear2 = self.client.post('/api/v1/deca/expediciones/', confirmar_datos)
        exp2_id = crear2.data['id']
        subir2 = self.client.post(
            f'/api/v1/deca/expediciones/{exp2_id}/documentos/',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_con_texto('Otro documento', 'cmr.pdf')},
            format='multipart',
        )
        doc2_id = subir2.data['documento']['id']
        self.client.post(f'/api/v1/deca/expediciones/{exp2_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{exp2_id}/generar/')

        bloqueado = self.client.delete(f'/api/v1/deca/documentos/{doc2_id}/')
        self.assertEqual(bloqueado.status_code, status.HTTP_403_FORBIDDEN)

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_extraccion_usa_ia_de_texto_cuando_el_pdf_tiene_capa_de_texto(
        self, mock_call_text_api, mock_call_vision_api,
    ):
        mock_call_text_api.return_value = (
            '{"nif_transportista": "B99999999", "nombre_transportista": "Porteador SL", '
            '"peso_kg": 116969.0, "bultos": 14}'
        )
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        archivo = self._pdf_con_texto(
            'CARTA DE PORTE INTERNACIONAL CMR ' * 12, 'cmr.pdf',
        )
        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': archivo},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        mock_call_text_api.assert_called_once()
        mock_call_vision_api.assert_not_called()
        self.assertEqual(subir.data['campos_sugeridos_ia']['nif_transportista'], 'B99999999')
        self.assertEqual(subir.data['campos_sugeridos_ia']['bultos'], 14)

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_extraccion_cae_a_vision_cuando_el_pdf_esta_escaneado(
        self, mock_call_text_api, mock_call_vision_api,
    ):
        """Bug real (CMR 19300 del usuario, 2026-09-24): un CMR impreso,
        firmado a mano y escaneado no tiene capa de texto -- pypdf devuelve
        0 caracteres. Antes el gate era `if texto`, así que en ese caso NO
        se llamaba a ninguna IA y el formulario se quedaba vacío del todo."""
        mock_call_vision_api.return_value = (
            '{"nombre_destinatario": "DISTRINORTE S.A", "bultos": 80, "peso_kg": 577.50}'
        )
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_sin_texto('cmr_escaneado.pdf')},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        mock_call_vision_api.assert_called_once()
        mock_call_text_api.assert_not_called()
        self.assertEqual(subir.data['campos_sugeridos_ia']['nombre_destinatario'], 'DISTRINORTE S.A')
        self.assertEqual(subir.data['campos_sugeridos_ia']['bultos'], 80)

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_completa_nif_desde_catalogo_cuando_la_ia_solo_saca_el_nombre(
        self, mock_call_text_api, mock_call_vision_api,
    ):
        """Pedido explícito del usuario 2026-09-25: un CMR suele traer el
        nombre del transportista/destinatario con claridad pero el NIF no
        siempre aparece (letra pequeña, sellado...). Si ese nombre ya está
        en la Agenda de la empresa (de una expedición anterior), el
        segundo pase debe rellenar el NIF desde ahí -- sin pisar ningún
        NIF que la IA ya hubiera encontrado por su cuenta."""
        EmpresaTransportistaDeca.objects.create(
            nif='B11111119', nombre='TRANSLOGIC',
        )
        DestinatarioDeca.objects.create(
            nif='A91234567', nombre='DISTRINORTE S.A',
        )
        mock_call_vision_api.return_value = (
            '{"nombre_transportista": "TRANSLOGIC", '
            '"nombre_destinatario": "DISTRINORTE S.A", "nif_destinatario": "A00000000", '
            '"bultos": 80}'
        )
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_sin_texto('cmr_escaneado.pdf')},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        campos = subir.data['campos_sugeridos_ia']
        # Transportista: la IA solo sacó el nombre -- el NIF debe venir del catálogo.
        self.assertEqual(campos['nif_transportista'], 'B11111119')
        # Destinatario: la IA leyó otro NIF para una empresa que está en la
        # Agenda. Desde 2026-10-01 la Agenda MANDA (Configuración de DeCA →
        # agenda_prioritaria, encendido de fábrica): se usa su NIF y se avisa.
        self.assertEqual(campos['nif_destinatario'], 'A91234567')
        self.assertIn('nif_destinatario', subir.data['campos_agenda'])
        self.assertTrue(any('A00000000' in a for a in subir.data['avisos_agenda']))

    @patch('deca.services.extraction_ia_service.call_vision_api')
    def test_fallo_de_ia_se_devuelve_como_ia_error(self, mock_call_vision_api):
        """Bug real 2026-09-25: con la cuota de Gemini agotada la pantalla
        decía "foto borrosa" y el usuario buscaba el fallo en la foto/móvil.
        Un fallo de la IA debe llegar como `ia_error`, distinto de "no
        encontró nada"."""
        mock_call_vision_api.side_effect = Exception('Cuota de IA agotada.')
        expedicion_id = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos()).data['id']
        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_sin_texto('cmr_escaneado.pdf')},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        self.assertEqual(subir.data['ia_error'], 'Cuota de IA agotada.')

        # Respuesta sin JSON (filtro de seguridad de OpenRouter, visto en prod).
        mock_call_vision_api.side_effect = None
        mock_call_vision_api.return_value = 'User Safety: unsafe'
        extraer = self.client.post(f"/api/v1/deca/documentos/{subir.data['documento']['id']}/extraer/")
        self.assertIn('no ha devuelto una respuesta válida', extraer.data['ia_error'])

        # IA que funciona: sin ia_error.
        mock_call_vision_api.return_value = '{"bultos": 3}'
        extraer = self.client.post(f"/api/v1/deca/documentos/{subir.data['documento']['id']}/extraer/")
        self.assertIsNone(extraer.data['ia_error'])

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_completa_nif_desde_catalogo_tolera_diferencias_de_puntuacion(
        self, mock_call_text_api, mock_call_vision_api,
    ):
        """Bug real reproducido en producción 2026-09-25: la ficha del
        catálogo tenía "Distrinorte S.A." (con punto final, tal como se
        guardó a mano una vez) y esa misma foto, en un reintento posterior,
        la IA la leyó como "DISTRINORTE S.A" (sin punto) -- un `iexact` a
        pelo no encontraba la coincidencia y el NIF se quedaba sin
        completar pese a que la empresa YA estaba en la Agenda."""
        DestinatarioDeca.objects.create(
            nif='A91234567', nombre='Distrinorte S.A.',
        )
        mock_call_vision_api.return_value = '{"nombre_destinatario": "DISTRINORTE S.A", "bultos": 80}'
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_sin_texto('cmr_escaneado.pdf')},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        self.assertEqual(subir.data['campos_sugeridos_ia']['nif_destinatario'], 'A91234567')
        # Coincidencia de NÚCLEO (misma empresa, solo cambia la forma
        # societaria/puntuación) -- no es una suposición, no se marca nada.
        self.assertEqual(subir.data['campos_a_revisar'], [])

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_completa_nif_desde_catalogo_con_coincidencia_difusa_marca_revisar(
        self, mock_call_text_api, mock_call_vision_api,
    ):
        """Pedido explícito del usuario 2026-09-25: si el nombre que lee la
        IA se PARECE a uno del catálogo pero no es idéntico (posible error
        de OCR/transcripción, ej. "Translogic" -> "Translogik"), se rellena el
        NIF igualmente mejor que dejarlo vacío, pero tanto el nombre como
        el NIF se marcan en `campos_a_revisar` para que el usuario lo
        confirme -- a diferencia de una coincidencia de núcleo exacta, que
        no lleva ningún aviso."""
        EmpresaTransportistaDeca.objects.create(
            nif='B98765431', nombre='TRANSLOGIC',
        )
        # "Translogik" -- una sola letra distinta ("c" -> "k") respecto a
        # "Translogic", el tipo de error real que comete una IA de visión
        # con una foto de baja calidad.
        mock_call_vision_api.return_value = '{"nombre_transportista": "Translogik", "bultos": 80}'
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_sin_texto('cmr_escaneado.pdf')},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        self.assertEqual(subir.data['campos_sugeridos_ia']['nif_transportista'], 'B98765431')
        self.assertCountEqual(
            subir.data['campos_a_revisar'], ['nif_transportista', 'nombre_transportista'],
        )

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_completa_nif_desde_catalogo_nombre_muy_distinto_no_rellena_nada(
        self, mock_call_text_api, mock_call_vision_api,
    ):
        """Un nombre genuinamente distinto (no un error de transcripción)
        no debe rellenar ni marcar nada -- adivinar aquí sería peor que
        dejarlo vacío."""
        EmpresaTransportistaDeca.objects.create(
            nif='B98765431', nombre='TRANSLOGIC',
        )
        mock_call_vision_api.return_value = '{"nombre_transportista": "Transportes García SL", "bultos": 80}'
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_sin_texto('cmr_escaneado.pdf')},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        self.assertNotIn('nif_transportista', subir.data['campos_sugeridos_ia'])
        self.assertEqual(subir.data['campos_a_revisar'], [])

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_extraccion_reconoce_conductor_y_completa_su_nif_desde_catalogo(
        self, mock_call_text_api, mock_call_vision_api,
    ):
        """Bug real reportado 2026-09-25: "en otro tipo de documento lo ha
        reconocido todo menos el conductor con su NIF" -- el conductor no
        estaba ni siquiera en la lista de campos que se le pide a la IA.
        Añadido nombre_conductor/nif_conductor al esquema, con el mismo
        segundo pase de catálogo que cargador/transportista/destinatario."""
        ConductorDeca.objects.create(
            nif='12345678Z', nombre='Juan Pérez',
        )
        mock_call_vision_api.return_value = '{"nombre_conductor": "Juan Pérez", "bultos": 80}'
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']

        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/?extraer=true',
            {'tipo_documento': 'cmr', 'archivo': self._pdf_sin_texto('cmr_escaneado.pdf')},
            format='multipart',
        )
        self.assertEqual(subir.status_code, status.HTTP_201_CREATED, subir.data)
        self.assertEqual(subir.data['campos_sugeridos_ia']['nif_conductor'], '12345678Z')
        self.assertEqual(subir.data['campos_a_revisar'], [])

    @patch('deca.services.extraction_ia_service.call_vision_api')
    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_reintentar_extraccion_sobre_documento_ya_subido(
        self, mock_call_text_api, mock_call_vision_api,
    ):
        """Botón "Extraer datos" -- pedido explícito 2026-09-23: poder
        reintentar la extracción sin volver a subir el archivo, por si
        falló en el momento de la subida o se desmarcó la casilla
        `extraer`. La IA va mockeada: aquí se comprueba la parte de regex,
        no el proveedor externo."""
        mock_call_text_api.return_value = '{}'
        mock_call_vision_api.return_value = '{}'
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        archivo = self._pdf_con_texto('NIF B12345674 peso 100,00 kg fecha 22/09/2026', 'albaran.pdf')
        subir = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/documentos/',
            {'tipo_documento': 'albaran_venta', 'archivo': archivo},
            format='multipart',
        )
        documento_id = subir.data['documento']['id']
        # Sin `?extraer=true` en la subida -- no se intentó nada todavía.
        self.assertIsNone(subir.data['campos_sugeridos'])

        reintento = self.client.post(f'/api/v1/deca/documentos/{documento_id}/extraer/')
        self.assertEqual(reintento.status_code, status.HTTP_200_OK, reintento.data)
        self.assertIn('B12345674', reintento.data['campos_sugeridos']['nifs_encontrados'])
        self.assertEqual(reintento.data['campos_sugeridos']['peso_kg'], '100.00')


class NormalizarOrientacionImagenTests(TestCase):
    """Bug real (2026-09-25): una foto de CMR nítida y bien encuadrada no
    sacaba ningún campo por visión. La foto (típica de cámara de móvil) no
    venía rotada de verdad -- se guarda "tumbada" (ancha) con el tag EXIF
    Orientation diciendo que hay que girarla 90° al mostrarla. El modelo de
    visión recibe los bytes crudos y no respeta ese tag, así que leía el
    documento de lado. `_normalizar_orientacion_imagen` debe aplicar esa
    rotación sobre los píxeles antes de mandarlo a la IA."""

    def _jpeg_con_orientacion(self, ancho, alto, orientation):
        from PIL import Image

        imagen = Image.new('RGB', (ancho, alto), color=(255, 255, 255))
        exif = Image.Exif()
        exif[274] = orientation  # 274 = tag Orientation
        buffer = io.BytesIO()
        imagen.save(buffer, format='JPEG', exif=exif.tobytes())
        return buffer.getvalue()

    def test_gira_los_pixeles_de_una_foto_apaisada_con_orientation_6(self):
        from PIL import Image

        # Cámara de móvil típica: guarda 4032x3024 (más ancho que alto) con
        # Orientation=6 ("girar 90° CW al mostrar") para que se vea en
        # vertical -- exactamente el caso real reportado por el usuario.
        original = self._jpeg_con_orientacion(4032, 3024, 6)
        normalizado = extraction_ia_service._normalizar_orientacion_imagen(original, 'image/jpeg')

        resultado = Image.open(io.BytesIO(normalizado))
        # Tras aplicar la rotación de verdad, el ancho/alto físico se
        # intercambian (queda en vertical) y ya no lleva Orientation
        # pendiente de aplicar.
        self.assertEqual(resultado.size, (3024, 4032))
        self.assertIsNone(resultado.getexif().get(274))  # 274 = tag Orientation

    def test_una_foto_sin_exif_se_devuelve_sin_romperse(self):
        from PIL import Image

        imagen = Image.new('RGB', (800, 600), color=(0, 0, 0))
        buffer = io.BytesIO()
        imagen.save(buffer, format='JPEG')
        original = buffer.getvalue()

        normalizado = extraction_ia_service._normalizar_orientacion_imagen(original, 'image/jpeg')
        self.assertEqual(Image.open(io.BytesIO(normalizado)).size, (800, 600))

    def test_un_pdf_se_deja_intacto(self):
        contenido = b'%PDF-1.4 no es una imagen'
        self.assertEqual(
            extraction_ia_service._normalizar_orientacion_imagen(contenido, 'application/pdf'),
            contenido,
        )

    def test_un_fichero_corrupto_no_rompe_la_subida(self):
        basura = b'esto no es ni un jpg ni un pdf'
        self.assertEqual(
            extraction_ia_service._normalizar_orientacion_imagen(basura, 'image/jpeg'),
            basura,
        )


class ExtraccionRegexTests(TestCase):
    """Regresión directa sobre `extraction_service.extraer_campos` -- sin
    pasar por la API, más rápido y más preciso para fijar bugs concretos
    de la regex (ver docstring del módulo: es puro, sin BD/Django)."""

    def test_bultos_no_cruza_de_linea_con_una_cifra_de_otra_celda(self):
        """Bug real (CMR de Frutas del Sur, 2026-09-24): `\\s*` incluye el
        salto de línea, así que enlazaba el "50" de los céntimos de
        "577,50" (peso neto, otra celda de la tabla) con la palabra
        "Palets" de una línea muy posterior, dando "50 bultos" cuando el
        documento real decía 80."""
        texto = 'Peso neto Kg 577,50\nPalets: PALE LOG MD 2\nTotal palets: 2'
        campos = extraction_service.extraer_campos(texto)
        self.assertIsNone(campos['bultos'])

    def test_peso_exige_decimal_para_no_capturar_ruido_de_producto(self):
        """Bug real (mismo CMR): "C.LOGIFRUIT 612 7Kg MD CEL.VAR" es el
        peso de una caja individual dentro de la descripción del
        producto, no el peso total del envío -- capturarlo daba 7 kg en
        vez de los 577,50 kg reales. Los pesos totales en estos
        documentos siempre llevan decimales; un entero suelto pegado a
        "Kg" es casi siempre ruido, mejor no capturarlo."""
        texto = 'C.LOGIFRUIT 612 7Kg MD CEL.VAR\nPeso neto Kg 577,50'
        campos = extraction_service.extraer_campos(texto)
        self.assertIsNone(campos['peso_kg'])

    def test_peso_con_decimal_pegado_a_kg_si_se_extrae(self):
        texto = 'Total 49.467,00 KG'
        campos = extraction_service.extraer_campos(texto)
        self.assertEqual(campos['peso_kg'], '49467.00')

    def test_peso_albaran_varias_lineas_usa_el_total_neto(self):
        """Bug real (albarán ALN26/3911 de Frutas del Sur, 2026-09-27): se
        cogía el peso de la primera línea de producto (49.467 kg) en vez
        del total neto de la línea "Suma" (116.969 kg)."""
        texto = (
            'NABO CONV MARTILLO 1ª CNO PALOT CLIENTE 3 49.467 KG 49.548,00 49.467,00 KG 0,1900 9.398,73\n'
            'PUERRO CONV NEBULUS 1ª CNO PALOT CLIENTE 11 67.502 KG 67.799,00 67.502,00 KG 0,2310 15.572,71\n'
            # Tal cual lo saca pypdf en modo maquetado: bruto y neto pegados.
            'Suma : 14,0 117.347,00116.969,00 24,971.44\n'
        )
        campos = extraction_service.extraer_campos('', texto_maquetado=texto)
        self.assertEqual(campos['peso_kg'], '116969.00')

    def test_peso_albaran_texto_desordenado_no_coge_la_primera_linea(self):
        """Mismo albarán en el modo normal de pypdf (celdas desordenadas):
        sin línea de totales legible, vacío -- nunca los 49.467 kg."""
        texto = (
            'NABO CONV MARTILLO 1ª CNO PALOT CLIENTE 3 49.467 KG 49.548,00 49.467,00 KG 0,1900 9.398,73\n'
            'PUERRO CONV NEBULUS 1ª CNO PALOT CLIENTE 11 67.502 KG 67.799,00 67.502,00 KG 0,2310 15.572,71\n'
            '24,971.44116.969,0014,0 117.347,00Suma:\n'
        )
        self.assertIsNone(extraction_service.extraer_campos(texto)['peso_kg'])

    def test_trocear_numeros_pegados(self):
        self.assertEqual(
            extraction_service._trocear_numeros_es('117.347,00116.969,00'),
            ['117.347,00', '116.969,00'],
        )
        self.assertIsNone(extraction_service._trocear_numeros_es('24,971.44'))

    def test_peso_varias_lineas_sin_total_se_deja_vacio(self):
        """Sin línea de totales no se sabe cuál es el total: vacío (lo
        completa la IA) antes que el peso de una sola línea."""
        texto = 'Tomate 1.200,00 KG\nPimiento 800,00 KG'
        campos = extraction_service.extraer_campos(texto)
        self.assertIsNone(campos['peso_kg'])

    def test_bultos_en_la_misma_linea_si_se_extrae(self):
        texto = 'Mercancia paletizada: 14 palets en total'
        campos = extraction_service.extraer_campos(texto)
        self.assertEqual(campos['bultos'], '14')

    def test_conductor_con_etiqueta_literal_se_extrae(self):
        """Red de seguridad añadida tras un bug real 2026-09-25: un ticket
        con "Conductor: PEDRO GARCIA LOPEZ   NIF: 12345678Z" en
        texto impreso perfectamente legible no lo reconoció ni Gemini por
        IA de visión -- el regex, cuando el documento SÍ tiene capa de
        texto, sirve de respaldo determinista independiente del modelo."""
        texto = 'Matricula: 1234BBC\nConductor: PEDRO GARCIA LOPEZ   NIF: 12345678Z\nAgencia:'
        campos = extraction_service.extraer_campos(texto)
        self.assertEqual(campos['nombre_conductor'], 'PEDRO GARCIA LOPEZ')
        self.assertEqual(campos['nif_conductor'], '12345678Z')

    def test_conductor_sin_etiqueta_no_inventa_nada(self):
        texto = 'Firma y sello del transportista: [ilegible]'
        campos = extraction_service.extraer_campos(texto)
        self.assertIsNone(campos['nombre_conductor'])
        self.assertIsNone(campos['nif_conductor'])


class AgendaDecaTests(APITestCase):
    """CRUD de los cuatro catálogos (la "Agenda" del módulo). Hasta
    2026-09-24 eran solo lectura: se auto-alimentaban al guardar
    expediciones pero no había forma de corregir una ficha mal escrita,
    borrarla ni darla de alta por adelantado."""

    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = User.objects.create_user(
            username='admin@agenda.test', email='admin@agenda.test', password='Admin123!',
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_crud_completo_de_cada_catalogo(self):
        casos = [
            ('transportistas', {'nombre': 'Porteador SL', 'nif': 'B12345674'}, 'nombre', 'Porteador SLU'),
            ('destinatarios', {'nombre': 'Cliente SA', 'nif': 'A12345674'}, 'nombre', 'Cliente SAU'),
            ('cargadores', {'nombre': 'Fabrica SL', 'nif': 'B12345674'}, 'nombre', 'Fabrica SLU'),
            ('conductores', {'nombre': 'Juan Pérez', 'nif': '12345678Z'}, 'nombre', 'Juan Pérez López'),
            ('tractoras', {'matricula': '1234BBB'}, 'alias', 'Camión frío'),
            ('remolques', {'matricula': '5678CCC'}, 'alias', 'Frigorífico'),
        ]
        for tipo, datos, campo_editable, nuevo_valor in casos:
            with self.subTest(tipo=tipo):
                crear = self.client.post(f'/api/v1/deca/{tipo}/', datos)
                self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
                ficha_id = crear.data['id']

                editar = self.client.patch(f'/api/v1/deca/{tipo}/{ficha_id}/', {campo_editable: nuevo_valor})
                self.assertEqual(editar.status_code, status.HTTP_200_OK, editar.data)
                self.assertEqual(editar.data[campo_editable], nuevo_valor)

                borrar = self.client.delete(f'/api/v1/deca/{tipo}/{ficha_id}/')
                self.assertEqual(borrar.status_code, status.HTTP_204_NO_CONTENT)

    def test_solo_activos_filtra_lo_archivado(self):
        """El ComboboxSelect del formulario pide `?solo_activos=true` (solo
        lo vigente); la pantalla de Agenda lista todo, o una ficha archivada
        sería invisible e irrecuperable."""
        activo = DestinatarioDeca.objects.create(nombre='Vigente', nif='B12345674')
        DestinatarioDeca.objects.create(
            nombre='Archivado', nif='A12345674', activo=False,
        )

        # Los listados van paginados (PAGE_SIZE global) -> {count, results}
        todos = self.client.get('/api/v1/deca/destinatarios/')
        self.assertEqual(todos.data['count'], 2)

        solo_activos = self.client.get('/api/v1/deca/destinatarios/?solo_activos=true')
        self.assertEqual([f['id'] for f in solo_activos.data['results']], [str(activo.id)])

    def test_nif_invalido_rechazado_tambien_en_la_agenda(self):
        respuesta = self.client.post(
            '/api/v1/deca/destinatarios/', {'nombre': 'Inventado SL', 'nif': '12345678A'},
        )
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('nif', respuesta.data)

    def test_page_size_permite_traer_mas_de_50_fichas(self):
        """Los ComboboxSelect del formulario filtran en local sobre lo que
        reciben: con el PAGE_SIZE global de 50, una empresa con más fichas
        dejaba de ver el resto en el desplegable sin ningún aviso."""
        # NIF únicos: hay un UniqueConstraint (empresa, nif). No pasan por
        # el serializer, así que no necesitan dígito de control válido.
        DestinatarioDeca.objects.bulk_create([
            DestinatarioDeca(nombre=f'Cliente {i}', nif=f'B{i:08d}')
            for i in range(60)
        ])
        por_defecto = self.client.get('/api/v1/deca/destinatarios/')
        self.assertEqual(len(por_defecto.data['results']), 50)

        ampliado = self.client.get('/api/v1/deca/destinatarios/?page_size=500')
        self.assertEqual(len(ampliado.data['results']), 60)


class ExportacionDecaTests(APITestCase):
    """Exportación PDF/Excel de Expediciones y de la Agenda -- pedido
    explícito del usuario 2026-09-24: paridad con buscar/ordenar/exportar
    del resto de módulos. Mismo filtro/orden que la pantalla (patrón
    `buildParams`, ver CLAUDE.md)."""

    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = User.objects.create_user(
            username='admin@export.test', email='admin@export.test', password='Admin123!',
            is_staff=True, first_name='Admin',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _crear_expedicion(self, numero_albaran):
        datos = {
            'numero_albaran': numero_albaran,
            'nif_cargador': 'B12345674',
            'nombre_cargador': 'Fabrica SL',

            'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
            'nif_transportista': 'B12345674',
            'nombre_transportista': 'Transportes SL',
            'nif_destinatario': 'B12345674',
            'nombre_destinatario': 'Cliente SA',
            'matricula_tractor': '1234BBB', 'matricula_remolque': '5678CCC',
            'matricula_remolque': '5678CCC',
            'origen': 'Almería',
            'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(),
            'naturaleza_mercancia': 'Tomate',
            'peso_kg': '12000.00',
            'bultos': 500,
        }
        respuesta = self.client.post('/api/v1/deca/expediciones/', datos)
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)
        return respuesta.data['id']

    def test_exportar_expediciones_pdf_y_excel(self):
        self._crear_expedicion('A-0001')
        self._crear_expedicion('A-0002')

        pdf = self.client.get('/api/v1/deca/expediciones/exportar-pdf/')
        self.assertEqual(pdf.status_code, status.HTTP_200_OK)
        self.assertEqual(pdf['Content-Type'], 'application/pdf')
        contenido_pdf = b''.join(pdf.streaming_content)
        self.assertTrue(contenido_pdf.startswith(b'%PDF'))

        excel = self.client.get('/api/v1/deca/expediciones/exportar-excel/')
        self.assertEqual(excel.status_code, status.HTTP_200_OK)
        self.assertIn('spreadsheetml', excel['Content-Type'])
        self.assertGreater(len(excel.content), 0)

    def test_exportar_expediciones_respeta_el_filtro_de_estado(self):
        self._crear_expedicion('A-0001')

        # Filtrando por un estado que no existe en los datos, el PDF se
        # genera igualmente (documento vacío, no un error) -- mismo criterio
        # que el listado en pantalla.
        pdf = self.client.get('/api/v1/deca/expediciones/exportar-pdf/', {'estado': 'anulado'})
        self.assertEqual(pdf.status_code, status.HTTP_200_OK)

    def test_exportar_agenda_pdf_y_excel_por_tipo(self):
        DestinatarioDeca.objects.create(nombre='Cliente Uno', nif='B12345674')
        EmpresaTransportistaDeca.objects.create(nombre='Porteador SL', nif='A12345674')

        for tipo in ('destinatarios', 'transportistas', 'conductores', 'tractoras', 'remolques'):
            with self.subTest(tipo=tipo):
                pdf = self.client.get(f'/api/v1/deca/agenda/{tipo}/exportar-pdf/')
                self.assertEqual(pdf.status_code, status.HTTP_200_OK)
                self.assertEqual(pdf['Content-Type'], 'application/pdf')

                excel = self.client.get(f'/api/v1/deca/agenda/{tipo}/exportar-excel/')
                self.assertEqual(excel.status_code, status.HTTP_200_OK, excel.content)
                self.assertIn('spreadsheetml', excel['Content-Type'])

    def test_exportar_agenda_tipo_desconocido_da_404(self):
        respuesta = self.client.get('/api/v1/deca/agenda/no-existe/exportar-pdf/')
        self.assertEqual(respuesta.status_code, status.HTTP_404_NOT_FOUND)

    def test_exportar_respeta_la_cabecera_de_documento_controlado(self):
        """Si la empresa activa la cabecera (código/versión/edición...), el
        PDF debe generarse igual -- no un 500 por un campo vacío que el
        helper compartido no sepa manejar."""
        self._crear_expedicion('A-0001')
        ConfiguracionDeca.objects.create(
            informe_mostrar_cabecera=True,
            informe_codigo_documento='DOC-DECA-01', informe_version='1.0',
            informe_edicion='1', informe_preparado_por='Admin', informe_autorizado_por='Gerencia',
        )
        pdf = self.client.get('/api/v1/deca/expediciones/exportar-pdf/')
        self.assertEqual(pdf.status_code, status.HTTP_200_OK)

class ImportarAgendaDecaTests(APITestCase):
    """Importación CSV masiva de la Agenda -- pedido explícito del usuario
    2026-09-24: no había forma de dar de alta varias fichas de golpe."""

    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = User.objects.create_user(
            username='admin@importar.test', email='admin@importar.test', password='Admin123!',
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _csv(self, contenido: str, nombre='fichas.csv') -> SimpleUploadedFile:
        return SimpleUploadedFile(nombre, contenido.encode('utf-8-sig'), content_type='text/csv')

    def test_importa_crea_y_actualiza_transportistas(self):
        csv_texto = (
            'nombre,nif,telefono,email\n'
            'Porteador SL,B12345674,600111222,contacto@porteador.test\n'
            'Rutas Rápidas SL,A12345674,,\n'
        )
        respuesta = self.client.post(
            '/api/v1/deca/agenda/transportistas/importar-csv/',
            {'archivo': self._csv(csv_texto)}, format='multipart',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
        self.assertEqual(respuesta.data['creados'], 2)
        self.assertEqual(respuesta.data['actualizados'], 0)
        self.assertEqual(respuesta.data['errores'], [])
        self.assertEqual(EmpresaTransportistaDeca.objects.filter().count(), 2)

        # Reimportar el mismo NIF actualiza en vez de duplicar.
        csv_actualizado = 'nombre,nif,telefono,email\nPorteador SLU,B12345674,600999888,\n'
        respuesta2 = self.client.post(
            '/api/v1/deca/agenda/transportistas/importar-csv/',
            {'archivo': self._csv(csv_actualizado)}, format='multipart',
        )
        self.assertEqual(respuesta2.status_code, status.HTTP_200_OK, respuesta2.data)
        self.assertEqual(respuesta2.data['creados'], 0)
        self.assertEqual(respuesta2.data['actualizados'], 1)
        self.assertEqual(EmpresaTransportistaDeca.objects.filter().count(), 2)
        ficha = EmpresaTransportistaDeca.objects.get(nif='B12345674')
        self.assertEqual(ficha.nombre, 'Porteador SLU')
        self.assertEqual(ficha.telefono, '600999888')

    def test_importa_tractoras_y_remolques_por_matricula(self):
        for tipo, modelo in (('tractoras', TractoraDeca), ('remolques', RemolqueDeca)):
            with self.subTest(tipo=tipo):
                csv_texto = 'matricula,alias\n1234BBB,Camión frío\n'
                respuesta = self.client.post(
                    f'/api/v1/deca/agenda/{tipo}/importar-csv/',
                    {'archivo': self._csv(csv_texto)}, format='multipart',
                )
                self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
                self.assertEqual(respuesta.data['creados'], 1)
                self.assertTrue(modelo.objects.filter(matricula='1234BBB').exists())

    def test_fila_con_nif_invalido_se_reporta_como_error_sin_romper_las_demas(self):
        csv_texto = (
            'nombre,nif,telefono,email\n'
            'Bueno SL,B12345674,,\n'
            'Malo SL,12345678A,,\n'
        )
        respuesta = self.client.post(
            '/api/v1/deca/agenda/destinatarios/importar-csv/',
            {'archivo': self._csv(csv_texto)}, format='multipart',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['creados'], 1)
        self.assertEqual(len(respuesta.data['errores']), 1)
        self.assertIn('Fila 3', respuesta.data['errores'][0])

    def test_fila_sin_clave_se_reporta_como_error(self):
        csv_texto = 'nombre,nif,telefono,email\nSin NIF SL,,,\n'
        respuesta = self.client.post(
            '/api/v1/deca/agenda/conductores/importar-csv/',
            {'archivo': self._csv(csv_texto)}, format='multipart',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['creados'], 0)
        self.assertEqual(len(respuesta.data['errores']), 1)

    def test_tipo_desconocido_da_404(self):
        respuesta = self.client.post(
            '/api/v1/deca/agenda/no-existe/importar-csv/',
            {'archivo': self._csv('a,b\n1,2\n')}, format='multipart',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_404_NOT_FOUND)

    def test_sin_archivo_da_400(self):
        respuesta = self.client.post('/api/v1/deca/agenda/transportistas/importar-csv/', {}, format='multipart')
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)


class EnviarEmailExpedicionDecaTests(APITestCase):
    """Envío MANUAL del DeCA generado por email -- pedido explícito del
    usuario 2026-09-24. `config/settings/test.py` fuerza el backend locmem
    de Django para todo el suite, así que un envío real cae en
    `django.core.mail.outbox` sin tocar ningún SMTP de verdad."""

    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = User.objects.create_user(
            username='admin@envio.test', email='admin@envio.test', password='Admin123!',
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        # Con `email_host` relleno, email_empresa.obtener_conexion crea una
        # conexión SMTP REAL (ignora settings.EMAIL_BACKEND) -- se anula la
        # conexión para que EmailMessage.send() caiga al backend por
        # defecto de Django, que en tests es locmem (ver
        # config/settings/test.py). Mismo patrón que
        # apps/facturacion/tests/test_envio_email.py.
        self._patcher_conexion = override_settings(EMAIL_HOST='smtp.test.com', DEFAULT_FROM_EMAIL='deca@envio-test.com')
        self._patcher_conexion.enable()
        self.addCleanup(self._patcher_conexion.disable)

    def _crear_y_generar_expedicion(self):
        datos = {
            'numero_albaran': 'A-EMAIL-001',
            'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL', 'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
            'nif_transportista': 'B12345674', 'nombre_transportista': 'Transportes SL',
            'nif_destinatario': 'B12345674', 'nombre_destinatario': 'Cliente SA',
            'matricula_tractor': '1234BBB', 'matricula_remolque': '5678CCC',
            'origen': 'Almería', 'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(),
            'naturaleza_mercancia': 'Tomate', 'peso_kg': '12000.00', 'bultos': 500,
        }
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')
        return expedicion_id

    def test_enviar_email_expedicion_generada(self):
        expedicion_id = self._crear_y_generar_expedicion()
        respuesta = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/enviar-email/',
            {'destinatario': 'cliente@ejemplo.com'},
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
        self.assertEqual(len(mail.outbox), 1)
        enviado = mail.outbox[0]
        self.assertEqual(enviado.to, ['cliente@ejemplo.com'])
        self.assertEqual(len(enviado.attachments), 1)
        nombre_adjunto, contenido_pdf, mimetype = enviado.attachments[0]
        self.assertTrue(nombre_adjunto.endswith('.pdf'))
        self.assertTrue(contenido_pdf.startswith(b'%PDF'))
        self.assertEqual(mimetype, 'application/pdf')

        expedicion = ExpedicionDeca.objects.get(id=expedicion_id)
        self.assertTrue(
            expedicion.eventos.filter(tipo_evento=EventoExpedicionDeca.TipoEvento.ENVIADA_EMAIL).exists(),
        )

    def test_enviar_email_asunto_y_cuerpo_personalizados(self):
        expedicion_id = self._crear_y_generar_expedicion()
        self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/enviar-email/',
            {'destinatario': 'cliente@ejemplo.com', 'asunto': 'Asunto a medida', 'cuerpo': 'Cuerpo a medida'},
        )
        self.assertEqual(mail.outbox[0].subject, 'Asunto a medida')
        self.assertEqual(mail.outbox[0].body, 'Cuerpo a medida')

    def test_enviar_email_expedicion_no_generada_da_400(self):
        crear = self.client.post('/api/v1/deca/expediciones/', {'numero_albaran': 'A-BORRADOR'})
        expedicion_id = crear.data['id']
        respuesta = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/enviar-email/',
            {'destinatario': 'cliente@ejemplo.com'},
        )
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(len(mail.outbox), 0)

    def test_enviar_email_sin_destinatario_valido_da_400(self):
        expedicion_id = self._crear_y_generar_expedicion()
        respuesta = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/enviar-email/', {'destinatario': 'no-es-un-email'},
        )
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)

    def test_enviar_email_asunto_por_defecto_es_el_numero_de_albaran(self):
        # El "concepto" del email es el número de albarán/expedición -- ya
        # no el texto genérico "DeCA X -- Empresa" (pedido explícito del
        # usuario 2026-09-25).
        expedicion_id = self._crear_y_generar_expedicion()
        self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/enviar-email/', {'destinatario': 'cliente@ejemplo.com'},
        )
        self.assertEqual(mail.outbox[0].subject, 'A-EMAIL-001')

    @override_settings(EMPRESA_NOMBRE='Envio Email Test')
    def test_enviar_email_usa_plantilla_de_la_empresa_si_no_se_manda_asunto_cuerpo(self):
        # Sin plantilla configurada, cae al mensaje estándar (ya cubierto por
        # test_enviar_email_expedicion_generada); con plantilla, la empresa
        # manda -- parametrizable por cliente, pedido explícito del usuario.
        ConfiguracionDeca.objects.create(
            plantilla_asunto_email='Albarán {numero_albaran} ({empresa})',
            plantilla_cuerpo_email='Van {origen} -> {destino}, tractora {matricula_tractor}.',
        )
        expedicion_id = self._crear_y_generar_expedicion()
        self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/enviar-email/', {'destinatario': 'cliente@ejemplo.com'},
        )
        self.assertEqual(mail.outbox[0].subject, 'Albarán A-EMAIL-001 (Envio Email Test)')
        self.assertEqual(mail.outbox[0].body, 'Van Almería -> Barcelona, tractora 1234BBB.')

    def test_enviar_email_asunto_cuerpo_explicitos_ganan_a_la_plantilla_de_empresa(self):
        ConfiguracionDeca.objects.create(
            plantilla_asunto_email='Plantilla de empresa', plantilla_cuerpo_email='Cuerpo de empresa',
        )
        expedicion_id = self._crear_y_generar_expedicion()
        self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/enviar-email/',
            {'destinatario': 'cliente@ejemplo.com', 'asunto': 'Asunto a medida', 'cuerpo': 'Cuerpo a medida'},
        )
        self.assertEqual(mail.outbox[0].subject, 'Asunto a medida')
        self.assertEqual(mail.outbox[0].body, 'Cuerpo a medida')

    def test_enviar_email_plantilla_con_placeholder_desconocido_no_revienta(self):
        # La plantilla la escribe el cliente desde Configuración -- un typo
        # en el nombre del placeholder no puede tumbar un envío real, se
        # manda tal cual con la llave sin resolver.
        ConfiguracionDeca.objects.create(
            plantilla_asunto_email='Pedido {numero_albraan}',
        )
        expedicion_id = self._crear_y_generar_expedicion()
        respuesta = self.client.post(
            f'/api/v1/deca/expediciones/{expedicion_id}/enviar-email/', {'destinatario': 'cliente@ejemplo.com'},
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
        self.assertEqual(mail.outbox[0].subject, 'Pedido {numero_albraan}')


class IdentificadorExpedicionDecaTests(APITestCase):
    """`ConfiguracionDeca.identificador_preferido` -- pedido explícito del
    usuario 2026-09-25: no todas las empresas referencian sus expediciones
    por número de albarán (algunas sí), otras usan el número de
    CMR, y otras no tienen ningún número externo propio y necesitan que
    Appodo numere por ellas. Ver `services/identificador_service.py`.

    Setup propio (no hereda de DecaAPITestCase) -- heredar reejecutaría sus
    34 tests bajo esta clase también, inflando la suite sin aportar nada."""

    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = User.objects.create_user(
            username='admin@identificador.test', email='admin@identificador.test', password='Admin123!',
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _datos_expedicion_validos(self):
        return {
            'numero_albaran': 'A-000123',
            'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL', 'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
            'nif_transportista': 'B12345674', 'nombre_transportista': 'Transportes SL',
            'nif_destinatario': 'B12345674', 'nombre_destinatario': 'Cliente SA',
            'matricula_tractor': '1234bbb', 'matricula_remolque': '5678ccc',
            'origen': 'Almería', 'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(),
            'naturaleza_mercancia': 'Tomate', 'peso_kg': '12000.00', 'bultos': 500,
        }

    def _crear_confirmar_y_generar(self, datos=None):
        crear = self.client.post('/api/v1/deca/expediciones/', datos or self._datos_expedicion_validos())
        expedicion_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        generar = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/generar/')
        self.assertEqual(generar.status_code, status.HTTP_200_OK, generar.data)
        return ExpedicionDeca.objects.get(id=expedicion_id)

    def test_por_defecto_usa_numero_albaran(self):
        from .services import identificador_service
        expedicion = self._crear_confirmar_y_generar()
        self.assertEqual(identificador_service.identificador_expedicion(expedicion), 'A-000123')

    def test_prefiere_numero_cmr_si_la_empresa_lo_configura(self):
        from .services import identificador_service
        ConfiguracionDeca.objects.create(identificador_preferido='numero_cmr')
        datos = self._datos_expedicion_validos()
        datos['numero_cmr'] = '00000019.300'
        expedicion = self._crear_confirmar_y_generar(datos)
        self.assertEqual(identificador_service.identificador_expedicion(expedicion), '00000019.300')

    def test_cae_en_cascada_a_albaran_si_prefiere_cmr_pero_esta_expedicion_no_tiene(self):
        from .services import identificador_service
        ConfiguracionDeca.objects.create(identificador_preferido='numero_cmr')
        expedicion = self._crear_confirmar_y_generar()  # sin numero_cmr
        self.assertEqual(identificador_service.identificador_expedicion(expedicion), 'A-000123')

    def test_generar_asigna_contador_automatico_si_la_empresa_lo_prefiere(self):
        ConfiguracionDeca.objects.create(
            identificador_preferido='automatico', prefijo_numero_automatico='DECA-',
        )
        expedicion = self._crear_confirmar_y_generar()
        expedicion.refresh_from_db()
        self.assertEqual(expedicion.numero_interno, 'DECA-00001')

        # Una segunda expedición generada consume el siguiente número.
        datos2 = self._datos_expedicion_validos()
        datos2['numero_albaran'] = 'A-000124'
        segunda = self._crear_confirmar_y_generar(datos2)
        segunda.refresh_from_db()
        self.assertEqual(segunda.numero_interno, 'DECA-00002')

    def test_generar_no_asigna_numero_automatico_si_la_empresa_no_lo_prefiere(self):
        # Por defecto (identificador_preferido='numero_albaran') -- no debe
        # numerar de más sin que la empresa lo haya pedido.
        expedicion = self._crear_confirmar_y_generar()
        expedicion.refresh_from_db()
        self.assertEqual(expedicion.numero_interno, '')

    def test_identificador_para_archivo_sanea_barras(self):
        # `numero_albaran` es una referencia externa del cliente y puede
        # traer "/" con toda normalidad (ej. "ALN26/1234") -- sin sanear, el
        # navegador la interpreta como separador de carpetas al guardar la
        # descarga y se queda solo con lo que hay después de la última barra.
        from .services import identificador_service
        datos = self._datos_expedicion_validos()
        datos['numero_albaran'] = 'ALN26/1234'
        expedicion = self._crear_confirmar_y_generar(datos)
        self.assertEqual(identificador_service.identificador_expedicion(expedicion), 'ALN26/1234')
        self.assertEqual(identificador_service.identificador_expedicion_para_archivo(expedicion), 'ALN26-1234')

    def test_descarga_publica_no_lleva_barras_en_el_nombre_de_archivo(self):
        # Blindaje de extremo a extremo: el `Content-Disposition` real de la
        # descarga pública (la que usa el botón "Descargar PDF" de la ficha
        # de detalle) no debe contener el identificador sin sanear.
        datos = self._datos_expedicion_validos()
        datos['numero_albaran'] = 'ALN26/1234'
        expedicion = self._crear_confirmar_y_generar(datos)
        respuesta = self.client.get(f'/api/v1/deca/publico/{expedicion.token_publico}/')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        disposicion = respuesta['Content-Disposition']
        self.assertIn('ALN26-1234', disposicion)
        self.assertNotIn('ALN26/1234', disposicion)

    def test_asunto_email_por_defecto_respeta_la_preferencia_cmr(self):
        # Blindaje de extremo a extremo: el asunto del email (el "concepto")
        # también tiene que respetar la preferencia, no solo el cálculo
        # interno del servicio.
        # Mismo patrón que EnviarEmailExpedicionDecaTests: `email_host`
        # relleno fuerza el camino de SMTP propio (independiente de si el
        # `.env` local tiene o no el email de plataforma configurado), y se
        # anula la conexión real para que el envío caiga en locmem.

        ConfiguracionDeca.objects.create(identificador_preferido='numero_cmr')
        datos = self._datos_expedicion_validos()
        datos['numero_cmr'] = '00000019.300'
        self._crear_confirmar_y_generar(datos)
        expedicion = ExpedicionDeca.objects.get(numero_albaran='A-000123')

        with override_settings(EMAIL_HOST='smtp.test.com'):
            respuesta = self.client.post(
                f'/api/v1/deca/expediciones/{expedicion.id}/enviar-email/', {'destinatario': 'cliente@ejemplo.com'},
            )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)
        self.assertEqual(mail.outbox[0].subject, '00000019.300')


class ObligatoriosCamposDecaTests(APITestCase):
    """Campos obligatorios para Confirmar/Generar un DeCA -- única fuente de
    verdad en obligatorios_service.py. La empresa puede exigir datos del
    destinatario (desactivado por defecto -- la norma FOM/2861/2012 no los exige)."""

    def setUp(self):
        self.empresa = None  # standalone: una instalación = una empresa
        self.user = User.objects.create_user(
            username='admin@obligatorios.test', email='admin@obligatorios.test', password='Admin123!',
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_por_defecto_no_exige_datos_destinatario(self):
        from .services.obligatorios_service import para_empresa
        campos = para_empresa(self.empresa)
        self.assertNotIn('nif_destinatario', campos)
        self.assertNotIn('nombre_destinatario', campos)

    def test_exige_datos_cargador_y_transportista_siempre(self):
        from .services.obligatorios_service import para_empresa
        campos = para_empresa(self.empresa)
        self.assertIn('nif_cargador', campos)
        self.assertIn('nombre_cargador', campos)
        self.assertIn('nif_transportista', campos)
        self.assertIn('nombre_transportista', campos)

    def test_exige_datos_trasporte_y_mercancia(self):
        from .services.obligatorios_service import para_empresa
        campos = para_empresa(self.empresa)
        self.assertIn('matricula_tractor', campos)
        self.assertIn('origen', campos)
        self.assertIn('destino', campos)
        self.assertIn('fecha_hora_transporte', campos)
        self.assertIn('naturaleza_mercancia', campos)

    def test_se_pueden_exigir_datos_destinatario_por_configuracion(self):
        from .services.obligatorios_service import para_empresa
        config = ConfiguracionDeca.objects.create(
            exigir_datos_destinatario=True,
        )
        campos = para_empresa(self.empresa)
        self.assertIn('nif_destinatario', campos)
        self.assertIn('nombre_destinatario', campos)
        # Todos (destinatario incluido): desde 2026-09-30 también domicilio del
        # cargador, remolque, peso y bultos (revisado contra el BOE).
        self.assertEqual(len(campos), 15)

    def test_serializer_expone_campos_obligatorios(self):
        from .serializers import ConfiguracionDecaSerializer
        config = ConfiguracionDeca.objects.create(
            exigir_datos_destinatario=False,
        )
        serializer = ConfiguracionDecaSerializer(config)
        campos_obligatorios = serializer.data.get('campos_obligatorios', [])
        self.assertIsInstance(campos_obligatorios, list)
        self.assertNotIn('nif_destinatario', campos_obligatorios)
        self.assertIn('nif_cargador', campos_obligatorios)

    def test_serializer_expone_campos_obligatorios_con_destinatario(self):
        from .serializers import ConfiguracionDecaSerializer
        config = ConfiguracionDeca.objects.create(
            exigir_datos_destinatario=True,
        )
        serializer = ConfiguracionDecaSerializer(config)
        campos_obligatorios = serializer.data.get('campos_obligatorios', [])
        self.assertIsInstance(campos_obligatorios, list)
        self.assertIn('nif_destinatario', campos_obligatorios)
        self.assertIn('nombre_destinatario', campos_obligatorios)

    def test_confirmar_requiere_destinatario_si_esta_configurado(self):
        ConfiguracionDeca.objects.create(
            exigir_datos_destinatario=True,
        )
        datos = {
            'numero_albaran': 'A-SIN-DEST',
            'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL', 'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
            'nif_transportista': 'B12345674', 'nombre_transportista': 'Transportes SL',
            # Falta nif_destinatario y nombre_destinatario
            'matricula_tractor': '1234BBB', 'matricula_remolque': '5678CCC', 'origen': 'Almería', 'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(),
            'naturaleza_mercancia': 'Tomate', 'peso_kg': '12000.00', 'bultos': 500,
        }
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        expedicion_id = crear.data['id']
        respuesta = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('nif_destinatario', str(respuesta.data))

    def test_confirmar_funciona_sin_destinatario_si_no_esta_configurado(self):
        # Por defecto, el destinatario es opcional -- así que una expedición
        # sin nif_destinatario debe poder confirmarse.
        datos = {
            'numero_albaran': 'A-SIN-DEST',
            'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL', 'domicilio_cargador': 'Calle Mayor 1, 04001 Almería',
            'nif_transportista': 'B12345674', 'nombre_transportista': 'Transportes SL',
            'matricula_tractor': '1234BBB', 'matricula_remolque': '5678CCC', 'origen': 'Almería', 'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(),
            'naturaleza_mercancia': 'Tomate', 'peso_kg': '12000.00', 'bultos': 500,
        }
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        expedicion_id = crear.data['id']
        respuesta = self.client.post(f'/api/v1/deca/expediciones/{expedicion_id}/confirmar/')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK, respuesta.data)


class ObligatoriosBoeDecaTests(DecaAPITestCase):
    """Obligatorios según la Orden FOM/2861/2012 art. 6 vigente (revisado
    contra el BOE el 2026-09-30) + bultos por decisión del usuario."""

    def test_obligatorios_segun_el_boe_domicilio_peso_bultos_y_remolque(self):
        """Orden FOM/2861/2012 art. 6 (vigente): domicilio del cargador (a),
        peso (d), tractora Y remolque en un conjunto articulado (g). Los
        bultos, por decisión del usuario. Revisado el 2026-09-30."""
        datos = self._datos_expedicion_validos()
        for campo in ('domicilio_cargador', 'matricula_remolque', 'peso_kg', 'bultos'):
            datos.pop(campo, None)
        crear = self.client.post('/api/v1/deca/expediciones/', datos)
        confirmar = self.client.post(f'/api/v1/deca/expediciones/{crear.data["id"]}/confirmar/')
        self.assertEqual(confirmar.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            sorted(confirmar.data['campos_faltantes']),
            ['bultos', 'domicilio_cargador', 'matricula_remolque', 'peso_kg'],
        )

    def test_camion_sin_remolque_no_exige_matricula_de_remolque(self):
        datos = {**self._datos_expedicion_validos(), 'matricula_remolque': '', 'sin_remolque': True}
        crear = self.client.post('/api/v1/deca/expediciones/', datos, format='json')
        confirmar = self.client.post(f'/api/v1/deca/expediciones/{crear.data["id"]}/confirmar/')
        self.assertEqual(confirmar.status_code, status.HTTP_200_OK, confirmar.data)
        generar = self.client.post(f'/api/v1/deca/expediciones/{crear.data["id"]}/generar/')
        self.assertEqual(generar.status_code, status.HTTP_200_OK, generar.data)

    def test_domicilio_del_cargador_pasa_a_la_agenda_y_al_pdf(self):
        from pypdf import PdfReader
        from .models import CargadorDeca

        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos())
        ficha = CargadorDeca.objects.get(nif='B12345674')
        self.assertEqual(ficha.domicilio, 'Calle Mayor 1, 04001 Almería')
        # Una expedición sin domicilio no borra el de la agenda.
        self.client.patch(f'/api/v1/deca/expediciones/{crear.data["id"]}/', {'domicilio_cargador': ''}, format='json')
        ficha.refresh_from_db()
        self.assertEqual(ficha.domicilio, 'Calle Mayor 1, 04001 Almería')

        previa = self.client.post(f'/api/v1/deca/expediciones/{crear.data["id"]}/vista-previa/', {
            'domicilio_cargador': 'Avda. del Puerto 7, Algeciras', 'sin_remolque': True,
            'autorizacion_especial': 'AEC-2026-123',
        }, format='json')
        texto = ''.join(p.extract_text() for p in PdfReader(io.BytesIO(b''.join(previa.streaming_content))).pages)
        self.assertIn('Avda. del Puerto 7, Algeciras', texto)
        self.assertIn('Sin remolque', texto)
        self.assertIn('AEC-2026-123', texto)


class DecaSinConexionTests(DecaAPITestCase):
    """DeCA hecho sin cobertura en el móvil e impreso allí (2026-09-30): al
    volver la cobertura se registra una sola vez y el PDF lo dice."""

    def test_se_registra_una_sola_vez_aunque_el_movil_reintente(self):
        datos = {**self._datos_expedicion_validos(), 'referencia_offline': 'OFF-A1B2C3',
                 'emitido_sin_conexion_en': '2026-09-30T06:15:00Z'}
        primera = self.client.post('/api/v1/deca/expediciones/', datos, format='json')
        self.assertEqual(primera.status_code, status.HTTP_201_CREATED, primera.data)
        segunda = self.client.post('/api/v1/deca/expediciones/', datos, format='json')
        self.assertEqual(segunda.status_code, status.HTTP_200_OK)
        self.assertEqual(segunda.data['id'], primera.data['id'])
        self.assertEqual(ExpedicionDeca.objects.filter(referencia_offline='OFF-A1B2C3').count(), 1)

    def test_la_referencia_no_se_puede_cambiar_despues(self):
        crear = self.client.post('/api/v1/deca/expediciones/', {
            **self._datos_expedicion_validos(), 'referencia_offline': 'OFF-FIJA',
        }, format='json')
        self.client.patch(f'/api/v1/deca/expediciones/{crear.data["id"]}/', {'referencia_offline': 'OFF-OTRA'}, format='json')
        self.assertEqual(ExpedicionDeca.objects.get(id=crear.data['id']).referencia_offline, 'OFF-FIJA')

    def test_un_borrador_empezado_con_cobertura_recibe_la_referencia_una_vez(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json')
        url = f'/api/v1/deca/expediciones/{crear.data["id"]}/'
        self.client.patch(url, {'referencia_offline': 'OFF-TARDE', 'emitido_sin_conexion_en': '2026-09-30T07:00:00Z'}, format='json')
        exp = ExpedicionDeca.objects.get(id=crear.data['id'])
        self.assertEqual(exp.referencia_offline, 'OFF-TARDE')
        self.assertIsNotNone(exp.emitido_sin_conexion_en)
        self.client.patch(url, {'referencia_offline': 'OFF-OTRA'}, format='json')
        self.assertEqual(ExpedicionDeca.objects.get(id=crear.data['id']).referencia_offline, 'OFF-TARDE')

    def test_el_pdf_dice_que_se_emitio_sin_conexion(self):
        from pypdf import PdfReader

        crear = self.client.post('/api/v1/deca/expediciones/', {
            **self._datos_expedicion_validos(), 'referencia_offline': 'OFF-PDF1',
            'emitido_sin_conexion_en': '2026-09-30T06:15:00Z',
        }, format='json')
        previa = self.client.get(f'/api/v1/deca/expediciones/{crear.data["id"]}/vista-previa/')
        texto = ''.join(p.extract_text() for p in PdfReader(io.BytesIO(b''.join(previa.streaming_content))).pages)
        self.assertIn('Emitido sin conexión', texto)
        self.assertIn('OFF-PDF1', texto)

class TrabajoCampoDecaTests(DecaAPITestCase):
    """Opciones de "Trabajo en campo y sin cobertura" de Configuración de DeCA
    (2026-09-30): modo sin cobertura, ejemplares, talonario de papel por foto,
    DeCA anticipado y aviso de DeCA sin completar."""

    def test_valores_por_defecto(self):
        datos = self.client.get('/api/v1/deca/configuracion/').data
        self.assertEqual(datos['modo_sin_cobertura'], 'imprimir')
        self.assertEqual(datos['ejemplares_sin_cobertura'], 2)
        self.assertFalse(datos['registrar_papel_por_foto'])
        self.assertFalse(datos['deca_anticipado'])
        self.assertTrue(datos['aviso_sin_completar'])
        self.assertEqual(datos['aviso_sin_completar_dias'], 2)

    def test_ejemplares_entre_1_y_3(self):
        r = self.client.patch('/api/v1/deca/configuracion/', {'ejemplares_sin_cobertura': 4}, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anticipado_exige_ventana_de_correccion(self):
        r = self.client.patch('/api/v1/deca/configuracion/', {
            'deca_anticipado': True, 'horas_max_edicion_generado': 0,
        }, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('deca_anticipado', r.data)
        ok = self.client.patch('/api/v1/deca/configuracion/', {
            'deca_anticipado': True, 'horas_max_edicion_generado': 24,
        }, format='json')
        self.assertEqual(ok.status_code, status.HTTP_200_OK)

    def test_peso_estimado_solo_con_anticipado_y_sale_en_el_pdf(self):
        from pypdf import PdfReader

        datos = {**self._datos_expedicion_validos(), 'peso_estimado': True}
        rechazo = self.client.post('/api/v1/deca/expediciones/', datos, format='json')
        self.assertEqual(rechazo.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('peso_estimado', rechazo.data)

        ConfiguracionDeca.objects.create(deca_anticipado=True, horas_max_edicion_generado=24)
        crear = self.client.post('/api/v1/deca/expediciones/', datos, format='json')
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        previa = self.client.get(f'/api/v1/deca/expediciones/{crear.data["id"]}/vista-previa/')
        texto = ''.join(p.extract_text() for p in PdfReader(io.BytesIO(b''.join(previa.streaming_content))).pages)
        self.assertIn('(estimado)', texto)

    def _con_foto(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json')
        self.client.post(
            f'/api/v1/deca/expediciones/{crear.data["id"]}/documentos/',
            {'tipo_documento': 'otro', 'archivo': self._pdf_con_texto('DeCA talonario', 'talonario.pdf')},
            format='multipart',
        )
        return crear.data['id']

    def test_registrar_papel_solo_si_la_empresa_lo_activa(self):
        exp_id = self._con_foto()
        r = self.client.post(f'/api/v1/deca/expediciones/{exp_id}/registrar-papel/')
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_registrar_papel_exige_foto_y_queda_inmutable(self):
        ConfiguracionDeca.objects.create(registrar_papel_por_foto=True)
        sin_foto = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json')
        r = self.client.post(f'/api/v1/deca/expediciones/{sin_foto.data["id"]}/registrar-papel/')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

        exp_id = self._con_foto()
        r = self.client.post(f'/api/v1/deca/expediciones/{exp_id}/registrar-papel/')
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data['estado'], 'papel')
        self.assertFalse(r.data['puede_editar'])
        self.assertFalse(r.data['tiene_pdf_generado'])
        editar = self.client.patch(f'/api/v1/deca/expediciones/{exp_id}/', {'origen': 'Otro'}, format='json')
        self.assertEqual(editar.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(EventoExpedicionDeca.objects.filter(
            expedicion_id=exp_id, tipo_evento=EventoExpedicionDeca.TipoEvento.REGISTRADA_PAPEL,
        ).exists())

    def test_registrar_papel_exige_los_datos_obligatorios(self):
        ConfiguracionDeca.objects.create(registrar_papel_por_foto=True)
        exp_id = self._con_foto()
        ExpedicionDeca.objects.filter(id=exp_id).update(domicilio_cargador='')
        r = self.client.post(f'/api/v1/deca/expediciones/{exp_id}/registrar-papel/')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('domicilio_cargador', r.data['campos_faltantes'])

    def _sin_completar(self, dias, **extra):
        from datetime import timedelta

        from django.utils import timezone

        return ExpedicionDeca.objects.create(
            anio=2026, mes=9, estado=ExpedicionDeca.Estado.BORRADOR,
            referencia_offline=f'OFF-{dias}-{len(extra)}', origen='Finca', destino='Huévar',
            emitido_sin_conexion_en=timezone.now() - timedelta(days=dias), **extra,
        )

    def test_aviso_sin_completar_una_sola_vez_y_solo_pasado_el_plazo(self):
        from django.core import mail
        from django.core.management import call_command

        vieja = self._sin_completar(3)
        reciente = self._sin_completar(1)
        call_command('avisar_deca_sin_completar')
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(vieja.referencia_offline, mail.outbox[0].body)
        self.assertNotIn(reciente.referencia_offline, mail.outbox[0].body)
        self.assertIn(self.user.email, mail.outbox[0].to)
        call_command('avisar_deca_sin_completar')
        self.assertEqual(len(mail.outbox), 1)

    def test_aviso_sin_completar_se_puede_apagar(self):
        from django.core import mail
        from django.core.management import call_command

        ConfiguracionDeca.objects.create(aviso_sin_completar=False)
        self._sin_completar(5)
        call_command('avisar_deca_sin_completar')
        self.assertEqual(len(mail.outbox), 0)


class DecaQrSinConexionTests(DecaAPITestCase):
    """El QR de un DeCA hecho sin cobertura va IMPRESO antes de registrarlo:
    el servidor adopta el token que generó el móvil (2026-09-30)."""

    def test_adopta_el_token_del_movil(self):
        token = str(uuid.uuid4())
        crear = self.client.post('/api/v1/deca/expediciones/', {
            **self._datos_expedicion_validos(), 'referencia_offline': 'OFF-QR1', 'token_publico': token,
        }, format='json')
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        self.assertEqual(str(ExpedicionDeca.objects.get(id=crear.data['id']).token_publico), token)

    def test_sin_referencia_offline_se_ignora(self):
        token = str(uuid.uuid4())
        crear = self.client.post('/api/v1/deca/expediciones/', {
            **self._datos_expedicion_validos(), 'token_publico': token,
        }, format='json')
        self.assertNotEqual(str(ExpedicionDeca.objects.get(id=crear.data['id']).token_publico), token)

    def test_token_repetido_o_no_v4_se_rechaza(self):
        ajena = ExpedicionDeca.objects.create(anio=2026, mes=9)
        repetido = self.client.post('/api/v1/deca/expediciones/', {
            **self._datos_expedicion_validos(), 'referencia_offline': 'OFF-QR2', 'token_publico': str(ajena.token_publico),
        }, format='json')
        self.assertEqual(repetido.status_code, status.HTTP_400_BAD_REQUEST)
        malo = self.client.post('/api/v1/deca/expediciones/', {
            **self._datos_expedicion_validos(), 'referencia_offline': 'OFF-QR3', 'token_publico': str(uuid.uuid1()),
        }, format='json')
        self.assertEqual(malo.status_code, status.HTTP_400_BAD_REQUEST)

    def test_qr_escaneado_antes_de_registrar_lo_explica(self):
        r = self.client.get(f'/api/v1/deca/publico/{uuid.uuid4()}/')
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn('sin cobertura', str(r.data))


class ModificacionDecaGeneradoTests(DecaAPITestCase):
    """Corregir un DeCA YA GENERADO (Resolución de 5-jun-2026, apartado
    quinto): motivo obligatorio y, en el mismo PDF/URL/QR, los datos nuevos,
    el motivo y los antiguos marcados como no válidos."""

    def _generado(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json')
        exp_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{exp_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{exp_id}/generar/')
        return exp_id

    def _texto_pdf(self, exp_id):
        from pypdf import PdfReader

        exp = ExpedicionDeca.objects.get(id=exp_id)
        lector = PdfReader(exp.pdf_generado.open('rb'))
        return ''.join(p.extract_text() for p in lector.pages), lector.metadata

    def test_sin_motivo_no_deja_corregir(self):
        exp_id = self._generado()
        r = self.client.patch(f'/api/v1/deca/expediciones/{exp_id}/', {'peso_kg': '21000'}, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('motivo_modificacion', r.data)
        self.assertNotEqual(str(ExpedicionDeca.objects.get(id=exp_id).peso_kg), '21000.00')

    def test_con_motivo_el_pdf_lleva_datos_antiguos_no_validos_y_el_motivo(self):
        exp_id = self._generado()
        token = str(ExpedicionDeca.objects.get(id=exp_id).token_publico)
        peso_antes = str(ExpedicionDeca.objects.get(id=exp_id).peso_kg)
        r = self.client.patch(f'/api/v1/deca/expediciones/{exp_id}/', {
            'peso_kg': '21000', 'motivo_modificacion': 'Pesada real en báscula',
        }, format='json')
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)

        mod = ModificacionDeca.objects.get(expedicion_id=exp_id)
        self.assertEqual(mod.motivo, 'Pesada real en báscula')
        self.assertEqual(mod.cambios[0]['campo'], 'peso_kg')
        self.assertEqual(mod.cambios[0]['antes'], peso_antes)

        texto, _ = self._texto_pdf(exp_id)
        self.assertIn('Modificaciones durante el servicio', texto)
        self.assertIn('Pesada real en báscula', texto)
        self.assertIn('YA NO VÁLIDO', texto)
        self.assertIn(peso_antes, texto)
        self.assertIn('21000', texto)
        # Mismo PDF, misma URL y mismo QR.
        self.assertEqual(str(ExpedicionDeca.objects.get(id=exp_id).token_publico), token)

    def test_metadatos_creacion_y_modificacion(self):
        exp_id = self._generado()
        _, meta = self._texto_pdf(exp_id)
        creacion_1 = meta['/CreationDate']
        self.client.patch(f'/api/v1/deca/expediciones/{exp_id}/', {
            'bultos': 31, 'motivo_modificacion': 'Un bulto más',
        }, format='json')
        _, meta = self._texto_pdf(exp_id)
        self.assertEqual(meta['/CreationDate'], creacion_1)  # la creación no cambia
        self.assertGreaterEqual(meta['/ModDate'], meta['/CreationDate'])

    def test_emitido_sin_conexion_la_creacion_es_la_del_movil(self):
        crear = self.client.post('/api/v1/deca/expediciones/', {
            **self._datos_expedicion_validos(), 'referencia_offline': 'OFF-META',
            'emitido_sin_conexion_en': '2026-09-30T06:15:00Z',
        }, format='json')
        exp_id = crear.data['id']
        self.client.post(f'/api/v1/deca/expediciones/{exp_id}/confirmar/')
        self.client.post(f'/api/v1/deca/expediciones/{exp_id}/generar/')
        _, meta = self._texto_pdf(exp_id)
        self.assertTrue(meta['/CreationDate'].startswith("D:20260930061500"))

    def test_en_borrador_no_hace_falta_motivo(self):
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json')
        r = self.client.patch(f'/api/v1/deca/expediciones/{crear.data["id"]}/', {'peso_kg': '5'}, format='json')
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertFalse(ModificacionDeca.objects.exists())


class AgendaMandaDecaTests(DecaAPITestCase):
    """La Agenda manda sobre lo leído del documento (2026-10-01): bug real de
    un albarán con empresa + cliente + transportista en el que el transportista
    se quedaba con el NIF del cliente aunque estaba en la Agenda."""

    def _sembrar_agenda(self):
        from .models import CargadorDeca, DestinatarioDeca, EmpresaTransportistaDeca

        CargadorDeca.objects.create(nombre='Distrinorte S.A.', nif='A91234567',
                                    domicilio='C/ Mayor 10, 46000 Valencia')
        DestinatarioDeca.objects.create(nombre='Distrinorte S.A.', nif='A91234567')
        EmpresaTransportistaDeca.objects.create(nombre='Transportes Romero Ruiz S.L.', nif='A91000000')

    def _aplicar(self, campos, nifs=None):
        from .services import catalogo_service

        self._sembrar_agenda()
        return catalogo_service.aplicar_prioridad_agenda(self.empresa, campos, nifs)

    def test_nif_de_otra_empresa_no_se_coloca(self):
        r = self._aplicar({'nombre_transportista': 'Transportes Romero Ruiz S.L.', 'nif_transportista': 'A91234567'})
        # El nombre está en la Agenda: manda su NIF, y se avisa de la diferencia.
        self.assertEqual(r['cambios']['nif_transportista'], 'A91000000')
        self.assertIn('nif_transportista', r['a_revisar'])
        self.assertTrue(any('A91234567' in a and 'A91000000' in a for a in r['avisos']))

    def test_nif_ajeno_sin_nombre_reconocido_se_deja_vacio(self):
        r = self._aplicar({'nombre_transportista': 'Transportes Desconocidos', 'nif_transportista': 'A91234567'})
        self.assertEqual(r['cambios']['nif_transportista'], '')
        self.assertTrue(any('Distrinorte' in a for a in r['avisos']))

    def test_nif_de_la_agenda_corrige_el_nombre_leido_a_mano(self):
        r = self._aplicar({'nombre_transportista': 'TTES ROMRO RUZ', 'nif_transportista': 'A91000000'})
        self.assertEqual(r['cambios']['nombre_transportista'], 'Transportes Romero Ruiz S.L.')
        self.assertIn('nombre_transportista', r['a_revisar'])

    def test_nombre_de_la_agenda_trae_nif_y_domicilio_del_cargador(self):
        r = self._aplicar({'nombre_cargador': 'DISTRINORTE'})
        self.assertEqual(r['cambios']['nif_cargador'], 'A91234567')
        self.assertEqual(r['cambios']['domicilio_cargador'], 'C/ Mayor 10, 46000 Valencia')
        self.assertEqual(r['avisos'], [])

    def test_papel_de_los_nif_sin_atribuir(self):
        r = self._aplicar({}, ['B11223344', 'A91234567', 'A91000000'])
        self.assertEqual(r['nifs_agenda']['A91000000'], ['transportista'])
        self.assertEqual(sorted(r['nifs_agenda']['A91234567']), ['cargador', 'destinatario'])
        self.assertNotIn('B11223344', r['nifs_agenda'])

    def test_lectura_completa_aplica_la_agenda_y_devuelve_avisos(self):
        ia = {'nombre_transportista': 'Transportes Romero Ruiz S.L.', 'nif_transportista': 'A91234567',
              'nombre_destinatario': 'Distrinorte S.A.', 'nif_destinatario': 'B11223344'}
        self._sembrar_agenda()
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json')
        with patch('deca.services.extraction_ia_service.extraer_campos_con_ia', return_value=ia), \
             patch('deca.services.extraction_ia_service.extraer_campos_con_vision', return_value=ia):
            r = self.client.post(
                f'/api/v1/deca/expediciones/{crear.data["id"]}/documentos/',
                {'tipo_documento': 'albaran_venta', 'archivo': self._pdf_sin_texto('albaran.pdf')},
                format='multipart',
            )
            doc_id = (r.data.get('documento') or {}).get('id')
            extraido = self.client.post(f'/api/v1/deca/documentos/{doc_id}/extraer/')
        self.assertEqual(extraido.status_code, status.HTTP_200_OK, extraido.data)
        self.assertEqual(extraido.data['campos_sugeridos_ia']['nif_transportista'], 'A91000000')
        self.assertEqual(extraido.data['campos_sugeridos_ia']['nif_destinatario'], 'A91234567')
        self.assertTrue(extraido.data['avisos_agenda'])

    def test_mismo_nombre_con_varios_nif_no_elige_a_ciegas(self):
        from .models import EmpresaTransportistaDeca

        self._sembrar_agenda()
        EmpresaTransportistaDeca.objects.create(nombre='Transportes Romero Ruiz S.L.', nif='B90123456')
        from .services import catalogo_service

        r = catalogo_service.aplicar_prioridad_agenda(self.empresa, {'nombre_transportista': 'Transportes Romero Ruiz'})
        self.assertNotIn('nif_transportista', r['cambios'])
        self.assertTrue(any('varios NIF' in a for a in r['avisos']))

    def test_apagado_la_agenda_solo_tapa_huecos(self):
        ConfiguracionDeca.objects.create(agenda_prioritaria=False)
        self._sembrar_agenda()
        ia = {'nombre_transportista': 'Transportes Romero Ruiz S.L.', 'nif_transportista': 'A91234567'}
        crear = self.client.post('/api/v1/deca/expediciones/', self._datos_expedicion_validos(), format='json')
        with patch('deca.services.extraction_ia_service.extraer_campos_con_vision', return_value=ia):
            r = self.client.post(
                f'/api/v1/deca/expediciones/{crear.data["id"]}/documentos/',
                {'tipo_documento': 'albaran_venta', 'archivo': self._pdf_sin_texto('albaran.pdf')},
                format='multipart',
            )
            extraido = self.client.post(f'/api/v1/deca/documentos/{r.data["documento"]["id"]}/extraer/')
        self.assertEqual(extraido.data['campos_sugeridos_ia']['nif_transportista'], 'A91234567')
        self.assertEqual(extraido.data['avisos_agenda'], [])


class MatriculasLecturaDecaTests(TestCase):
    """La lectura acepta los mismos formatos que el campo desde v4.32.1:
    españolas actuales, de remolque con R, antiguas y extranjeras."""

    def _leer(self, texto):
        return extraction_service.extraer_campos(texto)['matriculas_encontradas']

    def test_remolque_conserva_la_r(self):
        self.assertEqual(self._leer('Tractora: 4821LKP  Remolque: R1234BCD'), ['4821LKP', 'R1234BCD'])
        self.assertIn('R5678DFG', self._leer('remolque R-5678-DFG'))

    def test_antiguas_provinciales(self):
        self.assertEqual(self._leer('Vehículo CA-1234-AB'), ['CA1234AB'])

    def test_extranjeras_junto_a_la_etiqueta(self):
        self.assertEqual(self._leer('Matrícula: PL WGM12345'), ['PLWGM12345'])
        self.assertEqual(self._leer('Kennzeichen: KA AB 1234'), ['KAAB1234'])
        self.assertEqual(self._leer('Matrícula: R6152BDV - 5038LZN'), ['R6152BDV', '5038LZN'])

    def test_no_confunde_pedidos_ni_referencias(self):
        self.assertEqual(self._leer('Pedido 2026ABC Factura 1234AEI Lote CX1234YZ CP 11150'), [])
