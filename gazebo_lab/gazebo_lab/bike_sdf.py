"""bike_sdf.py — parametric motorcycle SDF generator for Gazebo Classic 11.

Builds a 5-body rigid motorcycle (chassis, steer/fork, front wheel, swingarm,
rear wheel) with force-torque sensors on the structural joints. Mass/geometry
come from the SAME numbers the React app uses (passed in from the API request),
so Gazebo and the analytical engine model the same bike.

The FT sensors at the steering head and swingarm pivot ARE the interface loads
we export — a validated rigid-body engine (DART/ODE) replaces the hand free-body.

Units: SI (m, kg). Coordinate: x forward, y left, z up (Gazebo convention).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List


@dataclass
class BikeParams:
    # geometry (mm in the app → converted to m here)
    wheelbase_mm: float = 1400.0
    rake_deg: float = 24.0
    front_wheel_dia_mm: float = 620.0
    rear_wheel_dia_mm: float = 620.0
    swingarm_length_mm: float = 580.0
    swingarm_pivot_height_mm: float = 320.0
    swingarm_pivot_x_mm: float = 820.0   # from front axle
    cg_height_mm: float = 600.0
    cg_x_mm: float = 700.0               # from front axle
    # masses (kg)
    total_mass: float = 200.0
    front_unsprung: float = 18.0
    rear_unsprung: float = 22.0
    fork_mass: float = 12.0
    swingarm_mass: float = 8.0
    # suspension
    fork_travel_mm: float = 120.0
    shock_travel_mm: float = 130.0
    spring_rate_front_Nmm: float = 18.0   # combined 2-leg
    spring_rate_rear_Nmm: float = 110.0
    damp_front: float = 1500.0            # N·s/m
    damp_rear: float = 2200.0
    # tyre contact
    mu: float = 1.1
    name: str = "motorcycle"


def _inertia_box(m, lx, ly, lz):
    return (m * (ly * ly + lz * lz) / 12.0,
            m * (lx * lx + lz * lz) / 12.0,
            m * (lx * lx + ly * ly) / 12.0)


def _inertia_cyl(m, r, h):
    # axis along y (wheel spin)
    ixx = m * (3 * r * r + h * h) / 12.0
    iyy = m * r * r / 2.0
    return ixx, iyy, ixx


def _inertial(m, ixx, iyy, izz, pose="0 0 0 0 0 0"):
    return f"""      <inertial>
        <pose>{pose}</pose>
        <mass>{m:.4f}</mass>
        <inertia><ixx>{ixx:.5f}</ixx><iyy>{iyy:.5f}</iyy><izz>{izz:.5f}</izz>
          <ixy>0</ixy><ixz>0</ixz><iyz>0</iyz></inertia>
      </inertial>"""


def _wheel_link(name, x, z, r, m):
    ixx, iyy, izz = _inertia_cyl(m, r, 0.12)
    return f"""    <link name="{name}">
      <pose>{x:.4f} 0 {z:.4f} 0 0 0</pose>
{_inertial(m, ixx, iyy, izz)}
      <collision name="{name}_col">
        <pose>0 0 0 1.5708 0 0</pose>
        <geometry><cylinder><radius>{r:.4f}</radius><length>0.12</length></cylinder></geometry>
        <surface><friction><ode><mu>{1.1}</mu><mu2>{1.0}</mu2></ode></friction>
          <contact><ode><kp>1e6</kp><kd>100</kd></ode></contact></surface>
      </collision>
      <visual name="{name}_vis">
        <pose>0 0 0 1.5708 0 0</pose>
        <geometry><cylinder><radius>{r:.4f}</radius><length>0.12</length></cylinder></geometry>
      </visual>
    </link>"""


def _ft_sensor(joint_name, topic):
    """Force-torque sensor + gazebo_ros plugin publishing WrenchStamped on `topic`."""
    return f"""      <sensor name="{joint_name}_ft" type="force_torque">
        <update_rate>200</update_rate>
        <force_torque><frame>child</frame><measure_direction>child_to_parent</measure_direction></force_torque>
        <plugin name="{joint_name}_ft_plugin" filename="libgazebo_ros_ft_sensor.so">
          <ros><namespace>/gazebo_lab</namespace><remapping>wrench:={topic}</remapping></ros>
          <frame_name>{joint_name}</frame_name>
          <update_rate>200</update_rate>
        </plugin>
      </sensor>"""


def generate_sdf(p: BikeParams, rig: bool = False) -> str:
    """rig=True pins the chassis to the world (fixed joint) and adds a force plugin
    so the rig node can apply standardized load wrenches and read pure reactions
    (the R0 calibration gate that validates against the analytical engine)."""
    # geometry in metres, x forward with rear contact near origin
    rf = p.front_wheel_dia_mm / 2000.0
    rr = p.rear_wheel_dia_mm / 2000.0
    wb = p.wheelbase_mm / 1000.0
    # place front axle at x=wb, rear axle at x=0
    front_x, rear_x = wb, 0.0
    pivot_x = front_x - p.swingarm_pivot_x_mm / 1000.0
    pivot_z = p.swingarm_pivot_height_mm / 1000.0
    cg_x = front_x - p.cg_x_mm / 1000.0
    cg_z = p.cg_height_mm / 1000.0

    rake = p.rake_deg * math.pi / 180.0

    # chassis mass = total − wheels − fork − swingarm
    chassis_m = max(20.0, p.total_mass - p.front_unsprung - p.rear_unsprung - p.fork_mass - p.swingarm_mass)
    cixx, ciyy, cizz = _inertia_box(chassis_m, 0.8, 0.4, 0.6)

    # steering axis pose at front: tilt about y by rake
    # fork link sits just above front wheel along steer axis
    steer_x = front_x + 0.05 * math.sin(rake)
    steer_z = rf + 0.30
    fixx, fiyy, fizz = _inertia_box(p.fork_mass, 0.1, 0.1, 0.6)
    sixx, siyy, sizz = _inertia_box(p.swingarm_mass, p.swingarm_length_mm / 1000.0, 0.08, 0.06)

    front_spring = p.spring_rate_front_Nmm * 1000.0   # N/m
    rear_spring = p.spring_rate_rear_Nmm * 1000.0

    rig_joint = ("""    <joint name="world_fix" type="fixed"><parent>world</parent><child>chassis</child></joint>
