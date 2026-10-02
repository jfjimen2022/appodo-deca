"""Alimenta los catálogos reutilizables (ConductorDeca, EmpresaTransportistaDeca,
TractoraDeca, RemolqueDeca...) a partir de los datos sueltos de una expedición
-- para que la próxima vez no haga falta volver a teclearlos. Nunca falla la
expedición si esto falla: es un efecto secundario de conveniencia, no una
escritura crítica.

Sin filtro por empresa (a diferencia del ERP origen): en esta instalación
solo hay una empresa, así que el NIF/matrícula es único a nivel de instancia
entera (ver `unique=True` en los modelos)."""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from deca.models import (
    CargadorDeca, ConductorDeca, DestinatarioDeca, EmpresaTransportistaDeca, ExpedicionDeca,
    RemolqueDeca, TractoraDeca,
)

# Formas societarias españolas más comunes -- se ignoran al comparar el
# "núcleo" de una razón social ("Distrinorte" y "Distrinorte S.A." deben
# considerarse la MISMA empresa, no una coincidencia dudosa). Lista
# deliberadamente corta y de formas inequívocas -- una palabra ambigua aquí
# (ej. "SC" también podría ser parte de un nombre propio) daría falsos
# positivos, así que solo se listan las que no se prestan a confusión.
_SUFIJOS_SOCIETARIOS = frozenset({
    'SA', 'SL', 'SLU', 'SAU', 'SLNE', 'SCOOP', 'SLP', 'SC', 'SCP', 'SAT',
})

# Umbral de similitud (0-1, `difflib.SequenceMatcher.ratio`) por debajo del
# cual una coincidencia "difusa" se descarta por no ser de fiar -- ajustado
# para tolerar un error de OCR/transcripción típico (una letra cambiada o
# un carácter de más/menos en un nombre corto), no para adivinar entre
# nombres genuinamente distintos.
UMBRAL_COINCIDENCIA_DIFUSA = 0.80


def _normalizar_nombre_empresa(nombre: str) -> str:
    """Para comparar razones sociales tolerando diferencias tipográficas que
    no cambian la identidad de la empresa: mayúsculas, puntos ("S.A." vs
    "S.A" vs "SA"), espacios dobles. Un `iexact` a pelo fallaba en
    producción con "Distrinorte S.A." (catálogo) vs "DISTRINORTE S.A" (lo que
    devolvió la IA en la foto real, sin el punto final) -- bug real
    detectado 2026-09-25."""
    sin_puntos = re.sub(r'[.,]', '', nombre.upper())
    return re.sub(r'\s+', ' ', sin_puntos).strip()


def _nucleo_nombre_empresa(nombre: str) -> str:
    """Como `_normalizar_nombre_empresa`, pero quitando además la forma
    societaria final -- "Distrinorte" y "Distrinorte S.A." deben tratarse como
    coincidencia TOTAL (sin aviso de revisión), no como una suposición.
    Pedido explícito del usuario 2026-09-25."""
    palabras = _normalizar_nombre_empresa(nombre).split(' ')
    while palabras and palabras[-1] in _SUFIJOS_SOCIETARIOS:
        palabras.pop()
    return ' '.join(palabras)


def guardar_conductor_de(expedicion: ExpedicionDeca) -> ConductorDeca | None:
    """Crea o actualiza la ficha del conductor de `expedicion` en el catálogo,
    si hay nombre y NIF informados. Sin NIF no hay forma fiable de identificar
    al mismo conductor la próxima vez, así que no se guarda nada."""
    if not (expedicion.nombre_conductor and expedicion.nif_conductor):
        return None

    conductor, _creado = ConductorDeca.objects.update_or_create(
        nif=expedicion.nif_conductor,
        defaults={
            'nombre': expedicion.nombre_conductor,
            'telefono': expedicion.telefono_conductor,
            'email': expedicion.email_conductor,
        },
    )
    return conductor


def guardar_transportista_de(expedicion: ExpedicionDeca) -> EmpresaTransportistaDeca | None:
    """Crea o actualiza la ficha de la empresa transportista de `expedicion`
    en el catálogo. El teléfono/email no están en ExpedicionDeca (solo NIF/
    nombre son mínimo legal) -- se conservan los que ya hubiera en el
    catálogo si la ficha ya existía, en vez de borrarlos."""
    if not (expedicion.nombre_transportista and expedicion.nif_transportista):
        return None

    transportista, creado = EmpresaTransportistaDeca.objects.get_or_create(
        nif=expedicion.nif_transportista,
        defaults={'nombre': expedicion.nombre_transportista},
    )
    if not creado and transportista.nombre != expedicion.nombre_transportista:
        transportista.nombre = expedicion.nombre_transportista
        transportista.save(update_fields=['nombre', 'fecha_actualizacion'])
    return transportista


