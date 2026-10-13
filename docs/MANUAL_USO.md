# Manual de usuario — Appodo DeCa

Guía de uso para quien gestiona el día a día del transporte (administrativo,
responsable de muelle, transportista o cargador), sin conocimientos
técnicos. Para instalar la aplicación en un servidor, ver
[`INSTALACION.md`](INSTALACION.md); para configurarla y dar de alta usuarios,
[`CONFIGURACION.md`](CONFIGURACION.md).

El DeCA (Documento de Control Administrativo) es obligatorio en el transporte
de mercancías por carretera según la Orden FOM/2861/2012. Desde el **5 de
octubre de 2026** (Resolución de 5 de junio de 2026) tiene que ser
**electrónico y con código QR**: un DeCA rellenado a bolígrafo deja de valer
como documento principal.

## Índice

1. [Antes de empezar](#1-antes-de-empezar)
2. [Qué datos hacen falta](#2-qué-datos-hacen-falta)
3. [Caso 1 · En el muelle, con el móvil](#3-caso-1--en-el-muelle-con-el-móvil)
4. [Caso 2 · En la oficina, con el PDF del albarán](#4-caso-2--en-la-oficina-con-el-pdf-del-albarán)
5. [Caso 3 · Corregir un DeCA ya generado](#5-caso-3--corregir-un-deca-ya-generado)
6. [Caso 4 · Sin cobertura](#6-caso-4--sin-cobertura)
7. [La lectura automática y cuándo desconfiar de ella](#7-la-lectura-automática-y-cuándo-desconfiar-de-ella)
8. [Expediciones, ficha de detalle y estados](#8-expediciones-ficha-de-detalle-y-estados)
9. [Agenda](#9-agenda)
10. [Configuración y usuarios (administrador)](#10-configuración-y-usuarios-administrador)
11. [Preparar los móviles para trabajar sin cobertura](#11-preparar-los-móviles-para-trabajar-sin-cobertura)
12. [Si algo no va](#12-si-algo-no-va)

## 1. Antes de empezar

1. **Abre la dirección de tu instalación** en el navegador (mejor Chrome):
   `http://localhost:8080` si la tienes en tu propio equipo, o el dominio
   que haya configurado quien la instaló (por ejemplo
   `https://deca.tuempresa.com`).
2. **Inicia sesión** con el usuario y la contraseña que te haya dado el
   administrador. No hay registro público: la instalación es privada.
3. Hay dos tipos de cuenta:
   - **Administrador**: todo, más **Configuración** y **Usuarios**.
   - **Operador**: Expediciones y Agenda.
4. **En el móvil, instala la app** (hace falta que la instalación se sirva
   por HTTPS): Android con Chrome → Expediciones → **Nuevo DeCA** →
   **Instalar Appodo DeCa en este móvil** (o menú ⋮ de Chrome → «Instalar
   aplicación»); iPhone → botón Compartir → «Añadir a pantalla de inicio» y
   entra con tu usuario desde ese icono. Ábrela siempre desde el icono: así
   funciona también sin cobertura (ver [sección 11](#11-preparar-los-móviles-para-trabajar-sin-cobertura)).

El menú de arriba tiene **Expediciones**, **Agenda** y, si eres
administrador, **Configuración** y **Usuarios**. Abajo se ve la versión de
la aplicación.

## 2. Qué datos hacen falta

Son los que pide el artículo 6 de la Orden FOM/2861/2012. Los campos
obligatorios salen con **fondo amarillo** y un contador te dice cuántos
faltan.

| Bloque | Datos |
|---|---|
| **Cargador** | Quien **contrata** el transporte (no tiene por qué ser el dueño de la mercancía ni el sitio de carga): nombre, NIF y domicilio. Puede ser tu empresa o tu cliente. |
| **Transportista** | Nombre y NIF de quien hace el transporte. |
| **Vehículo** | Matrícula de la tractora y del remolque, o marca **«Sin remolque»** si es un camión rígido o una furgoneta. Si el vehículo circula con una autorización especial (transportes especiales), su número. |
| **Ruta y fecha** | Origen, destino y fecha/hora de salida. |
| **Mercancía** | Qué se lleva (con su nombre corriente, no un código de artículo), peso en kg y número de bultos. |

El **destinatario** es opcional por norma; el administrador puede exigirlo
en Configuración. Valen matrículas españolas actuales (`1234BCD`), de
remolque con la R delante (`R1234BCD`), provinciales antiguas (`CA1234AB`)
y extranjeras (se marcan como tales).

> ¿Hace falta DeCA? El formulario tiene una ayuda «¿Hace falta DeCA?» con
> los casos en que no es obligatorio (por ejemplo, ciertos vehículos
> ligeros).

## 3. Caso 1 · En el muelle, con el móvil

Un camión contratado por tu cliente viene a cargar. El responsable de
muelle hace el DeCA con el móvil antes de que salga. Como el cliente ya
está en la agenda, casi todo se elige con un toque.

1. **Nuevo DeCA.** En Expediciones → **Nuevo DeCA**. En el móvil se abre un
   alta pensada para usarse de pie y a pleno sol: botones grandes y mucho
   contraste. Lo más rápido es **Foto del albarán** (o del CMR): la
   aplicación lee la foto y solo te pregunta lo que falta. Sin papel a mano,
   **Rellenar a mano**. Abajo debe poner «Listo para trabajar sin
   cobertura».
2. **«Solo esto»: lo que falta.** Arriba ves cuántos datos faltan. Cada dato
   obligatorio sale en amarillo con la etiqueta **Falta**, y el botón de
   abajo te lleva siempre al siguiente.
3. **Elige de la agenda con el «+».** Junto al campo, el **+** abre la
   agenda con buscador. Escribe unas letras del nombre, del NIF o de la
   matrícula y toca la ficha: se rellenan juntos nombre, NIF y domicilio.
   Para el cargador hay además atajos de un toque: **«Lo contratamos
   nosotros»** / **«Lo contrata el cliente»**.
4. **Completa el resto**: origen y destino, la salida (botón **Ahora**),
   qué lleva, el peso y los bultos. Cada dato completo se pone en verde con
   **Listo**. Se guarda solo mientras escribes.
5. **Más datos (opcional)**: nº de albarán, conductor, observaciones. Con
   nº de albarán el DeCA se reconoce mejor en la lista.
6. **Comprueba.** **Siguiente: comprobar** muestra todos los datos
   agrupados. Si algo no cuadra, **Cambiar**; si todo está bien, **Generar
   DeCA**.
7. **Confirma.** La aplicación te recuerda que, una vez generado, solo se
   puede corregir durante el plazo de corrección. **Sí, generar.**
8. **El QR, listo para el conductor.** Sale el QR grande. El conductor
   puede llevarlo en el móvil o impreso; en un control basta con enseñarlo.
9. **Mándalo o corrígelo**: **Email** o **Copiar enlace** para el
   conductor. Un recuadro amarillo dice hasta cuándo se puede **Corregir
   datos**.

## 4. Caso 2 · En la oficina, con el PDF del albarán

1. **Expediciones → Nuevo DeCA.**
2. **Sube el albarán.** En *Documentos adjuntos*, deja marcado **Intentar
   extraer datos automáticamente** y pulsa **Subir documento origen** (PDF,
   JPG o PNG, hasta 10 MB; las fotos HEIC de iPhone se convierten solas).
   Mientras lee aparece «Extrayendo…».
3. **Mira qué ha leído y los avisos.** Arriba aparecen los datos
   encontrados y lo que ha completado la IA. **Tu agenda manda sobre lo
   leído**: si el documento dice algo distinto de lo que ya tienes en la
   agenda, se pone el dato de la agenda y se avisa en ámbar con los dos
   valores. Los campos en **rojo** son los que tienes que comprobar con el
   documento delante; en una foto, «En el papel pone» te enseña el trozo de
   imagen de donde salió un dato dudoso.
4. **El cargador, siempre a mano.** El cargador es quien contrata el
   transporte y casi nunca lo dice el albarán, así que **nunca se rellena
   solo**: elígelo con **Lo contratamos nosotros**, **Lo contrata el
   cliente** o **Buscar en agenda** (buscador centrado; flechas y Enter
   también valen).
5. **Repasa NIF y matrículas** con el documento: son los datos legales del
   DeCA.
6. **Confirmar datos** y **Generar DeCA**. Si algo falta, el aviso rojo
   junto a los botones dice qué dato es y **Ir al campo** te lleva. Antes de
   generar puedes ver una **Vista previa** (con marca de agua, con lo que
   tengas en pantalla aunque no esté guardado).
7. **DeCA generado.** La ficha muestra los datos, el QR, el enlace público,
   **Descargar PDF**, **Enviar por email** y hasta cuándo se puede corregir.
8. **Envíaselo al conductor** con **Enviar por email**: si dejas el asunto y
   el mensaje en blanco, se usan los de Configuración.

## 5. Caso 3 · Corregir un DeCA ya generado

El DeCA se generó con 9.600 kg, pero en báscula salen 9.850. Mientras dure
el **plazo de corrección** (Configuración, 24 horas de fábrica, contado
desde la primera generación) se corrige sin anular nada.

1. En la ficha, **Corregir datos**. Cambia el dato y pulsa **Guardar
   corrección**.
2. El **motivo es obligatorio**: sin él no deja guardar y lo pide en el
   recuadro amarillo *Motivo de la corrección* («Peso real tras pasar por la
   báscula»).
3. **Así queda el DeCA.** La Resolución de 5 de junio de 2026 (apartado
   quinto) exige que en el propio documento consten los datos nuevos, el
   motivo y los antiguos marcados como no válidos. El PDF muestra el dato
   nuevo y una sección **«Modificaciones durante el servicio»** con quién,
   cuándo, el motivo y el dato anterior como **YA NO VÁLIDO**. Es el mismo
   PDF, con la misma URL y el **mismo QR**: el conductor ve la versión
   corregida sin que haya que mandarle otro. Los metadatos del PDF guardan
   la fecha de creación original y la de la modificación.

Pasado el plazo, la expedición se **anula** desde la ficha (pide un motivo)
y se hace una nueva.

## 6. Caso 4 · Sin cobertura

Se carga en una finca sin cobertura. El móvil ya entró en la aplicación con
red antes de salir, así que tiene la agenda y la configuración guardadas.

1. Arriba sale **Sin cobertura**. Se rellena igual que en el caso 1: la
   agenda funciona sin red. Las fotos se pueden hacer, pero sin red no se
   leen solas.
2. Al final, el botón verde es **Generar e imprimir sin conexión**. Antes de
   imprimir se comprueban los mismos datos obligatorios que con red: el
   papel sale tal cual.
3. **Imprimir** con la impresora de la caseta (wifi o bluetooth) o
   **Guardar como PDF**.
4. **El papel que viaja en el camión.** Cada ejemplar (transportista y, si
   se configura, cargador y destinatario) lleva todos los datos, casillas de
   firma, una referencia `OFF-…` y el **QR del DeCA**. Ese QR lo genera el
   propio móvil y el servidor lo adopta al registrar el DeCA: empieza a
   llevar al documento en cuanto el móvil vuelve a tener red. Si alguien lo
   escanea antes, se le explica que se emitió sin cobertura.
5. **Pendiente de registrar.** En Expediciones se ve lo que falta por
   registrar. Al volver la red se registra solo (en Android, aunque la app
   esté cerrada) o con **Registrar ahora**. Si el servidor rechaza algún
   dato (un NIF mal copiado), se registra igualmente en borrador sin ese
   dato, con lo que ponía copiado en Observaciones, y los administradores
   reciben el aviso de DeCA sin completar.

Los DeCA pendientes **nunca se borran** del móvil al cerrar sesión: son
documentos que ya viajaron en papel y tienen que llegar al registro (que se
conserva un año, art. 9 de la Orden). Lo que sí se borra al cerrar sesión es
la copia de la agenda guardada para trabajar sin red.

## 7. La lectura automática y cuándo desconfiar de ella

Al subir un documento pasa esto, en orden:

1. **Comprobación de seguridad.** Antes de guardar nada se verifica que el
   archivo es de verdad un PDF, JPG o PNG (no uno renombrado), que un PDF no
   lleva JavaScript, acciones automáticas ni ficheros incrustados, y que una
   imagen no está dañada. Si no pasa, se rechaza y se dice por qué.
2. **Se guarda** y aparece en la lista al momento.
3. **Lectura por patrones** (NIF, matrícula, peso, fecha).
4. **IA** (opcional, si el administrador de la instalación configuró una
   clave de Gemini): si el PDF tiene texto, una IA de texto completa lo que
   los patrones no supieron atribuir; si es un escaneo o una foto (sin capa
   de texto), una IA de visión lee la imagen. Las fotos giradas se enderezan
   antes de mandarlas.

Todo son **sugerencias**: nada es oficial hasta que pulsas Confirmar y
Generar. Si la lectura falla, el documento sigue subido y puedes reintentar
con **Extraer datos** en su fila.

**En qué orden se fía la aplicación de cada fuente** (con «la agenda manda»
encendido, que es lo de fábrica):

1. Lo que escribe una persona: nunca se pisa.
2. Tu agenda: datos confirmados en DeCA anteriores. Si el nombre leído
   coincide con una ficha, se usa su NIF (y el domicilio del cargador); si
   el NIF leído es de una ficha, se usa su nombre. Un NIF de la agenda nunca
   se pone en el papel de otra empresa.
3. Lo leído por la IA: para lo que la agenda no conoce.
4. Reparto por orden: último recurso para NIF sin papel; quedan marcados
   para revisar. **El cargador nunca se rellena así.**

**La lectura aprende.** Cuando generas un DeCA en el que corregiste lo que
leyó la IA, la aplicación guarda cómo aparece escrita cada ficha en los
papeles («TTES GARCIA» = Transportes García S.L.) y lo usa la próxima vez.
Con una sola confirmación lo propone para revisar; con dos o más, lo rellena
directamente. Los sinónimos aprendidos se ven y se borran en **Agenda →
Sinónimos**. La **precisión de lectura** (cuántos datos no hubo que
corregir) está en Configuración.

**Cuándo puede fallar**: un formato muy distinto al habitual, un escaneo
borroso o con letra a mano, dos matrículas seguidas sin marca de remolque,
un peso sin decimales mezclado con otros números de una tabla, un NIF con
la letra de control mal (se rechaza aunque venga de la IA) o un documento en
otro idioma. En el peor caso, toca rellenar algún campo a mano.

**Modelos de documento.** Si recibes o emites siempre el mismo tipo de papel
(«albarán del cliente X», «ticket de báscula de la cooperativa Y»), dalo de
alta en Configuración → **Modelos de documento**: se reconoce solo al subir
un documento y aplica sus instrucciones de lectura y sus valores fijos
(siempre como sugerencia).

## 8. Expediciones, ficha de detalle y estados

**Expediciones** es la lista de todos los DeCA: buscador (por nº de albarán
o por referencia del ERP), filtros por estado, columnas configurables y
ordenables, paginación y **Más acciones** para exportar a PDF o Excel
respetando filtros y orden. La lista se refresca sola cada poco (arriba se ve
cuándo se actualizó). Arriba aparecen también los DeCA hechos sin cobertura
pendientes de registrar en este móvil.

Si la empresa conecta su ERP ([`INTEGRACION_ERP.md`](INTEGRACION_ERP.md)),
hay además filtros **Recibidos del ERP / Hechos a mano**, **Modificados en el
ERP** y **Les falta algún dato**. Los borradores que llegan del ERP salen en
rojo: complétalos y genera desde ellos, no hagas otro DeCA a mano (si ya lo
hiciste, el ERP lo reconoce por el nº de albarán y no lo duplica). Un DeCA
generado que el ERP cambia después lleva la etiqueta roja **«Modificado en el
ERP»**: en su ficha se ve cada diferencia; corrígelo (en plazo y con motivo),
anúlalo o **descarta el aviso** si el cambio no afecta al transporte.

**Peso neto y bruto**: el DeCA lleva los dos en la misma línea (*Peso neto …
Peso bruto …*). Basta con uno de los dos para generar.

La **ficha de detalle** (expediciones generadas, anuladas o en papel)
muestra los datos, los documentos origen, los transportistas sucesivos, el
QR con su enlace público y el **historial de auditoría**: cada evento
(creación, subida de documento, edición campo a campo con quién y qué
cambió, confirmación, generación, correcciones, descargas públicas por QR,
envíos por email, anulación) con fecha y usuario. El historial se exporta a
**PDF o Excel** (informe de auditoría).

| Estado | Qué se puede hacer |
|---|---|
| **Borrador** | Editar todo, subir documentos, confirmar, borrar. |
| **Confirmado** | Generar el DeCA, editar (vuelve a borrador), anular. |
| **Generado** | Descargar, copiar enlace, enviar por email, corregir dentro del plazo (con motivo), anular, **adjuntar documentos** (p. ej. el CMR firmado que vuelve con el camión: no se lee, no cambia el PDF ni el QR y no se puede quitar después). |
| **DeCA en papel** | Solo lectura: un DeCA del talonario registrado por foto (ver Configuración). No tiene PDF ni QR de la aplicación. |
| **Anulado** | Solo lectura. Se puede borrar solo si nunca llegó a generarse el PDF oficial. |

Generar y corregir son **todo o nada**: si falla algo a mitad (el PDF, el
almacenamiento), no queda nada a medias ni se gasta un número del contador.

**Borrar** solo se puede un borrador, o uno anulado que nunca llegó a
generarse. Si era un borrador que llegó del ERP, el conector ya no lo vuelve a
crear.

**Verificación pública por QR**: cualquiera que escanee el QR puede ver y
descargar el PDF **sin iniciar sesión** mientras el acceso siga vigente
(días configurados, mínimo legal 7). Cada acceso queda en el historial.

## 9. Agenda

Seis catálogos: **Cargadores**, **Transportistas**, **Destinatarios**,
**Conductores**, **Tractoras** y **Remolques**, más la pestaña
**Sinónimos** (lo que ha aprendido la lectura). Se rellenan solos cada vez
que se confirma una expedición; también puedes dar de alta, editar,
archivar o borrar fichas a mano. Borrar una ficha no afecta a los DeCA ya
hechos (guardan los datos como texto). **Más acciones** importa un CSV
(plantilla descargable; si una fila coincide en NIF o matrícula se actualiza
en vez de duplicarse) y exporta a PDF o Excel.

Mantén la agenda al día: como manda sobre lo leído, un dato mal guardado en
una ficha se propagaría a los DeCA siguientes. Corrígelo en la ficha.

## 10. Configuración y usuarios (administrador)

La configuración de la aplicación, el alta de usuarios, la carga inicial de
la agenda y la conexión con el ERP están en la guía del administrador:
[`CONFIGURACION.md`](CONFIGURACION.md).

## 11. Preparar los móviles para trabajar sin cobertura

Una vez por móvil, con red y antes de salir al campo: instalar la app desde
el navegador, iniciar sesión desde el icono y comprobar que pone «Listo para
trabajar sin cobertura». Los pasos para Android e iPhone están en
[`CONFIGURACION.md` §5](CONFIGURACION.md#5-preparar-los-móviles) y en la
propia aplicación (Configuración → Sin cobertura).

Lo que tienes que recordar cada día: abre siempre la app desde el icono,
ábrela con red al menos una vez por semana y no borres los datos del
navegador si tienes DeCA pendientes de registrar.

## 12. Si algo no va

- **La foto no se ha leído bien**: repítela con buena luz y el papel entero,
  o rellena a mano. Si avisa de una foto movida o con reflejos, hazla otra
  vez. Revisa siempre NIF y matrículas antes de generar.
- **Dice que el servicio de IA no está disponible**: la clave de Gemini no
  está configurada o el servicio está saturado; espera unos minutos y usa
  **Extraer datos**, o rellena a mano.
- **No me deja confirmar o generar**: mira el aviso rojo junto a los
  botones: dice qué dato falta o está mal escrito (por ejemplo, un NIF con
  la letra de control mal) e **Ir al campo** te lleva.
- **Me he equivocado en un DeCA ya generado**: dentro del plazo, **Corregir
  datos** con el motivo (caso 3). Pasado el plazo, anúlalo y haz uno nuevo.
- **Un documento legítimo se rechaza al subirlo**: imprímelo de nuevo a PDF
  o súbelo como foto.
- **¿Vale un DeCA rellenado a bolígrafo?** Desde el 5 de octubre de 2026,
  no: tiene que ser electrónico y con su QR. Sin cobertura, usa el caso 4.

---

¿Dudas, quieres una funcionalidad que no está, o necesitas ayuda
implementándolo en tu empresa? Ver la sección **Autor y contacto** del
[`README.md`](../README.md) principal.
