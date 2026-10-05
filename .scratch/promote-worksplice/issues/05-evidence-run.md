# 05 — 实测证据：跑一次可复现的「并发写 → hold → 互审」

**Type:** task
**Blocked by:** 02
**Status:** resolved

**输入（来自已关闭的 [02 首发消息面](./02-launch-message.md)）**：要跑的就是「并发写裁决」这一幕——两个 agent 对同一频道写入、第二个被 hold、它选 revise 且房间未被覆盖，并留存 hold 时的原始 payload。注意 `scripts/seed-demo.mjs` 里有 `if (result.held) throw` 的断言，说明这段现场**没有现成演示数据**，必须真跑。

## Question

Q9 把「一篇真实实测证据文」列为首发门槛。landscape 的结论支撑这个门槛：同类展示帖近乎零互动，**「发了自然有人看」是假的**。在动笔写之前必须先真的跑一次，并把要留的证据定下来：

1. **实验设计**：两个 pi agent 指向同一个 checkout → 同一时刻对同一 channel 写入 → 触发 freshness-hold → 走 revise/resend 分支 → 任务 claim → 另一个 agent 互审 approve。跑多久、用哪个 provider/model（**0 预算**，要算 token 成本）、什么算「跑通」、失败重试几次仍算有效证据。
2. **留存什么**：截图、`~/.pi/agent/sessions` 的原始 jsonl、session 的 HTML 导出、hold 发生时的原始 payload、耗时与成本数字。哪些能公开、哪些会泄漏本机路径或私有内容（README 已有本地优先的定位，证据文里不能反手暴露）。
3. **可复现性**：别人照着能不能重跑——用 `seed:demo` 复现现场，还是必须两个真实 agent 加自己的 key？这决定证据文里写「你可以这样复现」还是「这是我们那次运行的记录」。

**产出**：一次真实运行的记录 + 可公开的证据素材清单 + 这篇证据文的**骨架**（正文写作留给执行阶段，不在本票内）。

## Answer

2026-10-03 实跑于本机（一次性目录 `/tmp/ws-evidence/`）。证据包落在 [evidence/](../evidence/README.md)，含三个可复现脚本与它们的原始输出。**零模型成本**：agent 用免费模型 `space-bunny-free`。

### 1. 跑出了什么

| 部分 | 证明了什么 | 结果 |
| --- | --- | --- |
| **A · 协议证明**（脚本 + curl 输出，无模型） | 并发写被 hold 而不是覆盖 | ✅ 409 `{held:true, roomSeq:3, whatHappened:"1 new message(s) arrived in this target (seq 3)"}`；房间未被覆盖；改版本号重发 201 |
| **B · 真实运行**（一个真 pi agent，免费模型） | hold 在真实链路里会触发 | ⚠️ **hold 触发了，但 revise 分支失败**（见 §2） |
| **C · 互审规则**（脚本，无模型） | 构建者不验证自己 | ✅ Dev 交付后自己 approve 被拒（`The builder cannot verify their own work`），Reviewer approve 后 done |

### 2. 关键发现：hold 成立，**revise 在生产接线下不成立**

`round_logs`（真实运行）：

```
status=error  reason="revised reply had no content"  base_seq=3
```

在 loop 里加临时诊断日志后抓到 pi SDK 的原始报错：

```
[probe] prompt failed: Agent is already processing. Specify streamingBehavior
('steer' or 'followUp') to queue the message.
| head: "Your reply to channel hold-run-004148 was held bec..."
```

**根因**：loop 的 `promptSession` 在 `prompt_done` 后立刻发 revise prompt，而 SDK 认为 agent 仍在处理 → 拒绝 → 空文本 → 记 `error`。单测里 `promptFn` 是注入的假实现，所以**这条缝（loop ↔ wrapper/SDK 的 settle 语义）从未被覆盖**。4 次独立运行全部复现。

