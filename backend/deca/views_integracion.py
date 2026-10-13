"""Integración del DeCA con el ERP de la empresa (sync con Appodo v4.40-v4.49).

Un programa instalado en la red de la empresa (un conector que lee la base de
datos de su ERP, o el propio ERP) envía cada albarán de salida a
`POST /api/v1/deca/integracion/expediciones/` con una clave de integración en
la cabecera `X-Api-Key`, y recibe el DeCA ya generado (o el borrador con lo
que le falta). La conexión la abre siempre el programa de la empresa hacia
esta instalación: su servidor no necesita puertos abiertos ni IP pública.

Standalone: una instalación = una empresa, así que la clave no lleva empresa
y las claves las crea y revoca el administrador (is_staff) desde
Configuración; la clave completa se enseña una sola vez.
"""

import logging
import re
from zoneinfo import ZoneInfo

from django.conf import settings

from django.contrib.auth.models import AnonymousUser
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions, status
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .models import ClaveIntegracionDeca, EventoExpedicionDeca, ExpedicionDeca, ReferenciaErpDescartada
from .serializers import ClaveIntegracionDecaSerializer, ExpedicionDecaSerializer
from .services import auditoria_service, catalogo_service, generacion_service, integracion_service, obligatorios_service
from .views import CAMPOS_AUDITABLES_EXPEDICION, _texto_dato, _url_publica

logger = logging.getLogger(__name__)

# Lo que puede mandar el programa externo: los datos del envío, nada de
# estado ni de lo que pone el sistema. `peso_estimado` se queda fuera: es una
# decisión de quien hace el DeCA anticipado aquí, no un dato del albarán.
CAMPOS_INTEGRACION = [c for c in CAMPOS_AUDITABLES_EXPEDICION if c != 'peso_estimado']

_ESTADOS_ACTUALIZABLES = (ExpedicionDeca.Estado.BORRADOR, ExpedicionDeca.Estado.CONFIRMADO)
# Ya hay un documento que viaja con el camión: si el ERP cambia, se avisa.
_ESTADOS_CON_DOCUMENTO = (ExpedicionDeca.Estado.GENERADO, ExpedicionDeca.Estado.PAPEL)
_VERDADERO = (True, 'true', 'True', '1', 1)
# Hora local de la instalación: la que trae el ERP en sus fechas.
_ZONA = ZoneInfo(settings.TIME_ZONE or 'Europe/Madrid')


# ─── Autenticación por clave ────────────────────────────────────────────────

class ClaveIntegracionDecaAuthentication(BaseAuthentication):
    """`X-Api-Key: deca_xxxxxxxx_...`. Sin cabecera no autentica (y el permiso
    responde 401); con una clave que no vale, 401 sin decir por qué.

    En DRF una clase de "authentication" identifica QUIÉN llama. Aquí no es
    una persona con login sino un programa externo con una API key."""

    def authenticate(self, request):
        """Devuelve la tupla (usuario, auth) si la clave vale, None si no hay
        cabecera, o lanza AuthenticationFailed (401) si la clave es mala. Aquí
        `request.auth` pasa a ser la ClaveIntegracionDeca, que luego usan las vistas."""
        texto = (request.META.get('HTTP_X_API_KEY') or '').strip()
        if not texto:
            return None
        clave = integracion_service.autenticar(texto)
        if clave is None:
            raise AuthenticationFailed('Clave de integración no válida o revocada.')
        return AnonymousUser(), clave

    def authenticate_header(self, request):
        """Valor de la cabecera WWW-Authenticate; hace que un fallo salga como 401 y no como 403."""
        return 'Api-Key'


class ClaveValida(permissions.BasePermission):
    """Solo pasa quien se autenticó con una clave de integración (no un
    usuario con sesión): la ingesta es para programas, no para personas."""
    message = 'Hace falta una clave de integración (cabecera X-Api-Key).'

    def has_permission(self, request, view):
        return isinstance(request.auth, ClaveIntegracionDeca)


class DecaIntegracionThrottle(SimpleRateThrottle):
    """Por clave, no por IP: todo un almacén sale por la misma IP."""
    scope = 'deca_integracion'

    def get_cache_key(self, request, view):
        """Identifica "quién" cuenta para el límite: la clave (su pk). La tasa
        se configura en los settings con el nombre del `scope`."""
        clave = request.auth
        if not isinstance(clave, ClaveIntegracionDeca):
            return None
        return self.cache_format % {'scope': self.scope, 'ident': clave.pk}


