"""
Validación del CONTENIDO de un documento subido (PDF / JPG / PNG) antes de
guardarlo.

Portado del ERP Appodo (core/validacion_ficheros.py). Por qué: mirar solo la
EXTENSIÓN del nombre y el tamaño deja pasar cualquier fichero renombrado a
`.pdf`, que luego se pasa a los lectores de PDF/imagen de la extracción
automática y queda disponible para que otro usuario lo descargue y lo abra en
su visor.

Qué comprueba:

1. **Que el contenido es lo que dice la extensión** (firma de los primeros
   bytes: `%PDF-`, JPEG `FF D8 FF`, PNG `89 50 4E 47`).
2. **PDF**: que se puede abrir y NO lleva contenido activo -- JavaScript,
   acciones automáticas al abrir (`/OpenAction` de tipo JavaScript/Launch,
   `/AA`), acciones en anotaciones, ni ficheros incrustados. Un albarán, un
   CMR o una factura nunca los necesitan; son el vector clásico de un PDF
   malicioso. Se busca en el catálogo con pypdf (que normaliza nombres
   ofuscados tipo `/J#61vaScript`).
3. **Imagen**: que Pillow la puede verificar, que el formato real coincide y
   que no es una "bomba de descompresión" (un PNG diminuto que al abrirse
   pide gigas de memoria).

Qué NO hace: no es un antivirus. Un PDF "limpio" que explota un fallo aún
desconocido del visor no se detecta aquí. Reduce la superficie a los
formatos esperados y sin contenido activo, que es lo proporcionado para
documentos de transporte.
"""
import io
import warnings

from PIL import Image

TAMANO_MAXIMO_POR_DEFECTO = 10 * 1024 * 1024
MAX_PIXELES_IMAGEN = 80_000_000  # una foto de móvil de 48-50 MP cabe holgada
MAX_PAGINAS_PDF = 200

EXTENSIONES = {
    'pdf': ('.pdf',),
    'jpg': ('.jpg', '.jpeg'),
    'png': ('.png',),
}

# Formatos que Pillow reporta para cada tipo. `MPO` es un JPEG normal que
# lleva dentro una segunda imagen (mapa de profundidad, foto "en movimiento"):
# así salen MUCHAS fotos de móvil (iPhone, Samsung...). v4.27.3 solo aceptaba
# 'JPEG' y rechazaba la foto de un albarán hecha con el móvil como "contenido
# que no corresponde a su extensión" (bug real en producción, 2026-09-26).
FORMATOS_PILLOW = {
    'jpg': {'JPEG', 'MPO'},
    'png': {'PNG'},
}

# OJO: v4.27.3 buscaba además `/JS`, `/JavaScript`... en los BYTES CRUDOS del
# PDF. Se quitó en v4.27.5: dentro de los datos comprimidos de una página esos
# bytes aparecen por pura casualidad, y rechazaba PDF legítimos -- medido
# sobre 72.000 ficheros reales, 37 falsos positivos, entre ellos los PDF DeCA
# que genera la propia app con ReportLab. La comprobación que vale es la del
# catálogo con pypdf (lee la estructura real y normaliza nombres ofuscados).
_ACCIONES_PELIGROSAS = {'/JavaScript', '/Launch', '/ImportData', '/SubmitForm', '/GoToE'}


class FicheroNoValido(ValueError):
    """El mensaje ya es legible para el usuario final."""


def _tipo_por_firma(cabecera: bytes):
    if b'%PDF-' in cabecera[:1024]:
        return 'pdf'
    if cabecera.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if cabecera.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    return None


def _tipo_por_extension(nombre: str):
    nombre = (nombre or '').lower()
    for tipo, extensiones in EXTENSIONES.items():
        if nombre.endswith(extensiones):
            return tipo
    return None


def _obj(valor):
    return valor.get_object() if hasattr(valor, 'get_object') else valor


def _accion_peligrosa(accion) -> bool:
    accion = _obj(accion)
    if not hasattr(accion, 'get'):
        return False  # un destino (array), no una acción
    return _obj(accion.get('/S')) in _ACCIONES_PELIGROSAS


def _validar_pdf(contenido: bytes) -> None:
    from pypdf import PdfReader

    activo = FicheroNoValido(
        'El PDF contiene contenido activo (JavaScript, acciones automáticas o '
        'ficheros incrustados) y no se admite por seguridad. Si es un documento '
        'legítimo, imprímelo a PDF de nuevo o súbelo como foto.'
    )
    try:
        reader = PdfReader(io.BytesIO(contenido), strict=False)
        if reader.is_encrypted and not reader.decrypt(''):
            raise FicheroNoValido('El PDF está protegido con contraseña y no se puede leer. Súbelo sin protección.')
        raiz = _obj(reader.trailer['/Root'])
        nombres = _obj(raiz.get('/Names')) or {}
        if '/JavaScript' in nombres or '/EmbeddedFiles' in nombres or '/AA' in raiz:
            raise activo
        if raiz.get('/OpenAction') is not None and _accion_peligrosa(raiz['/OpenAction']):
            raise activo
        num_paginas = len(reader.pages)
        if num_paginas > MAX_PAGINAS_PDF:
            raise FicheroNoValido(f'El PDF tiene demasiadas páginas ({num_paginas}); el máximo es {MAX_PAGINAS_PDF}.')
        for pagina in reader.pages:
            if '/AA' in pagina:
                raise activo
            for anotacion in _obj(pagina.get('/Annots')) or []:
                anotacion = _obj(anotacion)
                if '/AA' in anotacion or (anotacion.get('/A') is not None and _accion_peligrosa(anotacion['/A'])):
                    raise activo
    except FicheroNoValido:
        raise
    except Exception:
        raise FicheroNoValido('El PDF está dañado o no es un PDF válido.')


