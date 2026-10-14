#!/usr/bin/env python3
"""Reproducible local-only Compose stand, with synthetic accounts and mail."""
import argparse, json, os, pathlib, subprocess, time, urllib.request, urllib.error, http.cookiejar
ROOT=pathlib.Path(__file__).resolve().parents[1]
ORIGIN='http://127.0.0.1:3100'
PASSWORD='mailstack-local-only-2026'  # Public synthetic fixture, never production.
class Client:
    def __init__(self,role):self.role=role;self.csrf='';self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def call(self,path,data=None):
        request=urllib.request.Request(ORIGIN+'/api/'+self.role+'/'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Origin':ORIGIN,'Content-Type':'application/json','X-Mailstack-CSRF':self.csrf})
        with self.opener.open(request,timeout=40) as response:return json.load(response)
    def login(self,data):self.csrf=self.call('login',data)['csrfToken']
def seed():
    admin=Client('admin');admin.login({'password':'moxadmin'});accounts={a['name'] for a in admin.call('accounts')['items']}
    for name,full_name in [('alice','Алиса'),('bob','Борис')]:
        if name in accounts:continue
        admin.call('accounts',{'account':name,'address':name+'@localhost','password':PASSWORD})
        user=Client('mail');user.login({'username':name+'@localhost','password':PASSWORD});user.call('settings',{'fullName':full_name,'signature':full_name,'showHTML':True});user.call('logout',{})
    admin.call('logout',{});bob=Client('mail');bob.login({'username':'bob@localhost','password':PASSWORD});sent=bob.call('snapshot?folder=all')['mails'];subjects={m['subject'] for m in sent}
    examples=[('MailStack готов к проверке','Это локальный стенд с настоящим Mox. Здесь можно читать, отвечать, искать письма и проверять три компоновки. Вся почта тестовая.',''),('Обсуждение проекта','Предлагаю посмотреть интерфейс на широком экране и телефоне. Замечания можно прислать в чат разработки.',''),('Документы к встрече','Во вложении — небольшой тестовый файл. Проверьте скачивание и пересылку.',''),('Письмо с оформлением','Это текстовая версия HTML-письма.','<h1>Письмо с оформлением</h1><p>HTML отображается в отдельной защищённой области.</p><p><strong>Внешние изображения</strong> по умолчанию заблокированы.</p>')]
    import base64
    for index,(subject,text,html) in enumerate(examples):
        if subject in subjects:continue
        files=[{'name':'заметки.txt','type':'text/plain','data':base64.b64encode('Это тестовое вложение MailStack.\r\n'.encode()).decode()}] if index==2 else []
        bob.call('send',{'to':'alice@localhost','cc':'','bcc':'', 'subject':subject,'text':text,'html':html,'files':files})
    bob.call('logout',{});alice=Client('mail');alice.login({'username':'alice@localhost','password':PASSWORD})
    for _ in range(90):
        if len(alice.call('snapshot')['mails'])>=len(examples):break
        time.sleep(1)
    else:raise RuntimeError('Local delivery not confirmed')
    alice.call('logout',{})
def main():
    p=argparse.ArgumentParser();p.add_argument('--no-build',action='store_true');args=p.parse_args()
    subprocess.run(['docker','info'],check=True,stdout=subprocess.DEVNULL)
    architecture=subprocess.check_output(['docker','info','--format','{{.Architecture}}'],text=True).strip();arch={'aarch64':'arm64','arm64':'arm64','x86_64':'amd64','amd64':'amd64'}[architecture]
    path=ROOT/'artifacts/nextjs'/('images-'+arch+'.json')
    if not args.no_build or not path.exists():subprocess.run(['python3',str(ROOT/'scripts/build_nextjs_images.py'),'--platform','linux/'+arch,'--export'],check=True)
    manifest=json.loads(path.read_text());env={**os.environ,'MOX_IMAGE':manifest['images']['mox']['id'],'WEB_IMAGE':manifest['images']['web']['id']}
    subprocess.run(['docker','compose','-f',str(ROOT/'deploy/compose.dev.yaml'),'up','-d','--wait','--wait-timeout','120'],env=env,check=True)
    seed();print('MailStack: '+ORIGIN+'/mail · admin: '+ORIGIN+'/admin\nAlice: alice@localhost · Bob: bob@localhost\nПароль тестовых ящиков: '+PASSWORD+'\nПароль тестового администратора: moxadmin\nСтенд работает в Docker Compose. Повторный запуск сохраняет почту.')
if __name__=='__main__':main()
