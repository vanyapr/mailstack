import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const base=process.env.TEST_ORIGIN||'http://127.0.0.1:3100';
class Client {
  cookie='';csrf='';constructor(readonly role:'mail'|'admin'){}
  async response(path:string,data?:unknown,headers:Record<string,string>={}){return fetch(base+'/api/'+this.role+'/'+path,{method:data===undefined?'GET':'POST',headers:{cookie:this.cookie,origin:base,'content-type':'application/json','x-mailstack-csrf':this.csrf,...headers},body:data===undefined?undefined:JSON.stringify(data)});}
  async call<T=Record<string,unknown>>(path:string,data?:unknown):Promise<T>{const r=await this.response(path,data);const v=await r.json();assert.equal(r.status,200,`${path}: ${v.error||r.status}`);return v;}
  async login(data:unknown){const r=await this.response('login',data);const v=await r.json();assert.equal(r.status,200,v.error);this.cookie=r.headers.getSetCookie()[0].split(';')[0];this.csrf=v.csrfToken;}
}
type Snapshot={folders:{id:number;kind:string;name:string}[];mails:{id:number;subject:string;attachments:{path:string;name:string}[]}[];settings:{Signature:string}};
async function waitMail(c:Client,subject:string){for(let i=0;i<45;i++){const s=await c.call<Snapshot>('snapshot');const m=s.mails.find(m=>m.subject===subject);if(m)return m;await new Promise(r=>setTimeout(r,1000));}throw Error('Доставка не подтверждена за 45 секунд.');}
test('MIME drafts persist files and HTML, replace atomically and send after reopen',{timeout:150000},async()=>{
  const suffix=Date.now().toString(36),name='draft'+suffix,foreignName='foreign'+suffix,address=name+'@localhost',password='mailstack-local-only-2026';
  const admin=new Client('admin');await admin.login({password:'moxadmin'});await admin.call('accounts',{account:name,address,password});await admin.call('accounts',{account:foreignName,address:foreignName+'@localhost',password});
  try{
    const user=new Client('mail'),foreign=new Client('mail');await user.login({username:address,password});await foreign.login({username:foreignName+'@localhost',password});
    const folders=(await user.call<Snapshot>('snapshot')).folders,drafts=folders.find(f=>f.kind==='drafts')!.id,inbox=folders.find(f=>f.kind==='inbox')!.id;
    const binary=Buffer.from(Array.from({length:16384},(_,i)=>i%256)),csv=Buffer.from('имя,значение\r\nтест,✓\r\n');
    const files=[{name:'данные.bin',type:'application/octet-stream',data:binary.toString('base64')},{name:'документ.csv',type:'text/csv',data:csv.toString('base64')},{name:'пустой.txt',type:'text/plain',data:''}];
    const value={to:address,cc:'',bcc:'',subject:'MIME draft '+suffix,text:'Текст черновика',html:'<p><strong>Оформление</strong> черновика</p>',files,folder:drafts};
    let id=(await user.call<{id:number}>('draft',value)).id;
    type Opened={hasHTML:boolean;attachments:{name:string;path:string;size:number}[]};
    async function check(id:number,expected:typeof files){
      const message=await user.call<Opened>('message/'+id);assert.equal(message.hasHTML,true);assert.deepEqual(message.attachments.map(f=>f.name),expected.map(f=>f.name));
      for(const attachment of message.attachments){const file=expected.find(f=>f.name===attachment.name)!;const response=await user.response('attachment/'+id+'/'+attachment.path);assert.equal(response.status,200);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),createHash('sha256').update(Buffer.from(file.data,'base64')).digest('hex'));}
      assert.match((await user.call<{html:string}>('draft/'+id+'/html')).html,/<strong>Оформление<\/strong>/);
    }
    await check(id,files);
    assert.equal((await foreign.response('draft/'+id+'/html')).status,400);assert.ok([400,404].includes((await foreign.response('message/'+id)).status));
    assert.equal((await user.response('draft',{...value,draftId:id,folder:inbox})).status,400);await check(id,files);
    assert.equal((await user.response('draft',{...value,draftId:id,files:[{...files[0],data:'invalid!'}]})).status,400);await check(id,files);
    await admin.call('accounts/quota',{account:name,quota:1});const failed=await user.response('draft',{...value,draftId:id});assert.equal(failed.status,400);await admin.call('accounts/quota',{account:name,quota:0});await check(id,files);
    const edited=[files[0],{name:'новый.txt',type:'text/plain',data:Buffer.from('Новая версия').toString('base64')}];
    const previous=id;id=(await user.call<{id:number}>('draft',{...value,draftId:id,files:edited,forward:true})).id;
    assert.ok([400,404].includes((await user.response('message/'+previous)).status));assert.equal((await user.call<Snapshot>('snapshot?folder='+drafts)).mails.length,1);await check(id,edited);assert.equal((await user.call<{forward:boolean}>('draft/'+id+'/html')).forward,true);
    await user.call('send',{...value,draftId:id,files:edited,forward:true});assert.equal((await user.call<Snapshot>('snapshot?folder='+drafts)).mails.length,0);
    const received=await waitMail(user,value.subject);const sent=await user.call<Opened>('message/'+received.id);assert.equal(sent.hasHTML,true);assert.deepEqual(sent.attachments.map(f=>f.name),edited.map(f=>f.name));
    for(const attachment of sent.attachments){const file=edited.find(f=>f.name===attachment.name)!;const response=await user.response('attachment/'+received.id+'/'+attachment.path);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),createHash('sha256').update(Buffer.from(file.data,'base64')).digest('hex'));}
    // Exercise the advertised maximum through both native draft MIME and Send.
    const maximum=Buffer.alloc(15*1024*1024).fill(Buffer.from([0,1,127,255]));
    const maximumFiles=[{name:'maximum.bin',type:'application/octet-stream',data:maximum.toString('base64')}];
    const maximumValue={...value,subject:value.subject+' maximum',files:maximumFiles};
    const maximumID=(await user.call<{id:number}>('draft',maximumValue)).id;await check(maximumID,maximumFiles);
    await user.call('send',{...maximumValue,draftId:maximumID});const maximumReceived=await waitMail(user,maximumValue.subject);
    const maximumResponse=await user.response('attachment/'+maximumReceived.id+'/'+maximumReceived.attachments[0].path);assert.equal(maximumResponse.status,200);assert.equal(createHash('sha256').update(Buffer.from(await maximumResponse.arrayBuffer())).digest('hex'),createHash('sha256').update(maximum).digest('hex'));
  }finally{for(const account of [name,foreignName])await admin.call('accounts/remove',{account,confirm:account});await admin.call('logout',{});}
});
test('real Mox: accounts, send/HTML/file/reply, folders, search, draft, settings and isolation',{timeout:150000},async()=>{
  const suffix=Date.now().toString(36),password='mailstack-local-only-2026';const aName='a'+suffix,bName='b'+suffix,aAddress=aName+'@localhost',bAddress=bName+'@localhost';
  const admin=new Client('admin');await admin.login({password:'moxadmin'});
  await admin.call('accounts',{account:aName,address:aAddress,password});await admin.call('accounts',{account:bName,address:bAddress,password});
  const a=new Client('mail'),b=new Client('mail');await a.login({username:aAddress,password});await b.login({username:bAddress,password});
  assert.equal((await a.response('send',{},{'x-mailstack-csrf':'bad'})).status,403);
  assert.equal((await a.response('send',{},{origin:'https://evil.test'})).status,403);
  const foreignAdmin=await fetch(base+'/api/admin/accounts',{headers:{cookie:a.cookie}});assert.equal(foreignAdmin.status,401);
  const subject='Проверка API '+suffix,file=Buffer.from('MailStack attachment ✓\n'+suffix);
  await a.call('send',{to:bAddress,cc:'',bcc:'',subject,text:'Здравствуйте '+suffix,html:'<p>Здравствуйте <strong>'+suffix+'</strong></p><img src="https://example.test/track">',files:[{name:'вложение.bin',type:'application/octet-stream',data:file.toString('base64')}]});
  const received=await waitMail(b,subject);const opened=await b.call<{texts:string[];hasHTML:boolean}>('message/'+received.id);assert.equal(opened.hasHTML,true);assert.match(opened.texts.join(' '),new RegExp(suffix));
  const sent=await a.call<Snapshot>('snapshot?folder='+(await a.call<Snapshot>('snapshot')).folders.find(f=>f.kind==='sent')!.id);assert.ok(sent.mails.some(m=>m.subject===subject));
  const downloaded=await b.response('attachment/'+received.id+'/'+received.attachments[0].path);assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-disposition')||'',/attachment/);assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'),createHash('sha256').update(file).digest('hex'));
  const html=await b.response('message/'+received.id+'/html');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy')||'',/default-src 'none'/);assert.match(html.headers.get('content-security-policy')||'',/img-src data:;/);
  const foreignDraft=await a.call<{id:number}>('draft',{to:aAddress,subject:'Private '+suffix,text:'A private draft',html:'',files:[],folder:(await a.call<Snapshot>('snapshot')).folders.find(f=>f.kind==='drafts')!.id});
  assert.ok([400,404].includes((await b.response('message/'+foreignDraft.id)).status));
  const search=await b.call<Snapshot>('snapshot?q='+encodeURIComponent('subject:"'+subject+'"'));assert.ok(search.mails.some(m=>m.id===received.id));
  await b.call('flags',{ids:[received.id],flag:'\\seen',enabled:true});await b.call('flags',{ids:[received.id],flag:'\\flagged',enabled:true});
  await b.call('send',{to:aAddress,subject:'Re: '+subject,text:'Ответ '+suffix,html:'',cc:'',bcc:'',files:[],replyToId:received.id});await waitMail(a,'Re: '+subject);
  await b.call('folders',{name:'Проверка '+suffix});const folders=(await b.call<Snapshot>('snapshot')).folders;const folder=folders.find(f=>f.name==='Проверка '+suffix)!;
  await b.call('move',{ids:[received.id],folder:folder.id});assert.ok((await b.call<Snapshot>('snapshot?folder='+folder.id)).mails.some(m=>m.id===received.id));
  await b.call('folders/rename',{id:folder.id,name:'Переименована '+suffix});assert.ok((await b.call<Snapshot>('snapshot')).folders.some(f=>f.id===folder.id&&f.name==='Переименована '+suffix));
  assert.equal((await b.response('folders/delete',{id:folder.id})).status,409);assert.equal((await b.response('message/'+received.id)).status,200);
  assert.equal((await a.response('folders/delete',{id:folder.id})).status,404);assert.equal((await a.response('folders/rename',{id:folder.id,name:'Чужая'})).status,404);
  assert.equal((await b.response('folders/delete',{id:folders.find(f=>f.kind==='sent')!.id})).status,400);
  assert.equal((await b.response('folders/rename',{id:folders.find(f=>f.kind==='inbox')!.id,name:'Запрещено'})).status,400);
  await b.call('folders',{name:'Родитель '+suffix+'/Дочерняя'});const nested=(await b.call<Snapshot>('snapshot')).folders;const parent=nested.find(f=>f.name==='Родитель '+suffix)!,child=nested.find(f=>f.name==='Родитель '+suffix+'/Дочерняя')!;
  assert.equal((await b.response('folders/delete',{id:parent.id})).status,409);await b.call('folders/delete',{id:child.id});await b.call('folders/delete',{id:parent.id});
  await b.call('move',{ids:[received.id],folder:folders.find(f=>f.kind==='trash')!.id});assert.ok((await b.call<Snapshot>('snapshot?folder='+folders.find(f=>f.kind==='trash')!.id)).mails.some(m=>m.id===received.id));
  await b.call('folders/delete',{id:folder.id});assert.ok(!(await b.call<Snapshot>('snapshot')).folders.some(f=>f.id===folder.id));
  const draft=await b.call<{id:number}>('draft',{to:aAddress,cc:'',bcc:'',subject:'Черновик '+suffix,text:'Сохранённый текст',html:'',files:[],folder:folders.find(f=>f.kind==='drafts')!.id});assert.match((await b.call<{texts:string[]}>('message/'+draft.id)).texts.join(' '),/Сохранённый текст/);
  await b.call('settings',{fullName:'Тестовый пользователь',signature:'Подпись '+suffix,showHTML:true});assert.equal((await b.call<Snapshot>('snapshot')).settings.Signature,'Подпись '+suffix);
  await admin.call('aliases',{address:'alias'+suffix+'@localhost',addresses:bAddress});assert.ok((await admin.call<{items:{address:string}[]}>('aliases')).items.some(a=>a.address==='alias'+suffix+'@localhost'));
  await admin.call('accounts/access',{account:bName,disabled:true});const denied=new Client('mail');assert.equal((await denied.response('login',{username:bAddress,password})).status,401);await admin.call('accounts/access',{account:bName,disabled:false});
  await admin.call('aliases/update',{localpart:'alias'+suffix,domain:'localhost',addresses:aAddress+','+bAddress});assert.equal((await admin.call<{items:{address:string;addresses:string[]}[]}>('aliases')).items.find(x=>x.address==='alias'+suffix+'@localhost')!.addresses.length,2);
  await admin.call('aliases/remove',{localpart:'alias'+suffix,domain:'localhost',confirm:'alias'+suffix+'@localhost'});
  await admin.call('accounts/quota',{account:bName,quota:104857600});assert.equal((await admin.call<{items:{name:string;quota:number}[]}>('accounts')).items.find(x=>x.name===bName)!.quota,104857600);await admin.call('accounts/quota',{account:bName,quota:0});
  const testDomain='qa-'+suffix+'.test';await admin.call('domains',{domain:testDomain,account:aName,localpart:'postmaster'});assert.ok((await admin.call<{items:{name:string}[]}>('domains')).items.some(x=>x.name===testDomain));await admin.call('accounts/address/remove',{account:aName,address:'postmaster@'+testDomain,confirm:'postmaster@'+testDomain});await admin.call('domains/remove',{domain:testDomain,confirm:testDomain});
  await b.call('logout',{});assert.equal((await b.response('snapshot')).status,401);await a.call('logout',{});await admin.call('accounts/remove',{account:aName,confirm:aName});await admin.call('accounts/remove',{account:bName,confirm:bName});await admin.call('logout',{});
});

