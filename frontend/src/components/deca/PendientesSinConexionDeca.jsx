import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WifiOff, RefreshCw, AlertCircle } from 'lucide-react'
import { decaService } from '../../services/decaService'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { listarCola, sincronizarCola } from '../../lib/decaOffline'

// DeCA hechos SIN COBERTURA en este móvil y aún sin registrar en Appodo.
// Se registran solos al volver la red (evento `online`) o al entrar aquí con
// red; el botón es para no tener que esperar. Solo se ven y se envían los de
// la empresa y el usuario con los que se hicieron (lib/decaOffline.js).
export default function PendientesSinConexionDeca({ onRegistrados }) {
  const { t } = useTranslation('deca')
  const { empresa, user } = useAuth()
  const toast = useToast()
  const [pendientes, setPendientes] = useState([])
  const [enviando, setEnviando] = useState(false)
  const enCurso = useRef(false)

  const recargar = useCallback(async () => {
    if (!empresa?.id || !user?.id) return []
    const lista = await listarCola(empresa.id, user.id)
    setPendientes(lista)
    return lista
  }, [empresa?.id, user?.id])

  const sincronizar = useCallback(async ({ silencioso = false } = {}) => {
    if (enCurso.current || !empresa?.id || !user?.id) return
    enCurso.current = true
    setEnviando(true)
    try {
      const r = await sincronizarCola({ empresaId: empresa.id, usuarioId: user.id, servicio: decaService })
      if (r.registrados || r.por_completar) {
        toast.success(t('offline.registrados', { count: r.registrados + r.por_completar }))
        if (r.por_completar) toast.info(t('offline.por_completar', { count: r.por_completar }), 9000)
        onRegistrados?.()
      }
      if (r.sin_red && !silencioso) toast.error(t('offline.sigue_sin_red'))
      if (r.con_error) toast.error(t('offline.con_error', { count: r.con_error }), 9000)
    } finally {
      enCurso.current = false
      setEnviando(false)
      recargar()
    }
  }, [empresa?.id, user?.id, recargar, onRegistrados, t, toast])

  useEffect(() => {
    let vivo = true
    recargar().then((lista) => {
      if (vivo && lista.length && navigator.onLine !== false) sincronizar({ silencioso: true })
    })
    const alVolverRed = () => sincronizar({ silencioso: true })
    window.addEventListener('online', alVolverRed)
    return () => { vivo = false; window.removeEventListener('online', alVolverRed) }
  }, [recargar]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pendientes.length) return null

  return (
    <div role="status" className="shrink-0 rounded-xl border-2 border-amber-500 bg-amber-50 p-3 text-sm text-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <WifiOff className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t('offline.pendientes', { count: pendientes.length })}
        </p>
        <button
          type="button"
          onClick={() => sincronizar()}
          disabled={enviando}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[var(--color-marca)] px-3 font-semibold text-white disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${enviando ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
          {enviando ? t('offline.registrando') : t('offline.registrar_ahora')}
        </button>
      </div>
      <ul className="mt-2 divide-y divide-amber-200">
        {pendientes.map((p) => (
          <li key={p.referencia} className="py-1.5">
            <span className="font-mono font-semibold">{p.referencia}</span>
            {' · '}{new Date(p.emitido_en).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
            {p.datos?.destino ? ` · ${p.datos.destino}` : ''}
            {p.error && (
              <span className="mt-0.5 flex items-start gap-1 text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('offline.error_al_registrar', { detalle: p.error })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
