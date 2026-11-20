import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TimeField } from '../campo'
import { TG, f1, tgAxis, tgTooltip } from '../theme'
import type { CoachBriefResponse, PlayRosterMeta, PlaySummary, PlayTrackingData, TeamMatrixRow } from '../types'

interface Props {
  initialPlay: { gameId: number; playId: number } | null
  teams: TeamMatrixRow[]
}

/** Umbral de la zona de peligro (no es un peligro: el riesgo crece de forma continua). */
const THRESHOLD = 3.5

/** Mismo conjunto que backend/pipeline/build_tracking_features.py (END): eventos que terminan el dropback. */
const END_EVENTS = new Set(['pass_forward', 'autoevent_passforward', 'qb_sack', 'qb_strip_sack', 'run', 'fumble'])

const CATEGORIES: { id: string; label: string }[] = [
  { id: '', label: 'Todas las jugadas' },
  { id: 'cliff', label: 'Después de 3.5 s' },
  { id: 'play_action', label: 'Play action' },
  { id: 'stunt', label: 'Rush de 4 con stunt' },
  { id: 'blitz_3rd_long', label: 'Blitz en 3ro y largo' },
  { id: 'rollout', label: 'Rollouts diseñados' },
  { id: 'sack', label: 'Sacks' },
]

/** Afirmaciones descartadas en PLAN.md (doble marca = rusher libre, gravity, "golpe de gracia"). Nunca se muestran. */
const REMOVED_CLAIM = /gravity|over-?allocation|free rusher|rusher libre|double-team|instant collapse/i
const REMOVED_NOTE = /libre|free|over-?alloc/i
/** Notas del backend v1 (en inglés): si llegan, se reemplazan por notas en español calculadas con los mismos datos. */
const ENGLISH_NOTE = /double-teamed|unblocked|pressure generated|clean pocket|protection stress|nearest pass rusher/i

const THREAT_LABEL: Record<string, string> = { CLEAN: 'Limpio', CLOSING: 'Cerrándose', COLLAPSE: 'Colapso' }

const ROLE_LABEL: Record<string, string> = {
  Pass: 'QB',
  'Pass Rush': 'Pass rusher',
  'Pass Block': 'Bloqueo',
  'Pass Route': 'Ruta',
  Coverage: 'Cobertura',
}

// Etiquetas de pff_blockType según README_DATA.md (PLAN, decisión 27).
const BLOCK_LABEL: Record<string, string> = {
  PU: 'Recogida del RB',
  UP: 'Jalón',
  CL: 'Segundo nivel',
  SR: 'Set & release',
  PT: 'Post',
  SW: 'Switch (stunt)',
  CH: 'Chip',
  BH: 'Ayuda desde el backfield',
  PA: 'Protección de play action',
  PP: 'Protección estándar',
  PR: 'Pocket móvil',
  NB: 'Sin bloqueo',
}

const EVENT_LABEL: Record<string, string> = {
  ball_snap: 'Snap',
  autoevent_ballsnap: 'Snap',
  pass_forward: 'Lanzamiento',
  autoevent_passforward: 'Lanzamiento',
  pass_shovel: 'Pase shovel',
  play_action: 'Amague de play action',
  qb_sack: 'Sack',
  qb_strip_sack: 'Sack con balón suelto',
  run: 'Scramble',
  fumble: 'Balón suelto',
  pass_arrived: 'Llega el pase',
  autoevent_passinterrupted: 'Pase interrumpido',
  pass_outcome_caught: 'Pase atrapado',
  pass_outcome_incomplete: 'Pase incompleto',
  pass_outcome_interception: 'Intercepción',
  pass_outcome_touchdown: 'Touchdown',
  pass_tipped: 'Pase desviado',
  first_contact: 'Primer contacto',
  tackle: 'Tackle',
  out_of_bounds: 'Fuera del campo',
  line_set: 'Línea lista',
  man_in_motion: 'Jugador en movimiento',
  shift: 'Cambio de formación',
  huddle_break_offense: 'Salen del huddle',
  handoff: 'Entrega',
  lateral: 'Lateral',
  penalty_flag: 'Castigo',
  touchdown: 'Touchdown',
}

function endLabelFor(ev: string | null | undefined): string {
  switch (ev) {
    case 'pass_forward':
    case 'autoevent_passforward':
    case 'pass_shovel':
      return 'Lanzamiento'
    case 'qb_sack':
    case 'qb_strip_sack':
      return 'Sack'
    case 'run':
      return 'Scramble'
    default:
      return 'Fin del dropback'
  }
}

/** "el lanzamiento", "el sack"... para frases. */
function endWordFor(label: string): string {
  if (label === 'Lanzamiento') return 'el lanzamiento'
  if (label === 'Sack') return 'el sack'
  if (label === 'Scramble') return 'el scramble'
  return 'el fin del dropback'
}

function ord(n: number): string {
  return ({ 1: '1ro', 2: '2do', 3: '3ro', 4: '4to' } as Record<number, string>)[n] ?? `${n}`
}

function downLabel(p: PlaySummary): string {
  if (!p.down) return 'Intento de 2 puntos'
  return `${ord(p.down)} y ${p.yardsToGo}`
}

function quarterLabel(q: number): string {
  return q >= 5 ? 'Tiempo extra' : `${ord(q)} cuarto`
}

function yardsLabel(yd: number): string {
  return `${yd > 0 ? '+' : yd < 0 ? '−' : ''}${Math.abs(yd)} yd`
}

function resultLabel(p: PlaySummary): string {
  switch (p.passResult) {
    case 'C':
      return `Completo (${yardsLabel(p.playResult)})`
    case 'I':
      return 'Incompleto'
    case 'S':
      return `Sack (${yardsLabel(p.playResult)})`
    case 'IN':
      return 'Intercepción'
    case 'R':
      return `Scramble (${yardsLabel(p.playResult)})`
    default:
      return `${p.passResult} (${yardsLabel(p.playResult)})`
  }
}

function pressureLabel(r: PlayRosterMeta): string {
  if (r.sack) return 'Sack'
  if (r.hit) return 'Golpe'
  if (r.hurry) return 'Apuro'
  return ''
}

