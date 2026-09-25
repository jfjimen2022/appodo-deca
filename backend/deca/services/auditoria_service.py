"""Registro de eventos de auditoría de una expedición DeCA -- único punto
de escritura de `EventoExpedicionDeca` (nunca se crea a mano fuera de aquí,
para que el snapshot de `hash_documento` sea siempre consistente)."""
from __future__ import annotations

from deca.models import EventoExpedicionDeca, ExpedicionDeca


def registrar_evento(
    expedicion: ExpedicionDeca,
    tipo_evento: str,
    usuario=None,
    detalle: str = '',
    ip_origen: str | None = None,
) -> EventoExpedicionDeca:
    """Crea un evento de auditoría para `expedicion`.

    Args:
        expedicion: la expedición a la que pertenece el evento.
        tipo_evento: uno de `EventoExpedicionDeca.TipoEvento`.
        usuario: quién lo provocó, o None si no hay usuario autenticado
            (ej. una descarga pública por QR).
        detalle: nota libre (ej. tipo de documento subido, motivo de anulación).
        ip_origen: IP de origen, solo relevante en eventos públicos sin login.

    Returns:
        El evento creado.
    """
    return EventoExpedicionDeca.objects.create(
        expedicion=expedicion,
        tipo_evento=tipo_evento,
        usuario=usuario,
        detalle=detalle,
        hash_documento=expedicion.hash_sha256,
        ip_origen=ip_origen,
    )
