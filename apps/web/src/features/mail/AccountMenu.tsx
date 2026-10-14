'use client';
import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconArrowLeft, IconSettings } from '@/components/Icons';
export function AccountMenu({name,address,initials,busy,onSettings,onLogout}:{name:string;address:string;initials:string;busy:boolean;onSettings:()=>void;onLogout:()=>void}) {
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);root.current?.addEventListener('keydown',escape);
    const node=root.current;return()=>{document.removeEventListener('pointerdown',outside);node?.removeEventListener('keydown',escape);};
  },[open]);
  return <div ref={root} className="account-control" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
    <button ref={trigger} className="account" type="button" aria-label={'Аккаунт '+address} aria-expanded={open} aria-controls="account-actions" title={address} onClick={()=>setOpen(v=>!v)}><span className="avatar">{initials}</span><span className="account-copy"><strong>{name}</strong><small>{address}</small></span><IconChevronDown size={16}/></button>
    {open&&<div id="account-actions" className="account-menu" role="group" aria-label="Действия аккаунта"><p>{address}</p><button type="button" className="folder" onClick={()=>{setOpen(false);trigger.current?.focus();onSettings();}}><IconSettings size={22}/>Настройки</button><button type="button" className="folder" disabled={busy} onClick={()=>{setOpen(false);onLogout();}}><IconArrowLeft size={22}/>Выйти</button></div>}
  </div>;
}
