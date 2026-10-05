// Real-run capture for F4 / F6 — take 3.
//
// Differences from /tmp/ws-v2/live-run2.mjs (which produced Chinese on-screen rows):
//   · the agent dir has NO defaultProvider/defaultModel, so worksplice does NOT auto-create
//     the secretary "Susan" — and without her, none of the Chinese channel-creation /
//     new-member event messages are posted at all
//     (lib/domain/collab/event-messages.ts returns early when findSusanMember() is undefined);
//   · an English AGENTS.md is installed both globally (agent dir) and in the run project;
//   · the wake prompt pins the language harder.
// Everything recorded is still a real run of the real product against a real pi agent.
import { createRequire } from 'module';
const REPO = '/Users/apple/orca/workspaces/worksplice/screencast-v2-rev2';
const Database = createRequire(REPO + '/')('better-sqlite3');
const pw = createRequire('/tmp/pw/')('playwright');
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3126';
const DATA = '/tmp/ws-v2r3/data';
const OUT = '/tmp/ws-v2r3/out';
const PROJECT = '/tmp/ws-v2r3/project';
const MODEL = process.env.RUN_MODEL || 'glm-5.3';
const PROVIDER = process.env.RUN_PROVIDER || 'new-api';
const DRY = process.argv.includes('--dry');

const T0 = Date.now();
const log = (...a) => { const line = `${((Date.now()-T0)/1000).toFixed(1)}s ${a.join(' ')}`; console.log(line); fs.appendFileSync(`${OUT}/timeline.log`, line+'\n'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = async (url, body) => { const r = await fetch(BASE+url, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)}); const j = await r.json().catch(()=>({})); return {status:r.status, j}; };
const db = () => new Database(path.join(DATA,'worksplice.db'), {readonly:true});

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

// agent + channel (created BEFORE recording so setup is not in the shot)
let r = await post('/api/members', { name: 'Alice', description: 'fixes splitFields in parser.js', provider: PROVIDER, modelId: MODEL, thinkingLevel: 'low' });
const ALICE = r.j.agent?.id; log('agent', r.status, ALICE, r.j.error || '');
if (!ALICE) { log('FATAL no agent'); process.exit(1); }
r = await post(`/api/members/${ALICE}/workspace`, { workspacePath: PROJECT }); log('workspace', r.status);
r = await post('/api/channels', { name:'parser-fix', description:'fixing the CSV split in parser.js', memberIds:[ALICE] });
const CH = r.j.channel?.id; log('channel', r.status, CH, r.j.error || '');
r = await post('/api/messages', { targetId: CH, content:'#parser-fix — we are fixing the CSV split in parser.js. Alice is on it.' }); log('context msg', r.status, r.j.message?.seq);
fs.writeFileSync(`${OUT}/ids.json`, JSON.stringify({ALICE, CH, MODEL, PROVIDER}, null, 2));

// sanity: the room must contain no CJK and no auto-created secretary before we even start
{ const d=db();
  const su = d.prepare("SELECT id,name FROM members WHERE name='Susan'").get();
  const rows = d.prepare('SELECT seq,target_id,content FROM messages').all();
  d.close();
  const bad = rows.filter(x => CJK.test(x.content));
  log('pre-flight: Susan present?', su ? su.id : 'no');
  log('pre-flight CJK rows (all channels):', bad.length, bad.map(x=>x.target_id+'#'+x.seq).join(',') || '(none)');
  if (su) { log('FATAL secretary exists — her event messages are Chinese'); process.exit(1); }
  if (bad.length) { log('FATAL room already has CJK'); process.exit(1); } }

// wait for quiet
let prev = {n:-1, s:0};
for (let i=0;i<240;i++) {
  const d=db();
  const n=d.prepare('SELECT COUNT(*) c FROM round_logs WHERE agent_id=?').get(ALICE).c;
  const st=d.prepare('SELECT status FROM members WHERE id=?').get(ALICE).status;
  d.close();
  if (n===prev.n && st!=='working') prev.s++; else prev.s=0;
  prev.n=n;
  if (prev.s>=10) { log('quiet; rounds='+n); break; }
  await sleep(500);
}

