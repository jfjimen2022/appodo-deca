"""Generación de la imagen del código QR del DeCA."""
from __future__ import annotations

import io

import qrcode
from qrcode.constants import ERROR_CORRECT_M


def generar_qr_png(url: str) -> bytes:
    """Genera el PNG del código QR que apunta a la URL pública del DeCA.

    Nivel de corrección de errores M (15%): suficiente para que un escaneo
    desde un móvil en la cabina de un camión, con el PDF algo arrugado o
    doblado, siga siendo legible sin sobredimensionar la imagen.

    Args:
        url: URL pública absoluta de descarga del PDF (ver views.py::DecaDescargaPublicaView).

    Returns:
        Contenido PNG en bytes, listo para insertar en el PDF.
    """
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    imagen = qr.make_image(fill_color='black', back_color='white')

    buffer = io.BytesIO()
    imagen.save(buffer, format='PNG')
    return buffer.getvalue()
