## Summary

`lib/rpc` 从五件套收敛为 session + registry + caller + events 四件套，session 只剩 `promptRunning` 一份自持忙态，其余一律读 SDK；tool-presets 的生产调用点改为按会话实际工具清单过滤。

```diff
 lib/rpc/
-├── subscriber.ts    # 订阅集合
-├── broadcaster.ts   # 快照去重广播
+├── events.ts        # 订阅集合 + 快照去重广播 + getRunningIds（RpcSubscriber/RpcBroadcaster 兼容类名保留）
 ├── session.ts       # 自持状态只剩 promptRunning；isStreaming/isCompacting/get_state 全部委托 inner SDK
 ├── index.ts         # 11 个公共导出不变（9 个值 + 2 个类型）+ 4 个模块类
 └── *.test.mjs       # subscriber/broadcaster 测试合并为 events.test.mjs

 hooks/useAgentSession.ts
   handleToolPresetChange
+    get_tools            # 会话登记表是事实来源
+    getToolNamesForPreset(preset, availableTools)
     set_tools
```

- `lib/rpc/index.ts` 仍导出原 11 个公共名；`RpcSubscriber` / `RpcBroadcaster` 作为兼容类名在 `events.ts` 内定义并 re-export，`index.test.mjs` 的 11 导出守卫与 4 类守卫继续绿。
- `events.test.mjs` 覆盖订阅/退订、重复订阅幂等、广播快照去重、`getRunningIds`、取消后不再收到。
- session 侧没有新增自有状态：`isStreaming` / `isCompacting` 只从 `inner` 读取，`get_state`、`isRunning`、bash 忙态门禁行为不变（用行为测试钉住）。
- caller 二段式（`createAgentSessionServices → resolveVisibleModels → createAgentSessionFromServices`）、`toolsOption` 语义（`[]`=全禁 / `undefined`=不过滤）、registry per-member 记账均未改动。
- tool-presets：`handleToolPresetChange` 先 `get_tools` 再过滤；探测失败回退到未过滤预设。`ensureNewSession` 保持原样——此刻会话尚未创建，没有登记表可查。
- 更新 `AGENTS.md`、`README.md`、`README.zh-CN.md` 中指向已删除模块的目录说明。

## Evidence

**Base `3b86a28`（隔离 worktree）**

- `env -u DEEPSEEK_API_KEY npm test` → 1551 tests / 1551 pass / 0 fail
- `npm run typecheck` → exit 0
- `npm run lint` → 0 errors（`hooks/useI18n.tsx:61` 既有 warning）
- 注：本机 ambient `DEEPSEEK_API_KEY` 会让 `lib/model-listing.test.mjs` 的 lite path 用例看到真实模型（期望 `[]`）。该失败在 base 同样复现，与本次改动无关；上面的数字是清掉该环境变量后的结果。

**After（本 PR）**

- `env -u DEEPSEEK_API_KEY npm test` → 1558 tests / 1558 pass / 0 fail
- `npm run typecheck` → exit 0
- `npm run lint` → 0 errors / 1 warning（`hooks/useI18n.tsx:61`，既有）
- `lib/rpc/events.test.mjs lib/rpc/session.test.mjs lib/rpc/index.test.mjs lib/tool-presets.test.mjs hooks/useAgentSession.test.mjs` → 42 tests / 42 pass
- 新行为测试：SDK 状态变化后 `get_state` 立即跟随；`promptRunning` 在途时 `isRunning` 为真、结算后跟随 SDK；SDK streaming/compaction 期间 `bash` 命令被拒。
- 删除证据：`ls lib/rpc` 不再有 `subscriber.ts` / `broadcaster.ts`；`grep -n "isStreaming\|isCompacting" lib/rpc/session.ts` 只剩 `this.inner.isStreaming` / `this.inner.isCompacting` 的读取点。

## Merge Danger

**Door:** two-way

内部模块重组，无 schema、路由、持久化格式或依赖变更；回滚即恢复两个文件。可观察差异仅限预设切换时下发的工具名集合：请求集合现在先与会话实际登记的工具求交（SDK 原本会忽略未知名字，有效激活集不变）；`get_tools` 探测失败时回退到原行为。

**Blast Radius:** localized

`lib/rpc` 内部（session/events/index）、`hooks/useAgentSession.ts` 的预设切换分支、相关测试与三处目录文档。会话启停、流式事件、模型覆盖、`get_state`/busy 语义均未改变。

## Closes

无 GitHub issue；票据 `.scratch/pi-sdk-rebuild/issues/12-rpc-four-piece-thinning.md`（Orca task `task_199e57ddadfc`）。
