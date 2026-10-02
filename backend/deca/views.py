import csv
import io
import logging
import mimetypes
import uuid

from django.conf import settings
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.filters import OrderingFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from core_utils.ip_cliente import ip_cliente as _ip_cliente
from core_utils.validacion_ficheros import FicheroNoValido, preparar_documento
from core_utils.validadores_fiscales import normalizar as _normalizar_clave_importacion

from django.db.models import Q

from .models import (
    AliasAgendaDeca,
    CargadorDeca,
    ConductorDeca,
    ConfiguracionDeca,
    ModificacionDeca,
    DestinatarioDeca,
    DocumentoOrigenDeca,
    EmpresaTransportistaDeca,
    EventoExpedicionDeca,
    ExpedicionDeca,
    LecturaCampoDeca,
    PlantillaDocumentoDeca,
    RemolqueDeca,
    TractoraDeca,
    TransportistaSucesivoDeca,
)
from .serializers import (
    AliasAgendaDecaSerializer,
    CargadorDecaSerializer,
    ConductorDecaSerializer,
    ConfiguracionDecaSerializer,
    DestinatarioDecaSerializer,
    DocumentoOrigenDecaSerializer,
    EmpresaTransportistaDecaSerializer,
    EventoExpedicionDecaSerializer,
    ExpedicionDecaEnviarEmailSerializer,
    ExpedicionDecaSerializer,
    PlantillaDocumentoDecaSerializer,
    RemolqueDecaSerializer,
    TractoraDecaSerializer,
    TransportistaSucesivoDecaSerializer,
)
from .services import (
    aprendizaje_service, auditoria_service, catalogo_service, extraction_ia_service, extraction_service,
    identificador_service, pdf_service, plantillas_service, qr_service, storage_service,
)

logger = logging.getLogger(__name__)


# Sin `IsDecaActive`/módulo activo (decisión de arquitectura: DeCA es la
# única app instalada, no hay catálogo de módulos que activar/desactivar).
DECA_PERMS = [IsAuthenticated]
# Configuración y gestión de usuarios son las únicas pantallas admin-only
# (decisión de arquitectura: solo dos roles, `is_staff` True/False).
DECA_ADMIN_PERMS = [IsAuthenticated, IsAdminUser]


class _LecturaOAdmin(permissions.BasePermission):
    """Métodos de lectura para cualquiera; escritura solo `is_staff`."""

    def has_permission(self, request, view):
        return request.method in permissions.SAFE_METHODS or bool(request.user and request.user.is_staff)

# Obligatorios para Confirmar/Generar: ver services/obligatorios_service.py
# (el destinatario solo cuenta si la empresa lo activa -- la norma no lo exige).
from .services.obligatorios_service import CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR  # noqa: E402,F401
from .services.obligatorios_service import para_empresa as campos_obligatorios_para_confirmar  # noqa: E402,F401
from .services import obligatorios_service  # noqa: E402


# Campos de datos reales de la expedición (no estado/metadatos internos) --
# se usa para calcular qué cambió en cada PATCH y dejarlo en el historial
# (ExpedicionDecaDetailView.perform_update), no solo "se editó".
CAMPOS_AUDITABLES_EXPEDICION = [
    'numero_albaran', 'numero_cmr',
    'nif_cargador', 'nombre_cargador', 'domicilio_cargador',
    'nif_transportista', 'nombre_transportista',
    'nif_destinatario', 'nombre_destinatario',
    'matricula_tractor', 'matricula_remolque', 'sin_remolque', 'autorizacion_especial',
    'origen', 'destino', 'fecha_hora_transporte',
    'naturaleza_mercancia', 'peso_kg', 'peso_estimado', 'bultos', 'volumen_m3', 'codigo_mercancia',
    'numero_pedido', 'instrucciones_conductor', 'contacto_emergencias', 'tipo_contenedor',
    'instrucciones_expedidor', 'instrucciones_pago', 'comentarios',
    'nombre_conductor', 'nif_conductor', 'telefono_conductor', 'email_conductor',
]


def _texto_dato(valor) -> str:
    """Valor legible de un campo para el registro de modificaciones del DeCA."""
    if valor is None or valor == '':
        return ''
    if isinstance(valor, bool):
        return 'Sí' if valor else 'No'
    if hasattr(valor, 'strftime'):
        return valor.strftime('%d/%m/%Y %H:%M')
    return str(valor)


class DecaLecturaPublicaThrottle(AnonRateThrottle):
    scope = 'deca_publico'


def _nombre_usuario(usuario):
    return usuario.get_full_name() or usuario.username


# ─── Configuración ──────────────────────────────────────────────────────────

class ConfiguracionDecaView(generics.RetrieveUpdateAPIView):
    """Fila única (singleton) -- se crea sola con los valores por defecto la
    primera vez que se pide (`get_or_create`, nunca 404 en la primera visita
    a la pantalla). La LEE cualquier usuario autenticado (el formulario y el
    alta móvil la necesitan: obligatorios, modo sin cobertura, la agenda
    manda...); solo el admin de la instalación puede EDITARLA."""
    permission_classes = [IsAuthenticated, _LecturaOAdmin]
    serializer_class = ConfiguracionDecaSerializer

    def get_object(self):
        return ConfiguracionDeca.get_solo()


# ─── Expediciones (CRUD) ────────────────────────────────────────────────────

class ExpedicionDecaListCreateView(generics.ListCreateAPIView):
    permission_classes = DECA_PERMS
    serializer_class = ExpedicionDecaSerializer
    filter_backends = [OrderingFilter]
    # nombre_cargador/transportista/destinatario y matricula_tractor son
    # CharField reales del modelo, ordenables directamente. creado_por y
    # acceso_publico_vigente son SerializerMethodField (calculados) -- NO
    # se incluyen aquí sin anotar la query.
    ordering_fields = [
        'fecha_alta', 'fecha_hora_transporte', 'numero_albaran', 'estado',
        'nombre_cargador', 'nombre_transportista', 'nombre_destinatario', 'matricula_tractor',
    ]
    ordering = ['-fecha_alta']

    def get_queryset(self):
        qs = ExpedicionDeca.objects.all()
        estado = self.request.query_params.get('estado')
        if estado:
            qs = qs.filter(estado=estado)
        q = self.request.query_params.get('q')
        if q:
            qs = qs.filter(numero_albaran__icontains=q)
        return qs

    def create(self, request, *args, **kwargs):
        # DeCA hecho sin cobertura: el móvil puede reenviarlo varias veces
        # (red intermitente al volver). Con la misma referencia, se devuelve
        # la expedición que ya existe en vez de crear otra -- solo dentro de
        # la propia empresa.
        referencia = (request.data.get('referencia_offline') or '').strip()
        if referencia:
            existente = ExpedicionDeca.objects.filter(
                referencia_offline=referencia,
            ).first()
            if existente:
                datos = self.get_serializer(existente).data
                return Response(datos, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        extra = {}
        # DeCA hecho sin cobertura: el QR ya va IMPRESO en el papel que viaja
        # en el camión, con un token que generó el móvil. El servidor adopta
        # ese mismo token para que el QR del papel lleve a este DeCA en cuanto
        # se registre. Solo junto a una referencia offline (nunca en un alta
        # normal) y solo un UUID v4 que no use ya otro DeCA.
        token = self.request.data.get('token_publico')
        if token and (self.request.data.get('referencia_offline') or '').strip():
            try:
                token_uuid = uuid.UUID(str(token))
            except ValueError:
                raise ValidationError({'token_publico': 'Código de QR no válido.'})
            if token_uuid.version != 4:
                raise ValidationError({'token_publico': 'Código de QR no válido.'})
            if ExpedicionDeca.objects.filter(token_publico=token_uuid).exists():
                raise ValidationError({'token_publico': 'Ese código de QR ya lo usa otro DeCA.'})
            extra['token_publico'] = token_uuid
        expedicion = serializer.save(creado_por=self.request.user, **extra)
        auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.CREADA, usuario=self.request.user)
        catalogo_service.guardar_conductor_de(expedicion)
        catalogo_service.guardar_transportista_de(expedicion)
        catalogo_service.guardar_destinatario_de(expedicion)
        catalogo_service.guardar_cargador_de(expedicion)
        catalogo_service.guardar_tractora_de(expedicion)
        catalogo_service.guardar_remolque_de(expedicion)


class ExpedicionDecaDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = DECA_PERMS
    serializer_class = ExpedicionDecaSerializer
    queryset = ExpedicionDeca.objects.all()

    def perform_update(self, serializer):
        instance = serializer.instance
        estado_antes = instance.estado
        valores_antes = {campo: getattr(instance, campo) for campo in CAMPOS_AUDITABLES_EXPEDICION}

        # Corregir un DeCA YA GENERADO exige motivo: la Resolución de
        # 5-jun-2026 (BOE-A-2026-12784, apartado quinto) obliga a añadir al PDF
        # los datos nuevos "así como el motivo del cambio" y conservar los
        # antiguos marcados como no válidos. Se comprueba ANTES de guardar.
        motivo = (self.request.data.get('motivo_modificacion') or '').strip()
        corrige_generado = estado_antes == ExpedicionDeca.Estado.GENERADO
        if corrige_generado:
            nuevos = serializer.validated_data
            va_a_cambiar = [c for c in CAMPOS_AUDITABLES_EXPEDICION if c in nuevos and nuevos[c] != valores_antes[c]]
            if va_a_cambiar and not motivo:
                raise ValidationError({'motivo_modificacion': (
                    'Indica el motivo de la corrección: la norma exige que conste en el propio DeCA, '
                    'junto a los datos anteriores (Resolución de 5 de junio de 2026, apartado quinto).'
                )})

        expedicion = serializer.save()

        # Qué campos cambiaron de verdad -- el historial mostraba solo
        # "Editada" sin decir el qué (pedido explícito del usuario 2026-09-25).
        cambiados = [
            campo for campo in CAMPOS_AUDITABLES_EXPEDICION
            if valores_antes[campo] != getattr(expedicion, campo)
        ]
        detalle = f'Campos modificados: {", ".join(cambiados)}.' if cambiados else ''

        # Corrección de un DeCA ya generado, dentro del plazo de gracia (ver
        # ExpedicionDecaSerializer.validate -> puede_editar_generado): el PDF
        # ya entregado/enlazado por QR queda con datos viejos si no se
        # regenera -- mismo token público, contenido corregido. NO se toca
        # fecha_generacion (el plazo de corrección no se alarga al corregir).
        if corrige_generado and cambiados:
            ModificacionDeca.objects.create(
                expedicion=expedicion, usuario=self.request.user, motivo=motivo,
                cambios=[
                    {'campo': c, 'antes': _texto_dato(valores_antes[c]), 'despues': _texto_dato(getattr(expedicion, c))}
                    for c in cambiados
                ],
            )
        if estado_antes == ExpedicionDeca.Estado.GENERADO and expedicion.estado == ExpedicionDeca.Estado.GENERADO:
            url_publica = self.request.build_absolute_uri(
                reverse('deca-descarga-publica', args=[str(expedicion.token_publico)])
            )
            qr_png = qr_service.generar_qr_png(url_publica)
            contenido_pdf = pdf_service.generar_pdf_deca(expedicion, qr_png)
            expedicion = storage_service.regenerar_pdf_tras_correccion(expedicion, contenido_pdf)
            detalle = f'{detalle} Motivo: {motivo}. PDF regenerado tras corrección.'.strip()

        auditoria_service.registrar_evento(
            expedicion, EventoExpedicionDeca.TipoEvento.EDITADA, usuario=self.request.user, detalle=detalle,
        )
        catalogo_service.guardar_conductor_de(expedicion)
        catalogo_service.guardar_transportista_de(expedicion)
        catalogo_service.guardar_destinatario_de(expedicion)
        catalogo_service.guardar_cargador_de(expedicion)
        catalogo_service.guardar_tractora_de(expedicion)
        catalogo_service.guardar_remolque_de(expedicion)

    def perform_destroy(self, instance):
        # Borrable en dos casos, ambos sin rastro de un DeCA oficial ya
        # entregado: (a) todavía en borrador, (b) anulada pero SIN haber
        # llegado a generarse nunca el PDF oficial (`pdf_generado` vacío,
        # el mismo campo que usa DecaDescargaPublicaView). Una anulada que
        # SÍ se generó -- el caso típico de "detectamos un error y hay que
        # rehacerlo" -- se mantiene siempre por rastro de auditoría, nunca
        # se borra.
        borrable = (
            instance.estado == ExpedicionDeca.Estado.BORRADOR
            or (instance.estado == ExpedicionDeca.Estado.ANULADO and not instance.pdf_generado)
        )
        if not borrable:
            raise PermissionDenied(
                'Solo se puede borrar una expedición en borrador, o anulada si nunca llegó a '
                'generarse el DeCA oficial -- una que sí se generó se conserva por auditoría.'
            )
        instance.delete()


# ─── Catálogos reutilizables (la "Agenda" del módulo) ──────────────────────
#
# Los cinco se auto-alimentan al guardar una expedición (ver
# catalogo_service) para no teclear dos veces lo mismo, PERO además tienen
# CRUD propio desde la pantalla de Agenda.
#
# `?solo_activos=true` lo usan los combos de selección del formulario de
# expedición (solo interesa lo vigente); la pantalla de Agenda lista todo,
# incluido lo archivado, que si no sería invisible e inrecuperable.

class CatalogoDecaPagination(PageNumberPagination):
    """Permite subir el tamaño de página desde el cliente. Hace falta para
    los combos de selección del formulario de expedición: con el PAGE_SIZE
    global de 50 solo verían las 50 primeras fichas, y estos catálogos
    crecen solos con cada expedición."""
    page_size_query_param = 'page_size'
    max_page_size = 500


class _CatalogoDecaListCreateView(generics.ListCreateAPIView):
    """Base de los cinco catálogos: misma búsqueda por `?q=` sobre su campo
    de texto principal, mismo orden por `?ordering=`."""
    permission_classes = DECA_PERMS
    pagination_class = CatalogoDecaPagination
    filter_backends = [OrderingFilter]
    modelo = None
    campo_busqueda = 'nombre'
    ordering_fields = ['nombre', 'nif']
    ordering = ['nombre']

    def get_queryset(self):
        qs = self.modelo.objects.all()
        if self.request.query_params.get('solo_activos', '').lower() == 'true':
            qs = qs.filter(activo=True)
        q = self.request.query_params.get('q')
        if q:
            qs = qs.filter(**{f'{self.campo_busqueda}__icontains': q})
        return qs


class _CatalogoDecaDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = DECA_PERMS
    modelo = None

    def get_queryset(self):
        return self.modelo.objects.all()


class ConductorDecaListView(_CatalogoDecaListCreateView):
    serializer_class = ConductorDecaSerializer
    modelo = ConductorDeca


class ConductorDecaDetailView(_CatalogoDecaDetailView):
    serializer_class = ConductorDecaSerializer
    modelo = ConductorDeca


class EmpresaTransportistaDecaListView(_CatalogoDecaListCreateView):
    serializer_class = EmpresaTransportistaDecaSerializer
    modelo = EmpresaTransportistaDeca


class EmpresaTransportistaDecaDetailView(_CatalogoDecaDetailView):
    serializer_class = EmpresaTransportistaDecaSerializer
    modelo = EmpresaTransportistaDeca


class DestinatarioDecaListView(_CatalogoDecaListCreateView):
    serializer_class = DestinatarioDecaSerializer
    modelo = DestinatarioDeca


class DestinatarioDecaDetailView(_CatalogoDecaDetailView):
    serializer_class = DestinatarioDecaSerializer
    modelo = DestinatarioDeca


class CargadorDecaListView(_CatalogoDecaListCreateView):
    serializer_class = CargadorDecaSerializer
    modelo = CargadorDeca