""" if rig else "")
    # ros2_control effort interfaces (steer + drive) for the self-balancing ride node (R1)
    ros2_control = ("" if rig else """    <ros2_control name="GazeboSystem" type="system">
      <hardware><plugin>gazebo_ros2_control/GazeboSystem</plugin></hardware>
      <joint name="steering_joint"><command_interface name="effort"/>
        <state_interface name="position"/><state_interface name="velocity"/></joint>
      <joint name="rear_axle"><command_interface name="effort"/>
        <state_interface name="velocity"/></joint>
    </ros2_control>
    <plugin name="gz_ros2_control" filename="libgazebo_ros2_control.so">
      <ros><namespace>/gazebo_lab</namespace></ros>
      <parameters>$(find-pkg-share gazebo_lab)/config/controllers.yaml</parameters>
    </plugin>
""")
    rig_plugin = ("""    <plugin name="rig_force" filename="libgazebo_ros_force.so">
      <ros><namespace>/gazebo_lab</namespace><remapping>gazebo_ros_force:=rig_wrench</remapping></ros>
      <link_name>chassis</link_name><force_frame>world</force_frame>
    </plugin>
""" if rig else "")

    sdf = f"""<?xml version="1.0" ?>
<sdf version="1.6">
  <model name="{p.name}">
    <pose>0 0 0 0 0 0</pose>

    <!-- CHASSIS (frame + engine, stressed member) -->
    <link name="chassis">
      <pose>{cg_x:.4f} 0 {cg_z:.4f} 0 0 0</pose>
{_inertial(chassis_m, cixx, ciyy, cizz)}
      <visual name="chassis_vis">
        <geometry><box><size>0.8 0.3 0.4</size></box></geometry>
      </visual>
      <collision name="chassis_col">
        <geometry><box><size>0.8 0.3 0.4</size></box></geometry>
      </collision>
      <sensor name="chassis_imu" type="imu">
        <update_rate>200</update_rate><always_on>true</always_on>
        <plugin name="imu_plugin" filename="libgazebo_ros_imu_sensor.so">
          <ros><namespace>/gazebo_lab</namespace><remapping>~/out:=imu</remapping></ros>
          <frame_name>chassis</frame_name>
        </plugin>
      </sensor>
    </link>

    <!-- FORK / STEER assembly -->
    <link name="fork">
      <pose>{steer_x:.4f} 0 {steer_z:.4f} 0 {rake:.4f} 0</pose>
{_inertial(p.fork_mass, fixx, fiyy, fizz)}
      <visual name="fork_vis"><geometry><cylinder><radius>0.04</radius><length>0.6</length></cylinder></geometry></visual>
    </link>

    <!-- SWINGARM -->
    <link name="swingarm">
      <pose>{(pivot_x + (front_x - pivot_x) * 0.0):.4f} 0 {pivot_z:.4f} 0 0 0</pose>
{_inertial(p.swingarm_mass, sixx, siyy, sizz)}
      <visual name="swingarm_vis">
        <pose>{-(p.swingarm_length_mm/2000.0):.4f} 0 0 0 1.5708 0</pose>
        <geometry><box><size>{p.swingarm_length_mm/1000.0:.4f} 0.08 0.06</size></box></geometry>
      </visual>
    </link>

