# Agent 家目录与共享项目目录：工作区两分

创建 agent 不再绑定外部目录，而是自动在 `~/.worksplice/agents/<slug-id>/` 生成专属**家目录**（私有、唯一、删除身份时一并删除）；**项目目录**仍可显式绑定，且**允许多个 agent 绑定同一目录**（解除 `agentWorkspaceByAnother` 的唯一性），但同一目录的运行期并发保持**串行**（保留 `hasBusyRpcSessionForCwd`）。理由：共享目录是协作代码库的入口，多 agent 绑定才能协作；而同一仓库并发写没有锁，串行是安全默认，真并行留给 worktree（不同 cwd 天然并行）。

工作区 = 单槽：`workspace_path ?? 家目录`。创建时工作区即家目录；绑定项目目录 = 现有"换目录即换会话"流程；解除绑定回到家目录。创建流程不再出现目录选择（存量 agent 不迁移，行为不变）。

**删除与重置语义按目录来源区分**（修复原 `deleteAgentIdentity` 无条件 rmSync 整个绑定目录的隐患）：
- 删除身份：只 rm 家目录；工作区是共享项目目录时绝不删。
- Full reset：只清家目录内容；工作区是共享项目目录时拒绝/降级为 Session reset。
- 服务层拒绝把其他 agent 的家目录绑成项目目录。

**MEMORY.md**：家目录创建时预置固定大纲（英文节名 `## Role`/`## Current work`/`## Workflow`/`## Skills`/`## Tools`/`## Other`——内容层英文硬编码，见 `docs/i18n.md` 分层规则），正文可空，归 agent 所有，丢失不补种；**Full reset 保留**（记忆是身份资产，不是产物）；agent-loop prompt 每轮告知路径与用途（有实质进展时更新 `## Current work` 节），不注入正文。协作域不存 agent 私人记忆——共享消息流 + 任务状态 + 游标是重载真相，MEMORY.md 补 session reset 后丢失的推理上下文。

**创建时可选模型/推理强度**：CreateAgentModal 内嵌 ModelPicker，不选即继承全局默认（null），复用 `members.model_provider/model_id/thinking_level` 列，启动时由 startSession 应用。

**Consequences**: spec.md §5.2 "同一 cwd 同时仅一个活跃会话"（[锁定] 01）保留；spec.md 中 workspace 绑定的唯一性描述被本 ADR 取代。共享项目目录下 `resolveLatestSessionFile` 的会话文件沿用与 `removeSessionFilesForCwd` 的跨 agent 误删需在实现时改为按成员 `pi_session_file` 精确作用。
