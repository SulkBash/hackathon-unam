import { curva } from './curva'
import { JUGADA_DEMO } from './jugadaDemo'

/**
 * Trazos de la jugada: las rutas reales de los rushers y del QB dibujadas como curvas suaves
 * que avanzan con `t` (segundos desde el snap). Es el movimiento del juego, no decoración.
 */
type Props = { t: number; jugada?: typeof JUGADA_DEMO; height?: number }

export default function Trails({ t, jugada = JUGADA_DEMO, height = 360 }: Props) {
  // Vista desde atrás de la defensa: la línea de golpeo arriba, los rushers bajan hacia el QB.
  const all = jugada.jugadores.flatMap((j) => j.xy)
  const fx = all.filter((_, i) => i % 2 === 0)
  const fy = all.filter((_, i) => i % 2 === 1)
  const pad = 30
  const minX = Math.min(...fx) - pad, maxX = Math.max(...fx) + pad
  const minY = Math.min(...fy) - pad, maxY = Math.max(...fy) + pad
  const W = 760
  const sc = Math.min(W / (maxY - minY), height / (maxX - minX))
  const ox = (W - (maxY - minY) * sc) / 2
  const oy = (height - (maxX - minX) * sc) / 2
  const P = (px: number, py: number): [number, number] => [ox + (py - minY) * sc, oy + (maxX - px) * sc]
  const idx = Math.max(0, (t - jugada.inicio) / jugada.paso)
  const trazo = (xy: number[]) => {
    const n = xy.length / 2
    const k = Math.min(idx, n - 1)
    const pts: [number, number][] = []
    for (let i = 0; i <= Math.floor(k); i++) pts.push(P(xy[i * 2], xy[i * 2 + 1]))
    const f = k - Math.floor(k)
    if (f > 0 && Math.floor(k) + 1 < n) {
      const a = Math.floor(k), b = a + 1
      pts.push(P(xy[a * 2] + (xy[b * 2] - xy[a * 2]) * f, xy[a * 2 + 1] + (xy[b * 2 + 1] - xy[a * 2 + 1]) * f))
    }
    return pts
  }
  const los = P(890, 0)[1]
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`Rutas de la jugada: ${jugada.titulo}`} style={{ display: 'block', overflow: 'visible' }}>
      {[-50, 0, 50, 100, 150].map((d) => {
        const yy = P(890 - d, 0)[1]
        return yy > 0 && yy < height ? <line key={d} x1={0} x2={W} y1={yy} y2={yy} stroke="#f2f4ee" strokeOpacity={0.07} strokeWidth={1.5} /> : null
      })}
      <line x1={0} x2={W} y1={los} y2={los} stroke="#4a8af4" strokeOpacity={0.6} strokeWidth={2} />
      {jugada.jugadores.map((j) => {
        const pts = trazo(j.xy)
        const head = pts[pts.length - 1]
        const isFocus = j.num === jugada.enfoque
        const color = j.role === 'Q' ? '#4a8af4' : isFocus ? '#f0525a' : '#f2f4ee'
        const op = j.role === 'B' ? 0.22 : isFocus || j.role === 'Q' ? 1 : 0.6
        const w = j.role === 'B' ? 1.5 : isFocus ? 3.5 : j.role === 'Q' ? 3 : 2
        return (
          <g key={j.num}>
            <path d={curva(pts)} fill="none" stroke={color} strokeOpacity={op} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
            {head && <circle cx={head[0]} cy={head[1]} r={j.role === 'B' ? 3 : 5.5} fill={color} fillOpacity={j.role === 'B' ? 0.4 : 1} stroke="#0c2219" strokeWidth={2} />}
            {head && j.name && (isFocus || j.role === 'Q') && (
              <text x={head[0] + (j.role === 'Q' ? -14 : 10)} y={head[1] + (j.role === 'Q' ? 5 : -14)} textAnchor={j.role === 'Q' ? 'end' : 'start'} fill={color} style={{ font: '600 15px Barlow, sans-serif' }}>{j.name}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