class CargadorDecaDetailView(_CatalogoDecaDetailView):
    serializer_class = CargadorDecaSerializer
    modelo = CargadorDeca


class TractoraDecaListView(_CatalogoDecaListCreateView):
    serializer_class = TractoraDecaSerializer
    modelo = TractoraDeca
    campo_busqueda = 'matricula'
    ordering_fields = ['matricula', 'alias']
    ordering = ['matricula']


class TractoraDecaDetailView(_CatalogoDecaDetailView):
    serializer_class = TractoraDecaSerializer
    modelo = TractoraDeca


class RemolqueDecaListView(_CatalogoDecaListCreateView):
    serializer_class = RemolqueDecaSerializer
    modelo = RemolqueDeca
    campo_busqueda = 'matricula'
    ordering_fields = ['matricula', 'alias']
    ordering = ['matricula']


class RemolqueDecaDetailView(_CatalogoDecaDetailView):
    serializer_class = RemolqueDecaSerializer
    modelo = RemolqueDeca


# ─── Cadena de transportistas sucesivos (subcontratación) ──────────────────

class TransportistaSucesivoListCreateView(generics.ListCreateAPIView):
    """Plus sobre el mínimo legal (que solo exige el transportista efectivo,
    ver ExpedicionDeca) -- registra la cadena de subcontratación."""
    permission_classes = DECA_PERMS
    serializer_class = TransportistaSucesivoDecaSerializer

    def _expedicion(self):
        return get_object_or_404(ExpedicionDeca, id=self.kwargs['expedicion_id'])

    def get_queryset(self):
        return TransportistaSucesivoDeca.objects.filter(expedicion=self._expedicion())

    def perform_create(self, serializer):
        expedicion = self._expedicion()
        # El serializer no puede hacer esta comprobación en el alta: `expedicion`
        # es de solo lectura (la fija esta vista, no el payload) y en creación
        # `self.instance` todavía no existe, así que su `validate()` no tiene
        # forma de llegar a la expedición -- por eso el check vive aquí.
        if expedicion.estado != ExpedicionDeca.Estado.BORRADOR:
            raise PermissionDenied('Solo se puede editar la cadena de transportistas mientras la expedición está en borrador.')
        serializer.save(expedicion=expedicion)


class TransportistaSucesivoDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = DECA_PERMS
    serializer_class = TransportistaSucesivoDecaSerializer
    queryset = TransportistaSucesivoDeca.objects.all()

    def perform_destroy(self, instance):
        if instance.expedicion.estado != ExpedicionDeca.Estado.BORRADOR:
            raise PermissionDenied('Solo se puede editar la cadena de transportistas mientras la expedición está en borrador.')
        instance.delete()


# ─── Auditoría ───────────────────────────────────────────────────────────────

class EventoExpedicionDecaListView(generics.ListAPIView):
    """Historial append-only de una expedición -- alimenta el informe de
    auditoría exportable (ver ExportarAuditoriaExpedicionDecaView).

    Sin paginación (`pagination_class = None`): a diferencia de
    Expediciones/Agenda, esto es una colección acotada por UNA expedición
    (como `documentos_origen`/`transportistas_sucesivos` en el propio
    serializer de la expedición), no un listado global -- paginarla como
    esas vistas heredaba en silencio el PAGE_SIZE global de 50 y el
    frontend (DecaDetailPage.jsx) pedía todos los eventos de golpe sin
    paginar, así que un historial con más de 50 eventos (ej. muchas
    descargas públicas por QR) perdía los más antiguos sin ningún aviso."""
    permission_classes = DECA_PERMS
    serializer_class = EventoExpedicionDecaSerializer
    pagination_class = None

    def get_queryset(self):
        expedicion = get_object_or_404(ExpedicionDeca, id=self.kwargs['expedicion_id'])
        return expedicion.eventos.all()


class _ExportarAuditoriaExpedicionDecaView(APIView):
    """PDF/Excel del historial completo de UNA expedición -- informe de
    auditoría pedido por el usuario 2026-09-25 (deadline legal 5-oct-2026,
    demostrar ante una inspección qué pasó con un transporte concreto)."""
    permission_classes = DECA_PERMS
    formato = None  # 'pdf' | 'excel'

    def get(self, request, expedicion_id):
        from . import reportes
        expedicion = get_object_or_404(
            ExpedicionDeca, id=expedicion_id,
        )
        eventos = list(expedicion.eventos.all())
        generado_por = _nombre_usuario(request.user)
        config = _config_informes()
        nombre_archivo = f'auditoria_deca_{identificador_service.identificador_expedicion_para_archivo(expedicion, config)}'
        try:
            if self.formato == 'pdf':
                contenido = reportes.generar_pdf_auditoria_expedicion(
                    expedicion, eventos, _nombre_empresa(),
                    config=config, generado_por=generado_por,
                )
                return _respuesta_pdf(contenido, nombre_archivo)
            contenido = reportes.generar_excel_auditoria_expedicion(
                expedicion, eventos, empresa_nombre=_nombre_empresa(),
                config=config, generado_por=generado_por,
            )
            return _respuesta_excel(contenido, nombre_archivo)
        except Exception:
            logger.exception('Fallo exportando auditoría de expedición DeCA (%s)', self.formato)
            return Response({'detail': 'No se pudo generar la exportación.'}, status=500)


class ExportarPDFAuditoriaExpedicionDecaView(_ExportarAuditoriaExpedicionDecaView):
    formato = 'pdf'


class ExportarExcelAuditoriaExpedicionDecaView(_ExportarAuditoriaExpedicionDecaView):
    formato = 'excel'


# ─── Modelos de documento (plantillas por emisor) ──────────────────────────

class AliasAgendaDecaListView(generics.ListAPIView):
    """GET /api/v1/deca/sinonimos/?rol=transportista -- sinónimos aprendidos
    ("TTES ROMERO" = Transportes Romero Ruiz S.L.). No se crean a mano:
    salen solos al generar DeCA (services/aprendizaje_service.py)."""
    permission_classes = DECA_PERMS
    serializer_class = AliasAgendaDecaSerializer
    pagination_class = CatalogoDecaPagination

    def get_queryset(self):
        qs = AliasAgendaDeca.objects.all()
        rol = self.request.query_params.get('rol')
        if rol:
            qs = qs.filter(rol=rol)
        q = self.request.query_params.get('q')
        if q:
            qs = qs.filter(Q(texto__icontains=q) | Q(texto_original__icontains=q) | Q(nombre__icontains=q))
        return qs.order_by('rol', 'nombre', 'texto')


class PrecisionLecturaDecaView(APIView):
    """GET /api/v1/deca/precision-lectura/?dias=90 -- cuánto acierta la
    lectura automática (% de campos que nadie tuvo que corregir): total,
    manuscritos, por campo, por modelo de documento y por mes. Sin `dias`,
    desde el principio. Solo DeCA ya generados."""
    permission_classes = DECA_PERMS

    def get(self, request):
        desde = None
        try:
            dias = int(request.query_params.get('dias') or 0)
        except ValueError:
            raise ValidationError({'dias': 'Tiene que ser un número de días.'})
        if dias > 0:
            desde = timezone.now() - timedelta(days=dias)
        return Response(aprendizaje_service.precision_lectura(None, desde))


class AliasAgendaDecaDetailView(generics.DestroyAPIView):
    """DELETE -- olvidar un sinónimo mal aprendido."""
    permission_classes = DECA_PERMS

    def get_queryset(self):
        return AliasAgendaDeca.objects.all()


class PlantillaDocumentoDecaListView(_CatalogoDecaListCreateView):
    serializer_class = PlantillaDocumentoDecaSerializer
    modelo = PlantillaDocumentoDeca
    ordering_fields = ['nombre', 'tipo_documento', 'veces_aplicada', 'ultima_vez_aplicada']


class PlantillaDocumentoDecaDetailView(_CatalogoDecaDetailView):
    serializer_class = PlantillaDocumentoDecaSerializer
    modelo = PlantillaDocumentoDeca


