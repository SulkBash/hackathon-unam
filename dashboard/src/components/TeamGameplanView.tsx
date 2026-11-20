import { useEffect, useMemo, useState } from 'react'
import { TG, f1, n0, signed } from '../theme'
import type { CoachBriefResponse, PlaySummary, QbClocksData, TeamGameplan, TeamMatrixRow, TeamOlLane } from '../types'

interface Props {
  selectedTeam: string
  teams: TeamMatrixRow[]
  onSelectTeam: (team: string) => void
  onWatchPlay: (play: PlaySummary) => void
  qbClocks: QbClocksData | null
}

const QUICK_TEAMS = ['MIN', 'SF', 'CLE', 'BUF', 'TB', 'KC', 'LA', 'DAL']
const MIN_N = 50

const LANE_LABEL: Record<string, string> = {
  LT: 'Tackle izq.',
  LG: 'Guardia izq.',
  C: 'Centro',
  RG: 'Guardia der.',
  RT: 'Tackle der.',
}
const RISK_LABEL: Record<string, string> = { HIGH: 'Riesgo alto', MED: 'Riesgo medio', LOW: 'Riesgo bajo' }
const RESULT_LABEL: Record<string, string> = { C: 'Completo', I: 'Incompleto', IN: 'Intercepción', S: 'Sack', R: 'Scramble' }
const TAG_LABEL: Record<string, string> = { 'DEFENSE FILM': 'Su defensa', 'OFFENSE FILM': 'Su ofensiva' }
const ORDINAL: Record<number, string> = { 1: '1ro', 2: '2do', 3: '3ro', 4: '4to' }

const laneName = (code: string) => LANE_LABEL[code] ?? code
const quarterLabel = (q: number) => (q >= 5 ? 'Tiempo extra' : `${q}º cuarto`)