function lastName(name: string): string {
  return name.split(' ').slice(-1)[0] ?? name
}

/** Guardia del lado del cliente: la lista siempre respeta el filtro aunque el backend no lo conozca todavía. */
function matchesCategory(p: PlaySummary, cat: string): boolean {
  switch (cat) {
    case 'cliff':
      return typeof p.ttt === 'number' && p.ttt > THRESHOLD
    case 'play_action':
      return p.is_play_action
    case 'stunt':
      return p.has_stunt
    case 'blitz_3rd_long':
      return p.n_rushers >= 5 && p.down >= 3 && p.yardsToGo >= 7
    case 'rollout':
      return (p.dropBackType ?? '').includes('ROLLOUT')
    case 'sack':
      return p.passResult === 'S'
    default:
      return true
  }
}

interface Timing {
  ttt: number | null
  endEvent: string | null
  endLabel: string
  /** Último índice de cuadro con t <= ttt: ahí se congelan las métricas del pocket. */
  cutIdx: number
  firstT: number
  lastT: number
}

interface Capped {
  minR: number | null
  minIdx: number
  nearestName: string
  peak: number
}

interface ChartRow {
  t: number
  radioPre: number | null
  radioPost: number | null
  cierrePre: number | null
  cierrePost: number | null
}

function buildNotes(tr: PlayTrackingData, timing: Timing, capped: Capped): string[] {
  const notes: string[] = []
  const endWord = endWordFor(timing.endLabel)
  if (timing.ttt !== null) {
    notes.push(
      timing.ttt > THRESHOLD
        ? `Dropback terminado (${timing.endLabel.toLowerCase()}) a los ${f1(timing.ttt)} s, pasados los 3.5 s.`
        : `Dropback terminado (${timing.endLabel.toLowerCase()}) a los ${f1(timing.ttt)} s, antes de 3.5 s.`,
    )
  }
  const press = tr.roster.filter((r) => r.generatedPressure).map((r) => r.name)
  if (press.length && capped.minR !== null) {
    notes.push(`Presión de ${press.join(', ')}; el rusher más cercano llegó a ${f1(capped.minR)} yd del QB antes de ${endWord}.`)
  } else if (press.length) {
    notes.push(`Presión de ${press.join(', ')}.`)
  } else if (capped.minR !== null) {
    notes.push(`Pocket limpio: ningún rusher se acercó a menos de ${f1(capped.minR)} yd del QB antes de ${endWord}.`)
  }
  const dbl = tr.roster.filter((r) => r.isDoubleTeamed).map((r) => r.name)
  if (dbl.length) notes.push(`Bloqueo doble sobre ${dbl.join(', ')}.`)
  const lost = tr.roster
    .filter((r) => r.role === 'Pass Block' && (r.allowedPressure || r.beaten))
    .map((r) => `${r.name}${r.linedUp ? ` (${r.linedUp})` : ''}`)
  if (lost.length) notes.push(`Duelos perdidos en la protección: ${lost.slice(0, 3).join(', ')}.`)
  return notes
}

interface MiniChartProps {
  data: ChartRow[]
  preKey: 'radioPre' | 'cierrePre'
  postKey: 'radioPost' | 'cierrePost'
  color: string
  name: string
  unit: string
  domainX: [number, number]
  ticks: number[]
  ttt: number | null
  endLabel: string
  nowT: number | null
  collapseLine?: boolean
  showXAxis: boolean
}

