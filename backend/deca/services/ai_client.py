"""Cliente de IA propio y mínimo -- sustituye a `core.ai` del ERP origen
(multi-proveedor, con cascada de clave usuario -> empresa -> settings).

Decisión de arquitectura: un único proveedor (Gemini), configurable SOLO por
variable de entorno (`GEMINI_API_KEY`, `GEMINI_MODEL`) -- sin cascada de
clave por usuario/empresa, porque en el standalone no hay ni lo uno ni lo
otro. Se llama a la API REST de Gemini directamente por HTTP (`requests`) en
vez de depender del SDK `google-generativeai`/`google-genai`, para no atar
el proyecto a un paquete más -- la forma del payload es la misma que usa
`google.genai.Client.models.generate_content` en el ERP origen.

Ambas funciones NUNCA deben usarse para escribir directamente en un modelo
de negocio -- ver `deca/services/extraction_ia_service.py`: la IA sugiere,
un humano confirma en el formulario.
"""
from __future__ import annotations

import base64
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

_GEMINI_API_URL = (
    'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
)


def _modelo() -> str:
    return getattr(settings, 'GEMINI_MODEL', '') or 'gemini-2.5-flash'


def _api_key() -> str:
    key = getattr(settings, 'GEMINI_API_KEY', '')
    if not key:
        raise Exception(
            'No hay GEMINI_API_KEY configurada -- añádela al .env de esta instalación '
            'para activar la extracción automática por IA. Sin ella, la extracción por '
            'regex (extraction_service.py) sigue funcionando igual.'
        )
    return key


def _timeout() -> float:
    try:
        return float(getattr(settings, 'IA_TIMEOUT_SEGUNDOS', 30) or 30)
    except (TypeError, ValueError):
        return 30.0


def _post(payload: dict) -> str:
    url = _GEMINI_API_URL.format(model=_modelo())
    respuesta = requests.post(
        url, params={'key': _api_key()}, json=payload, timeout=_timeout(),
    )
    respuesta.raise_for_status()
    datos = respuesta.json()
    try:
        return datos['candidates'][0]['content']['parts'][0]['text']
    except (KeyError, IndexError, TypeError) as e:
        logger.warning('Respuesta de Gemini sin texto reconocible: %s', datos)
        raise Exception('La IA no devolvió una respuesta reconocible.') from e


def call_text_api(prompt: str) -> str:
    """Llamada de solo texto -- ver `docs` del ERP origen (`core.ai.call_text_api`)
    para la forma del prompt que ya se usa en `extraction_ia_service.py`."""
    payload = {'contents': [{'parts': [{'text': prompt}]}]}
    return _post(payload)


def call_vision_api(contenido: bytes, mime_type: str, prompt: str) -> str:
    """Llamada con un fichero (imagen o PDF) adjunto -- equivalente a
    `core.ai.call_vision_api` del ERP origen."""
    b64 = base64.b64encode(contenido).decode('utf-8')
    payload = {
        'contents': [{
            'parts': [
                {'inline_data': {'mime_type': mime_type, 'data': b64}},
                {'text': prompt},
            ],
        }],
    }
    return _post(payload)
