#!/usr/bin/env python3
"""Build a secret-free worker from exact revisions after both public pipelines pass."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time

OWNER = 'lifeFedorovAlexey'
API = OWNER + '/wr-api'
DATA = OWNER + '/wildriftchampionsData'
BASE = 'node@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d'
STATE = Path(os.environ.get('RUNNER_TEMP', '.')) / 'worker-source.json'


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def github(path):
    return json.loads(run('gh', 'api', path))


def successful_pipeline(repo, sha, name):
    runs = github(f'repos/{repo}/actions/runs?head_sha={sha}&per_page=100')['workflow_runs']
    relevant = [r for r in runs if r['name'] == name and r['head_branch'] == 'main'
                and r['event'] in ('push', 'workflow_dispatch')]
    return bool(relevant and max(relevant, key=lambda r: r['id'])['conclusion'] == 'success')


def resolve():
    publish = os.environ['PUBLISH'] == 'true'
    if publish and os.environ['GITHUB_REF'] != 'refs/heads/main':
        raise RuntimeError('Production releases may only be built from main')
    api = github(f'repos/{API}/commits/main')['sha'] if publish else os.environ['GITHUB_SHA']
    data = github(f'repos/{DATA}/commits/main')['sha']
    if not all(re.fullmatch('[0-9a-f]{40}', value) for value in (api, data)):
        raise RuntimeError('Invalid source revision')
    tag = f'worker-v1-{api[:12]}-{data[:12]}'
    build = True
    if publish:
        build = (api == os.environ['GITHUB_SHA']
                 and successful_pipeline(API, api, 'API Pipeline')
                 and successful_pipeline(DATA, data, 'UI Pipeline'))
        releases = github(f'repos/{API}/releases?per_page=100')
        if any(r['tag_name'] == tag and not r['draft'] for r in releases):
            build = False
    STATE.write_text(json.dumps(dict(api=api, data=data, tag=tag, publish=publish)))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'build={str(build).lower()}\napi={api}\ndata={data}\n')
    print(json.dumps(dict(build=build, api=api, data=data, tag=tag)))


def archive_image_id(archive, image):
    """The classic Docker ID is the config digest, not an OCI index digest.

    Containerd-backed builders report the index as inspect.Id. Docker 26's
    classic store reports the config as inspect.Id after loading that archive.
    Read the config actually referenced by the saved image instead of assuming
    the two stores expose the same identifier.
    """
    with tarfile.open(archive, mode='r:gz') as saved:
        member = saved.getmember('manifest.json')
        if not member.isfile() or member.size > 1024**2:
            raise ValueError('Unexpected Docker archive manifest')
        entries = json.load(saved.extractfile(member))
        images = [entry for entry in entries if image in entry.get('RepoTags', [])]
        if len(images) != 1:
            raise ValueError('Archive must contain exactly one matching worker image')
        config = saved.getmember(images[0]['Config'])
        if not config.isfile() or config.size > 1024**2:
            raise ValueError('Unexpected Docker image configuration')
        data = saved.extractfile(config).read()
        info = json.loads(data)
        if info.get('os') != 'linux' or info.get('architecture') != 'amd64':
            raise ValueError('Worker must target kolvrt: linux/amd64')
        return 'sha256:' + hashlib.sha256(data).hexdigest()


def verify_classic_load(archive, image, image_id):
    """Exercise the actual host's Docker generation before publishing."""
    name = 'worker-docker26-compatibility'
    subprocess.run(['docker', 'run', '--rm', '--privileged', '--detach', '--name', name,
                    '--network', 'none', '-e', 'DOCKER_TLS_CERTDIR=', 'docker:26.1.5-dind',
                    '--storage-driver=vfs', '--iptables=false', '--bridge=none'], check=True)
    try:
        for _ in range(30):
            ready = subprocess.run(['docker', 'exec', name, 'docker', 'info'],
                                   capture_output=True, timeout=10)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Docker 26 compatibility daemon did not start')
        with archive.open('rb') as source:
            subprocess.run(['docker', 'exec', '-i', name, 'docker', 'load'], stdin=source, check=True)
        loaded = json.loads(run('docker', 'exec', name, 'docker', 'image', 'inspect', image))[0]
        if loaded['Id'] != image_id:
            raise RuntimeError('Docker 26 loaded a different image configuration')
        smoke = 'await import("sharp");await import("postgres");await import("dotenv");console.log("DOCKER26_LOAD_OK")'
        subprocess.run(['docker', 'exec', name, 'docker', 'run', '--rm', '--network', 'none',
                        '--workdir', '/app/wr-api', '--entrypoint', 'node', image,
                        '--input-type=module', '-e', smoke], check=True)
    finally:
        subprocess.run(['docker', 'rm', '--force', name], check=False)


