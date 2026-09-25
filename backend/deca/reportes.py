"""
Exportación en PDF/Excel de los listados de DeCA -- Expediciones y los
cuatro catálogos de la Agenda (Transportistas, Destinatarios, Conductores,
Tractoras, Remolques). Columnas configurables por diccionario, cabecera de
documento controlado compartida vía `deca.pdf_utils`, mismo filtro/orden que
la pantalla para que listado y exportación nunca se desincronicen.
"""
import io
from datetime import date

ESTADO_LABELS_EXPEDICION = {
    'borrador': 'Borrador',
    'confirmado': 'Confirmado',
    'generado': 'Generado',
    'anulado': 'Anulado',
}


def _fecha_legible(dt):
    return dt.strftime('%d/%m/%Y %H:%M') if dt else '—'


# ─── Expediciones ────────────────────────────────────────────────────────

def resumen_filtros_legible_expediciones(filtros: dict | None) -> str:
    if not filtros:
        return 'Sin filtros aplicados'
    partes = []
    if filtros.get('estado'):
        partes.append(f'Estado: {ESTADO_LABELS_EXPEDICION.get(filtros["estado"], filtros["estado"])}')
    if filtros.get('q'):
        partes.append(f'Búsqueda: "{filtros["q"]}"')
    return ' · '.join(partes) if partes else 'Sin filtros aplicados'


COLUMNAS_EXPEDICIONES = {
    'numero_albaran':  {'label': 'Nº Albarán', 'peso': 10, 'ancho_excel': 16},
    'estado':          {'label': 'Estado', 'peso': 8, 'ancho_excel': 12},
    'cargador':        {'label': 'Cargador', 'peso': 18, 'ancho_excel': 26, 'truncar': 40},
    'transportista':   {'label': 'Transportista', 'peso': 18, 'ancho_excel': 26, 'truncar': 40},
    'destinatario':    {'label': 'Destinatario', 'peso': 18, 'ancho_excel': 26, 'truncar': 40},
    'matricula':       {'label': 'Matrícula', 'peso': 10, 'ancho_excel': 14},
    'fecha_transporte': {'label': 'Fecha transporte', 'peso': 12, 'ancho_excel': 18},
    'creado_por':      {'label': 'Creado por', 'peso': 12, 'ancho_excel': 20, 'truncar': 30},
}
ORDEN_COLUMNAS_EXPEDICIONES = list(COLUMNAS_EXPEDICIONES.keys())


def _valor_columna_expedicion(col_id, e):
    if col_id == 'numero_albaran':
        return e.numero_albaran or str(e.id)[:8]
    if col_id == 'estado':
        return ESTADO_LABELS_EXPEDICION.get(e.estado, e.estado)
    if col_id == 'cargador':
        return e.nombre_cargador or '—'
    if col_id == 'transportista':
        return e.nombre_transportista or '—'
    if col_id == 'destinatario':
        return e.nombre_destinatario or '—'
    if col_id == 'matricula':
        return e.matricula_tractor or '—'
    if col_id == 'fecha_transporte':
        return _fecha_legible(e.fecha_hora_transporte)
    if col_id == 'creado_por':
        if not e.creado_por_id:
            return '—'
        return e.creado_por.get_full_name() or e.creado_por.username
    return '—'


def generar_pdf_expediciones(expediciones, empresa_nombre, config=None, generado_por=None, filtros=None) -> bytes:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Table, Paragraph, Spacer
    from reportlab.lib.units import inch
    from .pdf_utils import NumberedCanvas, construir_cabecera_documento_controlado

    buffer = io.BytesIO()
    LEFT = 0.5 * inch
    RIGHT = 0.5 * inch
    available_width = landscape(A4)[0] - LEFT - RIGHT
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A4),
        topMargin=0.5 * inch, bottomMargin=0.5 * inch, leftMargin=LEFT, rightMargin=RIGHT,
    )
    styles = getSampleStyleSheet()
    elements = []

    if config and config.informe_mostrar_cabecera:
        elements.append(construir_cabecera_documento_controlado(
            config, empresa_nombre, generado_por, available_width,
            titulo_informe='Listado de Expediciones DeCA',
            total_registros=len(expediciones), resumen_filtro=resumen_filtros_legible_expediciones(filtros),
        ))
        elements.append(Spacer(1, 0.2 * inch))
    else:
        elements.append(Paragraph(f'<b>Listado de Expediciones DeCA — {empresa_nombre}</b>', styles['Title']))
        elements.append(Spacer(1, 0.1 * inch))
        elements.append(Paragraph(
            f'Generado: {date.today().strftime("%d/%m/%Y")} · Total: {len(expediciones)}', styles['Normal']))
        elements.append(Paragraph(
            f'<font color="#714B67"><b>Filtro:</b></font> {resumen_filtros_legible_expediciones(filtros)}',
            styles['Normal'],
        ))
        elements.append(Spacer(1, 0.2 * inch))

    columnas = ORDEN_COLUMNAS_EXPEDICIONES
    peso_total = sum(COLUMNAS_EXPEDICIONES[c]['peso'] for c in columnas)
    col_widths = [available_width * (COLUMNAS_EXPEDICIONES[c]['peso'] / peso_total) for c in columnas]

    data = [[COLUMNAS_EXPEDICIONES[c]['label'] for c in columnas]]
    for e in expediciones:
        fila = []
        for c in columnas:
            valor = _valor_columna_expedicion(c, e)
            truncar = COLUMNAS_EXPEDICIONES[c].get('truncar')
            fila.append(Paragraph(valor[:truncar], styles['Normal']) if truncar else valor)
        data.append(fila)

    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(_estilo_tabla_informe())
    elements.append(table)

    doc.build(elements, canvasmaker=NumberedCanvas)
    return buffer.getvalue()


