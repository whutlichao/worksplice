# worksplice 90 秒介绍视频 · 分镜（v2，马卡龙 UI）

- 规格：1600×900 / 30fps / h264 / 90.0s（±1s）/ 纯字幕、无旁白、英文界面 + 英文字幕 / ≤8MB
- 结构：与 v0.1.0 旧片（`worksplice-90s.mp4`）同构——10 镜、总时长不变、语言不变；
  画面全部换成当前 main 的马卡龙 UI，字幕文案沿用旧片并微调第 4/6/7/8 镜（见下）。
- 字幕样式：下缘 71px 近黑条（`rgb(18,16,17)`）+ 白色粗体 30px，居中；与旧片一致。
- 运镜：每镜推送/横摇/滚动由捕获阶段的浏览器舞台页逐帧渲染（本机 ffmpeg 无 drawtext/subtitles）。
- 数据：`WORKSPLICE_DATA_DIR` 指向独立演示目录（`scripts/seed-demo.mjs` 灌入），绝不触碰 `~/.worksplice`。

## 镜头表

| # | 入点–出点 | 时长 | 画面来源（捕获物 + 运镜） | 字幕（烧进画面） |
| --- | --- | --- | --- | --- |
| 1 | 0.0–9.0 | 9.0s | `board.png`：stream-sync 任务看板（五列：Pool / In progress / In review / Done / Closed），缓慢推近 | Five agents. One repository. Who decides? |
| 2 | 9.0–17.0 | 8.0s | `board.png`：推近到 In review 列的 `Approve / Reject` 卡片 | Done is not the same as approved — and that button only means something to someone who is not the author. |
| 3 | 17.0–25.0 | 8.0s | `messages_0/1/2.png`：频道消息三档滚动位交叉淡化（顶 → 中 → 底） | Not a chat log. The work itself. |
| 4 | 25.0–32.0 | 7.0s | `agent_panel.png`：Iris 资料面板（WORKSPACE / RUNTIME / TASK HISTORY / ROUNDS / SESSION EXPORT），向右侧面板推送 | Every agent is a persistent identity: its own directory, its own runtime, its own history. |
| 5 | 32.0–40.0 | 8.0s | `hold_1.png`：`hold-run-<tag>` 房间，owner 唤醒 Iris 的提问（seq #2），缓慢推近 | She was woken. The wake carries a position, not the message. |
| 6 | 40.0–47.0 | 7.0s | `hold_2.png`：插话进入房间（seq #3），与前态交叉淡化 | The room moved while she was writing. |
| 7 | 47.0–62.0 | 15.0s | `hold_3.png`：改稿回复落库（seq #4，作者 Iris），交叉淡化后向回复推送 | Her write was not merged. It was held — she re-read it and rewrote. |
| 8 | 62.0–76.0 | 14.0s | 终端页（黑底）：`worksplice room … --json` 的真实行 + 服务器真实返回的 hold 负载 + 被拒草稿，缓慢上滚 | This is not a UI effect. This is the hold the server returned. |
| 9 | 76.0–84.0 | 8.0s | `readme.png`：README「How It Relates to Other Tools」小节（含对比表）渲染页，缓慢推近 | Last-write-wins is the default. We do not have one. |
| 10 | 84.0–90.0 | 6.0s | `endcard.png`：片尾卡（worksplice / npx worksplice / github.com/whutlichao/worksplice / MIT · local · one SQLite file · no accounts），静态 | （无） |

合计 2700 帧 = 90.00s。

## 第 5–7 镜「真跑」口径（与 v0.1.0 的差异必须如实说明）

v0.1.0 旧片的第 5–7 镜由 **Release 构建 + 真实模型**驱动 pi agent：agent 被唤醒、写作被
freshness-hold 拦下、按 revise 重读重写，并展示其 pi session 文件。本次重建时本机没有模型
凭证（不代办第三方调用），经协调员裁决采用**同一机制、脚本驱动**的方案：

- **提问与插话**：走服务器真实 HTTP 写路径（`POST /api/messages`），真落库、真广播；
- **被 hold 的写**：走协作域同一条写路径 `sendMessage`（`app/api/messages/route.ts` 调用的就是它），
  携带过期 `baseSeq` → 由房间自身的 freshness 校验真实产生 `held` 与 `whatHappened`；
  held 写不落库（可在终端镜中核对：房间行里没有这条草稿）；
- **revise 后的回复**：以同一写路径按当前 `roomSeq` 落库，作者为 Iris；
- **第 8 镜**：展示的就是这次真实返回的 hold 负载（黑底终端、真实字节），不再展示 pi session 文件；
- **差别**：agent 的文本内容由脚本撰写（脚本化文案），而非模型生成；机制、状态与画面均真实。
- **唤醒抑制**：该房间对 Iris 静音（`muteChannel`）——本机没有模型，唤醒只会得到 demo provider
  的 error 态；静音只挡唤醒，不挡 freshness-hold 与 `getSince`（与 `scripts/evidence/part-b-real-run.sh`
  同一处置，该脚本里同样使用静音控制变量）。建频道入列时已在途的那次唤醒拦不住，等它落定后
  以 `setAgentStatus(iris, "offline")` 复位（只改成员状态行，不碰房间内容）——否则画面上会出现
  一次与本剧本无关的失败标记。

字幕因此把旧片的 "refused — she re-read it and rewrote" 改成 "held — she re-read it and rewrote"，
用词与 README / 域模型一致（`The write is held`）。

## 与旧片的字幕差异

| # | v0.1.0 | v2 | 原因 |
| --- | --- | --- | --- |
| 4 | …its own model, its own cost line. | …its own runtime, its own history. | 画面为真实面板；面板显示 WORKSPACE / RUNTIME / TASK HISTORY / ROUNDS / SESSION EXPORT，不显示成本数字 |
| 6 | Her round is running — the status dot says so. | The room moved while she was writing. | 无模型，不存在真实"运行中"轮次；画面实际展示的是插话进入房间 |
| 7 | refused | held | 与 README / 域模型用词一致 |
| 8 | This is her session file. | This is the hold the server returned. | 展示物由 pi session 文件改为服务器真实 hold 负载 |

第 1–3、5、9 镜字幕与旧片逐字相同。
