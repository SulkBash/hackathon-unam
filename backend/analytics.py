"""Motor de análisis: "La Guerra de los 3.5 Segundos".

Loads games.csv, players.csv, plays.csv and pffScoutingData.csv plus the precomputed
tracking features in backend/precomputed/ once at startup (pandas, <2 s) and computes
every aggregate in memory. Single-play 10 Hz replays read data/tracking/ on demand.

Evidence rules applied everywhere (see AGENTS.md):
- success/conversion exclude down == 0 (two-point tries, yardsToGo 0 -> success by construction);
- situational comparisons use the same down x exact yardsToGo (stratified, treated-weighted),
  with standard errors w^2 * (var_t/n_t + var_c/n_c) summed over strata;
- player metrics are compared within player (fixed effects) and within position group;
- completion % uses attempts (C / (C + I + IN)).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
TRACKING_DIR = DATA_DIR / "tracking"
PRE_DIR = Path(__file__).resolve().parent / "precomputed"

TEAM_NAMES: dict[str, str] = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills", "CAR": "Carolina Panthers", "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs", "LA": "Los Angeles Rams", "LAC": "Los Angeles Chargers",
    "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
    "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks", "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans", "WAS": "Washington Football Team",
}

# Labels follow README_DATA.md (pff_blockType data dictionary).
BLOCK_TYPE_LABELS: dict[str, str] = {
    "PP": "Protección estándar",
    "PA": "Protección de play action",
    "PT": "Post",
    "SW": "Switch (stunt)",
    "CL": "Segundo nivel",
    "CH": "Chip",
    "NB": "Sin bloqueo",
    "PU": "Recogida del RB",
    "UP": "Jalón",
    "BH": "Ayuda desde el backfield",
    "PR": "Pocket móvil",
    "SR": "Set & release",
}

OL_LANES = ["LT", "LG", "C", "RG", "RT"]
DL_POS = {"DE", "OLB", "DT", "NT"}
EDGE_POS = {"DE", "OLB"}
ROLLOUTS = {"DESIGNED_ROLLOUT_LEFT", "DESIGNED_ROLLOUT_RIGHT"}
END_EVENTS = {"pass_forward", "autoevent_passforward", "qb_sack", "run", "qb_strip_sack", "fumble"}
SNAP_EVENTS = {"ball_snap", "autoevent_ballsnap"}
TTT_BINS = [0.0, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, np.inf]
TTT_LABELS = ["≤2.0 s", "2.0–2.5 s", "2.5–3.0 s", "3.0–3.5 s", "3.5–4.0 s", "4.0–5.0 s", ">5.0 s"]
LATE_T = 3.5
PLAN_ORDER = ["4 con stunt", "4 sin stunt", "Blitz sin stunt", "Blitz con stunt"]


def _r(val: Any, digits: int = 1) -> float:
    if val is None:
        return 0.0
    try:
        f = float(val)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if np.isnan(f) else round(f, digits)


def _pct(val: Any, digits: int = 1) -> float:
    if val is None:
        return 0.0
    try:
        f = float(val)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if np.isnan(f) else round(f * 100.0, digits)


def _signed(val: float, digits: int = 1) -> str:
    """Signed number with a typographic minus, e.g. +4.5 / −4.6."""
    v = round(float(val), digits)
    return f"+{v:.{digits}f}" if v > 0 else (f"−{abs(v):.{digits}f}" if v < 0 else f"{0:.{digits}f}")


def _opt(val: Any, digits: int = 2) -> float | None:
    if val is None or pd.isna(val):
        return None
    return round(float(val), digits)


def strat_adjust(df: pd.DataFrame, treat: pd.Series, ctrl: pd.Series, outcome: str,
                 strata: list[str]) -> dict[str, float]:
    """Treated actual vs control expected in the same strata (treated-weighted), in points.

    se = sqrt(sum_s w_s^2 * (var_t/n_t + var_c/n_c)); strata without both groups are dropped.
    """
    t = df[treat.values].dropna(subset=[outcome])
    c = df[ctrl.values].dropna(subset=[outcome])
    if len(t) == 0 or len(c) == 0:
        return {"actual": 0.0, "expected": 0.0, "delta": 0.0, "se": 0.0, "z": 0.0, "n": 0}
    ct = c.groupby(strata)[outcome].agg(["mean", "var", "size"]).rename(columns=lambda s: "c_" + s)
    tt = t.groupby(strata)[outcome].agg(["mean", "var", "size"]).join(ct, how="inner")
    tt = tt[tt["c_size"] > 0]
    n = float(tt["size"].sum())
    if n == 0:
        return {"actual": 0.0, "expected": 0.0, "delta": 0.0, "se": 0.0, "z": 0.0, "n": 0}
    w = tt["size"] / n
    actual = float((w * tt["mean"]).sum())
    expected = float((w * tt["c_mean"]).sum())
    var = float((w ** 2 * (tt["var"].fillna(0) / tt["size"] + tt["c_var"].fillna(0) / tt["c_size"])).sum())
    se = float(np.sqrt(var))
    delta = actual - expected
    return {
        "actual": round(actual * 100, 1),
        "expected": round(expected * 100, 1),
        "delta": round(delta * 100, 1),
        "se": round(se * 100, 1),
        "z": round(delta / se, 1) if se > 0 else 0.0,
        "n": int(n),
    }


def _demean(v: np.ndarray, codes: np.ndarray, n: int) -> np.ndarray:
    s = np.bincount(codes, weights=v, minlength=n)
    c = np.bincount(codes, minlength=n)
    return v - (s / np.maximum(c, 1))[codes]


def fe_slope(y: np.ndarray, x: np.ndarray, fes: list[np.ndarray], cluster: np.ndarray,
             iters: int = 40) -> tuple[float, float]:
    """OLS slope of y on x with multi-way fixed effects (alternating projections) and cluster-robust SE."""
    y = y.astype(float).copy()
    x = x.astype(float).copy()
    coded = [pd.factorize(f)[0] for f in fes]
    sizes = [int(c.max()) + 1 for c in coded]
    for _ in range(iters if len(fes) > 1 else 1):
        for c, n in zip(coded, sizes):
            y = _demean(y, c, n)
            x = _demean(x, c, n)
    sxx = float(x @ x)
    if sxx == 0:
        return 0.0, 0.0
    b = float(x @ y) / sxx
    e = y - b * x
    cl = pd.factorize(cluster)[0]
    score = np.bincount(cl, weights=x * e)
    se = float(np.sqrt((score ** 2).sum())) / sxx
    return b, se


def split_half_corr(df: pd.DataFrame, key: str, value_fn, min_n: int) -> tuple[float, int]:
    """Correlation of a per-entity metric between weeks 1-4 and 5-8 (entities with >= min_n rows per half)."""
    vals = []
    for half, sub in [(1, df[df["week"] <= 4]), (2, df[df["week"] >= 5])]:
        g = sub.groupby(key)
        stat = g.apply(value_fn, include_groups=False) if len(sub) else pd.Series(dtype=float)
        stat = stat[g.size() >= min_n]
        vals.append(stat.rename(half))
    both = pd.concat(vals, axis=1).dropna()
    if len(both) < 3:
        return 0.0, int(len(both))
    return round(float(both[1].corr(both[2])), 2), int(len(both))


class TrenchAnalytics:
    """In-memory analytics store built from the read-only CSVs in data/ and backend/precomputed/."""

    def __init__(self) -> None:
        self.games = pd.read_csv(DATA_DIR / "games.csv")
        self.players = pd.read_csv(DATA_DIR / "players.csv")
        self.plays = pd.read_csv(DATA_DIR / "plays.csv")
        self.pff = pd.read_csv(DATA_DIR / "pffScoutingData.csv")
        self.trk_play = self._read_pre("tracking_plays.csv", ["gameId", "playId", "ttt", "endEvent"])
        self.trk_rush = self._read_pre(
            "tracking_rushers.csv", ["gameId", "playId", "nflId", "getoff", "s05", "strain", "dmin", "t2"])

        self.player_map: dict[int, dict[str, Any]] = {
            int(row["nflId"]): {
                "nflId": int(row["nflId"]),
                "displayName": str(row["displayName"]),
                "officialPosition": str(row["officialPosition"]),
                "height": str(row["height"]) if pd.notna(row["height"]) else "",
                "weight": int(row["weight"]) if pd.notna(row["weight"]) else 0,
            }
            for _, row in self.players.iterrows()
        }

        self._build_core_tables()
        self._guerra_cache = self._compute_guerra()
        self._qb_cache = self._compute_qb_clocks()
        self._overview_cache = self._compute_overview()
        self._players_cache = self._compute_player_leaderboards()
        self._showcase_cache = self._compute_showcase_plays()

    @staticmethod
    def _read_pre(name: str, cols: list[str]) -> pd.DataFrame:
        path = PRE_DIR / name
        if not path.exists():
            return pd.DataFrame({c: pd.Series(dtype=float if c not in ("endEvent",) else object) for c in cols})
        return pd.read_csv(path)

    # ------------------------------------------------------------------ core tables
    def _build_core_tables(self) -> None:
        plays_team = self.plays[["gameId", "playId", "possessionTeam", "defensiveTeam"]]

        blk = self.pff[self.pff["pff_role"] == "Pass Block"].copy()
        blk["allowed_pressure"] = (
            (blk["pff_hitAllowed"] == 1) | (blk["pff_hurryAllowed"] == 1) | (blk["pff_sackAllowed"] == 1)
        ).astype(int)
        blk["sack_allowed"] = (blk["pff_sackAllowed"] == 1).astype(int)
        blk["beaten"] = (blk["pff_beatenByDefender"] == 1).astype(int)
        blk["lost"] = ((blk["allowed_pressure"] == 1) | (blk["beaten"] == 1)).astype(int)
        blk = blk.merge(plays_team, on=["gameId", "playId"], how="left")
        blk = blk.merge(self.players[["nflId", "officialPosition"]], on="nflId", how="left")

        rush = self.pff[self.pff["pff_role"] == "Pass Rush"].copy()
        rush["pressure"] = ((rush["pff_hit"] == 1) | (rush["pff_hurry"] == 1) | (rush["pff_sack"] == 1)).astype(int)
        rush["sack"] = (rush["pff_sack"] == 1).astype(int)
        rush["hit"] = (rush["pff_hit"] == 1).astype(int)
        rush["hurry"] = (rush["pff_hurry"] == 1).astype(int)
        rush = rush.merge(plays_team, on=["gameId", "playId"], how="left")

        # Blockers whose PFF first target is this rusher (neutral info for the film room only).
        dt = (
            blk.dropna(subset=["pff_nflIdBlockedPlayer"])
            .groupby(["gameId", "playId", "pff_nflIdBlockedPlayer"]).size().reset_index(name="n_blockers_on_rusher")
        )
        dt["pff_nflIdBlockedPlayer"] = dt["pff_nflIdBlockedPlayer"].astype(int)
        rush = rush.merge(dt, left_on=["gameId", "playId", "nflId"],
                          right_on=["gameId", "playId", "pff_nflIdBlockedPlayer"], how="left")
        rush["n_blockers_on_rusher"] = rush["n_blockers_on_rusher"].fillna(0).astype(int)
        rush["is_double_teamed"] = (rush["n_blockers_on_rusher"] >= 2).astype(int)
        rush["is_free_rusher"] = (rush["n_blockers_on_rusher"] == 0).astype(int)

        play_rush = rush.groupby(["gameId", "playId"]).agg(
            n_rushers=("nflId", "count"),
            n_dt_rushers=("is_double_teamed", "sum"),
            n_free_rushers=("is_free_rusher", "sum"),
            total_pressures=("pressure", "sum"),
            total_sacks=("sack", "sum"),
        ).reset_index()
        play_blk = blk.groupby(["gameId", "playId"]).agg(
            n_blockers=("nflId", "count"),
            n_stunts=("pff_blockType", lambda s: int((s == "SW").sum())),
        ).reset_index()

        pm = (
            self.plays.merge(self.games[["gameId", "week", "gameDate", "homeTeamAbbr", "visitorTeamAbbr"]],
                             on="gameId", how="left")
            .merge(play_rush, on=["gameId", "playId"], how="left")
            .merge(play_blk, on=["gameId", "playId"], how="left")
            .merge(self.trk_play[["gameId", "playId", "ttt", "endEvent"]], on=["gameId", "playId"], how="left")
        )
        for col in ["n_rushers", "n_dt_rushers", "n_free_rushers", "total_pressures", "total_sacks",
                    "n_blockers", "n_stunts"]:
            pm[col] = pm[col].fillna(0).astype(int)

        ytg = pm["yardsToGo"].astype(float)
        res = pm["playResult"].astype(float)
        succ = np.where(pm["down"] == 1, res >= 0.4 * ytg,
                        np.where(pm["down"] == 2, res >= 0.6 * ytg, res >= ytg)).astype(float)
        valid_down = pm["down"] > 0
        pm["success"] = np.where(valid_down, succ, np.nan)
        pm["conversion"] = np.where(valid_down, (res >= ytg).astype(float), np.nan)
        pm["big"] = (pm["prePenaltyPlayResult"] >= 20).astype(int)
        pm["had_pressure"] = (pm["total_pressures"] > 0).astype(int)
        pm["is_sack"] = (pm["passResult"] == "S").astype(int)
        pm["is_att"] = pm["passResult"].isin(["C", "I", "IN"]).astype(int)
        pm["is_comp"] = (pm["passResult"] == "C").astype(int)
        pm["comp_att"] = np.where(pm["is_att"] == 1, pm["is_comp"].astype(float), np.nan)
        pm["is_int"] = (pm["passResult"] == "IN").astype(int)
        pm["is_blitz"] = (pm["n_rushers"] >= 5).astype(int)
        pm["has_stunt"] = (pm["n_stunts"] > 0).astype(int)
        pm["is_play_action"] = (pm["pff_playAction"] == 1).astype(int)
        pm["is_rollout"] = pm["dropBackType"].isin(ROLLOUTS).astype(int)
        pm["is_late"] = np.where(pm["ttt"].notna(), (pm["ttt"] > LATE_T).astype(float), np.nan)
        pm["third_long"] = ((pm["down"] >= 3) & (pm["yardsToGo"] >= 7)).astype(int)
        pm["plan"] = np.where(pm["is_blitz"] == 1,
                              np.where(pm["has_stunt"] == 1, "Blitz con stunt", "Blitz sin stunt"),
                              np.where(pm["has_stunt"] == 1, "4 con stunt", "4 sin stunt"))

        qb_df = self.pff[self.pff["pff_role"] == "Pass"][["gameId", "playId", "nflId"]].drop_duplicates(
            subset=["gameId", "playId"]).rename(columns={"nflId": "qb_nflId"})
        qb_df = qb_df.merge(
            self.players[["nflId", "displayName"]].rename(columns={"nflId": "qb_nflId", "displayName": "qb_name"}),
            on="qb_nflId", how="left")
        pm = pm.merge(qb_df, on=["gameId", "playId"], how="left")

        # Rusher snaps with tracking features (all PFF Pass Rush rows on tracked plays).
        rt = self.trk_rush.merge(
            rush[["gameId", "playId", "nflId", "pressure", "sack", "defensiveTeam"]],
            on=["gameId", "playId", "nflId"], how="inner")
        rt = rt.merge(self.players[["nflId", "officialPosition", "displayName"]], on="nflId", how="left")
        rt = rt.merge(pm[["gameId", "playId", "down", "yardsToGo", "is_play_action", "week", "ttt",
                          "third_long", "is_blitz", "has_stunt"]], on=["gameId", "playId"], how="left")
        rt["group"] = np.where(rt["officialPosition"].isin(EDGE_POS), "Edge",
                               np.where(rt["officialPosition"].isin(DL_POS), "Interior", "Otro"))

        dl = rt[rt["officialPosition"].isin(DL_POS) & rt["getoff"].notna() & (rt["getoff"] < 2)].copy()
        dl["p_mean"] = dl.groupby("nflId")["getoff"].transform("mean")
        dl["p_median"] = dl.groupby("nflId")["getoff"].transform("median")
        dl["p_n"] = dl.groupby("nflId")["getoff"].transform("size")
        dl["delta"] = np.round(dl["getoff"] - dl["p_median"], 1)
        dl["group_mean"] = dl.groupby("group")["getoff"].transform("mean")

        self.blk = blk
        self.rush = rush
        self.pm = pm
        self.rush_trk = rt
        self.dl = dl
        self.getoff_lookup: dict[tuple[int, int, int], float] = {
            (int(g), int(p), int(n)): float(v)
            for g, p, n, v in self.trk_rush.dropna(subset=["getoff"])[["gameId", "playId", "nflId", "getoff"]].itertuples(index=False)
        }
        self.player_getoff_median: dict[int, float] = (
            dl.groupby("nflId")["getoff"].median().round(2).to_dict()
        )

    # ------------------------------------------------------------------ /api/guerra
    def _compute_guerra(self) -> dict[str, Any]:
        pm = self.pm
        d = pm[pm["down"] > 0]
        dl = self.dl

        # Headline
        clean, pres = pm[pm["had_pressure"] == 0], pm[pm["had_pressure"] == 1]
        headline = {
            "plays": int(len(pm)),
            "games": int(pm["gameId"].nunique()),
            "tracked_plays": int(pm["ttt"].notna().sum()),
            "rusher_snaps": int(len(self.rush_trk)),
            "pressure_rate": _pct(pm["had_pressure"].mean()),
            "clean_comp": _pct(clean["comp_att"].mean()),
            "pressured_comp": _pct(pres["comp_att"].mean()),
            "clean_success": _pct(clean["success"].mean()),
            "pressured_success": _pct(pres["success"].mean()),
        }

        # Danger zone (time-to-throw buckets)
        tk = pm[pm["ttt"].notna()].copy()
        tk["bucket"] = pd.cut(tk["ttt"], TTT_BINS, labels=TTT_LABELS, include_lowest=True)
        cliff = []
        for lbl in TTT_LABELS:
            sub = tk[tk["bucket"] == lbl]
            cliff.append({
                "bucket": lbl,
                "plays": int(len(sub)),
                "pressure": _pct(sub["had_pressure"].mean()),
                "sack": _pct(sub["is_sack"].mean()),
                "success": _pct(sub["success"].mean()),
                "big": _pct(sub["big"].mean()),
            })
        early_t = tk[tk["ttt"] <= LATE_T]
        late_t = tk[tk["ttt"] > LATE_T]
        # Sack risk by uniform 0.5 s steps (2.0-4.5 s): growth is continuous (no break at 3.5 s).
        half_edges = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5]
        tk["half"] = pd.cut(tk["ttt"], half_edges, labels=False)
        half_rates = [float(tk[tk["half"] == i]["is_sack"].mean()) for i in range(len(half_edges) - 1)]
        sack_steps = [round(b_ / a_, 1) for a_, b_ in zip(half_rates[:-1], half_rates[1:]) if a_ > 0]
        sack_mult = round(float(np.exp(np.mean(np.log(sack_steps)))), 1) if sack_steps else 0.0
        sack_by_half = [{"from": lo, "to": hi, "sack": _pct(r_)} for lo, hi, r_ in
                        zip(half_edges[:-1], half_edges[1:], half_rates)]
        danger = {
            "threshold": LATE_T,
            "sack_before": _pct(early_t["is_sack"].mean()),
            "sack_after": _pct(late_t["is_sack"].mean()),
            "success_before": _pct(early_t["success"].mean()),
            "success_after": _pct(late_t["success"].mean()),
            "late_share": _pct(tk[tk["down"] > 0]["is_late"].mean()),
            "sack_steps": sack_steps,
            "sack_multiplier_per_half_second": sack_mult,
            "sack_by_half_second": sack_by_half,
            "sack_3_0_3_5": cliff[3]["sack"],
            "sack_3_5_4_0": cliff[4]["sack"],
            "sack_4_0_5_0": cliff[5]["sack"],
        }

        # Get-off
        w = dl[dl["p_n"] >= 100].copy()
        w["dclip"] = w["delta"].clip(-0.3, 0.3).round(1)
        within_player = []
        for dv in [-0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3]:
            sub = w[np.isclose(w["dclip"], dv)]
            label = "Su mediana" if dv == 0 else (f"{abs(dv):.1f} s antes" if dv < 0 else f"{dv:.1f} s después")
            within_player.append({"delta": dv, "label": label, "snaps": int(len(sub)),
                                  "pressure": _pct(sub["pressure"].mean())})

        b, se = fe_slope(dl["pressure"].values, dl["getoff"].values, [dl["nflId"].values], dl["nflId"].values)
        by_group = []
        for g in ["Edge", "Interior"]:
            sub = dl[dl["group"] == g]
            bg, sg = fe_slope(sub["pressure"].values, sub["getoff"].values, [sub["nflId"].values], sub["nflId"].values)
            by_group.append({"group": g, "snaps": int(len(sub)), "getoff_avg": _r(sub["getoff"].mean(), 3),
                             "base_rate": _pct(sub["pressure"].mean()),
                             "pp_per_tenth": _r(-bg * 10, 2), "se": _r(sg * 10, 2),
                             "z": _r(-bg / sg, 1) if sg > 0 else 0.0})
        # Controlled spec: same player + same down x yardsToGo + same time-to-throw band.
        dc = dl[(dl["down"] > 0) & dl["ttt"].notna()].copy()
        dc["sit"] = dc["down"].astype(int).astype(str) + "_" + dc["yardsToGo"].astype(int).astype(str)
        dc["tband"] = pd.cut(dc["ttt"], TTT_BINS, labels=False, include_lowest=True)
        bc, sc = fe_slope(dc["pressure"].values, dc["getoff"].values,
                          [dc["nflId"].values, dc["sit"].values, dc["tband"].values], dc["nflId"].values)
        # Robustness table: pressure pts per 0.1 s faster under increasingly strict controls (player-clustered z).
        dc["play"] = dc["gameId"].astype(str) + "_" + dc["playId"].astype(str)
        dc["bs"] = dc["is_blitz"].astype(str) + dc["has_stunt"].astype(str)
        robustness = []
        for lbl, fes in [
            ("Mismo jugador", ["nflId"]),
            ("+ down y distancia exacta", ["nflId", "sit"]),
            ("+ franja de tiempo de lanzamiento", ["nflId", "sit", "tband"]),
            ("+ play action", ["nflId", "sit", "tband", "is_play_action"]),
            ("+ blitz / stunt", ["nflId", "sit", "tband", "is_play_action", "bs"]),
            ("Contra sus compañeros en el mismo snap", ["nflId", "play"]),
        ]:
            br, sr = fe_slope(dc["pressure"].values, dc["getoff"].values, [dc[f].values for f in fes], dc["nflId"].values)
            robustness.append({"spec": lbl, "pp_per_tenth": _r(-br * 10, 2), "z": _r(-br / sr, 1) if sr > 0 else 0.0})
        for row in by_group:
            sub = dc[dc["group"] == row["group"]]
            bgc, sgc = fe_slope(sub["pressure"].values, sub["getoff"].values,
                                [sub["nflId"].values, sub["sit"].values, sub["tband"].values], sub["nflId"].values)
            row["pp_per_tenth_controlled"] = _r(-bgc * 10, 2)
            row["z_controlled"] = _r(-bgc / sgc, 1) if sgc > 0 else 0.0

        by_situation = []
        for lbl, sub in [("3er down y 7+", dl[dl["third_long"] == 1]), ("Resto", dl[dl["third_long"] == 0])]:
            by_situation.append({
                "situation": lbl,
                "faster": _pct(sub[sub["delta"] < 0]["pressure"].mean()),
                "slower": _pct(sub[sub["delta"] > 0]["pressure"].mean()),
                "snaps": int(len(sub)),
            })
        stab, stab_n = split_half_corr(dl, "nflId", lambda g: g["getoff"].mean(), 60)
        getoff = {
            "within_player": within_player,
            "pp_per_tenth": _r(-b * 10, 2),
            "pp_per_tenth_se": _r(se * 10, 2),
            "pp_per_tenth_z": _r(-b / se, 1) if se > 0 else 0.0,
            "pp_per_tenth_controlled": _r(-bc * 10, 2),
            "pp_per_tenth_controlled_z": _r(-bc / sc, 1) if sc > 0 else 0.0,
            "robustness": robustness,
            "base_rate": _pct(dl["pressure"].mean()),
            "relative_gain": _pct((-b * 0.1) / max(dl["pressure"].mean(), 1e-9)),
            "by_group": by_group,
            "by_situation": by_situation,
            "stability": stab,
            "stability_players": stab_n,
            "dl_snaps": int(len(dl)),
        }

        # Play action (PA actual vs non-PA expected at the same down x exact yardsToGo)
        strata = ["down", "yardsToGo"]
        pa_t, pa_c = d["is_play_action"] == 1, d["is_play_action"] == 0
        pa_s = strat_adjust(d, pa_t, pa_c, "success", strata)
        pa_b = strat_adjust(d, pa_t, pa_c, "big", strata)
        pa_p = strat_adjust(d, pa_t, pa_c, "had_pressure", strata)
        pa_k = strat_adjust(d, pa_t, pa_c, "is_sack", strata)
        dtt = d[d["ttt"].notna()]
        pa_ttt = strat_adjust(dtt.assign(ttt_c=dtt["ttt"] / 100.0), dtt["is_play_action"] == 1,
                              dtt["is_play_action"] == 0, "ttt_c", strata)
        f10 = dtt[(dtt["down"] == 1) & (dtt["yardsToGo"] == 10)]
        dlp = dl[dl["down"] > 0].copy()
        dlp["sit"] = dlp["down"].astype(int).astype(str) + "_" + dlp["yardsToGo"].astype(int).astype(str)
        bpa, spa = fe_slope(dlp["getoff"].values, dlp["is_play_action"].values,
                            [dlp["nflId"].values, dlp["sit"].values], dlp["nflId"].values)
        roll = pm[pm["is_rollout"] == 1]
        pa_roll = pm[(pm["is_play_action"] == 1) & (pm["is_rollout"] == 1)]
        pa_noroll = pm[(pm["is_play_action"] == 1) & (pm["is_rollout"] == 0)]
        play_action = {
            "pa_rate": _pct(pm["is_play_action"].mean()),
            "pa_plays": int(pm["is_play_action"].sum()),
            "getoff_no_pa": _r(dl[dl["is_play_action"] == 0]["getoff"].mean(), 2),
            "getoff_pa": _r(dl[dl["is_play_action"] == 1]["getoff"].mean(), 2),
            "getoff_delta_adj": _r(bpa, 2),
            "getoff_delta_adj_z": _r(bpa / spa, 1) if spa > 0 else 0.0,
            "ttt_no_pa": _r(dtt[dtt["is_play_action"] == 0]["ttt"].median(), 1),
            "ttt_pa": _r(dtt[dtt["is_play_action"] == 1]["ttt"].median(), 1),
            "ttt_1st10_no_pa": _r(f10[f10["is_play_action"] == 0]["ttt"].median(), 1),
            "ttt_1st10_pa": _r(f10[f10["is_play_action"] == 1]["ttt"].median(), 1),
            "ttt_delta_adj": _r(pa_ttt["delta"], 2),
            "success_pa": pa_s["actual"], "success_expected": pa_s["expected"], "success_se": pa_s["se"],
            "big_pa": pa_b["actual"], "big_expected": pa_b["expected"], "big_z": pa_b["z"],
            "pressure_pa": pa_p["actual"], "pressure_expected": pa_p["expected"], "pressure_z": pa_p["z"],
            "sack_pa": pa_k["actual"], "sack_expected": pa_k["expected"], "sack_z": pa_k["z"],
            "n_compared": pa_s["n"],
            "rollout_sack": _pct(roll["is_sack"].mean()),
            "rollout_n": int(len(roll)),
            "pocket_sack": _pct(pm[pm["dropBackType"] == "TRADITIONAL"]["is_sack"].mean()),
            "rollout_pa_share": int(round(roll["is_play_action"].mean() * 100)) if len(roll) else 0,
            "pa_rollout_sack": _pct(pa_roll["is_sack"].mean()),
            "pa_rollout_n": int(len(pa_roll)),
            "pa_rollout_sacks": int(pa_roll["is_sack"].sum()),
            "pa_no_rollout_sack": _pct(pa_noroll["is_sack"].mean()),
            "pa_no_rollout_n": int(len(pa_noroll)),
        }

        # Blitz depends on the down
        overall = []
        for lbl, m in [("Rush 3–4", pm["is_blitz"] == 0), ("Blitz 5+", pm["is_blitz"] == 1)]:
            sub = pm[m]
            overall.append({"label": lbl, "plays": int(len(sub)), "pressure": _pct(sub["had_pressure"].mean()),
                            "sack": _pct(sub["is_sack"].mean()), "success": _pct(sub["success"].mean())})
        sits = [
            ("1ro y 2do down", d["down"] <= 2, "success"),
            ("3ro/4to y 1-3", (d["down"] >= 3) & (d["yardsToGo"] <= 3), "success"),
            ("3ro/4to y 4-6", (d["down"] >= 3) & d["yardsToGo"].between(4, 6), "success"),
            ("3ro/4to y 7+", (d["down"] >= 3) & (d["yardsToGo"] >= 7), "conversion"),
        ]
        by_sit = []
        adj_cells = {}
        for lbl, m, metric in sits:
            s = d[m]
            a = strat_adjust(s, s["is_blitz"] == 1, s["is_blitz"] == 0, metric, strata)
            adj_cells[lbl] = a
            by_sit.append({
                "situation": lbl, "metric": metric, "plays": int(len(s)), "blitz_plays": int(s["is_blitz"].sum()),
                "blitz_share": _pct(s["is_blitz"].mean()),
                "blitz_rate_actual": a["actual"], "non_blitz_expected": a["expected"],
                "adj_delta": a["delta"], "se": a["se"], "z": a["z"],
                "sack_blitz": _pct(s[s["is_blitz"] == 1]["is_sack"].mean()),
                "sack_rush4": _pct(s[s["is_blitz"] == 0]["is_sack"].mean()),
            })
        early, tl = adj_cells["1ro y 2do down"], adj_cells["3ro/4to y 7+"]
        diff = tl["delta"] - early["delta"]
        dse = float(np.hypot(early["se"], tl["se"]))
        third = d[d["third_long"] == 1]
        base = third[third["plan"] == "4 sin stunt"]
        vs_base = []
        for plan in ["4 con stunt", "Blitz sin stunt", "Blitz con stunt"]:
            a = strat_adjust(third, third["plan"] == plan, third["plan"] == "4 sin stunt", "conversion", strata)
            sub = third[third["plan"] == plan]
            vs_base.append({"plan": plan, "plays": int(len(sub)), "conversion": _pct(sub["conversion"].mean()),
                            "adj_delta": a["delta"], "se": a["se"], "z": a["z"], "sack": _pct(sub["is_sack"].mean())})
        blitz = {
            "overall": overall,
            "by_situation": by_sit,
            "third_long_sacks": {"rush4": _pct(third[third["is_blitz"] == 0]["is_sack"].mean()),
                                 "blitz": _pct(third[third["is_blitz"] == 1]["is_sack"].mean())},
            "flip": {"early": early["delta"], "third_long": tl["delta"], "diff": round(diff, 1),
                     "z": round(diff / dse, 1) if dse > 0 else 0.0},
            "third_long_plans": {
                "base": {"plan": "4 sin stunt", "plays": int(len(base)), "conversion": _pct(base["conversion"].mean()),
                         "sack": _pct(base["is_sack"].mean())},
                "vs_base": vs_base,
            },
        }

        # Rush plans (adjusted at the same down x exact yardsToGo vs "4 sin stunt")
        rush_plans = []
        for plan in PLAN_ORDER:
            sub = pm[pm["plan"] == plan]
            if plan == "4 sin stunt":
                a = {"delta": 0.0, "se": 0.0, "z": 0.0}
            else:
                a = strat_adjust(d, d["plan"] == plan, d["plan"] == "4 sin stunt", "success", strata)
            rush_plans.append({
                "plan": plan, "plays": int(len(sub)), "pressure": _pct(sub["had_pressure"].mean()),
                "sack": _pct(sub["is_sack"].mean()), "success": _pct(sub["success"].mean()),
                "adj_delta": a["delta"], "se": a["se"], "z": a["z"],
            })

        # Protection weak links (lost rep = hit/hurry/sack allowed or beaten)
        blk = self.blk
        groups = [
            ("Línea ofensiva, protección estándar (PP)",
             blk[(blk["pff_blockType"] == "PP") & blk["officialPosition"].isin(["T", "G", "C"])]),
            ("Corredor recogiendo blitz (PU)", blk[(blk["pff_blockType"] == "PU") & (blk["officialPosition"] == "RB")]),
            ("Corredor ayudando (BH)", blk[(blk["pff_blockType"] == "BH") & (blk["officialPosition"] == "RB")]),
        ]
        protection = [{"label": lbl, "reps": int(len(s)), "lost": _pct(s["lost"].mean()),
                       "sacks": int(s["sack_allowed"].sum())} for lbl, s in groups]

        return {
            "headline": headline,
            "cliff": cliff,
            "danger_zone": danger,
            "getoff": getoff,
            "play_action": play_action,
            "blitz": blitz,
            "rush_plans": rush_plans,
            "protection": protection,
        }

    def get_guerra(self) -> dict[str, Any]:
        return self._guerra_cache

    # ------------------------------------------------------------------ /api/qb-clocks
    def _qb_table(self) -> pd.DataFrame:
        q = self.pm[(self.pm["down"] > 0) & self.pm["ttt"].notna() & self.pm["qb_nflId"].notna()].copy()
        q["qb_nflId"] = q["qb_nflId"].astype(int)
        return q

    def _compute_qb_clocks(self) -> dict[str, Any]:
        q = self._qb_table()
        early, late = q[q["is_late"] == 0], q[q["is_late"] == 1]
        league = {
            "late_share": _pct(q["is_late"].mean()),
            "ttt_median": _r(q["ttt"].median(), 1),
            "success_early": _pct(early["success"].mean()),
            "success_late": _pct(late["success"].mean()),
            "drop": _r((early["success"].mean() - late["success"].mean()) * 100, 1),
            "threshold": LATE_T,
        }
        agg = q.groupby("qb_nflId").agg(
            name=("qb_name", "first"),
            team=("possessionTeam", lambda s: s.mode().iloc[0] if len(s) else ""),
            plays=("ttt", "size"),
            ttt_median=("ttt", "median"),
            late_share=("is_late", "mean"),
        ).reset_index()
        se = early.groupby("qb_nflId")["success"].mean().rename("success_early")
        sl = late.groupby("qb_nflId")["success"].mean().rename("success_late")
        agg = agg.merge(se, on="qb_nflId", how="left").merge(sl, on="qb_nflId", how="left")
        self.qb_all = agg
        lst = agg[agg["plays"] >= 150].sort_values("late_share", ascending=False)
        qbs = [{
            "nflId": int(r["qb_nflId"]), "name": str(r["name"]), "team": str(r["team"]), "plays": int(r["plays"]),
            "ttt_median": _r(r["ttt_median"], 1), "late_share": _pct(r["late_share"]),
            "success_early": _pct(r["success_early"]), "success_late": _pct(r["success_late"]),
        } for _, r in lst.iterrows()]

        def drop_fn(g: pd.DataFrame) -> float:
            e, l_ = g[g["is_late"] == 0]["success"], g[g["is_late"] == 1]["success"]
            return float(e.mean() - l_.mean()) if len(l_) >= 5 else np.nan

        st_late, n_late = split_half_corr(q, "qb_nflId", lambda g: g["is_late"].mean(), 40)
        st_ttt, _ = split_half_corr(q, "qb_nflId", lambda g: g["ttt"].median(), 40)
        st_drop, _ = split_half_corr(q, "qb_nflId", drop_fn, 40)
        return {
            "league": league,
            "qbs": qbs,
            "min_plays": 150,
            "stability": {"late_share": st_late, "ttt_median": st_ttt, "drop": st_drop, "qbs": n_late},
        }

    def get_qb_clocks(self) -> dict[str, Any]:
        return self._qb_cache

    # ------------------------------------------------------------------ /api/overview (trimmed)
    def _compute_overview(self) -> dict[str, Any]:
        pm = self.pm
        blk = self.blk

        blk_schemes = []
        for code in ["PP", "PA", "SW", "PT", "CL", "UP", "PU", "BH", "CH", "SR", "PR", "NB"]:
            sub = blk[blk["pff_blockType"] == code]
            if len(sub) > 0:
                blk_schemes.append({
                    "code": code, "label": BLOCK_TYPE_LABELS.get(code, code), "snaps": int(len(sub)),
                    "pressure_allowed_rate": _pct(sub["allowed_pressure"].mean()),
                    "lost_rate": _pct(sub["lost"].mean()),
                    "sack_allowed_rate": _pct(sub["sack_allowed"].mean()),
                })

        ol_lanes = []
        for lane in OL_LANES:
            sub = blk[blk["pff_positionLinedUp"] == lane]
            ol_lanes.append({
                "lane": lane, "snaps": int(len(sub)),
                "pressure_allowed_rate": _pct(sub["allowed_pressure"].mean()),
                "beaten_rate": _pct(sub["beaten"].mean()),
                "sack_allowed_rate": _pct(sub["sack_allowed"].mean()),
            })

        team_matrix = []
        for team, grp in pm.groupby("defensiveTeam"):
            g4 = grp[grp["is_blitz"] == 0]
            off_grp = pm[pm["possessionTeam"] == team]
            team_matrix.append({
                "team": str(team),
                "teamName": TEAM_NAMES.get(str(team), str(team)),
                "def_plays": int(len(grp)),
                "blitz_rate": _pct(grp["is_blitz"].mean()),
                "press_rate": _pct(grp["had_pressure"].mean()),
                "press_rate_4man": _pct(g4["had_pressure"].mean()) if len(g4) else 0.0,
                "plays_4man": int(len(g4)),
                "stunt_rate": _pct(grp["has_stunt"].mean()),
                "sack_rate": _pct(grp["is_sack"].mean()),
                "avg_yds_allowed": _r(grp["playResult"].mean(), 2),
                "off_press_allowed_rate": _pct(off_grp["had_pressure"].mean()) if len(off_grp) else 0.0,
                "off_avg_yds": _r(off_grp["playResult"].mean(), 2) if len(off_grp) else 0.0,
            })
        team_matrix.sort(key=lambda x: x["press_rate_4man"], reverse=True)

        h = self._guerra_cache["headline"]
        return {
            "summary": {
                "total_games": int(len(self.games)),
                "total_plays": int(len(pm)),
                "tracked_plays": h["tracked_plays"],
                "rusher_snaps": h["rusher_snaps"],
                "total_players": int(len(self.players)),
                "weeks": f"1–{int(self.games['week'].max())}",
                "season": int(self.games["season"].iloc[0]),
                "league_pressure_rate": _pct(pm["had_pressure"].mean()),
                "league_sack_rate": _pct(pm["is_sack"].mean()),
                "clean_comp_rate": h["clean_comp"],
                "pressured_comp_rate": h["pressured_comp"],
                "clean_success": h["clean_success"],
                "pressured_success": h["pressured_success"],
            },
            "block_schemes": blk_schemes,
            "ol_lanes": ol_lanes,
            "team_matrix": team_matrix,
        }

    def get_overview(self) -> dict[str, Any]:
        return self._overview_cache

    # ------------------------------------------------------------------ /api/players
    def _compute_player_leaderboards(self) -> dict[str, Any]:
        rt = self.rush_trk
        dl = self.dl
        blk = self.blk

        dlr = rt[rt["officialPosition"].isin(DL_POS)]
        agg = dlr.groupby("nflId").agg(
            name=("displayName", "first"),
            position=("officialPosition", "first"),
            group=("group", "first"),
            team=("defensiveTeam", lambda s: s.mode().iloc[0] if len(s) else ""),
            snaps=("pressure", "size"),
            pressures=("pressure", "sum"),
            pressure_rate=("pressure", "mean"),
            sacks=("sack", "sum"),
            strain_avg=("strain", "mean"),
        ).reset_index()
        go = dl.groupby("nflId")["getoff"].agg(getoff_avg="mean", getoff_median="median").reset_index()
        agg = agg.merge(go, on="nflId", how="inner")
        agg = agg[agg["snaps"] >= 150].copy()
        agg["getoff_score"] = 0.0
        for g, idx in agg.groupby("group").groups.items():
            v = -agg.loc[idx, "getoff_avg"]
            rng = float(v.max() - v.min())
            agg.loc[idx, "getoff_score"] = (v - v.min()) / rng * 100.0 if rng > 0 else 50.0
        agg = agg.sort_values("getoff_score", ascending=False)
        getoff_leaders = [{
            "nflId": int(r["nflId"]), "name": str(r["name"]), "team": str(r["team"]),
            "position": str(r["position"]), "group": str(r["group"]), "snaps": int(r["snaps"]),
            "getoff_avg": _r(r["getoff_avg"], 3), "getoff_median": _r(r["getoff_median"], 2),
            "strain_avg": _r(r["strain_avg"], 3), "pressure_rate": _pct(r["pressure_rate"]),
            "pressures": int(r["pressures"]), "sacks": int(r["sacks"]), "getoff_score": _r(r["getoff_score"], 1),
        } for _, r in agg.iterrows()]
        group_avgs = {g: _r(dl[dl["group"] == g]["getoff"].mean(), 3) for g in ["Edge", "Interior"]}
        press_stab, press_n = split_half_corr(dlr, "nflId", lambda g: g["pressure"].mean(), 60)

        ol = blk[blk["officialPosition"].isin(["T", "G", "C"])].copy()
        ol = ol.merge(self.players[["nflId", "displayName"]], on="nflId", how="left")
        ol_agg = ol.groupby(["nflId", "displayName", "officialPosition"]).agg(
            snaps=("allowed_pressure", "count"),
            pressures_allowed=("allowed_pressure", "sum"),
            sacks_allowed=("sack_allowed", "sum"),
            clean_rate=("allowed_pressure", lambda s: 1.0 - s.mean()),
            beaten_rate=("beaten", "mean"),
            lost_rate=("lost", "mean"),
            team=("possessionTeam", lambda s: s.mode().iloc[0] if len(s) else ""),
            lane=("pff_positionLinedUp", lambda s: s.mode().iloc[0] if len(s) else ""),
            stunt_snaps=("pff_blockType", lambda s: int((s == "SW").sum())),
        ).reset_index()
        ol_agg = ol_agg[ol_agg["snaps"] >= 150].copy()
        ol_agg["iron_score"] = ol_agg["clean_rate"] * 70.0 + (1.0 - ol_agg["beaten_rate"]) * 30.0
        ol_agg = ol_agg.sort_values(["iron_score", "snaps"], ascending=[False, False])
        linemen = [{
            "nflId": int(r["nflId"]), "displayName": str(r["displayName"]), "position": str(r["officialPosition"]),
            "lane": str(r["lane"]), "team": str(r["team"]), "snaps": int(r["snaps"]),
            "pressures_allowed": int(r["pressures_allowed"]), "sacks_allowed": int(r["sacks_allowed"]),
            "clean_rate": _pct(r["clean_rate"]), "beaten_rate": _pct(r["beaten_rate"]),
            "lost_rate": _pct(r["lost_rate"]), "stunt_snaps": int(r["stunt_snaps"]), "iron_score": _r(r["iron_score"], 1),
        } for _, r in ol_agg.head(80).iterrows()]

        return {
            "getoff_leaders": getoff_leaders,
            "getoff_meta": {
                "min_snaps": 150,
                "group_avg": group_avgs,
                "stability": self._guerra_cache["getoff"]["stability"],
                "pressure_stability": press_stab,
                "pressure_stability_players": press_n,
            },
            "linemen": linemen,
            "qbs": self._qb_cache["qbs"],
            "qb_league": self._qb_cache["league"],
            "qb_stability": self._qb_cache["stability"],
        }

    def get_players(self) -> dict[str, Any]:
        return self._players_cache

    # ------------------------------------------------------------------ play summaries & showcase
    def _format_play_summary(self, row: pd.Series, tag: str = "", headline: str = "") -> dict[str, Any]:
        ttt = row.get("ttt")
        succ = row.get("success")
        return {
            "gameId": int(row["gameId"]),
            "playId": int(row["playId"]),
            "week": int(row["week"]) if pd.notna(row["week"]) else 0,
            "matchup": f"{row['visitorTeamAbbr']} @ {row['homeTeamAbbr']}",
            "offense": str(row["possessionTeam"]),
            "defense": str(row["defensiveTeam"]),
            "quarter": int(row["quarter"]),
            "gameClock": str(row["gameClock"]),
            "down": int(row["down"]),
            "yardsToGo": int(row["yardsToGo"]),
            "passResult": str(row["passResult"]),
            "playResult": int(row["playResult"]),
            "qb": str(row["qb_name"]) if pd.notna(row.get("qb_name")) else "",
            "formation": str(row["offenseFormation"]) if pd.notna(row["offenseFormation"]) else "",
            "dropBackType": str(row["dropBackType"]) if pd.notna(row["dropBackType"]) else "",
            "coverage": str(row["pff_passCoverage"]) if pd.notna(row["pff_passCoverage"]) else "",
            "n_rushers": int(row["n_rushers"]),
            "n_blockers": int(row["n_blockers"]),
            "n_dt_rushers": int(row["n_dt_rushers"]),
            "n_free_rushers": int(row["n_free_rushers"]),
            "has_stunt": bool(row["has_stunt"]),
            "is_blitz": bool(row["is_blitz"]),
            "is_play_action": bool(row["is_play_action"]),
            "had_pressure": bool(row["had_pressure"]),
            "ttt": _opt(ttt, 1),
            "endEvent": str(row["endEvent"]) if pd.notna(row.get("endEvent")) else "",
            "success": (bool(succ) if pd.notna(succ) else None),
            "is_big": bool(row["big"]),
            "description": str(row["playDescription"]),
            "tag": tag,
            "headline": headline,
        }

    def _compute_showcase_plays(self) -> list[dict[str, Any]]:
        pm = self.pm
        rt = self.rush_trk
        out: list[dict[str, Any]] = []
        used: set[tuple[int, int]] = set()

        def pick(candidates: pd.DataFrame, tag: str, headline: str) -> None:
            for _, row in candidates.iterrows():
                key = (int(row["gameId"]), int(row["playId"]))
                if key not in used and (TRACKING_DIR / f"tracking_{key[0]}.csv").exists():
                    used.add(key)
                    out.append(self._format_play_summary(row, tag=tag, headline=headline))
                    return

        # 1. Get-off que gana: sack by a rusher who got off in <= 0.6 s (prefer Garrett / Crosby)
        fast = rt[(rt["sack"] == 1) & (rt["getoff"] <= 0.6)].copy()
        fast["star"] = fast["displayName"].isin(["Myles Garrett", "Maxx Crosby"]).astype(int)
        fast = fast.sort_values(["star", "getoff"], ascending=[False, True])
        for _, fr in fast.iterrows():
            row = pm[(pm["gameId"] == fr["gameId"]) & (pm["playId"] == fr["playId"])]
            if len(row):
                n0 = len(out)
                pick(row, "GET-OFF QUE GANA", f"{fr['displayName']} arranca en {fr['getoff']:.1f} s y llega al sack")
                if len(out) > n0:
                    break

        # 2. Play action congela: PA, no pressure, ttt >= 3.5, completion >= 15 yds
        c = pm[(pm["is_play_action"] == 1) & (pm["had_pressure"] == 0) & (pm["ttt"] >= 3.5)
               & (pm["passResult"] == "C") & (pm["playResult"] >= 15)]
        pick(c.sort_values("playResult", ascending=False), "PLAY ACTION",
             "El amague congela a la defensa: pocket limpio y jugada grande")

        # 3. Zona de peligro: sack after 4.0 s
        c = pm[(pm["is_sack"] == 1) & (pm["ttt"] > 4.0) & (pm["ttt"] <= 5.0) & (pm["endEvent"] == "qb_sack")]
        c = c.assign(_k=(c["ttt"] - 4.5).abs()).sort_values(["_k", "playResult"])
        pick(c, "ZONA DE PELIGRO", "Pasados los 3.5 s: el reloj del QB se acaba")

        # 4. Stunt de 4: 4 rushers, stunt, sack
        c = pm[(pm["n_rushers"] == 4) & (pm["has_stunt"] == 1) & (pm["is_sack"] == 1)]
        c = c.assign(_k=(~c["endEvent"].isin(["qb_sack", "qb_strip_sack"])).astype(int)).sort_values(["_k", "ttt"])
        pick(c, "STUNT DE 4", "Rush de 4 con stunt: sack sin mandar a nadie más")

        # 5. Blitz en 3ro y largo que termina en conversión
        c = pm[(pm["is_blitz"] == 1) & (pm["down"] == 3) & (pm["yardsToGo"] >= 7) & (pm["conversion"] == 1)]
        pick(c.sort_values("playResult", ascending=False), "BLITZ EN 3RO Y LARGO",
             "Más sacks, pero también más conversiones")

        # 6. Pase rápido vence al blitz
        c = pm[(pm["is_blitz"] == 1) & (pm["ttt"] <= 2.3) & (pm["passResult"] == "C") & (pm["playResult"] >= 15)]
        pick(c.sort_values("playResult", ascending=False), "PASE RÁPIDO",
             "El QB suelta antes de 2.3 s y le gana al blitz")

        # 7. Aaron Donald sack
        ad = rt[(rt["displayName"] == "Aaron Donald") & (rt["sack"] == 1)]
        c = pm.merge(ad[["gameId", "playId"]].drop_duplicates(), on=["gameId", "playId"])
        pick(c.sort_values("ttt"), "INTERIOR ÉLITE", "Aaron Donald parte el pocket por dentro")

        # 8. Spotlight NFL México (MIN / SF)
        c = pm[(pm["defensiveTeam"].isin(["MIN", "SF"])) & (pm["is_sack"] == 1)]
        c = c.assign(_k=(~c["endEvent"].isin(["qb_sack", "qb_strip_sack"])).astype(int)).sort_values(["_k", "ttt"])
        pick(c, "SPOTLIGHT NFL MÉXICO", "Vikings / 49ers: sack de la línea defensiva")
        return out

    # ------------------------------------------------------------------ /api/team/{team}
    def _team_qb_clock(self, team: str) -> dict[str, Any]:
        q = self._qb_table()
        tq = q[q["possessionTeam"] == team]
        league = self._qb_cache["league"]
        if len(tq) == 0:
            return {"qb": "", "plays": 0, "late_share": 0.0, "ttt_median": 0.0, "league_late_share": league["late_share"],
                    "league_ttt_median": league["ttt_median"], "league_drop": league["drop"], "holds_ball": False}
        top = int(tq["qb_nflId"].value_counts().index[0])
        s = tq[tq["qb_nflId"] == top]
        late = _pct(s["is_late"].mean())
        return {
            "qb": str(s["qb_name"].iloc[0]),
            "plays": int(len(s)),
            "late_share": late,
            "ttt_median": _r(s["ttt"].median(), 1),
            "league_late_share": league["late_share"],
            "league_ttt_median": league["ttt_median"],
            "league_drop": league["drop"],
            "holds_ball": bool(late >= league["late_share"]),
            "stability": self._qb_cache["stability"]["late_share"],
        }

    def get_team_gameplan(self, team: str) -> dict[str, Any]:
        team = team.upper()
        pm = self.pm
        blk = self.blk
        g = self._guerra_cache

        off_plays = pm[pm["possessionTeam"] == team]
        def_plays = pm[pm["defensiveTeam"] == team]
        if len(off_plays) == 0 and len(def_plays) == 0:
            raise KeyError(f"Equipo desconocido: {team}")

        # OL lane heatmap (trend: weakest lane repeats between halves in 12/32 teams)
        team_blk = blk[blk["possessionTeam"] == team]
        ol_heatmap = []
        for lane in OL_LANES:
            sub = team_blk[team_blk["pff_positionLinedUp"] == lane]
            starter_name, starter_snaps = "—", 0
            if len(sub) > 0:
                vc = sub["nflId"].value_counts()
                starter_snaps = int(vc.iloc[0])
                starter_name = self.player_map.get(int(vc.index[0]), {}).get("displayName", str(vc.index[0]))
            press_r = _pct(sub["allowed_pressure"].mean()) if len(sub) else 0.0
            ol_heatmap.append({
                "lane": lane, "starter": starter_name, "starter_snaps": starter_snaps,
                "total_snaps": int(len(sub)), "n": int(len(sub)),
                "pressures": int(sub["allowed_pressure"].sum()),
                "pressure_allowed_rate": press_r,
                "beaten_rate": _pct(sub["beaten"].mean()) if len(sub) else 0.0,
                "sacks_allowed": int(sub["sack_allowed"].sum()),
                "low_sample": bool(len(sub) < 50),
                "risk_level": "HIGH" if press_r >= 7.5 else ("MED" if press_r >= 4.5 else "LOW"),
            })
        valid_lanes = [x for x in ol_heatmap if x["total_snaps"] >= 50] or ol_heatmap
        weakest_lane = max(valid_lanes, key=lambda x: x["pressure_allowed_rate"])

        qb_clock = self._team_qb_clock(team)

        # Team get-off vs league, relative to each rusher's position group (trend only)
        tdl = self.dl[self.dl["defensiveTeam"] == team]
        rel = (tdl["getoff"] - tdl["group_mean"]).mean() if len(tdl) else np.nan
        dlt = self.dl.assign(rel=self.dl["getoff"] - self.dl["group_mean"])
        team_stab, _ = split_half_corr(dlt, "defensiveTeam", lambda x: x["rel"].mean(), 200)
        def_getoff = {
            "team_avg": _r(tdl["getoff"].mean(), 3),
            "league_avg": _r(self.dl["getoff"].mean(), 3),
            "vs_group_avg": _r(rel, 3),
            "snaps": int(len(tdl)),
            "label": "Tendencia",
            "stability": team_stab,
        }

        team_rush = self.rush_trk[(self.rush_trk["defensiveTeam"] == team)]
        top_rushers = []
        if len(team_rush):
            ra = team_rush.groupby("nflId").agg(
                name=("displayName", "first"), position=("officialPosition", "first"), group=("group", "first"),
                snaps=("pressure", "size"), pressures=("pressure", "sum"), sacks=("sack", "sum"),
                press_rate=("pressure", "mean"),
            ).reset_index()
            gom = tdl.groupby("nflId")["getoff"].mean().rename("getoff_avg")
            ra = ra.merge(gom, on="nflId", how="left")
            ra = ra[ra["snaps"] >= 35].sort_values("pressures", ascending=False)
            for _, r in ra.head(5).iterrows():
                top_rushers.append({
                    "nflId": int(r["nflId"]), "displayName": str(r["name"]), "position": str(r["position"]),
                    "group": str(r["group"]), "snaps": int(r["snaps"]), "pressures": int(r["pressures"]),
                    "sacks": int(r["sacks"]), "press_rate": _pct(r["press_rate"]),
                    "getoff_avg": _opt(r["getoff_avg"], 2),
                })

        league_blitz = _pct(pm["is_blitz"].mean())
        team_blitz = _pct(def_plays["is_blitz"].mean()) if len(def_plays) else 0.0
        pa_rate = _pct(off_plays["is_play_action"].mean()) if len(off_plays) else 0.0
        pa = g["play_action"]
        tl_plans = {p["plan"]: p for p in g["blitz"]["third_long_plans"]["vs_base"]}
        blitz_tl = next(x for x in g["blitz"]["by_situation"] if x["situation"] == "3ro/4to y 7+")
        prot = g["protection"]

        # Hints when YOUR defense faces this offense
        wl = weakest_lane
        attack_this_oline = [
            f"Ataca el carril {wl['lane']} ({wl['starter']}): permitió presión en {wl['pressure_allowed_rate']}% de "
            f"{wl['total_snaps']} bloqueos ({wl['sacks_allowed']} {'sack' if wl['sacks_allowed'] == 1 else 'sacks'}). "
            f"Tendencia de 8 semanas.",
        ]
        if qb_clock["plays"]:
            if qb_clock["holds_ball"]:
                attack_this_oline.append(
                    f"Su QB {qb_clock['qb']} sostiene el balón más de 3.5 s en {qb_clock['late_share']}% de sus pases "
                    f"(liga: {qb_clock['league_late_share']}%). Pasado ese punto los QB de la liga pierden "
                    f"~{qb_clock['league_drop']} pts de éxito: cubre largo, rush de 4 con stunt y oblígalo a esperar.")
            else:
                attack_this_oline.append(
                    f"Su QB {qb_clock['qb']} suelta rápido (mediana {qb_clock['ttt_median']} s; solo "
                    f"{qb_clock['late_share']}% pasa de 3.5 s): no apuestes a la cobertura larga, gana con get-off.")
        best_plan = min(tl_plans.values(), key=lambda p: p["adj_delta"]) if tl_plans else None
        tls = g["blitz"]["third_long_sacks"]
        if blitz_tl["adj_delta"] > 0:
            blitz_txt = (f"pero no baja las conversiones (a la misma distancia permite ~{_signed(blitz_tl['adj_delta'])} "
                         f"pts de conversión)")
        else:
            blitz_txt = f"y baja las conversiones {_signed(blitz_tl['adj_delta'])} pts a la misma distancia"
        best_txt = ""
        if best_plan is not None and best_plan["adj_delta"] < 0:
            best_txt = (f" Ahí, el {best_plan['plan'].replace('4 ', 'rush de 4 ')} fue la mejor opción "
                        f"({_signed(best_plan['adj_delta'])} pts vs rush de 4 sin stunt, muestra chica).")
        attack_this_oline.append(
            f"En 3er down y 7+, el blitz da más sacks ({tls['blitz']}% vs {tls['rush4']}%) {blitz_txt}.{best_txt} "
            f"Guarda el blitz para 1ro/2do y 3ro corto.")

        # Hints when YOUR offense faces this defense
        beat_this_defense = [
            f"Play action para la jugada grande: en la liga, a la misma down y distancia, da {pa['big_pa']}% de "
            f"jugadas de 20+ yardas vs {pa['big_expected']}% (mismo éxito). Cuesta presión; con rollout los sacks "
            f"bajan a {pa['pa_rollout_sack']}%. Tu ofensiva lo usa en {pa_rate}% de sus pases.",
            f"{team} blitzea en {team_blitz}% de los pases (liga: {league_blitz}%). No dejes al corredor solo "
            f"recogiendo blitz: pierde {prot[1]['lost']}% de sus duelos (la línea, {prot[0]['lost']}%). Mandarlo a la "
            f"ruta contra blitz no empeora el resultado.",
        ]
        if top_rushers:
            tr0 = top_rushers[0]
            go_txt = f", get-off promedio {tr0['getoff_avg']} s" if tr0["getoff_avg"] is not None else ""
            beat_this_defense.append(
                f"Su rusher más peligroso es {tr0['displayName']} ({tr0['pressures']} presiones en {tr0['snaps']} "
                f"snaps{go_txt}): diseña lecturas que salgan antes de 3.5 s hacia su lado.")

        # Film room shortcuts
        def_highlights = def_plays.sort_values(["is_sack", "has_stunt", "total_pressures"], ascending=False).head(4)
        off_highlights = off_plays.sort_values(["playResult"], ascending=False).head(4)
        team_plays = [
            self._format_play_summary(r, tag="DEFENSA", headline=f"Defensa de {team}: {r['passResult']} ({r['playResult']} yds)")
            for _, r in def_highlights.iterrows()
        ] + [
            self._format_play_summary(r, tag="OFENSIVA", headline=f"Ofensiva de {team}: +{r['playResult']} yds")
            for _, r in off_highlights.iterrows()
        ]

        return {
            "team": team,
            "teamName": TEAM_NAMES.get(team, team),
            "offense": {
                "plays": int(len(off_plays)),
                "pressure_allowed_rate": _pct(off_plays["had_pressure"].mean()),
                "sack_rate": _pct(off_plays["is_sack"].mean()),
                "comp_rate": _pct(off_plays["comp_att"].mean()),
                "avg_yards": _r(off_plays["playResult"].mean(), 2),
                "play_action_rate": pa_rate,
                "pa_rate": pa_rate,
                "league_pa_rate": pa["pa_rate"],
                "rollout_rate": _pct(off_plays["is_rollout"].mean()),
                "ol_heatmap": ol_heatmap,
                "weakest_lane": weakest_lane,
                "qb_clock": qb_clock,
            },
            "defense": {
                "plays": int(len(def_plays)),
                "pressure_rate": _pct(def_plays["had_pressure"].mean()),
                "press_rate_4man": _pct(def_plays[def_plays["is_blitz"] == 0]["had_pressure"].mean()),
                "blitz_rate": team_blitz,
                "league_blitz_rate": league_blitz,
                "stunt_rate": _pct(def_plays["has_stunt"].mean()),
                "sack_rate": _pct(def_plays["is_sack"].mean()),
                "avg_yards_allowed": _r(def_plays["playResult"].mean(), 2),
                "def_getoff": def_getoff,
                "top_rushers": top_rushers,
            },
            "qb_clock": qb_clock,
            "def_getoff_avg": def_getoff,
            "pa_rate": pa_rate,
            "attack_this_oline": attack_this_oline,
            "beat_this_defense": beat_this_defense,
            "featured_plays": team_plays,
        }

    def list_plays(self, team: str | None = None, category: str | None = None, limit: int = 30) -> dict[str, Any]:
        sub = self.pm
        if team:
            t = team.upper()
            sub = sub[(sub["possessionTeam"] == t) | (sub["defensiveTeam"] == t)]
        if category == "sack":
            sub = sub[sub["is_sack"] == 1]
        elif category == "stunt":
            sub = sub[(sub["n_rushers"] <= 4) & (sub["has_stunt"] == 1) & (sub["had_pressure"] == 1)]
        elif category == "rollout":
            sub = sub[sub["is_rollout"] == 1]
        elif category == "blitz_3rd_long":
            sub = sub[(sub["third_long"] == 1) & (sub["is_blitz"] == 1)]
        elif category == "cliff":
            sub = sub[sub["ttt"] > LATE_T]
        elif category == "play_action":
            sub = sub[sub["is_play_action"] == 1]
        sub = sub.sort_values(["is_sack", "total_pressures", "playResult"], ascending=[False, False, False]).head(limit)
        return {
            "showcase": self._showcase_cache,
            "plays": [self._format_play_summary(row) for _, row in sub.iterrows()],
        }

    # ------------------------------------------------------------------ 10 Hz tracking & physics
    @staticmethod
    @lru_cache(maxsize=16)
    def _load_game_tracking(game_id: int) -> pd.DataFrame:
        path = TRACKING_DIR / f"tracking_{game_id}.csv"
        if not path.exists():
            raise FileNotFoundError(f"No hay archivo de tracking para el juego {game_id}")
        return pd.read_csv(
            path,
            usecols=["playId", "nflId", "frameId", "jerseyNumber", "team",
                     "playDirection", "x", "y", "s", "a", "o", "dir", "event"],
        )

    def get_play_tracking(self, game_id: int, play_id: int) -> dict[str, Any]:
        play_rows = self.pm[(self.pm["gameId"] == game_id) & (self.pm["playId"] == play_id)]
        if len(play_rows) == 0:
            raise KeyError(f"Jugada {game_id}/{play_id} no encontrada")
        prow = play_rows.iloc[0]

        tr_game = self._load_game_tracking(game_id)
        tr = tr_game[tr_game["playId"] == play_id].copy()
        if len(tr) == 0:
            raise KeyError(f"Sin frames de tracking para {game_id}/{play_id}")

        play_dir = str(tr["playDirection"].iloc[0])
        if play_dir == "left":
            tr["x"] = 120.0 - tr["x"]
            tr["y"] = 53.3 - tr["y"]
            tr["o"] = (tr["o"] + 180.0) % 360.0
            tr["dir"] = (tr["dir"] + 180.0) % 360.0
        los_x = float(prow["absoluteYardlineNumber"]) if pd.notna(prow["absoluteYardlineNumber"]) else 50.0
        if play_dir == "left":
            los_x = 120.0 - los_x

        snap_frames = tr[tr["event"].isin(SNAP_EVENTS)]["frameId"]
        snap_frame = int(snap_frames.min()) if len(snap_frames) > 0 else int(tr["frameId"].min())
        end_event = str(prow["endEvent"]) if pd.notna(prow.get("endEvent")) else ""
        if pd.notna(prow.get("ttt")):
            ttt = float(prow["ttt"])
        else:
            ends = tr[tr["event"].isin(END_EVENTS) & (tr["frameId"] > snap_frame)]
            if len(ends):
                ttt = round((int(ends["frameId"].min()) - snap_frame) * 0.1, 1)
                end_event = str(ends.sort_values("frameId")["event"].iloc[0])
            else:
                ttt = round((int(tr["frameId"].max()) - snap_frame) * 0.1, 1)

        pff_play = self.pff[(self.pff["gameId"] == game_id) & (self.pff["playId"] == play_id)]
        role_meta: dict[int, dict[str, Any]] = {}
        matchup_edges: list[dict[str, Any]] = []
        rusher_blocker_counts: dict[int, int] = {}
        for _, r in pff_play.iterrows():
            nid = int(r["nflId"])
            pinfo = self.player_map.get(nid, {})
            blocked_target = int(r["pff_nflIdBlockedPlayer"]) if pd.notna(r["pff_nflIdBlockedPlayer"]) else None
            if blocked_target is not None:
                rusher_blocker_counts[blocked_target] = rusher_blocker_counts.get(blocked_target, 0) + 1
                matchup_edges.append({
                    "blockerId": nid, "rusherId": blocked_target,
                    "blockType": str(r["pff_blockType"]) if pd.notna(r["pff_blockType"]) else "",
                })
            role = str(r["pff_role"]) if pd.notna(r["pff_role"]) else ""
            go = self.getoff_lookup.get((game_id, play_id, nid)) if role == "Pass Rush" else None
            role_meta[nid] = {
                "nflId": nid,
                "name": pinfo.get("displayName", str(nid)),
                "officialPos": pinfo.get("officialPosition", ""),
                "role": role,
                "linedUp": str(r["pff_positionLinedUp"]) if pd.notna(r["pff_positionLinedUp"]) else "",
                "blockType": str(r["pff_blockType"]) if pd.notna(r["pff_blockType"]) else "",
                "blockTypeLabel": BLOCK_TYPE_LABELS.get(str(r["pff_blockType"]), "") if pd.notna(r["pff_blockType"]) else "",
                "blockedTarget": blocked_target,
                "generatedPressure": bool(r["pff_hit"] == 1 or r["pff_hurry"] == 1 or r["pff_sack"] == 1),
                "sack": bool(r["pff_sack"] == 1),
                "hit": bool(r["pff_hit"] == 1),
                "hurry": bool(r["pff_hurry"] == 1),
                "allowedPressure": bool(r["pff_hitAllowed"] == 1 or r["pff_hurryAllowed"] == 1 or r["pff_sackAllowed"] == 1),
                "beaten": bool(r["pff_beatenByDefender"] == 1),
                "getoff": round(go, 1) if go is not None else None,
                "getoffMedian": self.player_getoff_median.get(nid) if role == "Pass Rush" else None,
            }
        for nid, meta in role_meta.items():
            cnt = rusher_blocker_counts.get(nid, 0) if meta["role"] == "Pass Rush" else 0
            meta["blockersAssigned"] = cnt
            meta["isDoubleTeamed"] = cnt >= 2
            meta["isFreeRusher"] = False  # PFF first-target coding makes "free rusher" unreliable (stunts)
        for edge in matchup_edges:
            edge["isDoubleTeam"] = rusher_blocker_counts.get(edge["rusherId"], 0) >= 2

        qb_ids = [nid for nid, m in role_meta.items() if m["role"] == "Pass"]
        qb_id = qb_ids[0] if qb_ids else None
        rusher_ids = {nid for nid, m in role_meta.items() if m["role"] == "Pass Rush"}
        ol_ids = {nid for nid, m in role_meta.items() if m["role"] == "Pass Block"}

        frames_out: list[dict[str, Any]] = []
        telemetry_out: list[dict[str, Any]] = []
        prev_min_dist: float | None = None
        peak_collapse_vel = 0.0
        min_pocket_radius = 99.0
        closest_rusher_name = ""
        closest_frame_idx = 0
        key_events: list[dict[str, Any]] = []
        seen_events: set[str] = set()
        last_threat = "CLEAN"
        throw_frame_idx = 0

        for idx, (fid, fdf) in enumerate(tr.groupby("frameId", sort=True)):
            fid_int = int(fid)
            t_sec = round((fid_int - snap_frame) * 0.1, 1)
            in_dropback = t_sec <= ttt + 1e-9
            if in_dropback:
                throw_frame_idx = idx
            ev_series = fdf["event"].dropna()
            ev = str(ev_series.iloc[0]) if len(ev_series) > 0 else ""
            if ev and ev not in seen_events:
                seen_events.add(ev)
                key_events.append({"frameIndex": idx, "frameId": fid_int, "t": t_sec, "event": ev})

            players_frame = []
            ball_pos = None
            qb_pos = None
            rush_pts: list[tuple[int, float, float, float, float]] = []
            ol_pts: list[tuple[float, float]] = []
            for pr in fdf.itertuples(index=False):
                px, py = float(pr.x), float(pr.y)
                if str(pr.team) == "football" or pd.isna(pr.nflId):
                    ball_pos = {"x": round(px, 2), "y": round(py, 2)}
                    continue
                nid = int(pr.nflId)
                spd = float(pr.s) if pd.notna(pr.s) else 0.0
                dr = float(pr.dir) if pd.notna(pr.dir) else 0.0
                if nid == qb_id:
                    qb_pos = (px, py)
                if nid in rusher_ids:
                    rush_pts.append((nid, px, py, spd, dr))
                if nid in ol_ids:
                    ol_pts.append((px, py))
                players_frame.append({
                    "id": nid, "t": str(pr.team),
                    "j": int(pr.jerseyNumber) if pd.notna(pr.jerseyNumber) else 0,
                    "x": round(px, 2), "y": round(py, 2), "s": round(spd, 2),
                    "o": round(float(pr.o), 1) if pd.notna(pr.o) else 0.0, "d": round(dr, 1),
                })

            min_dist = 12.0
            nearest_id = None
            max_closing = 0.0
            if qb_pos is not None and rush_pts:
                qx, qy = qb_pos
                for rnid, rx, ry, rspd, rdir in rush_pts:
                    dx, dy = qx - rx, qy - ry
                    dist = float(np.hypot(dx, dy))
                    if dist < min_dist:
                        min_dist = dist
                        nearest_id = rnid
                    if dist > 0.05:
                        rad = np.deg2rad(rdir)
                        closing = (rspd * np.sin(rad) * dx + rspd * np.cos(rad) * dy) / dist
                        max_closing = max(max_closing, float(closing))
            collapse_vel = max(0.0, (prev_min_dist - min_dist) / 0.1) if prev_min_dist is not None else 0.0
            prev_min_dist = min_dist

            pocket_area = 0.0
            if qb_pos is not None and len(ol_pts) >= 3:
                xs = [p[0] for p in ol_pts] + [qb_pos[0]]
                ys = [p[1] for p in ol_pts] + [qb_pos[1]]
                pocket_area = (max(xs) - min(xs)) * (max(ys) - min(ys))

            # Metrics are measured only during the dropback (tracking continues ~0.5 s after the throw).
            if in_dropback:
                if t_sec >= 0.0 and min_dist < min_pocket_radius:
                    min_pocket_radius = min_dist
                    closest_frame_idx = idx
                    if nearest_id is not None:
                        closest_rusher_name = role_meta.get(nearest_id, {}).get("name", "")
                if t_sec >= 0.0 and collapse_vel > peak_collapse_vel:
                    peak_collapse_vel = collapse_vel
                last_threat = "COLLAPSE" if min_dist < 2.5 else ("CLOSING" if min_dist < 4.2 else "CLEAN")

            frames_out.append({
                "frameId": fid_int, "t": t_sec, "event": ev, "ball": ball_pos,
                "qb": {"x": round(qb_pos[0], 2), "y": round(qb_pos[1], 2)} if qb_pos else None,
                "minDist": round(min_dist, 2), "nearestRusherId": nearest_id,
                "threat": last_threat, "postThrow": not in_dropback,
                "players": players_frame,
            })
            telemetry_out.append({
                "frameIndex": idx, "t": t_sec, "pocketRadius": round(min_dist, 2),
                "closingSpeed": round(max_closing, 2), "collapseRate": round(collapse_vel, 2),
                "pocketArea": round(pocket_area, 1), "event": ev, "postThrow": not in_dropback,
            })

        all_x = tr["x"].dropna()
        x_min = max(0.0, float(np.percentile(all_x, 5)) - 8.0)
        x_max = min(120.0, float(np.percentile(all_x, 95)) + 8.0)
        x_min = max(0.0, min(x_min, los_x - 16.0))
        x_max = min(120.0, max(x_max, los_x + 22.0))

        # Spanish coaching notes grounded in league numbers
        press_names = [m["name"] for m in role_meta.values() if m["generatedPressure"]]
        beaten_names = [f"{m['name']} ({m['linedUp']})" for m in role_meta.values() if m["allowedPressure"] or m["beaten"]]
        rushers = [m for m in role_meta.values() if m["role"] == "Pass Rush" and m["getoff"] is not None]
        bucket = next((c for c, lo, hi in zip(self._guerra_cache["cliff"], TTT_BINS[:-1], TTT_BINS[1:])
                       if lo < ttt <= hi or (lo == 0 and ttt <= hi)), None)
        end_lbl = {"pass_forward": "lanzó", "autoevent_passforward": "lanzó", "qb_sack": "fue capturado",
                   "qb_strip_sack": "fue capturado", "run": "salió corriendo", "fumble": "soltó el balón"}.get(end_event, "terminó")
        notes = []
        clock_note = f"Reloj: el QB {end_lbl} a los {ttt:.1f} s."
        if bucket:
            clock_note += (f" En la liga, en la franja {bucket['bucket']}: {bucket['sack']}% de sacks y "
                           f"{bucket['success']}% de éxito.")
        if ttt > LATE_T:
            clock_note += " Zona de peligro: después de 3.5 s."
        notes.append(clock_note)
        if rushers:
            best = min(rushers, key=lambda m: m["getoff"])
            med = best.get("getoffMedian")
            med_txt = f" (su mediana: {med:.2f} s)" if med is not None else ""
            notes.append(f"Arranque más rápido: {best['name']}, {best['getoff']:.1f} s{med_txt}.")
        if press_names:
            notes.append(f"Presión de: {', '.join(press_names)}. El rusher más cercano llegó a "
                         f"{round(min_pocket_radius, 1)} yd del QB antes del lanzamiento.")
        else:
            notes.append(f"Pocket limpio: ningún rusher se acercó a menos de {round(min_pocket_radius, 1)} yd "
                         f"antes del lanzamiento.")
        if bool(prow["is_play_action"]):
            pa = self._guerra_cache["play_action"]
            notes.append(f"Play action: en la liga el amague retrasa el arranque de cada rusher "
                         f"{pa['getoff_delta_adj']:.2f} s (mismo jugador y situación), a cambio de que el QB tarde más "
                         f"en soltar (mediana {pa['ttt_pa']} s vs {pa['ttt_no_pa']} s).")
        if beaten_names:
            notes.append(f"Bloqueos perdidos: {', '.join(beaten_names[:3])}.")

        play_summary = self._format_play_summary(prow)
        play_summary["ttt"] = round(ttt, 1)
        play_summary["endEvent"] = end_event
        return {
            "play": play_summary,
            "losX": round(los_x, 2),
            "firstDownX": round(min(110.0, los_x + float(prow["yardsToGo"])), 2),
            "viewBox": {"xMin": round(x_min, 1), "xMax": round(x_max, 1), "yMin": 0.0, "yMax": 53.3},
            "roster": list(role_meta.values()),
            "matchups": matchup_edges,
            "frames": frames_out,
            "telemetry": telemetry_out,
            "keyEvents": key_events,
            "physicsSummary": {
                "ttt": round(ttt, 1),
                "endEvent": end_event,
                "throwFrameIndex": throw_frame_idx,
                "minPocketRadius": round(min_pocket_radius, 2) if min_pocket_radius < 99 else None,
                "closestRusher": closest_rusher_name,
                "closestFrameIndex": closest_frame_idx,
                "peakCollapseVel": round(peak_collapse_vel, 2),
                "durationSec": round(len(frames_out) * 0.1, 1),
                "doubleTeamedRushers": [m["name"] for m in role_meta.values() if m["isDoubleTeamed"]],
                "freeRushers": [],
                "pressureMakers": press_names,
                "coachingNotes": notes,
            },
        }
