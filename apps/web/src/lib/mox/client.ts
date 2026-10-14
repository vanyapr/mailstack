import { AppError } from '../security/validation';
import type { ComposeMessage, Methods as UpstreamMail } from './upstream/webmail';
import type { Methods as Admin } from './upstream/webadmin';
import type { Methods as Account } from './upstream/webaccount';

// Local source6 extensions; keep upstream generated declarations unchanged.
type Mail = UpstreamMail & {MailboxDeleteEmpty(mailboxID:number):Promise<void>;MessageComposeRich(message:ComposeMessage,mailboxID:number,html:string,files:{Filename:string;ContentType:string;Data:string}[],forward:boolean):Promise<number>;DraftHTML(id:number):Promise<string>};

type Params<T> = T extends (...args: infer P) => unknown ? P : never;
type Result<T> = T extends (...args: never[]) => Promise<infer R> ? R : never;
export type Kind = 'webmail' | 'webadmin' | 'webaccount';
const paths: Record<Kind,string> = {webmail:'/webmail/',webadmin:'/admin/',webaccount:'/account/'};
export type Credential = {cookie: string; csrf: string};

export function moxOrigin(): string {
  const value = process.env.MOX_ORIGIN || 'http://127.0.0.1:11080';
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new AppError(503,'Некорректная конфигурация Mox.');
  return url.origin;
}

export class RPC<C> {
  credential: Credential;
  constructor(readonly kind: Kind, credential: Credential = {cookie:'',csrf:''}) { this.credential = {...credential}; }
  async call<K extends keyof C & string>(method: K, ...params: Params<C[K]>): Promise<Result<C[K]>> {
    let response: Response;
    try { response = await fetch(moxOrigin()+paths[this.kind]+'api/'+method, {
      method:'POST', headers:{'content-type':'application/json','cookie':this.credential.cookie,'x-mox-csrf':this.credential.csrf},
      body:JSON.stringify({params}), cache:'no-store', redirect:'error', signal:AbortSignal.timeout(20000),
    }); } catch { throw new AppError(502,'Почтовый сервер временно недоступен.'); }
    const cookies = response.headers.getSetCookie();
    for (const raw of cookies) {
      const name = this.kind+'session';
      if (raw.startsWith(name+'=') || (method==='LoginPrep' && raw.startsWith(this.kind+'login='))) this.credential.cookie = raw.split(';',1)[0];
    }
    const payload = await response.json().catch(()=>null) as {error?:{code:string;message:string};result?:Result<C[K]>}|null;
    if (!response.ok || payload?.error) {
      const code = payload?.error?.code || '';
      if (code.includes('noAuth') || code.includes('badAuth')) throw new AppError(401,'Сессия завершена. Войдите снова.');
      if (method === 'Login') throw new AppError(401,'Неверный логин или пароль.');
      if (code.startsWith('user:')) throw new AppError(400,(payload?.error?.message || 'Почтовый сервер отклонил действие.').slice(0,500));
      throw new AppError(502,'Не удалось выполнить запрос к почтовому серверу.');
    }
    if (!payload || !('result' in payload)) throw new AppError(502,'Неподдерживаемый ответ Mox.');
    return payload.result as Result<C[K]>;
  }
}
export const mailClient = (credential?: Credential) => new RPC<Mail>('webmail',credential);
export const adminClient = (credential?: Credential) => new RPC<Admin>('webadmin',credential);
export const accountClient = (credential?: Credential) => new RPC<Account>('webaccount',credential);

export async function loginMail(username: string, password: string) {
  const mail = mailClient(); const prep = await mail.call('LoginPrep');
  mail.credential.csrf = await mail.call('Login',prep,username,password);
  try {
    const account = accountClient(); const token = await account.call('LoginPrep');
    account.credential.csrf = await account.call('Login',token,username,password);
    return {mail:mail.credential,account:account.credential};
  } catch (e) { await mail.call('Logout').catch(()=>undefined); throw e; }
}
export async function loginAdmin(password: string) {
  const admin = adminClient(); const prep = await admin.call('LoginPrep');
  admin.credential.csrf = await admin.call('Login',prep,password); return admin.credential;
}

// webapi/v0 accepts multipart forms and requires the user's Basic credentials. They are
// kept only in the bounded, expiring server session; never in cookies or logs.
type SendData = Record<string,unknown> & {AttachedFiles?:{Name:string;ContentType:string;Data:string}[]};
export async function webAPI<T>(username: string, password: string, method: 'Send', data: SendData): Promise<T> {
  const {AttachedFiles=[],...fields}=data;
  const form=new FormData();form.set('request',JSON.stringify(fields));
  // Mox's attachedfile parts avoid Go's 10 MiB limit for urlencoded forms and
  // the text-field limit of multipart forms containing large base64 JSON.
  for(const file of AttachedFiles)form.append('attachedfile',new Blob([new Uint8Array(Buffer.from(file.Data,'base64'))],{type:file.ContentType}),file.Name);
  let response: Response;
  try { response = await fetch(moxOrigin()+'/webapi/v0/'+method, {
    method:'POST', headers:{authorization:'Basic '+Buffer.from(username+':'+password).toString('base64')},
    body:form, cache:'no-store', redirect:'error', signal:AbortSignal.timeout(30000),
  }); } catch { throw new AppError(502,'Результат отправки не подтверждён. Проверьте «Отправленные» перед повтором.'); }
  const result = await response.json().catch(()=>null) as (T & {Code?:string;Message?:string;MessageID?:unknown})|null;
  if (response.status === 401) throw new AppError(401,'Пароль изменён. Войдите снова.');
  if (!response.ok) throw new AppError(response.status===400?400:502,response.status===400?(result?.Code==='user'?(result.Message||'Ошибка отправки.').slice(0,500):'Почтовый сервер отклонил данные письма.'):'Результат отправки не подтверждён. Проверьте «Отправленные» и доставку перед повтором.');
  if (!result || typeof result!=='object' || typeof result.MessageID!=='string' || !result.MessageID) throw new AppError(502,'Результат отправки не подтверждён. Проверьте «Отправленные» перед повтором.');
  return result;
}
