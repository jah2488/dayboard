#!/bin/bash
# Fires the morning sweep against the always-on dayboard server. Run by launchd
# each morning; also runnable by hand. The server (kept alive by launchd) does
# the actual claude -p sweep and creates today's "Morning" edition.
set -euo pipefail

PORT="${PORT:-4747}"
DATE="$(date +%F)"

curl -fsS -X POST "http://localhost:${PORT}/api/sweep" \
  -H 'content-type: application/json' \
  -d "{\"date\":\"${DATE}\",\"label\":\"Morning\",\"trigger\":\"morning\"}" \
  && echo "[morning-run] sweep started for ${DATE}"

# Brain sweep is best-effort: under `set -e` the `|| echo` keeps a failure here
# from ever breaking the morning sweep above.
curl -fsS -X POST "http://localhost:${PORT}/api/brain/sweep" \
  -H 'content-type: application/json' \
  -d '{"force":false}' \
  > /dev/null \
  && echo "[morning-run] brain sweep started" \
  || echo "[morning-run] brain sweep failed to start (ignored)"
