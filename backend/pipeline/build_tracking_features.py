"""Precompute per-play and per-rusher tracking features from data/tracking/*.csv.

Run once from the project root (about 1-2 minutes):
    Windows: .\\.venv\\Scripts\\python -m backend.pipeline.build_tracking_features
    macOS/Linux: .venv/bin/python -m backend.pipeline.build_tracking_features

Writes two small read-only CSVs to backend/precomputed/ that the API loads at startup.
The API never writes to disk; this script is the reproducible source of those files.

Definitions (10 Hz tracking, frames from snap to end of dropback):
- ttt: seconds from ball snap to pass_forward / qb_sack / qb_strip_sack / run (scramble) / fumble.
- getoff: seconds after the snap until a pass rusher has moved 1.0 yard from his snap position.
- s05: rusher speed (yd/s) 0.5 s after the snap.
- strain: mean closing rate toward the QB divided by distance to the QB (1/s).
- dmin: closest distance (yd) the rusher got to the QB before the end of the dropback.
- t2: seconds until the rusher first got within 2 yards of the QB (blank if never).
"""
from __future__ import annotations

import glob
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "backend" / "precomputed"

SNAP = {"ball_snap", "autoevent_ballsnap"}
END = {"pass_forward", "autoevent_passforward", "qb_sack", "run", "qb_strip_sack", "fumble"}


def main() -> None:
    sc = pd.read_csv(DATA / "pffScoutingData.csv", usecols=["gameId", "playId", "nflId", "pff_role"])
    play_rows: list[tuple] = []
    rush_rows: list[tuple] = []
    files = sorted(glob.glob(str(DATA / "tracking" / "tracking_*.csv")))
    for i, f in enumerate(files):
        t = pd.read_csv(f, usecols=["gameId", "playId", "nflId", "frameId", "x", "y", "s", "event"])
        t = t[t.nflId.notna()]
        gid = int(t.gameId.iat[0])
        t = t.merge(sc[sc.gameId == gid][["playId", "nflId", "pff_role"]], on=["playId", "nflId"], how="left")
        for pid, g in t.groupby("playId"):
            ev = g.drop_duplicates("frameId").set_index("frameId").event
            snaps = ev[ev.isin(SNAP)].index
            if len(snaps) == 0:
                continue
            sf = snaps.min()
            ends = ev[ev.isin(END) & (ev.index > sf)].index
            end_event = str(ev.loc[ends.min()]) if len(ends) else "none"
            ef = ends.min() if len(ends) else ev.index.max()
            qb = g[g.pff_role == "Pass"]
            if qb.nflId.nunique() != 1:
                continue
            frames = np.arange(sf, ef + 1)
            qb = qb.set_index("frameId")[["x", "y"]].reindex(frames)
            qbx, qby = qb.x.values, qb.y.values
            play_rows.append((gid, int(pid), round((ef - sf) / 10, 1), end_event))
            for rid, r in g[g.pff_role == "Pass Rush"].groupby("nflId"):
                r = r.set_index("frameId").reindex(frames)
                d = np.hypot(r.x.values - qbx, r.y.values - qby)
                if len(d) == 0 or np.isnan(d[0]):
                    continue
                moved = np.hypot(r.x.values - r.x.values[0], r.y.values - r.y.values[0])
                getoff = np.argmax(moved >= 1.0) / 10 if (moved >= 1.0).any() else np.nan
                s05 = r.s.values[min(5, len(frames) - 1)]
                vel = -np.diff(d) * 10
                strain = np.nanmean(vel / np.maximum(d[1:], 0.5)) if len(vel) else np.nan
                t2 = np.argmax(d <= 2.0) / 10 if (d <= 2.0).any() else np.nan
                rush_rows.append((gid, int(pid), int(rid), getoff, s05, strain, np.nanmin(d), t2))
        print(f"{i + 1}/{len(files)} {Path(f).name}", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(play_rows, columns=["gameId", "playId", "ttt", "endEvent"]).to_csv(OUT / "tracking_plays.csv", index=False)
    pd.DataFrame(rush_rows, columns=["gameId", "playId", "nflId", "getoff", "s05", "strain", "dmin", "t2"]).round(3).to_csv(
        OUT / "tracking_rushers.csv", index=False)
    print("OK:", len(play_rows), "plays,", len(rush_rows), "rusher-snaps ->", OUT)


if __name__ == "__main__":
    main()
