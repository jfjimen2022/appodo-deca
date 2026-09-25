from django.contrib import admin

from .models import (
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
    list_display = ('numero_albaran', 'estado', 'nombre_cargador', 'nombre_transportista', 'nombre_destinatario', 'fecha_alta')
    list_filter = ('estado',)
    search_fields = ('numero_albaran', 'numero_cmr', 'nif_cargador', 'nif_transportista', 'nif_destinatario')
    readonly_fields = ('token_publico', 'hash_sha256', 'fecha_generacion', 'fecha_expiracion_publica')


@admin.register(EventoExpedicionDeca)
class EventoExpedicionDecaAdmin(admin.ModelAdmin):
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
