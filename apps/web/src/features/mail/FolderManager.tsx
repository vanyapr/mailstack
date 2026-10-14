'use client';
import { useEffect, useRef, useState } from 'react';
import { Action, ErrorBox, Modal } from '@/components/Controls';
import { IconFolder, IconPencil, IconTrash, IconX, IconShield } from '@/components/Icons';
import type { API } from '@/lib/api';
import type { Folder } from '@/lib/mox/mail';

export function FolderManager({api,onClose,onChanged}:{api:API;onClose:()=>void;onChanged:(folders:Folder[],deleted?:number)=>void}) {
  const [folders,setFolders]=useState<Folder[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [name,setName]=useState(''),[rename,setRename]=useState<Folder|null>(null),[renamed,setRenamed]=useState(''),[deleting,setDeleting]=useState<Folder|null>(null);
  const input=useRef<HTMLInputElement>(null),createInput=useRef<HTMLInputElement>(null),deleteCancel=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const controller=new AbortController();
    api.request<{folders:Folder[]}>('folders',undefined,controller.signal).then(data=>setFolders(data.folders)).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[api.request]);
  useEffect(()=>{if(rename)input.current?.focus();},[rename]);
  useEffect(()=>{if(deleting)deleteCancel.current?.focus();},[deleting]);
  async function change(path:string,data:unknown,deleted?:number){
    setBusy(true);setError('');setNotice('');
    try{
      const result=await api.request<{folders:Folder[]}>(path,data);setFolders(result.folders);onChanged(result.folders,deleted);setRename(null);setDeleting(null);setName('');setNotice(deleted?'Папка удалена.':path.endsWith('rename')?'Название сохранено.':'Папка создана.');createInput.current?.focus();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Modal title="Папки" className="folders-modal" onClose={()=>{if(!busy)onClose();}}>
    <p className="setting-hint">Создавайте папки и меняйте их названия. Удалить можно только пустую папку без вложенных папок.</p>
    {error&&<ErrorBox message={error}/>}<p className="folder-notice" role="status">{loading?'Загрузка папок…':notice}</p>
    <form className="folder-create settings-form" onSubmit={e=>{e.preventDefault();void change('folders',{name});}}><label>Новая папка<input ref={createInput} required value={name} onChange={e=>setName(e.target.value)} maxLength={200} disabled={busy||loading} placeholder="Название папки"/></label><button className="compose-button" disabled={busy||loading||!name.trim()}>Создать</button></form>
    <ul className="managed-folders" aria-label="Управление папками" aria-busy={loading}>
      {folders.map(folder=>{
        const system=folder.kind!=='folder',children=folders.some(child=>child.name.startsWith(folder.name+'/'));
        return <li key={folder.id}>
          <div className="managed-folder"><IconFolder size={22}/><span className="managed-folder-copy"><strong>{folder.label}</strong><small>{system?'Системная папка':`${folder.total} писем`}</small></span>{system?<IconShield size={18} aria-label="Системная папка защищена"/>:<div className="folder-actions"><Action icon={IconPencil} label={'Переименовать '+folder.label} disabled={busy} onClick={()=>{setDeleting(null);setError('');setRename(folder);setRenamed(folder.name);}}/><Action icon={IconTrash} label={'Удалить '+folder.label} disabled={busy||folder.total>0||children} title={folder.total>0?'Сначала переместите письма в другую папку':children?'Сначала удалите или переместите вложенные папки':'Удалить '+folder.label} onClick={()=>{setRename(null);setError('');setDeleting(folder);}}/></div>}</div>
          {rename?.id===folder.id&&<form className="folder-rename settings-form" onSubmit={e=>{e.preventDefault();void change('folders/rename',{id:folder.id,name:renamed});}}><label>Название папки<input ref={input} value={renamed} onChange={e=>setRenamed(e.target.value)} maxLength={200} required disabled={busy}/></label><div className="folder-edit-actions"><button className="secondary" disabled={busy||!renamed.trim()||renamed===folder.name}>Сохранить название</button><Action icon={IconX} label="Отменить переименование" disabled={busy} onClick={()=>setRename(null)}/></div></form>}
          {deleting?.id===folder.id&&<div className="folder-delete-confirm"><p>Удалить пустую папку «{folder.label}»?</p><div className="folder-edit-actions"><button className="secondary danger-button" disabled={busy} onClick={()=>void change('folders/delete',{id:folder.id},folder.id)}>Удалить папку</button><button ref={deleteCancel} className="secondary" disabled={busy} onClick={()=>setDeleting(null)}>Отмена</button></div></div>}
        </li>;
      })}
    </ul>
  </Modal>;
}
