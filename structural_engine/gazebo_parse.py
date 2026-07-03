"""structural_engine/gazebo_parse.py — turn a Gazebo run's FT log into load summaries.

Reads <run_dir>/ft_log.csv (written by rig_node / ride_node) and produces, per
attachment point and per case/maneuver: peak resultant force, peak moment, and —
for the impact cases — the MEASURED dynamic amplification factor (peak / static).
Provenance is tagged 'gazebo'. This is what overlays the analytical loads in the app.
"""

from __future__ import annotations

import csv
import json
import math
import os
from collections import defaultdict
from typing import Dict, List, Optional


def _resultant(fx, fy, fz):
    return math.sqrt(fx * fx + fy * fy + fz * fz)


def parse_ft_log(run_dir: str) -> dict:
    csv_path = os.path.join(run_dir, "ft_log.csv")
    if not os.path.exists(csv_path):
        return {"ok": False, "error": f"no ft_log.csv in {run_dir}"}

    # peaks[(case, attachment)] = {Fres, M, Fz}
    peaks: Dict[tuple, dict] = defaultdict(lambda: {"Fres": 0.0, "M": 0.0, "Fz": 0.0, "n": 0})
    with open(csv_path) as f:
        r = csv.DictReader(f)
        case_key = "case" if "case" in (r.fieldnames or []) else "maneuver"
        for row in r:
            try:
                fx, fy, fz = float(row["Fx"]), float(row["Fy"]), float(row["Fz"])
                tx, ty, tz = float(row["Tx"]), float(row["Ty"]), float(row["Tz"])
            except (KeyError, ValueError):
                continue
            k = (row.get(case_key, "?"), row["attachment"])
            fres = _resultant(fx, fy, fz)
            m = _resultant(tx, ty, tz)
            p = peaks[k]
            p["Fres"] = max(p["Fres"], fres)
            p["M"] = max(p["M"], m)
            p["Fz"] = max(p["Fz"], abs(fz))
            p["n"] += 1

    # restructure: per case → per attachment
    cases: Dict[str, Dict[str, dict]] = defaultdict(dict)
    for (case, att), v in peaks.items():
        cases[case][att] = {"resultantF_N": round(v["Fres"], 1),
                            "moment_Nm": round(v["M"], 2),
                            "Fz_N": round(v["Fz"], 1),
                            "samples": v["n"]}

    # measured DAF for impact cases vs the static baseline (rig runs)
    daf: Dict[str, Dict[str, float]] = {}
    static = cases.get("static1up")
    if static:
        for case in ("bump", "landing", "pothole", "kerb"):
            if case in cases:
                daf[case] = {}
                for att, vals in cases[case].items():
                    base = static.get(att, {}).get("Fz_N", 0.0)
                    if base > 1.0:
                        daf[case][att] = round(vals["Fz_N"] / base, 2)

    manifest = {}
    mpath = os.path.join(run_dir, "manifest.json")
    if os.path.exists(mpath):
        with open(mpath) as f:
            manifest = json.load(f)

    return {
        "ok": True,
        "provenance": "gazebo",
        "mode": manifest.get("mode"),
        "attachments_measured": manifest.get("attachments", []),
        "cases": cases,
        "measured_daf": daf,
    }
