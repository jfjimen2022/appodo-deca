"""Login/refresh/logout que devuelven el JWT en cookies HttpOnly en vez de
en el cuerpo JSON de la respuesta -- mismo patrón de seguridad que
`apps.usuarios.views.LoginView`/`CookieTokenRefreshView`/`LogoutView` del
ERP origen (mismos nombres de cookie, mismos flags), pero SIN el wrapper de
empresa (`emitir_token_con_empresa`, claim `empresa_id`, `Membresia`): aquí
por debajo es un `TokenObtainPairSerializer`/`RefreshToken` estándar de
simplejwt, sin tocar el payload del token.

Ver `deca/authentication.py::JWTCookieAuthentication` para el lado que LEE
estas cookies en cada request autenticado.
"""
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken


def _cookie_params(max_age: float) -> dict:
    """Mismos flags que el ERP origen: `httponly` siempre, `secure` fuera de
    DEBUG (en local por HTTP plano el navegador descartaría una cookie
    `Secure`), `samesite='Lax'` (permite navegación normal pero bloquea el
    envío en peticiones cross-site de terceros)."""
    return {
        'httponly': True,
        'secure': not settings.DEBUG,
        'samesite': 'Lax',
        'max_age': max_age,
    }


class CookieTokenObtainPairView(APIView):
    """POST /api/v1/auth/token/ -- login. Body: {username, password} (mismo
    body que el `TokenObtainPairView` estándar de simplejwt -- el campo lo
    decide `USER_ID_FIELD`/`USERNAME_FIELD` de `User`, aquí `username`).
    En vez de devolver access/refresh en el JSON, los setea como cookies
    HttpOnly `access_token`/`refresh_token`."""
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = TokenObtainPairSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        access = serializer.validated_data['access']
        refresh = serializer.validated_data['refresh']

        response = Response({'detail': 'Sesión iniciada correctamente.'})
        response.set_cookie(
            'access_token', str(access),
            **_cookie_params(settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds()),
        )
        response.set_cookie(
            'refresh_token', str(refresh),
            **_cookie_params(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()),
        )
        return response


class CookieTokenRefreshView(APIView):
    """POST /api/v1/auth/token/refresh/ -- lee el refresh token de la cookie
    (o del body, por si algún cliente no basado en navegador lo necesita) y
    renueva la cookie de access -- y la de refresh también si
    `ROTATE_REFRESH_TOKENS` está activo (lo está por defecto, ver settings)."""
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_token = request.data.get('refresh') or request.COOKIES.get('refresh_token')
        if not refresh_token:
            return Response({'detail': 'Refresh token no proporcionado.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            refresh = RefreshToken(refresh_token)
            new_access = str(refresh.access_token)
        except TokenError as e:
            return Response({'detail': str(e)}, status=status.HTTP_401_UNAUTHORIZED)

        response = Response({'detail': 'Token renovado.'})

        if settings.SIMPLE_JWT.get('ROTATE_REFRESH_TOKENS', False):
            if settings.SIMPLE_JWT.get('BLACKLIST_AFTER_ROTATION', False):
                try:
                    refresh.blacklist()
                except AttributeError:
                    # `rest_framework_simplejwt.token_blacklist` no instalada
                    # en esta instancia -- rotar igualmente sin invalidar el
                    # token anterior (ver .env.example/README si se quiere
                    # activar de verdad la blacklist).
                    pass
            User = get_user_model()
            user = User.objects.get(pk=refresh.payload['user_id'])
            new_refresh = RefreshToken.for_user(user)
            response.set_cookie(
                'refresh_token', str(new_refresh),
                **_cookie_params(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()),
            )

        response.set_cookie(
            'access_token', new_access,
            **_cookie_params(settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds()),
        )
        return response


class LogoutView(APIView):
    """POST /api/v1/auth/logout/ -- invalida el refresh token (si la
    blacklist está instalada) y borra ambas cookies. `AllowAny` a propósito
    (mismo motivo que el ERP: si el access token ya caducó, un usuario debe
    poder seguir "cerrando sesión" sin que eso mismo le dé 401)."""
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_token = request.data.get('refresh_token') or request.COOKIES.get('refresh_token')
        if refresh_token:
            try:
                RefreshToken(refresh_token).blacklist()
            except Exception:
                pass  # Token ya expirado/inválido, o blacklist no instalada -- cerrar sesión igual.

        response = Response({'detail': 'Sesión cerrada correctamente.'})
        response.delete_cookie('access_token')
        response.delete_cookie('refresh_token')
        return response
