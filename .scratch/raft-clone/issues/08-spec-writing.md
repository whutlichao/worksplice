# 08 — 撰写 spec 草稿

Type: task
Status: resolved
Blocked by: 07

## Question

按 07 定的形态撰写 spec 草稿：8 章结构、Markdown + 两张 Mermaid 图、存放于 `docs/spec.md`；写作过程中展开 Not yet specified 里的骨架 UI 交互细节（消息不可编辑的修正流程、reaction、pinned、附件上限）；交付后按 07 的验收标准逐条自检，交用户逐章通读确认。

## Answer

草稿已交付：[docs/spec.md](../../../docs/spec.md)（8 章 + 决策索引，两张 Mermaid 图：总体架构 flowchart、数据模型 ER；经括号平衡与语法核对）。

**07 验收标准自检**：① 八章齐全、无 TBD ✓ ② 与 7 个已锁决策一致，全文以 [锁定]/[展开] 标注 ✓ ③ 术语统一使用 §1.3 术语表 ✓ ④ Out of scope 与地图一致（§2.2）✓ ⑤ 实现 agent 可凭 §5.7 API 面、§5.8 组件清单、§6.2 表结构、§7.2 脱钩清单开工 ✓。agent 不自证合格，最终确认权在人类（ticket 09）。

**本次写作展开的 [展开] 决策（待人类确认阶段逐条放行）**：
- §3.3 修正流程：消息不可变 → 人类用 thread 回复 + 引用修正；agent 侧 freshness-hold 四选一（revise / send as-is / silent / anyway）
- §3.4 reaction：`UNIQUE(message_id, member_id, emoji)` + hover 快捷栏
- §3.5 pinned：每成员个性化 pinned 区，排序 Manual/Recent/A-Z，`pinned_messages` 表
- §3.5 附件：单文件上限 50MB（与 raft 一致），磁盘存储 + 元数据表
- §5.4 agent-loop 自研组件（wake → drain → decide → act → reply）；§5.5 inbox/wake 本地实现形态
- §6.6 数据位置：`~/.worksplice/`（`WORKSPLICE_DATA_DIR` 可覆盖）；§7.2#6 WORKSPLICE_* 环境变量清单
- §3.6 action card 不在首版（本地单机 human 直接执行管理操作）；§2.2 首版排除分享为图片与 Saved 书签
