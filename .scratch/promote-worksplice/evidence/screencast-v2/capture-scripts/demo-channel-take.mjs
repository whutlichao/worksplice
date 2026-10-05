import { createRequire } from 'module';
const { chromium } = createRequire('/tmp/pw/')('playwright');
import fs from 'fs';
const OUT = '/tmp/ws-demo3/shots';
const URL = 'http://127.0.0.1:3123';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CURSOR = () => {
  const el = document.createElement('div'); el.id = '__cursor';
  el.style.cssText = 'position:fixed;z-index:2147483647;left:-60px;top:-60px;width:18px;height:18px;border:2px solid #141111;border-radius:50%;background:rgba(255,212,64,.9);pointer-events:none;box-shadow:2px 2px 0 rgba(20,17,17,.35)';
  document.body.appendChild(el);
  window.addEventListener('mousemove', e => { el.style.left = (e.clientX - 9) + 'px'; el.style.top = (e.clientY - 9) + 'px'; }, true);
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1920,height:1080}, recordVideo:{dir:`${OUT}/webm`, size:{width:1920,height:1080}}, locale:'en-US' });
const page = await ctx.newPage();
await page.addInitScript(() => { localStorage.setItem('worksplice-locale','en'); localStorage.setItem('worksplice-task-view','board'); });
await page.goto(URL, { waitUntil:'networkidle' });
await sleep(1400);
await page.evaluate(CURSOR);
await page.mouse.move(960, 560, { steps: 10 }); await sleep(400);
const t0 = Date.now(); const t = () => (Date.now()-t0)/1000;
await page.mouse.move(150, 300, { steps: 14 }); await sleep(400);
await page.locator('text=stream-sync').first().click(); await sleep(1900);
const marks = { opened: +t().toFixed(2) };
// the channel's message list is full, so park in the blank header band that stays inside
// the F3 plate rect (x 240..1680, y 130..810) — never over a message line or a channel name
await page.mouse.move(1000, 160, { steps: 24 }); await sleep(900);
await page.mouse.move(1000, 158, { steps: 6 }); await sleep(11000);
marks.end = +t().toFixed(2);
const v = await page.video();
await ctx.close(); await browser.close();
const p = await v.path();
fs.writeFileSync(`${OUT}/d4-channel.txt`, `${p}\n${t().toFixed(2)}\n${JSON.stringify(marks)}\n`);
console.log('channel take', t().toFixed(1)+'s', p, JSON.stringify(marks));
