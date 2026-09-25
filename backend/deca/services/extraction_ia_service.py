"""Extracción por IA de los campos de un DeCA a partir del documento origen
(albarán de venta / carta de porte CMR), complementando el regex de
`extraction_service.py`.

Separado deliberadamente de `extraction_service.py`: ese módulo es puro
(sin acceso a BD/Django) para poder testearse sin levantar la app; este
usa `deca.services.ai_client` (proveedor único Gemini, configurado solo por
variable de entorno -- ver decisión de arquitectura, sin la cascada de
clave usuario->empresa->settings del ERP multiempresa origen).

## Dos caminos, según lo que el documento permita (medido, no supuesto)

Medido sobre documentos reales, `pypdf` da resultados radicalmente distintos
según el fichero: un CMR escaneado da 0 caracteres (ni el regex ni una IA de
texto pueden hacer nada con él), mientras que un albarán con capa de texto
sí es aprovechable. Por eso hay DOS funciones y se elige según el texto
disponible:

1. `extraer_campos_con_ia` (texto): cuando el PDF tiene capa de texto. Es
   el camino barato y rápido -- el modelo solo ve el texto que ya extrajo
   pypdf.
2. `extraer_campos_con_vision` (visión): cuando NO hay texto útil (PDF
   escaneado, o una foto JPG/PNG, que el formulario también acepta). Manda
   el fichero entero al modelo. Más caro, pero es el único camino posible
   ahí.

La norma DeCA exige que el PDF que se GENERA sea nativo, pero el documento
que el cliente SUBE como origen puede ser perfectamente un escaneo.

Principio: esto SUGIERE, nunca escribe en la expedición -- el resultado
vuelve tal cual en la respuesta HTTP para que el humano lo revise antes de
confirmar, igual que la extracción por regex.
"""
from __future__ import annotations

import json
import logging
import re

from .ai_client import call_text_api, call_vision_api

logger = logging.getLogger(__name__)

# Por debajo de esto damos el texto por inservible (una carátula escaneada
# puede dejar cuatro caracteres sueltos de algún sello) y se tira de visión.
MINIMO_CARACTERES_TEXTO_UTIL = 200

# Mismos nombres que los campos reales de ExpedicionDeca -- así el frontend
# puede aplicarlos directamente al formulario sin traducir un shape
# intermedio (a diferencia de la extracción por regex, que devuelve listas
# sin atribuir porque no tiene forma de saber quién es quién).
CAMPOS_DECA_IA = (
    'numero_albaran', 'numero_cmr',
    'nif_cargador', 'nombre_cargador',
    'nif_transportista', 'nombre_transportista',
    'nif_destinatario', 'nombre_destinatario',
    'matricula_tractor', 'matricula_remolque',
    'origen', 'destino', 'fecha_hora_transporte',
    'naturaleza_mercancia', 'peso_kg', 'bultos',
)

_CAMPOS_PEDIDOS = """Extrae los siguientes campos y devuélvelos ESTRICTAMENTE en formato JSON (sin explicación, sin markdown, solo el objeto JSON), usando exactamente estas claves. Si un dato no aparece, pon `null` -- nunca inventes un valor.

- numero_albaran: número de albarán/expedición del cliente (ej. "ALN26/3.591"). Es un número de NEGOCIO del remitente, distinto del número propio del formulario CMR.
- numero_cmr: número propio del formulario/carta de porte CMR en sí, normalmente arriba a la derecha del documento (ej. "00000019.300"). Solo aparece cuando el documento es un CMR -- en un albarán de venta sin CMR, null.
- nif_cargador: NIF/CIF de quien EXPIDE la mercancía (remitente/expéditeur/sender, casilla 1 del CMR). Suele coincidir con quien emite el propio albarán.
- nombre_cargador: nombre o razón social de ese remitente.
- nif_transportista: NIF/CIF de la empresa transportista/porteador (transporteur/carrier, casilla 16 del CMR). En muchos documentos este campo va en blanco porque se asigna después -- en ese caso null.
- nombre_transportista: nombre del transportista, si aparece.
- nif_destinatario: NIF/CIF de quien RECIBE la mercancía (consignatario/destinataire/consignee, casilla 2 del CMR).
- nombre_destinatario: nombre o razón social del destinatario.
- matricula_tractor: matrícula SOLO del vehículo tractor, sin ningún otro texto. Ojo: en estos documentos el campo "Matrícula" suele traer las DOS matrículas juntas separadas por un guion (ej. "R6152BDV - 5038LZN"). Cuando una de las dos lleva delante el prefijo "R" (de "Remolque", ej. "R6152BDV"), esa es la del remolque, NO la del tractor -- va en matricula_remolque sin la "R" (queda "6152BDV"). La otra matrícula del par, la que NO lleva prefijo "R" (en el ejemplo, "5038LZN"), es la del tractor y va aquí. Guíate siempre por el prefijo "R", nunca por el orden en que aparecen escritas. Si ninguna lleva prefijo "R", asume que la primera es la tractora y la segunda el remolque. Nunca devuelvas las dos en el mismo campo. null si el campo aparece en blanco.
- matricula_remolque: matrícula SOLO del remolque/semirremolque, sin ningún otro texto y sin el prefijo "R" si lo llevaba (ver criterio arriba).
- origen: lugar de carga (ciudad/localidad, casilla 4 del CMR "lugar y fecha de carga").
- destino: lugar de entrega (casilla 3 del CMR).
- fecha_hora_transporte: fecha (y hora si aparece) del transporte/carga, en formato ISO 8601 (YYYY-MM-DDTHH:MM:SS), por ejemplo "2026-09-22T00:00:00". Si no hay hora, usa T00:00:00.
- naturaleza_mercancia: descripción de la mercancía transportada (puede ser una lista breve de los productos).
- peso_kg: peso NETO total de la mercancía en kilogramos, como número (sin separador de miles, punto decimal si hace falta -- ejemplo: 116969.00, no "116.969,00"). Si solo hay peso bruto, úsalo y dilo en el propio número tal cual (sin comentario, solo el número).
- bultos: número total de bultos/palets/cajas, como número entero.

Responde solo con el objeto JSON."""

