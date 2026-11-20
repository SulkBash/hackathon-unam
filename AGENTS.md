# AGENTS.md: Hackathon NFL Big Data Bowl, UNAM

Instrucciones para cualquier asistente de IA que trabaje en este repositorio (Claude Code, Codex, Cursor, Copilot, Gemini, Kiro, etc.).

> Fuente oficial de las reglas: [.kiro/steering/rules.md](.kiro/steering/rules.md) (copia del evento en [.hackathon/rules.md](.hackathon/rules.md)). Las secciones "Reglas del proyecto" de abajo las reproducen tal cual. Si cambian allá, actualiza este archivo.

## Comandos rápidos

| Tarea | Windows (PowerShell) | macOS / Linux |
|---|---|---|
| Instalar entorno | `.\.hackathon\setup.cmd` | `sh .hackathon/setup.sh` |
| Backend (dev, puerto 8000) | `.\.venv\Scripts\uvicorn backend.main:app --reload` | `.venv/bin/uvicorn backend.main:app --reload` |
| Dashboard (dev) | `cd dashboard; npm run dev` | `cd dashboard && npm run dev` |
| Build del dashboard | `cd dashboard; npm run build` | `cd dashboard && npm run build` |
| Verificar entorno y reglas | `.\.hackathon\setup.cmd --check` | `sh .hackathon/setup.sh --check` |
| Generar zip de entrega | `.\.hackathon\setup.cmd --entregar` | `sh .hackathon/setup.sh --entregar` |

En el navegador abre siempre `http://localhost:...`, no `127.0.0.1`.

## Mapa del repositorio

- `backend/main.py`: la app FastAPI (`app`), `GET /health`, endpoints bajo `/api/...` y el cargador de `.env`.
- `backend/analytics.py`: motor de análisis (`TrenchAnalytics`): carga CSVs al arrancar y calcula todos los agregados en memoria.
- `backend/bedrock_coach.py`: resumen opcional con Amazon Nova + respaldo determinista (la app funciona sin IA).
- `backend/pipeline/build_tracking_features.py`: script reproducible que recorre los 122 archivos de tracking (811 MB, ~1–2 min) y genera `backend/precomputed/`. Se corre a mano: `.\.venv\Scripts\python -m backend.pipeline.build_tracking_features`.
- `backend/precomputed/`: `tracking_plays.csv` (ttt, endEvent por jugada) y `tracking_rushers.csv` (getoff, s05, strain, dmin, t2 por rusher y jugada). Solo lectura en tiempo de ejecución; se versionan.
- `dashboard/`: React + Vite + TS + Tailwind 3 + Recharts. `vite.config.ts` ya tiene `base: './'` y el proxy de `/api`.
- `data/`: datos del evento, **solo lectura**: `games.csv`, `plays.csv`, `players.csv`, `pffScoutingData.csv`, `tracking/tracking_<gameId>.csv` (122 juegos, 10 Hz, del snap al final del dropback + ~0.5 s). Están en `.gitignore` (no se versionan), así que muchas herramientas de búsqueda no los listan: ábrelos directamente por su ruta. El zip de `--entregar` sí los incluye.
- `docs/`: capturas que usa el README.
- `PLAN.md` (temporal, si existe): plan de implementación por etapas con contrato de API. **Se borra antes de `--entregar`.**
- `README.md`: lo primero que leen los jueces (hallazgo principal, audiencia, captura).
- `.hackathon/`, `.kiro/`, `.venv/`: no se mueven ni se modifican.

---

# Contexto del equipo: objetivo y estándar de evidencia

## Objetivo

**Ganar el hackathon.** El equipo no tiene experiencia en NFL; el producto debe convencer a jueces que quizá tampoco la tengan, y resistir a un juez que sí sepa estadística o fútbol americano. Un solo dato falso o inflado le cuesta credibilidad a todo lo demás, así que **cada número que se muestre debe estar verificado con los datos**.

**Tesis: "La Guerra de los 3.5 Segundos".** Cada pase es una carrera entre dos relojes: el del quarterback y el de los pass rushers. Cada hallazgo es una forma de ganar (ofensiva) o robar (defensiva) décimas de segundo, traducida a resultados.

**Audiencia:** coordinadores defensivos y ofensivos, y jugadores. Todo texto visible (dashboard y README) va **en español**, con un glosario "Cómo leer esto" para quien no conoce la NFL. Los identificadores de código quedan en inglés.

## Estándar de evidencia (obligatorio antes de mostrar cualquier afirmación)

