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

import io
import json
import logging
import re

from PIL import Image, ImageOps

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
    'nif_cargador', 'nombre_cargador', 'domicilio_cargador',
    'nif_transportista', 'nombre_transportista',
    'nif_destinatario', 'nombre_destinatario',
    'matricula_tractor', 'matricula_remolque',
    'nombre_conductor', 'nif_conductor',
    'origen', 'destino', 'fecha_hora_transporte',
    'naturaleza_mercancia', 'peso_kg', 'bultos', 'comentarios',
)

# La carta de porte CMR es un formulario INTERNACIONAL con casillas
# numeradas, igual lo imprima quien lo imprima: una sola guía vale para
# todas las empresas sin que ninguna tenga que dar de alta su CMR como
# modelo (analizado 2026-09-27 con el CMR escaneado de Frutas del Sur).
_GUIA_CMR = """
Si el documento es una carta de porte CMR (formulario internacional con casillas numeradas, en varios idiomas), las casillas significan siempre lo mismo:
- Casilla 1 (remitente / expéditeur / sender) es quien ENTREGA la mercancía, NO necesariamente el cargador: no la copies a nombre_cargador/nif_cargador por sí sola (ver la regla de nif_cargador).
- Casilla 14 (instrucciones de pago / prescriptions d'affranchissement): "franco", "porte pagado" o "paid" indica que el transporte lo paga -- y normalmente lo contrata -- el remitente; "debido", "no franco", "non franco" o "unpaid", que lo paga el destinatario.
- Casilla 2 (consignatario / destinataire / consignee) -> nombre_destinatario y nif_destinatario.
- Casilla 3 (lugar de entrega) -> destino.
- Casilla 4 (lugar y fecha de carga) -> origen y fecha_hora_transporte.
- Casillas 6 a 9 (marcas, número de bultos, clase de embalaje, naturaleza de la mercancía) -> bultos (el total) y naturaleza_mercancia.
- Casilla 11 es el peso BRUTO. Algunos modelos traen al lado una casilla de peso NETO: si existe, peso_kg es el neto; si no, el bruto. Usa la fila de total si la hay, nunca la de una sola línea de producto.
- Casillas 13 (instrucciones del remitente) y 18 (reservas y observaciones del porteador) -> comentarios, solo si traen algo propio de este envío (no el texto legal impreso en todos los CMR).
- Casilla 16 (porteador / transporteur / carrier) -> nombre_transportista, nif_transportista y, si aparece ahí, la matrícula.
- Casilla 17 (porteadores sucesivos) NO es el transportista principal: ignórala para nombre_transportista.
- Casillas 22 a 24 son firmas y sellos: no las uses como fuente del nombre de una empresa si ese dato ya aparece impreso en otra casilla.
- El número del propio formulario CMR (numero_cmr) va impreso arriba a la derecha; el número de albarán del remitente (numero_albaran) suele aparecer en la casilla 5 o en observaciones.
"""

