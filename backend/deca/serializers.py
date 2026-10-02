import re

from django.utils import timezone
from rest_framework import serializers

from core_utils.validadores_fiscales import normalizar, validar_identificador_fiscal
from .services.storage_service import fecha_limite_edicion as _fecha_limite_edicion
from .services.storage_service import puede_editar_generado as _puede_editar_generado

from .models import (
    AliasAgendaDeca,
    CargadorDeca,
    ConductorDeca,
    ConfiguracionDeca,
    DestinatarioDeca,
    DocumentoOrigenDeca,
    EmpresaTransportistaDeca,
    EventoExpedicionDeca,
    ExpedicionDeca,
    PlantillaDocumentoDeca,
    RemolqueDeca,
    TractoraDeca,
    TransportistaSucesivoDeca,
)
from .services.storage_service import acceso_publico_vigente as _acceso_publico_vigente

# Matrículas que se aceptan (sin espacios ni guiones, ya normalizadas):
# - española actual: 1234ABC;
# - remolque/semirremolque español: R1234ABC;
# - provincial antigua: CA1234AB, M1234Z...;
# - extranjera (camión portugués, francés...): 4 a 10 letras y números,
#   con al menos una letra y una cifra.
# Antes solo se aceptaba 1234ABC y un camión extranjero o con placa antigua no
# se podía ni guardar (revisado 2026-09-30). Todas cumplen la última regla;
# se dejan las otras por claridad de lo que cubre.
_RE_MATRICULA = re.compile(r'^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{4,10}$')


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


# De quién es cada NIF/matrícula, para que el error lo diga: un "NIF/CIF no
# válido" suelto no decía si era el del transportista, el del cargador o el
# del destinatario (pedido del usuario 2026-09-29).
_DE_QUIEN = {
    'nif_cargador': 'del cargador', 'nif_transportista': 'del transportista',
    'nif_destinatario': 'del destinatario', 'nif_conductor': 'del conductor',
    'matricula_tractor': 'del vehículo', 'matricula_remolque': 'del remolque',
}


def _validar_nif(valor: str, campo: str) -> str:
    """Igual que `_normalizar_y_validar_nif` pero pensada para un `validate()`
    de objeto completo, donde el error sí debe ir anclado al campo a mano."""
    try:
        return _normalizar_y_validar_nif(valor)
    except serializers.ValidationError:
        de_quien = _DE_QUIEN.get(campo, '')
        raise serializers.ValidationError({campo: (
            f'El NIF/CIF {de_quien} «{normalizar(valor)}» no es válido: revisa que esté bien copiado '
            '(la última cifra o letra es de control y no vale un número inventado).'
        ).replace('  ', ' ')})


def _normalizar_y_validar_matricula(valor: str) -> str:
    """Igual que `_normalizar_y_validar_nif` pero para matrícula -- pensada
    para un `validate_<campo>` de nivel de campo."""
    valor = normalizar(valor)
    if not _RE_MATRICULA.match(valor):
        raise serializers.ValidationError(
            'Matrícula no válida: escríbela sin espacios, por ejemplo 1234ABC, R1234ABC (remolque), CA1234AB o una extranjera.'
        )
    return valor


def _validar_matricula(valor: str, campo: str) -> str:
    """Igual que `_validar_nif` pero para matrícula -- pensada para un
    `validate()` de objeto completo, donde el error va anclado al campo a mano."""
    try:
        return _normalizar_y_validar_matricula(valor)
    except serializers.ValidationError:
        de_quien = _DE_QUIEN.get(campo, '')
        raise serializers.ValidationError({campo: (
            f'La matrícula {de_quien} «{normalizar(valor)}» no parece una matrícula: escríbela con sus letras y '
            'números, por ejemplo 1234ABC, R1234ABC (remolque), CA1234AB o una extranjera.'
        ).replace('  ', ' ')})


