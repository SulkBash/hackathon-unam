# DESIGN.md: dirección visual "El campo"

> Para los agentes que implementan `PLAN.md`. No se versiona todavía; **borrar antes de `--entregar`**.
> Idea central: la interfaz está hecha del material del juego (césped, pintura blanca y las líneas virtuales de la transmisión) y mide el tiempo como si fueran yardas. La línea amarilla de los 3.5 s es la única protagonista.

## 1. Qué trae el parche `tg-campo` (no lo reimplementes)

| Archivo | Qué hace |
|---|---|
| `dashboard/tailwind.config.js` | Remapea `slate` a verdes de césped nocturno: las clases `slate-*` existentes se re-visten solas. Agrega `pintura`, `linea` (amarillo), `azul`, `precipicio`, `cesped` y `font-cifra`. Radios chicos (2–8 px). |
| `dashboard/src/index.css` | Barlow (texto) + Alfa Slab One (solo cifras grandes, como los números pintados del campo), títulos en altas y bajas, `.tg-tab`, `.tg-btn-*`, `.tg-cifra`, `.tg-enter`, `.tg-skeleton`. |
| `dashboard/src/campo/` | `TimeField` (el campo del tiempo), `Trails` (rutas reales como curvas suaves), `usePlayhead`, `useInView`, `curva`, `JUGADA_DEMO` (jugada real 2279: Barrett captura a Prescott a los 5.3 s). |

## 2. Color: cada color tiene un trabajo y nada más

| Token | Hex | Trabajo |
|---|---|---|
| `slate-950` / `cesped-noche` | #0c2219 | Fondo. |
| `slate-900` / `cesped` | #113024 | Superficies, franja de podado A. |
| `cesped-claro` | #143829 | Franja de podado B. |
| `pintura` / `slate-50` | #f2f4ee | Texto principal, líneas del campo, barras neutras (a 30%). |
| `slate-300` | #a9bcb1 | Texto secundario. `slate-400` (#8aa094) para notas y fuentes. |
| `linea` | #ffd43b | **Solo**: la línea de 3.5 s, el tab activo y la acción principal (una por vista). |
| `azul` | #4a8af4 | Línea de golpeo, QB, ofensiva. |
| `precipicio` | #f0525a | Lo que pasa después de 3.5 s y el rusher que llega. |

- No uses `emerald`, `cyan`, `indigo` ni `violet`, ni degradados o sombras de color. Si el plan pide "verde/ámbar/rojo" para el reloj del pocket, usa `pintura` antes de 3.5 s y `precipicio` después: la línea amarilla ya separa las zonas.
- Azul y rojo están validados como par para daltonismo (ΔE 23 con protanopia) y ambos cumplen 3:1 sobre `cesped`.

## 3. Tipografía y texto

- Títulos: Barlow 600, en altas y bajas, una idea por título (`text-[56px] leading-[1.04]` en el hero, `text-[28px]` en secciones). Sin mayúsculas forzadas, sin itálicas, sin resaltar una palabra con color.
- Cifras grandes: `tg-cifra` (Alfa Slab One). Nada de texto corrido en esa fuente.
- Cuerpo: 16–19 px, `slate-300`, máximo ~65 caracteres por línea.
- **Sin etiquetas encima de los títulos** (eyebrows), sin rótulos en mayúsculas con tracking, sin cadenas "A · B · C", sin monoespaciadas para datos, sin flechas en botones.
- El título de cada gráfica dice el hallazgo ("Pasados los 3.5 s, el sack se triplica"), no el nombre de la métrica. Debajo, una línea en `slate-400` con la fuente y la `n`.

## 4. Estructura

- Sin tarjetas para todo: las secciones se separan con espacio y una línea `border-t border-slate-800`. Cajas solo donde agrupan algo que se manipula (filtros, tabla).
- Retícula de 12 columnas con proporciones desiguales (5+7, 4+8). Contenido alineado a la izquierda.
- Header: nombre del proyecto a la izquierda y pestañas `tg-tab` en texto; sin logo, sin badges, sin metadatos.
- Nada de filas de 4 KPI iguales. Las cifras clave viven en el campo del tiempo, ancladas al segundo donde ocurren.

## 5. Movimiento: un solo momento orquestado

- **El momento:** en el hero, `usePlayhead` corre la jugada de −0.3 a 5.3 s una vez al entrar en pantalla. `Trails` dibuja las rutas reales y `TimeField` hace crecer cada barra cuando el balón pasa por su tramo. La línea amarilla se pinta al cruzar 3.5 s. Con `prefers-reduced-motion` todo aparece en su estado final.
- Todo lo demás es estático. Se permite movimiento solo como respuesta a una acción: cambio de pestaña (`<div key={tab} className="tg-enter">`), tooltip, filtro.
- Curvas: `--tg-ease` (entrar) y `--tg-ease-draw` (dibujar líneas).

```tsx
import { TimeField, Trails, usePlayhead, useInView } from './campo'

const { ref, visto } = useInView<HTMLDivElement>(0.2)
const t = usePlayhead({ from: -0.3, to: 5.3, duration: 4600, run: visto })
<main ref={ref}>
  <Trails t={t} height={400} />
  <TimeField t={t} buckets={cliff.map(toBucket)} markers={[{ t: 0.75, label: 'El rusher promedio arranca' }, { t: 2.7, label: 'Lanzamiento promedio' }]} />
</main>
```

`buckets` sale de `/api/guerra.cliff` (sack % por tramo de tiempo hasta el lanzamiento). Valores de referencia que calculé hoy con `backend/precomputed/tracking_plays.csv` + `plays.csv` (8,533 jugadas): ≤2.0 s 0.2% · 2.0–2.5 0.6% · 2.5–3.0 2.1% · 3.0–3.5 5.1% · 3.5–4.0 13.2% · 4.0–5.0 23.4% · >5.0 21.2%.

## 6. Sala de Video

- Reloj del pocket: `<TimeField t={segundosDesdeSnap} compact endAt={play.ttt} endLabel="Lanzamiento" />` debajo del campo, a todo el ancho. Es el mismo lenguaje que el hero.
- Campo: fondo `cesped`, líneas `pintura` al 22%, línea de golpeo `azul`, primera y 10 `linea`. Ofensiva `azul`, defensiva `pintura` con número en `cesped-noche`, rusher enfocado con anillo `precipicio`. Bloqueo doble como línea `pintura` al 45%.
- Telemetría: no uses dos ejes Y con unidades distintas; van dos gráficas chicas que comparten el eje X y las líneas de 3.5 s y de lanzamiento.

## 7. Recharts

```ts
export const TG = { grid: '#1b382d', axis: '#8aa094', text: '#f2f4ee', neutral: 'rgba(242,244,238,0.3)', line: '#ffd43b', blue: '#4a8af4', red: '#f0525a', tooltipBg: '#143829', tooltipBorder: '#5a7566' }
// <CartesianGrid stroke={TG.grid} vertical={false} />  <XAxis tick={{ fill: TG.axis, fontSize: 13 }} tickLine={false} axisLine={{ stroke: TG.grid }} />
// Barras neutras en TG.neutral; solo la barra que cuenta el hallazgo va en TG.red (o TG.line si es la selección).
```