_CAMPOS_PEDIDOS = """Extrae los siguientes campos y devuélvelos ESTRICTAMENTE en formato JSON (sin explicación, sin markdown, solo el objeto JSON), usando exactamente estas claves. Si un dato no aparece, pon `null` -- nunca inventes un valor.

- numero_albaran: número de albarán/expedición del cliente (ej. "ALN26/3.591"). Es un número de NEGOCIO del remitente, distinto del número propio del formulario CMR.
- numero_cmr: número propio del formulario/carta de porte CMR en sí, normalmente arriba a la derecha del documento (ej. "00000019.300"). Solo aparece cuando el documento es un CMR -- en un albarán de venta sin CMR, null.
- nif_cargador: NIF/CIF del CARGADOR CONTRACTUAL, es decir, de quien CONTRATA el transporte con el transportista. NO es por defecto el remitente ni quien emite el albarán: un cliente puede mandar su propio camión a recoger la mercancía a su proveedor (entonces el cargador es el cliente, no el proveedor). Rellénalo SOLO si el documento indica quién contrata o paga el porte (texto como "cargador contractual", "ordenante del transporte", "portes a cargo de", o la casilla 14 del CMR). Si lo deduces de la forma de pago del porte, añade nif_cargador y nombre_cargador a campos_dudosos. Si el documento no dice quién contrata el transporte, null -- no lo supongas.
- nombre_cargador: nombre o razón social de ese cargador contractual, con el mismo criterio (null si no consta).
- domicilio_cargador: domicilio (calle, número, población) de ese cargador contractual, tal como aparezca junto a su nombre. null si no consta o si no se sabe quién es el cargador.
- nif_transportista: NIF/CIF de la empresa transportista/porteador (transporteur/carrier, casilla 16 del CMR). En muchos documentos este campo va en blanco porque se asigna después -- en ese caso null.
- nombre_transportista: nombre del transportista, si aparece.
- nif_destinatario: NIF/CIF de quien RECIBE la mercancía (consignatario/destinataire/consignee, casilla 2 del CMR).
- nombre_destinatario: nombre o razón social del destinatario.
- matricula_tractor: matrícula SOLO del vehículo tractor, sin ningún otro texto. Puede ser española (actual como 1234BCD, de remolque con "R" delante como R1234BCD, o antigua provincial como CA1234AB) o EXTRANJERA (cualquier formato): cópiala tal cual, solo sin espacios ni guiones, aunque no tenga formato español. Ojo: en estos documentos el campo "Matrícula" suele traer las DOS matrículas juntas separadas por un guion (ej. "R6152BDV - 5038LZN"). Cuando una de las dos lleva delante el prefijo "R" (de "Remolque", ej. "R6152BDV"), esa es la del remolque, NO la del tractor -- va en matricula_remolque TAL CUAL, CON su "R" (queda "R6152BDV": en España la "R" forma parte de la matrícula de un remolque). La otra matrícula del par, la que NO lleva prefijo "R" (en el ejemplo, "5038LZN"), es la del tractor y va aquí. Guíate siempre por el prefijo "R", nunca por el orden en que aparecen escritas. Si ninguna lleva prefijo "R", asume que la primera es la tractora y la segunda el remolque. Nunca devuelvas las dos en el mismo campo. null si el campo aparece en blanco.
- matricula_remolque: matrícula SOLO del remolque/semirremolque, sin ningún otro texto, CONSERVANDO la "R" inicial si la lleva (ver criterio arriba).
- nombre_conductor: nombre completo del conductor/chófer, si aparece (a veces solo en una firma o casilla "el chófer reconoce"). null si no aparece.
- nif_conductor: DNI/NIE del conductor, si aparece junto a su nombre. null si no aparece -- no confundirlo con el NIF de la empresa transportista.
- origen: lugar de carga (ciudad/localidad, casilla 4 del CMR "lugar y fecha de carga").
- destino: lugar de entrega (casilla 3 del CMR).
- fecha_hora_transporte: fecha (y hora si aparece) del transporte/carga, en formato ISO 8601 (YYYY-MM-DDTHH:MM:SS), por ejemplo "2026-09-22T00:00:00". Si no hay hora, usa T00:00:00.
- naturaleza_mercancia: QUÉ mercancía es, con su denominación corriente en palabras normales, como se entendería sin conocer la empresa (ej. "Aguacate Hass en cajas de 4 kg"). Si son varios productos, una lista breve o un grupo claro (ej. "Fruta fresca: aguacate y mango"). NO copies códigos de artículo, referencias internas, números de lote ni abreviaturas de sistema (de "ART00341 AGUAC.HASS CAL18 4KG" escribe "Aguacate Hass en cajas de 4 kg"). Si es mercancía peligrosa (ADR), su denominación oficial y su número ONU.
- peso_kg: peso NETO total de la mercancía en kilogramos, como número (sin separador de miles, punto decimal si hace falta -- ejemplo: 116969.00, no "116.969,00"). Si solo hay peso bruto, úsalo y dilo en el propio número tal cual (sin comentario, solo el número).
- bultos: número total de bultos/palets/cajas, como número entero.
- comentarios: observaciones, notas anexas o reservas escritas a mano o impresas en el documento que no encajen en ningún otro campo (ej. casillas "Observaciones", "Notas anexas", "Reservas del porteador" de un CMR). null si no hay ninguna.
- campos_dudosos: lista con las claves de los campos anteriores cuyo valor has leído de texto ESCRITO A MANO, tachado, borroso o parcialmente ilegible y que por tanto no es seguro (ej. ["nombre_conductor", "nif_conductor"]). Lista vacía [] si todo lo que devuelves se lee con claridad.
""" + _GUIA_CMR + """
Responde solo con el objeto JSON."""

