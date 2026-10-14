#!/usr/bin/env python3
"""Privileged operations are CLI/Ansible only, never callable by the web container."""
import sqlite3
import argparse, datetime, fcntl, hashlib, json, os, pathlib, re, shutil, socket, ssl, subprocess, sys, tempfile, time, uuid
ROOT=pathlib.Path('/opt/mailstack-nextjs')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic_json(path,value,mode=0o600):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.status-')
    try:
        with os.fdopen(fd,'w') as f:json.dump(value,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,mode);os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def run(args,**kwargs):
    result=subprocess.run(args,check=False,capture_output=True,timeout=kwargs.pop('timeout',120),**kwargs)
    if result.returncode:raise RuntimeError('Operation failed; no data was removed. Inspect the protected host diagnostics.')
    return result
def compose(*args,**kwargs):return run(['docker','compose','--project-directory',str(ROOT),'--profile','managed-mox',*args],**kwargs)
def mox(*args,**kwargs):return run(['docker','exec','mailstack-nextjs-mox','/bin/mox','-config','/mox/config/mox.conf',*args],**kwargs)
def load_config():
    p=ROOT/'private/runtime.json'
    if p.is_symlink() or p.stat().st_mode&0o077:raise ValueError('Host configuration must be a protected regular file')
    return json.loads(p.read_text())
def report_update(**values):
    p=ROOT/'report/status.json';report=json.loads(p.read_text()) if p.exists() else {}
    report.update(values);report['observedAt']=now();atomic_json(p,report,0o644);return report
def restic(config,*args,**kwargs):
    allow_failure=kwargs.pop('allow_failure',False)
    repository=config.get('backup_repository','');password=ROOT/'private/restic-password'
    if not repository or any(c in repository for c in '\r\n\0') or not (repository.startswith(('sftp:','s3:','rest:')) or repository.startswith('/')):raise ValueError('Configure a supported encrypted remote repository')
    if repository.startswith('/') and not config.get('lab'):raise ValueError('A same-host repository is accepted only in an explicit lab')
    if password.is_symlink() or password.stat().st_mode&0o077:raise ValueError('Restic password must be protected')
    env=os.environ.copy();env['RESTIC_REPOSITORY']=repository;env['RESTIC_PASSWORD_FILE']=str(password)
    credentials=ROOT/'private/restic-environment.json'
    if credentials.exists():
        if credentials.is_symlink() or credentials.stat().st_mode&0o077:raise ValueError('Repository credentials must be protected')
        values=json.loads(credentials.read_text());allowed={'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_DEFAULT_REGION'}
        if set(values)-allowed or not all(isinstance(v,str) and '\0' not in v for v in values.values()):raise ValueError('Unsupported storage credentials')
        env.update(values)
    options=['-o','sftp.args=-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20'] if repository.startswith('sftp:') else []
    return subprocess.run(['restic',*options,*args],env=env,capture_output=True,timeout=kwargs.pop('timeout',120),**kwargs) if allow_failure else run(['restic',*options,*args],env=env,**kwargs)
def backups_update(**values):
    p=ROOT/'report/status.json';report=json.loads(p.read_text()) if p.exists() else {};backups=report.get('backups',{});backups.update(values);return report_update(backups=backups)
def snapshot_push(source,destination):
    # SQLite online backup includes committed transactions while the web worker
    # runs. Never copy a live DB/journal pair with shutil.
    database=source/'push.sqlite'
    if not database.exists():return
    if source.is_symlink() or database.is_symlink():raise ValueError('Unexpected link in Push state')
    destination.mkdir(mode=0o700)
    with sqlite3.connect(database.as_uri()+'?mode=ro',uri=True) as live:
        with sqlite3.connect(destination/'push.sqlite') as copy:
            live.backup(copy)
            if copy.execute('PRAGMA quick_check').fetchone()!=('ok',):raise ValueError('Push snapshot failed integrity check')
    os.chmod(destination/'push.sqlite',0o600)
