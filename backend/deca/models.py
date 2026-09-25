import uuid

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from core_utils.models import BaseModel

DIAS_VISIBILIDAD_PUBLICA_MINIMO = 7
DIAS_VISIBILIDAD_PUBLICA_DEFECTO = 10
DIAS_RETENCION_IP_EVENTOS_DEFECTO = 365


def _ruta_documento_origen(instance: 'DocumentoOrigenDeca', nombre_archivo: str) -> str:
    """Ruta de guardado de un documento original subido (albarán, CMR...).

    Se indexa por el UUID de la expedición, nunca por el número de albarán
    tecleado por el usuario -- evita cualquier problema de sanitización /
    path traversal sobre un dato de entrada libre (ver services/storage_service.py).

    Sin nivel de empresa en la ruta (decisión de arquitectura: una
    instalación = una empresa, a diferencia de `deca/<empresa_id>/...` en
    el ERP multiempresa origen).
    """
    expedicion = instance.expedicion
    return (
        f'deca/{expedicion.anio}/{expedicion.mes:02d}/'
        f'{expedicion.id}/origen_{instance.id}_{nombre_archivo}'
    )


def _ruta_pdf_deca(instance: 'ExpedicionDeca', nombre_archivo: str) -> str:
    return f'deca/{instance.anio}/{instance.mes:02d}/{instance.id}/DECA_{instance.id}.pdf'


class CanalNotificacion(models.TextChoices):
    EMAIL = 'email', 'Email'
    SMS = 'sms', 'SMS'
    WHATSAPP = 'whatsapp', 'WhatsApp'


class RolHabitualDeca(models.TextChoices):
    CARGADOR = 'cargador', 'Cargador (expide la mercancía)'
    TRANSPORTISTA = 'transportista', 'Transportista (realiza el transporte)'


