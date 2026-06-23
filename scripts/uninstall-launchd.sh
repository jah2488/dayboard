#!/bin/bash
# Removes the dayboard LaunchAgents (stops the always-on server + morning sweep).
set -euo pipefail

AGENTS_DIR="${HOME}/Library/LaunchAgents"
for label in com.dayboard.server com.dayboard.morning; do
  launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
  rm -f "${AGENTS_DIR}/${label}.plist"
  echo "✓ removed ${label}"
done