/** Gráfica chica de telemetría. Dos de estas comparten el eje X (segundos) en lugar de un doble eje Y. */
function MiniChart({ data, preKey, postKey, color, name, unit, domainX, ticks, ttt, endLabel, nowT, collapseLine, showXAxis }: MiniChartProps) {
  return (
    <div className={showXAxis ? 'h-40' : 'h-32'}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} syncId="sala-video-telemetria" margin={{ top: 20, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={TG.grid} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={domainX}
            ticks={ticks}
            allowDataOverflow
            hide={!showXAxis}
            tickFormatter={(v: number) => `${v} s`}
            {...tgAxis}
          />
          <YAxis width={40} domain={[0, 'auto']} allowDecimals={false} {...tgAxis} />
          <Tooltip
            {...tgTooltip}
            labelFormatter={(v: unknown) => `${Number(v).toFixed(1)} s desde el snap`}
            formatter={(v: unknown, n: unknown) => [typeof v === 'number' ? `${v.toFixed(1)} ${unit}` : '–', String(n)]}
          />
          {ttt !== null && <ReferenceArea x1={ttt} x2={domainX[1]} fill={TG.text} fillOpacity={0.06} ifOverflow="hidden" />}
          {collapseLine && (
            <ReferenceLine
              y={2.5}
              stroke={TG.red}
              strokeDasharray="3 3"
              strokeOpacity={0.7}
              label={{ value: 'Colapso: menos de 2.5 yd', position: 'insideTopLeft', fill: TG.red, fontSize: 11 }}
            />
          )}
          <ReferenceLine x={THRESHOLD} stroke={TG.line} strokeWidth={2} label={{ value: '3.5 s', position: 'top', fill: TG.line, fontSize: 12 }} />
          {ttt !== null && (
            <ReferenceLine
              x={ttt}
              stroke={TG.text}
              strokeDasharray="4 4"
              label={{ value: endLabel, position: 'insideTopLeft', fill: TG.text, fontSize: 11 }}
            />
          )}
          {nowT !== null && <ReferenceLine x={nowT} stroke={TG.text} strokeOpacity={0.45} />}
          <Area
            dataKey={preKey}
            name={name}
            type="monotone"
            stroke={color}
            fill={color}
            fillOpacity={0.14}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            dataKey={postKey}
            name={`${name} (después de ${endWordFor(endLabel).replace(/^el /, '')})`}
            type="monotone"
            stroke={TG.neutral}
            strokeWidth={2}
            strokeDasharray="2 3"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function TrenchFilmRoom({ initialPlay, teams }: Props) {
  const [showcase, setShowcase] = useState<PlaySummary[]>([])
  const [filteredPlays, setFilteredPlays] = useState<PlaySummary[]>([])
  const [listError, setListError] = useState(false)
  const [filterTeam, setFilterTeam] = useState('')
  const [filterCat, setFilterCat] = useState('')

  const [activeKey, setActiveKey] = useState<{ gameId: number; playId: number } | null>(initialPlay)
  const [tracking, setTracking] = useState<PlayTrackingData | null>(null)
  const [loading, setLoading] = useState(false)
  const [trackError, setTrackError] = useState(false)

  // Reproducción
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [playRate, setPlayRate] = useState<0.5 | 1 | 2>(1)
  const [showMatchups, setShowMatchups] = useState(true)
  const [showPocket, setShowPocket] = useState(true)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const [brief, setBrief] = useState<CoachBriefResponse | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState(false)

  // Salto externo a una jugada (desde otra pestaña)
  useEffect(() => {
    if (initialPlay) setActiveKey(initialPlay)
  }, [initialPlay])

  // Jugadas destacadas + lista filtrada
  useEffect(() => {
    let live = true
    const params = new URLSearchParams()
    if (filterTeam) params.set('team', filterTeam)
    if (filterCat) params.set('category', filterCat)
    params.set('limit', '100')
    setListError(false)
    fetch(`api/plays?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<{ showcase?: PlaySummary[]; plays?: PlaySummary[] }>
      })
      .then((d) => {
        if (!live) return
        const safeShowcase = (d.showcase ?? []).filter((s) => !REMOVED_CLAIM.test(`${s.tag} ${s.headline}`))
        const plays = (d.plays ?? []).filter((p) => matchesCategory(p, filterCat)).slice(0, 30)
        setShowcase(safeShowcase)
        setFilteredPlays(plays)
        setActiveKey((prev) => {
          if (prev) return prev
          const first = safeShowcase[0] ?? plays[0]
          return first ? { gameId: first.gameId, playId: first.playId } : null
        })
      })
      .catch(() => {
        if (!live) return
        setListError(true)
        setFilteredPlays([])
      })
    return () => {
      live = false
    }
  }, [filterTeam, filterCat])

  // Tracking 10 Hz de la jugada seleccionada
  useEffect(() => {
    if (!activeKey) return
    let live = true
    setLoading(true)
    setTrackError(false)
    setBrief(null)
    setBriefError(false)
    fetch(`api/play/${activeKey.gameId}/${activeKey.playId}/tracking`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<PlayTrackingData>
      })
      .then((d) => {
        if (!live) return
        setTracking(d)
        setFrameIdx(0)
        setPlaying(true)
      })
      .catch(() => {
        if (!live) return
        setTracking(null)
        setTrackError(true)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [activeKey])

  // Bucle de animación a 10 Hz
  useEffect(() => {
    if (!playing || !tracking || tracking.frames.length === 0) return
    const ms = Math.round(100 / playRate)
    const id = window.setInterval(() => {
      setFrameIdx((cur) => (cur + 1 >= tracking.frames.length ? 0 : cur + 1))
    }, ms)
    return () => window.clearInterval(id)
  }, [playing, playRate, tracking])

  const rosterMap = useMemo(() => {
    const map = new Map<number, PlayRosterMeta>()
    tracking?.roster.forEach((r) => map.set(r.nflId, r))
    return map
  }, [tracking])

  // Fin del dropback: play.ttt de la API; si falta, el primer evento END del tracking (misma regla que el pipeline).
  const timing = useMemo<Timing | null>(() => {
    if (!tracking) return null
    const frames = tracking.frames
    const derived = [...(tracking.keyEvents ?? [])]
      .filter((k) => END_EVENTS.has(k.event) && k.t >= 0)
      .sort((a, b) => a.t - b.t)[0]
    const ttt = typeof tracking.play.ttt === 'number' ? tracking.play.ttt : derived ? derived.t : null
    const endEvent = tracking.play.endEvent ?? derived?.event ?? null
    let cutIdx = frames.length - 1
    if (ttt !== null) {
      const i = frames.findIndex((f) => f.t > ttt + 1e-6)
      cutIdx = i === -1 ? frames.length - 1 : Math.max(0, i - 1)
    }
    return {
      ttt,
      endEvent,
      endLabel: endLabelFor(endEvent),
      cutIdx,
      firstT: frames.length ? frames[0].t : 0,
      lastT: frames.length ? frames[frames.length - 1].t : 0,
    }
  }, [tracking])

  // Métricas del pocket recortadas a t <= ttt (el tracking sigue ~0.5 s después del lanzamiento).
  const capped = useMemo<Capped | null>(() => {
    if (!tracking || !timing) return null
    let minR = Infinity
    let minIdx = 0
    let nearest: number | null = null
    for (let i = 0; i <= timing.cutIdx && i < tracking.frames.length; i++) {
      const f = tracking.frames[i]
      if (f.t < 0) continue
      if (f.minDist < minR) {
        minR = f.minDist
        minIdx = i
        nearest = f.nearestRusherId
      }
    }
    let peak = 0
    for (const p of tracking.telemetry) {
      if (p.t >= 0 && p.frameIndex <= timing.cutIdx && p.collapseRate > peak) peak = p.collapseRate
    }
    const nearestName = nearest != null ? rosterMap.get(nearest)?.name ?? '' : ''
    return { minR: Number.isFinite(minR) ? minR : null, minIdx, nearestName, peak }
  }, [tracking, timing, rosterMap])

  const chartData = useMemo<ChartRow[]>(() => {
    if (!tracking || !timing) return []
    return tracking.telemetry.map((p) => {
      const pre = p.frameIndex <= timing.cutIdx
      const post = timing.ttt !== null && p.frameIndex >= timing.cutIdx
      return {
        t: p.t,
        radioPre: pre ? p.pocketRadius : null,
        radioPost: post ? p.pocketRadius : null,
        cierrePre: pre ? p.closingSpeed : null,
        cierrePost: post ? p.closingSpeed : null,
      }
    })
  }, [tracking, timing])

  const notes = useMemo<string[]>(() => {
    if (!tracking || !timing || !capped) return []
    const api = (tracking.physicsSummary?.coachingNotes ?? []).filter((n) => !REMOVED_NOTE.test(n))
    const english = api.some((n) => ENGLISH_NOTE.test(n))
    return english || api.length === 0 ? buildNotes(tracking, timing, capped) : api
  }, [tracking, timing, capped])

  const rushers = useMemo(
    () =>
      (tracking?.roster ?? [])
        .filter((r) => r.role === 'Pass Rush')
        .sort((a, b) => (a.getoff ?? 99) - (b.getoff ?? 99)),
    [tracking],
  )
  const anyGetoff = rushers.some((r) => typeof r.getoff === 'number')

  const frames = tracking?.frames ?? []
  const currentFrame = frames[frameIdx] ?? null
  const afterEnd = timing ? frameIdx > timing.cutIdx : false
  // El rótulo de amenaza se congela en el último cuadro antes del lanzamiento.
  const metricFrame = timing ? frames[Math.min(frameIdx, timing.cutIdx)] ?? currentFrame : currentFrame
  // Reloj del pocket: segundos desde el snap, detenido en el fin del dropback.
  const rawT = currentFrame ? Math.max(currentFrame.t, 0) : 0
  const clockT = timing?.ttt != null ? Math.min(rawT, timing.ttt) : rawT
  const crossed = clockT >= THRESHOLD

  // Pulso único al cruzar los 3.5 s
  const clockRef = useRef<HTMLDivElement | null>(null)
  const prevCrossed = useRef(false)
  useEffect(() => {
    if (crossed && !prevCrossed.current && clockRef.current) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (!reduce) {
        clockRef.current.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }],
          { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        )
      }
    }
    prevCrossed.current = crossed
  }, [crossed])

  async function requestPlayBrief() {
    if (!activeKey) return
    setBriefLoading(true)
    setBriefError(false)
    try {
      const resp = await fetch('api/coach-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'play', gameId: activeKey.gameId, playId: activeKey.playId }),
      })
      if (!resp.ok) throw new Error(String(resp.status))
      const json: CoachBriefResponse = await resp.json()
      setBrief(json)
    } catch {
      setBriefError(true)
    } finally {
      setBriefLoading(false)
    }
  }

  // Coordenadas: NFL (x en [xMin..xMax], y en [0..53.3]) a viewBox SVG (1000 x 560)
  const SVG_W = 1000
  const SVG_H = 560
  const vb = tracking?.viewBox ?? { xMin: 20, xMax: 70, yMin: 0, yMax: 53.3 }
  const xSpan = Math.max(vb.xMax - vb.xMin, 25)
  const sx = (x: number) => ((x - vb.xMin) / xSpan) * SVG_W
  const sy = (y: number) => ((53.3 - y) / 53.3) * SVG_H
  const pxPerYardX = SVG_W / xSpan
  const pxPerYardY = SVG_H / 53.3

  const playerPosMap = useMemo(() => {
    const m = new Map<number, { x: number; y: number; s: number }>()
    currentFrame?.players.forEach((p) => m.set(p.id, { x: p.x, y: p.y, s: p.s }))
    return m
  }, [currentFrame])

  const hoveredMeta = hoveredId != null ? rosterMap.get(hoveredId) : null
  const hoveredPos = hoveredId != null ? playerPosMap.get(hoveredId) : null

  // Eje X compartido de la telemetría: siempre incluye los 3.5 s para ubicar la jugada respecto al umbral.
  const domainX: [number, number] = timing
    ? [Math.min(Math.floor(timing.firstT * 2) / 2, 0), Math.max(Math.ceil(timing.lastT * 2) / 2, THRESHOLD + 0.5, timing.ttt ?? 0)]
    : [0, 6]
  const xTicks: number[] = []
  for (let s = Math.ceil(domainX[0]); s <= Math.floor(domainX[1]); s++) xTicks.push(s)
  const fieldMax = timing ? Math.max(6, Math.ceil(timing.lastT)) : 6
  const endWord = timing ? endWordFor(timing.endLabel) : 'el lanzamiento'

  const selectCls =
    'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-[15px] text-slate-50 outline-none focus:border-slate-400'

  return (
    <div className="space-y-8">
      {/* Selector de jugadas */}
      <section>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-[28px] leading-tight text-slate-50">Sala de Video (tracking 10 Hz)</h2>
            <p className="mt-1 text-base text-slate-300">
              Reconstrucción cuadro a cuadro. El reloj se detiene al concluir el dropback; los cuadros posteriores aparecen en
              gris y no entran en las métricas del pocket.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="sv-equipo">
              Equipo
            </label>
            <select id="sv-equipo" value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} className={selectCls}>
              <option value="">Todos los equipos</option>
              {[...teams]
                .sort((a, b) => a.team.localeCompare(b.team))
                .map((t) => (
                  <option key={t.team} value={t.team}>
                    {t.team} · {t.teamName}
                  </option>
                ))}
            </select>
            <label className="sr-only" htmlFor="sv-categoria">
              Tipo de jugada
            </label>
            <select id="sv-categoria" value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className={selectCls}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showcase.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {showcase.map((s) => {
              const isSelected = activeKey?.gameId === s.gameId && activeKey?.playId === s.playId
              return (
                <button
                  key={`${s.gameId}-${s.playId}`}
                  onClick={() => setActiveKey({ gameId: s.gameId, playId: s.playId })}
                  aria-pressed={isSelected}
                  className={`rounded border p-3 text-left transition-colors ${
                    isSelected ? 'border-linea bg-slate-900' : 'border-slate-800 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    {s.tag && <span className="rounded-sm bg-slate-800 px-1.5 py-0.5 font-semibold text-slate-200">{s.tag}</span>}
                    <span className="text-slate-400">
                      Sem. {s.week} · {s.matchup}
                    </span>
                  </div>
                  <div className="mt-2 text-[15px] font-semibold leading-snug text-slate-50">{s.headline || s.description}</div>
                  <div className="mt-1 text-[13px] text-slate-400">
                    {downLabel(s)} · {resultLabel(s)}
                    {typeof s.ttt === 'number' ? ` · ${f1(s.ttt)} s` : ''}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Campo + telemetría */}
      <div className="grid grid-cols-1 gap-8 border-t border-slate-800 pt-8 xl:grid-cols-12">
        <section className="xl:col-span-8">
          {trackError ? (
            <div className="flex h-[420px] items-center justify-center rounded border border-slate-800 text-base text-slate-300">
              No se pudo cargar el tracking de esta jugada. Elige otra de la lista.
            </div>
          ) : loading || !tracking || !currentFrame || !timing ? (
            <div>
              <div className="tg-skeleton h-[420px] w-full" />
              <p className="mt-3 text-sm text-slate-400">Cargando el tracking a 10 Hz…</p>
            </div>
          ) : (
            <>
              {/* Encabezado de la jugada */}
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-xl text-slate-50">
                    {tracking.play.offense} ataca a {tracking.play.defense}
                    <span className="ml-2 font-normal text-slate-300">
                      Sem. {tracking.play.week} · {quarterLabel(tracking.play.quarter)} {tracking.play.gameClock} ·{' '}
                      {downLabel(tracking.play)}
                    </span>
                  </h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
                    <span
                      className={`rounded-sm px-1.5 py-0.5 font-semibold ${
                        tracking.play.passResult === 'S' ? 'bg-peligro/15 text-peligro' : 'bg-slate-800 text-slate-100'
                      }`}
                    >
                      {resultLabel(tracking.play)}
                    </span>
                    <span className="rounded-sm bg-slate-800 px-1.5 py-0.5 text-slate-200">
                      {tracking.play.n_rushers} rushers contra {tracking.play.n_blockers} bloqueadores
                    </span>
                    {tracking.play.has_stunt && <span className="rounded-sm bg-slate-800 px-1.5 py-0.5 text-slate-200">Stunt</span>}
                    {tracking.play.is_play_action && (
                      <span className="rounded-sm bg-slate-800 px-1.5 py-0.5 text-slate-200">Play action</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[13px] text-slate-400">{tracking.play.description}</p>
                </div>

                {/* Rótulo de amenaza (congelado después del fin del dropback) */}
                {metricFrame && (
                  <div className="text-right tabular-nums">
                    <div className="text-[13px] text-slate-400">Espacio del QB</div>
                    <div
                      className={`text-lg font-semibold ${
                        metricFrame.threat === 'COLLAPSE' ? 'text-peligro' : metricFrame.threat === 'CLOSING' ? 'text-slate-50' : 'text-slate-300'
                      }`}
                    >
                      {metricFrame.minDist.toFixed(1)} yd · {THREAT_LABEL[metricFrame.threat] ?? metricFrame.threat}
                    </div>
                    {afterEnd && <div className="text-[13px] text-slate-400">Congelado en {endWord}</div>}
                  </div>
                )}
              </div>

              {/* Campo SVG */}
              <div className="relative overflow-hidden rounded-md border border-slate-800 bg-cesped">
                <svg
                  viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                  className="block h-auto w-full select-none"
                  style={{ filter: afterEnd ? 'grayscale(0.85) brightness(0.8)' : undefined, transition: 'filter 200ms' }}
                  role="img"
                  aria-label={`Jugada ${tracking.play.offense} contra ${tracking.play.defense}, segundo ${f1(currentFrame.t)}`}
                >
                  <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={TG.cesped} />
                  {/* Franjas de podado cada 5 yardas */}
                  {Array.from({ length: 24 }, (_, i) => i * 5).map((yardX) => {
                    const x1 = sx(yardX)
                    const x2 = sx(yardX + 5)
                    if (x2 < 0 || x1 > SVG_W) return null
                    return (
                      <rect key={yardX} x={x1} y={0} width={x2 - x1} height={SVG_H} fill={yardX % 10 === 0 ? TG.cespedClaro : TG.cesped} />
                    )
                  })}

                  {/* Líneas de yarda y números pintados */}
                  {Array.from({ length: 21 }, (_, i) => 10 + i * 5).map((yardX) => {
                    const px = sx(yardX)
                    if (px < -10 || px > SVG_W + 10) return null
                    const fieldNum = yardX <= 60 ? yardX - 10 : 110 - yardX
                    return (
                      <g key={yardX}>
                        <line
                          x1={px}
                          y1={0}
                          x2={px}
                          y2={SVG_H}
                          stroke={TG.text}
                          strokeOpacity={0.22}
                          strokeWidth={yardX % 10 === 0 ? 2 : 1}
                        />
                        {yardX % 10 === 0 && fieldNum > 0 && fieldNum <= 50 && (
                          <>
                            <text
                              x={px}
                              y={54}
                              textAnchor="middle"
                              fill={TG.text}
                              fillOpacity={0.22}
                              style={{ font: "26px 'Alfa Slab One', Rockwell, serif" }}
                            >
                              {fieldNum}
                            </text>
                            <text
                              x={px}
                              y={SVG_H - 28}
                              textAnchor="middle"
                              fill={TG.text}
                              fillOpacity={0.22}
                              style={{ font: "26px 'Alfa Slab One', Rockwell, serif" }}
                            >
                              {fieldNum}
                            </text>
                          </>
                        )}
                      </g>
                    )
                  })}

                  {/* Hash marks */}
                  {[23.36, 29.94].map((hy) => (
                    <line
                      key={hy}
                      x1={0}
                      y1={sy(hy)}
                      x2={SVG_W}
                      y2={sy(hy)}
                      stroke={TG.text}
                      strokeOpacity={0.2}
                      strokeDasharray="4 14"
                      strokeWidth={2}
                    />
                  ))}

                  {/* Línea de golpeo (azul) y línea a ganar (amarilla) */}
                  <line x1={sx(tracking.losX)} y1={0} x2={sx(tracking.losX)} y2={SVG_H} stroke={TG.blue} strokeWidth={3} />
                  <text x={sx(tracking.losX) + 6} y={SVG_H - 8} fill={TG.blue} style={{ font: '600 13px Barlow, sans-serif' }}>
                    Línea de golpeo
                  </text>
                  <line x1={sx(tracking.firstDownX)} y1={0} x2={sx(tracking.firstDownX)} y2={SVG_H} stroke={TG.line} strokeWidth={3} />
                  <text x={sx(tracking.firstDownX) + 6} y={SVG_H - 8} fill={TG.line} style={{ font: '600 13px Barlow, sans-serif' }}>
                    Línea a ganar
                  </text>

                  {/* Burbuja del pocket (solo hasta el fin del dropback) */}
                  {showPocket && !afterEnd && metricFrame?.qb && (
                    <g>
                      <ellipse
                        cx={sx(metricFrame.qb.x)}
                        cy={sy(metricFrame.qb.y)}
                        rx={Math.max(18, Math.min(metricFrame.minDist, 8) * pxPerYardX)}
                        ry={Math.max(18, Math.min(metricFrame.minDist, 8) * pxPerYardY)}
                        fill={metricFrame.threat === 'COLLAPSE' ? TG.red : TG.blue}
                        fillOpacity={metricFrame.threat === 'COLLAPSE' ? 0.16 : 0.1}
                        stroke={metricFrame.threat === 'COLLAPSE' ? TG.red : TG.blue}
                        strokeWidth={2}
                        strokeDasharray="6 4"
                      />
                      {metricFrame.nearestRusherId != null && playerPosMap.has(metricFrame.nearestRusherId) && (
                        <line
                          x1={sx(metricFrame.qb.x)}
                          y1={sy(metricFrame.qb.y)}
                          x2={sx(playerPosMap.get(metricFrame.nearestRusherId)!.x)}
                          y2={sy(playerPosMap.get(metricFrame.nearestRusherId)!.y)}
                          stroke={metricFrame.threat === 'COLLAPSE' ? TG.red : TG.text}
                          strokeOpacity={metricFrame.threat === 'COLLAPSE' ? 0.9 : 0.45}
                          strokeWidth={1.8}
                          strokeDasharray="4 3"
                        />
                      )}
                    </g>
                  )}

                  {/* Bloqueos según PFF: sencillo tenue, doble en pintura al 45% */}
                  {showMatchups &&
                    tracking.matchups.map((edge, i) => {
                      const bPos = playerPosMap.get(edge.blockerId)
                      const rPos = playerPosMap.get(edge.rusherId)
                      if (!bPos || !rPos) return null
                      return (
                        <line
                          key={i}
                          x1={sx(bPos.x)}
                          y1={sy(bPos.y)}
                          x2={sx(rPos.x)}
                          y2={sy(rPos.y)}
                          stroke={TG.text}
                          strokeOpacity={edge.isDoubleTeam ? 0.45 : 0.2}
                          strokeWidth={edge.isDoubleTeam ? 3 : 1.5}
                        />
                      )
                    })}

                  {/* Jugadores */}
                  {currentFrame.players.map((p) => {
                    const meta = rosterMap.get(p.id)
                    const isOff = p.t === tracking.play.offense
                    const isQb = meta?.role === 'Pass'
                    const isRusher = meta?.role === 'Pass Rush'
                    const isBlocker = meta?.role === 'Pass Block'
                    const pressured = !!meta?.generatedPressure
                    const cx = sx(p.x)
                    const cy = sy(p.y)
                    // Orientación (NFL: 0 = +y, 90 = +x)
                    const oRad = (p.o * Math.PI) / 180
                    const ox = cx + Math.sin(oRad) * 16
                    const oy = cy - Math.cos(oRad) * 16
                    const fill = isOff ? TG.blue : TG.text
                    const r = isQb || isRusher || isBlocker ? 12.5 : 10

                    return (
                      <g
                        key={p.id}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredId(p.id)}
                        onMouseLeave={() => setHoveredId(null)}
                      >
                        {pressured && <circle cx={cx} cy={cy} r={19} fill="none" stroke={TG.red} strokeWidth={2.5} />}
                        <line x1={cx} y1={cy} x2={ox} y2={oy} stroke={TG.text} strokeOpacity={0.6} strokeWidth={2} />
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill={fill}
                          fillOpacity={isOff || isRusher ? 1 : 0.75}
                          stroke={hoveredId === p.id ? TG.text : TG.noche}
                          strokeWidth={hoveredId === p.id ? 2.8 : 1.5}
                        />
                        <text x={cx} y={cy + 3.5} textAnchor="middle" fill={TG.noche} style={{ font: '600 10px Barlow, sans-serif' }}>
                          {p.j}
                        </text>
                        {(isQb || pressured) && meta && (
                          <text
                            x={cx}
                            y={isQb ? cy + 27 : cy - 23}
                            textAnchor="middle"
                            fill={isQb ? TG.blue : TG.red}
                            stroke={TG.noche}
                            strokeWidth={3.2}
                            paintOrder="stroke"
                            style={{ font: '600 13px Barlow, sans-serif' }}
                          >
                            {lastName(meta.name)}
                            {meta.sack ? ' · sack' : ''}
                          </text>
                        )}
                      </g>
                    )
                  })}

                  {/* Balón */}
                  {currentFrame.ball && (
                    <ellipse
                      cx={sx(currentFrame.ball.x)}
                      cy={sy(currentFrame.ball.y)}
                      rx={7}
                      ry={4.5}
                      fill="#8a4b2a"
                      stroke={TG.text}
                      strokeWidth={1.5}
                    />
                  )}
                </svg>

                {/* Reloj del pocket */}
                <div className="pointer-events-none absolute left-4 top-3 select-none">
                  <div
                    ref={clockRef}
                    className="tg-cifra origin-left text-[56px] tabular-nums"
                    style={{ color: crossed ? TG.red : TG.text, transition: 'color 200ms' }}
                  >
                    {clockT.toFixed(1)}
                    <span className="ml-1 font-sans text-xl font-semibold">s</span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-200">
                    {afterEnd && timing.ttt !== null
                      ? `${timing.endLabel} a los ${f1(timing.ttt)} s`
                      : currentFrame.t < 0
                        ? 'Antes del snap'
                        : crossed
                          ? 'Pasados 3.5 s'
                          : 'Desde el snap'}
                  </div>
                </div>

                {/* Evento del cuadro */}
                {currentFrame.event && (
                  <div className="pointer-events-none absolute bottom-8 left-4 rounded-sm bg-slate-950/90 px-2 py-1 text-[13px] font-semibold text-slate-100">
                    {EVENT_LABEL[currentFrame.event] ?? currentFrame.event.replace(/_/g, ' ')}
                  </div>
                )}

                {afterEnd && (
                  <div className="pointer-events-none absolute bottom-8 right-4 rounded-sm bg-slate-950/90 px-2 py-1 text-[13px] text-slate-300">
                    Después de {endWord} (fuera de medición)
                  </div>
                )}

                {/* Inspector al pasar el cursor */}
                {hoveredMeta && hoveredPos && (
                  <div className="pointer-events-none absolute right-3 top-3 max-w-[260px] rounded border border-slate-700 bg-slate-950/95 px-3 py-2 text-[13px]">
                    <div className="text-[15px] font-semibold text-slate-50">
                      {hoveredMeta.name}{' '}
                      <span className="font-normal text-slate-400">({hoveredMeta.linedUp || hoveredMeta.officialPos})</span>
                    </div>
                    <div className="mt-0.5 text-slate-300">
                      {ROLE_LABEL[hoveredMeta.role] ?? hoveredMeta.role} · {hoveredPos.s.toFixed(1)} yd/s
                    </div>
                    {hoveredMeta.role === 'Pass Rush' && (
                      <div className="text-slate-300">
                        Get-off: {typeof hoveredMeta.getoff === 'number' ? `${hoveredMeta.getoff.toFixed(2)} s` : '–'}
                      </div>
                    )}
                    {hoveredMeta.role === 'Pass Block' && hoveredMeta.blockType && (
                      <div className="text-slate-300">
                        Bloqueo: {BLOCK_LABEL[hoveredMeta.blockType] ?? hoveredMeta.blockType} ({hoveredMeta.blockType})
                      </div>
                    )}
                    {hoveredMeta.isDoubleTeamed && (
                      <div className="text-slate-300">Bloqueo doble ({hoveredMeta.blockersAssigned} bloqueadores)</div>
                    )}
                    {hoveredMeta.generatedPressure && (
                      <div className="font-semibold text-peligro">Presión: {pressureLabel(hoveredMeta)}</div>
                    )}
                    {hoveredMeta.role === 'Pass Block' && (hoveredMeta.allowedPressure || hoveredMeta.beaten) && (
                      <div className="font-semibold text-peligro">Perdió su duelo</div>
                    )}
                  </div>
                )}
              </div>

              {/* Reloj del pocket en el campo del tiempo */}
              <div className="mt-4">
                <TimeField
                  t={clockT}
                  compact
                  max={fieldMax}
                  endAt={timing.ttt ?? undefined}
                  endLabel={timing.endLabel}
                />
              </div>

              {/* Controles */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button onClick={() => setPlaying((p) => !p)} className="tg-btn tg-btn-primary">
                  {playing ? 'Pausa' : 'Reproducir'}
                </button>
                <div className="flex rounded border border-slate-700 p-0.5 text-[13px] font-semibold" role="group" aria-label="Velocidad">
                  {([0.5, 1, 2] as const).map((sp) => (
                    <button
                      key={sp}
                      onClick={() => setPlayRate(sp)}
                      aria-pressed={playRate === sp}
                      className={`rounded-sm px-2.5 py-1.5 ${playRate === sp ? 'bg-slate-700 text-slate-50' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      {sp}×
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(frames.length - 1, 0)}
                  value={frameIdx}
                  aria-label="Cuadro de la jugada"
                  onChange={(e) => {
                    setPlaying(false)
                    setFrameIdx(Number(e.target.value))
                  }}
                  className="h-1.5 min-w-[160px] flex-1 accent-slate-200"
                />
                <button
                  onClick={() => {
                    setPlaying(false)
                    setFrameIdx(timing.cutIdx)
                  }}
                  className="tg-btn tg-btn-secondary"
                >
                  Ir a {endWord}
                </button>
                {capped && capped.minR !== null && (
                  <button
                    onClick={() => {
                      setPlaying(false)
                      setFrameIdx(capped.minIdx)
                    }}
                    className="tg-btn tg-btn-secondary"
                  >
                    Ir al cierre máximo
                  </button>
                )}
              </div>

              {/* Leyenda y capas */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-slate-300">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-azul" /> Ataque y QB
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-pintura" /> Defensa
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full border-2 border-peligro" /> Rusher que presionó
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-[3px] w-5 bg-pintura/45" /> Bloqueo doble
                  </span>
                </div>
                <div className="flex gap-4">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={showMatchups}
                      onChange={(e) => setShowMatchups(e.target.checked)}
                      className="accent-slate-200"
                    />
                    Bloqueos
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={showPocket}
                      onChange={(e) => setShowPocket(e.target.checked)}
                      className="accent-slate-200"
                    />
                    Burbuja del pocket
                  </label>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Columna derecha: telemetría, rushers y notas */}
        <aside className="flex flex-col gap-8 xl:col-span-4">
          {tracking && timing && !trackError && (
            <>
              <div>
                <h3 className="text-xl text-slate-50">Telemetría del pocket</h3>
                <p className="mt-1 text-[13px] text-slate-400">
                  Medido hasta {endWord}; después aparece en gris.
                </p>
                <div className="mt-3">
                  <div className="text-[13px] font-medium text-slate-300">Distancia al rusher más cercano (yd)</div>
                  <MiniChart
                    data={chartData}
                    preKey="radioPre"
                    postKey="radioPost"
                    color={TG.blue}
                    name="Espacio del QB"
                    unit="yd"
                    domainX={domainX}
                    ticks={xTicks}
                    ttt={timing.ttt}
                    endLabel={timing.endLabel}
                    nowT={currentFrame ? currentFrame.t : null}
                    collapseLine
                    showXAxis={false}
                  />
                  <div className="mt-2 text-[13px] font-medium text-slate-300">Velocidad de cierre máxima (yd/s)</div>
                  <MiniChart
                    data={chartData}
                    preKey="cierrePre"
                    postKey="cierrePost"
                    color={TG.red}
                    name="Velocidad de cierre"
                    unit="yd/s"
                    domainX={domainX}
                    ticks={xTicks}
                    ttt={timing.ttt}
                    endLabel={timing.endLabel}
                    nowT={currentFrame ? currentFrame.t : null}
                    showXAxis
                  />
                </div>
                {capped && (
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-800 pt-4 tabular-nums">
                    <div>
                      <dt className="text-[13px] text-slate-400">Espacio mínimo</dt>
                      <dd className="tg-cifra mt-1 text-2xl text-slate-50">
                        {f1(capped.minR)}
                        <span className="ml-1 font-sans text-sm font-semibold">yd</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[13px] text-slate-400">Cierre máximo</dt>
                      <dd className="tg-cifra mt-1 text-2xl text-slate-50">
                        {f1(capped.peak)}
                        <span className="ml-1 font-sans text-sm font-semibold">yd/s</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[13px] text-slate-400">{timing.endLabel}</dt>
                      <dd className={`tg-cifra mt-1 text-2xl ${timing.ttt !== null && timing.ttt > THRESHOLD ? 'text-peligro' : 'text-slate-50'}`}>
                        {timing.ttt !== null ? f1(timing.ttt) : '–'}
                        <span className="ml-1 font-sans text-sm font-semibold">s</span>
                      </dd>
                    </div>
                  </dl>
                )}
              </div>

              {/* Rushers con su get-off en esta jugada */}
              <div className="border-t border-slate-800 pt-6">
                <h3 className="text-xl text-slate-50">Pass rushers en la jugada</h3>
                <p className="mt-1 text-[13px] text-slate-400">
                  Get-off: segundos del snap a 1 yarda recorrida.
                  {!anyGetoff && ' Sin dato en esta jugada.'}
                </p>
                <ul className="mt-3 divide-y divide-slate-800">
                  {rushers.map((r) => (
                    <li
                      key={r.nflId}
                      className="flex items-center justify-between gap-3 py-2"
                      onMouseEnter={() => setHoveredId(r.nflId)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-medium text-slate-50">
                          {r.name} <span className="font-normal text-slate-400">{r.officialPos || r.linedUp}</span>
                        </div>
                        <div className="text-[13px] text-slate-400">
                          {[
                            r.generatedPressure ? `Presión: ${pressureLabel(r)}` : '',
                            r.isDoubleTeamed ? 'Bloqueo doble' : '',
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Sin presión'}
                        </div>
                      </div>
                      <div
                        className={`shrink-0 text-right text-[15px] font-semibold tabular-nums ${
                          r.generatedPressure ? 'text-peligro' : 'text-slate-200'
                        }`}
                      >
                        {typeof r.getoff === 'number' ? `${r.getoff.toFixed(2)} s` : '–'}
                      </div>
                    </li>
                  ))}
                  {rushers.length === 0 && <li className="py-2 text-[13px] text-slate-400">Sin rushers registrados por PFF.</li>}
                </ul>
              </div>

              {/* Notas + resumen opcional con IA */}
              <div className="border-t border-slate-800 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-xl text-slate-50">Notas de la jugada</h3>
                  <button onClick={requestPlayBrief} disabled={briefLoading} className="tg-btn tg-btn-secondary disabled:opacity-50">
                    {briefLoading ? 'Generando…' : 'Resumen IA (opcional)'}
                  </button>
                </div>
                <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-slate-300">
                  {notes.map((n, i) => (
                    <li key={i} className="border-l-2 border-slate-700 pl-3">
                      {n}
                    </li>
                  ))}
                </ul>
                {briefError && <p className="mt-3 text-[13px] text-slate-400">No se pudo generar el resumen. Las notas de arriba no usan IA.</p>}
                {brief && (
                  <div className="mt-4 rounded border border-slate-700 p-3">
                    <div className="mb-1 text-[13px] font-semibold text-slate-300">
                      {brief.source === 'amazon_nova' ? 'Resumen con Amazon Nova' : 'Resumen del motor analítico (sin IA)'}
                    </div>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-200">{brief.brief}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Biblioteca de jugadas filtradas */}
      <section className="border-t border-slate-800 pt-8">
        <h3 className="text-xl text-slate-50">Más jugadas</h3>
        <p className="mt-1 text-[13px] text-slate-400">
          {CATEGORIES.find((c) => c.id === filterCat)?.label ?? 'Todas las jugadas'}
          {filterTeam ? ` · ${filterTeam}` : ''} · {filteredPlays.length} jugadas. Selecciona una fila para verla.
        </p>
        <div className="mt-3 max-h-72 overflow-y-auto rounded border border-slate-800">
          {listError ? (
            <div className="p-4 text-[15px] text-slate-300">No se pudo cargar la lista de jugadas.</div>
          ) : filteredPlays.length === 0 ? (
            <div className="p-4 text-[15px] text-slate-300">No hay jugadas para este filtro.</div>
          ) : (
            <table className="w-full text-left text-[14px]">
              <thead className="sticky top-0 bg-slate-950 text-[13px] text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Partido</th>
                  <th className="px-2 py-2 font-medium">Situación</th>
                  <th className="px-2 py-2 font-medium">Rush</th>
                  <th className="px-2 py-2 font-medium">Fin del dropback</th>
                  <th className="px-2 py-2 font-medium">Resultado</th>
                  <th className="px-3 py-2 font-medium">Descripción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredPlays.map((p) => {
                  const isSel = activeKey?.gameId === p.gameId && activeKey?.playId === p.playId
                  return (
                    <tr
                      key={`${p.gameId}-${p.playId}`}
                      onClick={() => setActiveKey({ gameId: p.gameId, playId: p.playId })}
                      className={`cursor-pointer transition-colors ${isSel ? 'bg-slate-800' : 'hover:bg-slate-900'}`}
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-50">
                        Sem. {p.week} · {p.offense} vs {p.defense}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-slate-300">
                        {quarterLabel(p.quarter)} {p.gameClock} · {downLabel(p)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-300">
                        {p.n_rushers} contra {p.n_blockers}
                        {p.has_stunt ? ' · stunt' : ''}
                        {p.is_play_action ? ' · PA' : ''}
                      </td>
                      <td
                        className={`whitespace-nowrap px-2 py-2 tabular-nums ${
                          typeof p.ttt === 'number' && p.ttt > THRESHOLD ? 'text-peligro' : 'text-slate-300'
                        }`}
                      >
                        {typeof p.ttt === 'number' ? `${f1(p.ttt)} s` : '–'}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2 font-medium ${p.passResult === 'S' ? 'text-peligro' : 'text-slate-200'}`}>
                        {resultLabel(p)}
                      </td>
                      <td className="max-w-md truncate px-3 py-2 text-slate-400">{p.description}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
