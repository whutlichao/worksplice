/**
 * 真实浏览器探针（ticket journey-card-transition）：内容层粒子过渡（最终设计）。
 *
 * 断言口径（设计定稿）：
 *   1. 卡壳静止：全程 computed animation-name=none、opacity=1、transform=none；
 *      动画只发生在内容层与粒子层。
 *   2. 首现 / 切换 / 退场只让内容燃尽与重聚：claim 后旧内容化为
 *      `journey-guide-content-dissolve` 粒子，旧实体内容立即让位（opacity=0），
 *      新内容由 `journey-guide-content-reform` 粒子聚拢后实体淡入。
 *   3. 粒子为确定性 DOM：层 aria-hidden=true、pointer-events=none；结束后
 *      `fx.children.length === 0`、内容 opacity=1、无残留。
 *   4. 对齐：冻结在消散驻留段，逐行比较粒子墨迹 bbox 与「DOM 行盒 + canvas 字体
 *      度量」推导的预期墨迹（含按钮矩形），每边 ≤1.5px；窄视口再验证 hint 折行后
 *      逐行对齐。
 *   5. 连续两次切换（claim → in_review）不残留；reduce 下不产生可见粒子、内容立即终态。
 *
 * 用法（先在本票 worktree 起隔离 dev，见 Answer.md）：
 *   ego-browser nodejs < .scratch/journey-card-transition/probe.ego.mjs
 * 自建私有频道 + 消息 + 任务，状态只由本地 HTTP 接口制造；不依赖用户默认数据目录。
 */
const { writeFileSync, appendFileSync, mkdirSync } = await import("node:fs");
const PATH = await import("node:path");

const ROOT =
    "/Users/apple/orca/workspaces/worksplice/journey-card-transition/.scratch/journey-card-transition";
const EVIDENCE = PATH.join(ROOT, "evidence");
mkdirSync(EVIDENCE, { recursive: true });
const LOG_PATH = PATH.join(EVIDENCE, "after.log");
const BASE = "http://127.0.0.1:30199";
const STEP_TIMEOUT_MS = 6000;
const DISSOLVE = "journey-guide-content-dissolve";
const REFORM = "journey-guide-content-reform";
const BURN = "journey-guide-content-burn";
const ALIGN_TOLERANCE_PX = 1.5;

const lines = [];
const record = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    lines.push(line);
    appendFileSync(LOG_PATH, line + "\n");
    console.log(line);
};
writeFileSync(LOG_PATH, "");

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

async function createChannelWithTask(label) {
    const channel = (
        await api("/api/channels", {
            method: "POST",
            body: JSON.stringify({
                name: `${label}-${Date.now()}`,
                type: "private",
                description: "journey-card-transition probe",
            }),
        })
    ).channel;
    const message = (
        await api("/api/messages", {
            method: "POST",
            body: JSON.stringify({
                targetId: channel.id,
                content: `${label}：引导卡切换探针消息。`,
            }),
        })
    ).message;
    const task = (
        await api("/api/tasks", {
            method: "POST",
            body: JSON.stringify({ messageId: message.id }),
        })
    ).task;
    return { channel, message, task };
}

const a = await createChannelWithTask("journey-transition");
record(`channel A ${a.channel.id}, task ${a.task.id} (${a.task.status})`);

const space = await taskSpace("worksplice-journey-card-transition");
// 每次取证前关掉上一轮遗留页：长时间取证后旧页可能被渲染器判定无响应。
for (const stale of await space.pages()) {
    try {
        await stale.close();
    } catch {
        // 已失联的页关不掉就跳过。
    }
}
// 每次取证用全新页面：复用的旧页在长时间取证后可能被渲染器判定无响应。
const page = await space.newPage();

async function preparePage() {
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
        // 老 ego 版本无此 CDP：chunk URL 带内容哈希，清 SW 缓存已足够。
    }
    await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
          window.__jctConsoleMessages = [];
          const original = console.error.bind(console);
          console.error = (...args) => {
            try { window.__jctConsoleMessages.push(args.map((arg) => String(arg)).join(" ")); } catch {}
            original(...args);
          };
          // 取证注入：把 200–900ms 的 setTimeout ×8 放缓，让粒子截图（ego 截图
          // 可能耗时 1s+）落在状态机清理计时器之前。动画 duration / 关键帧 /
          // 布局一律未改，冻结帧仍是真实中间帧；轮询间隔（通常 ≥1s）不受影响。
          const nativeSetTimeout = window.setTimeout.bind(window);
          window.setTimeout = (handler, delay, ...args) => {
            const value = Number(delay) || 0;
            const scaled = value >= 200 && value <= 900 ? value * 8 : value;
            return nativeSetTimeout(handler, scaled, ...args);
          };
        })();`,
    });
}

await preparePage();
record("locale zh-CN, sw/static caches cleared, console.error collector installed");

await page.goto(`${BASE}/?r=${Date.now()}#c/${a.channel.id}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
});
await page.waitForSelector(".ws-message-row", { timeout: 60000 });

