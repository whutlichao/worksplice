# 04-HTTP 走廊的调用者身份

Type: grilling
Status: claimed
Blocked by: （无）

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/agent-bash-containment-form.md`（Implementation Decisions · 决策六「排序约束」）
ADR: `docs/adr/0012-agent-bash-containment-form.md`（决策六）
前置事实: `docs/adr/0011-agent-file-tool-path-guard.md`（票 02 已合入 `a2d4634`）

## Question

**怎么让 worksplice 的 app 不再给任何能摸到端口的东西一条未沙箱的裸 shell。**

ADR-0012 决策六把这个洞判成排序链的第一环：在它落地之前，票 02 的六工具守卫与本形态都只能
自述为「纵深防御的一层」。要定的是这条走廊的**形态**——门后是谁、凭证从哪来、秘书的 curl
能力面怎么办、`dev:lan` 时是什么姿态。

已取证的既有事实（本票不重开）：

- `POST /api/agent/[id]` 接受任意命令，`{"type":"bash"}` 经 `lib/rpc/session.ts:746` 进入
  `AgentSession.executeBash` 的裸本地实现（`dist/core/agent-session.js:3037` 的
  `options?.operations ?? createLocalBashOperations({ shellPath })`）。
- 这条路由没有调用者身份：进门一律按 Owner 处理（`lib/domain/collab/channels.ts:7`）。
- 非浏览器客户端不做来源校验（`.github/SECURITY.md`「Exposure and hardening」）；
  Host 白名单放行 loopback 名与 IP 字面量。
- 认证已存在但默认关闭：`WORKSPLICE_PASSWORD` → HTTP Basic Auth，用户名固定 `pi`。
- `getShellEnv()` 是 `{...process.env}` → app 的完整环境变量进入每个成员的每个 bash 子进程。
- 默认 bind `127.0.0.1`；`dev:lan` / `start:lan` / `--hostname 0.0.0.0` / `WORKSPLICE_HOSTNAME`
  放宽到 `0.0.0.0`。
- 秘书的 curl 能力面是 `docs/spec-bootstrap-agent.md` §3.1 / §3.3 的 **[锁定]** 条目。

## Acceptance criteria

- [ ] 决策文档落 `docs/` 下，七节结构齐全、正文中文、每节有实质内容。
- [ ] Q1（调用者身份 vs 认证）有明确结论：先回答「普通成员通过 bash 调 app 自己的 API 有哪些正当用途」，再据此定「默认是否向成员发放凭证」。
- [ ] Q2（认证形态）在强制 `WORKSPLICE_PASSWORD` / per-agent token / 分离端口 / 组合之间明确选定，被否决项附具体理由。
- [ ] Q3（env 收口与请求认证的先后）独立验证，不照抄协调器判断；若认同，说明限定条件。
- [ ] Q4（秘书 `[锁定]` 条目改不改）给出独立判断与论证；若判「锁定即禁改」，给出「不改就关不掉」的反驳处理。
- [ ] Q5（`dev:lan` 姿态）明确 fail-closed 或维持现状。
- [ ] 结论里明确写出 `dev:lan` 姿态，以及 env 面与请求面两条通道各自的处置。
- [ ] 残留绕过面被写明。
- [ ] 后续实施票的输入：阻塞关系 + 不做会怎样。
- [ ] 术语决议 inline 进 `CONTEXT.md`。
- [ ] ADR 仅在三条件全满足时创建并续到 0013；不建则写明原因。
- [ ] **不改代码**——本票是决策票，源码改动面必须为空。

## Notes

- 不做秘书豁免（秘书在每个频道、最易被注入）。
- 不引入 HITL / 审批流。
- 排序：本票在 sandbox 实施票**之前**。
- 提问通道 `orchestration ask`。
