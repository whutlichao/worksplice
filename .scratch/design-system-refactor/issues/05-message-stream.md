# 05 — 消息流与 composer

**What to build:** `components/ChannelView.tsx` 的频道面按原型形态重做：`.chan-head`（`--surface` 底 + 下边发丝）/ `.chan-top` / `.chan-title`（16px / 680 / `letter-spacing -.02em`，`#` 号是 accent mono）/ `.chan-desc` / `.chan-tools` / `.chan-divider` / `.pin-strip`（`--panel` callout + accent pin 图标）/ `.day-sep` / `.msg`（hover `--fg-soft` 填充）/ `.msg-head` / `.msg-author`（`.is-agent` → accent）/ `.msg-tag`（"Agent" 胶囊）/ `.msg-time`（mono 10.5px）/ `.msg-body` / `.msg-text` / `.msg-tools`（绝对定位，hover/focus 才出，`--shadow-pop`，`opacity` 过渡 0.12s）/ `.reactions` / `.reaction` / `.task-chip` / `.composer` / `.composer-box`（`--surface` + `--border-strong` + `--r-lg` + `--shadow-composer`，`:focus-within` → `0 0 0 3px var(--accent-soft)`）/ `.composer-bar` / `.composer-hint` / `.composer-send`（accent 方块）。锚点行高亮从「黄色实心」改为 `--accent-soft` 底 + 左侧 accent 条（与 D3 的 `--bg-selected` 处置同源）。

**Blocked by:** 03, 04

**Status:** pending

- [ ] 消息行 hover 走 `--fg-soft`；锚点行不再是黄色实心（渲染断言：hover 类不指向 `--yellow`）
- [ ] **消息作者头像**（`ChannelView.tsx:910`）尺寸 40 → 26px（`size="md"` = `--avatar-md`）；行高随之重校（票 04 已迁到 `Avatar`，本票只收尺寸与行高）
- [ ] 消息行与动作栏无 `2px solid`
- [ ] composer 有 accent 焦点环 + `--shadow-composer`；常驻输入不吃 `--shadow-pop`
- [ ] 时间戳与 `#seq` 用 `var(--mono)` + `tabular-nums`
- [ ] 既有 8 个 `MessageRow` 用例（`components/ChannelView.test.mjs`）全绿——它们断的是无障碍名，视觉票不得改行为
- [ ] `components/MobilePwaLayout.test.mjs` 的 `overflow-x-hidden overflow-y-auto` 断言按票 02 的处置保持或同步更新
- [ ] `npm test` / `tsc --noEmit` 通过

## Answer
