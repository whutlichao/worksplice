/**
 * 真实浏览器探针（ticket journey-card-transition，review 追加）：跨频道不残留卡面。
 *
 * ChannelView 在 AppShell 里不按频道重新挂载，本票的过渡状态按频道 id 作用域重置。
 *
 * 三个频道覆盖三条语义：
 * - A（消息 + in_review 任务）：稳定态显示「去复核」卡；
 * - B（消息 + done 任务）：稳定态 `guideKind === null`，**本来就不该有卡**。切到 B 时
 *   header 后 900ms 泄漏窗内不得出现 A 的「去复核」；B 若因“消息先到、任务后到”短暂
 *   出现 handoff 卡，它必须按 enter 播放（不得是 switch），但“没有瞬时卡”同样合法；
 *   数据落位并稳定后断言 B 最终无卡。
 * - C（只有消息、没有任务）：稳定态必定 handoff 卡。切到 C 后首张流内卡必须存在且
 *   `phase=enter / kind=handoff`——这条断言不依赖竞态窗口。
 *
 * 用法：ego-browser nodejs < .scratch/journey-card-transition/probe-cross-channel.ego.mjs
 */
const { writeFileSync, mkdirSync } = await import("node:fs");
const PATH = await import("node:path");

const ROOT =
    "/Users/apple/orca/workspaces/worksplice/journey-card-transition/.scratch/journey-card-transition";
const EVIDENCE = PATH.join(ROOT, "evidence");
mkdirSync(EVIDENCE, { recursive: true });
const BASE = "http://127.0.0.1:30199";

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
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
}

async function createChannelWithMessage(label) {
    const channel = (
        await api("/api/channels", {
            method: "POST",
            body: JSON.stringify({
                name: `${label}-${Date.now()}`,
                type: "private",
                description: "journey cross-channel probe",
            }),
        })
    ).channel;
    const message = (
        await api("/api/messages", {
            method: "POST",
            body: JSON.stringify({ targetId: channel.id, content: `${label} message` }),
        })
    ).message;
    return { channel, message };
}

async function createChannelWithTask(label) {
    const { channel, message } = await createChannelWithMessage(label);
    const task = (
        await api("/api/tasks", {
            method: "POST",
            body: JSON.stringify({ messageId: message.id }),
        })
    ).task;
    return { channel, task };
}

// A：消息 + 任务推进到 in_review（去复核卡）
const a = await createChannelWithTask("cross-a");
record(`channel A ${a.channel.id}`);
await api(`/api/tasks/${encodeURIComponent(a.task.id)}/claim`, {
    method: "POST",
    body: JSON.stringify({}),
});
await api(`/api/tasks/${encodeURIComponent(a.task.id)}/update-status`, {
    method: "POST",
    body: JSON.stringify({ status: "in_review" }),
});
record("A task → in_review");

// B：消息 + 任务推进到 done（无卡）
const b = await createChannelWithTask("cross-b");
record(`channel B ${b.channel.id}`);
await api(`/api/tasks/${encodeURIComponent(b.task.id)}/claim`, {
    method: "POST",
    body: JSON.stringify({}),
});
await api(`/api/tasks/${encodeURIComponent(b.task.id)}/update-status`, {
    method: "POST",
    body: JSON.stringify({ status: "in_review" }),
});
await api(`/api/tasks/${encodeURIComponent(b.task.id)}/update-status`, {
    method: "POST",
    body: JSON.stringify({ status: "done" }),
});
record("B task → in_review → done (guideKind null)");

// C：只有消息、没有任务 → deriveJourneyState 必为 handoff；用来确定性验证
// “切频道后首张卡必须 enter”，不依赖 B 的竞态加载窗口。
const c = await createChannelWithMessage("cross-c");
record(`channel C ${c.channel.id} (message only, no task → handoff card)`);