class AnalizarEjemploPlantillaDecaView(APIView):
    """POST /api/v1/deca/plantillas/analizar/ -- lee un documento de EJEMPLO
    para dar de alta un modelo: devuelve lo que se ha leído para que la
    persona marque qué datos son siempre iguales en ese modelo. No guarda el
    fichero ni crea nada (el alta es un POST aparte a /plantillas/)."""
    permission_classes = DECA_PERMS
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        archivo = request.FILES.get('archivo')
        if not archivo:
            raise ValidationError({'archivo': 'Falta el fichero de ejemplo.'})
        try:
            archivo, tipo_real = preparar_documento(archivo)
        except FicheroNoValido as e:
            raise ValidationError({'archivo': str(e)})
        mime_real = {'pdf': 'application/pdf', 'jpg': 'image/jpeg', 'png': 'image/png'}[tipo_real]

        extraccion = _extraer_campos_de_archivo(
            archivo, request.user, 'ejemplo-plantilla', mime_type=mime_real, contar_uso=False,
        )
        campos = dict(extraccion['campos_sugeridos_ia'] or {})
        regex = extraccion['campos_sugeridos'] or {}
        # Con texto, el propio texto sugiere cómo reconocer el modelo: el CIF
        # del emisor (primer NIF del documento) es lo más estable que hay.
        tiene_texto = bool(regex.get('nifs_encontrados'))
        texto_identificativo = regex['nifs_encontrados'][0] if tiene_texto else ''
        return Response({
            'campos': campos,
            'campos_fijables': list(plantillas_service.CAMPOS_FIJABLES),
            'texto_identificativo_sugerido': texto_identificativo,
            'tiene_texto': tiene_texto,
            'campos_dudosos': extraccion['campos_dudosos'],
            'plantilla_aplicada': extraccion['plantilla_aplicada'],
            'ia_error': extraccion['ia_error'],
        })


# ─── Subida de documentos origen (albarán, CMR...) ─────────────────────────

def _extraer_campos_de_archivo(archivo, usuario, documento_id, mime_type=None, contar_uso=True):
    """Regex + IA sobre `archivo` -- compartido entre la subida
    (`DocumentoOrigenDecaUploadView`) y el reintento manual
    (`ExtraerCamposDocumentoView`). Best-effort: un fichero corrupto o
    cualquier fallo de parseo nunca debe lanzar, solo devuelve None en lo
    que no se pudo sacar.

    El camino de IA se elige por lo que el documento permita:
    - Con capa de texto -> IA de TEXTO sobre lo que ya extrajo pypdf.
    - Sin capa de texto (PDF escaneado, o una foto JPG/PNG) -> IA de VISIÓN
      sobre el fichero entero.
    """
    campos_sugeridos = None
    campos_sugeridos_ia = None
    campos_a_revisar = []
    errores_ia = []
    extras_ia = {}
    texto = ''
    resultado = {
        'campos_sugeridos': None, 'campos_sugeridos_ia': None, 'campos_a_revisar': [],
        'ia_error': None, 'campos_dudosos': [], 'plantilla_aplicada': None, 'zonas': {},
        'avisos_agenda': [], 'nifs_agenda': {}, 'campos_agenda': [],
    }
    config_deca = ConfiguracionDeca.objects.filter(pk=1).first()
    agenda_manda = config_deca.agenda_prioritaria if config_deca else True
    avisos_agenda = []
    campos_agenda = []
    try:
        archivo.seek(0)
        paginas = extraction_service.extraer_texto_por_pagina(archivo)
        texto = '\n'.join(paginas)
        campos_sugeridos = extraction_service.extraer_campos(
            texto, extraction_service.extraer_texto_maquetado(archivo),
        )
    except Exception:
        # Un JPG/PNG (o un PDF ilegible para pypdf) entra por aquí: no es
        # un error, simplemente no hay texto y se resuelve con visión.
        logger.info('Sin texto extraíble del documento DeCA %s, se usará visión', documento_id)
    resultado['campos_sugeridos'] = campos_sugeridos

    # Modelos de documento de la empresa (services/plantillas_service.py):
    # con texto se reconoce aquí; sin texto, la IA elige del catálogo.
    plantillas = plantillas_service.plantillas_activas(None)
    plantilla = plantillas_service.detectar_por_texto(plantillas, texto)
    if plantilla:
        pistas = plantillas_service.pistas_modelo_detectado(plantilla)
    elif plantillas:
        pistas = plantillas_service.pistas_catalogo(plantillas)
    else:
        pistas = ''
    # Nombres y matrículas que la empresa ya conoce (Agenda + sinónimos
    # aprendidos): en lo manuscrito la IA elige de esta lista en vez de
    # transcribir a ciegas (services/aprendizaje_service.py, fase 1).
    extra = [
        aprendizaje_service.pistas_candidatos(None),
        # Errores ya corregidos en documentos sin modelo (fase 2): los de
        # cada modelo van en su propia descripción (plantillas_service).
        aprendizaje_service.pistas_correcciones_empresa(None),
    ]
    pistas = '\n\n'.join(p for p in [pistas, *extra] if p)

    if extraction_ia_service.texto_es_util(texto):
        campos_sugeridos_ia = extraction_ia_service.extraer_campos_con_ia(
            usuario, texto, errores=errores_ia, pistas=pistas, extras=extras_ia,
        )
    else:
        try:
            archivo.seek(0)
            contenido = archivo.read()
        except Exception:
            logger.exception('No se pudo leer el documento DeCA %s para la visión', documento_id)
            return resultado
        campos_sugeridos_ia = extraction_ia_service.extraer_campos_con_vision(
            usuario, contenido, mime_type or _mime_type_de(archivo), errores=errores_ia,
            pistas=pistas, extras=extras_ia,
        )

    # Tal cual lo leyó la IA, antes de Agenda, sinónimos o valores fijos: es
    # lo que se registra para aprender cómo aparece escrito cada dato.
    leido_ia = {k: v for k, v in (campos_sugeridos_ia or {}).items() if k != 'campos_dudosos'}
    fuentes = {}

    if plantilla is None and plantillas:
        plantilla = plantillas_service.plantilla_por_numero(plantillas, extras_ia.get('modelo_reconocido'))
    if plantilla is not None:
        campos_sugeridos_ia = plantillas_service.aplicar_valores_fijos(plantilla, campos_sugeridos_ia)
        fuentes.update({c: LecturaCampoDeca.Fuente.MODELO for c in (plantilla.valores_fijos or {})})
        if contar_uso:
            plantillas_service.registrar_uso(plantilla)
        resultado['plantilla_aplicada'] = plantilla.nombre

    # Segundo pase: la IA a veces saca el NOMBRE de cargador/transportista/
    # destinatario pero no su NIF (letra pequeña, sellado, no aparece en el
    # CMR...) -- si ese nombre ya está en la Agenda de la empresa, se tapa
    # el hueco desde ahí. Si la coincidencia es solo por similitud (posible
    # error de OCR/transcripción, no un nombre idéntico), se rellena igual
    # pero `campos_a_revisar` marca tanto el NIF como el nombre para que la
    # pantalla los destaque -- pedido explícito del usuario 2026-09-25.
    if campos_sugeridos_ia:
        # Primero los sinónimos que la empresa ya enseñó ("TTES ROMERO" =
        # Transportes Romero Ruiz S.L.), que traen nombre y NIF de la
        # ficha; después el cruce por nombre con la Agenda para los huecos que
        # queden, y por último las matrículas con letras confundidas.
        cambios, revisar, fuentes_sinonimos = aprendizaje_service.aplicar_sinonimos(None, campos_sugeridos_ia)
        campos_sugeridos_ia = {**campos_sugeridos_ia, **cambios}
        fuentes.update(fuentes_sinonimos)

        # La Agenda manda (Configuración de DeCA → agenda_prioritaria): lo que
        # una persona ya confirmó en DeCA anteriores vale más que lo leído.
        revisar_agenda = []
        if agenda_manda:
            agenda = catalogo_service.aplicar_prioridad_agenda(None, campos_sugeridos_ia)
            campos_sugeridos_ia = {**campos_sugeridos_ia, **agenda['cambios']}
            fuentes.update({c: LecturaCampoDeca.Fuente.AGENDA for c, v in agenda['cambios'].items() if v})
            revisar_agenda = agenda['a_revisar']
            avisos_agenda.extend(agenda['avisos'])
            # Aparte de campos_a_revisar (que en pantalla significa "coincidencia
            # PARECIDA con la Agenda"): estos los corrigió la Agenda con
            # coincidencia exacta y van con su propio aviso en ámbar.
            campos_agenda.extend(revisar_agenda)

        nifs_desde_catalogo, campos_a_revisar = catalogo_service.completar_nifs_desde_catalogo(
            None, campos_sugeridos_ia,
        )
        if nifs_desde_catalogo:
            campos_sugeridos_ia = {**campos_sugeridos_ia, **nifs_desde_catalogo}
            fuentes.update({c: LecturaCampoDeca.Fuente.AGENDA for c in nifs_desde_catalogo})

        cambios_matricula, revisar_matricula, fuentes_matricula = aprendizaje_service.corregir_matriculas(
            None, campos_sugeridos_ia,
        )
        campos_sugeridos_ia = {**campos_sugeridos_ia, **cambios_matricula}
        fuentes.update(fuentes_matricula)
        campos_a_revisar = list(dict.fromkeys([*revisar, *campos_a_revisar, *revisar_matricula]))

    # NIF que la lectura por patrones encontró sin saber de quién son: si
    # están en la Agenda, su papel lo dice la Agenda (la pantalla los coloca
    # ahí y nunca en el hueco de otra parte).
    if agenda_manda and campos_sugeridos and campos_sugeridos.get('nifs_encontrados'):
        resultado['nifs_agenda'] = catalogo_service.aplicar_prioridad_agenda(
            None, {}, campos_sugeridos.get('nifs_encontrados'),
        )['nifs_agenda']
    resultado['avisos_agenda'] = avisos_agenda
    resultado['campos_agenda'] = list(dict.fromkeys(campos_agenda))

    # Motivo legible cuando la IA FALLÓ (cuota, saturación, respuesta
    # ilegible) -- distinto de "la IA leyó el documento y no encontró nada",
    # que sí puede ser una foto borrosa. La pantalla enseña esto en vez del
    # mensaje genérico.
    resultado.update({
        'campos_sugeridos_ia': campos_sugeridos_ia or None,
        'campos_a_revisar': campos_a_revisar,
        'ia_error': errores_ia[0] if errores_ia else None,
        # Leídos de letra a mano o de una zona ilegible: la pantalla los
        # marca para revisar (distinto de `campos_a_revisar`, que viene de
        # una coincidencia aproximada con la Agenda).
        # Un valor fijo del modelo ya no es dudoso: lo confirmó una persona.
        'campos_dudosos': [
            c for c in extras_ia.get('campos_dudosos', [])
            if c in (campos_sugeridos_ia or {}) and not (plantilla and (plantilla.valores_fijos or {}).get(c))
        ],
        # Dónde está escrito cada dato dudoso ([ymin, xmin, ymax, xmax] en
        # 0-1000): el móvil enseña ese trozo de la foto junto a "¿Es este?".
        # Solo en fotos -- de un PDF escaneado el navegador no tiene la
        # imagen para recortar.
        'zonas': extras_ia.get('zonas', {}) if 'image' in (mime_type or _mime_type_de(archivo)) else {},
        # Para `aprendizaje_service.registrar_lecturas` -- las vistas lo
        # sacan con `.pop()` antes de responder; nunca llega al navegador.
        '_registro': {
            'plantilla': plantilla,
            'leido': leido_ia,
            'propuesto': {k: v for k, v in (campos_sugeridos_ia or {}).items() if k != 'campos_dudosos'},
            'dudosos': list(extras_ia.get('campos_dudosos', [])),
            'fuentes': fuentes,
        },
    })
    return resultado


