import test from 'node:test';
import {webAPI} from '../src/lib/mox/client';
import assert from 'node:assert/strict';
import { object, text, email, filename, ids, identifier, body } from '../src/lib/security/validation';
import { queryRequest, events, composition } from '../src/lib/mox/mail';
import { createSession, getSession, destroy, csrf, sessionCookie, sameOrigin, limitLogin } from '../src/lib/auth/session';

process.env.MAILSTACK_LOCAL='1';process.env.APP_ORIGIN='http://127.0.0.1:3100';
test('rejects invalid identifiers, nested path filenames and injected addresses',()=>{
  for(const v of [-1,0,1.2,'-1','1e2',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>identifier(v));
  for(const v of ['../data','a\\b','a\r\n.txt','..'])assert.throws(()=>filename(v));
  for(const v of ['x@y\r\nBcc:a@b','x@y,another@b','<a@b>'])assert.throws(()=>email(v));
  assert.deepEqual(ids([1,1,2]),[1,2]);assert.throws(()=>ids([]));assert.throws(()=>object([]));assert.throws(()=>text('x\0y'));
});
test('sessions have separate role cookies and exact origin/CSRF protection',()=>{
  const mail=createSession('mail',{username:'a@localhost'}),admin=createSession('admin',{});
  const headers={cookie:sessionCookie('mail',mail.id).split(';')[0],origin:process.env.APP_ORIGIN!,'x-mailstack-csrf':mail.csrf};
  const request=new Request('http://127.0.0.1:3100/api/mail/move',{method:'POST',headers});
  assert.equal(getSession(request,'mail').id,mail.id);assert.throws(()=>getSession(request,'admin'));csrf(request,mail);
  assert.throws(()=>csrf(new Request(request,{headers:{...headers,'x-mailstack-csrf':'invalid'}}),mail));
  assert.throws(()=>sameOrigin(new Request(request,{headers:{...headers,origin:'https://evil.test'}})));
  process.env.APP_ORIGIN='https://mail.example.test';assert.match(sessionCookie('admin',admin.id),/__Host-mailstack-admin=.*HttpOnly.*SameSite=Strict.*Secure/);process.env.APP_ORIGIN='http://127.0.0.1:3100';
  destroy(mail);destroy(admin);assert.throws(()=>getSession(request,'mail'));
});
test('production login throttling remains strict outside the local fixture',()=>{
  const previous=process.env.MAILSTACK_LOCAL;delete process.env.MAILSTACK_LOCAL;
  try {
    const request=new Request('https://mail.example.test/api/mail/login');const identity='rate-limit-'+Date.now()+'@example.test';
    for(let i=0;i<10;i++)limitLogin(request,identity);
    assert.throws(()=>limitLogin(request,identity),/Слишком много попыток/);
  } finally {process.env.MAILSTACK_LOCAL=previous;}
});
test('body limit applies to streamed data, not only content-length',async()=>{
  const req=new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:'x'.repeat(100)})});
  await assert.rejects(body(req,20),/размер/);
  await assert.rejects(body(new Request('http://localhost',{method:'POST',body:'{}'})),/JSON/);
});
test('native search preserves fields and dates and bounds page size',()=>{
  const q=queryRequest(new URL('http://local/?q=from:a%40localhost+subject:%22новая+тема%22+after:2026-01-01+text&folder=all&cursor=12'));
  assert.deepEqual(q.Query.Filter.From,['a@localhost']);assert.deepEqual(q.Query.Filter.Subject,['новая тема']);assert.deepEqual(q.Query.Filter.Words,['text']);assert.equal(q.Query.Filter.MailboxID,-1);assert.equal(q.Page.Count,50);assert.equal(q.Page.AnchorMessageID,12);
  assert.throws(()=>queryRequest(new URL('http://local/?q=after:bad')));
});
test('SSE parser joins split chunks/multiline data and releases the stream',async()=>{
  const bytes=new TextEncoder().encode(': keepalive\n\nevent: start\ndata: {"value":\ndata: "почта"}\n\nevent: viewMsgs\ndata: {"ViewEnd":true}\n\n');
  let offset=0;const stream=new ReadableStream<Uint8Array>({pull(c){if(offset<bytes.length){c.enqueue(bytes.slice(offset,offset+3));offset+=3;}else c.close();}});
  const list=[];for await(const frame of events(stream))list.push(frame);
  assert.deepEqual(list,[{event:'start',data:{value:'почта'}},{event:'viewMsgs',data:{ViewEnd:true}}]);
});
test('compose rejects header injection and malformed or oversized attachments',()=>{
  const valid={to:'a@localhost',subject:'Тест',text:'Почта',files:[]};assert.equal(composition(valid).subject,'Тест');
  assert.throws(()=>composition({...valid,subject:'x\r\nBcc: y@localhost'}));
  assert.throws(()=>composition({...valid,files:[{name:'x',type:'text/plain',data:'not-base64!'}]}));
  assert.throws(()=>composition({...valid,files:[{name:'../x',type:'text/plain',data:''}]}));
});
test('compose accepts large base64 attachments through the 15 MiB limit',()=>{
  for(const size of [8654*1024,15*1024*1024]){
    const data=Buffer.alloc(size,42).toString('base64');
    const result=composition({to:'a@localhost',subject:'Large fixture',text:'',files:[{name:'fixture.bin',type:'application/octet-stream',data}]});
    assert.equal(result.files[0].data,data);assert.equal(Buffer.byteLength(result.files[0].data,'base64'),size);
  }
});
test('compose keeps strict base64 validation and the aggregate attachment limit',()=>{
  const compose=(data:string)=>composition({to:'a@localhost',subject:'Fixture',text:'',files:[{name:'fixture.bin',type:'application/octet-stream',data}]});
  for(const data of ['', 'AA==','AAA=','AAAA'])assert.doesNotThrow(()=>compose(data));
  for(const data of ['A','AA','AAA','A===','AA=A','AA==AAAA','AAAA====','AAAA\n','AAAA✓'])assert.throws(()=>compose(data),/Повреждено вложение/);
  const data=Buffer.alloc(8*1024*1024,42).toString('base64');
  assert.throws(()=>composition({to:'a@localhost',subject:'Fixture',text:'',files:[{name:'one.bin',data},{name:'two.bin',data}]}),/15 МБ/);
});

