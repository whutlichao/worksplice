# 删除与重置路径的 session 清理归属收口（上下文治理票 09）

## Summary

上下文治理票 09：按票 03 目标语义（spec B7 / D1 / D3）收口「删除 agent」与「重置 agent」路径的 session 清理归属判定，**归档集合与清理集合共用同一集合**，归属不明一律保留。

### 归属判定规则（本案核心设计点；唯一判定点 `listOwnedSessionFiles`）

```text
可确认归属 A 的 session 文件（可删、可归档）
  ├─ 凭证① 成员固化登记 pi_session_file（ADR-0003 所有权凭证）
  │     └─ 被其他成员（含 soft-deleted）登记 = 登记冲突 → 归属不确定 → 保留（只清 A 自己的登记）
  └─ 凭证② 家目录 cwd 清单（ADR-0001：家目录由构造唯一私有；仅当 workspace 即家目录时枚举）
        └─ 排除被其他成员登记的路径（登记冲突 → 保留）   [纯函数 chooseOwnedSessionFilesInHome]

共享项目目录：只认凭证①；清单里无登记的文件（人类会话、已删 agent 遗留、他人历史文件）
             不可确认 → 不删、不归档
边界：不确定 ⇒ 保留（宁可留，不可误删）
```

「可确认」= 上述两条凭证之一且无登记冲突；「不确定」= 无登记、或登记冲突 ⇒ 保留（不删、不归档）。

### 调用树

```text
sessionResetAgent / fullResetAgent
  clearSessionFilesForAgent
    listOwnedSessionFiles(agent, cwd, runtime)   ← 归属判定（凭证①+②）
      archiveAgentSessionFiles(agent.id, owned)  ← 票 06 归档副作用（只复制，先于删除）
      runtime.removeSessionFiles(owned)          ← 只删可确认归属集合
      setAgentSessionFile(id, null)              ← 清绑定登记

deleteAgentIdentity（显式永久删除）
  destroySession
  listOwnedSessionFiles → runtime.removeSessionFiles(owned) → 清绑定登记
  deleteAgentSessionArchives(id)                 ← 票 06 落点：先删索引行、再删 session-archives/<id>/
  rm MEMORY.md                                   ← 私有持久记忆（绑定项目目录时家目录仍在，故显式清）
  [workspace 即家目录时] 整删家目录               ← ADR-0001 既有语义，不扩大删除范围
  deleteAgent(id)                                ← soft-delete：协作历史（频道消息/任务）保留
```

### 文件职责

```text
lib/agent-lifecycle.ts        归属判定收口（listOwnedSessionFiles）+ 删除路径的私有清理
lib/agent-runtime.ts          纯函数 chooseOwnedSessionFilesInHome；removeSessionFilesForCwd(cwd)
                              → removeSessionFiles(paths)（runtime 不再按 cwd 自行扫除）
lib/session-archive.ts        【纯新增】deleteAgentSessionArchives(agentId)（协调者裁决 (a)）
lib/data/store.ts|sqlite.ts   【新增】deleteSessionArchiveEntriesForAgent(agentId)（数据层删索引行，业务不写 SQL）
lib/*agent*/…test.mjs         红→绿测试扩展（含共享 cwd 保留、登记冲突保留、删除清归档/记忆、重置不改归档）
```

## Evidence

**Before（红）**：把本票测试放在基线副本（`2569817` 的 detached worktree，fake runtime 补旧接口 shim 以让基线源码跑起来）上执行 —— 23 tests / 17 pass / **6 fail**：

