# gazebo_lab — Structural Load-Case Lab (Gazebo Classic 11 + ROS 2 Humble)

High-fidelity (Layer B) physics for the Chassis Workbench **Load Cases** and
**Stiffness Targets** tabs. A parametric motorcycle with **force-torque sensors**
on the structural joints generates *measured* interface loads — a validated
rigid-body engine (DART/ODE) instead of the hand free-body. The same bike numbers
the React app uses are passed in, so the two model the same machine.

Detected stack: **ROS 2 Humble**, **Gazebo Classic 11.10.2**, `gazebo_ros_pkgs`.

## Two modes
- **`rig` (R0) — the calibration gate.** Bike pinned to the world; standardized load
  wrenches applied; FT reactions logged. No balancing. **Must agree with the
  analytical engine (<5%)** before trusting Gazebo. This mode is fully wired.
- **`ride` (R1) — self-balancing ridden bike.** A steer-to-balance controller keeps
  the bike upright through maneuvers (spin-up → corner → brake) while FT sensors log
  the *dynamic* loads; impact worlds (bump/jump) give *measured* DAFs.
  **Requires `ros2_control` (`gazebo_ros2_control`) and on-machine gain tuning** —
  `BAL_KP`, `BAL_KD`, `BAL_KPATH`, `DRIVE_KV`, `V_TARGET` (env vars). This is the
  known hard part; expect to tune before it stays upright.

## Build
```bash
# put gazebo_lab in a ROS 2 workspace
mkdir -p ~/ws_chassis/src && ln -s /home/dikshant/Desktop/Moter_bike/gazebo_lab ~/ws_chassis/src/
cd ~/ws_chassis
source /opt/ros/humble/setup.bash
colcon build --packages-select gazebo_lab
source install/setup.bash
# ride mode also needs: sudo apt install ros-humble-gazebo-ros2-control ros-humble-ros2-controllers
```

## Run (interactive / GUI, for eyeballing)
```bash
ros2 launch gazebo_lab loadcases.launch.py mode:=rig  world:=flat headless:=false
ros2 launch gazebo_lab loadcases.launch.py mode:=ride world:=bump headless:=false
```

## Run (headless, what the backend calls)
```bash
python3 -m gazebo_lab.run_loadcases --mode rig  --run-dir /tmp/run1 --world flat \
  --params '{"total_mass":200,"wheelbase_mm":1400,"rake_deg":24}'
# → /tmp/run1/ft_log.csv + manifest.json
```

## From the app (Layer B button)
`POST /api/structural/gazebo/run {mode, world, params}` → `job_id`
`GET /api/structural/gazebo/status/{id}` → `running|done|error`
`GET /api/structural/gazebo/result/{id}` → per-attachment peak loads + **measured DAF**,
provenance `gazebo`. The Load Cases tab overlays these next to the analytical values
with a three-way agreement badge.

## Files
| File | Role |
|------|------|
| `gazebo_lab/bike_sdf.py` | parametric 5-body bike SDF + FT sensors + IMU + ros2_control |
| `gazebo_lab/worlds.py` | flat / bump / kerb / jump worlds |
| `gazebo_lab/rig_node.py` | R0 load-wrench applier + FT logger (validated gate) |
| `gazebo_lab/ride_node.py` | R1 steer-to-balance controller + maneuver runner |
| `gazebo_lab/run_loadcases.py` | headless batch entrypoint (spawns gz, runs node) |
| `config/controllers.yaml` | ros2_control effort controllers (steer + drive) |
| `../structural_engine/gazebo_parse.py` | FT log → load summary + measured DAF |

## Honesty notes
- Gazebo is **rigid-body** (optionally lumped joint compliance) — it produces *loads*
  and *forward-tests* a stiffness; it does **not** do structural FEA / derive frame
  stiffness. That stays ANSYS's job (the whole point of the concept-lane positioning).
- Tyre contact uses an ODE friction cone calibrated to μ; swap in a Pacejka/PINN tyre
  plugin later for higher fidelity (kept separate from the moto_sim tyre work).
- R0 (rig) is verified by XML well-formedness here + agreement with the analytical
  engine on-machine. R1 (ride) balance gains are machine-specific and need tuning.
