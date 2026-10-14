'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type Squire from 'squire-rte';
import createDOMPurify from 'dompurify';
import { Action } from '@/components/Controls';
import { IconArrowLeft, IconBold, IconItalic, IconUnderline, IconList, IconListNumbers, IconLink, IconUndo, IconArrowForwardUp, IconPaperclip, IconX, IconFileText, IconSend } from '@/components/Icons';
import { commitRecipients, recipientValues, serializeRecipients } from './recipients';
export type Draft={key:number;to:string;cc:string;bcc:string;subject:string;html:string;text:string;files:File[];draftId?:number;replyToId?:number;forward?:boolean};
export const newDraft=():Draft=>({key:Date.now(),to:'',cc:'',bcc:'',subject:'',html:'',text:'',files:[]});
type RecipientFieldName='to'|'cc'|'bcc';
const recipientFields:[RecipientFieldName,string,string][]=[['to','Кому','Кому'],['cc','Копия','Копия'],['bcc','Скрытая','Скрытая копия']];

function RecipientField({name,visibleLabel,label,value,input,error,busy,onChange,onInput,onError}:{name:RecipientFieldName;visibleLabel:string;label:string;value:string;input:string;error:string;busy:boolean;onChange:(value:string)=>void;onInput:(value:string)=>void;onError:(value:string)=>void}) {
  const values=recipientValues(value);
  const inputId='composer-'+name;
  const errorId=inputId+'-error';
  function commit(raw=input) {
    const result=commitRecipients(values,raw);
    onError(result.error||'');
    if(result.error)return false;
    onChange(serializeRecipients(result.values));onInput('');return true;
  }
  function update(value:string) {
    onError('');
    if(/[;,]\s*$/.test(value)) { commit(value); return; }
    onInput(value);
  }
  return <div className="composer-recipient">
    <label className="composer-field-label" htmlFor={inputId}>{visibleLabel}</label>
    <div className="recipient-control" data-invalid={error?true:undefined} onClick={()=>document.getElementById(inputId)?.focus()}>
      {!!values.length&&<ul className="recipient-list" aria-label={label+' — выбранные адресаты'}>{values.map(address=><li key={address}><span>{address}</span><button type="button" aria-label={'Убрать '+address} disabled={busy} onClick={event=>{event.stopPropagation();onError('');onChange(serializeRecipients(values.filter(value=>value!==address)));}}><IconX size={16}/></button></li>)}</ul>}
      <input id={inputId} name={name} aria-label={label} aria-describedby={error?errorId:undefined} aria-invalid={!!error} type="email" inputMode="email" autoComplete="email" value={input} disabled={busy} placeholder={values.length?'Добавить адрес':'name@example.com'} onChange={event=>update(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'||event.key===','||event.key===';'){event.preventDefault();commit();}if(event.key==='Backspace'&&!input&&values.length){event.preventDefault();onError('');onChange(serializeRecipients(values.slice(0,-1)));}}} onBlur={()=>{if(input.trim())commit();}}/>
    </div>
    {error&&<p id={errorId} className="recipient-error" role="alert">{error}</p>}
  </div>;
}

export function Composer({draft,from,busy,onChange,onClose,onSave,onSend,onDiscard,error}:{draft:Draft;from:string;busy:boolean;onChange:(patch:Partial<Draft>)=>void;onClose:()=>void;onSave:(patch:Partial<Draft>)=>void;onSend:(patch:Partial<Draft>)=>void;onDiscard:()=>void;error:string}) {
  const root=useRef<HTMLDivElement>(null),editor=useRef<Squire|null>(null),fileInput=useRef<HTMLInputElement>(null),form=useRef<HTMLFormElement>(null),change=useRef(onChange);
  change.current=onChange;
  const [empty,setEmpty]=useState(true),[link,setLink]=useState<string|null>(null),[linkError,setLinkError]=useState(''),[editorError,setEditorError]=useState(''),[ready,setReady]=useState(false);
  const [formats,setFormats]=useState<Record<string,boolean>>({});
  const [recipientInputs,setRecipientInputs]=useState<Record<RecipientFieldName,string>>({to:'',cc:'',bcc:''});
  const [recipientErrors,setRecipientErrors]=useState<Record<RecipientFieldName,string>>({to:'',cc:'',bcc:''});
  const savedRange=useRef<Range|null>(null);
  useEffect(()=>{
    let cancelled=false;let instance:Squire|null=null;
    void import('squire-rte').then(({default:Squire})=>{
    if(cancelled)return;
    const purify=createDOMPurify(window);const options={ALLOWED_TAGS:['div','p','br','span','b','strong','i','em','u','s','ol','ul','li','a','blockquote','pre','code'],ALLOWED_ATTR:['href','title'],ALLOWED_URI_REGEXP:/^(?:https?:|mailto:)/i};
    const current=new Squire(root.current!,{sanitizeToDOMFragment:html=>window.document.importNode(purify.sanitize(html,{...options,RETURN_DOM_FRAGMENT:true}),true)});
    instance=current;editor.current=current;current.setHTML(draft.html||'');
    if(!draft.html&&draft.text)current.insertPlainText(draft.text,false);
    const update=()=>{const text=root.current?.innerText||'';setEmpty(!text.trim());change.current({text,html:purify.sanitize(current.getHTML(),options)});setFormats(Object.fromEntries(['B','I','U','UL','OL'].map(tag=>[tag,current.hasFormat(tag)])));};
    current.addEventListener('input',update);current.addEventListener('pathChange',()=>setFormats(Object.fromEntries(['B','I','U','UL','OL'].map(tag=>[tag,current.hasFormat(tag)]))));
    setReady(true);current.setKeyHandler('Ctrl-s',(_,e)=>{e.preventDefault();form.current?.requestSubmit();});current.setKeyHandler('Meta-s',(_,e)=>{e.preventDefault();form.current?.requestSubmit();});update();
    }).catch(()=>setEditorError('Редактор не загрузился. Обновите страницу.'));
    return()=>{cancelled=true;instance?.destroy();editor.current=null;};
    // Recreate only when opening a different draft, never on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[draft.key]);
  useEffect(()=>{
    if(!ready||form.current?.contains(document.activeElement)&&document.activeElement?.tagName==='INPUT')return;
    if(draft.to)editor.current?.focus();else form.current?.querySelector<HTMLInputElement>('[name=to]')?.focus();
    // Focus after React removes the loading state, once per opened draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready,draft.key]);
  function format(tag:string) {const e=editor.current;if(!e)return;const remove=e.hasFormat(tag);if(tag==='B')remove?e.removeBold():e.bold();if(tag==='I')remove?e.removeItalic():e.italic();if(tag==='U')remove?e.removeUnderline():e.underline();if(tag==='UL')remove?e.removeList():e.makeUnorderedList();if(tag==='OL')remove?e.removeList():e.makeOrderedList();e.focus();}
  function addLink(){try{const url=new URL(link||'');if(!['https:','http:','mailto:'].includes(url.protocol))throw Error();const e=editor.current!;e.focus();if(savedRange.current)e.setSelection(savedRange.current);e.makeLink(url.href);setLink(null);setLinkError('');}catch{setLinkError('Укажите полный адрес https://… или mailto:…');}}
  function recipientPatch() {
    const patch:Partial<Draft>={};
    const nextErrors:Record<RecipientFieldName,string>={to:'',cc:'',bcc:''};
    let firstInvalid:RecipientFieldName|undefined;
    for(const [name] of recipientFields) {
      const result=commitRecipients(recipientValues(draft[name]),recipientInputs[name]);
      if(result.error){nextErrors[name]=result.error;firstInvalid||=name;continue;}
      patch[name]=serializeRecipients(result.values);
    }
    setRecipientErrors(nextErrors);
    if(firstInvalid){requestAnimationFrame(()=>document.getElementById('composer-'+firstInvalid)?.focus());return null;}
    return patch;
  }
  function save(e:FormEvent){e.preventDefault();const patch=recipientPatch();if(!busy&&ready&&patch)onSave(patch);}
  function send(){const patch=recipientPatch();if(!busy&&ready&&patch)onSend(patch);}
  return <form ref={form} className="composer" onSubmit={save} aria-label="Редактор письма">
    <header className="composer-heading"><Action icon={IconArrowLeft} label="Свернуть редактор" onClick={onClose} disabled={busy}/><h2>{draft.replyToId?(draft.forward?'Переслать':'Ответить'):'Новое письмо'}</h2><span className="composer-local">{draft.draftId?'Черновик в Mox':'Новое письмо'}</span></header>
    <div className="composer-scroll">{(error||editorError)&&<div className="mail-feedback" role="alert">{error||editorError}</div>}<div className="composer-fields"><div className="composer-from-row"><span>От</span><span className="composer-from" role="note" aria-label="Адрес отправителя нельзя изменить">{from}</span></div>
      {recipientFields.map(([name,visibleLabel,label])=><RecipientField key={name} name={name} visibleLabel={visibleLabel} label={label} value={draft[name]} input={recipientInputs[name]} error={recipientErrors[name]} busy={busy} onChange={value=>onChange({[name]:value})} onInput={value=>setRecipientInputs(current=>({...current,[name]:value}))} onError={value=>setRecipientErrors(current=>({...current,[name]:value}))}/>)}
      <label className="composer-field"><span>Тема</span><input name="subject" aria-label="Тема" type="text" value={draft.subject} onChange={event=>onChange({subject:event.target.value})} autoComplete="off" disabled={busy}/></label>
    </div><div className="editor-tools" role="group" aria-label="Форматирование текста">
      {([['B','Полужирный',IconBold],['I','Курсив',IconItalic],['U','Подчёркнутый',IconUnderline],['UL','Маркированный список',IconList],['OL','Нумерованный список',IconListNumbers]] as const).map(([tag,label,Icon])=><Action key={tag} icon={Icon} label={label} onMouseDown={e=>e.preventDefault()} onClick={()=>format(tag)} aria-pressed={!!formats[tag]} disabled={busy||!ready}/>)}
      <span className="tool-separator"/><Action icon={IconLink} label="Добавить ссылку" disabled={busy||!ready} onMouseDown={e=>e.preventDefault()} onClick={()=>{savedRange.current=editor.current?.getSelection()?.cloneRange()||null;setLink(link===null?'':null);}}/>
      <span className="editor-history"><Action icon={IconUndo} label="Отменить" disabled={busy||!ready} onMouseDown={e=>e.preventDefault()} onClick={()=>editor.current?.undo().focus()}/><Action icon={IconArrowForwardUp} label="Повторить" disabled={busy||!ready} onMouseDown={e=>e.preventDefault()} onClick={()=>editor.current?.redo().focus()}/></span>
    </div>{link!==null&&<div className="composer-link"><label>Адрес ссылки<input type="url" value={link} autoFocus onChange={e=>setLink(e.target.value)} aria-invalid={!!linkError}/></label><button type="button" className="secondary" onClick={addLink}>Добавить</button><Action icon={IconX} label="Закрыть добавление ссылки" onClick={()=>setLink(null)}/>{linkError&&<p role="alert">{linkError}</p>}</div>}
      <div className="editor-surface" aria-busy={!ready}><div ref={root} className="rich-editor" role={ready?'textbox':undefined} aria-label={ready?'Текст письма':undefined} aria-multiline={ready?true:undefined} aria-hidden={!ready||undefined} aria-disabled={busy||!ready} spellCheck tabIndex={ready?0:-1} inert={busy||!ready||undefined}/>{!ready&&!editorError?<span className="editor-placeholder" role="status">Загрузка редактора…</span>:empty&&ready&&<span className="editor-placeholder" aria-hidden="true">Напишите сообщение…</span>}</div>
      {!!draft.files.length&&<ul className="composer-files" aria-label="Вложения">{draft.files.map((f,i)=><li key={i}><IconFileText size={22}/><span>{f.name}<small>{Math.ceil(f.size/1024)} КБ</small></span><Action icon={IconX} label={'Убрать вложение '+f.name} disabled={busy} onClick={()=>onChange({files:draft.files.filter((_,index)=>index!==i)} )}/></li>)}</ul>}
    </div><footer className="composer-footer"><div className="composer-actions"><button type="button" className="compose-button" disabled={busy||!ready} onClick={send}><IconSend size={21}/>{busy?'Выполняется…':'Отправить'}</button><button type="submit" className="secondary" disabled={busy||!ready}>Сохранить черновик</button><Action icon={IconPaperclip} label="Добавить вложения" disabled={busy} onClick={()=>fileInput.current?.click()}/><Action icon={IconX} label="Сбросить изменения редактора" disabled={busy} onClick={onDiscard}/><input ref={fileInput} className="sr-only" type="file" multiple aria-label="Файлы для письма" onChange={e=>{onChange({files:[...draft.files,...Array.from(e.target.files||[])]});e.target.value='';}}/></div><p>Черновик сохраняет текст, оформление и вложения. До 20 файлов, всего до 15 МБ.</p></footer>
  </form>;
}
