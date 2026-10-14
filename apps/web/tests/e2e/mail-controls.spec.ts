import {test,expect} from '@playwright/test';
import {submitLogin} from './helpers';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3100';

test('mail controls: server flags, virtual folder, errors, spam and narrow screens',async({page,request})=>{
  // Avoid localserve's deliberately failing numeric/error address suffixes.
  const account='controls'+Date.now().toString(36)+'-mail',address=account+'@localhost',password='mailstack-local-only-2026';
  await page.goto('/admin');await page.getByLabel('Пароль',{exact:true}).fill('moxadmin');await submitLogin(page,'admin');
  const admin=(await (await page.request.get('/api/admin/session')).json()).csrfToken,adminHeaders={origin,'x-mailstack-csrf':admin};
  expect((await page.request.post('/api/admin/accounts',{headers:adminHeaders,data:{account,address,password}})).ok()).toBeTruthy();
  try{
    // Stage real mail before opening the UI. Send acceptance is not delivery;
    // verify all fixtures in Mox, independently of the browser's live updates.
    const subjects=['Отметка во входящих','Отметка в архиве','Без отметки'];
    const fixtureLogin=await request.post('/api/mail/login',{headers:{origin},data:{username:address,password}});
    expect(fixtureLogin.ok()).toBeTruthy();
    const fixtureHeaders={origin,'x-mailstack-csrf':(await fixtureLogin.json()).csrfToken};
    for(const subject of subjects){
      const sent=await request.post('/api/mail/send',{headers:fixtureHeaders,data:{to:address,cc:'',bcc:'',subject,text:'Тестовые данные локального стенда.',html:'',files:[]}});
      expect(sent.ok()).toBeTruthy();
    }
    await expect.poll(async()=>{
      const response=await request.get('/api/mail/snapshot');expect(response.ok()).toBeTruthy();
      return (await response.json()).mails.map((mail:{subject:string})=>mail.subject).sort();
    },{timeout:45000,message:'Mox must deliver all three control fixtures before UI login'}).toEqual([...subjects].sort());
    expect((await request.post('/api/mail/logout',{headers:fixtureHeaders,data:{}})).ok()).toBeTruthy();
    await page.goto('/mail');await page.getByLabel('Почтовый адрес',{exact:true}).fill(address);await page.getByLabel('Пароль',{exact:true}).fill(password);await submitLogin(page,'mail');
    const csrf=(await (await page.request.get('/api/mail/session')).json()).csrfToken,headers={origin,'x-mailstack-csrf':csrf};
    const post=async(path:string,data:unknown)=>{const result=await page.request.post('/api/mail/'+path,{headers,data});expect(result.ok()).toBeTruthy();return result.json();};
    const row=(subject:string)=>page.locator('.mail-row').filter({has:page.locator('.row-subject',{hasText:subject})});
    for(const subject of subjects)await expect(row(subject)).toBeVisible();
    const firstRow=row('Отметка во входящих');
    const checkbox=await firstRow.getByRole('checkbox').boundingBox(),star=await firstRow.locator('.row-star').boundingBox();
    expect(checkbox).not.toBeNull();expect(star).not.toBeNull();
    expect(Math.abs(checkbox!.x+checkbox!.width/2-star!.x-star!.width/2)).toBeLessThan(1);
    expect(star!.y).toBeGreaterThanOrEqual(checkbox!.y+checkbox!.height);
    await firstRow.locator('.row-star').click();await expect(firstRow.locator('.row-star')).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('heading',{name:'Выберите письмо',exact:true})).toBeVisible();
    await firstRow.locator('.row-star').press('Space');await expect(firstRow.locator('.row-star')).toHaveAttribute('aria-pressed','false');
    await expect(page.getByRole('button',{name:'Настройки',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:/^Аккаунт /}).click();
    await expect(page.locator('#account-actions button')).toHaveText(['Настройки','Выйти']);
    await page.getByRole('button',{name:'Настройки',exact:true}).click();await expect(page.getByRole('dialog',{name:'Настройки',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    const snapshot=await (await page.request.get('/api/mail/snapshot')).json();
    const archive=snapshot.folders.find((f:{kind:string})=>f.kind==='archive').id;
    const archived=snapshot.mails.find((m:{subject:string})=>m.subject==='Отметка в архиве').id;
    await post('move',{ids:[archived],folder:archive});await post('flags',{ids:[archived],flag:'\\flagged',enabled:true});
    await row('Отметка во входящих').locator('.mail-open').click();
    const readerFlag=page.getByRole('button',{name:'Отметить письмо',exact:true});
    await readerFlag.click();await expect(readerFlag).toHaveAttribute('aria-pressed','true');
    await expect(row('Отметка во входящих').getByRole('button',{name:'Отметить: Отметка во входящих',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.reload();await expect(row('Отметка во входящих').locator('.row-star')).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Отмеченные',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Отмеченные',exact:true})).toBeVisible();
    await expect(page.locator('.mail-row')).toHaveCount(2);
    await expect(row('Отметка в архиве')).toBeVisible();await expect(row('Без отметки')).toHaveCount(0);
    await page.getByRole('searchbox').fill('subject:"в архиве"');await expect(page.locator('.mail-row')).toHaveCount(1);await expect(row('Отметка в архиве')).toBeVisible();
    await page.getByRole('searchbox').fill('');await expect(page.locator('.mail-row')).toHaveCount(2);
    await row('Отметка в архиве').locator('.row-star').click();await expect(row('Отметка в архиве')).toHaveCount(0);
    await row('Отметка во входящих').locator('.mail-open').click();
    await page.screenshot({path:'test-results/controls-marked-desktop.png'});
    await readerFlag.click();await expect(page.locator('.mail-row')).toHaveCount(0);await expect(readerFlag).toHaveCount(0);
    await page.getByRole('button',{name:'Входящие',exact:true}).click();
    // A rejected write must leave both controls unmarked and show the error.
    await row('Отметка во входящих').locator('.mail-open').click();
    await page.route('**/api/mail/flags',route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Проверка отказа сервера'})}));
    await readerFlag.click();await expect(page.locator('.mail-feedback[role=alert]')).toContainText('Проверка отказа');
    await expect(readerFlag).toHaveAttribute('aria-pressed','false');await expect(row('Отметка во входящих').locator('.row-star')).toHaveAttribute('aria-pressed','false');
    await page.unroute('**/api/mail/flags');
    await row('Без отметки').getByRole('checkbox').check();
    // Reader Spam acts on the open message, even with another row selected.
    await page.locator('.message-toolbar').getByRole('button',{name:'Спам',exact:true}).click();
    await expect(row('Отметка во входящих')).toHaveCount(0);await expect(row('Без отметки')).toBeVisible();
    await page.getByRole('button',{name:'Спам',exact:true}).click();await row('Отметка во входящих').locator('.mail-open').click();
    await page.getByRole('button',{name:'Отметить письмо',exact:true}).click();
    await page.getByRole('button',{name:'Отмеченные',exact:true}).click();await expect(row('Отметка во входящих')).toBeVisible();
    await row('Отметка во входящих').locator('.mail-open').click();
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});await expect(page.getByRole('button',{name:'Не спам',exact:true})).toBeVisible();
      expect(await page.locator('.message-toolbar').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      await page.screenshot({path:`test-results/controls-mobile-${width}.png`});
    }
    await page.getByRole('button',{name:'Не спам',exact:true}).click();
    await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Входящие',exact:true}).click();await expect(row('Отметка во входящих')).toBeVisible();
    await row('Без отметки').getByRole('checkbox').check();await page.getByRole('button',{name:'В спам выбранные',exact:true}).click();await expect(row('Без отметки')).toHaveCount(0);
    await page.getByRole('button',{name:'Спам',exact:true}).click();await expect(row('Без отметки')).toBeVisible();
  }finally{
    expect((await page.request.post('/api/admin/accounts/remove',{headers:adminHeaders,data:{account,confirm:account}})).ok()).toBeTruthy();
  }
});
