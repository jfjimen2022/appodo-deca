"""Generación del PDF nativo del DeCA (ReportLab) con el QR estampado.

El documento se genera siempre desde los datos estructurados de la
`ExpedicionDeca` -- nunca se parte de un PDF de terceros y se le pega un QR
encima. Esto es deliberado: la norma exige un "PDF nativo digital... no se
permiten imágenes escaneadas ni documentos alterados sin validez" y generar
el documento desde cero es la forma más segura de no caer en esa prohibición.
"""
from __future__ import annotations

import io

from django.conf import settings
from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from deca.models import ExpedicionDeca

TAMANO_QR_MM = 32
MARGEN_MM = 15
ANCHO_UTIL_MM = 210 - 2 * MARGEN_MM  # A4 menos márgenes = 180mm
COLOR_MARCA = colors.HexColor('#714B67')
COLOR_GRIS = colors.HexColor('#6B7280')


def _nombre_empresa() -> str:
    return getattr(settings, 'EMPRESA_NOMBRE', '') or ''


def _dibujar_marca_agua(canvas, doc):
    """Marca de agua diagonal para las vistas previas -- para que nadie la
    confunda con el DeCA real ya generado (no lleva QR válido: apunta a una
    expedición que puede seguir sin generar, o incluso ya no existir)."""
    ancho_pagina, alto_pagina = A4
    canvas.saveState()
    canvas.setFont('Helvetica-Bold', 46)
    canvas.setFillColor(colors.HexColor('#D1D5DB'))
    canvas.translate(ancho_pagina / 2, alto_pagina / 2)
    canvas.rotate(40)
    canvas.drawCentredString(0, 0, 'VISTA PREVIA — NO VÁLIDO')
    canvas.restoreState()


def _dibujar_qr_esquina(qr_png: bytes, marca_agua: bool = False):
    """Devuelve el callback `onFirstPage` que estampa el QR en la esquina
    superior derecha de la página -- posición fija, exigida por la norma
    para que un inspector lo localice de un vistazo sin buscar.

    Args:
        marca_agua: True en una vista previa (ver `generar_pdf_deca`,
            `borrador=True`) -- añade el sello diagonal para que nadie la
            confunda con el documento oficial ya generado.
    """
    imagen_qr = ImageReader(io.BytesIO(qr_png))

    def _on_first_page(canvas, doc):
        if marca_agua:
            _dibujar_marca_agua(canvas, doc)
        ancho_pagina, alto_pagina = A4
        x = ancho_pagina - MARGEN_MM * mm - TAMANO_QR_MM * mm
        y = alto_pagina - MARGEN_MM * mm - TAMANO_QR_MM * mm
        canvas.drawImage(
            imagen_qr, x, y,
            width=TAMANO_QR_MM * mm, height=TAMANO_QR_MM * mm,
            preserveAspectRatio=True, mask='auto',
        )
        canvas.setFont('Helvetica', 6)
        canvas.setFillColor(COLOR_GRIS)
        canvas.drawCentredString(x + TAMANO_QR_MM * mm / 2, y - 3 * mm, 'Escanear para verificar')

    return _on_first_page


def _fila(etiqueta: str, valor: str) -> list[str]:
    return [etiqueta, valor or '—']


def _tabla_transporte_style() -> TableStyle:
    return TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 0), (0, -1), COLOR_GRIS),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, colors.HexColor('#FAFAFA')]),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ])


