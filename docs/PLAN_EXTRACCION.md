# Plan de extracción — DeCA como app independiente (single-tenant, open source)

Estado: **documentado, sin ejecutar**. DeCA sigue en desarrollo activo dentro
del monolito Appodo (`saas_erp/apps/deca/`) — no scaffoldear código hasta que
esté feature-complete allí, para no mantener dos copias divergentes.

Origen del análisis: sesión 2026-09-24, exploración del módulo real en
`c:\Users\planta15\Documents\01 Appodo`.

---

## 1. Objetivo

Sacar DeCA del ERP Appodo y publicarlo en GitHub como app **gratuita,
descargable, autoalojable (self-hosted)**, sin ninguna dependencia del resto
del ERP (multi-tenant, permisos, catálogo de módulos, facturación...).

## 2. Decisión de arquitectura: single-tenant

Cada instalación (`docker-compose up`) sirve a **una sola empresa**. No se
lleva el modelo `Empresa`/multi-tenant del ERP. Un usuario que quiera dar
servicio a varias empresas simplemente levanta varias instancias.

Implicaciones:
- Sin `core.models.TenantModel` — los modelos de DeCA pierden la FK a
  `Empresa`.
- Sin `apps.modulos.EmpresaModulo` / `IsDecaActive` — no hay catálogo de
  módulos que activar, DeCA es la única app.
- Sin `apps.permisos` (Roles/Responsables) — roles simples: `is_staff`
  (admin) / usuario normal (operador), del `auth.User` estándar de Django.
- Sin `core.serializers.TenantScopedModelSerializer` — ya no hace falta
  acotar por empresa.

## 3. Login / autenticación

`django.contrib.auth.User` + `djangorestframework-simplejwt`, igual mecanismo
que ya usa Appodo (JWT en cookies HttpOnly) pero **sin** el wrapper
`apps.usuarios.jwt.JWTWithEmpresaAuthentication` (que añade `empresa` al
token) — se usa el `TokenObtainPairView` estándar de simplejwt.

- Alta de usuarios: comando de gestión (`createsuperuser`) para el primer
  admin; pantalla de "Usuarios" simple (CRUD) para añadir operadores, con un
  único flag `is_staff` como diferenciador de permisos (admin ve
  Configuración, operador solo gestiona expediciones).
- Sin registro público — la instancia es privada por defecto, el admin crea
  las cuentas.

## 4. Puntos de acoplamiento identificados (informe completo en el anexo)

| Punto | Hoy (ERP) | En la app standalone |
|---|---|---|
| Tenant | `TenantModel` → FK `Empresa` en cada modelo | Se elimina la FK; los modelos cuelgan directo de la instancia |
| Gate de módulo | `IsDecaActive` + `EmpresaModulo` | Se elimina — no hay módulos que activar |
| Serializers | `TenantScopedModelSerializer` | `serializers.ModelSerializer` estándar de DRF |
| Auth | `JWTWithEmpresaAuthentication` (JWT+cookie con empresa embebida) | `TokenObtainPairView`/`TokenRefreshView` estándar de simplejwt, JWT+cookie sin campo empresa |
| IA opcional | `core.ai.call_text_api`/`call_vision_api`, cascada de API key Usuario→Empresa→settings | Cliente IA propio y más simple, una sola API key en `.env` de la instancia (Gemini/OpenAI, configurable) |
| Storage | `media/deca/<uuid_empresa>/<año>/...` | `media/deca/<año>/...` (sin nivel de empresa) |
| PDF/QR/auditoría/catálogo (services/) | Reutilizables casi tal cual, no dependen de tenant | Se copian sin apenas cambios |

## 5. Estructura de repo propuesta

```
appodo-deca/
├── backend/                  # Django + DRF
│   ├── config/                (settings.py único, sin base/dev/prod split -- o sí, valorar)
│   ├── deca/                  (la app, ex apps/deca)
│   ├── usuarios/               (User estándar + auth simplejwt)
│   ├── manage.py
│   └── requirements.txt
├── frontend/                  # React + Vite + Tailwind (mismo stack, sin AuthContext de empresa)
│   └── src/
├── docker-compose.yml          # backend + frontend + postgres, un solo servicio de cada
├── docs/
│   ├── PLAN_EXTRACCION.md      (este documento)
│   └── INSTALACION.md          (futuro, cuando se scaffoldee)
├── .env.example
├── LICENSE                     (por decidir: MIT o AGPL — ver sección 7)
└── README.md
```

