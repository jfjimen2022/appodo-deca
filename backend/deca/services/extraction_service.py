"""
Extracción de texto/campos de los PDF nativos que sube logística para una
expedición DeCA (albarán de venta, CMR...) -- capa pura de procesamiento,
sin acceso a BD ni a modelos de Django, para poder testear con pytest sin
levantar la app. Solo PRE-RELLENA el formulario que un humano revisa y
confirma antes de generar nada: un acierto parcial es aceptable, no se
busca precisión perfecta.

Copiado tal cual del ERP origen -- es lógica pura, sin dependencia de tenant.
"""
from __future__ import annotations

import io
import re
import unicodedata
from datetime import datetime

from pypdf import PdfReader, PdfWriter

# Un NIF/CIF/NIE español real nunca tiene los dos extremos numéricos (a
# diferencia de un teléfono de 9 dígitos, que sí) -- DNI acaba en letra, NIE
# empieza por X/Y/Z, CIF empieza siempre por letra. Ver core_utils/validadores_fiscales.py.
PATRON_NIF = re.compile(r'\b(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J])\b')
PATRON_MATRICULA = re.compile(r'\b\d{4}[A-Z]{3}\b')
# Un albarán/CMR real usa notación española: punto de millar, coma decimal
# ("116.969,00"). El peso TOTAL real en estos documentos casi siempre lleva
# decimales ("577,50"); un entero suelto seguido de "Kg" es casi siempre
# ruido de la descripción del producto, no el dato que buscamos -- exigir
# la parte decimal descarta ese falso positivo. Mejor no encontrar nada (lo
# complementa la IA) que rellenar un valor absurdo.
_NUMERO_ES_CON_DECIMAL = r'\d{1,3}(?:\.\d{3})*,\d+'
PATRON_PESO = re.compile(rf'({_NUMERO_ES_CON_DECIMAL})[ \t]*(?:kg|kilos|kilogramos)\b', re.IGNORECASE)
# `[ \t]*` (nunca `\s*`) a propósito: `\s` incluye el salto de línea, y en
# una tabla convertida a texto plano eso enlaza dos celdas de filas/columnas
# distintas que no tienen relación.
PATRON_BULTOS = re.compile(r'(\d+)[ \t]*(?:bultos|bulto|palets?|cajas?)', re.IGNORECASE)
PATRON_FECHA = re.compile(r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2})?')

# Formatos de fecha que puede traer un albarán/CMR español (con o sin hora,
# con / o con -). El formulario espera un datetime ISO parseable por
# `new Date()` en el navegador -- devolver el texto crudo "22/09/2026" haría
# que el frontend lo interpretara como MM/DD/YYYY (mes 22 inválido) y la
# fecha se perdería en silencio. Normalizar aquí, no en el frontend, es la
# única forma de no depender de cómo cada navegador parsea una cadena ambigua.
_FORMATOS_FECHA = (
    '%d/%m/%Y %H:%M', '%d-%m-%Y %H:%M',
    '%d/%m/%Y', '%d-%m-%Y',
    '%d/%m/%y', '%d-%m-%y',
)


def _normalizar_numero_es(cadena: str) -> str:
    """"116.969,00" -> "116969.00"; "49" -> "49". Nunca lanza -- si el
    resultado no es un número válido, se devuelve tal cual (mejor un dato
    raro que visible y corregible, que una excepción)."""
    limpio = cadena.replace('.', '').replace(',', '.')
    try:
        float(limpio)
    except ValueError:
        return cadena
    return limpio


def _normalizar_fecha_es(cadena: str) -> str | None:
    """Convierte una fecha en formato español detectada por regex a ISO
    8601. None si ningún formato conocido encaja -- mejor no rellenar nada
    que rellenar algo que el navegador luego malinterpreta.

    El sufijo 'Z' es deliberado: `fecha_hora_transporte` se trata como valor
    UTC LITERAL en todo el sistema (backend `strftime` sin conversión), nunca
    como una hora local que haya que convertir."""
    for formato in _FORMATOS_FECHA:
        try:
            return datetime.strptime(cadena.strip(), formato).isoformat() + 'Z'
        except ValueError:
            continue
    return None