class ConfiguracionDeca(models.Model):
    """Configuración del módulo DeCA -- SINGLETON de instancia completa (una
    instalación = una empresa, no hay FK a Empresa como en el ERP origen).
    Se accede siempre vía `ConfiguracionDeca.objects.singleton()` /
    `get_solo()`, nunca instanciando una segunda fila (ver `save()`)."""

    # PK fija (siempre 1) en vez de UUID -- más simple para un singleton
    # real que no necesita identificarse desde fuera por su id.
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    fecha_alta = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    # La obligación de formalizar el DeCA es CONJUNTA del cargador
    # contractual y del transportista efectivo (Orden FOM/2861/2012 art. 4,
    # con responsabilidad solidaria en el art. 7), así que el módulo lo usan
    # los dos lados. Este ajuste decide qué campo se precarga con el NIF
    # propio y cómo se reparten los NIF que lee la extracción automática.
    # Siempre se puede corregir a mano en una expedición concreta.
    rol_habitual = models.CharField(
        max_length=20, choices=RolHabitualDeca.choices, default=RolHabitualDeca.CARGADOR,
        help_text='Papel que juega normalmente esta empresa en sus expediciones. Decide qué campo '
                   'se precarga con su propio NIF y cómo se reparten los NIF que lee la extracción '
                   'automática. Siempre se puede corregir a mano en una expedición concreta.',
    )

    # Envío al conductor es obligatorio (siempre se intenta, sin interruptor);
    # cliente y transportista son opt-in, apagados por defecto. El envío en sí
    # (integración real con email/SMS/WhatsApp) es trabajo futuro -- esto solo
    # deja la preferencia de canal ya guardada para cuando se active.
    canal_notificacion_conductor = models.CharField(
        max_length=20, choices=CanalNotificacion.choices, default=CanalNotificacion.EMAIL,
    )
    notificar_cliente_activo = models.BooleanField(default=False)
    canal_notificacion_cliente = models.CharField(
        max_length=20, choices=CanalNotificacion.choices, default=CanalNotificacion.EMAIL,
    )
    notificar_transportista_activo = models.BooleanField(default=False)
    canal_notificacion_transportista = models.CharField(
        max_length=20, choices=CanalNotificacion.choices, default=CanalNotificacion.EMAIL,
    )

    dias_visibilidad_publica = models.PositiveIntegerField(
        default=DIAS_VISIBILIDAD_PUBLICA_DEFECTO,
        validators=[MinValueValidator(DIAS_VISIBILIDAD_PUBLICA_MINIMO)],
        help_text=(
            'Días que la URL pública del QR permite descarga sin login tras '
            'finalizar el transporte. Suelo legal: 7 días (Orden FOM/2861/2012 '
            'y Resolución de 5-jun-2026) -- no se puede configurar por debajo.'
        ),
    )
    dias_retencion_ip_eventos = models.PositiveIntegerField(
        default=DIAS_RETENCION_IP_EVENTOS_DEFECTO,
        help_text=(
            'Días que se conserva la IP de origen de un evento de auditoría '
            '(ej. descarga pública por QR) antes de anonimizarla. No es un '
            'requisito de la norma DeCA -- es minimización de datos RGPD; por '
            'defecto se alinea con la custodia legal de 1 año del propio DeCA. '
            'El resto del evento (tipo, fecha, hash) nunca se borra.'
        ),
    )

    # Cabecera de documento controlado -- mismos 6 campos con el mismo
    # nombre que en el ERP origen (deca/pdf_utils.py::construir_cabecera_documento_controlado
    # los busca por nombre, es agnóstica de dominio).
    informe_mostrar_cabecera = models.BooleanField(default=False)
    informe_codigo_documento = models.CharField(max_length=50, blank=True)
    informe_version = models.CharField(max_length=20, blank=True)
    informe_edicion = models.CharField(max_length=20, blank=True)
    informe_preparado_por = models.CharField(max_length=100, blank=True)
    informe_autorizado_por = models.CharField(max_length=100, blank=True)

    class Meta:
        db_table = 'deca_configuracion'
        verbose_name = 'Configuración de DeCA'
        verbose_name_plural = 'Configuración de DeCA'

    def save(self, *args, **kwargs):
        # Fuerza el singleton a nivel de modelo -- por si alguien intenta
        # crear una segunda fila a mano (shell, fixture) en vez de usar
        # `get_solo()`.
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls) -> 'ConfiguracionDeca':
        config, _creada = cls.objects.get_or_create(pk=1)
        return config

    def __str__(self) -> str:
        return 'Configuración DeCA'