1. **Ningún número escrito a mano en la UI ni en el README**: todo sale de código que calcula sobre `data/` o `backend/precomputed/` (vía la API). Si un número del README cambia, se vuelve a correr el cálculo.
2. **Compara lo comparable.** Antes de afirmar un efecto, controla los confusores obvios:
   - **Situación:** compara a la misma `yardsToGo` exacta dentro del mismo down (no por rangos amplios). Ejemplo real: el blitz en 3ro y 7+ parecía dar +10 pts de conversiones; a la misma distancia son +4.2.
   - **Tiempo de lanzamiento:** muchas cosas "pasan" en jugadas largas solo porque son largas. Compara dentro de la misma franja de `ttt`.
   - **Jugador:** para métricas de jugador, compara al jugador contra su propio promedio (efectos fijos), no entre jugadores.
   - **Equipo:** un "efecto de jugador" puede ser del equipo (ej. dos jugadores de BUF arriba en un ranking).
3. **Estabilidad:** una métrica de jugador o equipo solo se muestra si se repite entre semanas 1–4 y 5–8 (correlación entre mitades). Referencia: get-off 0.79 (sí), presión propia 0.32 (moderada; ≥60 snaps por mitad, n=101), % de jugadas del QB > 3.5 s 0.64 (sí), get-off promedio de una defensa 0.36 (solo "tendencia"), caída del QB después de 3.5 s −0.13 (no), "gravity" −0.12 (no), vulnerabilidad de equipo a stunts 0.15 (no).
4. **Busca artefactos de definición:** si el resultado sale "100%" o "siempre", probablemente es aritmético. PFF solo registra el **primer** defensor que bloquea cada bloqueador (`pff_nflIdBlockedPlayer`), así que en stunts aparecen "dobles" y "rusher libre" falsos.
5. **Muestra el tamaño de muestra** (`n`) y marca en gris lo que tenga n < 50.
6. **Reporta el número ajustado, no el crudo**, cuando difieran.
7. **Etiqueta la confianza:** 🟢 robusto / 🟡 moderado. Lo que no pase estos filtros va a **"Lo que descartamos"** (los jueces valoran ver hipótesis rechazadas).

## Definiciones (úsalas exactamente)

- **Presión (jugada):** algún rusher con `pff_hit|pff_hurry|pff_sack == 1`. **Presión (rusher):** lo mismo por fila.
- **Éxito:** 1er down `playResult >= 0.4*yardsToGo`; 2do `>= 0.6*yardsToGo`; 3ro/4to `>= yardsToGo`. **Conversión:** `playResult >= yardsToGo`. **Jugada grande:** `prePenaltyPlayResult >= 20`. Excluye `down == 0` (35 intentos de 2 puntos con `yardsToGo` 0: éxito 100% por construcción) de todo cálculo de éxito o situación.
- **Situación (cuidado):** el éxito depende del down (1ro 54.7%, 2do 49.8%, 3ro 39.5%) porque la vara cambia. Todo lo que se use más en un down que en otro (play action, blitz) se compara a la misma down y `yardsToGo` exacta.
- **% de pases completos:** C / (C + I + IN). Nunca contar sacks ni scrambles como incompletos.
- **Blitz:** 5+ rushers. **Stunt:** la jugada tiene algún `pff_blockType == "SW"`.
- **Duelo perdido (bloqueador):** hitAllowed, hurryAllowed, sackAllowed o beatenByDefender == 1.
- **ttt (tiempo de lanzamiento):** del snap a pass_forward / qb_sack / qb_strip_sack / run / fumble.
- **Get-off:** segundos tras el snap hasta que el rusher se movió 1 yarda. Comparar **dentro del grupo**: Edge = DE·OLB (~0.75 s), Interior = DT·NT (~0.83 s).
- Las etiquetas de `pff_blockType` siguen `README_DATA.md` (PU = recogida del RB, UP = jalón, CL = segundo nivel, SR = set & release, etc.).

## Hallazgos verificados (NFL 2021, semanas 1–8, 8,557 dropbacks, 36,263 snaps de rusher con tracking)