{_wheel_link("front_wheel", front_x, rf, rf, p.front_unsprung)}
{_wheel_link("rear_wheel", rear_x, rr, rr, p.rear_unsprung)}

    <!-- STEERING joint (revolute about rake axis) + FT sensor at steering head -->
    <joint name="steering_joint" type="revolute">
      <parent>chassis</parent><child>fork</child>
      <pose>0 0 0.3 0 0 0</pose>
      <axis><xyz>{math.sin(rake):.4f} 0 {math.cos(rake):.4f}</xyz>
        <limit><lower>-0.8</lower><upper>0.8</upper><effort>500</effort></limit>
        <dynamics><damping>2.0</damping></dynamics></axis>
      <sensor name="steering_head_ft" type="force_torque">
        <update_rate>200</update_rate>
        <force_torque><frame>child</frame><measure_direction>child_to_parent</measure_direction></force_torque>
        <plugin name="steering_head_ft_plugin" filename="libgazebo_ros_ft_sensor.so">
          <ros><namespace>/gazebo_lab</namespace><remapping>wrench:=ft/steeringHead</remapping></ros>
          <frame_name>steering_joint</frame_name><update_rate>200</update_rate>
        </plugin>
      </sensor>
    </joint>

    <!-- FRONT suspension travel (prismatic along steer axis) -->
    <joint name="front_susp" type="prismatic">
      <parent>fork</parent><child>front_wheel</child>
      <axis><xyz>0 0 1</xyz>
        <limit><lower>{-p.fork_travel_mm/1000.0:.4f}</lower><upper>0.0</upper></limit>
        <dynamics><spring_stiffness>{front_spring:.1f}</spring_stiffness><damping>{p.damp_front:.1f}</damping></dynamics></axis>
    </joint>

    <!-- SWINGARM pivot (revolute) + FT sensor -->
    <joint name="swingarm_joint" type="revolute">
      <parent>chassis</parent><child>swingarm</child>
      <pose>{(front_x - pivot_x):.4f} 0 0 0 0 0</pose>
      <axis><xyz>0 1 0</xyz>
        <limit><lower>-0.5</lower><upper>0.5</upper><effort>3000</effort></limit>
        <dynamics><spring_stiffness>{rear_spring:.1f}</spring_stiffness><damping>{p.damp_rear:.1f}</damping></dynamics></axis>
      <sensor name="swingarm_pivot_ft" type="force_torque">
        <update_rate>200</update_rate>
        <force_torque><frame>child</frame><measure_direction>child_to_parent</measure_direction></force_torque>
        <plugin name="swingarm_pivot_ft_plugin" filename="libgazebo_ros_ft_sensor.so">
          <ros><namespace>/gazebo_lab</namespace><remapping>wrench:=ft/swingarmPivot</remapping></ros>
          <frame_name>swingarm_joint</frame_name><update_rate>200</update_rate>
        </plugin>
      </sensor>
    </joint>

    <!-- REAR wheel spin (driven) -->
    <joint name="rear_axle" type="revolute">
      <parent>swingarm</parent><child>rear_wheel</child>
      <pose>0 0 0 0 0 0</pose>
      <axis><xyz>0 1 0</xyz><limit><lower>-1e16</lower><upper>1e16</upper></limit>
        <dynamics><damping>0.1</damping></dynamics></axis>
    </joint>

    <!-- FRONT wheel spin -->
    <joint name="front_axle" type="revolute">
      <parent>front_wheel</parent><child>front_wheel</child>
      <axis><xyz>0 1 0</xyz><limit><lower>-1e16</lower><upper>1e16</upper></limit></axis>
    </joint>

    <!-- ros2_control / state + effort interface -->
    <plugin name="gazebo_ros_state" filename="libgazebo_ros_state.so">
      <ros><namespace>/gazebo_lab</namespace></ros>
      <update_rate>200</update_rate>
    </plugin>
{rig_plugin}{ros2_control}{rig_joint}  </model>
</sdf>"""
    return sdf


# attachment-point name → FT topic (subset measured directly; others derived from these)
FT_TOPICS = {
    "steeringHead": "/gazebo_lab/ft/steeringHead",
    "swingarmPivot": "/gazebo_lab/ft/swingarmPivot",
}
