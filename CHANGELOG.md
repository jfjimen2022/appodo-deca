# Registro de cambios — Appodo DeCa

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
La numeración es propia del standalone (`v01`, `v02`...), independiente del
SemVer del ERP Appodo — cada entrada que proviene de un resync de código
anota además la versión y fecha de Appodo de origen (ver
`docs/PLAN_EXTRACCION.md`, sección "Nombre y versión").

## [v03.2] — 2026-10-15

### Cambiado

- **Bultos opcionales y en dos números, como el peso**: «Bultos palets» y
  «Bultos cajas», en la misma línea del PDF. Ya no son obligatorios para
  generar (la Orden FOM/2861/2012 art. 6.d solo pide el peso): un obligatorio
  menos en el contador «X/N», también en móvil, donde van sin fondo amarillo.
  `bultos` sigue siendo el campo de cajas; nuevo `bultos_palets` (migración
  `0005`). El ERP puede mandar `bultos_palets` y `bultos_cajas`; la lectura
  de documentos separa palets de cajas.
- **Aviso «Modificado en el ERP» como pregunta de sí o no**: «Sí, pasar los
  cambios al DeCA» lo corrige con los datos del ERP (motivo automático con la
  referencia, PDF regenerado con el mismo QR); «No, el DeCA está bien» quita
  el aviso. Nuevo endpoint `aplicar-cambios-erp/`.
- **El aviso solo vive dentro del plazo de corrección**: fuera de plazo (o en
  papel) un cambio del ERP ya no avisa, y un aviso sin contestar se cierra
  solo al vencer el plazo, con constancia en el historial. Nuevo comando
  `caducar_avisos_erp` en el servicio `scheduler`.

### Corregido

- Un aviso del ERP ya descartado no vuelve a salir al reenviarse el mismo envío.

### Al actualizar

- Nada a mano con el procedimiento habitual (`docker compose up -d --build`,
  ver `docs/INSTALACION.md` §11): la migración `0005` se aplica sola al
  arrancar el backend y el `scheduler` se recrea con el comando nuevo. Solo
  si se actualiza de otra forma hay que recrear el `scheduler`.

## [v03.1] — 2026-10-13

### Corregido

- **Documentos subidos en producción**: con `DEBUG=False` los enlaces a
  `/media/` (documentos origen y PDF) daban 404. Ahora los sirve el backend,
  **solo a usuarios con sesión iniciada** (`core_utils/media_protegida.py`);
  sin sesión, 404.
- **QR detrás de un proxy HTTPS**: la dirección del QR salía con `http://`.
  El nginx del frontend reenvía ahora `X-Forwarded-Proto` del proxy y Django
  lo respeta (`SECURE_PROXY_SSL_HEADER`). Afecta solo a los DeCA nuevos.

### Documentación

- `docs/INSTALACION.md` reescrita como guía completa para instalar en un
  servidor propio: requisitos, `.env` comentado con ejemplo de producción,
  HTTPS con Caddy o nginx, SMTP, Gemini (y protección de datos), tareas
  programadas, backups con restauración, actualización, problemas frecuentes
  y lista de seguridad.
- Nueva `docs/CONFIGURACION.md` (guía del administrador): puesta en marcha,
  usuarios, configuración pestaña a pestaña, carga de la agenda, móviles,
  ERP y mantenimiento. `docs/MANUAL_USO.md` queda para el usuario diario.
- README con «Por dónde empezar» según quién lo lee.

## [v03] — 2026-10-13

Resync del módulo DeCA del ERP Appodo: lo funcional de las versiones 4.38 a
4.49.3, adaptado a single-tenant. Lo específico de clientes concretos (su
conector, sus datos y su configuración) no forma parte de este repositorio.

_Sincronizado desde Appodo ERP v4.49.3 (2026-10-13)._

### Añadido

- **Conexión con el ERP de la empresa** (`backend/deca/views_integracion.py`):
  `POST/GET /api/v1/deca/integracion/expediciones/` con clave en `X-Api-Key`.
  El ERP (o un conector en su red) envía cada albarán y se genera el DeCA
  solo; si falta algún obligatorio queda en borrador. Idempotente por
  `referencia_externa`. Claves de integración (solo se guarda su SHA-256) que
  el administrador crea y revoca en **Configuración → Conexión con tu ERP**.
  Límite de 1.200 envíos/hora por clave. Guía: `docs/INTEGRACION_ERP.md`.
- **Peso neto y bruto** en la misma línea del DeCA (`peso_bruto_kg`); basta
  con uno de los dos para generar.
