import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { exampleVisit } from './database';

test('real product routes: privacy, validation and safe retries',async({page,browser})=>{
 const anonymous=await page.request.get('/api/snapshot');expect(anonymous.status()).toBe(401);expect((await page.request.get('/api/export')).status()).toBe(401);
 await page.goto('http://127.0.0.1:3121/enter/0');await expect(page.getByRole('heading',{name:'Your visits',exact:true})).toBeVisible();
 const payload=exampleVisit();const key=randomUUID();const headers={Origin:'http://127.0.0.1:3120','Idempotency-Key':key};
 const response=await page.request.post('/api/cases',{data:payload,headers});expect(response.status()).toBe(201);const {caseId}=await response.json();
 const retry=await page.request.post('/api/cases',{data:payload,headers});expect((await retry.json()).caseId).toBe(caseId);
 const crossOrigin=await page.request.post('/api/cases',{data:payload,headers:{...headers,Origin:'https://example.org'}});expect(crossOrigin.status()).toBe(403);
 const invalid=await page.request.post('/api/cases',{data:{...payload,owner_id:randomUUID()},headers:{...headers,'Idempotency-Key':randomUUID()}});expect(invalid.status()).toBe(400);
 const startKey=randomUUID();const start=await page.request.post(`/api/cases/${caseId}/start`,{data:{version:1,requestKey:startKey},headers});expect(start.status()).toBe(202);
 const stale=await page.request.post(`/api/cases/${caseId}/control`,{data:{version:1,action:'cancel'},headers});expect(stale.status()).toBe(409);
 const other=await browser.newContext();const otherPage=await other.newPage();await otherPage.goto('http://127.0.0.1:3121/enter/1');
 const denied=await otherPage.request.post(`/api/cases/${caseId}/control`,{data:{version:2,action:'cancel'},headers});expect(denied.status()).toBe(403);
 const snapshot=await otherPage.request.get('/api/snapshot');expect((await snapshot.json()).cases.some((c:{id:string})=>c.id===caseId)).toBe(false);
 const exported=await page.request.get('/api/export');expect(exported.status()).toBe(200);expect((await exported.json()).workspace.cases.some((c:{id:string})=>c.id===caseId)).toBe(true);const otherExport=await otherPage.request.get('/api/export');expect((await otherExport.json()).workspace.cases.some((c:{id:string})=>c.id===caseId)).toBe(false);
 const cache=await page.request.get('/api/snapshot');expect(cache.headers()['cache-control']).toContain('no-store');await other.close();
});

test('personal journey: needs, visit, queue, pause, resume, cancel and sign out',async({page})=>{
 await page.goto('http://127.0.0.1:3121/enter/0');
 await page.getByRole('button',{name:'Access needs',exact:true}).click();
 await page.getByLabel('What should we call you?').fill('Local preview');
 await page.getByRole('textbox',{name:'Access needs',exact:false}).fill('A step-free route all the way to the room\nA quiet place to rest');
 await page.getByRole('button',{name:'Save my needs'}).click();await expect(page.getByRole('status')).toContainText('saved');
 await page.getByRole('button',{name:'Your visits',exact:true}).click();await page.getByRole('button',{name:'+ Arrange a visit'}).click();
 const title='Visit '+randomUUID().slice(0,8);await page.getByLabel('A name for this plan').fill(title);await page.getByLabel('Place or venue').fill('Example studio');
 await expect(page.getByRole('textbox',{name:'Requirement 1',exact:true})).toHaveValue('A step-free route all the way to the room');
 await expect(page.getByLabel('May be shared with this venue').first()).not.toBeChecked();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Access needs',exact:true}).click();await expect(page.getByLabel('A name for this plan')).toHaveValue(title);
 await page.getByRole('button',{name:'Save this visit'}).click();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Queue information check'}).click();await expect(page.getByRole('status')).toContainText('waiting for research');
 await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Resume',exact:true}).click();await page.getByRole('button',{name:'Queue information check'}).click();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancel arrangement'}).click();await expect(page.getByText('This arrangement is cancelled.',{exact:false})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:new RegExp(title)}).click();await expect(page.getByText('This arrangement is cancelled.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/signin/);expect((await page.request.get('/api/snapshot')).status()).toBe(401);
});

test('public and personal screens remain accessible at desktop and mobile widths',async({page})=>{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto('/');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/product-public-${width}.png`,fullPage:true});
  await page.goto('http://127.0.0.1:3121/enter/0');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'+ Arrange a visit'}).click();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/product-form-${width}.png`,fullPage:true});
 }
});
