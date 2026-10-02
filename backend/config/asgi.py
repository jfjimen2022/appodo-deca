"""Punto de entrada ASGI de Django. La instalación por defecto sirve con
gunicorn (WSGI, ver backend/entrypoint.sh); se conserva por si se quiere
servir con un servidor ASGI."""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_asgi_application()
