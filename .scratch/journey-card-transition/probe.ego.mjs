/**
 * 真实浏览器探针（ticket journey-card-transition）：旅程引导卡形态切换过渡。
 *
 * 只读用户看到的那张卡（`section.journey-guide-card`）与粒子层：
 *   1. todo（handoff）→ claim（running）：切到 `is-switching`，卡面与粒子的 computed
 *      animation-name 命中本票 keyframes（非 none），截图切换瞬间；
 *   2. CDP 强制 `prefers-reduced-motion: reduce` 后再推进到 in_review（review）：
 *      粒子 computed animation-duration = 0.001s，卡面内容仍可见；
 *   3. 还原媒体后推进到 done：卡面先播 `is-exiting` 消散再卸载（aria-label 依次
 *      「等待交接或认领」→「让它跑」→「去复核」→ 无）。
 *
 * 用法（先在本票 worktree 起隔离 dev，见 Answer.md）：
 *   ego-browser nodejs < .scratch/journey-card-transition/probe.ego.mjs
 * 自建私有频道 + 消息 + 任务，状态只由本地 HTTP 接口制造；不依赖用户默认数据目录。
 */
const { writeFileSync, mkdirSync } = await import("node:fs");
const PATH = await import("node:path");

const ROOT =
    "/Users/apple/orca/workspaces/worksplice/journey-card-transition/.scratch/journey-card-transition";
const EVIDENCE = PATH.join(ROOT, "evidence");
mkdirSync(EVIDENCE, { recursive: true });
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
            name: `journey-transition-${Date.now()}`,
            // 私有频道：公开频道会自动塞进秘书 agent，agent-loop 会抢先推进状态。
            type: "private",
            description: "journey-card-transition probe",
        }),
    })
).channel;
record(`created channel ${channel.id} (${channel.name})`);

