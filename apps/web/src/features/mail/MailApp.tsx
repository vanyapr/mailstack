'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, Modal } from '@/components/Controls';
import { TooltipButton } from '@/components/TooltipButton';
import * as I from '@/components/Icons';
import { Login } from '@/components/Login';
import { useAuth } from '@/lib/api';
import type { Folder, Mail, Message, Snapshot } from '@/lib/mox/mail';
import { Composer, newDraft, type Draft } from './Composer';
import { AccountMenu } from './AccountMenu';
import { FolderManager } from './FolderManager';
import { browserSubscription, clearBrowserPush } from '@/lib/push/browser';
import { MailSettings } from './MailSettings';
import { compositionFor, hasDraftContent, type ComposeKind } from './composition';
import { loadAttachments } from './attachments';
const layouts=[['right','Справа',I.IconLayoutSidebarRight],['bottom','Снизу',I.IconLayoutBottombar],['full','Во всю ширину',I.IconLayoutNavbar]] as const;
type Layout=typeof layouts[number][0];
type MailFolder=number|'all'|'flagged';
const folderIcons:Record<string,typeof I.IconMail>={inbox:I.IconMail,sent:I.IconSend,drafts:I.IconFileText,archive:I.IconArchive,spam:I.IconAlertOctagon,trash:I.IconTrash};
const date=(value:string,long=false)=>new Intl.DateTimeFormat('ru-RU',long?{dateStyle:'medium',timeStyle:'short'}:{day:'2-digit',month:'2-digit'}).format(new Date(value));
const initials=(name:string)=>name.split(/[ @]+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();

// Selection and starring are independent of opening the message. Keep native
// checkbox semantics so keyboard and assistive-technology users get the same
// bulk actions as touch users; the wrapper enlarges the mobile hit target.
function MailRow({mail,active,checked,onCheck,onOpen,onMove,onUnread,onFlag,busy}:{mail:Mail;active:boolean;checked:boolean;onCheck:()=>void;onOpen:()=>void;onMove:(folder:string)=>void;onUnread:()=>void;onFlag:()=>void;busy:boolean}) {
  const [revealed,setRevealed]=useState(false);const gesture=useRef<{x:number;y:number}|null>(null),swiped=useRef(0);
  return <li className={`mail-row ${active?'selected':''} ${mail.unread?'unread':''}`}><div className="mail-row-main" onPointerDown={e=>{if(e.pointerType==='touch')gesture.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{const p=gesture.current;gesture.current=null;if(p&&Math.abs(e.clientX-p.x)>64&&Math.abs(e.clientY-p.y)<32){setRevealed(e.clientX<p.x);swiped.current=Date.now();}}} onPointerCancel={()=>{gesture.current=null;}}>
    <div className="row-selection"><label className="row-check-hit"><input className="row-checkbox" type="checkbox" checked={checked} onChange={onCheck}/><span className="sr-only">{'Выбрать: '+mail.subject}</span></label><Action icon={I.IconStar} label={'Отметить: '+mail.subject} aria-pressed={mail.flagged} className={'row-star '+(mail.flagged?'starred':'')} disabled={busy} onClick={onFlag}/></div><button className="mail-open" onClick={()=>{if(Date.now()-swiped.current>350)onOpen();}} aria-current={active?'true':undefined}><span className={'unread-dot '+(mail.unread?'visible':'')}/><span className="row-copy"><span className="sender">{mail.sender}</span><span className="row-subject">{mail.subject}</span><span className="preview">{mail.preview}</span></span><span className="row-meta"><time dateTime={mail.date}>{date(mail.date)}</time>{!!mail.attachments.length&&<I.IconPaperclip size={16} aria-label="Есть вложение"/>}</span></button><Action icon={I.IconDots} label={'Действия: '+mail.subject} className="row-more" aria-expanded={revealed} onClick={()=>setRevealed(v=>!v)}/>
  </div>{revealed&&<div className="row-actions"><Action icon={I.IconArchive} label="Архивировать" onClick={()=>onMove('archive')}>Архив</Action><Action icon={I.IconMailOpened} label="Изменить прочитанность" onClick={()=>{onUnread();setRevealed(false);}}>Прочитано</Action><Action icon={I.IconTrash} label="В корзину" onClick={()=>onMove('trash')}>В корзину</Action></div>}</li>;
}

export function MailApp() {
  const auth=useAuth('mail');const request=auth.request;
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[folder,setFolder]=useState<MailFolder>(0),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[ascending,setAscending]=useState(false);
  const [mail,setMail]=useState<Message|null>(null),[checked,setChecked]=useState<number[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[opening,setOpening]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[layout,setLayout]=useState<Layout>('right'),[scheme,setScheme]=useState('system'),[sidebar,setSidebar]=useState(false),[menu,setMenu]=useState(false),[settings,setSettings]=useState(false),[external,setExternal]=useState(false),[authorColors,setAuthorColors]=useState(false);
  const [draft,setDraft]=useState<Draft|null>(null),[editing,setEditing]=useState(false),[folderManager,setFolderManager]=useState(false);
  const [collapsed,setCollapsed]=useState(false),[searchShortcut,setSearchShortcut]=useState('Ctrl K');
  const [pendingCompose,setPendingCompose]=useState<{kind:ComposeKind;source:Message|null}|null>(null);
  const [revision,setRevision]=useState(0);const searchRef=useRef<HTMLInputElement>(null),sidebarRef=useRef<HTMLElement>(null),headingRef=useRef<HTMLHeadingElement>(null),openRevision=useRef(0);
  useEffect(()=>{try{const value=localStorage.getItem('golos-layout');if(layouts.some(([id])=>id===value))setLayout(value as Layout);setScheme(localStorage.getItem('golos-color-scheme')||'system');setCollapsed(localStorage.getItem('mailstack-sidebar-collapsed')==='true');}catch{}const platform=(navigator as Navigator&{userAgentData?:{platform:string}}).userAgentData?.platform||navigator.platform;setSearchShortcut(/Mac|iPhone|iPad/i.test(platform)?'⌘ K':'Ctrl K');},[]);
  useEffect(()=>{document.documentElement.dataset.scheme=scheme;},[scheme]);
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query),300);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);
  const parameters=useCallback((cursor=0)=>{const p=new URLSearchParams();if(folder)p.set('folder',String(folder));if(search)p.set('q',search);if(ascending)p.set('asc','1');if(cursor)p.set('cursor',String(cursor));return p.toString();},[folder,search,ascending]);
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{
    if(!auth.auth)return;const controller=new AbortController();setLoading(true);setError('');
    request<Snapshot>('snapshot?'+parameters(),undefined,controller.signal).then(data=>{setSnapshot(data);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
  },[auth.auth,request,parameters,revision]);
  useEffect(()=>{
    if(!auth.auth)return;let timer:ReturnType<typeof setTimeout>|undefined;
    const events=new EventSource('/api/mail/events?'+parameters());
    const changed=()=>{clearTimeout(timer);timer=setTimeout(reload,300);};
    // Reconcile the initial SSE view too: delivery may occur after the first
    // HTTP snapshot but before this stream connects (including reconnects).
    events.addEventListener('viewMsgs',changed);events.addEventListener('viewChanges',changed);
    const fallback=setInterval(reload,60000);return()=>{events.close();clearTimeout(timer);clearInterval(fallback);};
  },[auth.auth,parameters,reload]);
  useEffect(()=>{if(!draft)return;const handler=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[draft]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(document.querySelector('dialog[open]'))return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&!sidebar){e.preventDefault();searchRef.current?.focus();}if(e.key==='Escape'){setSidebar(false);setMenu(false);if(editing)setEditing(false);else setMail(null);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[sidebar,editing]);
  useEffect(()=>{
    if(!sidebar)return;const previous=document.activeElement as HTMLElement|null;
    sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const controls=Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a,button,input')||[]).filter(el=>el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
    const media=matchMedia('(min-width:800px)');const desktop=()=>{if(media.matches)setSidebar(false);};document.addEventListener('keydown',trap);media.addEventListener('change',desktop);return()=>{document.removeEventListener('keydown',trap);media.removeEventListener('change',desktop);previous?.focus();};
  },[sidebar]);
  useEffect(()=>{setExternal(false);setAuthorColors(false);setMenu(false);if(mail&&(layout==='full'||matchMedia('(max-width:799px)').matches))headingRef.current?.focus();},[mail?.id,layout]);
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function chooseLayout(value:Layout){setLayout(value);try{localStorage.setItem('golos-layout',value);}catch{setError('Не удалось сохранить компоновку.');}}
  function toggleCollapsed(){const next=!collapsed;setCollapsed(next);try{localStorage.setItem('mailstack-sidebar-collapsed',String(next));}catch{setError('Не удалось запомнить состояние панели.');}}
  function navigate(id:MailFolder){setSnapshot(s=>s?{...s,mails:[],hasMore:false,cursor:0}:s);setLoading(true);setFolder(id);reload();setMail(null);openRevision.current++;setEditing(false);setChecked([]);setQuery('');setSearch('');setSidebar(false);setMenu(false);}
  async function open(item:Mail){
    const rev=++openRevision.current;setOpening(true);setEditing(false);setError('');
    try{
      const result=await request<Message>('message/'+item.id);if(rev!==openRevision.current)return;setMail(result);
      if(item.draft){
        if(draft){setNotice('Сначала сохраните открытый черновик.');setEditing(true);}
        else{
          // Never open a partial draft: all files and the body must load first.
          const [files,content]=await Promise.all([loadAttachments(result),request<{html:string;replyToId:number;forward:boolean}>('draft/'+item.id+'/html')]);
          if(rev!==openRevision.current)return;
          setDraft({...newDraft(),to:result.to,cc:result.cc,bcc:result.bcc,subject:result.subject==='(Без темы)'?'':result.subject,text:result.texts.join('\n'),html:content.html,files,draftId:result.id,replyToId:content.replyToId||undefined,forward:content.forward});setEditing(true);
        }
      }
      if(item.unread){setMail(m=>m&&m.id===item.id?{...m,unread:false}:m);await request('flags',{ids:[item.id],flag:'\\seen',enabled:true});reload();}
    }catch(e){if(rev===openRevision.current){setMail(null);setError((e as Error).message);}}finally{if(rev===openRevision.current)setOpening(false);}
  }
  async function flags(id:number,flag:string,enabled:boolean){
    await request('flags',{ids:[id],flag,enabled});
    const patch=flag==='\\flagged'?{flagged:enabled}:{unread:!enabled};
    const removed=folder==='flagged'&&flag==='\\flagged'&&!enabled;
    setSnapshot(s=>s?{...s,mails:s.mails.flatMap(m=>m.id!==id?[m]:removed?[]:[{...m,...patch}])}:s);
    setMail(m=>m&&m.id===id?(removed?null:{...m,...patch}):m);
    if(removed)setChecked(ids=>ids.filter(value=>value!==id));
    reload();
  }
  async function move(destination:string|number,selected=checked.length?checked:(mail?[mail.id]:[])){
    const target=typeof destination==='number'?snapshot?.folders.find(f=>f.id===destination):snapshot?.folders.find(f=>f.kind===destination);if(!target)throw Error('Папка назначения не найдена. Создайте её в списке папок.');
    await request('move',{ids:selected,folder:target.id});if(mail&&selected.includes(mail.id))setMail(null);setChecked([]);setMenu(false);reload();setNotice('Письма перемещены.');
  }
  async function compose(kind:ComposeKind='new',source:Message|null=mail,replace=false) {
    const rev=++openRevision.current;setOpening(false);
    const signature=snapshot?.settings.Signature||'';
    if(draft&&!replace){
      if(kind==='new'){setEditing(true);setNotice('Продолжен открытый черновик.');return;}
      if(hasDraftContent(draft,signature)){setPendingCompose({kind,source});setMenu(false);return;}
    }
    const next=compositionFor(kind,source,auth.auth?.username||'',signature);
    if(kind==='forward'&&source?.attachments.length){
      await run(async()=>{
        next.files=await loadAttachments(source);if(rev!==openRevision.current)return;setDraft(next);setEditing(true);setSidebar(false);
      });return;
    }
    setDraft(next);setEditing(true);setSidebar(false);
  }
  async function serialize(current:Draft){const files=await Promise.all(current.files.map(async f=>{if(f.size>15*1024*1024)throw Error('Размер вложения превышает 15 МБ.');const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return {name:f.name,type:f.type,data:btoa(binary)};}));return {...current,files};}
  async function save(send=false,patch:Partial<Draft>={}){await run(async()=>{if(!draft)throw Error('Нет открытого письма.');const value=await serialize({...draft,...patch});if(send){const result=await request<{warnings:string[]}>('send',value);setNotice(result.warnings.length?result.warnings.join(' '):'Письмо принято Mox к отправке.');}else{const folder=snapshot?.folders.find(f=>f.kind==='drafts');if(!folder)throw Error('Папка черновиков не найдена.');await request('draft',{...value,folder:folder.id});setNotice('Черновик сохранён в Mox.');}setDraft(null);setEditing(false);reload();});}
  async function more(){if(!snapshot?.cursor)return;await run(async()=>{const data=await request<Snapshot>('snapshot?'+parameters(snapshot.cursor));setSnapshot(current=>current?{...data,mails:[...current.mails,...data.mails.filter(m=>!current.mails.some(old=>old.id===m.id))]}:data);});}
  async function logout(){if(draft){setError('Сначала сохраните открытый черновик.');setEditing(true);return;}await run(async()=>{const sub=await browserSubscription();const result=await request<{upstreamRevoked:boolean}>('logout',{pushEndpoint:sub?.endpoint||''});await clearBrowserPush().catch(()=>undefined);auth.accept(null);setSnapshot(null);setMail(null);if(!result.upstreamRevoked)setError('Выход выполнен. Mox не подтвердил завершение своей сессии.');});}
  if(auth.loading)return <main className="empty" role="status">Проверка сессии…</main>;
  if(auth.error)return <main className="empty"><h1>MailStack</h1><p role="alert">{auth.error}</p><button className="secondary" onClick={auth.retry}>Повторить</button></main>;
  if(!auth.auth)return <Login role="mail" api={auth} onLogin={auth.accept}/>;
  const folders=snapshot?.folders||[],mails=snapshot?.mails||[],current=folders.find(f=>f.id===folder)||(folder===0?folders.find(f=>f.kind==='inbox'):null),index=mails.findIndex(m=>m.id===mail?.id);
  const inSpam=folders.find(f=>f.id===mail?.folder)?.kind==='spam',spamDestination=inSpam?'inbox':'spam';
  return <main className={`mail-app layout-${layout} ${mail||opening||editing?'has-message':''} ${sidebar?'sidebar-open':''} ${collapsed?'sidebar-collapsed':''} ${editing?'is-composing':''}`}>
    {sidebar&&<button className="sidebar-backdrop" aria-label="Закрыть папки" onClick={()=>setSidebar(false)}/>}
    <aside className="sidebar" ref={sidebarRef}>
      <Action icon={I.IconX} label="Закрыть папки" className="sidebar-close" onClick={()=>setSidebar(false)}/>
      <div className="brand-row"><a className="brand" href="/mail" aria-label="MailStack" title="MailStack" onClick={e=>{e.preventDefault();navigate(0);}}><I.IconMail className="brand-mark" size={26}/><span className="brand-label">MailStack</span></a><TooltipButton className="sidebar-toggle action" label={collapsed?'Развернуть боковую панель':'Свернуть боковую панель'} aria-expanded={!collapsed} aria-controls="mail-folders" placement="right" onClick={toggleCollapsed}><I.IconSidebarLeft size={22}/></TooltipButton></div>
      <TooltipButton className="compose-button" label={draft?'Продолжить':'Написать'} tooltip={collapsed} placement="right" onClick={()=>compose()}><I.IconPencil size={24}/><span className="sidebar-label">{draft?'Продолжить':'Написать'}</span></TooltipButton>
      <nav id="mail-folders" aria-label="Почтовые папки">{folders.map(f=>{const Icon=folderIcons[f.kind]||I.IconFolder;return <TooltipButton key={f.id} label={f.label} tooltip={collapsed} placement="right" className={'folder '+(current?.id===f.id?'active':'')} aria-current={current?.id===f.id?'page':undefined} onClick={()=>navigate(f.id)}><Icon size={24}/><span className="sidebar-label">{f.label}</span>{f.unread>0&&<span className="folder-count">{f.unread}</span>}</TooltipButton>;})}<TooltipButton label="Отмеченные" tooltip={collapsed} placement="right" className={'folder '+(folder==='flagged'?'active':'')} aria-current={folder==='flagged'?'page':undefined} onClick={()=>navigate('flagged')}><I.IconStar size={24}/><span className="sidebar-label">Отмеченные</span></TooltipButton><TooltipButton label="Вся почта" tooltip={collapsed} placement="right" className={'folder '+(folder==='all'?'active':'')} onClick={()=>navigate('all')}><I.IconSearch size={24}/><span className="sidebar-label">Вся почта</span></TooltipButton></nav>
      <div className="folder-tools"><TooltipButton className="folder" label="Папки" tooltip={collapsed} placement="right" onClick={()=>{setSidebar(false);setFolderManager(true);}}><I.IconFolder size={24}/><span className="sidebar-label">Папки</span></TooltipButton></div>
      <div className="sidebar-footer"><AccountMenu name={snapshot?.name||'Почтовый ящик'} address={auth.auth.username||''} initials={initials(snapshot?.name||auth.auth.username||'')} busy={busy} onSettings={()=>{setSidebar(false);setSettings(true);}} onLogout={()=>{setSidebar(false);void logout();}}/></div>
    </aside>
    <header className="global-toolbar" inert={sidebar||undefined}><Action icon={I.IconMenu2} label="Открыть папки" className="mobile-menu" aria-expanded={sidebar} onClick={()=>setSidebar(true)}/><label className="search"><I.IconSearch size={22}/><input ref={searchRef} type="search" aria-label="Поиск в почте" placeholder="Поиск в почте" value={query} onChange={e=>setQuery(e.target.value)} title="from: to: subject: after:2026-01-01 before:2027-01-01"/><kbd>{searchShortcut}</kbd></label><div className="layout-switch" role="group" aria-label="Расположение письма">{layouts.map(([id,label,Icon])=><TooltipButton key={id} label={label} aria-pressed={layout===id} onClick={()=>chooseLayout(id)}><Icon size={24}/></TooltipButton>)}</div></header>
    <section className="workspace" inert={sidebar||undefined}><section className="mail-list" aria-label="Список писем" aria-busy={loading}><header className="list-heading"><h1>{folder==='flagged'?'Отмеченные':folder==='all'?'Вся почта':current?.label||'Входящие'}</h1><span className="list-count">{loading?'Загрузка…':search||folder==='flagged'?`${mails.length}${snapshot?.hasMore?'+':''} найдено`:`${current?.unread||0} непрочитанных`}</span></header><div className="list-toolbar"><input type="checkbox" aria-label="Выбрать все письма" checked={mails.length>0&&mails.every(m=>checked.includes(m.id))} onChange={e=>setChecked(e.target.checked?mails.map(m=>m.id):[])}/><Action icon={I.IconRefresh} label="Обновить список" disabled={loading} onClick={reload}/>{checked.length?<><Action icon={I.IconArchive} label="Архивировать выбранные" disabled={busy} onClick={()=>run(()=>move('archive'))}/><Action icon={I.IconAlertOctagon} label="В спам выбранные" disabled={busy||!folders.some(f=>f.kind==='spam')} onClick={()=>run(()=>move('spam'))}/><Action icon={I.IconTrash} label="В корзину выбранные" disabled={busy} onClick={()=>run(()=>move('trash'))}/></>:<button className="sort" onClick={()=>setAscending(v=>!v)}>{ascending?'Сначала старые':'По дате'}<I.IconChevronDown size={16}/></button>}</div>
      {error&&!editing&&!settings&&!folderManager&&<div className="mail-feedback" role="alert">{error}<button onClick={()=>{setError('');reload();}}>Обновить</button></div>}<ul className="rows">{mails.map(m=><MailRow key={m.id} mail={m} active={mail?.id===m.id} checked={checked.includes(m.id)} onCheck={()=>setChecked(ids=>ids.includes(m.id)?ids.filter(id=>id!==m.id):[...ids,m.id])} onOpen={()=>open(m)} onMove={f=>run(()=>move(f,[m.id]))} onUnread={()=>run(()=>flags(m.id,'\\seen',m.unread))} onFlag={()=>run(()=>flags(m.id,'\\flagged',!m.flagged))} busy={busy}/>)}</ul>{!loading&&!mails.length&&<div className="empty"><I.IconInbox size={36}/><h2>{search?'Ничего не найдено':'Здесь пока нет писем'}</h2><p>{search?'Попробуйте изменить запрос.':'Новые письма появятся в этой папке.'}</p></div>}{snapshot?.hasMore&&<button className="load-more" disabled={busy} onClick={more}>Загрузить ещё</button>}</section>
    <section className="message-pane" aria-label={editing?'Написание письма':'Открытое письмо'}>{editing&&draft?<Composer key={draft.key} draft={draft} from={auth.auth.username||''} busy={busy} error={error} onDiscard={()=>{if(window.confirm('Сбросить изменения в редакторе? Сохранённый черновик в Mox останется.')){setDraft(null);setEditing(false);setError('');}}} onChange={patch=>setDraft(d=>d?{...d,...patch}:d)} onClose={()=>setEditing(false)} onSave={patch=>save(false,patch)} onSend={patch=>save(true,patch)}/>:opening?<div className="empty" role="status">Открытие письма…</div>:mail?<><div className="message-toolbar"><Action icon={I.IconArrowLeft} label="Назад к списку" className="back-to-list" onClick={()=>setMail(null)}/><Action icon={I.IconArchive} label="Архивировать письмо" disabled={busy} onClick={()=>run(()=>move('archive'))}/><Action icon={I.IconTrash} label="В корзину" disabled={busy} onClick={()=>run(()=>move('trash'))}/><Action icon={I.IconAlertOctagon} label={inSpam?'Не спам':'Спам'} disabled={busy||!folders.some(f=>f.kind===spamDestination)} onClick={()=>run(()=>move(spamDestination,[mail.id]))}><span>{inSpam?'Не спам':'Спам'}</span></Action><Action icon={I.IconStar} label="Отметить письмо" disabled={busy} aria-pressed={mail.flagged} className={mail.flagged?'starred':''} onClick={()=>run(()=>flags(mail.id,'\\flagged',!mail.flagged))}/><label className="sr-only" htmlFor="move-folder">Переместить в папку</label><select id="move-folder" className="move-select" value="" disabled={busy} onChange={e=>run(()=>move(Number(e.target.value)))}><option value="">Переместить…</option>{folders.filter(f=>f.id!==mail.folder).map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select><div className="more-wrap"><Action icon={I.IconDots} label="Ещё действия" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}/>{menu&&<div className="dropdown"><button onClick={()=>run(()=>flags(mail.id,'\\seen',mail.unread))}>{mail.unread?'Отметить прочитанным':'Отметить непрочитанным'}</button><button onClick={()=>compose('all')}>Ответить всем</button><button onClick={()=>compose('forward')}>Переслать</button></div>}</div><div className="message-pagination"><Action icon={I.IconChevronLeft} label="Предыдущее письмо" disabled={index<=0} onClick={()=>open(mails[index-1])}/><Action icon={I.IconChevronRight} label="Следующее письмо" disabled={index<0||index>=mails.length-1} onClick={()=>open(mails[index+1])}/></div></div>
    <article className="message"><h2 ref={headingRef} tabIndex={-1}>{mail.subject}</h2><header className="message-header"><span className="avatar">{initials(mail.sender)}</span><div className="sender-details"><strong>{mail.sender}</strong><span>{mail.email}</span><span className="recipient">Кому: {mail.to}</span>{mail.cc&&<span>Копия: {mail.cc}</span>}</div><time dateTime={mail.date}>{date(mail.date,true)}</time></header>{mail.hasHTML?<><p className="setting-hint">{external?'Внешние изображения разрешены для этого письма.':'Внешние изображения заблокированы.'}<button className="secondary" onClick={()=>setExternal(v=>!v)}>{external?'Блокировать':'Загрузить изображения'}</button><button className="secondary" onClick={()=>setAuthorColors(v=>!v)}>{authorColors?'Цвета темы':'Цвета письма'}</button></p><iframe key={`${mail.id}-${external}-${authorColors}-${scheme}`} title="HTML-письмо" className="reader-frame" sandbox="" src={`/api/mail/message/${mail.id}/html?external=${external?'1':'0'}&colors=${authorColors?'author':scheme}`}/><details><summary>Текстовая версия</summary><div className="message-body">{mail.texts.map((p,i)=><p key={i}>{p}</p>)}</div></details></>:<div className="message-body">{mail.texts.map((p,i)=><p key={i}>{p}</p>)}</div>}
      {!!mail.attachments.length&&<div className="attachments"><h3>Вложения <span>{mail.attachments.length}</span></h3>{mail.attachments.map(f=><a className="attachment" key={f.path} href={`/api/mail/attachment/${mail.id}/${f.path}`} download><I.IconFileText size={26}/><span>{f.name}<small>{Math.ceil(f.size/1024)} КБ</small></span><I.IconDownload size={20}/></a>)}</div>}<div className="reply-actions"><button className="secondary reply-button" onClick={()=>compose('reply')}><I.IconArrowBackUp size={22}/>Ответить</button><button className="secondary reply-button" onClick={()=>compose('all')}>Ответить всем</button><button className="secondary reply-button" onClick={()=>compose('forward')}>Переслать</button></div></article></>:<div className="empty"><I.IconMailOpened size={42}/><h2>Выберите письмо</h2><p>Здесь будет ваша переписка.</p></div>}</section></section>
    {notice&&<div className="toast" role="status">{notice}</div>}
    {pendingCompose&&<Modal title="Открыт другой черновик" onClose={()=>setPendingCompose(null)}><p className="setting-hint">Сначала сохраните текущий черновик или начните новый ответ. Во втором случае несохранённые изменения будут сброшены; сохранённая версия в Mox останется.</p><div className="folder-edit-actions"><button className="secondary" onClick={()=>{setPendingCompose(null);setEditing(true);}}>Продолжить черновик</button><button className="compose-button" onClick={()=>{const next=pendingCompose;setPendingCompose(null);void compose(next.kind,next.source,true);}}>Начать новый ответ</button></div></Modal>}
    {folderManager&&<FolderManager api={auth} onClose={()=>setFolderManager(false)} onChanged={(next,deleted)=>{setSnapshot(s=>s?{...s,folders:next}:s);if(deleted&&(folder===deleted||current?.id===deleted))navigate(0);else reload();}}/>}
    {settings&&<MailSettings hasDraft={!!draft} api={auth} onClose={()=>setSettings(false)} onSaved={reload} onPasswordChanged={()=>{setSettings(false);setDraft(null);setEditing(false);setSnapshot(null);setMail(null);auth.accept(null);}} appearance={<><label>Тема<select aria-label="Тема" value={scheme} onChange={e=>{setScheme(e.target.value);try{localStorage.setItem('golos-color-scheme',e.target.value);}catch{setError('Не удалось сохранить тему.');}}}><option value="system">Как в системе</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label><div className="setting-layouts" role="group" aria-label="Расположение письма">{layouts.map(([id,label,Icon])=><button key={id} type="button" className="secondary" aria-pressed={layout===id} onClick={()=>chooseLayout(id)}><Icon size={22}/>{label}</button>)}</div>{error&&<p role="alert">{error}</p>}</>}/>}
  </main>;
}
