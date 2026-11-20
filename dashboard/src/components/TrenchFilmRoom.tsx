import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CoachBriefResponse, PlayRosterMeta, PlaySummary, PlayTrackingData, TeamMatrixRow } from '../types'

interface Props {
  initialPlay: { gameId: number; playId: number } | null
  teams: TeamMatrixRow[]
}

const CATEGORIES = [
  { id: '', label: 'All Plays' },
  { id: 'double_team_trap', label: '5v4 2× Double-Team Trap' },
  { id: 'stunt', label: '4-Man Stunts / Twists' },
  { id: 'blitz_3rd_long', label: '3rd & Long Blitzes' },
  { id: 'rollout', label: 'Designed Rollouts' },
  { id: 'sack', label: 'Sacks' },
]

export default function TrenchFilmRoom({ initialPlay, teams }: Props) {
  const [showcase, setShowcase] = useState<PlaySummary[]>([])
  const [filteredPlays, setFilteredPlays] = useState<PlaySummary[]>([])
  const [filterTeam, setFilterTeam] = useState('')
  const [filterCat, setFilterCat] = useState('')

  const [activeKey, setActiveKey] = useState<{ gameId: number; playId: number } | null>(initialPlay)
  const [tracking, setTracking] = useState<PlayTrackingData | null>(null)
  const [loading, setLoading] = useState(false)

  // Animation playback state
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1)
  const [showMatchups, setShowMatchups] = useState(true)
  const [showPocket, setShowPocket] = useState(true)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const [brief, setBrief] = useState<CoachBriefResponse | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)

  // Sync external play jump
  useEffect(() => {
    if (initialPlay) {
      setActiveKey(initialPlay)
    }
  }, [initialPlay])

  // Load showcase + filtered list
  useEffect(() => {
    const params = new URLSearchParams()
    if (filterTeam) params.set('team', filterTeam)
    if (filterCat) params.set('category', filterCat)
    params.set('limit', '24')
    fetch(`api/plays?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { showcase: PlaySummary[]; plays: PlaySummary[] }) => {
        setShowcase(d.showcase)
        setFilteredPlays(d.plays)
        setActiveKey((prev) => {
          if (prev) return prev
          const first = d.showcase[0] ?? d.plays[0]
          return first ? { gameId: first.gameId, playId: first.playId } : null
        })
      })
  }, [filterTeam, filterCat])

  // Load 10Hz tracking JSON for selected play
  useEffect(() => {
    if (!activeKey) return
    let live = true
    setLoading(true)
    setBrief(null)
    fetch(`api/play/${activeKey.gameId}/${activeKey.playId}/tracking`)
      .then((r) => r.json())
      .then((d: PlayTrackingData) => {
        if (!live) return
        setTracking(d)
        setFrameIdx(0)
        setPlaying(true)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [activeKey])

  // 10Hz animation loop
  useEffect(() => {
    if (!playing || !tracking || tracking.frames.length === 0) return
    const ms = Math.round(100 / speed)
    const id = window.setInterval(() => {
      setFrameIdx((cur) => (cur + 1 >= tracking.frames.length ? 0 : cur + 1))
    }, ms)
    return () => window.clearInterval(id)
  }, [playing, speed, tracking])

  const rosterMap = useMemo(() => {
    const map = new Map<number, PlayRosterMeta>()
    tracking?.roster.forEach((r) => map.set(r.nflId, r))
    return map
  }, [tracking])

  const currentFrame = tracking?.frames[frameIdx] ?? null

  async function requestPlayBrief() {
    if (!activeKey) return
    setBriefLoading(true)
    try {
      const resp = await fetch('api/coach-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'play', gameId: activeKey.gameId, playId: activeKey.playId }),
      })
      const json: CoachBriefResponse = await resp.json()
      setBrief(json)
    } finally {
      setBriefLoading(false)
    }
  }

  // Coordinate helper: map NFL (x in [xMin..xMax], y in [0..53.3]) to SVG viewBox (1000 x 560)
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

  return (
    <div className="space-y-5">
      {/* Showcase Play Strip */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="mb-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              Live 10Hz NFL Tracking Replay · 122 Games On Demand
            </span>
            <h2 className="text-base font-extrabold text-white">Curated Trench Warfare Showcase Plays</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={filterTeam}
              onChange={(e) => setFilterTeam(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white outline-none focus:border-emerald-400"
            >
              <option value="">Filter Any Team (32)</option>
              {[...teams]
                .sort((a, b) => a.team.localeCompare(b.team))
                .map((t) => (
                  <option key={t.team} value={t.team}>
                    {t.team} — {t.teamName}
                  </option>
                ))}
            </select>
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white outline-none focus:border-emerald-400"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {showcase.map((s) => {
            const isSelected = activeKey?.gameId === s.gameId && activeKey?.playId === s.playId
            return (
              <button
                key={`${s.gameId}-${s.playId}`}
                onClick={() => setActiveKey({ gameId: s.gameId, playId: s.playId })}
                className={`rounded-xl border p-2.5 text-left transition ${
                  isSelected
                    ? 'border-emerald-400 bg-emerald-500/15 shadow-lg shadow-emerald-500/10'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-300">
                    {s.tag}
                  </span>
                  <span className="text-[10px] text-slate-400">Wk {s.week} · {s.matchup}</span>
                </div>
                <div className="mt-1.5 truncate text-xs font-bold text-white">{s.headline}</div>
                <div className="mt-0.5 text-[10px] text-slate-400">
                  {s.offense} vs {s.defense} · {s.n_blockers}v{s.n_rushers} ({s.n_dt_rushers} DT)
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Main Stage: Animated 2D SVG NFL Field + Synced Physics Telemetry */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left: SVG NFL Field */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 xl:col-span-8">
          {loading || !tracking || !currentFrame ? (
            <div className="flex h-[460px] items-center justify-center text-sm text-slate-400">
              Loading 10Hz tracking frames &amp; trench matchup physics...
            </div>
          ) : (
            <>
              {/* Play Header */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 font-extrabold text-white">
                      {tracking.play.offense} (Off) vs {tracking.play.defense} (Def)
                    </span>
                    <span className="font-semibold text-slate-300">
                      Wk {tracking.play.week} · Q{tracking.play.quarter} {tracking.play.gameClock} · {tracking.play.down}&amp;{tracking.play.yardsToGo}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                        tracking.play.passResult === 'S'
                          ? 'bg-rose-500/25 text-rose-300'
                          : tracking.play.passResult === 'C'
                            ? 'bg-emerald-500/25 text-emerald-300'
                            : 'bg-slate-700 text-slate-200'
                      }`}
                    >
                      {tracking.play.passResult === 'S'
                        ? `SACK (${tracking.play.playResult} yds)`
                        : `${tracking.play.passResult} (${tracking.play.playResult >= 0 ? '+' : ''}${tracking.play.playResult} yds)`}
                    </span>
                    {tracking.play.has_stunt && (
                      <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-[10px] font-extrabold text-cyan-300">
                        STUNT/TWIST
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{tracking.play.description}</p>
                </div>

                {/* Live Threat Pill */}
                <div className="flex items-center gap-2 tabular-nums">
                  <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-right">
                    <div className="text-[10px] uppercase text-slate-400">Pocket Radius</div>
                    <div
                      className={`text-sm font-extrabold ${
                        currentFrame.threat === 'COLLAPSE'
                          ? 'text-rose-400'
                          : currentFrame.threat === 'CLOSING'
                            ? 'text-amber-300'
                            : 'text-emerald-400'
                      }`}
                    >
                      {currentFrame.minDist.toFixed(2)} yds · {currentFrame.threat}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-right">
                    <div className="text-[10px] uppercase text-slate-400">Clock vs Snap</div>
                    <div className="text-sm font-extrabold text-white">
                      {currentFrame.t >= 0 ? `+${currentFrame.t.toFixed(1)}s` : `${currentFrame.t.toFixed(1)}s`}
                    </div>
                  </div>
                </div>
              </div>

              {/* SVG NFL Field */}
              <div className="relative overflow-hidden rounded-xl border border-emerald-900/60 bg-[#0b2a1c] shadow-inner">
                <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="block h-auto w-full select-none">
                  {/* Turf Stripes every 5 yards */}
                  {Array.from({ length: 24 }, (_, i) => i * 5).map((yardX) => {
                    const x1 = sx(yardX)
                    const x2 = sx(yardX + 5)
                    if (x2 < 0 || x1 > SVG_W) return null
                    return (
                      <rect
                        key={yardX}
                        x={x1}
                        y={0}
                        width={x2 - x1}
                        height={SVG_H}
                        fill={yardX % 10 === 0 ? '#0d3322' : '#0a291b'}
                      />
                    )
                  })}

                  {/* Yard lines & Field numbers */}
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
                          stroke="rgba(255,255,255,0.16)"
                          strokeWidth={yardX % 10 === 0 ? 1.5 : 0.8}
                        />
                        {yardX % 10 === 0 && fieldNum > 0 && fieldNum <= 50 && (
                          <>
                            <text
                              x={px}
                              y={52}
                              textAnchor="middle"
                              fill="rgba(255,255,255,0.22)"
                              fontSize="24"
                              fontWeight="800"
                            >
                              {fieldNum}
                            </text>
                            <text
                              x={px}
                              y={SVG_H - 30}
                              textAnchor="middle"
                              fill="rgba(255,255,255,0.22)"
                              fontSize="24"
                              fontWeight="800"
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
                      stroke="rgba(255,255,255,0.14)"
                      strokeDasharray="4 14"
                      strokeWidth={2}
                    />
                  ))}

                  {/* Line of Scrimmage (Cyan) & First Down (Gold) */}
                  <line
                    x1={sx(tracking.losX)}
                    y1={0}
                    x2={sx(tracking.losX)}
                    y2={SVG_H}
                    stroke="#38bdf8"
                    strokeWidth={3}
                    strokeDasharray="8 5"
                  />
                  <text x={sx(tracking.losX) + 6} y={18} fill="#38bdf8" fontSize="11" fontWeight="800">
                    LOS →
                  </text>
                  <line
                    x1={sx(tracking.firstDownX)}
                    y1={0}
                    x2={sx(tracking.firstDownX)}
                    y2={SVG_H}
                    stroke="#facc15"
                    strokeWidth={2.5}
                    opacity={0.85}
                  />

                  {/* Live Shrinking QB Pocket Bubble */}
                  {showPocket && currentFrame.qb && (
                    <g>
                      <ellipse
                        cx={sx(currentFrame.qb.x)}
                        cy={sy(currentFrame.qb.y)}
                        rx={Math.max(18, Math.min(currentFrame.minDist, 8) * pxPerYardX)}
                        ry={Math.max(18, Math.min(currentFrame.minDist, 8) * pxPerYardY)}
                        fill={
                          currentFrame.threat === 'COLLAPSE'
                            ? 'rgba(244, 63, 94, 0.22)'
                            : currentFrame.threat === 'CLOSING'
                              ? 'rgba(245, 158, 11, 0.17)'
                              : 'rgba(16, 185, 129, 0.14)'
                        }
                        stroke={
                          currentFrame.threat === 'COLLAPSE'
                            ? '#fb7185'
                            : currentFrame.threat === 'CLOSING'
                              ? '#fbbf24'
                              : '#34d399'
                        }
                        strokeWidth={2.2}
                        strokeDasharray="6 4"
                      />
                      {/* Nearest rusher threat vector */}
                      {currentFrame.nearestRusherId != null && playerPosMap.has(currentFrame.nearestRusherId) && (
                        <line
                          x1={sx(currentFrame.qb.x)}
                          y1={sy(currentFrame.qb.y)}
                          x2={sx(playerPosMap.get(currentFrame.nearestRusherId)!.x)}
                          y2={sy(playerPosMap.get(currentFrame.nearestRusherId)!.y)}
                          stroke={currentFrame.threat === 'COLLAPSE' ? '#fb7185' : '#fbbf24'}
                          strokeWidth={1.8}
                          strokeDasharray="4 3"
                          opacity={0.9}
                        />
                      )}
                    </g>
                  )}

                  {/* Exact PFF Blocker -> Rusher Matchup Connectors */}
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
                          stroke={edge.isDoubleTeam ? '#fbbf24' : 'rgba(148, 163, 184, 0.55)'}
                          strokeWidth={edge.isDoubleTeam ? 3.2 : 1.5}
                          opacity={edge.isDoubleTeam ? 0.92 : 0.7}
                        />
                      )
                    })}

                  {/* Players */}
                  {currentFrame.players.map((p) => {
                    const meta = rosterMap.get(p.id)
                    const isOff = p.t === tracking.play.offense
                    const isQb = meta?.role === 'Pass'
                    const isRusher = meta?.role === 'Pass Rush'
                    const isBlocker = meta?.role === 'Pass Block'
                    const cx = sx(p.x)
                    const cy = sy(p.y)

                    // Orientation tick (NFL 0=North/+y, 90=East/+x)
                    const oRad = (p.o * Math.PI) / 180
                    const ox = cx + Math.sin(oRad) * 16
                    const oy = cy - Math.cos(oRad) * 16

                    const fill = isQb
                      ? '#38bdf8'
                      : isBlocker
                        ? '#0ea5e9'
                        : isOff
                          ? '#0284c7'
                          : meta?.generatedPressure
                            ? '#f43f5e'
                            : isRusher
                              ? '#ef4444'
                              : '#9f1239'

                    return (
                      <g
                        key={p.id}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredId(p.id)}
                        onMouseLeave={() => setHoveredId(null)}
                      >
                        {/* Double-team Gold Gravity Halo */}
                        {meta?.isDoubleTeamed && (
                          <circle cx={cx} cy={cy} r={20} fill="rgba(245, 158, 11, 0.22)" stroke="#fbbf24" strokeWidth={2.5} />
                        )}
                        {/* Free Rusher / Pressure Crimson Alert Halo */}
                        {(meta?.isFreeRusher || meta?.generatedPressure) && (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={meta.isDoubleTeamed ? 24 : 19}
                            fill="none"
                            stroke="#fb7185"
                            strokeWidth={2.2}
                            strokeDasharray={meta.isFreeRusher ? '4 3' : undefined}
                          />
                        )}
                        {/* Body Orientation Pointer */}
                        <line x1={cx} y1={cy} x2={ox} y2={oy} stroke="rgba(255,255,255,0.7)" strokeWidth={2} />
                        {/* Player Dot */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isQb || isRusher || isBlocker ? 12.5 : 10}
                          fill={fill}
                          stroke={hoveredId === p.id ? '#ffffff' : '#0f172a'}
                          strokeWidth={hoveredId === p.id ? 2.8 : 1.8}
                        />
                        <text
                          x={cx}
                          y={cy + 3.5}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="9.5"
                          fontWeight="800"
                        >
                          {p.j}
                        </text>
                        {/* Highlight labels for QB (below dot), Double-Teamed, Free Rushers, and Pressure Makers (above dot) */}
                        {(isQb || meta?.isDoubleTeamed || meta?.isFreeRusher || meta?.generatedPressure) && (
                          <text
                            x={cx}
                            y={isQb ? cy + 25 : meta?.isDoubleTeamed ? cy - 23 : cy - 19}
                            textAnchor="middle"
                            fill={meta?.isDoubleTeamed ? '#fde68a' : meta?.generatedPressure ? '#fda4af' : '#bae6fd'}
                            fontSize="10"
                            fontWeight="800"
                            stroke="#020617"
                            strokeWidth={3.2}
                            paintOrder="stroke"
                          >
                            {meta?.name.split(' ').slice(-1)[0]}
                            {meta?.isDoubleTeamed ? ' [2×DT]' : meta?.isFreeRusher ? ' [FREE]' : meta?.sack ? ' [SACK]' : ''}
                          </text>
                        )}
                      </g>
                    )
                  })}

                  {/* Football */}
                  {currentFrame.ball && (
                    <ellipse
                      cx={sx(currentFrame.ball.x)}
                      cy={sy(currentFrame.ball.y)}
                      rx={7}
                      ry={4.5}
                      fill="#92400e"
                      stroke="#fde68a"
                      strokeWidth={1.6}
                    />
                  )}
                </svg>

                {/* Floating Event Badge */}
                {currentFrame.event && (
                  <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-950/90 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-amber-300 ring-1 ring-amber-400/40">
                    Event: {currentFrame.event.replace(/_/g, ' ')}
                  </div>
                )}

                {/* Hover Inspector Card */}
                {hoveredMeta && hoveredPos && (
                  <div className="pointer-events-none absolute right-3 top-3 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl">
                    <div className="font-bold text-white">
                      {hoveredMeta.name} <span className="text-slate-400">({hoveredMeta.linedUp || hoveredMeta.officialPos})</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-300">
                      Role: <span className="font-semibold text-cyan-300">{hoveredMeta.role}</span> · Speed: {hoveredPos.s} yds/s
                    </div>
                    {hoveredMeta.isDoubleTeamed && (
                      <div className="text-[11px] font-bold text-amber-300">Absorbing Double-Team ({hoveredMeta.blockersAssigned} blockers)</div>
                    )}
                    {hoveredMeta.isFreeRusher && (
                      <div className="text-[11px] font-bold text-rose-400">Unblocked Free Rusher!</div>
                    )}
                    {hoveredMeta.generatedPressure && (
                      <div className="text-[11px] font-bold text-rose-300">
                        Pressure: {hoveredMeta.sack ? 'SACK' : hoveredMeta.hit ? 'QB HIT' : 'HURRY'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Playback Controls */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="rounded-xl bg-emerald-500 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"
                >
                  {playing ? '❚❚ Pause' : '▶ Play'}
                </button>
                <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-[11px] font-bold">
                  {([0.5, 1, 2] as const).map((sp) => (
                    <button
                      key={sp}
                      onClick={() => setSpeed(sp)}
                      className={`rounded-md px-2 py-1 ${speed === sp ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
                    >
                      {sp}×
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(tracking.frames.length - 1, 0)}
                  value={frameIdx}
                  onChange={(e) => {
                    setPlaying(false)
                    setFrameIdx(Number(e.target.value))
                  }}
                  className="h-1.5 flex-1 accent-emerald-400"
                />
                <button
                  onClick={() => {
                    setPlaying(false)
                    setFrameIdx(tracking.physicsSummary.closestFrameIndex)
                  }}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20"
                >
                  Jump to Peak Collapse
                </button>
              </div>

              {/* Layer toggles & Legend */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Offense / QB</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Pass Rush</span>
                  <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-amber-400" /> Double-Team Link</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-rose-400" /> Free Rusher</span>
                </div>
                <div className="flex gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5 text-slate-300">
                    <input type="checkbox" checked={showMatchups} onChange={(e) => setShowMatchups(e.target.checked)} className="accent-amber-400" />
                    Matchup Links
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 text-slate-300">
                    <input type="checkbox" checked={showPocket} onChange={(e) => setShowPocket(e.target.checked)} className="accent-emerald-400" />
                    Pocket Radar
                  </label>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Right: Synced Real-Time Physics Telemetry & Coach Notes */}
        <section className="flex flex-col gap-4 xl:col-span-4">
          {tracking && (
            <>
              {/* Physics Chart synced with animation frame */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">10Hz Pocket Collapse Telemetry</h3>
                    <p className="text-[11px] text-slate-400">Live pocket radius (yds) vs. peak rusher closing speed</p>
                  </div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={tracking.telemetry} margin={{ top: 8, right: 8, left: -18, bottom: 2 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="t" stroke="#94a3b8" fontSize={10} unit="s" />
                      <YAxis yAxisId="left" stroke="#34d399" fontSize={10} domain={[0, 'auto']} />
                      <YAxis yAxisId="right" orientation="right" stroke="#fb7185" fontSize={10} domain={[0, 'auto']} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 10, fontSize: 11 }}
                        labelFormatter={(v) => `t = ${v}s vs snap`}
                      />
                      <ReferenceLine yAxisId="left" y={2.5} stroke="#f43f5e" strokeDasharray="3 3" />
                      {currentFrame && (
                        <ReferenceLine yAxisId="left" x={currentFrame.t} stroke="#facc15" strokeWidth={2} />
                      )}
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="pocketRadius"
                        name="Pocket Radius (yds)"
                        stroke="#34d399"
                        fill="#10b981"
                        fillOpacity={0.16}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="closingSpeed"
                        name="Closing Speed (yds/s)"
                        stroke="#fb7185"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] tabular-nums">
                  <div className="rounded-lg bg-slate-950/80 p-2">
                    <div className="text-slate-400">Min Radius</div>
                    <div className="font-extrabold text-rose-400">{tracking.physicsSummary.minPocketRadius} yds</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/80 p-2">
                    <div className="text-slate-400">Peak Collapse</div>
                    <div className="font-extrabold text-amber-300">{tracking.physicsSummary.peakCollapseVel} y/s</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/80 p-2">
                    <div className="text-slate-400">Protection</div>
                    <div className="font-extrabold text-cyan-300">
                      {tracking.play.n_blockers}v{tracking.play.n_rushers}
                    </div>
                  </div>
                </div>
              </div>

              {/* Coaching Film Notes + Optional Amazon Nova Film Brief */}
              <div className="flex-1 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-white">Trench Film Notes</h3>
                  <button
                    onClick={requestPlayBrief}
                    disabled={briefLoading}
                    className="rounded-lg bg-indigo-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-400 disabled:opacity-50"
                  >
                    {briefLoading ? 'Analyzing...' : 'Nova Film Brief'}
                  </button>
                </div>
                <ul className="mt-2.5 space-y-2 text-xs text-slate-300">
                  {tracking.physicsSummary.coachingNotes.map((n, i) => (
                    <li key={i} className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 leading-relaxed">
                      {n}
                    </li>
                  ))}
                </ul>
                {brief && (
                  <div className="mt-3 rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-3">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                      {brief.source === 'amazon_nova' ? 'Amazon Nova Pro Film Brief' : 'Analytical Engine Brief'}
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-slate-200">
                      {brief.brief}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Play Library Browser (Filtered across all 8,557 plays) */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">
            Browse Filtered Plays ({filteredPlays.length} shown — click any row to load 10Hz tracking)
          </h3>
        </div>
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-950 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2">Game</th>
                <th className="px-2 py-2">Situation</th>
                <th className="px-2 py-2">Front</th>
                <th className="px-2 py-2">Result</th>
                <th className="px-3 py-2">Play Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredPlays.map((p) => {
                const isSel = activeKey?.gameId === p.gameId && activeKey?.playId === p.playId
                return (
                  <tr
                    key={`${p.gameId}-${p.playId}`}
                    onClick={() => setActiveKey({ gameId: p.gameId, playId: p.playId })}
                    className={`cursor-pointer transition ${isSel ? 'bg-emerald-500/15' : 'hover:bg-slate-800/50'}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-white">
                      Wk {p.week} · {p.offense} vs {p.defense}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-300">
                      Q{p.quarter} {p.gameClock} · {p.down}&amp;{p.yardsToGo}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-amber-300">
                      {p.n_blockers}v{p.n_rushers} ({p.n_dt_rushers} DT{p.has_stunt ? ' · SW' : ''})
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-bold">
                      <span className={p.passResult === 'S' ? 'text-rose-400' : p.passResult === 'C' ? 'text-emerald-400' : 'text-slate-300'}>
                        {p.passResult} ({p.playResult}y)
                      </span>
                    </td>
                    <td className="max-w-md truncate px-3 py-2 text-slate-400">{p.description}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