const space = await taskSpace("worksplice-journey-cross-channel");
// 每次取证前关掉上一轮遗留页，再用全新页面，避免复用的旧页被渲染器判定无响应。
for (const stale of await space.pages()) {
    try {
        await stale.close();
    } catch {
        // 已失联的页关不掉就跳过。
    }
}
const page = await space.newPage();
await page
    .goto(`${BASE}/?r=prep-${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 })
    .catch(() => undefined);
await page.evaluate(async () => {
    window.localStorage.setItem("worksplice-locale", "zh-CN");
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
});
await page.goto(`${BASE}/?r=${Date.now()}#c/${a.channel.id}`);
await page.waitForSelector(".ws-message-row");
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
    { name: a.channel.name, timeout: 20000 },
);
// 等 A 的 review 卡出现
await page.evaluate(async () => {
    const start = performance.now();
    while (performance.now() - start < 6000) {
        const card = document.querySelector("section.journey-guide-card");
        if (card?.getAttribute("aria-label") === "去复核") return true;
        await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return false;
});
record("A shows 去复核 card");

// 切到 B：header 切换后 900ms 内不得出现上一频道的卡（泄漏窗）。固定观测 6s：
// 让 B 的“消息先到、任务后到”瞬时卡有机会出现并播完退场，再断言稳定终态无卡。
const switchSample = await page.evaluate(
    async ({ channelId, expectedHeader, leakWindowMs, observeMs }) => {
        const samples = [];
        let headerSwitchedAt = null;
        let leakWindowSamples = 0;
        let leakWindowCards = 0;
        let transientCard = null;
        let messageRowSeenAt = null;
        let lastCardAt = null;
        const leakLabels = new Set();
        const start = performance.now();
        window.location.hash = `#c/${channelId}`;
        while (performance.now() - start < observeMs) {
            const elapsed = performance.now() - start;
            const header = document.querySelector("header.chan-head");
            const headerText = header?.textContent ?? "";
            if (headerSwitchedAt === null && headerText.includes(expectedHeader)) {
                headerSwitchedAt = Math.round(elapsed);
            }
            const card = document.querySelector("section.journey-guide-card");
            // 消息流末尾那张卡（不含空态 describe 卡）。
            const streamCard = document.querySelector(
                ".stream-inner > section.journey-guide-card",
            );
            if (headerSwitchedAt !== null) {
                if (streamCard && transientCard === null) {
                    transientCard = {
                        t: Math.round(elapsed),
                        label: streamCard.getAttribute("aria-label"),
                        kind: streamCard.getAttribute("data-guide-kind"),
                        phase: streamCard.getAttribute("data-guide-phase"),
                        className: streamCard.className,
                    };
                }
                if (card) lastCardAt = Math.round(elapsed);
                if (
                    messageRowSeenAt === null &&
                    document.querySelector(".stream-inner .ws-message-row")
                ) {
                    messageRowSeenAt = Math.round(elapsed);
                }
            }
            const inLeakWindow =
                headerSwitchedAt !== null && elapsed < headerSwitchedAt + leakWindowMs;
            if (inLeakWindow) {
                leakWindowSamples += 1;
                if (card) {
                    leakWindowCards += 1;
                    leakLabels.add(card.getAttribute("aria-label"));
                }
            }
            samples.push({
                t: Math.round(elapsed),
                header: headerSwitchedAt !== null,
                hasCard: Boolean(card),
            });
            await new Promise((resolve) => setTimeout(resolve, 16));
        }
        return {
            headerSwitchedAt,
            observeMs,
            sampleCount: samples.length,
            leakWindowSamples,
            leakWindowCards,
            leakLabels: [...leakLabels],
            messageRowSeenAt,
            lastCardAt,
            transientCard,
            // 只保留聚合，避免证据 JSON 过大。
            firstSamples: samples.slice(0, 8),
        };
    },
    {
        channelId: b.channel.id,
        expectedHeader: b.channel.name,
        leakWindowMs: 900,
        observeMs: 6000,
    },
);
record(
    `switch A→B: headerSwitchedAt=${switchSample.headerSwitchedAt}ms ` +
        `samples=${switchSample.sampleCount} leakWindowSamples=${switchSample.leakWindowSamples} ` +
        `leakWindowCards=${switchSample.leakWindowCards} ` +
        `leakLabels=${JSON.stringify(switchSample.leakLabels)} ` +
        `messageRowSeenAt=${switchSample.messageRowSeenAt}ms ` +
        `lastCardAt=${switchSample.lastCardAt}ms ` +
        `transientCard=${JSON.stringify(switchSample.transientCard)}`,
);
// B 的 done 任务快照落位后，瞬时 handoff 卡（若有）应在 663ms 内退场；留 1000ms
// 让采样末尾可能仍在退场的卡完成卸载（含任务恰在观测末尾到达的边界），再断言
// B 的稳定终态无卡。
const bFinal = await page.evaluate(async ({ settleMs }) => {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const streamCards = document.querySelectorAll(
        ".stream-inner > section.journey-guide-card",
    );
    const anyCards = document.querySelectorAll("section.journey-guide-card");
    return {
        streamCardCount: streamCards.length,
        anyCardCount: anyCards.length,
        labels: [...anyCards].map((card) => card.getAttribute("aria-label")),
    };
}, { settleMs: 1000 });
record(
    `B final: streamCards=${bFinal.streamCardCount} anyCards=${bFinal.anyCardCount} ` +
        `labels=${JSON.stringify(bFinal.labels)}; ` +
        (switchSample.transientCard
            ? `瞬时卡出现过（t=${switchSample.transientCard.t}ms, ` +
              `phase=${switchSample.transientCard.phase}）`
            : "瞬时卡未出现（消息与任务同帧落位，合法路径）"),
);
await page.screenshot({ path: PATH.join(EVIDENCE, "cross-01-channel-b-no-card.png") });

// 切回 A：卡面应按 enter（首次出现）重建
const backSample = await page.evaluate(
    async ({ channelId, expectedHeader, timeout }) => {
        window.location.hash = `#c/${channelId}`;
        const start = performance.now();
        let firstPhase = null;
        let firstLabel = null;
        while (performance.now() - start < timeout) {
            const card = document.querySelector("section.journey-guide-card");
            if (card) {
                firstPhase = card.getAttribute("data-guide-phase");
                firstLabel = card.getAttribute("aria-label");
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 16));
        }
        const header = document.querySelector("header.chan-head");
        return {
            elapsedMs: Math.round(performance.now() - start),
            firstPhase,
            firstLabel,
            header: header?.textContent?.slice(0, 40) ?? "",
        };
    },
    { channelId: a.channel.id, expectedHeader: a.channel.name, timeout: 6000 },
);
record(
    `switch B→A: firstPhase=${JSON.stringify(backSample.firstPhase)} ` +
        `firstLabel=${JSON.stringify(backSample.firstLabel)} elapsed=${backSample.elapsedMs}ms`,
);
await page.screenshot({ path: PATH.join(EVIDENCE, "cross-02-channel-a-card.png") });

