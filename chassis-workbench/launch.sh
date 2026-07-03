#!/usr/bin/env bash
# Launch Chassis Workbench — starts Electron (which spawns the Python backend internally)
cd "$(dirname "$0")"
exec ./node_modules/.bin/electron .