def _mime_type_de(archivo) -> str:
    """Tipo MIME de un fichero ya guardado (un `FieldFile` no trae
    `content_type` como sí hace el `UploadedFile` de una subida)."""
    adivinado, _ = mimetypes.guess_type(getattr(archivo, 'name', '') or '')
    return adivinado or 'application/pdf'


class DocumentoOrigenDecaUploadView(APIView):
    """Sube uno o varios PDF de origen para una expedición y, si se pide
    `extraer=true`, devuelve además los campos que la extracción automática
    ha logrado adivinar -- SOLO como sugerencia para precargar el formulario,
    nunca se escriben en la expedición desde aquí (la IA/automatización
    sugiere, un humano confirma)."""
    permission_classes = DECA_PERMS
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, expedicion_id):
        expedicion = get_object_or_404(ExpedicionDeca, id=expedicion_id)
        if expedicion.estado != ExpedicionDeca.Estado.BORRADOR:
            raise PermissionDenied('Solo se pueden añadir documentos a una expedición en borrador.')

        archivo = request.FILES.get('archivo')
        if not archivo:
            raise ValidationError({'archivo': 'Falta el fichero a subir.'})
        # Se valida el CONTENIDO, no solo la extensión (v4.27.3): que sea un
        # PDF/JPG/PNG real, sin JavaScript ni ficheros incrustados en el PDF y
        # sin bombas de descompresión en la imagen -- ver
        # core/validacion_ficheros.py. Antes de guardar nada.
        try:
            # Una foto HEIC de iPhone vuelve convertida a JPEG: se guarda ésa.
            archivo, tipo_real = preparar_documento(archivo)
        except FicheroNoValido as e:
            raise ValidationError({'archivo': str(e)})
        # El tipo REAL (por contenido), no el `content_type` que declara el
        # navegador: puede no cuadrar (foto renombrada) y la IA de visión lo usa.
        mime_real = {'pdf': 'application/pdf', 'jpg': 'image/jpeg', 'png': 'image/png'}[tipo_real]

        tipo_documento = request.data.get('tipo_documento', DocumentoOrigenDeca.TipoDocumento.OTRO)

        documento = DocumentoOrigenDeca.objects.create(
            expedicion=expedicion,
            tipo_documento=tipo_documento,
            archivo=archivo,
            nombre_original=archivo.name,
            subido_por=request.user,
        )

        extraccion = {
            'campos_sugeridos': None, 'campos_sugeridos_ia': None, 'campos_a_revisar': [],
            'ia_error': None, 'campos_dudosos': [], 'plantilla_aplicada': None,
        }
        if request.query_params.get('extraer', '').lower() == 'true':
            # Se lee `documento.archivo` (ya guardado en storage), NO el
            # `archivo` crudo de `request.FILES` -- ese es exactamente el
            # fichero que abre el botón "Extraer datos"
            # (ExtraerCamposDocumentoView) y que SÍ funcionaba siempre;
            # leer el de la petición en curso, justo después de haberlo
            # consumido para guardar el modelo, daba a veces una extracción
            # vacía con la misma foto que el reintento manual sí leía bien
            # (bug real reportado 2026-09-25).
            documento.archivo.open('rb')
            try:
                extraccion = _extraer_campos_de_archivo(
                    documento.archivo, request.user, documento.id,
                    mime_type=mime_real,
                )
            finally:
                documento.archivo.close()
        registro = extraccion.pop('_registro', None)
        if registro:
            aprendizaje_service.registrar_lecturas(expedicion, documento, **registro)

        auditoria_service.registrar_evento(
            expedicion, EventoExpedicionDeca.TipoEvento.DOCUMENTO_SUBIDO,
            usuario=request.user, detalle=f'{tipo_documento}: {archivo.name}',
        )

        respuesta = DocumentoOrigenDecaSerializer(documento, context={'request': request}).data
        return Response(
            # `campos_a_revisar`: nif_<rol>/nombre_<rol> que vinieron de una
            # coincidencia DIFUSA con el catálogo -- la pantalla los marca.
            {'documento': respuesta, **extraccion},
            status=status.HTTP_201_CREATED,
        )


class DocumentoOrigenDecaDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Renombrar (tipo/nombre) o borrar un documento origen ya subido --
    mismo patrón que TransportistaSucesivoDetailView (solo mientras la
    expedición está en borrador)."""
    permission_classes = DECA_PERMS
    serializer_class = DocumentoOrigenDecaSerializer
    queryset = DocumentoOrigenDeca.objects.all()

    def _validar_editable(self, instance):
        if instance.expedicion.estado != ExpedicionDeca.Estado.BORRADOR:
            raise PermissionDenied('Solo se pueden editar los documentos mientras la expedición está en borrador.')

    def perform_update(self, serializer):
        self._validar_editable(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._validar_editable(instance)
        # Borra también el fichero físico -- si no, el archivo huérfano se
        # queda ocupando disco sin que nada vuelva a referenciarlo.
        instance.archivo.delete(save=False)
        instance.delete()


class ExtraerCamposDocumentoView(APIView):
    """POST /api/v1/deca/documentos/<id>/extraer/ -- reintenta la
    extracción (regex + IA) sobre un documento YA subido, sin tener que
    volver a subirlo. Es una operación de solo lectura -- no escribe nada en
    la expedición ni en el documento."""
    permission_classes = DECA_PERMS

    def post(self, request, pk):
        documento = get_object_or_404(DocumentoOrigenDeca, id=pk)
        # A diferencia de la subida (donde `archivo` ya llega abierto como
        # UploadedFile), un FieldFile leído de BD hay que abrirlo a mano
        # antes de que pypdf pueda leerlo.
        documento.archivo.open('rb')
        try:
            extraccion = _extraer_campos_de_archivo(
                documento.archivo, request.user, documento.id,
            )
        finally:
            documento.archivo.close()
        registro = extraccion.pop('_registro', None)
        if registro:
            aprendizaje_service.registrar_lecturas(documento.expedicion, documento, **registro)
        return Response(extraccion)


# ─── Transiciones de estado ─────────────────────────────────────────────────

class ConfirmarExpedicionDecaView(APIView):
    """BORRADOR -> CONFIRMADO. Solo comprueba que los campos mínimos exigidos
    por la norma están rellenos -- la validación de formato (NIF, matrícula)
    ya la hizo el serializer al guardar cada campo."""
    permission_classes = DECA_PERMS

    def post(self, request, expedicion_id):
        expedicion = get_object_or_404(ExpedicionDeca, id=expedicion_id)
        if expedicion.estado != ExpedicionDeca.Estado.BORRADOR:
            raise PermissionDenied('Solo se puede confirmar una expedición en borrador.')

        # Remolque exento si se marcó 'sin remolque' (camión rígido).
        faltantes = obligatorios_service.faltantes(expedicion)
        if faltantes:
            raise ValidationError({'campos_faltantes': faltantes})

        expedicion.estado = ExpedicionDeca.Estado.CONFIRMADO
        expedicion.save(update_fields=['estado', 'fecha_actualizacion'])
        auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.CONFIRMADA, usuario=request.user)
        return Response(ExpedicionDecaSerializer(expedicion, context={'request': request}).data)


class VistaPreviaExpedicionDecaView(APIView):
    """Genera un PDF de vista previa (con marca de agua) a partir de los
    datos YA GUARDADOS de la expedición -- nunca se persiste ni afecta al
    hash/estado, se puede pedir tantas veces como haga falta mientras se
    edita. Corregir ANTES de pulsar Generar DeCA es gratis; después, no
    (ver GenerarDecaView)."""
    permission_classes = DECA_PERMS

    # Lo que nunca se toma del formulario, ni siquiera en memoria: identidad,
    # estado y todo lo que solo pone el sistema al generar.
    _CAMPOS_PROTEGIDOS = frozenset({
        'id', 'empresa', 'estado', 'token_publico', 'pdf_generado', 'hash_sha256', 'fecha_generacion',
        'fecha_expiracion_publica', 'creado_por', 'anio', 'mes', 'numero_interno', 'fecha_alta',
        'fecha_actualizacion',
    })

    def _expedicion(self, request, expedicion_id):
        expedicion = get_object_or_404(
            ExpedicionDeca, id=expedicion_id,
        )
        if expedicion.estado not in (ExpedicionDeca.Estado.BORRADOR, ExpedicionDeca.Estado.CONFIRMADO):
            raise PermissionDenied('La vista previa solo tiene sentido antes de generar el DeCA.')
        return expedicion

    def get(self, request, expedicion_id):
        return self._pdf(request, self._expedicion(request, expedicion_id))

    def post(self, request, expedicion_id):
        """Vista previa con lo que hay AHORA en el formulario, sin guardar
        nada (pedido del usuario 2026-09-29: "sale vacío porque no grabé").
        Los datos se copian solo en memoria sobre la expedición y se
        convierten sin validar el formato -- un NIF mal escrito también sale
        en la vista previa, que es justo para verlo. Nunca se llama a save()."""
        expedicion = self._expedicion(request, expedicion_id)
        self._aplicar_en_memoria(expedicion, request.data)
        return self._pdf(request, expedicion)

    def _aplicar_en_memoria(self, expedicion, datos):
        from datetime import timezone as dt_timezone
        from decimal import Decimal, InvalidOperation

        from django.db import models as dj_models
        from django.utils.dateparse import parse_datetime

        for campo in ExpedicionDeca._meta.concrete_fields:
            nombre = campo.name
            if nombre in self._CAMPOS_PROTEGIDOS or not campo.editable or campo.is_relation or nombre not in datos:
                continue
            valor = datos.get(nombre)
            if isinstance(campo, dj_models.DateTimeField):
                fecha = parse_datetime(str(valor)) if valor else None
                if fecha is not None and timezone.is_naive(fecha):
                    fecha = timezone.make_aware(fecha, dt_timezone.utc)  # mismo criterio UTC literal que al guardar
                setattr(expedicion, nombre, fecha)
            elif isinstance(campo, dj_models.DecimalField):
                try:
                    setattr(expedicion, nombre, Decimal(str(valor).replace(',', '.')) if valor not in (None, '') else None)
                except InvalidOperation:
                    setattr(expedicion, nombre, None)
            elif isinstance(campo, dj_models.BooleanField):
                setattr(expedicion, nombre, valor in (True, 'true', 'True', '1', 1))
            elif isinstance(campo, (dj_models.IntegerField,)):
                try:
                    setattr(expedicion, nombre, int(valor) if valor not in (None, '') else None)
                except (TypeError, ValueError):
                    setattr(expedicion, nombre, None)
            elif isinstance(campo, (dj_models.CharField, dj_models.TextField)):
                texto = '' if valor is None else str(valor)
                setattr(expedicion, nombre, texto[:campo.max_length] if campo.max_length else texto)

    def _pdf(self, request, expedicion):
        url_publica = request.build_absolute_uri(
            reverse('deca-descarga-publica', args=[str(expedicion.token_publico)])
        )
        qr_png = qr_service.generar_qr_png(url_publica)
        contenido_pdf = pdf_service.generar_pdf_deca(expedicion, qr_png, borrador=True)
        auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.VISTA_PREVIA, usuario=request.user)

        return FileResponse(
            io.BytesIO(contenido_pdf), content_type='application/pdf',
            filename=f'DECA_vista_previa_{identificador_service.identificador_expedicion_para_archivo(expedicion)}.pdf',
        )


class GenerarDecaView(APIView):
    """CONFIRMADO -> GENERADO. Genera el PDF nativo con el QR estampado y lo
    guarda -- a partir de aquí la expedición ya no se puede editar (ver
    ExpedicionDecaSerializer.validate)."""
    permission_classes = DECA_PERMS

    def post(self, request, expedicion_id):
        expedicion = get_object_or_404(ExpedicionDeca, id=expedicion_id)
        if expedicion.estado != ExpedicionDeca.Estado.CONFIRMADO:
            raise PermissionDenied('Solo se puede generar el DeCA de una expedición confirmada.')

        # Re-validar el mínimo legal aquí, no solo al Confirmar: aunque el
        # serializer ya bloquea el PATCH en CONFIRMADO (ver validate()), esta
        # comprobación es la última barrera antes de emitir un documento
        # oficial con QR/hash -- nunca generar un DeCA con campos vacíos
        # (hallazgo de la auditoría de seguridad 2026-09-23).
        # Remolque exento si se marcó 'sin remolque' (camión rígido).
        faltantes = obligatorios_service.faltantes(expedicion)
        if faltantes:
            raise ValidationError({'campos_faltantes': faltantes})

        # Si la empresa prefiere el contador automático de Appodo
        # (ConfiguracionDeca.identificador_preferido), numera AQUÍ -- solo
        # una vez, al generar el documento oficial, nunca en Borrador (no se
        # "queman" números de expediciones que se acaban borrando) ni de
        # nuevo en una corrección posterior (ver identificador_service).
        expedicion = identificador_service.asignar_numero_interno_si_procede(expedicion)

        url_publica = request.build_absolute_uri(
            reverse('deca-descarga-publica', args=[str(expedicion.token_publico)])
        )
        qr_png = qr_service.generar_qr_png(url_publica)
        contenido_pdf = pdf_service.generar_pdf_deca(expedicion, qr_png)
        expedicion = storage_service.guardar_pdf_generado(expedicion, contenido_pdf)
        auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.GENERADA, usuario=request.user)
        # Con los datos ya decididos por una persona: se compara con lo que
        # leyó la IA y se aprenden los sinónimos de lo que se corrigió.
        aprendizaje_service.resolver_lecturas(expedicion)

        return Response(ExpedicionDecaSerializer(expedicion, context={'request': request}).data)


class RegistrarPapelExpedicionDecaView(APIView):
    """BORRADOR/CONFIRMADO -> PAPEL (2026-09-30). Un DeCA rellenado a mano en
    el talonario se registra con su foto para que conste en el registro de un
    año (art. 9). No se genera PDF ni QR: el documento que viajó es el papel,
    y la foto es su copia. Exige los mismos datos que un DeCA de Appodo y al
    menos una foto del papel. Solo si la empresa lo tiene activado."""
    permission_classes = DECA_PERMS

    def post(self, request, expedicion_id):
        expedicion = get_object_or_404(
            ExpedicionDeca, id=expedicion_id,
        )
        config = ConfiguracionDeca.objects.filter(pk=1).first()
        if not (config and config.registrar_papel_por_foto):
            raise PermissionDenied('No está activado registrar DeCA de papel (Configuración de DeCA).')
        if expedicion.estado not in (ExpedicionDeca.Estado.BORRADOR, ExpedicionDeca.Estado.CONFIRMADO):
            raise PermissionDenied('Solo se puede registrar como DeCA en papel una expedición en borrador o confirmada.')
        if not expedicion.documentos_origen.exists():
            raise ValidationError({'documentos_origen': 'Falta la foto del DeCA de papel: es la copia del documento que viajó.'})
        faltantes = obligatorios_service.faltantes(expedicion)
        if faltantes:
            raise ValidationError({'campos_faltantes': faltantes})

        expedicion.estado = ExpedicionDeca.Estado.PAPEL
        expedicion.save(update_fields=['estado', 'fecha_actualizacion'])
        auditoria_service.registrar_evento(
            expedicion, EventoExpedicionDeca.TipoEvento.REGISTRADA_PAPEL, usuario=request.user,
        )
        aprendizaje_service.resolver_lecturas(expedicion)
        return Response(ExpedicionDecaSerializer(expedicion, context={'request': request}).data)


class AnularExpedicionDecaView(APIView):
    """Anula una expedición CONFIRMADA o GENERADA -- nunca un BORRADOR
    (2026-09-25): anular es "esto se emitió oficialmente y se cancela", y un
    borrador nunca llegó a confirmarse ni generarse, así que ese concepto no
    aplica -- para descartarlo existe "Borrar borrador"
    (ExpedicionDecaDetailView.perform_destroy). Anular una ya GENERADA corta
    al instante el acceso público por QR (DecaDescargaPublicaView exige
    estado=GENERADO para servir el PDF) -- es la vía de emergencia si se
    detecta un dato incorrecto después de vencer el plazo de corrección
    (ver ExpedicionDecaSerializer.validate -> puede_editar_generado)."""
    permission_classes = DECA_PERMS

    def post(self, request, expedicion_id):
        expedicion = get_object_or_404(ExpedicionDeca, id=expedicion_id)
        if expedicion.estado == ExpedicionDeca.Estado.ANULADO:
            raise PermissionDenied('Esta expedición ya está anulada.')
        if expedicion.estado == ExpedicionDeca.Estado.BORRADOR:
            raise PermissionDenied('Un borrador no se anula -- se borra (aún no existe ningún DeCA oficial que cancelar).')

        motivo = request.data.get('motivo', '')
        expedicion.estado = ExpedicionDeca.Estado.ANULADO
        expedicion.save(update_fields=['estado', 'fecha_actualizacion'])
        auditoria_service.registrar_evento(
            expedicion, EventoExpedicionDeca.TipoEvento.ANULADA, usuario=request.user, detalle=motivo,
        )
        return Response(ExpedicionDecaSerializer(expedicion, context={'request': request}).data)


class EnviarEmailExpedicionDecaView(APIView):
    """POST /deca/expediciones/<id>/enviar-email/ -- body: {destinatario,
    asunto?, cuerpo?}. Solo expediciones GENERADAS (400 si no). Adjunta el
    PDF ya generado y lo envía con el SMTP de la instalación -- envío
    MANUAL, el destinatario se escribe en cada ocasión (la automatización
    vía ConfiguracionDeca.notificar_* es una fase posterior, no construida).
    Registra el evento `enviada_email` en el timeline."""
    permission_classes = DECA_PERMS

    def post(self, request, expedicion_id):
        from .services import email_service
        from .services.email_service import EmailDecaError

        expedicion = get_object_or_404(ExpedicionDeca, id=expedicion_id)
        serializer = ExpedicionDecaEnviarEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            email_service.enviar_expedicion_email(
                expedicion,
                destinatario=serializer.validated_data['destinatario'],
                usuario=request.user,
                asunto=serializer.validated_data.get('asunto') or None,
                cuerpo=serializer.validated_data.get('cuerpo') or None,
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except EmailDecaError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({'detail': f"DeCA enviado a {serializer.validated_data['destinatario']}."})


# ─── Descarga pública por QR ────────────────────────────────────────────────

@extend_schema(exclude=True)
class DecaDescargaPublicaView(APIView):
    """Endpoint público exigido por la norma: sin login, sin token de sesión,
    descarga directa del PDF -- pero solo dentro de la ventana de vigencia
    configurada (mínimo legal 7 días, ver ConfiguracionDeca). Pasada esa
    ventana, el documento sigue custodiado el año completo pero deja de
    servirse por esta vía pública."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [DecaLecturaPublicaThrottle]

    def get(self, request, token):
        expedicion = ExpedicionDeca.objects.filter(token_publico=token).first()
        if expedicion is None:
            # Un DeCA emitido sin cobertura lleva su QR impreso antes de que el
            # móvil lo registre: quien lo escanee en ese rato tiene que saberlo.
            raise Http404(
                'DeCA no encontrado todavía. Si se emitió sin cobertura, aparecerá en cuanto el '
                'móvil que lo hizo vuelva a tener red; mientras tanto vale el documento impreso.'
            )
        if expedicion.estado != ExpedicionDeca.Estado.GENERADO or not expedicion.pdf_generado:
            raise Http404('DeCA no disponible.')
        if not storage_service.acceso_publico_vigente(expedicion):
            raise Http404('El acceso público a este documento ha caducado.')

        auditoria_service.registrar_evento(
            expedicion, EventoExpedicionDeca.TipoEvento.DESCARGA_PUBLICA, ip_origen=_ip_cliente(request),
        )

        return FileResponse(
            expedicion.pdf_generado.open('rb'),
            content_type='application/pdf',
            filename=f'DECA_{identificador_service.identificador_expedicion_para_archivo(expedicion)}.pdf',
        )