def generar_excel_expediciones(expediciones, empresa_nombre='', config=None, generado_por=None, filtros=None) -> bytes:
    return _generar_excel_generico(
        expediciones, 'Expediciones', COLUMNAS_EXPEDICIONES, ORDEN_COLUMNAS_EXPEDICIONES,
        _valor_columna_expedicion, empresa_nombre, config, generado_por,
        resumen_filtros_legible_expediciones(filtros),
    )


# ─── Agenda (los 5 catálogos) ────────────────────────────────────────────

TITULOS_AGENDA = {
    'transportistas': 'Transportistas',
    'destinatarios': 'Destinatarios',
    'conductores': 'Conductores',
    'tractoras': 'Tractoras',
    'remolques': 'Remolques',
}

COLUMNAS_AGENDA = {
    'transportistas': {
        'nombre': {'label': 'Nombre', 'peso': 35, 'ancho_excel': 34, 'truncar': 60},
        'nif': {'label': 'NIF/CIF', 'peso': 15, 'ancho_excel': 16},
        'telefono': {'label': 'Teléfono', 'peso': 15, 'ancho_excel': 16},
        'email': {'label': 'Email', 'peso': 25, 'ancho_excel': 28},
        'activo': {'label': 'Estado', 'peso': 10, 'ancho_excel': 14},
    },
    'destinatarios': {
        'nombre': {'label': 'Nombre', 'peso': 35, 'ancho_excel': 34, 'truncar': 60},
        'nif': {'label': 'NIF/CIF', 'peso': 15, 'ancho_excel': 16},
        'telefono': {'label': 'Teléfono', 'peso': 15, 'ancho_excel': 16},
        'email': {'label': 'Email', 'peso': 25, 'ancho_excel': 28},
        'activo': {'label': 'Estado', 'peso': 10, 'ancho_excel': 14},
    },
    'conductores': {
        'nombre': {'label': 'Nombre', 'peso': 35, 'ancho_excel': 34, 'truncar': 60},
        'nif': {'label': 'NIF', 'peso': 15, 'ancho_excel': 16},
        'telefono': {'label': 'Teléfono', 'peso': 15, 'ancho_excel': 16},
        'email': {'label': 'Email', 'peso': 25, 'ancho_excel': 28},
        'activo': {'label': 'Estado', 'peso': 10, 'ancho_excel': 14},
    },
    'tractoras': {
        'matricula': {'label': 'Matrícula', 'peso': 35, 'ancho_excel': 22},
        'alias': {'label': 'Alias', 'peso': 45, 'ancho_excel': 34, 'truncar': 60},
        'activo': {'label': 'Estado', 'peso': 20, 'ancho_excel': 14},
    },
    'remolques': {
        'matricula': {'label': 'Matrícula', 'peso': 35, 'ancho_excel': 22},
        'alias': {'label': 'Alias', 'peso': 45, 'ancho_excel': 34, 'truncar': 60},
        'activo': {'label': 'Estado', 'peso': 20, 'ancho_excel': 14},
    },
}


def resumen_filtros_legible_agenda(filtros: dict | None) -> str:
    if not filtros:
        return 'Sin filtros aplicados'
    partes = []
    if filtros.get('solo_activos') == 'true':
        partes.append('Solo activos')
    if filtros.get('q'):
        partes.append(f'Búsqueda: "{filtros["q"]}"')
    return ' · '.join(partes) if partes else 'Sin filtros aplicados'


def _valor_columna_agenda(col_id, ficha):
    if col_id == 'activo':
        return 'Activo' if ficha.activo else 'Archivado'
    valor = getattr(ficha, col_id, None)
    return valor or '—'


