"""Tests de Appodo DeCa standalone.

Adaptado del `tests.py` del ERP origen -- se ha quitado todo el andamiaje de
multi-tenant (`Empresa`, `EmpresaModulo`, `Modulo`, los tests de aislamiento
entre empresas) porque ya no aplica: una instalación = una empresa. Se
mantiene la cobertura de lo que sí sigue siendo relevante aquí: el ciclo de
vida de una expedición (borrador -> confirmado -> generado -> descarga
pública), la extracción por regex (pura), los catálogos de Agenda, permisos
admin-only y el comando de purga de IPs.

# TODO(standalone): esta suite es más pequeña que la del ERP origen
(58KB/~40 tests) -- no se ha re-portado exhaustivamente cada caso límite
(ej. todos los tests de vista previa con marca de agua, todos los formatos
de fecha de la extracción regex). Cubre el camino principal de cada pieza;
antes de un release público conviene ampliarla.
"""
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

from django.test import override_settings

from django.contrib.auth import get_user_model
from django.core import mail
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import (
    ConductorDeca,
    ConfiguracionDeca,
    DestinatarioDeca,
    EmpresaTransportistaDeca,
    EventoExpedicionDeca,
    ExpedicionDeca,
    RemolqueDeca,
    TractoraDeca,
)
from .services import extraction_service, storage_service

User = get_user_model()

DATOS_MINIMOS_CONFIRMAR = {
    'nif_cargador': 'B12345674',
    'nombre_cargador': 'Cargador SL',
    'nif_transportista': 'A12345674',
    'nombre_transportista': 'Transportista SL',
    'nif_destinatario': 'B87654323',
    'nombre_destinatario': 'Destinatario SL',
    'matricula_tractor': '1234BBB',
    'origen': 'Sevilla',
    'destino': 'Madrid',
    'fecha_hora_transporte': '2026-09-25T08:00:00Z',
    'naturaleza_mercancia': 'Fruta y verdura',
}


class DecaAPITestCase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin', email='admin@test.local', password='Admin123!', is_staff=True,
        )
        self.operador = User.objects.create_user(
            username='operador', email='operador@test.local', password='Operador123!', is_staff=False,
        )
        self.client.force_authenticate(user=self.admin)


class ConfiguracionDecaTests(DecaAPITestCase):
    def test_se_crea_sola_con_valores_por_defecto(self):
        respuesta = self.client.get(reverse('deca-configuracion'))
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(ConfiguracionDeca.objects.count(), 1)
        self.assertEqual(respuesta.data['dias_visibilidad_publica'], 10)

    def test_es_singleton_de_verdad(self):
        primera = ConfiguracionDeca.get_solo()
        primera.dias_visibilidad_publica = 20
        primera.save()
        segunda = ConfiguracionDeca.get_solo()
        self.assertEqual(ConfiguracionDeca.objects.count(), 1)
        self.assertEqual(segunda.dias_visibilidad_publica, 20)

    def test_operador_no_puede_ver_configuracion(self):
        self.client.force_authenticate(user=self.operador)
        respuesta = self.client.get(reverse('deca-configuracion'))
        self.assertEqual(respuesta.status_code, status.HTTP_403_FORBIDDEN)

    def test_no_se_puede_bajar_dias_visibilidad_del_minimo_legal(self):
        respuesta = self.client.patch(reverse('deca-configuracion'), {'dias_visibilidad_publica': 3}, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)


