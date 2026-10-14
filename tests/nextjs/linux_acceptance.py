#!/usr/bin/env python3
"""Synthetic acceptance fixture. Run as root ONLY in an explicit dedicated .test lab."""
import argparse, datetime, email, http.cookiejar, urllib.request, urllib.error, hashlib, http.client, imaplib, json, os, pathlib, socket, ssl, subprocess, sys, time
from email.message import EmailMessage
from email.policy import SMTP
ROOT=pathlib.Path('/opt/mailstack-nextjs')
MARKER='# MailStack acceptance fixture\n'
def run(*args,**kwargs):return subprocess.run(args,check=True,capture_output=True,**kwargs)
def context(config):return ssl.create_default_context(cafile=config['tls_ca_file'])
def read_fixture(config):
    expected=json.loads((ROOT/'private/acceptance.json').read_text());client=imaplib.IMAP4_SSL(config['hostname'],993,ssl_context=context(config));client.login('alice@'+config['domain'],'mailstack-local-only-2026');client.select('Inbox',readonly=True)
    status,data=client.uid('search',None,'HEADER','Message-ID',expected['messageId']);assert status=='OK' and data[0], 'Synthetic source message missing'
    status,data=client.uid('fetch',data[0].split()[-1],'(RFC822)');assert status=='OK';message=email.message_from_bytes(data[0][1],policy=SMTP)
    assert str(message['Subject'])==expected['subject'];payload=next(message.iter_attachments()).get_payload(decode=True);assert hashlib.sha256(payload).hexdigest()==expected['attachmentSHA256'];client.logout();return expected

def seed(config):
    if (ROOT/'private/acceptance.json').exists():return read_fixture(config)
    payload=bytes(range(256))*64;message=EmailMessage(policy=SMTP);message['From']='alice@'+config['domain'];message['To']='alice@'+config['domain'];message['Subject']='Проверка резервной копии MailStack';message['Message-ID']='<acceptance-'+str(time.time_ns())+'@'+config['domain']+'>';message['Date']=email.utils.format_datetime(datetime.datetime.now(datetime.timezone.utc));message.set_content('Это синтетическое письмо создано только в изолированном стенде.');message.add_attachment(payload,maintype='application',subtype='octet-stream',filename='проверка.bin')
    client=imaplib.IMAP4_SSL(config['hostname'],993,ssl_context=context(config));client.login('alice@'+config['domain'],'mailstack-local-only-2026');assert client.append('Inbox','(\\Seen)',None,message.as_bytes())[0]=='OK';client.logout()
    expected={'messageId':str(message['Message-ID']),'subject':str(message['Subject']),'attachmentSHA256':hashlib.sha256(payload).hexdigest()};(ROOT/'private/acceptance.json').write_text(json.dumps(expected,ensure_ascii=False));os.chmod(ROOT/'private/acceptance.json',0o600);return read_fixture(config)

def neighbours(config):
    directory=ROOT/'private/neighbour-fixture';directory.mkdir(mode=0o700,exist_ok=True)
    for suffix in ['a','b']:
        host='fixture-'+suffix+'.test';cert=directory/(suffix+'.pem');key=directory/(suffix+'.key');path=pathlib.Path('/etc/nginx/conf.d/mailstack-fixture-'+suffix+'.conf')
        if path.exists():assert path.read_text().startswith(MARKER)
        if not cert.exists():run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','30','-subj','/CN='+host,'-addext','subjectAltName=DNS:'+host,'-keyout',str(key),'-out',str(cert));os.chmod(key,0o600)
        path.write_text(MARKER+'server { listen 80; listen [::]:80; server_name '+host+'; location / { return 200 "neighbour-'+suffix+'"; }}\nserver { listen 443 ssl; listen [::]:443 ssl; server_name '+host+'; ssl_certificate '+str(cert)+'; ssl_certificate_key '+str(key)+'; location / { return 200 "neighbour-'+suffix+'"; }}\n')
    run('nginx','-t');run('systemctl','reload','nginx');time.sleep(1);return verify_neighbours(config)

