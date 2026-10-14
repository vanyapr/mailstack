import {test,expect} from '@playwright/test';
import {submitLogin} from './helpers';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3100';

test('messages delivered between initial snapshot and SSE connection appear without refresh',async({page})=>{
  const account='sync'+Date.now().toString(36)+'-mail',address=account+'@localhost',password='mailstack-local-only-2026';
  await page.goto('/admin');await page.getByLabel('Пароль',{exact:true}).fill('moxadmin');await submitLogin(page,'admin');
  const admin=(await (await page.request.get('/api/admin/session')).json()).csrfToken,adminHeaders={origin,'x-mailstack-csrf':admin};
  expect((await page.request.post('/api/admin/accounts',{headers:adminHeaders,data:{account,address,password}})).ok()).toBeTruthy();
  let release!:()=>void;const connected=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/mail/events?*',async route=>{await connected;await route.continue();});
  try{
    await page.goto('/mail');await page.getByLabel('Почтовый адрес',{exact:true}).fill(address);await page.getByLabel('Пароль',{exact:true}).fill(password);await submitLogin(page,'mail');
    await expect(page.getByRole('region',{name:'Список писем'})).toHaveAttribute('aria-busy','false');
    await expect(page.locator('.mail-row')).toHaveCount(0);
    const csrf=(await (await page.request.get('/api/mail/session')).json()).csrfToken,headers={origin,'x-mailstack-csrf':csrf};
    const subject='Доставка до подключения SSE';
    expect((await page.request.post('/api/mail/send',{headers,data:{to:address,cc:'',bcc:'',subject,text:'Только локальная приёмка.',html:'',files:[]}})).ok()).toBeTruthy();
    await expect.poll(async()=>{
      const response=await page.request.get('/api/mail/snapshot');expect(response.ok()).toBeTruthy();
      return (await response.json()).mails.map((mail:{subject:string})=>mail.subject);
    },{timeout:45000,message:'Mox must confirm delivery before the UI assertion'}).toContain(subject);
    const stream=page.waitForResponse(response=>response.url().includes('/api/mail/events?')&&response.status()===200);
    release();await stream;
    // The product must reconcile the initial SSE snapshot. No reload, UI refresh
    // or minute-long fallback can satisfy this assertion.
    await expect(page.locator('.mail-open').filter({hasText:subject})).toBeVisible();
  }finally{
    release();
    expect((await page.request.post('/api/admin/accounts/remove',{headers:adminHeaders,data:{account,confirm:account}})).ok()).toBeTruthy();
  }
});
