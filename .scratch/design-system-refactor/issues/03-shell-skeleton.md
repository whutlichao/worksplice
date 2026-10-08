# 03 — 三栏骨架与响应式

**What to build:** 把 `AppShell.tsx` 与 `app/globals.css` 的 `ws-*` 骨架改成设计系统的三栏形态：`.app` 语义（`display:flex; height:100dvh; overflow:hidden`）、rail 消费 `--rail-w`（252px，替换硬编码 236px）、dock 消费 `--dock-w` 380px 与 `--dock-w-md` 340px（替换 `min(480px, 44vw)`）、发丝分隔（`1px solid var(--border)`，替换 `2px solid var(--ink)`）、`--z-*` 阶梯（替换 300/490/500 硬编码）、`--dur-drawer` + `--ease`（替换硬编码 0.2s）。响应式：抽屉断点 960 → 900；新增 ≤1080 的 dock 收窄。`WorkspaceSidebar` 的 `.rail` 形态：`.rail-head` / `.brand`（`.brand-mark` + `.brand-name` + `.brand-sub`）/ `.search-btn`（`:focus-within` accent 环）/ `.rail-actions` / `.group-label`（mono 9.5px + `letter-spacing .1em`）/ `.nav-row`（激活 = `--surface` 填充 + inset 发丝 + 2px accent `::before` 竖条 + accent mono `#`）/ `.rail-foot`。

**Blocked by:** 02

**Status:** pending

- [ ] rail 宽度来自 `var(--rail-w)`；dock 宽度来自 `var(--dock-w)` / `var(--dock-w-md)`
- [ ] 骨架分隔一律 1px 发丝；无 2px ink
- [ ] `z-index` 全部来自 `--z-*`
- [ ] 抽屉过渡用 `--dur-drawer` + `--ease`；test 断言 `max-width: 900px` 存在、`960px` 不存在
- [ ] `≤1080px` 下 dock 收窄到 340px（E2E 或源码断言）
- [ ] 导航激活态 = `--accent-soft` 底 + `--accent` 文字/竖条（不是黄色实心）
- [ ] `AppShell` 渲染断言：markup 里出现 `var(--rail-w)` / `var(--dock-w)`，不出现 `236px` / `480px`
- [ ] `components/MobilePwaLayout.test.mjs` 的 4 条护栏断言全绿（安全区 / `--app-viewport-height` / 输入框 16px）
- [ ] `npm test` / `tsc --noEmit` 通过

## Answer
