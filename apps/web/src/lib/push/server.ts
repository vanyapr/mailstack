import webpush from 'web-push';
import { accountClient } from '../mox/client';
import type { Session } from '../auth/session';
import { appOrigin } from '../auth/session';
import { AppError } from '../security/validation';
import { pushStore, validSubscription, pushEnabled, type Hook } from './store';

export const hookURL=(id:string)=>appOrigin()+'/api/push/incoming/'+id;
// All aliases of an account share Mox's IncomingWebhook. Serialize first-time
// provisioning so two aliases cannot replace each other's freshly created hook.
const state=globalThis as typeof globalThis & {mailstackPushLock?:Promise<unknown>;mailstackPushTimer?:ReturnType<typeof setInterval>;mailstackPushRunning?:boolean};
async function locked<T>(fn:()=>Promise<T>):Promise<T>{const pending=(state.mailstackPushLock||Promise.resolve()).then(fn);state.mailstackPushLock=pending.catch(()=>undefined);return pending;}
async function accountHook(session:Session,create=false):Promise<Hook|undefined> {
  const store=pushStore(),client=accountClient(session.account),[account]=await client.call('Account');
  const existing=account.IncomingWebhook;
  if(existing?.URL) {
    const prefix=appOrigin()+'/api/push/incoming/';
    if(existing.URL.startsWith(prefix)) {
      const id=existing.URL.slice(prefix.length),hook=store.hook(id);
      if(hook&&existing.Authorization==='Bearer '+hook.secret)return hook;
    }
    if(!create)return;
    throw new AppError(409,'Для аккаунта уже настроен другой обработчик входящей почты. Подключение Push требует настройки администратора.');
  }
  if(!create)return;
  const hook=store.newHook();
  // Keep the record even on an ambiguous network failure: Mox may have applied
  // the change. A retry discovers the same hook from its native account config.
  await client.call('IncomingWebhookSave',hookURL(hook.id),'Bearer '+hook.secret);
  return hook;
}
export async function pushStatus(session:Session,endpoint='') {
  if(!pushEnabled())return {available:false,enabled:false,publicKey:''};
  const hook=await accountHook(session);
  return {available:true,enabled:!!hook&&!!endpoint&&pushStore().subscribed(hook.id,endpoint),publicKey:pushStore().vapid.publicKey};
}
export async function subscribe(session:Session,value:unknown) {
  const sub=validSubscription(value);
  return locked(async()=>{const hook=await accountHook(session,true);pushStore().subscribe(hook!.id,sub);startPushWorker();return {enabled:true};});
}
export async function unsubscribe(session:Session,endpoint:string) {
  if(!pushEnabled()||!endpoint)return;
  const hook=await accountHook(session);if(hook)pushStore().unsubscribe(hook.id,endpoint);
}
export async function revokeAccountPush(session:Session) {
  if(!pushEnabled())return;
  const hook=await accountHook(session);if(hook)pushStore().unsubscribeAll(hook.id);
}
export function startPushWorker() {
  if(!pushEnabled()||state.mailstackPushTimer)return;
  // Open the durable store before reporting readiness. Disk errors fail startup.
  pushStore();
  const tick=async()=>{
    if(state.mailstackPushRunning)return;state.mailstackPushRunning=true;
    try{const store=pushStore();await store.deliver(sub=>webpush.sendNotification(sub,JSON.stringify({title:'MailStack',body:'У вас новое письмо во «Входящих».',url:'/mail'}),{vapidDetails:{...store.vapid,subject:appOrigin()},TTL:3600,urgency:'normal',topic:'mailstack-inbox',timeout:10000}));}
    catch{console.error('MailStack: Push queue processing failed.');}
    finally{state.mailstackPushRunning=false;}
  };
  state.mailstackPushTimer=setInterval(()=>void tick(),15000);state.mailstackPushTimer.unref();void tick();
}