const message = (
    await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({
            targetId: channel.id,
            content: "引导卡过渡探针：这条消息会被转为任务。",
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

const space = await taskSpace("worksplice-journey-card-transition");
const page = space.page("p1");

// 先在同源落一页：固定中文 locale，并清掉 SW / 静态缓存（worksplice 的 SW 对
// /_next/static/ 是 cache-first，不清会跑改动前的客户端 chunk，探针假红）。
await page
    .goto(`${BASE}/?r=prep-${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
    })
    .catch(() => undefined);
await page.evaluate(async () => {
    window.localStorage.setItem("worksplice-locale", "zh-CN");
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
record("set locale zh-CN and cleared service worker + static caches");

// 在文档创建前挂 console.error 采集器：hydration mismatch 走 console.error。
await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      window.__jctConsoleMessages = [];
      const original = console.error.bind(console);
      console.error = (...args) => {
        try { window.__jctConsoleMessages.push(args.map((arg) => String(arg)).join(" ")); } catch {}
        original(...args);
      };
    })();`,
});

await page.goto(`${BASE}/?r=${Date.now()}#c/${channel.id}`);
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
    { name: channel.name, timeout: 20000 },
);
record("channel page ready");

/** 在页面里读卡面 + 粒子层的可观察状态。 */
async function readCard() {
    return await page.evaluate(() => {
        const card = document.querySelector("section.journey-guide-card");
        if (!card) return null;
        const layer = card.querySelector(".journey-guide-particles");
        const particle = card.querySelector(".journey-guide-particle");
        const cardStyle = getComputedStyle(card);
        const particleStyle = particle ? getComputedStyle(particle) : null;
        return {
            label: card.getAttribute("aria-label"),
            kind: card.getAttribute("data-guide-kind"),
            phase: card.getAttribute("data-guide-phase"),
            className: card.className,
            cardAnimationName: cardStyle.animationName,
            cardOpacity: cardStyle.opacity,
            cardTransform: cardStyle.transform,
            layerAnimationName: layer ? getComputedStyle(layer).animationName : null,
            layerAriaHidden: layer ? layer.getAttribute("aria-hidden") : null,
            particleAnimationName: particleStyle ? particleStyle.animationName : null,
            particleAnimationDuration: particleStyle
                ? particleStyle.animationDuration
                : null,
            particleAnimationDelay: particleStyle
                ? particleStyle.animationDelay
                : null,
            particleOpacity: particleStyle ? particleStyle.opacity : null,
            particleCount: card.querySelectorAll(".journey-guide-particle").length,
            text: card.textContent ?? "",
        };
    });
}

/** 轮询直到 predicate(state) 为真；返回 { state, elapsedMs, timedOut }。 */
async function waitForCard(predicateSource, timeout = STEP_TIMEOUT_MS) {
    return await page.evaluate(
        async ({ predicateSource, timeout }) => {
            // eslint-disable-next-line no-new-func
            const predicate = new Function("card", `return (${predicateSource});`);
            const read = () => {
                const card = document.querySelector("section.journey-guide-card");
                if (!card) return null;
                const layer = card.querySelector(".journey-guide-particles");
                const particle = card.querySelector(".journey-guide-particle");
                const cardStyle = getComputedStyle(card);
                const particleStyle = particle ? getComputedStyle(particle) : null;
                return {
                    label: card.getAttribute("aria-label"),
                    kind: card.getAttribute("data-guide-kind"),
                    phase: card.getAttribute("data-guide-phase"),
                    className: card.className,
                    cardAnimationName: cardStyle.animationName,
                    cardOpacity: cardStyle.opacity,
                    cardTransform: cardStyle.transform,
                    layerAnimationName: layer ? getComputedStyle(layer).animationName : null,
                    layerAriaHidden: layer ? layer.getAttribute("aria-hidden") : null,
                    particleAnimationName: particleStyle
                        ? particleStyle.animationName
                        : null,
                    particleAnimationDuration: particleStyle
                        ? particleStyle.animationDuration
                        : null,
                    particleAnimationDelay: particleStyle
                        ? particleStyle.animationDelay
                        : null,
                    particleOpacity: particleStyle ? particleStyle.opacity : null,
                    particleCount: card.querySelectorAll(".journey-guide-particle").length,
                    text: card.textContent ?? "",
                };
            };
            const start = performance.now();
            for (;;) {
                const card = read();
                let matched = false;
                try {
                    matched = Boolean(predicate(card));
                } catch {
                    matched = false;
                }
                if (matched) {
                    return {
                        matched: true,
                        state: card,
                        elapsedMs: Math.round(performance.now() - start),
                        timedOut: false,
                    };
                }
                if (performance.now() - start >= timeout) {
                    return {
                        matched: false,
                        state: card,
                        elapsedMs: Math.round(performance.now() - start),
                        timedOut: true,
                    };
                }
                await new Promise((resolve) => setTimeout(resolve, 16));
            }
        },
        { predicateSource, timeout },
    );
}

async function scrollCardIntoView() {
    await page.evaluate(() => {
        document
            .querySelector("section.journey-guide-card")
            ?.scrollIntoView({ block: "center" });
    });
}

async function shot(name) {
    await scrollCardIntoView();
    await page.screenshot({ path: PATH.join(EVIDENCE, `after-${name}.png`) });
}

/** 冻结当前所有动画到指定时刻，便于截到粒子在途的一帧（截完用 resumeAnimations 放行）。 */
async function freezeAnimationsAt(ms) {
    await page.evaluate((currentTime) => {
        for (const animation of document.getAnimations()) {
            animation.pause();
            animation.currentTime = currentTime;
        }
    }, ms);
}

async function resumeAnimations() {
    await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.play();
    });
}

const facts = { channelId: channel.id, taskId: task.id, steps: [] };

// —— 0. 初始：todo → handoff「等待交接或认领」 ——
const initial = await waitForCard(
    'card && card.label === "等待交接或认领"',
);
facts.initial = initial;
const consoleMessages = await page.evaluate(
    () => window.__jctConsoleMessages ?? [],
);
const hydrationWarnings = consoleMessages.filter((message) =>
    /hydrat|did not match|server rendered|server-rendered/i.test(message),
);
facts.hydrationWarnings = hydrationWarnings;
record(
    `console.error messages=${consoleMessages.length} hydrationWarnings=${hydrationWarnings.length}` +
        (hydrationWarnings.length > 0
            ? ` ${JSON.stringify(hydrationWarnings)}`
            : ""),
);
record(
    `initial: label=${JSON.stringify(initial.state?.label)} kind=${initial.state?.kind} ` +
        `phase=${initial.state?.phase} particles=${initial.state?.particleCount} ` +
        `layerAriaHidden=${initial.state?.layerAriaHidden} timedOut=${initial.timedOut}`,
);
await shot("00-initial");