- **NIF desde la Agenda** cuando el ERP manda el nombre sin NIF: coincidencia
  exacta → se completa; aproximada → se completa pero queda en borrador con
  aviso.
- **«Modificado en el ERP»**: si el ERP reenvía con datos distintos un DeCA
  ya emitido, no se toca; se guarda qué cambió, se marca en rojo y se puede
  corregir, anular o descartar el aviso.
- **Lo del ERP no duplica lo hecho a mano**: se enlaza por nº de albarán
  (sin espacios) y se borra el borrador sobrante; un borrador del ERP que se
  borra no vuelve a aparecer (`ReferenciaErpDescartada`).
- **Filtros de Expediciones** para lo que llega del ERP (origen, modificados,
  les falta algún dato), búsqueda por referencia del ERP, columna «Ref. ERP»
  en las exportaciones, y refresco automático del listado.
- **Adjuntar documentos con el DeCA ya generado** (el CMR firmado que vuelve
  con el camión): no se lee, no cambia el PDF ni el QR y no se puede quitar.
- Configuración reorganizada en **pestañas** (`?seccion=` en la URL).

### Corregido

- Generar y corregir un DeCA es **todo o nada**: si falla el PDF o el
  almacenamiento no queda nada a medias ni se consume número del contador.
- Número de DeCA automático duplicado con dos generaciones a la vez.
- PDF: «Reservas y comentarios» ya no se corta y el domicilio del cargador no
  invade la columna del transportista; la fecha de creación del PDF no cambia
  al corregir; en un CMR el transportista sale de la casilla 16.
- Hora de los envíos del ERP: se toma como hora local, no UTC.
- Informes: un nombre o filtro con `<` o `&` ya no rompe los PDF
  (`texto_pdf`), y en los Excel un valor que empiece por `=` se guarda como
  texto, nunca como fórmula (`core_utils/excel_utils.py`).
- Subir un documento con un tipo inventado devuelve un error claro.

### Técnico

- Migración `0004_sync_appodo_v4_49` (claves de integración, referencias
  descartadas, campos de integración y peso bruto en la expedición).
- Nueva dependencia de frontend `@radix-ui/react-tabs`. Tras actualizar:
  `docker compose up -d --build` (aplica la migración al arrancar).
- Tests: `test_integracion.py`, `test_generacion_atomica.py`,
  `test_listado.py`, `test_robustez_informes.py` portados; vitest de
  `ClavesIntegracionDeca` y `useAutoRefresh`.
- Manual de usuario actualizado y guía nueva `docs/INTEGRACION_ERP.md`.

## [v02] — 2026-10-02

Resync completo del módulo DeCA del ERP Appodo: todo lo funcional de las
versiones 4.20 a 4.37, adaptado a single-tenant.

_Sincronizado desde Appodo ERP v4.37.0 (2026-10-01)._

### Añadido

- **Corregir un DeCA ya generado** dentro de un plazo configurable (horas
  desde la primera generación), con historial de quién cambió qué campo, y
  **Anular** también fuera del borrador. Cada corrección exige **motivo** y
  queda en el mismo PDF (misma URL y QR) en la sección «Modificaciones
  durante el servicio», con los datos anteriores marcados «YA NO VÁLIDO» y
  las fechas de creación/modificación en los metadatos del PDF (Resolución
  de 5 de junio de 2026, apartados segundo y quinto). Modelo
  `ModificacionDeca`.
- **Informe de auditoría** de una expedición exportable a PDF/Excel; el
  historial ya no se corta en 50 eventos.
- **Obligatorios revisados contra el BOE** (art. 6 de la Orden
  FOM/2861/2012): domicilio del cargador, remolque salvo «sin remolque»,
  peso, bultos y autorización especial; datos del destinatario opcionales
  (configurable). Una sola fuente de verdad: `obligatorios_service`.
- **Referencia de la expedición** configurable (albarán, CMR o contador
  automático con prefijo) y **plantilla del email** de envío con marcadores.
- **Catálogo de Cargadores** en la Agenda (con domicilio), con migración que
  lo rellena desde las expediciones existentes.
- **Alta desde el móvil «a pleno sol»**: foto → lo que falta → comprobar →
  QR; buscador de agenda centrado; ayuda «¿Hace falta DeCA?».
- **La lectura aprende**: sinónimos aprendidos al generar (pestaña
  Sinónimos de la Agenda), candidatos de la agenda y correcciones anteriores
  como pistas para la IA, corrección de letras confundidas en matrículas,
  **modelos de documento** con valores fijos, panel de **precisión de
  lectura**, recorte «En el papel pone» y aviso de fotos movidas.
