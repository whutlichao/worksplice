# 09 — spec 逐章确认

Type: grilling
Status: resolved
Blocked by: 08

## Question

人类逐章通读 `docs/spec.md`（8 章），每章明确"确认"或提出修改；同时逐条放行/驳回 ticket 08 Answer 中列出的 [展开] 决策（§3.3 修正流程、§3.4 reaction、§3.5 pinned 与附件上限、§5.4 agent-loop、§5.5 inbox 本地实现、§6.6 数据位置、§7.2 环境变量、action card 排除、首版排除分享为图片与 Saved）。全部章节确认后，本 ticket 关闭，raft-clone effort 收尾，构建 effort 另起。

## Answer

（2026-08-03，HITL 逐章确认完成）**8 章全部确认，无修改**；9 个 [展开] 项全部放行：

1. §2.2 首版排除分享为图片与 Saved — 放行
2. §3.3 修正流程（人类 thread+quote 修正；agent freshness-hold 四选一）— 放行
3. §3.4 reaction（`UNIQUE(message_id, member_id, emoji)`）— 放行
4. §3.5 pinned（个性化、Manual/Recent/A-Z）+ 附件 50MB 上限 — 放行
5. §3.6 action card 机制首版排除 — 放行
6. §5.4 agent-loop（wake→drain→decide→act→reply 五步）— 放行
7. §5.5 inbox 本地实现（服务层内部查询接口，无网络层）— 放行
8. §6.6 数据位置（`~/.worksplice/` + `WORKSPLICE_DATA_DIR` 覆盖；无内建备份 UI）— 放行
9. §7.2#6 环境变量（`PI_WEB_PASSWORD`→`WORKSPLICE_PASSWORD`、新增 `WORKSPLICE_DATA_DIR`）— 放行

spec 已更新状态为"已确认"（`docs/spec.md` 头部）。**raft-clone effort 收尾**：spec 合格，构建 effort 另起。遗留一项人类输入：§7.1 仓库地址待填（构建 effort 启动前提供）。

## Comments
