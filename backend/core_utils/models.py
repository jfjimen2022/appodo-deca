"""Modelo base mínimo replicado de `core/models.py` del ERP -- solo la parte
que `apps/deca` necesita. `TenantModel` (FK a Empresa) NO se replica: en el
standalone no hay multi-tenant, así que los modelos de deca pierden esa FK
directamente en vez de heredar de un equivalente vacío."""
import uuid

from django.db import models


class BaseModel(models.Model):
    """Modelo base con UUID como PK y timestamps automáticos -- igual que en
    el ERP origen (`core.models.BaseModel`)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fecha_alta = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
