export function pushSupported() {
  return window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
}
export async function browserSubscription() {
  if(!pushSupported())return null;
  const registration=await navigator.serviceWorker.getRegistration('/mail');
  return registration?await registration.pushManager.getSubscription():null;
}
export async function clearBrowserPush() {
  if(!pushSupported())return;
  const registration=await navigator.serviceWorker.getRegistration('/mail');
  registration?.active?.postMessage('clear-notifications');
  const sub=await registration?.pushManager.getSubscription();
  if(sub)await sub.unsubscribe();
}
export function applicationKey(key:string) {
  return Uint8Array.from(atob(key.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
}
