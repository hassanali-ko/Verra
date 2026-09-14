import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('first visit offers a keyboard-accessible tour that can be replayed without resetting progress',async({page})=>{
 await page.goto('/demo');const tour=page.getByRole('dialog',{name:'A visit, with the details taken care of.'});await expect(tour).toBeVisible();
 const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('verra-judge-demo-v1')||'null'));
 await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Start with what needs to work');
 await page.getByRole('button',{name:'Back',exact:true}).click();await expect(tour).toBeVisible();
 await page.keyboard.press('Escape');await expect(tour).not.toBeVisible();await expect(page.getByRole('button',{name:'Replay tour',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('verra-judge-demo-v1')||'null'))).toEqual(original);
 await page.reload();await expect(page.locator('dialog[open]')).toHaveCount(0);
 await page.getByRole('button',{name:'Replay tour',exact:true}).click();
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'Explore this visit'}).click();await expect(page.getByRole('heading',{name:'Clay, coffee & company',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('verra-judge-demo-v1')||'null'))).toEqual(original);
});

test('companion answers from the selected visit and opens relevant evidence without sending requests',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('verra-demo-tour-v1','seen'));
 const requests:string[]=[];page.on('request',req=>{if(req.url().includes('/api/'))requests.push(req.url());});
 await page.goto('/demo?visit=studio');await page.getByRole('button',{name:'Ask the demo companion'}).click();
 const dialog=page.getByRole('dialog',{name:'Let’s look at the details.'});await dialog.getByRole('button',{name:'What still needs an answer?',exact:true}).click();
 await expect(dialog.locator('.companion-answer')).toContainText('lift is unavailable');
 await dialog.getByRole('button',{name:'Compare the evidence'}).click();await expect(page.getByRole('heading',{name:'Where the answer came from'})).toBeVisible();
 await page.goto('/demo?visit=gallery');await page.getByRole('button',{name:'Ask the demo companion'}).click();await dialog.getByLabel('Your question').fill('Are all needs confirmed?');await dialog.getByRole('button',{name:'Ask about this visit'}).click();await expect(dialog.locator('.companion-answer')).toContainText('Still unanswered: A quiet place near the exit');
 expect(requests).toEqual([]);
});

test('accessibility preferences preserve visit state and stay readable in both themes at narrow widths',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('verra-demo-tour-v1','seen'));
 await page.goto('/demo?visit=studio');await expect.poll(()=>page.evaluate(()=>localStorage.getItem('verra-judge-demo-v1'))).not.toBeNull();const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('verra-judge-demo-v1')||'null'));
 await page.getByRole('button',{name:'Accessibility and reading preferences',exact:true}).click();
 const dialog=page.getByRole('dialog');for(const name of ['Colour-blind support','Stronger contrast','Underline links'])await dialog.getByLabel(name,{exact:false}).check();
 await dialog.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Calm mode',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-color-support','on');await expect(page.locator('html')).toHaveAttribute('data-contrast','strong');
 await page.reload();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('verra-judge-demo-v1')||'null'))).toEqual(original);
 for(const width of [320,390,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Accessibility and reading preferences',exact:true}).click();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await page.keyboard.press('Escape');
 }
});

test('read-aloud uses a local voice only, supports pause and stop, and stops after a page change',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('verra-demo-tour-v1','seen');
  const calls:{text:string;voice:string;rate:number}[]=[];const actions:string[]=[];
  Object.assign(window,{__speechCalls:calls,__speechActions:actions});
  class Utterance{text:string;voice:any;rate=1;lang='';onend:any;onerror:any;constructor(text:string){this.text=text;}}
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'Device voice',voiceURI:'local',lang:'en-US',localService:true},{name:'Remote voice',voiceURI:'remote',lang:'en-US',localService:false}],addEventListener:()=>{},removeEventListener:()=>{},speak:(u:Utterance)=>calls.push({text:u.text,voice:u.voice.voiceURI,rate:u.rate}),cancel:()=>actions.push('cancel'),pause:()=>actions.push('pause'),resume:()=>actions.push('resume')},configurable:true});
 });
 await page.goto('/demo?visit=studio');expect(await page.evaluate(()=>(window as any).__speechCalls.length)).toBe(0);
 await page.getByRole('button',{name:'Accessibility and reading preferences',exact:true}).click();
 await expect(page.getByLabel('Reading voice')).not.toContainText('Remote voice');await page.getByLabel('Reading speed').selectOption('0.8');await page.getByRole('button',{name:'Read this page',exact:true}).click();
 const player=page.getByRole('region',{name:'Read-aloud controls'});await expect(player).toBeVisible();
 const calls=await page.evaluate(()=>(window as any).__speechCalls);expect(calls[0].voice).toBe('local');expect(calls[0].rate).toBe(.8);expect(calls[0].text).toContain('Clay, coffee');expect(calls[0].text).not.toContain('Reading speed');
 await player.getByRole('button',{name:'Pause reading'}).click();await player.getByRole('button',{name:'Resume reading'}).click();await player.getByRole('button',{name:'Stop reading'}).click();await expect(player).not.toBeVisible();
 await page.getByRole('button',{name:'Accessibility and reading preferences',exact:true}).click();await page.getByRole('button',{name:'Read this page',exact:true}).click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await expect(player).not.toBeVisible();
});

test('tour and companion are readable on mobile and respect reduced motion',async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/demo');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 expect(await page.locator('.tour-scene').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.screenshot({path:'test-results/verra-tour-mobile.png'});await page.getByRole('button',{name:'Skip tour'}).click();
 await page.getByRole('button',{name:'Ask the demo companion'}).click();await page.getByRole('button',{name:'What can I try next?',exact:true}).click();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/verra-companion-mobile.png'});
});
