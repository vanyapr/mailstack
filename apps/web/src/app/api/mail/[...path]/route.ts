import { body, text, email, identifier, ids, flag, AppError } from '@/lib/security/validation';
import { createSession, getSession, csrf, sameOrigin, limitLogin, sessionCookie, destroy, json, failure } from '@/lib/auth/session';
import { loginMail, mailClient, accountClient, moxOrigin } from '@/lib/mox/client';
import { pushStatus, subscribe, unsubscribe, revokeAccountPush } from '@/lib/push/server';
import { snapshot, message, composition, send, saveDraft, openEvents, queryRequest, folders, folderName, changeFolder } from '@/lib/mox/mail';

export const runtime='nodejs';export const dynamic='force-dynamic';
type Context = {params:Promise<{path:string[]}>};
async function handle(request:Request,context:Context) {
  try {
    const path=(await context.params).path;const key=path.join('/');const url=new URL(request.url);
    if(key==='login'&&request.method==='POST') {
      sameOrigin(request);const b=await body(request,8192);const username=email(b.username),password=text(b.password,1024);
      limitLogin(request,username);const credentials=await loginMail(username,password);
      // Replace an existing BFF session only after successful upstream login.
      try{destroy(getSession(request,'mail'));}catch{}
      const s=createSession('mail',{...credentials,username,password});
      return json({authenticated:true,csrfToken:s.csrf,username},200,{'set-cookie':sessionCookie('mail',s.id)});
    }
    const s=getSession(request,'mail');const client=mailClient(s.mail);
    if(request.method!=='GET')csrf(request,s);
    if(key==='session'&&request.method==='GET') {await client.call('Version');return json({authenticated:true,csrfToken:s.csrf,username:s.username});}
    if(key==='logout'&&request.method==='POST') {
      const logout=await body(request,4096);await unsubscribe(s,text(logout.pushEndpoint??'',2048,false));
      const result=await Promise.allSettled([client.call('Logout'),accountClient(s.account).call('Logout')]);destroy(s);
      return json({authenticated:false,upstreamRevoked:result.every(r=>r.status==='fulfilled')},200,{'set-cookie':sessionCookie('mail','',true)});
    }
    if(key==='snapshot'&&request.method==='GET')return json(await snapshot(s.mail!,url));
    if(key==='folders'&&request.method==='GET')return json({folders:await folders(s.mail!)});
    if(key==='events'&&request.method==='GET') {
      // Upstream one-use tokens never cross the BFF. Aborted browser requests
      // cancel the Mox stream. Native session invalidation also closes SSE.
      const stream=await openEvents(s.mail!,queryRequest(url),AbortSignal.any([request.signal,AbortSignal.timeout(300000)]));
      return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no'}});
    }
    if(path[0]==='draft'&&path.length===3&&path[2]==='html'&&request.method==='GET') {
      const id=identifier(path[1]);const [html,parsed]=await Promise.all([client.call('DraftHTML',id),client.call('ParsedMessage',id)]);
      const parent=parsed.Headers?.['In-Reply-To']?.[0]?.trim();let replyToId=0;
      if(parent)try{replyToId=await client.call('MessageFindMessageID',parent);}catch(e){if(!(e instanceof AppError&&e.status===400))throw e;}
      return json({html,replyToId,forward:parsed.Headers?.['X-Mailstack-Forward']?.[0]?.trim()==='yes'});
    }
    if(path[0]==='message'&&path.length===2&&request.method==='GET')return json(await message(s.mail!,identifier(path[1])));
    if(path[0]==='message'&&path[2]==='html'&&path.length===3&&request.method==='GET') {
      const id=identifier(path[1]);const response=await fetch(moxOrigin()+`/webmail/msg/${id}/html`,{headers:{cookie:s.mail!.cookie},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new AppError(response.status===404?404:502,'HTML-письмо недоступно.');
      const external=url.searchParams.get('external')==='1';
      const colors=url.searchParams.get('colors')||'system';
      const palette=colors==='author'?'':`html,body{color:#111a2a!important;background:#fff!important}body *:not(img):not(svg){color:inherit!important;background-color:transparent!important}a{color:#2463d4!important}${colors==='dark'?'html,body{color:#e6ebf3!important;background:#171e29!important}a{color:#8cb5ff!important}':colors==='system'?'@media(prefers-color-scheme:dark){html,body{color:#e6ebf3!important;background:#171e29!important}a{color:#8cb5ff!important}}':''}`;
      const style=new TextEncoder().encode(`<style>body{margin:0;padding:12px;font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.65;overflow-wrap:anywhere}img{max-width:100%;height:auto}${palette}</style>`);
      const rendered=response.body?.pipeThrough(new TransformStream({transform(chunk,controller){controller.enqueue(chunk);},flush(controller){controller.enqueue(style);}}));
      return new Response(rendered,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN','content-security-policy':`default-src 'none'; style-src 'unsafe-inline'; img-src data:${external?' https: http:':''}; base-uri 'none'; form-action 'none'; sandbox; frame-ancestors 'self'`}});
    }
    if(path[0]==='attachment'&&path.length===3&&request.method==='GET') {
      const id=identifier(path[1]);if(!/^\d+(?:\.\d+)*$/.test(path[2]))throw new AppError(400,'Некорректная часть письма.');
      const item=await client.call('MessageItem',id);const file=item.Attachments?.find(f=>[0,...(f.Path||[])].join('.')===path[2]);
      if(!file)throw new AppError(404,'Вложение не найдено.');
      const response=await fetch(moxOrigin()+`/webmail/msg/${id}/download/${path[2]}`,{headers:{cookie:s.mail!.cookie},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new AppError(502,'Вложение недоступно.');
      const name=(file.Filename||'attachment').replace(/[\/\\\r\n\x00-\x1f"]/g,'_');
      return new Response(response.body,{headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(name)}`,'cache-control':'no-store','content-security-policy':"default-src 'none'; sandbox",'x-content-type-options':'nosniff'}});
    }
    if(key==='settings'&&request.method==='GET') {
      const [snap,account]=await Promise.all([snapshot(s.mail!,url),accountClient(s.account).call('Account')]);
      return json({settings:snap.settings,fullName:account[0].FullName});
    }
    const b=request.method==='POST'?await body(request,key==='push'?8192:24*1024*1024):{};
    if(key==='push'&&request.method==='POST') {
      if(b.action==='status')return json(await pushStatus(s,text(b.endpoint??'',2048,false)));
      if(b.action==='subscribe')return json(await subscribe(s,b.subscription));
      if(b.action==='unsubscribe'){await unsubscribe(s,text(b.endpoint,2048));return json({enabled:false});}
      throw new AppError(400,'Неизвестное действие уведомлений.');
    }
    if(key==='send'&&request.method==='POST')return json(await send(s,composition(b)));
    if(key==='draft'&&request.method==='POST')return json({id:await saveDraft(s,composition(b),identifier(b.folder))});
    if(key==='move'&&request.method==='POST') {await client.call('MessageMove',ids(b.ids),identifier(b.folder),false);return json({ok:true});}
    if(key==='flags'&&request.method==='POST') {await client.call(b.enabled===true?'FlagsAdd':'FlagsClear',ids(b.ids),[flag(b.flag)]);return json({ok:true});}
    if(key==='folders'&&request.method==='POST') {await client.call('MailboxCreate',folderName(b.name));return json({folders:await folders(s.mail!)});}
    if((key==='folders/rename'||key==='folders/delete')&&request.method==='POST')return json({folders:await changeFolder(s.mail!,key.endsWith('rename')?'rename':'delete',identifier(b.id),b.name===undefined?undefined:folderName(b.name))});
    if(key==='settings'&&request.method==='POST') {
      const snap=await snapshot(s.mail!,url);
      await client.call('SettingsSave',{...snap.settings,Signature:text(b.signature,10000,false),ShowHTML:b.showHTML===true});
      await accountClient(s.account).call('AccountSaveFullName',text(b.fullName,200,false));return json({ok:true});
    }
    if(key==='password'&&request.method==='POST') {
      const password=text(b.password,1024);if(password.length<12)throw new AppError(400,'Не менее 12 символов.');
      await revokeAccountPush(s);await accountClient(s.account).call('SetPassword',password);destroy(s);return json({authenticated:false},200,{'set-cookie':sessionCookie('mail','',true)});
    }
    throw new AppError(404,'Такого действия нет.');
  } catch(e) {return failure(e);}
}
export const GET=handle;export const POST=handle;
