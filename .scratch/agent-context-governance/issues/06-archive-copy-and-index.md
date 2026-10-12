# 归档副本落盘与索引

Type: task
Status: resolved

## Question

在 Session Reset 与 Full Reset 路径上，把该 agent 的原始会话记录（session 原文，含 compact summary）
以归档副本落入数据目录并建立可检索索引，且迁移与重跑幂等——让重置不再等于丢失原始记录。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 B1（归档落点与备份口径）、B2/B3（归档原文与 compact summary
  可经索引命中）、B6（重置保留原始记录，目标语义）；对应裁决 D1（A+C 分层：session 原件归档副本落
  数据目录、SQLite 侧只建索引、否决新增归档表）与 D4（summary 随归档原文索引覆盖、不单独建面）。
- 改动面：重置流程先落归档副作用、再收口删除范围（spec.md「迁移与兼容约束」）——现状重置删 session
  文件（[`agent-lifecycle.ts:33-61`](../../../lib/agent-lifecycle.ts#L33-L61)、
  [`agent-lifecycle.ts:73-94`](../../../lib/agent-lifecycle.ts#L73-L94)）；归档副本必须落在数据目录内
  （[`dirs.ts:12-40`](../../../lib/data/dirs.ts#L12-L40)），索引走既有 SQLite 面
  （[`schema.ts`](../../../lib/data/schema.ts)），新表/新列遵守 `SCHEMA_VERSION` 迁移链（单调递增、
  启动迁移幂等；当前版本与列形状以该文件为准，不复制数字）。
- 不变量：不删除、不重写既有原始记录；不改变协作消息格式与不可变触发器
  （[`schema.ts:148-169`](../../../lib/data/schema.ts#L148-L169)）；Pi 活动 session 维持不在备份清单；
  不注册新工具、不改权限模型（B9）；「消费面扩面」由票 07 收口，「删除/重置清理的归属收口」由票 09
  承担——本票只先落归档副作用。

## Acceptance

- B1：合成重置流程（Session Reset／Full Reset）后，归档副本存在于数据目录内、可解析出与重置前一致的
  会话条目；归档产物落在数据目录内 ⇒ 被「数据目录整体可复制」的备份口径覆盖（不改 docs）。
- B2/B3：同一关键事实在归档＋索引前不可经检索面命中；归档＋索引后可在索引层/服务层命中归档会话
  原文并可定位到具体归档会话；发生 compact 的归档会话中 summary 文本随归档原文进入同一索引，
  不建只索引 summary 的独立面。证据形式：合成 JSONL＋临时数据目录的服务层/存储层测试。
- B6：重置后可解析出重置前的全部会话条目，且活动上下文不再包含它们（目标语义）。
- 迁移与幂等：新表/新列随既有迁移链落地，重复执行幂等；扩展既有测试缝
  [`agent-lifecycle.test.mjs`](../../../lib/agent-lifecycle.test.mjs)（归档落点/清理缝），既有断言不因本票失效。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。

## Answer

已按票面实施归档副本落盘与索引（B1/B2/B3/B6、迁移与幂等），base 提交 `861d375`：

- **归档副作用**（B1/B6）：重置共用路径 `clearSessionFilesForAgent`（[`agent-lifecycle.ts`](../../../lib/agent-lifecycle.ts)）
  在既有删除逻辑之前调用新模块 [`lib/session-archive.ts`](../../../lib/session-archive.ts) 的
  `archiveAgentSessionFiles`——绑定 session 文件 + 家目录（构造上私有）cwd 下的 session 文件以**逐字节副本**
  落入 `<dataDir>/session-archives/<agent id>/<内容 sha256>.jsonl`（[`dirs.ts`](../../../lib/data/dirs.ts)
  新增 `SESSION_ARCHIVES_DIR_NAME`/`sessionArchivesDir`，随数据目录创建）；共享项目 cwd 只归档绑定文件，
  归属不明/他人/人类 session 不归档（清理收口归票 09）。归档只复制不删除，失败即抛出、不进入删除阶段；
  无文件/空文件静默跳过、不造空档。
- **索引**（B2/B3）：`SCHEMA_VERSION 14 → 15`，新增索引表 `session_archive_index`（定位列
  archive/agent/源文件/条目行号 + 提取文本）+ `session_archive_index_fts`（trigram，镜像
  `messages_fts` 口径）+ insert/delete 两枚同步触发器；compact summary 作为 compaction/branch_summary
  条目进同一张表，不建独立 summary 面。`Store` 新增 `replaceSessionArchiveEntries`（同事务先按
  archive_id 清旧行再插当前投影：重复重置幂等、提取规则升级可收敛、索引丢失可自愈）与
  `searchSessionArchives`（FTS + 短 token LIKE 兜底）；服务层入口 `searchArchivedSessionEntries`。
  **消费面（search op / UI）未接线**（票 07），删除 agent 清理未动（票 09），`lib/agent-loop/` 未动。
- **实现级决策**（票面授权自行裁定）：①归档目录 `session-archives/<agent id>/<sha256>.jsonl`
  ——agent id 稳定不随改名漂移、内容寻址天然幂等；②索引表列形状如上（D1：SQLite 侧只建索引，
  归档本体是文件副本）；③`entry_type` 不设 CHECK——pi 条目类型会演进，CHECK 会让未知类型中止重置归档；
  ④文本投影 = message 正文/思考/工具调用参数 + bashExecution command/output + compaction/branch_summary
  summary + custom_message content（工具结果 `details` 是工具私有结构，不投影）。
- **测试**：新增 [`lib/session-archive.test.mjs`](../../../lib/session-archive.test.mjs) 9 例；扩展
  [`lib/agent-lifecycle.test.mjs`](../../../lib/agent-lifecycle.test.mjs) 5 例（fake runtime 增
  `listSessionFilesForCwd`，既有断言原样通过）；扩展 [`lib/data/data-layer.test.mjs`](../../../lib/data/data-layer.test.mjs)
  1 例（v14 老库升级补齐 + 重索引收敛 + 定位列检索）及 EXPECTED_TABLES/COLUMNS、数据目录布局断言。
- **质量门禁**：`npm run typecheck` ✓；`npm run lint` 0 error（仅 `hooks/useI18n.tsx:61` 一条存量
  warning，非本票文件）；`npm test` 基线 **1420/1420**（同 base commit `861d375` 复核）→ 本票后
  **1435/1435**（新增 15 例）。
- **code-review 双轴**（对最终 diff 跑）：**Standards 轴**无硬性违反；7 条 judgement call 中
  `archiveAgentSessionFiles` 改收 `agentId`、测试归档落点改经 `db.paths`（布局断言移入 data-layer），
  其余（LIKE 兜底三行与 `searchMessages` 同形不抽公共件、不添加 update 触发器、`clearSessionFilesForAgent`
  命名、`entry_type` 无 CHECK、两层函数命名词序）为有意保留并注明理由。**Spec 轴**无缺失、无越界
  （07/09 面均未接线）；2 条实现性 finding 已修复：①投影补 bashExecution `command/output`；
  ②「已索引即短路」会使旧归档不可重建 → 改为清理式重索引；1 条设计取舍记录（内容寻址去重下同内容
  双源只留一份副本、`source_path` 记最新来源，符合票面「以内容/来源标识去重」）。
- **PR**：#<PR_NUMBER>（body 路径：`/Users/apple/orca/workspaces/worksplice/context-governance-06-pr-body.md`），
  head 与最终提交一致。

## Comments

- 实施过程无决策类提问（实现级决策按票面授权自行裁定，未改变 D1/D4）；按 preamble 节奏发送 heartbeat、
  各检查点 `check` 无 coordinator follow-up。
- 红→绿证据：先写 `lib/session-archive.test.mjs`（模块不存在，`ERR_MODULE_NOT_FOUND`，0 pass/1 fail），
  再补生命周期缝红 4 例（14 pass/4 fail），随后实现转绿；最终 touched 59 例、全量 1435 例全绿。
- 共享 cwd 中「归属不明/人类 session」在 reset 时仍按现状删除（不归档）；票面已把清理收口归票 09，
  本票只落归档副作用。
