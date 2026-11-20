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

from backend.analytics import DATA_DIR, TrenchAnalytics
from backend.bedrock_coach import generate_coach_brief


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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Preload the 14.8 MB summary CSVs once at server startup so every API call is instant
    if (DATA_DIR / "plays.csv").exists():
        get_engine()
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


@app.get("/api/players")
def api_players() -> dict[str, Any]:
    return get_engine().get_players()


@app.get("/api/team/{team_abbr}")
def api_team(team_abbr: str) -> dict[str, Any]:
    try:
        return get_engine().get_team_gameplan(team_abbr)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/plays")
def api_plays(
    team: str | None = Query(default=None),
    category: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
) -> dict[str, Any]:
    return get_engine().list_plays(team=team, category=category, limit=limit)


@app.get("/api/play/{game_id}/{play_id}/tracking")
def api_play_tracking(game_id: int, play_id: int) -> dict[str, Any]:
    try:
        return get_engine().get_play_tracking(game_id, play_id)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/coach-brief")
def api_coach_brief(req: CoachBriefRequest) -> dict[str, Any]:
    engine = get_engine()
    if req.mode == "team":
        if not req.team:
            raise HTTPException(status_code=400, detail="team is required for mode='team'")
        try:
            ctx = engine.get_team_gameplan(req.team)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return generate_coach_brief("team", ctx, question=req.question)
    if req.mode == "play":
        if req.gameId is None or req.playId is None:
            raise HTTPException(status_code=400, detail="gameId and playId are required for mode='play'")
        try:
            ctx = engine.get_play_tracking(req.gameId, req.playId)
        except (KeyError, FileNotFoundError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return generate_coach_brief("play", ctx, question=req.question)
    raise HTTPException(status_code=400, detail="mode must be 'team' or 'play'")
