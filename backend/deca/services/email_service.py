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
from . import identificador_service
from ..models import ConfiguracionDeca, EventoExpedicionDeca, ExpedicionDeca

logger = logging.getLogger(__name__)


class EmailDecaError(Exception):
    """Fallo legible de cara al usuario al enviar el DeCA por email -- SMTP
    sin configurar, credenciales rechazadas, destinatario inválido, etc."""


def _nombre_empresa() -> str:
    return getattr(settings, 'EMPRESA_NOMBRE', '') or ''


class _DiccionarioTolerante(dict):
    """Deja un placeholder desconocido o mal escrito tal cual (`{typo}`) en
    vez de reventar `str.format` -- la plantilla la escribe el cliente desde
    Configuración, un error de tecleo no puede tumbar un envío real."""

    def __missing__(self, clave):
        return '{' + clave + '}'


def _contexto_plantilla(expedicion: ExpedicionDeca, config: ConfiguracionDeca | None) -> dict:
    return {
        # Referencia según la preferencia de la empresa (albarán/CMR/contador
        # automático, con fallback en cascada) -- ver identificador_service.
        # `numero_albaran` se mantiene aparte, literal, para quien quiera
        # referenciar ESE campo en concreto en su plantilla aunque la empresa
        # prefiera otro identificador.
        'identificador': identificador_service.identificador_expedicion(expedicion, config),
        'numero_albaran': expedicion.numero_albaran or str(expedicion.id),
        'origen': expedicion.origen or '-',
        'destino': expedicion.destino or '-',
        'matricula_tractor': expedicion.matricula_tractor or '-',
        'empresa': _nombre_empresa(),
    }


def _renderizar_plantilla(plantilla: str, contexto: dict) -> str:
    if not plantilla:
        return ''
    try:
        return plantilla.format_map(_DiccionarioTolerante(contexto))
    except (ValueError, IndexError):
        # Llaves sin cerrar u otro error de formato en lo que el cliente
        # escribió -- mejor mandar la plantilla tal cual que no enviar nada.
        return plantilla


def _asunto_por_defecto(contexto: dict) -> str:
    # El "concepto" del email es la referencia de la expedición según la
    # preferencia de la empresa, no "DeCA X -- Empresa".
    return contexto['identificador']


def _cuerpo_por_defecto(contexto: dict) -> str:
    return (
        f'Adjunto el Documento electrónico de Control Administrativo (DeCA) '
        f'de la expedición {contexto["identificador"]}.\n\n'
        f'Origen: {contexto["origen"]}\n'
        f'Destino: {contexto["destino"]}\n'
        f'Matrícula tractora: {contexto["matricula_tractor"]}\n\n'
        f'{contexto["empresa"]}'
    )


def enviar_expedicion_email(expedicion: ExpedicionDeca, destinatario, usuario, asunto=None, cuerpo=None) -> None:
    """Envía el PDF ya generado de `expedicion` (debe estar GENERADO) a
    `destinatario`, registrando el evento `enviada_email`.

    Sin `asunto`/`cuerpo` explícitos, usa la plantilla de Configuración
    (`plantilla_asunto_email`/`plantilla_cuerpo_email`) y si no hay plantilla,
    el mensaje estándar.

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

    config = identificador_service.obtener_configuracion(expedicion)
    contexto = _contexto_plantilla(expedicion, config)

    asunto_final = (
        asunto
        or (config and _renderizar_plantilla(config.plantilla_asunto_email, contexto))
        or _asunto_por_defecto(contexto)
    )
    cuerpo_final = (
        cuerpo
        or (config and _renderizar_plantilla(config.plantilla_cuerpo_email, contexto))
        or _cuerpo_por_defecto(contexto)
    )

    expedicion.pdf_generado.open('rb')
    try:
        contenido_pdf = expedicion.pdf_generado.read()
    finally:
        expedicion.pdf_generado.close()
    # El identificador del CONTEXTO (asunto/cuerpo) se deja sin sanear a
    # propósito -- ahí es texto legible, no un nombre de archivo. Para el
    # adjunto sí hace falta la versión saneada (ver identificador_service).
    nombre_adjunto = f'DECA_{identificador_service.identificador_expedicion_para_archivo(expedicion, config)}.pdf'

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
