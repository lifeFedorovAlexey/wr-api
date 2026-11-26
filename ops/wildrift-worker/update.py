#!/usr/bin/env python3
"""Pull CI-built worker releases; verify DB/export before switching the pinned image.

No shell from GitHub is executed. Existing compose, credentials, volumes and the
atomic VPS publisher remain authoritative. Run only from the root-owned unit.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.request import Request, urlopen

ROOT = Path('/srv/services/wildrift-worker')
STATE = Path('/srv/data/wildrift-worker/deployment-status.json')
EXPORT = Path('/srv/data/wildrift-public-data')
REPO = 'lifeFedorovAlexey/wr-api'
TIMERS = ('wildrift-scraper.timer', 'wildrift-monitor.timer', 'public-data-export.timer')
SERVICES = tuple(t.replace('.timer', '.service') for t in TIMERS)
JOURNAL = ROOT / '.update-transaction.json'
BACKUP = ROOT / '.env.before-auto-update'
MAX_ARCHIVE = 2 * 1024**3


def atomic_write(path, content, mode=0o600):
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def record(stage, **details):
    data = dict(stage=stage, at=dt.datetime.now(dt.timezone.utc).isoformat(), **details)
    atomic_write(STATE, json.dumps(data) + '\n', 0o644)
    print(json.dumps(data), flush=True)


def run(args, env=None, timeout=60):
    result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True,
                            text=True, timeout=timeout, check=False)
    if result.returncode:
        # Do not include child output: a DB client may print its connection URL.
        raise RuntimeError(f'{Path(args[0]).name} {args[1]} exited {result.returncode}')
    return result.stdout


def fetch(url, limit=2 * 1024**2):
    if not url.startswith(('https://api.github.com/', f'https://github.com/{REPO}/releases/download/')):
        raise ValueError('Unexpected release URL')
    request = Request(url, headers={'User-Agent': 'wildrift-worker-updater/1',
                                    'Accept': 'application/vnd.github+json'})
    with urlopen(request, timeout=45) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Release metadata is too large')
    return json.loads(data)


def validate_manifest(manifest, release):
    if (manifest.get('schema') != 'wildrift-worker-release' or manifest.get('version') != 1
            or manifest.get('repository') != REPO):
        raise ValueError('Unsupported worker release manifest')
    for key in ('api', 'data'):
        if not re.fullmatch('[0-9a-f]{40}', str(manifest.get(key, ''))):
            raise ValueError('Invalid source revision')
    tag = f"worker-v1-{manifest['api'][:12]}-{manifest['data'][:12]}"
    if manifest.get('tag') != tag or release['tag_name'] != tag:
        raise ValueError('Source revisions do not match the release tag')
    if manifest.get('image') != 'wildrift-worker:' + tag:
        raise ValueError('Unexpected image name')
    if not re.fullmatch('sha256:[0-9a-f]{64}', str(manifest.get('imageId', ''))):
        raise ValueError('Invalid image ID')
    if not re.fullmatch('[0-9a-f]{64}', str(manifest.get('sha256', ''))):
        raise ValueError('Invalid archive checksum')
    if manifest.get('archive') != 'worker-image.tar.gz' or not 0 < manifest.get('size', 0) < MAX_ARCHIVE:
        raise ValueError('Invalid archive size/name')
    if type(manifest.get('workflowRunId')) is not int or manifest['workflowRunId'] <= 0:
        raise ValueError('Invalid build run')
    if release.get('draft') or release.get('prerelease') or release.get('author', {}).get('login') != 'github-actions[bot]':
        raise ValueError('Release was not published by Actions')
    return manifest


def asset(release, name):
    matches = [a for a in release['assets'] if a['name'] == name]
    expected = f"https://github.com/{REPO}/releases/download/{release['tag_name']}/{name}"
    if len(matches) != 1 or matches[0]['browser_download_url'] != expected:
        raise ValueError('Missing or unexpected release asset')
    return matches[0]


def latest_release():
    releases = fetch(f'https://api.github.com/repos/{REPO}/releases?per_page=100')
    candidates = [r for r in releases if re.fullmatch('worker-v1-[0-9a-f]{12}-[0-9a-f]{12}', r['tag_name'])
                  and not r['draft'] and not r['prerelease']]
    if not candidates:
        return None
    release = max(candidates, key=lambda r: r['published_at'])
    manifest = validate_manifest(fetch(asset(release, 'worker-release.json')['browser_download_url']), release)
    build = fetch(f"https://api.github.com/repos/{REPO}/actions/runs/{manifest['workflowRunId']}")
    if (build.get('name') != 'Worker Release' or build.get('head_branch') != 'main'
            or build.get('head_sha') != manifest['api'] or build.get('conclusion') != 'success'):
        # Publication is the last build step; wait until the run itself finishes.
        return None
    return release, manifest


def download(release, manifest, target):
    info = asset(release, manifest['archive'])
    if info['size'] != manifest['size']:
        raise ValueError('GitHub asset size differs from manifest')
    digest = hashlib.sha256()
    count = 0
    with urlopen(Request(info['browser_download_url'], headers={'User-Agent': 'wildrift-worker-updater/1'}), timeout=60) as response, target.open('wb') as file:
        while chunk := response.read(1024**2):
            count += len(chunk)
            if count > manifest['size']:
                raise ValueError('Archive is larger than declared')
            digest.update(chunk)
            file.write(chunk)
    if count != manifest['size'] or digest.hexdigest() != manifest['sha256']:
        raise ValueError('Worker archive checksum mismatch')


def verify_image(manifest):
    info = json.loads(run(['docker', 'image', 'inspect', manifest['image']]))[0]
    config = info['Config']
    labels = config.get('Labels') or {}
    if (info['Id'] != manifest['imageId'] or config['User'] != '10001:10001'
            or config['Entrypoint'] != ['node', '/app/wr-api/scripts/scrape-worker.mjs']
            or labels.get('org.wildrift.api-revision') != manifest['api']
            or labels.get('org.wildrift.data-revision') != manifest['data']):
        raise ValueError('Loaded image identity/configuration mismatch')


def replace_config(text, image, revision):
    lines = text.splitlines()
    for key, value in (('WORKER_IMAGE', image), ('SCRAPE_REVISION', revision)):
        indices = [i for i, line in enumerate(lines) if line.startswith(key + '=')]
        if len(indices) > 1 or (key == 'WORKER_IMAGE' and not indices):
            raise ValueError('Unexpected worker environment configuration')
        if indices:
            lines[indices[0]] = key + '=' + value
        else:
            lines.append(key + '=' + value)
    return '\n'.join(lines) + '\n'


def recover():
    if not JOURNAL.exists():
        return
    transaction = json.loads(JOURNAL.read_text())
    if not transaction['committed']:
        atomic_write(ROOT / '.env', BACKUP.read_text())
    for timer in transaction['paused']:
        if timer not in TIMERS:
            raise ValueError('Invalid recovery timer')
        run(['systemctl', 'start', timer])
    JOURNAL.unlink()


def pause():
    active = [t for t in TIMERS if run(['systemctl', 'show', t, '-p', 'ActiveState', '--value']).strip() == 'active']
    atomic_write(JOURNAL, json.dumps(dict(paused=active, committed=False)))
    for timer in active:
        run(['systemctl', 'stop', timer])
    deadline = time.monotonic() + 1200
    while any(run(['systemctl', 'show', unit, '-p', 'ActiveState', '--value']).strip()
              in ('active', 'activating', 'deactivating', 'reloading') for unit in SERVICES):
        if time.monotonic() > deadline:
            raise RuntimeError('A running import has not finished; keeping the previous image')
        time.sleep(3)


def database_smoke(env):
    script = ('node /app/wr-api/scripts/scrape-worker.mjs --status --output /tmp/deployment-status.json && '
              'node -e \'const p=require("/tmp/deployment-status.json");'
              'if(p.ok!==true||Math.abs(Date.now()-Date.parse(p.collectedAt))>90000)process.exit(1);'
              'console.log("DATABASE_STATUS_OK")\'')
    result = run(['docker', 'compose', 'run', '--rm', '-T', '--no-deps', '--name', 'wildrift-update-check', '--entrypoint', 'sh',
                  'observer', '-c', script], env=env)
    if 'DATABASE_STATUS_OK' not in result:
        raise RuntimeError('New worker did not produce a fresh database status')


def clean_canaries():
    for name, service in (('wildrift-update-check', 'observer'), ('wildrift-update-export', 'exporter')):
        result = subprocess.run(['docker', 'inspect', name], cwd=ROOT, capture_output=True, text=True, timeout=10)
        if result.returncode:
            continue
        container = json.loads(result.stdout)[0]
        labels = container.get('Config', {}).get('Labels') or {}
        if (labels.get('com.docker.compose.project') != 'wildrift-worker'
                or labels.get('com.docker.compose.service') != service):
            raise RuntimeError('A foreign container uses the updater canary name')
        if container['State']['Running']:
            run(['docker', 'stop', '-t', '15', name], timeout=30)
        # --rm may already have removed it after stop.
        subprocess.run(['docker', 'rm', name], cwd=ROOT, capture_output=True, timeout=10)


def validate_snapshot(directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    datasets = manifest.get('datasets', {})
    required = {'champions:ru_ru', 'champions:en_us'}
    if (manifest.get('schema') != 'wildrift-public-snapshot' or manifest.get('version') != 1
            or not required.issubset(datasets) or not any(k.startswith('patch:') for k in datasets)
            or not any(k.startswith('trend-events:') for k in datasets)):
        raise ValueError('Incomplete public snapshot')
    for entry in datasets.values():
        name = PurePosixPath(entry['file'])
        if name.is_absolute() or '..' in name.parts or '\\' in entry['file']:
            raise ValueError('Invalid snapshot path')
        file = directory / name
        if file.is_symlink() or not file.resolve().is_relative_to(directory.resolve()):
            raise ValueError('Snapshot escapes release directory')
        if file.stat().st_size != entry['size']:
            raise ValueError('Snapshot size mismatch')
        with file.open('rb') as data:
            if hashlib.file_digest(data, 'sha256').hexdigest() != entry['sha256']:
                raise ValueError('Snapshot checksum mismatch')
    return len(datasets)


def install(manifest):
    config = ROOT / '.env'
    original = config.read_text()
    atomic_write(BACKUP, original)
    release_id = 'deploy-' + manifest['tag'] + '-' + str(time.time_ns())
    release_dir = EXPORT / 'releases' / release_id
    env = {**os.environ, 'WORKER_IMAGE': manifest['image'],
           'SCRAPE_REVISION': manifest['api'] + ':' + manifest['data']}
    committed = False
    try:
        pause()
        record('checking_database', release=manifest['tag'])
        database_smoke(env)
        record('checking_public_export', release=manifest['tag'])
        run(['docker', 'compose', 'run', '--rm', '-T', '--no-deps', '--name', 'wildrift-update-export', 'exporter',
             '--output=/public-data', '--release=' + release_id], env, timeout=900)
        count = validate_snapshot(release_dir)
        if config.read_text() != original:
            raise RuntimeError('Worker configuration changed concurrently')
        atomic_write(config, replace_config(original, manifest['image'], env['SCRAPE_REVISION']))
        database_smoke(env)
        # The existing publisher selects the newest completed export. Timers are
        # paused, and the canary itself is that export; never export it twice.
        newest = max((EXPORT / 'releases').iterdir(), key=lambda p: p.stat().st_mtime_ns)
        if newest != release_dir:
            raise RuntimeError('A concurrent export appeared; keeping the previous image')
        record('publishing_snapshot', release=manifest['tag'], datasets=count)
        run([str(ROOT / 'publish-public-data.sh')], timeout=600)
        transaction = json.loads(JOURNAL.read_text())
        transaction['committed'] = True
        atomic_write(JOURNAL, json.dumps(transaction))
        committed = True
        record('installed', release=manifest['tag'], image=manifest['image'],
               api=manifest['api'], data=manifest['data'], datasets=count, publicSnapshot=release_id)
    finally:
        clean_canaries()
        recover()
        if not committed:
            # Only this invocation's unique canary; no previous releases/backups.
            if release_dir.exists():
                shutil.rmtree(release_dir)
            for staging in EXPORT.glob('.staging-' + release_id + '-*'):
                if staging.is_dir() and not staging.is_symlink():
                    shutil.rmtree(staging)


def retain_rollback_images(manifest):
    history_path = ROOT / '.worker-image-history.json'
    history = json.loads(history_path.read_text()) if history_path.exists() else []
    history = [manifest['image']] + [image for image in history if image != manifest['image']]
    retained = history[:2]
    for image in history[2:]:
        # Only tags previously installed by this updater. Never a global prune.
        if not re.fullmatch('wildrift-worker:worker-v1-[0-9a-f]{12}-[0-9a-f]{12}', image):
            continue
        result = subprocess.run(['docker', 'image', 'rm', image], cwd=ROOT,
                                capture_output=True, timeout=60)
        if result.returncode:
            retained.append(image)  # An in-use image can be retried next update.
    atomic_write(history_path, json.dumps(retained))


def main():
    if os.geteuid() != 0 or os.uname().nodename != 'kolvrt':
        raise RuntimeError('Run as root on kolvrt')
    import fcntl
    os.umask(0o077)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    with (ROOT / '.dependency-update.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        clean_canaries()
        recover()
        candidate = latest_release()
        if not candidate:
            return
        release, manifest = candidate
        installed = ROOT / '.installed-worker-release.json'
        if installed.exists() and json.loads(installed.read_text()).get('imageId') == manifest['imageId']:
            return
        if STATE.exists():
            previous = json.loads(STATE.read_text())
            if (previous.get('stage') == 'failed' and previous.get('release') == manifest['tag']
                    and time.time() - previous.get('attemptTime', 0) < 1800):
                return
        if shutil.disk_usage(ROOT).free < 4 * 1024**3 + 3 * manifest['size']:
            raise RuntimeError('Insufficient free disk space for image and canary')
        record('downloading', release=manifest['tag'])
        try:
            with tempfile.TemporaryDirectory(prefix='.worker-download-', dir=ROOT) as directory:
                archive = Path(directory) / manifest['archive']
                download(release, manifest, archive)
                run(['docker', 'load', '-i', str(archive)], timeout=300)
            verify_image(manifest)
            install(manifest)
            atomic_write(installed, json.dumps(manifest))
            retain_rollback_images(manifest)
        except Exception:
            record('failed', release=manifest['tag'], attemptTime=time.time(),
                   error='Update failed; previous image and timers restored. See the updater journal.')
            raise


if __name__ == '__main__':
    def stop(_signum, _frame):
        raise RuntimeError('Updater interrupted')
    signal.signal(signal.SIGTERM, stop)
    try:
        main()
    except Exception as error:
        # Error messages above contain operation names, never credential values.
        print(type(error).__name__ + ': ' + str(error), flush=True)
        raise SystemExit(1)