def build():
    source = json.loads(STATE.read_text())
    image = 'wildrift-worker:' + source['tag']
    subprocess.run(['docker', 'build', '--build-arg', 'NODE_IMAGE=' + BASE,
                    '--label', 'org.wildrift.api-revision=' + source['api'],
                    '--label', 'org.wildrift.data-revision=' + source['data'],
                    '-f', 'app/wr-api/ops/wildrift-worker/Dockerfile', '-t', image, 'app'], check=True)
    smoke = ('await import("sharp");await import("postgres");await import("dotenv");'
             'const fs=await import("node:fs");'
             'for(const p of ["/app/.env","/app/.git","/app/wr-api/.env","/app/wr-api/.git"])'
             'if(fs.existsSync(p))throw Error("Forbidden build context: "+p);')
    subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node',
                    '--workdir', '/app/wr-api', image, '--input-type=module', '-e', smoke], check=True)
    for directory in ('/app', '/app/wr-api'):
        audit = json.loads(run('docker', 'run', '--rm', '-e', 'NPM_CONFIG_CACHE=/tmp/npm-audit',
                               '--workdir', directory, '--entrypoint', 'npm', image,
                               'audit', '--omit=dev', '--json'))
        if audit['metadata']['vulnerabilities']['total']:
            raise RuntimeError('Production dependencies are vulnerable')
    archive = Path('worker-image.tar.gz')
    with archive.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as compressed:
        process = subprocess.Popen(['docker', 'save', image], stdout=subprocess.PIPE)
        import shutil
        shutil.copyfileobj(process.stdout, compressed)
        if process.wait():
            raise RuntimeError('Docker save failed')
    if archive.stat().st_size >= 2 * 1024**3:
        raise RuntimeError('Release exceeds GitHub asset size limit')
    with archive.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    image_id = archive_image_id(archive, image)
    verify_classic_load(archive, image, image_id)
    manifest = dict(schema='wildrift-worker-release', version=1, repository=API,
                    api=source['api'], data=source['data'], tag=source['tag'], image=image,
                    imageId=image_id, archive=archive.name, size=archive.stat().st_size,
                    sha256=digest, workflowRunId=int(os.environ['GITHUB_RUN_ID']))
    Path('worker-release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if source['publish']:
        # A draft prevents the host seeing a half-uploaded release.
        existing = subprocess.run(['gh', 'release', 'view', source['tag'], '--repo', API,
                                   '--json', 'isDraft'], capture_output=True, text=True)
        if existing.returncode:
            subprocess.run(['gh', 'release', 'create', source['tag'], '--repo', API, '--draft',
                            '--target', source['api'], '--title', source['tag'], '--notes',
                            f"Worker sources: API {source['api']}; data {source['data']}."], check=True)
        elif not json.loads(existing.stdout)['isDraft']:
            raise RuntimeError('A published release cannot be overwritten')
        subprocess.run(['gh', 'release', 'upload', source['tag'], '--repo', API,
                        str(archive), 'worker-release.json', '--clobber'], check=True)
        subprocess.run(['gh', 'release', 'edit', source['tag'], '--repo', API,
                        '--draft=false', '--latest=false'], check=True)
    print(json.dumps(manifest))


if __name__ == '__main__':
    {'resolve': resolve, 'build': build}[sys.argv[1]]()
