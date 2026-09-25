"""
Numeracion de paginas ("Pagina X de Y") y cabecera de documento controlado
para informes PDF generados con reportlab `SimpleDocTemplate`.

Copiado tal cual de `core/pdf_utils.py` del ERP origen -- es agnóstico de
dominio y de tenant, no necesita adaptación más allá de la ruta de import.

reportlab no sabe cuantas paginas va a tener un documento hasta terminar de
construirlo, asi que "Pagina X de Y" exige el truco estandar de dos pasadas:
NumberedCanvas guarda el estado de cada pagina en `showPage()` (en vez de
escribirla ya) y, en `save()` (cuando ya se conoce el total), vuelve a
recorrerlas dibujando el pie con el total correcto en cada una.
"""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        canvas.Canvas.__init__(self, *args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_paginas = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._dibujar_numero_pagina(num_paginas)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def _dibujar_numero_pagina(self, num_paginas):
        ancho_pagina = self._pagesize[0] if self._pagesize else A4[0]
        self.setFont('Helvetica', 8)
        self.setFillColorRGB(0.45, 0.45, 0.45)
        self.drawRightString(
            ancho_pagina - 28, 18,
            f'Página {self._pageNumber} de {num_paginas}',
        )


def construir_cabecera_documento_controlado(
    config, empresa_nombre, generado_por, available_width, titulo_informe,
    total_registros=0, resumen_filtro='Sin filtros aplicados',
):
    """
    Cabecera estilo sistema de calidad (código de documento, versión,
    edición, preparado/autorizado por) para la primera página de un informe
    PDF de listado -- alternativa al título simple cuando
    `config.informe_mostrar_cabecera` está activo. NO aplica a documentos de
    una sola entidad (una factura individual, un CV...).

    `config` es `ConfiguracionDeca` (la única fila singleton de esta
    instalación) -- tiene los 6 campos `informe_*`. `titulo_informe` y
    `resumen_filtro` los calcula el módulo llamante -- esta función es
    agnóstica de dominio.
    """
    from datetime import date

    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import Table, TableStyle, Paragraph

    pequena = ParagraphStyle('cabecera_pequena', fontName='Helvetica', fontSize=7.5, leading=10)
    pequena_bold = ParagraphStyle('cabecera_pequena_bold', parent=pequena, fontName='Helvetica-Bold')

    hoy = date.today().strftime('%d/%m/%Y')
    data = [
        [
            Paragraph(f'<b>{config.informe_codigo_documento or "—"}</b>', pequena),
            Paragraph(f'<b>{empresa_nombre}</b><br/>{titulo_informe}', pequena_bold),
            Paragraph(f'Versión: {config.informe_version or "—"}', pequena),
        ],
        [
            Paragraph(f'Preparado por: {config.informe_preparado_por or "—"}', pequena),
            Paragraph(f'Autorizado por: {config.informe_autorizado_por or "—"}', pequena),
            Paragraph(f'Edición: {config.informe_edicion or "—"}', pequena),
        ],
        [
            Paragraph(f'Generado por: {generado_por or "—"}', pequena),
            '',
            Paragraph(f'Generado: {hoy}<br/>Total: {total_registros} registros', pequena),
        ],
        [
            Paragraph(f'<font color="#714B67"><b>Filtro:</b></font> {resumen_filtro}', pequena),
            '', '',
        ],
    ]
    col1 = 2.3 * inch
    col3 = 1.6 * inch
    tabla = Table(data, colWidths=[col1, available_width - col1 - col3, col3])
    tabla.setStyle(TableStyle([
        ('SPAN', (0, 3), (2, 3)),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#999999')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
    ]))
    return tabla
