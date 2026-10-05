// Demo capture — take 3. Replaces /tmp/pw/demo-capture.mjs.
//
// What changed vs the previous demo take:
//   · the pointer is parked in blank space at the moments the film shows it (E): the
//     board's empty column body, the channel's empty message area, the feed's blank
//     lower-right — never on a column label, a channel name or message body;
//   · the messages feed is scrolled for real during the window that lands in F5's
//     scene 2 (D), so the feed is not identical at 39s and 44s;
//   · every clip is recorded long enough for its composition slot (board ≥8s,
//     channel ≥7s, messages ≥9s, review ≥9s) — the old messages take was 7.8s for a
//     9s slot, so its last 1.2s froze on one frame.
import { createRequire } from 'module';
const { chromium } = createRequire('/tmp/pw/')('playwright');
import fs from 'fs';

const OUT = '/tmp/ws-demo3/shots';
const URL = 'http://127.0.0.1:3123';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(`${OUT}/webm`, { recursive: true });

const CURSOR = () => {
  const el = document.createElement('div'); el.id = '__cursor';
  el.style.cssText = 'position:fixed;z-index:2147483647;left:-60px;top:-60px;width:18px;height:18px;border:2px solid #141111;border-radius:50%;background:rgba(255,212,64,.9);pointer-events:none;box-shadow:2px 2px 0 rgba(20,17,17,.35)';
  document.body.appendChild(el);
  window.addEventListener('mousemove', e => { el.style.left = (e.clientX - 9) + 'px'; el.style.top = (e.clientY - 9) + 'px'; }, true);
};

async function take(name, fn) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: `${OUT}/webm`, size: { width: 1920, height: 1080 } }, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { localStorage.setItem('worksplice-locale', 'en'); localStorage.setItem('worksplice-task-view', 'board'); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(1400);
  await page.evaluate(CURSOR);
  await page.mouse.move(960, 560, { steps: 10 });
  await sleep(400);
  const t0 = Date.now();
  const marks = await fn(page, sleep, () => (Date.now() - t0) / 1000);
  const dur = (Date.now() - t0) / 1000;
  const v = await page.video();
  await ctx.close(); await browser.close();
  const path = await v.path();
  fs.writeFileSync(`${OUT}/${name}.txt`, `${path}\n${dur.toFixed(2)}\n${JSON.stringify(marks)}\n`);
  console.log(name, 'take~', dur.toFixed(1) + 's', JSON.stringify(marks), path);
}

/* D1 · board — Tasks tab, board view; the pointer drifts to blank column body and parks.
   The F3 bracket rides the column headers, so the pointer must never sit on a label. */
await take('d1-board', async (p, sleep, t) => {
  await p.click('text=Tasks'); await sleep(1600);
  const marks = { boardReady: +t().toFixed(2) };
  await p.mouse.move(420, 620, { steps: 26 }); await sleep(1400);
  marks.parked = +t().toFixed(2);
  await p.mouse.move(760, 730, { steps: 30 }); await sleep(1400);
  await p.mouse.move(760, 770, { steps: 8 }); await sleep(6600);
  marks.end = +t().toFixed(2);
  return marks;
});

/* D4 · channel — click a sidebar channel, let the room settle, park in blank space.
   (Was: cursor parked on the channel row it clicked, which sat on the name.) */
await take('d4-channel', async (p, sleep, t) => {
  await p.mouse.move(150, 300, { steps: 14 }); await sleep(400);
  await p.locator('text=stream-sync').first().click(); await sleep(1900);
  const marks = { opened: +t().toFixed(2) };
  await p.mouse.move(1450, 660, { steps: 26 }); await sleep(1200);
  await p.mouse.move(1700, 930, { steps: 20 }); await sleep(7000);
  marks.end = +t().toFixed(2);
  return marks;
});

/* D3 · messages — the #all feed, scrolled for real across the window F5's scene 2 shows
   (asset t 3–6s), so the feed is not identical at 39s and 44s. */
await take('d3-messages', async (p, sleep, t) => {
  await p.mouse.move(1700, 930, { steps: 14 }); await sleep(3000);
  const marks = { ready: +t().toFixed(2) };
  marks.scrollStart = +t().toFixed(2);
  for (let i = 0; i < 7; i++) { await p.mouse.wheel(0, 170); await sleep(430); }
  marks.scrollEnd = +t().toFixed(2);
  await sleep(900);
  await p.mouse.wheel(0, -110); await sleep(700);
  await p.mouse.move(1700, 945, { steps: 10 }); await sleep(6000);
  marks.end = +t().toFixed(2);
  return marks;
});

/* D2 · review — the In-review card up close; Approve then Reject hovered (no click). */
await take('d2-review', async (p, sleep, t) => {
  await p.click('text=Tasks'); await sleep(1300);
  await p.evaluate(() => { document.body.style.zoom = '1.5'; document.body.style.overflow = 'hidden'; });
  await sleep(900);
  const card = p.locator('text=unify the wording').first();
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(1100);
  const marks = { ready: +t().toFixed(2) };
  const approve = p.locator('button:has-text("Approve")').first();
  const ab = await approve.boundingBox().catch(() => null);
  if (ab) {
    await p.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2, { steps: 16 }); await sleep(1500);
    await p.mouse.move(ab.x + ab.width / 2 + 3, ab.y + ab.height / 2 + 3, { steps: 3 }); await sleep(900);
    marks.approveHover = +t().toFixed(2);
  }
  const reject = p.locator('button:has-text("Reject")').first();
  const rb = await reject.boundingBox().catch(() => null);
  if (rb) {
    await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 12 }); await sleep(1600);
    marks.rejectHover = +t().toFixed(2);
  }
  await sleep(7000);
  marks.end = +t().toFixed(2);
  return marks;
});
console.log('ALL DONE');
