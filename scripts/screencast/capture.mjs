// 90 秒介绍视频 · 捕获脚本
//
// 两道工序：
//   1) 对真实服务器（生产构建 + 演示数据目录）抓 UI 源图：
//      任务板 / 频道消息 / agent 资料面板 / hold-run 三态 / README / 片尾卡；
//   2) 用浏览器舞台页逐帧渲染每个镜头（推拉摇移 + 字幕烧录），PNG 序列交给 compose.sh 编码。
//
// 为什么逐帧渲染而不在 ffmpeg 里做文字：本机 ffmpeg 构建不含 drawtext/subtitles（freetype/libass
// 未编入），字幕与运镜一并由浏览器渲染，输出仍是 1600×900@30fps 的 PNG 序列，ffmpeg 只做编码。
//
// 真跑镜头（第 5–7 镜）的口径（协调员 2026-10-09 裁决方案 A）：
//   · 提问与插话走服务器真实 HTTP 写路径（POST /api/messages），真落库；
//   · 被 hold 的写走协作域同一条写路径 sendMessage（服务端路由调用的就是它），
//     携带过期 baseSeq → 由房间自身的 freshness 校验真实产生 held 与 whatHappened；
//   · revise 后的回复以同一写路径按当前 roomSeq 落库；
//   · 第 8 镜展示的就是这次真实返回的 hold 负载（黑底终端风格、真实字节）。
//   与 v0.1.0 旧片的差别：没有真实模型驱动 agent 撰写文本（本机无凭证，不代办），
//   文案脚本化、机制与画面均真实。分镜文档 storyboard.md 记录了这条口径。
//
// 用法（需先起好指向同一数据目录的服务器，见 README.md）：
//   WORKSPLICE_DATA_DIR=/tmp/screencast-90s-v2/demo-data \
//   BASE=http://127.0.0.1:30153 OUT=/tmp/screencast-90s-v2/out \
//   node scripts/screencast/capture.mjs

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

// ---------- 门禁：绝不触碰用户 live 数据目录 ----------

const DATA_DIR = process.env.WORKSPLICE_DATA_DIR ?? "";
if (!DATA_DIR) {
  console.error("需要 WORKSPLICE_DATA_DIR（演示数据目录），拒绝在未指定时运行。");
  process.exit(1);
}
if (path.resolve(DATA_DIR) === path.resolve(process.env.HOME ?? "/", ".worksplice")) {
  console.error("拒绝使用 ~/.worksplice：那是用户 live 数据，演示必须指向独立目录。");
  process.exit(1);
}

const BASE = process.env.BASE ?? "http://127.0.0.1:30153";
const OUT = path.resolve(process.env.OUT ?? "/tmp/screencast-90s-v2/out");
const SOURCES = path.join(OUT, "sources");
const FRAMES = path.join(OUT, "frames");
const TAG = process.env.TAG ?? String(Math.floor(Date.now() / 1000) % 100000);

const FPS = 30;
const W = 1600;
const H = 900;
/** 冒烟测试用：>0 时每镜只渲染前 N 帧（成片会变短，仅用于验证管线）。 */
const FRAME_CAP = Number(process.env.FRAME_CAP ?? 0);

// ---------- Playwright 解析：本地依赖 → 环境变量 → 全局 npm ----------

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    /* fallthrough */
  }
  if (process.env.PLAYWRIGHT_MODULE) return await import(process.env.PLAYWRIGHT_MODULE);
  const root = execSync("npm root -g", { encoding: "utf8" }).trim();
  const candidate = path.join(root, "playwright/index.mjs");
  if (existsSync(candidate)) return await import(candidate);
  throw new Error("找不到 playwright：npm i -D playwright，或用 PLAYWRIGHT_MODULE 指向全局安装。");
}

// ---------- 数据层 / 协作域（门禁之后动态 import） ----------

const collab = await import(path.join(REPO, "lib/domain/collab/index.ts"));
globalThis.__workspliceDb = (await import(path.join(REPO, "lib/data/sqlite.ts"))).openDataDb(DATA_DIR);

