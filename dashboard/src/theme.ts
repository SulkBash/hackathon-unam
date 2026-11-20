// Paleta "El campo" (DESIGN.md §2 y §7). Cada color tiene un solo trabajo:
// - line (amarillo): SOLO el umbral de 3.5 s, la selección y la acción principal.
// - blue: línea de golpeo, QB, ofensiva.
// - red: lo que pasa después de 3.5 s y el rusher que llega (la barra que cuenta el hallazgo).
// - neutral: barras neutras (pintura al 30%).
export const TG = {
  grid: '#1b382d',
  axis: '#8aa094',
  text: '#f2f4ee',
  muted: '#a9bcb1',
  neutral: 'rgba(242,244,238,0.3)',
  neutralStrong: 'rgba(242,244,238,0.55)',
  line: '#ffd43b',
  blue: '#4a8af4',
  red: '#f0525a',
  tooltipBg: '#143829',
  tooltipBorder: '#5a7566',
  cesped: '#113024',
  cespedClaro: '#143829',
  noche: '#0c2219',
} as const

export const tgTooltip = {
  contentStyle: { background: TG.tooltipBg, border: `1px solid ${TG.tooltipBorder}`, borderRadius: 4, color: TG.text, fontSize: 13 },
  labelStyle: { color: TG.text, fontWeight: 600 },
  itemStyle: { color: TG.text },
  cursor: { fill: 'rgba(242,244,238,0.06)' },
}

export const tgAxis = {
  tick: { fill: TG.axis, fontSize: 13 },
  tickLine: false,
  axisLine: { stroke: TG.grid },
} as const

/** Formatea un número con 1 decimal (o `digits`), tolerante a null/undefined. */
export function f1(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–'
  return v.toFixed(digits)
}

/** Signo explícito: +4.5 / −2.4 (usa el signo menos tipográfico). */
export function signed(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–'
  const s = Math.abs(v).toFixed(digits)
  if (Number(s) === 0) return s
  return v > 0 ? `+${s}` : `−${s}`
}

/** Número entero con separador de miles (es-MX). */
export function n0(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–'
  return Math.round(v).toLocaleString('es-MX')
}
