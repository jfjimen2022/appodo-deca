import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

let _nextId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const show = useCallback((text, type = 'success', duration = 5000) => {
    const id = ++_nextId
    setToasts(t => [...t, { id, text, type }])
    setTimeout(() => dismiss(id), duration)
  }, [dismiss])

  const toast = {
    success: (text, duration) => show(text, 'success', duration),
    error:   (text, duration) => show(text, 'error',   duration ?? 7000),
    warn:    (text, duration) => show(text, 'warn',    duration),
    info:    (text, duration) => show(text, 'info',    duration),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}

const STYLES = {
  success: 'bg-green-600 text-white',
  error:   'bg-red-600 text-white',
  warn:    'bg-amber-500 text-white',
  info:    'bg-blue-600 text-white',
}

const ICONS = {
  success: '✓',
  error:   '✕',
  warn:    '⚠',
  info:    'ℹ',
}

function Toaster({ toasts, onDismiss }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium max-w-xs pointer-events-auto animate-in slide-in-from-right-4 fade-in duration-200 ${STYLES[t.type]}`}
        >
          <span className="text-base leading-none">{ICONS[t.type]}</span>
          <span className="flex-1">{t.text}</span>
          <button onClick={() => onDismiss(t.id)} className="opacity-70 hover:opacity-100 ml-1 text-lg leading-none">&times;</button>
        </div>
      ))}
    </div>
  )
}
