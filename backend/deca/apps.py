"""Registro de la app `deca` en Django."""

from django.apps import AppConfig


class DecaConfig(AppConfig):
    """App única del standalone: toda la lógica de DeCA vive aquí (en el ERP
    origen era una app más entre muchas)."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'deca'
