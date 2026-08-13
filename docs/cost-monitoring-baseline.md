# worksplice 成本与监控基线

> 状态：**基线已建立（2026-08-13）** — 第一个 AI 应用 MVP（worksplice）开发与上线的收尾交付物。
> 对应 BAI-5：选定并实现第一个 AI 应用 MVP → 上线可用 → 建立成本与监控基线。

## 1. 产品与上线形态

- 产品：**worksplice** — 本地单机运行的多 agent 协作工作区（人类 Owner + 持久 pi coding agent 在频道/线程/任务板协作）。LLM 集成通过 `@earendil-works/pi-*` SDK（AgentSession in-process / `pi --mode rpc`）。
- 上线形态：**本地单机应用**（spec 锁定，多人/多机/服务器部署 out of scope）。`npm run start` 或 `npx worksplice` 即启，监听 `127.0.0.1:30142`。
- 发布路径：`docs/release.md` — npm 包 `worksplice` + GitHub Release（当前包版本 `0.1.0`，`main` 领先 origin 10 提交待发）。

## 2. 成本基线

### 2.1 成本采集方式

成本从 pi session jsonl **只读解析**（`lib/session-stats.ts`，与 SDK `getSessionStats` 同口径，不落库），按 agent 聚合展示于详情面板可观测性 tab（spec §6.5）。

解析口径：

- `message.usage`（assistant 消息）与 `compaction`/`branch_summary` 条目的 `usage`；
- 缓存 token = `cacheRead`；未缓存 token = `input + cacheWrite`；总 token = `input + output + cacheRead + cacheWrite`；
- 成本 = 各 usage 条目 `cost.total` 之和。

### 2.2 基线数据（2026-08-13 实测，3 个 agent）

| agent | 消息数 | 总 token | 累计成本（USD） |
| --- | --- | --- | --- |
| smoke-bot | 8 | 217,348 | 0.0000 |
| design | 36 | 1,072,610 | 0.1376 |
| Susan | 60 | 1,169,124 | 0.0000 |
| **合计** | **104** | **2,459,082** | **≈ $0.14** |

> 注：cost 为 0 的会话是 session jsonl 内尚无 cost 元数据的历史会话（模型未记录 cost 或会话发生在 cost 解析能力落地前）；design 的 $0.1376 是首个有成本数据的会话。

### 2.3 成本基线结论

- **MVP 全周期 LLM 成本 ≈ $0.14**，处于极低水平（开发期会话规模）。
- 缓存命中占比高：总 token 2.46M 中 cached 1.82M（约 74%）→ 缓存是成本的主要抑制因素，cost 有效值低于原始 token 量对应价格。
- 监控建议：每 release 或每周记录一次 §2.2 表格；若单 agent 单会话累计成本突增（> $1）需排查是否进入非缓存长上下文重复调用。

## 3. 监控基线

### 3.1 监控面（已落地）

| 层 | 机制 | 位置/入口 |
| --- | --- | --- |
| 成员状态 | 状态点四态（online/thinking/error/offline） | UI 频道成员面板 + `GET /api/members` |
| 轮次结果 | `round_logs` 表（agent/target/status/reason/base_seq/时间），只记有结论 7 种轮次，ring cap 200/agent | `GET /api/members/[id]/observability` → `rounds` |
| 任务历史 | 该 agent 参与的任务 + 状态变更时间线（查 messages/tasks，不落额外表） | observability → `tasks` / `timeline` |
| token/成本 | session jsonl 只读解析，按 agent 聚合 | observability → `stats` |
| 会话上下文 | 存活会话实时 context usage / compaction / 导出 | observability → `session.live` |
| 消息/频道 | seq 游标、freshness-hold、FTS 全文搜索 | 业务 API |

### 3.2 轮次结果语义（可观测页区分）

- **replied**：正常回复（成功轮）
- **ignored**：自判忽略（正常协议选择）
- **silent / anyway / yielded / busy-cwd**：协议内合法路径
- **error**：处理失败（需排查），如 `revised reply had no content`、must-respond 失败、cap-ack `(capped)`
- 普通 error/busy-cwd/yielded/ignored **不**标 abandoned；仅 silent + error/capped 派生「未回复」badge（`isAbandonedRound`）

### 3.3 基线数据（round_logs 实测，2026-08-13）

| status | 次数 | 说明 |
| --- | --- | --- |
| ignored | 7 | 自判忽略（正常） |
| replied | 3 | 正常回复 |
| error | 1 | `revised reply had no content`（已修复路径，见 agent-loop 回归测试） |

轮次记录总量小且无异常聚集：无 `(capped)` 逃逸、无连续 error 流 → agent-loop 当前健康。

### 3.4 运行态验证

- 应用实例：`http://127.0.0.1:30142` 存活，3 agent 均 online。
- 质量闸门：`tsc --noEmit` 干净、`npm run lint` 干净、测试 **668/668 pass**（lib + agent-loop + raft + data + components + hooks）。

## 4. 后续建议（不阻塞本轮）

- **CI/CD**：当前无 `.github/`（工程基座 BAI-4 覆盖项）；建议补 GitHub Actions 跑 tsc/lint/`node --test`，并在 release 路径门禁。
- **成本告警**：MVP 成本极低，暂不需要自动告警；可在一键脚本（记录 §2.2 + §3.3 快照）就绪后再接入。
- **基线刷新**：本文件为时间快照，更新时重跑 §2.2/§3.3 的命令即可。
