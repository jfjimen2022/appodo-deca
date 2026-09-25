"""Envío manual del DeCA generado por email a un destinatario cualquiera
(cliente, transportista, quien haga falta). Usa el SMTP estándar de Django
(`EMAIL_*` en settings, ver .env.example) en vez del `email_empresa` del ERP
multiempresa origen (que resolvía SMTP por empresa) -- aquí solo hay una
instancia con un único SMTP configurado.

Deliberadamente MANUAL (el usuario escribe el destinatario en el momento) --
la automatización según `ConfiguracionDeca.notificar_cliente_activo`/
`canal_notificacion_*` es una fase posterior, no construida todavía."""
from __future__ import annotations

import logging
import smtplib

from django.conf import settings
from django.core.mail import EmailMessage

from . import auditoria_service
from ..models import EventoExpedicionDeca, ExpedicionDeca

logger = logging.getLogger(__name__)


class EmailDecaError(Exception):
    """Fallo legible de cara al usuario al enviar el DeCA por email -- SMTP
    sin configurar, credenciales rechazadas, destinatario inválido, etc."""


def _nombre_empresa() -> str:
    return getattr(settings, 'EMPRESA_NOMBRE', '') or ''


def _asunto_por_defecto(expedicion: ExpedicionDeca) -> str:
    identificador = expedicion.numero_albaran or str(expedicion.id)
    empresa = _nombre_empresa()
    return f'DeCA {identificador} -- {empresa}' if empresa else f'DeCA {identificador}'


def _cuerpo_por_defecto(expedicion: ExpedicionDeca) -> str:
    identificador = expedicion.numero_albaran or str(expedicion.id)
    return (
        f'Adjunto el Documento electrónico de Control Administrativo (DeCA) '
        f'de la expedición {identificador}.\n\n'
        f'Origen: {expedicion.origen or "-"}\n'
        f'Destino: {expedicion.destino or "-"}\n'
        f'Matrícula tractora: {expedicion.matricula_tractor or "-"}\n\n'
        f'{_nombre_empresa()}'
    )


def enviar_expedicion_email(expedicion: ExpedicionDeca, destinatario, usuario, asunto=None, cuerpo=None) -> None:
    """Envía el PDF ya generado de `expedicion` (debe estar GENERADO) a
    `destinatario`, registrando el evento `enviada_email`.

    Lanza `ValueError` si la expedición no está generada, o `EmailDecaError`
    si el SMTP no está configurado o falla el envío (mensaje ya legible de
    cara al usuario).
    """
    if expedicion.estado != ExpedicionDeca.Estado.GENERADO:
        raise ValueError('Solo se puede enviar por email un DeCA ya generado -- genéralo primero.')

    if not settings.EMAIL_HOST:
        raise EmailDecaError(
            'No hay un servidor SMTP configurado en esta instalación -- rellena '
            'EMAIL_HOST/EMAIL_HOST_USER/EMAIL_HOST_PASSWORD en el .env.'
        )

    asunto_final = asunto or _asunto_por_defecto(expedicion)
    cuerpo_final = cuerpo or _cuerpo_por_defecto(expedicion)

    expedicion.pdf_generado.open('rb')
    try:
        contenido_pdf = expedicion.pdf_generado.read()
    finally:
        expedicion.pdf_generado.close()
    nombre_adjunto = f'DECA_{expedicion.numero_albaran or expedicion.id}.pdf'

    mensaje = EmailMessage(
        subject=asunto_final, body=cuerpo_final,
        from_email=settings.DEFAULT_FROM_EMAIL, to=[destinatario],
    )
    mensaje.attach(nombre_adjunto, contenido_pdf, 'application/pdf')

    try:
        mensaje.send(fail_silently=False)
    except smtplib.SMTPException as e:
        logger.exception('Fallo enviando el DeCA %s por email a %s', expedicion.id, destinatario)
        raise EmailDecaError(f'No se pudo enviar el email: {e}') from e

    auditoria_service.registrar_evento(
        expedicion, EventoExpedicionDeca.TipoEvento.ENVIADA_EMAIL,
        usuario=usuario, detalle=f'Enviado por email a {destinatario}.',
    )