const { createChannel, getMember, listAgents, muteChannel, sendMessage, setAgentStatus } = collab;

// ---------- 分镜文案（英文，与仓库 README / 旧片同语言） ----------

const CAPTIONS = {
  1: "Five agents. One repository. Who decides?",
  2: "Done is not the same as approved — and that button only means something to someone who is not the author.",
  3: "Not a chat log. The work itself.",
  4: "Every agent is a persistent identity: its own directory, its own runtime, its own history.",
  5: "She was woken. The wake carries a position, not the message.",
  6: "The room moved while she was writing.",
  7: "Her write was not merged. It was held — she re-read it and rewrote.",
  8: "This is not a UI effect. This is the hold the server returned.",
  9: "Last-write-wins is the default. We do not have one.",
};

const SCRIPT = {
  channelName: `hold-run-${TAG}`,
  channelDesc: "A real held write: the room moved while she was writing",
  ask:
    "@Iris read parser.js and README.md, then reply only with how you would change split. " +
    "Do not touch code yet, and do not create, claim, or update any task. " +
    "If the room changes while you are writing, revise: re-read and rewrite.",
  interjection:
    "Hold on — splitting on commas breaks on commas inside quotes. Lay out the approach first; do not edit the code.",
  draft:
    "split() should stay a one-liner: trim each part and drop empties, then split on every comma. " +
    "Callers keep the same signature and the existing tests still pass.",
  revised:
    "Re-read the room — you are right: a plain comma split breaks on commas inside quotes. " +
    "Revised approach: scan the line once, tracking single- and double-quote state, and split only on commas " +
    "outside quotes; keep the same signature so no caller changes. No code touched — this is the plan only.",
};

// ---------- 工具 ----------

const log = (...args) => console.log("[capture]", ...args);