class ExpedicionDeca(BaseModel):
    """Una expedición de transporte con su Documento electrónico de Control
    Administrativo (DeCA). Nace en BORRADOR con los datos extraídos/tecleados
    y pasa a GENERADO cuando el PDF final con QR ya existe."""

    class Estado(models.TextChoices):
        BORRADOR = 'borrador', 'Borrador'
        CONFIRMADO = 'confirmado', 'Confirmado'
        GENERADO = 'generado', 'Generado'
        ANULADO = 'anulado', 'Anulado'

    estado = models.CharField(max_length=20, choices=Estado.choices, default=Estado.BORRADOR)

    numero_albaran = models.CharField(
        max_length=100, blank=True,
        help_text='Número de albarán/expedición tal como lo maneja el cliente (texto libre, no es la PK).',
    )
    numero_cmr = models.CharField(
        max_length=100, blank=True,
        help_text='Número propio de la carta de porte CMR (esquina superior derecha del documento, '
                   'ej. "00000019.300"), distinto del número de albarán -- solo aplica cuando el '
                   'transporte va acompañado de CMR.',
    )

    # Año/mes de la expedición -- fijan la ruta de almacenamiento y no
    # cambian aunque se edite el resto de campos ya confirmados.
    anio = models.PositiveSmallIntegerField()
    mes = models.PositiveSmallIntegerField()

    # Campos mínimos exigidos por la norma -- pero SOLO al Confirmar (ver
    # CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR en views.py). Un borrador puede
    # nacer vacío: subir un documento origen crea el borrador en silencio
    # para poder extraer y autorrellenar estos mismos campos.
    nif_cargador = models.CharField(max_length=20, blank=True)
    nombre_cargador = models.CharField(max_length=255, blank=True)
    nif_transportista = models.CharField(max_length=20, blank=True)
    nombre_transportista = models.CharField(max_length=255, blank=True)
    nif_destinatario = models.CharField(max_length=20, blank=True)
    nombre_destinatario = models.CharField(max_length=255, blank=True)

    matricula_tractor = models.CharField(max_length=15, blank=True)
    matricula_remolque = models.CharField(max_length=15, blank=True)

    origen = models.CharField(max_length=255, blank=True)
    destino = models.CharField(max_length=255, blank=True)
    fecha_hora_transporte = models.DateTimeField(null=True, blank=True)

    naturaleza_mercancia = models.CharField(max_length=255, blank=True)
    peso_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    bultos = models.PositiveIntegerField(null=True, blank=True)
    volumen_m3 = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    codigo_mercancia = models.CharField(
        max_length=50, blank=True,
        help_text='Código UN/ADR u otro código interno de la mercancía, si aplica.',
    )

    # Plus sobre el mínimo legal (campos de estilo TransFollow/eCMR) -- todos
    # opcionales. Si se dejan en blanco, no aparecen en el PDF ni en la
    # ficha de detalle.
    numero_pedido = models.CharField(max_length=100, blank=True)
    instrucciones_conductor = models.TextField(blank=True)
    contacto_emergencias = models.CharField(max_length=255, blank=True)
    tipo_contenedor = models.CharField(max_length=100, blank=True)
    instrucciones_expedidor = models.TextField(blank=True)
    instrucciones_pago = models.TextField(blank=True)
    comentarios = models.TextField(blank=True)

    # Datos de contacto del conductor -- no los exige la norma (el mínimo
    # legal no incluye al conductor), son para el envío del DeCA que la
    # propia empresa quiere hacerle llegar siempre. Al guardarse alimentan
    # además el catálogo reutilizable ConductorDeca (ver
    # services/catalogo_service.py) para no volver a teclearlos.
    nombre_conductor = models.CharField(max_length=255, blank=True)
    nif_conductor = models.CharField(max_length=20, blank=True)
    telefono_conductor = models.CharField(max_length=20, blank=True)
    email_conductor = models.EmailField(blank=True)

    # Acceso público del QR -- token opaco, nunca el id secuencial ni el
    # número de albarán.
    token_publico = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    pdf_generado = models.FileField(upload_to=_ruta_pdf_deca, blank=True, null=True)
    hash_sha256 = models.CharField(max_length=64, blank=True, help_text='SHA-256 del PDF final generado.')
    fecha_generacion = models.DateTimeField(null=True, blank=True)
    fecha_expiracion_publica = models.DateTimeField(
        null=True, blank=True,
        help_text='fecha_generacion + dias_visibilidad_publica vigente en ese momento. Pasada esta fecha, el token deja de servir el PDF sin autenticación.',
    )

    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='expediciones_deca_creadas',
    )

    class Meta:
        db_table = 'deca_expediciones'
        verbose_name = 'Expedición DeCA'
        verbose_name_plural = 'Expediciones DeCA'
        ordering = ['-fecha_alta']

    def __str__(self) -> str:
        return f'DeCA {self.numero_albaran or self.id}'


