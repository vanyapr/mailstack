import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, lstatSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomBytes, createHash, timingSafeEqual, ECDH } from 'node:crypto';
import webpush from 'web-push';
import { AppError, object, text } from '../security/validation';

export type Subscription = {endpoint:string;keys:{auth:string;p256dh:string}};
export type Hook = {id:string;secret:string};
type Job = {id:number;endpoint:string;subscription:string;attempts:number;created:number};
const HOUR=3600000;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function validSubscription(value:unknown):Subscription {
  const raw=object(value),keys=object(raw.keys),endpoint=text(raw.endpoint,2048);
  let url:URL;try{url=new URL(endpoint);}catch{throw new AppError(400,'Некорректная подписка браузера.');}
  // Only known browser push services. Never turn a user-supplied URL into SSRF.
  const host=url.hostname;
  const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host)||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com');
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!allowed)throw new AppError(400,'Сервис Push этого браузера не поддерживается.');
  const auth=text(keys.auth,24),p256dh=text(keys.p256dh,88);
  if(!/^[A-Za-z0-9_-]{22}$/.test(auth)||Buffer.from(auth,'base64url').length!==16||!/^[A-Za-z0-9_-]{87}$/.test(p256dh))throw new AppError(400,'Некорректные ключи подписки.');
  try{ECDH.convertKey(Buffer.from(p256dh,'base64url'),'prime256v1');}catch{throw new AppError(400,'Некорректный ключ браузера.');}
  return {endpoint,keys:{auth,p256dh}};
}
export class PushStore {
  readonly db:DatabaseSync;
  readonly vapid:{publicKey:string;privateKey:string};
  constructor(directory:string) {
    if(!isAbsolute(directory))throw new Error('Push directory must be absolute');
    mkdirSync(directory,{recursive:true,mode:0o700});
    if(lstatSync(directory).isSymbolicLink())throw new Error('Push directory cannot be a symlink');
    chmodSync(directory,0o700);
    const path=join(directory,'push.sqlite');
    try{if(lstatSync(path).isSymbolicLink())throw new Error('Push database cannot be a symlink');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    this.db=new DatabaseSync(path);chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hooks (id TEXT PRIMARY KEY,secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (endpoint TEXT PRIMARY KEY,hook TEXT NOT NULL REFERENCES hooks(id),data TEXT NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (hook TEXT NOT NULL,message INTEGER NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(hook,message));
      CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT,endpoint TEXT NOT NULL REFERENCES subscriptions(endpoint) ON DELETE CASCADE,created INTEGER NOT NULL,due INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(due);`);
    const saved=this.db.prepare("SELECT value FROM settings WHERE key='vapid'").get() as {value:string}|undefined;
    this.vapid=saved?JSON.parse(saved.value):webpush.generateVAPIDKeys();
    if(!saved)this.db.prepare("INSERT INTO settings VALUES ('vapid',?)").run(JSON.stringify(this.vapid));
  }
  newHook():Hook {
    if(Number((this.db.prepare('SELECT count(*) AS n FROM hooks').get() as {n:number}).n)>=10000)throw new AppError(503,'Достигнут предел Push-подписок.');
    const hook={id:randomBytes(24).toString('base64url'),secret:randomBytes(32).toString('base64url')};
    this.db.prepare('INSERT INTO hooks VALUES (?,?)').run(hook.id,hook.secret);return hook;
  }
  hook(id:string):Hook|undefined{return this.db.prepare('SELECT id,secret FROM hooks WHERE id=?').get(id) as Hook|undefined;}
  authorize(id:string,authorization:string|null) {
    const hook=this.hook(id),expected=Buffer.from('Bearer '+(hook?.secret||'')),actual=Buffer.from(authorization||'');
    if(!hook||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new AppError(401,'Недопустимый источник события.');
    return hook;
  }
  subscribed(hook:string,endpoint:string) {return !!this.db.prepare('SELECT 1 FROM subscriptions WHERE hook=? AND endpoint=?').get(hook,hash(endpoint));}
  subscribe(hook:string,sub:Subscription) {
    const key=hash(sub.endpoint);
    if(!this.subscribed(hook,sub.endpoint)&&Number((this.db.prepare('SELECT count(*) AS n FROM subscriptions WHERE hook=?').get(hook) as {n:number}).n)>=20)throw new AppError(409,'Для аккаунта уже подключено 20 браузеров.');
    // A browser subscription can belong to only one mailbox. Delete pending jobs
    // on an explicit account switch rather than delivering the previous account.
    this.db.exec('BEGIN IMMEDIATE');
    try{this.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(key);this.db.prepare('INSERT INTO subscriptions VALUES (?,?,?,?)').run(key,hook,JSON.stringify(sub),Date.now());this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  unsubscribe(hook:string,endpoint:string){this.db.prepare('DELETE FROM subscriptions WHERE hook=? AND endpoint=?').run(hook,hash(endpoint));}
  unsubscribeAll(hook:string){this.db.prepare('DELETE FROM subscriptions WHERE hook=?').run(hook);}
  enqueue(hook:string,message:number,now=Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM receipts WHERE created<?').run(now-7*24*HOUR);
      this.db.prepare('DELETE FROM jobs WHERE created<?').run(now-HOUR);
      if(this.db.prepare('SELECT 1 FROM receipts WHERE hook=? AND message=?').get(hook,message)){this.db.exec('COMMIT');return;}
      if(Number((this.db.prepare('SELECT count(*) AS n FROM jobs').get() as {n:number}).n)>=10000)throw new AppError(503,'Очередь уведомлений заполнена.');
      this.db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(hook,message,now);
      this.db.prepare('INSERT INTO jobs(endpoint,created,due) SELECT endpoint,?,? FROM subscriptions WHERE hook=?').run(now,now,hook);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  async deliver(send:(subscription:Subscription)=>Promise<unknown>,now=Date.now()) {
    this.db.prepare('DELETE FROM jobs WHERE created<?').run(now-HOUR);
    const jobs=this.db.prepare('SELECT j.*,s.data AS subscription FROM jobs j JOIN subscriptions s ON s.endpoint=j.endpoint WHERE j.due<=? ORDER BY j.id LIMIT 20').all(now) as Job[];
    for(const job of jobs) {
      // Revocation/rebinding may happen while a previous HTTP send is in flight.
      if(!this.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(job.id))continue;
      try{await send(JSON.parse(job.subscription));this.db.prepare('DELETE FROM jobs WHERE id=?').run(job.id);}
      catch(e){
        if(!this.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(job.id))continue;
        const status=(e as {statusCode?:number}).statusCode;
        if(status===404||status===410)this.db.prepare('DELETE FROM subscriptions WHERE endpoint=? AND data=?').run(job.endpoint,job.subscription);
        else {
          const retry=(e as {headers?:Record<string,string>}).headers?.['retry-after'];
          const requested=retry?(/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-now):0;
          const delay=Math.max(Math.min(900000,15000*2**Math.min(job.attempts,6)),Number.isFinite(requested)?Math.min(HOUR,requested):0);
          this.db.prepare('UPDATE jobs SET attempts=attempts+1,due=? WHERE id=?').run(now+delay,job.id);
        }
      }
    }
  }
}

const global=globalThis as typeof globalThis & {mailstackPushStore?:PushStore};
export const pushEnabled=()=>process.env.MAILSTACK_PUSH_ENABLED==='1'&&!!process.env.MAILSTACK_PUSH_DIR;
export function pushStore(){
  if(!pushEnabled())throw new AppError(503,'Push-уведомления ещё не настроены на сервере.');
  return global.mailstackPushStore ||= new PushStore(process.env.MAILSTACK_PUSH_DIR!);
}