| Hallazgo | Evidencia | Confianza |
|---|---|---|
| La presión decide la jugada | Éxito 57.2% → 34.4%; completos 67.8% → 46.6% | 🟢 |
| Zona de peligro después de 3.5 s (umbral, no precipicio) | Sacks: 5.1% (3.0–3.5 s) → 13.2% (3.5–4 s) → 23.4% (4–5 s): el riesgo se multiplica ~2.4× cada medio segundo (pasos de 0.5 s entre 2.0 y 4.5 s: ×3.3, ×2.5, ×2.6, ×1.6). El éxito cae de forma continua (~7 pts por segundo; un quiebre en 3.5 s no mejora significativamente a una recta: F=2.9, p≈0.09). Jugadas grandes máximas en 3.0–3.5 s (14.8%) | 🟢 |
| El get-off gana | Mismo jugador: 0.3 s antes que su mediana → 21.3% de presión; 0.3 s después → 7.4%. ~0.9 pts por cada 0.1 s sobre una base de 11.0% (todos los snaps de DL). Robusto: 0.7–1.2 pts con controles de down × distancia, franja de ttt, play action, blitz/stunt y compañeros en el mismo snap (z ≥ 7.4 con errores agrupados por jugador; z ≥ 6.0 agrupando por juego). Con controles: Edge 1.6 (z 11.3) vs Interior 0.8 (z 6.3); solo dentro del jugador: Edge 1.1 vs Interior 0.6. Se sostiene en 3ro y 7+ y en el resto. Estabilidad 0.79 | 🟢 |
| El play action es el arma de la jugada grande | A la misma down y `yardsToGo` exacta: jugadas grandes 13.6% vs 7.7% (1.8×); éxito igual (54.1% vs 54.0%); más presión (37.8% vs 30.5%) y sacks (6.5% vs 4.2%) porque el amague cuesta ~0.8 s (1ro y 10: ttt mediano 3.4 vs 2.6). Congela a cada rusher 0.12 s (mismo jugador y situación; crudo 0.14). Se usa en 23.8% de los pases. Con rollout los sacks bajan: 2.7% (PA + rollout diseñado, 10 de 365) vs 7.3% (PA sin rollout). Verificado con 3 métodos (estratificado, MCO con efectos fijos, bootstrap): jugadas grandes z 6.7, presión z 5.4, éxito −0.2 (ee 1.4) | 🟢 |
| El blitz depende del down | A la misma `yardsToGo`: 1ro/2do −2.3 pts de éxito rival; 3ro/4to y 1–3 −5.2; 4–6 −1.4; 3ro/4to y 7+ **+4.5** conversiones, con más sacks (9.5% → 15.1%). Cada celda sola no es significativa; el cambio entre 1ro/2do y 3ro y 7+ está en el límite (diferencia 6.7 pts, z≈2.0, p≈0.05). Se usa más justo en 3ro y largo (30% vs 22%) | 🟡 |
| Rush de 4 con stunt: tendencia a favor de la defensa | A la misma down y `yardsToGo` exacta, vs rush de 4 sin stunt: 4 con stunt −1.8 pts de éxito rival (ee 1.5, no significativo); blitz sin stunt −3.5 (ee 1.5, z 2.3); blitz con stunt +2.3 (ee 2.3). (El "−2.4, IC −4.8 a −0.1" anterior usaba rangos de distancia y un ee demasiado chico: descartado.) En 3ro/4to y 7+ (vs 29.4% de conversión, n=541): 4 con stunt −4.6 (ee 3.1); blitz sin stunt −0.7 (ee 4.1); blitz con stunt +4.7 (ee 4.4). Ninguno es significativo solo: mostrar como "muestra chica" | 🟡 |
| Cuánto sostiene el balón cada QB | % de dropbacks > 3.5 s por QB se repite entre mitades (0.64; ttt mediano 0.50). Liga (sin intentos de 2 puntos): 25.5% de los pases pasan de 3.5 s; éxito 52.8% antes vs 35.9% después | 🟢 |
| Eslabones débiles en protección | RB recogiendo blitz (PU) pierde 26.0% vs 13.8% de la línea (PP, solo T/G/C). En jugadas de blitz, RB a la ruta vs RB bloqueando (misma down y distancia): éxito +4.0 (ee 2.4), sacks −1.8 (ee 1.2): no concluyente, solo dice que mandarlo a la ruta no empeora. El chip no ayuda (n=81 en blitz, éxito 43.2%) | 🟡 |
| Carril débil de la línea por equipo | Se repite entre mitades en 12 de 32 equipos (~2× azar): mostrar como "tendencia" con `n` | 🟡 |

## Descartado (no mostrar como hallazgo; sí en "Lo que descartamos")

