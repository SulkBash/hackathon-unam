import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { JUGADA_DEMO, TimeField, Trails, useInView, usePlayhead } from '../campo'
import { TG, f1, n0, signed, tgAxis, tgTooltip } from '../theme'
import type { CliffBucket, GuerraData, QbClocksData, TeamMatrixRow } from '../types'

type Props = {
  data: GuerraData | null
  error: string | null
  teams: TeamMatrixRow[]
  qbClocks: QbClocksData | null
  teamStability?: Record<string, number>
  onSelectTeam: (team: string) => void
  onWatchDemo: () => void
}

type Ranged = CliffBucket & { from: number; to: number }
type LabelGeom = { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown; index?: number }

// Bordes de los 7 tramos del contrato (definición, no estadística): (0,2] (2,2.5] (2.5,3] (3,3.5] (3.5,4] (4,5] (5,∞)
const EDGES = [0, 2, 2.5, 3, 3.5, 4, 5, 6]

function withRange(b: CliffBucket, i: number): Ranged {
  const nums = (b.bucket.match(/\d+(?:[.,]\d+)?/g) ?? []).map((s) => Number(s.replace(',', '.')))
  let from = EDGES[i] ?? i
  let to = EDGES[i + 1] ?? i + 1
  if (nums.length >= 2) {
    from = nums[0]
    to = nums[1]
  } else if (nums.length === 1 && /[≤<]/.test(b.bucket)) {
    from = 0
    to = nums[0]
  } else if (nums.length === 1 && /[>≥+]/.test(b.bucket)) {
    from = nums[0]
    to = Math.max(6, nums[0] + 1)
  }
  return { ...b, from, to }
}

function wavg(rows: Ranged[], key: 'sack' | 'success' | 'big' | 'pressure'): number | null {
  const n = rows.reduce((a, r) => a + (r.plays || 0), 0)
  if (!n) return null
  return rows.reduce((a, r) => a + r[key] * (r.plays || 0), 0) / n
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))
const pct0 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '–' : `${Math.round(v)}%`)
const ratio = (a?: number | null, b?: number | null) => (a && b ? a / b : null)

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}

function Confianza({ nivel }: { nivel: 'robusto' | 'moderado' }) {
  return (
    <span className="text-[14px] text-slate-300">
      {nivel === 'robusto' ? '🟢 Robusto' : '🟡 Moderado'}
    </span>
  )
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-slate-800 pt-10">
      <h3 className="max-w-4xl text-[28px] leading-tight text-pintura">{title}</h3>
      {note && <div className="mt-2 max-w-3xl text-[15px] leading-relaxed text-slate-400">{note}</div>}
      <div className="mt-6">{children}</div>
    </section>
  )
}

/** Etiqueta de barra con signo: arriba si es positiva, abajo si es negativa. */
function DeltaLabel({ x, y, width, height, value, highlight, extra }: LabelGeom & { highlight?: boolean; extra?: string }) {
  const v = num(value)
  if (Number.isNaN(v)) return null
  const X = num(x) + num(width) / 2
  const Y = num(y)
  const H = num(height)
  const top = Math.min(Y, Y + H)
  const bottom = Math.max(Y, Y + H)
  const ty = v < 0 ? bottom + 20 : top - 8
  return (
    <g>
      <text x={X} y={ty} textAnchor="middle" fill={highlight ? TG.red : TG.text} style={{ font: "600 15px Barlow, sans-serif" }}>
        {signed(v)} pts
      </text>
      {extra && (
        <text x={X} y={v < 0 ? ty + 20 : ty - 22} textAnchor="middle" fill={TG.red} style={{ font: "600 14px Barlow, sans-serif" }}>
          {extra}
        </text>
      )}
    </g>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6 pt-6">
      <div className="tg-skeleton h-14 w-2/3" />
      <div className="tg-skeleton h-6 w-1/2" />
      <div className="tg-skeleton h-[340px] w-full" />
      <div className="grid grid-cols-2 gap-6">
        <div className="tg-skeleton h-40" />
        <div className="tg-skeleton h-40" />
      </div>
    </div>
  )
}

