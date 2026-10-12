# 明确重置与删除对原始会话记忆的保留语义

Type: grilling
Blocked by: 01
Status: resolved

## Question

在“记忆完整”要求原始消息/session 记录可追溯检索的前提下，Session reset、Full reset 和显式删除分别应如何影响原始记录？请明确“清空当前活动上下文”是否应与“永久删除历史”分离，以及哪些操作需要明确的永久删除意图。现状审计发现 Pi compact 会保留原始 entries，但 reset/delete 路径会删除 session 文件；因此不能仅靠 compact 保证记忆完整。

## Answer

已确认以下目标语义：

- Session Reset 与 Full Reset 都清空活动上下文，但原始 session 记录归档并保持可检索；只有单独、明确的永久删除才清除原始记录。
- Full Reset 保留稳定的 `MEMORY.md` 内容，只清理过期/已完成的 `Current work`。
- 共享 workspace 重置时，只删除能确认属于该 agent 的 session；归属不明或人类 session 必须保留，不按 cwd 扫除。
- 删除 agent 属于显式永久删除：清除其私有 `MEMORY.md` 与归档 session；保留频道消息、任务等协作历史，不删除共享 workspace 或其他人的 session。

这是后续建议应遵循的语义，不代表当前代码已实现。当前 Session Reset / Full Reset 会删除 session 文件；Full Reset 保留整个 `MEMORY.md`；共享 cwd 的清理可能删除未登记 session；删除 agent 的清理范围也依 workspace 绑定情况而异。证据详见[上下文机制审计报告](https://github.com/whutlichao/worksplice/blob/research/agent-context-audit/.scratch/agent-context-governance/research/context-audit.md)。
