# Guía del administrador — Appodo DeCa

Para quien deja la aplicación lista para que la use el resto de la empresa:
usuarios, configuración, agenda inicial y móviles. Se hace desde el
navegador, sin tocar el servidor. Antes, alguien tiene que haberla instalado
siguiendo [`INSTALACION.md`](INSTALACION.md).

El día a día (hacer, corregir y anular DeCA) está en
[`MANUAL_USO.md`](MANUAL_USO.md).

## Índice

1. [Puesta en marcha en 8 pasos](#1-puesta-en-marcha-en-8-pasos)
2. [Usuarios](#2-usuarios)
3. [Configuración, pestaña a pestaña](#3-configuración-pestaña-a-pestaña)
4. [Cargar la agenda](#4-cargar-la-agenda)
5. [Preparar los móviles](#5-preparar-los-móviles)
6. [Conectar el ERP de la empresa](#6-conectar-el-erp-de-la-empresa)
7. [Mantenimiento habitual](#7-mantenimiento-habitual)

---

## 1. Puesta en marcha en 8 pasos

1. **Entra** en la dirección de la instalación (p. ej.
   `https://deca.tu-empresa.es`) con el administrador creado al instalar.
2. **Comprueba los datos de la empresa.** El nombre, NIF y domicilio no se
   editan en la aplicación: vienen del servidor (`EMPRESA_NOMBRE`,
   `EMPRESA_NIF`, `EMPRESA_DOMICILIO` en el `.env`). Si están mal, pídeselo a
   quien la instaló.
3. **Configuración → General**: el papel de tu empresa (cargador o
   transportista), qué número identifica cada expedición y el plazo de
   corrección ([§3](#3-configuración-pestaña-a-pestaña)).
4. **Configuración → Avisos y email**: el texto del email con el que se
   manda el DeCA.
5. **Configuración → Sin cobertura**: qué hace el móvil cuando no hay red.
6. **Usuarios**: una cuenta por persona ([§2](#2-usuarios)).
7. **Agenda**: importa tus clientes, transportistas y vehículos habituales
   ([§4](#4-cargar-la-agenda)). No es obligatorio (se rellena sola con el
   uso), pero ahorra mucho tecleo el primer mes.
8. **Prueba completa**: haz un DeCA de prueba desde el ordenador y otro desde
   un móvil (también en modo avión si vais a trabajar sin cobertura), abre
   el QR con otro móvil y después **anula** los dos.

## 2. Usuarios

Menú **Usuarios** (solo lo ven los administradores): alta, edición y baja.

Hay dos tipos de cuenta:

| | Administrador | Operador |
|---|---|---|
| Expediciones (crear, generar, corregir, anular, exportar) | Sí | Sí |
| Agenda (consultar, editar, importar) | Sí | Sí |
| Configuración | Sí | No |
| Usuarios | Sí | No |
| Recibe los avisos de DeCA sin completar (si tiene email) | Sí | No |

- La contraseña la pone el administrador al dar de alta y la cambia desde la
  misma pantalla. Pide a cada persona que use una contraseña solo para esto.
- **Una cuenta por persona**, nunca compartida: el historial de cada DeCA
  guarda quién hizo cada cosa, y eso es lo que se enseña en una inspección.
- Cuando alguien deja la empresa, **desactiva** su cuenta en vez de borrarla:
  sus DeCA siguen diciendo quién los hizo.
- La sesión dura hasta 7 días sin entrar; luego pide la contraseña otra vez.

## 3. Configuración, pestaña a pestaña

Los cambios se guardan con **Guardar** (arriba a la derecha). Los móviles los
reciben la próxima vez que abran la aplicación con red.

### General

- **Papel de tu empresa**: *Cargador* (contratáis el transporte) o
  *Transportista* (lo hacéis). Como transportista, vuestro NIF se precarga en
  el campo del transportista. La obligación del DeCA es de los dos (arts. 4 y
  7 de la Orden FOM/2861/2012); esto solo ahorra trabajo.
- **Referencia de la expedición**: el número que identifica cada DeCA en el
  asunto del email, el nombre del PDF y el informe de auditoría: nº de
  albarán, nº de CMR o el **número de la serie**.
- **Series de numeración**: una por actividad (nombre, prefijo y dígitos;
  p. ej. Algodón `DECA_ALG-00001`), cada una con su contador. Una es la
  serie **por defecto** y no se puede desactivar. El contador solo lo mueve
  la aplicación al generar; una serie ya usada no se borra, se desactiva. La
  primera vez se crea sola la serie «General» con el prefijo y el contador
  que ya tuviera la instalación.
- **Acceso público (QR)**:
  - *Días de visibilidad* del enlace del QR (mínimo legal 7). Pasado ese
    plazo el PDF ya no se descarga sin sesión, pero se conserva.
  - *Retención de las IP* de quien descarga por QR (protección de datos).
  - *Plazo de corrección*: cuántas horas después de generar se puede
    corregir un dato con motivo (24 de fábrica; 0 = no se puede corregir).
  - *Exigir datos del destinatario*: la norma no los pide; actívalo si tu
    empresa quiere que consten siempre.

### Avisos y email

- **Notificaciones**: canal preferido para conductor, cliente y
  transportista. De momento el envío es manual, con el botón **Email** de
  cada DeCA.
- **Plantilla del email**: asunto y mensaje por defecto, con marcadores
  `{identificador}`, `{numero_albaran}`, `{origen}`, `{destino}`,
  `{matricula_tractor}` y `{empresa}`. Vacío = texto estándar.

Para que salga cualquier email, el servidor necesita el SMTP configurado
([`INSTALACION.md` §7](INSTALACION.md#7-email-saliente-smtp)).

### Lectura de documentos

- **La agenda manda** (encendido de fábrica): si un documento dice algo
  distinto de lo que ya tienes en la agenda, se pone el dato de la agenda y se
  avisa. Recomendado: evita que una errata del papel acabe en el DeCA.
- **Modelos de documento**: si recibís o emitís siempre el mismo tipo de
  papel («albarán del cliente X», «ticket de báscula de la cooperativa Y»),
  dalo de alta con un ejemplo. Se reconoce solo al subir un documento y
  aplica sus instrucciones de lectura y valores fijos (como sugerencia).
- **Precisión de lectura**: qué porcentaje de datos leídos no hubo que
  corregir, por campo. Sirve para saber en qué fiarse menos.

La lectura con IA solo funciona si el servidor tiene clave de Gemini
([`INSTALACION.md` §8](INSTALACION.md#8-lectura-automática-con-ia-gemini)).

### Sin cobertura

- **Qué hace el móvil sin red** (se elige uno):
  - *Imprimir en el móvil* (de fábrica): genera la hoja del DeCA con su QR y
    lo registra al volver la red.
  - *Guardar y generar al volver la red*: no imprime; solo vale si el camión
    puede esperar.
  - *Necesita red*: sin cobertura no deja hacer DeCA.
- **Ejemplares al imprimir** (1 a 3): transportista, + cargador,
  + destinatario.
- **DeCA anticipado con peso estimado** (apagado): generar antes de que
  llegue el camión; el peso real se pone con *Corregir datos* antes de que
  salga. No se puede activar con 0 horas de corrección.
- **Aviso de DeCA sin completar** (encendido, 2 días): email a los
  administradores cuando un DeCA hecho sin cobertura llega al servidor sin
  poder generarse.
- La **guía para preparar los móviles** (la misma que en [§5](#5-preparar-los-móviles)).

### Informes y archivo

**Cabecera de documento controlado** para los PDF exportados (listados y
auditoría): código, versión, edición, preparado por y autorizado por. Útil
si trabajáis con un sistema de calidad (ISO, IFS, BRC…).

### Conexión con tu ERP

Claves para que el programa de gestión de la empresa mande los albaranes y
se genere el DeCA solo. Ver [§6](#6-conectar-el-erp-de-la-empresa).

## 4. Cargar la agenda

**Agenda** tiene seis catálogos: Cargadores, Transportistas,
Destinatarios, Conductores, Tractoras y Remolques (más *Sinónimos*, lo que
aprende la lectura).

Para cargarlos de una vez desde Excel:

1. En el catálogo que quieras, **Más acciones → Importar CSV** y, en la
   ventana que se abre, **Descargar plantilla CSV**.
2. Ábrela con Excel, rellena una fila por ficha (sin cambiar la primera fila)
   y guárdala como **CSV UTF-8**.
3. Vuelve a **Más acciones → Importar CSV** y elige el fichero. Si una fila
   coincide con una ficha existente (por NIF o por matrícula), se actualiza
   en vez de duplicarse.

Revisa bien los NIF antes de importar: con «la agenda manda», un NIF mal
guardado se repetiría en todos los DeCA siguientes. Si ves uno mal, corrígelo
en la ficha.

## 5. Preparar los móviles

Una vez por móvil, con red, antes de salir al campo (unos 5 minutos). Hace
falta que la instalación se sirva por **HTTPS**.

**Android · Chrome (recomendado)**

1. Abre la dirección de la instalación en Chrome e inicia sesión con el
   usuario de esa persona.
2. Expediciones → **Nuevo DeCA** → **Instalar Appodo DeCa en este móvil**
   (o menú ⋮ → «Instalar aplicación»).
3. Ábrela siempre desde el icono. Acepta las notificaciones.
4. Quita a Chrome el ahorro de batería extremo, si lo tiene.
5. Empareja la impresora de la caseta o comprueba «Guardar como PDF».
6. Comprueba que pone «Listo para trabajar sin cobertura».

Al volver la red, los DeCA hechos sin cobertura se registran solos aunque la
app esté cerrada.

**iPhone · Safari**

1. Abre la dirección de la instalación.
2. **Obligatorio**: Compartir → «Añadir a pantalla de inicio». Desde el
   navegador, el iPhone borra los datos de una web que no se abre en 7 días,
   incluidos los DeCA pendientes.
3. Abre la app desde el icono e inicia sesión **ahí** (no comparte sesión
   con el navegador).
4. Impresora con AirPrint o «Guardar en Archivos».
5. Comprueba «Listo para trabajar sin cobertura».

En iPhone, al volver la red hay que **abrir la app** para que se registren.

**En los dos**: un usuario por móvil; abrir la app con red al menos una vez
por semana; no borrar los datos del navegador con DeCA pendientes. Antes del
primer día, prueba en modo avión: rellenar, imprimir con QR, quitar el modo
avión y ver en Expediciones que aparece «Emitido sin conexión». Después,
anula ese DeCA de prueba.

## 6. Conectar el ERP de la empresa

Si vuestro programa de gestión (o un conector instalado en vuestra red) puede
mandar los albaranes de salida, el DeCA se genera solo, sin teclear ni subir
PDF.

1. **Configuración → Conexión con tu ERP → Crear clave**, con un nombre que
   diga qué servidor la usa.
2. Copia la clave **en ese momento** (no se vuelve a ver) y dásela por un
   canal seguro a quien programa el conector, junto con
   [`INTEGRACION_ERP.md`](INTEGRACION_ERP.md).
3. Empezad con el conector mandando `"generar": false`: todo llega como
   borrador (en rojo en Expediciones) y una persona lo revisa y genera.
   Cuando os fiéis de los datos, que genere solo.
4. Si una clave se filtra o se deja de usar, **Revocar**: deja de funcionar
   al instante.

## 7. Mantenimiento habitual

| Cada… | Qué |
|---|---|
| Semana | Expediciones → filtro *Borrador*: que no queden DeCA a medias, sobre todo los hechos sin cobertura. Con ERP conectado, filtro *Modificados en el ERP*. |
| Mes | Agenda: corregir fichas mal escritas y borrar sinónimos que no tengan sentido. Configuración → Lectura → *Precisión de lectura*. |
| Alta o baja de personal | Usuarios: crear o desactivar la cuenta. |
| Cambio de versión | Lo hace quien administra el servidor ([`INSTALACION.md` §11](INSTALACION.md#11-actualizar-a-una-versión-nueva)); avisa a los usuarios para que abran la app con red y reciban la versión nueva. |
| Inspección | En la ficha de cada DeCA, *Historial de auditoría* → **Exportar** (PDF o Excel); en Expediciones, exportar el listado del periodo. Los DeCA se conservan al menos un año. |
