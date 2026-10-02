import os
import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from core_utils.models import BaseModel

DIAS_VISIBILIDAD_PUBLICA_MINIMO = 7
DIAS_VISIBILIDAD_PUBLICA_DEFECTO = 10
DIAS_RETENCION_IP_EVENTOS_DEFECTO = 365
HORAS_MAX_EDICION_GENERADO_DEFECTO = 24


def _ruta_documento_origen(instance: 'DocumentoOrigenDeca', nombre_archivo: str) -> str:
    """Ruta de guardado de un documento original subido (albarán, CMR...).

    Se indexa por el UUID de la expedición, nunca por el número de albarán
    tecleado por el usuario -- evita cualquier problema de sanitización /
    path traversal sobre un dato de entrada libre (ver services/storage_service.py).

    Sin nivel de empresa en la ruta (decisión de arquitectura: una
    instalación = una empresa, a diferencia de `deca/<empresa_id>/...` en
    el ERP multiempresa origen).

    Solo la EXTENSIÓN del nombre original entra en la ruta (el nombre completo
    se guarda aparte en `nombre_original`, que es el que ve el usuario). Con el
    nombre dentro, la ruta pasaba de 100 caracteres -- tres UUID ya ocupan
    ~92 --, Django la recortaba y, con una extensión `.jpeg` o un nombre
    repetido, no le quedaba sitio y abortaba la subida con un 400 genérico
    (p. ej. la foto `IMG_3677.jpeg` de un iPhone). Además el campo pasa a
    `max_length=255`.
    """
    expedicion = instance.expedicion
    extension = os.path.splitext(nombre_archivo or '')[1].lower()[:10]
    return (
        f'deca/{expedicion.anio}/{expedicion.mes:02d}/'
        f'{expedicion.id}/origen_{instance.id}{extension}'
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


class IdentificadorExpedicionDeca(models.TextChoices):
    """Qué campo usa esta empresa como referencia de cara al cliente (asunto
    de email, nombre de PDF, título de auditoría...): no todas las empresas
    usan el número de albarán como su referencia, algunas usan el número de
    CMR, y otras no tienen ningún número externo propio y necesitan que la
    aplicación les numere. Ver
    `deca.services.identificador_service.identificador_expedicion`,
    punto único que resuelve esto -- nunca duplicar el criterio en un
    segundo sitio."""
    NUMERO_ALBARAN = 'numero_albaran', 'Número de albarán'
    NUMERO_CMR = 'numero_cmr', 'Número de CMR'
    AUTOMATICO = 'automatico', 'Contador automático'


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

    # Referencia de cara al cliente: una empresa usa su número de albarán,
    # otra puede usar el número de CMR como referencia, y otra puede no
    # tener ningún número externo propio. `numero_automatico_*` solo se
    # consume cuando `identificador_preferido='automatico'` -- el contador
    # se incrementa en `identificador_service.asignar_numero_interno_si_procede`,
    # llamado una única vez al Generar (nunca en Borrador/Confirmado, para no
    # "quemar" números de expediciones que se acaban borrando).
    identificador_preferido = models.CharField(
        max_length=20, choices=IdentificadorExpedicionDeca.choices,
        default=IdentificadorExpedicionDeca.NUMERO_ALBARAN,
        help_text='Qué número se usa como referencia de esta empresa en el asunto del email, el '
                   'nombre del PDF y el título del historial de auditoría. Si el campo elegido está '
                   'vacío en una expedición concreta, se cae en cascada al siguiente disponible '
                   '(albarán → CMR → contador automático → id interno), nunca se deja sin nada.',
    )
    prefijo_numero_automatico = models.CharField(max_length=20, blank=True, default='DECA-')
    ultimo_numero_automatico = models.PositiveIntegerField(default=0)

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

    # Ventana de gracia para corregir un dato mal escrito DESPUÉS de generar
    # el DeCA oficial, sin tener que anular y crear una expedición nueva --
    # caso real: el chófer llama nada más salir porque un dato está mal.
    # Cada corrección dentro del plazo regenera el PDF (mismo QR/token) y
    # queda registrada en el historial con el usuario que la hizo (ver
    # ExpedicionDecaDetailView.perform_update). El plazo se cuenta SIEMPRE
    # desde la primera generación (`fecha_generacion`), nunca se alarga al
    # corregir. 0 = sin plazo de gracia, se comporta como antes (inmutable
    # en cuanto se genera) -- no es un mínimo legal, es una decisión de
    # producto, así que no lleva validador de suelo.
    # La Orden FOM/2861/2012 (art. 6) NO exige ningún dato del destinatario:
    # solo nombre+NIF+domicilio del cargador y nombre+NIF del transportista.
    # Por defecto, pues, nombre y NIF del destinatario son opcionales al
    # Confirmar; una empresa que quiera exigirlos por su cuenta lo activa aquí.
    exigir_datos_destinatario = models.BooleanField(
        default=False,
        help_text='Exigir nombre y NIF del destinatario para poder confirmar (la norma no los exige).',
    )

    horas_max_edicion_generado = models.PositiveIntegerField(
        default=HORAS_MAX_EDICION_GENERADO_DEFECTO,
        help_text=(
            'Horas desde que se generó el DeCA oficial durante las que se '
            'puede seguir corrigiendo un dato sin anular la expedición. '
            'Pasado este plazo, queda bloqueada como siempre.'
        ),
    )

    # ── Trabajo en campo y sin cobertura (2026-09-30) ──────────────────────
    # Cada empresa elige cómo trabaja cuando no hay red en la finca. El modo
    # es UNO solo (son formas excluyentes de resolver lo mismo); el resto son
    # interruptores independientes. Ver la leyenda de cada uno en
    # ConfiguracionDecaPage (bloque "Trabajo en campo").
    class ModoSinCobertura(models.TextChoices):
        IMPRIMIR = 'imprimir', 'Imprimir en el móvil'
        GENERAR_AL_VOLVER = 'generar_al_volver', 'Guardar y generar al volver la red'
        NECESITA_RED = 'necesita_red', 'Necesita red'

    modo_sin_cobertura = models.CharField(
        max_length=20, choices=ModoSinCobertura.choices, default=ModoSinCobertura.IMPRIMIR,
    )
    ejemplares_sin_cobertura = models.PositiveSmallIntegerField(
        default=2, validators=[MinValueValidator(1), MaxValueValidator(3)],
        help_text='Ejemplares que se imprimen sin cobertura: 1 transportista, 2 + cargador, 3 + destinatario.',
    )
    # Talonario de papel: un DeCA rellenado a bolígrafo se registra después
    # con su foto, para que conste en el registro de un año (art. 9).
    registrar_papel_por_foto = models.BooleanField(default=False)
    # DeCA preparado antes de que llegue el camión con el peso previsto.
    # Apagado por defecto (decisión del usuario 2026-09-30): el art. 6.d pide
    # el peso de lo que se transporta, así que el estimado tiene que
    # corregirse ANTES de la salida. Necesita la ventana de corrección > 0.
    deca_anticipado = models.BooleanField(default=False)
    # Aviso al responsable del módulo de los DeCA hechos sin cobertura que
    # llegan al servidor sin poder generarse (les falta algo).
    aviso_sin_completar = models.BooleanField(default=True)
    aviso_sin_completar_dias = models.PositiveSmallIntegerField(
        default=2, validators=[MinValueValidator(1), MaxValueValidator(30)],
    )

    # Al leer un documento, la Agenda manda sobre lo leído (2026-10-01): si el
    # nombre o el NIF leídos están en la Agenda, se usan los datos de la ficha
    # y se avisa de cualquier diferencia con el papel. Ver
    # catalogo_service.aplicar_prioridad_agenda. Apagado = la Agenda solo
    # rellena el NIF cuando la lectura no lo encontró (comportamiento anterior).
    agenda_prioritaria = models.BooleanField(default=True)

    # Cabecera de documento controlado -- mismos 6 campos con el mismo
    # nombre que en el ERP origen (deca/pdf_utils.py::construir_cabecera_documento_controlado
    # los busca por nombre, es agnóstica de dominio).
    informe_mostrar_cabecera = models.BooleanField(default=False)
    informe_codigo_documento = models.CharField(max_length=50, blank=True)
    informe_version = models.CharField(max_length=20, blank=True)
    informe_edicion = models.CharField(max_length=20, blank=True)
    informe_preparado_por = models.CharField(max_length=100, blank=True)
    informe_autorizado_por = models.CharField(max_length=100, blank=True)

    # Plantilla del email de envío manual del DeCA: el texto fijo de `email_service` debe poder
    # adaptarse por empresa (firma, tono propio), y el "concepto" (asunto)
    # por defecto debe ser el número de albarán/expedición, no un texto
    # genérico "DeCA X -- Empresa". Placeholders disponibles: {numero_albaran}
    # {origen} {destino} {matricula_tractor} {empresa} -- uno desconocido o
    # mal escrito se deja tal cual en vez de reventar el envío (ver
    # email_service._renderizar_plantilla).
    plantilla_asunto_email = models.CharField(
        max_length=200, blank=True,
        help_text='Asunto por defecto del email de envío del DeCA. Vacío = se usa el número de '
                   'albarán/expedición. Placeholders: {numero_albaran} {origen} {destino} '
                   '{matricula_tractor} {empresa}.',
    )
    plantilla_cuerpo_email = models.TextField(
        blank=True,
        help_text='Mensaje por defecto del email de envío del DeCA. Vacío = se usa el mensaje '
                   'estándar. Mismos placeholders que el asunto.',
    )

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
        # DeCA del talonario de papel, registrado después con su foto: el
        # papel es el documento que viajó, así que no se genera PDF ni QR.
        PAPEL = 'papel', 'DeCA en papel'

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
    numero_interno = models.CharField(
        max_length=40, blank=True, editable=False,
        help_text='Número autonumerado por la aplicación (prefijo + contador de '
                   'ConfiguracionDeca), asignado UNA VEZ al Generar cuando la empresa tiene '
                   'identificador_preferido="automatico" y no llega con ningún número externo '
                   'propio. Nunca se reasigna ni se recalcula en una corrección posterior.',
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
    # Orden FOM/2861/2012 art. 6.a: "Nombre o denominación social, NIF y
    # domicilio del cargador contractual". Faltaba (revisado con el BOE,
    # 2026-09-30).
    domicilio_cargador = models.CharField(max_length=255, blank=True)
    nif_transportista = models.CharField(max_length=20, blank=True)
    nombre_transportista = models.CharField(max_length=255, blank=True)
    nif_destinatario = models.CharField(max_length=20, blank=True)
    nombre_destinatario = models.CharField(max_length=255, blank=True)

    matricula_tractor = models.CharField(max_length=15, blank=True)
    matricula_remolque = models.CharField(max_length=15, blank=True)
    # Art. 6.g: en un conjunto articulado, matrícula de tractora Y de
    # remolque/semirremolque. Por eso el remolque es obligatorio salvo que se
    # marque explícitamente que es un camión rígido sin remolque.
    sin_remolque = models.BooleanField(default=False)
    # Art. 6.e: solo cuando el vehículo circula con una autorización especial
    # de circulación (transportes especiales, góndolas...).
    autorizacion_especial = models.CharField(max_length=100, blank=True)
    # DeCA hecho SIN COBERTURA en el móvil e impreso allí mismo (2026-09-30):
    # la referencia la pone el móvil (única por empresa, sirve para que al
    # volver la cobertura se registre UNA sola vez aunque el envío se repita)
    # y la fecha es cuándo se imprimió el documento que viajó en el camión.
    referencia_offline = models.CharField(max_length=40, blank=True, db_index=True)
    emitido_sin_conexion_en = models.DateTimeField(null=True, blank=True)
    # Cuándo se avisó al responsable de que este DeCA sin cobertura llegó sin
    # poder generarse (una sola vez, ver avisar_deca_sin_completar).
    aviso_sin_completar_en = models.DateTimeField(null=True, blank=True, editable=False)
    # DeCA anticipado: el peso es el previsto y hay que corregirlo con el real
    # antes de que salga el camión (solo si la empresa tiene deca_anticipado).
    peso_estimado = models.BooleanField(default=False)

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

    # 255: la ruta lleva tres UUID y roza el límite de 100 por defecto (ver
    # _ruta_documento_origen, que sí llegó a romperse).
    pdf_generado = models.FileField(upload_to=_ruta_pdf_deca, blank=True, null=True, max_length=255)
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
        constraints = [
            # Un DeCA hecho sin cobertura se registra una sola vez aunque el
            # móvil reintente el envío (red intermitente al volver al almacén).
            models.UniqueConstraint(
                fields=['referencia_offline'],
                condition=~models.Q(referencia_offline=''),
                name='deca_referencia_offline_unica',
            ),
        ]

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
    archivo = models.FileField(upload_to=_ruta_documento_origen, max_length=255)
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


class ModificacionDeca(BaseModel):
    """Corrección de un DeCA YA GENERADO (Resolución de 5-jun-2026,
    BOE-A-2026-12784, apartado quinto): se añaden al PDF existente los datos
    nuevos y el MOTIVO del cambio, conservando los antiguos "indicando
    claramente que ya no son válidos" -- mismo PDF, misma URL, mismo QR.
    Cada fila es una corrección; `cambios` = [{campo, antes, despues}]."""

    expedicion = models.ForeignKey(
        ExpedicionDeca, on_delete=models.CASCADE, related_name='modificaciones',
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='modificaciones_deca',
    )
    motivo = models.TextField()
    cambios = models.JSONField(default=list)

    class Meta:
        db_table = 'deca_modificaciones'
        verbose_name = 'Modificación de DeCA generado'
        verbose_name_plural = 'Modificaciones de DeCA generados'
        ordering = ['fecha_alta']

    def __str__(self) -> str:
        return f'Modificación de {self.expedicion_id} ({self.fecha_alta:%d/%m/%Y %H:%M})'


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
        REGISTRADA_PAPEL = 'registrada_papel', 'Registrada como DeCA en papel'

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


class CargadorDeca(BaseModel):
    """Catálogo reutilizable de cargadores (quien CONTRATA el transporte,
    Orden FOM/2861/2012 art. 4) -- separado a propósito de DestinatarioDeca
    pese a compartir la misma forma (NIF/nombre): son roles distintos de la
    norma y, para una empresa de transporte que gestiona DeCAs de varios
    agricultores/clientes, casi nunca coinciden con quien recibe la
    mercancía (ver docstring de DestinatarioDeca). Sin catálogo propio, un
    transportista que gestiona varios cargadores tendría que teclear el
    NIF/CIF a mano cada vez."""

    nif = models.CharField(max_length=20, unique=True)
    nombre = models.CharField(max_length=255)
    # Obligatorio en el DeCA (art. 6.a): al elegir el cargador de la agenda,
    # el domicilio se rellena solo.
    domicilio = models.CharField(max_length=255, blank=True)
    telefono = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'deca_cargadores'
        verbose_name = 'Cargador DeCA'
        verbose_name_plural = 'Cargadores DeCA'
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


class PlantillaDocumentoDeca(BaseModel):
    """Modelo de documento que una empresa recibe o emite siempre igual
    ("albarán del cliente X", "ticket de báscula de la cooperativa Y"...).

    Sirve para leer mejor los documentos de origen: se reconoce solo al
    subir un documento (por `texto_identificativo`, o por la IA en fotos y
    escaneos) y entonces (a) se le pasan a la IA las `instrucciones` propias
    de ese modelo y (b) se rellenan los `valores_fijos` que ese modelo
    siempre trae igual. Todo sigue siendo SUGERENCIA que el usuario revisa.

    Es de la empresa que lo da de alta, nunca compartido: los ejemplos llevan
    datos reales de sus clientes. No se guarda el fichero de ejemplo, solo lo
    aprendido de él.
    """

    nombre = models.CharField(max_length=120)
    tipo_documento = models.CharField(
        max_length=20, choices=DocumentoOrigenDeca.TipoDocumento.choices,
        default=DocumentoOrigenDeca.TipoDocumento.OTRO,
    )
    # Palabras separadas por comas que aparecen SIEMPRE en ese modelo (CIF
    # del emisor, título...). Solo reconoce documentos con texto; fotos y
    # escaneos los reconoce la IA a partir de la descripción del modelo.
    texto_identificativo = models.CharField(max_length=255, blank=True)
    instrucciones = models.TextField(blank=True)
    valores_fijos = models.JSONField(default=dict, blank=True)
    activo = models.BooleanField(default=True)
    veces_aplicada = models.PositiveIntegerField(default=0)
    ultima_vez_aplicada = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'deca_plantillas_documento'
        verbose_name = 'Modelo de documento DeCA'
        verbose_name_plural = 'Modelos de documento DeCA'
        ordering = ['nombre']

    def __str__(self) -> str:
        return self.nombre


class LecturaCampoDeca(BaseModel):
    """Qué leyó la extracción automática de cada campo de un documento y qué
    acabó confirmando la persona -- la base para que la lectura "aprenda"
    (fase 1, 2026-09-28, ver services/aprendizaje_service.py).

    Es un registro de la IA, no un dato de negocio: la extracción solo
    escribe aquí, nunca en la expedición (la IA sugiere, nunca decide). El valor
    bueno lo pone siempre una persona al guardar; se copia en `valor_final`
    al generar el DeCA.
    """

    class Fuente(models.TextChoices):
        IA = 'ia', 'Lectura de la IA'
        MODELO = 'modelo', 'Valor fijo del modelo de documento'
        AGENDA = 'agenda', 'Completado desde la Agenda'
        SINONIMO = 'sinonimo', 'Sinónimo aprendido'
        CORRECCION = 'correccion', 'Corrección de letras confundidas'

    expedicion = models.ForeignKey(ExpedicionDeca, on_delete=models.CASCADE, related_name='lecturas')
    documento = models.ForeignKey(
        DocumentoOrigenDeca, on_delete=models.SET_NULL, null=True, blank=True, related_name='lecturas',
    )
    plantilla = models.ForeignKey(
        PlantillaDocumentoDeca, on_delete=models.SET_NULL, null=True, blank=True, related_name='lecturas',
    )
    campo = models.CharField(max_length=50)
    # Tal cual lo devolvió la IA, antes de pasar por la Agenda o los sinónimos:
    # es lo que hace falta para aprender cómo "se escribe" algo en el papel.
    valor_leido = models.TextField(blank=True)
    # Lo que se propuso finalmente en pantalla (tras Agenda, sinónimos...).
    valor_propuesto = models.TextField(blank=True)
    fuente = models.CharField(max_length=20, choices=Fuente.choices, default=Fuente.IA)
    dudoso = models.BooleanField(default=False, help_text='La IA lo marcó como manuscrito o poco legible.')
    valor_final = models.TextField(blank=True)
    corregido = models.BooleanField(null=True, blank=True, help_text='Vacío mientras el DeCA no se genera.')
    fecha_resolucion = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'deca_lecturas_campo'
        verbose_name = 'Lectura de campo DeCA'
        verbose_name_plural = 'Lecturas de campo DeCA'
        ordering = ['-fecha_alta']
        indexes = [models.Index(fields=['campo', 'corregido'])]

    def __str__(self) -> str:
        return f'{self.campo}: {self.valor_leido} -> {self.valor_final or "?"}'


class AliasAgendaDeca(BaseModel):
    """Tabla de sinónimos: cómo aparece escrita en los documentos una ficha
    de la Agenda ("TTES GARCIA" = Transportes García S.L.).

    Se aprende sola al generar un DeCA en el que la persona corrigió lo que
    leyó la IA (services/aprendizaje_service.py) y también se puede borrar a
    mano desde la Agenda. Solo SUGIERE: con una confirmación el dato se
    propone para revisar; a partir de `MINIMO_CONFIRMACIONES` se rellena
    directamente. Nunca se comparte entre empresas.
    """

    MINIMO_CONFIRMACIONES = 2

    class Rol(models.TextChoices):
        CARGADOR = 'cargador', 'Cargador'
        TRANSPORTISTA = 'transportista', 'Transportista'
        DESTINATARIO = 'destinatario', 'Destinatario'
        CONDUCTOR = 'conductor', 'Conductor'
        TRACTORA = 'tractora', 'Tractora'
        REMOLQUE = 'remolque', 'Remolque'

    rol = models.CharField(max_length=20, choices=Rol.choices)
    # Forma normalizada (mayúsculas, sin puntos ni forma societaria) de lo
    # que se leyó -- es la clave de búsqueda.
    texto = models.CharField(max_length=255)
    # Cómo se leyó la primera vez, para enseñarlo en la Agenda.
    texto_original = models.CharField(max_length=255, blank=True)
    # A qué ficha corresponde: nombre + NIF (empresas y conductores) o la
    # matrícula (vehículos, en `nombre`).
    nombre = models.CharField(max_length=255)
    nif = models.CharField(max_length=20, blank=True)
    veces_confirmado = models.PositiveIntegerField(default=1)
    ultima_confirmacion = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'deca_alias_agenda'
        verbose_name = 'Sinónimo de la Agenda DeCA'
        verbose_name_plural = 'Sinónimos de la Agenda DeCA'
        ordering = ['rol', 'texto']
        constraints = [
            models.UniqueConstraint(fields=['rol', 'texto'], name='deca_alias_unico_por_rol'),
        ]

    def __str__(self) -> str:
        return f'{self.texto_original or self.texto} = {self.nombre}'

    @property
    def fiable(self) -> bool:
        return self.veces_confirmado >= self.MINIMO_CONFIRMACIONES