class ConfiguracionDecaSerializer(serializers.ModelSerializer):
    # Lista efectiva de obligatorios para Confirmar (según
    # `exigir_datos_destinatario`): la pantalla la usa para marcar los campos,
    # de la MISMA fuente que valida el servidor (services/obligatorios_service.py).
    campos_obligatorios = serializers.SerializerMethodField()

    class Meta:
        model = ConfiguracionDeca
        fields = [
            'id', 'rol_habitual', 'dias_visibilidad_publica', 'dias_retencion_ip_eventos',
            'horas_max_edicion_generado', 'exigir_datos_destinatario', 'campos_obligatorios',
            'identificador_preferido', 'prefijo_numero_automatico', 'ultimo_numero_automatico',
            'canal_notificacion_conductor',
            'notificar_cliente_activo', 'canal_notificacion_cliente',
            'notificar_transportista_activo', 'canal_notificacion_transportista',
            'informe_mostrar_cabecera', 'informe_codigo_documento', 'informe_version',
            'informe_edicion', 'informe_preparado_por', 'informe_autorizado_por',
            'plantilla_asunto_email', 'plantilla_cuerpo_email',
            'modo_sin_cobertura', 'ejemplares_sin_cobertura', 'registrar_papel_por_foto',
            'deca_anticipado', 'aviso_sin_completar', 'aviso_sin_completar_dias',
            'agenda_prioritaria',
        ]
        # El contador solo lo mueve identificador_service.asignar_numero_interno_si_procede
        # (al Generar) -- editarlo a mano desde Configuración podría repetir
        # o saltarse números ya emitidos.
        read_only_fields = ['ultimo_numero_automatico']

    def get_campos_obligatorios(self, obj):
        from .services.obligatorios_service import para_configuracion

        return para_configuracion(obj)

    def validate(self, attrs):
        # El DeCA anticipado se corrige con el peso real dentro de la ventana
        # de corrección: sin ventana (0 horas) no habría forma de corregirlo.
        anticipado = attrs.get('deca_anticipado', getattr(self.instance, 'deca_anticipado', False))
        horas = attrs.get('horas_max_edicion_generado', getattr(self.instance, 'horas_max_edicion_generado', 0))
        if anticipado and not horas:
            raise serializers.ValidationError({'deca_anticipado': (
                'El DeCA anticipado necesita horas para corregir un DeCA ya generado: '
                'sin esa ventana no se podría poner el peso real antes de la salida.'
            )})
        return attrs


class ConductorDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConductorDeca
        fields = ['id', 'nombre', 'nif', 'telefono', 'email', 'activo']
        read_only_fields = ['id']

    def validate_nif(self, valor):
        return _normalizar_y_validar_nif(valor)


