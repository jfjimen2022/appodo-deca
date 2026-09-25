import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

function parseDateValue(value) {
  if (value instanceof Date) return value
  if (typeof value !== 'string') return null

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// Simplificado del ERP origen: allí el locale dependía del idioma/país de la
// empresa (multi-tenant). Aquí, single-tenant, se usa el idioma actual de
// i18next si se pasa explícitamente; por defecto es-ES (formato DD/MM/AAAA).
export function formatDate(value, { locale = 'es-ES', timeZone = 'Europe/Madrid' } = {}) {
  const date = parseDateValue(value)
  if (!date) return value ?? ''
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(date)
}
