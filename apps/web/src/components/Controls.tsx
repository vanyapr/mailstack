'use client';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { IconX, IconMail } from './Icons';
export function Action({icon:Icon=IconMail,label,children,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon?:typeof IconMail;label:string}) {
  return <button type="button" className={'action '+className} aria-label={label} title={label} {...props}><Icon size={22}/>{children}</button>;
}
export function Modal({title,onClose,children,className=''}:{title:string;onClose:()=>void;children:ReactNode;className?:string}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current,previous=document.activeElement as HTMLElement|null;
    dialog?.showModal();
    return()=>{dialog?.close();if(previous?.isConnected&&previous.getClientRects().length&&getComputedStyle(previous).visibility!=='hidden')previous.focus();};
  },[]);
  return <dialog ref={ref} className={'modal '+className} onCancel={e=>{e.preventDefault();onClose();}} aria-label={title}><header><h2>{title}</h2><Action icon={IconX} label="Закрыть" onClick={onClose}/></header>{children}</dialog>;
}
export function ErrorBox({message,retry}:{message:string;retry?:()=>void}) {
  return <div className="feedback feedback-error" role="alert"><span>{message}</span>{retry&&<button type="button" className="secondary" onClick={retry}>Повторить</button>}</div>;
}
