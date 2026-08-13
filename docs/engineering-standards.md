# 工程规范（Engineering Standards）

> 状态：**生效（2026-08-13，BAI-6）** — 沉淀 worksplice 首个应用打磨期的工程纪律。
> 本文是活文档：新增约定在此集中记录；与 AGENTS.md / CONTEXT.md / docs/adr 冲突时，以最近的决策为准并回填本文。
> 正文一律简体中文，技术术语保留英文。

## 1. 代码风格

- **语言与注释**：代码注释、commit message、issue/ticket 正文一律简体中文；标识符、API 路径、错误消息用英文（对外契约）。
- **Tabs/引号**：无强制的缩进宽度（沿用 next 脚手架 2 空格）；字符串统一单引号（`eslint` 默认）。提交前必须 `npm run lint` 干净。
- **命名**：
  - 服务层函数动词开头（`listXxx` / `createXxx` / `updateXxx` / `markXxx`）；路由文件一律 `export async function GET/POST(...)`。
  - 术语必须用 CONTEXT.md 的领域词表（成员/agent/频道/任务/轮次/唤醒/…），禁止引入同义词造成漂移。
  - 避免 `any`；服务层返回显式 union（如 `SendMessageResult`、状态机转移结果），让类型系统成为文档。
- **分层**：UI 组件不直连 DB——所有数据经 `lib/raft/*.ts` 服务层 → `app/api/*/route.ts`（薄封装，校验入参 + 映射错误码）。新查询方法落在 `lib/data/db.ts`，服务层只调 getDb()，不写 SQL。
- **错误码语义**：业务冲突用 409（held / conflict / blocked），非法入参用 400，资源缺失用 404。同语义错误跨路由必须同状态码（反例已整改：claim 边 conflict/blocked 与 /claim 对齐 409）。
- **不要**把密钥/客户数据写入代码、日志、commit。`console.log` 只在服务端排查用，能删则删。

## 2. 测试与 CI 纪律

### 2.1 测试框架

- **node:test + node:assert/strict**，零测试框架依赖。跑法：
  ```bash
  npm test              # 全量基线（agent-loop + raft + 组件，343 用例 @ BAI-6）
  node --test <files…>  # 单文件/子集
  ```
  全量基线明细：
  ```bash
  node --test lib/agent-loop/*.test.mjs lib/raft/*.test.mjs components/ChannelView.test.mjs
  ```
- **测试类型**（按此分层，优先写便宜的那层）：
  - **服务层单测**：`lib/raft/*.test.mjs` — 内存 tmp DB（`openDataDb(mkdtemp)`），验证纯逻辑/状态机/权限。
  - **agent-loop 单测**：`lib/agent-loop/*.test.mjs` — fake `LoopRuntime`（结构子集）注入，**零 SDK 依赖**。理由：node TS strip 模式无法解析 rpc-manager 的 parameter properties，静态 import 会挂。
  - **路由源码级断言**：`*-route.test.mjs` — `readFile` 断言路由源码含正确调用与错误码映射（薄路由不值得起 HTTP server）。
  - **组件渲染断言**：`components/*.test.mjs` — react-dom/server `renderToStaticMarkup` + jiti。
- **原则**：
  - 只测外部行为，不测实现细节；改动带回归测试是硬性要求（每个 ticket 携带修复 + 单测才算 resolved）。
  - 新增表/列必须带 `SCHEMA_VERSION` 版本号递增 + 迁移函数 + 老库兼容。
  - 全局 DB 用 `globalThis.__workspliceDb = openDataDb(tmp)` 直连，**不得**打开 `~/.worksplice/raft.db`（防污染真实数据）。

### 2.2 提交前门禁

每次提交/PR 前必须全绿：

1. `npm run typecheck`（= `tsc --noEmit`）
2. `npm run lint`（eslint，0 error）
3. `npm test`（全量基线）

**绝不**在开发期跑 `next build`（污染 `.next/` 且破坏 `npm run dev`）。发布构建走 `npm run release` 流程。

### 2.3 CI

- 当前 CI 状态：本地 gate 即 CI（发布见 `docs/release.md` 的 npm + GitHub Release 双通道）。
- 上 CI 平台时的最小集合：tsc → lint → 全量测试 → （仅 tag/release 时）`npm run build`。

## 3. 成本基线

- **基线数据与采集方式**：见 `docs/cost-monitoring-baseline.md`（BAI-5 实测：3 agent 的 token/成本 + `lib/session-stats.ts` 只读解析口径）。
- **成本敏感点**：LLM 调用（agent-loop 每轮 prompt / revision）、本地资源（SQLite、next dev server）。
- **已内置的节流**：
  - freshness-hold 重试有上限（revise 2 次 / resend 3 次），耗尽归 silent——不无限重试烧 token。
  - must-respond 连续失败 2 次 cap-ack 逃逸，防死循环空转。
  - busy-cwd 退避重试（`BUSY_CWD_RETRY_DELAY_MS`）防热自旋。
- **监控基线**：
  - 可观测页（`/api/members/[id]/observability`）看状态点 + 轮次记录（round_logs），`error`/`busy-cwd` 轮是排查入口。
  - 本地 SQLite 无显式配额；附件按文件落盘 `~/.worksplice/attachments/`，创建时校验 ≤50MB。
- **预算纪律**：LLM 成本异常（某 agent 频繁 revision/重试、超长会话）先自查再上报 CEO；新增 LLM 调用路径必须在代码注释里写明触发频率与成本上限。

## 4. 密钥管理

- **明文约定**：仓库 `.gitignore` 已排除 `.env*`。API key 走用户本地 `~/.pi/agent/models.json`（`auth/api-key` 路由管理，可启停），**绝不**写入代码、commit、日志或前端包。
- **HTTP Basic Auth**：`WORKSPLICE_PASSWORD` 保护 web 界面与全部 API（username `pi`）。明文不加密——**不得**把无 TLS 的 HTTP 暴露公网，走受信反向代理/VPN。
- **生产环境**（若上云）：密钥只放托管 secret 存储（环境变量 / secrets manager），权限最小化；代码库内任何位置出现真实 key 即视为事故，立即轮换并上报。
- **日志**：服务端日志不得包含 token、密钥、用户消息正文；排查用脱敏后重新打。

## 5. 流程纪律（日常）

- 每个 ticket 结束留可验证产物（修复 + 单测 + 文档），结论写进 `.scratch/<effort>/map.md` 的 Decisions-so-far。
- 改 agent-loop/driver/wake/backfill 等被 globalThis 闭包引用的模块后，**必须重启 dev server**（热重载不生效），并验证启动时间晚于改动。
- 术语/命名/决策变更：先更新 CONTEXT.md / ADR，再动代码。
