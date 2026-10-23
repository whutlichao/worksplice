## Summary

中文语言包里 agent 详情 dock 底部的生命周期按钮与提示仍是英文，本次只改文案值与回归断言：

```diff
 lib/i18n/messages/zh-CN.ts
-    "agent.restart": "Restart",
-    "agent.sessionReset": "Session reset",
-    "agent.fullReset": "Full reset",
+    "agent.restart": "重启",
+    "agent.sessionReset": "会话重置",
+    "agent.fullReset": "完整重置",
     "agent.fullResetSharedHint":
-      "当前绑定共享项目目录，Full reset 不可用（请用 Session reset）",
+      "当前绑定共享项目目录，完整重置不可用（请用会话重置）",
     "agent.stoppedHint":
-      "离线 = 已停止响应，身份仍在；可随时 Restart 激活",
+      "离线 = 已停止响应，身份仍在；可随时重启激活",
```

术语与 `GLOSSARY.md` 一致：会话重置（Session Reset）、完整重置（Full Reset）。`en.ts` 与组件未改动，组件已正确走 `t()`。

## Evidence

- **Before:** 新断言在隔离副本（`HEAD` 版 zh-CN 包）上失败：
  `agent.restart 应为中文文案 — 'Restart' !== '重启'`
- **After:** 窄档选择器全绿：

```text
node --test lib/i18n/messages.test.mjs \
  components/AgentDetailPanel.test.mjs components/DetailPanel.test.mjs
ℹ tests 52  pass 52  fail 0
npm run typecheck  → tsc --noEmit exit 0
```

## Merge Danger

**Door:** two-way

纯文案值与测试断言改动，回滚即还原两处字符串，不涉及数据迁移或运行时行为。

**Blast Radius:** minimal

仅中文界面这三条按钮及其直接引用提示的显示文字；未改 `en.ts`、组件、接口、构建或类型。未运行全量 `npm test` 与 `next build`（按本票窄档约定）。
