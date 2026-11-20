// "Cómo leer esto" (PLAN §3.6): glosario de una línea por término para quien no conoce la NFL.
// Solo definiciones; ninguna estadística escrita a mano.

const TERMS: [string, string][] = [
  ['Pase / dropback', 'Jugada en la que el quarterback retrocede para lanzar. Todo el análisis cubre únicamente estas jugadas.'],
  ['Quarterback (QB)', 'Jugador que recibe el balón al inicio de la jugada y decide el pase.'],
  ['Pocket', 'Zona de protección que forma la línea ofensiva alrededor del QB.'],
  ['Pass rusher', 'Defensor encargado de presionar o derribar al QB.'],
  ['Presión', 'Golpe, apuro (hurry) o sack sobre el QB.'],
  ['Sack', 'Derribo del QB con el balón antes de que logre lanzar.'],
  ['Get-off', 'Segundos desde el snap hasta que el rusher recorre su primera yarda.'],
  ['Tiempo de lanzamiento', 'Segundos desde el snap hasta el pase, sack o carrera del QB.'],
  ['Blitz', 'Enviar 5 o más rushers contra el QB (el estándar son 4).'],
  ['Stunt', 'Cruce de trayectorias entre dos rushers para desajustar el bloqueo.'],
  ['Play action', 'Engaño de carrera antes de retroceder para pasar.'],
  ['Rollout', 'Movimiento diseñado del QB hacia un costado fuera del pocket antes de lanzar.'],
  ['Éxito', 'Ganar al menos 40% de las yardas faltantes en 1er down, 60% en 2do y 100% en 3ro o 4to.'],
  ['Conversión', 'Conseguir todas las yardas necesarias para lograr un nuevo primer down.'],
  ['3er down y largo', 'Tercer intento con 7 o más yardas por avanzar.'],
  ['Jugada grande', 'Jugada de pase que avanza 20 yardas o más.'],
  ['Duelo perdido', 'Bloqueo en el que el liniero fue superado o permitió golpe, apuro o sack.'],
  ['Edge e Interior', 'Edge: rushers exteriores (DE y OLB). Interior: linieros centrales (DT y NT), que enfrentan bloqueo inmediato.'],
]

const RULES: [string, string][] = [
  ['🟢 Robusto', 'Efecto consistente al controlar por situación, comparar al jugador contra sí mismo y verificar estabilidad entre mitades.'],
  ['🟡 Moderado', 'Dirección clara, pero con muestra pequeña o significancia en el límite. Tomar como tendencia.'],
  ['Ajustado por down y distancia', 'Comparación dentro del mismo down y yardas exactas por avanzar, ya que la exigencia cambia en cada situación.'],
  ['n', 'Tamaño de muestra (jugadas o snaps) detrás de cada cifra. Los valores con n < 50 se muestran en gris.'],
]

export default function Glossary() {
  return (
    <div className="space-y-14 pb-10 pt-6">
      <div className="grid grid-cols-12 gap-x-10 gap-y-6">
        <div className="col-span-12 lg:col-span-5">
          <h2 className="text-[44px] leading-[1.04] text-pintura">Cómo leer esto</h2>
          <p className="mt-5 text-[18px] leading-relaxed text-slate-300">
            Guía de términos de NFL y criterios estadísticos usados en el análisis.
          </p>
          <p className="mt-4 text-[16px] leading-relaxed text-slate-400">
            En cada jugada de pase, el quarterback busca tiempo para lanzar mientras la defensa intenta llegar antes. Las
            métricas de este tablero cuantifican cuánto pesan esas décimas de segundo.
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
        <h3 className="text-[28px] text-pintura">Criterios de evidencia</h3>
        <p className="mt-2 max-w-3xl text-[15px] text-slate-400">
          Todas las cifras se calculan sobre el tracking a 10 Hz y PFF Scouting (NFL 2021, semanas 1–8). Las hipótesis que no
          superaron estos filtros aparecen en "Lo que descartamos", al final de El Reloj.
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
