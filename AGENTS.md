# worksplice - Development Notes

> 面向本地多 pi coding agent 的协作工作区：群组、任务板与评审、提醒、inbox/wake 游标，以及浏览器会话 UI。

<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.

<!-- CODEGRAPH_END -->

<!-- BROWSER_START -->

## 浏览器操作/测试（ego-browser 优先）

需要进行浏览器测试、页面操作、自动化验证时，**优先使用 ego-browser skill（ego lite）**，不要默认使用 Playwright：

- 用法：`skill("ego-browser")` 加载后，通过 Bash 运行 `ego-browser nodejs <<'EOF' ... EOF` heredoc 驱动真实浏览器。
- 适用：打开页面、点击/输入、截图观察、`js()` 注入探针做前端行为验证（如监测重渲染/滚动跳变）、网络抓取等。
- 仅当 ego-browser 不可用（未安装且安装失败）或任务明确要求 Playwright 特有能力时才回退到 Playwright。

<!-- BROWSER_END -->

<!-- LANGUAGE_START -->

## Language

- 使用中文进行交流。
- 文档除了指定结构外，正文尽量使用中文。

<!-- LANGUAGE_END -->

## Agent skills

### Issue tracker

Issues 与 spec 存放在 GitHub Issues（`gh` CLI，仓库 `whutlichao/worksplice`）；`.scratch/` 存量冻结为历史存档。See `docs/agents/issue-tracker.md`.

### Triage labels

五个标准 triage 角色，标签字符串与角色同名（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。See `docs/agents/triage-labels.md`.

### Domain docs

单上下文：词汇表 `GLOSSARY.md`（`CONTEXT.md` 是迁移后的指针文件），决策记录 `docs/adr/`。See `docs/agents/domain.md`.

## Quick Start

- 装依赖只用 `bun install`（新 checkout 可加 `--frozen-lockfile`）；**禁止 `npm install`**——它忽略 `bun.lock`，会让依赖版本漂移、门禁基线不可比（见 `.scratch/worktree-dep-drift/`）。`npm run <script>` 不受影响。
- 开发服务：`npm run dev`（port `30142`）。
- Typecheck：`node_modules/.bin/tsc --noEmit`（等价 `npm run typecheck`）。
- Lint：`npm run lint`。
- **开发期禁止 `next build`**——它会污染 `.next/` 并破坏 `npm run dev`。

## Architecture（核心链路）

```text
Browser ──HTTP/SSE──▶ Next.js Server ──startRpcSession()──▶ AgentSession (in-process)
   │                       │                                  │
   ├─ GET /api/sessions ───┤ reads ~/.pi/agent/sessions/      │
   ├─ POST /api/agent/[id] ┤ session.send(cmd) ──────────────▶ session.prompt()
   └─ GET .../events ◀─────┤ session.onEvent() ◀────────────── session.subscribe()
```

- **Session browsing** 是只读路径：经 SDK `SessionManager` helpers 与 `lib/session-reader.ts` 直接读 `.jsonl`，不创建 AgentSession。
- **Sending a message** 走 `startRpcSession()`（`lib/rpc/`），在进程内创建 AgentSession。
- **协作写入** 走 `app/api/*/route.ts`（薄封装）→ `lib/domain/collab/*`（唯一事实来源）→ `getDb(): Store` → `SQLiteAdapter`。
- 完整展开与数据流见 `docs/architecture.md`。

## 改动前必读