def generar_pdf_deca(expedicion: ExpedicionDeca, qr_png: bytes, borrador: bool = False) -> bytes:
    """Genera el PDF nativo del DeCA para `expedicion`, con el QR estampado.

    Args:
        expedicion: expedición confirmada con todos los campos mínimos ya
            validados (ver serializers.py -- esta función no vuelve a
            validar nada, asume datos correctos).
        qr_png: imagen PNG del QR ya generada (ver qr_service.generar_qr_png).
        borrador: True para una vista previa (ver `views.py::VistaPreviaExpedicionDecaView`)
            -- añade una marca de agua y nunca se persiste ni se usa para
            calcular `hash_sha256`. El documento oficial e inmutable solo
            nace al pulsar "Generar DeCA" (`borrador=False`, el valor por
            defecto).

    Returns:
        Contenido del PDF en bytes.
    """
    # `title` fija el metadato /Title del PDF -- sin él, el visor del
    # navegador le pone a la pestaña un nombre genérico en vez del número
    # de DeCA.
    identificador = expedicion.numero_albaran or str(expedicion.id)
    titulo_documento = f'{"VISTA PREVIA " if borrador else ""}DECA-{identificador}'
    empresa_nombre = _nombre_empresa()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, title=titulo_documento, author=empresa_nombre or 'Appodo DeCa',
        topMargin=MARGEN_MM * mm, bottomMargin=MARGEN_MM * mm,
        leftMargin=MARGEN_MM * mm, rightMargin=MARGEN_MM * mm,
    )
    estilos = getSampleStyleSheet()
    estilo_titulo = ParagraphStyle(
        'TituloDeca', parent=estilos['Title'], fontSize=15, leading=18, alignment=0,
    )
    estilo_subtitulo = ParagraphStyle(
        'SubtituloDeca', parent=estilos['Normal'], fontSize=9, textColor=COLOR_GRIS,
    )
    estilo_seccion = ParagraphStyle(
        'SeccionDeca', parent=estilos['Heading3'], fontSize=10.5, spaceBefore=4, spaceAfter=4,
        textColor=COLOR_MARCA,
    )
    estilo_pie = ParagraphStyle('PieDeca', parent=estilos['Normal'], fontSize=7, textColor=COLOR_GRIS)

    elementos = []

    # Cabecera en tabla de 2 columnas: el título/subtítulo/nº de albarán
    # ocupan solo el ancho que le queda libre a la izquierda del QR (que se
    # dibuja aparte, ver _dibujar_qr_esquina). Además la fila tiene ALTURA
    # FIJA igual a la del QR (`rowHeights=[TAMANO_QR_MM*mm]`) -- no basta con
    # reservar el ancho: si el bloque de texto es más bajo que el QR, lo que
    # venga después (la línea horizontal, el nº de albarán) cae dentro de la
    # franja vertical del QR y se dibuja encima/detrás de él, aunque esté
    # fuera de su ancho. Con la fila a altura fija, TODO lo que viene después
    # del `cabecera` queda garantizado por debajo del QR.
    ancho_titulo_mm = ANCHO_UTIL_MM - TAMANO_QR_MM - 5

    linea_albaran = f'Nº de albarán: <b>{expedicion.numero_albaran or "—"}</b>'
    if expedicion.numero_cmr:
        linea_albaran += f' &nbsp;·&nbsp; Nº de CMR: <b>{expedicion.numero_cmr}</b>'
    if expedicion.numero_pedido:
        linea_albaran += f' &nbsp;·&nbsp; Nº de pedido: <b>{expedicion.numero_pedido}</b>'

    celda_titulo = [
        Paragraph('Documento electrónico de Control Administrativo', estilo_titulo),
        Paragraph('DeCA · Orden FOM/2861/2012', estilo_subtitulo),
        Spacer(1, 3 * mm),
        Paragraph(linea_albaran, estilos['Normal']),
    ]
    cabecera = Table(
        [[celda_titulo, '']],
        colWidths=[ancho_titulo_mm * mm, (TAMANO_QR_MM + 5) * mm],
        rowHeights=[TAMANO_QR_MM * mm],
    )
    cabecera.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
    ]))
    elementos.append(cabecera)
    elementos.append(Spacer(1, 4 * mm))
    elementos.append(HRFlowable(width='100%', thickness=1.2, color=COLOR_MARCA))
    elementos.append(Spacer(1, 5 * mm))

    ancho_partes = ANCHO_UTIL_MM / 3
    datos = [
        ['Cargador', 'Transportista efectivo', 'Destinatario'],
        [
            f'{expedicion.nombre_cargador}\nNIF/CIF: {expedicion.nif_cargador}',
            f'{expedicion.nombre_transportista}\nNIF/CIF: {expedicion.nif_transportista}',
            f'{expedicion.nombre_destinatario}\nNIF/CIF: {expedicion.nif_destinatario}',
        ],
    ]
    tabla_partes = Table(datos, colWidths=[ancho_partes * mm] * 3)
    tabla_partes.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), COLOR_MARCA),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elementos.append(tabla_partes)
    elementos.append(Spacer(1, 6 * mm))

    peso_texto = f'{expedicion.peso_kg} kg' if expedicion.peso_kg is not None else '—'
    bultos_texto = str(expedicion.bultos) if expedicion.bultos is not None else '—'
    # `fecha_hora_transporte` es null=True desde que el borrador puede nacer
    # vacío (ver ExpedicionDeca en models.py) -- la vista previa debe poder
    # pintarse sobre un borrador a medio rellenar sin reventar.
    fecha_texto = (
        expedicion.fecha_hora_transporte.strftime('%d/%m/%Y %H:%M')
        if expedicion.fecha_hora_transporte else '—'
    )

    filas_transporte = [
        _fila('Matrícula tractor', expedicion.matricula_tractor),
        _fila('Matrícula remolque', expedicion.matricula_remolque),
        _fila('Origen', expedicion.origen),
        _fila('Destino', expedicion.destino),
        _fila('Fecha y hora del transporte', fecha_texto),
        _fila('Naturaleza de la mercancía', expedicion.naturaleza_mercancia),
        _fila('Peso', peso_texto),
        _fila('Bultos', bultos_texto),
    ]
    # Plus sobre el mínimo legal -- solo se añaden a la tabla si tienen dato,
    # nunca como fila vacía con "—".
    if expedicion.volumen_m3 is not None:
        filas_transporte.append(_fila('Volumen', f'{expedicion.volumen_m3} m³'))
    if expedicion.codigo_mercancia:
        filas_transporte.append(_fila('Código de la mercancía', expedicion.codigo_mercancia))
    tabla_transporte = Table(filas_transporte, colWidths=[ANCHO_UTIL_MM * 0.35 * mm, ANCHO_UTIL_MM * 0.65 * mm])
    tabla_transporte.setStyle(_tabla_transporte_style())
    # `KeepTogether` -- sin esto, un salto de página puede caer justo entre
    # el título de una sección y su tabla, dejando el título huérfano al
    # final de una página y la tabla sola al principio de la siguiente. Se
    # aplica a todas las secciones de abajo por el mismo motivo.
    elementos.append(KeepTogether([Paragraph('Datos del transporte', estilo_seccion), tabla_transporte]))
    elementos.append(Spacer(1, 6 * mm))

    # Instrucciones/información adicional -- cada línea es opcional y solo
    # aparece si tiene contenido; si no hay ninguna, la sección entera no
    # se imprime (mismo criterio que arriba).
    campos_adicionales = [
        ('Instrucciones al conductor', expedicion.instrucciones_conductor),
        ('Contacto de emergencias', expedicion.contacto_emergencias),
        ('Tipo de contenedor', expedicion.tipo_contenedor),
        ('Instrucciones del expedidor', expedicion.instrucciones_expedidor),
        ('Instrucciones de pago del transporte', expedicion.instrucciones_pago),
        ('Reservas y comentarios', expedicion.comentarios),
    ]
    filas_adicionales = [_fila(etiqueta, valor) for etiqueta, valor in campos_adicionales if valor]
    if filas_adicionales:
        tabla_adicionales = Table(filas_adicionales, colWidths=[ANCHO_UTIL_MM * 0.35 * mm, ANCHO_UTIL_MM * 0.65 * mm])
        tabla_adicionales.setStyle(_tabla_transporte_style())
        elementos.append(KeepTogether([Paragraph('Información adicional', estilo_seccion), tabla_adicionales]))
        elementos.append(Spacer(1, 6 * mm))

    # Conductor -- no es campo mínimo exigido por la norma, pero si la
    # empresa lo ha rellenado (se usa además para el envío obligatorio al
    # conductor, ver ConfiguracionDeca) tiene sentido que conste en el propio
    # documento que lleva encima durante el trayecto.
    if expedicion.nombre_conductor:
        filas_conductor = [
            _fila('Nombre', expedicion.nombre_conductor),
            _fila('NIF', expedicion.nif_conductor),
            _fila('Teléfono', expedicion.telefono_conductor),
        ]
        tabla_conductor = Table(filas_conductor, colWidths=[ANCHO_UTIL_MM * 0.35 * mm, ANCHO_UTIL_MM * 0.65 * mm])
        tabla_conductor.setStyle(_tabla_transporte_style())
        elementos.append(KeepTogether([Paragraph('Conductor', estilo_seccion), tabla_conductor]))
        elementos.append(Spacer(1, 6 * mm))

    # Cadena de subcontratación -- plus sobre el mínimo legal (ver
    # TransportistaSucesivoDeca), solo se imprime si hay alguno.
    sucesivos = list(expedicion.transportistas_sucesivos.all())
    if sucesivos:
        filas_sucesivos = [['#', 'Nombre', 'NIF/CIF', 'Matrícula']]
        for t in sucesivos:
            filas_sucesivos.append([str(t.orden), t.nombre, t.nif, t.matricula or '—'])
        ancho_sucesivos = [ANCHO_UTIL_MM * f for f in (0.08, 0.42, 0.30, 0.20)]
        tabla_sucesivos = Table(filas_sucesivos, colWidths=[a * mm for a in ancho_sucesivos])
        tabla_sucesivos.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F3F4F6')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
            ('FONTSIZE', (0, 0), (-1, -1), 8.5),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ]))
        elementos.append(KeepTogether([Paragraph('Transportistas sucesivos', estilo_seccion), tabla_sucesivos]))
        elementos.append(Spacer(1, 6 * mm))

    # Recuadro para uso de la inspección -- espacio en blanco real (no
    # relleno), práctica habitual en este tipo de documento de control.
    caja_observaciones = Table([['']], colWidths=[ANCHO_UTIL_MM * mm], rowHeights=[22 * mm])
    caja_observaciones.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.75, colors.HexColor('#D1D5DB')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elementos.append(KeepTogether([
        Paragraph('Observaciones (uso exclusivo de la inspección)', estilo_seccion), caja_observaciones,
    ]))
    elementos.append(Spacer(1, 8 * mm))

    ahora = timezone.now()
    elementos.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#D1D5DB')))
    elementos.append(Spacer(1, 2 * mm))
    if borrador:
        pie = (
            f'Vista previa generada el {ahora.strftime("%d/%m/%Y %H:%M")} UTC · {empresa_nombre} '
            f'· Este documento NO es válido para circular ni tiene efectos legales -- solo sirve para '
            f'revisar los datos antes de pulsar "Generar DeCA". Una vez generado, la expedición queda '
            f'bloqueada: si detectas un error después, tendrás que anularla y crear una nueva.'
        )
    else:
        pie = (
            f'Documento generado electrónicamente el {ahora.strftime("%d/%m/%Y %H:%M")} UTC · '
            f'{empresa_nombre} · Documento de control conforme a la Orden FOM/2861/2012 '
            f'y a la Resolución de 5 de junio de 2026. La descarga pública de este documento sin '
            f'autenticación está disponible durante la ventana legal configurada; pasada esta, se '
            f'conserva en custodia según la normativa vigente.'
        )
    elementos.append(Paragraph(pie, estilo_pie))

    callback_qr = _dibujar_qr_esquina(qr_png, marca_agua=borrador)
    doc.build(elementos, onFirstPage=callback_qr, onLaterPages=callback_qr)
    return buffer.getvalue()