## 6. Pasos de ejecución (cuando DeCA esté feature-complete en el ERP)

1. Copiar `apps/deca/` completo a `backend/deca/`.
2. Quitar la FK `empresa` de cada modelo + migraciones nuevas desde cero
   (no arrastrar el historial de migraciones del ERP).
3. Sustituir `TenantScopedModelSerializer` → `ModelSerializer`.
4. Quitar `IsDecaActive`, dejar solo `IsAuthenticated` (+ `IsAdminUser` en
   Configuración).
5. Sustituir el cliente IA de `core.ai` por un cliente propio y mínimo
   (una función `extraer_con_ia(texto_o_imagen)` que lea la key de
   `settings.GEMINI_API_KEY`/`OPENAI_API_KEY`).
6. Copiar `services/{extraction_service,pdf_service,qr_service,storage_service,auditoria_service,catalogo_service}.py`
   casi sin cambios (no dependen de tenant).
7. Frontend: copiar las 4 páginas + `decaService.js`, sustituir
   `AuthContext`/`ModuloActivoRoute`/`Sidebar` del ERP por un shell propio
   mínimo (login, layout con 2-3 enlaces, sin multi-módulo).
8. `docker-compose.yml` + `.env.example` + README de instalación.
9. Decidir licencia (ver abajo) y publicar.

## 7. Nombre y versión — decidido (2026-09-24)

**Nombre: "Appodo DeCa"**, se mantiene la marca a propósito. Sirve como
publicidad: quien instala la versión gratuita standalone para gestionar
CMR/albaranes ve la marca Appodo cada vez que la usa, y si necesita más
(control horario, facturación, CRM...) ya sabe dónde mirar — mismo patrón
que la edición community de herramientas como n8o/Plausible frente a su
cloud de pago. Repo en GitHub: `appodo-deca`.

**Versión: dos números, con significado distinto cada uno.**

```
Appodo DeCa v01 · basado en Appodo v4.8.1
```

- **v01, v02, v03...** — contador propio del standalone. Empieza en `01`,
  sube en cada release suyo (fixes/features del propio DeCa standalone),
  independiente del SemVer de Appodo.
- **basado en Appodo vX.Y.Z** — congelado. Es la versión de Appodo ERP de la
  que se hizo el último resync de código hacia el standalone. **No se
  actualiza sola** (el standalone no tiene forma de saber la versión actual
  de Appodo en producción) — solo cambia cuando alguien trae manualmente
  mejoras del módulo DeCA del ERP hacia aquí y anota contra qué versión de
  Appodo lo hizo.
- Dónde se muestra: footer/about del frontend, `README.md`, y cada entrada
  del `CHANGELOG.md` del standalone anota la versión de Appodo del resync
  correspondiente (si esa entrada viene de un resync; los releases propios
  de fixes/features del standalone no tocan ese número).

## 8. Pendiente de decidir con el usuario

- **Licencia**: MIT (máxima libertad, cualquiera puede hacer SaaS con él) vs.
  AGPL (obliga a publicar el código si alguien lo ofrece como servicio online
  modificado) — recomendable AGPL si se quiere evitar que un tercero lo
  revenda como SaaS cerrado sin contribuir cambios de vuelta.
- **Multi-usuario dentro de una instancia**: ¿hace falta más de un rol
  (admin/operador) o con esos dos basta para el caso de uso real de DeCA
  (gestión de expediciones de transporte)?
- **Funcionalidad pendiente en el ERP** (ver memoria `project_deca_produccion_hallazgos_20260923.md`):
  el informe de auditoría y CRUD/paginación siguen sin cerrar — bloqueante
  antes de hacer el scaffold real, no solo detalle menor.

## 9. Disparador para retomar

Cuando DeCA se dé por "feature-complete" en el ERP (informe de auditoría +
CRUD/paginación cerrados, sin cambios de fondo pendientes), volver a este
documento y ejecutar la sección 6.
