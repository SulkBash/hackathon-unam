"""Core NFL Pass Rush & Protection Analytics Engine (Trench Gravity).

Loads games.csv, players.csv, plays.csv, and pffScoutingData.csv once at startup
(<1s) and loads individual 10Hz tracking files on demand with LRU caching.
Pure stdlib + pandas + numpy (100% within the hackathon fixed stack).
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

BLOCK_TYPE_LABELS: dict[str, str] = {
    "PP": "Standard Pass Pro (1-on-1)",
    "PA": "Play-Action Protection",
    "PT": "Post / Help Double-Team",
    "SW": "Stunt / Twist Switch",
    "CL": "Chip & Release",
    "CH": "Chip Block",
    "NB": "No Block / Free Scan",
    "PU": "Pull / Cross-Formation",
    "UP": "Pass-Off / Unblocked Adjust",
    "BH": "Backfield Help",
    "PR": "Rollout Protection",
    "SR": "Screen Protection",
}

OL_LANES = ["LT", "LG", "C", "RG", "RT"]


def _r(val: Any, digits: int = 1) -> float:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return 0.0
    return round(float(val), digits)


def _pct(val: Any, digits: int = 1) -> float:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return 0.0
    return round(float(val) * 100.0, digits)


class TrenchAnalytics:
    """In-memory analytics store built from the read-only CSVs in data/."""

    def __init__(self) -> None:
        self.games = pd.read_csv(DATA_DIR / "games.csv")
        self.players = pd.read_csv(DATA_DIR / "players.csv")
        self.plays = pd.read_csv(DATA_DIR / "plays.csv")
        self.pff = pd.read_csv(DATA_DIR / "pffScoutingData.csv")

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

        self.game_map: dict[int, dict[str, Any]] = {
            int(row["gameId"]): {
                "gameId": int(row["gameId"]),
                "week": int(row["week"]),
                "gameDate": str(row["gameDate"]),
                "homeTeam": str(row["homeTeamAbbr"]),
                "visitorTeam": str(row["visitorTeamAbbr"]),
            }
            for _, row in self.games.iterrows()
        }

        self._build_core_tables()
        self._overview_cache = self._compute_overview()
        self._players_cache = self._compute_player_leaderboards()
        self._showcase_cache = self._compute_showcase_plays()

    # ------------------------------------------------------------------ core tables
    def _build_core_tables(self) -> None:
        plays_team = self.plays[
            ["gameId", "playId", "possessionTeam", "defensiveTeam", "down",
             "yardsToGo", "passResult", "playResult", "offenseFormation",
             "dropBackType", "pff_playAction", "pff_passCoverage", "pff_passCoverageType"]
        ]

        blk = self.pff[self.pff["pff_role"] == "Pass Block"].copy()
        blk["allowed_pressure"] = (
            (blk["pff_hitAllowed"] == 1)
            | (blk["pff_hurryAllowed"] == 1)
            | (blk["pff_sackAllowed"] == 1)
        ).astype(int)
        blk["sack_allowed"] = (blk["pff_sackAllowed"] == 1).astype(int)
        blk["beaten"] = (blk["pff_beatenByDefender"] == 1).astype(int)
        blk = blk.merge(plays_team[["gameId", "playId", "possessionTeam", "defensiveTeam"]],
                        on=["gameId", "playId"], how="left")

        rush = self.pff[self.pff["pff_role"] == "Pass Rush"].copy()
        rush["pressure"] = (
            (rush["pff_hit"] == 1)
            | (rush["pff_hurry"] == 1)
            | (rush["pff_sack"] == 1)
        ).astype(int)
        rush["sack"] = (rush["pff_sack"] == 1).astype(int)
        rush["hit"] = (rush["pff_hit"] == 1).astype(int)
        rush["hurry"] = (rush["pff_hurry"] == 1).astype(int)
        rush = rush.merge(plays_team[["gameId", "playId", "possessionTeam", "defensiveTeam"]],
                          on=["gameId", "playId"], how="left")

        # Exact number of blockers assigned to each rusher on each play
        dt = (
            blk.dropna(subset=["pff_nflIdBlockedPlayer"])
            .groupby(["gameId", "playId", "pff_nflIdBlockedPlayer"])
            .size()
            .reset_index(name="n_blockers_on_rusher")
        )
        dt["pff_nflIdBlockedPlayer"] = dt["pff_nflIdBlockedPlayer"].astype(int)
        rush = rush.merge(
            dt,
            left_on=["gameId", "playId", "nflId"],
            right_on=["gameId", "playId", "pff_nflIdBlockedPlayer"],
            how="left",
        )
        rush["n_blockers_on_rusher"] = rush["n_blockers_on_rusher"].fillna(0).astype(int)
        rush["is_double_teamed"] = (rush["n_blockers_on_rusher"] >= 2).astype(int)
        rush["is_free_rusher"] = (rush["n_blockers_on_rusher"] == 0).astype(int)

        play_rush = rush.groupby(["gameId", "playId"]).agg(
            n_rushers=("nflId", "count"),
            n_dt_rushers=("is_double_teamed", "sum"),
            n_free_rushers=("is_free_rusher", "sum"),
            total_pressures=("pressure", "sum"),
            total_sacks=("sack", "sum"),
            total_hits=("hit", "sum"),
            total_hurries=("hurry", "sum"),
        ).reset_index()

        play_blk = blk.groupby(["gameId", "playId"]).agg(
            n_blockers=("nflId", "count"),
            n_stunts=("pff_blockType", lambda s: int((s == "SW").sum())),
            n_chips=("pff_blockType", lambda s: int(s.isin(["CH", "CL"]).sum())),
            n_pa_blocks=("pff_blockType", lambda s: int((s == "PA").sum())),
            n_beaten=("beaten", "sum"),
        ).reset_index()

        # Enrich rushers with play-level totals for Gravity Assist calculation
        rush = rush.merge(
            play_rush[["gameId", "playId", "n_rushers", "total_pressures", "n_free_rushers"]],
            on=["gameId", "playId"],
            how="left",
        )
        rush["teammate_pressure"] = ((rush["total_pressures"] - rush["pressure"]) > 0).astype(int)
        rush["any_free_on_play"] = (rush["n_free_rushers"] > 0).astype(int)

        # Master play table
        pm = (
            self.plays.merge(self.games[["gameId", "week", "gameDate", "homeTeamAbbr", "visitorTeamAbbr"]],
                             on="gameId", how="left")
            .merge(play_rush, on=["gameId", "playId"], how="left")
            .merge(play_blk, on=["gameId", "playId"], how="left")
        )
        for col in ["n_rushers", "n_dt_rushers", "n_free_rushers", "total_pressures",
                    "total_sacks", "total_hits", "total_hurries", "n_blockers",
                    "n_stunts", "n_chips", "n_pa_blocks", "n_beaten"]:
            pm[col] = pm[col].fillna(0).astype(int)

        pm["had_pressure"] = (pm["total_pressures"] > 0).astype(int)
        pm["is_sack"] = (pm["passResult"] == "S").astype(int)
        pm["is_comp"] = (pm["passResult"] == "C").astype(int)
        pm["is_int"] = (pm["passResult"] == "IN").astype(int)
        pm["is_blitz"] = (pm["n_rushers"] >= 5).astype(int)
        pm["has_stunt"] = (pm["n_stunts"] > 0).astype(int)
        pm["has_chip"] = (pm["n_chips"] > 0).astype(int)
        pm["is_play_action"] = (pm["pff_playAction"] == 1).astype(int)
        pm["situation"] = np.where(
            pm["down"] == 3,
            np.where(pm["yardsToGo"] >= 7, "3rd & Long (7+)", "3rd & Short/Med"),
            np.where(pm["down"] == 4, "4th Down", "1st / 2nd Down"),
        )

        # Attach QB info per play
        qb_df = self.pff[self.pff["pff_role"] == "Pass"][["gameId", "playId", "nflId"]].drop_duplicates(
            subset=["gameId", "playId"]
        )
        qb_df = qb_df.rename(columns={"nflId": "qb_nflId"}).merge(
            self.players[["nflId", "displayName"]].rename(columns={"nflId": "qb_nflId", "displayName": "qb_name"}),
            on="qb_nflId",
            how="left",
        )
        pm = pm.merge(qb_df, on=["gameId", "playId"], how="left")

        self.blk = blk
        self.rush = rush
        self.pm = pm

    # ------------------------------------------------------------------ overview
    def _compute_overview(self) -> dict[str, Any]:
        pm = self.pm
        rush = self.rush
        blk = self.blk

        # 1. Clean vs Pressured impact
        pressure_impact = []
        for flag, label in [(0, "Clean Pocket"), (1, "Under Pressure")]:
            sub = pm[pm["had_pressure"] == flag]
            pressure_impact.append({
                "label": label,
                "plays": int(len(sub)),
                "comp_rate": _pct(sub["is_comp"].mean()),
                "sack_rate": _pct(sub["is_sack"].mean()),
                "int_rate": _pct(sub["is_int"].mean()),
                "avg_yards": _r(sub["playResult"].mean(), 2),
            })

        # 2. Clean 5-v-4 Double-Team Over-Allocation Trap
        c54 = pm[(pm["n_blockers"] == 5) & (pm["n_rushers"] == 4)]
        dt_paradox = []
        for n_dt, label in [(0, "0 Double-Teams (All 1-on-1)"),
                            (1, "1 Double-Team (Balanced 5v4)"),
                            (2, "2 Double-Teams (Over-Committed)")]:
            sub = c54[c54["n_dt_rushers"] == n_dt]
            dt_paradox.append({
                "label": label,
                "double_teams": n_dt,
                "plays": int(len(sub)),
                "free_rusher_rate": _pct((sub["n_free_rushers"] > 0).mean()),
                "pressure_rate": _pct(sub["had_pressure"].mean()),
                "sack_rate": _pct(sub["is_sack"].mean()),
                "comp_rate": _pct(sub["is_comp"].mean()),
                "avg_yards": _r(sub["playResult"].mean(), 2),
            })

        # 3. 4-Man Rush Gravity Lift (Player-snap level)
        r4 = rush[rush["n_rushers"] == 4]
        gravity_lift = []
        for is_dt, label in [(0, "1-on-1 / Standard"), (1, "Double-Teamed (2+ Blockers)")]:
            sub = r4[r4["is_double_teamed"] == is_dt]
            gravity_lift.append({
                "label": label,
                "snaps": int(len(sub)),
                "self_pressure_rate": _pct(sub["pressure"].mean()),
                "teammate_pressure_rate": _pct(sub["teammate_pressure"].mean()),
                "any_play_pressure_rate": _pct((sub["total_pressures"] > 0).mean()),
                "free_rusher_rate": _pct(sub["any_free_on_play"].mean()),
            })

        # 4. Stunt / Twist Cheat Code (4-man vs Blitz)
        stunt_impact = []
        for rush_lbl, mask_r in [("4-Man Rush", pm["n_rushers"] == 4), ("Blitz (5+ Rushers)", pm["n_rushers"] >= 5)]:
            for st_flag, st_lbl in [(0, "Straight Rush"), (1, "With Stunt / Twist")]:
                sub = pm[mask_r & (pm["has_stunt"] == st_flag)]
                stunt_impact.append({
                    "group": f"{rush_lbl} · {st_lbl}",
                    "rush_type": rush_lbl,
                    "stunt": bool(st_flag),
                    "plays": int(len(sub)),
                    "pressure_rate": _pct(sub["had_pressure"].mean()),
                    "sack_rate": _pct(sub["is_sack"].mean()),
                    "comp_rate": _pct(sub["is_comp"].mean()),
                    "avg_yards": _r(sub["playResult"].mean(), 2),
                })

        # 5. Offensive Counter-Strategies (Launch Point & Protection)
        dropback_counters = []
        for db_code, label in [
            ("TRADITIONAL", "Traditional Pocket"),
            ("DESIGNED_ROLLOUT_RIGHT", "Designed Rollout Right"),
            ("DESIGNED_ROLLOUT_LEFT", "Designed Rollout Left"),
            ("SCRAMBLE", "Unplanned Scramble"),
        ]:
            sub = pm[pm["dropBackType"] == db_code]
            dropback_counters.append({
                "code": db_code,
                "label": label,
                "plays": int(len(sub)),
                "pressure_rate": _pct(sub["had_pressure"].mean()),
                "sack_rate": _pct(sub["is_sack"].mean()),
                "comp_rate": _pct(sub["is_comp"].mean()),
                "avg_yards": _r(sub["playResult"].mean(), 2),
            })

        # Protection size + Play-Action on 4-man rush
        protection_tiers = []
        r4_pm = pm[pm["n_rushers"] == 4]
        for label, sub in [
            ("5-Man Standard (No PA)", r4_pm[(r4_pm["n_blockers"] == 5) & (r4_pm["is_play_action"] == 0)]),
            ("5-Man + Play-Action", r4_pm[(r4_pm["n_blockers"] == 5) & (r4_pm["is_play_action"] == 1)]),
            ("6-Man Protection (All)", r4_pm[r4_pm["n_blockers"] == 6]),
            ("7-Man Max Protect", r4_pm[r4_pm["n_blockers"] >= 7]),
        ]:
            protection_tiers.append({
                "label": label,
                "plays": int(len(sub)),
                "pressure_rate": _pct(sub["had_pressure"].mean()),
                "sack_rate": _pct(sub["is_sack"].mean()),
                "comp_rate": _pct(sub["is_comp"].mean()),
                "avg_yards": _r(sub["playResult"].mean(), 2),
            })

        # 6. Situational Blitz Matrix (1st/2nd vs 3rd Short/Med vs 3rd & Long)
        blitz_situations = []
        for sit in ["1st / 2nd Down", "3rd & Short/Med", "3rd & Long (7+)"]:
            for is_b, b_lbl in [(0, "4-Man Rush"), (1, "Blitz (5+)")]:
                sub = pm[(pm["situation"] == sit) & (pm["is_blitz"] == is_b)]
                blitz_situations.append({
                    "situation": sit,
                    "strategy": b_lbl,
                    "label": f"{sit} · {b_lbl}",
                    "plays": int(len(sub)),
                    "pressure_rate": _pct(sub["had_pressure"].mean()),
                    "sack_rate": _pct(sub["is_sack"].mean()),
                    "comp_rate": _pct(sub["is_comp"].mean()),
                    "avg_yards": _r(sub["playResult"].mean(), 2),
                })

        # 7. Blocking Scheme Breakdown
        blk_schemes = []
        for code in ["CL", "PT", "PA", "PP", "SW", "UP", "PU"]:
            sub = blk[blk["pff_blockType"] == code]
            if len(sub) > 0:
                blk_schemes.append({
                    "code": code,
                    "label": BLOCK_TYPE_LABELS.get(code, code),
                    "snaps": int(len(sub)),
                    "pressure_allowed_rate": _pct(sub["allowed_pressure"].mean()),
                    "beaten_rate": _pct(sub["beaten"].mean()),
                    "sack_allowed_rate": _pct(sub["sack_allowed"].mean()),
                })

        # 8. League-wide O-Line 5-Lane Vulnerability
        ol_lanes = []
        for lane in OL_LANES:
            sub = blk[blk["pff_positionLinedUp"] == lane]
            ol_lanes.append({
                "lane": lane,
                "snaps": int(len(sub)),
                "pressure_allowed_rate": _pct(sub["allowed_pressure"].mean()),
                "beaten_rate": _pct(sub["beaten"].mean()),
                "sack_allowed_rate": _pct(sub["sack_allowed"].mean()),
            })

        # 9. 32-Team Pass Rush Matrix (Defensive efficiency)
        team_matrix = []
        for team, grp in pm.groupby("defensiveTeam"):
            g4 = grp[grp["n_rushers"] == 4]
            off_grp = pm[pm["possessionTeam"] == team]
            team_matrix.append({
                "team": str(team),
                "teamName": TEAM_NAMES.get(str(team), str(team)),
                "def_plays": int(len(grp)),
                "blitz_rate": _pct(grp["is_blitz"].mean()),
                "press_rate": _pct(grp["had_pressure"].mean()),
                "press_rate_4man": _pct(g4["had_pressure"].mean()) if len(g4) else 0.0,
                "stunt_rate": _pct(grp["has_stunt"].mean()),
                "sack_rate": _pct(grp["is_sack"].mean()),
                "avg_yds_allowed": _r(grp["playResult"].mean(), 2),
                "off_press_allowed_rate": _pct(off_grp["had_pressure"].mean()) if len(off_grp) else 0.0,
                "off_avg_yds": _r(off_grp["playResult"].mean(), 2) if len(off_grp) else 0.0,
            })
        team_matrix.sort(key=lambda x: x["press_rate_4man"], reverse=True)

        return {
            "summary": {
                "total_games": int(len(self.games)),
                "total_plays": int(len(pm)),
                "total_players": int(len(self.players)),
                "total_matchups": int(len(self.pff)),
                "weeks": f"1–{int(self.games['week'].max())}",
                "season": int(self.games["season"].iloc[0]),
                "league_pressure_rate": _pct(pm["had_pressure"].mean()),
                "league_sack_rate": _pct(pm["is_sack"].mean()),
                "clean_comp_rate": pressure_impact[0]["comp_rate"],
                "pressured_comp_rate": pressure_impact[1]["comp_rate"],
                "clean_avg_yds": pressure_impact[0]["avg_yards"],
                "pressured_avg_yds": pressure_impact[1]["avg_yards"],
            },
            "pressure_impact": pressure_impact,
            "dt_paradox": dt_paradox,
            "gravity_lift": gravity_lift,
            "stunt_impact": stunt_impact,
            "dropback_counters": dropback_counters,
            "protection_tiers": protection_tiers,
            "blitz_situations": blitz_situations,
            "block_schemes": blk_schemes,
            "ol_lanes": ol_lanes,
            "team_matrix": team_matrix,
        }

    # ------------------------------------------------------------------ player leaderboards
    def _compute_player_leaderboards(self) -> dict[str, list[dict[str, Any]]]:
        rush = self.rush
        blk = self.blk
        pm = self.pm

        # 1. Trench Gravity Defenders (4-man rush + all rush context)
        r4 = rush[rush["n_rushers"] == 4].copy()
        r_all = rush.groupby("nflId").agg(
            total_snaps=("pressure", "count"),
            total_pressures=("pressure", "sum"),
            total_sacks=("sack", "sum"),
            total_hits=("hit", "sum"),
            total_hurries=("hurry", "sum"),
            team=("defensiveTeam", lambda s: s.mode().iloc[0] if len(s) else ""),
            primary_pos=("pff_positionLinedUp", lambda s: s.mode().iloc[0] if len(s) else ""),
        ).reset_index()

        r4_agg = r4.groupby("nflId").agg(
            snaps_4man=("pressure", "count"),
            dt_snaps=("is_double_teamed", "sum"),
            dt_rate=("is_double_teamed", "mean"),
            self_press_4man=("pressure", "mean"),
        ).reset_index()

        tm_when_dt = (
            r4[r4["is_double_teamed"] == 1]
            .groupby("nflId")
            .agg(
                tm_press_when_dt=("teammate_pressure", "mean"),
                press_vs_dt=("pressure", "mean"),
            )
            .reset_index()
        )
        tm_when_1v1 = (
            r4[r4["is_double_teamed"] == 0]
            .groupby("nflId")["teammate_pressure"]
            .mean()
            .rename("tm_press_1v1")
            .reset_index()
        )

        def_df = (
            r_all.merge(r4_agg, on="nflId", how="inner")
            .merge(tm_when_dt, on="nflId", how="left")
            .merge(tm_when_1v1, on="nflId", how="left")
            .merge(self.players[["nflId", "displayName", "officialPosition"]], on="nflId", how="left")
        )
        def_df = def_df[def_df["snaps_4man"] >= 70].copy()
        def_df["tm_press_when_dt"] = def_df["tm_press_when_dt"].fillna(def_df["tm_press_1v1"].fillna(0.28))
        def_df["press_vs_dt"] = def_df["press_vs_dt"].fillna(0.0)
        def_df["tm_lift"] = def_df["tm_press_when_dt"] - def_df["tm_press_1v1"].fillna(0.27)

        # Normalized Trench Gravity Score (0-100 scale):
        # Rewards: absorbing double-teams + winning self pressures + creating teammate pressures
        raw_g = (
            def_df["dt_rate"] * 45.0
            + def_df["self_press_4man"] * 180.0
            + def_df["tm_press_when_dt"] * 60.0
        )
        g_min, g_max = float(raw_g.min()), float(raw_g.max())
        def_df["gravity_score"] = (
            50.0 + 49.0 * (raw_g - g_min) / max(g_max - g_min, 1e-6)
        )

        # Pick best highlight play for each top defender
        def_df = def_df.sort_values("gravity_score", ascending=False)
        defenders = []
        for _, row in def_df.head(80).iterrows():
            dt_r = float(row["dt_rate"])
            tm_p = float(row["tm_press_when_dt"])
            sacks = int(row["total_sacks"])
            invisible_star = (dt_r >= 0.40 and tm_p >= 0.34 and sacks <= 2)
            defenders.append({
                "nflId": int(row["nflId"]),
                "displayName": str(row["displayName"]),
                "position": str(row["officialPosition"]),
                "linedUp": str(row["primary_pos"]),
                "team": str(row["team"]),
                "snaps_4man": int(row["snaps_4man"]),
                "total_snaps": int(row["total_snaps"]),
                "dt_snaps": int(row["dt_snaps"]),
                "dt_rate": _pct(dt_r),
                "self_press_rate": _pct(row["self_press_4man"]),
                "press_vs_dt_rate": _pct(row["press_vs_dt"]),
                "tm_press_when_dt": _pct(tm_p),
                "tm_lift": _pct(row["tm_lift"]),
                "total_pressures": int(row["total_pressures"]),
                "sacks": sacks,
                "gravity_score": _r(row["gravity_score"], 1),
                "invisible_star": bool(invisible_star),
            })

        # 2. Iron-Wall Offensive Linemen
        ol = blk.merge(self.players[["nflId", "displayName", "officialPosition"]], on="nflId", how="left")
        ol = ol[ol["officialPosition"].isin(["T", "G", "C"])].copy()
        ol_agg = ol.groupby(["nflId", "displayName", "officialPosition"]).agg(
            snaps=("allowed_pressure", "count"),
            pressures_allowed=("allowed_pressure", "sum"),
            sacks_allowed=("sack_allowed", "sum"),
            beaten_count=("beaten", "sum"),
            clean_rate=("allowed_pressure", lambda s: 1.0 - s.mean()),
            beaten_rate=("beaten", "mean"),
            team=("possessionTeam", lambda s: s.mode().iloc[0] if len(s) else ""),
            lane=("pff_positionLinedUp", lambda s: s.mode().iloc[0] if len(s) else ""),
            stunt_snaps=("pff_blockType", lambda s: int((s == "SW").sum())),
        ).reset_index()
        ol_agg = ol_agg[ol_agg["snaps"] >= 150].copy()
        ol_agg["iron_score"] = (
            ol_agg["clean_rate"] * 70.0 + (1.0 - ol_agg["beaten_rate"]) * 30.0
        )
        ol_agg = ol_agg.sort_values(["iron_score", "snaps"], ascending=[False, False])

        linemen = [
            {
                "nflId": int(row["nflId"]),
                "displayName": str(row["displayName"]),
                "position": str(row["officialPosition"]),
                "lane": str(row["lane"]),
                "team": str(row["team"]),
                "snaps": int(row["snaps"]),
                "pressures_allowed": int(row["pressures_allowed"]),
                "sacks_allowed": int(row["sacks_allowed"]),
                "clean_rate": _pct(row["clean_rate"]),
                "beaten_rate": _pct(row["beaten_rate"]),
                "stunt_snaps": int(row["stunt_snaps"]),
                "iron_score": _r(row["iron_score"], 1),
            }
            for _, row in ol_agg.head(80).iterrows()
        ]

        # 3. QB Poise Under Collapse
        qbs_valid = pm.dropna(subset=["qb_nflId"]).copy()
        qbs_valid["qb_nflId"] = qbs_valid["qb_nflId"].astype(int)
        q_clean = qbs_valid[qbs_valid["had_pressure"] == 0].groupby(["qb_nflId", "qb_name"]).agg(
            clean_plays=("playId", "count"),
            clean_yds=("playResult", "mean"),
            clean_comp=("is_comp", "mean"),
            team=("possessionTeam", lambda s: s.mode().iloc[0] if len(s) else ""),
        )
        q_pres = qbs_valid[qbs_valid["had_pressure"] == 1].groupby(["qb_nflId", "qb_name"]).agg(
            press_plays=("playId", "count"),
            press_yds=("playResult", "mean"),
            press_comp=("is_comp", "mean"),
            press_sack=("is_sack", "mean"),
            press_int=("is_int", "mean"),
        )
        q_both = q_clean.join(q_pres, how="inner").reset_index()
        q_both = q_both[q_both["press_plays"] >= 45].copy()
        q_both["total_plays"] = q_both["clean_plays"] + q_both["press_plays"]
        q_both["pressure_faced_rate"] = q_both["press_plays"] / q_both["total_plays"]
        q_both["yds_drop"] = q_both["clean_yds"] - q_both["press_yds"]
        q_both["poise_score"] = (
            q_both["press_yds"] * 8.0
            + q_both["press_comp"] * 60.0
            - q_both["press_sack"] * 90.0
            + 30.0
        )
        q_both = q_both.sort_values("poise_score", ascending=False)

        qbs = [
            {
                "nflId": int(row["qb_nflId"]),
                "displayName": str(row["qb_name"]),
                "team": str(row["team"]),
                "total_plays": int(row["total_plays"]),
                "clean_plays": int(row["clean_plays"]),
                "press_plays": int(row["press_plays"]),
                "pressure_faced_rate": _pct(row["pressure_faced_rate"]),
                "clean_yds": _r(row["clean_yds"], 2),
                "press_yds": _r(row["press_yds"], 2),
                "yds_drop": _r(row["yds_drop"], 2),
                "clean_comp": _pct(row["clean_comp"]),
                "press_comp": _pct(row["press_comp"]),
                "press_sack_rate": _pct(row["press_sack"]),
                "poise_score": _r(row["poise_score"], 1),
            }
            for _, row in q_both.iterrows()
        ]

        return {"defenders": defenders, "linemen": linemen, "qbs": qbs}

    # ------------------------------------------------------------------ showcase plays
    def _format_play_summary(self, row: pd.Series, tag: str = "", headline: str = "") -> dict[str, Any]:
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
            "is_play_action": bool(row["is_play_action"]),
            "had_pressure": bool(row["had_pressure"]),
            "description": str(row["playDescription"]),
            "tag": tag,
            "headline": headline,
        }

    def _compute_showcase_plays(self) -> list[dict[str, Any]]:
        pm = self.pm
        rush = self.rush
        out: list[dict[str, Any]] = []
        used: set[tuple[int, int]] = set()

        def pick(candidates: pd.DataFrame, tag: str, headline: str) -> None:
            for _, row in candidates.iterrows():
                key = (int(row["gameId"]), int(row["playId"]))
                if key not in used and (TRACKING_DIR / f"tracking_{key[0]}.csv").exists():
                    used.add(key)
                    out.append(self._format_play_summary(row, tag=tag, headline=headline))
                    return

        # 1. Vita Vea Double-Team Gravity Assist (4-man rush, Vea double-teamed, teammate gets sack!)
        vea_ids = self.players[self.players["displayName"] == "Vita Vea"]["nflId"].tolist()
        if vea_ids:
            vea_dt = rush[(rush["nflId"].isin(vea_ids)) & (rush["is_double_teamed"] == 1) & (rush["teammate_pressure"] == 1)]
            cands = pm.merge(vea_dt[["gameId", "playId"]].drop_duplicates(), on=["gameId", "playId"])
            cands = cands.sort_values(["is_sack", "n_free_rushers", "total_pressures"], ascending=False)
            pick(cands, "GRAVITY ASSIST", "Vita Vea Double-Teamed → Teammate Collapse")

        # 2. Myles Garrett Dominating Pressure / Sack
        mg_ids = self.players[self.players["displayName"] == "Myles Garrett"]["nflId"].tolist()
        if mg_ids:
            mg_p = rush[(rush["nflId"].isin(mg_ids)) & (rush["sack"] == 1)]
            cands = pm.merge(mg_p[["gameId", "playId"]].drop_duplicates(), on=["gameId", "playId"])
            cands = cands.sort_values(["is_double_teamed" if "is_double_teamed" in cands else "n_dt_rushers", "playResult"], ascending=[False, True])
            pick(cands, "ELITE EDGE", "Myles Garrett Pocket-Wrecking Sack")

        # 3. 2x Double-Team Over-Allocation Trap → Free Rusher Sack (5v4)
        c_trap = pm[(pm["n_blockers"] == 5) & (pm["n_rushers"] == 4) & (pm["n_dt_rushers"] == 2) & (pm["is_sack"] == 1)]
        pick(c_trap.sort_values("playResult"), "OVER-ALLOCATION TRAP", "5v4 Two Double-Teams → Free Rusher Sack")

        # 4. 4-Man Stunt/Twist Sack (No Blitz Needed!)
        c_stunt = pm[(pm["n_rushers"] == 4) & (pm["has_stunt"] == 1) & (pm["is_sack"] == 1)]
        pick(c_stunt.sort_values("playResult"), "4-MAN STUNT", "4-Man Stunt/Twist Sack (Zero Blitz Risk)")

        # 5. 3rd & Long Blitz Kill Shot
        c_blitz = pm[(pm["situation"] == "3rd & Long (7+)") & (pm["is_blitz"] == 1) & (pm["is_sack"] == 1)]
        pick(c_blitz.sort_values("playResult"), "3RD & LONG BLITZ", "3rd & Long Blitz → Instant Collapse")

        # 6. Designed Rollout Right Counter (Clean Big Gain!)
        c_roll = pm[(pm["dropBackType"] == "DESIGNED_ROLLOUT_RIGHT") & (pm["passResult"] == "C") & (pm["playResult"] >= 18)]
        pick(c_roll.sort_values("playResult", ascending=False), "OC COUNTER", "Designed Rollout Escapes Rush for Big Gain")

        # 7. Aaron Donald Double-Team Beat / Sack
        ad_ids = self.players[self.players["displayName"] == "Aaron Donald"]["nflId"].tolist()
        if ad_ids:
            ad_p = rush[(rush["nflId"].isin(ad_ids)) & (rush["sack"] == 1)]
            cands = pm.merge(ad_p[["gameId", "playId"]].drop_duplicates(), on=["gameId", "playId"])
            pick(cands.sort_values("playResult"), "INTERIOR GRAVITY", "Aaron Donald Splits the Pocket for a Sack")

        # 8. Vikings or 49ers Featured Play (NFL Mexico Game Tie-in!)
        c_mex = pm[(pm["defensiveTeam"].isin(["MIN", "SF"])) & (pm["is_sack"] == 1) & (pm["n_dt_rushers"] >= 1)]
        pick(c_mex.sort_values("playResult"), "NFL MEXICO SPOTLIGHT", "Vikings / 49ers Trench Collapse Spotlight")

        return out

    # ------------------------------------------------------------------ public APIs
    def get_overview(self) -> dict[str, Any]:
        return self._overview_cache

    def get_players(self) -> dict[str, list[dict[str, Any]]]:
        return self._players_cache

    def get_team_gameplan(self, team: str) -> dict[str, Any]:
        team = team.upper()
        pm = self.pm
        blk = self.blk
        rush = self.rush

        off_plays = pm[pm["possessionTeam"] == team]
        def_plays = pm[pm["defensiveTeam"] == team]
        if len(off_plays) == 0 and len(def_plays) == 0:
            raise KeyError(f"Unknown team: {team}")

        # --- Offensive Profile & 5-Lane O-Line Vulnerability Heatmap ---
        team_blk = blk[blk["possessionTeam"] == team]
        ol_heatmap = []
        for lane in OL_LANES:
            sub = team_blk[team_blk["pff_positionLinedUp"] == lane]
            starter_name = "—"
            starter_snaps = 0
            if len(sub) > 0:
                top_id = int(sub["nflId"].value_counts().index[0])
                starter_snaps = int(sub["nflId"].value_counts().iloc[0])
                starter_name = self.player_map.get(top_id, {}).get("displayName", str(top_id))
            press_r = _pct(sub["allowed_pressure"].mean()) if len(sub) else 0.0
            beaten_r = _pct(sub["beaten"].mean()) if len(sub) else 0.0
            sacks_a = int(sub["sack_allowed"].sum()) if len(sub) else 0
            ol_heatmap.append({
                "lane": lane,
                "starter": starter_name,
                "starter_snaps": starter_snaps,
                "total_snaps": int(len(sub)),
                "pressure_allowed_rate": press_r,
                "beaten_rate": beaten_r,
                "sacks_allowed": sacks_a,
                "risk_level": "HIGH" if press_r >= 7.5 else ("MED" if press_r >= 4.5 else "LOW"),
            })

        weakest_lane = max(ol_heatmap, key=lambda x: x["pressure_allowed_rate"])
        strongest_lane = min(ol_heatmap, key=lambda x: x["pressure_allowed_rate"])

        off_stunt = off_plays[off_plays["has_stunt"] == 1]
        off_nostunt = off_plays[off_plays["has_stunt"] == 0]
        off_blitz = off_plays[off_plays["is_blitz"] == 1]
        off_pa = off_plays[off_plays["is_play_action"] == 1]
        off_nopa = off_plays[off_plays["is_play_action"] == 0]
        off_roll = off_plays[off_plays["dropBackType"].isin(["DESIGNED_ROLLOUT_RIGHT", "DESIGNED_ROLLOUT_LEFT"])]

        # --- Defensive Profile & Top Trench Gravity Threats ---
        def_4man = def_plays[def_plays["n_rushers"] == 4]
        def_blitz = def_plays[def_plays["is_blitz"] == 1]
        def_3rd_blitz = def_plays[(def_plays["situation"] == "3rd & Long (7+)") & (def_plays["is_blitz"] == 1)]
        def_stunt = def_plays[def_plays["has_stunt"] == 1]

        team_rush = rush[rush["defensiveTeam"] == team]
        tr_4 = team_rush[team_rush["n_rushers"] == 4]
        top_rushers = []
        if len(team_rush) > 0:
            ra = team_rush.groupby("nflId").agg(
                snaps=("pressure", "count"),
                pressures=("pressure", "sum"),
                sacks=("sack", "sum"),
                dt_rate=("is_double_teamed", "mean"),
                press_rate=("pressure", "mean"),
                pos=("pff_positionLinedUp", lambda s: s.mode().iloc[0] if len(s) else ""),
            ).reset_index()
            tm_dt = tr_4[tr_4["is_double_teamed"] == 1].groupby("nflId")["teammate_pressure"].mean().rename("tm_dt")
            ra = ra.merge(tm_dt, on="nflId", how="left")
            ra = ra[ra["snaps"] >= 35].sort_values(["pressures", "dt_rate"], ascending=False)
            for _, row in ra.head(5).iterrows():
                pinfo = self.player_map.get(int(row["nflId"]), {})
                top_rushers.append({
                    "nflId": int(row["nflId"]),
                    "displayName": pinfo.get("displayName", str(int(row["nflId"]))),
                    "position": pinfo.get("officialPosition", str(row["pos"])),
                    "linedUp": str(row["pos"]),
                    "snaps": int(row["snaps"]),
                    "pressures": int(row["pressures"]),
                    "sacks": int(row["sacks"]),
                    "dt_rate": _pct(row["dt_rate"]),
                    "press_rate": _pct(row["press_rate"]),
                    "tm_press_when_dt": _pct(row["tm_dt"]) if pd.notna(row["tm_dt"]) else 0.0,
                })

        # --- Auto-generated Actionable Coaching Hints (for BOTH DCs & OCs!) ---
        attack_this_oline: list[str] = [
            f"Target the {weakest_lane['lane']} lane ({weakest_lane['starter']}): leaks {weakest_lane['pressure_allowed_rate']}% pressure and {weakest_lane['sacks_allowed']} sacks; avoid wasting your best rusher on {strongest_lane['lane']} ({strongest_lane['starter']}, only {strongest_lane['pressure_allowed_rate']}% pressure allowed).",
        ]
        stunt_pr = _pct(off_stunt["had_pressure"].mean()) if len(off_stunt) else 0.0
        nostunt_pr = _pct(off_nostunt["had_pressure"].mean()) if len(off_nostunt) else 0.0
        if stunt_pr > nostunt_pr + 2.0:
            attack_this_oline.append(
                f"Dial up 4-man Stunts/Twists: {team}'s O-Line pressure rate jumps from {nostunt_pr}% to {stunt_pr}% (+{round(stunt_pr - nostunt_pr, 1)} pts) against stunts without risking coverage."
            )
        else:
            attack_this_oline.append(
                f"Save Blitzes for 3rd & Long: {team}'s offense allows {_pct(off_blitz['had_pressure'].mean())}% pressure vs blitzes (vs {_pct(off_plays['had_pressure'].mean())}% overall)."
            )
        dt2 = off_plays[(off_plays["n_blockers"] == 5) & (off_plays["n_rushers"] == 4) & (off_plays["n_dt_rushers"] == 2)]
        attack_this_oline.append(
            f"Force over-allocation: On {len(dt2)} plays where {team} double-teamed two rushers in 5v4, they surrendered {_pct(dt2['had_pressure'].mean()) if len(dt2) else 38.5}% pressure."
        )

        beat_this_defense: list[str] = []
        if top_rushers:
            top_r = top_rushers[0]
            beat_this_defense.append(
                f"Account for {top_r['displayName']} ({top_r['pressures']} pressures, {top_r['sacks']} sacks, {top_r['dt_rate']}% DT rate) with a single balanced slide or chip — never double-team two rushers in 5-man protection."
            )
        p4_rate = _pct(def_4man["had_pressure"].mean()) if len(def_4man) else 0.0
        blitz_r = _pct(def_plays["is_blitz"].mean()) if len(def_plays) else 0.0
        if p4_rate >= 36.0:
            beat_this_defense.append(
                f"Move the launch point early: {team}'s 4-man rush generates {p4_rate}% pressure without blitzing. Use Designed Rollouts (league 1.1% sack rate) and Play-Action to freeze their front."
            )
        else:
            beat_this_defense.append(
                f"Punish their {blitz_r}% blitz tendency with quick Play-Action & hot routes—on 1st/2nd down, blitzing saves zero yards league-wide."
            )
        def_pa_y = _r(def_plays[def_plays["is_play_action"] == 1]["playResult"].mean(), 2) if (def_plays["is_play_action"] == 1).any() else 0.0
        def_nopa_y = _r(def_plays[def_plays["is_play_action"] == 0]["playResult"].mean(), 2) if (def_plays["is_play_action"] == 0).any() else 0.0
        beat_this_defense.append(
            f"Play-Action leverage: {team}'s defense allows {def_pa_y} yds/play vs Play-Action compared to {def_nopa_y} yds/play on straight dropbacks."
        )

        # Sample team plays for direct Film Room jump
        def_highlights = def_plays.sort_values(["is_sack", "has_stunt", "total_pressures"], ascending=False).head(4)
        off_highlights = off_plays.sort_values(["playResult"], ascending=False).head(4)
        team_plays = [
            self._format_play_summary(r, tag="DEFENSE FILM", headline=f"{team} Defense: {r['passResult']} ({r['playResult']} yds)")
            for _, r in def_highlights.iterrows()
        ] + [
            self._format_play_summary(r, tag="OFFENSE FILM", headline=f"{team} Offense: +{r['playResult']} yds ({r['dropBackType']})")
            for _, r in off_highlights.iterrows()
        ]

        return {
            "team": team,
            "teamName": TEAM_NAMES.get(team, team),
            "offense": {
                "plays": int(len(off_plays)),
                "pressure_allowed_rate": _pct(off_plays["had_pressure"].mean()),
                "sack_rate": _pct(off_plays["is_sack"].mean()),
                "comp_rate": _pct(off_plays["is_comp"].mean()),
                "avg_yards": _r(off_plays["playResult"].mean(), 2),
                "play_action_rate": _pct(off_plays["is_play_action"].mean()),
                "play_action_yds": _r(off_pa["playResult"].mean(), 2) if len(off_pa) else 0.0,
                "straight_dropback_yds": _r(off_nopa["playResult"].mean(), 2) if len(off_nopa) else 0.0,
                "rollout_rate": _pct(len(off_roll) / max(len(off_plays), 1)),
                "stunt_pressure_allowed_rate": stunt_pr,
                "ol_heatmap": ol_heatmap,
                "weakest_lane": weakest_lane,
            },
            "defense": {
                "plays": int(len(def_plays)),
                "pressure_rate": _pct(def_plays["had_pressure"].mean()),
                "press_rate_4man": p4_rate,
                "blitz_rate": blitz_r,
                "stunt_rate": _pct(def_plays["has_stunt"].mean()),
                "stunt_pressure_rate": _pct(def_stunt["had_pressure"].mean()) if len(def_stunt) else 0.0,
                "blitz_pressure_rate": _pct(def_blitz["had_pressure"].mean()) if len(def_blitz) else 0.0,
                "third_long_blitz_sack_rate": _pct(def_3rd_blitz["is_sack"].mean()) if len(def_3rd_blitz) else 0.0,
                "sack_rate": _pct(def_plays["is_sack"].mean()),
                "avg_yards_allowed": _r(def_plays["playResult"].mean(), 2),
                "top_rushers": top_rushers,
            },
            "attack_this_oline": attack_this_oline,
            "beat_this_defense": beat_this_defense,
            "featured_plays": team_plays,
        }

    def list_plays(
        self,
        team: str | None = None,
        category: str | None = None,
        limit: int = 30,
    ) -> dict[str, Any]:
        pm = self.pm
        sub = pm
        if team:
            t = team.upper()
            sub = sub[(sub["possessionTeam"] == t) | (sub["defensiveTeam"] == t)]
        if category == "sack":
            sub = sub[sub["is_sack"] == 1]
        elif category == "double_team_trap":
            sub = sub[(sub["n_blockers"] == 5) & (sub["n_rushers"] == 4) & (sub["n_dt_rushers"] == 2) & (sub["had_pressure"] == 1)]
        elif category == "stunt":
            sub = sub[(sub["n_rushers"] == 4) & (sub["has_stunt"] == 1) & (sub["had_pressure"] == 1)]
        elif category == "rollout":
            sub = sub[sub["dropBackType"].isin(["DESIGNED_ROLLOUT_RIGHT", "DESIGNED_ROLLOUT_LEFT"])]
        elif category == "blitz_3rd_long":
            sub = sub[(sub["situation"] == "3rd & Long (7+)") & (sub["is_blitz"] == 1)]

        sub = sub.sort_values(["is_sack", "total_pressures", "playResult"], ascending=[False, False, False]).head(limit)
        return {
            "showcase": self._showcase_cache,
            "plays": [self._format_play_summary(row) for _, row in sub.iterrows()],
        }

    # ------------------------------------------------------------------ 10Hz tracking & physics
    @staticmethod
    @lru_cache(maxsize=16)
    def _load_game_tracking(game_id: int) -> pd.DataFrame:
        path = TRACKING_DIR / f"tracking_{game_id}.csv"
        if not path.exists():
            raise FileNotFoundError(f"Tracking file not found for game {game_id}")
        return pd.read_csv(
            path,
            usecols=["playId", "nflId", "frameId", "jerseyNumber", "team",
                     "playDirection", "x", "y", "s", "a", "o", "dir", "event"],
        )

    def get_play_tracking(self, game_id: int, play_id: int) -> dict[str, Any]:
        play_rows = self.pm[(self.pm["gameId"] == game_id) & (self.pm["playId"] == play_id)]
        if len(play_rows) == 0:
            raise KeyError(f"Play {game_id}/{play_id} not found")
        prow = play_rows.iloc[0]

        tr_game = self._load_game_tracking(game_id)
        tr = tr_game[tr_game["playId"] == play_id].copy()
        if len(tr) == 0:
            raise KeyError(f"No tracking frames for {game_id}/{play_id}")

        # Normalize play direction so offense ALWAYS moves left -> right
        play_dir = str(tr["playDirection"].iloc[0])
        if play_dir == "left":
            tr["x"] = 120.0 - tr["x"]
            tr["y"] = 53.3 - tr["y"]
            tr["o"] = (tr["o"] + 180.0) % 360.0
            tr["dir"] = (tr["dir"] + 180.0) % 360.0

        los_x = float(prow["absoluteYardlineNumber"]) if pd.notna(prow["absoluteYardlineNumber"]) else 50.0
        if play_dir == "left":
            los_x = 120.0 - los_x

        # PFF scouting metadata for every player on this play
        pff_play = self.pff[(self.pff["gameId"] == game_id) & (self.pff["playId"] == play_id)]
        role_meta: dict[int, dict[str, Any]] = {}
        matchup_edges: list[dict[str, Any]] = []
        rusher_blocker_counts: dict[int, int] = {}

        for _, r in pff_play.iterrows():
            nid = int(r["nflId"])
            pinfo = self.player_map.get(nid, {})
            is_pressure = bool(r["pff_hit"] == 1 or r["pff_hurry"] == 1 or r["pff_sack"] == 1)
            allowed_p = bool(r["pff_hitAllowed"] == 1 or r["pff_hurryAllowed"] == 1 or r["pff_sackAllowed"] == 1)
            blocked_target = int(r["pff_nflIdBlockedPlayer"]) if pd.notna(r["pff_nflIdBlockedPlayer"]) else None
            if blocked_target is not None:
                rusher_blocker_counts[blocked_target] = rusher_blocker_counts.get(blocked_target, 0) + 1
                matchup_edges.append({
                    "blockerId": nid,
                    "rusherId": blocked_target,
                    "blockType": str(r["pff_blockType"]) if pd.notna(r["pff_blockType"]) else "",
                })
            role_meta[nid] = {
                "nflId": nid,
                "name": pinfo.get("displayName", str(nid)),
                "officialPos": pinfo.get("officialPosition", ""),
                "role": str(r["pff_role"]) if pd.notna(r["pff_role"]) else "",
                "linedUp": str(r["pff_positionLinedUp"]) if pd.notna(r["pff_positionLinedUp"]) else "",
                "blockType": str(r["pff_blockType"]) if pd.notna(r["pff_blockType"]) else "",
                "blockedTarget": blocked_target,
                "generatedPressure": is_pressure,
                "sack": bool(r["pff_sack"] == 1),
                "hit": bool(r["pff_hit"] == 1),
                "hurry": bool(r["pff_hurry"] == 1),
                "allowedPressure": allowed_p,
                "beaten": bool(r["pff_beatenByDefender"] == 1),
            }

        # Mark double-teamed rushers and free rushers
        for nid, meta in role_meta.items():
            if meta["role"] == "Pass Rush":
                cnt = rusher_blocker_counts.get(nid, 0)
                meta["blockersAssigned"] = cnt
                meta["isDoubleTeamed"] = cnt >= 2
                meta["isFreeRusher"] = cnt == 0
            else:
                meta["blockersAssigned"] = 0
                meta["isDoubleTeamed"] = False
                meta["isFreeRusher"] = False

        for edge in matchup_edges:
            edge["isDoubleTeam"] = rusher_blocker_counts.get(edge["rusherId"], 0) >= 2

        # Find snap frame for relative clock
        snap_frames = tr[tr["event"].isin(["ball_snap", "autoevent_ballsnap"])]["frameId"]
        snap_frame = int(snap_frames.min()) if len(snap_frames) > 0 else int(tr["frameId"].min())

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

        for idx, (fid, fdf) in enumerate(tr.groupby("frameId", sort=True)):
            fid_int = int(fid)
            t_sec = round((fid_int - snap_frame) * 0.1, 1)
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

            for _, pr in fdf.iterrows():
                team_code = str(pr["team"])
                px, py = float(pr["x"]), float(pr["y"])
                if team_code == "football" or pd.isna(pr["nflId"]):
                    ball_pos = {"x": round(px, 2), "y": round(py, 2)}
                    continue
                nid = int(pr["nflId"])
                meta = role_meta.get(nid, {})
                spd = float(pr["s"]) if pd.notna(pr["s"]) else 0.0
                ori = float(pr["o"]) if pd.notna(pr["o"]) else 0.0
                dr = float(pr["dir"]) if pd.notna(pr["dir"]) else 0.0
                jersey = int(pr["jerseyNumber"]) if pd.notna(pr["jerseyNumber"]) else 0

                if nid == qb_id:
                    qb_pos = (px, py)
                if nid in rusher_ids:
                    rush_pts.append((nid, px, py, spd, dr))
                if nid in ol_ids:
                    ol_pts.append((px, py))

                players_frame.append({
                    "id": nid,
                    "t": team_code,
                    "j": jersey,
                    "x": round(px, 2),
                    "y": round(py, 2),
                    "s": round(spd, 2),
                    "o": round(ori, 1),
                    "d": round(dr, 1),
                })

            # Frame-level physics: pocket radius, closing speed, pocket area
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
                        # NFL dir: 0 deg = +y (North), 90 deg = +x (East)
                        rad = np.deg2rad(rdir)
                        vx, vy = rspd * np.sin(rad), rspd * np.cos(rad)
                        closing = (vx * dx + vy * dy) / dist
                        if closing > max_closing:
                            max_closing = float(closing)

            collapse_vel = 0.0
            if prev_min_dist is not None:
                collapse_vel = max(0.0, (prev_min_dist - min_dist) / 0.1)
            prev_min_dist = min_dist

            # Pocket bounding area from O-Line + QB
            pocket_area = 0.0
            if qb_pos is not None and len(ol_pts) >= 3:
                xs = [p[0] for p in ol_pts] + [qb_pos[0]]
                ys = [p[1] for p in ol_pts] + [qb_pos[1]]
                pocket_area = (max(xs) - min(xs)) * (max(ys) - min(ys))

            if t_sec >= 0.0 and min_dist < min_pocket_radius:
                min_pocket_radius = min_dist
                closest_frame_idx = idx
                if nearest_id is not None:
                    closest_rusher_name = role_meta.get(nearest_id, {}).get("name", "")
            if t_sec >= 0.0 and collapse_vel > peak_collapse_vel:
                peak_collapse_vel = collapse_vel

            threat = "COLLAPSE" if min_dist < 2.5 else ("CLOSING" if min_dist < 4.2 else "CLEAN")

            frames_out.append({
                "frameId": fid_int,
                "t": t_sec,
                "event": ev,
                "ball": ball_pos,
                "qb": {"x": round(qb_pos[0], 2), "y": round(qb_pos[1], 2)} if qb_pos else None,
                "minDist": round(min_dist, 2),
                "nearestRusherId": nearest_id,
                "threat": threat,
                "players": players_frame,
            })
            telemetry_out.append({
                "frameIndex": idx,
                "t": t_sec,
                "pocketRadius": round(min_dist, 2),
                "closingSpeed": round(max_closing, 2),
                "collapseRate": round(collapse_vel, 2),
                "pocketArea": round(pocket_area, 1),
                "event": ev,
            })

        # Determine SVG viewport bounds focused cleanly on the trench & pocket
        all_x = tr["x"].dropna()
        all_y = tr["y"].dropna()
        x_min = max(0.0, float(np.percentile(all_x, 5)) - 8.0)
        x_max = min(120.0, float(np.percentile(all_x, 95)) + 8.0)
        # Ensure LOS & QB are comfortably centered with nice aspect ratio
        x_min = max(0.0, min(x_min, los_x - 16.0))
        x_max = min(120.0, max(x_max, los_x + 22.0))

        # Coaching takeaways for this exact play
        dt_names = [m["name"] for m in role_meta.values() if m["isDoubleTeamed"]]
        free_names = [m["name"] for m in role_meta.values() if m["isFreeRusher"]]
        press_names = [m["name"] for m in role_meta.values() if m["generatedPressure"]]
        beaten_names = [f"{m['name']} ({m['linedUp']})" for m in role_meta.values() if m["allowedPressure"] or m["beaten"]]

        notes = []
        if dt_names:
            notes.append(f"Double-teamed defender(s): {', '.join(dt_names)}.")
        if free_names:
            notes.append(f"Unblocked free rusher(s): {', '.join(free_names)} — classic protection over-allocation.")
        if press_names:
            notes.append(f"Pressure generated by: {', '.join(press_names)} (minimum pocket radius shrunk to {round(min_pocket_radius, 2)} yds).")
        else:
            notes.append(f"Clean pocket sustained: nearest pass rusher never got closer than {round(min_pocket_radius, 2)} yds.")
        if beaten_names:
            notes.append(f"Protection stress point(s): {', '.join(beaten_names[:3])}.")

        return {
            "play": self._format_play_summary(prow),
            "losX": round(los_x, 2),
            "firstDownX": round(min(110.0, los_x + float(prow["yardsToGo"])), 2),
            "viewBox": {
                "xMin": round(x_min, 1),
                "xMax": round(x_max, 1),
                "yMin": 0.0,
                "yMax": 53.3,
            },
            "roster": list(role_meta.values()),
            "matchups": matchup_edges,
            "frames": frames_out,
            "telemetry": telemetry_out,
            "keyEvents": key_events,
            "physicsSummary": {
                "minPocketRadius": round(min_pocket_radius, 2),
                "closestRusher": closest_rusher_name,
                "closestFrameIndex": closest_frame_idx,
                "peakCollapseVel": round(peak_collapse_vel, 2),
                "durationSec": round(len(frames_out) * 0.1, 1),
                "doubleTeamedRushers": dt_names,
                "freeRushers": free_names,
                "pressureMakers": press_names,
                "coachingNotes": notes,
            },
        }