class ExpedicionCicloDeVidaTests(DecaAPITestCase):
    def _crear_borrador(self, **overrides):
        datos = {**DATOS_MINIMOS_CONFIRMAR, **overrides}
        respuesta = self.client.post(reverse('deca-expediciones'), datos, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)
        return respuesta.data

    def test_crear_borrador_deriva_anio_mes_de_fecha_transporte(self):
        expedicion = self._crear_borrador()
        obj = ExpedicionDeca.objects.get(id=expedicion['id'])
        self.assertEqual(obj.anio, 2026)
        self.assertEqual(obj.mes, 9)
        self.assertEqual(obj.estado, ExpedicionDeca.Estado.BORRADOR)
        self.assertEqual(obj.creado_por, self.admin)

    def test_crear_borrador_vacio_es_valido(self):
        """Un borrador puede nacer sin los campos mínimos -- se exigen solo
        al Confirmar, no al crear (permite subir un documento y extraer)."""
        respuesta = self.client.post(reverse('deca-expediciones'), {}, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED, respuesta.data)

    def test_nif_invalido_se_rechaza(self):
        respuesta = self.client.post(
            reverse('deca-expediciones'), {**DATOS_MINIMOS_CONFIRMAR, 'nif_cargador': '00000000A'}, format='json',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('nif_cargador', respuesta.data)

    def test_confirmar_con_campos_faltantes_falla(self):
        expedicion = self._crear_borrador(nombre_cargador='')
        respuesta = self.client.post(
            reverse('deca-expedicion-confirmar', args=[expedicion['id']]),
        )
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('nombre_cargador', respuesta.data['campos_faltantes'])

    def test_confirmar_y_generar_completo(self):
        expedicion = self._crear_borrador()
        eid = expedicion['id']

        respuesta = self.client.post(reverse('deca-expedicion-confirmar', args=[eid]))
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['estado'], ExpedicionDeca.Estado.CONFIRMADO)

        respuesta = self.client.post(reverse('deca-expedicion-generar', args=[eid]))
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['estado'], ExpedicionDeca.Estado.GENERADO)
        self.assertTrue(respuesta.data['hash_sha256'])

        obj = ExpedicionDeca.objects.get(id=eid)
        self.assertTrue(obj.pdf_generado)
        self.assertTrue(storage_service.acceso_publico_vigente(obj))

        eventos = list(obj.eventos.values_list('tipo_evento', flat=True))
        self.assertIn(EventoExpedicionDeca.TipoEvento.CREADA, eventos)
        self.assertIn(EventoExpedicionDeca.TipoEvento.CONFIRMADA, eventos)
        self.assertIn(EventoExpedicionDeca.TipoEvento.GENERADA, eventos)

    def test_no_se_puede_editar_una_expedicion_generada(self):
        expedicion = self._crear_borrador()
        eid = expedicion['id']
        self.client.post(reverse('deca-expedicion-confirmar', args=[eid]))
        self.client.post(reverse('deca-expedicion-generar', args=[eid]))

        respuesta = self.client.patch(reverse('deca-expedicion-detalle', args=[eid]), {'origen': 'Cambiado'}, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)

    def test_editar_una_confirmada_la_devuelve_a_borrador(self):
        expedicion = self._crear_borrador()
        eid = expedicion['id']
        self.client.post(reverse('deca-expedicion-confirmar', args=[eid]))

        respuesta = self.client.patch(reverse('deca-expedicion-detalle', args=[eid]), {'origen': 'Cádiz'}, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['estado'], ExpedicionDeca.Estado.BORRADOR)

    def test_generar_sin_confirmar_falla(self):
        expedicion = self._crear_borrador()
        respuesta = self.client.post(reverse('deca-expedicion-generar', args=[expedicion['id']]))
        self.assertEqual(respuesta.status_code, status.HTTP_403_FORBIDDEN)

    def test_anular_genera_evento_y_bloquea_descarga_publica(self):
        expedicion = self._crear_borrador()
        eid = expedicion['id']
        self.client.post(reverse('deca-expedicion-confirmar', args=[eid]))
        generada = self.client.post(reverse('deca-expedicion-generar', args=[eid])).data
        token = generada['token_publico']

        # La descarga pública funciona mientras está GENERADO.
        respuesta = self.client.get(reverse('deca-descarga-publica', args=[token]))
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

        respuesta = self.client.post(reverse('deca-expedicion-anular', args=[eid]), {'motivo': 'Error de datos'}, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['estado'], ExpedicionDeca.Estado.ANULADO)

        # Tras anular, la vía pública deja de servir el PDF.
        self.client.logout()
        respuesta = self.client.get(reverse('deca-descarga-publica', args=[token]))
        self.assertEqual(respuesta.status_code, status.HTTP_404_NOT_FOUND)

    def test_borrar_borrador_permitido(self):
        expedicion = self._crear_borrador()
        respuesta = self.client.delete(reverse('deca-expedicion-detalle', args=[expedicion['id']]))
        self.assertEqual(respuesta.status_code, status.HTTP_204_NO_CONTENT)

    def test_no_se_puede_borrar_una_anulada_con_pdf_generado(self):
        expedicion = self._crear_borrador()
        eid = expedicion['id']
        self.client.post(reverse('deca-expedicion-confirmar', args=[eid]))
        self.client.post(reverse('deca-expedicion-generar', args=[eid]))
        self.client.post(reverse('deca-expedicion-anular', args=[eid]), {}, format='json')

        respuesta = self.client.delete(reverse('deca-expedicion-detalle', args=[eid]))
        self.assertEqual(respuesta.status_code, status.HTTP_403_FORBIDDEN)

    def test_catalogos_se_autoalimentan_al_crear(self):
        self._crear_borrador(
            nombre_conductor='Juan Pérez', nif_conductor='12345678Z',
            matricula_remolque='5678CCC',
        )
        self.assertTrue(ConductorDeca.objects.filter(nif='12345678Z').exists())
        self.assertTrue(EmpresaTransportistaDeca.objects.filter(nif='A12345674').exists())
        self.assertTrue(DestinatarioDeca.objects.filter(nif='B87654323').exists())
        self.assertTrue(TractoraDeca.objects.filter(matricula='1234BBB').exists())
        self.assertTrue(RemolqueDeca.objects.filter(matricula='5678CCC').exists())


