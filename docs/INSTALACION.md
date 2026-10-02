# Instalación — Appodo DeCa

## Requisitos

- Docker + Docker Compose v2 (`docker compose`, no el binario viejo
  `docker-compose`).
- Un dominio o IP accesible si lo vas a exponer fuera de tu red local
  (recomendado: un reverse proxy con TLS delante, ej. Caddy/Traefik/nginx —
  no incluido, el `docker-compose.yml` del repo expone el frontend en HTTP
  plano en `HTTP_PORT`).
- **HTTPS si vas a usar el DeCA sin cobertura en móviles.** Instalar la app
  en el móvil y trabajar sin red dependen de un *service worker*, y los
  navegadores solo lo permiten en páginas servidas por HTTPS (o en
  `localhost`). Por HTTP plano desde otra máquina la aplicación funciona,
  pero solo con conexión.
- Opcional: una API key de Gemini si quieres extracción automática de campos
  por IA cuando el regex no basta (sin ella, la extracción por regex sigue
  funcionando igual).
- Opcional: credenciales SMTP si quieres poder enviar el DeCA generado por
  email desde la propia app.

## Variables de entorno

Copia `.env.example` a `.env` en la raíz del repo y rellena:

| Variable | Obligatoria | Descripción |
|---|---|---|
| `SECRET_KEY` | Sí | Clave secreta de Django — genera una aleatoria larga, nunca uses el valor de ejemplo. |
| `DEBUG` | Sí | `False` en cualquier instalación real. |
| `ALLOWED_HOSTS` | Sí | Dominios/IPs desde los que se sirve, separados por coma. |
| `EMPRESA_NOMBRE` | Sí | Aparece en el PDF del DeCA, informes exportados y emails. |
| `EMPRESA_NIF` | No | NIF/CIF de tu empresa. Si tu papel habitual es transportista, se precarga en ese campo; al leer un documento se descarta como NIF de terceros; y activa el atajo «Lo contratamos nosotros» del cargador. |
| `EMPRESA_DOMICILIO` | No | Domicilio de tu empresa en una línea: domicilio del cargador con «Lo contratamos nosotros» (art. 6.a de la Orden FOM/2861/2012). |
| `TIME_ZONE` | No (default `Europe/Madrid`) | Zona horaria IANA de tu empresa. |
| `CORS_ALLOWED_ORIGINS` | Sí | Origen del frontend. Con el `docker-compose.yml` tal cual (nginx del frontend proxea `/api` al backend, mismo origen) no hace falta tocarlo salvo que sirvas frontend y backend en dominios distintos. |
| `DB_NAME`/`DB_USER`/`DB_PASSWORD` | Sí | Credenciales de PostgreSQL (el `docker-compose.yml` crea el contenedor `db` con ellas). |
| `GEMINI_API_KEY` | No | Sin ella no hay lectura por IA (la pantalla lo avisa al subir un documento); la lectura por patrones sigue funcionando. Si Gemini está saturado (503/429) se reintenta dos veces antes de rendirse. |
| `EMAIL_HOST` y demás `EMAIL_*` | No | Sin configurar, el botón "Enviar por email" devuelve un error legible en vez de fallar en silencio, y el aviso de DeCA sin completar no puede salir. |
| `HTTP_PORT` | No (default `8080`) | Puerto donde se publica la app. |
| `VITE_API_URL` | No | Déjalo vacío salvo que sirvas frontend/backend en dominios distintos (ver comentario en `.env.example`). |

## Primer arranque

```bash
cp .env.example .env
# edita .env
docker compose up -d --build
docker compose exec backend python manage.py createsuperuser
```

Entra en `http://localhost:${HTTP_PORT:-8080}`, inicia sesión con el
superusuario y crea desde Configuración → Usuarios a los operadores que
necesites (checkbox "Administrador" = `is_staff`, ve Configuración y gestión
de usuarios; sin marcar = solo Expediciones y Agenda).

## Tareas programadas (servicio `scheduler`)

El `docker-compose.yml` levanta un contenedor `scheduler` (la misma imagen
del backend) que cada hora ejecuta:

- `avisar_deca_sin_completar`: email a los administradores (usuarios con
  `is_staff` y email) de los DeCA hechos sin cobertura que llegaron al
  servidor sin poder generarse y siguen así pasados los días configurados.
  Se activa/desactiva en Configuración → Trabajo en campo.
- `purgar_ips_eventos_deca`: borra las IP de las descargas públicas más
  antiguas que la retención configurada.

Los dos son idempotentes (avisan/purgan una sola vez cada cosa). Si no usas
Docker, prográmalos con cron:

```cron
0 * * * * cd /ruta/backend && venv/bin/python manage.py avisar_deca_sin_completar
30 3 * * * cd /ruta/backend && venv/bin/python manage.py purgar_ips_eventos_deca
```

## Backups

Todo el estado que importa vive en dos volúmenes Docker:
- `deca_db_data` — la base de datos PostgreSQL (expedientes, agenda, usuarios).
- `deca_media` — PDFs generados y documentos origen subidos.

```bash
# Backup de la base de datos
docker compose exec db pg_dump -U appodo_deca appodo_deca > backup_$(date +%F).sql

# Backup de media (documentos y PDFs)
docker run --rm -v appododeca_deca_media:/data -v "$(pwd)":/backup alpine \
  tar czf /backup/media_$(date +%F).tar.gz -C /data .
```

(Ajusta el nombre del volumen `appododeca_deca_media` al prefijo real que
Docker Compose le dé en tu instalación — compruébalo con
`docker volume ls`.)

## Actualizar a una versión nueva

```bash
git pull
docker compose up -d --build
# las migraciones de base de datos se aplican solas al arrancar el backend
# (ver backend/entrypoint.sh)
```

Al pasar de `v01` a `v02` las migraciones añaden los modelos nuevos
(cargadores, correcciones de DeCA generados, aprendizaje de la lectura,
modelos de documento) y rellenan el catálogo de Cargadores con los que ya
había en las expediciones existentes. No hace falta hacer nada a mano; haz
un backup antes, como en cualquier actualización.

## Desarrollo local sin Docker

Ver la sección "Desarrollo local" del [`README.md`](../README.md) principal.