- **La agenda manda** al leer documentos (interruptor en Configuración con su
  leyenda): persona > agenda > IA > reparto por orden; el cargador nunca se
  rellena solo. Mismo criterio en backend (`catalogo_service.aplicar_prioridad_agenda`)
  y frontend (`lib/decaReparto.js`).
- **Matrículas**: españolas actuales, de remolque con R, provinciales
  antiguas y extranjeras (etiquetadas). **Naturaleza de la mercancía** con
  su denominación corriente, no códigos de artículo.
- **DeCA sin cobertura**: PWA instalable (`vite-plugin-pwa` en modo
  injectManifest + `src/sw.js`), caché de agenda/configuración por usuario,
  cola en IndexedDB que nunca se purga al cerrar sesión, QR generado en el
  móvil con `token_publico` que el servidor adopta, sincronización al volver
  la red (también con la app cerrada vía Background Sync / Periodic Sync).
  Modos imprimir / generar al volver / necesita red, ejemplares, registro de
  DeCA de papel por foto, DeCA anticipado con peso estimado y aviso por email
  de los que llegan sin completar (comando `avisar_deca_sin_completar`).
- **Validación del contenido** de cada fichero subido (`core_utils/validacion_ficheros.py`):
  firma real PDF/JPG/PNG, PDF sin JavaScript ni adjuntos, imágenes íntegras,
  fotos HEIC de iPhone convertidas a JPEG; fotos enderezadas según EXIF antes
  de la IA de visión.
- Reintento automático cuando Gemini responde saturado (503/429) y aviso
  real cuando falla la IA (antes parecía una «foto borrosa»).
- Servicio `scheduler` en `docker-compose.yml` (aviso de DeCA sin completar
  y purga de IPs, cada hora).
- Variables `EMPRESA_NIF` y `EMPRESA_DOMICILIO` (opcionales): `/auth/me/`
  devuelve la empresa de la instalación para precargar el NIF propio y el
  atajo «Lo contratamos nosotros».
- Tests: suite del ERP portada (`tests.py`, `test_aprendizaje.py`,
  `test_plantillas.py`) más la propia del standalone (`test_standalone.py`);
  vitest con jsdom para los componentes y librerías de DeCA (`npm test`).
- Manual de usuario reescrito a partir de las guías del ERP: cuatro casos
  paso a paso, lectura automática, configuración y preparación de móviles.

### Cambiado

- Los **operadores** pueden leer la Configuración (el formulario y el alta
  móvil la necesitan); editarla sigue siendo solo de administradores.
- nginx admite subidas de hasta 15 MB (antes cortaba en 1 MB las fotos de
  móvil) y no cachea `sw.js`.
- Accesibilidad de la paginación del listado de Expediciones.

### Conocido / pendiente

- Lo que en el ERP depende de su plataforma no se trae: cupo/uso de IA por
  empresa y claves de IA por empresa (aquí, una `GEMINI_API_KEY` por
  instalación), Google Drive, responsables de módulo (aquí, los avisos van a
  los usuarios `is_staff`) y zona horaria por empresa (aquí, `TIME_ZONE`).
- Background Sync / Periodic Sync solo existen en Chrome/Android; en iPhone
  los DeCA sin cobertura se registran al abrir la app con red.
- Las capturas de `docs/capturas/` son de `v01`.

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
- El ERP Appodo cerró en su v4.20.0 (posterior al resync de este release)
  una ventana de corrección configurable tras generar el DeCA, con
  historial de quién/qué campo cambió. El standalone todavía tiene el
  comportamiento anterior: una vez generado, solo se puede anular, no
  corregir — el propio diálogo de "Generar DeCA" lo dice así en el texto.
  Traerlo es la primera candidata para `v02`.

### Verificado (2026-09-25, en navegador con Playwright)

Stack completo levantado con Docker, sesión real por cookie HttpOnly,
ciclo de vida completo de una expedición (crear manual → rellenar →
guardar como borrador → confirmar → generar DeCA), PDF oficial con QR
generado correctamente, descarga pública del PDF verificada con `curl`
**sin ninguna cookie de sesión** (200, `application/pdf`), agenda de
transportistas autorrellenada a partir de la expedición guardada, pantalla
de Configuración con los campos reales. Capturas en
[`docs/capturas/`](docs/capturas/), usadas también en el README.
