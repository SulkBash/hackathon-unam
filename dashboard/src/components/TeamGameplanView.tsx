import { useEffect, useState } from 'react'
import type { CoachBriefResponse, PlaySummary, TeamGameplan, TeamMatrixRow } from '../types'

interface Props {
  selectedTeam: string
  teams: TeamMatrixRow[]
  onSelectTeam: (team: string) => void
  onWatchPlay: (play: PlaySummary) => void
}

const SPOTLIGHT_TEAMS = ['MIN', 'SF', 'BUF', 'CLE', 'TB', 'PHI', 'LA', 'KC']

export default function TeamGameplanView({ selectedTeam, teams, onSelectTeam, onWatchPlay }: Props) {
  const [plan, setPlan] = useState<TeamGameplan | null>(null)
  const [loading, setLoading] = useState(true)
  const [brief, setBrief] = useState<CoachBriefResponse | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [question, setQuestion] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setBrief(null)
    fetch(`api/team/${selectedTeam}`)
      .then((r) => r.json())
      .then((d: TeamGameplan) => {
        if (active) setPlan(d)
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
    try {
      const resp = await fetch('api/coach-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'team', team: selectedTeam, question }),
      })
      const json: CoachBriefResponse = await resp.json()
      setBrief(json)
    } finally {
      setBriefLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Team Picker Bar */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-white">32-Team Sunday War-Room Gameplan</h2>
            <p className="text-xs text-slate-400">
              Select any NFL franchise for an instant 5-lane O-Line vulnerability map, Trench Gravity rush profile, and DC/OC scouting directives.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedTeam}
              onChange={(e) => onSelectTeam(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-emerald-400"
            >
              {[...teams]
                .sort((a, b) => a.teamName.localeCompare(b.teamName))
                .map((t) => (
                  <option key={t.team} value={t.team}>
                    {t.team} — {t.teamName}
                  </option>
                ))}
            </select>
            <div className="flex flex-wrap gap-1.5">
              {SPOTLIGHT_TEAMS.map((abbr) => (
                <button
                  key={abbr}
                  onClick={() => onSelectTeam(abbr)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                    selectedTeam === abbr
                      ? 'bg-emerald-500 text-slate-950'
                      : abbr === 'MIN' || abbr === 'SF'
                        ? 'border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                        : 'border border-slate-700 bg-slate-800/70 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {abbr}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {loading || !plan ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-12 text-center text-sm text-slate-400">
          Loading {selectedTeam} war-room scouting report...
        </div>
      ) : (
        <>
          {/* Team Summary KPI Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiBox label="Off Press Allowed" value={`${plan.offense.pressure_allowed_rate}%`} tone={plan.offense.pressure_allowed_rate > 38 ? 'rose' : 'emerald'} />
            <KpiBox label="Off Sack Rate" value={`${plan.offense.sack_rate}%`} tone={plan.offense.sack_rate > 7 ? 'rose' : 'slate'} />
            <KpiBox label="Play-Action Yds" value={`${plan.offense.play_action_yds}`} sub={`vs ${plan.offense.straight_dropback_yds} dropback`} tone="emerald" />
            <KpiBox label="Def 4-Man Press" value={`${plan.defense.press_rate_4man}%`} tone={plan.defense.press_rate_4man >= 36 ? 'emerald' : 'slate'} />
            <KpiBox label="Def Blitz Rate" value={`${plan.defense.blitz_rate}%`} sub={`Stunts ${plan.defense.stunt_rate}%`} tone="cyan" />
            <KpiBox label="3rd & Long Blitz Sack" value={`${plan.defense.third_long_blitz_sack_rate}%`} tone="amber" />
          </div>

          {/* 5-Man O-Line Vulnerability Formation Map */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Pass Protection X-Ray</span>
                <h3 className="text-base font-bold text-white">{plan.teamName} — 5-Lane Offensive Line Vulnerability Heatmap</h3>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/80" /> Low (&lt;4.5%)</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500/80" /> Medium (4.5–7.4%)</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500/80" /> Target Lane (7.5%+)</span>
              </div>
            </div>

            {/* Visual Trench Formation */}
            <div className="rounded-xl border border-slate-800 bg-gradient-to-b from-emerald-950/20 via-slate-950/90 to-slate-950 p-5">
              <div className="mb-3 flex items-center justify-center">
                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-0.5 text-[11px] font-bold uppercase tracking-widest text-cyan-300">
                  ▲ Line of Scrimmage (Pass Rushers Attack Here) ▲
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                {plan.offense.ol_heatmap.map((lane) => {
                  const isWeakest = lane.lane === plan.offense.weakest_lane.lane
                  const style =
                    lane.risk_level === 'HIGH'
                      ? 'border-rose-500/60 bg-rose-950/40'
                      : lane.risk_level === 'MED'
                        ? 'border-amber-500/50 bg-amber-950/30'
                        : 'border-emerald-500/40 bg-emerald-950/25'
                  const badge =
                    lane.risk_level === 'HIGH'
                      ? 'bg-rose-500 text-white'
                      : lane.risk_level === 'MED'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-emerald-500 text-slate-950'
                  return (
                    <div key={lane.lane} className={`relative rounded-xl border p-3.5 text-center ${style}`}>
                      {isWeakest && (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow">
                          Primary Target
                        </span>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold tracking-wider text-slate-300">{lane.lane}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${badge}`}>
                          {lane.pressure_allowed_rate}%
                        </span>
                      </div>
                      <div className="mt-2 truncate text-sm font-bold text-white" title={lane.starter}>
                        {lane.starter}
                      </div>
                      <div className="mt-1.5 flex justify-center gap-2 text-[11px] tabular-nums text-slate-400">
                        <span>{lane.total_snaps} snaps</span>
                        <span>·</span>
                        <span className={lane.sacks_allowed >= 3 ? 'font-bold text-rose-400' : ''}>
                          {lane.sacks_allowed} sacks
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] tabular-nums text-slate-400">
                        Beaten: <span className="text-slate-200">{lane.beaten_rate}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 flex justify-center">
                <div className="rounded-full border border-slate-700 bg-slate-900 px-4 py-1 text-xs font-bold text-slate-300">
                  QB Pocket · {plan.offense.comp_rate}% Comp · {plan.offense.avg_yards} Yds/Play
                </div>
              </div>
            </div>
          </section>

          {/* Two-Column DC & OC Scouting Directives */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-rose-500/25 bg-slate-900/75 p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-rose-400">For Opposing Defensive Coordinators</div>
              <h3 className="mt-0.5 text-base font-bold text-white">How to Attack {plan.team}&apos;s Pass Protection</h3>
              <ul className="mt-4 space-y-3">
                {plan.attack_this_oline.map((hint, i) => (
                  <li key={i} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs leading-relaxed text-slate-200">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-[11px] font-extrabold text-rose-300">
                      {i + 1}
                    </span>
                    <span>{hint}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/75 p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">For Opposing Offensive Coordinators</div>
              <h3 className="mt-0.5 text-base font-bold text-white">How to Neutralize {plan.team}&apos;s Pass Rush</h3>
              <ul className="mt-4 space-y-3">
                {plan.beat_this_defense.map((hint, i) => (
                  <li key={i} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs leading-relaxed text-slate-200">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-[11px] font-extrabold text-cyan-300">
                      {i + 1}
                    </span>
                    <span>{hint}</span>
                  </li>
                ))}
              </ul>

              {plan.defense.top_rushers.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Top {plan.team} Rusher</th>
                        <th className="px-2 py-2 text-right">Press</th>
                        <th className="px-2 py-2 text-right">Sacks</th>
                        <th className="px-2 py-2 text-right">DT %</th>
                        <th className="px-3 py-2 text-right">TM Press w/ DT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 tabular-nums">
                      {plan.defense.top_rushers.map((r) => (
                        <tr key={r.nflId} className="hover:bg-slate-900/60">
                          <td className="px-3 py-2 font-semibold text-white">
                            {r.displayName} <span className="text-slate-400">({r.linedUp})</span>
                          </td>
                          <td className="px-2 py-2 text-right text-emerald-400 font-bold">{r.pressures}</td>
                          <td className="px-2 py-2 text-right text-slate-200">{r.sacks}</td>
                          <td className="px-2 py-2 text-right text-amber-300">{r.dt_rate}%</td>
                          <td className="px-3 py-2 text-right text-cyan-300">{r.tm_press_when_dt}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Optional Amazon Nova AI Coach Brief */}
          <section className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                    Optional AWS Bedrock · Amazon Nova Pro
                  </span>
                  {brief && (
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                      Source: {brief.source === 'amazon_nova' ? 'Amazon Nova Pro (Live)' : 'Deterministic Analytical Engine'}
                    </span>
                  )}
                </div>
                <h3 className="mt-1 text-base font-bold text-white">Generate Custom Coach&apos;s Scouting Brief</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Optional question (e.g. 3rd & 8 call?)"
                  className="w-60 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-400"
                />
                <button
                  onClick={requestCoachBrief}
                  disabled={briefLoading}
                  className="rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-400 disabled:opacity-50"
                >
                  {briefLoading ? 'Generating Brief...' : `Generate ${plan.team} Brief`}
                </button>
              </div>
            </div>
            {brief && (
              <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-indigo-500/20 bg-slate-950/80 p-4 font-sans text-xs leading-relaxed text-slate-200">
                {brief.brief}
              </pre>
            )}
          </section>

          {/* Direct Team Film Room Links */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5">
            <h3 className="text-base font-bold text-white">Watch {plan.team} Key Trench Film (10Hz Animated Tracking)</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {plan.featured_plays.map((p) => (
                <button
                  key={`${p.gameId}-${p.playId}`}
                  onClick={() => onWatchPlay(p)}
                  className="group flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-left transition hover:border-emerald-400/60 hover:bg-slate-900"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                        p.tag.includes('DEFENSE') ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                      }`}>
                        {p.tag}
                      </span>
                      <span className="text-[11px] text-slate-400">Wk {p.week} · {p.matchup}</span>
                    </div>
                    <div className="mt-2 text-xs font-bold text-white group-hover:text-emerald-300">
                      Q{p.quarter} {p.gameClock} · {p.down}&amp;{p.yardsToGo} · {p.passResult === 'S' ? 'SACK' : `${p.playResult} yds`}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">{p.description}</p>
                  </div>
                  <div className="mt-3 text-[11px] font-semibold text-emerald-400">Open in 2D Film Room →</div>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function KpiBox({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone: 'emerald' | 'rose' | 'amber' | 'cyan' | 'slate'
}) {
  const accent =
    tone === 'emerald'
      ? 'text-emerald-400'
      : tone === 'rose'
        ? 'text-rose-400'
        : tone === 'amber'
          ? 'text-amber-300'
          : tone === 'cyan'
            ? 'text-cyan-300'
            : 'text-white'
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-extrabold tabular-nums ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}
