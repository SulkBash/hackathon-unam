"""La Guerra de los 3.5 Segundos: agregados de GET /api/guerra (PLAN §2.2).

Todo se calcula al arrancar sobre data/ (vía TrenchAnalytics) y backend/precomputed/
(features de tracking a 10 Hz generadas por backend/pipeline/build_tracking_features.py).
Sin escrituras en disco. Solo pandas + numpy.

Definiciones (AGENTS.md / PLAN "Core definitions"):
- Éxito: 1er down playResult >= 0.4*ytg; 2do >= 0.6*ytg; 3ro/4to >= ytg. Se excluye down == 0
  (intentos de 2 puntos: ytg 0, éxito 100% por construcción) de todo cálculo de éxito o situación.
- Conversión: playResult >= ytg. Jugada grande: prePenaltyPlayResult >= 20.
- Blitz: 5+ rushers. Stunt: la jugada tiene algún pff_blockType == "SW".
- Presión (jugada): algún rusher con hit/hurry/sack. % completos: C / (C + I + IN).
- Duelo perdido: hitAllowed, hurryAllowed, sackAllowed o beatenByDefender == 1.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

PRE_DIR = Path(__file__).resolve().parent / "precomputed"
DL_POS = {"DE", "OLB", "DT", "NT"}
TTT_BINS = [0, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, np.inf]
TTT_LABELS = ["≤2.0 s", "2.0–2.5 s", "2.5–3.0 s", "3.0–3.5 s", "3.5–4.0 s", "4.0–5.0 s", "> 5.0 s"]
DESIGNED_ROLLOUTS = {"DESIGNED_ROLLOUT_LEFT", "DESIGNED_ROLLOUT_RIGHT"}


# ----------------------------------------------------------------------------- helpers
def _num(v: Any, digits: int = 1) -> float | None:
    """Plain Python float rounded, or None for NaN/inf (JSON-safe)."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(x):
        return None
    return round(x, digits)


def _pct(v: Any, digits: int = 1) -> float | None:
    x = _num(v, 9)
    return None if x is None else round(x * 100.0, digits)


def _read(name: str) -> pd.DataFrame:
    f = PRE_DIR / name
    if not f.exists():
        return pd.DataFrame()
    try:
        return pd.read_csv(f)
    except Exception:  # noqa: BLE001 - never crash the API on a bad cache file
        return pd.DataFrame()


def _strat_diff(df: pd.DataFrame, treat: str, out: str, strata: list[str]) -> tuple[float, float, int]:
    """Treated minus control on `out` within the same stratum, weighted by treated n.

    Only strata with both groups present count. SE combines binomial variances per stratum
    (p shrunk as (k+0.5)/(n+1) so tiny strata with p in {0,1} do not get zero variance).
    Returns (estimate, se, treated n used), both in proportion units.
    """
    d = df[[treat, out] + strata].dropna(subset=[out])
    if d.empty:
        return float("nan"), float("nan"), 0
    g = d.groupby(strata + [treat])[out].agg(["sum", "count"]).unstack(treat)
    if ("count", 1) not in g.columns or ("count", 0) not in g.columns:
        return float("nan"), float("nan"), 0
    k1, n1 = g[("sum", 1)], g[("count", 1)]
    k0, n0 = g[("sum", 0)], g[("count", 0)]
    ok = n1.notna() & n0.notna() & (n1 > 0) & (n0 > 0)
    k1, n1, k0, n0 = k1[ok], n1[ok], k0[ok], n0[ok]
    if n1.sum() == 0:
        return float("nan"), float("nan"), 0
    m1, m0 = k1 / n1, k0 / n0
    w = n1 / n1.sum()
    est = float((w * (m1 - m0)).sum())
    p1 = (k1 + 0.5) / (n1 + 1)
    p0 = (k0 + 0.5) / (n0 + 1)
    var = p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0
    se = float(np.sqrt((w**2 * var).sum()))
    return est, se, int(n1.sum())


def _expected_vs_base(df: pd.DataFrame, is_base: pd.Series, out: str, strata: list[str]) -> pd.Series:
    """Per-row expected `out` = mean of the base group in the row's stratum (NaN if no base data)."""
    base_mean = df.loc[is_base].groupby(strata)[out].mean().rename("_exp")
    return df[strata].merge(base_mean, left_on=strata, right_index=True, how="left")["_exp"]