async function api(pathname, init) {
  const res = await fetch(BASE + pathname, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const postJson = (pathname, payload) =>
  api(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

/** 注入：隐藏滚动条（保持画面干净）。 */
const HIDE_SCROLLBARS = `
  *::-webkit-scrollbar { display: none !important; }
  html, body { scrollbar-width: none !important; }
`;

/** 侧栏点选频道，直到房间头显示该频道为止（deep link 对新频道存在竞态，点击才稳）。 */
async function openChannel(page, name) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const item = page.locator(`text=${name}`).first();
    if ((await item.count()) === 0) {
      log(`侧栏还没有 ${name}，重试 ${attempt}`);
      continue;
    }
    await item.click();
    await page.waitForTimeout(1800);
    // 房间头的 "#" 与频道名分属两个元素，innerText 不连在一起；
    // 用该房间独有的系统消息判定真的打开了。
    const opened = await page.evaluate(
      (n) => document.body.innerText.includes(`New channel #${n} created`),
      name,
    );
    if (opened) return;
    log(`频道 ${name} 未打开，重试 ${attempt}`);
  }
  throw new Error(`UI 无法打开频道 ${name}`);
}

/** 等房间真的渲染出某条文案（写入是异步经服务端广播回来的）。 */
async function waitForRoomText(page, snippet) {
  await page.waitForSelector(`text=${snippet}`, { timeout: 20000 });
  await page.waitForTimeout(600);
}

async function shoot(page, name) {
  const file = path.join(SOURCES, `${name}.png`);
  await page.screenshot({ path: file });
  log("source", name);
  return file;
}

// ---------- 舞台页：逐帧渲染（运镜 + 字幕） ----------

/**
 * 舞台页模型：
 *   #world 里按顺序叠 <img class="layer">，captureSet 控制不透明度与相机。
 *   相机位形：scale s，把舞台坐标 (fx, fy) 固定在画面中心；越界时把可视窗口夹回图内。
 *   #caption 固定在画面底部（不随相机移动），复刻旧片的下缘字幕条（实测 71px / 近黑 / 白色粗体）。
 *   layers 用相对路径引用 sources/*.png（stage 文件就在 frames/ 下）。
 */
function stageHtml({ layers, caption, scrollHtml = null, bg = "#f7f1e6" }) {
  const imgs = layers
    .map(
      (src, i) =>
        `<img class="layer" data-i="${i}" src="../sources/${path.basename(src)}" style="opacity:${
          i === 0 ? 1 : 0
        }">`,
    )
    .join("\n");
  const captionHtml = caption
    ? `<div id="caption"><span>${caption}</span></div>`
    : `<div id="caption" style="display:none"></div>`;
  const scrollBlock = scrollHtml
    ? `<div id="scrollwrap"><div id="scrollpane">${scrollHtml}</div></div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:${bg};
    font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;}
  #world{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;}
  .layer{position:absolute;left:0;top:0;width:${W}px;height:${H}px;display:block;}
  ${
    scrollHtml
      ? `#scrollwrap{position:absolute;inset:0;background:#0f1115;color:#d8dee9;overflow:hidden;}
         #scrollpane{position:absolute;left:0;top:0;width:1330px;padding:56px 0 48px 96px;
           font:16px/1.85 "SF Mono",Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;}
         #scrollpane .dim{color:#8b93a7;}
         #scrollpane .key{color:#a8c7ff;}
         #scrollpane .num{color:#f2c98a;}
         #scrollpane .cmd{color:#e8ecf5;font-weight:600;}
         #scrollpane .head{color:#f5b8cd;font-weight:600;}`
      : ""
  }
  #caption{position:absolute;left:0;right:0;bottom:0;height:71px;background:rgb(18,16,17);
    display:flex;align-items:center;justify-content:center;}
  #caption span{color:#fff;font-weight:700;font-size:30px;letter-spacing:.1px;text-align:center;
    padding:0 40px;line-height:71px;white-space:nowrap;}
  </style></head><body>
  <div id="world">${imgs}</div>
  ${scrollBlock}
  ${captionHtml}
  <script>
  window.captureSet = function (state) {
    const s = state.scale ?? 1, fx = state.fx ?? ${W / 2}, fy = state.fy ?? ${H / 2};
    const halfW = ${W} / (2 * s), halfH = ${H} / (2 * s);
    const cfx = Math.min(Math.max(fx, halfW), ${W} - halfW);
    const cfy = Math.min(Math.max(fy, halfH), ${H} - halfH);
    const world = document.getElementById("world");
    world.style.transform =
      "translate(" + (${W / 2} - s * cfx) + "px," + (${H / 2} - s * cfy) + "px) scale(" + s + ")";
    if (state.opacity) {
      for (const el of document.querySelectorAll(".layer")) {
        const v = state.opacity[Number(el.dataset.i)] ?? 0;
        el.style.opacity = String(v);
      }
    }
    if (typeof state.scroll === "number") {
      const pane = document.getElementById("scrollpane");
      if (pane) pane.style.top = (-state.scroll) + "px";
    }
  };
  </script></body></html>`;
}

const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(t, 0), 1));
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);

// ---------- README 小节 → HTML（第 9 镜） ----------

function inlineMd(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function readmeSectionHtml() {
  const md = readFileSync(path.join(REPO, "README.md"), "utf8");
  const start = md.indexOf("## How It Relates to Other Tools");
  if (start < 0) throw new Error("README 缺少 How It Relates to Other Tools 小节");
  const rest = md.slice(start);
  const end = rest.indexOf("\n## ", 1);
  const section = (end < 0 ? rest : rest.slice(0, end)).trim();

  const lines = section.split("\n").slice(1);
  const out = [];
  const table = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("|")) {
      table.push(line);
      continue;
    }
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  if (table.length) {
    const rows = table
      .filter((l) => !/^\|[\s|:-]+\|$/.test(l))
      .map((l) =>
        l
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim()),
      );
    const [head, ...body] = rows;
    out.push(
      `<table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join("")}</tr></thead><tbody>` +
        body.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`).join("") +
        `</tbody></table>`,
    );
  }
  return out.join("\n");
}

// ---------- 镜头表 ----------