# ─── Ingesta ────────────────────────────────────────────────────────────────

def _anotar_cambios_erp(request, expedicion: ExpedicionDeca, datos: dict, clave) -> None:
    """El ERP reenvía un envío cuyo DeCA ya existe como documento (generado o
    en papel). No se cambia el DeCA: se guarda qué es distinto para que la
    pantalla lo marque en rojo y una persona decida (corregir o anular).

    Solo cuenta lo que el ERP manda con valor: un dato que el ERP no tiene
    (p. ej. el NIF que se completó aquí) no es una modificación."""
    # El serializer se usa solo para validar/normalizar `datos` (NIF, fechas...)
    # y poder comparar valor a valor con lo que ya tiene el DeCA.
    serializer = ExpedicionDecaSerializer(data=datos, context={'request': request})
    serializer.is_valid(raise_exception=True)
    diferencias = [
        {'campo': campo, 'en_deca': _texto_dato(getattr(expedicion, campo)), 'en_erp': _texto_dato(valor)}
        for campo, valor in serializer.validated_data.items()
        if campo in CAMPOS_AUDITABLES_EXPEDICION and valor not in (None, '') and getattr(expedicion, campo) != valor
    ]
    if diferencias == expedicion.cambios_erp:
        return  # ya avisado (el conector reenvía cada poco)
    if diferencias and diferencias == expedicion.cambios_erp_descartados:
        return  # alguien ya lo revisó y lo dejó así
    expedicion.cambios_erp = diferencias
    expedicion.cambios_erp_en = timezone.now() if diferencias else None
    expedicion.save(update_fields=['cambios_erp', 'cambios_erp_en', 'fecha_actualizacion'])
    if diferencias:
        auditoria_service.registrar_evento(
            expedicion, EventoExpedicionDeca.TipoEvento.CAMBIO_ERP,
            detalle=f'La integración «{clave.nombre}» envió datos distintos después de emitir el DeCA: ' + '; '.join(
                f'{d["campo"]}: «{d["en_deca"]}» → «{d["en_erp"]}»' for d in diferencias
            ) + '. El DeCA no se ha cambiado.',
        )


def _albaran_normalizado(texto) -> str:
    """'AV1 / 481' y 'AV1/481' son el mismo albarán: a mano se escribe
    con espacios, el ERP sin ellos."""
    return re.sub(r'\s+', '', texto or '').upper()


def _hecha_a_mano(numero_albaran):
    """DeCA del mismo albarán que alguien hizo a mano (no llegó del ERP).
    Caso típico: logística ya los hacía a mano y al conectar el ERP salían
    duplicados. Si hay varios, manda el que ya es documento (generado o en
    papel) y, entre iguales, el más reciente."""
    buscado = _albaran_normalizado(numero_albaran)
    numeros = re.findall(r'\d+', buscado)
    if not numeros:
        return None
    candidatos = [
        e for e in ExpedicionDeca.objects.filter(
            clave_integracion__isnull=True, numero_albaran__icontains=numeros[-1],
        ).exclude(estado=ExpedicionDeca.Estado.ANULADO)
        if _albaran_normalizado(e.numero_albaran) == buscado
    ]
    if not candidatos:
        return None
    return max(candidatos, key=lambda e: (e.estado in _ESTADOS_CON_DOCUMENTO, e.fecha_alta))


def _enlazar_con_la_hecha_a_mano(manual, sobrante, referencia, clave):
    """El DeCA hecho a mano se queda con la referencia del ERP (así el
    conector lo reconoce en los siguientes envíos) y el borrador que creó el
    ERP, si lo había, se borra: nadie lo ha emitido y duplicaba el envío."""
    # transaction.atomic(): todo lo del bloque se guarda junto o no se guarda
    # nada. Si falla algo a medias, no queda el borrador borrado sin enlazar.
    with transaction.atomic():
        if sobrante:
            sobrante.delete()
        manual.referencia_externa = referencia
        manual.save(update_fields=['referencia_externa', 'fecha_actualizacion'])
        auditoria_service.registrar_evento(
            manual, EventoExpedicionDeca.TipoEvento.EDITADA,
            detalle=f'Enlazada con el envío {referencia} de la integración «{clave.nombre}»: este DeCA ya se '
                    'había hecho a mano, así que no se crea otro'
                    + (' y se borra el borrador duplicado que había llegado del ERP.' if sobrante else '.'),
        )



