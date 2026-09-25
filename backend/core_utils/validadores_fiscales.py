"""
Validación del dígito de control de identificadores fiscales españoles
(DNI/NIF, NIE y CIF).

Copiado tal cual de `core/validadores_fiscales.py` del ERP origen -- es
lógica pura sin ninguna dependencia de tenant/empresa.

**Estas funciones NUNCA lanzan y NUNCA se usan para rechazar un alta.** El
resultado se usa como pista de calidad de dato (aviso), no como barrera dura
más allá de lo que el propio serializer de deca decida.
"""

import re

_LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'
_LETRAS_CIF_CONTROL = 'JABCDEFGHI'
# Letras de organización de un CIF cuyo dígito de control DEBE ser una letra
# (K, P, Q, S: entidades sin ánimo de lucro, organismos...) o un número
# (A, B, E, H: sociedades mercantiles). El resto admite cualquiera de los dos.
_CIF_ORG_SOLO_LETRA = set('KPQS')
_CIF_ORG_SOLO_NUMERO = set('ABEH')

_RE_DNI = re.compile(r'^\d{8}[A-Z]$')
_RE_NIE = re.compile(r'^[XYZ]\d{7}[A-Z]$')
_RE_CIF = re.compile(r'^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$')


def normalizar(valor):
    """Mayúsculas, sin espacios ni guiones. Devuelve '' si entra None."""
    return re.sub(r'[\s\-.]', '', (valor or '').upper())


def _letra_dni_correcta(numero_8):
    return _LETRAS_DNI[int(numero_8) % 23]


def validar_dni(valor):
    v = normalizar(valor)
    if not _RE_DNI.match(v):
        return False
    return v[8] == _letra_dni_correcta(v[:8])


def validar_nie(valor):
    v = normalizar(valor)
    if not _RE_NIE.match(v):
        return False
    numero = {'X': '0', 'Y': '1', 'Z': '2'}[v[0]] + v[1:8]
    return v[8] == _letra_dni_correcta(numero)


def validar_cif(valor):
    v = normalizar(valor)
    if not _RE_CIF.match(v):
        return False
    org, digitos, control = v[0], v[1:8], v[8]

    suma_par = sum(int(d) for d in digitos[1::2])
    suma_impar = 0
    for d in digitos[0::2]:
        doble = int(d) * 2
        suma_impar += doble // 10 + doble % 10
    digito_control = (10 - (suma_par + suma_impar) % 10) % 10
    letra_control = _LETRAS_CIF_CONTROL[digito_control]

    if org in _CIF_ORG_SOLO_LETRA:
        return control == letra_control
    if org in _CIF_ORG_SOLO_NUMERO:
        return control == str(digito_control)
    return control == str(digito_control) or control == letra_control


def validar_nif_persona(valor):
    """DNI o NIE — el identificador de un autónomo o un particular."""
    return validar_dni(valor) or validar_nie(valor)


def validar_identificador_fiscal(valor, tipo_titular):
    """
    True si el dígito de control cuadra para el tipo de titular indicado.
    'empresa' -> CIF (o NIF, hay autónomos que se registran como empresa);
    'autonomo'/'particular' -> NIF (DNI/NIE).
    Cualquier otro valor de `tipo_titular` -> se acepta CIF o NIF.
    """
    v = normalizar(valor)
    if not v:
        return False
    if tipo_titular == 'empresa':
        return validar_cif(v) or validar_nif_persona(v)
    if tipo_titular in ('autonomo', 'particular'):
        return validar_nif_persona(v)
    return validar_cif(v) or validar_nif_persona(v)
