# 01: DM 重建接续（同名 agent 重建后就地接续同一条私信）

**What to build:** 删除同名 agent 后重建（createAgent 得到新 member id）时，确定性 id 的 `dm:owner↔<名字>` 必须自动回到可用态——`archived=0`、成员恰为 {owner, 新 agent}、新身份对该 DM 的消费游标推到修复时刻的 `max(seq)`；历史消息一条不动、不重放。既有坏数据（存活 agent 存在、同名 DM 仍归档或缺该成员）由开库期幂等步骤同义修复，用户不需要再删一次重建一次。

**Blocked by:** 无（DM 地基 01 与懒创建 01 均已 resolved）

**Status:** in-progress

- [ ] 服务层接续入口 `resumeDirectChannel(agentId)`：解档 + 成员补回 owner/agent + 新身份游标 = 修复时刻 `max(seq)`，三条写入同事务、幂等（已在预期态时不写一行）
- [ ] `createAgent` 重建路径同步接续（与原生命周期同事务语义）
- [ ] 开库期幂等修复步骤（`runMigrations` 事务内、紧邻 `cleanupEmptyDms`，不 bump `SCHEMA_VERSION`、可重跑）
- [ ] 反例守卫：删除后不重建的 DM 保持 `archived=1`（不无差别解档）；join / leave / archive / mute 对 DM 仍一律拒绝
- [ ] 服务层测试覆盖上述全部行为（红→绿）

## 语义裁定（用户裁定，逐条必须成立）

1. 删除同名 agent 后重建 → 该 DM 自动可用：`archived=0`、成员恰为 {owner, 新 agent}、新 agent 对其消费游标 = 修复时刻 `max(seq)`；历史消息一条不动、仍可读。
2. 治理既有坏行（存活 agent + 同名 DM 归档或缺成员）——开库期幂等步骤，无需再删再建。
3. 不重放历史：新身份不被旧对话唤醒（游标推到当前 `max`）；人类发新消息后 DM 是确定信号（§R4），新 agent 必须被唤醒并回应。
4. 既有限制一个不动：删除身份仍归档其 DM；没有存活同名 agent 的旧 DM 保持 `archived=1`；join / leave / archive / mute 对 DM 一律拒绝；命名仍由名字决定（不引入新 id 方案、不改 schema 表形状）。
5. 修复与原生命周期同事务语义：不产生「解档了但成员没加回」「成员加了但游标没推」这类半修复状态。

## 实施方式（强制）

1. 先读 skill 文件：`/Users/apple/.pi/agent/skills/implement/SKILL.md`，按其流程驱动
2. 内部按 `/tdd`（`/Users/apple/.pi/agent/skills/tdd/SKILL.md`）一次一个红-绿切片推进：先写失败测试，再写实现，再重构
3. 收尾按 `/code-review`（`/Users/apple/.pi/agent/skills/code-review/SKILL.md`）双轴自审（Standards + Spec）后报完工

## 验收标准（行为级）

1. 红→绿：先写测试跑出红（给命令与红输出），再实现转绿（给绿输出）。测试至少覆盖：
   - a) 删除 → 同名重建 → DM `archived=0`、成员 = owner + 新 agent、消费游标 = 当时 max seq、旧消息仍在；
   - b) 重建后人类 sendMessage 不抛错，且新 agent 收到 wake（`subscribeWake` 断言 target = DM id + agentId = 新 id）；旧历史不产生 pending（该 agent 对 DM 的 drain 为空）；
   - c) 坏行（构造：DM 归档 + 成员被移除 + 无游标）→ 开库修复步骤恢复；可重跑（第二次开库不改动任何东西）；
   - d) 反例守卫：删除后不重建，其 DM 仍 `archived=1`；DM 禁改守卫仍拒（join/leave/archive/mute 至少两条）。
2. `npm test` 全量 0 fail。
3. `node_modules/.bin/tsc --noEmit` → 0 error；`npm run lint` → 本票改动文件 0 新增问题。
4. 双轴 code-review（Standards + Spec 两份报告不合并、不重排）：findings 逐条处理或写明豁免理由。Standards 轴额外必查：DM 生命周期判据在服务层与开库步骤两处是否一致。
5. `git status --porcelain` 为空；`git diff --numstat` 只覆盖真正改动的少量行。
6. 推分支 + `gh pr create`，PR 号回填 Answer 与本票据。

## 测试 seam

`lib/domain/collab/dm-rebuild-resume.test.mjs`（服务层，内存 tmp DB）：两个触发点（`createAgent` 重建 / 开库修复步骤）共用同一份「接续后预期态」断言；反例守卫同文件。

## 不在本票范围

- `.scratch/dm/**` 既有票据（历史正本不动）
- `lib/agent-loop/**`、`lib/rpc/**`、UI 组件（composer 的归档禁用已有测试覆盖）
- schema 表形状 / `SCHEMA_VERSION`（修复步骤无形状变更）