class DocumentoOrigenDeca(BaseModel):
    """PDF original subido por logística (albarán de venta, CMR, otros) del
    que se extraen/verifican los datos de una ExpedicionDeca. Se conserva
    como adjunto de auditoría aunque el DeCA ya se haya generado."""

    class TipoDocumento(models.TextChoices):
        ALBARAN_VENTA = 'albaran_venta', 'Albarán de venta'
        CMR = 'cmr', 'CMR'
        OTRO = 'otro', 'Otro'

    expedicion = models.ForeignKey(
        ExpedicionDeca, on_delete=models.CASCADE, related_name='documentos_origen',
    )
    tipo_documento = models.CharField(max_length=20, choices=TipoDocumento.choices)
    archivo = models.FileField(upload_to=_ruta_documento_origen)
    nombre_original = models.CharField(max_length=255)
    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='documentos_origen_deca_subidos',
    )

    class Meta:
        db_table = 'deca_documentos_origen'
        verbose_name = 'Documento origen DeCA'
        verbose_name_plural = 'Documentos origen DeCA'
        ordering = ['fecha_alta']

    def __str__(self) -> str:
        return f'{self.get_tipo_documento_display()} — {self.expedicion_id}'


class TransportistaSucesivoDeca(BaseModel):
    """Transportista que interviene en la cadena DESPUÉS del transportista
    efectivo de la expedición (subcontratación) -- el campo mínimo exigido
    por la norma solo pide el efectivo (ver ExpedicionDeca), esto es un
    plus sobre el mínimo legal, inspirado en cómo TransFollow distingue
    'Transportista efectivo' de 'Transportistas posteriores'."""

    expedicion = models.ForeignKey(
        ExpedicionDeca, on_delete=models.CASCADE, related_name='transportistas_sucesivos',
    )
    orden = models.PositiveSmallIntegerField(help_text='Posición en la cadena de subcontratación (1 = el primero tras el transportista efectivo).')
    nif = models.CharField(max_length=20)
    nombre = models.CharField(max_length=255)
    matricula = models.CharField(max_length=15, blank=True)

    class Meta:
        db_table = 'deca_transportistas_sucesivos'
        verbose_name = 'Transportista sucesivo DeCA'
        verbose_name_plural = 'Transportistas sucesivos DeCA'
        ordering = ['orden']
        constraints = [
            models.UniqueConstraint(fields=['expedicion', 'orden'], name='deca_transportista_sucesivo_orden_unico'),
        ]

    def __str__(self) -> str:
        return f'{self.nombre} (#{self.orden}) — {self.expedicion_id}'


class EventoExpedicionDeca(BaseModel):
    """Registro de auditoría append-only de todo lo que le pasa a una
    expedición -- inspirado en la 'captura de eventos inmutable' que
    TransFollow presume como argumento ante litigios/auditorías. Nunca se
    edita ni se borra una fila de aquí (solo se crean)."""

    class TipoEvento(models.TextChoices):
        CREADA = 'creada', 'Expedición creada'
        DOCUMENTO_SUBIDO = 'documento_subido', 'Documento origen subido'
        VISTA_PREVIA = 'vista_previa', 'Vista previa generada'
        EDITADA = 'editada', 'Datos editados'
        CONFIRMADA = 'confirmada', 'Confirmada'
        GENERADA = 'generada', 'DeCA generado'
        DESCARGA_PUBLICA = 'descarga_publica', 'Descarga pública por QR'
        ANULADA = 'anulada', 'Anulada'
        ENVIADA_EMAIL = 'enviada_email', 'Enviada por email'

    expedicion = models.ForeignKey(
        ExpedicionDeca, on_delete=models.CASCADE, related_name='eventos',
    )
    tipo_evento = models.CharField(max_length=20, choices=TipoEvento.choices)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='eventos_deca',
        help_text='Vacío en eventos sin usuario autenticado (ej. descarga pública por QR).',
    )
    detalle = models.TextField(blank=True)
    hash_documento = models.CharField(
        max_length=64, blank=True,
        help_text='hash_sha256 de la expedición en el momento del evento -- permite demostrar qué versión exacta del PDF se sirvió/consultó.',
    )
    ip_origen = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        db_table = 'deca_eventos_expedicion'
        verbose_name = 'Evento de expedición DeCA'
        verbose_name_plural = 'Eventos de expedición DeCA'
        ordering = ['fecha_alta']

    def __str__(self) -> str:
        return f'{self.get_tipo_evento_display()} — {self.expedicion_id} — {self.fecha_alta:%Y-%m-%d %H:%M}'


