# Hackathon NFL Big Data Bowl — UNAM

> **TODO (día de la competencia):** Reemplaza esta introducción con el nombre de tu equipo, el hallazgo principal, para quién es útil, cómo interpretarlo y al menos una captura o visualización (`![Vista previa](ruta/imagen.png)`). Los jueces leen este `README.md` primero.

## Hallazgo principal

_Pendiente de completar durante la competencia._

## Audiencia objetivo

_¿Para quién es este análisis y qué decisión ayuda a tomar?_

## Estructura del proyecto

```text
hackathon-unam/
├── backend/       # API en Python (FastAPI, Uvicorn, Pydantic, pandas, numpy)
├── dashboard/     # Frontend en React + Vite + TypeScript + Tailwind CSS 3 + Recharts
├── data/          # Datos del evento (solo lectura; leer con rutas relativas)
├── .kiro/         # Reglas del proyecto para asistentes (.kiro/steering/rules.md)
├── .hackathon/    # Scripts de instalación, validación y entrega (no modificar)
└── .env.example   # Plantilla de variables de entorno para desarrollo local
```

## Stack fijo del evento

| Capa | Herramientas y versiones |
|---|---|
| Python / gestor | Python 3.12.12 / uv 0.11.19 |
| Backend | FastAPI 0.115.14, Uvicorn 0.34.3, Pydantic 2.11.7 |
| Datos | pandas 2.2.3, numpy 2.1.3 |
| Pruebas (opcionales) | pytest 8.3.5, httpx 0.28.1 |
| Node / npm | Node 22.23.1 / npm 10.x |
| Frontend | React 18.3.1, Vite 5.4.21, TypeScript 5.7.3, Tailwind CSS 3.4.19, Recharts 3.10.1 |
| IA (opcional) | Amazon Bedrock (Amazon Nova) via `strands-agents` 1.64.0 y `boto3` 1.44.0 |

Consulta [.hackathon/rules.md](.hackathon/rules.md) y [.hackathon/INSTALACION.md](.hackathon/INSTALACION.md) para los detalles completos de las reglas del stack y despliegue.

## Configuración local (para clonar el repositorio)

1. Instala el entorno aislado (`.venv`, Node portátil y `node_modules`) desde la raíz del proyecto:
   - **Windows (PowerShell / CMD):**
     ```powershell
     .\.hackathon\setup.cmd
     ```
   - **macOS / Linux:**
     ```bash
     sh .hackathon/setup.sh
     ```

2. _(Opcional, solo si usas Amazon Bedrock localmente)_ Copia `.env.example` a `.env` y agrega las credenciales temporales del workshop. Nunca subas `.env` al repositorio.

3. Ejecuta el backend y el dashboard en terminales separadas:
   - **Backend (Windows):**
     ```powershell
     .\.venv\Scripts\uvicorn backend.main:app --reload
     ```
   - **Backend (macOS / Linux):**
     ```bash
     .venv/bin/uvicorn backend.main:app --reload
     ```
   - **Dashboard:**
     ```bash
     cd dashboard
     npm run dev
     ```
   Abre siempre `http://localhost:...` en el navegador (no `127.0.0.1`).

## Reglas clave de despliegue

- El backend expone `app` en `backend/main.py` con `GET /health` (`{"status": "ok"}`) y todos los endpoints bajo `/api/...`.
- El frontend llama a la API usando **rutas relativas sin diagonal inicial** (`fetch('api/...')`, nunca `fetch('/api/...')`) y conserva `base: './'` en `dashboard/vite.config.ts`.
- No agregues dependencias ni archivos Docker si deseas que AWS hospede tu aplicación.

## Validación y entrega

- **Validar entorno y reglas:**
  - Windows: `.\.hackathon\setup.cmd --check`
  - macOS / Linux: `sh .hackathon/setup.sh --check`
- **Generar el `.zip` de entrega:**
  - Windows: `.\.hackathon\setup.cmd --entregar`
  - macOS / Linux: `sh .hackathon/setup.sh --entregar`
