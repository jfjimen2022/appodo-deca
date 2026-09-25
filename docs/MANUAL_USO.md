# Manual de usuario — Appodo DeCa

Guía de uso para quien gestiona el día a día del transporte (administrativo,
transportista o cargador), sin conocimientos técnicos. Para instalar la
aplicación, ver [`INSTALACION.md`](INSTALACION.md).

## Acceso

Entra en la URL de tu instalación e inicia sesión con tu usuario y
contraseña. Hay dos tipos de cuenta:

- **Administrador**: además de gestionar expediciones y agenda, ve
  Configuración y puede crear/editar otros usuarios.
- **Operador**: gestiona expediciones y agenda, sin acceso a Configuración
  ni a la gestión de usuarios.

El administrador crea las cuentas desde **Usuarios** — no hay registro
público, la instalación es privada por defecto.

## 1. Expediciones (pantalla principal)

Es la lista de todos los DeCA. Cada fila muestra el estado, el cargador, el
transportista, el destinatario, la matrícula de la tractora, la fecha/hora
del transporte, y un icono de candado (abierto = el enlace público del QR
sigue vigente; cerrado = ha caducado).

Puedes buscar por texto, filtrar por estado (borrador, confirmado, generado,
anulado), elegir qué columnas ver y en qué orden, ordenar por cabecera, y
paginar. El menú **"Más acciones"** de la barra superior exporta el listado
filtrado a PDF o Excel, respetando los filtros y el orden que tengas en
pantalla.

Los botones **"Nuevo"** y **"Manual"** crean una expedición en blanco (el
segundo abre directamente el formulario sin la sección de documentos, para
cuando no hay ningún papel que escanear).

En cada fila, el menú de tres puntos permite: ver el detalle y, solo si está
**generada**, descargar el PDF, copiar el enlace público y enviarla por
email; y, salvo que ya esté anulada, anularla. Borrar solo está disponible
en borradores, o en expediciones anuladas que nunca llegaron a generar un
DeCA oficial (una anulada que sí se generó se conserva siempre, por
auditoría).

## 2. Crear o editar una expedición

El flujo típico:

1. **Sube el documento origen** (foto o PDF del albarán/CMR) con "Hacer
   foto" o "Subir documento". La aplicación intenta extraer automáticamente
   NIFs, matrículas, peso, bultos y fecha/hora, y solo rellena los campos
   que aún estén vacíos — nunca pisa lo que ya hayas escrito. Si el
   documento es ilegible, avisa y no pasa nada: se rellena a mano.
2. **Revisa y completa los bloques**: Cargador, Transportista, Destinatario
   (NIF y nombre obligatorios en los tres), Transporte (matrícula de la
   tractora, origen, destino, fecha/hora), Mercancía (naturaleza
   obligatoria; peso, bultos y volumen opcionales) y Conductor (opcional).
   Cada bloque tiene un botón **"Buscar en agenda"** para rellenarlo de un
   tirón con una ficha ya guardada. Un contador "X/N" en cada sección indica
   cuántos campos obligatorios faltan.
3. Si algún dato se completó mediante reconocimiento por IA (cuando la
   extracción automática simple no lo encontró), aparece un aviso aparte
   pidiendo que lo revises.
4. **Guardar** (queda en borrador). Si la expedición ya estaba confirmada y
   la editas, vuelve automáticamente a borrador — es una medida de
   seguridad para que un DeCA nunca se genere con datos a medio revisar.
5. **Confirmar**: valida que estén todos los datos legales mínimos. Solo
   disponible en borrador.
6. **Vista previa**: genera el PDF de prueba sin cambiar el estado, para
   revisar el resultado antes de generarlo de verdad.
7. **Generar DeCA**: solo desde "confirmado". Crea el PDF y el código QR
   oficiales. A partir de aquí la expedición pasa a solo lectura — ya no se
   puede editar. Si hay un error después, hay que anularla y crear una
   nueva.
8. **Enviar por email** y **Anular** solo están disponibles después de
   generar.

Los bloques **"Información adicional"** (instrucciones al conductor,
contacto de emergencia, tipo de contenedor, instrucciones de pago,
comentarios) y **"Transportistas sucesivos"** son opcionales y aparecen
plegados por defecto.

### Transportistas sucesivos

Es la cadena de transportistas que intervienen después del transportista
efectivo, cuando hay subcontratación del transporte. Se añaden uno a uno con
nombre, NIF y matrícula, en orden numerado. Solo se puede editar mientras la
expedición está en borrador.

