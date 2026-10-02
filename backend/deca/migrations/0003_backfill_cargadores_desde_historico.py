"""Rellena el catálogo CargadorDeca (nuevo en esta versión) con los cargadores
que ya existían en expediciones anteriores -- sin esto, una instalación que
actualiza desde v01 se encuentra el catálogo de Cargadores vacío pese a tener
cargadores reales guardados en el histórico.

Mismo criterio que `catalogo_service.guardar_cargador_de` en tiempo real:
solo cargadores con nombre Y NIF, uno por NIF -- si hay varios nombres para
el mismo NIF, se queda con el de la expedición más reciente."""
from django.db import migrations


def backfill_cargadores(apps, schema_editor):
    ExpedicionDeca = apps.get_model('deca', 'ExpedicionDeca')
    CargadorDeca = apps.get_model('deca', 'CargadorDeca')

    vistos = set()
    qs = (
        ExpedicionDeca.objects
        .exclude(nombre_cargador='').exclude(nif_cargador='')
        .order_by('-fecha_alta')
        .values('nif_cargador', 'nombre_cargador')
    )
    for fila in qs:
        if fila['nif_cargador'] in vistos:
            continue
        vistos.add(fila['nif_cargador'])
        CargadorDeca.objects.get_or_create(
            nif=fila['nif_cargador'], defaults={'nombre': fila['nombre_cargador']},
        )


def sin_reversa(apps, schema_editor):
    """Migración de datos: al revertir no se borra nada (no se distingue un
    cargador creado aquí de uno creado después)."""


class Migration(migrations.Migration):

    dependencies = [
        ('deca', '0002_sync_appodo_v4_37'),
    ]

    operations = [
        migrations.RunPython(backfill_cargadores, sin_reversa),
    ]
