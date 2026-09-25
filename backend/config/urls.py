from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from deca.auth_views import CookieTokenObtainPairView, CookieTokenRefreshView, LogoutView


class MeView(APIView):
    """El frontend necesita saber quién es el usuario autenticado y si es
    admin (`is_staff`, ver decisión de arquitectura: solo dos roles) para
    decidir si mostrar Configuración/gestión de usuarios. No lee el token de
    ningún sitio explícitamente -- `request.user` ya lo resuelve
    `JWTCookieAuthentication` a partir de la cookie `access_token`."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        u = request.user
        return Response({
            'id': u.id,
            'username': u.username,
            'email': u.email,
            'is_staff': u.is_staff,
        })


urlpatterns = [
    path('admin/', admin.site.urls),
    # JWT en cookies HttpOnly (no en el JSON de respuesta) -- ver
    # deca/auth_views.py y deca/authentication.py.
    path('api/v1/auth/token/', CookieTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/v1/auth/token/refresh/', CookieTokenRefreshView.as_view(), name='token_refresh'),
    path('api/v1/auth/logout/', LogoutView.as_view(), name='auth-logout'),
    path('api/v1/auth/me/', MeView.as_view(), name='auth-me'),
    path('api/v1/', include('deca.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
