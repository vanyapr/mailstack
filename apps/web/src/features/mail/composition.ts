import type { Message } from '@/lib/mox/mail';
import { newDraft, type Draft } from './Composer';
export type ComposeKind='new'|'reply'|'all'|'forward';
export function hasDraftContent(draft:Draft,signature:string){
  return !!(draft.to.trim()||draft.cc.trim()||draft.bcc.trim()||draft.subject.trim()||draft.files.length||(draft.text.trim()&&draft.text.trim()!==signature.trim()));
}
export function compositionFor(kind:ComposeKind,source:Message|null,address:string,signature:string):Draft {
  const next=newDraft();next.text=signature?`\n\n${signature}`:'';
  if(kind==='new'||!source)return next;
  next.replyToId=source.id;next.forward=kind==='forward';
  next.to=kind==='forward'?'':source.replyTo||source.email;
  next.subject=(kind==='forward'?'Fwd: ':'Re: ')+source.subject.replace(/^(?:Re:|Fwd:)\s*/i,'');
  if(kind==='all'){
    const excluded=new Set([address,...next.to.split(',')].map(a=>a.trim().toLowerCase()));
    next.cc=[source.to,source.cc].join(',').split(',').map(a=>a.trim()).filter(a=>{const key=a.toLowerCase();if(!a||excluded.has(key))return false;excluded.add(key);return true;}).join(', ');
  }
  const date=new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(source.date));
  next.text+=`\n\n${date} ${source.sender} <${source.email}>:\n${source.texts.join('\n').split('\n').map(line=>'> '+line).join('\n')}`;
  return next;
}
