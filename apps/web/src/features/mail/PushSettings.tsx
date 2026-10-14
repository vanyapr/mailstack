'use client';
import { useEffect, useState } from 'react';
import type { API } from '@/lib/api';
import { ErrorBox } from '@/components/Controls';
import { pushSupported, browserSubscription, clearBrowserPush, applicationKey } from '@/lib/push/browser';
type Status={available:boolean;enabled:boolean;publicKey:string};
export function PushSettings({api}:{api:API}) {
  const [supported,setSupported]=useState<boolean|null>(null),[permission,setPermission]=useState<NotificationPermission>('default');
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const supported=pushSupported();setSupported(supported);if(!supported)return;
    const controller=new AbortController();setPermission(Notification.permission);setError('');setStatus(null);
    void browserSubscription().then(sub=>api.request<Status>('push',{action:'status',endpoint:sub?.endpoint||''},controller.signal)).then(setStatus).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[api.request,revision]);
  async function enable() {
    if(!status)return;
    // Call synchronously from the click so Safari retains the user activation.
    const granted=Notification.permission==='granted'?Promise.resolve<NotificationPermission>('granted'):Notification.requestPermission();
    setBusy(true);setError('');let created:PushSubscription|null=null;
    try {
      const permission=await granted;setPermission(permission);
      if(permission!=='granted')throw new Error(permission==='denied'?'Уведомления запрещены в настройках браузера. Разрешите их для этого сайта.':'Разрешение не выдано. Можно попробовать снова.');
      const registration=await navigator.serviceWorker.register('/mail-push-sw.js',{scope:'/mail',updateViaCache:'none'});
      if(!registration.active)await new Promise<void>((resolve,reject)=>{
        const worker=registration.installing||registration.waiting;if(!worker){reject(new Error('Не удалось запустить уведомления. Обновите страницу.'));return;}
        const timeout=setTimeout(()=>{worker.removeEventListener('statechange',change);reject(new Error('Не удалось запустить уведомления. Повторите попытку.'));},15000);
        function change(){if(worker!.state==='activated'){clearTimeout(timeout);worker!.removeEventListener('statechange',change);resolve();}else if(worker!.state==='redundant'){clearTimeout(timeout);worker!.removeEventListener('statechange',change);reject(new Error('Не удалось установить уведомления.'));}}
        worker.addEventListener('statechange',change);change();
      });
      let sub=await registration.pushManager.getSubscription();
      if(!sub){sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(status.publicKey)});created=sub;}
      await api.request('push',{action:'subscribe',subscription:sub.toJSON()});
      setStatus({...status,enabled:true});
    }catch(e){
      if(created)await created.unsubscribe().catch(()=>undefined);
      setError((e as Error).message);
    }finally{setBusy(false);}
  }
  async function disable() {
    setBusy(true);setError('');
    try{const sub=await browserSubscription();if(sub)await api.request('push',{action:'unsubscribe',endpoint:sub.endpoint});await clearBrowserPush();setStatus(status?{...status,enabled:false}:status);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="settings-form push-settings">
    <h3>Новые письма</h3>
    <p className="setting-hint">Уведомления приходят в этот браузер, даже когда вкладка MailStack закрыта. Тема, отправитель и текст письма в них не отображаются.</p>
    {error&&<ErrorBox message={error} retry={()=>setRevision(v=>v+1)}/>}
    <p role="status">{supported===null?'Проверка браузера…':!supported?'Этот браузер не поддерживает Push здесь. Откройте MailStack по HTTPS. На iPhone и iPad добавьте его на экран «Домой» и откройте оттуда.':!status?error?'Не удалось проверить подключение.':'Проверка подключения…':!status.available?'Push-уведомления ещё не настроены на сервере.':status.enabled?'Уведомления включены в этом браузере.':permission==='denied'?'Уведомления запрещены. Разрешите их в настройках сайта в браузере.':'Уведомления выключены в этом браузере.'}</p>
    {supported&&status?.available&&<button type="button" className={status.enabled?'secondary':'compose-button'} disabled={busy||(!status.enabled&&permission==='denied')} onClick={()=>void(status.enabled?disable():enable())}>{busy?'Подождите…':status.enabled?'Отключить уведомления':'Включить уведомления'}</button>}
    {supported&&permission==='denied'&&<button type="button" className="secondary" disabled={busy} onClick={()=>setRevision(v=>v+1)}>Проверить разрешение снова</button>}
    <p className="setting-hint">При выходе из аккаунта подписка этого браузера отключается. Доставка также зависит от разрешений браузера, сети и режима «Не беспокоить».</p>
  </div>;
}
