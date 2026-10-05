# 04 — pi-web 功能去留与 raft 能力映射

Type: grilling
Status: resolved
Blocked by: 03

## Question

pi-web 现有功能（会话浏览、模型配置、技能管理、文件预览、worktree 切换）在 raft 形态下哪些保留/改造/删除？raft 能力（channels/threads/任务板/inbox）与这些功能的映射关系如何？哪些 pi-web 代码面整体保留、哪些重写？

研究输入（03 已闭）：raft 无可观测性规范页（需自研形态）、inbox 为拉取式、任务板自动认领。另需一并决策：可观测性面板形态（token/成本、任务历史视图）、i18n 语言集与中文优先策略。

## Answer

### 决策（用户逐项确认）

1. **UI 骨架：重写为 raft 式（Discord 式）**——左栏 channels/agent 列表、中央 channel 消息流、channel 级 Tasks tab、消息级 thread；pi-web 降级为组件库复用，不保留单聊天窗口布局
2. **会话浏览（会话树）：删除**——channel/thread 消息流即 agent 工作历史；fork/分支删除（raft 消息不可变，修正靠回复）；rename/delete 改造为 agent 详情面板的三种重置粒度（Restart / Session reset / Full reset）+ 删除身份；export/context 与状态可见性（cost/compaction）并入可观测性面板
3. **模型配置：保留全局面板 + 新增 per-agent 模型选择**——全局 models.json 面板对应 raft server 级设置（几乎不改）；per-agent 模型/provider/thinking 选择对应 raft 的 runtime config（复用 ChatInput 模型选择器）
4. **技能管理：保留为全局设置**（raft 无对应概念，作为本地形态增强，代码复用 SkillsConfig）
5. **文件预览三分法**：消息附件（新功能，挂附件复用 FileViewer）＋ agent workspace 浏览（进 agent 详情面板，对应 raft workspace 概念）＋ **项目 Explorer（用户明确要求保留）**
6. **worktree：保留代码，降级为 agent workspace 管理**——创建 agent 时用 DirectoryPicker 选绑定目录（可选 worktree），agent 详情面板可换；无侧栏全局切换器
7. **可观测性面板：agent 详情面板内一个 tab**——① agent 状态点（绿/黄/橙/灰 + idle/active，raft 语义）② token/成本（复用 pi session context/cost 数据，per-agent 聚合）③ 任务历史（该 agent 参与的任务 + 状态变更时间线，复刻自研）
8. **i18n：保留 en + zh-CN 双语言，默认英文、英文优先**（用户修改推荐：不默认中文）

### raft 能力 → pi-web 功能映射

| raft 能力 | 落点 |
|---|---|
| channels/threads | 新骨架（消息流复用 MessageView/MarkdownBody/ChatInput） |
| 任务板（Tasks tab） | channel 级新视图，状态机 todo→in_progress→in_review→done/closed |
| inbox（拉取式） | agent 侧新协议（seq 游标 + drain + wake hint），数据层见 05 |
| reminder | 新功能（服务端 cron 调度 + recurrence DSL） |
| agent 成员/身份 | agent 详情面板（重置粒度/workspace/runtime/可观测性） |

### pi-web 代码面清单

- **整体保留复用（组件）**：MarkdownBody、MessageView、ChatInput、FileViewer、FileExplorer、ModelsConfig、SkillsConfig、DirectoryPicker、TabBar、FileIcons、MermaidBlock、i18n 基建、主题
- **整体保留复用（lib/API）**：rpc-manager、session-reader、agent-client、useAgentSession、models-config/model-catalog/provider 系、worktree/git 系、file-access/directory-browser、skills-service、project-trust（启动 gate）
- **重写**：AppShell（布局骨架）、SessionSidebar（→ channels/agent 列表）、ChatWindow（→ channel 消息流）、SessionSidebar 的会话树/项目选择；新增 channels/threads/tasks/inbox/reminders API 与 freshness-hold
- **删除**：fork/分支 UI、会话树浏览、侧栏 worktree 切换器
- **未列为决策点、默认保留**：插件管理（pi 生态能力，全局设置）、PWA（沿用，手机端本身 out of scope）、项目信任 gate