test('SSE parses CRLF boundaries split across single-byte chunks',async()=>{
  const bytes=new TextEncoder().encode('event: start\r\ndata: {"ok":true}\r\n\r\n');let i=0;const stream=new ReadableStream<Uint8Array>({pull(c){if(i<bytes.length)c.enqueue(bytes.slice(i,++i));else c.close();}});const result=[];for await(const event of events(stream))result.push(event);assert.deepEqual(result,[{event:'start',data:{ok:true}}]);
});

test('send server failures and malformed success stay ambiguous, never report fake success',async()=>{
  const original=globalThis.fetch;try{
    for(const [status,value] of [[500,{Code:'server'}],[200,{}],[200,null]] as const){globalThis.fetch=async()=>Response.json(value,{status});await assert.rejects(webAPI('fixture@localhost','synthetic','Send',{}),/не подтверждён/);}
  }finally{globalThis.fetch=original;}
});
test('send uses Mox binary multipart attachments and keeps metadata in request',async()=>{
  const original=globalThis.fetch,bytes=Buffer.from([0,1,255,13,10]);
  try{
    globalThis.fetch=async(_url,options)=>{
      assert.ok(options?.body instanceof FormData);const form=options.body;
      assert.deepEqual(JSON.parse(String(form.get('request'))),{Subject:'Тест',SaveSent:true});
      const file=form.get('attachedfile') as File;assert.equal(file.name,'тест.bin');assert.equal(file.type,'application/octet-stream');assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
      return Response.json({MessageID:'fixture@localhost'});
    };
    await webAPI('fixture@localhost','synthetic','Send',{Subject:'Тест',SaveSent:true,AttachedFiles:[{Name:'тест.bin',ContentType:'application/octet-stream',Data:bytes.toString('base64')}]});
  }finally{globalThis.fetch=original;}
});

// The virtual folder must filter on the server before pagination/SSE.
test('marked mail searches all folders with the native flag and keeps search/cursor',()=>{
  const q=queryRequest(new URL('http://local/?folder=flagged&q=subject:test&cursor=51&asc=1'));
  assert.equal(q.Query.Filter.MailboxID,0);
  assert.equal(q.Query.Filter.MailboxName,'');
  assert.deepEqual(q.Query.Filter.Labels,['\\flagged']);
  assert.deepEqual(q.Query.Filter.Subject,['test']);
  assert.equal(q.Page.AnchorMessageID,51);
  assert.equal(q.Query.OrderAsc,true);
});
