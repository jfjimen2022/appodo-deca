"""La lectura de documentos DeCA que "aprende" de lo que corrigen las personas
(fase 1, diseñada con el usuario 2026-09-28).

No se reentrena ningún modelo: se RECUERDA lo que la persona confirmó y se
usa la próxima vez, siempre dentro de la misma empresa. Cuatro piezas:

1. `registrar_lecturas` -- al extraer un documento, se apunta qué leyó la IA
   de cada campo (LecturaCampoDeca). Es un registro de la IA, no un dato de
   negocio: la expedición no se toca.
2. `resolver_lecturas` -- al GENERAR el DeCA (valores ya decididos por una
   persona) se compara lo leído con lo final y, cuando la persona corrigió un
   nombre o una matrícula, se aprende el sinónimo (AliasAgendaDeca).
3. `aplicar_sinonimos` -- en la siguiente lectura, lo que aparezca escrito
   igual se traduce a la ficha de la Agenda. Con una sola confirmación se
   propone para revisar; con `AliasAgendaDeca.MINIMO_CONFIRMACIONES`, directo.
4. `corregir_matriculas` y `pistas_candidatos` -- para lo manuscrito, lo más
   difícil de leer: la IA recibe la lista cerrada de nombres y matrículas
   conocidos de la empresa para ELEGIR en vez de transcribir a ciegas, y las
   letras que se confunden al escribir a mano (8/B, 5/S, 0/O...) se reparan
   contra la Agenda.

Todo es best-effort: si algo de esto falla, la extracción y la generación
siguen igual que antes (se loguea, nunca se traga en silencio).
"""
from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher

from django.utils import timezone

from deca.models import (
    AliasAgendaDeca, CargadorDeca, ConductorDeca, DestinatarioDeca, EmpresaTransportistaDeca,
    ExpedicionDeca, LecturaCampoDeca, RemolqueDeca, TractoraDeca,
)
from deca.services.catalogo_service import _nucleo_nombre_empresa

logger = logging.getLogger(__name__)

# Campo de nombre (o matrícula) -> rol del sinónimo, y su NIF acompañante.
_ROL_POR_CAMPO = {
    'nombre_cargador': ('cargador', 'nif_cargador'),
    'nombre_transportista': ('transportista', 'nif_transportista'),
    'nombre_destinatario': ('destinatario', 'nif_destinatario'),
    'nombre_conductor': ('conductor', 'nif_conductor'),
    'matricula_tractor': ('tractora', None),
    'matricula_remolque': ('remolque', None),
}
_CAMPO_POR_ROL = {rol: campo for campo, (rol, _nif) in _ROL_POR_CAMPO.items()}
_CAMPOS_MATRICULA = ('matricula_tractor', 'matricula_remolque')

_RE_MATRICULA = re.compile(r'^\d{4}[A-Z]{3}$')

