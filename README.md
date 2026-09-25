# Appodo DeCa

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

## Stack

- **Backend:** Django 4.2 + Django REST Framework, PostgreSQL, JWT en
  cookies HttpOnly (`djangorestframework-simplejwt`).
- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui.
- Roles: `is_staff` (admin, ve Configuración y gestión de usuarios) / usuario
  normal (operador, solo gestiona expediciones y agenda).

## Arranque rápido (Docker)

```bash
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

## Licencia

[AGPL-3.0](LICENSE) — puedes usarlo, modificarlo y autoalojarlo libremente.
Si ofreces una versión modificada como servicio online, debes publicar tu
código bajo la misma licencia.

## Estado del proyecto

Scaffold inicial generado a partir del módulo DeCA del ERP Appodo (informe
de acoplamiento y plan en `docs/PLAN_EXTRACCION.md`). Pendiente de probar
end-to-end con Docker antes del primer release — ver TODOs marcados en el
código (`TODO(standalone):`).
