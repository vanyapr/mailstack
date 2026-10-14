import {test,expect} from '@playwright/test';
import {createECDH,randomBytes} from 'node:crypto';
import {submitLogin} from './helpers';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3100';
test('Push settings provision a real Mox hook, persist with a closed tab, disable and revoke at logout',async({page,context})=>{
  const account='push'+Date.now().toString(36),address=account+'@localhost',password='mailstack-local-only-2026';
  const ec=createECDH('prime256v1');ec.generateKeys();
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/fixture-'+account,keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  // Real service worker registration + real BFF/Mox. Simulate only the browser
  // provider so this regression never creates or sends external notifications.
  await context.addInitScript(sub=>{
    Object.defineProperty(Notification,'permission',{get:()=> 'granted'});
    const fake={...sub,toJSON:()=>sub,unsubscribe:async()=>true,options:{applicationServerKey:null}};
    PushManager.prototype.getSubscription=async()=>fake as unknown as PushSubscription;
    PushManager.prototype.subscribe=async()=>fake as unknown as PushSubscription;
  },sub);
  await page.goto('/admin');await page.getByLabel('Пароль',{exact:true}).fill('moxadmin');await submitLogin(page,'admin');
  const admin=(await (await page.request.get('/api/admin/session')).json()).csrfToken,adminHeaders={origin,'x-mailstack-csrf':admin};
  expect((await page.request.post('/api/admin/accounts',{headers:adminHeaders,data:{account,address,password}})).ok()).toBeTruthy();
  try {
    await page.goto('/mail');await page.getByLabel('Почтовый адрес',{exact:true}).fill(address);await page.getByLabel('Пароль',{exact:true}).fill(password);await submitLogin(page,'mail');
    async function settings(){await page.getByRole('button',{name:'Аккаунт '+address,exact:true}).click();await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('tab',{name:'Уведомления',exact:true}).click();}
    await settings();await page.getByRole('button',{name:'Включить уведомления',exact:true}).click();await expect(page.getByText('Уведомления включены в этом браузере.',{exact:true})).toBeVisible();
    await page.screenshot({path:'test-results/push-desktop.png'});
    await page.close();page=await context.newPage();await page.goto('/mail');await settings();await expect(page.getByText('Уведомления включены в этом браузере.',{exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});await expect(page.getByRole('tab',{name:'Уведомления',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'test-results/push-mobile.png'});
    await page.getByRole('button',{name:'Отключить уведомления',exact:true}).click();await expect(page.getByText('Уведомления выключены в этом браузере.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Включить уведомления',exact:true}).click();await expect(page.getByText('Уведомления включены в этом браузере.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Аккаунт '+address,exact:true}).click();await page.getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();
    await page.getByLabel('Почтовый адрес',{exact:true}).fill(address);await page.getByLabel('Пароль',{exact:true}).fill(password);await submitLogin(page,'mail');await settings();await expect(page.getByText('Уведомления выключены в этом браузере.',{exact:true})).toBeVisible();
  }finally{expect((await context.request.post('/api/admin/accounts/remove',{headers:adminHeaders,data:{account,confirm:account}})).ok()).toBeTruthy();}
});
