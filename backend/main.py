"""Trench Gravity — Hackathon NFL Big Data Bowl UNAM API.

Ejecuta en desarrollo:
  Windows: .\\.venv\\Scripts\\uvicorn backend.main:app --reload
  macOS/Linux: .venv/bin/uvicorn backend.main:app --reload
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

import logging

from backend.analytics import DATA_DIR, TrenchAnalytics
from backend.bedrock_coach import generate_coach_brief

# La Guerra de los 3.5 Segundos (PLAN §2): módulos nuevos, importados con protección para que la app
# siga sirviendo /health y la API v1 aunque alguno falle.
log = logging.getLogger("guerra")
try:
    from backend.guerra import build_guerra
except Exception:  # noqa: BLE001
    log.exception("No se pudo importar backend.guerra")
    build_guerra = None  # type: ignore[assignment]
try:
    from backend.guerra_players import build_getoff_leaders, build_qb_clocks, play_extras, team_extras
except Exception:  # noqa: BLE001
    log.exception("No se pudo importar backend.guerra_players")
    build_getoff_leaders = build_qb_clocks = play_extras = team_extras = None  # type: ignore[assignment]
try:
    from backend.showcase import build_showcase, enrich_play, retag_featured
except Exception:  # noqa: BLE001
    log.exception("No se pudo importar backend.showcase")
    build_showcase = enrich_play = retag_featured = None  # type: ignore[assignment]


def cargar_env() -> None:
    f = Path(__file__).resolve().parent.parent / ".env"
    if f.exists():
        for linea in f.read_text(encoding="utf-8-sig").splitlines():
            linea = linea.strip()
            if linea and not linea.startswith("#") and "=" in linea:
                k, v = linea.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


cargar_env()

_engine: TrenchAnalytics | None = None


def get_engine() -> TrenchAnalytics:
    global _engine
    if _engine is None:
        _engine = TrenchAnalytics()
    return _engine


_cache: dict[str, Any] = {}


def _cached(key: str, fn: Any) -> Any:
    """Calcula una vez y guarda en memoria (el servidor es efímero: nada se escribe en disco)."""
    if key not in _cache:
        try:
            _cache[key] = fn()
        except Exception:  # noqa: BLE001
            log.exception("Falló el cálculo de %s", key)
            _cache[key] = None
    return _cache[key]


def get_guerra() -> dict[str, Any] | None:
    return _cached("guerra", lambda: build_guerra(get_engine())) if build_guerra else None


def get_qb_clocks() -> dict[str, Any] | None:
    return _cached("qb_clocks", lambda: build_qb_clocks(get_engine())) if build_qb_clocks else None


def get_getoff_leaders() -> list[dict[str, Any]]:
    res = _cached("getoff_leaders", lambda: build_getoff_leaders(get_engine())) if build_getoff_leaders else None
    return res or []


def get_showcase() -> list[dict[str, Any]] | None:
    return _cached("showcase", lambda: build_showcase(get_engine())) if build_showcase else None


def team_context(team_abbr: str) -> dict[str, Any]:
    """Plan de juego v1 + campos de la Guerra (PLAN §2.5), sin las métricas descartadas por la auditoría."""
    engine = get_engine()
    gp = dict(engine.get_team_gameplan(team_abbr))
    team = gp["team"]
    off = dict(gp["offense"])
    off.pop("stunt_pressure_allowed_rate", None)
    # % de pases completos con intentos como denominador: C / (C + I + IN)
    op = engine.pm[(engine.pm["possessionTeam"] == team)]
    att = int(op["passResult"].isin(["C", "I", "IN"]).sum())
    off["comp_rate"] = round(100.0 * int((op["passResult"] == "C").sum()) / att, 1) if att else 0.0
    gp["offense"] = off
    dfn = dict(gp["defense"])
    for k in ("third_long_blitz_sack_rate", "stunt_pressure_rate"):
        dfn.pop(k, None)
    dfn["top_rushers"] = [
        {k: v for k, v in r.items() if k not in ("dt_rate", "tm_press_when_dt")} for r in dfn.get("top_rushers", [])
    ]
    gp["defense"] = dfn
    if team_extras:
        try:
            gp.update(team_extras(engine, team, get_qb_clocks() or {}, get_guerra()))
        except Exception:  # noqa: BLE001
            log.exception("Falló team_extras para %s", team)
    if retag_featured:
        gp["featured_plays"] = retag_featured(gp.get("featured_plays", []), team)
    return gp


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Precarga los CSV y todos los agregados al arrancar para que cada llamada sea instantánea
    if (DATA_DIR / "plays.csv").exists():
        get_engine()
        get_guerra()
        get_qb_clocks()
        get_getoff_leaders()
        get_showcase()
    yield


app = FastAPI(title="Trench Gravity — Hackathon NFL UNAM", lifespan=lifespan)


class CoachBriefRequest(BaseModel):
    mode: str  # "team" | "play"
    team: str | None = None
    gameId: int | None = None
    playId: int | None = None
    question: str = ""


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/status")
def api_status() -> dict[str, Any]:
    files = sorted(
        p.name for p in DATA_DIR.iterdir()
        if p.is_file() and not p.name.startswith(".")
    ) if DATA_DIR.exists() else []
    return {"status": "ok", "data_files": files}


@app.get("/api/overview")
def api_overview() -> dict[str, Any]:
    return get_engine().get_overview()


@app.get("/api/guerra")
def api_guerra() -> dict[str, Any]:
    data = get_guerra()
    if data is None:
        raise HTTPException(status_code=503, detail="El análisis principal no está disponible")
    return data


@app.get("/api/qb-clocks")
def api_qb_clocks() -> dict[str, Any]:
    data = get_qb_clocks()
    if data is None:
        raise HTTPException(status_code=503, detail="Los relojes de QB no están disponibles")
    return data


@app.get("/api/players")
def api_players() -> dict[str, Any]:
    data = dict(get_engine().get_players())
    # "Gravity" y "poise" de v1 se descartaron (no se repiten entre mitades de temporada / % de completos mal calculado)
    data.pop("defenders", None)
    data.pop("qbs", None)
    data["getoff_leaders"] = get_getoff_leaders()
    return data


@app.get("/api/team/{team_abbr}")
def api_team(team_abbr: str) -> dict[str, Any]:
    try:
        return team_context(team_abbr)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/plays")
def api_plays(
    team: str | None = Query(default=None),
    category: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
) -> dict[str, Any]:
    engine = get_engine()
    if category in ("cliff", "play_action"):
        # Categorías nuevas (PLAN §2.7): se filtran con el ttt precalculado y la bandera de play action
        sub = engine.pm
        if team:
            t = team.upper()
            sub = sub[(sub["possessionTeam"] == t) | (sub["defensiveTeam"] == t)]
        if category == "play_action":
            sub = sub[sub["is_play_action"] == 1]
        sub = sub.sort_values(["is_sack", "total_pressures", "playResult"], ascending=[False, False, False])
        plays = [enrich_play(engine._format_play_summary(r)) if enrich_play else engine._format_play_summary(r) for _, r in sub.iterrows()]
        if category == "cliff":
            plays = [p for p in plays if (p.get("ttt") or 0) > 3.5]
        res = {"showcase": [], "plays": plays[:limit]}
    elif category == "double_team_trap":
        res = {"showcase": [], "plays": []}  # afirmación descartada (artefacto aritmético)
    else:
        res = dict(engine.list_plays(team=team, category=category, limit=limit))
        if enrich_play:
            res["plays"] = [enrich_play(p) for p in res.get("plays", [])]
    showcase = get_showcase()
    res["showcase"] = showcase if showcase is not None else []
    return res


@app.get("/api/play/{game_id}/{play_id}/tracking")
def api_play_tracking(game_id: int, play_id: int) -> dict[str, Any]:
    try:
        data = dict(get_engine().get_play_tracking(game_id, play_id))
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    # PLAN §2.6: ttt, endEvent y get-off por rusher; sin "rusher libre" (afirmación descartada)
    if play_extras:
        try:
            ex = play_extras(game_id, play_id)
            play = dict(data["play"])
            play["ttt"] = ex.get("ttt")
            play["endEvent"] = ex.get("endEvent")
            play.pop("n_free_rushers", None)
            data["play"] = play
            go = ex.get("getoff") or {}
            data["roster"] = [{**r, "getoff": go.get(int(r["nflId"]))} for r in data.get("roster", [])]
        except Exception:  # noqa: BLE001
            log.exception("Falló play_extras para %s/%s", game_id, play_id)
    phys = dict(data.get("physicsSummary", {}))
    phys.pop("freeRushers", None)
    data["physicsSummary"] = phys
    return data


@app.post("/api/coach-brief")
def api_coach_brief(req: CoachBriefRequest) -> dict[str, Any]:
    engine = get_engine()
    if req.mode == "team":
        if not req.team:
            raise HTTPException(status_code=400, detail="team is required for mode='team'")
        try:
            ctx = team_context(req.team)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return generate_coach_brief("team", ctx, question=req.question)
    if req.mode == "play":
        if req.gameId is None or req.playId is None:
            raise HTTPException(status_code=400, detail="gameId and playId are required for mode='play'")
        ctx = api_play_tracking(req.gameId, req.playId)
        return generate_coach_brief("play", ctx, question=req.question)
    raise HTTPException(status_code=400, detail="mode must be 'team' or 'play'")
