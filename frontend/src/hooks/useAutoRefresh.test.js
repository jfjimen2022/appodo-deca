import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAutoRefresh } from './useAutoRefresh'

function setVisibilidad(estado) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado })
}

describe('useAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibilidad('visible')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refresca cada intervalo con la pestaña visible', () => {
    const fn = vi.fn()
    renderHook(() => useAutoRefresh(fn, { intervaloMs: 1000 }))
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('no pide nada con la pestaña en segundo plano', () => {
    const fn = vi.fn()
    setVisibilidad('hidden')
    renderHook(() => useAutoRefresh(fn, { intervaloMs: 1000 }))
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('no refresca mientras está pausado y retoma al despausar', () => {
    const fn = vi.fn()
    const { rerender } = renderHook(({ pausado }) => useAutoRefresh(fn, { intervaloMs: 1000, pausado }), {
      initialProps: { pausado: true },
    })
    vi.advanceTimersByTime(3000)
    expect(fn).not.toHaveBeenCalled()
    rerender({ pausado: false })
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('al volver a la pestaña refresca una sola vez aunque lleguen focus y visibilitychange', () => {
    const fn = vi.fn()
    renderHook(() => useAutoRefresh(fn, { intervaloMs: 60000, minimoEntreRefrescosMs: 10000 }))
    vi.advanceTimersByTime(20000)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('al volver enseguida no repite la petición', () => {
    const fn = vi.fn()
    renderHook(() => useAutoRefresh(fn, { intervaloMs: 60000, minimoEntreRefrescosMs: 10000 }))
    vi.advanceTimersByTime(2000)
    window.dispatchEvent(new Event('focus'))
    expect(fn).not.toHaveBeenCalled()
  })
})
