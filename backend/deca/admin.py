"""Admin de Django para soporte técnico: permite inspeccionar expediciones,
catálogos y lo aprendido por la lectura. El uso normal es siempre desde el
frontend; el historial de eventos es de solo lectura aquí también."""

from django.contrib import admin

from .models import (
    AliasAgendaDeca,
    CargadorDeca,
    LecturaCampoDeca,
    ModificacionDeca,
    PlantillaDocumentoDeca,
    ConductorDeca,
    ConfiguracionDeca,
    DestinatarioDeca,
    DocumentoOrigenDeca,
    EmpresaTransportistaDeca,
    EventoExpedicionDeca,
    ExpedicionDeca,
    RemolqueDeca,
    TractoraDeca,
    TransportistaSucesivoDeca,
)


@admin.register(ExpedicionDeca)
class ExpedicionDecaAdmin(admin.ModelAdmin):
    """Listado de expediciones con búsqueda por número y NIF. Token, hash y
    fechas de generación son de solo lectura: los pone el sistema al generar
    y alterarlos rompería la verificación pública del QR."""
    list_display = ('numero_albaran', 'estado', 'nombre_cargador', 'nombre_transportista', 'nombre_destinatario', 'fecha_alta')
    list_filter = ('estado',)
    search_fields = ('numero_albaran', 'numero_cmr', 'nif_cargador', 'nif_transportista', 'nif_destinatario')
    readonly_fields = ('token_publico', 'hash_sha256', 'fecha_generacion', 'fecha_expiracion_publica')


@admin.register(EventoExpedicionDeca)
class EventoExpedicionDecaAdmin(admin.ModelAdmin):
    """Historial de auditoría en modo solo lectura: es append-only por diseño
    (prueba ante una inspección o un litigio), así que ni se crea ni se
    edita ni se borra desde el admin."""
    list_display = ('expedicion', 'tipo_evento', 'usuario', 'fecha_alta')
    list_filter = ('tipo_evento',)
    readonly_fields = [f.name for f in EventoExpedicionDeca._meta.fields]

    def has_add_permission(self, request):
        # Append-only: nunca se crea a mano desde el admin.
        return False

    def has_change_permission(self, request, obj=None):
        return False


admin.site.register(ConfiguracionDeca)
admin.site.register(DocumentoOrigenDeca)
admin.site.register(TransportistaSucesivoDeca)
admin.site.register(ConductorDeca)
admin.site.register(TractoraDeca)
admin.site.register(RemolqueDeca)
admin.site.register(DestinatarioDeca)
admin.site.register(EmpresaTransportistaDeca)
admin.site.register(CargadorDeca)
admin.site.register(ModificacionDeca)
admin.site.register(PlantillaDocumentoDeca)
admin.site.register(LecturaCampoDeca)
admin.site.register(AliasAgendaDeca)
