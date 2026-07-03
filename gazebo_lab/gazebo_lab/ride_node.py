"""ride_node.py — R1 self-balancing ridden motorcycle (dynamic load cases).

A steer-to-balance controller keeps the bike upright while it runs standard
maneuvers; the FT sensors log the *dynamic* interface loads, and the impact
worlds (bump/jump) give *measured* dynamic amplification.

Control (Whipple-style steer-into-the-fall, ref BicyclePaper1Andyv23):
    steer_effort = -(Kp·φ + Kd·φ̇)  + Kpath·(φ_cmd − φ)      (balance + path/lean)
    drive_effort =  Kv·(v_target − v)                          (speed)

φ (roll) from chassis IMU; v from rear-wheel speed × radius. Gains via env / yaml.
These gains ALWAYS need on-machine tuning — flagged in README. The rig node (R0)
is the validated gate; this node is the high-fidelity dynamic tier.
"""

from __future__ import annotations

import csv
import json
import math
import os
import time

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Imu, JointState
from std_msgs.msg import Float64MultiArray
from geometry_msgs.msg import WrenchStamped

from gazebo_lab.bike_sdf import FT_TOPICS

G = 9.81


def quat_to_roll(x, y, z, w):
    return math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))


class RideNode(Node):
    def __init__(self):
        super().__init__("ride_node")
        self.out_dir = os.environ.get("RUN_DIR", "/tmp/gazebo_lab_run")
        os.makedirs(self.out_dir, exist_ok=True)
        self.rear_r = float(os.environ.get("REAR_RADIUS", "0.31"))
        # balance gains (tune on-machine)
        self.Kp = float(os.environ.get("BAL_KP", "180"))
        self.Kd = float(os.environ.get("BAL_KD", "40"))
        self.Kpath = float(os.environ.get("BAL_KPATH", "60"))
        self.Kv = float(os.environ.get("DRIVE_KV", "25"))
        self.v_target = float(os.environ.get("V_TARGET", "12"))  # m/s

        self.roll = 0.0
        self.roll_rate = 0.0
        self.v = 0.0
        self.phi_cmd = 0.0

        self.steer_pub = self.create_publisher(Float64MultiArray, "/gazebo_lab/steer_effort_controller/commands", 10)
        self.drive_pub = self.create_publisher(Float64MultiArray, "/gazebo_lab/drive_effort_controller/commands", 10)
        self.create_subscription(Imu, "/gazebo_lab/imu", self._imu_cb, 50)
        self.create_subscription(JointState, "/gazebo_lab/joint_states", self._js_cb, 50)
        self.latest = {}
        for name, topic in FT_TOPICS.items():
            self.create_subscription(WrenchStamped, topic, self._ft_cb(name), 50)

        self.fh = open(os.path.join(self.out_dir, "ft_log.csv"), "w", newline="")
        self.w = csv.writer(self.fh)
        self.w.writerow(["t", "maneuver", "attachment", "Fx", "Fy", "Fz", "Tx", "Ty", "Tz", "roll", "v"])

        # maneuver schedule: (label, duration_s, v_target, phi_cmd_rad)
        self.maneuvers = [
            ("spinup",    4.0, self.v_target, 0.0),
            ("straight",  2.0, self.v_target, 0.0),
            ("corner10",  4.0, self.v_target, 0.45),   # ~26° lean
            ("straight2", 1.5, self.v_target, 0.0),
            ("brake10",   2.5, 0.0,           0.0),
        ]
        self.mi = 0
        self.t0 = time.time()
        self.man_t0 = time.time()
        self.timer = self.create_timer(0.01, self._tick)  # 100 Hz control
        self.get_logger().info("RideNode: balance controller live")

    def _imu_cb(self, msg: Imu):
        q = msg.orientation
        self.roll = quat_to_roll(q.x, q.y, q.z, q.w)
        self.roll_rate = msg.angular_velocity.x

    def _js_cb(self, msg: JointState):
        try:
            i = msg.name.index("rear_axle")
            self.v = abs(msg.velocity[i]) * self.rear_r
        except (ValueError, IndexError):
            pass

    def _ft_cb(self, name):
        def f(msg: WrenchStamped):
            self.latest[name] = msg.wrench
        return f

    def _tick(self):
        now = time.time()
        if self.mi >= len(self.maneuvers):
            self._finish()
            return
        label, dur, vt, phi_cmd = self.maneuvers[self.mi]

        # balance + path control
        steer = -(self.Kp * self.roll + self.Kd * self.roll_rate) + self.Kpath * (phi_cmd - self.roll)
        steer = max(-400.0, min(400.0, steer))
        drive = self.Kv * (vt - self.v)
        drive = max(-600.0, min(600.0, drive))

        self.steer_pub.publish(Float64MultiArray(data=[steer]))
        self.drive_pub.publish(Float64MultiArray(data=[drive]))

        for name, wr in self.latest.items():
            self.w.writerow([f"{now - self.t0:.4f}", label, name,
                             f"{wr.force.x:.3f}", f"{wr.force.y:.3f}", f"{wr.force.z:.3f}",
                             f"{wr.torque.x:.4f}", f"{wr.torque.y:.4f}", f"{wr.torque.z:.4f}",
                             f"{self.roll:.4f}", f"{self.v:.3f}"])

        if (now - self.man_t0) > dur:
            self.mi += 1
            self.man_t0 = now
        # crash guard
        if abs(self.roll) > 1.2:
            self.get_logger().warn(f"fell over (roll={math.degrees(self.roll):.0f}°) — tune BAL_KP/KD")
            self._finish()

    def _finish(self):
        self.fh.flush(); self.fh.close()
        with open(os.path.join(self.out_dir, "manifest.json"), "w") as f:
            json.dump({"mode": "ride", "maneuvers": [m[0] for m in self.maneuvers],
                       "attachments": list(FT_TOPICS)}, f, indent=2)
        self.get_logger().info("RideNode done")
        self.timer.cancel()
        rclpy.shutdown()


def main(args=None):
    rclpy.init(args=args)
    node = RideNode()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, Exception):
        pass
    finally:
        try:
            node.destroy_node()
        except Exception:
            pass


if __name__ == "__main__":
    main()
