"""IP real de un cliente detrás de un proxy inverso (nginx/Traefik/lo que
sea que se ponga delante de esta instalación en producción).

Copiado tal cual de `core/ip_cliente.py` del ERP origen -- es lógica pura,
sin dependencia de tenant. Cuenta N saltos de confianza desde el FINAL de la
cadena `X-Forwarded-For` hacia atrás (mismo criterio que
`SimpleRateThrottle.get_ident` de DRF con `NUM_PROXIES` fijado) -- nunca se
fía del primer valor, que puede falsificarlo el propio visitante.

Configura `REST_FRAMEWORK['NUM_PROXIES']` en settings si esta instalación
corre detrás de uno o más proxies (nginx, Traefik, Cloudflare...); sin
fijarlo, se usa `REMOTE_ADDR` tal cual.
"""
from __future__ import annotations

from rest_framework.settings import api_settings


def ip_cliente(request) -> str | None:
    """IP real del visitante, o `None` si no hay ninguna disponible."""
    remote_addr = request.META.get('REMOTE_ADDR')
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    num_proxies = api_settings.NUM_PROXIES

    if not xff or not num_proxies:
        return remote_addr

    addrs = [a.strip() for a in xff.split(',') if a.strip()]
    if not addrs:
        return remote_addr

    return addrs[-min(num_proxies, len(addrs))]
