import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TG, f1, n0, signed, tgAxis } from '../theme'
import type { GetoffLeader, GuerraData, IronLineman, PlayersData, QbClockRow, QbClocksData, RushGroup } from '../types'

interface Props {
  data: PlayersData
  qbClocks: QbClocksData | null
  guerra: GuerraData | null
  onSelectTeam: (team: string) => void
}

type GroupFilter = 'Todos' | RushGroup
type OlFilter = 'Todos' | 'T' | 'G' | 'C'
type SortKey = 'getoff_score' | 'getoff_avg' | 'pressure_rate' | 'sacks' | 'snaps' | 'strain_avg'

const GROUP_LABEL: Record<RushGroup, string> = { Edge: 'Edge (DE·OLB)', Interior: 'Interior (DT·NT)' }
const OL_LABEL: Record<OlFilter, string> = { Todos: 'Todos', T: 'Tackles', G: 'Guardias', C: 'Centros' }
const LANE_LABEL: Record<string, string> = {
  LT: 'Tackle izq.',
  LG: 'Guardia izq.',
  C: 'Centro',
  RG: 'Guardia der.',
  RT: 'Tackle der.',
}
const SMALL_N = 50

/** "Myles Garrett" → "M. Garrett" */
function shortName(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

const keyOf = (d: GetoffLeader) => (d.nflId !== undefined ? String(d.nflId) : `${d.name}|${d.team}`)

function weightedMean(rows: GetoffLeader[]): number | null {
  const snaps = rows.reduce((a, r) => a + (r.snaps || 0), 0)
  if (!snaps) return null
  return rows.reduce((a, r) => a + r.getoff_avg * (r.snaps || 0), 0) / snaps
}

function Pills<T extends string>({ options, value, onChange, labels, counts }: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labels: Record<T, string>
  counts?: Partial<Record<T, number>>
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((opt) => {
        const on = opt === value
        return (
          <button
            key={opt}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(opt)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              on ? 'bg-linea text-linea-tinta' : 'border border-slate-700 text-slate-300 hover:border-slate-600 hover:text-pintura'
            }`}
          >
            {labels[opt]}
            {counts?.[opt] !== undefined && (
              <span className={`ml-1.5 tabular-nums ${on ? 'opacity-70' : 'text-slate-400'}`}>{counts[opt]}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function TeamButton({ team, onSelectTeam }: { team: string; onSelectTeam: (t: string) => void }) {
  return (
    <button
      onClick={() => onSelectTeam(team)}
      title={`Abrir el plan de juego de ${team}`}
      className="rounded px-2 py-0.5 text-[13px] font-semibold text-pintura ring-1 ring-slate-700 transition-colors hover:bg-slate-800"
    >
      {team}
    </button>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-pintura placeholder-slate-500 outline-none focus:border-slate-500"
    />
  )
}

export default function PlayersLabView({ data, qbClocks, guerra, onSelectTeam }: Props) {
  const leaders = data.getoff_leaders ?? []
  const linemen = data.linemen ?? []

  const [group, setGroup] = useState<GroupFilter>('Todos')
  const [sortKey, setSortKey] = useState<SortKey>('getoff_score')
  const [sortAsc, setSortAsc] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [qDl, setQDl] = useState('')
  const [olPos, setOlPos] = useState<OlFilter>('Todos')
  const [qOl, setQOl] = useState('')

  const inGroup = useMemo(
    () => (group === 'Todos' ? leaders : leaders.filter((d) => d.group === group)),
    [leaders, group],
  )

  const topSet = useMemo(() => {
    const top = [...inGroup].sort((a, b) => b.pressure_rate - a.pressure_rate).slice(0, 8)
    return new Set(top.map(keyOf))
  }, [inGroup])

  const edgeRows = useMemo(() => inGroup.filter((d) => d.group === 'Edge'), [inGroup])
  const interiorRows = useMemo(() => inGroup.filter((d) => d.group === 'Interior'), [inGroup])

  const groupCounts = useMemo(
    () => ({
      Todos: leaders.length,
      Edge: leaders.filter((d) => d.group === 'Edge').length,
      Interior: leaders.filter((d) => d.group === 'Interior').length,
    }),
    [leaders],
  )
  const edgeMean = useMemo(() => weightedMean(leaders.filter((d) => d.group === 'Edge')), [leaders])
  const interiorMean = useMemo(() => weightedMean(leaders.filter((d) => d.group === 'Interior')), [leaders])

  const tableRows = useMemo(() => {
    const q = qDl.trim().toLowerCase()
    const rows = inGroup.filter(
      (d) => !q || d.name.toLowerCase().includes(q) || d.team.toLowerCase().includes(q),
    )
    const dir = sortAsc ? 1 : -1
    return [...rows].sort((a, b) => (a[sortKey] - b[sortKey]) * dir || b.snaps - a.snaps)
  }, [inGroup, qDl, sortKey, sortAsc])

  const visibleRows = showAll ? tableRows : tableRows.slice(0, 30)

  function onSort(k: SortKey) {
    if (k === sortKey) setSortAsc((a) => !a)
    else {
      setSortKey(k)
      setSortAsc(k === 'getoff_avg')
    }
  }

  const filteredLinemen = useMemo(() => {
    const q = qOl.trim().toLowerCase()
    return linemen.filter((l: IronLineman) => {
      if (olPos !== 'Todos' && l.position !== olPos) return false
      if (q && !l.displayName.toLowerCase().includes(q) && !l.team.toLowerCase().includes(q)) return false
      return true
    })
  }, [linemen, olPos, qOl])

  const league = qbClocks?.league
  const qbRows = useMemo(
    () =>
      (qbClocks?.qbs ?? []).map((q) => ({
        ...q,
        label: `${shortName(q.name)} · ${q.team}`,
        tag: `${f1(q.late_share)}% · ${f1(q.ttt_median)} s`,
      })),
    [qbClocks],
  )
  const stabilityGetoff = guerra?.getoff?.stability
  const stabilityQb = qbClocks?.stability?.late_share

  // Custom scatter dot: Edge = filled paint, Interior = hollow ring (group encoded by fill, not hue).
  const renderDot = (props: unknown) => {
    const p = props as { cx?: number; cy?: number; payload?: GetoffLeader }
    if (p.cx == null || p.cy == null || !p.payload) return <g />
    const d = p.payload
    const hollow = d.group === 'Interior'
    const labelled = topSet.has(keyOf(d))
    return (
      <g>
        <circle
          cx={p.cx}
          cy={p.cy}
          r={labelled ? 5.5 : 4.5}
          fill={hollow ? 'none' : TG.text}
          fillOpacity={hollow ? 0 : labelled ? 0.95 : 0.55}
          stroke={TG.text}
          strokeOpacity={hollow ? (labelled ? 0.95 : 0.65) : 0}
          strokeWidth={1.6}
        />
        {labelled && (
          <text x={p.cx} y={p.cy - 10} textAnchor="middle" fill={TG.text} style={{ font: '600 12px Barlow, sans-serif' }}>
            {shortName(d.name)}
          </text>
        )}
      </g>
    )
  }

  const SortTh = ({ k, children, title }: { k: SortKey; children: React.ReactNode; title?: string }) => (
    <th className="px-3 py-2.5 text-right font-medium" aria-sort={sortKey === k ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(k)} title={title} className={`hover:text-pintura ${sortKey === k ? 'text-pintura' : ''}`}>
        {children}
        {sortKey === k && <span className="ml-1 text-slate-400">{sortAsc ? '▲' : '▼'}</span>}
      </button>
    </th>
  )

  return (
    <div className="space-y-14">
      {/* ------------------------------------------------------------------ */}
      {/* 1. GET-OFF LEADERBOARD                                              */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-8">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-4">
            <h2 className="text-[28px] leading-tight text-pintura">Arranque de los pass rushers (get-off)</h2>
            {stabilityGetoff !== undefined && stabilityGetoff !== null && (
              <div className="flex items-end gap-4">
                <span className="tg-cifra text-[64px] text-pintura">{f1(stabilityGetoff, 2)}</span>
                <p className="pb-1 text-base text-slate-300">
                  correlación por jugador entre las semanas 1–4 y 5–8
                </p>
              </div>
            )}
            <p className="max-w-[60ch] text-base text-slate-300">
              Segundos desde el snap hasta avanzar 1 yarda. Se compara dentro de cada posición porque los interiores
              enfrentan contacto inmediato
              {edgeMean !== null && interiorMean !== null && (
                <>
                  {' '}
                  (Edge: {f1(edgeMean, 2)} s · Interior: {f1(interiorMean, 2)} s)
                </>
              )}
              .
            </p>
            {guerra?.getoff?.pp_per_tenth !== undefined && (
              <p className="max-w-[60ch] text-base text-slate-300">
                Cada 0.1 s más rápido que su propia mediana aporta ~{f1(guerra.getoff.pp_per_tenth)} pts de presión (ver El
                Reloj).
              </p>
            )}
            <Pills
              options={['Todos', 'Edge', 'Interior'] as const}
              value={group}
              onChange={(g) => {
                setGroup(g)
                setShowAll(false)
              }}
              labels={{ Todos: 'Todos', Edge: 'Edge', Interior: 'Interior' }}
              counts={groupCounts}
            />
            <div className="flex flex-wrap items-center gap-5 text-sm text-slate-300">
              <span className="inline-flex items-center gap-2">
                <svg width="12" height="12" aria-hidden="true">
                  <circle cx="6" cy="6" r="5" fill={TG.text} />
                </svg>
                {GROUP_LABEL.Edge}
              </span>
              <span className="inline-flex items-center gap-2">
                <svg width="12" height="12" aria-hidden="true">
                  <circle cx="6" cy="6" r="4.4" fill="none" stroke={TG.text} strokeWidth="1.6" />
                </svg>
                {GROUP_LABEL.Interior}
              </span>
            </div>
          </div>

          <div className="lg:col-span-8">
            {leaders.length === 0 ? (
              <div className="flex h-80 items-center justify-center rounded-lg border border-slate-800 text-base text-slate-400">
                No hay datos de get-off disponibles.
              </div>
            ) : (
              <>
                <div className="h-[380px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 22, right: 28, left: 8, bottom: 30 }}>
                      <CartesianGrid stroke={TG.grid} />
                      <XAxis
                        type="number"
                        dataKey="getoff_avg"
                        name="Get-off"
                        reversed
                        domain={['dataMin - 0.02', 'dataMax + 0.02']}
                        tickFormatter={(v: number) => v.toFixed(2)}
                        {...tgAxis}
                        label={{ value: 'Get-off promedio (s) · más rápido →', position: 'insideBottom', offset: -18, fill: TG.axis, fontSize: 13 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="pressure_rate"
                        name="Presión"
                        unit="%"
                        domain={[0, 'auto']}
                        {...tgAxis}
                        label={{ value: '% de snaps con presión', angle: -90, position: 'insideLeft', offset: 10, fill: TG.axis, fontSize: 13, style: { textAnchor: 'middle' } }}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3', stroke: TG.tooltipBorder }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload as GetoffLeader
                          return (
                            <div className="rounded border border-slate-600 bg-cesped-claro px-3 py-2 text-sm text-pintura">
                              <div className="font-semibold">{d.name}</div>
                              <div className="text-slate-300">
                                {d.team} · {d.position} · {GROUP_LABEL[d.group] ?? d.group}
                              </div>
                              <div className="mt-1.5 space-y-0.5 tabular-nums text-slate-200">
                                <div>Get-off promedio: {f1(d.getoff_avg, 2)} s</div>
                                <div>
                                  Presión: {f1(d.pressure_rate)}% de {n0(d.snaps)} snaps · {n0(d.sacks)} sacks
                                </div>
                                <div>Puntaje get-off: {f1(d.getoff_score, 0)} (dentro de {d.group})</div>
                              </div>
                            </div>
                          )
                        }}
                      />
                      {edgeRows.length > 0 && <Scatter name="Edge" data={edgeRows} shape={renderDot} isAnimationActive={false} />}
                      {interiorRows.length > 0 && (
                        <Scatter name="Interior" data={interiorRows} shape={renderDot} isAnimationActive={false} />
                      )}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Linieros defensivos con ≥150 snaps de pass rush · etiquetas: los 8 con mayor % de presión en el filtro.
                </p>
              </>
            )}
          </div>
        </div>

        {leaders.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg text-pintura">
                  Ranking de get-off · {group === 'Todos' ? 'todos los grupos' : GROUP_LABEL[group]}
                </h3>
                <p className="text-sm text-slate-400">
                  Puntaje 0–100 relativo a cada grupo (100 = arranque más rápido).
                  {group === 'Todos' && ' Cada jugador se evalúa frente a su propia posición.'}
                </p>
              </div>
              <SearchBox value={qDl} onChange={setQDl} placeholder="Buscar jugador o equipo" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-3 py-2.5 font-medium">Jugador</th>
                    <th className="px-3 py-2.5 font-medium">Equipo</th>
                    <th className="px-3 py-2.5 font-medium">Pos</th>
                    <th className="px-3 py-2.5 font-medium">Grupo</th>
                    <SortTh k="snaps">Snaps</SortTh>
                    <SortTh k="getoff_avg" title="Segundos desde el snap hasta avanzar 1 yarda">Get-off (s)</SortTh>
                    <SortTh k="getoff_score" title="0–100 dentro de su grupo">Puntaje get-off</SortTh>
                    <SortTh k="pressure_rate">% presión</SortTh>
                    <SortTh k="sacks">Sacks</SortTh>
                    <SortTh k="strain_avg" title="Versión simplificada de STRAIN">Strain (tipo STRAIN)</SortTh>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {visibleRows.map((d, idx) => {
                    const small = d.snaps < SMALL_N
                    return (
                      <tr key={keyOf(d)} className={`border-t border-slate-800/70 hover:bg-slate-900 ${small ? 'text-slate-500' : 'text-slate-200'}`}>
                        <td className="px-4 py-2 text-slate-400">{idx + 1}</td>
                        <td className="px-3 py-2 font-semibold text-pintura">{d.name}</td>
                        <td className="px-3 py-2">
                          <TeamButton team={d.team} onSelectTeam={onSelectTeam} />
                        </td>
                        <td className="px-3 py-2 text-slate-300">{d.position}</td>
                        <td className="px-3 py-2 text-slate-300">{d.group}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{n0(d.snaps)}</td>
                        <td className="px-3 py-2 text-right">{f1(d.getoff_avg, 2)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-pintura">{f1(d.getoff_score, 0)}</td>
                        <td className="px-3 py-2 text-right">{f1(d.pressure_rate)}%</td>
                        <td className="px-3 py-2 text-right">{n0(d.sacks)}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{f1(d.strain_avg, 2)}</td>
                      </tr>
                    )
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-6 text-center text-slate-400">
                        Ningún jugador coincide con la búsqueda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-800 px-4 py-3 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Strain: métrica simplificada tipo STRAIN (mide velocidad de cierre y cercanía al QB).
              </span>
              {tableRows.length > 30 && (
                <button onClick={() => setShowAll((v) => !v)} className="tg-btn-secondary rounded-md px-3 py-1.5 font-semibold text-pintura">
                  {showAll ? 'Ver menos' : `Ver los ${tableRows.length}`}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 2. QB CLOCKS                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-t border-slate-800 pt-10">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-4">
            <h2 className="text-[28px] leading-tight text-pintura">Tiempo de lanzamiento por quarterback</h2>
            {league?.late_share !== undefined && (
              <div className="flex items-end gap-4">
                <span className="tg-cifra text-[64px] text-pintura">
                  {f1(league.late_share)}
                  <span className="text-[32px]">%</span>
                </span>
                <p className="pb-1 text-base text-slate-300">de los pases en la liga salen después de 3.5 s</p>
              </div>
            )}
            {league && league.success_early !== undefined && league.success_late !== undefined && (
              <p className="max-w-[60ch] text-base text-slate-300">
                En la liga, el éxito baja de {f1(league.success_early)}% a {f1(league.success_late)}% (
                {signed(league.success_late - league.success_early)} pts) pasados los 3.5 s.
              </p>
            )}
            <p className="max-w-[60ch] text-base text-slate-300">
              Estabilidad del % &gt; 3.5 s entre mitades
              {stabilityQb !== undefined && stabilityQb !== null ? `: r = ${f1(stabilityQb, 2)}.` : '.'}
            </p>
            <div className="flex flex-wrap items-center gap-5 text-sm text-slate-300">
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-3 w-5 rounded-sm" style={{ background: TG.red }} />
                Por encima de la liga
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-3 w-5 rounded-sm" style={{ background: TG.neutral }} />
                Por debajo de la liga
              </span>
            </div>
            <p className="max-w-[60ch] text-sm text-slate-400">
              Se omite la caída de éxito individual por QB porque no es estable entre mitades (ver Lo que descartamos).
            </p>
          </div>

          <div className="lg:col-span-8">
            {qbRows.length === 0 ? (
              <div className="flex h-80 items-center justify-center rounded-lg border border-slate-800 text-base text-slate-400">
                No hay datos del reloj de los QB disponibles.
              </div>
            ) : (
              <>
                <div style={{ height: Math.max(320, qbRows.length * 26 + 48) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={qbRows} layout="vertical" margin={{ top: 22, right: 96, left: 8, bottom: 8 }} barCategoryGap={5}>
                      <CartesianGrid stroke={TG.grid} horizontal={false} />
                      <XAxis type="number" unit="%" domain={[0, 'auto']} {...tgAxis} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={150}
                        interval={0}
                        tick={{ fill: TG.text, fontSize: 13 }}
                        tickLine={false}
                        axisLine={{ stroke: TG.grid }}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(242,244,238,0.06)' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const q = payload[0].payload as QbClockRow
                          return (
                            <div className="rounded border border-slate-600 bg-cesped-claro px-3 py-2 text-sm text-pintura">
                              <div className="font-semibold">
                                {q.name} · {q.team}
                              </div>
                              <div className="mt-1 space-y-0.5 tabular-nums text-slate-200">
                                <div>Pases después de 3.5 s: {f1(q.late_share)}%</div>
                                <div>Tiempo mediano hasta lanzar: {f1(q.ttt_median)} s</div>
                                <div>n = {n0(q.plays)} dropbacks</div>
                              </div>
                            </div>
                          )
                        }}
                      />
                      {league?.late_share !== undefined && (
                        <ReferenceLine
                          x={league.late_share}
                          stroke={TG.text}
                          strokeOpacity={0.8}
                          strokeDasharray="4 4"
                          label={{ value: `Liga ${f1(league.late_share)}%`, position: 'top', fill: TG.text, fontSize: 13 }}
                        />
                      )}
                      <Bar dataKey="late_share" name="% de pases después de 3.5 s" isAnimationActive={false}>
                        {qbRows.map((q) => (
                          <Cell
                            key={`${q.name}-${q.team}`}
                            fill={league?.late_share !== undefined && q.late_share >= league.late_share ? TG.red : TG.neutral}
                          />
                        ))}
                        <LabelList dataKey="tag" position="right" fill={TG.muted} fontSize={12} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  % de dropbacks &gt; 3.5 s y tiempo mediano de lanzamiento (QBs con ≥150 dropbacks).
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 3. OFFENSIVE LINE LEADERBOARD                                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-5 border-t border-slate-800 pt-10">
        <div className="max-w-[70ch] space-y-2">
          <h2 className="text-[28px] leading-tight text-pintura">Mejores bloqueadores de pase</h2>
          <p className="text-base text-slate-300">
            Puntaje: 70% bloqueos sin presión + 30% sin ser vencido (≥150 bloqueos de pase, semanas 1–8).
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-800">
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <Pills options={['Todos', 'T', 'G', 'C'] as const} value={olPos} onChange={setOlPos} labels={OL_LABEL} />
            <SearchBox value={qOl} onChange={setQOl} placeholder="Buscar liniero o equipo" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Liniero</th>
                  <th className="px-3 py-2.5 font-medium">Carril</th>
                  <th className="px-3 py-2.5 font-medium">Equipo</th>
                  <th className="px-3 py-2.5 text-right font-medium">Puntaje</th>
                  <th className="px-3 py-2.5 text-right font-medium">% sin presión</th>
                  <th className="px-3 py-2.5 text-right font-medium">% vencido</th>
                  <th className="px-3 py-2.5 text-right font-medium">Presiones permitidas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sacks permitidos</th>
                  <th className="px-4 py-2.5 text-right font-medium">Bloqueos</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {filteredLinemen.slice(0, 40).map((l, idx) => {
                  const small = l.snaps < SMALL_N
                  return (
                    <tr key={l.nflId} className={`border-t border-slate-800/70 hover:bg-slate-900 ${small ? 'text-slate-500' : 'text-slate-200'}`}>
                      <td className="px-4 py-2 text-slate-400">{idx + 1}</td>
                      <td className="px-3 py-2 font-semibold text-pintura">{l.displayName}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {LANE_LABEL[l.lane] ?? l.lane} <span className="text-slate-400">({l.position})</span>
                      </td>
                      <td className="px-3 py-2">
                        <TeamButton team={l.team} onSelectTeam={onSelectTeam} />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-pintura">{f1(l.iron_score)}</td>
                      <td className="px-3 py-2 text-right">{f1(l.clean_rate)}%</td>
                      <td className="px-3 py-2 text-right">{f1(l.beaten_rate)}%</td>
                      <td className="px-3 py-2 text-right">{n0(l.pressures_allowed)}</td>
                      <td className="px-3 py-2 text-right">{n0(l.sacks_allowed)}</td>
                      <td className="px-4 py-2 text-right text-slate-400">{n0(l.snaps)}</td>
                    </tr>
                  )
                })}
                {filteredLinemen.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                      Ningún liniero coincide con el filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