- **"2 dobles en 5 contra 4 = rusher libre 100%"**: aritmética (0 de 781 jugadas podían salir distinto); 53% son stunts mal registrados por la regla del primer bloqueo.
- **"Trench Gravity" / estrellas invisibles** (Lotulelei, Zimmer, Vea): correlación entre mitades −0.12; BUF presionaba 41% con Lotulelei fuera.
- **"Blitz en 3ro y largo = golpe de gracia"**: da más sacks pero también más conversiones.
- **"Rollout a la derecha: 6.4× menos sacks"**: escogido a conveniencia (izquierda 5.4%). Lo defendible es rollouts diseñados de ambos lados: 2.5% vs 6.7% (y dentro del play action: 2.7% vs 7.3%).
- **"El play action sube el éxito de 47% a 54%"**: artefacto de down (40% de los pases de 1ro son PA vs 4% en 3ro, y en 1ro la vara es más baja). A la misma down y distancia: 54.1% vs 54.0%. "Misma presión" también es crudo: ajustado, PA tiene +7.3 pts de presión.
- **"Cada QB tiene su propio reloj"** (Mayfield 57→19 vs Prescott 55→57): la caída por QB no se repite entre mitades (−0.14): no se distingue del ruido.
- **"Tackles 40–80 lb más pesados pierden más (15.0% vs 6.5% de duelos perdidos)"**: confusión por tipo de rusher (el grupo "tackle igual o más ligero" es 14% edges; el de 40–80 lb, 96%). Con el mismo rusher, un tackle más pesado pierde *menos* (−0.9 pts por +10 lb, z −3.3 agrupando por rusher): importa quién hace el rush (ligero = edge = mejor pasador de presión), no el peso del tackle.
- **"La 3.5 s es un precipicio"**: no hay quiebre significativo (F=2.9, p≈0.09); es un umbral útil en una curva continua.
- **"Presión fantasma"** (rusher a 2–3 yd sin presión baja el % de completos: 64.9% vs 71.0%): dentro de la misma franja de ttt baja a −2.6 pts (ee 1.5, no significativo).
- **Fatiga del rusher**: la presión *sube* con los snaps (sesgo de selección: las estrellas juegan más).
- **Ruido del estadio**: efecto mínimo.
- **Vulnerabilidad de un equipo a stunts**: no se repite entre mitades (0.15).

## Reglas de trabajo del equipo

- Usa `PLAN.md` (si existe) como fuente de verdad para el trabajo en curso: decisiones cerradas, contrato de API, horarios, lista de recortes. No reabras decisiones cerradas sin datos nuevos.
- Si propones un hallazgo nuevo, verifícalo con el estándar de arriba **antes** de escribirlo en la UI o el README, y reporta el número ajustado, `n` y la confianza.
- Las métricas de la sala de video (radio del pocket, velocidad de cierre, alerta de colapso) se miden solo hasta `t <= ttt`; el tracking sigue ~0.5 s después del lanzamiento.
- Antes de entregar: `--check` en `TODO OK`, `npm run build` sin errores, sin rutas con `/` inicial, `PLAN.md` borrado, README en español con captura.

---

# Reglas del proyecto

Estas reglas aplican a todo lo que generes en este proyecto. Si una petición las contradice, dilo y propón la alternativa dentro del stack.

Si el equipo declara explícitamente que se sale del stack, ignora todas las secciones de estas reglas: Stack fijo, Estructura y despliegue, IA opcional con servicios AWS y Entrega.

Estas reglas solo cubren el stack y el despliegue. El enfoque, el análisis, los datos y la calidad del trabajo son decisión del equipo.

## Stack fijo

| Capa | Versión |
|---|---|
| Python / uv | 3.12.12 / 0.11.19 |
| Backend | FastAPI 0.115.14, Uvicorn 0.34.3, Pydantic 2.11.7 |
| Datos | pandas 2.2.3, numpy 2.1.3 |
| Pruebas (opcionales) | pytest 8.3.5, httpx 0.28.1 |
| Node / npm | 22.23.1 / 10.x |
| Frontend | React 18.3.1, Vite 5.4.21, TypeScript 5.7.3, Tailwind CSS 3.4.19, Recharts 3.10.1 |
| IA (opcional) | strands-agents 1.64.0, boto3 1.44.0 |

