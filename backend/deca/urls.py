from django.urls import path

from . import views, views_usuarios

urlpatterns = [
    path('deca/configuracion/', views.ConfiguracionDecaView.as_view(), name='deca-configuracion'),
    # Agenda del módulo: los cinco catálogos, con CRUD completo.
    path('deca/conductores/', views.ConductorDecaListView.as_view(), name='deca-conductores'),
    path('deca/conductores/<uuid:pk>/', views.ConductorDecaDetailView.as_view(), name='deca-conductor-detalle'),
    path('deca/transportistas/', views.EmpresaTransportistaDecaListView.as_view(), name='deca-transportistas'),
    path(
        'deca/transportistas/<uuid:pk>/',
        views.EmpresaTransportistaDecaDetailView.as_view(),
        name='deca-transportista-detalle',
    ),
    path('deca/destinatarios/', views.DestinatarioDecaListView.as_view(), name='deca-destinatarios'),
    path(
        'deca/destinatarios/<uuid:pk>/',
        views.DestinatarioDecaDetailView.as_view(),
        name='deca-destinatario-detalle',
    ),
    path('deca/tractoras/', views.TractoraDecaListView.as_view(), name='deca-tractoras'),
    path('deca/tractoras/<uuid:pk>/', views.TractoraDecaDetailView.as_view(), name='deca-tractora-detalle'),
    path('deca/remolques/', views.RemolqueDecaListView.as_view(), name='deca-remolques'),
    path('deca/remolques/<uuid:pk>/', views.RemolqueDecaDetailView.as_view(), name='deca-remolque-detalle'),
    path('deca/expediciones/', views.ExpedicionDecaListCreateView.as_view(), name='deca-expediciones'),
    path('deca/expediciones/<uuid:pk>/', views.ExpedicionDecaDetailView.as_view(), name='deca-expedicion-detalle'),
    path(
        'deca/expediciones/exportar-pdf/',
        views.ExportarPDFExpedicionesDecaView.as_view(),
        name='deca-expediciones-exportar-pdf',
    ),
    path(
        'deca/expediciones/exportar-excel/',
        views.ExportarExcelExpedicionesDecaView.as_view(),
        name='deca-expediciones-exportar-excel',
    ),
    path(
        'deca/agenda/<str:tipo>/exportar-pdf/',
        views.ExportarPDFAgendaDecaView.as_view(),
        name='deca-agenda-exportar-pdf',
    ),
    path(
        'deca/agenda/<str:tipo>/exportar-excel/',
        views.ExportarExcelAgendaDecaView.as_view(),
        name='deca-agenda-exportar-excel',
    ),
    path(
        'deca/agenda/<str:tipo>/importar-csv/',
        views.ImportarAgendaDecaView.as_view(),
        name='deca-agenda-importar-csv',
    ),
    path(
        'deca/expediciones/<uuid:expedicion_id>/documentos/',
        views.DocumentoOrigenDecaUploadView.as_view(),
        name='deca-documentos-subir',
    ),
    path(
        'deca/documentos/<uuid:pk>/',
        views.DocumentoOrigenDecaDetailView.as_view(),
        name='deca-documento-detalle',
    ),
    path(
        'deca/documentos/<uuid:pk>/extraer/',
        views.ExtraerCamposDocumentoView.as_view(),
        name='deca-documento-extraer',
    ),
    path(
        'deca/expediciones/<uuid:expedicion_id>/confirmar/',
        views.ConfirmarExpedicionDecaView.as_view(),
        name='deca-expedicion-confirmar',
    ),
    path(
        'deca/expediciones/<uuid:expedicion_id>/vista-previa/',
        views.VistaPreviaExpedicionDecaView.as_view(),
        name='deca-expedicion-vista-previa',
    ),
    path(
        'deca/expediciones/<uuid:expedicion_id>/generar/',
        views.GenerarDecaView.as_view(),
        name='deca-expedicion-generar',
    ),
    path(
        'deca/expediciones/<uuid:expedicion_id>/anular/',
        views.AnularExpedicionDecaView.as_view(),
        name='deca-expedicion-anular',
    ),
    path(
        'deca/expediciones/<uuid:expedicion_id>/enviar-email/',
        views.EnviarEmailExpedicionDecaView.as_view(),
        name='deca-expedicion-enviar-email',
    ),
    path(
        'deca/expediciones/<uuid:expedicion_id>/transportistas-sucesivos/',
        views.TransportistaSucesivoListCreateView.as_view(),
        name='deca-transportistas-sucesivos',
    ),
    path(
        'deca/transportistas-sucesivos/<uuid:pk>/',
        views.TransportistaSucesivoDetailView.as_view(),
        name='deca-transportista-sucesivo-detalle',
    ),
    path(
        'deca/expediciones/<uuid:expedicion_id>/eventos/',
        views.EventoExpedicionDecaListView.as_view(),
        name='deca-eventos',
    ),
    path('deca/publico/<uuid:token>/', views.DecaDescargaPublicaView.as_view(), name='deca-descarga-publica'),

    # Gestión de usuarios (admin-only) -- decisión de arquitectura: sin
    # catálogo de módulos ni permisos granulares del ERP origen, solo
    # is_staff True/False.
    path('deca/usuarios/', views_usuarios.UsuarioListCreateView.as_view(), name='deca-usuarios'),
    path('deca/usuarios/<int:pk>/', views_usuarios.UsuarioDetailView.as_view(), name='deca-usuario-detalle'),
]