_PROMPT_TEXTO = (
    'Analiza el texto de un albarán de venta o carta de porte CMR de transporte de '
    'mercancías por carretera en España.\n\n'
    + _CAMPOS_PEDIDOS
    + '\n\nTexto del documento:\n---\n{texto}\n---\n'
)

_PROMPT_VISION = (
    'Analiza este documento escaneado o fotografiado: es un albarán de venta o una carta de '
    'porte CMR de transporte de mercancías por carretera en España. Puede estar girado, tener '
    'sellos, firmas manuscritas o anotaciones a mano -- léelo igualmente.\n\n'
    + _CAMPOS_PEDIDOS
)


def texto_es_util(texto: str) -> bool:
    """False cuando el PDF no tiene capa de texto aprovechable (escaneo) y
    por tanto hay que tirar de visión -- ver docstring del módulo."""
    return len((texto or '').strip()) >= MINIMO_CARACTERES_TEXTO_UTIL


def _parsear_json_ia(respuesta: str) -> dict | None:
    """Saca el objeto JSON de la respuesta del modelo (que a veces lo
    envuelve en ```json ... ```) y lo filtra a los campos que esperamos."""
    coincidencia = re.search(r'\{.*\}', respuesta or '', re.DOTALL)
    if not coincidencia:
        logger.warning('La IA no devolvió un JSON reconocible para un documento DeCA')
        return None

    try:
        datos = json.loads(coincidencia.group())
    except (json.JSONDecodeError, ValueError):
        logger.warning('JSON de la IA no parseable para un documento DeCA')
        return None

    if not isinstance(datos, dict):
        return None
    return {campo: datos.get(campo) for campo in CAMPOS_DECA_IA if datos.get(campo) not in (None, '')}


def extraer_campos_con_vision(contenido: bytes, mime_type: str) -> dict | None:
    """Lee el documento ENTERO con un modelo de visión -- único camino
    posible cuando el PDF viene escaneado (sin capa de texto) o cuando lo
    que se sube es una foto JPG/PNG.

    Nunca lanza: cualquier fallo (sin clave configurada, cuota agotada,
    timeout) devuelve None y la subida sigue adelante."""
    try:
        respuesta = call_vision_api(contenido, mime_type, _PROMPT_VISION)
    except Exception:
        logger.exception('Fallo en la extracción por visión de un documento DeCA')
        return None
    return _parsear_json_ia(respuesta)


def extraer_campos_con_ia(texto: str) -> dict | None:
    """Complementa la extracción por regex pidiéndole a la IA de texto que
    lea el documento como lo haría una persona. Nunca lanza -- cualquier
    fallo (sin clave configurada, cuota agotada, respuesta no parseable)
    devuelve None y la subida sigue con lo que encontró el regex, como si
    esto no hubiera pasado."""
    try:
        respuesta = call_text_api(_PROMPT_TEXTO.format(texto=texto[:12000]))
    except Exception:
        logger.exception('Fallo en la extracción por IA de un documento DeCA')
        return None
    return _parsear_json_ia(respuesta)