// —— 1. claim：todo → in_progress，handoff → running 播放切换动画 ——
await api(`/api/tasks/${encodeURIComponent(task.id)}/claim`, {
    method: "POST",
    body: JSON.stringify({}),
});
record("claim posted (todo → in_progress)");
const switching = await waitForCard(
    'card && card.label === "让它跑" && card.phase === "switch"',
);
facts.switching = switching;
record(
    `switch detected: label=${JSON.stringify(switching.state?.label)} ` +
        `phase=${switching.state?.phase} elapsed=${switching.elapsedMs}ms ` +
        `cardAnimation=${JSON.stringify(switching.state?.cardAnimationName)} ` +
        `particleAnimation=${JSON.stringify(switching.state?.particleAnimationName)} ` +
        `timedOut=${switching.timedOut}`,
);
// 冻结到消散中段再截图：截图本身有耗时，不冻结会错过 520ms 的动画窗口。
await freezeAnimationsAt(150);
const switchMid = await readCard();
facts.switchMid = switchMid;
record(
    `switch mid (frozen 150ms): cardOpacity=${switchMid?.cardOpacity} ` +
        `particleOpacity=${switchMid?.particleOpacity} ` +
        `particleAnimation=${JSON.stringify(switchMid?.particleAnimationName)}`,
);
await shot("01-switch-running-mid");
await resumeAnimations();

// 终态：动画结束后卡面稳定、粒子不可见。
const runningFinal = await waitForCard(
    'card && card.label === "让它跑" && card.phase === "switch" && card.cardOpacity === "1" && card.particleOpacity === "0"',
);
facts.runningFinal = runningFinal;
record(
    `running final: opacity=${runningFinal.state?.cardOpacity} ` +
        `transform=${runningFinal.state?.cardTransform} ` +
        `particleOpacity=${runningFinal.state?.particleOpacity} ` +
        `elapsed=${runningFinal.elapsedMs}ms timedOut=${runningFinal.timedOut}`,
);
await shot("02-running-final");

// —— 2. reduce：强制 prefers-reduced-motion，再推进到 in_review ——
await page.cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
record("Emulation.setEmulatedMedia prefers-reduced-motion: reduce");
await api(`/api/tasks/${encodeURIComponent(task.id)}/update-status`, {
    method: "POST",
    body: JSON.stringify({ status: "in_review" }),
});
record("update-status posted (in_progress → in_review)");
const reduced = await waitForCard(
    'card && card.label === "去复核" && card.phase === "switch"',
);
await page.waitForTimeout(80);
const reducedSample = await readCard();
facts.reducedMotion = { matched: reduced, sample: reducedSample };
record(
    `reduce switch: label=${JSON.stringify(reducedSample?.label)} ` +
        `particleAnimationDuration=${JSON.stringify(reducedSample?.particleAnimationDuration)} ` +
        `particleOpacity=${JSON.stringify(reducedSample?.particleOpacity)} ` +
        `cardOpacity=${JSON.stringify(reducedSample?.cardOpacity)} ` +
        `cardTextVisible=${(reducedSample?.text ?? "").length > 0} ` +
        `elapsed=${reduced.elapsedMs}ms timedOut=${reduced.timedOut}`,
);
await shot("03-reduce-review");

// 还原媒体，回到常规动效。
await page.cdp("Emulation.setEmulatedMedia", { media: "", features: [] });
record("Emulation.setEmulatedMedia restored");

