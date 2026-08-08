# 01 — 关键节点触发机制与 bash 工具可用性研究

Type: research
Status: resolved
Blocked by:

## Question

构建秘书需要三个技术事实（research 子代理产出到 `.scratch/bootstrap-agent/research/01-*.md`）：

1. **关键节点触发机制**：现有系统里"成员加入 channel、channel 创建、agent 创建"等非消息事件，有没有任何事件流或 wake 面？（查 `lib/raft/channels.ts` join/create、`lib/agent-loop/wake.ts` 的触发面清单、`lib/agent-status.ts` 状态点、`app/api/members/events/route.ts` SSE、`lib/agent-loop/reminder-cron.ts` 系统消息投递先例）——"新成员欢迎/新频道报到"的欢迎消息触发路径怎么落地：join/create 处发系统消息（reminder fire 的先例）？还是依赖成员轮询？还是需要新 wake 类型（违背零机制改动原则，须明确标注机制成本）？
2. **pi 工具集**：`lib/tool-presets.ts` 的 PRESET_DEFAULT / PRESET_FULL 各自包含哪些工具？**bash 工具是否在列**（curl 依赖它）？秘书创建时工具集怎么选（toolNames 怎么传）？
3. **API 服务地址**：worksplice 服务端口如何确定（dev 30141 写在哪、bin/worksplice.js 的启动逻辑、有无环境变量/配置能让 agent 发现 base URL）？

## Answer

研究产出：[research/01-key-events-and-bash-research.md](../research/01-key-events-and-bash-research.md)（三个问题，证据索引含文件:行号）。

**问题 1 — 关键节点触发机制**：
- 非消息事件**零感知通道**：wake 的完整触发面只有两类——消息落库（`messages.ts:135` `notifyMessageWakes`）与提醒到点（`reminders.ts:325` `emitWake` reason="reminder"）；`WakeHint.reason` 枚举只有 `"message" | "reminder"`。`joinChannel`/`createChannel`（`channels.ts:32-72`）、`createAgent`（`members.ts:117-164`）均为纯 DB 变更，零事件；状态点流（`agent-status.ts` + `members/events` SSE）是快照非事件流；**"Owner 首次登录"不存在**——Owner 是 schema seed 的静态行（`schema.ts:225-244`），无登录概念，最近似事件 = 服务启动（`instrumentation.ts`）。
- **触发方案选型**：**方案 A（采纳）**——在 join/create 提交后由服务层以 Owner 署名投"事件系统消息"（如"@秘书 新 agent X 加入频道"），走现有 `sendMessage` + `@mention` 穿透唤醒（`wake.ts:78-83`），秘书被唤醒后正常 drain 应答即欢迎。机制全部现成（reminder 先例 `reminders.ts:263-336`），成本低。方案 B（扩展 wake 枚举）中改、方案 C（自轮询）反架构，均不采纳。
- **关键陷阱（设计铁律）**：触发器**不得以秘书署名**——`runAgentRound` 对"drain 到的全是自己的消息"直接 noop（`loop.ts:581-594`），秘书会被自己的消息挡住；署名必须为 Owner/事件方，或走 reminder 宽松轮。

**问题 2 — bash 工具可用性**：
- `bash` 在 `PRESET_DEFAULT = ["read","bash","edit","write"]`（`tool-presets.ts:10`）与 `PRESET_FULL`（`:11`）中都有；agent 成员会话由 `agent-runtime.ts:144-157` 启动时不传 toolNames → SDK 默认激活 DEFAULT → **curl 开箱即用，零配置**。
- 禁忌：任何入口不得传 `toolNames: []`（全禁工具 + 清空 system prompt，`rpc-manager.ts:1198-1207`）。若需 grep/find/ls，按 `CODING_TOOL_NAMES` 7 个工具名配置。

**问题 3 — API 地址发现**：
- 默认端口 30141 四处硬编码一致（`package.json:31-35`、`worksplice-options.js:24`、README）；覆盖顺序 CLI > `PORT` env > 默认，但 **dev/start 脚本路径下 `PORT` 不生效**；无 `WORKSPLICE_PORT`。
- 安全门利好：`request-security.ts:76-88` 只校验 loopback/IP 字面量 hostname、**不校验端口**，且 Origin 检查仅对带浏览器头的请求生效——同机 `curl http://127.0.0.1:30141/api/...` 恒放行（设 `WORKSPLICE_PASSWORD` 时需 `-u pi:<password>`）。
- 结论：**默认写死 `http://127.0.0.1:30141` 可靠**；自定义端口场景把 base URL 写进秘书 MEMORY.md（构建 effort 定实现），不依赖运行时 env 发现。
