# 秘书 agent 可行性调研：事件触发 / bash 工具集 / API 地址发现

> 背景：设计一个"秘书 agent"（普通 agent 成员形态），需要 a) 在关键节点（新 agent 加入频道、新频道建立、Owner 首次登录）主动发欢迎/报到消息；b) 用 bash + curl 调本地 HTTP API 创建频道/agent。
> 本调研只回答三个事实问题，不写实现代码。

---

## 问题 1：关键节点触发机制（"非消息事件"有没有事件流/wake 面）

### 1.1 wake 体系的全部触发面（事实）

wake 事件是 agent-loop 唯一的"外部唤醒"通道，hint 结构（`lib/agent-loop/wake.ts:12-17`）：

```ts
export interface WakeHint {
  agentId: string;
  targetId: string;
  seq: number;
  reason: "message" | "reminder";   // 枚举只有两个
}
```

全仓库 `emitWake(` 调用点只有 5 处（grep 全量确认）：

| 位置 | 用途 |
|---|---|
| `lib/agent-loop/wake.ts:42` | `emitWake` 定义本身 |
| `lib/agent-loop/wake.ts:68` | 任务延续自醒（owner 回复落 in_progress 任务线程） |
| `lib/agent-loop/wake.ts:76` | channel 成员被新消息唤醒（不含作者，mute 除外） |
| `lib/agent-loop/wake.ts:82` | 未加入 channel 但被 `@mention` 的 agent 穿透唤醒 |
| `lib/raft/reminders.ts:325` | `fireReminder` 定向唤醒提醒作者（reason=reminder） |

其中 68/76/82 三处全部在 `notifyMessageWakes`（`wake.ts:61-84`）内部，而 `notifyMessageWakes` 的**唯一调用点**是 `lib/raft/messages.ts:135`（`sendMessage` 事务提交成功后、`wake !== false` 时，事务外分发，held 不误唤醒，见 `messages.ts:132-138` 注释）。

订阅侧：`subscribeWake` 的订阅者只有 loop 驱动（`lib/agent-loop/driver.ts:54`），driver 将 hint 排入逐 agent FIFO 队列，同 (agent,target) 合并、reminder 宽松升级（`driver.ts:83-100`），busy 时 settle 后重试（`driver.ts:140-174`）。

**结论：wake 只由两类事件触发——消息落库（`sendMessage`）与提醒到点（`fireReminder`）。非消息事件没有任何 wake 面。**

### 1.2 非消息事件现状（逐文件证据）

**`lib/raft/channels.ts`**
- `createChannel`（`:32-52`）：`insertChannel` → `addChannelMember(owner)` → 循环 `addChannelMember(memberIds)`，**无任何通知/事件发射**，最后直接 `return channel`。
- `joinChannel`（`:58-72`）：权限校验（owner 可替他人、私有仅 owner）→ `addChannelMember`，**无任何通知**。
- `leaveChannel` / `setChannelArchived` / `muteChannel` 同理：纯 DB 变更，零事件。

**`lib/raft/members.ts`**
- `createAgent`（`:117-164`）：建家目录 + 写 MEMORY.md → `insertMember` → 自动加入 `#all`（`:162` `getDb().addChannelMember(BUILTIN_CHANNEL_ID, agent.id)`），**无通知、无欢迎消息**。
- 全仓库 grep `welcome|欢迎|seed message` 零命中；`appendMessage` 唯一调用点在 `messages.ts:116`（即只有 `sendMessage` 写消息）。系统启动/seed 阶段不产生任何消息。

**API 路由层（薄封装，无额外事件）**
- `app/api/channels/route.ts` POST（`:12-33`）→ `createChannel`；`app/api/members/route.ts` POST（`:17-49`）→ `createAgent`。都是"解析 body → 调服务层 → 返回 JSON"。

