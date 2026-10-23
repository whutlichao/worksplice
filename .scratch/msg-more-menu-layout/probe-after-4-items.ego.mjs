/**
 * 反馈回路（diagnosing-bugs 阶段 1/5）：真实浏览器里量 `···` 二级菜单的几何。
 *
 * 断言的是用户看到的那条症状，不是「没报错」：
 *   ① 每个菜单项高度 ≥ 26 且相邻项区间不重叠
 *   ② 每项内 svg 与文字 span 在同一行（top 差 ≤ 3px）、图标在文字左侧
 *   ③ 面板包住全部项（scrollHeight ≤ clientHeight + 1）、最后一项不溢出面板内边距
 *   ④ 面板不溢出视口左右边界
 *   ⑤ 最长标签不换行、项内容不溢出自身盒子
 *
 * 用法：ego-browser nodejs < 本文件；SHOT 决定截图文件名。
 * 每轮都带 cache-buster 重新加载：`···` 是 toggle，复用上一轮的展开态会让「开」变成「关」。
 */
const SHOT = "after-4-items";
const BASE = "http://127.0.0.1:30177";
const CHANNEL = "11352d0f-b071-4407-85df-646a66e1298c"; // stream-sync
const SHOT_DIR =
    "/Users/apple/orca/workspaces/worksplice/msg-more-menu-layout/.scratch/msg-more-menu-layout/evidence";

const task = await taskSpace("worksplice-more-menu-layout");
const page = task.page("p1");
await page.goto(`${BASE}/?r=${Date.now()}#c/${CHANNEL}`);
await page.waitForSelector(".ws-message-row");
await page.waitForTimeout(1500);

async function candidateRows() {
    return await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".ws-message-row")];
        return rows
            .map((row, i) => ({ row, i }))
            .filter(({ row }) => {
                if (!row.querySelector('.msg-tools button[aria-haspopup="menu"]')) return false;
                const r = row.getBoundingClientRect();
                return r.top >= 80 && r.bottom <= window.innerHeight - 80;
            })
            .map(({ row, i }) => {
                const r = row.getBoundingClientRect();
                return {
                    i,
                    center: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
                    text: row.textContent.slice(0, 50),
                };
            });
    });
}

/** 在某个行上把 `···` 菜单打开，返回项数（0 = 没打开）。 */
async function openMenuOn(candidate) {
    await page.press("body", "Escape");
    await page.waitForTimeout(120);
    await page.mouse.move(candidate.center.x, candidate.center.y, { label: "hover message row" });
    await page.waitForTimeout(250);
    const btn = await page.evaluate((i) => {
        const row = [...document.querySelectorAll(".ws-message-row")][i];
        const el = row.querySelector('.msg-tools button[aria-haspopup="menu"]');
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return null;
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, candidate.i);
    if (!btn) return 0;
    await page.mouse.click(btn.x, btn.y, { label: "open ··· menu" });
    await page.waitForTimeout(250);
    return await page.evaluate(() => document.querySelectorAll('.msg-tools [role="menuitem"]').length);
}

// 优先选能给出全部 4 项（含「转为任务」）的行——那是用户截图里的形态。
const candidates = await candidateRows();
if (candidates.length === 0) throw new Error("没有找到带 ··· 触发器的消息行");
let chosen = null;
let itemCount = 0;
for (const candidate of candidates.slice(0, 20)) {
    const n = await openMenuOn(candidate);
    if (n > itemCount) {
        chosen = candidate;
        itemCount = n;
    }
    if (n >= 4) break;
}
if (!chosen || itemCount === 0) throw new Error("菜单打不开");
await openMenuOn(chosen);
await page.waitForSelector('.msg-tools [role="menu"]');
await page.waitForTimeout(300);

const shot = await page.screenshot({ path: `${SHOT_DIR}/${SHOT}.png` });

const probe = await page.evaluate(() => {
    const menu = document.querySelector('.msg-tools div[role="menu"]');
    if (!menu) return { error: "no menu inside .msg-tools" };
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const menuRect = menu.getBoundingClientRect();
    const cs = getComputedStyle(menu);
    const num = (v) => parseFloat(v) || 0;

    const rects = items.map((item) => {
        const r = item.getBoundingClientRect();
        const svg = item.querySelector("svg");
        const span = item.querySelector("span");
        const sr = svg?.getBoundingClientRect() ?? null;
        const pr = span?.getBoundingClientRect() ?? null;
        const style = getComputedStyle(item);
        return {
            label: item.textContent.trim(),
            rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width },
            svg: sr && { top: sr.top, left: sr.left, width: sr.width, height: sr.height },
            span: pr && {
                top: pr.top,
                left: pr.left,
                clientWidth: span.clientWidth,
                scrollWidth: span.scrollWidth,
            },
            itemScrollHeight: item.scrollHeight,
            itemClientHeight: item.clientHeight,
            display: style.display,
            height: style.height,
            paddingLeft: style.paddingLeft,
        };
    });

    const overlaps = [];
    for (let i = 1; i < rects.length; i += 1) {
        if (rects[i].rect.top < rects[i - 1].rect.bottom - 0.5) {
            overlaps.push([rects[i - 1].label, rects[i].label]);
        }
    }

    return {
        heights: rects.map((r) => ({ label: r.label, height: Math.round(r.rect.height * 10) / 10 })),
        overlaps,
        inline: rects.map((r) => ({
            label: r.label,
            topDelta: r.svg && r.span ? Math.round((r.span.top - r.svg.top) * 10) / 10 : null,
            iconLeftOfText: r.svg && r.span ? r.svg.left < r.span.left : null,
        })),
        menu: {
            rect: {
                top: menuRect.top,
                bottom: menuRect.bottom,
                left: menuRect.left,
                right: menuRect.right,
                width: menuRect.width,
                height: menuRect.height,
            },
            clientHeight: menu.clientHeight,
            scrollHeight: menu.scrollHeight,
            padding: {
                top: num(cs.paddingTop),
                right: num(cs.paddingRight),
                bottom: num(cs.paddingBottom),
                left: num(cs.paddingLeft),
            },
        },
        lastItem: rects.length ? { bottom: rects.at(-1).rect.bottom, label: rects.at(-1).label } : null,
        nowrap: rects.map((r) => ({
            label: r.label,
            wraps: r.span ? r.span.scrollWidth > r.span.clientWidth + 1 : null,
            itemOverflows: r.itemScrollHeight > r.itemClientHeight + 1,
        })),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        styles: rects.map((r) => ({ label: r.label, display: r.display, height: r.height, paddingLeft: r.paddingLeft })),
    };
});

