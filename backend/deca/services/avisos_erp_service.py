"""Avisos "Modificado en el ERP" que caducan con el plazo de corrección.

Decisión del usuario (2026-10-14): el aviso solo tiene sentido mientras el
DeCA se puede corregir. Pasado el plazo (o si deja de estar generado:
anulado) ya no va a cambiar, así que un aviso sin contestar se cierra solo y
queda en el historial. Se llama al abrir el listado o la ficha (para que nunca
se vea uno caducado) y desde el comando programado `caducar_avisos_erp`."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from deca.models import EventoExpedicionDeca, ExpedicionDeca

from . import auditoria_service
from .storage_service import horas_max_edicion_generado_de


def caducar_avisos_erp() -> int:
    """Cierra los avisos sin contestar cuyo DeCA ya no se puede corregir.
    Devuelve cuántos ha cerrado. Si no hay ninguno abierto, es una sola
    consulta barata (el caso normal)."""
    corte = timezone.now() - timedelta(hours=horas_max_edicion_generado_de(None))
    caducados = (
        ExpedicionDeca.objects.exclude(cambios_erp=[])
        .exclude(estado=ExpedicionDeca.Estado.GENERADO, fecha_generacion__gt=corte)
    )
    cerrados = 0
    for expedicion in caducados:
        expedicion.cambios_erp, expedicion.cambios_erp_en = [], None
        expedicion.save(update_fields=['cambios_erp', 'cambios_erp_en', 'fecha_actualizacion'])
        auditoria_service.registrar_evento(
            expedicion, EventoExpedicionDeca.TipoEvento.CAMBIO_ERP,
            detalle='Aviso del ERP cerrado sin respuesta: venció el plazo de corrección y el DeCA ya no puede cambiar.',
        )
        cerrados += 1
    return cerrados