class AgendaDecaTests(DecaAPITestCase):
    def test_crud_destinatario(self):
        respuesta = self.client.post(
            reverse('deca-destinatarios'), {'nombre': 'Cliente Uno', 'nif': 'B12345674'}, format='json',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        pk = respuesta.data['id']

        respuesta = self.client.patch(reverse('deca-destinatario-detalle', args=[pk]), {'activo': False}, format='json')
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertFalse(DestinatarioDeca.objects.get(id=pk).activo)

    def test_solo_activos_filtra(self):
        DestinatarioDeca.objects.create(nombre='Vigente', nif='B12345674')
        DestinatarioDeca.objects.create(nombre='Archivado', nif='A12345674', activo=False)

        respuesta = self.client.get(reverse('deca-destinatarios'), {'solo_activos': 'true'})
        nombres = [d['nombre'] for d in respuesta.data['results']]
        self.assertIn('Vigente', nombres)
        self.assertNotIn('Archivado', nombres)

    def test_paginacion_admite_page_size_grande(self):
        DestinatarioDeca.objects.bulk_create([
            DestinatarioDeca(nombre=f'Cliente {i}', nif=f'B{i:08d}') for i in range(60)
        ])
        respuesta = self.client.get(reverse('deca-destinatarios'), {'page_size': 100})
        self.assertEqual(len(respuesta.data['results']), 60)


class ImportarAgendaDecaTests(DecaAPITestCase):
    def test_importar_csv_crea_y_actualiza(self):
        csv_contenido = (
            'nombre,nif,telefono,email\r\n'
            'Porteador Uno,B12345674,600111222,uno@test.local\r\n'
            'Porteador Dos,A12345674,600333444,dos@test.local\r\n'
        ).encode('utf-8')
        from django.core.files.uploadedfile import SimpleUploadedFile
        archivo = SimpleUploadedFile('agenda.csv', csv_contenido, content_type='text/csv')

        respuesta = self.client.post(
            reverse('deca-agenda-importar-csv', args=['transportistas']), {'archivo': archivo}, format='multipart',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['creados'], 2)
        self.assertEqual(EmpresaTransportistaDeca.objects.count(), 2)


class ExtraccionRegexTests(APITestCase):
    """Capa pura -- sin BD, sin autenticación."""

    def test_extraer_peso_con_decimales(self):
        campos = extraction_service.extraer_campos('Peso neto: 116.969,00 Kg')
        self.assertEqual(campos['peso_kg'], '116969.00')

    def test_peso_entero_sin_decimales_no_se_confunde_con_ruido(self):
        campos = extraction_service.extraer_campos('C.LOGIFRUIT 612 7Kg MD CEL.VAR')
        self.assertIsNone(campos['peso_kg'])

    def test_extraer_nifs_y_matriculas(self):
        campos = extraction_service.extraer_campos('CIF B12345674 matrícula 1234BBB otra vez B12345674')
        self.assertIn('B12345674', campos['nifs_encontrados'])
        self.assertEqual(len(campos['nifs_encontrados']), 1)  # sin duplicados
        self.assertIn('1234BBB', campos['matriculas_encontradas'])

    def test_fecha_espanola_se_normaliza_a_iso(self):
        campos = extraction_service.extraer_campos('Fecha de carga: 22/09/2026')
        self.assertEqual(campos['fecha_hora_transporte'], '2026-09-22T00:00:00Z')

    def test_identificar_tipo_documento(self):
        self.assertEqual(extraction_service.identificar_tipo_documento('CARTA DE PORTE CMR'), 'cmr')
        self.assertEqual(extraction_service.identificar_tipo_documento('ALBARAN DE VENTA Nº 123'), 'albaran_venta')
        self.assertIsNone(extraction_service.identificar_tipo_documento('texto sin pistas'))


class EnviarEmailExpedicionDecaTests(DecaAPITestCase):
    def _generar_expedicion(self):
        respuesta = self.client.post(reverse('deca-expediciones'), DATOS_MINIMOS_CONFIRMAR, format='json')
        eid = respuesta.data['id']
        self.client.post(reverse('deca-expedicion-confirmar', args=[eid]))
        self.client.post(reverse('deca-expedicion-generar', args=[eid]))
        return eid

    def test_enviar_email_sin_generar_falla(self):
        respuesta = self.client.post(reverse('deca-expediciones'), {}, format='json')
        eid = respuesta.data['id']
        respuesta = self.client.post(
            reverse('deca-expedicion-enviar-email', args=[eid]), {'destinatario': 'cliente@test.local'}, format='json',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(EMAIL_HOST='smtp.test.local')
    def test_enviar_email_generado_ok(self):
        eid = self._generar_expedicion()
        respuesta = self.client.post(
            reverse('deca-expedicion-enviar-email', args=[eid]), {'destinatario': 'cliente@test.local'}, format='json',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['cliente@test.local'])
        self.assertEqual(len(mail.outbox[0].attachments), 1)

        obj = ExpedicionDeca.objects.get(id=eid)
        self.assertTrue(obj.eventos.filter(tipo_evento=EventoExpedicionDeca.TipoEvento.ENVIADA_EMAIL).exists())


class PurgarIpsEventosDecaTests(DecaAPITestCase):
    def test_purga_respeta_retencion_configurada(self):
        from django.core.management import call_command
        from django.utils import timezone
        from datetime import timedelta

        expedicion = ExpedicionDeca.objects.create(anio=2026, mes=1)
        evento_antiguo = EventoExpedicionDeca.objects.create(
            expedicion=expedicion, tipo_evento=EventoExpedicionDeca.TipoEvento.DESCARGA_PUBLICA,
            ip_origen='1.2.3.4',
        )
        EventoExpedicionDeca.objects.filter(pk=evento_antiguo.pk).update(
            fecha_alta=timezone.now() - timedelta(days=400),
        )

        call_command('purgar_ips_eventos_deca')

        evento_antiguo.refresh_from_db()
        self.assertIsNone(evento_antiguo.ip_origen)


class CookieAuthTests(APITestCase):
    """El login/refresh/logout ya NO devuelven el JWT en el JSON -- lo
    setean como cookies HttpOnly (`access_token`/`refresh_token`), mismo
    mecanismo de seguridad que el ERP origen. Estos tests pasan por el
    flujo real (sin `force_authenticate`) para probar
    `JWTCookieAuthentication` de verdad."""

    def setUp(self):
        self.usuario = User.objects.create_user(
            username='cookieuser', email='cookie@test.local', password='Cookie123!', is_staff=True,
        )

    def test_login_setea_cookies_httponly_sin_exponer_token_en_json(self):
        respuesta = self.client.post(
            reverse('token_obtain_pair'), {'username': 'cookieuser', 'password': 'Cookie123!'}, format='json',
        )
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertNotIn('access', respuesta.data)
        self.assertNotIn('access_token', respuesta.data)

        self.assertIn('access_token', respuesta.cookies)
        self.assertIn('refresh_token', respuesta.cookies)
        self.assertTrue(respuesta.cookies['access_token']['httponly'])
        self.assertTrue(respuesta.cookies['refresh_token']['httponly'])
        self.assertEqual(respuesta.cookies['access_token']['samesite'], 'Lax')

    def test_endpoint_protegido_funciona_solo_con_la_cookie(self):
        self.client.post(reverse('token_obtain_pair'), {'username': 'cookieuser', 'password': 'Cookie123!'}, format='json')
        # Sin `force_authenticate` ni cabecera Authorization -- solo la
        # cookie que el propio test client ya conserva tras el login.
        respuesta = self.client.get(reverse('auth-me'))
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data['username'], 'cookieuser')

    def test_sin_cookie_da_401(self):
        respuesta = self.client.get(reverse('auth-me'))
        self.assertEqual(respuesta.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_renueva_la_cookie_de_access(self):
        login = self.client.post(reverse('token_obtain_pair'), {'username': 'cookieuser', 'password': 'Cookie123!'}, format='json')
        access_original = login.cookies['access_token'].value

        respuesta = self.client.post(reverse('token_refresh'))
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertIn('access_token', respuesta.cookies)
        # Nueva cookie de access presente (no comprobamos que cambie el
        # valor -- con la misma jornada/segundo simplejwt puede generar un
        # JWT idéntico si el payload no incluye jti único en este setup).
        self.assertTrue(respuesta.cookies['access_token']['httponly'])
        self.assertIsNotNone(access_original)

    def test_logout_borra_las_cookies(self):
        self.client.post(reverse('token_obtain_pair'), {'username': 'cookieuser', 'password': 'Cookie123!'}, format='json')
        respuesta = self.client.post(reverse('auth-logout'))
        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.cookies['access_token'].value, '')
        self.assertEqual(respuesta.cookies['refresh_token'].value, '')

        respuesta = self.client.get(reverse('auth-me'))
        self.assertEqual(respuesta.status_code, status.HTTP_401_UNAUTHORIZED)


class AiClientTests(APITestCase):
    """El cliente de IA nunca debe lanzar hacia arriba desde
    `extraction_ia_service` -- cualquier fallo (sin clave, timeout, JSON
    ilegible) se traduce en `None`, para que la subida del documento nunca
    se rompa por esto."""

    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_fallo_de_ia_no_rompe_la_extraccion(self, mock_call):
        from .services import extraction_ia_service
        mock_call.side_effect = Exception('sin clave configurada')
        resultado = extraction_ia_service.extraer_campos_con_ia('texto cualquiera')
        self.assertIsNone(resultado)

    @patch('deca.services.extraction_ia_service.call_text_api')
    def test_json_valido_se_filtra_a_campos_conocidos(self, mock_call):
        from .services import extraction_ia_service
        mock_call.return_value = '{"nif_cargador": "B12345674", "campo_desconocido": "x"}'
        resultado = extraction_ia_service.extraer_campos_con_ia('texto')
        self.assertEqual(resultado, {'nif_cargador': 'B12345674'})
