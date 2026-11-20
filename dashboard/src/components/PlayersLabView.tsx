import { useMemo, useState } from 'react'
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
import type { GravityDefender, PlayersData } from '../types'

interface Props {
  data: PlayersData
  onSelectTeam: (team: string) => void
}

type SubTab = 'defenders' | 'linemen' | 'qbs'

export default function PlayersLabView({ data, onSelectTeam }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('defenders')
  const [search, setSearch] = useState('')
  const [onlyInvisible, setOnlyInvisible] = useState(false)
  const [olPos, setOlPos] = useState<'ALL' | 'T' | 'G' | 'C'>('ALL')

  const q = search.trim().toLowerCase()

  const filteredDefenders = useMemo(() => {
    return data.defenders.filter((d) => {
      if (onlyInvisible && !d.invisible_star) return false
      if (q && !d.displayName.toLowerCase().includes(q) && !d.team.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.defenders, onlyInvisible, q])

  const filteredLinemen = useMemo(() => {
    return data.linemen.filter((l) => {
      if (olPos !== 'ALL' && l.position !== olPos) return false
      if (q && !l.displayName.toLowerCase().includes(q) && !l.team.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.linemen, olPos, q])

  const filteredQbs = useMemo(() => {
    return data.qbs.filter((qb) => {
      if (q && !qb.displayName.toLowerCase().includes(q) && !qb.team.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.qbs, q])

  return (
    <div className="space-y-6">
      {/* Sub-navigation & Filters */}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['defenders', 'Trench Gravity Monsters (DL / Edge)'],
              ['linemen', 'Iron-Wall Blockers (O-Line)'],
              ['qbs', 'QB Poise Under Collapse'],
            ] as [SubTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                subTab === id
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                  : 'border border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {subTab === 'defenders' && (
            <button
              onClick={() => setOnlyInvisible((v) => !v)}
              className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                onlyInvisible
                  ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                  : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-amber-400/50'
              }`}
            >
              ★ Invisible Box-Score Stars Only (≤2 sacks)
            </button>
          )}
          {subTab === 'linemen' && (
            <div className="flex gap-1">
              {(['ALL', 'T', 'G', 'C'] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setOlPos(pos)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                    olPos === pos ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 bg-slate-950 text-slate-300'
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player or team (e.g. Vea, BUF)..."
            className="w-64 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-400"
          />
        </div>
      </section>

      {/* TAB 1: TRENCH GRAVITY DEFENDERS */}
      {subTab === 'defenders' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-bold text-white">
                  Front-Office Scouting Radar: Double-Team Gravity vs. Teammate Pressure Created
                </h3>
                <p className="text-xs text-slate-400">
                  Gold stars = <span className="font-semibold text-amber-300">&quot;Invisible Box-Score Superstars&quot;</span> (≤2 sacks, yet ≥40% double-team rate &amp; ≥34% teammate pressure). Traditional stats underpay them!
                </p>
              </div>
              <span className="rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300">
                4-Man Rush · Min 70 Snaps
              </span>
            </div>

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 20, left: 16, bottom: 14 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    type="number"
                    dataKey="dt_rate"
                    name="Double-Team Rate"
                    unit="%"
                    stroke="#94a3b8"
                    fontSize={12}
                    label={{ value: 'Double-Team Rate on 4-Man Rushes (%) →', position: 'insideBottom', offset: -8, fill: '#94a3b8', fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="tm_press_when_dt"
                    name="Teammate Pressure"
                    unit="%"
                    stroke="#94a3b8"
                    fontSize={12}
                    label={{ value: 'Teammate Press % (w/ DT)', angle: -90, position: 'insideLeft', offset: 2, style: { textAnchor: 'middle', fill: '#94a3b8', fontSize: 11 } }}
                  />
                  <ZAxis type="number" dataKey="gravity_score" range={[55, 250]} name="Gravity Score" />
                  <ReferenceLine x={40} stroke="#475569" strokeDasharray="4 4" />
                  <ReferenceLine y={32} stroke="#475569" strokeDasharray="4 4" />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3', stroke: '#64748b' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload as GravityDefender
                      return (
                        <div className="rounded-xl border border-slate-700 bg-slate-950/95 p-3 text-xs shadow-xl">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{p.displayName}</span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                              {p.team} · {p.position}
                            </span>
                          </div>
                          {p.invisible_star && (
                            <div className="mt-1 text-[10px] font-bold uppercase text-amber-300">
                              ★ Invisible Box-Score Star ({p.sacks} sacks, massive gravity!)
                            </div>
                          )}
                          <div className="mt-1.5 space-y-0.5 tabular-nums text-slate-300">
                            <div>Gravity Score: <span className="font-extrabold text-emerald-400">{p.gravity_score}</span></div>
                            <div>Double-Team Rate: <span className="font-bold text-amber-300">{p.dt_rate}%</span> ({p.dt_snaps}/{p.snaps_4man})</div>
                            <div>Teammate Press w/ DT: <span className="font-bold text-cyan-300">{p.tm_press_when_dt}%</span></div>
                            <div>Self Pressure Rate: <span className="text-white">{p.self_press_rate}%</span> · Sacks: <span className="text-white">{p.sacks}</span></div>
                          </div>
                        </div>
                      )
                    }}
                  />
                  <Scatter data={filteredDefenders}>
                    {filteredDefenders.map((d) => (
                      <Cell
                        key={d.nflId}
                        fill={d.invisible_star ? '#f59e0b' : d.gravity_score >= 88 ? '#10b981' : '#38bdf8'}
                        fillOpacity={0.85}
                        stroke="#0f172a"
                        strokeWidth={1.2}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Defenders Table */}
          <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/70 text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-3 py-3">Player</th>
                    <th className="px-3 py-3">Team</th>
                    <th className="px-3 py-3 text-right">Gravity Score</th>
                    <th className="px-3 py-3 text-right">Double-Team %</th>
                    <th className="px-3 py-3 text-right">Teammate Press w/ DT</th>
                    <th className="px-3 py-3 text-right">Self Press %</th>
                    <th className="px-3 py-3 text-right">Sacks</th>
                    <th className="px-4 py-3 text-right">4-Man Snaps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 tabular-nums">
                  {filteredDefenders.slice(0, 35).map((d, idx) => (
                    <tr key={d.nflId} className="hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 text-slate-500">{idx + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{d.displayName}</span>
                          <span className="text-[11px] text-slate-400">{d.position}</span>
                          {d.invisible_star && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                              ★ INVISIBLE STAR
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => onSelectTeam(d.team)}
                          className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-200 hover:bg-emerald-500 hover:text-slate-950"
                        >
                          {d.team}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right font-extrabold text-emerald-400">{d.gravity_score}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-amber-300">{d.dt_rate}%</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-cyan-300">{d.tm_press_when_dt}%</td>
                      <td className="px-3 py-2.5 text-right text-slate-200">{d.self_press_rate}%</td>
                      <td className="px-3 py-2.5 text-right font-bold text-white">{d.sacks}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{d.snaps_4man}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: IRON-WALL OFFENSIVE LINEMEN */}
      {subTab === 'linemen' && (
        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75">
          <div className="border-b border-slate-800 p-4">
            <h3 className="text-base font-bold text-white">Iron-Wall Offensive Linemen (Min 150 Pass-Block Snaps)</h3>
            <p className="text-xs text-slate-400">
              Ranked by composite Iron Wall Score (70% Clean-Pocket Rate + 30% Unbeaten Rate) — the blockers who neutralize Trench Gravity 1-on-1.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/70 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-3 py-3">Lineman</th>
                  <th className="px-3 py-3">Lane / Pos</th>
                  <th className="px-3 py-3">Team</th>
                  <th className="px-3 py-3 text-right">Iron Score</th>
                  <th className="px-3 py-3 text-right">Clean Rate %</th>
                  <th className="px-3 py-3 text-right">Beaten %</th>
                  <th className="px-3 py-3 text-right">Press Allowed</th>
                  <th className="px-3 py-3 text-right">Sacks Allowed</th>
                  <th className="px-4 py-3 text-right">Snaps</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 tabular-nums">
                {filteredLinemen.slice(0, 40).map((l, idx) => (
                  <tr key={l.nflId} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 text-slate-500">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-bold text-white">{l.displayName}</td>
                    <td className="px-3 py-2.5 text-cyan-300 font-semibold">{l.lane} ({l.position})</td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => onSelectTeam(l.team)}
                        className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-200 hover:bg-emerald-500 hover:text-slate-950"
                      >
                        {l.team}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right font-extrabold text-emerald-400">{l.iron_score}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-white">{l.clean_rate}%</td>
                    <td className="px-3 py-2.5 text-right text-amber-300">{l.beaten_rate}%</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{l.pressures_allowed}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-slate-100">{l.sacks_allowed}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{l.snaps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: QB POISE UNDER COLLAPSE */}
      {subTab === 'qbs' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5">
            <h3 className="text-base font-bold text-white">QB Poise Under Pocket Collapse: Clean vs. Pressured Yards/Play</h3>
            <p className="text-xs text-slate-400">
              Top 14 QBs ranked by Poise Score (minimum 45 pressured dropbacks). Shows who keeps producing when the pocket shrinks.
            </p>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredQbs.slice(0, 14)} margin={{ top: 8, right: 12, left: -10, bottom: 52 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="displayName"
                    stroke="#94a3b8"
                    fontSize={10}
                    angle={-28}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis stroke="#94a3b8" fontSize={12} unit=" yds" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 10, fontSize: 12 }}
                  />
                  <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
                  <Bar dataKey="clean_yds" name="Clean Pocket Yds/Play" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="press_yds" name="Under Pressure Yds/Play" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/70 text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-3 py-3">Quarterback</th>
                    <th className="px-3 py-3">Team</th>
                    <th className="px-3 py-3 text-right">Poise Score</th>
                    <th className="px-3 py-3 text-right">Pressured Yds</th>
                    <th className="px-3 py-3 text-right">Clean Yds</th>
                    <th className="px-3 py-3 text-right">Press Comp %</th>
                    <th className="px-3 py-3 text-right">Press→Sack %</th>
                    <th className="px-4 py-3 text-right">Press Faced %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 tabular-nums">
                  {filteredQbs.map((qb, idx) => (
                    <tr key={qb.nflId} className="hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 text-slate-500">{idx + 1}</td>
                      <td className="px-3 py-2.5 font-bold text-white">{qb.displayName}</td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => onSelectTeam(qb.team)}
                          className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-200 hover:bg-emerald-500 hover:text-slate-950"
                        >
                          {qb.team}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right font-extrabold text-emerald-400">{qb.poise_score}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-amber-300">{qb.press_yds}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{qb.clean_yds}</td>
                      <td className="px-3 py-2.5 text-right text-cyan-300">{qb.press_comp}%</td>
                      <td className="px-3 py-2.5 text-right text-rose-400">{qb.press_sack_rate}%</td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{qb.pressure_faced_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
