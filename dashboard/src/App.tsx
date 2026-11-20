import { useEffect, useState } from 'react'
import ExecutivePlaybook from './components/ExecutivePlaybook'
import Glossary from './components/Glossary'
import PlayersLabView from './components/PlayersLabView'
import TeamGameplanView from './components/TeamGameplanView'
import TrenchFilmRoom from './components/TrenchFilmRoom'
import type { GuerraData, OverviewData, PlayersData, PlaySummary, QbClocksData } from './types'

type TabId = 'reloj' | 'plan' | 'jugadores' | 'video' | 'glosario'

const TABS: [TabId, string][] = [
  ['reloj', '1. El Reloj'],
  ['plan', '2. Plan de Juego (32 equipos)'],
  ['jugadores', '3. Laboratorio de Jugadores'],
  ['video', '4. Sala de Video 10 Hz'],
  ['glosario', 'Cómo leer esto'],
]

// Jugada real del hero (identificadores, no estadísticas): DAL @ TB, semana 1 de 2021. Ver campo/jugadaDemo.ts.
const DEMO_PLAY = { gameId: 2021090900, playId: 2279 }

/** Carga una ruta relativa de la API (sin diagonal inicial) y reporta el error en español. */
function useApi<T>(path: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch(path)
      .then((r) => {
        if (!r.ok) throw new Error(`${path} respondió ${r.status}`)
        return r.json() as Promise<T>
      })
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [path])
  return { data, error }
}

function Pendiente({ error, que }: { error: string | null; que: string }) {
  if (error) {
    return (
      <div className="border-t border-slate-800 pt-10">
        <h2 className="text-[28px] text-pintura">No se pudo cargar {que}</h2>
        <p className="mt-2 text-[15px] text-slate-400">{error}</p>
      </div>
    )
  }
  return (
    <div className="space-y-6 pt-6">
      <div className="tg-skeleton h-12 w-1/2" />
      <div className="tg-skeleton h-[320px] w-full" />
      <div className="tg-skeleton h-40 w-full" />
    </div>
  )
}

function tabFromHash(): TabId {
  const h = window.location.hash.replace('#', '')
  return (TABS.find(([id]) => id === h)?.[0] ?? 'reloj') as TabId
}

export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [selectedTeam, setSelectedTeam] = useState('MIN')
  const [selectedPlay, setSelectedPlay] = useState<{ gameId: number; playId: number } | null>(null)

  const overview = useApi<OverviewData>('api/overview')
  const players = useApi<PlayersData>('api/players')
  const guerra = useApi<GuerraData>('api/guerra')
  const qbClocks = useApi<QbClocksData>('api/qb-clocks')
  const teams = overview.data?.team_matrix ?? []

  function goTo(next: TabId) {
    setTab(next)
    // Hash relativo (sin diagonal inicial): funciona en la subruta de AWS y permite enlazar cada pestaña
    if (window.location.hash !== `#${next}`) window.history.replaceState(null, '', `#${next}`)
    window.scrollTo({ top: 0 })
  }

  function handleSelectTeam(team: string) {
    setSelectedTeam(team)
    goTo('plan')
  }

  function handleWatchPlay(play: PlaySummary) {
    setSelectedPlay({ gameId: play.gameId, playId: play.playId })
    goTo('video')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-pintura">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-x-10 px-5 2xl:flex-row 2xl:items-end 2xl:justify-between">
          <div className="pt-4 2xl:pb-4">
            <h1 className="text-[22px] leading-tight text-pintura">La Guerra de los 3.5 Segundos</h1>
            <p className="text-[14px] text-slate-400">Cómo ganar (o robar) décimas de segundo en cada pase. NFL 2021, semanas 1–8.</p>
          </div>
          <nav role="tablist" aria-label="Secciones" className="-mb-px flex flex-wrap gap-x-7 overflow-x-auto">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className="tg-tab whitespace-nowrap" onClick={() => goTo(id)}>
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <div key={tab} className="tg-enter">
          {tab === 'reloj' && (
            <ExecutivePlaybook
              data={guerra.data}
              error={guerra.error}
              teams={teams}
              qbClocks={qbClocks.data}
              teamStability={overview.data?.team_matrix_stability}
              onSelectTeam={handleSelectTeam}
              onWatchDemo={() => {
                setSelectedPlay(DEMO_PLAY)
                goTo('video')
              }}
            />
          )}
          {tab === 'plan' && (
            <TeamGameplanView
              selectedTeam={selectedTeam}
              teams={teams}
              onSelectTeam={setSelectedTeam}
              onWatchPlay={handleWatchPlay}
              qbClocks={qbClocks.data}
            />
          )}
          {tab === 'jugadores' &&
            (players.data ? (
              <PlayersLabView data={players.data} qbClocks={qbClocks.data} guerra={guerra.data} onSelectTeam={handleSelectTeam} />
            ) : (
              <Pendiente error={players.error} que="el laboratorio de jugadores" />
            ))}
          {tab === 'video' && <TrenchFilmRoom initialPlay={selectedPlay} teams={teams} />}
          {tab === 'glosario' && <Glossary />}
        </div>
      </main>

      <footer className="border-t border-slate-800 py-6">
        <div className="mx-auto max-w-7xl px-5 text-[13px] text-slate-400">
          La Guerra de los 3.5 Segundos. Datos del NFL Big Data Bowl: temporada 2021, semanas 1–8, tracking a 10 Hz y scouting de
          PFF. Hackathon UNAM.
        </div>
      </footer>
    </div>
  )
}