export default function ExecutivePlaybook({ data, error, teams, qbClocks, teamStability, onSelectTeam, onWatchDemo }: Props) {
  // El único momento animado de la página (DESIGN §5): la jugada real corre una vez al entrar en pantalla.
  const { ref, visto } = useInView<HTMLDivElement>(0.2)
  const t = usePlayhead({ from: -0.3, to: 5.5, duration: 4600, run: visto && !!data })

  if (error && !data) {
    return (
      <div className="border-t border-slate-800 pt-10">
        <h2 className="text-[28px] text-pintura">No se pudo cargar el análisis principal</h2>
        <p className="mt-2 max-w-2xl text-slate-300">
          La API <span className="text-pintura">api/guerra</span> no respondió. Revisa que el backend esté corriendo y vuelve a cargar la página.
        </p>
        <p className="mt-2 text-[14px] text-slate-400">{error}</p>
      </div>
    )
  }
  if (!data) return <div ref={ref}><Skeleton /></div>

  const { headline, getoff, play_action: pa, blitz, rush_plans, protection } = data
  const cliff = (data.cliff ?? []).map(withRange)
  const totalPlays = cliff.reduce((a, r) => a + r.plays, 0)
  const findB = (from: number, to: number) => cliff.find((b) => Math.abs(b.from - from) < 1e-6 && Math.abs(b.to - to) < 1e-6)
  const b2530 = findB(2.5, 3)
  const b3035 = findB(3, 3.5)
  const b3540 = findB(3.5, 4)
  const b4050 = findB(4, 5)
  // ~×2.5 cada medio segundo: media geométrica de los pasos 2.5–3.0 → 3.0–3.5 → 3.5–4.0 (tramos de 0.5 s con muestra suficiente)
  const mult =
    data.danger_zone?.sack_multiplier_per_half_second ??
    (b2530 && b3540 && b2530.sack > 0 ? Math.sqrt(b3540.sack / b2530.sack) : null)
  const sackEarly = wavg(cliff.filter((b) => b.to <= 3.5), 'sack')
  const sackAfter4 = wavg(cliff.filter((b) => b.from >= 4), 'sack')
  const successEarly = qbClocks?.league.success_early ?? wavg(cliff.filter((b) => b.to <= 3.5), 'success')
  const successLate = qbClocks?.league.success_late ?? wavg(cliff.filter((b) => b.from >= 3.5), 'success')
  const firstLate = cliff.find((b) => b.from >= 3.5)
  const lastBucket = cliff[cliff.length - 1]
  const bigPeak = cliff.length ? cliff.reduce((a, b) => (b.big > a.big ? b : a), cliff[0]) : null

  const within = [...(getoff?.within_player ?? [])].sort((a, b) => a.delta - b.delta)
  const fast = within[0]
  const slow = within[within.length - 1]
  const goRatio = ratio(fast?.pressure, slow?.pressure)
  const goSnaps = within.reduce((a, r) => a + r.snaps, 0)
  const relGain = getoff ? (getoff.pp_per_tenth / getoff.base_rate) * 100 : null
  const sit3 = getoff?.by_situation?.[0]
  const sitRest = getoff?.by_situation?.[1]

  const bigRatio = ratio(pa?.big_pa, pa?.big_expected)
  const sameSuccess = pa ? Math.abs(pa.success_pa - pa.success_expected) < 2 : false

  const sitRows = (blitz?.by_situation ?? []).map((r) => ({
    ...r,
    label: r.metric === 'conversion' ? `${r.situation} (conversiones)` : r.situation,
  }))
  const flipIdx = sitRows.findIndex((r) => /7/.test(r.situation))
  const early = sitRows[0]
  const third = flipIdx >= 0 ? sitRows[flipIdx] : undefined
  const plans3 = blitz?.third_long_plans
  const stunt3 = plans3?.vs_base.find((p) => /4 con stunt/i.test(p.plan))

  const stunt4 = rush_plans?.find((p) => /4 con stunt/i.test(p.plan))
  const blitzNo = rush_plans?.find((p) => /blitz sin stunt/i.test(p.plan))
  // Auditoría: a la yarda exacta, 4 con stunt y blitz sin stunt NO tienen "el mismo efecto"; solo afirmamos que ambos bajan el éxito.
  const stuntAndBlitzHelp = !!(stunt4 && blitzNo && stunt4.adj_delta < 0 && blitzNo.adj_delta < 0)
  const isSig = (r: { z?: number; adj_delta: number }) => r.adj_delta !== 0 && (r.z === undefined || Math.abs(r.z) >= 2)
  const planMax = Math.max(1, ...(rush_plans ?? []).map((p) => Math.abs(p.adj_delta)), ...sitRows.map((r) => Math.abs(r.adj_delta)))
  const deltaDomain: [number, number] = [-Math.ceil(planMax * 1.45), Math.ceil(planMax * 1.45)]

  const pu = protection?.find((p) => /PU/.test(p.label))
  const pp = protection?.find((p) => /PP/.test(p.label))
  const puRatio = ratio(pu?.lost, pp?.lost)
  const protMax = Math.max(1, ...(protection ?? []).map((p) => p.lost))

  const paRows = pa
    ? [
        { metric: 'Éxito', expected: pa.success_expected, pa: pa.success_pa },
        { metric: 'Jugadas de 20+ yardas', expected: pa.big_expected, pa: pa.big_pa },
        { metric: 'Presión', expected: pa.pressure_expected, pa: pa.pressure_pa },
        { metric: 'Sacks', expected: pa.sack_expected, pa: pa.sack_pa },
      ]
    : []

  // Scatter estable (auditoría): el reloj ofensivo se repite entre mitades; la presión con 4 por equipo no (−0.36)
  const clockTeams = teams.filter((r) => typeof r.off_late_share === 'number' && typeof r.off_press_allowed_rate === 'number')
  const avgLate = clockTeams.length ? clockTeams.reduce((a, r) => a + (r.off_late_share ?? 0), 0) / clockTeams.length : 0
  const avgPress = clockTeams.length ? clockTeams.reduce((a, r) => a + r.off_press_allowed_rate, 0) / clockTeams.length : 0
  const clockR = pearson(clockTeams.map((r) => r.off_late_share ?? 0), clockTeams.map((r) => r.off_press_allowed_rate))

  return (
    <div className="space-y-16 pb-10">
      {/* ------------------------------------------------------------------ HERO */}
      <div ref={ref} className="grid grid-cols-12 gap-x-10 gap-y-8 pt-6">
        <div className="col-span-12 lg:col-span-5">
          <h2 className="text-[44px] leading-[1.04] text-pintura sm:text-[56px]">Dos relojes en cada jugada de pase</h2>
          <p className="mt-6 max-w-[34rem] text-[18px] leading-relaxed text-slate-300">
            Cuando el quarterback tarda más de 3.5 s en soltar el balón, los sacks suben de {pct0(b3035?.sack)} a{' '}
            {pct0(b3540?.sack)}, y llegan a {pct0(b4050?.sack)} pasados los 4 s ({mult ? `~${f1(mult)}×` : ''} cada medio
            segundo). En esa ventana pesan las décimas: arrancar 0.1 s antes aporta ~{f1(getoff?.pp_per_tenth)} pts de
            presión ({relGain !== null ? `≈${Math.round(relGain)}%` : '–'} relativo), y el play action retrasa{' '}
            {f1(pa?.getoff_delta_adj, 2)} s a cada rusher.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button type="button" className="tg-btn tg-btn-primary" onClick={onWatchDemo}>
              Ver esta jugada en video
            </button>
            <span className="text-[15px] text-slate-400">
              {n0(headline?.plays)} pases · {n0(headline?.games)} partidos · {n0(headline?.rusher_snaps)} snaps de rusher
            </span>
          </div>
        </div>
        <figure className="col-span-12 lg:col-span-7">
          <Trails t={t} height={400} />
          <figcaption className="mt-2 text-[15px] text-slate-400">
            {JUGADA_DEMO.titulo} ({JUGADA_DEMO.contexto}). Trayectorias reales del tracking.
          </figcaption>
        </figure>
        <div className="col-span-12">
          <TimeField
            t={t}
            buckets={cliff.map((b) => ({ from: b.from, to: b.to, value: b.sack }))}
            markers={[
              ...(pa ? [{ t: pa.getoff_no_pa, label: `Arranque promedio (${f1(pa.getoff_no_pa, 2)} s, sin PA)` }] : []),
              ...(pa ? [{ t: pa.ttt_no_pa, label: `Lanzamiento mediano (${f1(pa.ttt_no_pa)} s, sin PA)` }] : []),
            ]}
          />
          <p className="mt-3 max-w-3xl text-[15px] text-slate-400">
            Tasa de sacks según tiempo de lanzamiento en {n0(totalPlays)} pases (tracking 10 Hz). Cada franja equivale a 0.5 s;
            la línea amarilla marca los 3.5 s.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------- CUATRO HALLAZGOS */}
      <section className="border-t border-slate-800 pt-10">
        <h3 className="text-[28px] text-pintura">Hallazgos principales</h3>
        <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
          <article className="border-t border-slate-800 pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <h4 className="text-[20px] text-pintura">Sacks y éxito después de 3.5 s</h4>
              <Confianza nivel="robusto" />
            </div>
            <div className="mt-4 flex items-baseline gap-3">
              <span className="tg-cifra text-[44px] text-pintura">{f1(sackEarly)}%</span>
              <span className="text-[20px] text-slate-400">→</span>
              <span className="tg-cifra text-[44px] text-peligro">{f1(sackAfter4)}%</span>
            </div>
            <p className="mt-3 text-[16px] leading-relaxed text-slate-300">
              de sacks antes de 3.5 s frente a más de 4 s. Al pasar 3.5 s, el éxito del pase baja de {f1(successEarly)}% a{' '}
              {f1(successLate)}% en una curva continua.
            </p>
            <p className="mt-2 text-[14px] text-slate-400">n = {n0(totalPlays)} pases con tracking</p>
          </article>

          <article className="border-t border-slate-800 pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <h4 className="text-[20px] text-pintura">Arranque del rusher (get-off)</h4>
              <Confianza nivel="robusto" />
            </div>
            <div className="mt-4 flex items-baseline gap-3">
              <span className="tg-cifra text-[44px] text-peligro">{f1(fast?.pressure)}%</span>
              <span className="text-[20px] text-slate-400">vs</span>
              <span className="tg-cifra text-[44px] text-pintura">{f1(slow?.pressure)}%</span>
            </div>
            <p className="mt-3 text-[16px] leading-relaxed text-slate-300">
              de presión del mismo jugador al arrancar {fast?.label ?? 'antes'} que su mediana frente a {slow?.label ?? 'después'}.
              Cada 0.1 s menos aporta ~{f1(getoff?.pp_per_tenth)} pts sobre una base de {f1(getoff?.base_rate)}%.
            </p>
            <p className="mt-2 text-[14px] text-slate-400">
              n = {n0(goSnaps)} snaps (≥100 por jugador) · r = {f1(getoff?.stability, 2)} entre mitades
            </p>
          </article>

          <article className="border-t border-slate-800 pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <h4 className="text-[20px] text-pintura">Play action y jugadas largas</h4>
              <Confianza nivel="robusto" />
            </div>
            <div className="mt-4 flex items-baseline gap-3">
              <span className="tg-cifra text-[44px] text-pintura">{f1(pa?.big_expected)}%</span>
              <span className="text-[20px] text-slate-400">→</span>
              <span className="tg-cifra text-[44px] text-azul">{f1(pa?.big_pa)}%</span>
            </div>
            <p className="mt-3 text-[16px] leading-relaxed text-slate-300">
              de jugadas de 20+ yardas en el mismo down y distancia ({bigRatio ? `${f1(bigRatio)}×` : '–'}), con igual éxito (
              {f1(pa?.success_pa)}% vs {f1(pa?.success_expected)}%). Frena {f1(pa?.getoff_delta_adj, 2)} s al rusher, aunque
              alarga el lanzamiento.
            </p>
            <p className="mt-2 text-[14px] text-slate-400">Frecuencia en la liga: {f1(pa?.pa_rate)}% de los pases</p>
          </article>

          <article className="border-t border-slate-800 pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <h4 className="text-[20px] text-pintura">Efecto del blitz por down</h4>
              <Confianza nivel="moderado" />
            </div>
            <div className="mt-4 flex items-baseline gap-3">
              <span className="tg-cifra text-[44px] text-pintura">{signed(blitz?.flip.early)}</span>
              <span className="text-[20px] text-slate-400">vs</span>
              <span className="tg-cifra text-[44px] text-peligro">{signed(blitz?.flip.third_long)}</span>
            </div>
            <p className="mt-3 text-[16px] leading-relaxed text-slate-300">
              pts de éxito rival en 1ro/2do frente a conversiones en 3ro y 7+ a igual distancia. En 3ro y 7+ suben los sacks (
              {f1(blitz?.third_long_sacks.rush4)}% → {f1(blitz?.third_long_sacks.blitz)}%) y también las conversiones, justo
              donde más se manda ({pct0(third?.blitz_share)} vs {pct0(early?.blitz_share)}). Rush de 4 con stunt:{' '}
              {signed(stunt3?.adj_delta)} pts (muestra chica).
            </p>
            <p className="mt-2 text-[14px] text-slate-400">
              Diferencia entre situaciones: {f1(blitz?.flip.diff)} pts (z ≈ {f1(blitz?.flip.z)})
            </p>
          </article>
        </div>
      </section>

      {/* ------------------------------------------------------ (a) ZONA DE PELIGRO */}
      <Section
        title="Después de 3.5 s, el riesgo de sack se dispara mientras el éxito cae"
        note={
          <>
            Barras: % de sacks. Líneas: % de éxito y jugadas de 20+ yardas. El éxito baja de forma continua; las jugadas largas
            alcanzan su pico entre {bigPeak?.bucket ?? '–'} ({f1(bigPeak?.big)}%).
          </>
        }
      >
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={cliff} margin={{ top: 24, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={TG.grid} vertical={false} />
              <XAxis dataKey="bucket" {...tgAxis} interval={0} />
              <YAxis {...tgAxis} unit="%" width={48} />
              {firstLate && lastBucket && (
                <ReferenceArea x1={firstLate.bucket} x2={lastBucket.bucket} fill={TG.red} fillOpacity={0.07} />
              )}
              {firstLate && (
                <ReferenceLine
                  x={firstLate.bucket}
                  position="start"
                  stroke={TG.line}
                  strokeWidth={3}
                  label={{ value: '3.5 s', position: 'insideTopRight', fill: TG.line, fontSize: 15, fontWeight: 600 }}
                />
              )}
              <Tooltip
                {...tgTooltip}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const r = payload[0].payload as Ranged
                  return (
                    <div className="rounded border border-slate-600 bg-cesped-claro px-3 py-2 text-[13px] text-pintura">
                      <div className="font-semibold">Lanzamiento en {r.bucket}</div>
                      <div className="mt-1 text-slate-300">Sacks {f1(r.sack)}%, éxito {f1(r.success)}%</div>
                      <div className="text-slate-300">Jugadas de 20+ yardas {f1(r.big)}%, presión {f1(r.pressure)}%</div>
                      <div className="text-slate-400">n = {n0(r.plays)} pases</div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="sack" name="Sacks" maxBarSize={56}>
                {cliff.map((b) => (
                  <Cell key={b.bucket} fill={b.from >= 3.5 ? TG.red : TG.neutral} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="success" name="Éxito" stroke={TG.text} strokeWidth={2.5} dot={{ r: 3.5, fill: TG.text, strokeWidth: 0 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="big" name="Jugadas de 20+ yardas" stroke={TG.blue} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: TG.blue, strokeWidth: 0 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-slate-300">
          <span className="flex items-center gap-2"><span className="inline-block h-3 w-4" style={{ background: TG.neutral }} />Sacks antes de 3.5 s</span>
          <span className="flex items-center gap-2"><span className="inline-block h-3 w-4" style={{ background: TG.red }} />Sacks después de 3.5 s</span>
          <span className="flex items-center gap-2"><span className="inline-block h-[3px] w-5" style={{ background: TG.text }} />Éxito</span>
          <span className="flex items-center gap-2"><span className="inline-block h-[3px] w-5" style={{ background: TG.blue }} />Jugadas de 20+ yardas</span>
        </div>
      </Section>

      {/* ------------------------------------------------------ (b) GET-OFF */}
      <Section
        title={goRatio ? `Arrancar antes multiplica por ${f1(goRatio)} la presión del mismo rusher` : 'Presión según el arranque del rusher'}
        note="Comparación de cada jugador contra su propia mediana de get-off (segundos desde el snap hasta avanzar 1 yarda)."
      >
        <div className="grid grid-cols-12 gap-x-10 gap-y-6">
          <div className="col-span-12 h-[300px] lg:col-span-8">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={within} margin={{ top: 28, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={TG.grid} vertical={false} />
                <XAxis dataKey="label" {...tgAxis} interval={0} />
                <YAxis {...tgAxis} unit="%" width={48} />
                <Tooltip
                  {...tgTooltip}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const r = payload[0].payload as (typeof within)[number]
                    return (
                      <div className="rounded border border-slate-600 bg-cesped-claro px-3 py-2 text-[13px] text-pintura">
                        <div className="font-semibold">{r.label}</div>
                        <div className="text-slate-300">Presión {f1(r.pressure)}%</div>
                        <div className="text-slate-400">n = {n0(r.snaps)} snaps</div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="pressure" maxBarSize={64}>
                  {within.map((r) => (
                    <Cell key={r.delta} fill={r === fast ? TG.red : r.delta < 0 ? TG.neutralStrong : TG.neutral} />
                  ))}
                  <LabelList dataKey="pressure" position="top" fill={TG.text} fontSize={14} formatter={(v: unknown) => `${f1(num(v))}%`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="col-span-12 space-y-5 lg:col-span-4">
            <div>
              <div className="tg-cifra text-[44px] text-pintura">+{f1(getoff?.pp_per_tenth)}</div>
              <p className="mt-1 text-[16px] text-slate-300">
                pts de presión por cada 0.1 s más rápido que su promedio ({relGain !== null ? `≈${Math.round(relGain)}%` : '–'}{' '}
                sobre una base de {f1(getoff?.base_rate)}%).
              </p>
            </div>
            {sit3 && sitRest && (
              <p className="text-[16px] leading-relaxed text-slate-300">
                El patrón se mantiene en {sit3.situation} ({f1(sit3.faster)}% rápido vs {f1(sit3.slower)}% lento) y en el resto
                de jugadas ({f1(sitRest.faster)}% vs {f1(sitRest.slower)}%).
              </p>
            )}
            <p className="text-[15px] text-slate-400">
              Estabilidad entre semanas 1–4 y 5–8: r = {f1(getoff?.stability, 2)}. Es una métrica consistente de cada jugador.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------ (c) PLANES DE RUSH */}
      <Section
        title={
          stuntAndBlitzHelp
            ? 'Planes de presión: blitz sin stunt y rush de 4 con stunt'
            : 'Éxito del rival según el plan de presión'
        }
        note="Diferencia frente al rush de 4 sin stunt, ajustada por down y distancia exacta. Stunt: cruce de dos rushers. Blitz: 5+ rushers. En gris, valores sin significancia individual (|z| < 2)."
      >
        <div className="grid grid-cols-12 gap-x-10 gap-y-6">
          <div className="col-span-12 lg:col-span-7">
            <p className="text-[14px] text-slate-300">
              Cambio en éxito rival vs rush de 4 sin stunt (negativo favorece a la defensa)
            </p>
            <div className="mt-2 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rush_plans ?? []} margin={{ top: 28, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={TG.grid} vertical={false} />
                  <XAxis dataKey="plan" {...tgAxis} interval={0} />
                  <YAxis {...tgAxis} unit=" pts" width={60} domain={deltaDomain} />
                  <ReferenceLine y={0} stroke={TG.text} strokeOpacity={0.5} />
                  <Tooltip
                    {...tgTooltip}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const r = payload[0].payload as NonNullable<typeof rush_plans>[number]
                      return (
                        <div className="rounded border border-slate-600 bg-cesped-claro px-3 py-2 text-[13px] text-pintura">
                          <div className="font-semibold">{r.plan}</div>
                          <div className="text-slate-300">
                            Cambio ajustado {signed(r.adj_delta)} pts{r.z !== undefined ? ` (z ${f1(r.z)})` : ''}
                          </div>
                          <div className="text-slate-300">Presión {f1(r.pressure)}%, sacks {f1(r.sack)}%</div>
                          <div className="text-slate-400">n = {n0(r.plays)} jugadas</div>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="adj_delta" maxBarSize={72}>
                    {(rush_plans ?? []).map((r) => (
                      <Cell key={r.plan} fill={isSig(r) ? TG.neutralStrong : 'rgba(242,244,238,0.16)'} />
                    ))}
                    <LabelList
                      dataKey="adj_delta"
                      content={(p: unknown) => <DeltaLabel {...(p as LabelGeom)} />}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-5">
            <table className="w-full text-left text-[14px] tabular-nums">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 text-right font-medium">Jugadas</th>
                  <th className="py-2 text-right font-medium">Presión</th>
                  <th className="py-2 text-right font-medium">Sacks</th>
                  <th className="py-2 text-right font-medium">Ajustado</th>
                  <th className="py-2 text-right font-medium">z</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {(rush_plans ?? []).map((r) => (
                  <tr key={r.plan} className={`border-b border-slate-800/70 ${r.plays < 50 ? 'text-slate-500' : ''}`}>
                    <td className="py-2">{r.plan}</td>
                    <td className="py-2 text-right">{n0(r.plays)}</td>
                    <td className="py-2 text-right">{f1(r.pressure)}%</td>
                    <td className="py-2 text-right">{f1(r.sack)}%</td>
                    <td className={`py-2 text-right ${isSig(r) ? 'text-pintura' : 'text-slate-400'}`}>{signed(r.adj_delta)}</td>
                    <td className="py-2 text-right text-slate-400">{r.z !== undefined && r.adj_delta !== 0 ? f1(r.z) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stunt4 && blitzNo && (
              <p className="mt-4 text-[15px] leading-relaxed text-slate-300">
                El blitz sin stunt reduce el éxito rival en {signed(blitzNo.adj_delta)} pts. El rush de 4 con stunt apunta en la
                misma dirección ({signed(stunt4.adj_delta)} pts) sin restar cobertura, aunque sin significancia estadística propia.
              </p>
            )}
            <p className="mt-2"><Confianza nivel="moderado" /></p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------ (d) BLITZ POR SITUACIÓN */}
      <Section
        title="El blitz funciona en 1er y 2do down, pero se invierte en 3ro y largo"
        note={
          <>
            Blitz frente a rush de 3–4 a igual distancia exacta. En 3ro y 7+ genera más sacks ({f1(blitz?.third_long_sacks.rush4)}% →{' '}
            {f1(blitz?.third_long_sacks.blitz)}%), pero también más conversiones, justo donde más se manda (
            {pct0(third?.blitz_share)} vs {pct0(early?.blitz_share)} en 1ro y 2do).
          </>
        }
      >
        <div className="grid grid-cols-12 gap-x-10 gap-y-6">
          <div className="col-span-12 lg:col-span-7">
            <p className="text-[14px] text-slate-300">Cambio en éxito o conversión rival con blitz (negativo favorece a la defensa)</p>
            <div className="mt-2 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sitRows} margin={{ top: 48, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={TG.grid} vertical={false} />
                  <XAxis dataKey="label" {...tgAxis} interval={0} />
                  <YAxis {...tgAxis} unit=" pts" width={60} domain={deltaDomain} />
                  <ReferenceLine y={0} stroke={TG.text} strokeOpacity={0.5} />
                  <Tooltip
                    {...tgTooltip}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const r = payload[0].payload as (typeof sitRows)[number]
                      return (
                        <div className="rounded border border-slate-600 bg-cesped-claro px-3 py-2 text-[13px] text-pintura">
                          <div className="font-semibold">{r.label}</div>
                          <div className="text-slate-300">Blitz vs rush de 3–4: {signed(r.adj_delta)} pts</div>
                          {r.blitz_share !== undefined && <div className="text-slate-300">Uso del blitz: {f1(r.blitz_share)}%</div>}
                          {r.plays !== undefined && <div className="text-slate-400">n = {n0(r.plays)} jugadas</div>}
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="adj_delta" maxBarSize={72}>
                    {sitRows.map((r, i) => (
                      <Cell key={r.situation} fill={i === flipIdx ? TG.red : TG.neutral} />
                    ))}
                    <LabelList
                      dataKey="adj_delta"
                      content={(p: unknown) => {
                        const g = p as LabelGeom
                        const hi = g.index === flipIdx
                        return <DeltaLabel {...g} highlight={hi} extra={hi ? 'Se invierte' : undefined} />
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[14px] text-slate-400">
              Por separado ninguna barra es significativa; la diferencia entre 1ro/2do y 3ro y 7+ ({f1(blitz?.flip.diff)} pts, z ≈{' '}
              {f1(blitz?.flip.z)}) queda al límite. <Confianza nivel="moderado" />
            </p>
          </div>
          <div className="col-span-12 lg:col-span-5">
            <div className="rounded-md border border-slate-800 p-5">
              <h4 className="text-[18px] text-pintura">Opciones en 3ro y 7+</h4>
              <p className="mt-1 text-[14px] text-slate-400">
                Frente a rush de 4 sin stunt ({f1(plans3?.base.conversion)}% de conversión, n = {n0(plans3?.base.plays)}), a igual
                distancia. Muestra chica.
              </p>
              <table className="mt-3 w-full text-left text-[14px] tabular-nums">
                <thead className="text-slate-400">
                  <tr className="border-b border-slate-800">
                    <th className="py-2 font-medium">Plan</th>
                    <th className="py-2 text-right font-medium">Conversión</th>
                    <th className="py-2 text-right font-medium">Sacks</th>
                    <th className="py-2 text-right font-medium">n</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {(plans3?.vs_base ?? []).map((p) => (
                    <tr key={p.plan} className={`border-b border-slate-800/70 ${p.plays < 50 ? 'text-slate-500' : ''}`}>
                      <td className="py-2">{p.plan}</td>
                      <td className={`py-2 text-right ${p === stunt3 ? 'text-peligro' : ''}`}>{signed(p.adj_delta)} pts</td>
                      <td className="py-2 text-right">{p.sack !== undefined ? `${f1(p.sack)}%` : '–'}</td>
                      <td className="py-2 text-right">{n0(p.plays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stunt3 && (
                <p className="mt-3 text-[15px] leading-relaxed text-slate-300">
                  El rush de 4 con stunt tuvo el mejor estimado ({signed(stunt3.adj_delta)} pts), en línea con el dato global,
                  pero sin significancia estadística propia.
                </p>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------ (e) PLAY ACTION */}
      <Section
        title={
          sameSuccess && bigRatio
            ? `El play action multiplica por ${f1(bigRatio)} las jugadas de 20+ yardas`
            : 'Efecto del play action'
        }
        note="Comparado contra pases sin play action en el mismo down y distancia exacta."
      >
        <div className="grid grid-cols-12 gap-x-10 gap-y-6">
          <div className="col-span-12 h-[300px] lg:col-span-8">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paRows} margin={{ top: 28, right: 8, left: 0, bottom: 4 }} barGap={6}>
                <CartesianGrid stroke={TG.grid} vertical={false} />
                <XAxis dataKey="metric" {...tgAxis} interval={0} />
                <YAxis {...tgAxis} unit="%" width={48} />
                <Tooltip
                  {...tgTooltip}
                  formatter={(v: unknown, name: unknown) => [`${f1(num(v))}%`, String(name)]}
                />
                <Bar dataKey="expected" name="Sin play action" fill={TG.neutral} maxBarSize={48}>
                  <LabelList dataKey="expected" position="top" fill={TG.muted} fontSize={13} formatter={(v: unknown) => `${f1(num(v))}%`} />
                </Bar>
                <Bar dataKey="pa" name="Con play action" fill={TG.blue} maxBarSize={48}>
                  <LabelList dataKey="pa" position="top" fill={TG.text} fontSize={13} formatter={(v: unknown) => `${f1(num(v))}%`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-x-6 text-[14px] text-slate-300">
              <span className="flex items-center gap-2"><span className="inline-block h-3 w-4" style={{ background: TG.neutral }} />Sin play action (mismo down y distancia)</span>
              <span className="flex items-center gap-2"><span className="inline-block h-3 w-4" style={{ background: TG.blue }} />Con play action</span>
            </div>
          </div>
          <div className="col-span-12 space-y-5 lg:col-span-4">
            <div>
              <div className="tg-cifra text-[44px] text-azul">{f1(pa?.getoff_delta_adj, 2)} s</div>
              <p className="mt-1 text-[16px] text-slate-300">
                retrasa en promedio a cada rusher (mismo jugador, down y distancia).
              </p>
            </div>
            <p className="text-[16px] leading-relaxed text-slate-300">
              A cambio, el QB tarda más en soltar ({f1(pa?.ttt_pa)} s vs {f1(pa?.ttt_no_pa)} s de mediana), lo que eleva la
              presión ({f1(pa?.pressure_pa)}% vs {f1(pa?.pressure_expected)}%) y los sacks ({f1(pa?.sack_pa)}% vs{' '}
              {f1(pa?.sack_expected)}%).
            </p>
            <p className="text-[16px] leading-relaxed text-slate-300">
              Con rollout diseñado, los sacks en play action bajan a {f1(pa?.pa_rollout_sack)}% (n = {n0(pa?.pa_rollout_n)})
              frente a {f1(pa?.pa_no_rollout_sack)}% desde el pocket. El {f1(pa?.rollout_pa_share, 0)}% de los rollouts usan
              play action.
            </p>
            <Confianza nivel="robusto" />
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------ (f) PROTECCIÓN */}
      <Section
        title={
          puRatio
            ? `El corredor recogiendo blitz pierde ${f1(puRatio)} veces más duelos que la línea`
            : 'Puntos débiles en la protección'
        }
        note="Duelo perdido: el bloqueador fue superado o permitió golpe, apuro o sack."
      >
        <div className="max-w-3xl space-y-4">
          {(protection ?? []).map((p) => {
            const hi = p === pu
            return (
              <div key={p.label}>
                <div className="flex items-baseline justify-between gap-4 text-[15px]">
                  <span className={hi ? 'text-pintura' : 'text-slate-300'}>{p.label}</span>
                  <span className="tabular-nums text-slate-400">n = {n0(p.reps)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-3 flex-1 rounded-sm bg-slate-900">
                    <div className="h-3 rounded-sm" style={{ width: `${(p.lost / protMax) * 100}%`, background: hi ? TG.red : TG.neutral }} />
                  </div>
                  <span className={`w-16 text-right tabular-nums text-[15px] ${hi ? 'text-peligro' : 'text-pintura'}`}>{f1(p.lost)}%</span>
                </div>
              </div>
            )
          })}
          <p className="pt-2 text-[15px] text-slate-400">
            Mandar al corredor a ruta contra el blitz no empeora el resultado; dejarlo solo bloqueando es el punto más
            vulnerable. <Confianza nivel="moderado" />
          </p>
        </div>
      </Section>

      {/* ------------------------------------------------------ 32 OFENSIVAS: RELOJ vs PRESIÓN */}
      {clockTeams.length >= 10 && (
        <Section
          title={
            clockR !== null && clockR > 0.3
              ? 'Los equipos cuyo QB tarda más en lanzar reciben más presión'
              : 'Tiempo de lanzamiento y presión permitida por equipo'
          }
          note={
            <>
              Cada punto es una ofensiva en las 8 semanas (r = {f1(clockR, 2)} entre los {clockTeams.length} equipos).
              {teamStability?.off_late_share !== undefined && (
                <> Estabilidad del % &gt; 3.5 s entre mitades: r = {f1(teamStability.off_late_share, 2)}.</>
              )}{' '}
              Haz clic en un equipo para ver su plan de juego.
            </>
          }
        >
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 24, left: 0, bottom: 24 }}>
                <CartesianGrid stroke={TG.grid} />
                <XAxis
                  type="number"
                  dataKey="off_late_share"
                  name="% de pases después de 3.5 s"
                  unit="%"
                  domain={['dataMin - 2', 'dataMax + 2']}
                  {...tgAxis}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                  label={{ value: '% de pases que salen después de 3.5 s', position: 'insideBottom', offset: -14, fill: TG.axis, fontSize: 13 }}
                />
                <YAxis
                  type="number"
                  dataKey="off_press_allowed_rate"
                  name="Presión permitida"
                  unit="%"
                  domain={['dataMin - 2', 'dataMax + 2']}
                  {...tgAxis}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                  width={56}
                  label={{ value: '% de pases con presión permitida', angle: -90, position: 'insideLeft', offset: 8, fill: TG.axis, fontSize: 13 }}
                />
                <ReferenceLine x={avgLate} stroke={TG.text} strokeOpacity={0.35} strokeDasharray="4 4" />
                <ReferenceLine y={avgPress} stroke={TG.text} strokeOpacity={0.35} strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3', stroke: TG.axis }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const r = payload[0].payload as TeamMatrixRow
                    return (
                      <div className="rounded border border-slate-600 bg-cesped-claro px-3 py-2 text-[13px] text-pintura">
                        <div className="font-semibold">{r.teamName} ({r.team})</div>
                        <div className="text-slate-300">Pases después de 3.5 s: {f1(r.off_late_share)}%</div>
                        <div className="text-slate-300">Lanzamiento mediano: {f1(r.off_ttt_median)} s</div>
                        <div className="text-slate-300">Presión permitida: {f1(r.off_press_allowed_rate)}%, sacks {f1(r.off_sack_rate)}%</div>
                        <div className="text-slate-400">Clic para abrir su plan de juego</div>
                      </div>
                    )
                  }}
                />
                <Scatter
                  data={clockTeams}
                  fill={TG.text}
                  fillOpacity={0.85}
                  className="cursor-pointer"
                  onClick={(pt) => {
                    const row = (pt as unknown as { payload?: TeamMatrixRow })?.payload
                    if (row?.team) onSelectTeam(row.team)
                  }}
                >
                  <LabelList dataKey="team" position="top" fill={TG.muted} fontSize={11} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* ------------------------------------------------------ LO QUE DESCARTAMOS */}
      <section className="border-t border-slate-800 pt-10">
        <div className="rounded-md border border-slate-800 p-6 sm:p-8">
          <h3 className="text-[28px] text-pintura">Lo que descartamos</h3>
          <p className="mt-2 max-w-3xl text-[15px] text-slate-400">
            Hipótesis probadas con los mismos datos que no superaron los controles de situación, tiempo de lanzamiento, efectos
            fijos por jugador o estabilidad entre mitades.
          </p>
          <ul className="mt-6 grid grid-cols-1 gap-x-10 gap-y-4 text-[15px] leading-relaxed text-slate-300 md:grid-cols-2">
            <li><span className="text-pintura">"El play action sube la tasa de éxito".</span> Efecto del down: se usa mucho más en 1er down, donde el umbral de éxito es menor. En el mismo down y distancia: {f1(pa?.success_pa)}% vs {f1(pa?.success_expected)}%.</li>
            <li><span className="text-pintura">"Cada QB cae distinto después de 3.5 s".</span> La caída de éxito individual no es estable entre mitades; solo el tiempo que sostiene el balón se mantiene.</li>
            <li><span className="text-pintura">"Dos bloqueos dobles dejan un rusher libre".</span> Artefacto de registro: PFF anota solo el primer defensor bloqueado, por lo que los stunts figuran como dobles falsos.</li>
            <li><span className="text-pintura">"Estrellas invisibles" (gravity).</span> La presión de compañeros cuando un liniero recibe doble marca no es estable entre mitades.</li>
            <li><span className="text-pintura">"Presión fantasma".</span> Rushers a 2–3 yd sin presión oficial: al controlar por tiempo de lanzamiento, la brecha deja de ser significativa.</li>
            <li><span className="text-pintura">"Tackles pesados pierden contra rushers ligeros".</span> Confusión por posición (los ligeros son edges). Frente al mismo rusher, el efecto se invierte.</li>
            <li><span className="text-pintura">"En 3.5 s hay un quiebre abrupto".</span> No existe un cambio de pendiente significativo; el riesgo sube de forma continua y 3.5 s funciona como referencia práctica.</li>
            <li><span className="text-pintura">"Blitz en 3ro y largo como jugada definitiva".</span> Sube los sacks, pero también las conversiones a igual distancia.</li>
            <li><span className="text-pintura">"Rollout a la derecha".</span> Selección sesgada de un solo lado. Considerando ambos lados, los rollouts diseñados registran {f1(pa?.rollout_sack)}% de sacks frente a {f1(pa?.pocket_sack)}% desde el pocket.</li>
            <li><span className="text-pintura">Fatiga del rusher.</span> La presión no cae al acumular snaps en el partido, incluso dentro del mismo jugador.</li>
            <li><span className="text-pintura">Ruido del estadio.</span> Diferencia mínima entre local y visitante.</li>
            <li><span className="text-pintura">Vulnerabilidad de equipo a stunts.</span> No se mantiene entre semanas 1–4 y 5–8.</li>
          </ul>
        </div>
      </section>
    </div>
  )
}