def backup(config):
    if config.get('mode')!='managed':raise ValueError('Connected Mox backup requires its separately configured host maintenance access')
    stage_root=ROOT/'mox/backup';stage_root.mkdir(mode=0o750,exist_ok=True);os.chown(stage_root,0,2000);os.chmod(stage_root,0o750)
    if shutil.disk_usage(stage_root).free < 512*1024*1024:raise ValueError('Backup staging requires at least 512 MiB free')
    stage=pathlib.Path(tempfile.mkdtemp(prefix='snapshot-',dir=stage_root));os.chown(stage,0,2000);os.chmod(stage,0o750)
    native=stage/'mox';native.mkdir(mode=0o700);os.chown(native,2000,2000)
    backups_update(lastAttempt=now(),state='running')
    try:
        mox('backup','/mox/backup/'+stage.name+'/mox',timeout=1800)
        if not (native/'data').is_dir() or not (native/'config').is_dir():raise ValueError('Mox native backup contract mismatch')
        for name in ['tls','private']:
            shutil.copytree(ROOT/name,stage/name,symlinks=True,ignore=shutil.ignore_patterns('push') if name=='private' else None)
        snapshot_push(ROOT/'private/push',stage/'private/push')
        shutil.copyfile(ROOT/'compose.yaml',stage/'compose.yaml');shutil.copyfile(ROOT/'.env',stage/'.env')
        shutil.copyfile('/etc/nginx/conf.d/mailstack-nextjs.conf',stage/'nginx.conf')
        atomic_json(stage/'manifest.json',{'schema':1,'createdAt':now(),'moxImage':config['mox_image'],'webImage':config['web_image'],'method':'mox-native-backup','sessions':'ephemeral-not-restored'})
        result=restic(config,'backup','--json','--tag','mailstack-nextjs',str(stage),timeout=3600)
        summaries=[json.loads(line) for line in result.stdout.decode().splitlines() if line.strip()]
        summary=next((s for s in reversed(summaries) if s.get('message_type')=='summary' and re.fullmatch(r'[a-f0-9]{64}',s.get('snapshot_id',''))),None)
        if not summary:raise ValueError('Backup did not return a concrete snapshot ID')
        restic(config,'check','--read-data',timeout=7200)
        backups_update(lastSuccess=now(),lastCheck=now(),snapshotId=summary['snapshot_id'],state='ok',repository='lab-local' if config.get('lab') and config['backup_repository'].startswith('/') else 'remote-encrypted',schedule=config.get('backup_schedule',''))
        # Only this invocation's verified native staging is removed. Repository,
        # mail data, failed staging and every historical snapshot are retained.
        if stage.parent==stage_root and stage.name.startswith('snapshot-') and not stage.is_symlink():shutil.rmtree(stage)
        return {'snapshotId':summary['snapshot_id'],'integrity':'all-pack-data-read','externalStorage':not config['backup_repository'].startswith('/')}
    except Exception:
        backups_update(state='error',lastFailure=now());raise
def restore(config,snapshot):
    if not re.fullmatch(r'[a-f0-9]{8,64}',snapshot):raise ValueError('A concrete snapshot ID is required, never latest')
    restic(config,'check','--read-data',timeout=7200)
    destination=ROOT/'restores'/uuid.uuid4().hex;destination.mkdir(parents=True,mode=0o700)
    restic(config,'restore',snapshot,'--target',str(destination),'--verify',timeout=7200)
    manifests=list(destination.rglob('manifest.json'))
    if len(manifests)!=1:raise ValueError('Recovery manifest is missing or ambiguous')
    stage=manifests[0].parent;manifest=json.loads(manifests[0].read_text())
    if manifest.get('schema')!=1 or not re.fullmatch(r'sha256:[a-f0-9]{64}',manifest.get('moxImage','')):raise ValueError('Restore requires a concrete Mox image identity')
    image=manifest['moxImage']
    run(['docker','image','inspect',image])
    version=run(['docker','run','--rm','--network','none',image,'/bin/mox','version']).stdout.decode()
    if not any(generation in version for generation in ['v0.0.17-mailstack.4-nextjs','v0.0.17-mailstack.6-nextjs']):raise ValueError('Recovery generation needs separate compatibility acceptance')
    data=stage/'mox/data'
    if not data.is_dir() or data.is_symlink():raise ValueError('Restored Mox data is missing')
    # Native verifydata opens Bolt databases read/write; only this isolated restored
    # copy is writable. The live data directory is never mounted here.
    run(['docker','run','--rm','--network','none','--volume',str(stage)+':/restore','--volume',str(stage/'tls')+':/tls:ro',image,'/bin/mox','-config','/restore/mox/config/mox.conf','verifydata','/restore/mox/data'],timeout=3600)
    atomic_json(destination/'RECOVERY-NOT-ACTIVE.json',{'snapshotId':snapshot,'verifiedAt':now(),'active':False,'mailDelivery':'not-started'})
    backups_update(lastRestore=now());return {'verified':True,'active':False,'target':str(stage),'snapshotId':snapshot}