**状态点流（给 UI 的，不是事件流）**
- `lib/agent-status.ts`：状态点 = **现状快照**（`{memberId: working|online|error|offline}`），不是"发生过什么"的事件流；广播只发生在 `publishAgentStatus` 值变化时（`broadcastIfChanged`，`:76-88`）+ 10s 低频扫掠（`:94-97`）。
- `app/api/members/events/route.ts` GET：SSE 推整张快照 + 30s heartbeat（`:30-38`）。agent 理论上可以用 bash+curl 消费（loopback 恒放行，见问题 3），但**快照里没有 join/create 事件**，且没有任何东西能因此唤醒 agent——纯轮询。

**"Owner 首次登录"概念不存在**
- Owner 不是登录出来的：`lib/data/schema.ts` 的 `seed()`（`:225-244`）在每次打开 DB 时插入 `#all` 频道 + 一个 `human` 类型的 Owner 行（`OWNER_MEMBER_ID = "owner"`，`schema.ts:6`）；`CURRENT_MEMBER_ID` 恒为 `"owner"`（`channels.ts:6`）。
- 全系统无登录页/登录事件；最接近的"全局启动"钩子是 `instrumentation.ts`（`register()` 里 `startAgentLoop()`，`:9-17`）——它只做状态扫掠 + 崩溃补拉 + driver + reminder cron（`lib/agent-loop/index.ts:27-43`），**不产生任何事件或消息**。

### 1.3 现有先例：提醒系统消息（可复用的"服务层替身份投递"模板）

`lib/raft/reminders.ts` 的 `fireReminder`（`:263-336`）给出了完整先例：

1. **以作者署名投递系统消息**：`sendMessage({ targetId: deliveryTarget, authorId: reminder.author_id, content, wake: false })`（`:283-288`）。系统消息就是普通消息行，只是作者固定为提醒作者。
2. **`wake: false` 的含义**：`sendMessage` 的 `wake` 选项（`messages.ts:81-82`）控制提交后是否调 `notifyMessageWakes`——`wake:false` = 不惊动 channel 其他 agent（`:133-135`）。
3. **定向唤醒**：仅当作者是 agent 时 `emitWake({ agentId, targetId, seq, reason: "reminder" })`（`:322-331`）；作者是 human 则靠 UI 轮询看到系统消息。
4. **幂等收口**：`status/fire_at` 前置校验，重复调用返回 `not_due`；状态迁移 + log 在事务里（`:305-320`）；投递失败记 error log 并收口 fired（`:271-297`）。

这条链路的每一步（`sendMessage` 带 `wake`、`emitWake`、事务收口）都是秘书欢迎消息可直接复用的机制。

### 1.4 结论：非消息事件 → agent 感知的现有路径

| 事件 | 现有感知路径 | 状态 |
|---|---|---|
| 消息落库 | `notifyMessageWakes` → driver → `runAgentRound` | **有**（完整闭环） |
| 提醒到点 | `fireReminder` → 系统消息（wake:false）+ `emitWake`(reminder) | **有**（完整闭环） |
| 新 agent 加入频道（joinChannel） | 无 | **无** |
| 新频道建立（createChannel） | 无 | **无** |
| agent 创建（createAgent） | 无（仅 DB 行 + 自动进 `#all`） | **无** |
| Owner 首次登录 | 无登录概念；最近似事件 = 服务启动（instrumentation） | **无** |

### 1.5 可行实现选项与成本

**方案 A：join/create 处投递"事件系统消息"（低改动，推荐）**
- 在 `joinChannel` / `createChannel` / `createAgent` 提交后（参考 reminder 的"提交成功后、事务外"模式）由服务层调 `sendMessage` 投一条描述事件的消息（如"@秘书 新 agent X 加入了频道"），`wake` 走 `notifyMessageWakes`（消息会被目标 channel 的 agent 成员看到；若秘书不在该 channel，用 `@秘书` mention → 穿透唤醒，`wake.ts:78-83` + loop 非成员推进逻辑 `loop.ts:566-574`）。
- 秘书被唤醒后 drain 到"非自己消息" → 正常 `buildReplyPrompt` 应答，欢迎即秘书的回复。
- 成本：**低**。机制全部现成（`sendMessage` + wake + mention 穿透），只改 `channels.ts`/`members.ts` 两个服务层文件；需处理的边角：作者必须已是该 channel 成员（`messages.ts:92` 强校验——可用 Owner 署名，Owner 由 seed 进 `#all` 且 createChannel 自动加入）；`createAgent` 时秘书必须已存在（创建顺序依赖）。

