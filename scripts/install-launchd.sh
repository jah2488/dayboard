#!/bin/bash
# Installs two LaunchAgents so dayboard is always on and sweeps every morning:
#   com.dayboard.server   — keeps `npm start` alive on PORT (RunAtLoad + KeepAlive)
#   com.dayboard.morning  — fires the morning sweep at MORNING_HOUR:MORNING_MIN
#
# Re-running is safe (it reloads). Uninstall: scripts/uninstall-launchd.sh
set -euo pipefail

PORT="${PORT:-4747}"
MORNING_HOUR="${MORNING_HOUR:-7}"
MORNING_MIN="${MORNING_MIN:-0}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/dayboard"
mkdir -p "${AGENTS_DIR}" "${LOG_DIR}"

# Resolve absolute binaries — launchd runs with a minimal PATH.
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
CLAUDE_BIN="$(command -v claude || true)"
NODE_DIR="$(dirname "${NODE_BIN}")"
CLAUDE_DIR="$([ -n "${CLAUDE_BIN}" ] && dirname "${CLAUDE_BIN}" || echo "${HOME}/.local/bin")"
PATH_ENV="${NODE_DIR}:${CLAUDE_DIR}:/usr/bin:/bin:/usr/sbin:/sbin"

SERVER_PLIST="${AGENTS_DIR}/com.dayboard.server.plist"
MORNING_PLIST="${AGENTS_DIR}/com.dayboard.morning.plist"

# Headless auth: under launchd there's no interactive session, so claude can't
# read its login-keychain credentials (it hangs/​fails "not logged in"). Pass a
# long-lived token from `claude setup-token` (uses your subscription, no API
# billing) so the sweep authenticates without the keychain. Optional but
# required for the morning sweep to work unattended.
TOKEN_LINE=""
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  TOKEN_LINE="<key>CLAUDE_CODE_OAUTH_TOKEN</key><string>${CLAUDE_CODE_OAUTH_TOKEN}</string>"
fi

cat > "${SERVER_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dayboard.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NPM_BIN}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${PROJECT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${PATH_ENV}</string>
    <key>PORT</key><string>${PORT}</string>
    <key>SWEEP_CLAUDE_BIN</key><string>${CLAUDE_BIN}</string>
    ${TOKEN_LINE}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_DIR}/server.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/server.err.log</string>
</dict>
</plist>
EOF

cat > "${MORNING_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dayboard.morning</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_DIR}/bin/morning-run.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${PATH_ENV}</string>
    <key>PORT</key><string>${PORT}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${MORNING_HOUR}</integer>
    <key>Minute</key><integer>${MORNING_MIN}</integer>
  </dict>
  <key>StandardOutPath</key><string>${LOG_DIR}/morning.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/morning.err.log</string>
</dict>
</plist>
EOF

# Reload both (bootout is a no-op if not loaded).
for label in com.dayboard.server com.dayboard.morning; do
  launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
done
launchctl bootstrap "gui/$(id -u)" "${SERVER_PLIST}"
launchctl bootstrap "gui/$(id -u)" "${MORNING_PLIST}"

echo "✓ installed:"
echo "  server  → http://localhost:${PORT} (always on)"
echo "  morning → sweep daily at ${MORNING_HOUR}:$(printf '%02d' "${MORNING_MIN}")"
echo "  logs    → ${LOG_DIR}/"
echo "  build the UI first if you haven't: (cd ${PROJECT_DIR} && npm run build)"
