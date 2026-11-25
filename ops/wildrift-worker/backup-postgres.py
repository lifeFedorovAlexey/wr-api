#!/usr/bin/env python3
"""Back up production PostgreSQL locally and on VPS; optionally prove restore."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path('/srv/backups/wildrift')
REMOTE = '/var/backups/wildrift-postgres'
SSH = ['ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes',
       '-i','/root/.ssh/timeweb_ed25519','root@176.98.178.32']
PG = ['docker','exec','wildrift-prod-postgres']
USER = 'wildrift_app'
PATTERN = r'wildrift-\d{8}T\d{12}Z\.dump'


def checked(args, **kwargs):
    p = subprocess.run(args, check=False, **kwargs)
    if p.returncode:
        raise RuntimeError(Path(args[0]).name+' failed (exit '+str(p.returncode)+')')
    return p


def prune(directory, now):
    # Only names created by this backup program; never follow symlinks.
    for p in directory.iterdir():
        if re.fullmatch(PATTERN, p.name) and not p.is_symlink() and p.is_file() and p.stat().st_mtime < now-7*86400:
            p.unlink()


def backup(verify_restore=False):
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if ROOT.is_symlink():
        raise RuntimeError('Backup directory must not be a symlink')
    os.chmod(ROOT,0o700)
    now = dt.datetime.now(dt.timezone.utc)
    name = 'wildrift-'+now.strftime('%Y%m%dT%H%M%S%fZ')+'.dump'
    path = ROOT/name
    temporary = ROOT/(name+'.partial')
    with temporary.open('xb') as output:
        checked(PG+['pg_dump','-U',USER,'-d','wildrift','--format=custom','--no-owner','--no-acl'], stdout=output)
        output.flush()
        os.fsync(output.fileno())
    if temporary.stat().st_size < 1024:
        raise RuntimeError('Backup is unexpectedly small')
    with temporary.open('rb') as dump:
        checked(['docker','exec','-i','wildrift-prod-postgres','pg_restore','--file=/dev/null'], stdin=dump, stdout=subprocess.DEVNULL)
    if verify_restore:
        db = 'wr_backup_verify_'+now.strftime('%Y%m%d%H%M%S%f')
        checked(PG+['createdb','-U',USER,'--template=template0',db],stdout=subprocess.DEVNULL)
        try:
            with temporary.open('rb') as dump:
                checked(['docker','exec','-i','wildrift-prod-postgres','pg_restore','-U',USER,'-d',db,'--exit-on-error','--no-owner','--no-acl'],stdin=dump,stdout=subprocess.DEVNULL)
            checked(PG+['psql','-X','-q','-U',USER,'-d',db,'-v','ON_ERROR_STOP=1','-c','SELECT count(*) FROM public.site_users;'],stdout=subprocess.DEVNULL)
        finally:
            checked(PG+['dropdb','-U',USER,db],stdout=subprocess.DEVNULL)
    temporary.replace(path)
    with path.open('rb') as f:
        digest = hashlib.file_digest(f,'sha256').hexdigest()
    with path.open('rb') as f:
        checked(SSH+['set -e; umask 077; test ! -L '+REMOTE+'; mkdir -p '+REMOTE+'; chmod 700 '+REMOTE+'; cat > '+REMOTE+'/'+name+'.partial'],stdin=f,stdout=subprocess.DEVNULL)
    # Names/digests are generated locally, never interpolated from credentials.
    remote_check = r'''
import hashlib,json,os,re,time
from pathlib import Path
root=Path('/var/backups/wildrift-postgres')
if root.is_symlink(): raise RuntimeError('Backup directory is a symlink')
os.chmod(root,0o700)
p=root/NAME
tmp=root/(NAME+'.partial')
with tmp.open('rb') as f: actual=hashlib.file_digest(f,'sha256').hexdigest()
if actual!=DIGEST: raise RuntimeError('Remote backup checksum mismatch')
tmp.replace(p)
for old in root.iterdir():
 if re.fullmatch(r'wildrift-\d{8}T\d{12}Z\.dump',old.name) and not old.is_symlink() and old.is_file() and old.stat().st_mtime<time.time()-7*86400: old.unlink()
print(json.dumps({'offsite':True,'bytes':p.stat().st_size,'sha256':actual}))
'''
    result = checked(SSH+['python3','-'],input='NAME='+repr(name)+'\nDIGEST='+repr(digest)+'\n'+remote_check,text=True,capture_output=True)
    prune(ROOT,now.timestamp())
    print(json.dumps({'backup':name,'bytes':path.stat().st_size,'restoreVerified':verify_restore,'remote':json.loads(result.stdout)},ensure_ascii=False))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-restore',action='store_true')
    args=parser.parse_args()
    if os.geteuid()!=0:
        raise SystemExit('Run with sudo on kolvrt')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (ROOT/'.production-backup.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        backup(args.verify_restore)


if __name__=='__main__':
    main()
