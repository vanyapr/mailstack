#!/usr/bin/env python3
"""Certbot deploy hook: validate, atomic switch, restart Mox, verify or roll back."""
import argparse, hashlib, json, os, pathlib, shutil, socket, ssl, subprocess, tempfile, time
ROOT=pathlib.Path('/opt/mailstack-nextjs')
def command(args,**kwargs):return subprocess.run(args,check=True,capture_output=True,**kwargs)
def validate(lineage,names,lab=False):
    lineage=pathlib.Path(lineage);certificate=lineage/'fullchain.pem';key=lineage/'privkey.pem'
    if not certificate.is_file() or not key.is_file():raise ValueError('Certificate or key is missing')
    context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(certificate,key)
    info=ssl._ssl._test_decode_cert(str(certificate))
    sans={value for kind,value in info.get('subjectAltName',[]) if kind=='DNS'}
    if not set(names)<=sans:raise ValueError('Certificate SAN does not cover the required hostnames')
    if ssl.cert_time_to_seconds(info['notAfter'])<time.time()+86400:raise ValueError('Certificate expires in less than 24 hours')
    if not lab:
        command(['openssl','verify','-CAfile','/etc/ssl/certs/ca-certificates.crt','-untrusted',str(certificate),str(certificate)])
    return hashlib.sha256(certificate.read_bytes()+key.read_bytes()).hexdigest()
def compose(*args):return command(['docker','compose','--project-directory',str(ROOT),'--profile','managed-mox',*args])
def probe(hostname,ca=None):
    context=ssl.create_default_context(cafile=ca)
    with socket.create_connection(('127.0.0.1',993),timeout=15) as connection:
        with context.wrap_socket(connection,server_hostname=hostname) as tls:
            if not tls.recv(256).startswith(b'* OK'):raise ValueError('IMAPS greeting is invalid')
    args=['openssl','s_client','-starttls','smtp','-connect','127.0.0.1:587','-servername',hostname,'-verify_hostname',hostname,'-verify_return_error']
    if ca:args+=['-CAfile',ca]
    result=command(args,input=b'QUIT\r\n',timeout=25)
    if b'Verify return code: 0 (ok)' not in result.stdout+result.stderr:raise ValueError('SMTP TLS verification failed')
def deploy(config,probe_tls=True):
    names=config['certificate_names'];lineage=config['certificate_lineage'];lab=config.get('lab',False)
    renewed=os.environ.get('RENEWED_LINEAGE')
    if renewed and pathlib.Path(renewed).resolve()!=pathlib.Path(lineage).resolve():return {'changed':False,'unrelatedCertificate':True}
    fingerprint=validate(lineage,names,lab);tls=ROOT/'tls';tls.mkdir(mode=0o700,exist_ok=True)
    version=tls/fingerprint;current=tls/'current';previous=os.readlink(current) if current.is_symlink() else None
    if previous==fingerprint:return {'changed':False}
    if not version.exists():
        version.mkdir(mode=0o700)
        for name in ['fullchain.pem','privkey.pem']:
            shutil.copyfile(pathlib.Path(lineage)/name,version/name);os.chmod(version/name,0o600)
    next_link=tls/'next';next_link.unlink(missing_ok=True);next_link.symlink_to(fingerprint);os.replace(next_link,current)
    try:
        # Before initial Mox configuration this only stages a verified certificate.
        if (ROOT/'mox/config/mox.conf').exists() and probe_tls and config.get('mode','managed')=='managed':
            compose('run','--rm','--no-deps','mox','/bin/mox','-config','/mox/config/mox.conf','config','test')
            compose('restart','mox');last=None
            for _ in range(15):
                try:probe(config['hostname'],config.get('tls_ca_file'));last=None;break
                except Exception as exc:last=exc;time.sleep(1)
            if last:raise last
        command(['nginx','-t']);command(['systemctl','reload','nginx'])
    except Exception:
        current.unlink(missing_ok=True)
        if previous:
            current.symlink_to(previous)
            if (ROOT/'mox/config/mox.conf').exists() and config.get('mode','managed')=='managed':compose('restart','mox')
        raise RuntimeError('Certificate deployment failed; the previous Mox certificate was restored') from None
    return {'changed':True,'certificateSHA256':hashlib.sha256((version/'fullchain.pem').read_bytes()).hexdigest()}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--stage-only',action='store_true');a=p.parse_args()
    try:print(json.dumps(deploy(json.loads((ROOT/'private/runtime.json').read_text()),not a.stage_only)))
    except Exception as exc:raise SystemExit(str(exc))
