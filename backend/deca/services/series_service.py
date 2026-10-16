"""Series de numeración del DeCA (pedido del usuario 2026-10-15).

La instalación tiene una o varias series (General, Algodón, Tomates...), cada
una con su prefijo y su contador. TODO DeCA que se genera recibe el siguiente
número de su serie (o de la serie por defecto si no eligió ninguna), tenga o
no albarán: así la numeración por actividad es completa y sin huecos. Qué
número se ENSEÑA de cara al cliente lo sigue decidiendo
`ConfiguracionDeca.identificador_preferido` (ver identificador_service).

El número se asigna una sola vez, al Generar (un borrador que se borra no
gasta número), y nunca se reasigna en una corrección posterior.
"""
from django.db import transaction

from ..models import ConfiguracionDeca, ExpedicionDeca, SerieNumeracionDeca

NOMBRE_SERIE_INICIAL = 'General'


def formatear(serie: SerieNumeracionDeca, numero: int) -> str:
    """prefijo + número con ceros a la izquierda (p. ej. "DECA-00042")."""
    return f'{serie.prefijo}{numero:0{serie.digitos}d}'


def serie_por_defecto() -> SerieNumeracionDeca:
    """La serie marcada por defecto. Si no hay ninguna (instalación nueva),
    crea la serie «General» con el prefijo y el contador que tuviera
    la configuración: así nadie empieza sin serie."""
    serie = SerieNumeracionDeca.objects.filter(activa=True, por_defecto=True).first()
    if serie:
        return serie
    config = ConfiguracionDeca.objects.first()
    serie, _creada = SerieNumeracionDeca.objects.get_or_create(
        nombre=NOMBRE_SERIE_INICIAL,
        defaults={
            'prefijo': config.prefijo_numero_automatico if config else 'DECA-',
            'ultimo_numero': config.ultimo_numero_automatico if config else 0,
            'por_defecto': True,
        },
    )
    if not serie.activa or not serie.por_defecto:
        serie.activa = serie.por_defecto = True
        serie.save(update_fields=['activa', 'por_defecto', 'fecha_actualizacion'])
    return serie


def asignar_numero(expedicion: ExpedicionDeca) -> ExpedicionDeca:
    """Da a `expedicion` el siguiente número de su serie (o de la serie por
    defecto, que queda guardada en la expedición). Llamar UNA VEZ, al Generar.
    Si ya tiene número, no hace nada.

    select_for_update bloquea la fila de la serie hasta que acaba la
    transacción: si dos usuarios generan a la vez en la misma serie, el
    segundo espera y lee el contador ya incrementado (nunca dos DeCA con el
    mismo número). La expedición también se relee bloqueada por si otra
    petición ya le asignó número mientras tanto."""
    if expedicion.numero_interno:
        return expedicion
    serie_id = expedicion.serie_id or serie_por_defecto().id
    with transaction.atomic():
        actual = ExpedicionDeca.objects.select_for_update().only('numero_interno').get(pk=expedicion.pk)
        if actual.numero_interno:
            expedicion.numero_interno = actual.numero_interno
            return expedicion
        serie = SerieNumeracionDeca.objects.select_for_update().get(pk=serie_id)
        serie.ultimo_numero += 1
        serie.save(update_fields=['ultimo_numero', 'fecha_actualizacion'])
        expedicion.serie = serie
        expedicion.numero_interno = formatear(serie, serie.ultimo_numero)
        expedicion.save(update_fields=['serie', 'numero_interno', 'fecha_actualizacion'])
    return expedicion