let browser=null, ctx=null, page=null;
if (!DRY) {
  globalThis.REC_START = Date.now(); log('RECORDING START');
  browser = await pw.chromium.launch();
  ctx = await browser.newContext({ viewport:{width:1920,height:1080}, recordVideo:{dir:`${OUT}/webm`, size:{width:1920,height:1080}}, locale:'en-US' });
  page = await ctx.newPage();
  await page.addInitScript(()=>localStorage.setItem('worksplice-locale','en'));
  await page.goto(BASE, { waitUntil:'networkidle' });
  await sleep(1200);
  await page.evaluate(() => {
    const el=document.createElement('div'); el.id='__cursor';
    el.style.cssText='position:fixed;z-index:2147483647;left:-60px;top:-60px;width:18px;height:18px;border:2px solid #141111;border-radius:50%;background:rgba(255,212,64,.9);pointer-events:none;box-shadow:2px 2px 0 rgba(20,17,17,.35)';
    document.body.appendChild(el);
    window.addEventListener('mousemove', e=>{ el.style.left=(e.clientX-9)+'px'; el.style.top=(e.clientY-9)+'px'; }, true);
  });
  // open the channel from the sidebar, then park the pointer in clear space below the messages
  await page.mouse.move(120, 245, {steps:16}); await sleep(500);
  await page.locator('text=parser-fix').first().click(); await sleep(1600);
  log('channel opened');
  await page.mouse.move(980, 900, {steps:18}); await sleep(600);
  await page.mouse.wheel(0, 400); await sleep(400);
  log('settled, recording room idle');
}
const recT = () => DRY ? 0 : (Date.now()-globalThis.REC_START)/1000;

r = await post('/api/messages', { targetId: CH, content:'@Alice read parser.js and README.md, then reply with your plan for fixing splitFields. Write the reply in ENGLISH. Do not edit code yet, and do not create/claim/update any task. If the room changes while you are writing, revise instead of using anyway.' });
log('WAKE posted', r.status, r.j.message?.seq, 'at', recT().toFixed(1)+'s');
if (page) await page.screenshot({ path: `${OUT}/shot-wake-posted.png` });

const sessPath = () => { const d=db(); const v=d.prepare('SELECT pi_session_file f FROM members WHERE id=?').get(ALICE)?.f; d.close(); return v; };
let SESS=null, INTER=0, MUTED=false, sawWorking=false, wakeRendered=false, revAt=null, replySeen=false, replyAt=null, interjectAt=null;
const marks = () => { try { const lines=fs.readFileSync(SESS,'utf8').split('\n').filter(Boolean); let n=0,last=0,rev=0; for(const l of lines){ if(l.includes('worksplice:revision')) rev++; if(l.includes('worksplice:target='+CH)){ const m=l.match(/seq=(\d+)/); if(m){n++;last=+m[1];} } } return {n,last,rev}; } catch { return {n:0,last:0,rev:0}; } };

