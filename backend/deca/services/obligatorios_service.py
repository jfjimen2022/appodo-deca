"""Campos obligatorios para Confirmar/Generar un DeCA -- único punto de verdad.

Los usan Confirmar y Generar (views.py) y la pantalla, que los lee de la
configuración (`ConfiguracionDecaSerializer.campos_obligatorios`) para marcar
los campos: así pantalla y servidor no pueden divergir.

Base legal: Orden FOM/2861/2012, art. 6 (texto vigente tras el RD 70/2019,
revisado contra el BOE el 2026-09-30):
- a) nombre, NIF **y domicilio** del cargador contractual;
- b) nombre y NIF del transportista efectivo;
- c) origen y destino;
- d) naturaleza **y peso** de la mercancía;
- f) fecha;
- g) matrícula; en un conjunto articulado, **tractora y remolque** (el
  remolque se exige salvo que se marque `sin_remolque`: camión rígido).

Además, por decisión del usuario (2026-09-30), los **bultos** también son
obligatorios aunque la norma no los pide. **Nada del destinatario**: sus
datos solo cuentan si la empresa lo activa
(`ConfiguracionDeca.exigir_datos_destinatario`, desactivado por defecto).
"""
from __future__ import annotations

CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR = [
    'nif_cargador', 'nombre_cargador', 'domicilio_cargador',
    'nif_transportista', 'nombre_transportista',
    'nif_destinatario', 'nombre_destinatario',
    'matricula_tractor', 'matricula_remolque', 'origen', 'destino',
    'fecha_hora_transporte', 'naturaleza_mercancia', 'peso_kg', 'bultos',
]

CAMPOS_DESTINATARIO = ('nif_destinatario', 'nombre_destinatario')


def para_configuracion(config) -> list[str]:
    """Lista efectiva de obligatorios con una configuración ya cargada."""
    exigir = bool(config and config.exigir_datos_destinatario)
    return [c for c in CAMPOS_OBLIGATORIOS_PARA_CONFIRMAR if exigir or c not in CAMPOS_DESTINATARIO]


def para_empresa(empresa) -> list[str]:
    """Lista efectiva de obligatorios leyendo la configuración de la
    instalación. El parámetro `empresa` se conserva por compatibilidad con
    el ERP origen y se ignora (single-tenant)."""
    from deca.models import ConfiguracionDeca

    config = ConfiguracionDeca.objects.filter(pk=1).only('exigir_datos_destinatario').first()
    return para_configuracion(config)


def faltantes(expedicion) -> list[str]:
    """Obligatorios vacíos de una expedición concreta. La matrícula del
    remolque no se exige si se marcó que es un camión sin remolque. Un peso o
    unos bultos a 0 cuentan como vacíos: un envío de 0 kg no existe."""
    return [
        campo for campo in para_empresa(None)
        if not (campo == 'matricula_remolque' and expedicion.sin_remolque)
        and not getattr(expedicion, campo)
    ]
