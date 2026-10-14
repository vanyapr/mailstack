#!/usr/bin/env python3
"""Apply one owned vhost atomically; restore it on validation/reload failure."""
import argparse, json, os, pathlib, subprocess, tempfile
TARGET=pathlib.Path('/etc/nginx/conf.d/mailstack-nextjs.conf')
MARKER=b'# Managed by MailStack Next.js\n'
def atomic(path,data):
    fd,name=tempfile.mkstemp(dir=path.parent,prefix='.mailstack-')
    try:
        with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.chmod(name,0o644);os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)
def apply(candidate,target=TARGET,runner=subprocess.run):
    data=pathlib.Path(candidate).read_bytes()
    if not data.startswith(MARKER):raise ValueError('Candidate ownership marker is missing')
    if target.is_symlink():raise ValueError('Refusing a symlink target')
    previous=target.read_bytes() if target.exists() else None
    if previous is not None and not previous.startswith(MARKER):raise ValueError('Target belongs to another application')
    if previous==data:return {'changed':False}
    atomic(target,data)
    try:
        runner(['nginx','-t'],check=True,capture_output=True)
        runner(['systemctl','reload','nginx'],check=True,capture_output=True)
    except Exception:
        if previous is None:target.unlink()
        else:atomic(target,previous)
        runner(['nginx','-t'],check=True,capture_output=True)
        runner(['systemctl','reload','nginx'],check=True,capture_output=True)
        raise RuntimeError('Nginx validation/reload failed; the owned configuration was restored') from None
    return {'changed':True}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('candidate');args=parser.parse_args()
    try:print(json.dumps(apply(args.candidate)))
    except Exception as exc:raise SystemExit(str(exc))
