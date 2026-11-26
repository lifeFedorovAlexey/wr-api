#!/usr/bin/env python3
"""Called over the existing root SSH connection by the kolvrt cutover tool."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.request import urlopen
from urllib.parse import urlsplit

API = ['wr-api','wr-api-public','wr-api-auth']
KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIBfMb1HX+oexiMuSL7BQSG4IT/R1Fh8LjoOWNkrbHBhU'


def command(args, env=None, cwd=None):
    p=subprocess.run(args,capture_output=True,text=True,env=env,cwd=cwd,timeout=45)
    if p.returncode:
        raise RuntimeError(Path(args[0]).name+' failed; secret output suppressed')
    return p.stdout


def apps():
    return json.loads(command(['pm2','jlist']))


def read_url(text):
    for line in text.splitlines():
        if line.startswith('DATABASE_URL='):
            return line.partition('=')[2].strip().strip('\"\'')
    return ''


def write(path, text):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.cutover-tmp')
    with temporary.open('w') as f:
        os.chmod(temporary,0o600)
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    temporary.replace(path)


def main():
    data=json.load(sys.stdin)
    stamp=data['stamp']
    if not re.fullmatch(r'\d{8}T\d{12}Z',stamp):
        raise RuntimeError('Invalid cutover identifier')
    directory=Path('/var/backups/wildrift-cutover')/stamp
    mode=sys.argv[1]
    if mode=='prepare':
        public_key=Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()[1]
        if public_key!=KEY:
            raise RuntimeError('VPS SSH host key differs from the pinned Actions key')
        directory.mkdir(mode=0o700,parents=True,exist_ok=False)
        os.chmod(directory.parent,0o700)
        current=apps()
        selected=[a for a in current if a['name'] in API]
        if len(selected)!=3 or any('canary' in a['name'] and a.get('pm2_env',{}).get('status')=='online' for a in current):
            raise RuntimeError('Expected three API processes and no deployment in progress')
        files={}
        urls=[]
        for app in selected:
            cfg=app['pm2_env']
            file=(Path(cfg['pm_cwd'])/'.env').resolve()
            if not file.is_relative_to(Path('/var/www/wr-api')):
                raise RuntimeError('Unexpected API environment path')
            files[str(file)]=file.read_text()
            urls.append(cfg.get('DATABASE_URL') or cfg.get('env',{}).get('DATABASE_URL') or read_url(files[str(file)]))
        if len(set(urls))!=1 or not urlsplit(urls[0]).hostname:
            raise RuntimeError('API processes use different database configurations')
        # Prove password authentication through the actual VPS reverse forward
        # before stopping any live process. A listening TCP port alone is insufficient.
        probe="""import postgres from 'postgres';
const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:10,onnotice(){},connection:{default_transaction_read_only:'on',statement_timeout:10000}});
try { const [r]=await sql`select current_database() as name`; if(r.name!=='wildrift') throw new Error('Unexpected database'); }
finally {await sql.end({timeout:3});}
"""
        command(['node','--input-type=module','-e',probe],{**os.environ,'DATABASE_URL':data['targetUrl']},selected[0]['pm2_env']['pm_cwd'])
        for file in [Path('/var/www/wr-api/.env'),Path('/var/www/wr-api/shared/database.env')]:
            files[str(file.resolve())]=file.read_text() if file.exists() else None
        state={'files':files,'apps':[{'name':a['name'],'status':a['pm2_env'].get('status')} for a in current if a['name'] in API+['wr-chat']],
          'sourceUrl':urls[0]}
        write(directory/'state.json',json.dumps(state))
        print(json.dumps({'sourceUrl':urls[0],'backup':str(directory),'hostKeyVerified':True}))
        return
    state=json.loads((directory/'state.json').read_text())
    if mode=='stop':
        command(['pm2','stop',*[a['name'] for a in state['apps'] if a['status']=='online']])
    elif mode=='restore':
        for name,content in state['files'].items():
            if content is None:
                Path(name).unlink(missing_ok=True)
            else:
                write(name,content)
        env={**os.environ,'DATABASE_URL':state['sourceUrl']}
        command(['pm2','restart',*[a['name'] for a in state['apps'] if a['status']=='online'],'--update-env'],env)
        command(['pm2','save'])
    elif mode=='apply':
        url=data['targetUrl']
        u=urlsplit(url)
        if u.hostname!='127.0.0.1' or u.port!=55432 or u.path!='/wildrift' or not u.password or '\n' in url:
            raise RuntimeError('Expected private kolvrt database')
        canonical='/var/www/wr-api/shared/database.env'
        for name,content in state['files'].items():
            if name==canonical:
                continue
            lines=(content or '').splitlines()
            lines=[line for line in lines if not line.startswith('DATABASE_URL=')]
            write(name,'\n'.join(lines)+f'\nDATABASE_URL={url}\n')
        write(canonical,f'DATABASE_URL={url}\n')
        command(['pm2','restart',*API,'--update-env'],{**os.environ,'DATABASE_URL':url})
        for app in state['apps']:
            if app['name']=='wr-chat' and app['status']=='online':
                command(['pm2','restart','wr-chat'])
        actual=[a for a in apps() if a['name'] in API]
        if len(actual)!=3 or any(a['pm2_env'].get('DATABASE_URL')!=url or a['pm2_env'].get('status')!='online' for a in actual):
            raise RuntimeError('PM2 database configuration verification failed')
        command(['pm2','save'])
        expected=data['statsDate']
        deadline=time.monotonic()+45
        while True:
            try:
                with urlopen('http://127.0.0.1:3002/api/updated-at',timeout=5) as response:
                    result=json.load(response)
                if result.get('statsDate')==expected:
                    break
            except Exception:
                pass
            if time.monotonic()>deadline:
                raise RuntimeError('Live API did not confirm the target statistics date')
            time.sleep(1)
        print(json.dumps({'apiSwitched':True,'statsDate':result['statsDate'],'pm2Saved':True}))
        return
    else:
        raise RuntimeError('Unknown operation')
    print(json.dumps({'operation':mode,'ok':True}))


if __name__=='__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        # Never include captured environment or URLs in diagnostics.
        print(json.dumps({'ok':False,'error':str(error) if isinstance(error,RuntimeError) else type(error).__name__}))
        sys.exit(1)
