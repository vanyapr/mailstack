import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { AppError } from '../security/validation';
import type { Credential } from '../mox/client';

export type Role = 'mail' | 'admin';
export type Session = {id:string;role:Role;csrf:string;created:number;used:number;mail?:Credential;account?:Credential;admin?:Credential;username?:string;password?:string};
// One web worker/replica. No mail, passwords or session tokens are written to disk.
const state = globalThis as typeof globalThis & {mailstackSessions?:Map<string,Session>;mailstackLimits?:Map<string,{count:number;reset:number}>};
const sessions = state.mailstackSessions ||= new Map<string,Session>();
const limits = state.mailstackLimits ||= new Map<string,{count:number;reset:number}>();
export function appOrigin() {
  const url = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:3100');
  const local = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol!=='https:' && !(local && process.env.MAILSTACK_LOCAL==='1'))) throw new AppError(503,'Для приложения требуется HTTPS.');
  return url.origin;
}
export function cookieName(role:Role) { return (appOrigin().startsWith('https:')?'__Host-':'')+'mailstack-'+role; }
export function sessionCookie(role:Role,id:string, clear=false) {
  return `${cookieName(role)}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:28800}${appOrigin().startsWith('https:')?'; Secure':''}`;
}
function sweep() {
  const now=Date.now(); for (const [id,s] of sessions) if(now-s.created>28800000 || now-s.used>1800000) sessions.delete(id);
  for(const [key,l] of limits) if(l.reset<=now) limits.delete(key);
}
export function createSession(role:Role, props:Partial<Session>) {
  sweep(); if(sessions.size>=1000) throw new AppError(503,'Слишком много активных сессий.');
  const session:Session={...props,id:randomBytes(32).toString('base64url'),role,csrf:randomBytes(32).toString('base64url'),created:Date.now(),used:Date.now()};
  sessions.set(session.id,session); return session;
}
export function getSession(request:Request,role:Role):Session {
  sweep(); const name=cookieName(role)+'=';
  const id=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name))?.slice(name.length);
  const session = id ? sessions.get(id):undefined;
  if(!session || session.role!==role) throw new AppError(401,'Войдите в аккаунт.');
  session.used=Date.now();return session;
}
export function destroy(session:Session){ sessions.delete(session.id); session.password=undefined; }
export function sameOrigin(request:Request) {
  if(request.headers.get('origin')!==appOrigin() || request.headers.get('sec-fetch-site')==='cross-site') throw new AppError(403,'Недопустимый источник запроса.');
}
export function csrf(request:Request,session:Session) {
  sameOrigin(request); const a=Buffer.from(request.headers.get('x-mailstack-csrf')||''); const b=Buffer.from(session.csrf);
  if(a.length!==b.length || !timingSafeEqual(a,b)) throw new AppError(403,'Проверка безопасности не пройдена. Обновите страницу.');
}
export function limitLogin(request:Request,identity:string) {
  sweep(); const ip=process.env.TRUST_NGINX==='1'?(request.headers.get('x-real-ip')||'unknown'):'local';
  // The local Compose fixture seeds several synthetic accounts through the same BFF.
  // It is already limited to loopback HTTP by appOrigin(), so it can use a wider
  // in-memory window without weakening the HTTPS production limits below.
  const localFixture=process.env.MAILSTACK_LOCAL==='1';
  const globalLimit=localFixture?1000:100,ipLimit=localFixture?100:10;
  const keys=['all',ip,createHash('sha256').update(identity.toLowerCase()).digest('hex')];
  for(const [i,key] of keys.entries()) {
    let l=limits.get(key); if(!l || l.reset<Date.now()){l={count:0,reset:Date.now()+60000};limits.set(key,l);}
    if(l.count>=(i===0?globalLimit:ipLimit)) throw new AppError(429,'Слишком много попыток входа. Подождите минуту.');
    l.count++;
  }
  if(limits.size>10000) throw new AppError(429,'Слишком много попыток входа.');
}
export function json(data:unknown,status=200,headers:Record<string,string>={}) {
  return Response.json(data,{status,headers:{'cache-control':'no-store',...headers}});
}
export function failure(e:unknown) {
  const error=e instanceof AppError?e:new AppError(500,'Не удалось выполнить действие.');
  return json({error:error.message},error.status,error.status===429?{'retry-after':'60'}:{});
}
