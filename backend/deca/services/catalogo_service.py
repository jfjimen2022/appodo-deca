"""Alimenta los catálogos reutilizables (ConductorDeca, EmpresaTransportistaDeca,
TractoraDeca, RemolqueDeca...) a partir de los datos sueltos de una expedición
-- para que la próxima vez no haga falta volver a teclearlos. Nunca falla la
expedición si esto falla: es un efecto secundario de conveniencia, no una
escritura crítica.

Sin filtro por empresa (a diferencia del ERP origen): en esta instalación
solo hay una empresa, así que el NIF/matrícula es único a nivel de instancia
entera (ver `unique=True` en los modelos)."""
from __future__ import annotations

from deca.models import (
    ConductorDeca, DestinatarioDeca, EmpresaTransportistaDeca, ExpedicionDeca, RemolqueDeca,
    TractoraDeca,
)


def guardar_conductor_de(expedicion: ExpedicionDeca) -> ConductorDeca | None:
    """Crea o actualiza la ficha del conductor de `expedicion` en el catálogo,
    si hay nombre y NIF informados. Sin NIF no hay forma fiable de identificar
    al mismo conductor la próxima vez, así que no se guarda nada."""
    if not (expedicion.nombre_conductor and expedicion.nif_conductor):
        return None

    conductor, _creado = ConductorDeca.objects.update_or_create(
        nif=expedicion.nif_conductor,
        defaults={
            'nombre': expedicion.nombre_conductor,
            'telefono': expedicion.telefono_conductor,
            'email': expedicion.email_conductor,
        },
    )
    return conductor


def guardar_transportista_de(expedicion: ExpedicionDeca) -> EmpresaTransportistaDeca | None:
    """Crea o actualiza la ficha de la empresa transportista de `expedicion`
    en el catálogo. El teléfono/email no están en ExpedicionDeca (solo NIF/
    nombre son mínimo legal) -- se conservan los que ya hubiera en el
    catálogo si la ficha ya existía, en vez de borrarlos."""
    if not (expedicion.nombre_transportista and expedicion.nif_transportista):
        return None

    transportista, creado = EmpresaTransportistaDeca.objects.get_or_create(
        nif=expedicion.nif_transportista,
        defaults={'nombre': expedicion.nombre_transportista},
    )
    if not creado and transportista.nombre != expedicion.nombre_transportista:
        transportista.nombre = expedicion.nombre_transportista
        transportista.save(update_fields=['nombre', 'fecha_actualizacion'])
    return transportista


def guardar_destinatario_de(expedicion: ExpedicionDeca) -> DestinatarioDeca | None:
    """Crea o actualiza la ficha del destinatario de `expedicion` en el
    catálogo. Mismo criterio que el transportista: sin NIF no hay forma
    fiable de reconocer al mismo destinatario la próxima vez."""
    if not (expedicion.nombre_destinatario and expedicion.nif_destinatario):
        return None

    destinatario, creado = DestinatarioDeca.objects.get_or_create(
        nif=expedicion.nif_destinatario,
        defaults={'nombre': expedicion.nombre_destinatario},
    )
    if not creado and destinatario.nombre != expedicion.nombre_destinatario:
        destinatario.nombre = expedicion.nombre_destinatario
        destinatario.save(update_fields=['nombre', 'fecha_actualizacion'])
    return destinatario


def guardar_tractora_de(expedicion: ExpedicionDeca) -> TractoraDeca | None:
    """Crea la ficha de la tractora de `expedicion` en el catálogo si hay
    matrícula informada y todavía no existía -- catálogo independiente del
    remolque (ver docstring de `TractoraDeca`), así que aquí no se toca nada
    más que la propia tractora."""
    if not expedicion.matricula_tractor:
        return None
    tractora, _creada = TractoraDeca.objects.get_or_create(matricula=expedicion.matricula_tractor)
    return tractora


def guardar_remolque_de(expedicion: ExpedicionDeca) -> RemolqueDeca | None:
    """Igual que `guardar_tractora_de` pero para el remolque -- catálogo
    independiente, no se combinan en una sola ficha."""
    if not expedicion.matricula_remolque:
        return None
    remolque, _creado = RemolqueDeca.objects.get_or_create(matricula=expedicion.matricula_remolque)
    return remolque
