"""worlds.py — generate Gazebo Classic world SDF for each structural scenario.

flat   — calibration / static-rig reference
bump   — single half-cylinder bump (measure vertical DAF)
kerb   — lateral kerb edge (measure lateral impact)
jump   — ramp + gap for drop landing (measure landing DAF)
"""

from __future__ import annotations

_HEADER = """<?xml version="1.0" ?>
<sdf version="1.6">
  <world name="{name}">
    <physics type="ode"><max_step_size>0.0005</max_step_size><real_time_update_rate>2000</real_time_update_rate></physics>
    <plugin name="gazebo_ros_factory" filename="libgazebo_ros_factory.so"><ros><namespace>/gazebo_lab</namespace></ros></plugin>
    <include><uri>model://sun</uri></include>
    <model name="ground"><static>true</static>
      <link name="link"><collision name="c"><geometry><plane><normal>0 0 1</normal><size>200 200</size></plane></geometry>
        <surface><friction><ode><mu>{mu}</mu><mu2>{mu}</mu2></ode></friction></surface></collision>
        <visual name="v"><geometry><plane><normal>0 0 1</normal><size>200 200</size></plane></geometry></visual>
      </link></model>
"""

_FOOTER = "  </world>\n</sdf>\n"


def _obstacle(name, pose, size):
    return f"""    <model name="{name}"><static>true</static>
      <link name="link"><pose>{pose}</pose>
        <collision name="c"><geometry><box><size>{size}</size></box></geometry></collision>
        <visual name="v"><geometry><box><size>{size}</size></box></geometry></visual>
      </link></model>
"""


def generate_world(scenario: str = "flat", mu: float = 1.1) -> str:
    body = ""
    if scenario == "bump":
        body = _obstacle("bump", "5 0 0.03 0 0 0", "0.15 4 0.06")
    elif scenario == "kerb":
        body = _obstacle("kerb", "5 0.6 0.05 0 0 0", "4 0.1 0.10")
    elif scenario == "jump":
        body = _obstacle("ramp", "5 0 0.15 0 -0.18 0", "1.2 2 0.05")
    return _HEADER.format(name=scenario, mu=mu) + body + _FOOTER


SCENARIO_DAF_KIND = {
    "flat": "static", "bump": "impact", "kerb": "impact", "jump": "impact",
}
