#!/usr/bin/env python3
"""Install the monitor and worker units; never enable the scraper before cutover."""
import base64
import os
from pathlib import Path
import shutil
import socket
import subprocess

HERE = Path(__file__).resolve().parent
WORKER = Path('/srv/services/wildrift-worker')
MONITOR = Path('/srv/services/kolvrt-monitor')


def command(*args):
    return subprocess.run(args, check=True)


def managed(directory):
    marker = directory / '.managed-wildrift-monitor'
    if directory.is_symlink() or (directory.exists() and any(directory.iterdir()) and not marker.is_file()):
        raise RuntimeError('Refusing unmanaged directory: ' + str(directory))
    directory.mkdir(mode=0o755, exist_ok=True)
    marker.touch(mode=0o644, exist_ok=True)


if os.geteuid() != 0 or socket.gethostname() != 'kolvrt':
    raise RuntimeError('Run as root on kolvrt')
for directory in [WORKER, MONITOR]:
    managed(directory)
for file in (HERE / 'kolvrt-monitor').iterdir():
    if file.is_file() and file.suffix in ('.py', '.html', '.css', '.js', '.json'):
        shutil.copyfile(file, MONITOR / file.name)
        os.chmod(MONITOR / file.name, 0o644)
shutil.copyfile(HERE / 'wildrift-worker/compose.yaml', WORKER / 'compose.yaml')
secrets = WORKER / 'secrets'
secrets.mkdir(mode=0o700, exist_ok=True)
os.chmod(secrets, 0o700)
private = secrets / 'provision-private.pem'
public = WORKER / 'provision-public.pem'
if not private.exists():
    old = os.umask(0o077)
    try:
        command('openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-out', str(private))
    finally:
        os.umask(old)
    command('openssl', 'pkey', '-in', str(private), '-pubout', '-out', str(public))
    os.chmod(public, 0o644)
data = Path('/srv/data/wildrift-worker')
data.mkdir(mode=0o755, exist_ok=True)
os.chown(data, 10001, 10001)
for directory in ['wildrift-worker', 'kolvrt-monitor']:
    for file in (HERE / directory).iterdir():
        if file.suffix in ('.service', '.timer'):
            shutil.copyfile(file, Path('/etc/systemd/system') / file.name)
command('systemctl', 'daemon-reload')
command('systemctl', 'enable', '--now', 'kolvrt-monitor.service')
print('Monitor installed. Worker timers remain disabled until verified cutover.')
print('RECIPIENT_PUBLIC_KEY=' + base64.b64encode(public.read_bytes()).decode())
