#!/usr/bin/env bash
# Run backend tests with ROS2 paths stripped from PYTHONPATH.
# Required because sourcing /opt/ros/humble/setup.bash injects Python 3.10
# paths that confuse pytest 9 on Python 3.13, causing an INTERNALERROR on
# startup before any test runs.
PYTHONPATH="" python -m pytest "$@"
