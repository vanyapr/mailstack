'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
export type Auth={authenticated:boolean;csrfToken:string;username?:string};
export class APIError extends Error {constructor(public status:number,message:string){super(message);}}
export type API={request:<T>(path:string,body?:unknown,signal?:AbortSignal)=>Promise<T>};
export function useAuth(role:'mail'|'admin') {
  const [auth,setAuth]=useState<Auth|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const csrf=useRef('');
  const accept=useCallback((value:Auth|null)=>{csrf.current=value?.csrfToken||'';setAuth(value);},[]);
  const request=useCallback(async <T,>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>=>{
    let response:Response;
    try {response=await fetch('/api/'+role+'/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json','x-mailstack-csrf':csrf.current},body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'});}
    catch(e){if(e instanceof Error&&e.name==='AbortError')throw e;throw new APIError(0,'Нет соединения. Проверьте сеть и повторите.');}
    const data=await response.json().catch(()=>null);
    if(!response.ok){if(response.status===401&&path!=='login')accept(null);throw new APIError(response.status,data?.error||'Не удалось выполнить запрос.');}
    return data as T;
  },[role,accept]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');request<Auth>('session',undefined,controller.signal).then(accept).catch(e=>{if(e instanceof APIError&&e.status===401)accept(null);else if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[request,accept,revision]);
  return {auth,accept,loading,error,request,retry:()=>setRevision(r=>r+1)};
}
