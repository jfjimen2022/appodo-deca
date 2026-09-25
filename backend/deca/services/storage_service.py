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
