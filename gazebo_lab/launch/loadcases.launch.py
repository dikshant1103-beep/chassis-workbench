"""loadcases.launch.py — convenience launch for interactive (GUI) runs.

For the headless backend pipeline use `python3 -m gazebo_lab.run_loadcases`.
This launch is for eyeballing the model:

    ros2 launch gazebo_lab loadcases.launch.py mode:=rig world:=flat
    ros2 launch gazebo_lab loadcases.launch.py mode:=ride world:=bump headless:=false
"""

import os
import tempfile

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, OpaqueFunction
from launch.substitutions import LaunchConfiguration


def _setup(context, *args, **kwargs):
    mode = LaunchConfiguration("mode").perform(context)
    world = LaunchConfiguration("world").perform(context)
    headless = LaunchConfiguration("headless").perform(context).lower() == "true"

    from gazebo_lab.bike_sdf import BikeParams, generate_sdf
    from gazebo_lab.worlds import generate_world

    run_dir = tempfile.mkdtemp(prefix="gazebo_lab_")
    sdf_path = os.path.join(run_dir, "bike.sdf")
    world_path = os.path.join(run_dir, "world.sdf")
    bp = BikeParams()
    with open(sdf_path, "w") as f:
        f.write(generate_sdf(bp, rig=(mode == "rig")))
    with open(world_path, "w") as f:
        f.write(generate_world(world, mu=bp.mu))

    gz_bin = "gzserver" if headless else "gazebo"
    actions = [
        ExecuteProcess(cmd=[gz_bin, "--verbose", world_path, "-s", "libgazebo_ros_factory.so"],
                       output="screen"),
        ExecuteProcess(cmd=["ros2", "run", "gazebo_ros", "spawn_entity.py",
                            "-entity", "motorcycle", "-file", sdf_path, "-z", "0.1"],
                       output="screen"),
        ExecuteProcess(cmd=["python3", "-m", f"gazebo_lab.{'rig_node' if mode == 'rig' else 'ride_node'}"],
                       additional_env={"RUN_DIR": run_dir, "BIKE_MASS": str(bp.total_mass)},
                       output="screen"),
    ]
    print(f"[gazebo_lab] run dir: {run_dir}")
    return actions


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument("mode", default_value="rig"),
        DeclareLaunchArgument("world", default_value="flat"),
        DeclareLaunchArgument("headless", default_value="true"),
        OpaqueFunction(function=_setup),
    ])
