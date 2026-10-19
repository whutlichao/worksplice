# 05: Agent-authored DM mention wake

**What to build:** 修复 agent 在 Owner↔agent 一对一 DM 中回复时 @mention 其他 agent 会触发非成员唤醒的问题；DM 普通回复与 held/revision prompt 明确要求使用纯文本姓名。

**Status:** in progress

- [x] agent-authored DM 中对非成员 agent 的 @mention 不产生 wake；DM 成员正常收消息。
- [x] Owner-authored DM 对非成员的 mention 路由保持；普通频道的非成员 mention wake 保持。
- [x] 初始 DM prompt 与 held/revision prompt 明确禁止 @mention 其他 agent，并要求用纯文本姓名。
- [x] 两份指定文档同步窄例外规则。
- [x] 受影响测试、typecheck、lint 与双轴 code review 已运行；记录全量套件基线失败。

## Answer

### 实现

`notifyMessageWakes` 先按原规则唤醒 DM 成员；若消息作者是 agent 且频道为 DM，则在全局非成员 @mention 路由前返回。Owner-authored DM 和非 DM 频道仍走原 mention 路由。普通回复和 held/revision prompt 都注入同一条 DM 专属规则，要求不要 @mention 其他 agent，需要提及姓名时使用纯文本。`docs/spec.md` 与 `docs/design-notes/orchestrating-coding-agents.md` 记录同一窄例外。

本次问题的因果判断：`notifyMessageWakes` 对 agent-authored DM 正文中的非成员 agent mention 仍执行全局穿透唤醒，同时普通回复 prompt 没有 DM 专属约束。

### 红测与绿测

- 基线命令 `node /tmp/dm-mention-repro.mjs`（任务提供的基线证据）：DM 成员是 Susan 与 Owner；mention wake recipient 是 MattDev；DM prompt 含 MattDev 且没有 mention restriction。
- 在本票隔离 worktree 先加 wake 回归用例，再运行 `node --test --test-name-pattern="agent-authored DM mention does not wake a nonmember agent" lib/agent-loop/wake.test.mjs`：exit 1，1 test failed；实际 wake recipients 为 `['8b46db57-b5c4-449d-b44d-69b2ff34d604']`，预期 `[]`。
- 初始 prompt 红测：`node --test --test-name-pattern="a DM owner human message is answered normally with a reply" lib/agent-loop/dm-respond.test.mjs`；断言缺少 `/do not @mention other agents in this direct message; refer to their names in plain text instead/i`。
- held/revision prompt 红测：`node --test --test-name-pattern="buildRevisionPrompt includes the DM mention rule after a held reply" lib/agent-loop/loop.test.mjs`；同一规则断言未匹配。
- 相同 wake 回归用例实现后通过：1 test passed，0 failed。最终受影响命令 `node --test lib/agent-loop/dm-respond.test.mjs lib/agent-loop/loop.test.mjs lib/agent-loop/wake.test.mjs`：83 tests passed，0 failed。

### 验证命令结果

- `npm test`：1512 tests，1511 passed，1 failed。唯一失败 `lib/model-listing.test.mjs:50`（`lite path returns a working runtime without loading extensions`）：期望 `[]`，实际包含 `deepseek-flash` 与 `deepseek-v4-pro`。Coordinator 在干净基线 `2c5619f048da26d32a0895d229daad7fb91442f3` 上用 `node --test lib/model-listing.test.mjs` 复核为相同失败（3/4 passed）；不属于本票。
- `npm run typecheck`：exit 0（`tsc --noEmit`）。
- `npm run lint`：exit 0，0 errors；仓库既有 `hooks/useI18n.tsx:61` 有 1 条 `locale` 缺失依赖 warning。

### Review 小节（code-review 双轴）

**Standards**：首轮指出两个测试从协作子模块导入；已改为经 `../domain/collab/index.ts` 导入。后续指出新增字符串应使用单引号；已修复新增 prompt literal、DM 类型判断及对应测试字符串。最终 review 未发现文档化规范违规；另报告 `dm-respond.test.mjs` 与 `loop.test.mjs` 中 fake-session 状态 wiring 可能重复（P3 Duplicated Code）。该 wiring 不在本票 diff 中；抽取 helper 会超出本票“不引入新抽象”的约束，因此保留。最终 review 未发现其他列出的 Fowler smells。

**Spec**：无 findings。Owner-authored DM 跨成员 mention 路由、非 DM mention wake、DM 成员唤醒均保留；parser、storage、rendering、membership 与非 DM 策略未改。
