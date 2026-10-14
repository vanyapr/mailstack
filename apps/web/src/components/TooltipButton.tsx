'use client';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

// A fixed portal keeps hints visible outside the scrolling folder list.
export function TooltipButton({label,tooltip=true,placement='top',children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{label:string;tooltip?:boolean;placement?:'top'|'right'}) {
  const ref=useRef<HTMLButtonElement>(null),id=useId();
  const [position,setPosition]=useState<{left:number;top:number;side:'top'|'right'}|null>(null);
  function show(){
    if(!tooltip||props.disabled||!ref.current)return;
    const r=ref.current.getBoundingClientRect();
    const side=placement==='right'&&r.right+240<window.innerWidth?'right':'top';
    setPosition({side,left:side==='right'?r.right+10:Math.max(120,Math.min(window.innerWidth-120,r.left+r.width/2)),top:side==='right'?Math.min(window.innerHeight-40,r.top+r.height/2):Math.max(40,r.top-8)});
  }
  useEffect(()=>{
    if(!position)return;
    const hide=()=>setPosition(null),escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();hide();}};
    window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);window.addEventListener('keydown',escape,true);
    return()=>{window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide);window.removeEventListener('keydown',escape,true);};
  },[position]);
  return <><button {...props} ref={ref} type={props.type||'button'} aria-label={label} aria-describedby={position?id:undefined} title={position?undefined:label} onMouseEnter={show} onMouseLeave={()=>setPosition(null)} onFocus={show} onBlur={()=>setPosition(null)} onClick={e=>{setPosition(null);props.onClick?.(e);}}>{children}</button>{position&&createPortal(<span id={id} role="tooltip" className={'button-tooltip tooltip-'+position.side} style={{left:position.left,top:position.top}}>{label}</span>,document.body)}</>;
}
