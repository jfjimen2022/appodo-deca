import re

from django.utils import timezone
from rest_framework import serializers

from core_utils.validadores_fiscales import normalizar, validar_identificador_fiscal

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
from .services.storage_service import acceso_publico_vigente as _acceso_publico_vigente

_RE_MATRICULA = re.compile(r'^\d{4}[A-Z]{3}$')


def _nombre_usuario(usuario):
    if not usuario:
        return None
    return usuario.get_full_name() or usuario.username


def _normalizar_y_validar_nif(valor: str) -> str:
    """Normaliza y valida un NIF/CIF suelto -- para usar en un `validate_<campo>`
    de nivel de campo (DRF espera un string/None, no un dict, en ese contexto)."""
    valor = normalizar(valor)
    if not validar_identificador_fiscal(valor, 'otro'):
        raise serializers.ValidationError('NIF/CIF no válido -- revisa el dígito de control, no vale un número inventado')
    return valor


def _validar_nif(valor: str, campo: str) -> str:
    """Igual que `_normalizar_y_validar_nif` pero pensada para un `validate()`
    de objeto completo, donde el error sí debe ir anclado al campo a mano."""
    try:
        return _normalizar_y_validar_nif(valor)
    except serializers.ValidationError:
        raise serializers.ValidationError({campo: 'NIF/CIF no válido -- revisa el dígito de control, no vale un número inventado'})


def _normalizar_y_validar_matricula(valor: str) -> str:
    """Igual que `_normalizar_y_validar_nif` pero para matrícula -- pensada
    para un `validate_<campo>` de nivel de campo."""
    valor = normalizar(valor)
    if not _RE_MATRICULA.match(valor):
        raise serializers.ValidationError('Matrícula no válida (formato 1234ABC)')
    return valor


def _validar_matricula(valor: str, campo: str) -> str:
    """Igual que `_validar_nif` pero para matrícula -- pensada para un
    `validate()` de objeto completo, donde el error va anclado al campo a mano."""
    try:
        return _normalizar_y_validar_matricula(valor)
    except serializers.ValidationError:
        raise serializers.ValidationError({campo: 'Matrícula no válida (formato 1234ABC)'})


class ConfiguracionDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfiguracionDeca
        fields = [
            'id', 'rol_habitual', 'dias_visibilidad_publica', 'dias_retencion_ip_eventos',
            'canal_notificacion_conductor',
            'notificar_cliente_activo', 'canal_notificacion_cliente',
            'notificar_transportista_activo', 'canal_notificacion_transportista',
            'informe_mostrar_cabecera', 'informe_codigo_documento', 'informe_version',
            'informe_edicion', 'informe_preparado_por', 'informe_autorizado_por',
        ]
        read_only_fields = ['id']


class ConductorDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConductorDeca
        fields = ['id', 'nombre', 'nif', 'telefono', 'email', 'activo']
        read_only_fields = ['id']

    def validate_nif(self, valor):
        return _normalizar_y_validar_nif(valor)


class EmpresaTransportistaDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmpresaTransportistaDeca
        fields = ['id', 'nombre', 'nif', 'telefono', 'email', 'activo']
        read_only_fields = ['id']

    def validate_nif(self, valor):
        return _normalizar_y_validar_nif(valor)


class DestinatarioDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = DestinatarioDeca
        fields = ['id', 'nombre', 'nif', 'telefono', 'email', 'activo']
        read_only_fields = ['id']

    def validate_nif(self, valor):
        return _normalizar_y_validar_nif(valor)


class TractoraDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = TractoraDeca
        fields = ['id', 'matricula', 'alias', 'activo']
        read_only_fields = ['id']

    def validate_matricula(self, valor):
        return _normalizar_y_validar_matricula(valor)


class RemolqueDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = RemolqueDeca
        fields = ['id', 'matricula', 'alias', 'activo']
        read_only_fields = ['id']

    def validate_matricula(self, valor):
        return _normalizar_y_validar_matricula(valor)


class DocumentoOrigenDecaSerializer(serializers.ModelSerializer):
    subido_por = serializers.SerializerMethodField()

    class Meta:
        model = DocumentoOrigenDeca
        fields = ['id', 'tipo_documento', 'archivo', 'nombre_original', 'subido_por', 'fecha_alta']
        # `archivo` es de solo lectura aquí: reemplazar el fichero pasa por
        # borrar + subir uno nuevo (valida tipo/tamaño, ver
        # DocumentoOrigenDecaUploadView), nunca por un PATCH directo.
        read_only_fields = ['id', 'archivo', 'subido_por', 'fecha_alta']

    def get_subido_por(self, obj):
        return _nombre_usuario(obj.subido_por)


class TransportistaSucesivoDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportistaSucesivoDeca
        fields = ['id', 'expedicion', 'orden', 'nif', 'nombre', 'matricula']
        # `expedicion` la fija siempre la vista a partir de la URL
        # (TransportistaSucesivoListCreateView.perform_create) -- nunca
        # debe llegar por el payload.
        read_only_fields = ['id', 'expedicion']

    def validate(self, attrs):
        expedicion = attrs.get('expedicion') or getattr(self.instance, 'expedicion', None)
        if expedicion and expedicion.estado != ExpedicionDeca.Estado.BORRADOR:
            raise serializers.ValidationError('Solo se puede editar la cadena de transportistas mientras la expedición está en borrador.')

        if 'nif' in attrs:
            attrs['nif'] = _validar_nif(attrs['nif'], 'nif')
        if attrs.get('matricula'):
            attrs['matricula'] = _validar_matricula(attrs['matricula'], 'matricula')
        return attrs


