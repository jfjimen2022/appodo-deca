"""Generar el DeCA oficial de una expedición CONFIRMADA: numerar si procede,
QR, PDF con su hash, evento de auditoría y aprendizaje de lecturas.

Un solo sitio para los dos caminos que generan un DeCA -- el botón "Generar
DeCA" de la pantalla (GenerarDecaView) y lo que llega del ERP de la empresa
por una clave de integración (IngestaExpedicionDecaView). Si cada uno lo
hiciera a su manera, acabarían saliendo DeCA distintos según por dónde
entraran.

La comprobación de campos obligatorios la hace quien llama (cada uno
responde distinto si faltan: la pantalla da un 400, la integración deja el
borrador para que alguien lo complete)."""

import logging

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException

from ..models import EventoExpedicionDeca, ExpedicionDeca
from . import aprendizaje_service, auditoria_service, identificador_service, pdf_service, qr_service, storage_service

logger = logging.getLogger(__name__)


class ErrorGeneracionDeca(APIException):
    """No se pudo generar (o regenerar) el PDF del DeCA. Cuando se lanza, la
    base de datos ya está como antes de intentarlo. Al ser una APIException,
    DRF responde un JSON `{"detail": "..."}` que el frontend enseña tal cual
    (aviso rojo + toast), en vez de un 500 en HTML que solo daba el mensaje
    genérico. El detalle técnico va al log, nunca al usuario."""
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    default_detail = (
        'No se ha podido generar el PDF del DeCA. No se ha guardado ningún cambio: '
        'la expedición sigue confirmada y puedes volver a intentarlo. '
        'Si vuelve a fallar, avisa a soporte.'
    )
    default_code = 'error_generacion_deca'


def _borrar_pdf_huerfano(expedicion: ExpedicionDeca, nombre_anterior: str) -> None:
    """El fichero del PDF no está en la base de datos: si se llegó a escribir
    antes del fallo, el rollback no lo borra. Django nunca sobrescribe (si ya
    existe `DECA_<id>.pdf` le añade un sufijo), así que el PDF anterior, si lo
    había, sigue intacto y solo hay que quitar el nuevo."""
    nombre_nuevo = expedicion.pdf_generado.name
    if nombre_nuevo and nombre_nuevo != nombre_anterior:
        try:
            expedicion.pdf_generado.storage.delete(nombre_nuevo)
        except Exception:
            logger.exception('DeCA %s: no se pudo borrar el PDF huérfano %s', expedicion.id, nombre_nuevo)


def _restaurar_desde_bd(expedicion: ExpedicionDeca) -> None:
    """Tras el rollback, el objeto en memoria aún lleva los cambios a medias
    (número, estado, fecha...): se relee de la BD para que quien llama no
    trabaje con datos que no existen."""
    try:
        expedicion.refresh_from_db()
    except Exception:
        logger.exception('DeCA %s: no se pudo releer tras el fallo de generación', expedicion.id)


def generar(expedicion: ExpedicionDeca, url_publica: str, usuario=None, detalle: str = '') -> ExpedicionDeca:
    """CONFIRMADO -> GENERADO. `url_publica` es la dirección que lleva el QR
    (la construye quien llama, que es quien conoce el request).

    Todo o nada: número, PDF, estado GENERADO y evento de auditoría van en
    una transacción. Si algo falla, no se consume número, la expedición sigue
    CONFIRMADA y se lanza ErrorGeneracionDeca."""
    nombre_pdf_anterior = expedicion.pdf_generado.name
    try:
        with transaction.atomic():
            # Numera AQUÍ, una sola vez al generar, si la empresa usa el contador de
            # Appodo (ver identificador_service): nunca en borrador.
            expedicion = identificador_service.asignar_numero_interno_si_procede(expedicion)

            qr_png = qr_service.generar_qr_png(url_publica)
            # Un solo instante para el metadato de CREACIÓN del PDF y para
            # fecha_generacion: si se tomaban por separado, al corregir el DeCA la
            # creación del PDF nuevo (que sale de fecha_generacion) podía diferir
            # un segundo de la del original (Resolución 5-jun-2026, apdo. 2º).
            generado_en = timezone.now()
            expedicion.fecha_generacion = generado_en
            contenido_pdf = pdf_service.generar_pdf_deca(expedicion, qr_png)
            # Guarda el PDF, calcula su hash SHA-256 y pasa la expedición a GENERADO.
            expedicion = storage_service.guardar_pdf_generado(expedicion, contenido_pdf, generado_en=generado_en)
            auditoria_service.registrar_evento(
                expedicion, EventoExpedicionDeca.TipoEvento.GENERADA, usuario=usuario, detalle=detalle,
            )
    except Exception as exc:
        logger.exception('DeCA %s: fallo al generar el PDF', expedicion.id)
        _borrar_pdf_huerfano(expedicion, nombre_pdf_anterior)
        _restaurar_desde_bd(expedicion)
        raise ErrorGeneracionDeca() from exc

    # Fuera de la transacción y sin poder tumbar la generación: el DeCA ya es
    # oficial. Con los datos ya decididos, se compara con lo que leyó la IA y
    # se aprenden los sinónimos de lo que se corrigió; si esto falla, se
    # pierde solo el aprendizaje de esta vez.
    try:
        aprendizaje_service.resolver_lecturas(expedicion)
    except Exception:
        logger.exception('DeCA %s: fallo en el aprendizaje de lecturas (el DeCA sí se generó)', expedicion.id)
    return expedicion


def regenerar_tras_correccion(expedicion: ExpedicionDeca, url_publica: str) -> ExpedicionDeca:
    """Rehace el PDF de un DeCA ya GENERADO tras corregir un dato, con el
    MISMO token/QR (la URL pública no cambia), para que quien escanee el QR
    del papel ya impreso vea los datos corregidos.

    Debe llamarse DENTRO de la transacción de quien guarda la corrección: si
    falla, lanza ErrorGeneracionDeca y esa transacción deshace también los
    datos nuevos y la ModificacionDeca, así que pantalla y PDF no se
    contradicen nunca."""
    nombre_pdf_anterior = expedicion.pdf_generado.name
    try:
        qr_png = qr_service.generar_qr_png(url_publica)
        contenido_pdf = pdf_service.generar_pdf_deca(expedicion, qr_png)
        return storage_service.regenerar_pdf_tras_correccion(expedicion, contenido_pdf)
    except Exception as exc:
        logger.exception('DeCA %s: fallo al regenerar el PDF tras la corrección', expedicion.id)
        _borrar_pdf_huerfano(expedicion, nombre_pdf_anterior)
        raise ErrorGeneracionDeca(
            'No se ha podido regenerar el PDF con la corrección. No se ha guardado ningún cambio: '
            'el DeCA sigue con los datos anteriores. Inténtalo de nuevo; si vuelve a fallar, avisa a soporte.'
        ) from exc