// 切到 C（只有消息、没有任务 → 稳定态必为 handoff）：首张流内卡必须存在且按 enter
// 重建。这条断言不依赖数据到达顺序，是“切频道首卡必须 enter”的确定性证据。
const cSample = await page.evaluate(
    async ({ channelId, expectedHeader, timeout }) => {
        const start = performance.now();
        window.location.hash = `#c/${channelId}`;
        let headerSwitchedAt = null;
        let firstCard = null;
        while (performance.now() - start < timeout) {
            const elapsed = performance.now() - start;
            const header = document.querySelector("header.chan-head");
            if (
                headerSwitchedAt === null &&
                (header?.textContent ?? "").includes(expectedHeader)
            ) {
                headerSwitchedAt = Math.round(elapsed);
            }
            const card = document.querySelector(
                ".stream-inner > section.journey-guide-card",
            );
            if (headerSwitchedAt !== null && card) {
                firstCard = {
                    t: Math.round(elapsed),
                    label: card.getAttribute("aria-label"),
                    kind: card.getAttribute("data-guide-kind"),
                    phase: card.getAttribute("data-guide-phase"),
                    className: card.className,
                };
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 16));
        }
        return {
            headerSwitchedAt,
            firstCard,
            elapsedMs: Math.round(performance.now() - start),
        };
    },
    { channelId: c.channel.id, expectedHeader: c.channel.name, timeout: 8000 },
);
record(
    `switch A→C (deterministic handoff): headerSwitchedAt=${cSample.headerSwitchedAt}ms ` +
        `firstCard=${JSON.stringify(cSample.firstCard)} elapsed=${cSample.elapsedMs}ms`,
);
await page.screenshot({
    path: PATH.join(EVIDENCE, "cross-03-channel-c-handoff-card.png"),
});

