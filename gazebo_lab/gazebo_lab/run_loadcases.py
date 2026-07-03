"""run_loadcases.py — headless batch entrypoint for one Gazebo structural run.

Called by the backend job (api/routers/structural.py) as a subprocess:

    python3 -m gazebo_lab.run_loadcases --mode rig  --run-dir <dir> --params <json>
    python3 -m gazebo_lab.run_loadcases --mode ride --run-dir <dir> --params <json> --world bump

It writes the bike SDF + world from params, launches Gazebo headless, spawns the
bike, runs the rig/ride node, and leaves ft_log.csv + manifest.json in --run-dir.

This module deliberately avoids importing ROS at top level so the backend can
import-check it without a sourced ROS environment.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time


def write_assets(run_dir: str, params: dict, mode: str, world: str):
    from gazebo_lab.bike_sdf import BikeParams, generate_sdf
    from gazebo_lab.worlds import generate_world

    os.makedirs(run_dir, exist_ok=True)
    bp = BikeParams(**{k: params[k] for k in params if k in BikeParams.__dataclass_fields__})
    sdf = generate_sdf(bp, rig=(mode == "rig"))
    world_sdf = generate_world(world, mu=getattr(bp, "mu", 1.1))
    sdf_path = os.path.join(run_dir, "bike.sdf")
    world_path = os.path.join(run_dir, "world.sdf")
    with open(sdf_path, "w") as f:
        f.write(sdf)
    with open(world_path, "w") as f:
        f.write(world_sdf)
    return sdf_path, world_path, bp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["rig", "ride"], default="rig")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--params", default="{}", help="JSON bike params")
    ap.add_argument("--world", default="flat")
    ap.add_argument("--timeout", type=float, default=60.0)
    args = ap.parse_args()

    params = json.loads(args.params)
    sdf_path, world_path, bp = write_assets(args.run_dir, params, args.mode, args.world)

    status_path = os.path.join(args.run_dir, "status.json")

    def set_status(state, **extra):
        with open(status_path, "w") as f:
            json.dump({"state": state, "mode": args.mode, "world": args.world,
                       "t": time.time(), **extra}, f)

    set_status("starting")

    env = dict(os.environ)
    env["RUN_DIR"] = args.run_dir
    env["BIKE_MASS"] = str(getattr(bp, "total_mass", 200))
    env["REAR_RADIUS"] = str(bp.rear_wheel_dia_mm / 2000.0)

    # headless gazebo (gzserver) with the generated world
    gz = subprocess.Popen(
        ["gzserver", "--verbose", world_path,
         "-s", "libgazebo_ros_factory.so"],
        env=env, preexec_fn=os.setsid,
    )
    time.sleep(4.0)  # let gazebo + plugins come up

    # spawn the bike
    spawn = subprocess.run(
        ["ros2", "run", "gazebo_ros", "spawn_entity.py",
         "-entity", "motorcycle", "-file", sdf_path,
         "-x", "0", "-y", "0", "-z", "0.1"],
        env=env, timeout=30,
    )
    set_status("running", spawn_rc=spawn.returncode)

    # controllers for ride mode
    procs = []
    if args.mode == "ride":
        for ctrl in ["joint_state_broadcaster", "steer_effort_controller", "drive_effort_controller"]:
            subprocess.run(["ros2", "run", "controller_manager", "spawner", ctrl,
                            "-c", "/gazebo_lab/controller_manager"], env=env, timeout=30)

    node_mod = "gazebo_lab.rig_node" if args.mode == "rig" else "gazebo_lab.ride_node"
    node = subprocess.Popen(["python3", "-m", node_mod], env=env, preexec_fn=os.setsid)

    # wait for the node to finish (it shuts itself down) or timeout
    t0 = time.time()
    rc = None
    while time.time() - t0 < args.timeout:
        rc = node.poll()
        if rc is not None:
            break
        time.sleep(0.5)

    for p in [node, gz, *procs]:
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGINT)
        except Exception:
            pass
    time.sleep(1.0)
    for p in [node, gz, *procs]:
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGKILL)
        except Exception:
            pass

    done = os.path.exists(os.path.join(args.run_dir, "manifest.json"))
    set_status("done" if done else "error", node_rc=rc)
    sys.exit(0 if done else 1)


if __name__ == "__main__":
    main()
