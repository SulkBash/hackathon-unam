import { useEffect, useState } from 'react'
import ExecutivePlaybook from './components/ExecutivePlaybook'
import PlayersLabView from './components/PlayersLabView'
import TeamGameplanView from './components/TeamGameplanView'
import TrenchFilmRoom from './components/TrenchFilmRoom'
import type { OverviewData, PlayersData, PlaySummary } from './types'

type TabId = 'playbook' | 'gameplan' | 'players' | 'film'

export default function App() {
  const [tab, setTab] = useState<TabId>('playbook')
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [players, setPlayers] = useState<PlayersData | null>(null)
  const [selectedTeam, setSelectedTeam] = useState('MIN')
  const [selectedPlay, setSelectedPlay] = useState<{ gameId: number; playId: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('api/overview').then((r) => {
        if (!r.ok) throw new Error(`Overview API ${r.status}`)
        return r.json() as Promise<OverviewData>
      }),
      fetch('api/players').then((r) => {
        if (!r.ok) throw new Error(`Players API ${r.status}`)
        return r.json() as Promise<PlayersData>
      }),
    ])
      .then(([ov, pl]) => {
        setOverview(ov)
        setPlayers(pl)
      })
      .catch((err) => setError(String(err)))
  }, [])

  function handleSelectTeam(team: string) {
    setSelectedTeam(team)
    setTab('gameplan')
  }

  function handleWatchPlay(play: PlaySummary) {
    setSelectedPlay({ gameId: play.gameId, playId: play.playId })
    setTab('film')
  }

  return (
    <div className="min-h-screen bg-[#060a13] text-slate-100">
      {/* Top Broadcast War-Room Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#060a13]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-black text-slate-950 shadow-lg shadow-emerald-500/20">
              TG
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-white">TRENCH GRAVITY</h1>
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  NFL Big Data Bowl · UNAM
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                The Double-Team Paradox &amp; 10Hz Pass-Rush Physics for NFL Coaches
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap gap-1.5">
            {(
              [
                ['playbook', '1. Executive Playbook'],
                ['gameplan', '2. 32-Team Gameplan'],
                ['players', '3. Gravity & Poise Lab'],
                ['film', '4. 10Hz Trench Film Room'],
              ] as [TabId, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  tab === id
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-6 text-sm text-rose-200">
            <div className="font-bold">Could not load analytics API</div>
            <p className="mt-1 text-xs text-rose-300">{error}</p>
          </div>
        ) : !overview || !players ? (
          <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/50">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            <div className="text-sm font-semibold text-slate-300">
              Analyzing 8,557 NFL pass plays &amp; 188,254 PFF trench matchups...
            </div>
          </div>
        ) : (
          <>
            {tab === 'playbook' && (
              <ExecutivePlaybook
                data={overview}
                onSelectTeam={handleSelectTeam}
                onOpenFilmRoom={() => setTab('film')}
              />
            )}
            {tab === 'gameplan' && (
              <TeamGameplanView
                selectedTeam={selectedTeam}
                teams={overview.team_matrix}
                onSelectTeam={setSelectedTeam}
                onWatchPlay={handleWatchPlay}
              />
            )}
            {tab === 'players' && <PlayersLabView data={players} onSelectTeam={handleSelectTeam} />}
            {tab === 'film' && <TrenchFilmRoom initialPlay={selectedPlay} teams={overview.team_matrix} />}
          </>
        )}
      </main>

      <footer className="border-t border-slate-900 py-4 text-center text-[11px] text-slate-500">
        Trench Gravity · NFL 2021 Weeks 1–8 Tracking &amp; PFF Scouting Analytics · Built for UNAM NFL Big Data Bowl 2026
      </footer>
    </div>
  )
}