# `{pistas}`: indicaciones del modelo de documento de la empresa, si lo hay
# (services/plantillas_service.py). Siempre se inyecta por `.format()`, nunca
# concatenado, porque es texto libre escrito por la empresa.
_PROMPT_TEXTO = (
    'Analiza el texto de un albarán de venta o carta de porte CMR de transporte de '
    'mercancías por carretera en España.\n\n'
    + _CAMPOS_PEDIDOS.replace('{', '{{').replace('}', '}}')
    + '{pistas}'
    + '\n\nTexto del documento:\n---\n{texto}\n---\n'
)

# Solo en visión (fase 3 del aprendizaje, 2026-09-28): dónde está escrito
# cada dato dudoso, para que el móvil enseñe ese trozo de la foto ampliado
# junto a "¿Es este?" y la persona lea la letra con sus propios ojos.
_ZONAS_DUDOSOS = (
    '\n\nAdemás, añade al JSON la clave "zonas": un objeto que, para CADA campo de campos_dudosos, '
    'da el rectángulo donde está escrito en la imagen como [ymin, xmin, ymax, xmax], en enteros '
    'de 0 a 1000 relativos al alto y ancho de la imagen tal como la ves. Ejemplo: '
    '"zonas": {"nombre_conductor": [612, 80, 660, 410]}. Si todo es legible, "zonas": {}.'
)

_PROMPT_VISION = (
    'Analiza este documento escaneado o fotografiado: es un albarán de venta, un ticket de '
    'báscula, un documento de salida o una carta de porte CMR de transporte de mercancías por '
    'carretera en España. Puede estar girado, tener sellos, firmas manuscritas o anotaciones a '
    'mano -- léelo igualmente.\n\n'
    + _CAMPOS_PEDIDOS.replace('{', '{{').replace('}', '}}')
    + _ZONAS_DUDOSOS.replace('{', '{{').replace('}', '}}')
    + '{pistas}'
)


def _zonas_validas(zonas, campos_dudosos: list) -> dict:
    """Solo rectángulos bien formados ([ymin, xmin, ymax, xmax] en 0-1000,
    con tamaño) de campos que la IA marcó como dudosos. Lo demás se
    descarta sin más: el recorte es una ayuda, nunca debe romper nada."""
    if not isinstance(zonas, dict):
        return {}
    validas = {}
    for campo, caja in zonas.items():
        if campo not in campos_dudosos or not isinstance(caja, (list, tuple)) or len(caja) != 4:
            continue
        try:
            ymin, xmin, ymax, xmax = (int(round(float(v))) for v in caja)
        except (TypeError, ValueError):
            continue
        if 0 <= ymin < ymax <= 1000 and 0 <= xmin < xmax <= 1000:
            validas[campo] = [ymin, xmin, ymax, xmax]
    return validas


def _bloque_pistas(pistas: str) -> str:
    return f'\n\n{pistas.strip()}\n' if pistas and pistas.strip() else ''


def texto_es_util(texto: str) -> bool:
    """False cuando el PDF no tiene capa de texto aprovechable (escaneo) y
    por tanto hay que tirar de visión -- ver docstring del módulo."""
    return len((texto or '').strip()) >= MINIMO_CARACTERES_TEXTO_UTIL


def _parsear_json_ia(respuesta: str, extras: dict | None = None) -> dict | None:
    """Saca el objeto JSON de la respuesta del modelo (que a veces lo
    envuelve en ```json ... ```) y lo filtra a los campos que esperamos.
    Si se pasa `extras`, deja ahí lo que no son campos de la expedición:
    `campos_dudosos` (solo claves válidas) y `modelo_reconocido`."""
    coincidencia = re.search(r'\{.*\}', respuesta or '', re.DOTALL)
    if not coincidencia:
        logger.warning('La IA no devolvió un JSON reconocible para un documento DeCA: %r', (respuesta or '')[:200])
        return None

    try:
        datos = json.loads(coincidencia.group())
    except (json.JSONDecodeError, ValueError):
        logger.warning('JSON de la IA no parseable para un documento DeCA')
        return None

    if not isinstance(datos, dict):
        return None
    campos = {campo: datos.get(campo) for campo in CAMPOS_DECA_IA if datos.get(campo) not in (None, '')}
    if extras is not None:
        dudosos = datos.get('campos_dudosos')
        extras['campos_dudosos'] = [
            c for c in (dudosos if isinstance(dudosos, list) else []) if c in campos
        ]
        extras['modelo_reconocido'] = datos.get('modelo_reconocido')
        extras['zonas'] = _zonas_validas(datos.get('zonas'), extras['campos_dudosos'])
    return campos