function buildShots() {
  const track = (scaleAt, fxAt, fyAt) => (f, n) => {
    const t = f / (n - 1);
    return { scale: scaleAt(t), fx: fxAt(t), fy: fyAt(t) };
  };
  return [
    {
      index: 1,
      name: "tasks_full",
      frames: 270,
      stage: () => stageHtml({ layers: ["board.png"], caption: CAPTIONS[1] }),
      state: track((t) => 1 + 0.06 * easeInOut(t), () => 800, () => 430),
    },
    {
      index: 2,
      name: "tasks_approve",
      frames: 240,
      stage: () => stageHtml({ layers: ["board.png"], caption: CAPTIONS[2] }),
      state: track((t) => 1.02 + 0.43 * easeInOut(t), () => 880, () => 330),
    },
    {
      index: 3,
      name: "messages",
      frames: 240,
      stage: () => stageHtml({ layers: ["messages_0.png", "messages_1.png", "messages_2.png"], caption: CAPTIONS[3] }),
      state: (f, n) => {
        const t = f / (n - 1);
        const fade = (a, b) => clamp01((t - a) / (b - a));
        return {
          scale: 1 + 0.04 * t,
          fx: 736,
          fy: 430,
          opacity: [1 - fade(0.3, 0.42), Math.min(fade(0.3, 0.42), 1 - fade(0.62, 0.74)), fade(0.62, 0.74)],
        };
      },
    },
    {
      index: 4,
      name: "agent_panel",
      frames: 210,
      stage: () => stageHtml({ layers: ["agent_panel.png"], caption: CAPTIONS[4] }),
      state: track((t) => 1 + 0.1 * easeInOut(t), () => 1440, () => 470),
    },
    {
      index: 5,
      name: "hold_ask",
      frames: 240,
      stage: () => stageHtml({ layers: ["hold_1.png"], caption: CAPTIONS[5] }),
      state: track((t) => 1 + 0.05 * easeInOut(t), () => 800, () => 430),
    },
    {
      index: 6,
      name: "hold_interject",
      frames: 210,
      stage: () => stageHtml({ layers: ["hold_2.png", "hold_1.png"], caption: CAPTIONS[6] }),
      state: (f, n) => {
        const t = f / (n - 1);
        const fade = clamp01(t / 0.12);
        return { scale: 1 + 0.03 * t, fx: 800, fy: 430, opacity: [fade, 1 - fade] };
      },
    },
    {
      index: 7,
      name: "hold_revised",
      frames: 450,
      stage: () => stageHtml({ layers: ["hold_3.png", "hold_2.png"], caption: CAPTIONS[7] }),
      state: (f, n) => {
        const t = f / (n - 1);
        const fade = clamp01(t / 0.06);
        const move = clamp01((t - 0.08) / 0.92);
        return {
          scale: 1.02 + 0.16 * easeInOut(move),
          fx: 800,
          fy: 430 + 110 * easeInOut(move),
          opacity: [fade, 1 - fade],
        };
      },
    },
    {
      index: 9,
      name: "readme_compare",
      frames: 240,
      stage: () => stageHtml({ layers: ["readme.png"], caption: CAPTIONS[9], bg: "#ffffff" }),
      state: track((t) => 1 + 0.12 * easeInOut(t), () => 800, () => 470),
    },
  ];
}

// ---------- 主流程 ----------

const { chromium } = await loadPlaywright();
mkdirSync(SOURCES, { recursive: true });
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.addInitScript((css) => {
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  });
}, HIDE_SCROLLBARS);

