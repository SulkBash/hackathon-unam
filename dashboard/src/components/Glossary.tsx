// "Cómo leer esto" (PLAN §3.6): glosario de una línea por término para quien no conoce la NFL.
// Solo definiciones; ninguna estadística escrita a mano.

const TERMS: [string, string][] = [
  ['Pase / dropback', 'Cada jugada en la que el quarterback retrocede para lanzar. Analizamos solo estas jugadas.'],
  ['Quarterback (QB)', 'El jugador que recibe el balón al inicio y decide a quién lanzarlo.'],
  ['Pocket', 'La bolsa de protección que forma la línea ofensiva alrededor del QB.'],
  ['Pass rusher', 'El defensor que corre hacia el QB para presionarlo o derribarlo.'],
  ['Presión', 'Golpe, apuro o sack sobre el QB.'],
  ['Sack', 'Derribar al QB con el balón antes de que lance.'],
  ['Get-off', 'Cuánto tarda el rusher en arrancar tras el snap: segundos hasta que se movió 1 yarda.'],
  ['Tiempo de lanzamiento', 'Segundos desde el snap hasta que el QB suelta el balón, es capturado o sale corriendo.'],
  ['Blitz', 'Mandar 5 o más rushers (lo normal es 4).'],
  ['Stunt', 'Dos rushers cruzan carriles para confundir a los bloqueadores.'],
  ['Play action', 'Fingir una carrera antes de pasar.'],
  ['Rollout', 'Jugada diseñada para que el QB salga del pocket hacia un lado antes de lanzar.'],
  ['Éxito', 'Ganar 40% de la distancia en 1er down, 60% en 2do y 100% en 3ro o 4to.'],
  ['Conversión', 'Ganar todas las yardas que faltaban para el primer down.'],
  ['3er down y largo', 'Tercer intento con 7 o más yardas por avanzar.'],
  ['Jugada grande', 'Un pase que gana 20 yardas o más.'],
  ['Duelo perdido', 'El bloqueador permitió golpe, apuro o sack, o fue superado por su rival.'],
  ['Edge e Interior', 'Edge: rushers de las orillas (DE y OLB). Interior: los del centro (DT y NT), que chocan con un bloqueador casi de inmediato.'],
]

const RULES: [string, string][] = [
  ['🟢 Robusto', 'El efecto se sostiene con controles de situación, al comparar al jugador contra sí mismo y entre mitades de temporada.'],
  ['🟡 Moderado', 'La dirección es clara pero la muestra es chica o la significancia está en el límite. Úsalo como tendencia.'],
  ['Ajustado por down y distancia', 'Comparamos contra jugadas en el mismo down y con las mismas yardas por avanzar, porque el éxito depende de la vara.'],
  ['n', 'Cuántas jugadas o snaps hay detrás de cada número. Lo que tiene menos de 50 aparece en gris.'],
]

export default function Glossary() {
  return (
    <div className="space-y-14 pb-10 pt-6">
      <div className="grid grid-cols-12 gap-x-10 gap-y-6">
        <div className="col-span-12 lg:col-span-5">
          <h2 className="text-[44px] leading-[1.04] text-pintura">Cómo leer esto</h2>
          <p className="mt-5 text-[19px] leading-relaxed text-slate-300">
            No necesitas saber de fútbol americano. Cada pase es una carrera: el QB necesita tiempo para lanzar y los rushers
            quieren quitárselo. Todo lo que verás es una forma de ganar o robar décimas de segundo.
          </p>
          <p className="mt-5 text-[17px] leading-relaxed text-slate-300">
            Piensa en el fútbol: el get-off es el arranque del delantero al espacio; el play action es el amague.
          </p>
        </div>
        <dl className="col-span-12 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 lg:col-span-7">
          {TERMS.map(([term, def]) => (
            <div key={term} className="border-t border-slate-800 pt-3">
              <dt className="text-[17px] font-semibold text-pintura">{term}</dt>
              <dd className="mt-1 text-[15px] leading-relaxed text-slate-300">{def}</dd>
            </div>
          ))}
        </dl>
      </div>

      <section className="border-t border-slate-800 pt-10">
        <h3 className="text-[28px] text-pintura">Cómo decidimos qué mostrar</h3>
        <p className="mt-2 max-w-3xl text-[15px] text-slate-400">
          Cada número sale de un cálculo sobre los datos del evento: tracking a 10 Hz de las semanas 1–8 de la temporada 2021 y el
          scouting de PFF. Lo que no pasó estos filtros está en "Lo que descartamos", al final de El Reloj.
        </p>
        <dl className="mt-6 grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2">
          {RULES.map(([term, def]) => (
            <div key={term} className="border-t border-slate-800 pt-3">
              <dt className="text-[17px] font-semibold text-pintura">{term}</dt>
              <dd className="mt-1 text-[15px] leading-relaxed text-slate-300">{def}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
