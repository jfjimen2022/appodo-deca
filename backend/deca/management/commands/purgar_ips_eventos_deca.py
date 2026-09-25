import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from deca.models import EventoExpedicionDeca
from deca.services.storage_service import dias_retencion_ip_eventos_de

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    """Anonimiza (pone a NULL) la IP de los eventos de auditoría DeCA más
    antiguos que la retención configurada -- minimización de datos RGPD, ver
    ConfiguracionDeca.dias_retencion_ip_eventos. El resto del evento (tipo,
    fecha, usuario, hash) nunca se toca: es el historial de auditoría legal,
    no un dato personal.

    Sin bucle por empresa (a diferencia del ERP multiempresa origen): una
    instalación = una empresa, así que la retención se aplica globalmente.
    Programar en cron/systemd timer, ej. una vez al día.
    """

    help = 'Anonimiza las IPs de eventos DeCA más antiguas que la retención configurada.'

    def handle(self, *args, **options):
        dias = dias_retencion_ip_eventos_de()
        corte = timezone.now() - timedelta(days=dias)

        actualizadas = EventoExpedicionDeca.objects.filter(
            ip_origen__isnull=False,
            fecha_alta__lt=corte,
        ).update(ip_origen=None)

        if actualizadas:
            logger.info('DeCA: %s IP(s) anonimizadas (retención %s días)', actualizadas, dias)

        self.stdout.write(self.style.SUCCESS(f'DeCA: {actualizadas} IP(s) de eventos anonimizadas.'))