**方案 B：扩展 wake 体系（中改动）**
- 给 `WakeHint.reason` 加 `"member_joined" | "channel_created"` 等枚举，在 join/create 处 `emitWake`。
- 但 `runAgentRound` 的入口是 drain（`loop.ts:561-562`：`drained.messages.length === 0` 直接 `noop`）——**纯 wake 扩展不够**，还要给"空 drain 的语境轮"新增 prompt 路径（参考 `reason === "reminder"` 的宽松处理，`loop.ts:578-584`）。
- 成本：**中**（wake.ts 枚举 + driver 合并规则 + loop 新分支）。

**方案 C：秘书自轮询（零服务端改动，但反架构）**
- 秘书用 bash+curl 轮询 `GET /api/channels` / `GET /api/members` 比对变化。服务端零改动，但实时性差、与现有 wake 架构相悖；且秘书自己的 loop 不会被触发（无消息 → noop），要靠 reminder cron（分钟级）或外部机制兜底。

**关键陷阱（设计时必须规避）**：**不要以"秘书署名"的系统消息作为触发器**——`runAgentRound` 对"drain 到的全是自己的消息"直接 noop（`loop.ts:581-584`），秘书会被自己的消息挡住；触发器作者必须是别人（Owner 或事件署名），或走 reminder 宽松轮（`reminderDriven`）。

---

## 问题 2：pi 工具集与 bash 可用性

### 2.1 preset 定义（`lib/tool-presets.ts`）

```ts
export const PRESET_NONE: string[] = [];                                    // :9
export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"]; // :10
export const PRESET_FULL: string[] = ["bash", "read", "edit", "write", "grep", "find", "ls"]; // :11
```

- **bash 在 PRESET_DEFAULT 和 PRESET_FULL 里都有**；`PRESET_FULL` 额外加 grep/find/ls。
- `getPresetFromTools`（`:15-28`）与 `getToolNamesForPreset`（`:30-34`）为纯函数；非匹配集合回落 `"default"`。
- `rpc-manager.ts:90`：`CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"]`——与 `PRESET_FULL` 完全一致。

### 2.2 startRpcSession 的 toolNames 语义（`lib/rpc-manager.ts:1195-1282`）

| 传入值 | 行为 |
|---|---|
| `toolNames` 未定义（缺省） | 不传 tools 选项 → pi SDK 默认激活 `["read","bash","edit","write"]`（即 PRESET_DEFAULT；SDK 证据：`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2043-2046` `defaultActiveToolNames = ["read","bash","edit","write"]`） |
| `toolNames: []`（空数组） | 语义 = "全关"：传空 allow-list 禁用一切工具（`:1198-1207`）+ `setForceEmptySystemPrompt(true)` 清空 system prompt（`:1271-1273`，热重载后仍强制，`:1282`） |
| `toolNames` 非空（如 PRESET_FULL） | 创建后 `setActiveToolsByName(请求的工具 ∪ 全部扩展/包工具)`（`:1263-1265` + `withExtensionTools` `:120-130`），内置编码工具只保留请求的 7 个 |

`set_tools` 命令同语义：`toolNames.length === 0` → 清 system prompt（`:578-584`）。

**agent 成员会话的实际情况**：`lib/agent-runtime.ts:144-157` 的 `startSession` **不传 toolNames**（只传 per-agent 模型/thinking 覆盖）→ 秘书（普通 agent 成员）由 agent-loop 拉起的会话**默认激活 read/bash/edit/write，bash 开箱即用**。

