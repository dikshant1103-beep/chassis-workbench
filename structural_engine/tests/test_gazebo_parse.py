"""Validation for the Gazebo FT-log parser (no Gazebo needed — synthetic CSV)."""

import json
import os

from structural_engine.gazebo_parse import parse_ft_log


def _write_run(tmp_path):
    run = str(tmp_path)
    rows = [
        "t,case,attachment,Fx,Fy,Fz,Tx,Ty,Tz",
        # static: steeringHead Fz 980, swingarmPivot Fz 980
        "0.5,static1up,steeringHead,0,0,980,0,0,0",
        "0.6,static1up,swingarmPivot,0,0,980,0,0,0",
        # bump: 2.5x vertical
        "1.5,bump,steeringHead,0,0,2450,0,5,0",
        "1.6,bump,swingarmPivot,0,0,2450,0,3,0",
        # landing: 4x
        "2.5,landing,steeringHead,0,0,3920,0,7,0",
    ]
    with open(os.path.join(run, "ft_log.csv"), "w") as f:
        f.write("\n".join(rows))
    with open(os.path.join(run, "manifest.json"), "w") as f:
        json.dump({"mode": "rig", "attachments": ["steeringHead", "swingarmPivot"]}, f)
    return run


def test_parse_peaks_and_daf(tmp_path):
    run = _write_run(tmp_path)
    out = parse_ft_log(run)
    assert out["ok"] is True
    assert out["provenance"] == "gazebo"
    # peak resultant captured
    assert out["cases"]["bump"]["steeringHead"]["resultantF_N"] == 2450.0
    # measured DAF = peak/static
    assert out["measured_daf"]["bump"]["steeringHead"] == 2.5
    assert out["measured_daf"]["landing"]["steeringHead"] == 4.0


def test_parse_missing(tmp_path):
    out = parse_ft_log(str(tmp_path))
    assert out["ok"] is False
