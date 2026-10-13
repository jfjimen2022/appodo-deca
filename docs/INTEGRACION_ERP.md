# Appodo DeCa — Conexión con el ERP de la empresa (API de integración)

Desde la v03, un programa de la empresa (su ERP, o un conector instalado en su
red que lee la base de datos del ERP) puede enviar cada albarán de salida a
Appodo DeCa. La aplicación genera el DeCA con su QR y su PDF, sin teclear nada
ni subir documentos.

La conexión la abre siempre el programa de la empresa hacia esta instalación,
por HTTPS. El servidor del ERP no necesita abrir puertos ni tener IP pública:
basta con que llegue a la URL de Appodo DeCa.

En los ejemplos, `https://deca.tu-empresa.es` es la dirección de tu
instalación.

## 1. Crear la clave

En **Configuración → pestaña Conexión con tu ERP**. Se escribe un nombre
(p. ej. "ERP - servidor de la oficina") y se pulsa **Crear clave**.

- La clave completa (`deca_xxxxxxxx_...`) **solo se enseña en ese momento**.
  Solo se guarda su huella (SHA-256), así que no se puede volver a ver. Si se
  pierde, se revoca y se crea otra.
- Cada servidor o programa que se conecte lleva **su propia clave**. Así se
  puede cortar uno sin afectar a los demás.
- **Revocar** corta el acceso al instante y para siempre. Los DeCA que ya
  llegaron con esa clave se conservan.
- Solo los **administradores** (usuarios con `is_staff`) gestionan claves.
- No pegues la clave en chats, tickets ni correos: quien la tenga puede crear
  DeCA en nombre de tu empresa.

## 2. Enviar un albarán

```
POST https://deca.tu-empresa.es/api/v1/deca/integracion/expediciones/
X-Api-Key: deca_xxxxxxxx_...
Content-Type: application/json
```

```json
{
  "referencia_externa": "ALB-2026/4512",
  "numero_albaran": "2026/4512",
  "nif_cargador": "B12345674",
  "nombre_cargador": "Fabrica SL",
  "domicilio_cargador": "Calle Mayor 1, 04001 Almería",
  "nif_transportista": "B87654321",
  "nombre_transportista": "Transportes SL",
  "nif_destinatario": "A91234567",
  "nombre_destinatario": "Distrinorte SA",
  "matricula_tractor": "1234KLM",
  "matricula_remolque": "R5678BBC",
  "origen": "Almería",
  "destino": "Riba-roja de Túria",
  "fecha_hora_transporte": "2026-10-06T10:00:00",
  "naturaleza_mercancia": "Aguacate",
  "peso_neto_kg": "14200.50",
  "peso_bruto_kg": "15320.00",
  "bultos": 1260
}
```

### Campos

| Campo | ¿Obligatorio? | Notas |
|---|---|---|
| `referencia_externa` | **Siempre** | Identificador del envío en el ERP (máx. 100). Es lo que evita duplicados: la misma referencia nunca crea dos DeCA. |
| `nif_cargador`, `nombre_cargador`, `domicilio_cargador` | Para generar | Se valida el dígito de control del NIF. |
| `nif_transportista`, `nombre_transportista` | Para generar | |
| `matricula_tractor` | Para generar | Sin espacios ni guiones. Admite españolas actuales y antiguas, remolques con R y extranjeras. |
| `matricula_remolque` o `sin_remolque: true` | Para generar | `sin_remolque` es para los camiones rígidos. |
| `origen`, `destino`, `fecha_hora_transporte` | Para generar | La fecha va en hora local (`TIME_ZONE` del `.env`) y sin zona horaria. |
| `naturaleza_mercancia`, `bultos` | Para generar | |
| `peso_neto_kg`, `peso_bruto_kg` | Para generar (al menos uno) | El DeCA lleva los dos en la misma línea: *Peso neto … Peso bruto …*. El que no llegue sale como "—". |
| `peso_kg` | No | Otro nombre del peso neto. Si se manda, tiene prioridad sobre `peso_neto_kg`. |
| `nif_destinatario`, `nombre_destinatario` | Según la configuración | Solo obligatorios si se ha activado en Configuración. |
| `numero_albaran`, `numero_cmr`, `numero_pedido`, `autorizacion_especial`, `volumen_m3`, `codigo_mercancia`, `tipo_contenedor`, `contacto_emergencias`, `instrucciones_*`, `comentarios` | No | |
| `nombre_conductor`, `nif_conductor`, `telefono_conductor`, `email_conductor` | No | |
| `generar` | No (por defecto `true`) | Con `false`, el DeCA se queda siempre en borrador para que alguien lo revise antes de generarlo. |

**NIF que no manda el ERP.** Si llega el nombre de una parte (transportista,
cargador, destinatario, conductor) pero no su NIF, se busca por nombre en la
Agenda:

