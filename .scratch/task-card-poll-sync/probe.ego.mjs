/**
 * 真实浏览器探针（ticket task-card-poll-sync）：消息页旅程引导卡是否跟随任务状态实时刷新。
 *
 * 断言的是用户看到的那条症状：卡面文案（JourneyGuideCard 的 title）必须在状态变化后
 * ≤5s 内依次变成 handoff（todo）→ running（in_progress）→ review（in_review）→ 消失（done）；
 * 不看接口返回、不看 React 内部状态——只读 DOM 里那张卡的 aria-label（= 卡面标题）。
 *
 * 用法（先在本票 worktree 起隔离 dev，见 Answer.md）：
 *   echo before > .scratch/task-card-poll-sync/phase.txt
 *   ego-browser nodejs < .scratch/task-card-poll-sync/probe.ego.mjs
 * phase 决定日志/截图前缀（before=base 红、after=修复后绿），探针本体不随 phase 改动。
 * 每轮自建独立 channel + 消息 + 任务，不依赖用户默认数据目录；状态变化走 curl 同款
 * HTTP 接口（POST /api/tasks/[id]/claim、.../update-status），模拟 agent-loop / 另一个页签。
 */
const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
const PATH = await import("node:path");

const ROOT =
    "/Users/apple/orca/workspaces/worksplice/task-card-poll-sync/.scratch/task-card-poll-sync";
const EVIDENCE = PATH.join(ROOT, "evidence");
mkdirSync(EVIDENCE, { recursive: true });
const PHASE = readFileSync(PATH.join(ROOT, "phase.txt"), "utf8").trim() || "before";
const BASE = "http://127.0.0.1:30199";
const STEP_TIMEOUT_MS = 5000;

const lines = [];
const record = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    lines.push(line);
    console.log(line);
};

async function api(path, init = {}) {
    const res = await fetch(`${BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
    });
    const text = await res.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    if (!res.ok) {
        throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text}`);
    }
    return body;
}

const channel = (
    await api("/api/channels", {
        method: "POST",
        body: JSON.stringify({
            name: `poll-sync-${PHASE}-${Date.now()}`,
            // 私有频道：公开频道会自动塞进秘书 agent，agent-loop 会抢先 claim/complete，
            // 探针的「状态只由本地 curl 制造」前提就不成立了（实测踩到 initial 已是 running）。
            type: "private",
            description: "task-card-poll-sync probe",
        }),
    })
).channel;
record(`created channel ${channel.id} (${channel.name})`);

const message = (
    await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({
            targetId: channel.id,
            content: "任务卡轮询同步探针：这条消息会被转为任务。",
        }),
    })
).message;
record(`created message ${message.id} seq=${message.seq}`);

const task = (
    await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ messageId: message.id }),
    })
).task;
record(`created task #${task.number} (${task.id}) status=${task.status}`);

