import { useState, useRef, useEffect } from 'react'

/**
 * Selector de columnas visibles + orden (drag & drop), persistido en
 * localStorage por navegador.
 */
export function useColumnasVisibles(storageKeyBase, columnasConfig) {
  const LS_KEY = `${storageKeyBase}_columnas_visibles`
  const LS_KEY_ORDEN = `${storageKeyBase}_columnas_orden`

  const [columnasVisibles, setColumnasVisibles] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved) return new Set(JSON.parse(saved))
    } catch { }
    return new Set(columnasConfig.filter((c) => c.defaultVisible).map((c) => c.id))
  })

  const defaultOrden = columnasConfig.map((c) => c.id)
  const [columnasOrden, setColumnasOrden] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY_ORDEN) || 'null')
      if (Array.isArray(saved)) {
        const known = new Set(defaultOrden)
        const filtered = saved.filter((id) => known.has(id))
        const missing = defaultOrden.filter((id) => !filtered.includes(id))
        return [...filtered, ...missing]
      }
    } catch { }
    return defaultOrden
  })

  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleColumna = (id) => {
    setColumnasVisibles((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(LS_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const handleDragEnd = (result) => {
    if (!result.destination) return

    const mitad = Math.ceil(columnasOrden.length / 2)
    const columnasVisuales = {
      'col-0': columnasOrden.slice(0, mitad),
      'col-1': columnasOrden.slice(mitad),
    }
    const origen = columnasVisuales[result.source.droppableId]
    const destino = columnasVisuales[result.destination.droppableId]
    if (!origen || !destino) return
    if (origen === destino && result.source.index === result.destination.index) return

    const [moved] = origen.splice(result.source.index, 1)
    destino.splice(result.destination.index, 0, moved)

    const reordered = [...columnasVisuales['col-0'], ...columnasVisuales['col-1']]
    setColumnasOrden(reordered)
    localStorage.setItem(LS_KEY_ORDEN, JSON.stringify(reordered))
  }

  const visible = (id) => columnasVisibles.has(id)
  const columnasActivas = columnasOrden
    .filter((id) => columnasVisibles.has(id))
    .map((id) => columnasConfig.find((c) => c.id === id))
    .filter(Boolean)

  return {
    columnasOrden, panelOpen, setPanelOpen, panelRef,
    toggleColumna, handleDragEnd, visible, columnasActivas,
  }
}