- **Coincidencia exacta,** quitando la forma societaria ("TRANSPORTES MARTIN E
  HIJOS" = "Transportes Martín e Hijos S.L."): se completa el NIF y el DeCA se
  genera con normalidad.
- **Coincidencia solo aproximada** (una errata en el nombre): se completa el
  NIF, pero el DeCA se queda en **borrador** y la respuesta trae `avisos` para
  que una persona lo confirme antes de generar. La Agenda no se toca, para no
  guardar el nombre con la errata.

Cualquier otro campo se ignora, incluidos `estado`, `token_publico` y
`peso_estimado`. El estado lo decide la aplicación, nunca el programa externo.

### Qué ocurre

| Situación | Respuesta | Qué hace Appodo DeCa |
|---|---|---|
| Referencia nueva con todos los obligatorios | `201`, `estado: "generado"` | Crea y genera el DeCA (QR + PDF). |
| Referencia nueva a la que le falta algo | `201`, `estado: "borrador"`, `campos_faltantes: [...]` | Lo deja en borrador. Nunca se inventa un dato. |
| Misma referencia, todavía en borrador | `200`, `ya_existia: true` | Lo actualiza con los datos nuevos y vuelve a intentar generarlo. |
| Misma referencia, ya generado o en papel, con los mismos datos | `200`, `ya_existia: true` | Nada. |
| Misma referencia, ya generado o en papel, **con datos distintos** | `200`, `ya_existia: true`, `cambios_erp: [...]` | **El DeCA no se cambia.** En Expediciones aparece la etiqueta roja **"Modificado en el ERP"** y, en la ficha, cada diferencia. Una persona lo corrige (si está en plazo y con su motivo), lo anula, o descarta el aviso si no afecta al transporte. Un dato que el ERP manda vacío no cuenta como cambio. |
| El mismo albarán ya se hizo **a mano** | `200`, `ya_existia: true` | No se crea otro: el DeCA hecho a mano se enlaza con la referencia del ERP (y se borra el borrador del ERP que lo duplicaba). El ERP nunca modifica un DeCA hecho a mano. El número de albarán se compara sin espacios (`AV1 / 481` = `AV1/481`). |
| Alguien **borró** el borrador que creó el ERP | `200`, `estado: "descartado"` | No vuelve a aparecer aunque el conector lo reenvíe. |
| Misma referencia, anulado | `200`, `ya_existia: true` | Nada. |
| Un dato con formato incorrecto (NIF, matrícula…) | `400` con el campo y el motivo | No crea nada. |
| Sin clave, o clave mal copiada o revocada | `401` | — |
| Más de 1.200 envíos en una hora con la misma clave | `429` | Hay que esperar y reintentar. |

### Respuesta

```json
{
  "id": "8f0c…",
  "referencia_externa": "ALB-2026/4512",
  "estado": "generado",
  "numero_albaran": "2026/4512",
  "numero_interno": "",
  "campos_faltantes": [],
  "url_publica": "https://deca.tu-empresa.es/api/v1/deca/publico/2b1e…/",
  "hash_sha256": "…",
  "fecha_generacion": "2026-10-06T10:05:12.345678+00:00",
  "ya_existia": false,
  "avisos": [],
  "cambios_erp": []
}
```

`url_publica` es la dirección que lleva el QR. Abre el PDF del DeCA mientras
siga vigente y es lo que se le hace llegar al transportista.

## 3. Consultar cómo va un envío

```
GET https://deca.tu-empresa.es/api/v1/deca/integracion/expediciones/?referencia=ALB-2026/4512
X-Api-Key: deca_xxxxxxxx_...
```

Devuelve lo mismo que el envío. Sirve, por ejemplo, para saber si un borrador
que se completó a mano ya está generado.

## 4. En la aplicación

- El DeCA aparece en **Expediciones** como cualquier otro. En su ficha pone
  *Recibido de tu ERP (nombre de la clave) · referencia …* en lugar de quién
  lo creó. Los borradores que llegan del ERP se marcan en rojo.
- Filtros de Expediciones: **Recibidos del ERP / Hechos a mano**, **Modificados
  en el ERP** y **Les falta algún dato**. La búsqueda encuentra también por
  referencia del ERP, y las exportaciones PDF/Excel respetan los filtros.
- Su historial registra que llegó por la integración, con el nombre de la
  clave.
- Los transportistas, cargadores, destinatarios, conductores y vehículos que
  llegan se añaden a la Agenda igual que al hacer un DeCA a mano.

## 5. Escribir el conector

El conector es un programa pequeño que corre en la red de la empresa, cada
pocos minutos (tarea programada / cron):

1. Lee de la base de datos del ERP, **solo lectura**, las expediciones de
   salida de los últimos días.
2. Las convierte al JSON de arriba. La `referencia_externa` debe ser estable
   (el id del envío en el ERP).
3. Las envía una a una con `POST`. Reenviar lo mismo no duplica nada, así que
   puede mandar todo lo de los últimos días en cada pasada.
4. Para revisar antes de emitir, que mande `"generar": false`: todo llega
   como borrador y una persona lo genera desde la ficha.

El conector nunca escribe en la base de datos del ERP.
