import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('verra-demo-tour-v1','seen'));});
test('landing leads into an account-free judge flow with scoped decisions and persistent samples',async({page})=>{
 const protectedCalls:string[]=[];page.on('request',r=>{if(r.url().includes('/api/')||r.url().includes('/auth/'))protectedCalls.push(r.url());});
 await page.goto('/');await page.getByRole('button',{name:'Dinner out',exact:true}).click();await expect(page.getByRole('heading',{name:'A table for the evening'})).toBeVisible();
 await page.getByRole('link',{name:'Explore the judge demo',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Good plans start here.'})).toBeVisible();
 await page.getByRole('button',{name:'Open visit',exact:true}).click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await expect(page.getByRole('heading',{name:'Where the answer came from'})).toBeVisible();await expect(page.getByText('The unresolved detail',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Access needs',exact:true}).last().click();await page.getByLabel('May be shared in this sample arrangement').first().uncheck();await expect(page.getByRole('button',{name:'Approve question'})).toBeDisabled();await page.getByLabel('May be shared in this sample arrangement').first().check();
 await page.getByRole('button',{name:'Approve question'}).click();await expect(page.getByRole('status')).toContainText('No message was sent');
 await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByRole('button',{name:'Load example reply'})).toHaveCount(0);await page.getByRole('button',{name:'Resume',exact:true}).click();await page.getByRole('button',{name:'Load example reply'}).click();
 await page.getByRole('button',{name:'Review visit plan'}).click();await expect(page.getByRole('heading',{name:'Your visit plan'})).toBeVisible();await expect(page.getByText('A quieter arrival time is still unconfirmed.',{exact:false})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Your visit plan'})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download sample plan'}).click();expect((await download).suggestedFilename()).toBe('verra-sample-plan.json');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel arrangement'}).click();await expect(page.getByRole('status')).toContainText('sharing permission is revoked');await page.getByRole('button',{name:'Access needs',exact:true}).last().click();for(const box of await page.getByLabel('May be shared in this sample arrangement').all()){await expect(box).not.toBeChecked();await expect(box).toBeDisabled();}
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Reset demo',exact:true}).click();await expect(page.getByRole('heading',{name:'Good plans start here.'})).toBeVisible();expect(protectedCalls).toEqual([]);
});
test('sample creation, reusable needs, filter, decline and reset all work',async({page})=>{
 await page.goto('/demo');await page.getByRole('button',{name:'Access needs',exact:true}).click();await page.getByLabel('Sample functional needs',{exact:false}).fill('A place to rest\nStep-free access');await page.getByRole('button',{name:'Save sample needs'}).click();await expect(page.getByRole('status')).toContainText('Sample needs saved');
 await page.getByRole('button',{name:'Your visits',exact:true}).click();await page.getByRole('button',{name:'Arrange a visit',exact:true}).click();await page.getByLabel('A name for this plan').fill('A sample library visit');await page.getByLabel('Venue name').fill('Example library');await expect(page.getByLabel('What needs to work',{exact:false})).toHaveValue('A place to rest\nStep-free access');await page.getByRole('button',{name:'Save sample visit'}).click();await expect(page.getByRole('heading',{name:'A sample library visit'})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'A sample library visit'})).toBeVisible();
 await page.getByRole('button',{name:'Your visits',exact:true}).click();await page.getByLabel('Find a visit').fill('library');await expect(page.getByRole('heading',{name:'A sample library visit'})).toBeVisible();await expect(page.getByRole('heading',{name:'Clay, coffee & company'})).toHaveCount(0);
 await page.goto('/demo?visit=dining');await page.getByRole('button',{name:'Decline this alternative'}).click();await expect(page.getByRole('heading',{name:'Alternative declined'})).toBeVisible();await expect(page.getByRole('heading',{name:'A table away from speakers'})).toBeVisible();await page.getByRole('button',{name:'Reconsider the proposal'}).click();await expect(page.getByRole('button',{name:'Approve question'})).toBeVisible();
});
test('new website and judge screens pass light/dark desktop/mobile accessibility and overflow checks',async({page})=>{
 for(const width of [1440,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});await page.goto('/');await page.evaluate(t=>{localStorage.setItem('verra-appearance',t);document.documentElement.dataset.theme=t;},theme);
  for(const url of ['/','/demo','/demo?visit=studio&tab=evidence','/judges','/privacy','/signin']){
   await page.goto(url);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
   const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations,`${url} ${theme} ${width}`).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${url} ${theme} ${width}`).toBe(true);
   if(url==='/'||url==='/demo'||url.includes('evidence'))await page.screenshot({path:`test-results/${url==='/'?'landing':url==='/demo'?'demo':'decision'}-${theme}-${width}.png`,fullPage:true});
  }
 }
});
