import {expect,type Page} from '@playwright/test';
// Integration and UI suites share one loopback IP. Respect the real rate limit;
// never disable it or retry wrong credentials/server failures.
export async function submitLogin(page:Page,role:'mail'|'admin'){
  for(let attempt=0;attempt<2;attempt++){
    const response=page.waitForResponse(r=>r.url().endsWith('/api/'+role+'/login')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Войти',exact:true}).click();const result=await response;
    if(result.status()!==429){expect(result.status()).toBe(200);return;}
    await page.waitForTimeout((Math.min(60,Math.max(1,Number(result.headers()['retry-after'])||60))*1000)+100);
  }
  throw Error('Login remains rate limited after Retry-After.');
}
