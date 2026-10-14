#!/usr/bin/env python3
"""Interactive controller: protected JSON, immutable image bundle, native Ansible."""
import argparse, getpass, hashlib, ipaddress, json, os, pathlib, re, secrets, shutil, stat, subprocess, sys, tempfile, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
class ConfigError(ValueError):pass
def protected(path):
    """Reject symlinks and group/world-readable files before parsing credentials."""
    path=pathlib.Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode&0o077:raise ConfigError('Конфигурация должна быть обычным файлом с правами 0600.')
    return path
def validate(cfg):
    """Validate the exact target and mode before SSH, Docker, or Ansible runs.

    The controller never discovers a production target from ambient context.
    A caller must supply host, domain, TLS/backup plan and required passwords.
    """
    if not isinstance(cfg,dict):raise ConfigError('Ожидается JSON-объект.')
    for key in ['ssh_host','ssh_user']:
        if not isinstance(cfg.get(key),str) or not re.fullmatch(r'[A-Za-z0-9_.:-]+',cfg[key]) or cfg[key].startswith('-'):raise ConfigError('Проверьте SSH host/user.')
    for key in ['domain','hostname']:
        if not isinstance(cfg.get(key),str) or len(cfg[key])>253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label) for label in cfg[key].split('.')):raise ConfigError('Домен и hostname должны быть в ASCII/Punycode.')
    for key in ['admin_password','first_password','restic_password']:
        if not isinstance(cfg.get(key),str) or len(cfg[key])<12 or len(cfg[key])>1024 or any(c in cfg[key] for c in '\r\n\0'):raise ConfigError('Пароли должны содержать 12–1024 символа без переносов строки.')
    address=cfg.get('first_address','');local,sep,domain=address.partition('@')
    if not sep or domain!=cfg['domain'] or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}',local):raise ConfigError('Первый адрес должен принадлежать почтовому домену и иметь ASCII localpart.')
    if not isinstance(cfg.get('ssh_port',22),int) or not 1<=cfg.get('ssh_port',22)<=65535:raise ConfigError('Некорректный SSH-порт.')
    if cfg.get('certificate_mode','acme') not in ['acme','reuse','lab']:raise ConfigError('Неизвестный режим TLS.')
    if cfg.get('certificate_mode')=='lab' and not (cfg.get('lab') is True and cfg['domain'].endswith('.test')):raise ConfigError('Lab TLS допустим только с явным lab=true и доменом .test.')
    if cfg.get('mode','managed') not in ['managed','connect']:raise ConfigError('Неизвестный режим Mox.')
    if not isinstance(cfg.get('push_enabled',False),bool):raise ConfigError('push_enabled должен быть явным boolean true/false.')
    if cfg.get('mode')=='connect':
        url=urllib.parse.urlsplit(cfg.get('mox_origin',''))
        if url.username or url.password or url.query or url.fragment or url.path not in ['','/'] or not (url.scheme=='https' or (url.scheme=='http' and url.hostname in ['127.0.0.1','localhost','::1'])):raise ConfigError('Mox URL: HTTPS либо HTTP на loopback, без credentials и пути.')
    repository=cfg.get('backup_repository','')
    if not isinstance(repository,str) or any(c in repository for c in '\r\n\0') or (repository and not repository.startswith(('sftp:','s3:','/'))):raise ConfigError('Допускается SFTP/S3 repository; локальный путь только для lab.')
    if repository.startswith('/') and not cfg.get('lab'):raise ConfigError('Единственная локальная копия не подходит для рабочей установки.')
    schedule=cfg.get('backup_schedule','*-*-* 02:30:00 UTC')
    if not isinstance(schedule,str) or not re.fullmatch(r'[A-Za-z0-9*:,./ +_-]{1,120}',schedule):raise ConfigError('Некорректное расписание backup.')
    if cfg.get('ssh_key'):
        key=pathlib.Path(cfg['ssh_key']).expanduser()
        if not key.is_file() or key.stat().st_mode&0o077:raise ConfigError('SSH-ключ должен быть доступен только владельцу.')
        cfg['ssh_key']=str(key)
    if cfg.get('known_hosts'):
        known=pathlib.Path(cfg['known_hosts']).expanduser()
        if not known.is_file():raise ConfigError('Файл проверенных host keys не найден.')
        cfg['known_hosts']=str(known)
    return cfg
