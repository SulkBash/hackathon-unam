import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { OverviewData, TeamMatrixRow } from '../types'

interface Props {
  data: OverviewData
  onSelectTeam: (team: string) => void
  onOpenFilmRoom: () => void
}

export default function ExecutivePlaybook({ data, onSelectTeam, onOpenFilmRoom }: Props) {
  const { summary, dt_paradox, gravity_lift, stunt_impact, dropback_counters, blitz_situations, team_matrix } = data

  const avgBlitz =
    team_matrix.reduce((acc, r) => acc + r.blitz_rate, 0) / Math.max(team_matrix.length, 1)
  const avg4Man =
    team_matrix.reduce((acc, r) => acc + r.press_rate_4man, 0) / Math.max(team_matrix.length, 1)

  const blitzGrouped = ['1st / 2nd Down', '3rd & Short/Med', '3rd & Long (7+)'].map((sit) => {
    const four = blitz_situations.find((r) => r.situation === sit && r.strategy === '4-Man Rush')
    const blz = blitz_situations.find((r) => r.situation === sit && r.strategy === 'Blitz (5+)')
    return {
      situation: sit,
      '4-Man Sack %': four?.sack_rate ?? 0,
      'Blitz Sack %': blz?.sack_rate ?? 0,
      '4-Man Yds/Play': four?.avg_yards ?? 0,
      'Blitz Yds/Play': blz?.avg_yards ?? 0,
      '4-Man Press %': four?.pressure_rate ?? 0,
      'Blitz Press %': blz?.pressure_rate ?? 0,
    }
  })

  return (
    <div className="space-y-6">
      {/* Hero Discovery Banner */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 p-6 shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              NFL {summary.season} Weeks {summary.weeks} · {summary.total_plays.toLocaleString()} Pass Plays · {summary.total_matchups.toLocaleString()} PFF Matchups
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              The Double-Team Paradox &amp; Winning the Pass-Rush War
            </h2>
            <p className="text-sm leading-relaxed text-slate-300 sm:text-base">
              Quarterback pressure slashes completions by{' '}
              <span className="font-bold text-rose-400">30.0 percentage points</span> ({summary.clean_comp_rate}% → {summary.pressured_comp_rate}%)
              and cuts yards per play in <span className="font-bold text-rose-400">half</span> ({summary.clean_avg_yds} → {summary.pressured_avg_yds} yds).
              Yet double-teaming two rushers in 5-on-4 protection creates a free rusher{' '}
              <span className="font-bold text-amber-300">100% of the time</span> and spikes pressure to{' '}
              <span className="font-bold text-amber-300">38.5%</span>. Here is the verified blueprint for{' '}
              <span className="font-semibold text-white">Defensive &amp; Offensive Coordinators</span>.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2.5">
            <button
              onClick={onOpenFilmRoom}
              className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
            >
              Watch Live 10Hz Film Room →
            </button>
            <button
              onClick={() => onSelectTeam('MIN')}
              className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20"
            >
              MIN vs SF War Room
            </button>
          </div>
        </div>

        {/* 4 Headline KPI Cards */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-rose-500/25 bg-slate-950/70 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-rose-400">1 · Pressure Leverage</div>
            <div className="mt-1 flex items-baseline gap-2 tabular-nums">
              <span className="text-2xl font-extrabold text-white">-4.22</span>
              <span className="text-xs text-slate-400">yds/play under pressure</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Clean: <span className="text-emerald-400 font-semibold">{summary.clean_comp_rate}% comp</span> ({summary.clean_avg_yds} yds) · Pressured:{' '}
              <span className="text-rose-400 font-semibold">{summary.pressured_comp_rate}% comp</span> ({summary.pressured_avg_yds} yds)
            </p>
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-slate-950/70 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-400">2 · Over-Allocation Trap (5v4)</div>
            <div className="mt-1 flex items-baseline gap-2 tabular-nums">
              <span className="text-2xl font-extrabold text-white">38.5%</span>
              <span className="text-xs text-slate-400">pressure w/ 2× double-teams</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              100% free rusher leak vs 10.5% with 1 DT; teammate pressure rises{' '}
              <span className="text-amber-300 font-semibold">{gravity_lift[0]?.teammate_pressure_rate}% → {gravity_lift[1]?.teammate_pressure_rate}%</span>.
            </p>
          </div>

          <div className="rounded-xl border border-cyan-500/25 bg-slate-950/70 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-cyan-400">3 · Free-Pressure Cheat Code</div>
            <div className="mt-1 flex items-baseline gap-2 tabular-nums">
              <span className="text-2xl font-extrabold text-white">+5.6 pts</span>
              <span className="text-xs text-slate-400">pressure via 4-man stunts</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              4-man stunts jump pressure <span className="text-cyan-300 font-semibold">33.3% → 38.9%</span> &amp; drop completions -4.4% with zero blitz coverage risk.
            </p>
          </div>

          <div className="rounded-xl border border-emerald-500/25 bg-slate-950/70 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400">4 · OC Launch-Point Counter</div>
            <div className="mt-1 flex items-baseline gap-2 tabular-nums">
              <span className="text-2xl font-extrabold text-white">1.1%</span>
              <span className="text-xs text-slate-400">sack rate on rollout right</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              <span className="text-emerald-300 font-semibold">6.4× fewer sacks</span> than traditional dropbacks (6.7%) &amp; <span className="text-emerald-300 font-semibold">67.7% comp</span> (+7.6 pts).
            </p>
          </div>
        </div>
      </section>

      {/* Row 2: Double-Team Paradox + 32-Team Trench Matrix */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Double-Team Over-Allocation Trap */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 xl:col-span-5">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white">The 5-on-4 Double-Team Over-Allocation Trap</h3>
              <p className="text-xs text-slate-400">
                Clean 5-blocker vs 4-rusher pass plays ({dt_paradox.reduce((s, r) => s + r.plays, 0).toLocaleString()} plays). Doubling 2 rushers breaks protection math.
              </p>
            </div>
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">PARADOX</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dt_paradox} margin={{ top: 10, right: 12, left: -12, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="double_teams"
                  tickFormatter={(v) => `${v} DT`}
                  stroke="#94a3b8"
                  fontSize={12}
                />
                <YAxis stroke="#94a3b8" fontSize={12} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 10, fontSize: 12 }}
                  formatter={(value, name) => [`${value ?? 0}%`, String(name ?? '')]}
                  labelFormatter={(v) => `${v} Double-Team(s) in 5v4`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="pressure_rate" name="Play Pressure %" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                <Bar dataKey="free_rusher_rate" name="Unblocked Free Rusher %" fill="#ef4444" radius={[6, 6, 0, 0]} />
                <Bar dataKey="sack_rate" name="Sack %" fill="#06b6d4" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
            <span className="font-bold text-amber-300">Coach&apos;s Rule:</span> On 4-man rushes, even when a single star is double-teamed, teammate pressure jumps from{' '}
            <span className="font-semibold text-white">{gravity_lift[0]?.teammate_pressure_rate}%</span> to{' '}
            <span className="font-semibold text-amber-300">{gravity_lift[1]?.teammate_pressure_rate}%</span>. Limit 5-man protection to 1 slide/double-team—or move the pocket.
          </div>
        </section>

        {/* 32-Team 4-Man Rush vs Blitz Matrix */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 xl:col-span-7">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white">32-Team Pass-Rush Efficiency Matrix</h3>
              <p className="text-xs text-slate-400">
                Top-left = Elite 4-Man Rush without blitzing (BUF, CLE, PHI). <span className="text-emerald-400">Click any team dot</span> to open its Sunday Gameplan.
              </p>
            </div>
            <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">INTERACTIVE</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 20, left: -8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  type="number"
                  dataKey="blitz_rate"
                  name="Blitz Rate"
                  unit="%"
                  domain={[5, 45]}
                  stroke="#94a3b8"
                  fontSize={12}
                  label={{ value: 'Blitz Rate (%) →', position: 'insideBottom', offset: -6, fill: '#94a3b8', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="press_rate_4man"
                  name="4-Man Pressure"
                  unit="%"
                  domain={[22, 46]}
                  stroke="#94a3b8"
                  fontSize={12}
                  label={{ value: '4-Man Rush Press %', angle: -90, position: 'insideLeft', offset: 14, fill: '#94a3b8', fontSize: 11 }}
                />
                <ZAxis type="number" dataKey="sack_rate" range={[70, 260]} name="Sack Rate" />
                <ReferenceLine x={avgBlitz} stroke="#475569" strokeDasharray="4 4" />
                <ReferenceLine y={avg4Man} stroke="#475569" strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3', stroke: '#64748b' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const t = payload[0].payload as TeamMatrixRow
                    return (
                      <div className="rounded-xl border border-slate-700 bg-slate-950/95 p-3 text-xs shadow-xl">
                        <div className="font-bold text-white">{t.teamName} ({t.team})</div>
                        <div className="mt-1 space-y-0.5 tabular-nums text-slate-300">
                          <div>4-Man Rush Pressure: <span className="font-bold text-emerald-400">{t.press_rate_4man}%</span></div>
                          <div>Blitz Rate: <span className="font-bold text-cyan-300">{t.blitz_rate}%</span> · Stunt Rate: <span className="text-amber-300">{t.stunt_rate}%</span></div>
                          <div>Sack Rate: <span className="text-white">{t.sack_rate}%</span> · Yds Allowed: <span className="text-white">{t.avg_yds_allowed}</span></div>
                        </div>
                        <div className="mt-1.5 text-[10px] font-semibold text-emerald-400">Click dot → Open {t.team} Gameplan</div>
                      </div>
                    )
                  }}
                />
                <Scatter
                  data={team_matrix}
                  onClick={(pt) => {
                    const row = (pt as unknown as { payload?: TeamMatrixRow })?.payload
                    if (row?.team) onSelectTeam(row.team)
                  }}
                  className="cursor-pointer"
                >
                  {team_matrix.map((entry) => {
                    const elite = entry.press_rate_4man >= avg4Man && entry.blitz_rate <= avgBlitz
                    const spotlight = entry.team === 'MIN' || entry.team === 'SF'
                    const color = spotlight
                      ? '#f59e0b'
                      : elite
                        ? '#10b981'
                        : entry.press_rate_4man >= avg4Man
                          ? '#06b6d4'
                          : '#64748b'
                    return <Cell key={entry.team} fill={color} fillOpacity={0.88} stroke="#0f172a" strokeWidth={1.5} />
                  })}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Elite 4-Man Rush (Low Blitz)</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Aggressive High-Pressure</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> NFL Mexico Spotlight (MIN / SF)</span>
            </div>
            <div className="flex gap-1.5">
              {['BUF', 'CLE', 'PHI', 'MIN', 'SF'].map((abbr) => (
                <button
                  key={abbr}
                  onClick={() => onSelectTeam(abbr)}
                  className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] font-bold text-slate-200 hover:border-emerald-400 hover:text-emerald-300"
                >
                  {abbr}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Row 3: DC Playbook (Blitz Timing + Stunts) & OC Counter Playbook (Rollouts + Max Protect) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Defensive Coordinator Playbook */}
        <section className="rounded-2xl border border-rose-500/20 bg-slate-900/70 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400">Defensive Coordinator Playbook</span>
              <h3 className="text-base font-bold text-white">Stop Blitzing Early Downs — Unleash on 3rd &amp; Long</h3>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={blitzGrouped} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="situation" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={12} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 10, fontSize: 12 }}
                  formatter={(value, name) => [`${value ?? 0}%`, String(name ?? '')]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="4-Man Sack %" fill="#64748b" radius={[5, 5, 0, 0]} />
                <Bar dataKey="Blitz Sack %" fill="#f43f5e" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="font-bold text-rose-400">3rd &amp; Long Kill Shot</div>
              <p className="mt-1 text-slate-300">
                Blitzing on 3rd &amp; 7+ jumps sacks <span className="font-bold text-white">9.1% → 15.2%</span> (+67%) and pressure to <span className="font-bold text-white">60.5%</span>. On 1st/2nd down, blitzing saves <span className="font-bold text-amber-300">0.00 yds/play</span> (6.72 vs 6.75).
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="font-bold text-cyan-400">4-Man Stunts &amp; Twists</div>
              <p className="mt-1 text-slate-300">
                {stunt_impact[1]?.pressure_rate}% pressure vs {stunt_impact[0]?.pressure_rate}% straight rush on 4-man fronts. Pair <span className="font-bold text-white">Blitz + Stunt</span> for a <span className="font-bold text-rose-400">{stunt_impact[3]?.sack_rate}%</span> sack rate!
              </p>
            </div>
          </div>
        </section>

        {/* Offensive Coordinator Counter-Playbook */}
        <section className="rounded-2xl border border-emerald-500/20 bg-slate-900/70 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Offensive Coordinator Counter-Playbook</span>
              <h3 className="text-base font-bold text-white">Beat Trench Gravity by Moving the Launch Point</h3>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dropback_counters} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} interval={0} />
                <YAxis stroke="#94a3b8" fontSize={12} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 10, fontSize: 12 }}
                  formatter={(value, name) => [`${value ?? 0}%`, String(name ?? '')]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="comp_rate" name="Completion %" fill="#10b981" radius={[5, 5, 0, 0]} />
                <Bar dataKey="pressure_rate" name="Pressure %" fill="#f59e0b" radius={[5, 5, 0, 0]} />
                <Bar dataKey="sack_rate" name="Sack %" fill="#ef4444" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="font-bold text-emerald-400">Designed Rollout Right</div>
              <p className="mt-1 text-slate-300">
                Slashes sack rate <span className="font-bold text-white">6.7% → 1.1%</span> (6.4× safer!) and lifts completions to <span className="font-bold text-emerald-300">67.7%</span> by outflanking interior gravity.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="font-bold text-amber-300">Skip 6-Man Static · Use PA / 7-Man</div>
              <p className="mt-1 text-slate-300">
                On 4-man rushes, Play-Action adds <span className="font-bold text-white">+1.76 yds/play</span> (6.12 → 7.88), and 7-man Max Protect cuts pressure to <span className="font-bold text-emerald-300">28.4%</span> (7.85 yds).
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