def guardar_destinatario_de(expedicion: ExpedicionDeca) -> DestinatarioDeca | None:
    """Crea o actualiza la ficha del destinatario de `expedicion` en el
    catálogo. Mismo criterio que el transportista: sin NIF no hay forma
    fiable de reconocer al mismo destinatario la próxima vez."""
    if not (expedicion.nombre_destinatario and expedicion.nif_destinatario):
        return None

    destinatario, creado = DestinatarioDeca.objects.get_or_create(
        nif=expedicion.nif_destinatario,
        defaults={'nombre': expedicion.nombre_destinatario},
    )
    if not creado and destinatario.nombre != expedicion.nombre_destinatario:
        destinatario.nombre = expedicion.nombre_destinatario
        destinatario.save(update_fields=['nombre', 'fecha_actualizacion'])
    return destinatario


def guardar_cargador_de(expedicion: ExpedicionDeca) -> CargadorDeca | None:
    """Crea o actualiza la ficha del cargador de `expedicion` en el catálogo.
    Mismo criterio que transportista/destinatario: sin NIF no hay forma
    fiable de reconocer al mismo cargador la próxima vez."""
    if not (expedicion.nombre_cargador and expedicion.nif_cargador):
        return None

    cargador, creado = CargadorDeca.objects.get_or_create(
        nif=expedicion.nif_cargador,
        defaults={'nombre': expedicion.nombre_cargador, 'domicilio': expedicion.domicilio_cargador},
    )
    if not creado:
        cambios = []
        if cargador.nombre != expedicion.nombre_cargador:
            cargador.nombre = expedicion.nombre_cargador
            cambios.append('nombre')
        # El domicilio solo se actualiza si la expedición trae uno: una
        # expedición sin domicilio no debe borrar el que ya tenía la agenda.
        if expedicion.domicilio_cargador and cargador.domicilio != expedicion.domicilio_cargador:
            cargador.domicilio = expedicion.domicilio_cargador
            cambios.append('domicilio')
        if cambios:
            cargador.save(update_fields=[*cambios, 'fecha_actualizacion'])
    return cargador


def guardar_tractora_de(expedicion: ExpedicionDeca) -> TractoraDeca | None:
    """Crea la ficha de la tractora de `expedicion` en el catálogo si hay
    matrícula informada y todavía no existía -- catálogo independiente del
    remolque (ver docstring de `TractoraDeca`), así que aquí no se toca nada
    más que la propia tractora."""
    if not expedicion.matricula_tractor:
        return None
    tractora, _creada = TractoraDeca.objects.get_or_create(matricula=expedicion.matricula_tractor)
    return tractora


def guardar_remolque_de(expedicion: ExpedicionDeca) -> RemolqueDeca | None:
    """Igual que `guardar_tractora_de` pero para el remolque -- catálogo
    independiente, no se combinan en una sola ficha."""
    if not expedicion.matricula_remolque:
        return None
    remolque, _creado = RemolqueDeca.objects.get_or_create(matricula=expedicion.matricula_remolque)
    return remolque


# ── La Agenda manda (2026-10-01) ──────────────────────────────────────────
# Un NIF de la Agenda lo confirmó una persona en un DeCA anterior: vale más
# que cualquier lectura, sobre todo de letra a mano. Bug real que lo motivó:
# con un albarán de empresa + cliente + transportista, el reparto por orden
# dejaba al transportista con el NIF del cliente, aunque el transportista
# estaba en la Agenda con su NIF correcto (la Agenda solo tapaba huecos).
#
# Orden: lo que escribe una persona > Agenda > IA > reparto por orden. Se
# activa con ConfiguracionDeca.agenda_prioritaria (encendido de fábrica).

_ROLES_EMPRESA = ('cargador', 'transportista', 'destinatario')


def _normalizar_nif(valor) -> str:
    return re.sub(r'[\s.\-]', '', str(valor or '')).upper()


def _fichas(empresa, rol):
    campos = ['nombre', 'nif'] + (['domicilio'] if rol == 'cargador' else [])
    return [f for f in _MODELO_POR_ROL[rol].objects.all().only(*campos) if f.nif]


