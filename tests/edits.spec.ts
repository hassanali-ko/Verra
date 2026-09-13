import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {exampleVisit} from './database';

const origin='http://127.0.0.1:3120';
test('edit a researched visit, review changed sharing and preserve earlier evidence',async({page})=>{
 await page.goto('http://127.0.0.1:3121/enter/0');
 const visit={...exampleVisit(),title:'Edit verification '+randomUUID().slice(0,8)},headers={Origin:origin,'Idempotency-Key':randomUUID()};
 const {caseId}=await(await page.request.post('/api/cases',{headers,data:visit})).json();
 const {jobId}=await(await page.request.post(`/api/cases/${caseId}/start`,{headers,data:{version:1,requestKey:randomUUID()}})).json();
 await promisify(execFile)('.venv/bin/python',['agent/tests/worker_roundtrip.py',jobId]);
 await page.reload();await page.getByRole('button').filter({hasText:visit.title}).click();
 await page.getByRole('button',{name:'Edit visit',exact:true}).click();await expect(page.getByRole('heading',{name:'Edit your visit'})).toBeVisible();
 await page.getByLabel('Date, if known').fill('2026-10-07');await page.getByLabel('Venue email, if known').fill('revised@example.org');
 for(const input of await page.getByLabel('May be shared with this venue').all())await expect(input).not.toBeChecked();
 await expect(page.getByLabel('Allow Verra to contact this venue', {exact:false})).not.toBeChecked();
 for(const entry of await page.locator('.need-entry textarea').all())if((await entry.inputValue()).startsWith('Step-free'))await entry.fill('Step-free route to the new room');
 await page.getByLabel('May be shared with this venue').first().check();await page.getByLabel('Allow Verra to contact this venue',{exact:false}).check();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Edit your visit'})).toBeVisible();
 await page.getByLabel('I reviewed the changed venue').check();
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:1000});
  for(const theme of ['light','dark']){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:`Use ${theme} theme`,exact:true}).click();
   expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
 }
 await page.setViewportSize({width:390,height:1000});
 const save=page.getByRole('button',{name:'Save changes',exact:true});await save.scrollIntoViewIfNeeded();
 const saveBox=await save.boundingBox(),navBox=await page.getByRole('navigation',{name:'Mobile workspace',exact:true}).boundingBox();expect(saveBox!.y+saveBox!.height).toBeLessThanOrEqual(navBox!.y);
 await save.click();await expect(page.getByRole('status')).toContainText('Changes saved');
 await expect(page.getByText('This check belongs to an earlier visit version.',{exact:false})).toBeVisible();
 await expect(page.locator('.research-findings')).toContainText('Step-free route to the classroom');
 await expect(page.locator('.research-findings')).not.toContainText('Step-free route to the new room');
 await expect(page.getByRole('button',{name:'Copy inquiry draft'})).toHaveCount(0);
 await page.locator('.revision-entry summary').click();await expect(page.locator('.revision-entry')).toContainText('access@example.org');
 await expect(page.getByRole('button',{name:'Queue information check'})).toBeVisible();
 await page.locator('.research-report').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/edited-research.png'});
 await page.reload();await page.getByRole('button').filter({hasText:visit.title}).click();await expect(page.getByText('2026-10-07 · Asia/Karachi',{exact:false})).toBeVisible();
});

test('a lost edit response retries the same save without duplicate history',async({page,browser})=>{
 await page.goto('http://127.0.0.1:3121/enter/0');
 const visit={...exampleVisit(),title:'Retry edit '+randomUUID().slice(0,8)},headers={Origin:origin,'Idempotency-Key':randomUUID()};
 const {caseId}=await(await page.request.post('/api/cases',{headers,data:visit})).json();await page.reload();await page.getByRole('button').filter({hasText:visit.title}).click();await page.getByRole('button',{name:'Edit visit'}).click();
 await page.getByLabel('A name for this plan').fill(visit.title+' revised');
 await page.route(`**/api/cases/${caseId}`,async route=>{await route.fetch();await route.abort();},{times:1});
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('.visit-form').getByRole('alert')).toContainText('Could not confirm');
 await expect(page.getByLabel('A name for this plan')).toBeDisabled();
 await page.getByRole('button',{name:'Retry the same save'}).click();await expect(page.getByRole('heading',{name:visit.title+' revised',exact:true})).toBeVisible();
 const data=await(await page.request.get('/api/snapshot')).json();expect(data.revisions.filter((r:{case_id:string})=>r.case_id===caseId)).toHaveLength(1);
 const other=await browser.newContext(),stranger=await other.newPage();await stranger.goto('http://127.0.0.1:3121/enter/1');
 const patch={version:2,visit,recipientReviewed:false};expect((await stranger.request.patch(`/api/cases/${caseId}`,{headers,data:patch})).status()).toBe(403);
 expect((await page.request.patch(`/api/cases/${caseId}`,{headers:{...headers,Origin:'https://example.org'},data:patch})).status()).toBe(403);
 expect((await(await stranger.request.get('/api/export')).json()).workspace.revisions.some((r:{case_id:string})=>r.case_id===caseId)).toBe(false);await other.close();
});

test('a concurrent change retains unsaved words and requires deliberate conflict recovery',async({page})=>{
 await page.goto('http://127.0.0.1:3121/enter/0');
 const visit={...exampleVisit(),title:'Conflict edit '+randomUUID().slice(0,8)},headers={Origin:origin,'Idempotency-Key':randomUUID()};
 const {caseId}=await(await page.request.post('/api/cases',{headers,data:visit})).json();await page.reload();await page.getByRole('button').filter({hasText:visit.title}).click();await page.getByRole('button',{name:'Edit visit'}).click();
 await page.getByLabel('A name for this plan').fill('My unsaved revision');
 await page.request.post(`/api/cases/${caseId}/control`,{headers,data:{version:1,action:'pause'}});
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('.visit-form').getByRole('alert')).toContainText('visit changed');await expect(page.getByLabel('A name for this plan')).toHaveValue('My unsaved revision');
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Open latest saved visit'}).click();await expect(page.getByLabel('A name for this plan')).toHaveValue('My unsaved revision');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Open latest saved visit'}).click();await expect(page.getByRole('heading',{name:visit.title,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible();
});