test('native SSE pagination returns 50 messages and a distinct remaining page',{timeout:90000},async()=>{
  const admin=new Client('admin'),user=new Client('mail'),name='page'+Date.now().toString(36),password='mailstack-local-only-2026';await admin.login({password:'moxadmin'});await admin.call('accounts',{account:name,address:name+'@localhost',password});await user.login({username:name+'@localhost',password});
  const folder=(await user.call<Snapshot>('snapshot')).folders.find(f=>f.kind==='drafts')!.id;
  for(let i=0;i<55;i++)await user.call('draft',{to:name+'@localhost',subject:'Страница '+i,text:'Синтетический черновик '+i,html:'',files:[],folder});
  const first=await user.call<Snapshot&{hasMore:boolean;cursor:number}>('snapshot?folder='+folder);assert.equal(first.mails.length,50);assert.equal(first.hasMore,true);
  const second=await user.call<Snapshot&{hasMore:boolean}>('snapshot?folder='+folder+'&cursor='+first.cursor);assert.equal(second.mails.length,5);assert.equal(second.hasMore,false);assert.equal(new Set([...first.mails,...second.mails].map(m=>m.id)).size,55);
  await user.call('logout',{});await admin.call('accounts/remove',{account:name,confirm:name});await admin.call('logout',{});
});
