"""Modelos de documento por empresa (`PlantillaDocumentoDeca`): reconocer a
qué modelo pertenece un documento subido, preparar las pistas para la IA y
rellenar los valores que ese modelo trae siempre igual.

Analizado con cuatro documentos reales de un cliente
(2026-09-27): solo uno de cuatro tenía texto legible (el albarán en PDF de
Frutas del Sur); el CMR venía escaneado y los otros dos eran fotos. Por eso
la plantilla no es "el dato está en tal posición", sino sobre todo
instrucciones para la IA, que es la que lee escaneos y fotos:

- Documento CON texto: se reconoce aquí mismo por `texto_identificativo`
  y a la IA solo le llegan las instrucciones de ese modelo.
- Documento SIN texto (foto, escaneo): no hay nada que comparar antes de
  llamar a la IA, así que se le pasa el catálogo de modelos de la empresa y
  ella dice cuál es (`modelo_reconocido`, un número de la lista). El número
  se valida contra la lista -- nunca se usa un id que venga de la IA.

Todo es sugerencia: el usuario revisa el formulario antes de confirmar
(CLAUDE.md, capa de IA aislada)."""
from __future__ import annotations

import unicodedata

from django.utils import timezone

# Datos que un modelo de documento puede traer SIEMPRE iguales: quién lo
# emite, a quién va, de dónde sale... Nunca lo que cambia en cada envío
# (peso, fecha, matrícula, conductor, número de albarán).
CAMPOS_FIJABLES = (
    'nif_cargador', 'nombre_cargador', 'domicilio_cargador',
    'nif_transportista', 'nombre_transportista',
    'nif_destinatario', 'nombre_destinatario',
    'origen', 'destino', 'naturaleza_mercancia',
)

# Tope de modelos que se describen a la IA en una sola llamada -- una
# empresa real tendrá unos pocos; acota el tamaño del prompt.
MAXIMO_MODELOS_EN_PROMPT = 25


def _normalizar(texto: str) -> str:
    texto = unicodedata.normalize('NFKD', texto or '')
    return ' '.join(texto.encode('ascii', 'ignore').decode('ascii').upper().split())


def palabras_identificativas(plantilla) -> list[str]:
    return [p for p in (_normalizar(x) for x in (plantilla.texto_identificativo or '').split(',')) if p]


def plantillas_activas(empresa) -> list:
    from deca.models import PlantillaDocumentoDeca

    return list(
        PlantillaDocumentoDeca.objects.filter(activo=True)
        .order_by('nombre')[:MAXIMO_MODELOS_EN_PROMPT]
    )


def detectar_por_texto(plantillas: list, texto: str):
    """La plantilla cuyas palabras identificativas aparecen TODAS en el
    texto; con varias candidatas, la más específica (más palabras). None si
    ninguna encaja -- un modelo sin palabras nunca se reconoce por texto."""
    if not texto:
        return None
    # Sin espacios: pypdf a veces pega palabras ("117.347,00Suma:") y otras
    # las separa; comparar sin espacios aguanta ambos casos.
    texto_normalizado = _normalizar(texto).replace(' ', '')
    mejor, mejor_puntos = None, 0
    for plantilla in plantillas:
        palabras = palabras_identificativas(plantilla)
        if palabras and all(p.replace(' ', '') in texto_normalizado for p in palabras):
            if len(palabras) > mejor_puntos:
                mejor, mejor_puntos = plantilla, len(palabras)
    return mejor


def _describir(plantilla) -> str:
    lineas = [f'Nombre del modelo: {plantilla.nombre} (tipo: {plantilla.get_tipo_documento_display()})']
    palabras = palabras_identificativas(plantilla)
    if palabras:
        lineas.append(f'Se reconoce porque aparece: {", ".join(palabras)}')
    fijos = {k: v for k, v in (plantilla.valores_fijos or {}).items() if k in CAMPOS_FIJABLES and v}
    if fijos:
        lineas.append('Datos que este modelo trae siempre: ' + '; '.join(f'{k} = {v}' for k, v in fijos.items()))
    if plantilla.instrucciones:
        lineas.append(f'Cómo leerlo: {plantilla.instrucciones.strip()}')
    # Lo que las personas ya corrigieron en documentos de ESTE modelo (fase 2
    # del aprendizaje, services/aprendizaje_service.py): va en la descripción
    # para que llegue también a fotos y escaneos, donde el modelo solo se
    # conoce después de llamar a la IA.
    from deca.services.aprendizaje_service import correcciones_recientes

    try:
        ejemplos = correcciones_recientes(None, plantilla=plantilla)
    except Exception:
        ejemplos = []
    if ejemplos:
        lineas.append('Errores ya corregidos en este modelo (no los repitas): ' + '; '.join(ejemplos))
    return '\n'.join(lineas)


def pistas_modelo_detectado(plantilla) -> str:
    return (
        'Este documento es de un modelo que la empresa ya conoce. Sigue estas '
        'indicaciones, tienen prioridad sobre las reglas generales:\n' + _describir(plantilla)
    )


def pistas_catalogo(plantillas: list) -> str:
    """Catálogo numerado para que la IA diga qué modelo es (o ninguno)."""
    bloques = [f'[{i}]\n{_describir(p)}' for i, p in enumerate(plantillas, start=1)]
    return (
        'La empresa ha dado de alta estos modelos de documento que recibe o emite a menudo. '
        'Si el documento corresponde CLARAMENTE a uno de ellos, sigue sus indicaciones (tienen '
        'prioridad sobre las reglas generales) y añade al JSON la clave "modelo_reconocido" con '
        'su número. Si no corresponde a ninguno, o dudas, pon "modelo_reconocido": null.\n\n'
        + '\n\n'.join(bloques)
    )


def plantilla_por_numero(plantillas: list, numero):
    """Traduce el número que devolvió la IA a la plantilla -- solo dentro de
    la lista que se le pasó (de la propia empresa)."""
    try:
        indice = int(numero)
    except (TypeError, ValueError):
        return None
    if 1 <= indice <= len(plantillas):
        return plantillas[indice - 1]
    return None


def aplicar_valores_fijos(plantilla, campos: dict | None) -> dict:
    """Los valores fijos del modelo mandan sobre lo que haya leído la IA: los
    ha confirmado una persona de la empresa sobre un documento real."""
    campos = dict(campos or {})
    for clave, valor in (plantilla.valores_fijos or {}).items():
        if clave in CAMPOS_FIJABLES and valor not in (None, ''):
            campos[clave] = valor
    return campos


def registrar_uso(plantilla) -> None:
    from django.db.models import F

    type(plantilla).objects.filter(pk=plantilla.pk).update(
        veces_aplicada=F('veces_aplicada') + 1,
        ultima_vez_aplicada=timezone.now(),
    )
