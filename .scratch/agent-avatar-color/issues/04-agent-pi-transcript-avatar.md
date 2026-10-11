# 04: 仅在精确归属的 Pi transcript assistant 消息显示 agent 头像

**What to build:** 在票 05 提供的 Agent 详情 transcript viewer 中，仅为精确归属该 agent 的 assistant 消息显示 agent 当前身份色的 Avatar；不明确归属的 transcript 和非 assistant 消息继续保持普通呈现。本票只负责 viewer 内的 Avatar 呈现，不实现 transcript 读取、刷新或分页。

**Blocked by:** 03 — 让全部协作界面的 agent 身份头像同步使用当前头像色；05 — Agent 详情 transcript viewer 与精确会话读取/分页。

**Status:** resolved

- [x] 在实际 transcript viewer 产品 markup 中，精确关联 agent 的当前分支 assistant 消息显示该 agent 当前的自动色或持久覆盖色 Avatar；历史消息也使用当前身份色。
- [x] 只有 assistant 消息显示该 agent Avatar；user、tool、custom、compaction 等非 assistant 消息均不显示该 agent Avatar。
- [x] human session 与未关联 agent 的 transcript 不新增 agent Avatar；同 cwd/workspace/project root、同 basename、分叉关系或文件名均不能使 transcript 获得 agent Avatar。
- [x] 归属消费票 05 的公开 member-ID GET 契约：服务端只读取该成员当前 `pi_session_file` 并精确确定 session 归属。测试验证该公开契约，不为测试引入不必要的任意 path 参数。
- [x] 头像色只影响身份 Avatar tile；选色或恢复自动色不写 Pi 文件或消息内容。
- [x] 测试实际 transcript viewer markup 中 assistant/non-assistant、human/未关联 transcript 的 Avatar 差异，并验证 Avatar 使用当前成员色；本票不重复实现或验收 viewer 的取数、刷新、消息类型读取或分页行为。

## Comments

- 产品行为范围来自产品所有者在本次 coordinator interview 中已确认的共识；本票只细化 Avatar 专项，不重开 viewer 决策。

## Answer

### 实现

- Agent 详情面板将当前身份的 `id`、`name` 与 `avatar_tint` 传给 transcript viewer；Avatar 使用共用 `Avatar`，自动色按原 member ID 取色。
- Viewer 仍只经 `/api/members/{memberId}/transcript` 取数；markup 仅在 `message.role === 'assistant'` 且身份 ID 与 member ID 相符时附加 Avatar。非 assistant 与无/不匹配身份保持原呈现。
- 当前选色 state 直接驱动历史与后续 transcript 项的 Avatar；未改 transcript reader、分页/快照、Pi 文件或消息内容。

### TDD 红绿

- 红：新增实际 `AgentTranscriptContent` markup 断言后运行 `node --test components/AgentTranscriptViewer.test.mjs`，原实现下新增的两个 Avatar 断言失败（均未渲染 Avatar）。
- 绿：实现后同命令通过；最终 15/15 通过。覆盖 assistant/non-assistant、member ID mismatch、human/无关联 markup、当前 tint/恢复自动色，以及面板选色后的同一历史项。
- member-ID GET 契约沿用票05公开 seam：`node 'app/api/members/[id]/transcript/route.test.mjs'` 9/9 通过；既有测试传入无效 `path`/`sessionId` query 仍断言只返回登记文件内容且 Pi 文件字节不变。Viewer 面板测试同时断言只请求 member-ID transcript URL。

### 文件

- `components/AgentTranscriptViewer.tsx`：assistant-only Avatar markup 与 member 身份数据传递。
- `components/AgentDetailPanel.tsx`：将当前身份 tint 传给 viewer。
- `components/AgentTranscriptViewer.test.mjs`：实际 markup、身份匹配、当前 tint 更新及 human 无关联用例。
- `.scratch/agent-avatar-color/issues/04-agent-pi-transcript-avatar.md`：状态与本 Answer。

### 验证

- `npm test`：1405/1405 通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：0 errors；仅有 `hooks/useI18n.tsx:61` 一条既存 `react-hooks/exhaustive-deps` warning。改动文件 ESLint 通过，且 `git diff origin/main -- hooks/useI18n.tsx` 为空，因此相较 base 无新增 lint 问题。
- 未运行 formatter。`.pi-lens.json` 内容为 `{"format":{"enabled":false}}`，已加入 git info exclude 且 `git check-ignore -v .pi-lens.json` 确认忽略；`git diff --numstat` 无整文件格式噪声。

### 双轴 Code Review

- 首轮 Standards 指出测试中 assistant fixture 重复；已抽为并复用 `transcriptAssistantItem`。首轮 Spec 指出 human transcript 未显式覆盖；已增加 `memberId: null`、`agent: null` 的真实 markup 用例。
- 复审 Standards：0 hard violation、0 judgement call。复审 Spec：pass，无缺项、越界或实现错误。

### 提交与 PR

- 分支 `agent-transcript-avatar-04`，基于 `origin/main` 提交 `74746c2`；提交：`80b071a`、`b71f392`。
- PR 链接待 coordinator 创建：本 worker 的派单行为规则要求对第三方 GitHub 操作 escalation，不代为 push/open PR；代码已本地提交，未自行合并。