## 3. Ficha de detalle

Disponible para expediciones generadas o anuladas. Muestra toda la
información en modo lectura: transporte, mercancía, información adicional,
cargador/transportista/destinatario/conductor, documentos origen adjuntos,
transportistas sucesivos (si los hay), y un **historial de auditoría** con
cada evento (creación, subida de documento, edición, confirmación,
generación, descargas públicas, anulación) con fecha y usuario.

Si está generada, hay una tarjeta con el **código QR**, el enlace público, y
botones para copiar el enlace, descargar el PDF y enviarlo por email.
También indica si el acceso público sigue vigente o ha caducado, y la fecha
exacta de caducidad.

El botón **"Anular"** (pide un motivo obligatorio) está disponible mientras
la expedición no esté ya anulada.

Las expediciones en borrador o confirmado no tienen ficha de detalle propia:
al intentar abrirlas, se abre directamente el formulario de edición.

## 4. Agenda

Cinco catálogos en una sola pantalla, por pestañas: **Conductores**,
**Tractoras**, **Remolques**, **Destinatarios** y **Empresas
transportistas**. Se rellenan solos cada vez que guardas una expedición
nueva, pero también puedes dar de alta, editar o borrar fichas a mano.

Cada catálogo tiene su propio buscador, ordenación por columna y
paginación. Acciones por ficha: editar, archivar/recuperar (en vez de
borrar, para no perder el histórico pero dejar de verla en las búsquedas
activas) y eliminar. Borrar una ficha de agenda no afecta a las expediciones
ya creadas: guardan el NIF y el nombre como texto congelado en el propio
documento legal.

Desde **"Más acciones"** puedes importar de golpe un CSV (con plantilla
descargable) — si una fila coincide en NIF (o en matrícula, para vehículos),
se actualiza en vez de duplicarse — y exportar el catálogo activo a PDF o
Excel.

## 5. Configuración (solo administrador)

- **Papel de tu empresa**: si actúas normalmente como Cargador (expides
  mercancía propia) o Transportista (transportas mercancía de terceros).
  Determina en qué campo se precarga tu NIF y cómo reparte la extracción
  automática los NIFs que lee del documento. Siempre se puede corregir a
  mano en una expedición concreta.
- **Acceso público**: días de visibilidad del enlace/QR público (mínimo 7
  días) y días de retención de las direcciones IP registradas en los
  eventos de descarga pública (por privacidad).
- **Notificaciones**: canal (email, SMS o WhatsApp) para avisar al
  conductor, y, de forma opcional, también al cliente y al transportista.
- **Cabecera de documento controlado**: opcional, añade a los PDF
  exportados (tanto de Expediciones como de Agenda) una cabecera tipo
  sistema de calidad — código de documento, versión, edición, preparado por
  y autorizado por — en vez del título simple.

## 6. Usuarios (solo administrador)

Alta, edición y baja de operadores. El único permiso a decidir es
"Administrador" (marcado = ve Configuración y gestión de usuarios; sin
marcar = solo Expediciones y Agenda).

## 7. Estados de una expedición

| Estado | Qué se puede hacer |
|---|---|
| **Borrador** | Editar todo, subir documentos, confirmar, borrar. |
| **Confirmado** | Generar el DeCA, o volver a editar (la devuelve a borrador automáticamente). |
| **Generado** | Solo lectura. Descargar, copiar enlace público, enviar por email, anular. |
| **Anulado** | Solo lectura. Se puede borrar definitivamente únicamente si nunca llegó a generarse el PDF oficial. |

## 8. Verificación pública por QR

Cada expedición generada lleva un enlace único incrustado en el código QR
del PDF. Cualquiera que escanee el QR o abra el enlace puede ver y descargar
el PDF del DeCA **sin necesidad de iniciar sesión**, mientras el acceso siga
vigente (según los días configurados en "Acceso público"). Pasado ese
plazo, el enlace deja de funcionar, aunque el documento en papel siga
siendo válido. Cada acceso queda registrado en el historial de auditoría.

## 9. Exportación

Tanto el listado de Expediciones como cada catálogo de la Agenda se pueden
exportar a **PDF** y **Excel**, respetando los filtros y el orden que
tengas activos en pantalla.

---

¿Dudas, quieres una funcionalidad que no está, o necesitas ayuda
implementándolo en tu empresa? Ver la sección **Contacto** del
[`README.md`](../README.md) principal.
