import { mailClient, moxOrigin, webAPI } from './client';
import type { Credential } from './client';
import { ThreadMode, AttachmentType } from './upstream/webmail';
import type { EventStart, EventViewMsgs, MessageItem, Request as MoxRequest, MessageAddress, Mailbox, Filter } from './upstream/webmail';
import { AppError, text, email, filename, object, identifier } from '../security/validation';
import type { Session } from '../auth/session';

export type Folder = {id:number;name:string;label:string;kind:string;unread:number;total:number};
export type Mail = {id:number;folder:number;sender:string;email:string;to:string;subject:string;preview:string;date:string;unread:boolean;flagged:boolean;draft:boolean;messageID:string;cc:string;bcc:string;replyTo:string;attachments:{name:string;path:string;size:number;type:string}[]};
export type Snapshot = {folders:Folder[];mails:Mail[];hasMore:boolean;cursor:number;address:string;name:string;settings:EventStart['Settings'];version:string};
export type Message = Mail & {texts:string[];hasHTML:boolean};
export const address = (a?:MessageAddress|null) => a ? a.User+'@'+(a.Domain.Unicode||a.Domain.ASCII) : '';
const addresses = (a?:MessageAddress[]|null) => (a||[]).map(address).join(', ');
export function mapMail(item:MessageItem):Mail {
  const m=item.Message, e=item.Envelope;
  return {id:m.ID,folder:m.MailboxID,sender:e.From?.[0]?.Name||address(e.From?.[0])||'Без отправителя',email:address(e.From?.[0]),to:addresses(e.To),cc:addresses(e.CC),bcc:addresses(e.BCC),replyTo:addresses(e.ReplyTo),subject:e.Subject||'(Без темы)',preview:m.Preview||'',date:String(m.Received),unread:!m.Seen,flagged:m.Flagged,draft:m.Draft,messageID:e.MessageID,attachments:(item.Attachments||[]).map(a=>({name:a.Filename||'Вложение',path:[0,...(a.Path||[])].join('.'),size:a.Part.DecodedSize,type:(a.Part.MediaType+'/'+a.Part.MediaSubType).toLowerCase()}))};
}
export function mapFolder(m:Mailbox):Folder {
  const kind=m.Name.toLowerCase()==='inbox'?'inbox':m.Sent?'sent':m.Draft?'drafts':m.Archive?'archive':m.Junk?'spam':m.Trash?'trash':'folder';
  const labels:Record<string,string>={inbox:'Входящие',sent:'Отправленные',drafts:'Черновики',archive:'Архив',spam:'Спам',trash:'Корзина'};
  return {id:m.ID,name:m.Name,label:labels[kind]||m.Name,kind,unread:m.Unread,total:m.Total};
}
export function queryRequest(url:URL):MoxRequest {
  const raw=url.searchParams.get('q')||''; if(raw.length>1000) throw new AppError(400,'Поисковый запрос слишком длинный.');
  const filter:Filter={MailboxID:0,MailboxName:'Inbox',MailboxChildrenIncluded:false,Attachments:'' as AttachmentType,SizeMin:0,SizeMax:0,Words:[],From:[],To:[],Subject:[]};
  const folder=url.searchParams.get('folder');
  if(folder==='flagged') {filter.MailboxName='';filter.Labels=['\\flagged'];} else if(folder==='all') {filter.MailboxName='';filter.MailboxID=-1;} else if(folder) {filter.MailboxName='';filter.MailboxID=identifier(folder);}
  const tokens=raw.match(/(?:[^\s"]+|"[^"]*")+/g)||[];
  for(const token of tokens) {
    const match=/^(from|to|subject|after|before):(.+)$/i.exec(token);
    if(!match) {(filter.Words as string[]).push(token.replaceAll('"',''));continue;}
    const [,key,rawValue]=match; const value=rawValue.replaceAll('"','');
    if(key==='after'||key==='before') {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))) throw new AppError(400,'Дата поиска: ГГГГ-ММ-ДД.');
      filter[key==='after'?'Oldest':'Newest']=new Date(value+'T00:00:00Z');
    } else {const field=({from:'From',to:'To',subject:'Subject'} as const)[key as 'from'|'to'|'subject'];filter[field]!.push(value);}
  }
  return {ID:1,SSEID:0,ViewID:1,Cancel:false,Query:{OrderAsc:url.searchParams.get('asc')==='1',Threading:'off' as ThreadMode,Filter:filter,NotFilter:{Attachments:'' as AttachmentType}},Page:{Count:50,AnchorMessageID:url.searchParams.get('cursor')?identifier(url.searchParams.get('cursor')):0,DestMessageID:0}};
}

