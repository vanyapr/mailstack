'use client';
import { useState, type FormEvent } from 'react';
import { IconMail, IconShield } from './Icons';
import { ErrorBox } from './Controls';
import type { API, Auth } from '@/lib/api';
export function Login({role,api,onLogin}:{role:'mail'|'admin';api:API;onLogin:(auth:Auth)=>void}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[show,setShow]=useState(false);
  const admin=role==='admin';const Icon=admin?IconShield:IconMail;
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));setBusy(true);setError('');try{onLogin(await api.request<Auth>('login',values));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="admin-view"><main className="login-page"><div className="login-brand">MailStack<span>{admin?'Управление почтой':'Ваша почта'}</span></div><section className="login-card"><span className="login-icon"><Icon size={30}/></span><h1>{admin?'Вход администратора':'Вход в почту'}</h1><p>{admin?'Пароль управления сервером задаётся при установке.':'Войдите с адресом вашего почтового ящика.'}</p><form className="action-form" onSubmit={submit}><fieldset disabled={busy}>
    {!admin&&<label className="field">Почтовый адрес<input name="username" type="email" required autoComplete="username" spellCheck={false} autoFocus maxLength={320}/></label>}
    <label className="field">Пароль<input name="password" id="current-password" type={show?'text':'password'} required autoComplete="current-password" maxLength={1024} autoFocus={admin}/></label>
    <label className="checkbox-field"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/>Показать пароль</label>
    <button className="primary" type="submit">{busy?'Проверка…':'Войти'}</button></fieldset>{error&&<ErrorBox message={error}/>}</form><p className="login-hint">Если забыли пароль, обратитесь к администратору сервера.</p>{admin&&<a href="/mail">Открыть почту</a>}</section><p className="login-footer">MailStack · Mox</p></main></div>;
}