def aplicar_prioridad_agenda(empresa, campos: dict | None, nifs_regex=None) -> dict:
    """Corrige lo leído (IA, sinónimos...) con la Agenda de la empresa.

    Por cada parte (cargador, transportista, destinatario, conductor):
    - El NIF leído está en la Agenda de esa parte -> se usa el nombre de la
      ficha (letra a mano mal leída); si el papel decía otro nombre, aviso.
    - El nombre leído coincide (núcleo exacto) con una ficha -> se usan su NIF
      (y domicilio, en el cargador); si el papel traía otro NIF, aviso.
    - El NIF leído es, en la Agenda, de OTRA empresa (ni coincide el nombre)
      -> no se coloca: se deja vacío y se avisa. Es el cruce de NIF típico.

    Además resuelve el papel de los NIF que la lectura por patrones encontró
    sin saber de quién son (`nifs_regex`): `nifs_agenda` = {nif: [roles]}.

    Devuelve {'cambios', 'a_revisar', 'avisos', 'nifs_agenda'}. Nunca toca lo
    que escribió una persona: solo trabaja sobre lo leído del documento."""
    campos = dict(campos or {})
    cambios, a_revisar, avisos = {}, [], []
    fichas = {rol: _fichas(empresa, rol) for rol in _MODELO_POR_ROL}
    por_nif = {}
    for rol, lista in fichas.items():
        for ficha in lista:
            por_nif.setdefault(_normalizar_nif(ficha.nif), []).append((rol, ficha))

    for rol in _MODELO_POR_ROL:
        campo_nif, campo_nombre = f'nif_{rol}', f'nombre_{rol}'
        nif = _normalizar_nif(campos.get(campo_nif))
        nombre = (campos.get(campo_nombre) or '').strip()
        nucleo = _nucleo_nombre_empresa(nombre) if nombre else ''

        propia = next((f for r, f in por_nif.get(nif, []) if r == rol), None) if nif else None
        if propia:
            if nombre and nucleo != _nucleo_nombre_empresa(propia.nombre):
                avisos.append(
                    f'{rol.capitalize()}: en el documento se lee «{nombre}», pero en tu agenda el NIF {nif} '
                    f'es de «{propia.nombre}». Se ha puesto el de la agenda; compruébalo.'
                )
                a_revisar.append(campo_nombre)
            if nombre != propia.nombre:
                cambios[campo_nombre] = propia.nombre
            if rol == 'cargador' and propia.domicilio and not campos.get('domicilio_cargador'):
                cambios['domicilio_cargador'] = propia.domicilio
            continue

        coinciden = [f for f in fichas[rol] if nucleo and _nucleo_nombre_empresa(f.nombre) == nucleo]
        nifs_coinciden = sorted({_normalizar_nif(f.nif) for f in coinciden})
        if len(nifs_coinciden) > 1:
            # Varias fichas con el mismo nombre y NIF distintos (agenda con
            # datos de prueba o de un DeCA mal hecho): no se elige a ciegas.
            avisos.append(
                f'{rol.capitalize()} «{nombre}»: en tu agenda aparece con varios NIF '
                f'({", ".join(nifs_coinciden)}). Revisa la agenda y deja solo el bueno.'
            )
            if nif not in nifs_coinciden:
                a_revisar.append(campo_nif)
            continue
        por_nombre = coinciden[0] if coinciden else None
        if por_nombre:
            nif_agenda = _normalizar_nif(por_nombre.nif)
            if nif and nif != nif_agenda:
                avisos.append(
                    f'{rol.capitalize()} «{por_nombre.nombre}»: en el documento se lee el NIF {nif}, pero en tu '
                    f'agenda es {nif_agenda}. Se ha puesto el de la agenda; compruébalo.'
                )
                a_revisar.append(campo_nif)
            if nif != nif_agenda:
                cambios[campo_nif] = nif_agenda
            if rol == 'cargador' and por_nombre.domicilio and not campos.get('domicilio_cargador'):
                cambios['domicilio_cargador'] = por_nombre.domicilio
            continue

        ajena = next((f for r, f in por_nif.get(nif, []) if r != rol), None) if nif else None
        if ajena and (not nucleo or nucleo != _nucleo_nombre_empresa(ajena.nombre)):
            avisos.append(
                f'{rol.capitalize()}: la lectura le puso el NIF {nif}, que en tu agenda es de «{ajena.nombre}». '
                f'Se ha dejado vacío para que lo completes.'
            )
            cambios[campo_nif] = ''
            a_revisar.append(campo_nif)

    nifs_agenda = {}
    for crudo in nifs_regex or []:
        nif = _normalizar_nif(crudo)
        roles = sorted({r for r, _f in por_nif.get(nif, []) if r in _ROLES_EMPRESA})
        if roles:
            nifs_agenda[nif] = roles

    return {'cambios': cambios, 'a_revisar': a_revisar, 'avisos': avisos, 'nifs_agenda': nifs_agenda}


