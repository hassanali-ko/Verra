import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {exampleVisit} from './database';

test('Python worker saves research through SQL and the owner can review source evidence',async({page,browser})=>{
 await page.goto('http://127.0.0.1:3121/enter/0');
 const input={...exampleVisit(),title:'Research verification '+randomUUID().slice(0,8)};
 const headers={Origin:'http://127.0.0.1:3120','Idempotency-Key':randomUUID()};
 const created=await page.request.post('/api/cases',{headers,data:input});expect(created.status()).toBe(201);const {caseId}=await created.json();
 const queued=await page.request.post(`/api/cases/${caseId}/start`,{headers,data:{version:1,requestKey:randomUUID()}});expect(queued.status()).toBe(202);const {jobId}=await queued.json();
 const {stdout}=await promisify(execFile)('.venv/bin/python',['agent/tests/worker_roundtrip.py',jobId],{cwd:process.cwd()});
 expect(JSON.parse(stdout).status).toBe('succeeded');
 await page.reload();await page.getByRole('button').filter({hasText:input.title}).click();
 await expect(page.getByRole('heading',{name:'Your venue check'})).toBeVisible();
 await expect(page.getByText('Synthetic verification result.',{exact:false})).toBeVisible();
 await expect(page.getByRole('link',{name:'Synthetic venue test page'})).toHaveAttribute('href','https://example.org/');
 await expect(page.locator('.research-next pre')).toContainText('Step-free route');
 await expect(page.locator('.research-next pre')).not.toContainText('quiet place');
 await expect(page.getByText('It has not been sent.',{exact:false})).toBeVisible();
 const data=await (await page.request.get('/api/snapshot')).json();
 expect(data.jobs.every((j:object)=>!Object.hasOwn(j,'lease_owner'))).toBe(true);
 const other=await browser.newContext();const stranger=await other.newPage();await stranger.goto('http://127.0.0.1:3121/enter/1');
 const exportOther=await (await stranger.request.get('/api/export')).json();expect(exportOther.workspace.reports.some((r:{case_id:string})=>r.case_id===caseId)).toBe(false);await other.close();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const theme of ['Light','Dark']){
   if(await page.locator('html').getAttribute('data-theme')!==theme.toLowerCase())await page.getByRole('button',{name:`Use ${theme.toLowerCase()} theme`,exact:true}).click();
   expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.locator('.research-report').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/research-${width}.png`});
 }
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancel arrangement',exact:true}).click();
 await expect(page.getByText('This draft is unavailable while the visit',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Copy inquiry draft',exact:true})).toHaveCount(0);
});