def _two_way_demean(df: pd.DataFrame, cols: list[str], fe1: str, fe2: str, iters: int = 30) -> pd.DataFrame:
    """Alternating projections: remove fe1 and fe2 fixed effects from `cols`."""
    out = df[cols].astype(float).copy()
    for _ in range(iters):
        for fe in (fe1, fe2):
            out = out - out.groupby(df[fe]).transform("mean")
    return out


# ----------------------------------------------------------------------------- main
def build_guerra(engine: Any) -> dict[str, Any]:
    pm = engine.pm.copy()
    rush = engine.rush
    blk_all = engine.pff[engine.pff["pff_role"] == "Pass Block"]

    # Outcomes on every play (success / conversion NaN on down == 0)
    d, ytg, res = pm["down"], pm["yardsToGo"], pm["playResult"]
    need = np.where(d == 1, 0.4 * ytg, np.where(d == 2, 0.6 * ytg, ytg))
    valid = d > 0
    pm["success"] = np.where(valid, (res >= need).astype(float), np.nan)
    pm["conversion"] = np.where(valid, (res >= ytg).astype(float), np.nan)
    pm["big"] = (pm["prePenaltyPlayResult"] >= 20).astype(float)
    pm["is_att"] = pm["passResult"].isin(["C", "I", "IN"])
    pm["pressure"] = pm["had_pressure"].astype(float)
    pm["sack"] = pm["is_sack"].astype(float)
    pm["blitz"] = pm["is_blitz"].astype(int)
    pm["stunt"] = pm["has_stunt"].astype(int)
    pm["pa"] = pm["is_play_action"].astype(int)

    trk_play = _read("tracking_plays.csv")
    trk_rush = _read("tracking_rushers.csv")
    if not trk_play.empty:
        pm = pm.merge(trk_play[["gameId", "playId", "ttt", "endEvent"]], on=["gameId", "playId"], how="left")
    else:
        pm["ttt"] = np.nan
        pm["endEvent"] = None

    sit = pm[valid].copy()  # situational population (down > 0)

    # ------------------------------------------------------------------ headline
    att = pm[pm["is_att"]]
    headline = {
        "plays": int(len(pm)),
        "games": int(pm["gameId"].nunique()),
        "rusher_snaps": int(len(trk_rush)) if not trk_rush.empty else int(len(rush)),
        "clean_comp": _pct(att.loc[att["pressure"] == 0, "is_comp"].mean()),
        "pressured_comp": _pct(att.loc[att["pressure"] == 1, "is_comp"].mean()),
        "clean_success": _pct(sit.loc[sit["pressure"] == 0, "success"].mean()),
        "pressured_success": _pct(sit.loc[sit["pressure"] == 1, "success"].mean()),
    }

    # ------------------------------------------------------------------ cliff (danger zone)
    cliff: list[dict[str, Any]] = []
    tp = pm.dropna(subset=["ttt"]).copy()
    if not tp.empty:
        tp["bucket"] = pd.cut(tp["ttt"], bins=TTT_BINS, labels=TTT_LABELS, right=True)
        for label in TTT_LABELS:
            b = tp[tp["bucket"] == label]
            cliff.append({
                "bucket": label,
                "plays": int(len(b)),
                "pressure": _pct(b["pressure"].mean()),
                "sack": _pct(b["sack"].mean()),
                "success": _pct(b["success"].mean()),  # NaN-skipping mean: down == 0 excluded
                "big": _pct(b["big"].mean()),
            })

    # ------------------------------------------------------------------ get-off
    getoff: dict[str, Any] = {"within_player": [], "pp_per_tenth": None, "base_rate": None, "by_situation": [], "stability": None}
    dl = pd.DataFrame()
    if not trk_rush.empty:
        rt = trk_rush.merge(rush[["gameId", "playId", "nflId", "pressure"]], on=["gameId", "playId", "nflId"], how="inner")
        rt = rt.merge(engine.players[["nflId", "officialPosition"]], on="nflId", how="left")
        rt = rt.merge(pm[["gameId", "playId", "down", "yardsToGo", "week", "pa"]], on=["gameId", "playId"], how="left")
        dl = rt[rt["officialPosition"].isin(DL_POS) & rt["getoff"].notna() & (rt["getoff"] < 2)].copy()

    if not dl.empty:
        dl["pressure"] = dl["pressure"].astype(float)
        # within_player: ONLY players with >= 100 DL rows; delta vs own median, rounded to 0.1, clipped ±0.3
        cnt = dl.groupby("nflId")["getoff"].transform("count")
        wp = dl[cnt >= 100].copy()
        wp["delta"] = (np.round(wp["getoff"] - wp.groupby("nflId")["getoff"].transform("median"), 1).clip(-0.3, 0.3)) + 0.0
        rows = []
        for delta, g in wp.groupby("delta"):
            dv = round(float(delta), 1)
            if dv < 0:
                label = f"{abs(dv):.1f} s antes"
            elif dv > 0:
                label = f"{dv:.1f} s después"
            else:
                label = "En su mediana"
            rows.append({"delta": dv, "label": label, "snaps": int(len(g)), "pressure": _pct(g["pressure"].mean())})
        getoff["within_player"] = sorted(rows, key=lambda r: r["delta"])

        # pp_per_tenth / base_rate / by_situation: ALL DL rows (POPULATIONS note)
        x = dl["getoff"] - dl.groupby("nflId")["getoff"].transform("mean")
        y = dl["pressure"] - dl.groupby("nflId")["pressure"].transform("mean")
        slope = float(np.polyfit(x.to_numpy(), y.to_numpy(), 1)[0])
        getoff["pp_per_tenth"] = _num(-slope * 0.1 * 100, 1)
        getoff["base_rate"] = _pct(dl["pressure"].mean())

        dl["delta_med"] = dl["getoff"] - dl.groupby("nflId")["getoff"].transform("median")
        # "3er down y 7+" = down == 3 (matches the label and the verified 17.2/13.6 · 11.6/8.8 split)
        third_long = (dl["down"] == 3) & (dl["yardsToGo"] >= 7)
        rest = (dl["down"] > 0) & ~third_long
        by_sit = []
        for name, m in (("3er down y 7+", third_long), ("Resto", rest)):
            s = dl[m]
            by_sit.append({
                "situation": name,
                "faster": _pct(s.loc[s["delta_med"] < 0, "pressure"].mean()),
                "slower": _pct(s.loc[s["delta_med"] > 0, "pressure"].mean()),
                "snaps": int(len(s)),
            })
        getoff["by_situation"] = by_sit

        # stability: player mean get-off, weeks 1-4 vs 5-8 (>= 60 DL rows in each half)
        h1 = dl[dl["week"] <= 4].groupby("nflId")["getoff"].agg(["mean", "count"])
        h2 = dl[dl["week"] >= 5].groupby("nflId")["getoff"].agg(["mean", "count"])
        both = h1.join(h2, lsuffix="_1", rsuffix="_2", how="inner")
        both = both[(both["count_1"] >= 60) & (both["count_2"] >= 60)]
        getoff["stability"] = _num(both["mean_1"].corr(both["mean_2"]), 2) if len(both) > 2 else None
        getoff["stability_players"] = int(len(both))

    # ------------------------------------------------------------------ play action
    strata_dy = ["down", "yardsToGo"]
    pa_rows = sit[sit["pa"] == 1].copy()
    play_action: dict[str, Any] = {"pa_rate": _pct(pm["pa"].mean())}
    if not dl.empty:
        play_action["getoff_no_pa"] = _num(dl.loc[dl["pa"] == 0, "getoff"].mean(), 2)
        play_action["getoff_pa"] = _num(dl.loc[dl["pa"] == 1, "getoff"].mean(), 2)
        fe = dl[dl["down"] > 0].copy()
        fe["stratum"] = fe["down"].astype(int).astype(str) + "_" + fe["yardsToGo"].astype(int).astype(str)
        dm = _two_way_demean(fe, ["getoff", "pa"], "nflId", "stratum")
        sxx = float((dm["pa"] ** 2).sum())
        play_action["getoff_delta_adj"] = _num(float((dm["pa"] * dm["getoff"]).sum()) / sxx, 2) if sxx > 0 else None
    else:
        play_action.update({"getoff_no_pa": None, "getoff_pa": None, "getoff_delta_adj": None})
    play_action["ttt_no_pa"] = _num(pm.loc[pm["pa"] == 0, "ttt"].median(), 1)
    play_action["ttt_pa"] = _num(pm.loc[pm["pa"] == 1, "ttt"].median(), 1)
    for metric, key_pa, key_exp in (
        ("success", "success_pa", "success_expected"),
        ("big", "big_pa", "big_expected"),
        ("pressure", "pressure_pa", "pressure_expected"),
        ("sack", "sack_pa", "sack_expected"),
    ):
        exp = _expected_vs_base(sit, sit["pa"] == 0, metric, strata_dy)
        m = (sit["pa"] == 1) & exp.notna().to_numpy() & sit[metric].notna()
        play_action[key_pa] = _pct(sit.loc[m, metric].mean())
        play_action[key_exp] = _pct(exp[m.to_numpy()].mean())
    play_action["pa_plays_compared"] = int(len(pa_rows))
    designed = pm["dropBackType"].isin(DESIGNED_ROLLOUTS)
    pa_all = pm["pa"] == 1
    play_action["rollout_sack"] = _pct(pm.loc[designed, "sack"].mean())
    play_action["pocket_sack"] = _pct(pm.loc[pm["dropBackType"] == "TRADITIONAL", "sack"].mean())
    play_action["rollout_pa_share"] = _num(pm.loc[designed, "pa"].mean() * 100, 0)
    play_action["pa_rollout_sack"] = _pct(pm.loc[pa_all & designed, "sack"].mean())
    play_action["pa_rollout_n"] = int((pa_all & designed).sum())
    play_action["pa_no_rollout_sack"] = _pct(pm.loc[pa_all & ~designed, "sack"].mean())

    # ------------------------------------------------------------------ blitz
    overall = []
    for label, m in (("Rush 3–4", pm["blitz"] == 0), ("Blitz 5+", pm["blitz"] == 1)):
        g = pm[m]
        overall.append({"label": label, "plays": int(len(g)), "pressure": _pct(g["pressure"].mean()), "success": _pct(g["success"].mean())})

    situations = [
        ("1ro y 2do down", sit["down"].isin([1, 2]), "success"),
        ("3ro/4to y 1-3", (sit["down"] >= 3) & sit["yardsToGo"].between(1, 3), "conversion"),
        ("3ro/4to y 4-6", (sit["down"] >= 3) & sit["yardsToGo"].between(4, 6), "conversion"),
        ("3ro/4to y 7+", (sit["down"] >= 3) & (sit["yardsToGo"] >= 7), "conversion"),
    ]
    by_situation = []
    ests: dict[str, tuple[float, float]] = {}
    for name, m, metric in situations:
        s = sit[m]
        est, se, nb = _strat_diff(s, "blitz", metric, strata_dy)
        ests[name] = (est, se)
        row: dict[str, Any] = {
            "situation": name,
            "adj_delta": _num(est * 100, 1),
            "se": _num(se * 100, 1),
            "blitz_share": _pct(s["blitz"].mean()),
            "plays": int(len(s)),
            "blitz_plays": int(s["blitz"].sum()),
        }
        if name == "3ro/4to y 7+":
            row["metric"] = "conversion"
        by_situation.append(row)

    tl = sit[(sit["down"] >= 3) & (sit["yardsToGo"] >= 7)]
    third_long_sacks = {
        "rush4": _pct(tl.loc[tl["blitz"] == 0, "sack"].mean()),
        "blitz": _pct(tl.loc[tl["blitz"] == 1, "sack"].mean()),
    }
    e1, s1 = ests["1ro y 2do down"]
    e4, s4 = ests["3ro/4to y 7+"]
    diff = e4 - e1
    z = diff / np.sqrt(s1**2 + s4**2) if np.isfinite(s1) and np.isfinite(s4) and (s1 > 0 or s4 > 0) else float("nan")
    flip = {"early": _num(e1 * 100, 1), "third_long": _num(e4 * 100, 1), "diff": _num(diff * 100, 1), "z": _num(z, 1)}

    def plan_of(df: pd.DataFrame) -> pd.Series:
        return np.where(df["blitz"] == 1, "Blitz", "4") + np.where(df["stunt"] == 1, " con stunt", " sin stunt")

    tl = tl.copy()
    tl["plan"] = plan_of(tl)
    tl["plan"] = tl["plan"].str.replace("^4", "4", regex=True)
    base = tl[tl["plan"] == "4 sin stunt"]
    vs_base = []
    for plan in ("4 con stunt", "Blitz sin stunt", "Blitz con stunt"):
        sub = tl[tl["plan"].isin([plan, "4 sin stunt"])].copy()
        sub["t"] = (sub["plan"] == plan).astype(int)
        est, se, _ = _strat_diff(sub, "t", "conversion", strata_dy)
        g = tl[tl["plan"] == plan]
        vs_base.append({"plan": plan, "plays": int(len(g)), "adj_delta": _num(est * 100, 1), "se": _num(se * 100, 1), "sack": _pct(g["sack"].mean())})
    third_long_plans = {
        "base": {"plan": "4 sin stunt", "plays": int(len(base)), "conversion": _pct(base["conversion"].mean()), "sack": _pct(base["sack"].mean())},
        "vs_base": vs_base,
    }

    blitz = {
        "overall": overall,
        "by_situation": by_situation,
        "third_long_sacks": third_long_sacks,
        "flip": flip,
        "third_long_plans": third_long_plans,
    }

    # ------------------------------------------------------------------ rush plans (adjusted by down x ytg bin)
    rp = pm[pm["n_rushers"] >= 1].copy()
    rp["plan"] = plan_of(rp)
    rp["ytg_bin"] = pd.cut(rp["yardsToGo"], bins=[0, 3, 6, 10, 99], labels=False, right=True)
    rp_sit = rp[rp["down"] > 0].copy()
    rp_sit["_exp"] = _expected_vs_base(rp_sit, rp_sit["plan"] == "4 sin stunt", "success", ["down", "ytg_bin"]).to_numpy()
    rush_plans = []
    for plan in ("4 con stunt", "4 sin stunt", "Blitz sin stunt", "Blitz con stunt"):
        g = rp[rp["plan"] == plan]
        gs = rp_sit[(rp_sit["plan"] == plan) & rp_sit["_exp"].notna() & rp_sit["success"].notna()]
        adj = (gs["success"].mean() - gs["_exp"].mean()) * 100 if len(gs) else float("nan")
        rush_plans.append({
            "plan": plan,
            "plays": int(len(g)),
            "pressure": _pct(g["pressure"].mean()),
            "sack": _pct(g["sack"].mean()),
            "success": _pct(g["success"].mean()),
            "adj_delta": 0.0 if plan == "4 sin stunt" else _num(adj, 1),
        })

    # ------------------------------------------------------------------ protection (lost-rep rate by blocker group)
    blk = blk_all.merge(engine.players[["nflId", "officialPosition"]], on="nflId", how="left")
    lost = (
        (blk["pff_hitAllowed"] == 1)
        | (blk["pff_hurryAllowed"] == 1)
        | (blk["pff_sackAllowed"] == 1)
        | (blk["pff_beatenByDefender"] == 1)
    ).astype(float)
    groups = (
        ("Línea ofensiva, protección estándar (PP)", blk["pff_blockType"] == "PP"),
        ("Corredor recogiendo blitz (PU)", (blk["pff_blockType"] == "PU") & (blk["officialPosition"] == "RB")),
        ("Corredor ayudando (BH)", (blk["pff_blockType"] == "BH") & (blk["officialPosition"] == "RB")),
    )
    protection = [{"label": label, "reps": int(m.sum()), "lost": _pct(lost[m].mean())} for label, m in groups]

    return {
        "headline": headline,
        "cliff": cliff,
        "getoff": getoff,
        "play_action": play_action,
        "blitz": blitz,
        "rush_plans": rush_plans,
        "protection": protection,
    }