# Caracteres que se confunden al leer letra a mano o una foto mala. Cada
# grupo se reduce a un mismo símbolo para comparar ("4B21LKP" ~ "4821LKP").
_GRUPOS_CONFUSION = ('0OQD', '1IL', '2Z', '5S', '6G', '8B')
_CLASE_CONFUSION = {c: grupo[0] for grupo in _GRUPOS_CONFUSION for c in grupo}
# Reparación de formato: en los 4 primeros huecos solo caben cifras y en los
# 3 últimos solo letras.
_A_CIFRA = {'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'G': '6', 'B': '8', 'T': '7'}
_A_LETRA = {'8': 'B', '5': 'S', '2': 'Z', '6': 'G'}

# Cuántos candidatos de la Agenda se le pasan a la IA por rol: suficientes
# para cubrir los habituales sin inflar el prompt.
MAXIMO_CANDIDATOS_POR_ROL = 40


# ── Normalización ───────────────────────────────────────────────────────────

def _matricula(valor: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', (valor or '').upper())


def clave(rol: str, valor: str) -> str:
    """Forma de búsqueda de un texto leído: matrícula sin separadores, o
    núcleo del nombre (sin puntos, espacios de más ni forma societaria)."""
    if rol in ('tractora', 'remolque'):
        return _matricula(valor)
    return _nucleo_nombre_empresa(valor or '')


def _confusion(valor: str) -> str:
    return ''.join(_CLASE_CONFUSION.get(c, c) for c in valor)


def matriculas_confundibles(a: str, b: str) -> bool:
    """True si dos matrículas distintas solo se diferencian en caracteres que
    se confunden al leer (8/B, 5/S, 0/O, 1/I...)."""
    a, b = _matricula(a), _matricula(b)
    return a != b and len(a) == len(b) and _confusion(a) == _confusion(b)


def reparar_formato_matricula(valor: str) -> str | None:
    """Intenta llevar una matrícula mal leída al formato 1234ABC cambiando
    solo caracteres confundibles. None si no hay forma segura de hacerlo."""
    v = _matricula(valor)
    if len(v) != 7:
        return None
    cifras = ''.join(_A_CIFRA.get(c, c) for c in v[:4])
    letras = ''.join(_A_LETRA.get(c, c) for c in v[4:])
    reparada = cifras + letras
    return reparada if _RE_MATRICULA.match(reparada) and reparada != v else None


def _parecidos(rol: str, leido: str, final: str) -> bool:
    """¿Lo leído y lo final son la MISMA cosa escrita distinto, o la persona
    eligió otra distinta? Solo lo primero es un sinónimo; aprender lo
    segundo enseñaría a la IA a equivocarse."""
    if rol in ('tractora', 'remolque'):
        a, b = _matricula(leido), _matricula(final)
        if len(a) != len(b):
            return False
        return sum(x != y for x, y in zip(_confusion(a), _confusion(b))) <= 1
    a, b = _nucleo_nombre_empresa(leido or ''), _nucleo_nombre_empresa(final or '')
    if not a or not b:
        return False
    if SequenceMatcher(None, a, b).ratio() >= 0.5:
        return True
    palabras_a = {p for p in a.split() if len(p) >= 4}
    return bool(palabras_a & set(b.split()))


def _comparable(campo: str, valor) -> str:
    if valor is None:
        return ''
    if hasattr(valor, 'isoformat'):
        valor = valor.isoformat()
    texto = str(valor).strip().upper()
    if campo == 'fecha_hora_transporte':
        return re.sub(r'[^0-9]', '', texto)[:12]  # AAAAMMDDHHMM
    if campo in ('peso_kg', 'bultos'):
        try:
            return f'{float(texto.replace(",", ".")):.2f}'
        except ValueError:
            return texto
    return re.sub(r'[^A-Z0-9]', '', texto)


# ── 1. Registrar lo que se leyó ─────────────────────────────────────────────

def registrar_lecturas(expedicion, documento, plantilla, leido: dict | None, propuesto: dict | None,
                       dudosos=(), fuentes: dict | None = None) -> int:
    """Apunta una LecturaCampoDeca por cada campo con valor, leído o
    propuesto. Devuelve cuántas. No lanza nunca."""
    leido, propuesto, fuentes = leido or {}, propuesto or {}, fuentes or {}
    try:
        filas = []
        for campo in set(leido) | set(propuesto):
            if campo == 'campos_dudosos':
                continue
            valor_leido = leido.get(campo)
            valor_propuesto = propuesto.get(campo, valor_leido)
            if valor_leido in (None, '') and valor_propuesto in (None, ''):
                continue
            filas.append(LecturaCampoDeca(
                expedicion=expedicion, documento=documento, plantilla=plantilla,
                campo=campo, valor_leido=str(valor_leido or ''), valor_propuesto=str(valor_propuesto or ''),
                fuente=fuentes.get(campo, LecturaCampoDeca.Fuente.IA), dudoso=campo in (dudosos or ()),
            ))
        LecturaCampoDeca.objects.bulk_create(filas)
        return len(filas)
    except Exception:
        logger.exception('No se pudieron registrar las lecturas del documento DeCA %s', getattr(documento, 'id', None))
        return 0


# ── 2. Resolver al generar y aprender sinónimos ─────────────────────────────

def resolver_lecturas(expedicion: ExpedicionDeca) -> int:
    """Al generar el DeCA: guarda el valor final de cada lectura pendiente y
    aprende los sinónimos de lo que la persona corrigió. Devuelve cuántos
    sinónimos se han aprendido o reforzado. No lanza nunca."""
    try:
        ahora = timezone.now()
        pendientes = list(expedicion.lecturas.filter(corregido__isnull=True))
        aprendidos = set()
        for lectura in pendientes:
            final = getattr(expedicion, lectura.campo, None)
            lectura.valor_final = '' if final is None else (final.isoformat() if hasattr(final, 'isoformat') else str(final))
            lectura.corregido = _comparable(lectura.campo, final) != _comparable(lectura.campo, lectura.valor_propuesto)
            lectura.fecha_resolucion = ahora
            if lectura.campo in _ROL_POR_CAMPO and lectura.valor_leido:
                rol, _ = _ROL_POR_CAMPO[lectura.campo]
                aprendidos.add((rol, lectura.valor_leido))
        LecturaCampoDeca.objects.bulk_update(pendientes, ['valor_final', 'corregido', 'fecha_resolucion'])

        total = 0
        for rol, valor_leido in aprendidos:
            if _aprender_sinonimo(expedicion, rol, valor_leido, ahora):
                total += 1
        return total
    except Exception:
        logger.exception('No se pudo aprender de la expedición DeCA %s', expedicion.id)
        return 0


def _aprender_sinonimo(expedicion, rol: str, valor_leido: str, ahora) -> bool:
    campo = _CAMPO_POR_ROL[rol]
    campo_nif = _ROL_POR_CAMPO[campo][1]
    final = getattr(expedicion, campo) or ''
    nif = getattr(expedicion, campo_nif) if campo_nif else ''
    texto = clave(rol, valor_leido)
    if not texto or not final or texto == clave(rol, final):
        return False  # se leyó igual que la ficha: ya se reconoce sin sinónimo
    if campo_nif and not nif:
        return False  # sin NIF no hay ficha fiable a la que apuntar
    if not _parecidos(rol, valor_leido, final):
        return False  # la persona eligió OTRA empresa/vehículo, no es un sinónimo

    alias, creado = AliasAgendaDeca.objects.get_or_create(
        rol=rol, texto=texto,
        defaults={'texto_original': valor_leido[:255], 'nombre': final, 'nif': nif or '', 'ultima_confirmacion': ahora},
    )
    if creado:
        return True
    if alias.nombre == final and alias.nif == (nif or ''):
        alias.veces_confirmado += 1
    else:
        # Apuntaba a otra ficha: manda la última decisión y vuelve a empezar la cuenta.
        alias.nombre, alias.nif, alias.veces_confirmado = final, nif or '', 1
    alias.ultima_confirmacion = ahora
    alias.save(update_fields=['nombre', 'nif', 'veces_confirmado', 'ultima_confirmacion', 'fecha_actualizacion'])
    return True


# ── 3. Aplicar sinónimos en la siguiente lectura ────────────────────────────

def aplicar_sinonimos(empresa, campos: dict | None) -> tuple[dict, list[str], dict]:
    """Traduce a la ficha de la Agenda lo que la empresa ya enseñó.
    Devuelve `(cambios, a_revisar, fuentes)`."""
    cambios, a_revisar, fuentes = {}, [], {}
    if not campos:
        return cambios, a_revisar, fuentes
    alias_por_rol = {}
    for alias in AliasAgendaDeca.objects.all():
        alias_por_rol.setdefault(alias.rol, {})[alias.texto] = alias

    for campo, (rol, campo_nif) in _ROL_POR_CAMPO.items():
        valor = (campos.get(campo) or '').strip()
        alias = alias_por_rol.get(rol, {}).get(clave(rol, valor)) if valor else None
        if not alias:
            continue
        nif_leido = (campos.get(campo_nif) or '').strip() if campo_nif else ''
        if campo_nif and nif_leido and nif_leido.upper() != alias.nif.upper():
            continue  # la IA leyó un NIF distinto: no se pisa con una suposición
        cambios[campo] = alias.nombre
        fuentes[campo] = LecturaCampoDeca.Fuente.SINONIMO
        if campo_nif:
            cambios[campo_nif] = alias.nif
            fuentes[campo_nif] = LecturaCampoDeca.Fuente.SINONIMO
        if not alias.fiable:
            a_revisar.extend([campo] + ([campo_nif] if campo_nif else []))
    return cambios, a_revisar, fuentes


def corregir_matriculas(empresa, campos: dict | None) -> tuple[dict, list[str], dict]:
    """Repara matrículas mal leídas: primero contra la Agenda (una conocida
    que solo difiere en caracteres confundibles) y, si no, llevándola al
    formato 1234ABC. Siempre se propone para revisar."""
    cambios, a_revisar, fuentes = {}, [], {}
    if not campos:
        return cambios, a_revisar, fuentes
    modelos = {'matricula_tractor': TractoraDeca, 'matricula_remolque': RemolqueDeca}
    for campo in _CAMPOS_MATRICULA:
        leida = _matricula(campos.get(campo) or '')
        if not leida:
            continue
        conocidas = list(modelos[campo].objects.all().values_list('matricula', flat=True))
        if leida in conocidas:
            continue
        candidatas = [m for m in conocidas if matriculas_confundibles(leida, m)]
        propuesta = candidatas[0] if len(candidatas) == 1 else None
        if propuesta is None and not _RE_MATRICULA.match(leida):
            propuesta = reparar_formato_matricula(leida)
        if propuesta:
            cambios[campo] = propuesta
            a_revisar.append(campo)
            fuentes[campo] = LecturaCampoDeca.Fuente.CORRECCION
    return cambios, a_revisar, fuentes


# ── 4. Candidatos cerrados para la IA ───────────────────────────────────────

def pistas_candidatos(empresa) -> str:
    """Texto para el prompt con los nombres y matrículas conocidos de ESTA
    empresa (y cómo suelen aparecer escritos), para que en lo manuscrito o
    poco legible la IA elija uno de ellos en vez de transcribir a ciegas.
    Cadena vacía si la Agenda está vacía."""
    try:
        secciones = []
        empresas_por_rol = (
            ('transportista', 'nombre_transportista', EmpresaTransportistaDeca),
            ('cargador', 'nombre_cargador', CargadorDeca),
            ('destinatario', 'nombre_destinatario', DestinatarioDeca),
            ('conductor', 'nombre_conductor', ConductorDeca),
        )
        alias_por_rol = {}
        for alias in AliasAgendaDeca.objects.all().order_by('-veces_confirmado'):
            alias_por_rol.setdefault((alias.rol, alias.nombre), []).append(alias.texto_original or alias.texto)

        for rol, campo, modelo in empresas_por_rol:
            fichas = modelo.objects.filter(activo=True).order_by('-fecha_actualizacion')[:MAXIMO_CANDIDATOS_POR_ROL]
            lineas = []
            for ficha in fichas:
                otros = alias_por_rol.get((rol, ficha.nombre), [])[:3]
                extra = f' (también aparece escrito: {", ".join(otros)})' if otros else ''
                lineas.append(f'  - {ficha.nombre} [NIF {ficha.nif}]{extra}')
            if lineas:
                secciones.append(f'{campo}:\n' + '\n'.join(lineas))

        for rol, campo, modelo in (('tractora', 'matricula_tractor', TractoraDeca), ('remolque', 'matricula_remolque', RemolqueDeca)):
            matriculas = list(
                modelo.objects.filter(activo=True).order_by('-fecha_actualizacion')
                .values_list('matricula', flat=True)[:MAXIMO_CANDIDATOS_POR_ROL]
            )
            if matriculas:
                secciones.append(f'{campo}: ' + ', '.join(matriculas))

        if not secciones:
            return ''
        return (
            'Valores ya conocidos por esta empresa. Si un dato está escrito a mano, abreviado o se lee mal '
            'y se parece claramente a uno de estos, devuelve EXACTAMENTE el valor de la lista (con su NIF si '
            'lo lleva) y añádelo a campos_dudosos. Si no se parece a ninguno, devuélvelo tal como lo lees; '
            'nunca elijas uno de la lista solo por descarte.\n' + '\n'.join(secciones)
        )
    except Exception:
        logger.exception('No se pudieron preparar los candidatos de la Agenda para la IA')
        return ''


# ── Fase 2: aprender por modelo de documento y medirlo ──────────────────────

# Campos cuyo valor cambia en CADA envío (a diferencia del nombre y NIF de
# cargador, transportista o destinatario): una corrección suya nunca es un
# ejemplo útil -- el peso de hoy no dice nada del de mañana, y dárselo a la
# IA solo la empujaría a repetirlo (aclarado por el usuario 2026-09-28). Se
# siguen midiendo en la precisión de lectura, pero no se enseñan.
_CAMPOS_VARIABLES = frozenset({
    'fecha_hora_transporte', 'peso_kg', 'bultos', 'volumen_m3', 'numero_albaran', 'numero_cmr',
    'numero_pedido', 'comentarios',
})
MAXIMO_EJEMPLOS_CORRECCION = 8
# Valores fijos: cuántos DeCA generados seguidos con el mismo valor hacen
# falta para PROPONERLO (nunca se aplica solo: lo acepta el administrador).
MINIMO_REPETICIONES_VALOR_FIJO = 5
VENTANA_VALOR_FIJO = 10


def correcciones_recientes(empresa, plantilla=None, limite: int = MAXIMO_EJEMPLOS_CORRECCION) -> list[str]:
    """Últimas lecturas que una persona tuvo que corregir, como ejemplos para
    la IA: `campo: se leyó "X" -> era "Y"`. Con `plantilla`, solo las de ese
    modelo; sin ella, las de toda la empresa que no son de ningún modelo.
    Nunca de campos que cambian en cada envío (`_CAMPOS_VARIABLES`)."""
    qs = (
        LecturaCampoDeca.objects.filter(corregido=True)
        .exclude(valor_leido='').exclude(campo__in=_CAMPOS_VARIABLES)
    )
    if plantilla is not None:
        qs = qs.filter(plantilla=plantilla)
    else:
        qs = qs.filter(plantilla__isnull=True)
    ejemplos, vistos = [], set()
    for lectura in qs.order_by('-fecha_resolucion')[:limite * 4]:
        clave_ejemplo = (lectura.campo, lectura.valor_leido.strip().upper(), lectura.valor_final.strip().upper())
        if clave_ejemplo in vistos or not lectura.valor_final:
            continue
        vistos.add(clave_ejemplo)
        ejemplos.append(f'{lectura.campo}: se leyó "{lectura.valor_leido[:80]}" -> era "{lectura.valor_final[:80]}"')
        if len(ejemplos) >= limite:
            break
    return ejemplos


def pistas_correcciones_empresa(empresa) -> str:
    """Bloque para el prompt con los errores de lectura que ya se corrigieron
    en documentos sin modelo. Vacío si no hay ninguno."""
    try:
        ejemplos = correcciones_recientes(empresa)
    except Exception:
        logger.exception('No se pudieron preparar las correcciones recientes para la IA')
        return ''
    if not ejemplos:
        return ''
    return (
        'Errores de lectura que las personas de esta empresa ya corrigieron en documentos anteriores. '
        'No los repitas: si vuelves a ver lo mismo escrito, devuelve el valor corregido y márcalo en '
        'campos_dudosos.\n' + '\n'.join(f'  - {e}' for e in ejemplos)
    )


def sugerencias_valores_fijos(plantilla) -> list[dict]:
    """Datos que han salido IGUALES en los últimos DeCA generados con este
    modelo y que todavía no son valor fijo: se PROPONEN al administrador
    (`[{campo, valor, veces}]`), nunca se aplican solos."""
    from deca.services.plantillas_service import CAMPOS_FIJABLES

    expediciones = list(
        ExpedicionDeca.objects.filter(
            lecturas__plantilla=plantilla, estado=ExpedicionDeca.Estado.GENERADO,
        ).distinct().order_by('-fecha_generacion')[:VENTANA_VALOR_FIJO]
    )
    if len(expediciones) < MINIMO_REPETICIONES_VALOR_FIJO:
        return []
    ya_fijos = {k for k, v in (plantilla.valores_fijos or {}).items() if v}
    sugerencias = []
    for campo in CAMPOS_FIJABLES:
        if campo in ya_fijos:
            continue
        valores = [(getattr(e, campo) or '').strip() for e in expediciones]
        if valores[0] and len({v.upper() for v in valores}) == 1:
            sugerencias.append({'campo': campo, 'valor': valores[0], 'veces': len(valores)})
    return sugerencias


def _porcentaje(aciertos: int, total: int) -> float | None:
    return round(100 * aciertos / total, 1) if total else None


def precision_lectura(empresa, desde=None) -> dict:
    """Cuánto acierta la lectura automática: % de campos que nadie tuvo que
    corregir, en total, en lo manuscrito, por campo, por modelo y por mes.
    Solo cuenta lecturas ya resueltas (DeCA generados)."""
    from django.db.models import Count, Q
    from django.db.models.functions import TruncMonth

    qs = LecturaCampoDeca.objects.filter(corregido__isnull=False)
    if desde is not None:
        qs = qs.filter(fecha_resolucion__gte=desde)
    acierto = Count('id', filter=Q(corregido=False))

    total = qs.count()
    aciertos = qs.filter(corregido=False).count()
    manuscritas = qs.filter(dudoso=True)
    total_m = manuscritas.count()
    aciertos_m = manuscritas.filter(corregido=False).count()

    por_campo = [
        {'campo': f['campo'], 'total': f['total'], 'corregidas': f['total'] - f['aciertos'],
         'porcentaje': _porcentaje(f['aciertos'], f['total'])}
        for f in qs.values('campo').annotate(total=Count('id'), aciertos=acierto).order_by('campo')
    ]
    por_modelo = [
        {'modelo': f['plantilla__nombre'] or '', 'total': f['total'],
         'porcentaje': _porcentaje(f['aciertos'], f['total'])}
        for f in qs.values('plantilla__nombre').annotate(total=Count('id'), aciertos=acierto).order_by('plantilla__nombre')
    ]
    por_mes = [
        {'mes': f['mes'].strftime('%Y-%m'), 'total': f['total'], 'porcentaje': _porcentaje(f['aciertos'], f['total'])}
        for f in qs.annotate(mes=TruncMonth('fecha_resolucion')).values('mes')
        .annotate(total=Count('id'), aciertos=acierto).order_by('mes') if f['mes']
    ]
    return {
        'total': total, 'porcentaje': _porcentaje(aciertos, total),
        'manuscritas': {'total': total_m, 'porcentaje': _porcentaje(aciertos_m, total_m)},
        'por_campo': por_campo, 'por_modelo': por_modelo, 'por_mes': por_mes,
    }
