# 研究 01 — pi 能力边界与多实例模型

> 对应 ticket：`.scratch/raft-clone/issues/01-pi-multi-instance-model.md`
> 研究对象：pi coding agent（`@earendil-works/pi-coding-agent`，仓库 `earendil-works/pi`，原名 `badlogic/pi-mono`）、pi-web（`agegr/pi-web`）
> 日期：2026-08-02 · 结论基于官方文档 pi.dev/docs、npm 包源码与 GitHub issue/discussion

---

## 结论摘要

- **持久 agent = 一个 AgentSession（SDK 内存对象）或一个 `pi --mode rpc` 子进程**，每个会话绑定一个固定 cwd；会话的"持久性"由 `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl` 文件承载，进程退出后可用 `SessionManager.open()` 从该文件完整恢复（含分支树、compaction、模型/思考级别状态）。
- **多实例完全可行且是官方生态的默认做法**：官方仓库生态中的 pi-subagents 扩展就是把每个 sub-agent 实现为一个持久的 `pi --mode rpc` 子进程（`pi --mode rpc` 是官方 headless 模式）；pi-web 则在**同一个 Node.js 进程内**持有多个 `AgentSession`（全局注册表 `globalThis.__piSessions: Map<sessionId, AgentSessionWrapper>`），多会话并存。
- **隔离的天然单位是 cwd**：session 文件按 cwd 编码分目录（`/`→`-`，形如 `--home-user-proj--`），不同 cwd 的会话零冲突；但同一 cwd 同时只允许一个活跃会话（pi-web 用 `hasBusyRpcSessionForCwd()` 显式拒绝），raft 的多 agent 应映射为"每 agent 一个 cwd / 一个 session"。
- **配置（models.json/skills/auth/settings）默认全局共享**（`~/.pi/agent/`），但可用 `PI_CODING_AGENT_DIR` 环境变量整体隔离成多份"agent 目录"；session 存储可单独用 `PI_CODING_AGENT_SESSION_DIR` / `--session-dir` / `settings.json#sessionDir` 隔离（优先级依次递减）。
- **共享配置文件的并发写有锁**：settings.json、auth.json 的读写使用 proper-lockfile（早期版本并发启动会因锁冲突崩溃，v0.55.3 起已加重试，见 discussion #1629）；session jsonl 本身无锁，**同一文件禁止多进程同时写**——raft 应保证"一个 session 文件同一时刻只有一个进程/会话持有"。

---

## pi 的基本形态

### CLI 形态

- 安装：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent` 或 `curl -fsSL https://pi.dev/install.sh | sh`；仓库为 monorepo（`earendil-works/pi`，原 `badlogic/pi-mono`，82k+ stars），核心包：
  - `@earendil-works/pi-coding-agent` — 交互式 coding agent CLI（含 SDK、RPC、JSON 模式）
  - `@earendil-works/pi-agent-core` — agent runtime（tool calling、状态管理）
  - `@earendil-works/pi-ai` — 统一多 provider LLM API
  - `@earendil-works/pi-tui` — 终端 UI 库
- 用法：`pi [options] [@files...] [messages...]`，默认进入交互式 TUI；`pi -p "prompt"` 打印模式；`pi --mode json "prompt"` JSON 事件流；`pi --mode rpc` 走 stdin/stdout JSONL；`pi -c` 继续最近会话、`pi -r` 浏览选择会话。

### 配置方式（分层）

| 层 | 位置 | 内容 |
| --- | --- | --- |
| 全局配置目录 | `~/.pi/agent/`（可用 `PI_CODING_AGENT_DIR` 覆盖） | `models.json`、`auth.json`、`settings.json`、`trust.json`、`extensions/`、`skills/`、`prompts/`、`themes/`、`sessions/`、`AGENTS.md`、`SYSTEM.md` |
| 全局设置 | `~/.pi/agent/settings.json` | 默认模型/思考级别、compaction、retry、`sessionDir`、`packages`、`skills`、`extensions` 等 |
| 项目设置 | `.pi/settings.json`（cwd 下，需项目信任） | 覆盖全局设置（嵌套合并） |
| 项目资源 | `.pi/skills/`、`.pi/extensions/`、`.pi/prompts/`、`.agents/skills/` | 项目级扩展与技能 |
| CLI 参数 | `--provider`、`--model`、`--session-dir`、`--no-session`、`--skill`、`--extension` 等 | 单次运行覆盖 |

