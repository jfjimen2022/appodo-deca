import { ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'

export default function SortableHeader({ label, field, ordering, onSort, className = '', filter = null }) {
  const isActive = ordering?.field === field
  const isAsc = isActive && ordering?.dir === 'asc'
  const isDesc = isActive && ordering?.dir === 'desc'

  return (
    <th
      className={`text-left px-4 py-3 font-medium select-none hover:bg-gray-100 transition-colors whitespace-nowrap ${className}`}
    >
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 cursor-pointer" onClick={() => onSort(field)}>
          {label}
          {isAsc
            ? <ChevronUp className="h-3.5 w-3.5 text-[var(--color-marca)]" />
            : isDesc
              ? <ChevronDown className="h-3.5 w-3.5 text-[var(--color-marca)]" />
              : <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />
          }
        </span>
        {filter}
      </span>
    </th>
  )
}
