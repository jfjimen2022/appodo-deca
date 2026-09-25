"""
Settings de Appodo DeCa -- extracción standalone (single-tenant) del módulo
DeCA del ERP Appodo. Una instalación = una empresa: no hay modelo Empresa,
no hay catálogo de módulos, no hay multi-tenant. Ver docs/ del repo para el
plan completo de la extracción.
"""
import os
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)
# .env es opcional (en producción normalmente se inyectan variables de
# entorno reales vía Docker/systemd) -- si no existe, seguimos con lo que
# ya haya en el entorno del proceso.
env_file = BASE_DIR / '.env'
if env_file.exists():
    environ.Env.read_env(str(env_file))

SECRET_KEY = env('SECRET_KEY', default='inseguro-cambia-esto-en-produccion')
DEBUG = env.bool('DEBUG', default=False)
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1'])

# Nombre de la empresa que usa esta instalación -- sustituye a
# `Empresa.nombre` del ERP multiempresa (aparece en el PDF del DeCA, en los
# informes exportados y en el email de envío). Ver deca/reportes.py,
# deca/services/pdf_service.py y deca/services/email_service.py.
EMPRESA_NOMBRE = env('EMPRESA_NOMBRE', default='')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'drf_spectacular',
    'deca',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# ── Base de datos ────────────────────────────────────────────────────────
# PostgreSQL vía variables DB_* explícitas (documentadas en .env.example) --
# se prefiere sobre una única DATABASE_URL para que quien autoaloja esto en
# Docker pueda pasar cada variable por separado sin construir una URL a mano.
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME', default='appodo_deca'),
        'USER': env('DB_USER', default='appodo_deca'),
        'PASSWORD': env('DB_PASSWORD', default=''),
        'HOST': env('DB_HOST', default='localhost'),
        'PORT': env('DB_PORT', default='5432'),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ── Internacionalización ─────────────────────────────────────────────────
LANGUAGE_CODE = env('LANGUAGE_CODE', default='es')
TIME_ZONE = env('TIME_ZONE', default='Europe/Madrid')
USE_I18N = True
USE_TZ = True

# ── Estáticos / media ────────────────────────────────────────────────────
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = env('MEDIA_URL', default='/media/')
MEDIA_ROOT = str(BASE_DIR / env('MEDIA_ROOT', default='media'))

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ── DRF + JWT ────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        # JWT en cookies HttpOnly (mismo mecanismo de seguridad que el ERP
        # origen) -- ver deca/authentication.py y deca/auth_views.py.
        'deca.authentication.JWTCookieAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_THROTTLE_RATES': {
        # Scope propio (nunca el genérico 'anon') para el endpoint público
        # de descarga por QR -- ver deca/views.py::DecaLecturaPublicaThrottle.
        'deca_publico': '30/min',
    },
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'Appodo DeCa API',
    'DESCRIPTION': 'API del Documento electrónico de Control Administrativo (DeCA).',
    'VERSION': '1.0.0',
}

from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# ── CORS ─────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=['http://localhost:5173'])
CORS_ALLOW_CREDENTIALS = True

# ── IA (extracción automática, opcional) ────────────────────────────────
# Ver deca/services/ai_client.py -- proveedor único (Gemini) vía REST,
# configurable únicamente por variable de entorno (sin cascada
# usuario→empresa→settings del ERP multiempresa, ver decisión de arquitectura).
GEMINI_API_KEY = env('GEMINI_API_KEY', default='')
GEMINI_MODEL = env('GEMINI_MODEL', default='gemini-2.5-flash')
IA_TIMEOUT_SEGUNDOS = env.float('IA_TIMEOUT_SEGUNDOS', default=30.0)

# ── Email saliente ───────────────────────────────────────────────────────
EMAIL_BACKEND = env('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = env('EMAIL_HOST', default='')
EMAIL_PORT = env.int('EMAIL_PORT', default=587)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', default=True)
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='no-reply@example.com')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
}