# Catálogo por rol para `completar_nifs_desde_catalogo` -- mismo criterio de
# nombres de campo que `extraction_ia_service.CAMPOS_DECA_IA`.
_MODELO_POR_ROL = {
    'cargador': CargadorDeca,
    'transportista': EmpresaTransportistaDeca,
    'destinatario': DestinatarioDeca,
    'conductor': ConductorDeca,
}


def completar_nifs_desde_catalogo(empresa, campos_ia: dict | None) -> tuple[dict, list[str]]:
    """Segundo pase sobre lo que ya extrajo la IA (foto o documento): cuando
    el documento trae el nombre de una parte (cargador/transportista/
    destinatario/conductor) pero NO su NIF -- muy habitual, el NIF suele ir en
    letra pequeña, sellado o simplemente no aparece en un CMR -- se busca
    ese nombre en el catálogo de la Agenda de la empresa (alimentado por
    expediciones anteriores, ver `guardar_*_de` arriba) y se rellena el NIF
    desde ahí. Devuelve `(completados, a_revisar)`: `completados` son los
    `nif_<rol>` rellenados, `a_revisar` son los campos (nif Y nombre) que
    conviene que el humano confirme porque la coincidencia no era exacta.

    Dos niveles de coincidencia (pedido explícito del usuario 2026-09-25):
    1. NÚCLEO exacto ("Distrinorte" == "Distrinorte S.A." una vez quitada la
       forma societaria): se rellena sin marcar nada, es la misma empresa.
    2. DIFUSA (similitud de texto por encima de `UMBRAL_COINCIDENCIA_DIFUSA`,
       tolera errores de OCR/transcripción tipo "Translogic" vs "Translogik"
       o "Distrinorte" vs "Mercadono"): se rellena TAMBIÉN, pero tanto el NIF
       como el propio nombre extraído se devuelven en `a_revisar` para que
       la pantalla los marque en rojo -- puede que la IA se haya
       equivocado leyendo el nombre, o que sea una empresa distinta que
       simplemente se parece.

    Nunca sobreescribe un NIF que la IA ya hubiera encontrado -- solo tapa
    huecos. Sigue siendo una SUGERENCIA que el humano revisa antes de
    guardar, igual que el resto de campos de IA."""
    if not campos_ia:
        return {}, []

    completados: dict[str, str] = {}
    a_revisar: list[str] = []
    for rol, modelo in _MODELO_POR_ROL.items():
        campo_nombre = f'nombre_{rol}'
        campo_nif = f'nif_{rol}'
        nombre = (campos_ia.get(campo_nombre) or '').strip()
        if not nombre or campos_ia.get(campo_nif):
            continue
        nucleo_objetivo = _nucleo_nombre_empresa(nombre)
        if not nucleo_objetivo:
            continue

        # Catálogo por empresa: en la práctica son decenas/cientos de
        # fichas, nunca miles -- comparar en Python es más simple y fiable
        # que intentar esta lógica (núcleo + similitud) directamente en SQL.
        mejor_difusa = None
        mejor_ratio = 0.0
        for ficha in modelo.objects.all().only('nombre', 'nif'):
            if not ficha.nif:
                continue
            nucleo_ficha = _nucleo_nombre_empresa(ficha.nombre)
            if nucleo_ficha == nucleo_objetivo:
                completados[campo_nif] = ficha.nif
                mejor_difusa = None  # coincidencia total encontrada, no hace falta la difusa
                break
            ratio = SequenceMatcher(None, nucleo_objetivo, nucleo_ficha).ratio()
            if ratio > mejor_ratio:
                mejor_ratio, mejor_difusa = ratio, ficha

        if campo_nif in completados:
            continue  # ya resuelto por coincidencia total
        if mejor_difusa and mejor_ratio >= UMBRAL_COINCIDENCIA_DIFUSA:
            completados[campo_nif] = mejor_difusa.nif
            a_revisar.extend([campo_nif, campo_nombre])

    return completados, a_revisar
