# Guía de instalación — Appodo DeCa

Para quien va a montar Appodo DeCa en un servidor propio de la empresa (o en
un VPS alquilado). Hace falta saber moverse por una terminal Linux; no hace
falta saber programar.

Al terminar tendrás la aplicación funcionando en
`https://deca.tu-empresa.es`, con copias de seguridad y las tareas
automáticas en marcha. Lo que se configura **dentro** de la aplicación
(usuarios, datos de la empresa, móviles…) está en
[`CONFIGURACION.md`](CONFIGURACION.md).

## Índice

1. [Qué se instala](#1-qué-se-instala)
2. [Requisitos](#2-requisitos)
3. [Preparar el servidor](#3-preparar-el-servidor)
4. [Descargar y configurar (`.env`)](#4-descargar-y-configurar-env)
5. [Primer arranque](#5-primer-arranque)
6. [HTTPS con dominio propio](#6-https-con-dominio-propio)
7. [Email saliente (SMTP)](#7-email-saliente-smtp)
8. [Lectura automática con IA (Gemini)](#8-lectura-automática-con-ia-gemini)
9. [Tareas programadas](#9-tareas-programadas)
10. [Copias de seguridad y restauración](#10-copias-de-seguridad-y-restauración)
11. [Actualizar a una versión nueva](#11-actualizar-a-una-versión-nueva)
12. [Registros (logs) y problemas frecuentes](#12-registros-logs-y-problemas-frecuentes)
13. [Lista de comprobación de seguridad](#13-lista-de-comprobación-de-seguridad)

---

## 1. Qué se instala

Todo va en contenedores Docker, definidos en `docker-compose.yml`:

| Servicio | Qué es | Expone |
|---|---|---|
| `frontend` | nginx con la aplicación web (React) ya compilada. Reenvía `/api/`, `/media/` y `/static/` al backend. | El puerto `HTTP_PORT` (8080 por defecto), en HTTP. |
| `backend` | API Django + gunicorn (3 procesos). Aplica solo las migraciones al arrancar. | Nada hacia fuera (solo la red interna de Docker). |
| `scheduler` | La misma imagen que el backend: cada hora manda los avisos y purga datos antiguos (ver [§9](#9-tareas-programadas)). | Nada. |
| `db` | PostgreSQL 16. | Nada. |

Los datos viven en dos volúmenes de Docker: `deca_db_data` (la base de
datos) y `deca_media` (documentos subidos y PDF generados). Son lo único que
hay que copiar en un backup.

```
Internet ──HTTPS──► proxy (Caddy / nginx / Traefik, lo pones tú)
                      │  HTTP, solo en la propia máquina
                      ▼
               frontend :8080 ──► backend :8000 ──► db (PostgreSQL)
                                      │
                                      ├─► Gemini (opcional, salida HTTPS)
                                      └─► servidor SMTP (opcional)
```

## 2. Requisitos

**Servidor**

| | Mínimo | Recomendado |
|---|---|---|
| Sistema | Cualquier Linux con Docker | Ubuntu Server 24.04 LTS o Debian 12 |
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Disco | 20 GB | 40 GB o más (ver abajo) |

El disco crece con los documentos: cada DeCA guarda su PDF (unos 100 KB) y
los documentos que se suban (hasta 10 MB cada uno; una foto de móvil suele
ocupar 1–3 MB). La norma obliga a conservar el registro **un año** (art. 9 de
la Orden FOM/2861/2012), así que calcula el espacio de un año de trabajo.

También funciona en Windows o macOS con Docker Desktop (útil para probar),
pero para trabajar a diario usa un servidor Linux.

**Red**

- Un **dominio o subdominio** (p. ej. `deca.tu-empresa.es`) que apunte a la IP
  del servidor, y los puertos **80 y 443** abiertos hacia él, para el
  certificado HTTPS.
- **HTTPS es obligatorio en la práctica**, por dos motivos:
  - La sesión viaja en cookies seguras: con `DEBUG=False` el navegador **no
    deja iniciar sesión** por HTTP plano, salvo entrando desde el propio
    servidor por `http://localhost`.
  - Instalar la app en el móvil y trabajar **sin cobertura** solo funciona en
    páginas HTTPS.
- Salida a Internet desde el servidor: `generativelanguage.googleapis.com:443`
  si usas la IA, y tu servidor SMTP si mandas emails.

**Cuentas externas (opcionales)**

- Una clave de API de **Google Gemini**, para que la aplicación lea sola los
  albaranes y CMR ([§8](#8-lectura-automática-con-ia-gemini)). Sin ella, la
  lectura por patrones (NIF, matrículas, pesos, fechas) sigue funcionando.
- Una cuenta **SMTP** para enviar el DeCA por email y los avisos
  ([§7](#7-email-saliente-smtp)).

## 3. Preparar el servidor

En un Ubuntu/Debian recién instalado, como un usuario con `sudo`:

```bash
# Actualizar el sistema
sudo apt update && sudo apt upgrade -y

# Docker y el plugin "docker compose" (script oficial de Docker)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # cierra la sesión y vuelve a entrar

# Comprobar
docker --version
docker compose version             # debe responder "Docker Compose version v2..."

# Cortafuegos: solo SSH, HTTP y HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> Usa `docker compose` (con espacio, v2). El antiguo `docker-compose` (con
> guion) no está soportado.

> **Docker y ufw**: Docker publica sus puertos saltándose ufw. Por eso en el
> `.env` de producción el puerto de la aplicación se publica solo en
> `127.0.0.1` ([§4](#4-descargar-y-configurar-env)): así no queda accesible
> desde fuera sin pasar por el HTTPS.

## 4. Descargar y configurar (`.env`)

```bash
cd /opt
sudo git clone https://github.com/jfjimen2022/appodo-deca.git
sudo chown -R $USER:$USER appodo-deca
cd appodo-deca
cp .env.example .env
chmod 600 .env          # contiene contraseñas: solo lo lee su dueño
nano .env
```

Genera la clave secreta y la contraseña de la base de datos con:

```bash
openssl rand -base64 48 | tr -d '\n=+/' ; echo     # SECRET_KEY
openssl rand -base64 24 | tr -d '\n=+/' ; echo     # DB_PASSWORD
```

### Variables

| Variable | ¿Obligatoria? | Qué poner |
|---|---|---|
| `SECRET_KEY` | **Sí** | Una cadena aleatoria larga (comando de arriba). Si cambia, se cierran todas las sesiones. Nunca dejes la del ejemplo. |
| `DEBUG` | **Sí** | `False`. `True` solo en un equipo de desarrollo: muestra errores internos y relaja la seguridad. |
| `ALLOWED_HOSTS` | **Sí** | El dominio por el que se entra, sin `https://`: `deca.tu-empresa.es`. Separados por comas si hay varios. Añade `localhost` si vas a entrar también desde el propio servidor. |
| `CORS_ALLOWED_ORIGINS` | **Sí** | La dirección completa: `https://deca.tu-empresa.es`. |
| `EMPRESA_NOMBRE` | **Sí** | Razón social. Sale en el PDF del DeCA, en los informes y en los emails. |
| `EMPRESA_NIF` | Recomendada | NIF/CIF de la empresa. Se precarga cuando sois el transportista, permite el atajo «Lo contratamos nosotros» del cargador y evita que la lectura confunda vuestro NIF con el de un tercero. |
| `EMPRESA_DOMICILIO` | Recomendada | Domicilio en una línea (`Calle Mayor 1, 04001 Almería`). Es el domicilio del cargador cuando el transporte lo contratáis vosotros (art. 6.a). |
| `TIME_ZONE` | No | Zona horaria (`Europe/Madrid` por defecto; `Atlantic/Canary` en Canarias). Es la hora que sale en el DeCA y la que se usa para las fechas que manda el ERP. |
| `LANGUAGE_CODE` | No | `es`. |
| `DB_NAME`, `DB_USER` | No | Se pueden dejar como están (`appodo_deca`). |
| `DB_PASSWORD` | **Sí** | Contraseña de PostgreSQL (comando de arriba). Se fija la **primera vez** que arranca la base de datos: cambiarla después en el `.env` no cambia la de la base de datos. |
| `GEMINI_API_KEY` | No | Clave de Gemini ([§8](#8-lectura-automática-con-ia-gemini)). Vacía = sin lectura por IA. |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` por defecto. |
| `IA_TIMEOUT_SEGUNDOS` | No | Cuánto se espera a la IA (30 por defecto). |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL` | No | Servidor de correo ([§7](#7-email-saliente-smtp)). Sin ellas no se pueden enviar emails (la aplicación lo dice con un error claro). |
| `HTTP_PORT` | No | Dónde se publica la aplicación. En producción, **`127.0.0.1:8080`**: solo el proxy HTTPS de la misma máquina llega a ella. Para una prueba rápida en tu PC, `8080`. |
| `VITE_API_URL` | No | Déjala **vacía**. Solo hace falta si sirves la web y la API en dominios distintos. |

Ejemplo de `.env` de producción:

```dotenv
SECRET_KEY=pon-aqui-la-cadena-generada
DEBUG=False
ALLOWED_HOSTS=deca.tu-empresa.es,localhost
CORS_ALLOWED_ORIGINS=https://deca.tu-empresa.es
EMPRESA_NOMBRE=Transportes Ejemplo S.L.
EMPRESA_NIF=B12345674
EMPRESA_DOMICILIO=Calle Mayor 1, 04001 Almería
TIME_ZONE=Europe/Madrid
LANGUAGE_CODE=es

DB_NAME=appodo_deca
DB_USER=appodo_deca
DB_PASSWORD=pon-aqui-la-contraseña-generada

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
IA_TIMEOUT_SEGUNDOS=30

EMAIL_HOST=smtp.tu-proveedor.es
EMAIL_PORT=587
EMAIL_HOST_USER=deca@tu-empresa.es
EMAIL_HOST_PASSWORD=contraseña-o-contraseña-de-aplicación
EMAIL_USE_TLS=True
DEFAULT_FROM_EMAIL=Transportes Ejemplo <deca@tu-empresa.es>

HTTP_PORT=127.0.0.1:8080
VITE_API_URL=
```

## 5. Primer arranque

```bash
docker compose up -d --build        # la primera vez tarda unos minutos
docker compose ps                   # los 4 servicios deben estar "running"/"Up"

# El primer administrador (pide usuario, email y contraseña)
docker compose exec backend python manage.py createsuperuser
```

Comprueba que responde desde el propio servidor:

```bash
curl -I http://127.0.0.1:8080/      # debe dar HTTP/1.1 200 OK
```

Todavía no se puede entrar desde fuera: falta el HTTPS (siguiente apartado).

> **Solo para probar en tu PC** (sin dominio): con `HTTP_PORT=8080`,
> `ALLOWED_HOSTS=localhost,127.0.0.1` y
> `CORS_ALLOWED_ORIGINS=http://localhost:8080`, entra en
> `http://localhost:8080`. Desde otro equipo de la red por
> `http://IP:8080` la página carga pero **no deja iniciar sesión** (cookies
> seguras): para eso hace falta HTTPS.

## 6. HTTPS con dominio propio

Primero crea en tu proveedor de DNS un registro **A** de
`deca.tu-empresa.es` hacia la IP pública del servidor, y espera a que
resuelva (`ping deca.tu-empresa.es`).

### Opción A · Caddy (la más sencilla, recomendada)

Caddy pide y renueva solo el certificado de Let's Encrypt.

```bash
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
deca.tu-empresa.es {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

Ya está: entra en `https://deca.tu-empresa.es`. Caddy pasa por sí mismo las
cabeceras `Host` y `X-Forwarded-Proto`, que la aplicación necesita.

### Opción B · nginx + certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/deca
```

```nginx
server {
    listen 80;
    server_name deca.tu-empresa.es;

    # Fotos y PDF de hasta 10 MB (más margen)
    client_max_body_size 15m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;     # la lectura con IA puede tardar
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/deca /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d deca.tu-empresa.es     # pide el certificado y activa HTTPS
```

### Si usas otro proxy (Traefik, un balanceador, Cloudflare…)

Tiene que cumplir tres cosas:

1. Pasar la cabecera **`Host`** original (el dominio).
2. Mandar **`X-Forwarded-Proto: https`**. Con ella, la dirección que va dentro
   del QR del DeCA sale con `https://`; sin ella saldría con `http://`.
3. Aceptar cuerpos de petición de al menos **15 MB** y esperar al menos
   **120 s** de respuesta (la lectura de un documento con IA).

### Comprobación

Entra en `https://deca.tu-empresa.es`, inicia sesión con el administrador,
crea un DeCA de prueba y genéralo: el enlace público de la ficha (el del QR)
debe empezar por `https://deca.tu-empresa.es/`. Ábrelo en una ventana de
incógnito: debe descargar el PDF sin pedir usuario. Después, anula ese DeCA de
prueba.

## 7. Email saliente (SMTP)

Se usa para dos cosas: el botón **Enviar por email** de cada DeCA y los
avisos automáticos a los administradores ([§9](#9-tareas-programadas)).

| Proveedor | `EMAIL_HOST` | `EMAIL_PORT` | `EMAIL_USE_TLS` | Notas |
|---|---|---|---|---|
| Microsoft 365 | `smtp.office365.com` | 587 | `True` | El buzón debe tener activado «SMTP autenticado». |
| Google Workspace / Gmail | `smtp.gmail.com` | 587 | `True` | Con verificación en dos pasos, usa una **contraseña de aplicación**. |
| Tu hosting | El que te indique | 587 | `True` | Si solo da el 465 (SSL), pregunta a tu proveedor por el 587. |

`DEFAULT_FROM_EMAIL` debe ser un remitente que tu servidor SMTP te deje usar
(normalmente el mismo buzón de `EMAIL_HOST_USER`); si no, los correos
acabarán en spam o serán rechazados.

Tras cambiar el `.env`: `docker compose up -d` y prueba a enviar un DeCA a
tu propio correo.

## 8. Lectura automática con IA (Gemini)

Sin IA, la aplicación ya lee de un PDF con texto los NIF, matrículas, pesos y
fechas. Con IA, además rellena el resto (nombres, origen, destino,
mercancía…) y lee **fotos y escaneos**.

1. Entra en [Google AI Studio](https://aistudio.google.com/) con una cuenta
   de Google de la empresa y crea una **API key**.
2. Ponla en `GEMINI_API_KEY` del `.env` y aplica con `docker compose up -d`.
3. Sube un albarán de prueba: deben aparecer los campos «completados por IA».

**Protección de datos.** Con la IA activada, el contenido de los documentos
que se suben (albaranes, CMR: nombres, NIF y matrículas de terceros) se envía
a Google para leerlo. Valora con tu responsable de protección de datos si
hace falta mencionarlo en vuestro registro de actividades o en los contratos
con clientes, y usa una cuenta de pago si no quieres que Google pueda usar
esos datos para mejorar sus modelos (consulta sus condiciones vigentes). Sin
`GEMINI_API_KEY`, no sale nada del servidor.

Si Gemini está saturado, la aplicación reintenta dos veces y, si sigue sin
responder, avisa y se puede rellenar a mano o reintentar con **Extraer
datos**.

## 9. Tareas programadas

El servicio `scheduler` ejecuta cada hora, sin que tengas que hacer nada:

| Tarea | Qué hace |
|---|---|
| `avisar_deca_sin_completar` | Email a los administradores (usuarios marcados como Administrador y con email) cuando un DeCA hecho sin cobertura llegó al servidor sin poder generarse y sigue así pasados los días configurados. Se activa o desactiva en Configuración → Sin cobertura. Necesita el SMTP. |
| `purgar_ips_eventos_deca` | Borra la IP de quien descargó un DeCA por el QR cuando supera la retención configurada (protección de datos). |

Las dos son seguras de repetir: cada cosa se avisa o se purga una sola vez.
Para ver que funcionan: `docker compose logs --tail 50 scheduler`.

## 10. Copias de seguridad y restauración

Lo que hay que guardar: la **base de datos**, la carpeta de **documentos y
PDF** y el fichero **`.env`** (sin él no se descifran las sesiones ni se
conecta a la base de datos).

Script de ejemplo, `/opt/appodo-deca/backup.sh`:

```bash
#!/bin/sh
set -e
cd /opt/appodo-deca
DESTINO=/var/backups/appodo-deca
FECHA=$(date +%F)
mkdir -p "$DESTINO"

# Base de datos
docker compose exec -T db pg_dump -U appodo_deca -Fc appodo_deca > "$DESTINO/db_$FECHA.dump"

# Documentos y PDF (el volumen se llama <carpeta>_deca_media; compruébalo con "docker volume ls")
docker run --rm -v appodo-deca_deca_media:/data:ro -v "$DESTINO":/backup alpine \
  tar czf "/backup/media_$FECHA.tar.gz" -C /data .

cp .env "$DESTINO/env_$FECHA"

# Conservar 30 días
find "$DESTINO" -type f -mtime +30 -delete
```

```bash
chmod +x /opt/appodo-deca/backup.sh
sudo crontab -e
# Todos los días a las 2:30
30 2 * * * /opt/appodo-deca/backup.sh >> /var/log/appodo-deca-backup.log 2>&1
```

**Saca una copia fuera del servidor** (otro equipo, un NAS, almacenamiento en
la nube): un backup en el mismo disco no sirve si el disco se rompe. Y
recuerda que hay que poder enseñar los DeCA de, al menos, el último año.

**Restaurar** (en un servidor nuevo con la aplicación ya instalada y el
`.env` copiado):

```bash
cd /opt/appodo-deca
docker compose up -d db
docker compose exec -T db pg_restore -U appodo_deca -d appodo_deca --clean --if-exists < db_AAAA-MM-DD.dump
docker run --rm -v appodo-deca_deca_media:/data -v "$PWD":/backup alpine \
  sh -c "cd /data && tar xzf /backup/media_AAAA-MM-DD.tar.gz"
docker compose up -d
```

Prueba a restaurar una vez antes de necesitarlo de verdad.

## 11. Actualizar a una versión nueva

Lee antes el [`CHANGELOG.md`](../CHANGELOG.md) de la versión nueva: dice si
hay que hacer algo a mano (casi nunca).

```bash
cd /opt/appodo-deca
./backup.sh                          # siempre un backup antes
git pull
docker compose up -d --build         # las migraciones se aplican solas al arrancar
docker compose logs --tail 50 backend
```

Para volver a la versión anterior: `git checkout <versión-anterior>`,
`docker compose up -d --build` y, si la versión nueva cambió la base de
datos, restaurar el backup.

Notas de versiones concretas:

- **v01 → v02**: las migraciones añaden cargadores, correcciones de DeCA
  generados, aprendizaje de la lectura y modelos de documento, y rellenan el
  catálogo de Cargadores con los de las expediciones existentes.
- **v02 → v03**: la migración `0004` añade las claves de integración con el
  ERP, los envíos del ERP descartados, el peso bruto y los campos de
  integración. Además, `/media/` se sirve solo con sesión iniciada y la
  dirección del QR respeta `X-Forwarded-Proto` (revisa tu proxy, [§6](#6-https-con-dominio-propio)).

## 12. Registros (logs) y problemas frecuentes

```bash
docker compose ps                         # estado de los servicios
docker compose logs -f backend            # errores de la aplicación
docker compose logs -f frontend           # peticiones web (nginx)
docker compose logs --tail 100 scheduler  # tareas programadas
docker compose restart backend            # reiniciar solo la API
```

| Síntoma | Causa probable | Solución |
|---|---|---|
| La página carga pero **no deja iniciar sesión** (vuelve al login sin error) | Se entra por HTTP desde otro equipo: el navegador descarta las cookies seguras. | Entra por `https://`. Para probar sin dominio, desde el propio servidor por `http://localhost:8080`. |
| **Bad Request (400)** | El dominio no está en `ALLOWED_HOSTS`. | Añádelo y `docker compose up -d`. |
| El **QR lleva `http://`** en vez de `https://` | El proxy no manda `X-Forwarded-Proto: https`. | Ver [§6](#6-https-con-dominio-propio). Los DeCA ya generados no cambian; los nuevos sí. |
| **413** al subir una foto | El proxy limita el tamaño (nginx: 1 MB por defecto). | `client_max_body_size 15m;` en tu proxy. |
| **502/504** al leer un documento | El proxy corta antes de que responda la IA. | Sube el tiempo de espera del proxy a 120 s. |
| `backend` se reinicia sin parar | No conecta a la base de datos (contraseña) o error en el `.env`. | `docker compose logs backend`. Si cambiaste `DB_PASSWORD` después del primer arranque, vuelve a la original. |
| No se puede **instalar la app en el móvil** | No es HTTPS. | Ver [§6](#6-https-con-dominio-propio). |
| «El servicio de IA no está disponible» | Falta `GEMINI_API_KEY`, la clave no vale o Gemini está saturado. | Revisa la clave; si está saturado, reintenta en unos minutos. |
| No llegan los emails | SMTP mal configurado o remitente no permitido. | `docker compose logs backend` al enviar; revisa [§7](#7-email-saliente-smtp). |
| Se ha llenado el disco | Documentos, imágenes viejas de Docker o backups locales. | `df -h`, `docker system prune` (borra imágenes sin usar, no los volúmenes) y revisa la retención de backups. |

**Olvidé la contraseña del administrador:**

```bash
docker compose exec backend python manage.py changepassword NOMBRE_DE_USUARIO
```

## 13. Lista de comprobación de seguridad

- [ ] `DEBUG=False` y un `SECRET_KEY` propio, largo y aleatorio.
- [ ] `DB_PASSWORD` fuerte; `.env` con permisos `600` y fuera de cualquier
      repositorio.
- [ ] HTTPS activo y `HTTP_PORT=127.0.0.1:8080` (la aplicación no se ve sin
      pasar por el HTTPS).
- [ ] Cortafuegos con solo 22, 80 y 443 abiertos; acceso SSH con clave, no
      con contraseña.
- [ ] Backups diarios, con copia fuera del servidor y una restauración
      probada.
- [ ] Actualizaciones de seguridad del sistema (`unattended-upgrades` en
      Ubuntu/Debian) y de Appodo DeCa ([§11](#11-actualizar-a-una-versión-nueva)).
- [ ] Usuarios con nombre propio (nada de cuentas compartidas) y solo los
      administradores imprescindibles.
- [ ] Si conectas el ERP, una clave por servidor, guardada fuera de chats y
      correos ([`INTEGRACION_ERP.md`](INTEGRACION_ERP.md)).
- [ ] Decidido y documentado si se usa la IA de Google con documentos de
      terceros ([§8](#8-lectura-automática-con-ia-gemini)).

Los documentos subidos y los PDF (`/media/`) solo se sirven a usuarios con
sesión iniciada. Lo único público es el enlace de cada DeCA (el del QR), con
un identificador imposible de adivinar, que caduca a los días configurados y
con un límite de 30 descargas por minuto. El panel de administración de
Django (`/admin/`) no se publica a través del nginx de la aplicación.

---

Desarrollo local sin Docker: ver la sección «Desarrollo local» del
[`README.md`](../README.md).
