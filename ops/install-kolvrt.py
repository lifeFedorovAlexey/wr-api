#!/usr/bin/env python3
"""Install the shared web service. Prepare dormant worker units only with --worker."""
import argparse
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


def install_units(directory):
    for file in (HERE / directory).iterdir():
        if file.suffix in ('.service', '.timer'):
            shutil.copyfile(file, Path('/etc/systemd/system') / file.name)


def install_worker():
    managed(WORKER)
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
    install_units('wildrift-worker')
    print('Worker units prepared; timers are not enabled by this installer.')
    print('RECIPIENT_PUBLIC_KEY=' + base64.b64encode(public.read_bytes()).decode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', action='store_true', help='Also prepare the worker units and provisioning key')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'kolvrt':
        raise RuntimeError('Run as root on kolvrt')
    managed(MONITOR)
    for name in ['monitor.py', 'index.html', 'style.css', 'app.js', 'services.json']:
        shutil.copyfile(HERE / 'kolvrt-monitor' / name, MONITOR / name)
        os.chmod(MONITOR / name, 0o644)
    install_units('kolvrt-monitor')
    if args.worker:
        install_worker()
    command('systemctl', 'daemon-reload')
    command('systemctl', 'enable', '--now', 'kolvrt-monitor.service')
    command('systemctl', 'restart', 'kolvrt-monitor.service')
    print('Shared web service installed. Existing crawler files and collector are reused.')


if __name__ == '__main__':
    main()