- `models.json`：`{"providers": {"<name>": {"baseUrl", "api", "apiKey", "models": [...]}}}`；`apiKey` 支持环境变量插值（`$VAR`）与 shell 命令（`!cmd`）；文件在 `/model` 打开时重载，无需重启。
- skills 目录：`~/.pi/agent/skills/<name>/SKILL.md`（frontmatter 含 `name`/`description`），另支持 `~/.agents/skills/`、`.pi/skills/`、`.agents/skills/`（cwd 及祖先目录）；技能以 `/skill:name` 注册，描述常驻 system prompt、正文按需 `read` 加载（progressive disclosure）。

### session 存储

- 位置：`~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl`；编码规则见源码 `packages/coding-agent/src/core/session-manager.ts`：
  - `safePath = "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--"`
- 格式：JSONL，首行为 `session` header（`{"type":"session","version":3,"id","cwd",...}`），后续每行一个 entry（`message`/`compaction`/`branch_summary`/`custom`/`custom_message`/`label`/`model_change`/`thinking_level_change`/`session_info`），entry 通过 `id`/`parentId` 构成树（分支不新建文件，`/fork`/`/clone` 才新建 `.jsonl`）。
- 持久化策略：用户消息先 flush 写盘，assistant 消息到达后全量重写；bash-only 会话由调用方补写（见 pi-web `persistBashOnlySession()`）。
- 每会话启动时 bash 工具注入 `PI_SESSION_ID`/`PI_SESSION_FILE`/`PI_PROVIDER`/`PI_MODEL`/`PI_REASONING_LEVEL`。

---

## 多实例可行性

### 可行，隔离维度如下

1. **按 cwd（工作目录）隔离 —— 默认且最自然**：session 文件按 cwd 编码分目录，不同 cwd 的 pi 进程/会话互不干扰；CLI 以启动时所在目录为 cwd（SDK 中 `createAgentSession({ cwd })` 可显式指定）。pi 的 SessionManager API 与 pi-web 的目录选择器都围绕 cwd 组织。
2. **按环境变量隔离 agent 目录**：`PI_CODING_AGENT_DIR=<dir>` 可让每个实例拥有独立的 models.json / skills / auth / settings / sessions（源码 `config.ts`：`getAgentDir()` 优先读 `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`，即 `PI_CODING_AGENT_DIR`）。这是"每 agent 一套配置 + 一套 session"的最彻底做法。
3. **仅隔离 session 存储**：`PI_CODING_AGENT_SESSION_DIR`（环境变量）→ `--session-dir <path>`（CLI）→ `settings.json#sessionDir`（设置），优先级依次递减。
4. **设置隔离**：`~/.pi/agent/settings.json` 全局 + `.pi/settings.json` 项目级覆盖（嵌套合并）。

### 同一 cwd 的并发约束（重要）

- 共享文件（settings.json、auth.json、models.json）的写入有 proper-lockfile 文件锁：**并发启动**早期版本会直接崩溃（discussion #1629，`Lock file is already being held`），v0.55.3 起改为带重试的 `acquireLockSyncWithRetry`（10 次×20ms）；issue #4919 报告了 stale 锁不回收导致误报 "No API key found" 的残留问题。**结论：多实例可并发启动，但共享配置的并发写仍然需要外部串行化，最稳妥是每 agent 一份 `PI_CODING_AGENT_DIR`。**
- session jsonl 写入无锁（appendFileSync/writeFileSync 直写）：同一 session 文件绝不能被两个进程同时持有；不同进程新建会话（时间戳+uuid 文件名不同）则天然无冲突。
- pi-web 在应用层强制"同一 cwd 同时只有一个活跃会话"（`hasBusyRpcSessionForCwd()` / `destroyRpcSessionsForCwd()`），并发在**不同 cwd** 之间展开。

### 生态先例

- **pi-subagents**（`rjshrjndrn/pi-subagents`，官方 README 推荐链路）：每个 sub-agent 是持久的 `pi --mode rpc` 子进程，可并行 spawn 多个、双向通信、断线可 `resume_agent` 恢复——多实例方案在官方生态中已被验证为常规操作。
- pi-chat（`earendil-works/pi-chat`）同样以多进程/多会话方式服务聊天自动化。

---

## 服务化驱动方式

### pi 的三种 headless 出口

