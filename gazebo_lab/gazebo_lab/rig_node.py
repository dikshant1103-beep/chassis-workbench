"""rig_node.py — R0 virtual chassis test rig (calibration gate).

The bike is pinned to the world (rig SDF). This node applies a sequence of
standardized load wrenches to the chassis and records the force-torque reactions
at the steering head and swingarm pivot. With no balancing needed, this is the
gate that must agree with the analytical engine (<5%) before we trust Gazebo.

Mirrors a real chassis stiffness/load bench.
"""

from __future__ import annotations

import csv
import json
import os
import time

import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Wrench, WrenchStamped

from gazebo_lab.bike_sdf import FT_TOPICS

G = 9.81


class RigNode(Node):
    def __init__(self):
        super().__init__("rig_node")
        m = float(os.environ.get("BIKE_MASS", "200"))
        self.out_dir = os.environ.get("RUN_DIR", "/tmp/gazebo_lab_run")
        os.makedirs(self.out_dir, exist_ok=True)
        W = m * G
        # (label, Fx, Fy, Fz) applied to chassis CoG, N
        self.cases = [
            ("static1up", 0.0, 0.0, W),
            ("bump",      0.0, 0.0, W * 2.5),
            ("landing",   0.0, 0.0, W * 4.0),
            ("brake10",  -W * 1.0, 0.0, W),
            ("corner10",  0.0, W * 1.0, W),
        ]
        self.case_dwell = 1.5  # s per case
        self.settle = 0.5      # s ignored at start of each case

        self.pub = self.create_publisher(Wrench, "/gazebo_lab/rig_wrench", 10)
        self.latest = {}
        for name, topic in FT_TOPICS.items():
            self.create_subscription(WrenchStamped, topic, self._cb(name), 50)

        self.fh = open(os.path.join(self.out_dir, "ft_log.csv"), "w", newline="")
        self.w = csv.writer(self.fh)
        self.w.writerow(["t", "case", "attachment", "Fx", "Fy", "Fz", "Tx", "Ty", "Tz"])

        self.idx = 0
        self.case_t0 = time.time()
        self.t0 = time.time()
        self.timer = self.create_timer(0.02, self._tick)  # 50 Hz
        self.get_logger().info(f"RigNode: {len(self.cases)} cases → {self.out_dir}")

    def _cb(self, name):
        def f(msg: WrenchStamped):
            self.latest[name] = msg.wrench
        return f

    def _tick(self):
        now = time.time()
        if self.idx >= len(self.cases):
            self._finish()
            return
        label, fx, fy, fz = self.cases[self.idx]
        wr = Wrench()
        wr.force.x, wr.force.y, wr.force.z = fx, fy, fz
        self.pub.publish(wr)

        if (now - self.case_t0) > self.settle:
            for name, w in self.latest.items():
                self.w.writerow([f"{now - self.t0:.4f}", label, name,
                                 f"{w.force.x:.3f}", f"{w.force.y:.3f}", f"{w.force.z:.3f}",
                                 f"{w.torque.x:.4f}", f"{w.torque.y:.4f}", f"{w.torque.z:.4f}"])

        if (now - self.case_t0) > self.case_dwell:
            self.idx += 1
            self.case_t0 = now

    def _finish(self):
        self.fh.flush(); self.fh.close()
        with open(os.path.join(self.out_dir, "manifest.json"), "w") as f:
            json.dump({"mode": "rig", "cases": [c[0] for c in self.cases],
                       "attachments": list(FT_TOPICS)}, f, indent=2)
        self.get_logger().info("RigNode done — ft_log.csv + manifest.json written")
        self.timer.cancel()
        rclpy.shutdown()


def main(args=None):
    rclpy.init(args=args)
    node = RigNode()
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
