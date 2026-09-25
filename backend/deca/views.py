import csv
import io
import logging
import mimetypes

from django.conf import settings
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
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
from core_utils.validadores_fiscales import normalizar as _normalizar_clave_importacion

from .models import (
    ConductorDeca,
    ConfiguracionDeca,
    DestinatarioDeca,
    DocumentoOrigenDeca,
    EmpresaTransportistaDeca,
    EventoExpedicionDeca,
    ExpedicionDeca,
    RemolqueDeca,
    TractoraDeca,
    TransportistaSucesivoDeca,
)
from .serializers import (
    ConductorDecaSerializer,
    ConfiguracionDecaSerializer,
    DestinatarioDecaSerializer,
    DocumentoOrigenDecaSerializer,
    EmpresaTransportistaDecaSerializer,
    EventoExpedicionDecaSerializer,
    ExpedicionDecaEnviarEmailSerializer,
    ExpedicionDecaSerializer,
    RemolqueDecaSerializer,
    TractoraDecaSerializer,
    TransportistaSucesivoDecaSerializer,
)
from .services import (
    auditoria_service, catalogo_service, extraction_ia_service, extraction_service,
    pdf_service, qr_service, storage_service,
)

logger = logging.getLogger(__name__)


# Sin `IsDecaActive`/módulo activo (decisión de arquitectura: DeCA es la
# única app instalada, no hay catálogo de módulos que activar/desactivar).
DECA_PERMS = [IsAuthenticated]
# Configuración y gestión de usuarios son las únicas pantallas admin-only
# (decisión de arquitectura: solo dos roles, `is_staff` True/False).
DECA_ADMIN_PERMS = [IsAuthenticated, IsAdminUser]

CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR = [
    'nif_cargador', 'nombre_cargador',
    'nif_transportista', 'nombre_transportista',
    'nif_destinatario', 'nombre_destinatario',
    'matricula_tractor', 'origen', 'destino',
    'fecha_hora_transporte', 'naturaleza_mercancia',
]


class DecaLecturaPublicaThrottle(AnonRateThrottle):
    scope = 'deca_publico'


def _nombre_usuario(usuario):
    return usuario.get_full_name() or usuario.username


# ─── Configuración ──────────────────────────────────────────────────────────

class ConfiguracionDecaView(generics.RetrieveUpdateAPIView):
    """Fila única (singleton) -- se crea sola con los valores por defecto la
    primera vez que se pide (`get_or_create`, nunca 404 en la primera visita
    a la pantalla). Solo el admin de la instalación puede verla/editarla."""
    permission_classes = DECA_ADMIN_PERMS
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

    def perform_create(self, serializer):
        expedicion = serializer.save(creado_por=self.request.user)
        auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.CREADA, usuario=self.request.user)
        catalogo_service.guardar_conductor_de(expedicion)
        catalogo_service.guardar_transportista_de(expedicion)
        catalogo_service.guardar_destinatario_de(expedicion)
        catalogo_service.guardar_tractora_de(expedicion)
        catalogo_service.guardar_remolque_de(expedicion)


class ExpedicionDecaDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = DECA_PERMS
    serializer_class = ExpedicionDecaSerializer
    queryset = ExpedicionDeca.objects.all()

    def perform_update(self, serializer):
        expedicion = serializer.save()
        auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.EDITADA, usuario=self.request.user)
        catalogo_service.guardar_conductor_de(expedicion)
        catalogo_service.guardar_transportista_de(expedicion)
        catalogo_service.guardar_destinatario_de(expedicion)
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
    """Historial append-only de una expedición."""
    permission_classes = DECA_PERMS
    serializer_class = EventoExpedicionDecaSerializer

    def get_queryset(self):
        expedicion = get_object_or_404(ExpedicionDeca, id=self.kwargs['expedicion_id'])
        return expedicion.eventos.all()


# ─── Subida de documentos origen (albarán, CMR...) ─────────────────────────