```text
✖ 共享项目目录 reset 只归档并清理可确认归属的绑定文件（归属不明的 session 保留）
    Error: ENOENT … human-or-orphan.jsonl   ← 旧语义按「未被引用即删」把归属不明 session 删了
✖ 其他成员登记的 session 文件（登记冲突）在 reset 时保留、不归档
✖ 绑定文件被其他成员登记时（登记冲突）保留文件、只清本 agent 的登记
✖ deleteAgentIdentity 清私有归档副本与索引、清私有持久记忆、保协作历史（B7）
    AssertionError: 私有归档副本目录被清除  true !== false   ← 旧语义删除身份不清私有归档
✖ deleteAgentIdentity：绑定共享项目目录时只清自己的会话与 MEMORY.md，不动他人 session
✖ 重置路径不删归档副本（再次 Session Reset / Full Reset 后仍可检索），删除才清除
```

**After（绿）**：`node --test lib/agent-lifecycle.test.mjs lib/agent-runtime.test.mjs` → 68 pass / 0 fail。
新增/改写的断言要点：

- B7：`session-archives/<agent id>/` 目录被清 + `searchArchivedSessionEntries(fact)` 命中 0（票 06「索引可查」层断言），`MEMORY.md` 被清，频道消息仍在，旁观者 agent 的私有归档不受影响（不扩大删除范围）。
- 共享 cwd：绑定文件清理、归属不明 session 逐字节保留、restart 仍得全新会话（共享目录不回填无主文件）。
- 家目录：cwd 清单全部清理 ⇒ restart 不复活旧上下文。
- 登记冲突：他人登记的路径保留且不进归档；本 agent 的登记仍清空。
- 重置不改归档：再次 Session Reset / Full Reset 后副本目录与命中数不变（票 06 不变量），只有显式删除才清除。

**门禁（全量，base `2569817`）**：`npm run typecheck` ✅、`npm run lint` ✅（0 error；`hooks/useI18n.tsx` 1 处既存 warning 与本票无关）、`npm test` ✅ **1441 pass / 0 fail**（基线 1435，本票 +6）。

## Merge Danger

**Door:** two-way（行为可逆：删除面收窄 + 删除路径新增清理，无 schema 迁移、无不可逆格式变更）

**Blast Radius:** 中等

- **删除面收窄**：共享 cwd 内无登记的 session 文件在重置后保留（磁盘占用略增）。这是票面要求的取舍（不确定 ⇒ 保留），不是回归。
- **删除路径新增清理（不可逆）**：`deleteAgentIdentity` 现在会删除 `session-archives/<agent id>/` 与其索引行、以及家目录 `MEMORY.md`。只有显式永久删除路径调用；`Session Reset` / `Full Reset` 不调用（票 06 不变量，已加断言）。
- **接口缩窄**：`AgentRuntime.removeSessionFilesForCwd(cwd)` → `removeSessionFiles(paths)`。全仓调用点只剩 `lib/agent-lifecycle.ts`，三个 fake 已同步；runtime 自身不再按 cwd 判定，归属判定唯一化在 lifecycle 侧。
- **归档/数据层新增**：`deleteSessionArchiveEntriesForAgent`（Store 接口 + SQLite 实现）与 `deleteAgentSessionArchives`（session-archive 纯新增）经协调者裁决 (a) 授权；既有导出（archiveAgentSessionFiles / searchArchivedSessionEntries）行为与签名未变。
- **文档漂移（未改）**：`AGENTS.md:476/479` 与 `docs/adr/0001` 仍描述旧的 `removeSessionFilesForCwd` 语义；本票不改 docs，留后续 docs 票。
- **并行合并**：与票 07（检索面 `lib/domain/collab/search*`、`lib/agent-loop/member-ops*`、`app/api/search/*`、`components/SearchView*`）无文件重叠；与票 06 的唯一交点是 `lib/session-archive.ts` 的纯新增。
- **已知边界（本票不改，见票 09 Answer）**：① 绑定共享项目目录的 agent，其家目录内未登记的遗留 session 文件不在清理面（家目录本体按 ADR-0001 保留）；② Full Reset 的「清空家目录内容」语义覆盖家目录内其他文件（含他人登记冲突文件），属既有语义。