const space = await taskSpace("worksplice-task-card-poll-sync");
const page = space.page("p1");
// ⚠️ worksplice 的 SW 对 /_next/static/ 是 cache-first（public/sw.js）：不先清掉旧缓存，
// 页面会一直跑**改动前**的客户端 chunk，探针会假红（已实测踩到，2026-10-23）。
// 先在同源落一页，注销 SW + 删缓存，再带 cache-buster 打开频道页。
await page.goto(`${BASE}/?r=sw-reset-${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => undefined);
await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
});
try {
    await page.cdp("Network.clearBrowserCache");
} catch {
    // 老 ego 版本没有这段 CDP 也无妨：chunk URL 带内容哈希，缓存已删就够。
}
record("cleared service worker + static caches");
await page.goto(`${BASE}/?r=${Date.now()}#c/${channel.id}`);
await page.waitForSelector(".ws-message-row");
// 等中心 header 真的换成这条新频道：否则可能读到上一次运行时残留的卡面。
await page.evaluate(
    async ({ name, timeout }) => {
        const start = performance.now();
        while (performance.now() - start < timeout) {
            const header = document.querySelector("header.chan-head");
            if (header && header.textContent.includes(name)) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
    },
    { name: channel.name, timeout: 20000 },
);
await page.waitForTimeout(1500);

/** 读卡面标题：JourneyGuideCard 是 aria-label=标题 的 section；没有卡返回 null。 */
const CARD_TITLES = [
    "把想法交给成员，让它跑起来",
    "把一条消息转为任务",
    "等待交接或认领",
    "让它跑",
    "去复核",
];

async function readCard() {
    return await page.evaluate((titles) => {
        for (const section of document.querySelectorAll("section[aria-label]")) {
            const label = section.getAttribute("aria-label");
            if (titles.includes(label)) return label;
        }
        return null;
    }, CARD_TITLES);
}

/** 等到卡面变成期望值（null = 卡消失），返回 { title, elapsedMs, timedOut }。 */
async function waitForCard(expected) {
    return await page.evaluate(
        async ({ titles, expected, timeout }) => {
            const read = () => {
                for (const section of document.querySelectorAll("section[aria-label]")) {
                    const label = section.getAttribute("aria-label");
                    if (titles.includes(label)) return label;
                }
                return null;
            };
            const start = performance.now();
            for (;;) {
                const title = read();
                if (title === expected) {
                    return { title, elapsedMs: Math.round(performance.now() - start), timedOut: false };
                }
                if (performance.now() - start >= timeout) {
                    return { title, elapsedMs: Math.round(performance.now() - start), timedOut: true };
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        },
        { titles: CARD_TITLES, expected, timeout: STEP_TIMEOUT_MS },
    );
}

async function shot(name) {
    await page.screenshot({ path: PATH.join(EVIDENCE, `${PHASE}-${name}.png`) });
}

const steps = [];

async function step({ name, expected, action }) {
    await action();
    const observed = await waitForCard(expected);
    steps.push({ name, expected, ...observed });
    record(
        `${name}: expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed.title)} ` +
            `elapsed=${observed.elapsedMs}ms ${observed.timedOut ? "TIMEOUT" : "ok"}`,
    );
    await shot(name);
}

const initial = await readCard();
record(`initial card: ${JSON.stringify(initial)}`);
await shot("00-initial");
// 初始态（todo 任务）必须是 handoff 的「等待交接或认领」：确认探针确实在看那张卡。
steps.push({ name: "initial", expected: "等待交接或认领", title: initial, elapsedMs: 0, timedOut: initial !== "等待交接或认领" });

await step({
    name: "01-claim-running",
    expected: "让它跑",
    action: async () => {
        await api(`/api/tasks/${encodeURIComponent(task.id)}/claim`, {
            method: "POST",
            body: JSON.stringify({}),
        });
        record("claim posted (todo → in_progress)");
    },
});

await step({
    name: "02-review",
    expected: "去复核",
    action: async () => {
        await api(`/api/tasks/${encodeURIComponent(task.id)}/update-status`, {
            method: "POST",
            body: JSON.stringify({ status: "in_review" }),
        });
        record("update-status posted (in_progress → in_review)");
    },
});

await step({
    name: "03-done-disappears",
    expected: null,
    action: async () => {
        await api(`/api/tasks/${encodeURIComponent(task.id)}/update-status`, {
            method: "POST",
            body: JSON.stringify({ status: "done" }),
        });
        record("update-status posted (in_review → done)");
    },
});

const failed = steps.filter((s) => s.timedOut || s.title !== s.expected);
const summary = {
    phase: PHASE,
    channelId: channel.id,
    taskId: task.id,
    verdict: failed.length === 0 ? "GREEN" : "RED",
    failed: failed.map((s) => ({ name: s.name, expected: s.expected, observed: s.title })),
    steps,
};
record(`VERDICT ${summary.verdict} (${steps.length - failed.length}/${steps.length} steps matched)`);
writeFileSync(PATH.join(EVIDENCE, `${PHASE}.log`), lines.join("\n") + "\n");
writeFileSync(PATH.join(EVIDENCE, `${PHASE}.json`), JSON.stringify(summary, null, 2) + "\n");

if (failed.length > 0) {
    throw new Error(
        `probe ${PHASE} = RED: ` +
            failed.map((s) => `${s.name} expected=${JSON.stringify(s.expected)} observed=${JSON.stringify(s.title)}`).join("; "),
    );
}
