"""Vista guardiana de /media/ (documentos origen subidos y PDF generados).

Django solo sirve /media/ por sí mismo con DEBUG=True; en producción hacía
falta algo que lo sirviera, y servirlo "tal cual" dejaría los albaranes y
CMR de la empresa al alcance de cualquiera que adivinara una ruta. Esta
vista los sirve SOLO a un usuario con sesión iniciada (la cookie HttpOnly
`access_token`, ver deca/authentication.py), y delega en
`django.views.static.serve`, que ya protege contra path traversal y pone
Content-Type y Last-Modified.

Es la versión single-tenant de la vista guardiana del ERP origen
(`core/views_media.py`): una instalación = una empresa, así que cualquier
usuario activo puede ver cualquier documento, igual que ve cualquier
expedición en la pantalla.

Lo público (lo que abre el QR) NO pasa por aquí: va por
/api/v1/deca/publico/<token>/ con su propia caducidad.

Se responde 404 (no 403) a todo lo denegado: un 403 confirmaría que el
fichero existe.
"""
from django.conf import settings
from django.http import Http404
from django.views.static import serve

from deca.authentication import JWTCookieAuthentication


def _usuario(request):
    """El usuario de la cookie/cabecera JWT, o None si no hay sesión válida."""
    try:
        resultado = JWTCookieAuthentication().authenticate(request)
    except Exception:
        return None
    if resultado is None:
        return None
    usuario = resultado[0]
    return usuario if usuario and usuario.is_active else None


def servir_media_protegido(request, path):
    """GET /media/<path>: el fichero si hay sesión iniciada; 404 si no."""
    if _usuario(request) is None:
        raise Http404()
    return serve(request, path, document_root=settings.MEDIA_ROOT)
