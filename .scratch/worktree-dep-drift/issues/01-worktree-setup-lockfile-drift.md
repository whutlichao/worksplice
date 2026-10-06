# 01: worktree 的 setup 用 npm 装依赖、绕过 `bun.lock`，导致门禁基线不可比

**What to build:** 消除「同一提交、两套依赖版本」这个门禁级的不确定性——决定 worktree setup 该走哪条安装路径，
并处置由此暴露的 7 条 `react-hooks/preserve-manual-memoization` 错误（修掉或显式豁免），让「改前基线 / 改后结果」
在任何 worktree 里都可比。

## 事实（2026-10-06 实测，PR #90 一轮）

| 环境 | eslint-plugin-react-hooks | react | eslint | 全仓 `npm run lint` |
| --- | --- | --- | --- | --- |
| `main`（node_modules 为 bun 装，与 `bun.lock` 一致） | **7.0.1** | 19.2.4 | 9.39.4 | **1 problem**（0 err / 1 warn） |
| 新 worktree（`worker-start --setup run` 之后） | **7.1.1** | 19.3.0 | 9.39.5 | **8 problems**（7 err / 1 warn） |

三条证据把因果锁死：

1. **7 条 errors 全在本票没碰过的文件**：`components/ChatInput.tsx`（6 条）+ `hooks/useAgentSession.ts`（1 条），
   规则 `react-hooks/preserve-manual-memoization`（"Compilation Skipped: Existing memoization could not be preserved"）；
   另一条 warning 是既有的 `hooks/useI18n.tsx:61`。
2. **依赖边是 caret 范围**：`eslint-config-next@16.2.12` → `eslint-plugin-react-hooks: ^7.0.0`，
   所以 `7.0.1 → 7.1.1` 是范围内的正常解析，不是谁写错了版本号。
3. **新 worktree 里出现了被 `.gitignore` 忽略的 `package-lock.json`**（`main` 里没有），
   且该 worktree 的 `bun.lock` 未被重新生成 ⇒ worktree 的 setup 跑的是 **`npm install`**。
   仓库自己早就写明风险——`README.md:68`：「This repository tracks `bun.lock`, so `bun install` is the
   reproducible path; `npm install` also works, but it ignores `bun.lock` and does not guarantee a
   reproducible dependency tree.」

复现命令（任一含 `bun.lock` 的 checkout）：

```bash
git worktree add --detach /tmp/wt HEAD && cd /tmp/wt   # 新 worktree
npm install                                            # 复刻 setup 的安装路径（会生成 package-lock.json）
node -e "console.log(require('eslint-plugin-react-hooks/package.json').version)"  # → 7.1.1
./node_modules/.bin/eslint components/ChatInput.tsx    # → 6 条 preserve-manual-memoization
```

**setup hook 的来源尚未定位**（仓库无 `orca.yaml`、`package.json` 里没有 `scripts.setup`、
Orca profile 设置里也没有 setup command）——这是本票的第一个待答问题：它是 Orca 的包管理器自动探测，
还是 GUI 里的每仓库设置？

## 影响

1. **门禁基线不可比**：改前基线若取自 `main` 的旧 `node_modules`、改后取自 worktree，会得到
   「1 → 8 problems」这种假增量。本轮就真的发生过——一度被读成「本票引入 7 条 lint 错误」，
   靠「同一 worktree 依赖环境下取改前/改后」才证伪。
2. **假回归信号会把人和 agent 引向错误方向**：reviewer 或后续 worker 可能去"修"这三处
   **与任何在办票都无关**的既有代码。
3. **反向不可复现**：如果谁真在这套新插件下「修」了那 7 条，在 `main` 上（旧插件）又看不到问题，
   结论无法在仓库的权威环境里复现。

## 建议处置（triage 决定，三选一 + 一条兜底）

- **(a) 让 worktree setup 走 `bun install`（推荐，最小改动）**：漂移消失，`main` 与 worktree 回到同一套版本；
  7 条 finding 保持"旧插件下不存在"的现状，不必现在动。
- **(b) 接受这次升级**：在 `main` 上显式升级 `eslint-config-next` / `eslint-plugin-react-hooks`，
  重生成 `bun.lock`，并**一次性处置**这 7 条（要么改掉 `ChatInput.tsx` / `useAgentSession.ts` 的手写 memo，
  要么在 `eslint.config.mjs` 里就事论事地说明豁免范围）——代价是它会牵动两个与本次发现无关的文件的改动。
- **(c) 固定安装器为唯一路径**：在文档/CI/`package.json` 的 `packageManager` 字段上写死 bun，
  并让 `npm install` 在该仓库明确失败或警告。
- **兜底（无论选哪条，都该保留）**：门禁基线必须**同依赖环境**取——`git worktree add` 一个 BASE 临时 worktree，
  把它的 `node_modules` 软链到**被测 worktree** 的那一份，再各跑一次 lint/tsc。

## 非目标

- 不在本票顺手改 `ChatInput.tsx` / `useAgentSession.ts` 的 memo 写法：改不改取决于上面 (a)/(b) 的裁决，
  先改代码等于先选定了 (b)。
- 不在本票动 `README.md:68` 那段说明：它描述的是事实，不是缺陷。

**Blocked by:** None — 需要的是 triage 裁决，不是前置工作。
**Type:** implementation
**Status:** needs-triage

## Comments

- 2026-10-06 由 coordinator 在收口 PR #90 时提交（该轮验收报告
  `~/.pi/agent/projects-memory/worksplice/orchestra/2026-10-06-msg-actionbar-convert-task.md` §4.2 记录同一发现）。
  本轮没有改动任何源码：本票只是把「依赖漂移 + 被它照出来的 7 条 finding」立成可裁决的票据。
