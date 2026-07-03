"""
conftest.py — project-level pytest fixture file.

Strips ROS2 paths from sys.path before test collection.
ROS2 Humble registers a pytest11 entry point (launch_testing_ros) that is
incompatible with pytest ≥ 8 on Python 3.13. When PYTHONPATH includes
/opt/ros/humble/..., pytest finds and tries to load the plugin, fails with
PluginValidationError, and aborts before running any test.
"""

import sys

sys.path = [p for p in sys.path if "/opt/ros" not in p and "ros/humble" not in p]
