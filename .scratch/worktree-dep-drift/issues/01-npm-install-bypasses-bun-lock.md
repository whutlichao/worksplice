# 01: 新 worktree 里 agent 用 `npm install` 装依赖、绕过 `bun.lock`，制造假回归信号

**What to build:** 让「装依赖」这条路在新 worktree 里也走仓库的权威锁（`bun install`），并决定如何处置由此
暴露的 7 条 `react-hooks/preserve-manual-memoization`。**目标不是消灭那 7 条本身，而是让任何 worktree 里的
「改前基线 / 改后结果」可比、可信**——现在同一提交、两套依赖，门禁结论取决于谁装过什么。

## 事实（2026-10-06 实测，PR #90 一轮）

#### ① 同一提交、两套版本

| 环境 | eslint-plugin-react-hooks | react | eslint | 全仓 `npm run lint` |
| --- | --- | --- | --- | --- |
| `main`（bun 装的 node_modules，与 `bun.lock` 一致） | **7.0.1** | 19.2.4 | 9.39.4 | **1 problem**（0 err / 1 warn） |
| 新 worktree（装依赖之后） | **7.1.1** | 19.3.0 | 9.39.5 | **8 problems**（7 err / 1 warn） |

**② 7 条 errors 全在与任何在办票无关的文件上**：`components/ChatInput.tsx`（6 条）+
`hooks/useAgentSession.ts`（1 条），规则 `react-hooks/preserve-manual-memoization`
（"Compilation Skipped: Existing memoization could not be preserved"）；另 1 条 warning 是既有的
`hooks/useI18n.tsx:61`。

**③ 依赖边是 caret 范围**：`eslint-config-next@16.2.12` → `eslint-plugin-react-hooks: ^7.0.0`，
所以 `7.0.1 → 7.1.1` 是范围内的正常解析，不是谁写错了版本号。

#### ④ 归因（已取证，非推测）

- Orca 的「工作树钩子 → 设置脚本」内容是 **`codegraph init`**（用户 2026-10-06 截图确认）——**与依赖无关**；
- 真正执行安装的是 **worker 自己**：会话日志
  `~/.pi/agent/sessions/--Users-apple-orca-workspaces-worksplice-msg-actionbar-convert-task--/*.jsonl`
  里，bash 工具三次调用的原文均为 `cd <worktree> && npm install --no-audit --no-fund`，
  自述「npm install succeeded (716 packages, tsc available)」；
- 副产物吻合：该 worktree 里出现了被 `.gitignore` 忽略的 `package-lock.json`（`main` 里没有）。

**⑤ 为什么 agent 会选 npm**：仓库面向 agent 的文档通篇是 npm（`AGENTS.md:38` `npm run dev`、
typecheck/lint/test 也全是 `npm run …`），而 `README.md:68` 说可复现路径是 `bun install`、并明写
npm「ignores `bun.lock` and does not guarantee a reproducible dependency tree」。两条指引都真实存在，
agent 在空 worktree 里自然伸手去拿更"顺手"的那条。

**⑥ 为什么不怪 agent**：这不是某个 worker 的失误——**同一份文档喂给任何 agent 都会走到同一个选择**，
而且失败是静默的（装完照样能跑测试，只是版本变了）。

## 已验证的修法（本票实测）

干净 worktree 里跑 `bun install --frozen-lockfile`：

```text
1044 packages installed [7.93s]                                    # exit 0
eslint-plugin-react-hooks 7.0.1 / react 19.2.4 / eslint 9.39.4     # 与 main 逐字一致
（未生成 package-lock.json）
```

对照 `npm install`：7.1.1 / 19.3.0 / 9.39.5 + 生成 `package-lock.json`。⇒ 走 bun 即可消除漂移
（本机 `bun --version` = 1.3.14，满足 `README.md:68` 的 ≥1.3.14 要求）。

## 建议处置（triage 决定）

- **(a) 文档层（推荐；最小、已验证）**：在 `AGENTS.md` 的 Quick Start 里补一条安装纪律——
  「装依赖用 `bun install`（可 `--frozen-lockfile`）；不要 `npm install`，它忽略 `bun.lock`」。
  `npm run <script>` 本身无害（不改依赖树），可保留不动。
- **(b) 仓库级守卫（更硬，推荐与 (a) 一起做）**：`package.json` 加 `"packageManager": "bun@1.3.14"`，
  并加 `preinstall` 守卫脚本：检测到 `npm_*` 环境变量且 `bun.lock` 存在 → 直接失败并给出指引。
  理由：(a) 靠自觉，(b) 才挡得住下一个不知道这条纪律的 agent/人。
- **(c) 接受这次升级**：在 `main` 上显式升级 `eslint-config-next` / `eslint-plugin-react-hooks`，
  重生成 `bun.lock`，并**一次性处置**那 7 条（改掉两处手写 memo，或在 `eslint.config.mjs` 里就事论事地豁免）。
  代价：牵动两个与本次发现无关的文件。
- **兜底（无论选哪条都该保留）**：门禁基线必须**同依赖环境**取——`git worktree add` 一个 BASE 临时 worktree，
  把它的 `node_modules` 软链到**被测 worktree** 的那一份，再各跑一次 lint/tsc。

## 影响

1. **门禁基线不可比**：改前基线若取自 `main` 的旧 `node_modules`、改后取自 worktree，会得到
   「1 → 8 problems」这种假增量。本轮真的发生过——一度被读成「本票引入 7 条 lint 错误」，
   靠「同一 worktree 依赖环境下取改前/改后」才证伪。
2. **假回归信号会把人和 agent 引向错误方向**：reviewer 或后续 worker 可能去"修"这三处与在办票无关的既有代码。
3. **反向不可复现**：如果谁真在这套新插件下「修」了那 7 条，在 `main`（旧插件）上又看不到问题。

## 非目标

- 不在本票顺手改 `ChatInput.tsx` / `useAgentSession.ts` 的 memo 写法：改不改取决于 (c) 是否被选中。
- 不改 `README.md:68`：它描述的是事实，不是缺陷。
- 不把 Orca 的设置脚本当缺陷：它是 `codegraph init`，与依赖无关（见 ④）。

**Blocked by:** None — 需要的是 triage 裁决，不是前置工作。
**Type:** implementation
**Status:** needs-triage

## Comments

- 2026-10-06 由 coordinator 在收口 PR #90 时提交（该轮验收报告
  `~/.pi/agent/projects-memory/worksplice/orchestra/2026-10-06-msg-actionbar-convert-task.md` §4.2 记录同一发现）。
- 2026-10-06 **更正归因**：初版把责任判给「Orca 的 worktree setup 跑 npm install」——**错**。
  用户给出设置脚本截图（内容为 `codegraph init`）后，改按会话日志取证，判为「agent 自己跑了
  `npm install`」。保留这条更正记录：这类漂移最容易被误判成基础设施问题，而正确的第一步是查**谁真的执行了安装**。
- 2026-10-06 补测：`bun install --frozen-lockfile` 在干净 worktree 里产出与 `main` 完全一致的版本
  （7.0.1 / 19.2.4 / 9.39.4），据此把 (a) 从"推测"升为"已验证"。