class CargadorDecaSerializer(serializers.ModelSerializer):
    class Meta:
        model = CargadorDeca
        fields = ['id', 'nombre', 'nif', 'domicilio', 'telefono', 'email', 'activo']
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
    puede_editar = serializers.SerializerMethodField()
    fecha_limite_edicion = serializers.SerializerMethodField()

    class Meta:
        model = ExpedicionDeca
        fields = [
            'id', 'estado', 'numero_albaran', 'numero_cmr', 'numero_interno', 'anio', 'mes',
            'nif_cargador', 'nombre_cargador', 'domicilio_cargador',
            'nif_transportista', 'nombre_transportista',
            'nif_destinatario', 'nombre_destinatario',
            'matricula_tractor', 'matricula_remolque', 'sin_remolque', 'autorizacion_especial',
            'referencia_offline', 'emitido_sin_conexion_en',
            'origen', 'destino', 'fecha_hora_transporte',
            'naturaleza_mercancia', 'peso_kg', 'peso_estimado', 'bultos', 'volumen_m3', 'codigo_mercancia',
            'numero_pedido', 'instrucciones_conductor', 'contacto_emergencias', 'tipo_contenedor',
            'instrucciones_expedidor', 'instrucciones_pago', 'comentarios',
            'nombre_conductor', 'nif_conductor', 'telefono_conductor', 'email_conductor',
            'token_publico', 'hash_sha256', 'fecha_generacion', 'fecha_expiracion_publica',
            'creado_por', 'documentos_origen', 'transportistas_sucesivos', 'acceso_publico_vigente',
            'tiene_pdf_generado', 'puede_editar', 'fecha_limite_edicion',
        ]
        read_only_fields = [
            'id', 'estado', 'numero_interno', 'anio', 'mes', 'token_publico', 'hash_sha256',
            'fecha_generacion', 'fecha_expiracion_publica', 'creado_por',
            'documentos_origen', 'transportistas_sucesivos', 'acceso_publico_vigente',
            'tiene_pdf_generado', 'puede_editar', 'fecha_limite_edicion',
        ]

    def get_creado_por(self, obj):
        return _nombre_usuario(obj.creado_por)

    def get_acceso_publico_vigente(self, obj):
        return _acceso_publico_vigente(obj)

    def get_puede_editar(self, obj):
        # El frontend usa esto para decidir readOnly -- nunca vuelve a
        # calcular horas a mano, así config y frontend nunca divergen.
        if obj.estado in (ExpedicionDeca.Estado.ANULADO, ExpedicionDeca.Estado.PAPEL):
            return False
        if obj.estado == ExpedicionDeca.Estado.GENERADO:
            return _puede_editar_generado(obj)
        return True

    def get_fecha_limite_edicion(self, obj):
        if obj.estado != ExpedicionDeca.Estado.GENERADO:
            return None
        return _fecha_limite_edicion(obj)

    def get_tiene_pdf_generado(self, obj):
        # Usado por el frontend para decidir si una expedición ANULADA se
        # puede borrar (nunca llegó a generarse el DeCA oficial) o hay que
        # conservarla por auditoría (ver ExpedicionDecaDetailView.perform_destroy).
        return bool(obj.pdf_generado)

    def validate(self, attrs):
        # Anulada: siempre inmutable, sin excepción -- para corregir algo se
        # anula y se crea una expedición nueva (ver AnularExpedicionDecaView).
        # Generada: editable solo dentro del plazo de gracia configurado
        # (ConfiguracionDeca.horas_max_edicion_generado, ver
        # puede_editar_generado) -- caso real: el chófer avisa de un dato
        # mal escrito nada más salir. Fuera de plazo, vuelve a ser
        # inmutable como antes; cada corrección dentro de plazo regenera el
        # PDF y queda en el historial (ver ExpedicionDecaDetailView.perform_update).
        if self.instance and self.instance.estado == ExpedicionDeca.Estado.ANULADO:
            raise serializers.ValidationError('No se puede editar una expedición anulada.')
        # Un DeCA en papel es la copia del documento que viajó: no se toca.
        if self.instance and self.instance.estado == ExpedicionDeca.Estado.PAPEL:
            raise serializers.ValidationError('No se puede editar un DeCA en papel ya registrado.')
        # Peso estimado solo si la empresa trabaja con DeCA anticipado.
        if attrs.get('peso_estimado'):
            config = ConfiguracionDeca.objects.filter(pk=1).first()
            if not (config and config.deca_anticipado):
                raise serializers.ValidationError({'peso_estimado': 'Tu empresa no tiene activado el DeCA anticipado (Configuración de DeCA).'})
        if self.instance and self.instance.estado == ExpedicionDeca.Estado.GENERADO:
            if not _puede_editar_generado(self.instance):
                raise serializers.ValidationError(
                    'El plazo para corregir este DeCA ya generado ha vencido -- '
                    'para cambiar un dato ahora hay que anularlo y crear una expedición nueva.'
                )

        # Un borrador puede nacer sin estos datos (ver comentario en
        # models.py) -- solo se valida el formato cuando SÍ hay algo escrito,
        # nunca una cadena vacía.
        for campo in ('nif_cargador', 'nif_transportista', 'nif_destinatario', 'nif_conductor'):
            if attrs.get(campo):
                attrs[campo] = _validar_nif(attrs[campo], campo)

        for campo in ('matricula_tractor', 'matricula_remolque'):
            if attrs.get(campo):
                attrs[campo] = _validar_matricula(attrs[campo], campo)

        # La referencia y la fecha de un DeCA hecho sin cobertura solo se
        # fijan al crearlo (desde el móvil al volver la cobertura): después no
        # se pueden cambiar, son la huella del documento que viajó en papel.
        # Única excepción: un borrador empezado CON cobertura y terminado sin
        # ella, que aún no tiene referencia -- la recibe una sola vez.
        fijable_ahora = (
            self.instance is not None
            and not self.instance.referencia_offline
            and self.instance.estado == 'borrador'
            and attrs.get('referencia_offline')
        )
        if self.instance is not None and not fijable_ahora:
            attrs.pop('referencia_offline', None)
            attrs.pop('emitido_sin_conexion_en', None)

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