### 2.3 结论：秘书跑 curl 的工具集选择

- **无需任何特殊配置**：agent 成员会话默认就有 `bash`（PRESET_DEFAULT），`curl` 直接可用。
- 想要 grep/find/ls 一并可用：按 `PRESET_FULL`（= `CODING_TOOL_NAMES` 7 个工具名）配置即可；若走 `POST /api/agent/new` 传 `toolNames`（`app/api/agent/new/route.ts:45-49` 支持），传这 7 个名字。
- **禁忌**：任何入口都别传 `toolNames: []`——那会全禁工具 + 清空 system prompt，秘书就既不能 curl 也失去自我认知。

---

## 问题 3：API 服务地址发现

### 3.1 端口 30141 写在哪

| 位置 | 内容 |
|---|---|
| `bin/worksplice-options.js:24` | `port: cliArgs.port ?? env.PORT ?? "30141"`——默认值 + CLI/环境覆盖 |
| `package.json:31-35` | `dev` / `dev:lan` / `start` / `start:lan` 四个脚本**硬编码 `-p 30141`** |
| `README.md:24,95` | 文档声明默认 http://127.0.0.1:30141 |

hostname 同理：`worksplice-options.js:25` `cliArgs.hostname ?? env.WORKSPLICE_HOSTNAME ?? "127.0.0.1"`。

### 3.2 启动链路与 env

- **生产二进制** `bin/worksplice.js`：解析 port/hostname → `next start -p <port> -H <hostname>`（`:60-61`），并把 `WORKSPLICE_HOSTNAME` 注入子进程 env（`:68` `env: { ...process.env, WORKSPLICE_HOSTNAME: hostname }`）；要求 `.next` 构建产物（`:43-46`）。覆盖顺序：CLI `-p/--port` > `PORT` env > 默认 30141。
- **dev 模式** `npm run dev`：直接跑 `next dev -H 127.0.0.1 -p 30141`——**CLI flag 优先，`PORT` 环境变量在 dev/start 脚本路径下不生效**（只有 `worksplice` 二进制尊重 `PORT`）。dev 下也不会导出 `WORKSPLICE_HOSTNAME`（那是 `worksplice.js:68` 二进制专属）。
- `next.config.ts`：**无端口配置**；只有 `serverExternalPackages` / `allowedDevOrigins` / headers / 两个 `NEXT_PUBLIC_*` env（`:12-49`）。
- `proxy.ts`（middleware）：**无端口逻辑**；只做 request-security（Host/Origin 校验）与可选 Basic Auth（`WORKSPLICE_PASSWORD`，username 固定 `pi`，`proxy.ts:25-37`）。

### 3.3 运行时"自知地址"的现状

- **服务端代码内部全部用相对路径**：`components/` 下 86 处 `fetch("/api/...")`（如 `ChannelView.tsx:1639,1855`、`AppShell.tsx:68`），没有任何绝对 base URL 概念。
- 全仓库唯一的绝对 URL 在 `bin/worksplice.js:72`（`http://${hostname}:${port}`，仅供自动打开浏览器），**不进入服务器进程**。
- 环境变量全清单（README.md:34-38）：`PORT`（仅二进制）、`WORKSPLICE_HOSTNAME`（仅 hostname、无端口）、`WORKSPLICE_ALLOWED_HOSTS`、`WORKSPLICE_PASSWORD`、`WORKSPLICE_NO_OPEN`，另有数据目录 `WORKSPLICE_DATA_DIR`（docs/spec.md:436）。**没有 `WORKSPLICE_PORT` 这样的"端口已知"变量。**

### 3.4 本机 curl 的 API 安全门（好消息）

