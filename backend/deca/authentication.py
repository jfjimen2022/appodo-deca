"""Autenticación JWT vía cookie HttpOnly -- mismo mecanismo de seguridad que
el ERP origen (`apps.usuarios.jwt.JWTWithEmpresaAuthentication`), sin el
wrapper de empresa: aquí no hay multi-tenant, así que no hay claim
`empresa_id` que resolver ni `Membresia` que parchear en memoria.

El JWT viaja en dos cookies HttpOnly (`access_token`/`refresh_token`, ver
`deca/auth_views.py`) en vez de en el header `Authorization` o en el cuerpo
JSON de la respuesta de login -- evita que un XSS en el frontend pueda robar
el token leyendo `document.cookie`/`localStorage` (HttpOnly no es legible
desde JS). DRF ya exime a las `APIView`/`generics` de la comprobación CSRF de
Django (`APIView.as_view()` las envuelve en `csrf_exempt`), así que esto no
necesita nada adicional de CSRF para las vistas de la API.
"""
from rest_framework_simplejwt.authentication import JWTAuthentication


class JWTCookieAuthentication(JWTAuthentication):
    """Igual que `JWTAuthentication` estándar de simplejwt (sigue aceptando
    `Authorization: Bearer <token>` si algún cliente no-navegador lo manda),
    pero si no hay cabecera cae a leer el JWT de la cookie `access_token` --
    el caso normal en este proyecto, donde el frontend nunca toca el token
    desde JavaScript."""

    def authenticate(self, request):
        header = self.get_header(request)
        if header is not None:
            return super().authenticate(request)

        raw_token = request.COOKIES.get('access_token')
        if raw_token is None:
            return None

        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token
