# 删除 agent 的私有归档清理收口

Type: task
Status: resolved
Blocked by: 06

## Question

按票 03 目标语义收口重置与删除路径的 session 清理归属判定：删除 agent 清其私有归档副本与私有持久
记忆、保留协作历史；共享 workspace 只清理可确认归属该 agent 的 session，归属不明或人类 session 保留。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 B7（删除 agent 的私有归档清理，票 03 语义、目标语义）；
  对应裁决 D1 的「删除 agent 清私有归档副本、协作历史保留」与 D3 的隔离姿态。
- 改动面：删除身份路径 [`agent-lifecycle.ts:114-127`](../../../lib/agent-lifecycle.ts#L114-L127)；
  重置路径 [`agent-lifecycle.ts:53-61`](../../../lib/agent-lifecycle.ts#L53-L61)、
  [`agent-lifecycle.ts:73-94`](../../../lib/agent-lifecycle.ts#L73-L94)；共享 cwd 的清理判定现状按
  「未被任何成员引用」删除（[`agent-runtime.ts:324-335`](../../../lib/agent-runtime.ts#L324-L335)），
  归属不明/人类 session 尚未收口（票 01 审计与票 03 目标语义的差异点）；私有归档副本落点由票 06 建立。
- 不变量：不删协作历史（消息不可 UPDATE/DELETE，见
  [`schema.ts:148-169`](../../../lib/data/schema.ts#L148-L169) 的不可变触发器）；不删共享目录他人、
  归属不明或人类 session；不扩大删除范围；不改备份口径实现（统一为「数据目录整体可复制」，
  spec.md D1）；不改 docs。

## Acceptance

- B7：显式永久删除 agent 后，其私有归档副本与私有持久记忆被清除、对任何检索面不可见；协作消息仍在；
  共享 cwd 中他人/归属不明 session 未被删除。
- 重置路径同规则：归属不明或人类 session 不被重置清理误删；B6 的「重置只清活动上下文、原始记录
  保留可获取」不受损。
- 证据形式：扩展 [`agent-lifecycle.test.mjs`](../../../lib/agent-lifecycle.test.mjs) 的 fake
  runtime／数据目录缝断言（含共享 cwd 他人/归属不明 session 保留；现行「删该 cwd 全部 session」的
  断言按目标语义更新）。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。

## Answer

已按目标语义收口（PR [#178](https://github.com/whutlichao/worksplice/pull/178)；
PR body：[`09-pr-body.md`](./09-pr-body.md)）。

### 归属判定规则（本案核心设计点）

唯一判定点 = [`agent-lifecycle.ts`](../../../lib/agent-lifecycle.ts) 的 `listOwnedSessionFiles`
（纯函数 [`agent-runtime.ts`](../../../lib/agent-runtime.ts) 的 `chooseOwnedSessionFilesInHome`
收口「家目录清单」侧）。**归档与清理共用同一集合**，因此传给票 06 归档的文件集合只含可确认归属该
agent 的 session。

```text
可确认归属 A 的 session 文件（可删、可归档）
  ├─ 凭证① 成员固化登记 pi_session_file（ADR-0003 所有权凭证）
  │     └─ 被其他成员（含 soft-deleted）登记 = 登记冲突 → 不确定 → 保留（只清 A 自己的登记）
  └─ 凭证② 家目录 cwd 清单（ADR-0001：家目录由构造唯一私有；仅当 workspace 即家目录时枚举）
        └─ 排除被其他成员登记的路径（登记冲突 → 保留）

共享项目目录：只认凭证①；清单里无登记的文件（人类会话、已删 agent 遗留、他人历史文件）
             不可确认 → 不删、不归档
边界：不确定 ⇒ 保留（宁可留，不可误删）
```

- 「可确认」= 上述两条凭证之一且无登记冲突；「不确定」= 无登记或登记冲突 ⇒ 保留。
- 不采用文件命名/内容线索作正向凭证：session 文件名（会话 id）与正文都不含 agent 身份，猜不出归属；
  内容里的 `cwd` 字段只能证明「文件属于该目录」，不能证明「属于该 agent」，故只作清单来源、不作凭证。
- 副作用上的语义保证：共享 cwd 里保留的归属不明文件不会被回填（票 03「共享目录不解析无主文件」），
  因此保留不等于「复活旧上下文」；restart 仍得全新会话（测试已断言）。

### 与票 06 的交点（归档副作用的文件集合）

票 06 的 `archiveAgentSessionFiles(agentId, paths)` 未改签名，但**调用点传入的集合已收口**：由原来的
「绑定文件 + 家目录 cwd 清单」改为同一个 `listOwnedSessionFiles` 结果，即再排除所有被其他成员登记的
路径（登记冲突 ⇒ 不确定 ⇒ 不归档也不删）。协调者裁决：归档删除面用 `session-archive.ts` 的**纯新增**
`deleteAgentSessionArchives(agentId)`（先删索引行、再删 `session-archives/<agent id>/`），索引行删除走
数据层新增的 `Store.deleteSessionArchiveEntriesForAgent`（业务模块不写 SQL）；`Session Reset` /
`Full Reset` 不调用它（票 06「归档只增不删」不变量，已加断言）。

### 证据与门禁（base commit `2569817`，`git log --oneline -1` 核对）

- 红（隔离副本：base 的 detached worktree + 本票测试 + 旧接口 shim）：`lib/agent-lifecycle.test.mjs`
  23 tests / 17 pass / **6 fail**——旧语义把共享 cwd 里归属不明的 session 删了（断言读文件时 ENOENT），
  删除身份后私有归档目录仍在（`true !== false`）。
- 绿：`lib/agent-lifecycle.test.mjs` 23/23、`lib/agent-runtime.test.mjs` 45/45。
- 门禁：`npm run typecheck` ✅、`npm run lint` ✅（0 error；`hooks/useI18n.tsx` 1 处既存 warning 与本票
  无关）、`npm test` ✅ **1441 pass / 0 fail**；**测试基数 1435（与本票同一 base `2569817`）→ 新增 6**
  （agent-lifecycle +5、agent-runtime +1）。
- 改动文件：`lib/agent-lifecycle.ts`、`lib/agent-runtime.ts`、`lib/session-archive.ts`（纯新增）、
  `lib/data/store.ts`、`lib/data/sqlite.ts`、`lib/agent-lifecycle.test.mjs`、`lib/agent-runtime.test.mjs`、
  `lib/agent-recovery.test.mjs`、`lib/domain/collab/agent-home-datadir-move.test.mjs`（后两个仅 fake runtime
  接口同步）。

### code-review 双轴（最终 diff）与处置

- **Standards 轴**（子代理执行）：0 硬性违规（分层/命名/术语/测试纪律合规；新查询走 Store 契约、业务不写
  SQL 已核验）；判断项 5 条的处置：
  1. 归属判定的纯函数原本带 `isOwnHome` 参数，生产调用方对共享 cwd 已传空清单、该分支不可达 ⇒
     **已移除该参数**，函数改名 `chooseOwnedSessionFilesInHome`，前置条件写进文档注释（共享 cwd 清单不得传入）。
  2. 归一化口径不对称（比较归一化、入集合用原路径）⇒ **已在注释写明约定**（原路径用于归档/删除，只比较时归一化）。
  3. 注释口径落差（绑定项目目录时家目录遗留 session 不在清理面）⇒ **已改写注释显式写明边界**。
  4. `confirmableOwnedSessionFiles` 形容词开头 ⇒ **改名 `listOwnedSessionFiles`**（动词开头，符合 §1）。
  5. 家目录判定存在同义谓词三份（`isOwnHome` / `isOwnHomeDir`）⇒ 既存重复、合并会扩大改动面，**不处置**，
     记录待后续收敛票。
- **Spec 轴**（子代理被配额限流 429，由实施者本人按同一清单执行）：无越界、无实现可疑点；B6/B7 与票据
  Acceptance 逐条覆盖（删除清归档+索引+MEMORY.md、保协作历史、共享 cwd 他人/归属不明 session 未删；
  重置不改归档、B6 不受损）；`lib/session-archive.ts` 既有导出行为与签名未变。

### 已知边界（本票不改，留后续）

1. 绑定共享项目目录的 agent，其家目录内**未登记的遗留 session 文件**不在清理面（家目录本体按 ADR-0001
   保留，不扩大删除范围）；代码注释已写明。
2. Full Reset 的「清空家目录内容」语义覆盖家目录内其他文件（含他人登记冲突的 session 文件），与
   「登记冲突 ⇒ 保留」有落差：属既有 Full Reset 语义，本票未改。
3. `AGENTS.md:476/479`、`docs/adr/0001` 仍描述旧的 `removeSessionFilesForCwd` 语义（本票不改 docs，待后续
   docs 票）。
