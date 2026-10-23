# 12 — lib/rpc 四件套收窄 + tool-presets 去硬编码

**What to build:** `lib/rpc` 从 session/registry/caller/subscriber/broadcaster 五件套收敛为 session+registry+caller+events 四件套：session 瘦身为仅 `promptRunning` + 薄订阅（不复刻 SDK 的 `isStreaming/isCompacting`），subscriber 与 broadcaster 合并为 events 窄面，caller 保留 `createAgentSessionServices → resolveVisibleModels → createAgentSessionFromServices` 二段式并透传 per-agent 模型/provider/thinkingLevel 三列，registry 保持 per-member 记账（不按 cwd 猜归属）；`tool-presets` 三档改由 `getAllTools()` 动态推导去硬编码，`allowedToolNames` 经 caller `toolsOption` 注入（`[]`=全禁、`undefined`=不过滤）。行为不变——agent 会话启停、流式事件、模型覆盖照旧。

**Blocked by:** 11 — cwd 互斥唯一事实来源

**Status:** resolved（2026-10-23）

- [x] 五件套→四件套：subscriber/broadcaster 合并为 events 窄面，`lib/rpc/index.ts` 11 导出保持（SDK `SessionManager.listAll` 不替代 registry）
- [x] session 瘦身：仅 `promptRunning` + 薄订阅转发，SDK `toolsOption` 语义（`[]`=全禁 / `undefined`=不过滤）直通，薄 Wrapper 约束不回归
- [x] caller 二段式保留：per-agent `model_provider/model_id/thinking_level` 经 `startSession` 透传（不二次 `setModel`），thinkingLevelPins 随 scopedModels 走
- [x] tool-presets 去硬编码：`getToolNamesForPreset()` 用 `getAllTools()` 子集过滤，三档行为不变
- [x] 全量门禁 `tsc --noEmit + npm run lint + npm test` 全绿（base `3b86a28` 实测 1551 用例 → 本 PR 实测 1558 用例）；rpc 单测与路由源码断言回归
- [x] 手动②：固化门禁 `chooseSessionFileForStart` 无回归——复用旧文件、无主文件永不解析（手动项 N/A，理由见 Answer）

## Answer（2026-10-23）

