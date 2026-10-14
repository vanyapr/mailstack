import { readFile } from 'node:fs/promises';
import { body, text, email, domain, account, identifier, ids, AppError } from '@/lib/security/validation';
import { createSession, getSession, csrf, sameOrigin, limitLogin, sessionCookie, destroy, json, failure } from '@/lib/auth/session';
import { loginAdmin, adminClient } from '@/lib/mox/client';
import type { Filter, Alias } from '@/lib/mox/upstream/webadmin';
export const runtime='nodejs';export const dynamic='force-dynamic';
const queueFilter:Filter={Max:100,Account:'',From:'',To:'',Submitted:'',NextAttempt:''};
type Context={params:Promise<{path:string[]}>};
async function handle(request:Request,context:Context) {
  try {
    const path=(await context.params).path;const key=path.join('/');
    if(key==='login'&&request.method==='POST') {
      sameOrigin(request);const b=await body(request,4096);limitLogin(request,'admin');
      const credential=await loginAdmin(text(b.password,1024));
      try{destroy(getSession(request,'admin'));}catch{}
      const s=createSession('admin',{admin:credential});return json({authenticated:true,csrfToken:s.csrf},200,{'set-cookie':sessionCookie('admin',s.id)});
    }
    const s=getSession(request,'admin');const client=adminClient(s.admin);if(request.method!=='GET')csrf(request,s);
    if(key==='session'&&request.method==='GET'){await client.call('Version');return json({authenticated:true,csrfToken:s.csrf});}
    if(key==='logout'&&request.method==='POST'){let upstreamRevoked=true;await client.call('Logout').catch(()=>{upstreamRevoked=false;});destroy(s);return json({authenticated:false,upstreamRevoked},200,{'set-cookie':sessionCookie('admin','',true)});}
    if(key==='overview'&&request.method==='GET') {
      const [version,domains,accounts,queue]=await Promise.all([client.call('Version'),client.call('Domains'),client.call('Accounts'),client.call('QueueSize')]);
      return json({version,domainCount:domains?.length||0,accountCount:accounts[0]?.length||0,queueSize:queue,observedAt:new Date().toISOString(),mox:'ok'});
    }
    if(key==='domains'&&request.method==='GET')return json({items:(await client.call('Domains')||[]).map(d=>({name:d.Domain.Unicode||d.Domain.ASCII,disabled:d.Disabled,description:d.Description}))});
    if(key==='accounts'&&request.method==='GET') {
      const [names]=await client.call('Accounts');const items=[];
      for(const name of names||[]) {const [a,size]=await client.call('Account',name);items.push({name,addresses:Object.keys(a.Destinations||{}),disabled:!!a.LoginDisabled,fullName:a.FullName,size,quota:a.QuotaMessageSize});}
      return json({items});
    }
    if(key==='aliases'&&request.method==='GET') {
      const domains=await client.call('Domains');const items=[];
      for(const d of domains||[]) for(const [localpart,a] of Object.entries(d.Aliases||{}))items.push({address:localpart+'@'+d.Domain.ASCII,localpart,domain:d.Domain.ASCII,addresses:a.Addresses||[],postPublic:a.PostPublic,listMembers:a.ListMembers,allowMsgFrom:a.AllowMsgFrom});
      return json({items});
    }
    if(key==='queue'&&request.method==='GET') {
      const list=await client.call('QueueList',queueFilter,{Field:'Queued',LastID:0,Last:null,Asc:true});
      return json({items:(list||[]).map(m=>({id:m.ID,from:m.SenderLocalpart+'@'+m.SenderDomainStr,to:m.RecipientLocalpart+'@'+m.RecipientDomainStr,queued:m.Queued,nextAttempt:m.NextAttempt,attempts:m.Attempts,hold:m.Hold,lastError:m.LastAttempt?m.Results?.at(-1)?.Error||'':''}))});
    }
    if(key==='system'&&request.method==='GET') {
      let report:unknown=null;
      if(process.env.SYSTEM_STATUS_PATH) {
        try {const data=await readFile(process.env.SYSTEM_STATUS_PATH,'utf8');if(data.length<1024*1024){const value=JSON.parse(data);report={observedAt:value.observedAt,phase:value.phase,checks:Array.isArray(value.checks)?value.checks.map((c:Record<string,unknown>)=>({name:c.name,status:c.status,message:c.message})):[],backups:value.backups?Object.fromEntries(['lastAttempt','state','lastSuccess','lastCheck','lastFailure','snapshotId','repository','schedule','lastRestore'].map(key=>[key,value.backups[key]])):null};}}
        catch {report=null;}
      }
      return json({version:await client.call('Version'),application:'0.2.0-dev',report,observedAt:new Date().toISOString(),operations:'cli'});
    }
    const b=request.method==='POST'?await body(request,16384):{};
    if(key==='domains'&&request.method==='POST'){const name=account(b.account);const [names]=await client.call('Accounts');const existing=(names||[]).includes(name);await client.call('DomainAdd',false,domain(b.domain),name,existing?'':text(b.localpart||'postmaster',64));return json({ok:true,createdAccount:existing?null:name});}
    if(key==='domains/remove'&&request.method==='POST'){const name=domain(b.domain);if(b.confirm!==name)throw new AppError(400,'Подтвердите точное имя домена.');await client.call('DomainRemove',name);return json({ok:true});}
    if(key==='dns'&&request.method==='POST') {const name=domain(b.domain);const [check,records]=await Promise.all([client.call('CheckDomain',name),client.call('DomainRecords',name)]);return json({check,records});}
    if(key==='accounts'&&request.method==='POST') {
      const name=account(b.account),address=email(b.address),password=text(b.password,1024);if(password.length<12)throw new AppError(400,'Пароль: не менее 12 символов.');
      await client.call('AccountAdd',name,address);
      try{await client.call('SetPassword',name,password);}catch{throw new AppError(502,`Аккаунт ${name} создан, но пароль не установлен. Задайте пароль в его настройках.`);}
      return json({ok:true});
    }
    if(key==='accounts/password'&&request.method==='POST'){const password=text(b.password,1024);if(password.length<12)throw new AppError(400,'Пароль: не менее 12 символов.');await client.call('SetPassword',account(b.account),password);return json({ok:true});}
    if(key==='accounts/access'&&request.method==='POST'){await client.call('AccountLoginDisabledSave',account(b.account),b.disabled===true?'Disabled by MailStack administrator':'');return json({ok:true});}
    if(key==='accounts/remove'&&request.method==='POST'){const name=account(b.account);if(b.confirm!==name)throw new AppError(400,'Подтвердите точное имя аккаунта.');await client.call('AccountRemove',name);return json({ok:true});}
    if(key==='accounts/address'&&request.method==='POST'){await client.call('AddressAdd',email(b.address),account(b.account));return json({ok:true});}
    if(key==='accounts/address/remove'&&request.method==='POST'){const address=email(b.address),[a]=await client.call('Account',account(b.account));if(b.confirm!==address)throw new AppError(400,'Подтвердите точный удаляемый адрес.');if(!Object.hasOwn(a.Destinations||{},address))throw new AppError(400,'Адрес не принадлежит этому аккаунту.');await client.call('AddressRemove',address);return json({ok:true});}
    if(key==='accounts/quota'&&request.method==='POST') {
      const name=account(b.account),quota=Number(b.quota);if(!Number.isSafeInteger(quota)||quota<0)throw new AppError(400,'Квота должна быть целым неотрицательным числом байтов.');const [a]=await client.call('Account',name);
      await client.call('AccountSettingsSave',name,a.MaxOutgoingMessagesPerDay,a.MaxFirstTimeRecipientsPerDay,quota,!a.NoFirstTimeSenderDelay,a.NoCustomPassword);return json({ok:true});
    }
    if(key==='aliases'&&request.method==='POST') {
      const address=email(b.address),at=address.lastIndexOf('@'),lp=address.slice(0,at),dom=domain(address.slice(at+1));
      const targets=text(b.addresses,4000).split(/[;,]/).map(t=>email(t.trim()));
      if(targets.length>100)throw new AppError(400,'Слишком много адресов.');
      const alias:Alias={Addresses:targets,PostPublic:b.postPublic!==false,ListMembers:false,AllowMsgFrom:false,LocalpartStr:lp,Domain:{ASCII:dom,Unicode:''}};
      await client.call('AliasAdd',lp,dom,alias);return json({ok:true});
    }
    if(key==='aliases/update'&&request.method==='POST') {
      const lp=text(b.localpart,64),dom=domain(b.domain);
      const config=await client.call('DomainConfig',dom);const existing=config.Aliases?.[lp];if(!existing)throw new AppError(404,'Алиас не найден.');
      const next=text(b.addresses,4000).split(/[;,]/).map(t=>email(t.trim()));const previous=existing.Addresses||[];
      const added=next.filter(a=>!previous.includes(a)),removed=previous.filter(a=>!next.includes(a));
      if(added.length)await client.call('AliasAddressesAdd',lp,dom,added);
      if(removed.length)await client.call('AliasAddressesRemove',lp,dom,removed);
      return json({ok:true});
    }
    if(key==='aliases/remove'&&request.method==='POST'){const lp=text(b.localpart,64),dom=domain(b.domain);if(b.confirm!==lp+'@'+dom)throw new AppError(400,'Подтвердите точный адрес алиаса.');await client.call('AliasRemove',lp,dom);return json({ok:true});}
    if(key==='queue/retry'&&request.method==='POST')return json({affected:await client.call('QueueNextAttemptSet',{...queueFilter,IDs:ids(b.ids)},0)});
    throw new AppError(404,'Такого действия нет.');
  } catch(e) {return failure(e);}
}
export const GET=handle;export const POST=handle;
