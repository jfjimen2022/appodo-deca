import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { GripVertical } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Panel de checkboxes + drag&drop para el selector de columnas visibles,
 * pensado para usarse junto con el hook useColumnasVisibles.
 */
export default function ColumnPickerPanel({ columnasOrden, columnasConfig, visible, toggleColumna, handleDragEnd, getLabel }) {
  const mitad = Math.ceil(columnasOrden.length / 2)
  const columnasVisuales = [
    { id: 'col-0', items: columnasOrden.slice(0, mitad) },
    { id: 'col-1', items: columnasOrden.slice(mitad) },
  ]

  return (
    <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-[420px]">
      <p className="text-[10px] text-gray-400 px-2 pb-1">Arrastra para reordenar</p>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-2 gap-1">
          {columnasVisuales.map((columna) => (
            <Droppable droppableId={columna.id} key={columna.id}>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="min-h-[24px]">
                  {columna.items.map((id, index) => {
                    const col = columnasConfig.find((c) => c.id === id)
                    if (!col) return null
                    return (
                      <Draggable key={id} draggableId={id} index={index}>
                        {(drag, snapshot) => (
                          <label
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            className={cn(
                              'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm select-none',
                              snapshot.isDragging ? 'bg-gray-100 shadow-sm' : 'hover:bg-gray-50',
                            )}
                          >
                            <span
                              {...drag.dragHandleProps}
                              className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing"
                              onClick={(e) => e.preventDefault()}
                            >
                              <GripVertical className="h-3.5 w-3.5" />
                            </span>
                            <input
                              type="checkbox"
                              checked={visible(id)}
                              onChange={() => toggleColumna(id)}
                              className="w-3.5 h-3.5 accent-[var(--color-marca)]"
                            />
                            <span className="flex-1 truncate">{getLabel(col)}</span>
                          </label>
                        )}
                      </Draggable>
                    )
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </div>
  )
}
