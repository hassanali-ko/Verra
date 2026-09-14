import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT = process.env.OUT || 'gallery';
const BASE = process.env.BASE || 'https://theverra.vercel.app';

const shots = [
  { name: '01-landing',         url: '/',       w: 1440, h: 900, theme: 'light' },
  { name: '02-demo-overview',   url: '/demo',   w: 1440, h: 900, theme: 'light', skipTour: true },
  { name: '03-judges-guide',    url: '/judges', w: 1440, h: 900, theme: 'light' },
  { name: '04-signin',          url: '/signin', w: 1440, h: 900, theme: 'light' },
  { name: '05-landing-mobile',  url: '/',       w: 390,  h: 844, theme: 'light', mobile: true },
  { name: '06-demo-mobile',     url: '/demo',   w: 390,  h: 844, theme: 'light', mobile: true, skipTour: true },
  { name: '07-landing-dark',    url: '/',       w: 1440, h: 900, theme: 'dark' },
  { name: '08-demo-dark',       url: '/demo',   w: 1440, h: 900, theme: 'dark', skipTour: true },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
    isMobile: !!s.mobile,
    hasTouch: !!s.mobile,
  });
  const page = await ctx.newPage();
  // set the theme before first paint, the app reads this on load
  await page.addInitScript((t) => {
    try { localStorage.setItem('verra-appearance', t); } catch {}
  }, s.theme);
  await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1200);

  if (s.skipTour) {
    const skip = page.getByRole('button', { name: /skip tour|close/i }).first();
    if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(700); }
  }
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  console.log('shot', s.name, `${s.w}x${s.h}`, s.theme);
  await ctx.close();
}
await browser.close();
console.log('done');
