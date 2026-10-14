import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import webpush from 'web-push';
import { PushStore, validSubscription, pushEnabled } from '../src/lib/push/store';
import { subscribe, unsubscribe, pushStatus } from '../src/lib/push/server';
import { createSession, sessionCookie } from '../src/lib/auth/session';
import { POST as mailPOST } from '../src/app/api/mail/[...path]/route';
import { POST as incoming } from '../src/app/api/push/incoming/[id]/route';

const subscription=(suffix='one')=>{const ec=createECDH('prime256v1');ec.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/'+suffix,keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};};
async function withStore(fn:(store:PushStore,directory:string)=>Promise<void>){const dir=mkdtempSync(join(tmpdir(),'mailstack-push-test-')),store=new PushStore(dir);try{await fn(store,dir);}finally{store.db.close();rmSync(dir,{recursive:true,force:true});}}
test('subscription validation prevents SSRF and rejects invalid encryption keys',()=>{
  const sub=subscription();assert.deepEqual(validSubscription(sub),sub);
  for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://fcm.googleapis.com:8443/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com/a#x'])assert.throws(()=>validSubscription({...sub,endpoint}));
  assert.throws(()=>validSubscription({...sub,keys:{...sub.keys,auth:'x'}}));
  assert.throws(()=>validSubscription({...sub,keys:{...sub.keys,p256dh:'x'.repeat(87)}}));
});
test('outbound notification uses encrypted Web Push and VAPID without making a network request',()=>{
  const keys=webpush.generateVAPIDKeys(),payload='У вас новое письмо во «Входящих».';
  const request=webpush.generateRequestDetails(subscription(),payload,{vapidDetails:{...keys,subject:'https://mail.example.test'},TTL:3600});
  assert.equal(request.headers['Content-Encoding'],'aes128gcm');assert.match(String(request.headers.Authorization),/^vapid /);assert.equal(request.headers.TTL,3600);
  assert.ok(request.body instanceof Buffer);assert.equal(request.body.includes(Buffer.from(payload)),false);
});
test('durable subscriptions, keys, queue and deduplication survive a fresh database connection',async()=>withStore(async(store,dir)=>{
  const hook=store.newHook(),sub=subscription();store.subscribe(hook.id,sub);store.enqueue(hook.id,42);store.enqueue(hook.id,42);
  const reopened=new PushStore(dir);
  try{assert.deepEqual(reopened.vapid,store.vapid);assert.equal(reopened.subscribed(hook.id,sub.endpoint),true);let sent=0;await reopened.deliver(async value=>{assert.deepEqual(value,sub);sent++;});assert.equal(sent,1);await reopened.deliver(async()=>{sent++;});assert.equal(sent,1);}finally{reopened.db.close();}
}));
test('cross-account unsubscribe is ignored; explicit browser rebinding cancels old queued mail',async()=>withStore(async store=>{
  const a=store.newHook(),b=store.newHook(),sub=subscription();store.subscribe(a.id,sub);store.enqueue(a.id,1);store.unsubscribe(b.id,sub.endpoint);assert.equal(store.subscribed(a.id,sub.endpoint),true);
  store.subscribe(b.id,sub);assert.equal(store.subscribed(a.id,sub.endpoint),false);let count=0;await store.deliver(async()=>{count++;});assert.equal(count,0);store.enqueue(a.id,2);store.enqueue(b.id,3);await store.deliver(async()=>{count++;});assert.equal(count,1);
}));
test('transient errors retry; gone endpoints revoke; old events expire',async()=>withStore(async store=>{
  const hook=store.newHook(),sub=subscription(),now=Date.now();store.subscribe(hook.id,sub);store.enqueue(hook.id,1,now);
  await store.deliver(async()=>{throw {statusCode:503};},now);let sent=0;await store.deliver(async()=>{sent++;},now+14999);assert.equal(sent,0);await store.deliver(async()=>{sent++;},now+15000);assert.equal(sent,1);
  store.enqueue(hook.id,2,now);await store.deliver(async()=>{throw {statusCode:410};},now);assert.equal(store.subscribed(hook.id,sub.endpoint),false);
  store.subscribe(hook.id,sub);store.enqueue(hook.id,3,now);await store.deliver(async()=>{sent++;},now+3600001);assert.equal(sent,1);
}));
test('rate-limited delivery honors the provider Retry-After delay',async()=>withStore(async store=>{
  const hook=store.newHook(),sub=subscription(),now=Date.now();store.subscribe(hook.id,sub);store.enqueue(hook.id,1,now);
  await store.deliver(async()=>{throw {statusCode:429,headers:{'retry-after':'120'}};},now);
  let sent=0;await store.deliver(async()=>{sent++;},now+119999);assert.equal(sent,0);await store.deliver(async()=>{sent++;},now+120000);assert.equal(sent,1);
}));
test('revoking while delivery is in flight cannot delete a replacement account job',async()=>withStore(async store=>{
  const a=store.newHook(),b=store.newHook(),sub=subscription();store.subscribe(a.id,sub);store.enqueue(a.id,1);
  await store.deliver(async()=>{store.unsubscribe(a.id,sub.endpoint);store.subscribe(b.id,sub);store.enqueue(b.id,2);});
  let sent=0;await store.deliver(async()=>{sent++;});assert.equal(sent,1);
}));
test('an expired in-flight send cannot revoke a newly rebound subscription',async()=>withStore(async store=>{
  const a=store.newHook(),b=store.newHook(),sub=subscription();store.subscribe(a.id,sub);store.enqueue(a.id,1);
  await store.deliver(async()=>{store.unsubscribe(a.id,sub.endpoint);store.subscribe(b.id,sub);store.enqueue(b.id,2);throw {statusCode:410};});
  assert.equal(store.subscribed(b.id,sub.endpoint),true);let sent=0;await store.deliver(async()=>{sent++;});assert.equal(sent,1);
}));
test('authenticated BFF provisioning preserves existing webhooks, protects CSRF, deduplicates Inbox events and revokes logout',async()=>{
  process.env.MAILSTACK_LOCAL='1';process.env.APP_ORIGIN='http://127.0.0.1:3100';
  const directory=mkdtempSync(join(tmpdir(),'mailstack-push-api-test-'));process.env.MAILSTACK_PUSH_DIR=directory;process.env.MAILSTACK_PUSH_ENABLED='1';
  const global=globalThis as typeof globalThis&{mailstackPushStore?:PushStore;mailstackPushTimer?:ReturnType<typeof setInterval>};
  // Keep real browser services untouched. Delivery behavior is tested above.
  global.mailstackPushTimer=setInterval(()=>{},60000);global.mailstackPushTimer.unref();
  let config:{URL:string;Authorization:string}|null=null;const original=fetch;
  globalThis.fetch=async (url,init)=>{const method=String(url).split('/').at(-1),params=JSON.parse(String(init?.body)).params;if(method==='Account')return Response.json({result:[{IncomingWebhook:config},0,0,[]]});if(method==='IncomingWebhookSave')config={URL:params[0],Authorization:params[1]};return Response.json({result:null});};
  const session=createSession('mail',{username:'fixture@localhost',mail:{cookie:'',csrf:''},account:{cookie:'',csrf:''}}),sub=subscription();
  const headers={'content-type':'application/json',origin:process.env.APP_ORIGIN,'x-mailstack-csrf':session.csrf,cookie:sessionCookie('mail',session.id).split(';')[0]};
  const request=(key:string,data:unknown,extra={})=>mailPOST(new Request('http://127.0.0.1:3100/api/mail/'+key,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)}),{params:Promise.resolve({path:key.split('/')})});
  try {
    config={URL:'https://existing.example/hook',Authorization:'existing'};
    await assert.rejects(subscribe(session,sub),/другой обработчик/);assert.equal(config.URL,'https://existing.example/hook');config=null;
    assert.equal((await request('push',{action:'subscribe',subscription:sub},{'x-mailstack-csrf':'wrong'})).status,403);
    assert.equal((await request('push',{action:'subscribe',subscription:sub},{cookie:''})).status,401);
    assert.equal((await request('push',{action:'subscribe',subscription:sub})).status,200);
    assert.equal((await pushStatus(session,sub.endpoint)).enabled,true);
    const hook=config as unknown as {URL:string;Authorization:string},id=hook.URL.split('/').at(-1)!;
    const event=(mailbox='Inbox',auth=hook.Authorization)=>incoming(new Request(hook.URL,{method:'POST',headers:{'content-type':'application/json',authorization:auth},body:JSON.stringify({Version:0,Subject:'PRIVATE-MAIL-SUBJECT',Text:'PRIVATE-MAIL-BODY',Meta:{MsgID:42,MailboxName:mailbox}})}),{params:Promise.resolve({id})});
    assert.equal((await event('Inbox','wrong')).status,401);assert.equal((await event('Junk')).status,200);let sent=0;await global.mailstackPushStore!.deliver(async()=>{sent++;});assert.equal(sent,0);
    assert.equal((await event()).status,200);assert.equal((await event()).status,200);await global.mailstackPushStore!.deliver(async()=>{sent++;});assert.equal(sent,1);
    assert.equal(readFileSync(join(directory,'push.sqlite')).includes(Buffer.from('PRIVATE-MAIL')),false);
    assert.equal((await request('logout',{pushEndpoint:sub.endpoint})).status,200);assert.equal(global.mailstackPushStore!.subscribed(id,sub.endpoint),false);
  }finally{globalThis.fetch=original;clearInterval(global.mailstackPushTimer);delete global.mailstackPushTimer;global.mailstackPushStore?.db.close();delete global.mailstackPushStore;delete process.env.MAILSTACK_PUSH_DIR;delete process.env.MAILSTACK_PUSH_ENABLED;rmSync(directory,{recursive:true,force:true});}
});
test('service worker displays neutral notification with no page and opens only same-origin mail',async()=>{
  const handlers:Record<string,(event:unknown)=>void>={},shown:unknown[]=[],opened:string[]=[];let task:Promise<unknown>|undefined;
  const self={location:{origin:'https://mail.example.test'},addEventListener:(type:string,handler:(event:unknown)=>void)=>{handlers[type]=handler;},registration:{showNotification:async(title:string,options:unknown)=>{shown.push({title,options});}},clients:{matchAll:async()=>[],openWindow:async(url:string)=>{opened.push(url);}}};
  runInNewContext(readFileSync(new URL('../public/mail-push-sw.js',import.meta.url),'utf8'),{self,URL});
  handlers.push({data:{json:()=>({title:'Injected',url:'https://evil.test',body:'PRIVATE'})},waitUntil:(promise:Promise<unknown>)=>{task=promise;}});await task;
  assert.equal(JSON.stringify(shown).includes('PRIVATE'),false);assert.equal(JSON.stringify(shown).includes('новое письмо'),true);
  handlers.notificationclick({notification:{close(){},data:{url:'https://evil.test'}},waitUntil:(promise:Promise<unknown>)=>{task=promise;}});await task;assert.deepEqual(opened,['/mail']);
});

test('Push stays disabled with a directory but without explicit opt-in',async()=>{
  const previous={directory:process.env.MAILSTACK_PUSH_DIR,enabled:process.env.MAILSTACK_PUSH_ENABLED};
  try{process.env.MAILSTACK_PUSH_DIR='/not-opened-by-disabled-push';delete process.env.MAILSTACK_PUSH_ENABLED;assert.equal(pushEnabled(),false);assert.deepEqual(await pushStatus(createSession('mail',{})),{available:false,enabled:false,publicKey:''});process.env.MAILSTACK_PUSH_ENABLED='0';assert.equal(pushEnabled(),false);process.env.MAILSTACK_PUSH_ENABLED='1';assert.equal(pushEnabled(),true);}
  finally{if(previous.directory===undefined)delete process.env.MAILSTACK_PUSH_DIR;else process.env.MAILSTACK_PUSH_DIR=previous.directory;if(previous.enabled===undefined)delete process.env.MAILSTACK_PUSH_ENABLED;else process.env.MAILSTACK_PUSH_ENABLED=previous.enabled;}
});