def write_private(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:json.dump(data,f,ensure_ascii=False,indent=2)
def interactive():
    print('MailStack — установка на Linux. Существующие сервисы не останавливаются.')
    cfg={'ssh_host':input('Адрес сервера: ').strip(),'ssh_user':input('SSH-пользователь [root]: ').strip() or 'root','ssh_port':22,'domain':input('Почтовый домен: ').strip(),'hostname':input('Hostname веб-почты и Mox: ').strip()}
    cfg['mode']='connect' if input('Подключить уже работающий Mox вместо создания нового? [yes/нет]: ').strip()=='yes' else 'managed'
    if cfg['mode']=='connect':cfg['mox_origin']=input('Закрытый Mox URL (HTTPS или loopback HTTP): ').strip()
    cfg['ssh_key']=input('Путь к SSH-ключу (пусто — SSH agent): ').strip();cfg['first_address']=input('Первый почтовый адрес: ').strip()
    cfg['admin_password']=getpass.getpass('Пароль администратора (пусто — сгенерировать): ') or secrets.token_urlsafe(24)
    cfg['first_password']=getpass.getpass('Пароль первого ящика (пусто — сгенерировать): ') or secrets.token_urlsafe(24)
    cfg['restic_password']=secrets.token_urlsafe(32);cfg['backup_repository']=input('Внешний Restic repository SFTP/S3 (можно настроить позже): ').strip()
    cfg['initialize_backup']=bool(cfg['backup_repository']) and input('Инициализировать именно этот repository, если он отсутствует? [yes/нет]: ').strip()=='yes'
    cfg=validate(cfg);path=ROOT/'deploy/private'/('install-'+cfg['ssh_host'].replace(':','_')+'.json');write_private(path,cfg)
    print('Пароли и конфигурация сохранены только в защищённом файле:',path)
    return cfg,path
def ssh_arguments(cfg):
    args=['ssh','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-p',str(cfg.get('ssh_port',22))]
    if cfg.get('ssh_key'):args+=['-i',cfg['ssh_key']]
    if cfg.get('known_hosts'):args+=['-o','UserKnownHostsFile='+cfg['known_hosts']]
    return args+[cfg['ssh_user']+'@'+cfg['ssh_host']]
def image_manifest(cfg,filename=None):
    """Match the target architecture and verify both offline archives by hash.

    The manifest is a review receipt, not a floating Docker tag. The host-side
    roles resolve and pin the immutable image identity again after load.
    """
    arch=subprocess.check_output(ssh_arguments(cfg)+['uname','-m'],text=True).strip();arch={'aarch64':'arm64','x86_64':'amd64'}.get(arch)
    if not arch:raise ConfigError('Поддерживаются Linux amd64 и arm64.')
    path=pathlib.Path(filename) if filename else ROOT/'artifacts/nextjs'/('images-'+arch+'.json')
    if not path.exists():subprocess.run([sys.executable,str(ROOT/'scripts/build_nextjs_images.py'),'--platform','linux/'+arch,'--export'],check=True)
    path=path.resolve();manifest=json.loads(path.read_text())
    if manifest.get('schema')!=1 or manifest.get('architecture')!=arch or manifest.get('moxVersion')!='v0.0.17-mailstack.6-nextjs':raise ConfigError('Несовместимый image manifest.')
    for service in ['mox','web']:
        image=manifest.get('images',{}).get(service,{})
        if not re.fullmatch(r'sha256:[a-f0-9]{64}',image.get('id','')):raise ConfigError('Требуется неизменяемый image digest.')
        archive=pathlib.Path(image.get('archive',''))
        if not archive.is_absolute():archive=path.parent/archive
        archive=archive.resolve();image['archive']=str(archive)
        if not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest()!=image.get('sha256'):raise ConfigError('Архив образа не прошёл проверку SHA-256.')
    return manifest
def ansible(cfg,playbook,extra,check=False):
    """Pass secrets through short-lived mode-0600 files, never CLI arguments.

    Strict SSH host-key checking stays enabled even for dry-run operations.
    """
    executable=shutil.which('ansible-playbook')
    if not executable:raise ConfigError('Ansible не найден. Установите controller: python3 -m pip install ansible-core==2.20.5')
    with tempfile.TemporaryDirectory(prefix='mailstack-ansible-') as temporary:
        directory=pathlib.Path(temporary);os.chmod(directory,0o700)
        inventory={'all':{'children':{'mailstack':{'hosts':{'target':{'ansible_host':cfg['ssh_host'],'ansible_user':cfg['ssh_user'],'ansible_port':cfg.get('ssh_port',22),'ansible_python_interpreter':'/usr/bin/python3'}}}}}}
        host=inventory['all']['children']['mailstack']['hosts']['target']
        if cfg.get('ssh_key'):host['ansible_ssh_private_key_file']=cfg['ssh_key']
        # Native trust remains strict. This never installs or replaces host keys.
        import shlex
        host['ansible_ssh_common_args']='-o StrictHostKeyChecking=yes'+(' -o UserKnownHostsFile='+shlex.quote(cfg['known_hosts']) if cfg.get('known_hosts') else '')
        variables={'mailstack_'+k:v for k,v in cfg.items() if k not in ['ssh_host','ssh_user','ssh_port','ssh_key','known_hosts']};variables.update(extra);variables['mailstack_first_account']=cfg['first_address'].split('@')[0]
        write_private(directory/'inventory.json',inventory);write_private(directory/'vars.json',variables)
        args=[executable,'-i',str(directory/'inventory.json'),str(ROOT/'deploy/ansible/playbooks'/playbook),'-e','@'+str(directory/'vars.json')]
        if check:args.append('--check')
        subprocess.run(args,cwd=ROOT/'deploy/ansible',env={**os.environ,'ANSIBLE_CONFIG':str(ROOT/'deploy/ansible/ansible.cfg')},check=True)
def main():
    p=argparse.ArgumentParser();p.add_argument('operation',choices=['install','update','status','doctor','backup','restore','uninstall','dev']);p.add_argument('--config');p.add_argument('--images');p.add_argument('--snapshot');p.add_argument('--confirm');p.add_argument('--check',action='store_true');args=p.parse_args()
    if args.operation=='dev':
        subprocess.run([sys.executable,str(ROOT/'scripts/dev_nextjs.py')],check=True);return
    if args.config:path=protected(args.config);cfg=validate(json.loads(path.read_text()))
    elif args.operation=='install':cfg,path=interactive()
    else:raise ConfigError('Укажите защищённую конфигурацию --config.')
    if args.operation in ['install','update']:
        manifest=image_manifest(cfg,args.images);extra={}
        for service,image in manifest['images'].items():
            for field in ['id','archive','sha256']:extra['mailstack_'+service+('_image' if field=='id' else '_archive' if field=='archive' else '_archive_sha256')]=image[field]
        ansible(cfg,'install.yml' if args.operation=='install' else 'update.yml',extra,args.check)
    elif args.operation=='uninstall':
        if (args.confirm or input('Для удаления приложения введите hostname '+cfg['hostname']+': '))!=cfg['hostname']:raise ConfigError('Удаление отменено. Данные сохранены.')
        ansible(cfg,'uninstall.yml',{},args.check)
    else:
        if args.operation=='restore' and (not args.snapshot or (args.confirm or input('Подтвердите ID snapshot '+args.snapshot+': '))!=args.snapshot):raise ConfigError('Восстановление не подтверждено.')
        ansible(cfg,'maintenance.yml',{'mailstack_operation':args.operation,'mailstack_snapshot':args.snapshot or ''},args.check)
if __name__=='__main__':
    try:main()
    except (ConfigError,ValueError,OSError,subprocess.SubprocessError) as exc:raise SystemExit('MailStack: '+str(exc))
