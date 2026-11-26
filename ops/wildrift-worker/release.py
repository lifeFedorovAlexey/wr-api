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
    info = json.loads(run('docker', 'image', 'inspect', image))[0]
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
    manifest = dict(schema='wildrift-worker-release', version=1, repository=API,
                    api=source['api'], data=source['data'], tag=source['tag'], image=image,
                    imageId=info['Id'], archive=archive.name, size=archive.stat().st_size,
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