if (probe.error) throw new Error(probe.error);

const failures = [];
if (probe.heights.length === 0) failures.push("菜单没有任何 [role=menuitem]");
for (const h of probe.heights) if (h.height < 26) failures.push(`① 项「${h.label}」高度 ${h.height} < 26`);
if (probe.overlaps.length) failures.push(`① 相邻项重叠：${JSON.stringify(probe.overlaps)}`);
for (const i of probe.inline) {
    if (i.topDelta === null) failures.push(`② 项「${i.label}」缺 svg 或 span`);
    else {
        if (Math.abs(i.topDelta) > 3) failures.push(`② 项「${i.label}」图标与文字不在同一行（top 差 ${i.topDelta}px）`);
        if (!i.iconLeftOfText) failures.push(`② 项「${i.label}」图标不在文字左侧`);
    }
}
if (probe.menu.scrollHeight > probe.menu.clientHeight + 1) {
    failures.push(
        `③ 面板内容溢出（scrollHeight ${probe.menu.scrollHeight} > clientHeight ${probe.menu.clientHeight}）`,
    );
}
if (probe.lastItem) {
    const limit = probe.menu.rect.bottom - probe.menu.padding.bottom;
    if (probe.lastItem.bottom > limit + 0.5) {
        failures.push(
            `③ 最后一项「${probe.lastItem.label}」底部 ${Math.round(probe.lastItem.bottom)} 溢出面板内边距线 ${Math.round(limit)}`,
        );
    }
}
if (probe.menu.rect.right > probe.viewport.width) {
    failures.push(`④ 面板右边 ${Math.round(probe.menu.rect.right)} 溢出视口 ${probe.viewport.width}`);
}
if (probe.menu.rect.left < 0) failures.push(`④ 面板左边 ${Math.round(probe.menu.rect.left)} < 0`);
for (const n of probe.nowrap) {
    if (n.wraps) failures.push(`⑤ 项「${n.label}」标签换行（scrollWidth > clientWidth）`);
    if (n.itemOverflows) failures.push(`⑤ 项「${n.label}」内容溢出自身盒子`);
}

console.log(
    JSON.stringify({ shot, chosen: chosen.text, itemCount, probe, failures, verdict: failures.length ? "RED" : "GREEN" }, null, 2),
);
process.exitCode = failures.length ? 1 : 0;
