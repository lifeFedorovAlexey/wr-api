#!/usr/bin/env python3
"""Publish history and systemd state from the existing privileged observer unit."""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

STATE = Path('/srv/data/wildrift-worker/status.json')
UNITS = ('wildrift-scraper.timer', 'wildrift-scraper.service')


def read_snapshot(path):
    try:
        if path.stat().st_size > 3 * 1024 * 1024:
            return {}
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def process_snapshot():
    try:
        result = subprocess.run(['/usr/bin/systemctl', 'show', *UNITS,
                                 '--property=Id,LoadState,ActiveState,SubState,Result,MainPID'],
                                capture_output=True, text=True, timeout=2, check=False)
        units = [dict(line.split('=', 1) for line in part.splitlines() if '=' in line)
                 for part in result.stdout.strip().split('\n\n') if part.strip()]
        complete = {unit.get('Id') for unit in units} == set(UNITS) and all(unit.get('LoadState') for unit in units)
        missing = any(unit.get('LoadState') == 'not-found' for unit in units)
        if complete and (result.returncode == 0 or missing):
            return units, dt.datetime.now(dt.timezone.utc).isoformat()
    except (OSError, subprocess.SubprocessError):
        pass
    return [], None


def publish(path, data):
    descriptor, temporary = tempfile.mkstemp(prefix='.observe-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(data, output, ensure_ascii=False)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def observe(path=STATE):
    previous = read_snapshot(path)
    raw_path = path.with_name('database-status.json')
    started_ns = time.time_ns()
    successful = False
    try:
        # The final snapshot preserves history. A raw file must be produced by
        # this invocation, even when filesystem timestamp resolution is coarse.
        raw_path.unlink(missing_ok=True)
        result = subprocess.run(['/usr/bin/docker', 'compose', 'run', '--rm', '--name', 'wildrift-monitor', 'observer'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=18, check=False)
        successful = result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        pass
    if successful:
        data = read_snapshot(raw_path)
        try:
            collected_at = dt.datetime.fromisoformat(data.get('collectedAt', '').replace('Z', '+00:00'))
            successful = (data.get('ok') is True and raw_path.stat().st_mtime_ns >= started_ns - 1_000_000_000
                          and abs((dt.datetime.now(dt.timezone.utc) - collected_at).total_seconds()) <= 90)
        except (OSError, TypeError, ValueError, AttributeError):
            successful = False
    if not successful:
        # Stop a timed-out container before publishing an explicit stale snapshot.
        try:
            subprocess.run(['/usr/bin/docker', 'stop', '-t', '1', 'wildrift-monitor'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2, check=False)
        except (OSError, subprocess.SubprocessError):
            pass
        data = {**previous, 'ok': False, 'error': 'Не удалось обновить данные сборщика. Показана последняя полученная история.'}
    data['processes'], data['processesObservedAt'] = process_snapshot()
    publish(path, data)
    return successful


if __name__ == '__main__':
    raise SystemExit(0 if observe() else 1)