def _respuesta(request, expedicion: ExpedicionDeca, ya_existia: bool) -> dict:
    """JSON que se devuelve al programa externo: estado del DeCA, qué campos
    faltan (si sigue en borrador), URL pública (si ya se generó) y su hash."""
    generado = expedicion.estado == ExpedicionDeca.Estado.GENERADO
    faltantes = (
        obligatorios_service.faltantes(expedicion) if expedicion.estado in _ESTADOS_ACTUALIZABLES else []
    )
    return {
        'id': str(expedicion.id),
        'referencia_externa': expedicion.referencia_externa,
        'estado': expedicion.estado,
        'numero_albaran': expedicion.numero_albaran,
        'numero_interno': expedicion.numero_interno,
        'campos_faltantes': faltantes,
        # La dirección del QR: abre el PDF del DeCA mientras siga vigente.
        'url_publica': _url_publica(request, expedicion) if generado else None,
        'hash_sha256': expedicion.hash_sha256 or None,
        'fecha_generacion': expedicion.fecha_generacion.isoformat() if expedicion.fecha_generacion else None,
        'ya_existia': ya_existia,
        # Datos que el ERP cambió después de emitir el DeCA (no aplicados).
        'cambios_erp': expedicion.cambios_erp,
    }


@extend_schema(exclude=True)
class IngestaExpedicionDecaView(APIView):
    """POST: recibe un envío y devuelve su DeCA. GET `?referencia=`: estado
    del DeCA de ese envío (para saber si un borrador ya se completó).

    - Primera vez que llega una referencia: crea la expedición y, si están
      todos los datos obligatorios, la genera (QR + PDF). Si falta alguno,
      queda en borrador y la respuesta dice cuáles: alguien lo completa en
      la pantalla. Nunca se inventa un dato.
    - Llega otra vez y sigue en borrador: se actualiza con los datos nuevos y
      se vuelve a intentar generar (el ERP ya tiene, p. ej., la matrícula).
    - Llega otra vez y ya está generado, anulado o en papel: no se toca y se
      devuelve tal cual (`ya_existia: true`). Corregir un DeCA generado es
      una decisión de una persona aquí, con su motivo.

    `generar: false` deja siempre el borrador para revisarlo aquí."""
    authentication_classes = [ClaveIntegracionDecaAuthentication]
    permission_classes = [ClaveValida]
    throttle_classes = [DecaIntegracionThrottle]

    def get(self, request):
        """Consulta el estado de un envío por su `?referencia=`."""
        referencia = (request.query_params.get('referencia') or '').strip()
        if not referencia:
            raise ValidationError({'referencia': 'Indica la referencia del envío.'})
        expedicion = get_object_or_404(ExpedicionDeca, referencia_externa=referencia)
        return Response(_respuesta(request, expedicion, ya_existia=True))

    def post(self, request):
        """Flujo de ingesta: (1) valida la referencia, (2) filtra los campos
        permitidos, (3) completa NIF desde la Agenda, (4) decide si crear,
        actualizar, enlazar con un DeCA hecho a mano o solo anotar cambios,
        y (5) si no falta nada, confirma y genera el DeCA. Es idempotente:
        reenviar el mismo envío no crea duplicados."""
        clave = request.auth
        integracion_service.anotar_uso(clave)

        referencia = str(request.data.get('referencia_externa') or '').strip()
        if not referencia:
            raise ValidationError({'referencia_externa': 'Falta la referencia del envío en tu programa (p. ej. el número de albarán).'})
        if len(referencia) > 100:
            raise ValidationError({'referencia_externa': 'La referencia no puede pasar de 100 caracteres.'})
        generar = request.data.get('generar', True) in _VERDADERO
        # Lista blanca: solo se copian los campos permitidos; cualquier otro
        # que mande el programa externo (estado, empresa, hash...) se ignora.
        datos = {c: request.data[c] for c in CAMPOS_INTEGRACION if c in request.data}
        # `peso_neto_kg` es el nombre claro para el ERP; en el DeCA, el neto es
        # `peso_kg`. `peso_bruto_kg` ya entra tal cual (CAMPOS_INTEGRACION).
        if 'peso_kg' not in datos and 'peso_neto_kg' in request.data:
            datos['peso_kg'] = request.data['peso_neto_kg']
        # El ERP suele traer el nombre del transportista pero no su NIF: se
        # completa desde la Agenda, igual que al leer un documento. Si la
        # coincidencia no es exacta (una errata en el nombre), nadie la ha
        # revisado: el DeCA se queda en borrador para que alguien la confirme.
        completados, a_revisar = catalogo_service.completar_nifs_desde_catalogo(None, datos)
        datos.update(completados)
        avisos = [
            f'NIF {completados[c]} puesto desde la Agenda por un nombre parecido a «{datos.get(c.replace("nif_", "nombre_"), "")}»: '
            'compruébalo antes de generar el DeCA.'
            for c in completados if c in a_revisar
        ]
        detalle = f'Recibida de la integración «{clave.nombre}» (referencia {referencia}).'

        # Alguien borró su borrador aquí: el conector lo seguirá
        # reenviando unos días y no debe volver a aparecer.
        if ReferenciaErpDescartada.objects.filter(referencia_externa=referencia).exists():
            return Response({
                'referencia_externa': referencia, 'estado': 'descartado', 'campos_faltantes': [],
                'url_publica': None, 'ya_existia': True, 'cambios_erp': [],
            }, status=status.HTTP_200_OK)

        existente = ExpedicionDeca.objects.filter(referencia_externa=referencia).first()
        # Un DeCA hecho a mano aquí no lo toca nunca el ERP: ni se
        # actualiza ni se marca "Modificado en el ERP" (lo escrito a mano
        # difiere en la forma, no en el envío).
        if existente and not existente.clave_integracion_id:
            return Response(_respuesta(request, existente, ya_existia=True), status=status.HTTP_200_OK)
        if existente is None or existente.estado == ExpedicionDeca.Estado.BORRADOR:
            manual = _hecha_a_mano(datos.get('numero_albaran'))
            if manual:
                _enlazar_con_la_hecha_a_mano(manual, existente, referencia, clave)
                return Response(_respuesta(request, manual, ya_existia=True), status=status.HTTP_200_OK)
        if existente and existente.estado not in _ESTADOS_ACTUALIZABLES:
            if existente.estado in _ESTADOS_CON_DOCUMENTO:
                with timezone.override(_ZONA):
                    _anotar_cambios_erp(request, existente, datos, clave)
            return Response(_respuesta(request, existente, ya_existia=True), status=status.HTTP_200_OK)

        cambio = True
        try:
            # La fecha llega en hora local (TIME_ZONE) y sin zona horaria
            # (así lo pide la guía): sin esto, DRF la tomaba como UTC y las
            # 07:30 del albarán salían como 09:30.
            # transaction.atomic(): crear/actualizar y anotar el evento van
            # juntos o no van. Si dos peticiones crean la misma referencia a la
            # vez, la restricción única de la BD hace saltar IntegrityError (abajo).
            with timezone.override(_ZONA), transaction.atomic():
                if existente:
                    serializer = ExpedicionDecaSerializer(
                        existente, data=datos, partial=True, context={'request': request},
                    )
                    serializer.is_valid(raise_exception=True)
                    # El conector reenvía cada poco lo que sigue en borrador:
                    # si no llega nada distinto, ni se guarda ni se anota.
                    cambio = any(getattr(existente, k) != v for k, v in serializer.validated_data.items())
                    if cambio:
                        expedicion = serializer.save()
                        auditoria_service.registrar_evento(
                            expedicion, EventoExpedicionDeca.TipoEvento.EDITADA, detalle=detalle,
                        )
                    else:
                        expedicion = existente
                else:
                    serializer = ExpedicionDecaSerializer(data=datos, context={'request': request})
                    serializer.is_valid(raise_exception=True)
                    expedicion = serializer.save(
                        referencia_externa=referencia, clave_integracion=clave,
                    )
                    auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.CREADA, detalle=detalle)
        except IntegrityError:
            # Dos envíos de la misma referencia a la vez: ganó el otro.
            expedicion = ExpedicionDeca.objects.get(referencia_externa=referencia)
            return Response(_respuesta(request, expedicion, ya_existia=True), status=status.HTTP_200_OK)

        # Alimenta la agenda igual que un DeCA hecho a mano -- salvo con una
        # coincidencia dudosa: guardaría el nombre con la errata junto a un
        # NIF que nadie ha confirmado.
        if cambio and not avisos:
            for guardar in (
                catalogo_service.guardar_conductor_de, catalogo_service.guardar_transportista_de,
                catalogo_service.guardar_destinatario_de, catalogo_service.guardar_cargador_de,
                catalogo_service.guardar_tractora_de, catalogo_service.guardar_remolque_de,
            ):
                guardar(expedicion)

        if avisos:
            if cambio:
                auditoria_service.registrar_evento(
                    expedicion, EventoExpedicionDeca.TipoEvento.EDITADA, detalle=' '.join(avisos),
                )
        elif generar and not obligatorios_service.faltantes(expedicion):
            # Camino automático completo: BORRADOR -> CONFIRMADO -> GENERADO
            # sin intervención humana, solo si no falta ningún dato obligatorio.
            expedicion.estado = ExpedicionDeca.Estado.CONFIRMADO
            expedicion.save(update_fields=['estado', 'fecha_actualizacion'])
            auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.CONFIRMADA, detalle=detalle)
            # Si el PDF falla, generar() ya lo ha deshecho todo (sin número
            # consumido) y la expedición queda CONFIRMADA: un estado válido,
            # desde el que alguien puede pulsar "Generar" aquí. Al ERP
            # se le dice con un aviso en vez de un 500 sin explicación, porque
            # la expedición SÍ se recibió y guardó.
            try:
                expedicion = generacion_service.generar(expedicion, _url_publica(request, expedicion), detalle=detalle)
            except generacion_service.ErrorGeneracionDeca:
                avisos.append(
                    'La expedición se ha recibido y confirmado, pero no se ha podido generar el PDF del DeCA. '
                    'Se puede generar desde la pantalla.'
                )

        datos_respuesta = _respuesta(request, expedicion, ya_existia=existente is not None)
        datos_respuesta['avisos'] = avisos
        return Response(datos_respuesta, status=status.HTTP_200_OK if existente else status.HTTP_201_CREATED)