// Complete SSE frames, including split UTF-8/chunks and multiline data. Bounded
// frames protect the BFF when the upstream changes or malfunctions.
export async function* events(stream:ReadableStream<Uint8Array>) {
  const reader=stream.getReader(); const decoder=new TextDecoder();let buffer='';
  try {
    while(true) {
      const {value,done}=await reader.read();buffer=(buffer+decoder.decode(value,{stream:!done})).replaceAll('\r\n','\n');
      if(buffer.length>4*1024*1024) throw new AppError(502,'Слишком большой ответ Mox.');
      let end:number;
      while((end=buffer.indexOf('\n\n'))>=0) {
        const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);let event='message';const data:string[]=[];
        for(const line of frame.split('\n')) {if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).trimStart());}
        if(data.length) yield {event,data:JSON.parse(data.join('\n')) as unknown};
      }
      if(done) break;
    }
  } finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export async function openEvents(credential:Credential,request:MoxRequest,signal?:AbortSignal) {
  const token=await mailClient(credential).call('Token');
  const params=new URLSearchParams({singleUseToken:token,request:JSON.stringify(request)});
  let response:Response;
  try {response=await fetch(moxOrigin()+'/webmail/events?'+params,{headers:{cookie:credential.cookie},cache:'no-store',redirect:'error',signal:signal||AbortSignal.timeout(30000)});}
  catch {throw new AppError(502,'Не удалось загрузить письма.');}
  if(!response.ok||!response.body) throw new AppError(response.status===400?401:502,'Не удалось загрузить письма. Обновите сессию.');
  return response.body;
}
export async function folders(credential:Credential):Promise<Folder[]> {
  const stream=await openEvents(credential,queryRequest(new URL('http://local/')));
  for await(const frame of events(stream)) {
    if(frame.event==='start')return ((frame.data as EventStart).Mailboxes||[]).map(mapFolder);
    if(frame.event==='fatalErr')break;
  }
  throw new AppError(502,'Не удалось загрузить папки.');
}
export function folderName(value:unknown):string {
  const name=text(value,200).trim();
  if(!name||/[\x00-\x1f\x7f]/.test(name))throw new AppError(400,'Укажите название папки без управляющих символов.');
  return name;
}
export async function changeFolder(credential:Credential,action:'rename'|'delete',id:number,name?:string) {
  const all=await folders(credential),folder=all.find(folder=>folder.id===id);
  if(!folder)throw new AppError(404,'Папка не найдена.');
  if(folder.kind!=='folder')throw new AppError(400,'Системные папки защищены от переименования и удаления.');
  const client=mailClient(credential);
  if(action==='rename')await client.call('MailboxRename',id,folderName(name));
  else {
    if(folder.total>0)throw new AppError(409,'Сначала переместите письма в другую папку. Удалить можно только пустую папку.');
    if(all.some(child=>child.name.startsWith(folder.name+'/')))throw new AppError(409,'Сначала удалите или переместите вложенные папки.');
    // The native transaction repeats these checks under its delivery write lock.
    // Never substitute destructive MailboxDelete, even on older Mox versions.
    try{await client.call('MailboxDeleteEmpty',id);}catch(e){
      if(e instanceof AppError&&e.status===400&&e.message.includes('mailbox is not empty'))throw new AppError(409,'В папке появились письма. Переместите их перед удалением.');
      throw e;
    }
  }
  return folders(credential);
}
export async function snapshot(credential:Credential,url:URL):Promise<Snapshot> {
  const stream=await openEvents(credential,queryRequest(url));let start:EventStart|undefined;const items:Mail[]=[];let hasMore=true;
  for await (const frame of events(stream)) {
    if(frame.event==='start') start=frame.data as EventStart;
    if(frame.event==='fatalErr'||frame.event==='viewErr') throw new AppError(502,'Mox не смог выполнить поиск.');
    if(frame.event==='viewMsgs') {
      const event=frame.data as EventViewMsgs;
      for(const thread of event.MessageItems||[]) for(const item of thread||[]) items.push(mapMail(item));
      if(event.ViewEnd) hasMore=false;
      if(event.ViewEnd||!event.MessageItems?.length) break;
    }
  }
  if(!start) throw new AppError(502,'Неполный ответ почтового сервера.');
  const draftFolders=new Set((start.Mailboxes||[]).filter(m=>m.Draft).map(m=>m.ID));
  return {folders:(start.Mailboxes||[]).map(mapFolder),mails:items.map(m=>({...m,draft:m.draft||draftFolders.has(m.folder)})),hasMore,cursor:items.at(-1)?.id||0,address:address(start.LoginAddress),name:start.LoginAddress.Name||address(start.LoginAddress),settings:start.Settings,version:start.Version};
}
export async function message(credential:Credential,id:number):Promise<Message> {
  const client=mailClient(credential);const [item,parsed]=await Promise.all([client.call('MessageItem',id),client.call('ParsedMessage',id)]);
  return {...mapMail(item),texts:parsed.Texts||[],hasHTML:parsed.HasHTML};
}
export type Composition = {to:string;cc:string;bcc:string;subject:string;text:string;html:string;files:{name:string;type:string;data:string}[];replyToId?:number;draftId?:number;forward?:boolean};
export function composition(raw:Record<string,unknown>):Composition {
  const c:Composition={to:text(raw.to,4000,false),cc:text(raw.cc??'',4000,false),bcc:text(raw.bcc??'',4000,false),subject:text(raw.subject,998,false),text:text(raw.text,1024*1024,false),html:text(raw.html??'',2*1024*1024,false),files:[]};
  if(/[\r\n]/.test(c.subject)) throw new AppError(400,'Недопустимые символы в теме.');
  if(!Array.isArray(raw.files)||raw.files.length>20) throw new AppError(400,'Допускается до 20 вложений.');
  let size=0;
  c.files=raw.files.map(rawFile=>{
    const f=object(rawFile),data=text(f.data,20*1024*1024,false);
    // A repeated four-character group exhausts V8's regexp stack on large files.
    const padding=data.endsWith('==')?2:data.endsWith('=')?1:0;
    if(data.length%4!==0||/[^A-Za-z0-9+/]/.test(data.slice(0,data.length-padding)))throw new AppError(400,'Повреждено вложение.');
    size+=Buffer.byteLength(data,'base64');if(size>15*1024*1024) throw new AppError(413,'Вложения превышают 15 МБ.');
    return {name:filename(f.name),type:text(f.type||'application/octet-stream',100),data};
  });
  if(raw.replyToId)c.replyToId=identifier(raw.replyToId); if(raw.draftId)c.draftId=identifier(raw.draftId);c.forward=raw.forward===true;
  return c;
}
function recipients(value:string) { const list=value.split(/[;,]/).map(v=>v.trim()).filter(Boolean);if(list.length>100)throw new AppError(400,'Слишком много получателей.');return list.map(email); }
export async function saveDraft(s:Session,c:Composition,folder:number) {
  return mailClient(s.mail).call('MessageComposeRich',{From:s.username!,To:recipients(c.to),Cc:recipients(c.cc),Bcc:recipients(c.bcc),ReplyTo:'',Subject:c.subject,TextBody:c.text,ResponseMessageID:c.replyToId||0,DraftMessageID:c.draftId||0},folder,c.html,c.files.map(file=>({Filename:file.name,ContentType:file.type,Data:file.data})),!!c.forward);
}
export async function send(s:Session,c:Composition) {
  const to=recipients(c.to),cc=recipients(c.cc),bcc=recipients(c.bcc);
  if(!to.length&&!cc.length&&!bcc.length)throw new AppError(400,'Укажите получателя.');
  const reference=c.replyToId?await mailClient(s.mail).call('MessageItem',c.replyToId):null;
  const result=await webAPI<{MessageID:string}>(s.username!,s.password!,'Send',{
    To:to.map(Address=>({Address})),CC:cc.map(Address=>({Address})),BCC:bcc.map(Address=>({Address})),Subject:c.subject,Text:c.text,HTML:/<(?:b|strong|i|em|u|a|ul|ol|li|blockquote|code|pre|h[1-6]|table|img)(?:\s|>)/i.test(c.html)?c.html:'',
    References:reference?.Envelope.MessageID?[reference.Envelope.MessageID]:[],SaveSent:true,AttachedFiles:c.files.map(f=>({Name:f.name,ContentType:f.type,Data:f.data})),
  });
  const warnings:string[]=[];
  if(c.replyToId) await mailClient(s.mail).call('FlagsAdd',[c.replyToId],[c.forward?'$forwarded':'\\answered']).catch(()=>warnings.push('Письмо отправлено, но отметка ответа не сохранена.'));
  if(c.draftId) await mailClient(s.mail).call('MessageDelete',[c.draftId]).catch(()=>warnings.push('Письмо отправлено, но прежний черновик не удалён.'));
  return {...result,warnings};
}