const failures = [];
if (
    switchSample.headerSwitchedAt === null ||
    switchSample.headerSwitchedAt > 900
) {
    failures.push(
        `切换后 header 未在 900ms 内变成频道 B（实际 ${switchSample.headerSwitchedAt}ms）`,
    );
}
// B 自己的加载序列（消息先到、任务快照后到）会短暂出现 handoff 卡，这是既有行为；
// 本探针只守「A 的卡面不许跟到 B」这条跨频道泄漏。
const leakedLabels = switchSample.leakLabels.filter((label) => label === "去复核");
if (leakedLabels.length > 0) {
    failures.push(
        `切到频道 B 后 900ms 泄漏窗内仍出现频道 A 的「去复核」卡（跨频道残留）：` +
            `${JSON.stringify(switchSample.leakLabels)}`,
    );
}
if (switchSample.messageRowSeenAt === null) {
    failures.push(
        `切到频道 B 后 ${switchSample.observeMs}ms 内消息行未落位，无法判定数据已到位`,
    );
}
// 瞬时 handoff 卡是“消息先到、任务后到”的合法产物：出现则必须按本频道首现（enter）
// 播放，不得沿用 A 的 switch 态；完全没出现（消息与任务同帧落位）同样合法。
if (switchSample.transientCard) {
    if (switchSample.transientCard.phase !== "enter") {
        failures.push(
            `B 的瞬时消息流卡应按 enter 重建，实际 ${JSON.stringify(switchSample.transientCard)}`,
        );
    }
    if (switchSample.transientCard.kind !== "handoff") {
        failures.push(
            `B 的瞬时卡形态应为 handoff，实际 ${JSON.stringify(switchSample.transientCard)}`,
        );
    }
}
// 稳定终态：B 是 done 任务频道，guideKind === null，不得留有任何引导卡。
if (bFinal.anyCardCount !== 0) {
    failures.push(
        `频道 B 稳定态不应有引导卡（guideKind null），实际 ${JSON.stringify(bFinal.labels)}`,
    );
}
// C（只有消息、没有任务）稳定态必有 handoff 卡：首卡必须存在且按 enter 重建。
if (!cSample.firstCard) {
    failures.push(
        `切到确定性 handoff 频道 C 后 8s 内未出现首张流内卡（headerSwitchedAt=${cSample.headerSwitchedAt}ms）`,
    );
} else {
    if (cSample.firstCard.phase !== "enter") {
        failures.push(
            `频道 C 首张卡应按 enter 重建，实际 ${JSON.stringify(cSample.firstCard)}`,
        );
    }
    if (cSample.firstCard.kind !== "handoff") {
        failures.push(
            `频道 C 首张卡形态应为 handoff，实际 ${JSON.stringify(cSample.firstCard)}`,
        );
    }
    if (cSample.firstCard.label !== "把一条消息转为任务") {
        failures.push(
            `频道 C 首张卡标题应为「把一条消息转为任务」，实际 ${JSON.stringify(cSample.firstCard.label)}`,
        );
    }
}
if (backSample.firstLabel !== "去复核") {
    failures.push(`切回 A 后首张卡应为「去复核」，实际 ${JSON.stringify(backSample.firstLabel)}`);
}
if (backSample.firstPhase !== "enter") {
    failures.push(`切回 A 后卡面应按 enter 重建，实际 ${JSON.stringify(backSample.firstPhase)}`);
}

const summary = {
    verdict: failures.length === 0 ? "GREEN" : "RED",
    failures,
    switchSample,
    bFinal,
    backSample,
    cSample,
};
record(`VERDICT ${summary.verdict} (${failures.length} failure(s))`);
writeFileSync(PATH.join(EVIDENCE, "cross-channel.log"), lines.join("\n") + "\n");
writeFileSync(
    PATH.join(EVIDENCE, "cross-channel.json"),
    JSON.stringify(summary, null, 2) + "\n",
);
await page.close();
if (failures.length > 0) throw new Error(`cross-channel probe RED: ${failures.join("; ")}`);