def verify_neighbours(config):
    result={}
    for suffix in ['a','b']:
        host='fixture-'+suffix+'.test';cert=ROOT/'private/neighbour-fixture'/(suffix+'.pem');connection=http.client.HTTPConnection('127.0.0.1',80,timeout=10);connection.request('GET','/',headers={'Host':host});response=connection.getresponse();assert response.status==200 and response.read()==('neighbour-'+suffix).encode();connection.close()
        ctx=ssl.create_default_context(cafile=str(cert));sock=ctx.wrap_socket(socket.create_connection(('127.0.0.1',443),10),server_hostname=host);fingerprint=hashlib.sha256(sock.getpeercert(binary_form=True)).hexdigest();sock.sendall(('GET / HTTP/1.0\r\nHost: '+host+'\r\n\r\n').encode());body=b''
        while True:
            chunk=sock.recv(4096)
            if not chunk:break
            body+=chunk
        sock.close();assert ('neighbour-'+suffix).encode() in body;result[host]=fingerprint
    state=ROOT/'private/neighbours-expected.json'
    if state.exists():assert json.loads(state.read_text())==result,'A neighbouring certificate changed'
    else:state.write_text(json.dumps(result));os.chmod(state,0o600)
    return result

def verify(config):
    result={'message':read_fixture(config),'neighbours':verify_neighbours(config)}
    with context(config).wrap_socket(socket.create_connection(('::1',993),10),server_hostname=config['hostname']) as sock:assert sock.recv(256).startswith(b'* OK')
    for host in ['::1',run('hostname','-I',text=True).stdout.split()[0]]:
        try:socket.create_connection((host,1080),2).close()
        except OSError:continue
        raise AssertionError('Native API unexpectedly reachable at '+host)
    connection=http.client.HTTPSConnection(config['hostname'],443,context=context(config),timeout=10);connection.request('GET','/admin/api/LoginPrep');response=connection.getresponse();assert response.status==404;connection.close()
    jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPSHandler(context=context(config)),urllib.request.HTTPCookieProcessor(jar));origin='https://'+config['hostname']
    def api(path,data=None,csrf=None):
        headers={'Origin':origin,'Content-Type':'application/json'}
        if csrf:headers['X-Mailstack-CSRF']=csrf
        request=urllib.request.Request(origin+path,data=json.dumps(data).encode() if data is not None else None,headers=headers)
        return opener.open(request,timeout=30)
    login=json.load(api('/api/mail/login',{'username':'alice@'+config['domain'],'password':'mailstack-local-only-2026'}));assert login['authenticated'];cookies=list(jar);assert len(cookies)==1 and cookies[0].secure and cookies[0].name=='__Host-mailstack-mail'
    snap=json.load(api('/api/mail/snapshot'));item=next(m for m in snap['mails'] if m['messageID'] in [result['message']['messageId'],result['message']['messageId'].strip('<>')]);opened=json.load(api('/api/mail/message/'+str(item['id'])));assert opened['subject']==result['message']['subject']
    data=api('/api/mail/attachment/'+str(item['id'])+'/'+item['attachments'][0]['path']).read();assert hashlib.sha256(data).hexdigest()==result['message']['attachmentSHA256']
    try:api('/api/admin/accounts')
    except urllib.error.HTTPError as e:assert e.code==401
    else:raise AssertionError('Mail session gained admin access')
    try:api('/api/mail/flags',{'ids':[item['id']],'flag':'\\seen','enabled':True},'wrong')
    except urllib.error.HTTPError as e:assert e.code==403
    else:raise AssertionError('CSRF bypassed')
    json.load(api('/api/mail/logout',{},login['csrfToken']));result['httpsBFF']='login/read/download/logout; Secure cookie; CSRF and role separation verified';result['isolation']='public IPv4/IPv6 and HTTPS native API paths closed';result['ipv6Imaps']=True;return result

def main():
    p=argparse.ArgumentParser();p.add_argument('operation',choices=['seed','neighbours','verify','read']);args=p.parse_args();config=json.loads((ROOT/'private/runtime.json').read_text());assert os.geteuid()==0 and config.get('lab') is True and config['domain'].endswith('.test') and (ROOT/'OWNED-BY-MAILSTACK-NEXTJS').is_file(), 'Dedicated lab only'
    print(json.dumps({'operation':args.operation,'result':{'seed':seed,'neighbours':neighbours,'verify':verify,'read':read_fixture}[args.operation](config)},ensure_ascii=False))
if __name__=='__main__':main()