1. **RPC 模式**（`pi --mode rpc [--no-session] [--session-dir <dir>] [--name <name>]`）：stdin/stdout 上跑 JSONL 协议——客户端发命令（`prompt`/`steer`/`follow_up`/`abort`/`bash`/`compact`/`fork`/`new_session`/`switch_session`/`get_state`/`get_entries`/`set_model`/…），进程向 stdout 推事件（`agent_start`/`agent_end`/`agent_settled`/`message_update`/`tool_execution_*`/`compaction_*`/`queue_update` 等）。扩展 UI 交互（select/confirm/input/editor）在 RPC 模式下转为 request/response 子协议。**这是"pi 进程即服务"的官方形态。**
2. **JSON 事件流模式**（`pi --mode json "prompt"`）：单次执行，事件以 JSON 行输出到 stdout，首行是 session header。
3. **SDK**（`@earendil-works/pi-coding-agent`）：同进程嵌入。导出 `createAgentSession()`、`createAgentSessionServices()`、`createAgentSessionFromServices()`、`createAgentSessionRuntime()`、`SessionManager`、`SettingsManager`、`ModelRuntime`、`DefaultResourceLoader`、`runRpcMode()`/`runPrintMode()` 等。**SDK 模式下 `PI_CODING_AGENT` 标记不会被自动设置（文档注明）。**

### pi-web 的 AgentSession 机制（如何驱动 pi、能否多会话并存）

**它不是调用 `pi` CLI 子进程，而是在 Next.js 进程内直接 import pi 的 SDK 包**（`package.json` dependencies 直锁 `@earendil-works/pi-{agent-core,ai,coding-agent,tui}@0.83.0`），把 `AgentSession` 包装成 `AgentSessionWrapper`：

- **生命周期**（`lib/rpc-manager.ts`）：
  - `startRpcSession(sessionId, sessionFile, cwd, options)`：已有 sessionFile → `SessionManager.open(file)`；新建 → `SessionManager.create(cwd)`。先用 `createAgentSessionServices({cwd, agentDir})` 构建服务（含 resourceLoader、模型解析、项目信任 gate），再 `createAgentSessionFromServices()` 产出 `AgentSession`，包一层 `AgentSessionWrapper` 后注册进**全局注册表** `globalThis.__piSessions: Map<sessionId, AgentSessionWrapper>`（挂在 globalThis 上以扛 Next.js 热重载）。
  - `prompt` 是 fire-and-forget（`source: "rpc"`），结果通过 `session.subscribe()` 事件流推送；`send()` 支持 20+ 种命令（prompt/steer/follow_up/abort/bash/compact/fork/reload/set_model/set_tools/get_state/get_commands…）。
  - **idle 回收**：10 分钟无活动自动 `shutdown()`（可 `onDestroy` 回调）；`destroy()` 调 `inner.dispose()`。进程退出（exit/SIGINT/SIGTERM）时清空全部 wrapper。
  - 单例语义：`sessionId` 在注册表已存在且 alive 则直接复用；启动中的会话有 per-key 的 in-flight lock（合并并发请求）；`/api/agent/new` 用一次性 `__new__<uuid>` 键避免撞锁。
- **SSE 事件出口**（`app/api/agent/[id]/events/route.ts`）：GET 打开 `ReadableStream`，`data: <json>\n\n` 逐事件推送（滤掉 `turn_start/turn_end/tool_execution_update` 等高频事件），30s 心跳防超时，客户端断开（abort signal）即清理。
- **命令入口**（`app/api/agent/[id]/route.ts`）：POST 命令 → `send()`；`app/api/agent/new/route.ts`：POST `{cwd, type, message, provider, modelId, toolNames, thinkingLevel}` → 建新会话并立即下发首条命令（`ensure_session` 只建 runtime 不发指令）。
- **多会话并存：是**。注册表本身是 `Map<sessionId, ...>`，不同 cwd/不同 session 的多个 wrapper 可同时存活、同时运行（`getRunningRpcSessionIds()` 提供给侧边栏实时运行状态）；唯一约束是**同一 cwd 的 busy 会话唯一**（`hasBusyRpcSessionForCwd` 检查启动中/运行中的会话）。
- **session 文件解析**（`lib/session-reader.ts`）：复用 SDK 的 `SessionManager.listAll()` / `SessionManager.open(file).getEntries()` / `buildSessionContext()` / `buildContextEntries()`，再本地做 UI 化转换（branch context、fork 目标、compaction 展示、工具调用归一化、图片 base64 裁剪等）；列表结果 30s TTL 缓存 + 世代号失效。
- **bin/pi-web.js**：Node 包装器，校验 Node ≥22.19，解析 `--port/--hostname/--no-open/PI_WEB_PASSWORD` 等，`spawn(process.execPath, [nextBin, "start", ...])` 启动 Next 服务器，监听 stdout 出现 "Ready" 后打开浏览器——即"一个 pi-web 进程 = 一个常驻的 Next.js 服务 = N 个 AgentSession"。