LONGITUD_CABECERA = 500

# Un DeCA/albarán/CMR real nunca pasa de unas pocas páginas -- este tope
# acota el coste de parsear un PDF ajeno subido por el usuario (síncrono,
# dentro del propio request) sin depender solo del límite de tamaño en
# bytes, que no limita el número de páginas ni la complejidad del árbol de
# objetos.
MAXIMO_PAGINAS_A_PROCESAR = 50


def extraer_texto_por_pagina(archivo) -> list[str]:
    """Devuelve el texto de cada página del PDF, en orden (máximo
    `MAXIMO_PAGINAS_A_PROCESAR`). Página sin texto extraíble -> ''."""
    reader = PdfReader(archivo)
    paginas = reader.pages[:MAXIMO_PAGINAS_A_PROCESAR]
    return [pagina.extract_text() or '' for pagina in paginas]


def identificar_tipo_documento(texto_pagina: str) -> str | None:
    """Heurística por palabras clave en la cabecera de la página. None si no reconoce nada -- nunca inventa un tipo por descarte."""
    cabecera = unicodedata.normalize('NFKD', texto_pagina[:LONGITUD_CABECERA])
    cabecera = cabecera.encode('ascii', 'ignore').decode('ascii').upper()
    if 'CMR' in cabecera:
        return 'cmr'
    if 'ALBARAN' in cabecera:
        return 'albaran_venta'
    return None


def agrupar_paginas_por_documento(paginas: list[str]) -> list[tuple[str, list[int]]]:
    """Agrupa índices de páginas consecutivas del mismo tipo. Una página sin tipo detectado continúa el documento anterior, o abre un grupo 'otro' si es la primera."""
    grupos: list[tuple[str, list[int]]] = []
    for indice, texto in enumerate(paginas):
        tipo = identificar_tipo_documento(texto)
        if tipo is None:
            tipo = grupos[-1][0] if grupos else 'otro'
        if grupos and grupos[-1][0] == tipo:
            grupos[-1][1].append(indice)
        else:
            grupos.append((tipo, [indice]))
    return grupos


def dividir_pdf_por_grupos(archivo, grupos: list[tuple[str, list[int]]]) -> list[tuple[str, bytes]]:
    """Genera un PDF independiente por cada grupo de páginas del documento original."""
    if hasattr(archivo, 'seek'):
        archivo.seek(0)
    reader = PdfReader(archivo)
    resultado: list[tuple[str, bytes]] = []
    for tipo_documento, indices in grupos:
        writer = PdfWriter()
        for indice in indices:
            writer.add_page(reader.pages[indice])
        buffer = io.BytesIO()
        writer.write(buffer)
        resultado.append((tipo_documento, buffer.getvalue()))
    return resultado


def extraer_campos(texto: str) -> dict[str, str | None]:
    """Adivina campos del DeCA a partir del texto completo del/de los documento(s). No distingue quién es cada NIF/matrícula -- eso lo decide el humano al revisar."""
    nifs_encontrados: list[str] = []
    for match in PATRON_NIF.findall(texto.upper()):
        if match not in nifs_encontrados:
            nifs_encontrados.append(match)

    matriculas_encontradas: list[str] = []
    for match in PATRON_MATRICULA.findall(texto.upper()):
        if match not in matriculas_encontradas:
            matriculas_encontradas.append(match)

    peso_match = PATRON_PESO.search(texto)
    bultos_match = PATRON_BULTOS.search(texto)
    fecha_match = PATRON_FECHA.search(texto)

    return {
        'nifs_encontrados': nifs_encontrados,
        'matriculas_encontradas': matriculas_encontradas,
        'peso_kg': _normalizar_numero_es(peso_match.group(1)) if peso_match else None,
        'bultos': bultos_match.group(1) if bultos_match else None,
        'fecha_hora_transporte': _normalizar_fecha_es(fecha_match.group(0)) if fecha_match else None,
    }
