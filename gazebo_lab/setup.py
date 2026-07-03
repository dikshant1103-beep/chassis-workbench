import os
from glob import glob
from setuptools import setup

package_name = "gazebo_lab"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        (os.path.join("share", package_name, "launch"), glob("launch/*.py")),
        (os.path.join("share", package_name, "config"), glob("config/*.yaml")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="dikshant",
    maintainer_email="261631710+dikshant1103-beep@users.noreply.github.com",
    description="Structural load-case Gazebo lab for Chassis Workbench",
    license="MIT",
    entry_points={
        "console_scripts": [
            "rig_node = gazebo_lab.rig_node:main",
            "ride_node = gazebo_lab.ride_node:main",
            "ft_logger = gazebo_lab.ft_logger:main",
            "run_loadcases = gazebo_lab.run_loadcases:main",
        ],
    },
)