def _extraer_campos_de_archivo(archivo, documento_id, mime_type=None):
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
    texto = ''
    try:
        archivo.seek(0)
        paginas = extraction_service.extraer_texto_por_pagina(archivo)
        texto = '\n'.join(paginas)
        campos_sugeridos = extraction_service.extraer_campos(texto)
    except Exception:
        # Un JPG/PNG (o un PDF ilegible para pypdf) entra por aquí: no es
        # un error, simplemente no hay texto y se resuelve con visión.
        logger.info('Sin texto extraíble del documento DeCA %s, se usará visión', documento_id)

    if extraction_ia_service.texto_es_util(texto):
        campos_sugeridos_ia = extraction_ia_service.extraer_campos_con_ia(texto)
    else:
        try:
            archivo.seek(0)
            contenido = archivo.read()
        except Exception:
            logger.exception('No se pudo leer el documento DeCA %s para la visión', documento_id)
            return campos_sugeridos, None
        campos_sugeridos_ia = extraction_ia_service.extraer_campos_con_vision(
            contenido, mime_type or _mime_type_de(archivo),
        )

    return campos_sugeridos, campos_sugeridos_ia


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
        # El límite de tipo/tamaño es una barrera de seguridad real, no solo
        # de UX: sin esto el backend aceptaría cualquier Content-Type/
        # extensión y cualquier tamaño y lo procesaría síncrono dentro del
        # request. Mismo límite que el input del frontend (10MB, pdf/jpg/png).
        EXTENSIONES_PERMITIDAS = ('.pdf', '.jpg', '.jpeg', '.png')
        TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024
        nombre_lower = (archivo.name or '').lower()
        if not nombre_lower.endswith(EXTENSIONES_PERMITIDAS):
            raise ValidationError({'archivo': 'Tipo de archivo no permitido (solo PDF, JPG, PNG).'})
        if archivo.size > TAMANO_MAXIMO_BYTES:
            raise ValidationError({'archivo': 'El archivo supera el tamaño máximo permitido (10MB).'})

        tipo_documento = request.data.get('tipo_documento', DocumentoOrigenDeca.TipoDocumento.OTRO)

        documento = DocumentoOrigenDeca.objects.create(
            expedicion=expedicion,
            tipo_documento=tipo_documento,
            archivo=archivo,
            nombre_original=archivo.name,
            subido_por=request.user,
        )

        campos_sugeridos = None
        campos_sugeridos_ia = None
        if request.query_params.get('extraer', '').lower() == 'true':
            campos_sugeridos, campos_sugeridos_ia = _extraer_campos_de_archivo(
                archivo, documento.id, mime_type=getattr(archivo, 'content_type', None),
            )

        auditoria_service.registrar_evento(
            expedicion, EventoExpedicionDeca.TipoEvento.DOCUMENTO_SUBIDO,
            usuario=request.user, detalle=f'{tipo_documento}: {archivo.name}',
        )

        respuesta = DocumentoOrigenDecaSerializer(documento, context={'request': request}).data
        return Response(
            {
                'documento': respuesta,
                'campos_sugeridos': campos_sugeridos,
                'campos_sugeridos_ia': campos_sugeridos_ia,
            },
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
            campos_sugeridos, campos_sugeridos_ia = _extraer_campos_de_archivo(documento.archivo, documento.id)
        finally:
            documento.archivo.close()
        return Response({
            'campos_sugeridos': campos_sugeridos,
            'campos_sugeridos_ia': campos_sugeridos_ia,
        })


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

        faltantes = [
            campo for campo in CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR
            if not getattr(expedicion, campo)
        ]
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

    def get(self, request, expedicion_id):
        expedicion = get_object_or_404(ExpedicionDeca, id=expedicion_id)
        if expedicion.estado not in (ExpedicionDeca.Estado.BORRADOR, ExpedicionDeca.Estado.CONFIRMADO):
            raise PermissionDenied('La vista previa solo tiene sentido antes de generar el DeCA.')

        url_publica = request.build_absolute_uri(
            reverse('deca-descarga-publica', args=[str(expedicion.token_publico)])
        )
        qr_png = qr_service.generar_qr_png(url_publica)
        contenido_pdf = pdf_service.generar_pdf_deca(expedicion, qr_png, borrador=True)
        auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.VISTA_PREVIA, usuario=request.user)

        return FileResponse(
            io.BytesIO(contenido_pdf), content_type='application/pdf',
            filename=f'DECA_vista_previa_{expedicion.numero_albaran or expedicion.id}.pdf',
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
        # oficial con QR/hash -- nunca generar un DeCA con campos vacíos.
        faltantes = [
            campo for campo in CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR
            if not getattr(expedicion, campo)
        ]
        if faltantes:
            raise ValidationError({'campos_faltantes': faltantes})

        url_publica = request.build_absolute_uri(
            reverse('deca-descarga-publica', args=[str(expedicion.token_publico)])
        )
        qr_png = qr_service.generar_qr_png(url_publica)
        contenido_pdf = pdf_service.generar_pdf_deca(expedicion, qr_png)
        expedicion = storage_service.guardar_pdf_generado(expedicion, contenido_pdf)
        auditoria_service.registrar_evento(expedicion, EventoExpedicionDeca.TipoEvento.GENERADA, usuario=request.user)

        return Response(ExpedicionDecaSerializer(expedicion, context={'request': request}).data)


class AnularExpedicionDecaView(APIView):
    """Anula una expedición en cualquier estado salvo ya anulada. Anular una
    ya GENERADA corta al instante el acceso público por QR (DecaDescargaPublicaView
    exige estado=GENERADO para servir el PDF) -- es la vía de emergencia si se
    detecta un dato incorrecto después de haber entregado el documento."""
    permission_classes = DECA_PERMS

    def post(self, request, expedicion_id):
        expedicion = get_object_or_404(ExpedicionDeca, id=expedicion_id)
        if expedicion.estado == ExpedicionDeca.Estado.ANULADO:
            raise PermissionDenied('Esta expedición ya está anulada.')

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
        expedicion = get_object_or_404(ExpedicionDeca, token_publico=token)
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
            filename=f'DECA_{expedicion.numero_albaran or expedicion.id}.pdf',
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