def _validar_imagen(contenido: bytes, tipo: str) -> None:
    try:
        with warnings.catch_warnings():
            # Por encima de MAX_IMAGE_PIXELS Pillow solo AVISA (y lanza error
            # al doble): aquí cualquier aviso de bomba es un rechazo.
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(contenido)) as imagen:
                ancho, alto = imagen.size
                formato = imagen.format
                if ancho * alto > MAX_PIXELES_IMAGEN:
                    raise FicheroNoValido('La imagen es demasiado grande (resolución excesiva).')
                imagen.verify()
    except FicheroNoValido:
        raise
    except Exception:
        raise FicheroNoValido('La imagen está dañada o no es una imagen válida.')
    if formato not in FORMATOS_PILLOW[tipo]:
        raise FicheroNoValido('La imagen está dañada o no es una imagen válida.')


def validar_documento(archivo, tipos=('pdf', 'jpg', 'png'), tamano_maximo=TAMANO_MAXIMO_POR_DEFECTO) -> str:
    """Valida un `UploadedFile` y devuelve su tipo real ('pdf'|'jpg'|'png').
    Lanza `FicheroNoValido` con un mensaje para el usuario. Deja el fichero
    rebobinado al principio para que se pueda guardar a continuación.

    Lo que decide es el CONTENIDO, no el nombre: si el contenido es de un tipo
    permitido pero la extensión no cuadra (un PNG llamado `.jpg`, algo normal
    cuando el móvil o una app renombran la foto), se acepta y se corrige la
    extensión de `archivo.name` -- así se guarda y se sirve con el tipo que es
    de verdad. Rechazarlo no protegía de nada: los dos tipos están permitidos
    y pasan las mismas comprobaciones."""
    if archivo.size > tamano_maximo:
        raise FicheroNoValido(f'El archivo supera el tamaño máximo permitido ({tamano_maximo // (1024 * 1024)} MB).')
    if archivo.size == 0:
        raise FicheroNoValido('El archivo está vacío.')

    tipo_extension = _tipo_por_extension(archivo.name)
    permitidos = ', '.join(t.upper() for t in tipos[:-1]) + f' o {tipos[-1].upper()}' if len(tipos) > 1 else tipos[0].upper()
    if tipo_extension not in tipos:
        raise FicheroNoValido(f'Tipo de archivo no permitido (solo {permitidos}).')

    archivo.seek(0)
    contenido = archivo.read()
    archivo.seek(0)

    tipo_real = _tipo_por_firma(contenido[:2048])
    if tipo_real not in tipos:
        raise FicheroNoValido(
            f'El contenido del archivo no es un {permitidos} real '
            '(puede estar dañado o ser otro tipo de archivo renombrado).'
        )
    if tipo_real == 'pdf':
        _validar_pdf(contenido)
    else:
        _validar_imagen(contenido, tipo_real)

    if tipo_real != tipo_extension:
        archivo.name = _con_extension(archivo.name, EXTENSIONES[tipo_real][0])
    return tipo_real


def _con_extension(nombre: str, extension: str) -> str:
    base = nombre.rsplit('.', 1)[0] if '.' in nombre else nombre
    return f'{base}{extension}'


# Marcas de la caja `ftyp` de un HEIC/HEIF (bytes 4-12): así guarda el iPhone
# sus fotos. A veces llegan con nombre `.jpg` (transferidas, reenviadas).
_MARCAS_HEIF = (b'ftypheic', b'ftypheix', b'ftyphevc', b'ftypheim', b'ftypheis', b'ftypmif1', b'ftypmsf1', b'ftypheif')


def _es_heif(cabecera: bytes) -> bool:
    return cabecera[4:12] in _MARCAS_HEIF


def preparar_documento(archivo, **kwargs):
    """Punto de entrada para una vista de subida: convierte a JPEG una foto
    HEIC/HEIF de iPhone (el navegador no la muestra y la IA de visión no la
    lee como JPEG) y después la valida con `validar_documento`.

    Devuelve `(archivo_final, tipo_real)`: con HEIC, `archivo_final` es un
    fichero NUEVO (el JPEG convertido) y hay que guardar ése, no el original."""
    archivo.seek(0)
    cabecera = archivo.read(16)
    archivo.seek(0)
    if _es_heif(cabecera):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from pillow_heif import register_heif_opener

        register_heif_opener()
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(archivo) as imagen:
                    if imagen.size[0] * imagen.size[1] > MAX_PIXELES_IMAGEN:
                        raise FicheroNoValido('La imagen es demasiado grande (resolución excesiva).')
                    salida = io.BytesIO()
                    # Se conserva el EXIF (la orientación de la foto) si lo
                    # trae; pillow-heif pone `None` cuando no hay.
                    extra = {'exif': imagen.info['exif']} if imagen.info.get('exif') else {}
                    imagen.convert('RGB').save(salida, format='JPEG', quality=90, **extra)
        except FicheroNoValido:
            raise
        except Exception:
            raise FicheroNoValido('La foto (formato HEIC) está dañada o no se ha podido convertir.')
        archivo = SimpleUploadedFile(
            _con_extension(archivo.name or 'foto', '.jpg'), salida.getvalue(), content_type='image/jpeg',
        )
    return archivo, validar_documento(archivo, **kwargs)