class EventoExpedicionDecaSerializer(serializers.ModelSerializer):
    usuario = serializers.SerializerMethodField()

    class Meta:
        model = EventoExpedicionDeca
        fields = ['id', 'tipo_evento', 'usuario', 'detalle', 'hash_documento', 'ip_origen', 'fecha_alta']
        read_only_fields = fields

    def get_usuario(self, obj):
        return _nombre_usuario(obj.usuario)


class ExpedicionDecaSerializer(serializers.ModelSerializer):
    creado_por = serializers.SerializerMethodField()
    documentos_origen = DocumentoOrigenDecaSerializer(many=True, read_only=True)
    transportistas_sucesivos = TransportistaSucesivoDecaSerializer(many=True, read_only=True)
    acceso_publico_vigente = serializers.SerializerMethodField()
    tiene_pdf_generado = serializers.SerializerMethodField()

    class Meta:
        model = ExpedicionDeca
        fields = [
            'id', 'estado', 'numero_albaran', 'numero_cmr', 'anio', 'mes',
            'nif_cargador', 'nombre_cargador',
            'nif_transportista', 'nombre_transportista',
            'nif_destinatario', 'nombre_destinatario',
            'matricula_tractor', 'matricula_remolque',
            'origen', 'destino', 'fecha_hora_transporte',
            'naturaleza_mercancia', 'peso_kg', 'bultos', 'volumen_m3', 'codigo_mercancia',
            'numero_pedido', 'instrucciones_conductor', 'contacto_emergencias', 'tipo_contenedor',
            'instrucciones_expedidor', 'instrucciones_pago', 'comentarios',
            'nombre_conductor', 'nif_conductor', 'telefono_conductor', 'email_conductor',
            'token_publico', 'hash_sha256', 'fecha_generacion', 'fecha_expiracion_publica',
            'creado_por', 'documentos_origen', 'transportistas_sucesivos', 'acceso_publico_vigente',
            'tiene_pdf_generado',
        ]
        read_only_fields = [
            'id', 'estado', 'anio', 'mes', 'token_publico', 'hash_sha256',
            'fecha_generacion', 'fecha_expiracion_publica', 'creado_por',
            'documentos_origen', 'transportistas_sucesivos', 'acceso_publico_vigente',
            'tiene_pdf_generado',
        ]

    def get_creado_por(self, obj):
        return _nombre_usuario(obj.creado_por)

    def get_acceso_publico_vigente(self, obj):
        return _acceso_publico_vigente(obj)

    def get_tiene_pdf_generado(self, obj):
        # Usado por el frontend para decidir si una expedición ANULADA se
        # puede borrar (nunca llegó a generarse el DeCA oficial) o hay que
        # conservarla por auditoría (ver ExpedicionDecaDetailView.perform_destroy).
        return bool(obj.pdf_generado)

    def validate(self, attrs):
        # Una vez generado el PDF, la ruta de almacenamiento (año/mes) y los
        # datos ya quedaron fijados en el documento -- editar aquí desincroniza
        # lo firmado en el PDF con lo que muestra la ficha.
        if self.instance and self.instance.estado in (
            ExpedicionDeca.Estado.GENERADO, ExpedicionDeca.Estado.ANULADO,
        ):
            raise serializers.ValidationError('No se puede editar una expedición ya generada.')

        # Un borrador puede nacer sin estos datos (ver comentario en
        # models.py) -- solo se valida el formato cuando SÍ hay algo escrito,
        # nunca una cadena vacía.
        for campo in ('nif_cargador', 'nif_transportista', 'nif_destinatario', 'nif_conductor'):
            if attrs.get(campo):
                attrs[campo] = _validar_nif(attrs[campo], campo)

        for campo in ('matricula_tractor', 'matricula_remolque'):
            if attrs.get(campo):
                attrs[campo] = _validar_matricula(attrs[campo], campo)

        return attrs

    def create(self, validated_data):
        # anio/mes no llegan por request: se derivan siempre de la fecha real
        # del transporte para que la ruta de almacenamiento del PDF sea
        # consistente. Un borrador recién creado desde "subir documento"
        # puede no traer todavía la fecha real (la extracción es lo que la
        # rellena) -- cae a la fecha actual como marcador provisional, se
        # recalcula en cuanto se guarde la fecha real.
        fecha = validated_data.get('fecha_hora_transporte')
        if fecha is None:
            fecha = timezone.now()
        validated_data['anio'] = fecha.year
        validated_data['mes'] = fecha.month
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if 'fecha_hora_transporte' in validated_data and validated_data['fecha_hora_transporte'] is not None:
            fecha = validated_data['fecha_hora_transporte']
            validated_data['anio'] = fecha.year
            validated_data['mes'] = fecha.month
        # Editar una expedición ya CONFIRMADA la devuelve a BORRADOR -- así
        # cualquier cambio (incluido vaciar un campo obligatorio) obliga a
        # re-confirmar antes de poder generar el DeCA. Cierra la vía
        # "confirmar -> vaciar campos por PATCH -> generar sin re-validar"
        # (GenerarDecaView ya repite además la comprobación de campos
        # obligatorios como última barrera).
        if instance.estado == ExpedicionDeca.Estado.CONFIRMADO:
            validated_data['estado'] = ExpedicionDeca.Estado.BORRADOR
        return super().update(instance, validated_data)


class ExpedicionDecaEnviarEmailSerializer(serializers.Serializer):
    """Body de POST .../enviar-email/ -- asunto/cuerpo opcionales, se generan
    con un texto por defecto si no vienen (ver services/email_service.py)."""
    destinatario = serializers.EmailField()
    asunto = serializers.CharField(required=False, allow_blank=True)
    cuerpo = serializers.CharField(required=False, allow_blank=True)
