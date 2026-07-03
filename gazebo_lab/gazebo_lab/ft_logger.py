"""ft_logger.py — ROS 2 node that records force-torque sensor wrenches to CSV.

Subscribes to every FT topic published by the bike model and writes a flat CSV
(time, topic, Fx..Tz). The backend parser turns this into per-attachment-point
load summaries with measured dynamic amplification.
"""

from __future__ import annotations

import csv
import os
import time

import rclpy
from rclpy.node import Node
from geometry_msgs.msg import WrenchStamped

from gazebo_lab.bike_sdf import FT_TOPICS


class FTLogger(Node):
    def __init__(self, out_csv: str, topics=None):
        super().__init__("ft_logger")
        topics = topics or FT_TOPICS
        os.makedirs(os.path.dirname(out_csv), exist_ok=True)
        self._fh = open(out_csv, "w", newline="")
        self._w = csv.writer(self._fh)
        self._w.writerow(["t", "attachment", "Fx", "Fy", "Fz", "Tx", "Ty", "Tz"])
        self._t0 = time.time()
        self._subs = []
        for name, topic in topics.items():
            self._subs.append(
                self.create_subscription(WrenchStamped, topic, self._make_cb(name), 50)
            )
        self.get_logger().info(f"FTLogger → {out_csv} on {list(topics)}")

    def _make_cb(self, name):
        def cb(msg: WrenchStamped):
            f, tq = msg.wrench.force, msg.wrench.torque
            self._w.writerow([f"{time.time() - self._t0:.4f}", name,
                              f"{f.x:.3f}", f"{f.y:.3f}", f"{f.z:.3f}",
                              f"{tq.x:.4f}", f"{tq.y:.4f}", f"{tq.z:.4f}"])
        return cb

    def close(self):
        try:
            self._fh.flush()
            self._fh.close()
        except Exception:
            pass


def main(args=None):
    rclpy.init(args=args)
    out = os.environ.get("FT_CSV", "/tmp/gazebo_lab_ft.csv")
    node = FTLogger(out)
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.close()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