/** 读卡壳 + 内容层 + 粒子层的可观察状态。 */
async function readCard() {
    return await page.evaluate(() => {
        const card = document.querySelector("section.journey-guide-card");
        if (!card) return null;
        const layer = card.querySelector(".journey-guide-particles");
        const outgoing = card.querySelector(".journey-guide-content-outgoing");
        const incoming = card.querySelector(
            ".journey-guide-content:not(.journey-guide-content-outgoing)",
        );
        const outParticle = card.querySelector(".journey-guide-particle.is-out");
        const inParticle = card.querySelector(".journey-guide-particle.is-in");
        const cardStyle = getComputedStyle(card);
        const rect = card.getBoundingClientRect();
        return {
            label: card.getAttribute("aria-label"),
            kind: card.getAttribute("data-guide-kind"),
            phase: card.getAttribute("data-guide-phase"),
            className: card.className,
            cardAnimationName: cardStyle.animationName,
            cardOpacity: cardStyle.opacity,
            cardTransform: cardStyle.transform,
            cardRect: {
                left: Math.round(rect.left * 10) / 10,
                top: Math.round(rect.top * 10) / 10,
                width: Math.round(rect.width * 10) / 10,
                height: Math.round(rect.height * 10) / 10,
            },
            contentOpacity: incoming ? getComputedStyle(incoming).opacity : null,
            contentText: (incoming?.textContent ?? "").slice(0, 60),
            incomingAnimationName: incoming ? getComputedStyle(incoming).animationName : null,
            incomingClassName: incoming?.className ?? null,
            outgoingCount: card.querySelectorAll(".journey-guide-content-outgoing").length,
            outgoingOpacity: outgoing ? getComputedStyle(outgoing).opacity : null,

            outgoingClassName: outgoing?.className ?? null,

            outgoingAnimationName: outgoing ? getComputedStyle(outgoing).animationName : null,
            outgoingText: outgoing ? (outgoing.textContent ?? "").slice(0, 60) : null,
            fxCount: layer?.childElementCount ?? 0,
            outCount: card.querySelectorAll(".journey-guide-particle.is-out").length,
            inCount: card.querySelectorAll(".journey-guide-particle.is-in").length,
            outAnim: outParticle ? getComputedStyle(outParticle).animationName : null,
            inAnim: inParticle ? getComputedStyle(inParticle).animationName : null,
            layerAriaHidden: layer?.getAttribute("aria-hidden") ?? null,
            layerPointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
            layerCount: card.querySelectorAll(".journey-guide-particles").length,
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
                const outgoing = card.querySelector(".journey-guide-content-outgoing");
                const incoming = card.querySelector(
                    ".journey-guide-content:not(.journey-guide-content-outgoing)",
                );
                const outParticle = card.querySelector(".journey-guide-particle.is-out");
                const inParticle = card.querySelector(".journey-guide-particle.is-in");
                const cardStyle = getComputedStyle(card);
                const rect = card.getBoundingClientRect();
                return {
                    label: card.getAttribute("aria-label"),
                    kind: card.getAttribute("data-guide-kind"),
                    phase: card.getAttribute("data-guide-phase"),
                    className: card.className,
                    cardAnimationName: cardStyle.animationName,
                    cardOpacity: cardStyle.opacity,
                    cardTransform: cardStyle.transform,
                    cardRect: {
                        left: Math.round(rect.left * 10) / 10,
                        top: Math.round(rect.top * 10) / 10,
                        width: Math.round(rect.width * 10) / 10,
                        height: Math.round(rect.height * 10) / 10,
                    },
                    contentOpacity: incoming ? getComputedStyle(incoming).opacity : null,
                    contentText: (incoming?.textContent ?? "").slice(0, 60),
                    incomingAnimationName: incoming
                        ? getComputedStyle(incoming).animationName
                        : null,
                    incomingClassName: incoming?.className ?? null,
                    outgoingCount: card.querySelectorAll(".journey-guide-content-outgoing").length,
                    outgoingOpacity: outgoing ? getComputedStyle(outgoing).opacity : null,

                    outgoingClassName: outgoing?.className ?? null,

                    outgoingAnimationName: outgoing ? getComputedStyle(outgoing).animationName : null,
                    outgoingText: outgoing ? (outgoing.textContent ?? "").slice(0, 60) : null,
                    fxCount: layer?.childElementCount ?? 0,
                    outCount: card.querySelectorAll(".journey-guide-particle.is-out").length,
                    inCount: card.querySelectorAll(".journey-guide-particle.is-in").length,
                    outAnim: outParticle ? getComputedStyle(outParticle).animationName : null,
                    inAnim: inParticle ? getComputedStyle(inParticle).animationName : null,
                    layerAriaHidden: layer?.getAttribute("aria-hidden") ?? null,
                    layerPointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
                    layerCount: card.querySelectorAll(".journey-guide-particles").length,
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

/**
 * 只冻结粒子动画到指定时刻，便于截到粒子在途的一帧。
 * 不能冻结全部动画：内容层的 opacity transition 也会被 getAnimations() 命中，
 * 一并暂停会把新内容永久停在 opacity 0，截出空卡。
 */
async function freezeParticleAnimations(ms) {
    await page.evaluate((currentTime) => {
        window.__jctFrozenAnimations = [];
        for (const animation of document.getAnimations()) {
            const target = animation.effect?.target;
            const name =
                typeof animation.animationName === "string" ? animation.animationName : "";
            const isParticle =
                target instanceof HTMLElement &&
                target.classList.contains("journey-guide-particle");
            // 退场时连同内容燃尽一起冻结，否则 140ms 的 burn 会在截图途中结束，
            // 只剩实体文字、看不到粒子承接。
            const isBurn = name === "journey-guide-content-burn";
            if (!isParticle && !isBurn) continue;
            animation.pause();
            animation.currentTime = currentTime;
            window.__jctFrozenAnimations.push(animation);
        }
    }, ms);
}

async function resumeParticleAnimations() {
    await page.evaluate(() => {
        for (const animation of window.__jctFrozenAnimations ?? []) {
            try {
                animation.play();
            } catch {
                // 粒子可能已被状态机清理，忽略。
            }
        }
        window.__jctFrozenAnimations = [];
    });
}

/** 只截卡面区域：裁剪截图比整页截图快，能在粒子清理计时器触发前落盘。 */
async function shotCard(name) {
    const box = await page.evaluate(() => {
        const card = document.querySelector("section.journey-guide-card");
        if (!card) return null;
        card.scrollIntoView({ block: "center" });
        const rect = card.getBoundingClientRect();
        const x = Math.max(0, rect.left - 12);
        const y = Math.max(0, rect.top - 12);
        return {
            x,
            y,
            width: Math.min(window.innerWidth - x, rect.width + 24),
            height: Math.min(window.innerHeight - y, rect.height + 24),
        };
    });
    if (!box) {
        await page.screenshot({ path: PATH.join(EVIDENCE, `after-${name}.png`) });
        return;
    }
    await page.screenshot({
        path: PATH.join(EVIDENCE, `after-${name}.png`),
        clip: box,
    });
}

/**
 * 冻结在消散驻留段时测量对齐：文本行用 DOM Range 行盒 + 与实现相同的 canvas 字体
 * 度量推导预期墨迹；按钮用元素矩形。返回每行的 delta（粒子墨迹 bbox - 预期）。
 */
async function measureAlignment() {
    return await page.evaluate(() => {
        const card = document.querySelector("section.journey-guide-card");
        const layer = card.querySelector(".journey-guide-particles");
        const outgoing = card.querySelector(".journey-guide-content-outgoing");
        if (!layer || !outgoing) return null;
        const layerRect = layer.getBoundingClientRect();
        const particles = [...layer.querySelectorAll(".journey-guide-particle.is-out")].map(
            (el) => {
                const r = el.getBoundingClientRect();
                return {
                    left: r.left - layerRect.left,
                    right: r.right - layerRect.left,
                    top: r.top - layerRect.top,
                    bottom: r.bottom - layerRect.top,
                    cy: (r.top + r.bottom) / 2 - layerRect.top,
                };
            },
        );

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const blocks = [...outgoing.querySelectorAll('[data-guide-sample="text"]')];
        const lineChecks = [];
        for (const [blockIndex, block] of blocks.entries()) {
            const style = getComputedStyle(block);
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (!node.nodeValue?.trim()) continue;
                const glyphs = [];
                const range = document.createRange();
                for (let index = 0; index < node.nodeValue.length; index += 1) {
                    range.setStart(node, index);
                    range.setEnd(node, index + 1);
                    const r = range.getBoundingClientRect();
                    if (!r.width && !r.height) continue;
                    glyphs.push({
                        char: node.nodeValue[index],
                        top: r.top - layerRect.top,
                        left: r.left - layerRect.left,
                        right: r.right - layerRect.left,
                        bottom: r.bottom - layerRect.top,
                    });
                }
                const grouped = [];
                for (const glyph of glyphs) {
                    let line = grouped.find(
                        (candidate) => Math.abs(candidate.top - glyph.top) < 0.5,
                    );
                    if (!line) {
                        line = {
                            top: glyph.top,
                            bottom: glyph.bottom,
                            left: glyph.left,
                            right: glyph.right,
                            text: "",
                        };
                        grouped.push(line);
                    }
                    line.text += glyph.char;
                    line.left = Math.min(line.left, glyph.left);
                    line.right = Math.max(line.right, glyph.right);
                    line.bottom = Math.max(line.bottom, glyph.bottom);
                }
                ctx.font = `${style.fontWeight} ${Number.parseFloat(style.fontSize)}px ${style.fontFamily}`;
                const fontAscent = ctx.measureText("国").fontBoundingBoxAscent;
                for (const line of grouped) {
                    const metrics = ctx.measureText(line.text);
                    const baseline = line.top + fontAscent;
                    const expected = {
                        left: line.left - Math.abs(metrics.actualBoundingBoxLeft),
                        right: line.left + metrics.actualBoundingBoxRight,
                        top: baseline - metrics.actualBoundingBoxAscent,
                        bottom: baseline + metrics.actualBoundingBoxDescent,
                    };
                    const band = particles.filter(
                        (particle) =>
                            particle.cy >= line.top - 2 && particle.cy <= line.bottom + 2,
                    );
                    if (band.length === 0) continue;
                    const ink = {
                        left: Math.min(...band.map((particle) => particle.left)),
                        right: Math.max(...band.map((particle) => particle.right)),
                        top: Math.min(...band.map((particle) => particle.top)),
                        bottom: Math.max(...band.map((particle) => particle.bottom)),
                    };
                    lineChecks.push({
                        block: blockIndex === 0 ? "title" : "hint",
                        text: line.text.slice(0, 28),
                        count: band.length,
                        lineBox: {
                            left: Math.round(line.left * 100) / 100,
                            right: Math.round(line.right * 100) / 100,
                            top: Math.round(line.top * 100) / 100,
                            bottom: Math.round(line.bottom * 100) / 100,
                        },
                        ink: {
                            left: Math.round(ink.left * 100) / 100,
                            right: Math.round(ink.right * 100) / 100,
                            top: Math.round(ink.top * 100) / 100,
                            bottom: Math.round(ink.bottom * 100) / 100,
                        },
                        delta: {
                            left: Math.round((ink.left - expected.left) * 100) / 100,
                            right: Math.round((ink.right - expected.right) * 100) / 100,
                            top: Math.round((ink.top - expected.top) * 100) / 100,
                            bottom: Math.round((ink.bottom - expected.bottom) * 100) / 100,
                        },
                    });
                }
            }
        }

        const button = outgoing.querySelector('[data-guide-sample="button"]');
        let buttonCheck = null;
        if (button) {
            const r = button.getBoundingClientRect();
            const rect = {
                left: r.left - layerRect.left,
                top: r.top - layerRect.top,
                right: r.right - layerRect.left,
                bottom: r.bottom - layerRect.top,
            };
            const band = particles.filter(
                (particle) =>
                    particle.cy >= rect.top - 2 && particle.cy <= rect.bottom + 2,
            );
            if (band.length > 0) {
                const ink = {
                    left: Math.min(...band.map((particle) => particle.left)),
                    right: Math.max(...band.map((particle) => particle.right)),
                    top: Math.min(...band.map((particle) => particle.top)),
                    bottom: Math.max(...band.map((particle) => particle.bottom)),
                };
                buttonCheck = {
                    count: band.length,
                    rect: Object.fromEntries(
                        Object.entries(rect).map(([key, value]) => [
                            key,
                            Math.round(value * 100) / 100,
                        ]),
                    ),
                    ink: Object.fromEntries(
                        Object.entries(ink).map(([key, value]) => [
                            key,
                            Math.round(value * 100) / 100,
                        ]),
                    ),
                    delta: {
                        left: Math.round((ink.left - rect.left) * 100) / 100,
                        right: Math.round((ink.right - rect.right) * 100) / 100,
                        top: Math.round((ink.top - rect.top) * 100) / 100,
                        bottom: Math.round((ink.bottom - rect.bottom) * 100) / 100,
                    },
                };
            }
        }
        return { layerWidth: Math.round(layerRect.width * 10) / 10, lines: lineChecks, button: buttonCheck };
    });
}

const failures = [];
const expect = (condition, message) => {
    if (!condition) failures.push(message);
};
const assertShellStatic = (state, where) => {
    expect(
        state?.className === "journey-guide-card",
        `${where}: 卡壳 class 应只有 journey-guide-card，实际 ${JSON.stringify(state?.className)}`,
    );
    expect(
        state?.cardAnimationName === "none",
        `${where}: 卡壳 animation-name 应为 none，实际 ${JSON.stringify(state?.cardAnimationName)}`,
    );
    expect(
        state?.cardOpacity === "1",
        `${where}: 卡壳 opacity 应为 1，实际 ${JSON.stringify(state?.cardOpacity)}`,
    );
    expect(
        state?.cardTransform === "none",
        `${where}: 卡壳 transform 应为 none，实际 ${JSON.stringify(state?.cardTransform)}`,
    );
};
const assertAlignment = (measurement, where, { requireWrappedHint = false } = {}) => {
    expect(Boolean(measurement), `${where}: 未取到对齐测量结果`);
    if (!measurement) return;
    const hintLines = measurement.lines.filter((line) => line.block === "hint");
    if (requireWrappedHint) {
        expect(
            hintLines.length >= 2,
            `${where}: 窄容器下 hint 应折成 ≥2 行，实际 ${hintLines.length}`,
        );
    }
    for (const line of measurement.lines) {
        const worst = Math.max(...Object.values(line.delta).map((value) => Math.abs(value)));
        expect(
            worst <= ALIGN_TOLERANCE_PX,
            `${where}: ${line.block} 行「${line.text}」粒子墨迹偏差 ${worst}px > ${ALIGN_TOLERANCE_PX}px (${JSON.stringify(line.delta)})`,
        );
    }
    expect(Boolean(measurement.button), `${where}: 未取到按钮对齐测量结果`);
    if (measurement.button) {
        const worst = Math.max(
            ...Object.values(measurement.button.delta).map((value) => Math.abs(value)),
        );
        expect(
            worst <= ALIGN_TOLERANCE_PX,
            `${where}: 按钮底板粒子偏差 ${worst}px > ${ALIGN_TOLERANCE_PX}px (${JSON.stringify(measurement.button.delta)})`,
        );
    }
};

const facts = { channelA: a.channel.id, taskA: a.task.id, steps: [] };

// —— 0. 初始 enter：handoff「等待交接或认领」——
const initialSeen = await waitForCard('card && card.label === "等待交接或认领"', 20000);
facts.initialSeen = initialSeen;
// 尽量抓 enter 中段（窗口约 415ms，抓不到不算失败）。
const enterMid = await waitForCard(
    'card && card.phase === "enter" && card.inCount > 0 && card.inAnim === "journey-guide-content-reform"',
    1500,
);
if (enterMid.matched) {
    await freezeParticleAnimations(160);
    const enterSample = await readCard();
    facts.enterMid = enterSample;
    record(
        `enter mid: inCount=${enterSample?.inCount} inAnim=${JSON.stringify(enterSample?.inAnim)} ` +
            `contentOpacity=${enterSample?.contentOpacity}`,
    );
    await shotCard("01-enter-mid");
    await resumeParticleAnimations();
} else {
    record("enter mid not captured (window already closed)");
}
const enterDone = await waitForCard(
    'card && card.label === "等待交接或认领" && card.fxCount === 0 && card.contentOpacity === "1"',
    15000,
);
facts.enterDone = enterDone;
record(
    `enter done: label=${JSON.stringify(enterDone.state?.label)} phase=${enterDone.state?.phase} ` +
        `fx=${enterDone.state?.fxCount} contentOpacity=${enterDone.state?.contentOpacity} timedOut=${enterDone.timedOut}`,
);
assertShellStatic(enterDone.state, "initial enter done");
await shotCard("00-initial");

// —— 1. claim：handoff → running，旧内容消散 → 新内容重聚 ——
await api(`/api/tasks/${encodeURIComponent(a.task.id)}/claim`, {
    method: "POST",
    body: JSON.stringify({}),
});
record("claim posted (todo → in_progress)");
const switching = await waitForCard(
    'card && card.label === "让它跑" && card.phase === "switch" && card.outCount > 0',
);
facts.switching = switching;
record(
    `switch detected: label=${JSON.stringify(switching.state?.label)} ` +
        `outCount=${switching.state?.outCount} outAnim=${JSON.stringify(switching.state?.outAnim)} ` +
        `outgoing=${switching.state?.outgoingCount} outgoingOpacity=${switching.state?.outgoingOpacity} ` +
        `outgoingAnimation=${JSON.stringify(switching.state?.outgoingAnimationName)} ` +
        `elapsed=${switching.elapsedMs}ms timedOut=${switching.timedOut}`,
);
await freezeParticleAnimations(120);
const dissolveMid = await readCard();
const dissolveAlign = await measureAlignment();
facts.dissolveMid = dissolveMid;
facts.dissolveAlign = dissolveAlign;
record(
    `dissolve mid: outCount=${dissolveMid?.outCount} outAnim=${JSON.stringify(dissolveMid?.outAnim)} ` +
        `incomingOpacity=${dissolveMid?.contentOpacity} outgoingOpacity=${dissolveMid?.outgoingOpacity} ` +
        `card=${JSON.stringify(dissolveMid?.cardRect)}`,
);
record(
    `dissolve alignment: ${JSON.stringify(dissolveAlign?.lines?.map((line) => ({ block: line.block, text: line.text, delta: line.delta })))} ` +
        `button=${JSON.stringify(dissolveAlign?.button?.delta)}`,
);
await shotCard("02-switch-dissolve-mid");
await resumeParticleAnimations();
// 截图 + 对齐测量期间浏览器计时器仍在走，第一轮不追重聚窗口（第二轮专测）。

const runningFinal = await waitForCard(
    'card && card.label === "让它跑" && card.phase === "switch" && card.fxCount === 0 && card.contentOpacity === "1"',
    20000,
);
facts.runningFinal = runningFinal;
record(
    `running final: fx=${runningFinal.state?.fxCount} contentOpacity=${runningFinal.state?.contentOpacity} ` +
        `outgoing=${runningFinal.state?.outgoingCount} card=${JSON.stringify(runningFinal.state?.cardRect)} ` +
        `elapsed=${runningFinal.elapsedMs}ms timedOut=${runningFinal.timedOut}`,
);
assertShellStatic(runningFinal.state, "switch 1 final");
await shotCard("04-switch-final");

// —— 2. 连续第二次切换：in_review → review，先确认上一轮无残留 ——
const residueBeforeSecond = await readCard();
facts.residueBeforeSecond = residueBeforeSecond;
record(
    `before 2nd switch: fx=${residueBeforeSecond?.fxCount} outgoing=${residueBeforeSecond?.outgoingCount} ` +
        `contentOpacity=${residueBeforeSecond?.contentOpacity}`,
);
await api(`/api/tasks/${encodeURIComponent(a.task.id)}/update-status`, {
    method: "POST",
    body: JSON.stringify({ status: "in_review" }),
});
record("update-status posted (in_progress → in_review)");
const switching2 = await waitForCard(
    'card && card.label === "去复核" && card.phase === "switch" && card.inCount > 0 && card.inAnim === "journey-guide-content-reform"',
);
facts.switching2 = switching2;
record(
    `2nd switch reform detected: label=${JSON.stringify(switching2.state?.label)} ` +
        `inCount=${switching2.state?.inCount} inAnim=${JSON.stringify(switching2.state?.inAnim)} ` +
        `elapsed=${switching2.elapsedMs}ms timedOut=${switching2.timedOut}`,
);
await freezeParticleAnimations(240);
const reformMid = await readCard();
facts.reforming = switching2;
facts.reformMid = reformMid;
record(
    `reform mid: inCount=${reformMid?.inCount} inAnim=${JSON.stringify(reformMid?.inAnim)} ` +
        `contentOpacity=${reformMid?.contentOpacity} text=${JSON.stringify(reformMid?.contentText?.slice(0, 12))}`,
);
await shotCard("05-switch2-reform-mid");
await resumeParticleAnimations();
const reviewFinal = await waitForCard(
    'card && card.label === "去复核" && card.fxCount === 0 && card.contentOpacity === "1"',
    20000,
);
facts.reviewFinal = reviewFinal;
record(
    `review final: fx=${reviewFinal.state?.fxCount} contentOpacity=${reviewFinal.state?.contentOpacity} ` +
        `elapsed=${reviewFinal.elapsedMs}ms timedOut=${reviewFinal.timedOut}`,
);
assertShellStatic(reviewFinal.state, "switch 2 final");

// —— 3. done：内容燃尽后退场，卡壳随后卸载（无整卡退场动画）——
await api(`/api/tasks/${encodeURIComponent(a.task.id)}/update-status`, {
    method: "POST",
    body: JSON.stringify({ status: "done" }),
});
record("update-status posted (in_review → done)");
const exiting = await waitForCard('card && card.phase === "exit"');
facts.exiting = exiting;
record(
    `exit detected: label=${JSON.stringify(exiting.state?.label)} outAnim=${JSON.stringify(exiting.state?.outAnim)} ` +
        `incomingAnim=${JSON.stringify(exiting.state?.incomingAnimationName)} ` +
        `incomingClass=${JSON.stringify(exiting.state?.incomingClassName)} ` +
        `elapsed=${exiting.elapsedMs}ms timedOut=${exiting.timedOut}`,
);
assertShellStatic(exiting.state, "exit");
await freezeParticleAnimations(120);
const exitMid = await readCard();
facts.exitMid = exitMid;
record(
    `exit mid: outCount=${exitMid?.outCount} outAnim=${JSON.stringify(exitMid?.outAnim)} ` +
        `incomingAnim=${JSON.stringify(exitMid?.incomingAnimationName)} ` +
        `contentOpacity=${exitMid?.contentOpacity} text=${JSON.stringify(exitMid?.contentText?.slice(0, 10))}`,
);
await shotCard("06-exit-mid");
const exitAfterShot = await readCard();
facts.exitAfterShot = exitAfterShot;
record(
    `exit after shot: outCount=${exitAfterShot?.outCount} ` +
        `incomingAnim=${JSON.stringify(exitAfterShot?.incomingAnimationName)} ` +
        `contentOpacity=${exitAfterShot?.contentOpacity}`,
);
await resumeParticleAnimations();
const gone = await waitForCard("card === null", 15000);
facts.gone = gone;
record(`exit complete: cardGone=${gone.matched} elapsed=${gone.elapsedMs}ms timedOut=${gone.timedOut}`);
await shot("07-done-gone");

// —— 4. reduce：不生成可见粒子，内容立即终态 ——
const b = await createChannelWithTask("jct-reduce");
record(`channel B ${b.channel.id}, task ${b.task.id}`);
await page.cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
record("Emulation.setEmulatedMedia prefers-reduced-motion: reduce");
await page.goto(`${BASE}/?r=${Date.now()}#c/${b.channel.id}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
});
await page.waitForSelector(".ws-message-row", { timeout: 60000 });
const reducedInitial = await waitForCard(
    'card && card.label === "等待交接或认领" && card.contentOpacity === "1"',
    20000,
);
facts.reducedInitial = reducedInitial;
record(
    `reduce initial: label=${JSON.stringify(reducedInitial.state?.label)} fx=${reducedInitial.state?.fxCount} ` +
        `contentOpacity=${reducedInitial.state?.contentOpacity} timedOut=${reducedInitial.timedOut}`,
);
await shotCard("08-reduce-initial");
await api(`/api/tasks/${encodeURIComponent(b.task.id)}/claim`, {
    method: "POST",
    body: JSON.stringify({}),
});
record("reduce: claim posted");
const reducedSwitch = await waitForCard(
    'card && card.label === "让它跑" && card.phase === "switch"',
);
await page.waitForTimeout(300);
const reducedSample = await readCard();
const reducedParticleElements = await page.evaluate(
    () => document.querySelectorAll(".journey-guide-particle").length,
);
facts.reducedSwitch = reducedSample;
facts.reducedParticleElements = reducedParticleElements;
record(
    `reduce switch: label=${JSON.stringify(reducedSample?.label)} fx=${reducedSample?.fxCount} ` +
        `particles=${reducedParticleElements} contentOpacity=${reducedSample?.contentOpacity} ` +
        `timedOut=${reducedSwitch.timedOut}`,
);
assertShellStatic(reducedSample, "reduce switch");
await shotCard("09-reduce-switch");
await page.cdp("Emulation.setEmulatedMedia", { media: "", features: [] });
record("Emulation.setEmulatedMedia restored");

// —— 5. 窄容器：hint 折行后逐行对齐 ——
const c = await createChannelWithTask("jct-narrow");
record(`channel C ${c.channel.id}, task ${c.task.id}`);
await page.cdp("Emulation.setDeviceMetricsOverride", {
    width: 300,
    height: 900,
    // 与真实 macOS 屏一致：采样网格按 devicePixelRatio=2 计算（DPR=1 会把
    // 2.6px 网格量化误差放大到 1.5px 以上，属于取证环境失真而非布局偏差）。
    deviceScaleFactor: 2,
    mobile: false,
});
await page.goto(`${BASE}/?r=${Date.now()}#c/${c.channel.id}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
});
await page.waitForSelector(".ws-message-row", { timeout: 60000 });
const narrowInitial = await waitForCard(
    'card && card.label === "等待交接或认领" && card.contentOpacity === "1"',
    20000,
);
facts.narrowInitial = narrowInitial;
record(
    `narrow initial: label=${JSON.stringify(narrowInitial.state?.label)} card=${JSON.stringify(narrowInitial.state?.cardRect)}`,
);
await api(`/api/tasks/${encodeURIComponent(c.task.id)}/claim`, {
    method: "POST",
    body: JSON.stringify({}),
});
record("narrow: claim posted");
const narrowSwitch = await waitForCard(
    'card && card.label === "让它跑" && card.phase === "switch" && card.outCount > 0',
);
facts.narrowSwitch = narrowSwitch;
record(
    `narrow switch: outCount=${narrowSwitch.state?.outCount} elapsed=${narrowSwitch.elapsedMs}ms timedOut=${narrowSwitch.timedOut}`,
);
await freezeParticleAnimations(120);
const narrowAlign = await measureAlignment();
facts.narrowAlign = narrowAlign;
record(
    `narrow alignment: ${JSON.stringify(
        narrowAlign?.lines?.map((line) => ({ block: line.block, text: line.text, delta: line.delta })),
    )}`,
);
await shotCard("10-narrow-wrapped-dissolve-mid");
await resumeParticleAnimations();
const narrowFinal = await waitForCard(
    'card && card.label === "让它跑" && card.fxCount === 0 && card.contentOpacity === "1"',
    20000,
);
facts.narrowFinal = narrowFinal;
await page.cdp("Emulation.clearDeviceMetricsOverride");
record("device metrics cleared");

// —— 断言 ——
expect(initialSeen.matched, "首张卡应在 20s 内以「等待交接或认领」出现");
expect(enterDone.matched, `enter 应在 6s 内收尾，实际 ${JSON.stringify(enterDone.state)}`);
expect(switching.matched, `claim 后应出现 switch 消散，实际 ${JSON.stringify(switching.state)}`);
expect(
    dissolveMid?.outCount > 0,
    `消散中段应有 is-out 粒子，实际 ${dissolveMid?.outCount}`,
);
expect(
    dissolveMid?.outAnim === DISSOLVE,
    `消散粒子 animation-name 应为 ${DISSOLVE}，实际 ${JSON.stringify(dissolveMid?.outAnim)}`,
);
expect(
    dissolveMid?.outgoingCount === 1,
    `切换时应存在旧内容层，实际 ${dissolveMid?.outgoingCount}`,
);
expect(
    /is-burning/.test(dissolveMid?.outgoingClassName ?? ""),
    `旧内容层应在 140ms 内燃尽淡出（is-burning），实际 ${JSON.stringify(dissolveMid?.outgoingClassName)}`,
);
expect(
    dissolveMid?.outgoingAnimationName === BURN,
    `旧内容层 animation-name 应为 ${BURN}，实际 ${JSON.stringify(dissolveMid?.outgoingAnimationName)}`,
);
expect(
    dissolveMid?.contentOpacity === "0",
    `新内容在重聚前应不可见（opacity=0），实际 ${JSON.stringify(dissolveMid?.contentOpacity)}`,
);
expect(
    dissolveMid?.layerAriaHidden === "true",
    "粒子层应 aria-hidden=true",
);
expect(
    dissolveMid?.layerPointerEvents === "none",
    `粒子层应 pointer-events:none，实际 ${JSON.stringify(dissolveMid?.layerPointerEvents)}`,
);
expect(dissolveMid?.layerCount === 1, "卡内应只有一个粒子层");
assertShellStatic(dissolveMid, "dissolve mid");
assertAlignment(dissolveAlign, "dissolve mid");
expect(
    reformMid?.inAnim === REFORM,
    `重聚粒子 animation-name 应为 ${REFORM}，实际 ${JSON.stringify(reformMid?.inAnim)}`,
);
expect(
    (reformMid?.contentText ?? "").includes("去复核"),
    `重聚阶段的新内容应为「去复核」，实际 ${JSON.stringify(reformMid?.contentText)}`,
);
assertShellStatic(reformMid, "reform mid");
expect(
    reformMid?.outgoingOpacity === "0",
    `重聚阶段旧内容应已燃尽（opacity=0），实际 ${JSON.stringify(reformMid?.outgoingOpacity)}`,
);
expect(runningFinal.matched, `切换结束后应稳定在「让它跑」，实际 ${JSON.stringify(runningFinal.state)}`);
expect(
    runningFinal.state?.fxCount === 0 && runningFinal.state?.outgoingCount === 0,
    `切换结束后粒子层应清空且无旧内容层，实际 fx=${runningFinal.state?.fxCount} outgoing=${runningFinal.state?.outgoingCount}`,
);
expect(
    runningFinal.state?.contentOpacity === "1",
    `切换结束后内容 opacity 应为 1，实际 ${JSON.stringify(runningFinal.state?.contentOpacity)}`,
);
expect(
    Math.abs((runningFinal.state?.cardRect?.width ?? 0) - (dissolveMid?.cardRect?.width ?? -1)) <= 1.5,
    `卡壳宽度不应变化：dissolve=${dissolveMid?.cardRect?.width} final=${runningFinal.state?.cardRect?.width}`,
);
expect(
    Math.abs((runningFinal.state?.cardRect?.height ?? 0) - (dissolveMid?.cardRect?.height ?? -1)) <= 2,
    `卡壳高度不应跳动：dissolve=${dissolveMid?.cardRect?.height} final=${runningFinal.state?.cardRect?.height}`,
);

expect(
    residueBeforeSecond?.fxCount === 0 && residueBeforeSecond?.outgoingCount === 0,
    `第二次切换前不得有粒子/旧内容残留，实际 fx=${residueBeforeSecond?.fxCount} outgoing=${residueBeforeSecond?.outgoingCount}`,
);
expect(
    switching2.matched,
    `第二次切换应在消散后出现重聚粒子，实际 ${JSON.stringify(switching2.state)}`,
);
expect(
    switching2.state?.inAnim === REFORM && switching2.state?.inCount > 0,
    `第二次切换应为重聚粒子，实际 anim=${JSON.stringify(switching2.state?.inAnim)} count=${switching2.state?.inCount}`,
);
assertShellStatic(reviewFinal.state, "switch 2 final");
expect(
    reviewFinal.state?.fxCount === 0 && reviewFinal.state?.contentOpacity === "1",
    `第二次切换收尾应无残留，实际 fx=${reviewFinal.state?.fxCount} opacity=${reviewFinal.state?.contentOpacity}`,
);

expect(exiting.matched, "done 后应出现 exit 阶段");
expect(
    exiting.state?.outAnim === DISSOLVE && exiting.state?.outCount > 0,
    `退场应燃尽内容（is-out 消散），实际 anim=${JSON.stringify(exiting.state?.outAnim)} count=${exiting.state?.outCount}`,
);
expect(
    exiting.state?.incomingAnimationName === BURN,
    `退场时实体内容应播 ${BURN}，实际 ${JSON.stringify(exiting.state?.incomingAnimationName)}`,
);
expect(
    /is-burning/.test(exiting.state?.incomingClassName ?? ""),
    `退场时内容层应带 is-burning，实际 ${JSON.stringify(exiting.state?.incomingClassName)}`,
);
expect(gone.matched, "退场结束后卡壳应卸载");

expect(
    reducedInitial.matched && reducedInitial.state?.fxCount === 0,
    `reduce 首现不应生成粒子，实际 ${JSON.stringify(reducedInitial.state)}`,
);
expect(
    reducedSample?.fxCount === 0 && reducedSample?.contentOpacity === "1",
    `reduce 切换应为终态（无粒子、内容可见），实际 fx=${reducedSample?.fxCount} opacity=${reducedSample?.contentOpacity}`,
);
expect(
    reducedParticleElements === 0,
    `reduce 下不应有可见粒子元素，实际 ${reducedParticleElements}`,
);
expect(narrowSwitch.matched, `窄容器下应检测到消散粒子，实际 ${JSON.stringify(narrowSwitch.state)}`);
assertAlignment(narrowAlign, "narrow wrapped hint", { requireWrappedHint: true });
expect(
    narrowFinal.state?.fxCount === 0 && narrowFinal.state?.contentOpacity === "1",
    `窄容器收尾应无残留，实际 fx=${narrowFinal.state?.fxCount} opacity=${narrowFinal.state?.contentOpacity}`,
);

const consoleMessages = await page.evaluate(() => window.__jctConsoleMessages ?? []);
const hydrationWarnings = consoleMessages.filter((message) =>
    /hydrat|did not match|server rendered|server-rendered/i.test(message),
);
facts.hydrationWarnings = hydrationWarnings;
facts.consoleMessages = consoleMessages;
record(
    `console.error messages=${consoleMessages.length} hydrationWarnings=${hydrationWarnings.length}` +
        (hydrationWarnings.length > 0 ? ` ${JSON.stringify(hydrationWarnings)}` : ""),
);
expect(hydrationWarnings.length === 0, "不应出现 SSR/hydration 警告");

const labelSequence = [
    initialSeen.state?.label,
    switching.state?.label,
    reviewFinal.state?.label,
    gone.matched ? null : gone.state?.label,
];
facts.labelSequence = labelSequence;
expect(
    JSON.stringify(labelSequence) ===
        JSON.stringify(["等待交接或认领", "让它跑", "去复核", null]),
    `aria-label 序列应依次为 等待交接或认领 → 让它跑 → 去复核 → 卸载，实际 ${JSON.stringify(labelSequence)}`,
);

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

await page.close();
if (failures.length > 0) {
    throw new Error(`probe = RED: ${failures.join("; ")}`);
}