# ─── Exportación PDF/Excel (Expediciones + Agenda) ─────────────────────────
#
# Mismo filtro/orden que la pantalla (para que listado y exportación nunca
# se desincronicen).

def _respuesta_pdf(contenido, nombre_archivo):
    return FileResponse(
        io.BytesIO(contenido), as_attachment=True,
        filename=f'{nombre_archivo}_{timezone.now().date().isoformat()}.pdf',
        content_type='application/pdf',
    )


def _respuesta_excel(contenido, nombre_archivo):
    from django.http import HttpResponse
    response = HttpResponse(
        contenido, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = (
        f'attachment; filename="{nombre_archivo}_{timezone.now().date().isoformat()}.xlsx"'
    )
    return response


def _config_informes():
    return ConfiguracionDeca.objects.first()


def _nombre_empresa() -> str:
    return getattr(settings, 'EMPRESA_NOMBRE', '') or ''


class _ExportarExpedicionesDecaView(APIView):
    permission_classes = DECA_PERMS
    formato = None  # 'pdf' | 'excel'

    def get(self, request):
        from . import reportes
        qp = request.query_params
        vista = ExpedicionDecaListCreateView()
        vista.request = request
        expediciones = list(vista.filter_queryset(vista.get_queryset()))
        filtros = {'estado': qp.get('estado'), 'q': qp.get('q')}
        generado_por = _nombre_usuario(request.user)
        config = _config_informes()
        try:
            if self.formato == 'pdf':
                contenido = reportes.generar_pdf_expediciones(
                    expediciones, _nombre_empresa(), config=config,
                    generado_por=generado_por, filtros=filtros,
                )
                return _respuesta_pdf(contenido, 'expediciones_deca')
            contenido = reportes.generar_excel_expediciones(
                expediciones, empresa_nombre=_nombre_empresa(), config=config,
                generado_por=generado_por, filtros=filtros,
            )
            return _respuesta_excel(contenido, 'expediciones_deca')
        except Exception:
            logger.exception('Fallo exportando expediciones DeCA (%s)', self.formato)
            return Response({'detail': 'No se pudo generar la exportación.'}, status=500)


class ExportarPDFExpedicionesDecaView(_ExportarExpedicionesDecaView):
    formato = 'pdf'


class ExportarExcelExpedicionesDecaView(_ExportarExpedicionesDecaView):
    formato = 'excel'


_MODELOS_AGENDA = {
    'transportistas': (EmpresaTransportistaDeca, EmpresaTransportistaDecaListView),
    'destinatarios': (DestinatarioDeca, DestinatarioDecaListView),
    'cargadores': (CargadorDeca, CargadorDecaListView),
    'conductores': (ConductorDeca, ConductorDecaListView),
    'tractoras': (TractoraDeca, TractoraDecaListView),
    'remolques': (RemolqueDeca, RemolqueDecaListView),
}


class _ExportarAgendaDecaView(APIView):
    permission_classes = DECA_PERMS
    formato = None  # 'pdf' | 'excel'

    def get(self, request, tipo):
        from . import reportes
        if tipo not in _MODELOS_AGENDA:
            raise Http404('Catálogo no reconocido.')
        _, vista_cls = _MODELOS_AGENDA[tipo]
        qp = request.query_params
        vista = vista_cls()
        vista.request = request
        fichas = list(vista.filter_queryset(vista.get_queryset()))
        filtros = {'solo_activos': qp.get('solo_activos'), 'q': qp.get('q')}
        generado_por = _nombre_usuario(request.user)
        config = _config_informes()
        try:
            if self.formato == 'pdf':
                contenido = reportes.generar_pdf_agenda(
                    tipo, fichas, _nombre_empresa(), config=config,
                    generado_por=generado_por, filtros=filtros,
                )
                return _respuesta_pdf(contenido, f'agenda_deca_{tipo}')
            contenido = reportes.generar_excel_agenda(
                tipo, fichas, empresa_nombre=_nombre_empresa(), config=config,
                generado_por=generado_por, filtros=filtros,
            )
            return _respuesta_excel(contenido, f'agenda_deca_{tipo}')
        except Exception:
            logger.exception('Fallo exportando agenda DeCA %s (%s)', tipo, self.formato)
            return Response({'detail': 'No se pudo generar la exportación.'}, status=500)


class ExportarPDFAgendaDecaView(_ExportarAgendaDecaView):
    formato = 'pdf'


class ExportarExcelAgendaDecaView(_ExportarAgendaDecaView):
    formato = 'excel'


# ─── Importación CSV de la Agenda ───────────────────────────────────────────
#
# CSV con cabecera, upsert por la clave natural del catálogo (NIF, o
# matrícula en Tractoras/Remolques), reutilizando el serializer normal
# (misma validación de NIF/matrícula que el alta manual, nunca una copia
# aparte).

_CATALOGOS_IMPORTABLES = {
    'transportistas': (EmpresaTransportistaDeca, EmpresaTransportistaDecaSerializer, 'nif', ['nombre', 'nif', 'telefono', 'email']),
    'destinatarios': (DestinatarioDeca, DestinatarioDecaSerializer, 'nif', ['nombre', 'nif', 'telefono', 'email']),
    'cargadores': (CargadorDeca, CargadorDecaSerializer, 'nif', ['nombre', 'nif', 'domicilio', 'telefono', 'email']),
    'conductores': (ConductorDeca, ConductorDecaSerializer, 'nif', ['nombre', 'nif', 'telefono', 'email']),
    'tractoras': (TractoraDeca, TractoraDecaSerializer, 'matricula', ['matricula', 'alias']),
    'remolques': (RemolqueDeca, RemolqueDecaSerializer, 'matricula', ['matricula', 'alias']),
}


class ImportarAgendaDecaView(APIView):
    permission_classes = DECA_PERMS
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, tipo):
        if tipo not in _CATALOGOS_IMPORTABLES:
            raise Http404('Catálogo no reconocido.')
        modelo, serializer_cls, campo_clave, campos = _CATALOGOS_IMPORTABLES[tipo]

        archivo = request.FILES.get('archivo')
        if not archivo:
            return Response({'detail': 'Se requiere un archivo CSV.'}, status=status.HTTP_400_BAD_REQUEST)
        if archivo.size > 5 * 1024 * 1024:
            return Response({'detail': 'El archivo es demasiado grande (máximo 5MB).'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded = archivo.read().decode('utf-8-sig')
        except UnicodeDecodeError:
            return Response({'detail': 'El archivo no es un CSV de texto válido (UTF-8).'}, status=status.HTTP_400_BAD_REQUEST)

        reader = csv.DictReader(io.StringIO(decoded))
        creados = 0
        actualizados = 0
        errores = []

        for i, row in enumerate(reader, start=2):
            valor_clave = (row.get(campo_clave) or '').strip()
            if not valor_clave:
                errores.append(f'Fila {i}: falta {campo_clave}.')
                continue

            datos = {campo: (row.get(campo) or '').strip() for campo in campos}
            # Buscamos por la clave ya normalizada (mismo `normalizar` que
            # aplica el serializer al validar) -- si no, "B12345674" y
            # "B-12345674" en el CSV se tratarían como fichas distintas y
            # cada reimportación duplicaría en vez de actualizar.
            instancia = modelo.objects.filter(
                **{campo_clave: _normalizar_clave_importacion(valor_clave)},
            ).first()
            serializer = serializer_cls(
                instancia, data=datos, partial=bool(instancia), context={'request': request},
            )
            if not serializer.is_valid():
                primer_error = next(iter(serializer.errors.values()))[0]
                errores.append(f'Fila {i}: {primer_error}')
                continue
            serializer.save()
            if instancia:
                actualizados += 1
            else:
                creados += 1

        return Response({'creados': creados, 'actualizados': actualizados, 'errores': errores})
