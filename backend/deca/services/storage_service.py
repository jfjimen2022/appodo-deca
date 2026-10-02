"""Persistencia del PDF DeCA generado, hash de integridad y ventana de
acceso público (ver ConfiguracionDeca.dias_visibilidad_publica).

Sin parámetro `empresa` (a diferencia del ERP multiempresa origen): hay una
única `ConfiguracionDeca` (singleton, ver `ConfiguracionDeca.get_solo()`)."""
from __future__ import annotations

import hashlib
from datetime import timedelta

from django.core.files.base import ContentFile
from django.utils import timezone

from deca.models import (
    DIAS_RETENCION_IP_EVENTOS_DEFECTO,
    DIAS_VISIBILIDAD_PUBLICA_DEFECTO,
    HORAS_MAX_EDICION_GENERADO_DEFECTO,
    ConfiguracionDeca,
    ExpedicionDeca,
)


def dias_visibilidad_publica_de() -> int:
    """Días de visibilidad pública configurados.

    Sin fila de configuración todavía (instalación recién desplegada que
    nunca entró a Configuración de DeCA), cae al valor por defecto -- el
    `default=` del campo del modelo solo se aplica al CREAR la fila, no
    sustituye una fila inexistente.
    """
    config = ConfiguracionDeca.objects.first()
    if config is not None:
        return config.dias_visibilidad_publica
    return DIAS_VISIBILIDAD_PUBLICA_DEFECTO


def guardar_pdf_generado(expedicion: ExpedicionDeca, contenido_pdf: bytes) -> ExpedicionDeca:
    """Guarda el PDF final de `expedicion`, calcula su hash SHA-256 y fija
    la fecha en la que el acceso público sin login deja de estar permitido.

    Args:
        expedicion: expedición ya confirmada para la que se generó el DeCA.
        contenido_pdf: bytes del PDF nativo con el QR ya estampado.

    Returns:
        La misma expedición, actualizada y guardada en BD.
    """
    ahora = timezone.now()
    dias = dias_visibilidad_publica_de()

    expedicion.pdf_generado.save(
        f'DECA_{expedicion.id}.pdf', ContentFile(contenido_pdf), save=False,
    )
    expedicion.hash_sha256 = hashlib.sha256(contenido_pdf).hexdigest()
    expedicion.fecha_generacion = ahora
    expedicion.fecha_expiracion_publica = ahora + timedelta(days=dias)
    expedicion.estado = ExpedicionDeca.Estado.GENERADO
    expedicion.save(update_fields=[
        'pdf_generado', 'hash_sha256', 'fecha_generacion',
        'fecha_expiracion_publica', 'estado', 'fecha_actualizacion',
    ])
    return expedicion


def regenerar_pdf_tras_correccion(expedicion: ExpedicionDeca, contenido_pdf: bytes) -> ExpedicionDeca:
    """Reemplaza el PDF de una expedición YA GENERADA tras corregir un dato
    dentro del plazo de gracia (`ConfiguracionDeca.horas_max_edicion_generado`,
    ver `puede_editar_generado`). A diferencia de `guardar_pdf_generado`,
    NO toca `fecha_generacion` -- el plazo de corrección se cuenta siempre
    desde la primera generación, nunca se alarga al corregir -- ni
    `fecha_expiracion_publica`, que ya quedó fijada la primera vez. El mismo
    QR/token público sigue sirviendo, ahora con el contenido correcto."""
    expedicion.pdf_generado.save(
        f'DECA_{expedicion.id}.pdf', ContentFile(contenido_pdf), save=False,
    )
    expedicion.hash_sha256 = hashlib.sha256(contenido_pdf).hexdigest()
    expedicion.save(update_fields=['pdf_generado', 'hash_sha256', 'fecha_actualizacion'])
    return expedicion


def horas_max_edicion_generado_de(empresa) -> int:
    """Igual que `dias_visibilidad_publica_de` -- sin fila de configuración
    todavía, cae al valor por defecto."""
    config = ConfiguracionDeca.objects.filter(pk=1).first()
    if config is not None:
        return config.horas_max_edicion_generado
    return HORAS_MAX_EDICION_GENERADO_DEFECTO


def fecha_limite_edicion(expedicion: ExpedicionDeca):
    """Instante hasta el que se puede corregir `expedicion` una vez generada,
    o None si nunca se generó. Ver `puede_editar_generado`."""
    if not expedicion.fecha_generacion:
        return None
    horas = horas_max_edicion_generado_de(None)
    return expedicion.fecha_generacion + timedelta(hours=horas)


def puede_editar_generado(expedicion: ExpedicionDeca) -> bool:
    """True si una expedición GENERADA todavía está dentro del plazo de
    gracia para corregir un dato sin anular. Fuera de ese plazo (u
    horas_max_edicion_generado=0), queda inmutable como siempre."""
    if expedicion.estado != ExpedicionDeca.Estado.GENERADO:
        return False
    limite = fecha_limite_edicion(expedicion)
    if limite is None:
        return False
    # Standalone: una sola zona horaria (settings.TIME_ZONE), en vez de la
    # de cada empresa del ERP origen (core.tiempo_empresa.ahora_para).
    return timezone.now() <= limite


def acceso_publico_vigente(expedicion: ExpedicionDeca) -> bool:
    """True si el token público de `expedicion` todavía debe servir el PDF
    sin autenticación (dentro de la ventana legal/configurada)."""
    if not expedicion.fecha_expiracion_publica:
        return False
    return timezone.now() <= expedicion.fecha_expiracion_publica


def dias_retencion_ip_eventos_de() -> int:
    """Días configurados para conservar la IP de los eventos de auditoría
    antes de anonimizarla (ver purgar_ips_eventos_deca). Mismo fallback que
    `dias_visibilidad_publica_de` si no hay fila todavía."""
    config = ConfiguracionDeca.objects.first()
    if config is not None:
        return config.dias_retencion_ip_eventos
    return DIAS_RETENCION_IP_EVENTOS_DEFECTO
