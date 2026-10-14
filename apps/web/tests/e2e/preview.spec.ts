import {test,expect} from '@playwright/test';
import {submitLogin} from './helpers';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3100';
test('isolated stand: typography, HTML isolation, responsive view and own admin',async({page})=>{
  const account='preview'+Date.now().toString(36),address=account+'@localhost',password='mailstack-local-only-2026';
  await page.goto('/admin');await page.getByLabel('Пароль',{exact:true}).fill('moxadmin');await submitLogin(page,'admin');
  const adminToken=(await (await page.request.get('/api/admin/session')).json()).csrfToken,adminHeaders={origin,'x-mailstack-csrf':adminToken};
  expect((await page.request.post('/api/admin/accounts',{headers:adminHeaders,data:{account,address,password}})).ok()).toBeTruthy();
  try{
    await page.goto('/mail');await page.getByLabel('Почтовый адрес',{exact:true}).fill(address);await page.getByLabel('Пароль',{exact:true}).fill(password);await submitLogin(page,'mail');
    const csrf=(await (await page.request.get('/api/mail/session')).json()).csrfToken,headers={origin,'x-mailstack-csrf':csrf};
    expect((await page.request.post('/api/mail/settings',{headers,data:{fullName:'Алиса',signature:'Алиса',showHTML:true}})).ok()).toBeTruthy();
    for(const [subject,text,html] of [['MailStack готов к проверке','Это локальный стенд MailStack.',''],['Письмо с оформлением','Текстовая версия','<h1>Письмо с оформлением</h1><p>HTML отображается в отдельной защищённой области.</p>']])expect((await page.request.post('/api/mail/send',{headers,data:{to:address,cc:'',bcc:'',subject,text,html,files:[]}})).ok()).toBeTruthy();
    await expect(page.locator('.mail-open').filter({hasText:'MailStack готов к проверке'})).toBeVisible({timeout:45000});
    await page.getByRole('button',{name:'Справа',exact:true}).click();await page.locator('.mail-open').filter({hasText:'MailStack готов к проверке'}).click();await expect(page.locator('.message-body')).toContainText('локальный стенд');await page.screenshot({path:'test-results/stand-desktop.png'});
    await page.locator('.mail-open').filter({hasText:'Письмо с оформлением'}).click();await expect(page.frameLocator('iframe').getByRole('heading',{name:'Письмо с оформлением'})).toBeVisible();expect(await page.locator('iframe').getAttribute('sandbox')).toBe('');
    await page.getByRole('button',{name:/^Аккаунт /}).click();await page.getByRole('button',{name:'Настройки',exact:true}).click();await expect(page.getByLabel('Отображаемое имя',{exact:true})).toHaveValue('Алиса');await page.getByRole('tab',{name:'Внешний вид',exact:true}).click();await page.getByLabel('Тема',{exact:true}).selectOption('dark');await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.frameLocator('iframe').getByRole('heading',{name:'Письмо с оформлением'})).toBeVisible();await page.screenshot({path:'test-results/stand-html-dark.png'});
    await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Назад к списку',exact:true})).toBeVisible();await page.getByRole('button',{name:'Назад к списку',exact:true}).click();await expect(page.locator('.mail-open').filter({hasText:'MailStack готов к проверке'})).toBeVisible();await page.screenshot({path:'test-results/stand-mobile.png'});
    await page.goto('/admin');await expect(page.getByRole('heading',{name:'Обзор',exact:true})).toBeVisible();await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/stand-admin.png'});
  }finally{expect((await page.request.post('/api/admin/accounts/remove',{headers:adminHeaders,data:{account,confirm:account}})).ok()).toBeTruthy();}
});
