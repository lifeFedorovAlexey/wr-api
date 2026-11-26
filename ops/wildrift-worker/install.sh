#!/usr/bin/env bash
# Permanent, versioned bootstrap. Later application updates need no sudo input.
set -euo pipefail
[[ "$EUID" == 0 && "$(hostname)" == kolvrt ]] || { echo 'Run as root on kolvrt' >&2; exit 1; }
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET=/srv/services/wildrift-worker
[[ -f "$TARGET/compose.yaml" && -f "$TARGET/.env" && -x "$TARGET/publish-public-data.sh" ]]
python3 - "$SOURCE" <<'PY'
import ast, pathlib, sys
for name in ('update.py', 'observe.py'):
    ast.parse((pathlib.Path(sys.argv[1]) / name).read_text())
PY
# Let the old observer finish before replacing it; no collector is interrupted.
monitor_active=$(systemctl is-active wildrift-monitor.timer || true)
systemctl stop wildrift-monitor.timer
trap '[[ "$monitor_active" != active ]] || systemctl start wildrift-monitor.timer' EXIT
for attempt in $(seq 1 30); do
  state=$(systemctl show wildrift-monitor.service -p ActiveState --value)
  [[ "$state" != active && "$state" != activating && "$state" != deactivating ]] && break
  sleep 1
done
[[ "$state" != active && "$state" != activating && "$state" != deactivating ]]
install -o root -g root -m 0755 "$SOURCE/update.py" "$TARGET/update.py"
install -o root -g root -m 0755 "$SOURCE/observe.py" "$TARGET/observe.py"
install -o root -g root -m 0644 "$SOURCE/wildrift-worker-update.service" /etc/systemd/system/
install -o root -g root -m 0644 "$SOURCE/wildrift-worker-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wildrift-worker-update.timer
systemctl start --no-block wildrift-worker-update.service
echo 'Worker auto-update timer enabled; existing database, compose and secrets preserved.'