DNS_SECTIONS=('DNSSEC','IPRev','MX','TLS','DANE','SPF','DKIM','DMARC','HostTLSRPT','DomainTLSRPT','MTASTS','SRVConf','Autoconf','Autodiscover')
def dns_ready(value,domain):
    if not isinstance(value,dict) or value.get('Domain')!=domain:return False
    for section in DNS_SECTIONS:
        item=value.get(section)
        if not isinstance(item,dict) or 'Errors' not in item or item['Errors'] not in (None,[]):return False
    return True
def container_status():
    raw=compose('ps','--format','json').stdout.decode().strip()
    values=json.loads(raw) if raw.startswith('[') else [json.loads(line) for line in raw.splitlines() if line.strip()]
    expected={'mox','web'} if load_config().get('mode')=='managed' else {'web'}
    by_service={value.get('Service'):value for value in values}
    if not expected <= by_service.keys() or any(by_service[name].get('State')!='running' or by_service[name].get('Health')!='healthy' for name in expected):raise ValueError('Required services are not healthy')
    return values

def probe_bff():
    code="fetch(new URL('/admin/api/LoginPrep',process.env.MOX_ORIGIN),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({params:[]})}).then(async r=>{if(!r.ok||!(await r.json()).result)process.exit(1)}).catch(()=>process.exit(1))"
    run(['docker','exec','mailstack-nextjs-web','node','-e',code])
    return 'BFF достигает Mox по закрытому API; учётные данные не использовались.'

def doctor(config):
    checks=[]
    def check(name,action):
        try:message=action();checks.append({'name':name,'status':'ok','message':message})
        except Exception:checks.append({'name':name,'status':'pending','message':'Проверка не пройдена. Требуется диагностика на хосте.'})
    check('Контейнеры',lambda: container_status() and 'Все обязательные контейнеры работают и healthy.')
    check('BFF → Mox',probe_bff)
    check('Next.js',lambda:run(['python3','-c',"import urllib.request;assert urllib.request.urlopen('http://127.0.0.1:3100/api/health').status==200"]).stdout.decode() or 'HTTP отвечает на loopback.')
    if config.get('mode')=='managed':
        from tls_deploy import probe
        check('IMAPS и SMTP STARTTLS',lambda:probe(config['hostname'],config.get('tls_ca_file')) or 'Цепочка, hostname, IMAPS и SMTP STARTTLS проверены.')
    disk=shutil.disk_usage(ROOT);checks.append({'name':'Диск','status':'ok' if disk.free>2147483648 else 'pending','message':str(disk.free)+' байт свободно.'})
    phase='application-installed'
    if config.get('lab'):
        checks.append({'name':'DNS и внешняя доставка','status':'pending','message':'Изолированный lab. Публичная доставка не проверяется.'});phase='lab-installed'
    elif config.get('mode')=='managed':
        try:
            value=json.loads(mox('config','dnscheck','-json',config['domain'],timeout=180).stdout)
            ready=dns_ready(value,config['domain']);atomic_json(ROOT/'private/dns-check.json',value)
            phase='dns-ready-external-test-required' if ready else 'dns-configuration-required'
            checks.append({'name':'DNS','status':'ok' if ready else 'pending','message':'Критичные проверки Mox пройдены.' if ready else 'Проверьте dns-records.txt и защищённый отчёт DNS.'})
        except Exception:phase='dns-configuration-required';checks.append({'name':'DNS','status':'pending','message':'Полный ответ Mox не получен.'})
    report=report_update(checks=checks,phase=phase)
    return {'phase':phase,'checks':checks,'externalSendVerified':False,'backupVerified':bool(report.get('backups',{}).get('lastCheck'))}
def status(config):
    return {'containers':container_status(),'report':json.loads((ROOT/'report/status.json').read_text())}
def main():
    p=argparse.ArgumentParser();p.add_argument('operation',choices=['backup','restore','doctor','status','backup-init']);p.add_argument('--snapshot');args=p.parse_args()
    config=load_config();lockfile=ROOT/'private/operation.lock'
    with lockfile.open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit('Another MailStack maintenance operation is running')
        if args.operation=='backup':result=backup(config)
        elif args.operation=='restore':result=restore(config,args.snapshot or '')
        elif args.operation=='doctor':result=doctor(config)
        elif args.operation=='status':result=status(config)
        else:
            # The configured repository is explicit. No pruning or deletion exists.
            probe=restic(config,'snapshots','--json',allow_failure=True);initialized=False
            if probe.returncode:
                if config.get('initialize_backup') is not True:raise ValueError('Repository unavailable; initialization was not explicitly selected')
                restic(config,'init');initialized=True
            result={'repositoryAccessible':True,'initialized':initialized}
        print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except Exception as exc:raise SystemExit(str(exc))
