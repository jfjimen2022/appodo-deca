"""Claves de integración del DeCA: crear, comprobar y revocar.

Formato de la clave: `deca_<prefijo>_<secreto>`. El prefijo (8 caracteres
hexadecimales) no es secreto: sirve para encontrar la clave sin recorrer la
tabla y para que la persona la reconozca en la lista. El secreto sale de
`secrets` (256 bits), así que basta con guardar su SHA-256: no hace falta un
hash lento como el de las contraseñas, porque no se puede adivinar."""

import hashlib
import hmac
import secrets

from django.utils import timezone

from ..models import ClaveIntegracionDeca

PREFIJO_TEXTO = 'deca_'


def _huella(texto: str) -> str:
    """SHA-256 en hexadecimal del texto: es lo único que se guarda en BD."""
    return hashlib.sha256(texto.encode('utf-8')).hexdigest()


def crear_clave(nombre: str, usuario=None) -> tuple[ClaveIntegracionDeca, str]:
    """Crea la clave y devuelve también su texto completo: es la ÚNICA vez que
    existe en claro, quien llama debe enseñarlo y olvidarlo."""
    # El prefijo debe ser único (se usa para localizar la clave), así que
    # se regenera mientras ya exista otro igual. Es raro: 4 bytes = 4.000M de combinaciones.
    prefijo = secrets.token_hex(4)
    while ClaveIntegracionDeca.objects.filter(prefijo=prefijo).exists():
        prefijo = secrets.token_hex(4)
    texto = f'{PREFIJO_TEXTO}{prefijo}_{secrets.token_urlsafe(32)}'
    clave = ClaveIntegracionDeca.objects.create(
        nombre=nombre, prefijo=prefijo, hash_clave=_huella(texto), creada_por=usuario,
    )
    return clave, texto


def autenticar(texto: str) -> ClaveIntegracionDeca | None:
    """La clave activa que corresponde a `texto`, o None. Nunca dice por qué
    falla (no existe, revocada, secreto equivocado): las tres son lo mismo
    para quien llama."""
    if not texto or not texto.startswith(PREFIJO_TEXTO):
        return None
    # Se separa prefijo y secreto por el primer '_' (el secreto urlsafe
    # puede contener '_' o '-', por eso el límite de 1 corte).
    partes = texto[len(PREFIJO_TEXTO):].split('_', 1)
    if len(partes) != 2 or not partes[0] or not partes[1]:
        return None
    # Las revocadas (revocada_en con fecha) se ignoran.
    clave = ClaveIntegracionDeca.objects.filter(prefijo=partes[0], revocada_en__isnull=True).first()
    # compare_digest compara en tiempo constante: evita que alguien deduzca
    # la huella midiendo cuánto tarda en fallar la comparación.
    if clave is None or not hmac.compare_digest(clave.hash_clave, _huella(texto)):
        return None
    return clave


def anotar_uso(clave: ClaveIntegracionDeca) -> None:
    """Guarda la fecha del último uso de la clave (para mostrarla en la lista)."""
    # update_fields hace que el UPDATE solo toque esas columnas.
    clave.ultimo_uso = timezone.now()
    clave.save(update_fields=['ultimo_uso', 'fecha_actualizacion'])


def revocar(clave: ClaveIntegracionDeca, usuario=None) -> ClaveIntegracionDeca:
    """Desactiva la clave para siempre (no se borra, para conservar quién y
    cuándo). Si ya estaba revocada no hace nada: se conserva la fecha original."""
    if clave.revocada_en is None:
        clave.revocada_en = timezone.now()
        clave.revocada_por = usuario
        clave.save(update_fields=['revocada_en', 'revocada_por', 'fecha_actualizacion'])
    return clave
