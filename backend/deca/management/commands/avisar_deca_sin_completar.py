"""Comando programado (servicio `scheduler` del docker-compose): avisa por
email a los administradores de los DeCA hechos sin cobertura que llegaron al
servidor sin poder generarse. Ver la clase Command."""

import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.core.management.base import BaseCommand
from django.utils import timezone

from deca.models import ConfiguracionDeca, ExpedicionDeca

logger = logging.getLogger(__name__)


def _config():
    # Sin fila de configuración rigen los valores por defecto (aviso
    # encendido, 2 días): `default=` solo se aplica al crear la fila.
    return ConfiguracionDeca.objects.filter(pk=1).first() or ConfiguracionDeca()


def _emails_admins() -> list[str]:
    """Standalone: los avisos van a los administradores de la instalación
    (usuarios activos con `is_staff`), en vez de al responsable del módulo /
    admin fundador del ERP origen (`core.responsables`)."""
    return list(
        get_user_model().objects
        .filter(is_active=True, is_staff=True)
        .exclude(email='')
        .values_list('email', flat=True)
    )


class Command(BaseCommand):
    """Avisa a los administradores de los DeCA hechos SIN COBERTURA que
    llegaron al servidor pero no se pudieron generar (les falta algún dato) y
    siguen así pasados N días (ConfiguracionDeca.aviso_sin_completar_dias).
    El papel ya viajó en el camión, pero el registro está incompleto.

    Una sola vez por DeCA (`aviso_sin_completar_en`). Lo que nunca ha llegado
    al servidor (un móvil que no ha vuelto a tener red) no se puede detectar
    desde aquí: eso se ve en el propio móvil.

    Pensado para ejecutarse periódicamente (cron, ver docs/INSTALACION.md)."""

    help = 'Avisa de DeCA hechos sin cobertura que siguen sin completar.'

    def handle(self, *args, **options):
        config = _config()
        if not config.aviso_sin_completar:
            self.stdout.write('DeCA: aviso de DeCA sin completar desactivado en Configuración.')
            return

        ahora = timezone.now()
        corte = ahora - timedelta(days=config.aviso_sin_completar_dias)
        vencidas = list(
            ExpedicionDeca.objects
            .exclude(referencia_offline='')
            .filter(
                estado__in=[ExpedicionDeca.Estado.BORRADOR, ExpedicionDeca.Estado.CONFIRMADO],
                aviso_sin_completar_en__isnull=True,
                emitido_sin_conexion_en__isnull=False,
                emitido_sin_conexion_en__lte=corte,
            )
        )
        if not vencidas:
            self.stdout.write(self.style.SUCCESS('DeCA: 0 DeCA sin completar avisados.'))
            return

        emails = _emails_admins()
        if not emails:
            logger.warning('Hay DeCA sin completar y ningún administrador con email a quien avisar.')
            self.stdout.write('DeCA: hay DeCA sin completar pero ningún administrador con email.')
            return

        lineas = '\n'.join(
            f'- {e.referencia_offline} · {e.origen or "?"} → {e.destino or "?"} · '
            f'emitido sin conexión el {timezone.localtime(e.emitido_sin_conexion_en).strftime("%d/%m/%Y %H:%M")}'
            for e in vencidas
        )
        cuerpo = (
            'Hola,\n\n'
            f'Hay {len(vencidas)} DeCA hechos sin cobertura que llegaron al servidor pero no se han '
            'podido generar porque les falta algún dato. El papel ya viajó en el camión; falta '
            'completar el registro:\n\n'
            f'{lineas}\n\n'
            'Ábrelos en Expediciones (están en borrador), completa lo que falte y genera.\n\n'
            'Este aviso se puede desactivar en Configuración → Trabajo en campo.\n\n— Appodo DeCa'
        )
        try:
            send_mail(
                f'Appodo DeCa: {len(vencidas)} DeCA sin cobertura pendientes de completar',
                cuerpo, settings.DEFAULT_FROM_EMAIL, emails, fail_silently=False,
            )
        except Exception:
            logger.exception('No se pudo enviar el aviso de DeCA sin completar.')
            return
        ExpedicionDeca.objects.filter(id__in=[e.id for e in vencidas]).update(aviso_sin_completar_en=ahora)
        self.stdout.write(self.style.SUCCESS(f'DeCA: {len(vencidas)} DeCA sin completar avisados.'))