**PR**：[#201](https://github.com/whutlichao/worksplice/pull/201)
（body 路径：`.scratch/pi-sdk-rebuild/pr-body.md`）

### 红证据（base commit `3b86a28`，隔离 worktree）

- `ls lib/rpc/events.ts` → `No such file`；`lib/rpc/subscriber.ts`(61 行) 与 `lib/rpc/broadcaster.ts`(58 行) 尚存，并各自被 `lib/rpc/index.ts` 导出。
- `env -u DEEPSEEK_API_KEY npm test` → **1551 tests / 1551 pass / 0 fail**（本票基线；票据原文的 347 是旧口径，按实测数字替换）。
- 环境注记：本机 ambient `DEEPSEEK_API_KEY` 会让 `lib/model-listing.test.mjs` 的 lite path 用例看到真实模型（期望 `[]`）。该失败在 base `3b86a28` 同样复现，属环境相关、与票据无关；因此门禁用 `env -u DEEPSEEK_API_KEY` 取仓库真值。
- session 侧的 `isStreaming` / `isCompacting` 在 base 已只读 `this.inner`（无自持双状态机）；本票的增量是行为测试钉住该委托形态，并确认没有重新引入副本。

### 绿证据（本 PR，head `d998a75` + 票据提交）

- `env -u DEEPSEEK_API_KEY npm test` → **1558 tests / 1558 pass / 0 fail**。
- `npm run typecheck` → exit 0。
- `npm run lint` → 0 errors / 1 warning（`hooks/useI18n.tsx:61` 既有 warning，未触碰该文件）。
- 目标测试：`lib/rpc/events.test.mjs lib/rpc/session.test.mjs lib/rpc/index.test.mjs lib/tool-presets.test.mjs hooks/useAgentSession.test.mjs` → 42 tests / 42 pass。
  - events：订阅/退订、重复订阅幂等（Set 语义，一次取消即清）、快照去重、无订阅者时快照重置、listener 抛错隔离、`getRunningIds`、取消后不再收到。
  - session：SDK 状态变化后 `get_state` 立即跟随（同 wrapper 二次调用）、`promptRunning` 在途时 `isRunning` 为真且结算后跟随 SDK、SDK streaming/compaction 期间 `bash` 被拒。
  - tool-presets：DEFAULT/FULL 部分可用时按预设顺序求交，空登记表返回空请求。
  - hook：预设切换先 `get_tools`、失败才回退、过滤后下发 `set_tools`。
- 删除证据：`ls lib/rpc` 不再有 `subscriber.ts` / `broadcaster.ts`；`lib/rpc/index.test.mjs` 的 11 导出守卫（9 value + 2 type）与 4 模块类守卫全绿。
- 无自持状态机证据：`grep -n "isStreaming\|isCompacting\|promptRunning" lib/rpc/session.ts` 只剩
  `private promptRunning = false`（275）、`this.promptRunning` 读写（516/523/528/552）、
  `this.inner.isStreaming` / `this.inner.isCompacting` 的读取（321/551/554/818）。
- `toolsOption` 语义未改：`lib/rpc/caller.ts` 仍为 `toolNames.length === 0 ? [] : undefined`；caller 二段式与 `initialModel`/`thinkingLevel` 透传未改；registry 仍以真实 session id 做 per-member 记账。
- `chooseSessionFileForStart` 无回归：`lib/agent-runtime.test.mjs` 覆盖「合法绑定文件复用」「共享目录永不认领无主文件」及其余自愈分支。

### 改动文件

- `lib/rpc/events.ts`（新增）、`lib/rpc/subscriber.ts`（删除）、`lib/rpc/broadcaster.ts`（删除）
- `lib/rpc/events.test.mjs`（新增）、`lib/rpc/subscriber.test.mjs`（删除）、`lib/rpc/broadcaster.test.mjs`（删除）
- `lib/rpc/index.ts`、`lib/rpc/session.ts`、`lib/rpc/session.test.mjs`
- `hooks/useAgentSession.ts`、`hooks/useAgentSession.test.mjs`
- `lib/tool-presets.test.mjs`
- `AGENTS.md`、`README.md`、`README.zh-CN.md`（目录说明同步到 `events.ts` / 预设过滤语义）
- `.scratch/pi-sdk-rebuild/pr-body.md`、本票据

### 双轴 review

- **Standards**：初版发现 ① events.ts / hook 新增英文注释 → 已改中文；② 无回归测试的 hook 改动 → 已补 `hooks/useAgentSession.test.mjs` 源码断言；③ `session.test.mjs` 的私有字段 grep 测试属实现细节 → 已删除，改由三条行为测试 + 本 Answer 的 grep 证据承担；④ 多余导出 `getRpcSubscriber/getRpcBroadcaster` → 已收回模块内部；⑤ `AGENTS.md`/`README*` 仍指向已删文件 → 已更新。剩余判断项：`events.test.mjs` 的 `new RpcSubscriber()` 依赖 globalThis 共享集合，属沿用旧测试结构。
- **Spec**：约束 1–3、5 conformant；约束 4 指出 `availableTools?.length ? … : undefined` 会把「成功但为空」误当探测失败 → 已改为只对抛错回退（`.catch(() => undefined)`），空清单按 `lib/tool-presets.ts` 契约照常下发。`ensureNewSession` 无法传 `availableTools`（会话尚未创建，无登记表），保持原样；`getAllTools()` 仅在既有 `getToolNamesForPreset(preset, availableTools?)` 签名上消费，不再改动静态档位成员。
- 无 schema / 路由 / UI / SDK 版本 / 依赖变更。

### 手动②

N/A（无稳定人工场景）：该门禁是纯函数 `chooseSessionFileForStart`，人工路径只能间接观测，且 `lib/agent-runtime.test.mjs` 已逐分支钉住「复用合法绑定文件」「共享目录永不解析无主文件」「错绑自愈」「他人引用自愈」；再跑一遍手工 UI 无法提供额外证据。