// —— 3. done：review → null，先消散退场再卸载 ——
await api(`/api/tasks/${encodeURIComponent(task.id)}/update-status`, {
    method: "POST",
    body: JSON.stringify({ status: "done" }),
});
record("update-status posted (in_review → done)");
const exiting = await waitForCard(
    'card && card.phase === "exit"',
);
facts.exiting = exiting;
record(
    `exit detected: label=${JSON.stringify(exiting.state?.label)} ` +
        `className=${JSON.stringify(exiting.state?.className)} ` +
        `cardAnimation=${JSON.stringify(exiting.state?.cardAnimationName)} ` +
        `particleAnimation=${JSON.stringify(exiting.state?.particleAnimationName)} ` +
        `elapsed=${exiting.elapsedMs}ms timedOut=${exiting.timedOut}`,
);
await freezeAnimationsAt(140);
await shot("04-exit-mid");
await resumeAnimations();

const gone = await waitForCard("card === null", 2000);
facts.gone = gone;
record(`exit complete: cardGone=${gone.matched} elapsed=${gone.elapsedMs}ms timedOut=${gone.timedOut}`);
await shot("05-done-gone");

// —— 断言 ——
const failures = [];
const expect = (condition, message) => {
    if (!condition) failures.push(message);
};

const labelSequence = [
    initial.state?.label,
    switching.state?.label,
    reducedSample?.label,
    gone.matched ? null : gone.state?.label,
];
facts.labelSequence = labelSequence;

expect(
    initial.state?.label === "等待交接或认领",
    `初始卡面应为「等待交接或认领」，实际 ${JSON.stringify(initial.state?.label)}`,
);
expect(
    initial.state?.particleCount >= 8 && initial.state?.particleCount <= 16,
    `粒子数量应在 8–16，实际 ${initial.state?.particleCount}`,
);
expect(initial.state?.layerAriaHidden === "true", "粒子层应 aria-hidden=true");
expect(
    switching.state?.cardAnimationName === "journey-guide-card-switch",
    `切换时卡面 animation-name 应为 journey-guide-card-switch，实际 ${JSON.stringify(switching.state?.cardAnimationName)}`,
);
expect(
    /journey-guide-particle-(out|in)/.test(switching.state?.particleAnimationName ?? ""),
    `切换时粒子 animation-name 应命中 journey-guide-particle-*，实际 ${JSON.stringify(switching.state?.particleAnimationName)}`,
);
expect(
    switching.state?.particleAnimationName !== "none",
    "切换时粒子 animation-name 不应为 none",
);
expect(
    Number(switchMid?.particleOpacity) > 0,
    `切换中段粒子应可见（opacity>0），实际 ${JSON.stringify(switchMid?.particleOpacity)}`,
);
expect(
    runningFinal.matched,
    `动画结束后卡面应处于最终稳定态（opacity 1 / 粒子不可见），实际 ${JSON.stringify(runningFinal.state)}`,
);
expect(
    reducedSample?.particleAnimationDuration === "0.001s",
    `reduce 下粒子 animation-duration 应为 0.001s，实际 ${JSON.stringify(reducedSample?.particleAnimationDuration)}`,
);
expect(reducedSample?.particleOpacity === "0", "reduce 下粒子应不可见");
expect(reducedSample?.cardOpacity === "1", "reduce 下卡面内容应可见");
expect(
    exiting.state?.cardAnimationName === "journey-guide-card-out",
    `退场时卡面 animation-name 应为 journey-guide-card-out，实际 ${JSON.stringify(exiting.state?.cardAnimationName)}`,
);
expect(
    /journey-guide-particle-out/.test(exiting.state?.particleAnimationName ?? ""),
    `退场时粒子 animation-name 应命中 journey-guide-particle-out，实际 ${JSON.stringify(exiting.state?.particleAnimationName)}`,
);
expect(gone.matched, "done 后卡面应在退场动画播完后卸载");
expect(hydrationWarnings.length === 0, "不应出现 SSR/hydration 警告");

const summary = {
    verdict: failures.length === 0 ? "GREEN" : "RED",
    failures,
    labelSequence,
    facts,
};
record(`VERDICT ${summary.verdict} (${failures.length} failure(s))`);
writeFileSync(PATH.join(EVIDENCE, "after.log"), lines.join("\n") + "\n");
writeFileSync(
    PATH.join(EVIDENCE, "after.json"),
    JSON.stringify(summary, null, 2) + "\n",
);

if (failures.length > 0) {
    throw new Error(`probe = RED: ${failures.join("; ")}`);
}
