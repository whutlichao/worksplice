# 01 — 面板状态纯模块

**What to build:** 右栏面板内容状态（agent | human | thread | null）的全部转移规则落成纯函数模块：打开内容（单槽替换）、关闭置空、切换频道清空。UI 层只调用该模块，规则单测覆盖。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `open(state, { kind, id })`：任意内容互斥替换（agent→thread→human 两两替换均可）；null 上 open 正常
- [x] `close(state)` → null；`onChannelSwitched(state)` → null
- [x] id 随 kind 透传，kind 集合限定 agent | human | thread
- [x] 纯模块测试（node --test）通过：全部转移 + 单槽互斥 + 清空规则

## Answer

随 commit `d580305`（#13）落地，`lib/panel-state.ts`：

- `open(state, next)` — 单槽替换：任意 kind 内容互斥，id 透传；null 上 open 正常
- `close(state)` → null（幂等）；`onChannelSwitched(state)` → null（切换频道清空）
- `memberPanel(memberId, isHuman)` — agent/人类统一入口映射 `{kind, id}`
- `subscribePinnedChanged`/`notifyPinnedChanged` — 面板↔中央 pinned 双端收敛广播（04 复用）
- `lib/panel-state.test.mjs` 8 例全绿（null 打开 / 两两替换 / id 透传 / 幂等关闭 / 清空 / 广播订阅取消）
