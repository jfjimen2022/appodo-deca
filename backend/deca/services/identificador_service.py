"""Punto único que decide "el identificador" de una expedición de cara al
cliente -- asunto de email, nombre de archivo PDF, título del historial de
auditoría. No todas las empresas
usan el número de albarán como referencia (una empresa sí, pero otra
empresa puede referenciar por número de CMR, y otra no tener ningún número
externo propio y necesitar que Appodo numere por ella).

Toda la lógica vive AQUÍ -- antes de esto, `expedicion.numero_albaran or
str(expedicion.id)` estaba duplicado en email_service.py, pdf_service.py,
views.py (x3) y reportes.py; si mañana cambia el criterio, es un único sitio
que tocar (una sola función para un mismo criterio: si se copia en dos
sitios, acaba divergiendo)."""
import re

from ..models import ConfiguracionDeca, ExpedicionDeca, IdentificadorExpedicionDeca

# Caracteres inválidos en un nombre de archivo (Windows es el más
# restrictivo de los sistemas habituales, y cubre también los problemáticos
# en URL/HTTP header) -- la "/" es la que de verdad importa aquí: un
# identificador preferido que sea una referencia externa del cliente (ej.
# numero_albaran "ALN26/1234") la lleva de forma habitual, y el navegador la
# interpreta como separador de carpetas al guardar la descarga, quedándose
# solo con lo que hay después de la última barra ("1234.pdf" en vez de
# "DECA_ALN26-1234.pdf" -- bug real reportado 2026-09-25).
_CARACTERES_INVALIDOS_ARCHIVO = re.compile(r'[\\/:*?"<>|]')


def obtener_configuracion(expedicion: ExpedicionDeca) -> ConfiguracionDeca | None:
    """Configuración de la instalación, o None si aún no existe la fila (se
    usan los valores por defecto)."""
    return ConfiguracionDeca.objects.filter(pk=1).first()


def identificador_expedicion(expedicion: ExpedicionDeca, config: ConfiguracionDeca | None = None) -> str:
    """Resuelve el identificador según `ConfiguracionDeca.identificador_preferido`
    de la empresa. Si el campo preferido está vacío en esta expedición en
    concreto (ej. prefiere CMR pero esta expedición no lleva CMR), cae en
    cascada al siguiente disponible -- nunca deja el identificador vacío ni
    se cae directamente al `id` interno de la base de datos salvo que de
    verdad no haya ningún otro dato.

    `config` es opcional para que un llamador que recorre muchas expediciones
    de la MISMA empresa (un informe de listado) la cargue una sola vez y la
    pase, en vez de disparar una consulta por fila.
    """
    if config is None:
        config = obtener_configuracion(expedicion)
    preferido = config.identificador_preferido if config else IdentificadorExpedicionDeca.NUMERO_ALBARAN

    candidatos_en_orden = {
        IdentificadorExpedicionDeca.NUMERO_ALBARAN: expedicion.numero_albaran,
        IdentificadorExpedicionDeca.NUMERO_CMR: expedicion.numero_cmr,
        IdentificadorExpedicionDeca.AUTOMATICO: expedicion.numero_interno,
    }
    preferido_valor = candidatos_en_orden.get(preferido)
    if preferido_valor:
        return preferido_valor

    # Fallback en cascada -- el orden es siempre el mismo independientemente
    # de cuál sea la preferencia, así nunca se muestra el `id` interno si hay
    # CUALQUIER otro dato disponible.
    return (
        expedicion.numero_albaran or expedicion.numero_cmr or expedicion.numero_interno
        or str(expedicion.id)
    )


def identificador_expedicion_para_archivo(expedicion: ExpedicionDeca, config: ConfiguracionDeca | None = None) -> str:
    """Mismo identificador que `identificador_expedicion`, saneado para poder
    usarse como nombre de archivo o dentro de un `Content-Disposition` --
    usar SIEMPRE esta función (nunca `identificador_expedicion` a secas) al
    construir un `filename=`, sea de descarga, adjunto de email o export de
    auditoría."""
    return _CARACTERES_INVALIDOS_ARCHIVO.sub('-', identificador_expedicion(expedicion, config))


def asignar_numero_interno_si_procede(expedicion: ExpedicionDeca, config: ConfiguracionDeca | None = None) -> ExpedicionDeca:
    """Llamar UNA VEZ, al Generar (nunca antes: un borrador que se acaba
    borrando no debe "quemar" un número). Si la empresa prefiere el contador
    automático y esta expedición todavía no tiene `numero_interno`, lo asigna
    incrementando `ConfiguracionDeca.ultimo_numero_automatico`. En cualquier
    otro caso no hace nada -- asignar un número automático a una empresa que
    no lo pidió sería numerar de más sin necesidad."""
    if config is None:
        config = obtener_configuracion(expedicion)
    if not config or config.identificador_preferido != IdentificadorExpedicionDeca.AUTOMATICO:
        return expedicion
    if expedicion.numero_interno:
        return expedicion

    config.ultimo_numero_automatico += 1
    config.save(update_fields=['ultimo_numero_automatico', 'fecha_actualizacion'])
    expedicion.numero_interno = f'{config.prefijo_numero_automatico}{config.ultimo_numero_automatico:05d}'
    expedicion.save(update_fields=['numero_interno', 'fecha_actualizacion'])
    return expedicion
