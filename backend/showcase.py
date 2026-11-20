"""Jugadas para la Sala de Video (PLAN §2.7), elegidas con datos reales y etiquetadas en español.

Reemplaza la vitrina de v1 (que mostraba afirmaciones descartadas: "gravity", "doble marca deja un rusher libre",
"blitz en 3ro y largo = golpe de gracia"). Usa los features precalculados de backend/precomputed/ (ttt por jugada y
get-off por rusher). Solo lectura; nada se escribe en disco.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

from backend.analytics import TRACKING_DIR

PRE = Path(__file__).resolve().parent / "precomputed"

RESULT_ES = {"C": "pase completo", "I": "pase incompleto", "IN": "intercepción", "S": "sack", "R": "scramble"}
DROPBACK_ES = {
    "TRADITIONAL": "dropback tradicional",
    "SCRAMBLE": "scramble",
    "DESIGNED_ROLLOUT_RIGHT": "rollout diseñado a la derecha",
    "DESIGNED_ROLLOUT_LEFT": "rollout diseñado a la izquierda",
    "SCRAMBLE_ROLLOUT_RIGHT": "scramble a la derecha",
    "SCRAMBLE_ROLLOUT_LEFT": "scramble a la izquierda",
    "DESIGNED_RUN": "carrera diseñada",
}


@lru_cache(maxsize=1)
def _trk_play() -> pd.DataFrame:
    f = PRE / "tracking_plays.csv"
    return pd.read_csv(f) if f.exists() else pd.DataFrame(columns=["gameId", "playId", "ttt", "endEvent"])


@lru_cache(maxsize=1)
def _trk_rush() -> pd.DataFrame:
    f = PRE / "tracking_rushers.csv"
    cols = ["gameId", "playId", "nflId", "getoff"]
    return pd.read_csv(f, usecols=cols) if f.exists() else pd.DataFrame(columns=cols)


@lru_cache(maxsize=1)
def _ttt_index() -> dict[tuple[int, int], tuple[float | None, str | None]]:
    out: dict[tuple[int, int], tuple[float | None, str | None]] = {}
    for g, p, t, e in _trk_play()[["gameId", "playId", "ttt", "endEvent"]].itertuples(index=False):
        out[(int(g), int(p))] = (
            round(float(t), 1) if pd.notna(t) else None,
            ("pass_forward" if str(e) == "autoevent_passforward" else str(e)) if pd.notna(e) else None,
        )
    return out


def ttt_of(game_id: int, play_id: int) -> tuple[float | None, str | None]:
    return _ttt_index().get((int(game_id), int(play_id)), (None, None))


def enrich_play(summary: dict[str, Any]) -> dict[str, Any]:
    """Agrega ttt y endEvent a un resumen de jugada; quita los campos de 'rusher libre' (afirmación descartada)."""
    out = {k: v for k, v in summary.items() if k not in ("n_free_rushers",)}
    ttt, end = ttt_of(out["gameId"], out["playId"])
    out["ttt"] = ttt
    out["endEvent"] = end
    return out


def _with_ttt(pm: pd.DataFrame) -> pd.DataFrame:
    t = _trk_play()[["gameId", "playId", "ttt", "endEvent"]]
    return pm.merge(t, on=["gameId", "playId"], how="left")


def build_showcase(engine: Any) -> list[dict[str, Any]]:
    pm = _with_ttt(engine.pm)
    pm = pm[pm["down"] > 0]
    rush = engine.rush
    getoff = _trk_rush()
    out: list[dict[str, Any]] = []
    used: set[tuple[int, int]] = set()

    def pick(cands: pd.DataFrame, tag: str, headline_fn) -> None:
        for _, row in cands.iterrows():
            key = (int(row["gameId"]), int(row["playId"]))
            if key in used or not (TRACKING_DIR / f"tracking_{key[0]}.csv").exists():
                continue
            used.add(key)
            out.append(enrich_play(engine._format_play_summary(row, tag=tag, headline=headline_fn(row))))
            return

    names = engine.players.set_index("nflId")["displayName"].to_dict()

    # 1. Get-off que gana: sack del rusher que arrancó en <= 0.6 s (preferimos a Garrett o Crosby)
    sacks = rush[rush["sack"] == 1][["gameId", "playId", "nflId"]].merge(getoff, on=["gameId", "playId", "nflId"], how="inner")
    sacks = sacks[sacks["getoff"].notna() & (sacks["getoff"] <= 0.6)].copy()
    sacks["name"] = sacks["nflId"].map(names)
    sacks["pref"] = sacks["name"].isin(["Myles Garrett", "Maxx Crosby"]).astype(int)
    c1 = pm.merge(sacks, on=["gameId", "playId"]).sort_values(["pref", "getoff"], ascending=[False, True])
    pick(c1, "Get-off", lambda r: f"Get-off que gana: {r['name']} arranca en {r['getoff']:.2f} s y llega al QB")

    # 2. Play action congela: PA, sin presión, ttt >= 3.5, completo de 15+ yardas
    c2 = pm[(pm["is_play_action"] == 1) & (pm["had_pressure"] == 0) & (pm["ttt"] >= 3.5) & (pm["passResult"] == "C") & (pm["playResult"] >= 15)]
    pick(c2.sort_values("playResult", ascending=False), "Play action",
         lambda r: f"El play action congela a los rushers: +{int(r['playResult'])} yardas con {r['ttt']:.1f} s para lanzar")

    # 3. Zona de peligro: sack después de 4 s
    c3 = pm[(pm["is_sack"] == 1) & (pm["ttt"] > 4.0) & (pm["ttt"] <= 5.0) & (pm["dropBackType"] == "TRADITIONAL")]
    pick(c3.sort_values("playResult"), "Zona de peligro", lambda r: f"Después de 3.5 s: sack a los {r['ttt']:.1f} s")

    # 4. Rush de 4 con stunt: sack sin blitz
    c4 = pm[(pm["n_rushers"] == 4) & (pm["has_stunt"] == 1) & (pm["is_sack"] == 1) & (pm["ttt"] <= 4.0)]
    pick(c4.sort_values(["ttt", "playResult"]), "Stunt de 4", lambda r: "Rush de 4 con stunt: sack sin mandar blitz")

    # 5. Blitz en 3ro y largo que el rival convierte
    c5 = pm[(pm["down"] >= 3) & (pm["yardsToGo"] >= 7) & (pm["is_blitz"] == 1) & (pm["playResult"] >= pm["yardsToGo"]) & (pm["passResult"] == "C")]
    pick(c5.sort_values("playResult", ascending=False), "Blitz en 3ro y largo",
         lambda r: f"Más sacks, pero también más conversiones: el rival convierte 3ro y {int(r['yardsToGo'])} contra el blitz")

    # 6. Pase rápido vence al blitz: blitz, ttt <= 2.3, completo de 15+ yardas
    c6 = pm[(pm["is_blitz"] == 1) & (pm["ttt"] <= 2.3) & (pm["passResult"] == "C") & (pm["playResult"] >= 15)]
    pick(c6.sort_values("playResult", ascending=False), "Pase rápido",
         lambda r: f"Pase rápido vence al blitz: suelta en {r['ttt']:.1f} s y gana {int(r['playResult'])} yardas")

    # 7. Aaron Donald
    ad = engine.players[engine.players["displayName"] == "Aaron Donald"]["nflId"].tolist()
    if ad:
        ad_s = rush[(rush["nflId"].isin(ad)) & (rush["sack"] == 1)][["gameId", "playId"]].drop_duplicates()
        c7 = pm.merge(ad_s, on=["gameId", "playId"])
        pick(c7.sort_values("playResult"), "Interior", lambda r: "Aaron Donald parte el pocket por el centro")

    # 8. Spotlight NFL México (Vikings / 49ers)
    c8 = pm[(pm["defensiveTeam"].isin(["MIN", "SF"])) & (pm["is_sack"] == 1)]
    pick(c8.sort_values("playResult"), "Spotlight NFL México", lambda r: f"Spotlight NFL México: sack de la defensa de {r['defensiveTeam']}")

    return out


def retag_featured(plays: list[dict[str, Any]], team: str) -> list[dict[str, Any]]:
    """Traduce las jugadas destacadas por equipo de v1 (etiquetas en inglés) y agrega ttt/endEvent."""
    out = []
    for p in plays:
        q = enrich_play(p)
        res = RESULT_ES.get(str(q.get("passResult")), str(q.get("passResult")))
        if q.get("tag") == "DEFENSE FILM":
            q["tag"] = "Su defensa"
            q["headline"] = f"Defensa de {team}: {res} ({q.get('playResult')} yardas)"
        elif q.get("tag") == "OFFENSE FILM":
            q["tag"] = "Su ofensiva"
            drop = DROPBACK_ES.get(str(q.get("dropBackType")), str(q.get("dropBackType")).lower())
            q["headline"] = f"Ofensiva de {team}: +{q.get('playResult')} yardas ({drop})"
        out.append(q)
    return out
