"""Comando programado (servicio `scheduler` del docker-compose): cierra los
avisos "Modificado en el ERP" sin contestar cuyo DeCA ya no se puede corregir
(plazo vencido). La pantalla ya los cierra al abrirse; esto deja el historial
al día aunque nadie entre. Ver deca/services/avisos_erp_service.py."""

from django.core.management.base import BaseCommand

from deca.services.avisos_erp_service import caducar_avisos_erp


class Command(BaseCommand):
    help = 'Cierra los avisos del ERP sin contestar cuyo plazo de corrección ha vencido.'

    def handle(self, *args, **options):
        cerrados = caducar_avisos_erp()
        self.stdout.write(self.style.SUCCESS(f'DeCA: {cerrados} aviso(s) del ERP caducado(s).'))
