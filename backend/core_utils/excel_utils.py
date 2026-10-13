"""Utilidades comunes para los Excel que genera la app (openpyxl)."""


def proteger_hoja(ws):
    """Marca como TEXTO toda celda que empiece por '=' para que nunca se
    ejecute como fórmula.

    openpyxl guarda como fórmula cualquier texto que empiece por '='; si ese
    texto lo ha escrito un usuario (un nombre, un motivo, un filtro de
    búsqueda), al abrir el Excel se ejecutaría (inyección de fórmulas,
    auditoría 2026-10-10). Llamar justo antes de `wb.save()`. Los valores
    se ven exactamente igual; solo dejan de ser fórmulas."""
    for fila in ws.iter_rows():
        for celda in fila:
            if isinstance(celda.value, str) and celda.value.startswith('='):
                celda.data_type = 's'
    return ws