def generar_pdf_agenda(tipo, fichas, empresa_nombre, config=None, generado_por=None, filtros=None) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Table, Paragraph, Spacer
    from reportlab.lib.units import inch
    from .pdf_utils import NumberedCanvas, construir_cabecera_documento_controlado

    columnas_def = COLUMNAS_AGENDA[tipo]
    columnas = list(columnas_def.keys())
    titulo = f'Agenda DeCA — {TITULOS_AGENDA[tipo]}'

    buffer = io.BytesIO()
    LEFT = 0.6 * inch
    RIGHT = 0.6 * inch
    available_width = A4[0] - LEFT - RIGHT
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch, leftMargin=LEFT, rightMargin=RIGHT,
    )
    styles = getSampleStyleSheet()
    elements = []

    if config and config.informe_mostrar_cabecera:
        elements.append(construir_cabecera_documento_controlado(
            config, empresa_nombre, generado_por, available_width,
            titulo_informe=titulo, total_registros=len(fichas),
            resumen_filtro=resumen_filtros_legible_agenda(filtros),
        ))
        elements.append(Spacer(1, 0.2 * inch))
    else:
        elements.append(Paragraph(f'<b>{titulo} — {empresa_nombre}</b>', styles['Title']))
        elements.append(Spacer(1, 0.1 * inch))
        elements.append(Paragraph(
            f'Generado: {date.today().strftime("%d/%m/%Y")} · Total: {len(fichas)}', styles['Normal']))
        elements.append(Paragraph(
            f'<font color="#714B67"><b>Filtro:</b></font> {resumen_filtros_legible_agenda(filtros)}',
            styles['Normal'],
        ))
        elements.append(Spacer(1, 0.2 * inch))

    peso_total = sum(columnas_def[c]['peso'] for c in columnas)
    col_widths = [available_width * (columnas_def[c]['peso'] / peso_total) for c in columnas]

    data = [[columnas_def[c]['label'] for c in columnas]]
    for ficha in fichas:
        fila = []
        for c in columnas:
            valor = _valor_columna_agenda(c, ficha)
            truncar = columnas_def[c].get('truncar')
            fila.append(Paragraph(valor[:truncar], styles['Normal']) if truncar else valor)
        data.append(fila)

    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(_estilo_tabla_informe())
    elements.append(table)

    doc.build(elements, canvasmaker=NumberedCanvas)
    return buffer.getvalue()


def generar_excel_agenda(tipo, fichas, empresa_nombre='', config=None, generado_por=None, filtros=None) -> bytes:
    columnas_def = COLUMNAS_AGENDA[tipo]
    return _generar_excel_generico(
        fichas, TITULOS_AGENDA[tipo], columnas_def, list(columnas_def.keys()),
        _valor_columna_agenda, empresa_nombre, config, generado_por,
        resumen_filtros_legible_agenda(filtros),
    )


# ─── Compartido ──────────────────────────────────────────────────────────

def _estilo_tabla_informe():
    from reportlab.lib import colors
    from reportlab.platypus import TableStyle
    return TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#714B67')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('FONTSIZE', (0, 1), (-1, -1), 7),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9F7FA')]),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#E3E0E9')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ])


def _generar_excel_generico(
    registros, titulo, columnas_def, columnas, valor_columna_fn,
    empresa_nombre, config, generado_por, resumen_filtro,
) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    wb = Workbook()
    ws = wb.active
    ws.title = titulo[:31]  # límite de Excel para el nombre de la hoja

    fila = 1
    if config and config.informe_mostrar_cabecera:
        ws.cell(row=fila, column=1, value=config.informe_codigo_documento or '—').font = Font(bold=True)
        ws.cell(row=fila, column=3, value=f'Versión: {config.informe_version or "—"}')
        fila += 1
        ws.cell(row=fila, column=1, value=empresa_nombre).font = Font(bold=True, size=13)
        ws.cell(row=fila, column=3, value=f'Edición: {config.informe_edicion or "—"}')
        fila += 1
        ws.cell(row=fila, column=1, value=titulo)
        fila += 1
        ws.cell(row=fila, column=1, value=f'Preparado por: {config.informe_preparado_por or "—"}')
        ws.cell(row=fila, column=3, value=f'Autorizado por: {config.informe_autorizado_por or "—"}')
        fila += 1
        ws.cell(row=fila, column=1, value=f'Generado por: {generado_por or "—"} el {date.today().strftime("%d/%m/%Y")}')
        fila += 2
    else:
        ws.cell(row=fila, column=1, value=f'{titulo} — {empresa_nombre}').font = Font(bold=True, size=13)
        fila += 1
        ws.cell(row=fila, column=1, value=f'Generado: {date.today().strftime("%d/%m/%Y")} · Total: {len(registros)}')
        fila += 2

    ws.cell(row=fila, column=1, value=f'Filtro: {resumen_filtro}')
    fila += 2

    header_fill = PatternFill(start_color='714B67', end_color='714B67', fill_type='solid')
    fila_header = fila
    for idx, c in enumerate(columnas, start=1):
        celda = ws.cell(row=fila_header, column=idx, value=columnas_def[c]['label'])
        celda.font = Font(bold=True, color='FFFFFF')
        celda.fill = header_fill
        celda.alignment = Alignment(horizontal='center')
        ws.column_dimensions[celda.column_letter].width = columnas_def[c]['ancho_excel']

    for registro in registros:
        fila += 1
        for idx, c in enumerate(columnas, start=1):
            ws.cell(row=fila, column=idx, value=valor_columna_fn(c, registro))

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