export default function TeamGameplanView({ selectedTeam, teams, onSelectTeam, onWatchPlay, qbClocks }: Props) {
  const [plan, setPlan] = useState<TeamGameplan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<CoachBriefResponse | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setBrief(null)
    setBriefError(null)
    fetch(`api/team/${selectedTeam}`)
      .then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`)
        return r.json() as Promise<TeamGameplan>
      })
      .then((d) => {
        if (active) setPlan(d)
      })
      .catch((err) => {
        if (active) {
          setPlan(null)
          setError(String(err))
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedTeam])

  async function requestCoachBrief() {
    setBriefLoading(true)
    setBriefError(null)
    try {
      const resp = await fetch('api/coach-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'team', team: selectedTeam, question }),
      })
      if (!resp.ok) throw new Error(`API ${resp.status}`)
      const json: CoachBriefResponse = await resp.json()
      setBrief(json)
    } catch (err) {
      setBriefError(String(err))
    } finally {
      setBriefLoading(false)
    }
  }

  // Reloj del QB rival: qb_clock de la API; si falta, el QB con más pases del equipo en api/qb-clocks.
  // Nunca mezclamos campos de dos fuentes distintas para el mismo QB.
  const qb = useMemo(() => {
    if (!plan) return null
    const qc = plan.qb_clock
    const fallback = qbClocks?.qbs.filter((q) => q.team === plan.team).sort((a, b) => b.plays - a.plays)[0]
    const src =
      qc && qc.late_share != null && qc.ttt_median != null
        ? { name: qc.qb ?? qc.name ?? 'QB titular', plays: qc.plays, late: qc.late_share, ttt: qc.ttt_median }
        : fallback
          ? { name: fallback.name, plays: fallback.plays, late: fallback.late_share, ttt: fallback.ttt_median }
          : null
    if (!src) return null
    const league = qbClocks?.league
    return {
      ...src,
      leagueLate: qc?.league_late_share ?? qc?.league?.late_share ?? league?.late_share,
      leagueTtt: qc?.league_ttt_median ?? qc?.league?.ttt_median ?? league?.ttt_median,
      leagueDrop: qc?.league_drop ?? qc?.league?.drop ?? league?.drop,
      successEarly: qc?.league?.success_early ?? league?.success_early,
      successLate: qc?.league?.success_late ?? league?.success_late,
    }
  }, [plan, qbClocks])

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.teamName.localeCompare(b.teamName)), [teams])
  const teamName = plan?.teamName ?? teams.find((t) => t.team === selectedTeam)?.teamName ?? selectedTeam

  return (
    <div className="space-y-12">
      {/* Selector de rival: única caja manipulable del encabezado */}
      <section className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <h2 className="text-[28px] leading-tight text-pintura">Plan de juego contra {teamName}</h2>
          <p className="mt-2 max-w-[65ch] text-[17px] text-slate-300">
            Elige un rival: el reporte se arma con sus jugadas de pase de la NFL 2021 (semanas 1–8) y dice qué hacer
            con tu defensa y con tu ofensiva.
          </p>
        </div>
        <div className="rounded-md bg-slate-900 p-4 lg:col-span-5">
          <label htmlFor="tg-team" className="text-[13px] text-slate-400">
            Rival
          </label>
          <select
            id="tg-team"
            value={selectedTeam}
            onChange={(e) => onSelectTeam(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[15px] font-medium text-pintura outline-none"
          >
            {sortedTeams.map((t) => (
              <option key={t.team} value={t.team}>
                {t.teamName} ({t.team})
              </option>
            ))}
          </select>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK_TEAMS.filter((abbr) => teams.some((t) => t.team === abbr)).map((abbr) => (
              <button
                key={abbr}
                onClick={() => onSelectTeam(abbr)}
                aria-pressed={selectedTeam === abbr}
                className={`rounded-md px-2.5 py-1 text-[13px] font-semibold transition ${
                  selectedTeam === abbr
                    ? 'bg-pintura text-cesped-noche'
                    : 'text-slate-300 ring-1 ring-inset ring-slate-700 hover:bg-slate-800 hover:text-pintura'
                }`}
              >
                {abbr}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div className="border-t border-slate-800 pt-6 text-[15px] text-slate-300">
          <p className="font-semibold text-peligro">No se pudo cargar el plan de {selectedTeam}.</p>
          <p className="mt-1 text-slate-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-4 border-t border-slate-800 pt-8" aria-busy="true" aria-label="Cargando plan de juego">
          <div className="tg-skeleton h-8 w-2/5" />
          <div className="tg-skeleton h-56 w-full" />
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="tg-skeleton h-48 lg:col-span-5" />
            <div className="tg-skeleton h-48 lg:col-span-7" />
          </div>
        </div>
      ) : plan ? (
        <div key={plan.team} className="tg-enter space-y-12">
          {/* ============ Bloque A: su ofensiva (para el coordinador defensivo rival) ============ */}
          <section className="space-y-8 border-t border-slate-800 pt-8">
            <div>
              <h2 className="text-[28px] leading-tight text-pintura">Cuando tu defensa enfrenta a {plan.team}</h2>
              <p className="mt-1 text-[16px] text-slate-400">
                Para el coordinador defensivo: dónde presionar a su línea y cuánto aguanta su quarterback.
              </p>
            </div>

            <LaneMap plan={plan} />

            <div className="grid gap-10 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <QbClockCard qb={qb} stability={qbClocks?.stability?.late_share} />
              </div>
              <div className="space-y-8 lg:col-span-7">
                <HintList
                  title={`Cómo presionar a ${plan.team}`}
                  hints={plan.attack_this_oline ?? []}
                />
                <OffenseProfile plan={plan} />
              </div>
            </div>
          </section>

          {/* ============ Bloque B: su defensa (para el coordinador ofensivo rival) ============ */}
          <section className="space-y-8 border-t border-slate-800 pt-8">
            <div>
              <h2 className="text-[28px] leading-tight text-pintura">Cuando tu ofensiva enfrenta a {plan.team}</h2>
              <p className="mt-1 text-[16px] text-slate-400">
                Para el coordinador ofensivo: quién presiona en su defensa y cómo proteger a tu quarterback.
              </p>
            </div>
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="space-y-8 lg:col-span-5">
                <DefenseGetoff plan={plan} />
                <DefenseProfile plan={plan} />
              </div>
              <div className="space-y-8 lg:col-span-7">
                <HintList title={`Cómo neutralizar el pass rush de ${plan.team}`} hints={plan.beat_this_defense ?? []} />
                <TopRushers plan={plan} />
              </div>
            </div>
          </section>

          {/* ============ Resumen del coordinador (IA opcional) ============ */}
          <section className="grid gap-6 border-t border-slate-800 pt-8 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h3 className="text-[22px] leading-tight text-pintura">Un resumen listo para la reunión de coordinadores</h3>
              <p className="mt-2 text-[16px] text-slate-300">
                Redacta el plan contra {plan.team} con los datos de esta página. La IA es opcional: si Amazon Nova no
                está disponible, el motor analítico arma el resumen sin ella.
              </p>
            </div>
            <div className="rounded-md bg-slate-900 p-4 lg:col-span-7">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Pregunta opcional, por ejemplo: ¿qué llamar en 3ro y 8?"
                  aria-label="Pregunta opcional para el resumen"
                  className="h-11 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 text-[15px] text-pintura placeholder-slate-500 outline-none"
                />
                <button
                  onClick={requestCoachBrief}
                  disabled={briefLoading}
                  className="tg-btn tg-btn-primary justify-center disabled:opacity-60"
                >
                  {briefLoading ? 'Generando resumen…' : 'Resumen del coordinador (IA opcional)'}
                </button>
              </div>
              {briefError && (
                <p className="mt-3 text-[15px] text-slate-300">
                  <span className="font-semibold text-peligro">No se pudo generar el resumen.</span>{' '}
                  <span className="text-slate-400">{briefError}</span>
                </p>
              )}
              {brief && (
                <div className="mt-4 border-t border-slate-800 pt-4">
                  <p className="text-[13px] text-slate-400">
                    Fuente: {brief.source === 'amazon_nova' ? 'Amazon Nova' : 'Motor analítico (sin IA)'}
                  </p>
                  <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-200">{brief.brief}</div>
                </div>
              )}
            </div>
          </section>

          {/* ============ Jugadas para la Sala de Video ============ */}
          {(plan.featured_plays ?? []).length > 0 && (
            <section className="border-t border-slate-800 pt-8">
              <h3 className="text-[22px] leading-tight text-pintura">Míralo en video antes del partido</h3>
              <p className="mt-1 text-[16px] text-slate-400">
                Jugadas de su defensa y de su ofensiva, reconstruidas con el tracking a 10 Hz.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {plan.featured_plays.map((p) => (
                  <button
                    key={`${p.gameId}-${p.playId}`}
                    onClick={() => onWatchPlay(p)}
                    className="group flex flex-col justify-between rounded-md p-4 text-left ring-1 ring-inset ring-slate-800 transition hover:bg-slate-900"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-[13px] text-slate-400">
                        <span className="font-semibold text-slate-300">{TAG_LABEL[p.tag] ?? p.tag}</span>
                        <span>
                          Semana {p.week} · {p.matchup}
                        </span>
                      </div>
                      <div className="mt-2 text-[15px] font-semibold text-pintura">
                        {quarterLabel(p.quarter)} {p.gameClock} · {ORDINAL[p.down] ?? p.down} y {p.yardsToGo}
                      </div>
                      <div className="text-[15px]" style={{ color: p.passResult === 'S' ? TG.red : TG.muted }}>
                        {RESULT_LABEL[p.passResult] ?? p.passResult} · {p.playResult > 0 ? '+' : ''}
                        {p.playResult} yd
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] text-slate-400">{p.description}</p>
                    </div>
                    <span className="mt-3 text-[14px] font-semibold text-pintura underline-offset-4 group-hover:underline">
                      Ver en la Sala de Video
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */

function TendenciaTag() {
  return <span className="rounded-sm bg-slate-800 px-1.5 py-0.5 text-[13px] font-medium text-slate-300">Tendencia</span>
}

function LaneMap({ plan }: { plan: TeamGameplan }) {
  const lanes: TeamOlLane[] = plan.offense.ol_heatmap ?? []
  if (lanes.length === 0) return null
  const weakest = plan.offense.weakest_lane
  const maxRate = Math.max(1, ...lanes.map((l) => l.pressure_allowed_rate))
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[22px] leading-tight text-pintura">
          {weakest
            ? `Su carril más débil: ${laneName(weakest.lane)} (${weakest.starter})`
            : 'Presión permitida por carril de su línea'}
        </h3>
        <TendenciaTag />
      </div>
      <p className="mt-1 text-[15px] text-slate-400">
        % de bloqueos de pase en cada carril con presión permitida (golpe, apuro o sack), con n = bloqueos. Tendencia:
        muestra de 8 semanas.
      </p>

      <div className="mt-5 rounded-md bg-slate-900 px-4 pb-4 pt-3">
        <div className="flex items-center gap-2 text-[13px] text-slate-400">
          <span className="h-[3px] flex-1" style={{ background: TG.blue, opacity: 0.7 }} />
          <span>Línea de golpeo: los rushers atacan desde aquí</span>
          <span className="h-[3px] flex-1" style={{ background: TG.blue, opacity: 0.7 }} />
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2 sm:gap-4">
          {lanes.map((lane) => {
            const isWeakest = weakest?.lane === lane.lane
            const small = lane.total_snaps < MIN_N
            const pressures =
              (lane as TeamOlLane & { pressures?: number }).pressures ??
              Math.round((lane.pressure_allowed_rate / 100) * lane.total_snaps)
            const barH = Math.max(2, (lane.pressure_allowed_rate / maxRate) * 100)
            return (
              <div key={lane.lane} className={`flex min-w-0 flex-col ${small ? 'opacity-50' : ''}`}>
                <div className="text-[13px] text-slate-400">
                  {laneName(lane.lane)} <span className="text-slate-500">{lane.lane}</span>
                </div>
                <div className="truncate text-[15px] font-semibold text-pintura" title={lane.starter}>
                  {lane.starter}
                </div>
                <div className="relative mt-3 h-28 overflow-hidden rounded-sm bg-cesped-claro">
                  <div
                    className="absolute inset-x-0 bottom-0"
                    style={{ height: `${barH * 0.9}%`, background: isWeakest ? TG.red : TG.neutral }}
                  />
                </div>
                <div className="mt-2 tg-cifra text-[30px] sm:text-[36px]" style={{ color: isWeakest ? TG.red : TG.text }}>
                  {f1(lane.pressure_allowed_rate)}
                  <span className="font-sans text-[16px] font-semibold">%</span>
                </div>
                <div className="mt-1 text-[13px] tabular-nums text-slate-300">n = {n0(lane.total_snaps)} bloqueos</div>
                <div className="text-[13px] tabular-nums text-slate-400">
                  {n0(pressures)} presiones · {n0(lane.sacks_allowed)} sacks
                </div>
                <div className="mt-1 text-[13px] text-slate-400">
                  {isWeakest ? <span className="font-semibold text-peligro">Carril más débil</span> : RISK_LABEL[lane.risk_level] ?? ''}
                  {small && <span className="block">Muestra chica (n &lt; {MIN_N})</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4 text-center text-[13px] text-slate-400">
          Bolsa del quarterback
          <span className="mx-auto mt-1 block h-2.5 w-2.5 rounded-full" style={{ background: TG.blue }} />
        </div>
      </div>
    </div>
  )
}

type QbView = {
  name: string
  plays?: number
  late: number
  ttt: number
  leagueLate?: number
  leagueTtt?: number
  leagueDrop?: number
  successEarly?: number
  successLate?: number
}

function QbClockCard({ qb, stability }: { qb: QbView | null; stability?: number }) {
  if (!qb) {
    return (
      <div>
        <h3 className="text-[22px] leading-tight text-pintura">Reloj del QB rival</h3>
        <p className="mt-2 text-[15px] text-slate-400">Sin datos de reloj para el quarterback de este equipo.</p>
      </div>
    )
  }
  const holds = qb.leagueLate != null ? qb.late >= qb.leagueLate : null
  const barMax = Math.max(qb.late, qb.leagueLate ?? 0) * 1.15 || 1
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[22px] leading-tight text-pintura">Reloj del QB rival</h3>
        {holds !== null && (
          <span
            className={`rounded-sm px-2 py-0.5 text-[13px] font-semibold ${
              holds ? 'bg-peligro/15 text-peligro' : 'bg-azul/15 text-azul'
            }`}
          >
            {holds ? 'Sostiene el balón' : 'Suelta rápido'}
          </span>
        )}
      </div>
      <p className="mt-1 text-[15px] text-slate-400">
        {qb.name}
        {qb.plays != null ? ` · ${n0(qb.plays)} pases` : ''}
      </p>

      <div className="mt-4 flex items-end gap-4">
        <div className="tg-cifra text-[64px]" style={{ color: holds ? TG.red : TG.text }}>
          {f1(qb.late)}
          <span className="font-sans text-[24px] font-semibold">%</span>
        </div>
        <p className="pb-2 text-[16px] leading-snug text-slate-300">
          de sus pases pasan
          <br />
          de 3.5 s
        </p>
      </div>

      {qb.leagueLate != null && (
        <div className="mt-4 space-y-2" aria-label="Comparación contra la liga">
          <BarRow label={qb.name} value={qb.late} max={barMax} color={holds ? TG.red : TG.blue} />
          <BarRow label="Liga" value={qb.leagueLate} max={barMax} color={TG.neutralStrong} />
        </div>
      )}

      <p className="mt-4 text-[16px] text-slate-300">
        Mediana de lanzamiento: <span className="font-semibold text-pintura">{f1(qb.ttt)} s</span>
        {qb.leagueTtt != null && <span className="text-slate-400"> (liga: {f1(qb.leagueTtt)} s)</span>}
      </p>

      {qb.successEarly != null && qb.successLate != null ? (
        <p className="mt-2 text-[15px] text-slate-300">
          En toda la liga, el éxito del pase cae de {f1(qb.successEarly)}% a {f1(qb.successLate)}% después de 3.5 s.
        </p>
      ) : qb.leagueDrop != null ? (
        <p className="mt-2 text-[15px] text-slate-300">
          En toda la liga, después de 3.5 s el éxito del pase cae ~{f1(qb.leagueDrop)} puntos.
        </p>
      ) : null}

      <p className="mt-3 text-[13px] text-slate-400">
        Cuánto sostiene el balón un QB se repite entre mitades de temporada
        {stability != null ? ` (correlación ${f1(stability, 2)})` : ''}. La caída de éxito de cada QB después de 3.5 s
        no se repite, por eso no la mostramos por jugador.
      </p>
    </div>
  )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-3 text-[14px]">
      <span className="truncate text-slate-300" title={label}>
        {label}
      </span>
      <span className="h-3 rounded-sm bg-cesped-claro">
        <span className="block h-3 rounded-sm" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </span>
      <span className="text-right tabular-nums text-slate-200">{f1(value)}%</span>
    </div>
  )
}

function HintList({ title, hints }: { title: string; hints: string[] }) {
  return (
    <div>
      <h3 className="text-[22px] leading-tight text-pintura">{title}</h3>
      {hints.length === 0 ? (
        <p className="mt-2 text-[15px] text-slate-400">Sin recomendaciones para este equipo.</p>
      ) : (
        <ol className="mt-4 space-y-4">
          {hints.map((hint, i) => (
            <li key={i} className="flex gap-3 text-[16px] leading-relaxed text-slate-200">
              <span className="w-5 shrink-0 pt-px text-right font-semibold tabular-nums text-slate-500">{i + 1}</span>
              <span className="max-w-[65ch]">{hint}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-pintura">{value}</dd>
    </>
  )
}

function OffenseProfile({ plan }: { plan: TeamGameplan }) {
  const o = plan.offense
  const pa = plan.pa_rate ?? o.play_action_rate
  return (
    <div>
      <h4 className="text-[18px] text-pintura">Lo que hace su ofensiva</h4>
      <p className="mt-1 text-[14px] text-slate-400">
        Datos descriptivos: cuánto usan cada recurso, no qué tan bien les funciona.
      </p>
      <dl className="mt-3 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px]">
        <StatRow label="Pases (dropbacks)" value={n0(o.plays)} />
        {pa != null && <StatRow label="Con play action" value={`${f1(pa)}%`} />}
        {o.rollout_rate != null && <StatRow label="Con rollout diseñado" value={`${f1(o.rollout_rate)}%`} />}
        <StatRow label="Presión permitida" value={`${f1(o.pressure_allowed_rate)}%`} />
        <StatRow label="Sacks por pase" value={`${f1(o.sack_rate)}%`} />
      </dl>
    </div>
  )
}

function DefenseGetoff({ plan }: { plan: TeamGameplan }) {
  // La API puede mandar un número (contrato original) o un objeto con el promedio ajustado por grupo (edge/interior).
  const raw = plan.def_getoff_avg as unknown
  const obj =
    raw && typeof raw === 'object'
      ? (raw as { team_avg?: number; league_avg?: number; vs_group_avg?: number; snaps?: number; stability?: number })
      : null
  const team = obj ? obj.team_avg : (raw as number | null | undefined)
  const league = obj ? obj.league_avg : plan.league_getoff_avg
  if (team == null || league == null) return null
  const rel = obj?.vs_group_avg ?? team - league
  const faster = rel < 0
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[22px] leading-tight text-pintura">
          {faster ? 'Su línea arranca antes que la liga' : 'Su línea arranca después que la liga'}
        </h3>
        <TendenciaTag />
      </div>
      <div className="mt-4 flex items-end gap-4">
        <div className="tg-cifra text-[56px]" style={{ color: TG.text }}>
          {f1(team, 2)}
          <span className="font-sans text-[22px] font-semibold"> s</span>
        </div>
        <p className="pb-1.5 text-[16px] leading-snug text-slate-300">
          get-off promedio de sus rushers
          <br />
          <span className="text-slate-400">
            liga: {f1(league, 2)} s. Contra su grupo (edge o interior): {signed(rel, 2)} s
          </span>
        </p>
      </div>
      <p className="mt-3 text-[13px] text-slate-400">
        Get-off: segundos desde el snap hasta que el rusher avanza 1 yarda. A nivel equipo es solo una tendencia
        {obj?.stability != null ? ` (se repite poco entre mitades de temporada: ${f1(obj.stability, 2)})` : ''}
        {obj?.snaps != null ? `; n = ${n0(obj.snaps)} snaps` : ''}. El efecto robusto es el de cada jugador contra sí mismo.
      </p>
    </div>
  )
}

function DefenseProfile({ plan }: { plan: TeamGameplan }) {
  const d = plan.defense
  return (
    <div>
      <h4 className="text-[18px] text-pintura">Lo que hace su defensa</h4>
      <dl className="mt-3 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px]">
        <StatRow label="Pases defendidos" value={n0(d.plays)} />
        <StatRow label="Presión" value={`${f1(d.pressure_rate)}%`} />
        <StatRow label="Presión con rush de 4" value={`${f1(d.press_rate_4man)}%`} />
        <StatRow label="Blitz (5+ rushers)" value={`${f1(d.blitz_rate)}%`} />
        <StatRow label="Stunts" value={`${f1(d.stunt_rate)}%`} />
        <StatRow label="Sacks por pase" value={`${f1(d.sack_rate)}%`} />
      </dl>
    </div>
  )
}

function TopRushers({ plan }: { plan: TeamGameplan }) {
  const rows = plan.defense.top_rushers ?? []
  if (rows.length === 0) return null
  const anySmall = rows.some((r) => r.snaps < MIN_N)
  return (
    <div>
      <h4 className="text-[18px] text-pintura">Sus rushers con más presiones</h4>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-[14px]">
          <thead className="border-b border-slate-800 text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">Jugador</th>
              <th className="px-2 py-2 text-right font-medium">Snaps</th>
              <th className="px-2 py-2 text-right font-medium">Presiones</th>
              <th className="px-2 py-2 text-right font-medium">Sacks</th>
              <th className="py-2 pl-2 text-right font-medium">% presión</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 tabular-nums">
            {rows.map((r) => {
              const small = r.snaps < MIN_N
              return (
                <tr key={r.nflId} className={small ? 'text-slate-500' : 'text-slate-200'}>
                  <td className="py-2 pr-3">
                    <span className={small ? '' : 'font-semibold text-pintura'}>{r.displayName}</span>{' '}
                    <span className="text-slate-400">{r.position}</span>
                  </td>
                  <td className="px-2 py-2 text-right">{n0(r.snaps)}</td>
                  <td className="px-2 py-2 text-right">{n0(r.pressures)}</td>
                  <td className="px-2 py-2 text-right">{n0(r.sacks)}</td>
                  <td className="py-2 pl-2 text-right">{f1(r.press_rate)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {anySmall && <p className="mt-2 text-[13px] text-slate-400">En gris: menos de {MIN_N} snaps (muestra chica).</p>}
    </div>
  )
}
