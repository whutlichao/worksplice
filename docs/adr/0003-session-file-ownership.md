# 会话文件所有权：固化登记即归属，无主文件永不解析

**背景**：共享项目目录允许多 agent 绑定（ADR-0001），agent 按需重建会话时原本沿用「cwd 下最新且未被任何成员 `pi_session_file` 引用的 session 文件」——但「未被引用」不等于「无主」：人类 pi 会话从不登记 `pi_session_file`、soft-deleted agent 的登记随 `listMembers()` 的 `deleted=0` 过滤而消失、活 agent 的旧文件本就无登记。任何无主文件都可被新 agent 解析并 `setAgentSessionFile` 固化——**借来的文件永久变成自己的**（粘性继承）——即「agent 继承其他 agent 会话/上下文」的机制根源（症状②）。

**决策（ticket 03）**：

- **所有权凭证 = 固化登记**：`members.pi_session_file` 是会话文件归属的唯一事实来源。jsonl 无归属元数据（格式读写权归 SDK，app 只读不解析，spec 已锁），无法事后区分文件属于谁——归属只能由 DB 登记推导。
- **复用校验**：`startSession` 对 `pi_session_file` 现值做归属校验——文件 cwd == 成员当前 workspace、不被其他成员固化引用、在 session 清单内。校验失败（历史脏数据）→ **自愈**：清除错绑 + 新建空会话 + 记日志；不做批量清理（无法事后判定继承来源，且文件内容可能仍有效）。
- **无主文件永不解析**：无绑定或绑定文件丢失时，仅家目录（构造上唯一私有，他 agent 家目录不可绑定）回填 latest unreferenced；共享项目目录一律新建空会话。
- **语义分叉**：「继承判定」只认固化登记，人类会话文件天然无主、永不解析；「占用判定」（busy，`hasBusyRpcSessionForCwd`）是独立一轴，由 02 决策，互不牵连。

**Consequences**：

- 共享目录上「B 捡起 A 的旧上下文继续聊」的隐性行为消失——该行为本身就是继承 bug。
- 「换目录即换会话」语义自洽：换回来也是新会话。
- 04（backfill 作者归属护栏）的所有权门禁与本文档同源：文件必须仍是该 agent 的 `pi_session_file` 且 cwd 归属一致。
- 启动路径在已绑定文件时多一次 `SessionManager.listAll()` 查证（无绑定时不增加）。
- spec.md §5.2 的「按需重建沿用 cwd 下最新 jsonl」描述被本 ADR 取代（收窄为家目录回填）。