`lib/request-security.ts`：
- Host 校验（`:76-88`）：hostname 为 loopback（localhost/*.localhost）或任意 IP 字面量 → 放行；**不校验端口**。
- Origin 校验（`:91-112`）：仅在请求带 `origin` / `sec-fetch-site` 头时启用——curl 不带这些头 → 恒放行。

即：秘书在**同机**用 `curl http://127.0.0.1:30141/api/...`（Host 为 loopback + 无浏览器头）**永远通过安全门**；唯一例外是设置了 `WORKSPLICE_PASSWORD` 时需要 `-u pi:<password>`（Basic Auth）。

### 3.5 结论：base URL 如何发现

1. **默认写死 `http://127.0.0.1:30141` 是可靠的**：默认端口在 4 处硬编码一致（package.json ×4 脚本、worksplice-options.js 默认值、README 文档），loopback 恒被安全门放行。
2. **运行时可发现性弱**：
   - dev 模式：服务器进程（及秘书的 bash 子进程）内**没有**任何端口 env——脚本把 `-p 30141` 硬编码进 CLI flag，`PORT` 不生效、`WORKSPLICE_HOSTNAME` 不导出。
   - 生产二进制模式：若部署者 `PORT=8080 worksplice`，`PORT` 会随 `env: {...process.env}` 传递进服务器进程，秘书 bash 的 `executeBash` 子进程继承服务器 env → 能读到 `$PORT` 与 `$WORKSPLICE_HOSTNAME`（但这是"用户恰好设置了"的偶然，不是契约）。
3. **稳妥做法**：a) 默认写死 30141；b) 把 base URL 写入秘书家目录的 `MEMORY.md`（`members.ts:143-146` 创建时预置模板 + `lib/data/dirs.ts` 的 `buildMemoryTemplate` 固定大纲），由部署者按实际端口填写；c) 不要依赖运行时 env 发现（无 `WORKSPLICE_PORT`，dev 下无 `PORT`）。

---

## 附录：关键证据索引

| 事实 | 证据 |
|---|---|
| WakeHint 只有 message/reminder 两个 reason | `lib/agent-loop/wake.ts:12-17` |
| emitWake 全部调用点 | `wake.ts:42,68,76,82`；`lib/raft/reminders.ts:325` |
| notifyMessageWakes 唯一调用点 | `lib/raft/messages.ts:135`（`wake !== false` 且非 held） |
| subscribeWake 唯一订阅者 | `lib/agent-loop/driver.ts:54` |
| joinChannel/createChannel 无通知 | `lib/raft/channels.ts:32-52,58-72` |
| createAgent 无通知、自动进 #all | `lib/raft/members.ts:117-164`（`:162`） |
| Owner 是 seed 静态行、无登录概念 | `lib/data/schema.ts:5-6,225-244`；`channels.ts:6` |
| 状态点是快照不是事件流 | `lib/agent-status.ts:14,51-88`；`app/api/members/events/route.ts:9-38` |
| 系统消息先例（署名投递 + wake:false + emitWake） | `lib/raft/reminders.ts:263-336` |
| 秘书自己的消息会被 loop noop | `lib/agent-loop/loop.ts:561-594` |
| PRESET 定义、bash 在 DEFAULT 与 FULL 中 | `lib/tool-presets.ts:9-11` |
| toolNames 三态语义（未传/空/非空） | `lib/rpc-manager.ts:1195-1282`（`:1198-1207,1263-1273`） |
| agent 成员会话默认工具 = SDK 默认 | `lib/agent-runtime.ts:144-157`；pi agent-session.js:2043-2046 |
| 端口 30141 四处硬编码 | `bin/worksplice-options.js:24`；`package.json:31-35`；`README.md:24,95` |
| 二进制注入 WORKSPLICE_HOSTNAME、尊重 PORT | `bin/worksplice.js:60-61,68`；`worksplice-options.js:24-25` |
| dev 脚本硬编码端口、PORT 不生效 | `package.json:31-32` |
| API 安全门不校验端口、curl 恒放行 | `lib/request-security.ts:76-88,91-112`；`proxy.ts:11-40` |
| UI 全相对路径、无绝对 base URL | `components/*.tsx` 86 处 `fetch("/api/...")` |