1. **分层与协作写入**：API route 只做薄封装，业务规则必须落在 `lib/domain/collab/`（唯一导入面 `index.ts`，数据经 `getDb(): Store`），不要绕过服务层直接写 SQL。→ `docs/traps.md#collab-domain`
2. **fork 后立刻销毁 wrapper**：`AgentSession.fork()` 会原地改写 `inner.sessionId`，`send("fork")` 必须在返回前 `destroy()`，否则旧 id 会继续指向已 fork 状态并污染 `parentSession` 链。→ `docs/traps.md#fork-wrapper`
3. **不要把 Fork 与同文件分支混为一谈**：Fork 生成新的 `.jsonl`，Continue/BranchNavigator 用 `navigate_tree` 在同一文件内切 `leafId`，而 `parentSession` 只是展示元数据。→ `docs/traps.md#branching`
4. **globalThis 单例改动后必须重启 dev server**：`__workspliceWakeListeners` / `__workspliceRoomTurns` / `__workspliceMemberOpQuota` 等闭包会跨热重载存活，并确认 `next-server` 启动时间晚于改动。→ `docs/traps.md#agent-loop`
5. **`instrumentation.ts` 顶层禁止静态引入 Node 内置模块**：只在 `register()` 内、`NEXT_RUNTIME === "nodejs"` 守卫后动态 `await import()`，改动前先跑 `lib/access-gate-startup.test.mjs`。→ `docs/traps.md#instrumentation-edge`
6. **成员 bash 沙箱必须 fail-closed**：推导不出 `PORT` 或平台无法按端口过滤（当前 Linux）时不得激活，更不能退化成不封端口的沙箱。→ `docs/traps.md#bash-sandbox`
7. **房间系统消息必须显式声明**：Owner 署名的系统/事件消息要传 `roomNotice: true`（并保留 `wake:false`），否则会开新房次、重置 `lateTurns` 并 supersede 在跑场次。→ `docs/traps.md#room-budget`
8. **agent-loop 的 hint 合并窗口不能挪**：`processAgent` 必须在 `queue.shift()` 前先 `await null` 让出微任务，别在这之前加 `await` 或重排循环，否则同 target hint 合并会静默失效。→ `docs/traps.md#agent-loop`
9. **任务状态写权只认服务端裁决**：拖拽不做乐观移动；只有人类 Owner 与当前全局首席可以变更任务状态（含 claim / unclaim / complete / approve / reject / close / reopen）。普通 Bot / 群组首席的完成动作只产生完成请求并唤醒全局首席；任务事件与 handoff 归当前全局首席，群组首席只保留一般默认收件人；reopened 任务仅任务状态权威可认领接管并清标。→ `docs/traps.md#task-board`
10. **消息与线程边界不可破**：thread 内消息不能转任务、thread 不能嵌套，写操作带 `baseSeq` 走 freshness-hold，冲突返回 409 held。→ `docs/traps.md#collab-domain`
11. **文件 API 不是通用文件浏览器**：`/api/files` 与 worktrees 只允许 session cwd / project root / `~/pi-cwd-*` 及显式 `allowFileRoot()` 的根。→ `docs/traps.md#file-access`
12. **pi 配置检测不得产生副作用**：P1 路径一次都不碰模型面，初始化目标固定 `getAgentDir()` 且不接受 HTTP 指定目录。→ `docs/traps.md#pi-env`
13. **UI 图标只用 lucide**：除 reaction 持久化数据外禁止新增 emoji，替换按出现处编辑，禁止全局 `replaceAll`。→ `docs/traps.md#ui-icons`
14. **首席是一个身份、两个职责**：身份只按「群组首席 → 全局首席 → 无」回落，可达性另问 `canRouteToChief`，不要按名字判定，也不要新增第二个身份或判定入口。→ `docs/traps.md#chief`
15. **成员能力约束只在能力表定义**：createAgent/createChannel 的名字、配额、私有 actor 校验只从 `member-capabilities.ts` 取值，拒绝走 denied 通道，配额只在成功后记账。→ `docs/traps.md#member-capabilities`

## 文档索引

| 路径 | 什么时候读 |
| --- | --- |
| `docs/architecture.md` | 理解 HTTP/SSE/AgentSession 核心链路与协作写入链路时 |
| `docs/file-map.md` | 定位 API 路由、服务层、组件、hooks 或数据层模块时；改代码前先查 |
| `docs/traps.md` | 动架构、agent-loop、协作域、首席、任务板、提醒、消息、沙箱或启动钩子前 |
| `docs/pi-session-file-format.md` | 读写 session `.jsonl`、处理 fork、backfill、导出或统计时 |
| `docs/css-variables.md` | 改主题、token、对比度或组件视觉时 |
| `docs/engineering-standards.md` | 写代码、补测试、提交/PR 门禁、密钥与成本纪律 |
| `docs/agents/issue-tracker.md` | 创建/读取/认领/关闭 issue，或需要 spec/ticket 流程 |
| `docs/agents/triage-labels.md` | 应用 triage 标签时 |
| `docs/agents/domain.md` | 查术语与 ADR、输出领域概念前 |
| `docs/agents/orchestration-dispatch-checklist.md` | 派 worker 或实施票前逐项核对 |
| `docs/i18n.md` | 改 UI 文案、模型上下文文案或 MEMORY.md 大纲时 |
| `docs/release.md` | 发布构建与 npm / GitHub Release 流程 |
| `docs/adr/` | 需要核对既有架构决策与取舍时 |
