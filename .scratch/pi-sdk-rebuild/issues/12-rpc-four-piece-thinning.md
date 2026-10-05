# 12 — lib/rpc 四件套收窄 + tool-presets 去硬编码

**What to build:** `lib/rpc` 从 session/registry/caller/subscriber/broadcaster 五件套收敛为 session+registry+caller+events 四件套：session 瘦身为仅 `promptRunning` + 薄订阅（不复刻 SDK 的 `isStreaming/isCompacting`），subscriber 与 broadcaster 合并为 events 窄面，caller 保留 `createAgentSessionServices → resolveVisibleModels → createAgentSessionFromServices` 二段式并透传 per-agent 模型/provider/thinkingLevel 三列，registry 保持 per-member 记账（不按 cwd 猜归属）；`tool-presets` 三档改由 `getAllTools()` 动态推导去硬编码，`allowedToolNames` 经 caller `toolsOption` 注入（`[]`=全禁、`undefined`=不过滤）。行为不变——agent 会话启停、流式事件、模型覆盖照旧。

**Blocked by:** 11 — cwd 互斥唯一事实来源

**Status:** ready-for-agent

- [ ] 五件套→四件套：subscriber/broadcaster 合并为 events 窄面，`lib/rpc/index.ts` 11 导出保持（SDK `SessionManager.listAll` 不替代 registry）
- [ ] session 瘦身：仅 `promptRunning` + 薄订阅转发，SDK `toolsOption` 语义（`[]`=全禁 / `undefined`=不过滤）直通，薄 Wrapper 约束不回归
- [ ] caller 二段式保留：per-agent `model_provider/model_id/thinking_level` 经 `startSession` 透传（不二次 `setModel`），thinkingLevelPins 随 scopedModels 走
- [ ] tool-presets 去硬编码：`getToolNamesForPreset()` 用 `getAllTools()` 子集过滤，三档行为不变
- [ ] 全量门禁 `tsc --noEmit + npm run lint + npm test`（347 用例）全绿；rpc 单测与路由源码断言回归
- [ ] 手动②：固化门禁 `chooseSessionFileForStart` 无回归——复用旧文件、无主文件永不解析