### raft 映射要点

- 无需每 agent 一个 OS 进程；单进程内多 `AgentSession` 即可（pi-web 已证明）。
- 持久 agent = 一个 session 文件 + 一个注册表项；"恢复" = `SessionManager.open(file)` 后按需重建（pi-web 已有 GET/POST `/api/agent/[id]` 的懒加载重建路径）。
- 每 agent 独立 cwd；如需完全隔离配置，为 agent 组准备多份 `PI_CODING_AGENT_DIR`（注意：`getAgentDir()` 是进程级单例，同进程内混用多份 agent 目录需要 SDK 参数覆盖 `agentDir`/`ModelRuntime.create({authPath, modelsPath})`，pi-web 目前只支持单一 `~/.pi/agent`）。

---

## 关键事实来源

- 仓库与 README：https://github.com/earendil-works/pi （原 badlogic/pi-mono 迁移，README 列出 4 个包与容器化说明）
- pi-web README / 项目结构：https://github.com/agegr/pi-web （含 `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`、`PI_CODING_AGENT_DIR` 说明）
- pi-web package.json：https://raw.githubusercontent.com/agegr/pi-web/main/package.json （依赖直锁 4 个 `@earendil-works/pi-*@0.83.0`）
- pi-web lib/rpc-manager.ts：https://raw.githubusercontent.com/agegr/pi-web/main/lib/rpc-manager.ts （AgentSessionWrapper 生命周期、全局注册表、idle shutdown、`hasBusyRpcSessionForCwd`）
- pi-web app/api/agent：`new/route.ts`、`[id]/route.ts`、`[id]/events/route.ts`、`running/route.ts`（同仓库 raw 路径）
- pi-web lib/session-reader.ts：https://raw.githubusercontent.com/agegr/pi-web/main/lib/session-reader.ts （SDK SessionManager 复用 + .jsonl 解析/缓存）
- pi-web bin/pi-web.js：https://raw.githubusercontent.com/agegr/pi-web/main/bin/pi-web.js （next start 包装器）
- 官方文档（pi.dev/docs/latest）：
  - 概览/快速开始：https://pi.dev/docs/latest 、/quickstart
  - CLI 参考（模式/会话/工具/资源参数）：https://pi.dev/docs/latest/usage
  - 设置与项目覆盖：https://pi.dev/docs/latest/settings （sessionDir 优先级、信任机制）
  - 环境变量：https://pi.dev/docs/latest/environment-variables （`PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、bash 注入变量）
  - Session 文件格式与 SessionManager API：https://pi.dev/docs/latest/session-format
  - Skills 结构与位置：https://pi.dev/docs/latest/skills
  - 自定义模型 models.json：https://pi.dev/docs/latest/models
  - SDK：https://pi.dev/docs/latest/sdk （createAgentSession/…Services/…Runtime、agentDir/cwd 语义）
  - RPC 模式：https://pi.dev/docs/latest/rpc （headless JSONL 协议、事件表、`--no-session`/`--session-dir`）
  - JSON 事件流模式：https://pi.dev/docs/latest/json
- pi 源码：
  - session 编码/存储：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts
  - 配置目录/环境变量：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/config.ts （`ENV_AGENT_DIR = PI_CODING_AGENT_DIR`，getAgentDir/getSessionsDir/getModelsPath）
- 并发/多实例事实与生态：
  - Discussion #1629（并发启动锁冲突、修复）：https://github.com/badlogic/pi-mono/discussions/1629
  - Issue #4919（auth/settings stale 锁）：https://github.com/earendil-works/pi/issues/4919
  - Issue #1871（并行启动的误导性 auth 错误）：https://github.com/badlogic/pi-mono/issues/1871
  - Issue #5035（子进程继承 PI_CODING_AGENT_DIR 的副作用）：https://github.com/earendil-works/pi/issues/5035
  - pi-subagents（每 sub-agent = 持久 `pi --mode rpc` 子进程）：https://github.com/rjshrjndrn/pi-subagents
