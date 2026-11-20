import { useEffect, useRef, useState } from 'react'

/**
 * Reloj de reproducción para el único momento animado de la página.
 * Avanza de `from` a `to` segundos de jugada en `duration` ms, una sola vez, cuando `run` es true.
 * Con prefers-reduced-motion salta directo al final.
 */
export default function usePlayhead({ from = 0, to, duration, delay = 350, run = true }: { from?: number; to: number; duration: number; delay?: number; run?: boolean }) {
  const [t, setT] = useState(from)
  const raf = useRef(0)
  useEffect(() => {
    if (!run) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setT(to)
      return
    }
    const t0 = performance.now() + delay
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / duration))
      setT(from + (to - from) * p)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [from, to, duration, delay, run])
  return t
}
