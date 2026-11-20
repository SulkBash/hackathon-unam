"""Relojes de QB, líderes de get-off, extras por equipo y por jugada (PLAN §2.3–2.6).

"La Guerra de los 3.5 Segundos": todo se calcula al vuelo en pandas sobre data/ (vía el motor
TrenchAnalytics) y los features de tracking precalculados en backend/precomputed/ (solo lectura).
Las salidas usan únicamente tipos de Python (sin numpy ni NaN) para que FastAPI las serialice.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

PRE_DIR = Path(__file__).resolve().parent / "precomputed"

DL_POSITIONS = {"DE", "OLB", "DT", "NT"}
EDGE_POSITIONS = {"DE", "OLB"}
LATE_T = 3.5  # umbral de la zona de peligro (s)
MIN_QB_DROPBACKS = 150
MIN_DL_SNAPS = 150
MIN_HALF_DROPBACKS = 60

LANE_ES = {
    "LT": "del tackle izquierdo",
    "LG": "del guardia izquierdo",
    "C": "del centro",
    "RG": "del guardia derecho",
    "RT": "del tackle derecho",
}

# Eventos del tracking que terminan el dropback; 'autoevent_passforward' es el mismo lanzamiento.
END_EVENT_CANON = {"autoevent_passforward": "pass_forward"}


# ---------------------------------------------------------------------------- helpers
def _r(val: Any, digits: int = 1) -> float | None:
    """Redondea a float de Python; None si no hay dato."""
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if np.isnan(f) or np.isinf(f):
        return None
    return round(f, digits)


def _f1(val: float | None) -> str:
    return "–" if val is None else f"{val:.1f}"


def _signed(val: float | None) -> str:
    if val is None:
        return "–"
    s = f"{abs(val):.1f}"
    if float(s) == 0:
        return s
    return f"+{s}" if val > 0 else f"−{s}"


@lru_cache(maxsize=1)
def _trk_plays() -> pd.DataFrame:
    f = PRE_DIR / "tracking_plays.csv"
    if not f.exists():
        return pd.DataFrame(columns=["gameId", "playId", "ttt", "endEvent"])
    return pd.read_csv(f)


@lru_cache(maxsize=1)
def _trk_rush() -> pd.DataFrame:
    f = PRE_DIR / "tracking_rushers.csv"
    if not f.exists():
        return pd.DataFrame(columns=["gameId", "playId", "nflId", "getoff", "s05", "strain", "dmin", "t2"])
    return pd.read_csv(f)


_CACHE: dict[tuple[int, str], Any] = {}


def _cached(engine: Any, key: str, build: Callable[[], Any]) -> Any:
    k = (id(engine), key)
    if k not in _CACHE:
        _CACHE[k] = build()
    return _CACHE[k]


def _dropbacks(engine: Any) -> pd.DataFrame:
    """Una fila por dropback con ttt (tracking) y éxito (NaN en intentos de 2 puntos, down == 0)."""

    def build() -> pd.DataFrame:
        cols = ["gameId", "playId", "week", "possessionTeam", "defensiveTeam", "down", "yardsToGo",
                "playResult", "qb_nflId", "qb_name", "is_play_action"]
        pm = engine.pm[cols].copy()
        pm = pm.merge(_trk_plays()[["gameId", "playId", "ttt", "endEvent"]], on=["gameId", "playId"], how="left")
        d, ytg, pr = pm["down"], pm["yardsToGo"], pm["playResult"]
        need = np.where(d == 1, 0.4 * ytg, np.where(d == 2, 0.6 * ytg, ytg))
        pm["success"] = (pr >= need).astype(float)
        pm.loc[d == 0, "success"] = np.nan
        return pm

    return _cached(engine, "dropbacks", build)


def _dl_rows(engine: Any) -> pd.DataFrame:
    """Snaps de DL con get-off: DE/OLB/DT/NT, getoff no nulo y < 2 s (PLAN, definiciones)."""

    def build() -> pd.DataFrame:
        r = engine.rush[["gameId", "playId", "nflId", "pressure", "sack", "defensiveTeam"]]
        t = _trk_rush()[["gameId", "playId", "nflId", "getoff", "strain"]]
        m = r.merge(t, on=["gameId", "playId", "nflId"], how="inner")
        m = m.merge(engine.players[["nflId", "officialPosition", "displayName"]], on="nflId", how="left")
        m = m[m["officialPosition"].isin(DL_POSITIONS) & m["getoff"].notna() & (m["getoff"] < 2)].copy()
        m["group"] = np.where(m["officialPosition"].isin(EDGE_POSITIONS), "Edge", "Interior")
        return m

    return _cached(engine, "dl", build)


def _mode(s: pd.Series) -> Any:
    vc = s.value_counts()
    return vc.index[0] if len(vc) else None


# ---------------------------------------------------------------------------- §2.3 relojes de QB
def build_qb_clocks(engine: Any) -> dict[str, Any]:
    """% de dropbacks > 3.5 s por QB (rasgo estable) y ttt mediano. Nunca el éxito antes/después por QB (ruido)."""

    def build() -> dict[str, Any]:
        db = _dropbacks(engine)
        x = db[db["ttt"].notna() & (db["down"] > 0)].copy()
        x["late"] = (x["ttt"] > LATE_T).astype(float)
        s_early = x.loc[x["late"] == 0, "success"].mean() * 100
        s_late = x.loc[x["late"] == 1, "success"].mean() * 100
        league = {
            "late_share": _r(x["late"].mean() * 100),
            "success_early": _r(s_early),
            "success_late": _r(s_late),
            "drop": _r(s_early - s_late),
            "ttt_median": _r(x["ttt"].median()),
            "plays": int(len(x)),
        }

        xq = x[x["qb_nflId"].notna()]
        agg = xq.groupby("qb_nflId").agg(
            plays=("ttt", "size"),
            ttt_median=("ttt", "median"),
            late_share=("late", "mean"),
            name=("qb_name", "first"),
        )
        agg["team"] = xq.groupby("qb_nflId")["possessionTeam"].agg(_mode)
        agg = agg[agg["plays"] >= MIN_QB_DROPBACKS].sort_values("late_share", ascending=False)
        qbs = [
            {
                "nflId": int(qid),
                "name": str(row["name"]),
                "team": str(row["team"]),
                "plays": int(row["plays"]),
                "ttt_median": _r(row["ttt_median"]),
                "late_share": _r(row["late_share"] * 100),
            }
            for qid, row in agg.iterrows()
        ]

        # Estabilidad: correlación entre semanas 1–4 y 5–8 (QBs con 60+ dropbacks en cada mitad)
        h = xq.assign(half=np.where(xq["week"] <= 4, 1, 2))
        per = h.groupby(["qb_nflId", "half"]).agg(n=("ttt", "size"), late=("late", "mean"), med=("ttt", "median")).unstack("half")
        ok = (per[("n", 1)] >= MIN_HALF_DROPBACKS) & (per[("n", 2)] >= MIN_HALF_DROPBACKS)
        per = per[ok]
        stability = {
            "late_share": _r(per[("late", 1)].corr(per[("late", 2)]), 2) if len(per) > 2 else None,
            "ttt_median": _r(per[("med", 1)].corr(per[("med", 2)]), 2) if len(per) > 2 else None,
            "qbs": int(len(per)),
        }
        return {"league": league, "qbs": qbs, "stability": stability}

    return _cached(engine, "qb_clocks", build)


# ---------------------------------------------------------------------------- §2.4 líderes de get-off
def build_getoff_leaders(engine: Any) -> list[dict[str, Any]]:
    """DL con 150+ snaps; getoff_score 0–100 (min-max de −getoff) SIEMPRE dentro de su grupo (Edge / Interior)."""

    def build() -> list[dict[str, Any]]:
        m = _dl_rows(engine)
        agg = m.groupby("nflId").agg(
            snaps=("getoff", "size"),
            getoff_avg=("getoff", "mean"),
            strain_avg=("strain", "mean"),
            pressure_rate=("pressure", "mean"),
            sacks=("sack", "sum"),
            name=("displayName", "first"),
            position=("officialPosition", "first"),
            group=("group", "first"),
        )
        agg["team"] = m.groupby("nflId")["defensiveTeam"].agg(_mode)
        agg = agg[agg["snaps"] >= MIN_DL_SNAPS].copy()
        agg["getoff_score"] = 50.0
        for _, sub in agg.groupby("group"):
            lo, hi = sub["getoff_avg"].min(), sub["getoff_avg"].max()
            if hi > lo:
                agg.loc[sub.index, "getoff_score"] = (hi - sub["getoff_avg"]) / (hi - lo) * 100
        agg = agg.sort_values("getoff_score", ascending=False)
        return [
            {
                "nflId": int(pid),
                "name": str(row["name"]),
                "team": str(row["team"]),
                "position": str(row["position"]),
                "group": str(row["group"]),
                "snaps": int(row["snaps"]),
                "getoff_avg": _r(row["getoff_avg"], 2),
                "strain_avg": _r(row["strain_avg"], 2),
                "pressure_rate": _r(row["pressure_rate"] * 100),
                "sacks": int(row["sacks"]),
                "getoff_score": int(round(float(row["getoff_score"]))),
            }
            for pid, row in agg.iterrows()
        ]

    return _cached(engine, "getoff_leaders", build)


# ---------------------------------------------------------------------------- §2.5 extras por equipo
def _guerra_hints(guerra: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    """Pistas de liga (no por equipo): 3ro y 7+ para la defensa; play action y corredor para la ofensiva."""
    defense: list[str] = []
    offense: list[str] = []
    if not guerra:
        return defense, offense

    blitz = guerra.get("blitz") or {}
    flip = blitz.get("flip") or {}
    third_long = flip.get("third_long")
    early = flip.get("early")
    plans = (blitz.get("third_long_plans") or {}).get("vs_base") or []
    stunt = next((p for p in plans if "4 con stunt" in str(p.get("plan", "")).lower()), None)
    if third_long is not None and third_long > 0:
        txt = (
            f"En 3er down y 7+, el blitz da más sacks pero no baja las conversiones "
            f"(a la misma distancia permite ~{_f1(third_long)} pts más)."
        )
        best = min(plans, key=lambda p: p.get("adj_delta", 0)) if plans else None
        if stunt and stunt.get("adj_delta") is not None and stunt["adj_delta"] < 0 and best is stunt:
            txt += f" Ahí, el rush de 4 con stunt fue la mejor opción ({_signed(stunt['adj_delta'])} pts, muestra chica)."
        if early is not None and early < 0:
            txt += " Guarda el blitz para 1ro/2do y 3ro corto."
        defense.append(txt)

    pa = guerra.get("play_action") or {}
    if pa.get("big_pa") is not None and pa.get("big_expected") is not None:
        same = (
            pa.get("success_pa") is not None
            and pa.get("success_expected") is not None
            and abs(pa["success_pa"] - pa["success_expected"]) < 2
        )
        txt = (
            f"Play action para la jugada grande: en la liga, a la misma down y distancia, da {_f1(pa['big_pa'])}% "
            f"de jugadas de 20+ yardas vs {_f1(pa['big_expected'])}%{' (mismo éxito)' if same else ''}."
        )
        if (pa.get("pressure_pa") or 0) > (pa.get("pressure_expected") or 0) and pa.get("pa_rollout_sack") is not None:
            txt += f" Cuesta presión; con rollout los sacks bajan a {_f1(pa['pa_rollout_sack'])}%."
        if pa.get("pa_rate") is not None:
            txt += f" La liga lo usa en solo {_f1(pa['pa_rate'])}% de los pases."
        offense.append(txt)

    prot = guerra.get("protection") or []
    pu = next((p for p in prot if "(PU)" in str(p.get("label", "")) or "PU" in str(p.get("label", ""))), None)
    pp = next((p for p in prot if "(PP)" in str(p.get("label", "")) or "PP" in str(p.get("label", ""))), None)
    if pu and pp and pu.get("lost") is not None and pp.get("lost") is not None and pu["lost"] > pp["lost"]:
        offense.append(
            f"No dejes al corredor solo recogiendo blitz: pierde {_f1(pu['lost'])}% de sus duelos "
            f"(la línea, {_f1(pp['lost'])}%). Mandarlo a la ruta contra blitz no empeora el resultado."
        )
    return defense, offense


def team_extras(
    engine: Any,
    team: str,
    qb_clocks: dict[str, Any] | None,
    guerra: dict[str, Any] | None = None,
    gameplan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Reloj del QB del equipo, get-off de su defensa (tendencia), uso de play action y pistas en español."""
    team = team.upper()
    league = (qb_clocks or {}).get("league") or {}
    db = _dropbacks(engine)
    off = db[db["possessionTeam"] == team]

    qb_clock: dict[str, Any] | None = None
    offt = off[off["ttt"].notna() & (off["down"] > 0) & off["qb_nflId"].notna()]
    if len(offt):
        top = offt["qb_nflId"].value_counts().index[0]
        q = offt[offt["qb_nflId"] == top]
        qb_clock = {
            "qb": str(q["qb_name"].iloc[0]),
            "nflId": int(top),
            "plays": int(len(q)),
            "late_share": _r((q["ttt"] > LATE_T).mean() * 100),
            "ttt_median": _r(q["ttt"].median()),
            "league_late_share": league.get("late_share"),
            "league_ttt_median": league.get("ttt_median"),
            "league_drop": league.get("drop"),
        }

    dl = _dl_rows(engine)
    team_go = dl.loc[dl["defensiveTeam"] == team, "getoff"]
    def_getoff_avg = _r(team_go.mean(), 2) if len(team_go) else None
    league_getoff_avg = _r(dl["getoff"].mean(), 2) if len(dl) else None
    pa_rate = _r(off["is_play_action"].mean() * 100) if len(off) else None

    attack: list[str] = []
    gp = gameplan if gameplan is not None else engine.get_team_gameplan(team)
    wl = ((gp or {}).get("offense") or {}).get("weakest_lane")
    if wl and wl.get("total_snaps"):
        lane = str(wl.get("lane", ""))
        sacks = int(wl.get("sacks_allowed", 0))
        attack.append(
            f"Ataca el carril {LANE_ES.get(lane, lane)} ({lane}, {wl.get('starter', '—')}): permitió presión en "
            f"{_f1(_r(wl.get('pressure_allowed_rate')))}% de {int(wl['total_snaps']):,} bloqueos "
            f"({sacks} {'sack' if sacks == 1 else 'sacks'}). Tendencia de 8 semanas."
        )
    if qb_clock and qb_clock["late_share"] is not None:
        lg_late = league.get("late_share")
        if lg_late is not None and qb_clock["late_share"] >= lg_late:
            attack.append(
                f"Su QB {qb_clock['qb']} sostiene el balón más de 3.5 s en {_f1(qb_clock['late_share'])}% de sus pases "
                f"(liga: {_f1(lg_late)}%). Pasado ese punto los QB de la liga pierden ~{_f1(league.get('drop'))} pts de "
                f"éxito: cubre largo, rush de 4 con stunt y oblígalo a esperar."
            )
        else:
            attack.append(
                f"Su QB {qb_clock['qb']} suelta rápido (mediana {_f1(qb_clock['ttt_median'])} s; solo "
                f"{_f1(qb_clock['late_share'])}% pasa de 3.5 s): no apuestes a la cobertura larga, gana con get-off."
            )
    def_hints, off_hints = _guerra_hints(guerra)
    attack.extend(def_hints)

    return {
        "qb_clock": qb_clock,
        "def_getoff_avg": def_getoff_avg,
        "league_getoff_avg": league_getoff_avg,
        "pa_rate": pa_rate,
        "attack_this_oline": attack,
        "beat_this_defense": off_hints,
    }


