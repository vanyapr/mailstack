'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Modal, ErrorBox } from '@/components/Controls';
import type { API } from '@/lib/api';
import type { Snapshot } from '@/lib/mox/mail';
import { PushSettings } from './PushSettings';
const tabs=[['account','Аккаунт'],['appearance','Внешний вид'],['notifications','Уведомления'],['security','Безопасность']] as const;
type Tab=typeof tabs[number][0];
export function MailSettings({api,appearance,onClose,onSaved,onPasswordChanged,hasDraft}:{api:API;appearance:ReactNode;onClose:()=>void;onSaved:()=>void;onPasswordChanged:()=>void;hasDraft:boolean}) {
  const [tab,setTab]=useState<Tab>('account'),[name,setName]=useState(''),[signature,setSignature]=useState(''),[showHTML,setShowHTML]=useState(true),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [loaded,setLoaded]=useState(false),[revision,setRevision]=useState(0);
  const id=useId(),tablist=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');api.request<{settings:Snapshot['settings'];fullName:string}>('settings',undefined,controller.signal).then(data=>{setName(data.fullName);setSignature(data.settings.Signature);setShowHTML(data.settings.ShowHTML);setLoaded(true);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
  },[api.request,revision]);
  async function save(security=false){
    setError('');setNotice('');if(security&&hasDraft){setError('Сохраните или сбросьте открытый черновик перед сменой пароля.');return;}if(security&&password!==confirmation){setError('Пароли не совпадают.');return;}
    setBusy(true);try{if(security){await api.request('password',{password});setPassword('');setConfirmation('');onPasswordChanged();}else{await api.request('settings',{fullName:name,signature,showHTML});setNotice('Настройки сохранены.');onSaved();}}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Modal title="Настройки" className="settings-modal" onClose={()=>{if(!busy)onClose();}}>
    <div ref={tablist} className="settings-tabs" role="tablist" aria-label="Разделы настроек">{tabs.map(([key,label],index)=><button key={key} type="button" role="tab" id={`${id}-${key}`} aria-selected={tab===key} aria-controls={`${id}-panel-${key}`} tabIndex={tab===key?0:-1} onClick={()=>{setTab(key);setError('');setNotice('');}} onKeyDown={e=>{const next=e.key==='ArrowRight'?(index+1)%tabs.length:e.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:-1;if(next>=0){e.preventDefault();setTab(tabs[next][0]);tablist.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();setError('');setNotice('');}}}>{label}</button>)}</div>
    {error&&<ErrorBox message={error} retry={!loaded&&!loading?()=>setRevision(v=>v+1):undefined}/>}<div role="status" className="settings-notice">{loading?'Загрузка настроек…':notice}</div>
    <section role="tabpanel" id={`${id}-panel-account`} aria-labelledby={`${id}-account`} hidden={tab!=='account'}><form className="settings-form" onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||!loaded}><label>Отображаемое имя<input value={name} onChange={e=>setName(e.target.value)} maxLength={200} autoComplete="name"/></label><label>Подпись<textarea value={signature} onChange={e=>setSignature(e.target.value)} maxLength={10000}/></label><button className="compose-button">Сохранить настройки</button></fieldset></form></section>
    <section role="tabpanel" id={`${id}-panel-appearance`} aria-labelledby={`${id}-appearance`} hidden={tab!=='appearance'}><div className="settings-form">{appearance}<p className="setting-hint">Внешний вид сохраняется автоматически в этом браузере.</p></div></section>
    <section role="tabpanel" id={`${id}-panel-notifications`} aria-labelledby={`${id}-notifications`} hidden={tab!=='notifications'}>{tab==='notifications'&&<PushSettings api={api}/>}</section>
    <section role="tabpanel" id={`${id}-panel-security`} aria-labelledby={`${id}-security`} hidden={tab!=='security'}><form className="settings-form" onSubmit={e=>{e.preventDefault();void save(true);}}><fieldset disabled={busy||hasDraft}><label>Новый пароль<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Повторите пароль<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><p className="setting-hint">Не менее 12 символов. После смены пароля нужно войти снова.</p>{hasDraft&&<p className="setting-hint">Сохраните или сбросьте открытый черновик перед сменой пароля.</p>}<button className="compose-button">Изменить пароль</button></fieldset></form></section>
  </Modal>;
}
