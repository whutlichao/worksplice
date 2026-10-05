# 票 05 证据包

2026-10-03 实跑于本机（`/tmp/ws-evidence/`，一次性目录）。三部分各自独立、都可复现；**没有一次模型调用是付费的**（agent 用 `new-api/space-bunny-free`，免费模型）。

| 文件 | 是什么 | 需要模型吗 |
| --- | --- | --- |
| `part-a-mechanism.sh` + `part-a-transcript.txt` + `part-a-3-held.json` | **协议证明**：并发写被 hold 而不是覆盖 | 不需要 |
| `part-b-real-run.sh` + `part-b-transcript.txt` + `part-b-session.jsonl` | **真实运行（修复前）**：hold 触发了，revise 失败 | 需要（免费模型） |
| `part-b-transcript-fixed.txt` + `part-b-revision-prompt.txt` | **真实运行（修复后）**：revise 走通 | 需要（免费模型） |
| `part-c-review.mjs` + `part-c-transcript.txt` | **互审规则**：构建者不能验证自己 | 不需要 |

## A · 协议证明（确定性）

```
Alice 读到房间版本 seq=2 → Bob 写下 seq=3 → Alice 用 baseSeq=2 提交
→ HTTP 409 {"held":true,"roomSeq":3,"whatHappened":"1 new message(s) arrived in this target (seq 3)"}
→ 房间不变（Bob 的话还在，Alice 那一版没写进去）
→ Alice 改用 baseSeq=3 重发 → HTTP 201
```

复现：`BASE=http://127.0.0.1:3105 OUT=<目录> bash part-a-mechanism.sh`

## B · 真实运行（需要模型）

剧本：Bob 唤醒 Alice 改 `parser.js` → 在她**真正 drain 完**之后插话（判据是 session 里出现 `[worksplice:target=<频道> seq=N]`）→ 她用旧版本 N 提交 → 被 hold。

**结果：hold 触发了，但 revise 这一支在生产接线下失败。** `round_logs`：

```
status=error  reason="revised reply had no content"  base_seq=3
```

打开 loop 的临时诊断日志后抓到 SDK 的原始报错：

```
[probe] prompt failed: Agent is already processing. Specify streamingBehavior
('steer' or 'followUp') to queue the message.
| head: "Your reply to channel hold-run-004148 was held bec..."
```

即：loop 在 `prompt_done` 之后立刻发 revise prompt，而 pi SDK 认为 agent 仍在处理，直接拒绝 → 空文本 → 记 `error`（消息保持 pending，下轮重试，**不丢消息**）。单测里 `promptFn` 是注入的假实现，所以这条缝从未被覆盖。

同一轮里另外三种收口是工作的：`anyway`（显式绕过，消息落地）、`silent`、`yielded`（模型自己塞了 task 操作时让路）。

复现：`BASE=... OUT=... PROJECT=... WORKSPLICE_DATA_DIR=... PI_CODING_AGENT_DIR=... MUTE=1 bash part-b-real-run.sh`

两个必要的复现前提（三次失败换来的，写在脚本注释里）：
1. 必须等她**真正 drain 完**再插话；早了（会话还没起）两条消息被同一轮一起读到，压根不会 hold。
2. 必须等她**先静默**（建号/建频道会在 `#all` 触发别的轮次）并让插话**不唤醒她**（静音该频道；静音只挡唤醒，`getSince` 不过滤，所以 revise 仍能看到新消息正文）。

## C · 互审规则（确定性）

```
1) Dev 认领            → claimed
2) Dev 交付（in_review）→ updated
3) Dev 想自己 approve  → 被拒：The builder cannot verify their own work
4) Reviewer approve    → updated        （最终 done）
```

复现：`WORKSPLICE_DATA_DIR=<独立目录> node part-c-review.mjs`（不起服务、不触发 wake）

## B′ · 修复验证（2026-10-03，修复后重跑）

修复：`lib/agent-loop/loop.ts` 新增 `waitForSessionIdle`——发 prompt 前等会话真正空闲（`prompt_done` ≠ 空闲；`LoopSession.isRunning()` 是判据），`promptSession` 在发送前调用它；回归测试盯住这条缝（`loop.test.mjs` 两条，未修时红、修后绿）。重跑同一剧本：

```
✓ [worksplice:revision] 出现了
房间：#6 Alice  收到，引号内逗号这点我原来的方案漏了，补充如下（仍不改代码）…
round_logs：status=replied  base_seq=5
```

**`part-b-revision-prompt.txt` 是可直接公开的核心素材**（不含任何本机路径），它逐字展示了 hold 如何把控制权交回作者：

```
Your reply to channel hold-run-085200 was held because the room changed while you were writing.
What happened: 2 new message(s) arrived in this target (seq 4–5)
The room is now at seq 5.

Messages that arrived while you were writing:
#4 @Owner: 等一下——按逗号切分在引号里的逗号上会出错。先说方案，别直接改。
…
Your held draft was:
---
已读完 parser.js 和 README.md。
…
[worksplice:revision]
```

## 环境说明（复现时要知道的）

- 本机文件沙箱不允许写 `~/.pi`，所以整场实验用 `PI_CODING_AGENT_DIR=/tmp/ws-evidence/pi-agent` 重定向（里面只有一份最小 `settings.json` + 指向真实 `models.json` 的**符号链接**，密钥从未被复制）。**作者的 `~/.pi` 没有被写入任何内容。**
- `.next` 是生产构建（`npm run build`），服务用 `node bin/worksplice.js --port 3105`。
- agent 的工作目录是一次性的 `/tmp/ws-evidence/project`（一个只有 `README.md` + `parser.js` 的 git 仓库）。

## 诚实记录（这些数字/结论的边界）

- **修复前的失败证据被刻意保留**（`part-b-transcript.txt` + SDK 原文报错）：它是证据文最好的钩子——"我们的 hold 路径在真实接线下失效了，问题出在 SDK 的 settle 语义"。
- B 的失败结论建立在 **4 次独立运行**上（每次都是 `revised reply had no content`），其中 1 次抓到了 SDK 原始报错；修复后的成功也是同一剧本跑出来的。
- 演示时把 agent 在该频道静音是**为了隔离变量**（避免"插话唤醒她 → 新一轮抢会话"），静音不参与 hold 判定。
- 免费模型不稳定：它会自己塞 task 操作（导致 `yielded`）、会选 `anyway` 而不是 `revise`。这不是缺陷，但**决定了复现需要重试**。
