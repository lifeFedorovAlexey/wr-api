#!/usr/bin/env python3
"""Reconcile in an isolated database, retain both originals, then switch API."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit,unquote,parse_qs

HERE=Path(__file__).resolve().parent
ROOT=Path('/srv/backups/wildrift')
USER='wildrift_app'
IMAGE='postgres:18.7-bookworm'
SSH=['ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','-i','/root/.ssh/timeweb_ed25519','root@176.98.178.32']
BASE=ROOT/'source-20261124-191835.dump'


def emit(stage,**fields):
    print(json.dumps({'stage':stage,**fields},ensure_ascii=False),flush=True)


def checked(args, data=None, env=None, output=None, timeout=600):
    p=subprocess.run(args,input=data,env=env,stdout=output or subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if p.returncode:
        # SQL errors can contain user data. Keep them out of the terminal.
        raise RuntimeError(Path(args[0]).name+' failed with exit '+str(p.returncode)+'; production databases retained')
    return p.stdout


def ident(name):
    return '"'+name.replace('"','""')+'"'


def literal(value):
    return "'"+str(value).replace("'","''")+"'"


def pg(db, sql):
    data=('SET TIME ZONE \'UTC\';\n'+sql).encode()
    result=checked(['docker','exec','-i','wildrift-prod-postgres','psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',USER,'-d',db],data)
    return result.decode()


def rows(db,sql):
    return [json.loads(line) for line in pg(db,sql).splitlines() if line.strip()]


def table_metadata(db):
    return rows(db,"""SELECT json_build_object('table',c.relname,'columns',(
      SELECT json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname;""")


def worker_table(name):
    return name.startswith(('guide_','riftgg_cn_')) or name in {
      'champions','champion_guides','champion_stats_history','champion_stats_snapshots','scrape_runs','scrape_job_state'}


def fingerprint(db,name,ignore=()):
    expression='to_jsonb(t)'
    for key in ignore:
        expression+=' - '+literal(key)
    result=rows(db,'SELECT json_build_object(\'rows\',count(*),\'hash\',md5(coalesce(string_agg(h,\'\' order by h),\'\'))) FROM '
      '(SELECT md5(('+expression+')::text) h FROM public.'+ident(name)+' t) s;')
    return result[0]


def vps(mode,stamp,**payload):
    code=(HERE/'vps-db-cutover.py').read_text()
    result=checked(SSH+['python3 -c '+shlex.quote(code)+' '+shlex.quote(mode)],json.dumps({'stamp':stamp,**payload}).encode(),timeout=180)
    return json.loads(result)


def dump(db,path,tables=None):
    args=['docker','exec','wildrift-prod-postgres','pg_dump','-U',USER,'-d',db,'--no-owner','--no-acl']
    if tables is None:
        args+=['--format=custom']
    else:
        args+=['--data-only','--disable-triggers']
        for table in tables:
            args+=['--table','public.'+ident(table)]
        sequences=rows(db,"SELECT json_build_object('name',s.relname) FROM pg_class s JOIN pg_depend d ON d.objid=s.oid JOIN pg_class t ON t.oid=d.refobjid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE s.relkind='S' AND d.deptype IN ('a','i') AND n.nspname='public' AND t.relname IN ("+','.join(literal(t) for t in tables)+');')
        for sequence in sequences:
            args+=['--table','public.'+ident(sequence['name'])]
    with path.open('xb') as f:
        checked(args,output=f)
        f.flush()
        os.fsync(f.fileno())


def restore(path,db):
    checked(['docker','exec','wildrift-prod-postgres','createdb','-U',USER,'--template=template0',db])
    with path.open('rb') as f:
        p=subprocess.run(['docker','exec','-i','wildrift-prod-postgres','pg_restore','-U',USER,'-d',db,'--exit-on-error','--no-owner','--no-acl'],stdin=f,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=600)
    if p.returncode:
        raise RuntimeError('Restore verification failed; original databases unchanged')


def source_dump(url,path):
    u=urlsplit(url)
    if not u.hostname or u.hostname in ('127.0.0.1','localhost'):
        raise RuntimeError('Source is not the expected cloud database')
    env={**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGUSER':unquote(u.username or ''),
      'PGPASSWORD':unquote(u.password or ''),'PGDATABASE':unquote(u.path.lstrip('/')),
      'PGSSLMODE':parse_qs(u.query).get('sslmode',['prefer'])[0],'PGCONNECT_TIMEOUT':'10'}
    args=['docker','run','--rm','--network','host','--memory','256m','--cpus','1']
    for key in ('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT'):
        args+=['-e',key]
    args+=['--entrypoint','pg_dump',IMAGE,'--format=custom','--no-owner','--no-acl']
    with path.open('xb') as f:
        checked(args,env=env,output=f)
        f.flush()
        os.fsync(f.fileno())
    if path.stat().st_size<1024:
        raise RuntimeError('Source backup is unexpectedly small')


def validate_foreign_keys(db):
    constraints=rows(db,"""SELECT json_build_object('name',k.conname,'table',t.relname,'parent',p.relname,'match',k.confmatchtype,
      'childColumns',(SELECT json_agg(a.attname ORDER BY u.ord) FROM unnest(k.conkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=u.num),
      'parentColumns',(SELECT json_agg(a.attname ORDER BY u.ord) FROM unnest(k.confkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=p.oid AND a.attnum=u.num))
      FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace WHERE k.contype='f' AND k.convalidated AND n.nspname='public';""")
    for c in constraints:
        child=['t.'+ident(x) for x in c['childColumns']]
        joins=' AND '.join(a+'=p.'+ident(b) for a,b in zip(child,c['parentColumns']))
        nonnull=' AND '.join(x+' IS NOT NULL' for x in child)
        invalid='('+nonnull+') AND NOT EXISTS(SELECT 1 FROM public.'+ident(c['parent'])+' p WHERE '+joins+')'
        if c['match']=='f':
            invalid+=' OR (('+' OR '.join(x+' IS NULL' for x in child)+') AND ('+' OR '.join(x+' IS NOT NULL' for x in child)+'))'
        count=pg(db,'SELECT count(*) FROM public.'+ident(c['table'])+' t WHERE '+invalid+';').strip()
        if count!='0':
            raise RuntimeError('Foreign key verification failed: '+c['table']+'.'+c['name'])


def merge_sql(metadata):
    columns={t['table']:[c['name'] for c in t['columns']] for t in metadata}
    snapshot_columns=columns['champion_stats_snapshots']
    history_columns=[c for c in columns['champion_stats_history'] if c!='id']
    # Reuse a source snapshot only if it was already imported; otherwise allocate a
    # fresh target ID. Both workers assigned serial IDs independently after the dump.
    pieces=["CREATE TEMP TABLE imported_snapshot_ids(old_id integer PRIMARY KEY,new_id integer NOT NULL);",
      "INSERT INTO imported_snapshot_ids SELECT s.id,coalesce((SELECT min(t.id) FROM champion_stats_snapshots t WHERE t.source=s.source AND t.stats_date=s.stats_date AND t.started_at=s.started_at),nextval(pg_get_serial_sequence('public.champion_stats_snapshots','id'))) FROM old_source_snapshots s;",
      'INSERT INTO public.champion_stats_snapshots('+','.join(map(ident,snapshot_columns))+') SELECT '+','.join('m.new_id' if c=='id' else 's.'+ident(c) for c in snapshot_columns)+' FROM old_source_snapshots s JOIN imported_snapshot_ids m ON m.old_id=s.id ON CONFLICT (id) DO NOTHING;',
      'INSERT INTO public.champion_stats_history('+','.join(map(ident,history_columns))+') SELECT '+','.join('m.new_id' if c=='snapshot_id' else 'h.'+ident(c) for c in history_columns)+' FROM old_source_history h JOIN imported_snapshot_ids m ON m.old_id=h.snapshot_id ON CONFLICT (snapshot_id,slug,rank,lane) DO NOTHING;',
      'INSERT INTO public.champions SELECT * FROM old_source_champions ON CONFLICT DO NOTHING;',
      'INSERT INTO public.scrape_runs SELECT * FROM old_source_runs ON CONFLICT (id) DO NOTHING;']
    return '\n'.join(pieces)+'\n'


def main():
    if os.geteuid()!=0 or os.uname().nodename!='kolvrt':
        raise RuntimeError('Run with sudo on kolvrt')
    os.umask(0o077)
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    run=ROOT/('cutover-'+stamp)
    run.mkdir(mode=0o700,parents=True,exist_ok=False)
    import fcntl
    lock=(ROOT/'.cutover.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    suffix=stamp.replace('T','').replace('Z','')
    base_db='wr_cutover_base_'+suffix
    candidate='wr_cutover_new_'+suffix
    original='wr_before_cutover_'+suffix
    stopped=False
    renamed=False
    live_switch_attempted=False
    paused=[]
    emit('preflight')
    if not BASE.is_file() or BASE.stat().st_size<1024:
        raise RuntimeError('Original nonempty migration dump is required')
    if shutil.disk_usage('/srv/data/wildrift-prod-postgres').free<3*1024**3:
        raise RuntimeError('At least 3 GiB free disk is required for isolated restores')
    for unit in ['wildrift-api-db-tunnel.service','docker.service']:
        checked(['systemctl','is-active','--quiet',unit])
    # Install and prove the new backup before taking private endpoints offline.
    for name in ['backup-postgres.py','wildrift-postgres-backup.service','wildrift-postgres-backup.timer']:
        target=Path('/etc/systemd/system')/name if name.endswith(('.service','.timer')) else Path('/srv/services/wildrift-worker')/name
        shutil.copyfile(HERE/name,target)
        os.chmod(target,0o644)
    checked(['systemctl','daemon-reload'])
    checked(['python3','/srv/services/wildrift-worker/backup-postgres.py','--verify-restore'])
    emit('target_backup_and_restore_verified')
    restore(BASE,base_db)
    metadata=table_metadata('wildrift')
    names=[t['table'] for t in metadata]
    base_metadata=table_metadata(base_db)
    if metadata!=base_metadata:
        raise RuntimeError('Target schema differs from the original migration dump; automatic replacement refused')
    source_owned=[name for name in names if not worker_table(name)]
    baseline={}
    for name in source_owned:
        ignore=('parse_status','parse_error','updated_at') if name=='patch_notes' else ()
        baseline[name]=fingerprint(base_db,name,ignore)
        if fingerprint('wildrift',name,ignore)!=baseline[name]:
            raise RuntimeError('Local edits require reconciliation before replacing table: '+name)
    prepare=vps('prepare',stamp)
    emit('source_configuration_verified',hostKeyVerified=prepare['hostKeyVerified'])
    try:
        # Pause all local writers/readers that could reconnect during database rename.
        for timer in ['wildrift-scraper.timer','public-data-export.timer','wildrift-monitor.timer']:
            p=subprocess.run(['systemctl','is-active','--quiet',timer])
            if p.returncode==0:
                checked(['systemctl','stop',timer]); paused.append(timer)
        deadline=time.monotonic()+600
        services=['wildrift-scraper.service','public-data-export.service','wildrift-monitor.service']
        while any(checked(['systemctl','show',service,'-p','ActiveState','--value']).decode().strip() in ('active','activating','deactivating','reloading') for service in services):
            if time.monotonic()>deadline:
                raise RuntimeError('Local import did not finish within 10 minutes; try again after it finishes')
            time.sleep(3)
        for name in source_owned:
            ignore=('parse_status','parse_error','updated_at') if name=='patch_notes' else ()
            if fingerprint('wildrift',name,ignore)!=baseline[name]:
                raise RuntimeError('Local table changed while waiting for worker: '+name)
        # Freeze private writes only. Next.js and its public snapshot keep running.
        stopped=True
        vps('stop',stamp)
        emit('private_endpoints_paused_public_snapshot_running')
        source=run/'source-final.dump'
        source_dump(prepare['sourceUrl'],source)
        restore(source,candidate)
        if table_metadata(candidate)!=metadata:
            raise RuntimeError('Cloud schema changed; automatic replacement refused')
        expected={name:fingerprint(candidate,name) for name in source_owned}
        worker=[name for name in names if worker_table(name)]
        protected={name:fingerprint('wildrift',name) for name in worker if name.startswith(('guide_','riftgg_cn_')) or name=='champion_guides'}
        worker_data=run/'worker-data.sql'
        dump('wildrift',worker_data,worker)
        base_max=int(pg(base_db,'SELECT coalesce(max(id),0) FROM public.champion_stats_snapshots;').strip())
        merged=run/'merge.sql'
        with merged.open('wb') as f:
            f.write(("BEGIN; SET LOCAL session_replication_role=replica;\n"
              "CREATE TEMP TABLE old_source_snapshots AS SELECT * FROM public.champion_stats_snapshots WHERE id>"+str(base_max)+";\n"
              "CREATE TEMP TABLE old_source_history AS SELECT h.* FROM public.champion_stats_history h JOIN old_source_snapshots s ON s.id=h.snapshot_id;\n"
              "CREATE TEMP TABLE old_source_champions AS SELECT * FROM public.champions;\n"
              "CREATE TEMP TABLE old_source_runs AS SELECT * FROM public.scrape_runs;\n"+
              '\n'.join('DELETE FROM public.'+ident(t)+';' for t in worker)+'\n').encode())
            with worker_data.open('rb') as src:
                shutil.copyfileobj(src,f)
            f.write((merge_sql(metadata)+'\nSET LOCAL session_replication_role=origin; COMMIT;\n').encode())
        with merged.open('rb') as f:
            p=subprocess.run(['docker','exec','-i','wildrift-prod-postgres','psql','-X','-q','-v','ON_ERROR_STOP=1','-U',USER,'-d',candidate],stdin=f,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=600)
        if p.returncode:
            (run/'merge-error.log').write_bytes(p.stderr)
            raise RuntimeError('Isolated merge failed; details retained in protected merge-error.log')
        for name,checksum in expected.items():
            if fingerprint(candidate,name)!=checksum:
                raise RuntimeError('Cloud data verification failed: '+name)
        for name,checksum in protected.items():
            if fingerprint(candidate,name)!=checksum:
                raise RuntimeError('Local worker data verification failed: '+name)
        validate_foreign_keys(candidate)
        pg(candidate,'ANALYZE;')
        stats=pg(candidate,"SELECT stats_date::text FROM champion_stats_snapshots WHERE source='cnHistory' AND status='completed' ORDER BY stats_date DESC,completed_at DESC NULLS LAST,id DESC LIMIT 1;").strip()
        emit('isolated_merge_verified',sourceTables=len(source_owned),localTables=len(worker),statsDate=stats)
        # Original target stays intact under a new name. No table on it was deleted.
        pg('postgres','ALTER DATABASE wildrift ALLOW_CONNECTIONS false; SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=\'wildrift\' AND pid<>pg_backend_pid();')
        pg('postgres','ALTER DATABASE wildrift RENAME TO '+ident(original)+';')
        renamed=True
        pg('postgres','ALTER DATABASE '+ident(candidate)+' RENAME TO wildrift; ALTER DATABASE wildrift ALLOW_CONNECTIONS true;')
        target_env={}
        for line in Path('/etc/wildrift-prod-postgres/env').read_text().splitlines():
            k,sep,value=line.partition('=')
            if sep: target_env[k]=value.strip().strip('\"\'')
        from urllib.parse import quote
        target_url='postgresql://'+quote(target_env['POSTGRES_USER'],safe='')+':'+quote(target_env['POSTGRES_PASSWORD'],safe='')+'@127.0.0.1:55432/wildrift'
        # From this point new writes may reach the new database: never automatically
        # roll back to an old copy and silently discard them.
        live_switch_attempted=True
        actual=vps('apply',stamp,targetUrl=target_url,statsDate=stats)
        stopped=False
        emit('live_api_verified',**actual)
        checked(['python3','/srv/services/wildrift-worker/backup-postgres.py','--verify-restore'])
        checked(['systemctl','enable','--now','wildrift-postgres-backup.timer'])
        with source.open('rb') as source_file:
            digest=hashlib.file_digest(source_file,'sha256').hexdigest()
        (run/'completed.json').write_text(json.dumps({'at':stamp,'oldTargetDatabase':original,'api':actual,'sourceDumpSha256':digest}))
        emit('cutover_completed',oldTargetDatabase=original,sourceDump=str(source),backupTimer=True,cloudDatabaseStillRunning=True)
    finally:
        if not live_switch_attempted:
            if renamed:
                active=pg('postgres',"SELECT datname FROM pg_database WHERE datname='wildrift';").strip()
                if active:
                    pg('postgres','ALTER DATABASE wildrift ALLOW_CONNECTIONS false; SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=\'wildrift\'; ALTER DATABASE wildrift RENAME TO '+ident(candidate)+';')
                pg('postgres','ALTER DATABASE '+ident(original)+' RENAME TO wildrift; ALTER DATABASE wildrift ALLOW_CONNECTIONS true;')
            else:
                pg('postgres','ALTER DATABASE wildrift ALLOW_CONNECTIONS true;')
            if stopped:
                vps('restore',stamp)
                emit('original_api_restored')
        for timer in paused:
            checked(['systemctl','start',timer])
        # Export after all data checks, never while reconciliation is in progress.
        if not stopped and live_switch_attempted:
            checked(['systemctl','start','--no-block','public-data-export.service'])


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        emit('failed',error=str(error) if isinstance(error,RuntimeError) else type(error).__name__,cloudDatabaseStillRunning=True)
        sys.exit(1)
