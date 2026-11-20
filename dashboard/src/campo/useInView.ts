import { useEffect, useRef, useState } from 'react'

/** true la primera vez que el elemento entra en pantalla (para arrancar el momento animado). */
export default function useInView<T extends Element>(threshold = 0.3) {
  const ref = useRef<T | null>(null)
  const [visto, setVisto] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visto) return
    if (typeof IntersectionObserver === 'undefined') return setVisto(true)
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        setVisto(true)
        io.disconnect()
      }
    }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold, visto])
  return { ref, visto }
}
