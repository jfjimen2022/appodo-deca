# Registro de cambios — Appodo DeCa

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
La numeración es propia del standalone (`v01`, `v02`...), independiente del
SemVer del ERP Appodo — cada entrada que proviene de un resync de código
anota además la versión y fecha de Appodo de origen (ver
`docs/PLAN_EXTRACCION.md`, sección "Nombre y versión").

## [v01] — 2026-09-25

Primer release: extracción completa del módulo DeCA del ERP Appodo como
aplicación standalone, autoalojable y de código abierto (AGPL-3.0).

_Sincronizado desde Appodo ERP v4.19.1 (2026-09-25)._

### Añadido

- **Backend** (Django 4.2 + DRF): gestión de expediciones DeCA con ciclo de
  vida completo (borrador → confirmado → generado → anulado), extracción
  automática de campos desde el documento origen (regex + IA de texto/visión
  opcional vía Gemini), generación de PDF oficial con QR de verificación
  pública, envío por email, exportación de listados a PDF/Excel con cabecera
  de documento controlado opcional, agenda de conductores/tractoras/
  remolques/destinatarios/empresas transportistas con importación CSV
  masiva, auditoría append-only de eventos (con purga configurable de IPs
  por antigüedad), y gestión de usuarios (admin/operador).
- **Autenticación**: JWT en cookies HttpOnly (mismo criterio de seguridad
  que el ERP Appodo, sin robo de token vía XSS), sin multi-tenant — cada
  instalación sirve a una sola empresa.
- **Frontend** (React + Vite + Tailwind + shadcn/ui): las 5 pantallas del
  módulo (Expediciones, Formulario, Detalle, Agenda, Configuración) con un
  shell propio mínimo (login, layout, rutas protegidas por rol).
- **Despliegue**: `docker-compose.yml` con Postgres + backend (gunicorn) +
  frontend (nginx, proxy de `/api` al backend), migraciones automáticas al
  arrancar, verificado end-to-end (build de ambas imágenes, arranque del
  stack completo, login real a través del proxy).
- Documentación: [`docs/INSTALACION.md`](docs/INSTALACION.md) (requisitos,
  variables de entorno, backups, actualización) y
  [`docs/MANUAL_USO.md`](docs/MANUAL_USO.md) (manual de usuario final).
- Licencia AGPL-3.0.

### Conocido / pendiente

- Integración con Google Drive del ERP **retirada** (dependía de
  credenciales de empresa que no existen en el standalone) — marcado con
  `TODO(standalone):` en el código donde aplicaba.
- Cliente de IA simplificado a un único proveedor (Gemini) configurable por
  variable de entorno, sin la cascada de clave por usuario/empresa del ERP.
- Interfaz verificada por build y por llamadas API reales (`curl`), pero
  pendiente de una pasada de verificación visual en navegador.