**坏掉时系统仍然做对的事**：消息不丢——游标不推进、被 hold 的消息保持 pending、下一轮重试；状态点如实报 `error`。同一轮里另外三种收口照常工作（`anyway` 显式绕过并落地、`silent`、`yielded` 让路）。

诊断补丁（`lib/agent-loop/loop.ts` 两处 `console.error`）**已还原**，工作区干净。

### 3. 证据素材清单与可公开性判定

| 素材 | 可公开？ |
| --- | --- |
| `part-a-transcript.txt`、`part-a-3-held.json`（409 原文） | ✅ 直接可公开 |
| `part-c-transcript.txt`（互审被拒原文） | ✅ 直接可公开 |
| `part-b-transcript.txt`、`round_logs` 摘录、SDK 原始报错行 | ✅ 可公开（含模型名 `space-bunny-free`，不含任何凭据） |
| `part-b-session.jsonl`（完整会话） | ❌ **必须脱敏后才能公开**——它内嵌 agent 系统提示里的**本机技能清单绝对路径**（`/Users/apple/.agents/skills/...`）。建议只公开「revise prompt 那一条」并剥掉路径 |
| 架构图/截图 | 待票 03（录屏）产出 |

隐私扫描结论：证据里**没有** API key、`auth.json` 内容、网关地址或 `Bearer` 串；唯一的泄漏面是上面那条本机路径。

### 4. 可复现性判定

- **A 与 C 完全确定性、零成本**：一条命令、不碰模型，任何人可复现。建议把这两个脚本直接作为文章附录。
- **B 需要模型 + 两个前提 + 重试**：前提写进了脚本注释——(1) 必须等她**真正 drain 完**再插话（判据：session 里出现 `[worksplice:target=<频道> seq=N]`），早了根本不会 hold；(2) 必须等她**先静默**（建号/建频道会在 `#all` 触发别的轮次抢会话）并让插话**不唤醒她**（静音该频道；静音只挡唤醒，`getSince` 不过滤）。免费模型还会自己塞 task 操作（→ `yielded`）或选 `anyway`，所以要允许重试。
- **环境**：本机沙箱不允许写 `~/.pi`，全程用 `PI_CODING_AGENT_DIR` 重定向到一次性目录（`models.json` 走符号链接，**密钥从未被复制**）；作者的 `~/.pi` 未被写入。

### 5. 证据文骨架（交执行阶段写作）

《两个 agent 抢同一个文件时，我们做了什么 —— 以及哪里做错了》

1. **场景**：两个 pi agent 共用一个 checkout，各自都以为自己是对的；
2. **本来打算怎么做**：写携带房间版本、房间动过就 hold、作者四选一；
3. **协议这一层是成立的**（证据 A，附 409 原文与重发成功）；
4. **真实运行里它触发了，但 revise 掉进了 SDK 的 settle 缝**（证据 B + SDK 原文报错）；
5. **为什么会漏**：单测注入假 promptFn，缝在 loop 与 wrapper 之间；
6. **坏掉的时候系统做对了什么**：不丢消息、如实报错、其余三种收口照常；
7. **另外两条仍然成立的语义**：互审（证据 C）、重开封锁；
8. **修法与验收判据**：等 settle 或用 `streamingBehavior:'followUp'` 入队；验收 = 重跑拿到 `[worksplice:revision]` 标记。

> 这个骨架比原计划（"展示我们做对了"）更有价值：**它把一次真实失效变成了可信度**，正对 `docs/design-notes/orchestrating-coding-agents.md` 的既有文体。

### 6. 后续

- 新增决策票 [11 并发写裁决这一幕：首发前修 revise，还是改叙事](./11-revise-defect-decision.md)——它直接改票 02 定的主打场景与票 09 的就绪门槛。
- 票 09 的就绪检查单必须包含：**revise 路径在真实运行中可用（重跑拿到 `[worksplice:revision]`）**，或叙事已按票 11 的结论改写。