// 1) 任务板（第 1–2 镜共用源图）
const channels = (await api("/api/channels")).body.channels ?? [];
const stream = channels.find((c) => c.name === "stream-sync");
if (!stream) throw new Error("演示数据里找不到 stream-sync 频道");
await page.goto(`${BASE}/#c/${stream.id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.click('button[role="tab"]:has-text("Tasks")');
await page.waitForSelector('button:has-text("Approve")', { timeout: 20000 });
await page.waitForTimeout(600);
// 看板视图（五列色块）比列表更贴近旧片第 1 镜
await page.click('button:has-text("Board")');
await page.waitForTimeout(1200);
await shoot(page, "board");

// 2) 频道消息（第 3 镜）：三个滚动位
await page.click('button[role="tab"]:has-text("Messages")');
await page.waitForTimeout(1500);
const scrollMax = await page.evaluate(() => {
  const main = document.querySelector("main");
  return main ? main.scrollHeight - main.clientHeight : null;
});
if (scrollMax === null) throw new Error("找不到消息滚动容器 main");
for (const [i, frac] of [0, 0.5, 1].entries()) {
  await page.evaluate((v) => {
    document.querySelector("main").scrollTop = v;
  }, Math.round(scrollMax * frac));
  await page.waitForTimeout(500);
  await shoot(page, `messages_${i}`);
}

// 3) agent 资料面板（第 4 镜）
await page.click("text=Iris");
await page.waitForTimeout(1500);
await shoot(page, "agent_panel");
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// 4) hold-run 三态（第 5–7 镜）——真实写路径
const iris = listAgents().find((a) => a.name === "Iris");
if (!iris) throw new Error("演示数据里找不到 Iris");
const channel = createChannel({
  name: SCRIPT.channelName,
  type: "public",
  description: SCRIPT.channelDesc,
  memberIds: [iris.id],
});
log("hold-run channel", channel.id);

// 静音该频道：本机没有模型凭证，唤醒只会换来 demo provider 的 error 态；
// 静音只挡唤醒，不挡 freshness-hold 与 getSince（与 part-b-real-run.sh 同一处置）。
muteChannel(channel.id, iris.id);
log("muted Iris on", SCRIPT.channelName);

// 本机没有模型凭证，任何唤醒都必然落成一次 error 轮次（demo provider 无该模型）。
// 静音挡得住普通消息，但 **@mention 穿透静音**——提问里 @Iris 就会唤醒她。
// 画面上不该出现这次注定失败、且与剧本无关的失败标记，所以每次拍照前：
//   等静默 → 复位 members.status（只改状态行，不碰房间内容）→ 重载页面让侧栏重取状态。
async function settleIrisOffline() {
  const NEED = 5; // 连续 5 次（6s）静默才认账
  let stable = 0;
  for (let i = 1; i <= 20 && stable < NEED; i += 1) {
    await page.waitForTimeout(1200);
    if (getMember(iris.id)?.status === "offline") stable += 1;
    else stable = 0;
    setAgentStatus(iris.id, "offline");
  }
  return stable >= NEED;
}

async function shootHold(name) {
  const settled = await settleIrisOffline();
  log(`status before ${name}`, getMember(iris.id)?.status, settled ? "(settled)" : "(unsettled!)");
  if (!settled) throw new Error(`${name} 前 Iris 状态未能收口到 offline`);
  await openChannel(page, SCRIPT.channelName);
  await shoot(page, name);
}

await openChannel(page, SCRIPT.channelName);

// 4.1 owner 提问 → 真落库（seq 1）
const askRes = await postJson("/api/messages", { targetId: channel.id, content: SCRIPT.ask });
if (askRes.status >= 300 || !askRes.body?.message?.seq) {
  throw new Error(`提问写入失败：${askRes.status} ${JSON.stringify(askRes.body)}`);
}
const baseSeq = askRes.body.message.seq;
log("ask seq", baseSeq);
await waitForRoomText(page, "Then reply only with how you would change split");
await shootHold("hold_1");

// 4.2 owner 插话 → 房间前进（seq 2）
const interjectRes = await postJson("/api/messages", { targetId: channel.id, content: SCRIPT.interjection });
if (interjectRes.status >= 300 || !interjectRes.body?.message?.seq) {
  throw new Error(`插话写入失败：${interjectRes.status} ${JSON.stringify(interjectRes.body)}`);
}
log("interject seq", interjectRes.body.message.seq);
await waitForRoomText(page, "breaks on commas inside quotes");
await shootHold("hold_2");

// 4.3 她按旧版本写作 → 服务端 freshness 校验真实 hold（与路由同一条写路径）
const held = sendMessage({
  targetId: channel.id,
  authorId: iris.id,
  content: SCRIPT.draft,
  baseSeq,
  wake: false,
});
if (!held.held) throw new Error(`草稿没有被 hold（held=${held.held}）——场景失效`);
log("held ✓ roomSeq", held.roomSeq, "| whatHappened:", held.whatHappened.slice(0, 90));

// 4.4 revise：按当前 roomSeq 重写（seq 3）
const revised = sendMessage({
  targetId: channel.id,
  authorId: iris.id,
  content: SCRIPT.revised,
  baseSeq: held.roomSeq,
  wake: false,
});
if (revised.held) throw new Error(`revise 仍被 hold（roomSeq=${revised.roomSeq}）`);
log("revised seq", revised.message.seq);
await waitForRoomText(page, "Re-read the room");
await shootHold("hold_3");

// 4.5 hold 负载落盘（第 8 镜终端内容 = 真实返回字节）
const payload = {
  channel: SCRIPT.channelName,
  channelId: channel.id,
  author: "Iris",
  baseSeq,
  roomSeq: held.roomSeq,
  held: held.held,
  whatHappened: held.whatHappened,
  writtenToRoom: false,
};
writeFileSync(path.join(SOURCES, "hold-payload.json"), JSON.stringify(payload, null, 2) + "\n");

// 5) README 小节（第 9 镜）与片尾卡（第 10 镜）
const readmeHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;background:#fff;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#1f2328;}
.wrap{width:1000px;margin:0 auto;padding:46px 0 0 0;}
h2{font-size:32px;margin:0 0 14px 0;border-bottom:1px solid #d8dee4;padding-bottom:10px;}
p{font-size:17px;line-height:1.65;margin:0 0 14px 0;}
code{background:#f6f8fa;padding:1px 6px;border-radius:6px;font-family:"SF Mono",Menlo,monospace;font-size:15px;}
table{border-collapse:collapse;width:100%;margin:18px 0 8px 0;font-size:16px;}
th,td{border:1px solid #d8dee4;padding:10px 14px;text-align:left;vertical-align:top;line-height:1.5;}
th{background:#f6f8fa;}
</style></head><body><div class="wrap">${readmeSectionHtml()}</div></body></html>`;
writeFileSync(path.join(FRAMES, "readme.html"), readmeHtml);
await page.goto(`file://${path.join(FRAMES, "readme.html")}`);
await page.waitForTimeout(300);
await shoot(page, "readme");

await page.goto(`file://${path.join(HERE, "endcard.html")}`);
await page.waitForTimeout(300);
await shoot(page, "endcard");

// 6) 终端内容（第 8 镜）——真实 hold 负载 + 房间实录
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const payloadJson = JSON.stringify({ held: true, roomSeq: payload.roomSeq, whatHappened: payload.whatHappened }, null, 2);
const coloredJson = esc(payloadJson)
  .replace(/^(\s*)"([a-zA-Z]+)":/gm, (_m, ind, key) => `${ind}<span class="key">"${key}"</span>:`)
  .replace(/: (true|false)(,?)$/gm, ': <span class="num">$1</span>$2');
// 房间真实行：直接从库读出（readonly），按 store 返回的字段渲染成 JSON —— 真实字节。
const require_ = createRequire(import.meta.url);
const Database = require_("better-sqlite3");
const roomRows = new Database(path.join(DATA_DIR, "worksplice.db"), { readonly: true })
  .prepare("SELECT seq, author_id, content FROM messages WHERE target_id = ? ORDER BY seq")
  .all(channel.id)
  .map((r) => ({ seq: r.seq, author: r.author_id === "owner" ? "owner" : "Iris", content: r.content }));
const roomJson = esc(
  JSON.stringify(roomRows, null, 2)
    .split("\n")
    .map((l) => "  " + l)
    .join("\n"),
);
const terminalHtml = [
  `<span class="cmd">$ worksplice room ${esc(SCRIPT.channelName)} --json</span>`,
  `<span class="dim"># every row the store actually holds — held writes leave no row.</span>`,
  roomJson,
  ``,
  `<span class="dim"># ---------------------------------------------------------------------------</span>`,
  `<span class="cmd">$ cat hold-payload.json</span>`,
  `<span class="dim"># the write her round produced — refused at the door: the room had moved to seq ${payload.roomSeq}</span>`,
  `<span class="dim"># baseSeq ${payload.baseSeq} ≠ roomSeq ${payload.roomSeq} → a held write writes nothing; this is what came back instead.</span>`,
  coloredJson,
  ``,
  `<span class="dim"># ---------------------------------------------------------------------------</span>`,
  `<span class="cmd">$ cat draft-refused.txt</span>`,
  `<span class="dim"># what she tried to send against seq ${payload.baseSeq} — refused, never stored.</span>`,
  esc(SCRIPT.draft),
].join("\n");

// 量内容高度 → 滚动上限
let terminalScrollMax = 0;
{
  const probe = await browser.newPage({ viewport: { width: W, height: H } });
  const f = path.join(FRAMES, "stage08.html");
  writeFileSync(f, stageHtml({ layers: [], caption: CAPTIONS[8], scrollHtml: terminalHtml, bg: "#0f1115" }));
  await probe.goto(`file://${f}`);
  const contentH = await probe.evaluate(
    () => document.getElementById("scrollpane").getBoundingClientRect().height,
  );
  await probe.close();
  terminalScrollMax = Math.max(0, Math.round(contentH - H + 60));
  log("terminal content height", Math.round(contentH), "scroll max", terminalScrollMax);
}

// 7) 逐帧渲染
async function renderShot(shot) {
  const dir = path.join(FRAMES, `shot${String(shot.index).padStart(2, "0")}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const stageFile = path.join(FRAMES, `stage${String(shot.index).padStart(2, "0")}.html`);
  writeFileSync(stageFile, shot.stage());
  const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await p.goto(`file://${stageFile}`);
  await p.evaluate(() => document.fonts.ready);
  const total = FRAME_CAP > 0 ? Math.min(FRAME_CAP, shot.frames) : shot.frames;
  for (let f = 0; f < total; f += 1) {
    await p.evaluate((s) => window.captureSet(s), shot.state(f, total));
    await p.screenshot({
      path: path.join(dir, `${String(f + 1).padStart(4, "0")}.png`),
      scale: "css",
    });
  }
  await p.close();
  log(`frames shot${shot.index} (${shot.name})`, `${total}f / ${(total / FPS).toFixed(1)}s`);
  return { index: shot.index, name: shot.name, dir: path.relative(OUT, dir), frames: total, static: false };
}

const manifestShots = [];
for (const shot of buildShots()) {
  manifestShots.push(await renderShot(shot));
}

// 第 8 镜（终端）与第 10 镜（片尾卡）在镜头表外单独登记
{
  const shot8 = {
    index: 8,
    name: "hold_payload",
    frames: 420,
    stage: () => stageHtml({ layers: [], caption: CAPTIONS[8], scrollHtml: terminalHtml, bg: "#0f1115" }),
    state: (f, n) => {
      const t = f / (n - 1);
      return { scroll: terminalScrollMax * easeInOut(clamp01((t - 0.06) / 0.88)) };
    },
  };
  manifestShots.push(await renderShot(shot8));
  manifestShots.push({
    index: 10,
    name: "endcard",
    dir: null,
    frames: 180,
    static: true,
    source: path.join("sources", "endcard.png"),
  });
}
manifestShots.sort((a, b) => a.index - b.index);

await browser.close();
writeFileSync(
  path.join(OUT, "manifest.json"),
  JSON.stringify({ fps: FPS, width: W, height: H, tag: TAG, base: BASE, shots: manifestShots }, null, 2) + "\n",
);
log("manifest →", path.join(OUT, "manifest.json"));
log("done");
