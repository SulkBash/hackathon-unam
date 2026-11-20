/**
 * El campo del tiempo: los segundos desde el snap dibujados como un campo de fútbol americano.
 * Franjas de podado cada 0.5 s, líneas cada segundo, hash marks cada 0.1 s, números pintados.
 * La línea amarilla (como la de primera y 10 en la transmisión) marca los 3.5 s.
 * Controlado por `t` (segundos desde el snap): úsalo con usePlayhead para el momento animado,
 * o con el frame actual en la Sala de Video.
 */
type Bucket = { from: number; to: number; value: number }
type Marker = { t: number; label: string }
type Props = {
  t: number
  buckets?: Bucket[]
  markers?: Marker[]
  cliff?: number
  max?: number
  compact?: boolean
  endAt?: number
  endLabel?: string
  unit?: string
}

const C = { stripeA: '#113024', stripeB: '#143829', paint: '#f2f4ee', muted: '#a9bcb1', line: '#ffd43b', red: '#f0525a' }
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)

export default function TimeField({ t, buckets = [], markers = [], cliff = 3.5, max = 6, compact = false, endAt, endLabel = 'Lanzamiento', unit = '%' }: Props) {
  const W = 1200
  const H = compact ? 120 : 340
  const top = compact ? 26 : 92
  const bottom = compact ? 34 : 54
  const plotH = H - top - bottom
  const x = (s: number) => (s / max) * W
  const crossed = t >= cliff
  const vmax = Math.max(1, ...buckets.map((b) => b.value))
  const bands = Array.from({ length: Math.ceil(max / 0.5) }, (_, i) => i)
  const ticks = Array.from({ length: Math.round(max * 10) + 1 }, (_, i) => i / 10)
  const fmt = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toString())
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Segundos desde el snap; umbral en ${cliff} s`} style={{ display: 'block', overflow: 'visible' }}>
      {bands.map((i) => (
        <rect key={i} x={x(i * 0.5)} y={top} width={x(0.5)} height={plotH} fill={i % 2 ? C.stripeB : C.stripeA} />
      ))}
      <rect x={x(cliff)} y={top} width={x(max - cliff)} height={plotH} fill={C.red} opacity={crossed ? 0.08 : 0} style={{ transition: 'opacity 600ms' }} />
      {ticks.map((s) =>
        Number.isInteger(s) ? (
          <line key={s} x1={x(s)} x2={x(s)} y1={top} y2={top + plotH} stroke={C.paint} strokeOpacity={0.28} strokeWidth={2} />
        ) : (
          <g key={s} stroke={C.paint} strokeOpacity={0.26} strokeWidth={1.5}>
            <line x1={x(s)} x2={x(s)} y1={top} y2={top + (compact ? 6 : 9)} />
            <line x1={x(s)} x2={x(s)} y1={top + plotH - (compact ? 6 : 9)} y2={top + plotH} />
          </g>
        ),
      )}
      {buckets.map((b, i) => {
        const p = easeOut(clamp((t - b.from) / 0.45))
        const h = (b.value / vmax) * plotH * 0.78 * p
        const after = b.from >= cliff
        const bx = x(b.from) + 3
        const bw = x(Math.min(b.to, max)) - x(b.from) - 6
        return (
          <g key={i}>
            <rect x={bx} y={top + plotH - h} width={bw} height={h} fill={after ? C.red : C.paint} fillOpacity={after ? 0.92 : 0.3} />
            {p > 0.6 && (
              <text x={bx + bw / 2} y={top + plotH - h - 12} textAnchor="middle" fill={after ? C.red : C.paint} style={{ font: "38px 'Alfa Slab One', Rockwell, serif", opacity: (p - 0.6) / 0.4 }}>
                {fmt(b.value)}
                <tspan style={{ font: "600 18px Barlow, sans-serif" }} dx={2}>{unit}</tspan>
              </text>
            )}
          </g>
        )
      })}
      {!compact &&
        markers.map((m, i) => (
          <g key={m.label} style={{ opacity: t >= m.t ? 1 : 0, transition: 'opacity 400ms' }}>
            <line x1={x(m.t)} x2={x(m.t)} y1={i % 2 ? 46 : 18} y2={top} stroke={C.paint} strokeOpacity={0.5} />
            <text x={x(m.t) + 8} y={i % 2 ? 58 : 30} fill={C.muted} style={{ font: '500 15px Barlow, sans-serif' }}>
              {m.label}
            </text>
          </g>
        ))}
      <g style={{ transformBox: 'fill-box', transformOrigin: 'top', transform: `scaleY(${crossed ? 1 : 0})`, transition: 'transform 500ms cubic-bezier(0.65,0,0.35,1)' }}>
        <rect x={x(cliff) - 2.5} y={compact ? top - 6 : top - 30} width={5} height={plotH + (compact ? 12 : 36)} fill={C.line} />
      </g>
      {!compact ? (
        <text x={x(cliff) + 12} y={top - 12} fill={C.line} style={{ font: "600 20px Barlow, sans-serif", opacity: crossed ? 1 : 0.35, transition: 'opacity 300ms' }}>
          {cliff} s
        </text>
      ) : (
        <text x={x(cliff) + 8} y={top - 4} fill={C.line} style={{ font: "600 18px Barlow, sans-serif" }}>{cliff} s</text>
      )}
      {endAt !== undefined && (
        <g>
          <line x1={x(endAt)} x2={x(endAt)} y1={top} y2={top + plotH} stroke={C.paint} strokeWidth={2} strokeDasharray="4 4" />
          <text x={x(endAt) + 6} y={top + plotH - 6} fill={C.paint} style={{ font: "500 18px Barlow, sans-serif" }}>{endLabel}</text>
        </g>
      )}
      <g transform={`translate(${x(Math.max(0, Math.min(t, max)))} 0)`}>
        <line y1={top} y2={top + plotH} stroke={C.paint} strokeWidth={2.5} />
        <ellipse cy={top} rx={11} ry={6.5} fill="#8a4b2a" stroke={C.paint} strokeWidth={1.5} />
        <line x1={-4} x2={4} y1={top} y2={top} stroke={C.paint} strokeWidth={1.2} />
      </g>
      {Array.from({ length: max + 1 }, (_, s) => (
        <text key={s} x={x(s)} y={H - (compact ? 6 : 10)} textAnchor={s === 0 ? 'start' : s === max ? 'end' : 'middle'} fill={C.paint} fillOpacity={0.55} style={{ font: compact ? "18px 'Alfa Slab One', serif" : "26px 'Alfa Slab One', serif" }}>
          {s}
          {s === max ? ' s' : ''}
        </text>
      ))}
    </svg>
  )
}
