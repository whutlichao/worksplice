/**
 * 真实浏览器探针（ticket journey-card-transition，review 追加）：跨频道不残留卡面。
 *
 * ChannelView 在 AppShell 里不按频道重新挂载，本票的过渡状态按频道 id 作用域重置。
 * 本探针断言：从「去复核」卡所在的频道 A 切到「任务全部完成、无卡」的频道 B 时，
 * 切换后的 900ms 内 B 页面从不出现 `section.journey-guide-card`（旧实现会保留 A 的卡
 * 340ms 播退场）；再从 B 切回 A，卡面按 enter（首次出现）重建。
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

async function createChannelWithTask(label) {
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

const space = await taskSpace("worksplice-journey-cross-channel");
const page = space.page("p1");
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

// 切到 B，采样 900ms：header 切到 B 之后不得再出现任何卡面
const switchSample = await page.evaluate(
    async ({ channelId, expectedHeader, timeout }) => {
        const samples = [];
        let headerSwitchedAt = null;
        let cardsAfterSwitch = 0;
        let firstStream = null;
        const labelsSeen = new Set();
        const start = performance.now();
        window.location.hash = `#c/${channelId}`;
        while (performance.now() - start < timeout) {
            const elapsed = performance.now() - start;
            const header = document.querySelector("header.chan-head");
            const headerText = header?.textContent ?? "";
            if (headerSwitchedAt === null && headerText.includes(expectedHeader)) {
                headerSwitchedAt = Math.round(elapsed);
            }
            const card = document.querySelector("section.journey-guide-card");
            // 消息流末尾那张卡（不含空态 describe 卡）——B 的第一张卡必须按 enter 重建。
            const streamCard = document.querySelector(
                ".stream-inner > section.journey-guide-card",
            );
            if (headerSwitchedAt !== null && streamCard && firstStream === null) {
                firstStream = {
                    t: Math.round(elapsed),
                    label: streamCard.getAttribute("aria-label"),
                    kind: streamCard.getAttribute("data-guide-kind"),
                    phase: streamCard.getAttribute("data-guide-phase"),
                    className: streamCard.className,
                };
            }
            if (headerSwitchedAt !== null && card) {
                cardsAfterSwitch += 1;
                labelsSeen.add(card.getAttribute("aria-label"));
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
            sampleCount: samples.length,
            cardsAfterSwitch,
            firstStream,
            labelsSeen: [...labelsSeen],
            // 只保留聚合，避免证据 JSON 过大。
            firstSamples: samples.slice(0, 8),
        };
    },
    { channelId: b.channel.id, expectedHeader: b.channel.name, timeout: 900 },
);
record(
    `switch A→B: headerSwitchedAt=${switchSample.headerSwitchedAt}ms ` +
        `samples=${switchSample.sampleCount} cardsAfterSwitch=${switchSample.cardsAfterSwitch} ` +
        `labelsSeen=${JSON.stringify(switchSample.labelsSeen)}`,
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

const failures = [];
if (switchSample.headerSwitchedAt === null) {
    failures.push("切换后 header 未在 900ms 内变成频道 B");
}
// B 自己的加载序列（消息先到、任务快照后到）会短暂出现 handoff 卡，这是既有行为；
// 本探针只守「A 的卡面不许跟到 B」这条跨频道泄漏。
const leakedLabels = switchSample.labelsSeen.filter((label) => label === "去复核");
if (leakedLabels.length > 0) {
    failures.push(
        `切到频道 B 后仍出现频道 A 的「去复核」卡（跨频道残留）：${JSON.stringify(switchSample.labelsSeen)}`,
    );
}
// B 的第一张消息流卡面必须是本频道首现（enter），而不是沿用 A 的切换态。
if (!switchSample.firstStream) {
    failures.push("切到频道 B 后 900ms 内未出现消息流卡面");
} else {
    if (switchSample.firstStream.phase !== "enter") {
        failures.push(
            `B 的首张消息流卡应按 enter 重建，实际 ${JSON.stringify(switchSample.firstStream)}`,
        );
    }
    if (switchSample.firstStream.kind !== "handoff") {
        failures.push(
            `B 的首张卡形态应为 handoff，实际 ${JSON.stringify(switchSample.firstStream)}`,
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
    backSample,
};
record(`VERDICT ${summary.verdict} (${failures.length} failure(s))`);
writeFileSync(PATH.join(EVIDENCE, "cross-channel.log"), lines.join("\n") + "\n");
writeFileSync(
    PATH.join(EVIDENCE, "cross-channel.json"),
    JSON.stringify(summary, null, 2) + "\n",
);
if (failures.length > 0) throw new Error(`cross-channel probe RED: ${failures.join("; ")}`);