# ---------------------------------------------------------------------------- §2.6 extras de la Sala de Video
@lru_cache(maxsize=1)
def _play_index() -> tuple[dict[tuple[int, int], tuple[float | None, str | None]], dict[tuple[int, int], dict[int, float]]]:
    plays: dict[tuple[int, int], tuple[float | None, str | None]] = {}
    for g, p, t, e in _trk_plays()[["gameId", "playId", "ttt", "endEvent"]].itertuples(index=False):
        ev = str(e) if pd.notna(e) else None
        plays[(int(g), int(p))] = (_r(t), END_EVENT_CANON.get(ev, ev) if ev else None)
    rush: dict[tuple[int, int], dict[int, float]] = {}
    for g, p, n, go in _trk_rush()[["gameId", "playId", "nflId", "getoff"]].itertuples(index=False):
        if pd.notna(go):
            rush.setdefault((int(g), int(p)), {})[int(n)] = round(float(go), 2)
    return plays, rush


def play_extras(game_id: int, play_id: int) -> dict[str, Any]:
    """ttt y evento que terminó el dropback, y el get-off de cada rusher en esta jugada."""
    plays, rush = _play_index()
    ttt, end_event = plays.get((int(game_id), int(play_id)), (None, None))
    return {"ttt": ttt, "endEvent": end_event, "getoff": dict(rush.get((int(game_id), int(play_id)), {}))}
