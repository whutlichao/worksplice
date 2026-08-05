# 01 — 面板状态纯模块

**What to build:** 右栏面板内容状态（agent | human | thread | null）的全部转移规则落成纯函数模块：打开内容（单槽替换）、关闭置空、切换频道清空。UI 层只调用该模块，规则单测覆盖。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `open(state, { kind, id })`：任意内容互斥替换（agent→thread→human 两两替换均可）；null 上 open 正常
- [ ] `close(state)` → null；`onChannelSwitched(state)` → null
- [ ] id 随 kind 透传，kind 集合限定 agent | human | thread
- [ ] 纯模块测试（node --test）通过：全部转移 + 单槽互斥 + 清空规则