class ConductorDeca(BaseModel):
    """Catálogo reutilizable de conductores -- se alimenta solo al confirmar
    una expedición con datos de conductor nuevos (ver services/catalogo_service.py),
    para no volver a teclearlos la próxima vez."""

    nombre = models.CharField(max_length=255)
    nif = models.CharField(max_length=20, unique=True)
    telefono = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'deca_conductores'
        verbose_name = 'Conductor DeCA'
        verbose_name_plural = 'Conductores DeCA'
        ordering = ['nombre']

    def __str__(self) -> str:
        return f'{self.nombre} ({self.nif})'


class TractoraDeca(BaseModel):
    """Catálogo reutilizable de cabezas tractoras -- misma idea que
    ConductorDeca/EmpresaTransportistaDeca: rellenar la expedición con el
    mínimo trabajo posible.

    Independiente de RemolqueDeca a propósito: en la operativa real una
    tractora suelta se combina con distintos remolques según el día, así
    que guardar la pareja como una sola ficha obligaría a sobrescribir el
    remolque anterior cada vez que cambia."""

    matricula = models.CharField(max_length=20, unique=True)
    alias = models.CharField(max_length=100, blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'deca_tractoras'
        verbose_name = 'Tractora DeCA'
        verbose_name_plural = 'Tractoras DeCA'
        ordering = ['matricula']

    def __str__(self) -> str:
        etiqueta = self.alias or self.matricula
        return f'{etiqueta} ({self.matricula})'


class RemolqueDeca(BaseModel):
    """Catálogo reutilizable de remolques -- ver `TractoraDeca` para el
    porqué de separarlos en dos catálogos independientes."""

    matricula = models.CharField(max_length=20, unique=True)
    alias = models.CharField(max_length=100, blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'deca_remolques'
        verbose_name = 'Remolque DeCA'
        verbose_name_plural = 'Remolques DeCA'
        ordering = ['matricula']

    def __str__(self) -> str:
        etiqueta = self.alias or self.matricula
        return f'{etiqueta} ({self.matricula})'


class DestinatarioDeca(BaseModel):
    """Catálogo reutilizable de destinatarios (quien RECIBE la mercancía).

    Se llama "destinatario" y no "cliente" a propósito: en el caso típico
    (la empresa expide a su cliente) coinciden, pero para una empresa de
    transporte el destinatario es un tercero y su cliente es el cargador;
    en un traslado entre almacenes propios el destinatario es la propia
    empresa; en una triangulación es el cliente de su cliente. El término
    legal de la norma (Orden FOM/2861/2012 art. 6) es el único que vale en
    todos los casos."""

    nif = models.CharField(max_length=20, unique=True)
    nombre = models.CharField(max_length=255)
    telefono = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'deca_destinatarios'
        verbose_name = 'Destinatario DeCA'
        verbose_name_plural = 'Destinatarios DeCA'
        ordering = ['nombre']

    def __str__(self) -> str:
        return f'{self.nombre} ({self.nif})'


class EmpresaTransportistaDeca(BaseModel):
    """Catálogo reutilizable de empresas transportistas -- misma idea que
    ConductorDeca. `ExpedicionDeca.nif_transportista`/`nombre_transportista`
    siguen siendo texto libre (no se convierten en FK para no romper lo ya
    construido); este catálogo solo sirve para autocompletar esos campos."""

    nif = models.CharField(max_length=20, unique=True)
    nombre = models.CharField(max_length=255)
    telefono = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'deca_empresas_transportistas'
        verbose_name = 'Empresa transportista DeCA'
        verbose_name_plural = 'Empresas transportistas DeCA'
        ordering = ['nombre']

    def __str__(self) -> str:
        return f'{self.nombre} ({self.nif})'