for (let i=0;i<1200;i++) {
  if (!SESS) { SESS = sessPath(); if (SESS) log('session file:', SESS); }
  const st = db().prepare('SELECT status FROM members WHERE id=?').get(ALICE).status;
  if (i%10===0) log('tick', i, 'status='+st, SESS?JSON.stringify(marks()):'-', 'rec='+recT().toFixed(1)+'s');
  if (st==='working' && !sawWorking) { sawWorking=true; log('STATUS WORKING at', recT().toFixed(1)+'s'); if (page) await page.screenshot({path:`${OUT}/shot-working.png`}); }
  if (page && !wakeRendered) {
    const txt = await page.evaluate(()=>document.body.innerText.includes('read parser.js and README.md'));
    if (txt) { wakeRendered=true; log('WAKE RENDERED IN UI at', recT().toFixed(1)+'s'); }
  }
  const M = SESS ? marks() : {n:0,last:0,rev:0};
  if (M.rev>0 && !revAt) { revAt=recT(); log('REVISION MARKER at', revAt.toFixed(1)+'s'); }
  if (M.n>INTER && INTER<3 && !MUTED) {
    INTER++;
    await post(`/api/channels/${CH}/mute`, { memberId: ALICE, muted:true }); MUTED=true; log('MUTED');
    r = await post('/api/messages', { targetId: CH, content:'Hold on — splitting on commas breaks inside quoted fields. Explain the approach first, don\'t edit code.' });
    interjectAt=recT();
    log('INTERJECT posted', r.status, r.j.message?.seq, 'at', interjectAt.toFixed(1)+'s');
    if (page) { await page.screenshot({path:`${OUT}/shot-interject.png`}); await page.mouse.move(1050, 620, {steps:14}); }
  }
  const d=db();
  const last = d.prepare('SELECT content,author_id FROM messages WHERE target_id=? ORDER BY seq DESC LIMIT 1').get(CH);
  d.close();
  if (last && last.author_id===ALICE && String(last.content).length>50 && !replySeen) {
    replySeen=true; replyAt=recT(); log('REPLY IN DB at', replyAt.toFixed(1)+'s');
    if (page) {
      await sleep(4200);                        // UI polls every 3s
      await page.mouse.wheel(0, 240); await sleep(1000);
      await page.mouse.move(900, 700, {steps:20}); await sleep(1600);
      log('holding on the reply');
      await sleep(9000);
    } else {
      await sleep(1000);
    }
    break;
  }
  await sleep(500);
}
log('reporting: cjk/length check');
{ const d=db(); const rows=d.prepare('SELECT seq,author_id,content FROM messages WHERE target_id=? ORDER BY seq').all(CH); d.close();
  fs.writeFileSync(`${OUT}/messages.json`, JSON.stringify(rows,null,2));
  const bad = rows.filter(x=>CJK.test(x.content));
  log('MESSAGES:', rows.length, 'rows; CJK rows:', bad.length);
  for (const x of rows) log('  seq'+x.seq, (x.author_id===ALICE?'Alice':x.author_id), JSON.stringify(String(x.content).slice(0,110)));
  const d2=db(); const all=d2.prepare('SELECT target_id,seq,content FROM messages').all(); d2.close();
  log('ALL-CHANNEL CJK rows:', all.filter(x=>CJK.test(x.content)).length);
}
{ const d=db(); fs.writeFileSync(`${OUT}/rounds.json`, JSON.stringify(d.prepare('SELECT status,reason,base_seq,created_at FROM round_logs WHERE agent_id=? ORDER BY id').all(ALICE),null,2)); d.close(); }
try {
  const lines=fs.readFileSync(SESS,'utf8').split('\n').filter(Boolean);
  const rev=lines.filter(l=>l.includes('[worksplice:revision]'));
  if (rev.length) { const j=JSON.parse(rev[rev.length-1]); const txt=(j.message.content||[]).map(c=>c.text||'').join('\n'); fs.writeFileSync(`${OUT}/revision-prompt.txt`, txt); log('revise prompt saved', txt.length, 'CJK:', CJK.test(txt)); }
  const held=lines.filter(l=>{ try { const j=JSON.parse(l); const t=(j.message?.content||[]).map(c=>c.text||'').join(''); return t.includes('was held because'); } catch { return false; } });
  log('held-prompt entries in session:', held.length);
} catch(e){ log('sess read fail', e.message); }

if (!DRY) {
  const dur=recT(); log('recording duration', dur.toFixed(1)+'s');
  const v = await page.video();
  await ctx.close(); await browser.close();
  const vpath = await v.path();
  fs.writeFileSync(`${OUT}/video-path.txt`, vpath);
  log('VIDEO', vpath);
}
log('DONE');