- No agregues dependencias, no cambies versiones, no uses otros frameworks (Streamlit, Flask, Django, Next.js, Plotly Dash, notebooks como app, etc.) ni Docker. Si algo no se puede hacer con este stack, dilo y propón la alternativa dentro de él.
- Si el equipo decide salirse del stack, el equipo asume que AWS no hospedará su aplicación. Puede publicarla por su cuenta y bajo su propio riesgo, o no publicarla y subir solo el código. Avísale esto de forma breve antes de apartarte del stack, sin insistir.
- Python siempre dentro de `.venv`. Tailwind es la versión 3: no uses la sintaxis de Tailwind 4 (`@import "tailwindcss"`, `@theme`, `@tailwindcss/vite`).

## Estructura y despliegue

AWS hospeda la aplicación y la despliega tal cual, así que respeta este contrato:

- `backend/` contiene el código Python. `backend/main.py` expone `app` (FastAPI) con `GET /health` que responde `{"status": "ok"}`. Toda la API va bajo `/api/...`.
- `dashboard/` contiene el frontend. El build es `vite build` y genera `dashboard/dist`. El servidor sirve ese build y la API en la misma URL y puerto.
- El dashboard llama a la API con rutas relativas **sin diagonal inicial**: `fetch('api/<ruta>')`, nunca `fetch('/api/<ruta>')` (`<ruta>` es el nombre de tu endpoint). Tu app se publica en una subruta (`/evento/equipo/`) y con la diagonal inicial la llamada falla con 404. Esto aplica a toda ruta que escribas en el código del dashboard (imágenes, CSS, enlaces), no solo a `fetch`. Nunca uses `localhost`, `127.0.0.1` ni URLs absolutas.
- En desarrollo, Vite y Uvicorn corren por separado. Configura en `vite.config.ts` un proxy de `/api` hacia `http://localhost:8000`, y conserva `base: './'`.
- `data/` contiene los datos. Léelos con rutas relativas a la raíz del proyecto. Es solo lectura: no modifiques los archivos originales.
- El servidor es efímero: no dependas de escribir archivos en disco para que la app funcione. Calcula al arrancar o al responder.
- No cambies la estructura de carpetas ni muevas `.hackathon/`, `.venv/` ni `.kiro/`.

## IA opcional con servicios AWS

- La IA es opcional. Dentro del stack se usa solo Amazon Bedrock, con modelos Amazon Nova, mediante Strands Agents y boto3. Si el equipo prefiere otro proveedor (OpenAI, Gemini, etc.), aplica la regla de salirse del stack: AWS no lo hospeda y la llave del proveedor es responsabilidad del equipo.
- El hosting ya define `BEDROCK_MODEL_ID` y las credenciales vienen del rol: no uses llaves en el código. **No leas, no verifiques ni exijas `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` ni `AWS_SESSION_TOKEN`** (ni devuelvas un error si faltan) y no pases llaves a boto3: crea el cliente solo con la región, `boto3.client("bedrock-runtime", region_name=region)`. En AWS el rol de la tarea firma las llamadas; en tu computadora boto3 toma las llaves del `.env` por sí solo. Lee el modelo con `os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")` y la región con `os.environ.get("AWS_REGION", "us-east-1")`. No pongas otros IDs de modelo.
- En tu computadora, las llamadas a Bedrock usan las llaves temporales del workshop, que van en un archivo `.env` en la raíz del proyecto (hay un `.env.example` para copiar) con `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_SESSION_TOKEN`. No agregues `python-dotenv` ni otra dependencia: al inicio de `backend/main.py`, antes de usar boto3, carga el `.env` con este código y nada más:
  ```python
  import os
  from pathlib import Path

  def cargar_env():
      f = Path(__file__).resolve().parent.parent / ".env"
      if f.exists():
          for linea in f.read_text(encoding="utf-8-sig").splitlines():
              linea = linea.strip()
              if linea and not linea.startswith("#") and "=" in linea:
                  k, v = linea.split("=", 1)
                  os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

  cargar_env()
  ```
- `.env` no se versiona y `--entregar` no lo incluye en el .zip. Nunca escribas llaves ni credenciales en el código ni en el README, y no imprimas ni registres credenciales. En el despliegue AWS asigna el rol y no se usan llaves.
- La app debe funcionar y mostrar su hallazgo principal aunque la IA falle o no esté disponible. La IA añade funciones, no sostiene el análisis.
- No crees ni llames otros servicios de AWS (S3, DynamoDB, Lambda, etc.). La infraestructura la pone AWS.

## Entrega

- Para verificar el entorno: `sh .hackathon/setup.sh --check`. Para generar el zip de entrega: `sh .hackathon/setup.sh --entregar`. En Windows: `.\.hackathon\setup.cmd --check` (o `--entregar`; en CMD omite el `.\` inicial).
