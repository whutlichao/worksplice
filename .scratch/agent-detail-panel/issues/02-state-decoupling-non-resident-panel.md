# 02 — 中央/面板状态解耦 + 非长驻右栏 + 左栏高亮

**What to build:** 点 agent（channel 内成员面板 / @提及 / 左栏 agent 行）后详情在右栏出现，中央频道消息流保持不动、不再被清空；无面板内容时右栏整栏消失、中央吃满宽度；右栏加宽至 ~380px；X 关闭面板；切换频道清空面板；左栏仅高亮频道行。agent 变体先复用现有 agent 详情面板。

**Blocked by:** 01 — 面板状态纯模块

**Status:** resolved

- [x] channel 内点 agent → 右栏详情出现，中央频道消息列表不被清空、阅读位置不丢
- [x] 左栏点 agent 行 → 面板打开，中央频道不变；左栏频道行仍高亮、agent 行不高亮
- [x] X → 面板关闭，右栏整栏消失，中央占满宽度
- [x] 切换频道 → 面板清空
- [x] 无面板内容时不渲染右栏；面板宽度 ~380px
- [x] 点 agent 后中央 3s 消息轮询持续运行（agent 回复不因看详情而漏刷）
- [x] tsc + eslint + node --test 通过

## Answer

随 commit `d580305`（#13）落地：

- **状态解耦**：`AppShell.tsx` 中央（`centerSelection`）与面板（`panelContent`）两个独立 state——点 agent/人类/线程只写面板，中央频道消息流与阅读位置不动；channel 内 mention 点击经 `onOpenPanel`（`ChannelView.tsx:1628` `memberPanel`）
- **左栏高亮**：`WorkspaceSidebar.tsx:290` `isSelected = selectedChannelId === channel.id`——只高亮频道行；agent 行点击（`:333`）→ `onOpenAgent` → `handleOpenPanel({kind:"agent"})`
- **非长驻右栏**：`resolvablePanel` 为 null 时 `<aside className="ws-right">` 不渲染（中央吃满）；面板宽度 `globals.css:918` `width: 380px`；X 关闭 → `closePanel` → 整栏消失
- **切频道清空**：`handleSelectChannel` → `onChannelSwitched(prev)` → null
- **轮询并存**：中央 `ChannelView` 自有 `INBOX_POLL_MS` effect，与面板独立——看详情期间 agent 回复照常刷出（`ChannelView.test.mjs` 断言轮询存在）