def _normalizar_orientacion_imagen(contenido: bytes, mime_type: str) -> bytes:
    """Aplica de verdad, sobre los píxeles, la rotación que indica el tag
    EXIF Orientation de una foto -- una foto de cámara (iOS y Android por
    igual) suele guardarse "tumbada" con ese tag diciendo cómo girarla al
    mostrarla, pero `call_vision_api` manda los bytes crudos al modelo, que
    no respeta ese tag: lee el documento de lado y no saca nada (bug real
    2026-09-25, CMR perfectamente nítido y bien encuadrado que la IA no
    pudo leer por venir rotado 90°). Best-effort: si algo falla (fichero
    corrupto, no es una imagen que PIL entienda) devuelve el original tal
    cual -- nunca debe romper la subida."""
    if 'pdf' in (mime_type or '').lower():
        return contenido
    try:
        imagen = Image.open(io.BytesIO(contenido))
        imagen = ImageOps.exif_transpose(imagen)
        if imagen.mode not in ('RGB', 'L'):
            imagen = imagen.convert('RGB')
        salida = io.BytesIO()
        imagen.save(salida, format='JPEG', quality=90)
        return salida.getvalue()
    except Exception:
        logger.exception('No se pudo normalizar la orientación de una foto DeCA, se manda tal cual')
        return contenido


MENSAJE_IA_RESPUESTA_ILEGIBLE = (
    'El servicio de IA no ha devuelto una respuesta válida (suele pasar cuando está '
    'saturado). Vuelve a intentarlo en unos minutos con el botón "Extraer datos".'
)


def extraer_campos_con_vision(
    user, contenido: bytes, mime_type: str, errores: list | None = None,
    pistas: str = '', extras: dict | None = None,
) -> dict | None:
    """Lee el documento ENTERO con un modelo de visión -- único camino
    posible cuando el PDF viene escaneado (sin capa de texto) o cuando lo
    que se sube es una foto JPG/PNG.

    Nunca lanza: cualquier fallo (proveedor sin soporte de PDF, cuota
    agotada, timeout) devuelve None y la subida sigue adelante. Si se pasa
    `errores`, se le añade el motivo legible para enseñárselo al usuario --
    antes un fallo de la IA se mostraba como "foto borrosa" (2026-09-25,
    cuota de Gemini agotada)."""
    contenido = _normalizar_orientacion_imagen(contenido, mime_type)
    try:
        prompt = _PROMPT_VISION.format(pistas=_bloque_pistas(pistas))
        respuesta = call_vision_api(contenido, mime_type, prompt)
    except Exception as e:
        logger.exception('Fallo en la extracción por visión de un documento DeCA')
        if errores is not None:
            errores.append(str(e))
        return None
    return _parsear_json_o_anotar(respuesta, errores, extras)


def extraer_campos_con_ia(
    user, texto: str, errores: list | None = None, pistas: str = '', extras: dict | None = None,
) -> dict | None:
    """Complementa la extracción por regex pidiéndole a la IA de texto
    configurada en la instalación (GEMINI_API_KEY, ver ai_client.py) que lea el documento como lo haría una persona. Nunca
    lanza -- cualquier fallo (sin clave configurada, cuota agotada,
    respuesta no parseable) devuelve None y la subida sigue con lo que
    encontró el regex, como si esto no hubiera pasado. `errores`: ver
    `extraer_campos_con_vision`."""
    try:
        prompt = _PROMPT_TEXTO.format(texto=texto[:12000], pistas=_bloque_pistas(pistas))
        respuesta = call_text_api(prompt)
    except Exception as e:
        logger.exception('Fallo en la extracción por IA de un documento DeCA')
        if errores is not None:
            errores.append(str(e))
        return None
    return _parsear_json_o_anotar(respuesta, errores, extras)


def _parsear_json_o_anotar(respuesta: str, errores: list | None, extras: dict | None = None) -> dict | None:
    datos = _parsear_json_ia(respuesta, extras)
    if datos is None and errores is not None:
        errores.append(MENSAJE_IA_RESPUESTA_ILEGIBLE)
    return datos
