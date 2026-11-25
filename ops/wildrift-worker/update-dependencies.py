#!/usr/bin/env python3
"""Update the deployed worker's dependencies from a checked bundle; retain rollback."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT=Path('/srv/services/wildrift-worker')
BUNDLE=Path(__file__).resolve().parent


def emit(stage,**data):
    print(json.dumps({'stage':stage,**data}),flush=True)


def run(args,env=None,timeout=600):
    p=subprocess.run(args,cwd=ROOT,env=env,text=True,capture_output=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError(Path(args[0]).name+' failed with exit '+str(p.returncode)+'; worker configuration retained')
    return p.stdout


def image_name(text):
    values=[line.partition('=')[2].strip().strip('\"\'') for line in text.splitlines() if line.startswith('WORKER_IMAGE=')]
    if len(values)!=1 or not re.fullmatch(r'wildrift-worker:[a-zA-Z0-9_.-]+',values[0]):
        raise RuntimeError('Expected one local wildrift-worker image tag')
    return values[0]


def smoke(image):
    env={**os.environ,'WORKER_IMAGE':image}
    script='node /app/wr-api/scripts/scrape-worker.mjs --status --output /tmp/security-status.json && node -e '\
      "'const fs=require(\"node:fs\");const p=JSON.parse(fs.readFileSync(\"/tmp/security-status.json\"));if(p.ok!==true||!p.collectedAt)process.exit(1);console.log(\"DATABASE_STATUS_OK\")'"
    result=run(['docker','compose','run','--rm','--no-deps','--entrypoint','sh','observer','-c',script],env,timeout=60)
    if 'DATABASE_STATUS_OK' not in result:
        raise RuntimeError('New worker did not produce a verified database status')


def main():
    if os.geteuid()!=0 or os.uname().nodename!='kolvrt':
        raise RuntimeError('Run with sudo on kolvrt')
    os.umask(0o077)
    import fcntl
    with (ROOT/'.dependency-update.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        manifest=json.loads((BUNDLE/'bundle.json').read_text())
        expected={'root/package.json','root/package-lock.json','api/package.json','api/package-lock.json','Dockerfile.dependencies','update-dependencies.py'}
        if set(manifest['sha256'])!=expected:
            raise RuntimeError('Incomplete dependency bundle')
        for name,digest in manifest['sha256'].items():
            with (BUNDLE/name).open('rb') as f:
                if hashlib.file_digest(f,'sha256').hexdigest()!=digest:
                    raise RuntimeError('Bundle checksum mismatch: '+name)
        config=ROOT/'.env'
        original=config.read_text()
        previous=image_name(original)
        base_id=run(['docker','image','inspect',previous,'--format','{{.Id}}']).strip()
        stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        image='wildrift-worker:security-'+stamp
        records=ROOT/'security-updates'/stamp
        records.mkdir(mode=0o700,parents=True,exist_ok=False)
        (records/'before.env').write_text(original)
        emit('building',image=image,previousImage=previous)
        p=subprocess.run(['docker','build','--pull=false','--build-arg','BASE_IMAGE='+previous,'-f',str(BUNDLE/'Dockerfile.dependencies'),'-t',image,str(BUNDLE)],cwd=ROOT,stdout=(records/'build.log').open('w'),stderr=subprocess.STDOUT,timeout=900)
        if p.returncode:
            raise RuntimeError('Dependency image build failed; original image remains active')
        for directory in ['/app','/app/wr-api']:
            report=json.loads(run(['docker','run','--rm','--env','NPM_CONFIG_CACHE=/tmp/security-npm-cache','--entrypoint','npm','--workdir',directory,image,'audit','--omit=dev','--json'],timeout=120))
            if report.get('metadata',{}).get('vulnerabilities',{}).get('total')!=0:
                raise RuntimeError('Dependency audit is not clean: '+directory)
        # Native image processing must remain available after ignore-scripts.
        run(['docker','run','--rm','--entrypoint','node','--workdir','/app/wr-api',image,'--input-type=module','-e',"await import('sharp');await import('postgres');await import('dotenv');console.log('NATIVE_IMPORTS_OK')"],timeout=60)
        emit('image_audit_clean',productionVulnerabilities=0)
        paused=[]
        switched=False
        success=False
        try:
            for timer in ['wildrift-scraper.timer','wildrift-monitor.timer','public-data-export.timer']:
                if run(['systemctl','show',timer,'-p','ActiveState','--value']).strip()=='active':
                    run(['systemctl','stop',timer]);paused.append(timer)
            deadline=time.monotonic()+1200
            services=['wildrift-scraper.service','wildrift-monitor.service','public-data-export.service']
            while any(run(['systemctl','show',unit,'-p','ActiveState','--value']).strip() in ('active','activating','deactivating','reloading') for unit in services):
                if time.monotonic()>deadline:
                    raise RuntimeError('A running job did not finish; update aborted')
                time.sleep(3)
            smoke(image)
            if config.read_text()!=original or run(['docker','image','inspect',previous,'--format','{{.Id}}']).strip()!=base_id:
                raise RuntimeError('Worker configuration changed concurrently')
            text='\n'.join('WORKER_IMAGE='+image if line.startswith('WORKER_IMAGE=') else line for line in original.splitlines())+'\n'
            temporary=ROOT/'.env.security-update'
            temporary.write_text(text)
            os.chmod(temporary,0o600)
            os.replace(temporary,config)
            switched=True
            smoke(image)
            success=True
            (records/'completed.json').write_text(json.dumps({'image':image,'previousImage':previous,'bundle':manifest.get('revisions',{}),'productionVulnerabilities':0}))
            emit('worker_dependencies_updated',image=image,previousImage=previous,databaseStatus=True,productionVulnerabilities=0)
        finally:
            if switched and not success:
                rollback=ROOT/'.env.security-rollback'
                rollback.write_text(original);os.chmod(rollback,0o600);os.replace(rollback,config)
                emit('previous_image_restored',image=previous)
            for timer in paused:
                run(['systemctl','start',timer])


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        emit('failed',error=str(error) if isinstance(error,RuntimeError) else type(error).__name__)
        raise SystemExit(1)