class PlantillaDocumentoDecaSerializer(serializers.ModelSerializer):
    """Modelo de documento de la empresa (services/plantillas_service.py).
    `instrucciones` y `valores_fijos` acaban dentro del prompt de la IA de
    la propia empresa: se acotan en tamaño y en claves, nada más."""

    MAXIMO_INSTRUCCIONES = 1500

    # Datos que han salido iguales en los últimos DeCA de este modelo: se
    # proponen al administrador para fijarlos (fase 2 del aprendizaje).
    sugerencias_valores_fijos = serializers.SerializerMethodField()

    class Meta:
        model = PlantillaDocumentoDeca
        fields = [
            'id', 'nombre', 'tipo_documento', 'texto_identificativo', 'instrucciones',
            'valores_fijos', 'activo', 'veces_aplicada', 'ultima_vez_aplicada', 'sugerencias_valores_fijos',
        ]
        read_only_fields = ['id', 'veces_aplicada', 'ultima_vez_aplicada', 'sugerencias_valores_fijos']

    def get_sugerencias_valores_fijos(self, plantilla):
        from deca.services.aprendizaje_service import sugerencias_valores_fijos
        return sugerencias_valores_fijos(plantilla) if plantilla.pk else []

    def validate_instrucciones(self, valor):
        if len(valor or '') > self.MAXIMO_INSTRUCCIONES:
            raise serializers.ValidationError(f'Máximo {self.MAXIMO_INSTRUCCIONES} caracteres.')
        return valor

    def validate_valores_fijos(self, valor):
        from .services.plantillas_service import CAMPOS_FIJABLES

        if not isinstance(valor, dict):
            raise serializers.ValidationError('Formato no válido.')
        limpio = {}
        for clave, dato in valor.items():
            if clave not in CAMPOS_FIJABLES:
                raise serializers.ValidationError(f'"{clave}" no se puede fijar en un modelo de documento.')
            if dato in (None, ''):
                continue
            if not isinstance(dato, str) or len(dato) > 255:
                raise serializers.ValidationError(f'Valor no válido para "{clave}".')
            limpio[clave] = _normalizar_y_validar_nif(dato) if clave.startswith('nif_') else dato.strip()
        return limpio


class AliasAgendaDecaSerializer(serializers.ModelSerializer):
    """Sinónimos aprendidos (solo lectura + borrar): se crean solos al
    generar DeCA en los que la persona corrigió lo que leyó la IA."""
    fiable = serializers.BooleanField(read_only=True)

    class Meta:
        model = AliasAgendaDeca
        fields = ['id', 'rol', 'texto', 'texto_original', 'nombre', 'nif', 'veces_confirmado',
                  'ultima_confirmacion', 'fiable']
        read_only_fields = fields