# ─── Gestión de claves (pantalla de Configuración) ──────────────────────────

# Gestionar claves es cosa del administrador de la instalación (is_staff):
# una clave da acceso de escritura a las expediciones.
CLAVES_PERMS = [IsAuthenticated, IsAdminUser]


class ClaveIntegracionDecaListCreateView(generics.ListCreateAPIView):
    """Lista y alta de claves. La respuesta del alta es el ÚNICO sitio donde
    sale la clave completa (`clave`)."""
    permission_classes = CLAVES_PERMS
    serializer_class = ClaveIntegracionDecaSerializer
    pagination_class = None

    def get_queryset(self):
        # annotate: el nº de expediciones de cada clave sale en la misma
        # consulta (antes, un COUNT por clave al serializar el listado).
        return ClaveIntegracionDeca.objects.select_related(
            'creada_por', 'revocada_por',
        ).annotate(n_expediciones=Count('expediciones'))

    def create(self, request, *args, **kwargs):
        """Crea la clave y devuelve, solo esta vez, el texto completo en `clave`."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        clave, texto = integracion_service.crear_clave(
            serializer.validated_data['nombre'], usuario=request.user,
        )
        datos = self.get_serializer(clave).data
        datos['clave'] = texto
        return Response(datos, status=status.HTTP_201_CREATED)


class RevocarClaveIntegracionDecaView(APIView):
    """Deja la clave sin efecto para siempre. No se borra: las expediciones
    que llegaron con ella siguen diciendo de dónde vinieron."""
    permission_classes = CLAVES_PERMS

    def post(self, request, pk):
        """Revoca la clave `pk`."""
        clave = get_object_or_404(ClaveIntegracionDeca, pk=pk)
        integracion_service.revocar(clave, usuario=request.user)
        return Response(ClaveIntegracionDecaSerializer(clave, context={'request': request}).data)
