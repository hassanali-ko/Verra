import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('mobile controls stay reachable; calm settings persist without changing an arrangement',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/demo?visit=studio');
 const nav=page.getByRole('navigation',{name:'Mobile workspace'});await expect(nav).toBeVisible();
 const position=await nav.boundingBox();expect(position!.y+position!.height).toBeCloseTo(844,0);
 const before=await page.evaluate(()=>localStorage.getItem('verra-judge-demo-v1'));
 await page.getByRole('button',{name:'Calm mode',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-calm','on');
 expect(await page.evaluate(()=>localStorage.getItem('verra-judge-demo-v1'))).toBe(before);
 await page.getByRole('button',{name:'Review next step',exact:true}).click();await expect(page.getByRole('button',{name:'Approve sample question'})).toBeInViewport();
 await expect(page.getByText('Your hard requirement is unchanged.',{exact:false})).toBeVisible();expect(await nav.boundingBox()).toEqual(position);
 await page.getByRole('button',{name:'Reading preferences',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await page.getByLabel('Quiet layout',{exact:false}).uncheck();await expect(page.locator('html')).toHaveAttribute('data-calm','off');await expect(page.locator('html')).toHaveAttribute('data-reading','comfortable');await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Reading preferences',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Calm mode',exact:true}).click();await page.reload();await expect(page.locator('html')).toHaveAttribute('data-calm','on');
 await page.getByRole('button',{name:'More workspace options',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Connections',exact:true}).click();await expect(page.getByRole('heading',{name:'Connections',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Your visits',exact:true}).click();await page.getByRole('button',{name:'Arrange a visit',exact:true}).click();
 const save=page.getByRole('button',{name:'Save sample visit'});await expect(save).toBeInViewport();const saveRect=await save.boundingBox();const navRect=await nav.boundingBox();expect(saveRect!.y+saveRect!.height).toBeLessThanOrEqual(navRect!.y);
 await page.getByLabel('A name for this plan').fill('A comfortable library visit');await page.getByLabel('Fictional venue').fill('Example library');await save.click();await expect(page.getByRole('heading',{name:'A comfortable library visit',exact:true})).toBeVisible();
});
test('calm mode is readable in both themes on narrow phones and desktop',async({page})=>{
 for(const width of [1440,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.goto('/demo?visit=studio');await page.evaluate(t=>{localStorage.setItem('verra-appearance',t);document.documentElement.dataset.theme=t;},theme);
  if(await page.getByRole('button',{name:'Calm mode',exact:true}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'Calm mode',exact:true}).click();
  for(const path of ['/demo?visit=studio&tab=evidence','/']){
   await page.goto(path);await expect(page.locator('html')).toHaveAttribute('data-calm','on');
   expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,`${path} ${width} ${theme}`).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${path} ${width} ${theme}`).toBe(true);
   await page.screenshot({path:`test-results/comfort-${path==='/'?'landing':'visit'}-${theme}-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'Reading preferences',exact:true}).click();expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await page.keyboard.press('Escape');
 }
});
