# Appodo DeCa

[![Licencia: AGPL v3](https://img.shields.io/badge/Licencia-AGPL%20v3-blue.svg)](LICENSE)
[![Versión](https://img.shields.io/badge/versión-v01-informational)](CHANGELOG.md)
[![Stack](https://img.shields.io/badge/stack-Django%20%2B%20React-informational)](#stack)

**Appodo DeCa** es una app gratuita, autoalojable (self-hosted) y de código
abierto para gestionar el **Documento de Control de Ruta (DeCA)** exigido en
el transporte de mercancías por carretera en España: expediciones, agenda de
conductores/vehículos/clientes, extracción automática de campos desde el
albarán/CMR de origen (con IA opcional) y generación del PDF oficial con QR
de verificación pública.

Es una extracción del módulo DeCA del [ERP Appodo](https://appodo.dev),
**single-tenant** (una instalación = una empresa, sin multi-tenant ni
permisos por rol complejos) — si necesitas más (control horario, facturación,
CRM, gestión multiempresa...), esa es la versión de pago.

> 🤝 **¿No quieres complicarte la vida instalándolo tú?** Te lo instalamos y
> mantenemos nosotros en tu propio servidor (o en el nuestro) — actualizaciones,
> copias de seguridad y soporte incluidos, con el ahorro de una instalación
> propia frente a una suscripción por usuario o por documento. Más info en
> [appodo.dev/appodo-deca](https://appodo.dev/appodo-deca) o escribe
> directamente a **juanf.jipa@gmail.com**.

## Funcionalidades

- Ciclo de vida completo de una expedición: borrador → confirmado →
  generado → anulado, con validación de los campos legales mínimos.
- Extracción automática de campos desde el albarán/CMR de origen (foto o
  PDF) por reconocimiento de texto, con IA opcional (Gemini) cuando el
  documento viene escaneado o el regex no llega.
- Generación del PDF oficial con código QR y **verificación pública sin
  login** (con caducidad configurable y registro de auditoría de cada
  acceso).
- Agenda de conductores, tractoras, remolques, destinatarios y empresas
  transportistas, con importación masiva por CSV.
- Exportación de listados a PDF/Excel, con cabecera de documento controlado
  opcional (código, versión, edición, preparado por, autorizado por).
- Envío del DeCA por email, historial de auditoría append-only, roles
  admin/operador.

Manual de uso completo: [`docs/MANUAL_USO.md`](docs/MANUAL_USO.md).

## Capturas

| | |
|---|---|
| ![Login](docs/capturas/01_login.png) | ![Listado de expediciones](docs/capturas/02_expediciones.png) |
| ![Formulario de expedición](docs/capturas/03_formulario.png) | ![Detalle con QR de verificación pública](docs/capturas/04_detalle_qr.png) |
| ![Agenda](docs/capturas/05_agenda.png) | ![Configuración](docs/capturas/06_configuracion.png) |

## Stack

- **Backend:** Django 4.2 + Django REST Framework, PostgreSQL, JWT en
  cookies HttpOnly (`djangorestframework-simplejwt`).
- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui.
- Roles: `is_staff` (admin, ve Configuración y gestión de usuarios) / usuario
  normal (operador, solo gestiona expediciones y agenda).

## Descarga e instalación rápida (Docker)

```bash
git clone https://github.com/jfjimen2022/appodo-deca.git
cd appodo-deca
cp .env.example .env
# edita .env: al menos SECRET_KEY, DB_PASSWORD, EMPRESA_NOMBRE
docker compose up -d
docker compose exec backend python manage.py createsuperuser
```

La app queda en `http://localhost:8080` (puerto configurable con
`HTTP_PORT` en `.env`).

Ver [`docs/INSTALACION.md`](docs/INSTALACION.md) para requisitos completos,
variables de entorno, backups y despliegue en un VPS.

## Desarrollo local (sin Docker)

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # y edítalo (DB_HOST=localhost, etc.)
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver

# Frontend (en otra terminal)
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/MANUAL_USO.md`](docs/MANUAL_USO.md) | Manual de usuario final: pantallas, flujo de una expedición, agenda, configuración. |
| [`docs/INSTALACION.md`](docs/INSTALACION.md) | Requisitos, variables de entorno, backups, actualización, despliegue. |
| [`CHANGELOG.md`](CHANGELOG.md) | Registro de versiones y qué trae cada una. |
| [`docs/PLAN_EXTRACCION.md`](docs/PLAN_EXTRACCION.md) | Cómo se extrajo del ERP Appodo — decisiones de arquitectura, para quien quiera entender el porqué. |

## Licencia

[AGPL-3.0](LICENSE) — puedes usarlo, modificarlo y autoalojarlo libremente.
Si ofreces una versión modificada como servicio online, debes publicar tu
código bajo la misma licencia.

## Estado del proyecto

`v01` — verificado end-to-end de verdad, en navegador (Docker real, login,
ciclo completo crear → confirmar → generar DeCA → PDF con QR real →
descarga pública sin sesión → agenda autorrellenada). Ver capturas arriba.
Quedan TODOs explícitos en el código (`TODO(standalone):`, ver
[`CHANGELOG.md`](CHANGELOG.md)) antes de considerarlo listo para producción
sin supervisión — ver el estado "Conocido / pendiente" de la versión
actual.

## Autor y contacto

Desarrollado por **Juan Fco Jiménez Pascual**, autor también del
[ERP Appodo](https://appodo.dev).

¿Tu empresa necesita implementarlo, personalizarlo, integrarlo con otros
sistemas, o simplemente quieres soporte, instalación gestionada o migrar a
la versión completa del ERP? Contacto:

📧 **juanf.jipa@gmail.com**
🌐 [appodo.dev/appodo-deca](https://appodo.dev/appodo-deca)
