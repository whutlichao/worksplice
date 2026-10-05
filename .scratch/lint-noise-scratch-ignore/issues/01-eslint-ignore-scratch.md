# 01: 把 `.scratch/**` 从 ESLint 检查面排除

**What to build:** 在 `eslint.config.mjs` 的 flat config 数组里加一个**只含 `ignores` 键**的独立 config 对象，
把 `.scratch/**` 整体移出 lint 目标。理由：PR #86（commit `5df3501`）把 `.scratch/` 纳入版本库后，一次性带进
14 个旧 effort 的 295 个归档文件，`npm run lint` 凭空多出 6 条来自归档脚本的 warning；这种噪声随每个新 effort
线性增长，最终会让人习惯性忽略 lint 输出，等于门禁失效。

**Blocked by:** None — can start immediately.

**Type:** implementation

**Status:** resolved

- [x] 红：改前 `npm run lint` = 7 problems，逐条列出 7 条落点
- [x] 绿：改后 `npm run lint` = 1 problem，且是 `hooks/useI18n.tsx:61`，errors 仍为 0
- [x] 护栏：改前改后 `eslint components lib hooks app scripts` 输出逐字一致
- [x] 只改 `eslint.config.mjs`（+ 本票据），`git diff --numstat` 无四位数行
- [x] `npm test` 全量 924 pass / 0 fail
- [x] `npm run typecheck` 退出码 0
- [x] 双轴 code-review（Standards + Spec 两份，不合并不重排）

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。
- 本票**只许改 `eslint.config.mjs`**：不改 `rules` 段、不改任何源码、不改 `.gitignore`（`.scratch/` 仍需入库）。
- ignore 必须精确（`.scratch/**`），**不得**扩成 `**/*.mjs` / `evidence/**` / `**/abandoned-*` 之类宽泛规则，
  **不得**顺手压制 `hooks/useI18n.tsx:61` 那条真源码既有 warning。
- **不要跑 `next build`**（污染 `.next/` 并破坏 dev server）。

## 取舍记录（本票的「非目标」）

- `hooks/useI18n.tsx:61` 的 `react-hooks/exhaustive-deps` 是真源码既有问题，处置它不在本票范围，另开票。
- `.scratch/` 里若将来出现真正的活代码（会被 `next build` / `tsc` 吃到的那种），那时该单独把它移出
  `.scratch/` 或单点解禁，而不是放宽本条 ignore。

## Answer

**PR:** https://github.com/whutlichao/worksplice/pull/89
**分支:** `whutlichao/lint-noise-scratch-ignore` · **提交:** `314559a` + 收敛提交（票据 Status/Answer）

### 改了什么

`eslint.config.mjs` 加一个只含 `ignores` 键的独立 config 对象（ESLint v9 的全局 ignore 形状），
`git diff --numstat` = **5 insertions / 0 deletions**。`rules` 段未动，`.gitignore` 未动（`.scratch/` 仍入库），
源码零改动。

### 红（改前）

`npm run lint` → `✖ 7 problems (0 errors, 7 warnings)`，7 条逐条落点：

| # | 文件 | 行:列 | 规则 |
|---|---|---|---|
| 1 | `.scratch/architecture-improvements/abandoned-rpc-split/lib-rpc/registry.ts` | `3:15` | `@typescript-eslint/no-unused-vars`（`ThinkingLevel`） |
| 2 | 同上 | `6:10` | `@typescript-eslint/no-unused-vars`（`invalidateSessionListCache`） |
| 3 | `.scratch/promote-worksplice/evidence/screencast-v2/capture-scripts/demo-add-cards.mjs` | `69:7` | `@typescript-eslint/no-unused-vars`（`out`） |
| 4 | `.scratch/promote-worksplice/evidence/screencast-v2/capture-scripts/demo-align-cuts.mjs` | `15:9` | `@typescript-eslint/no-unused-vars`（`i`） |
| 5 | `.scratch/promote-worksplice/evidence/screencast-v2/verify-f03-bracket.mjs` | `51:7` | `@typescript-eslint/no-unused-vars`（`CROP_SEAT_X`） |
| 6 | 同上 | `66:7` | `@typescript-eslint/no-unused-vars`（`H`） |
| 7 | `hooks/useI18n.tsx` | `61:6` | `react-hooks/exhaustive-deps` ← **真源码既有，不属本票** |

### 绿（改后）

```
$ npm run lint
/Users/apple/orca/workspaces/worksplice/lint-noise-scratch-ignore/hooks/useI18n.tsx
  61:6  warning  React Hook useEffect has a missing dependency: 'locale'. Either include it or remove the dependency array  react-hooks/exhaustive-deps

✖ 1 problem (0 errors, 1 warning)
```

余下那 1 条正是 `hooks/useI18n.tsx:61`。**errors 仍为 0**（ignore 没写错）。

### 护栏：过度忽略的机械对照

`./node_modules/.bin/eslint components lib hooks app scripts`，改前 / 改后：

```
/Users/apple/orca/workspaces/worksplice/lint-noise-scratch-ignore/hooks/useI18n.tsx
  61:6  warning  React Hook useEffect has a missing dependency: 'locale'. Either include it or remove the dependency array  react-hooks/exhaustive-deps

✖ 1 problem (0 errors, 1 warning)
```

```
$ diff /tmp/guard-before.txt /tmp/guard-after.txt   # 无输出
$ shasum -a 256 /tmp/guard-{before,after}.txt
bf18183f637b43b1d2012ac0b34780e9b8f0939a73b74a196d6a79a70a4fa859  /tmp/guard-before.txt
bf18183f637b43b1d2012ac0b34780e9b8f0939a73b74a196d6a79a70a4fa859  /tmp/guard-after.txt
```

**逐字一致**（同一 sha256）。

改前基线取自本 worktree 改动前的干净工作区（`git status --porcelain` 空），不是 main 工作区；回退用
`git checkout HEAD -- eslint.config.mjs` 单文件、跑一次、再恢复。

### 护栏加码：留面文件集逐个核对

比「输出逐字一致」更强的一层——直接比对改前/改后的 **lint 目标文件集**（`eslint . -f json`，各跑一次，
改前那次用单文件 checkout 临时回退 config 取得）：

| 指标 | 改前 | 改后 |
|---|---|---|
| 被 lint 的文件总数 | 394 | 375 |
| 离开 lint 面的文件 | — | **19** |
| 其中落在 `.scratch/` **之外**的 | — | **0** |
| 新进 lint 面的文件 | — | **0** |
| `components/lib/hooks/app/scripts` 下的真源码 | **364** | **364**（未变） |

即：唯一变化是 19 个 `.scratch/` 文件离开检查面，真源码留面数一个没少。旁证——
`find .scratch -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' \) | wc -l` = **19**，
与「离开 lint 面的文件数」精确吻合。

### 护栏再加码：`.scratch/` 从来就不在类型检查面

```
$ ./node_modules/.bin/tsc --noEmit --listFiles | grep -c '/\.scratch/'
0
```

TypeScript 的 `include` 通配符（`**/*.ts`）**不匹配点开头的目录**，所以 `.scratch/` 从来没进过 tsc 面，
自然也没进过 `next build` 的面。**这条 ignore 移除的 lint 覆盖面，与构建/类型检查覆盖面零重叠**——
不存在「ignore 顺手把构建要吃的东西也从检查面拿掉」的可能。

另：全仓 grep 确认**没有任何源码 import/require `.scratch`**（命中只有 3 处注释引用：
`next.config.ts:25`、`lib/build-env.d.ts:9`、`lib/i18n/format.test.mjs:46`），`package.json` 的 `files`
白名单也不含 `.scratch`。

### 测试档 = 宽档（无条件全量）

本票改的是构建/lint 配置，影响面无法靠文件相邻关系圈定，故跑全量：

```
$ npm test
ℹ tests 924
ℹ pass 924
ℹ fail 0
```

**924 pass / 0 fail**，与 main 当前基线一致。全量的第二个目的（证明没把真问题藏进 ignore）已达成：
上面三张表已把「藏了什么」这件事证伪到文件级。

```
$ npm run typecheck   # tsc --noEmit
TYPECHECK_EXIT=0
```

未跑 `next build`（会污染 `.next/` 并破坏 dev server）。未跑任何 `prettier --write` / `oxlint --fix` /
`biome --write` / `eslint --fix`。本地 `.pi-lens.json` 已写入并加入 `.git/info/exclude`，不进仓库。

### 双轴 code-review（Standards / Spec 两份独立报告）

两个 fresh-context 只读 reviewer 并行跑（`reviewer` agent，基线 `84720b6`，diff `84720b6...HEAD`）。

#### Standards 轴

- **代码 hunk：无违规。** ignore 精确性经独立核验（全仓 grep 无源码 import `.scratch`；`package.json` 的
  `files` 白名单不含 `.scratch`；写法为「仅含 `ignores` 键的对象」，若并进 `rules` 块会静默失效——第 3 行
  注释正是在防这个坑）。注释风格符合 `docs/engineering-standards.md`「注释一律简体中文」，与 `next.config.ts`
  的「讲 why + 指向，不复述代码」惯例一致。Fowler 12 项 smell 对单行配置对象均不适用。
- **Finding P1｜票据未收口**：`Status: claimed` + `## Answer` 仍是占位，违反
  `docs/agents/issue-tracker.md:30` 与 AGENTS.md「worker 全权负责 Status 流转」。
  → **已处置**：本提交即收敛（`Status: resolved` + 完整 Answer + 验收清单全勾）。
- **Finding P2｜`Type: implementation` 不在 issue-tracker.md:26 的枚举内** → **豁免（有据）**：
  该行位于「**路径导航操作**——由 `/wayfinder` 使用」小节，其枚举管的是 wayfinder 的 ticket 集，不是所有
  effort 的 issues；仓库既有票据已有 2 张用 `Type: implementation`
  （`.scratch/thread-message-actions/issues/02-*.md`）。仓库实践优先于该条对 wayfinder 场景的约定。
- **Finding P2｜缺 `map.md`** → **豁免（有据）**：同上，`map.md` 是 wayfinder 的产物；17 个 effort 目录里
  11 个没有 `map.md`，含最近一个 effort `thread-message-actions`。本票单票据、非 wayfinder。
- **Finding P2｜缺 `spec.md`** → **豁免（有据）**：17 个 effort 目录里 9 个没有 `spec.md`
  （`i18n-process-fix`、`worksplice-build`、`unread-badge-fix` 等）。本 effort 的「spec」就是 dispatch 里那份
  已写全的票据说明，无 PRD 可写；硬造一份是噪声。
- **Finding P2｜7 项验收清单全为 `- [ ]`** → **已处置**：本提交全部勾上。
- **P2 观察｜「tsconfig `**/*.ts` 仍覆盖 `.scratch/**/*.ts`，lint 面已排除、typecheck 面未排除」**
  → **证伪（reviewer 判断有误）**：该结论与实测不符。`tsc --noEmit --listFiles | grep -c '/\.scratch/'` = **0**
  （TypeScript 通配符不匹配点开头目录），而同目录下 `find` 实测存在 5 个
  `.scratch/architecture-improvements/abandoned-rpc-split/lib-rpc/*.ts`。即 `.scratch/` 从来就不在 tsc 面，
  不存在「lint 面与 typecheck 面不对齐」需要另开票的问题。（reviewer 很可能被 worktree 路径名
  `lint-noise-scratch-ignore` 里的 `scratch` 子串误导。）
- **Merge verdict**：代码 OK；票据流程 BLOCK（P1）→ 已处置。

#### Spec 轴

- **(a) 缺失/部分实现：无。** `{ ignores: [".scratch/**"] }` 精确为独立对象、键唯一，符合「只含 `ignores` 键」。
  独立实测 `.scratch` 下可 lint 文件数 = **19**，与「394 → 375，19 个全在 `.scratch/`」完全对齐；红档 6 条告警
  落点全部落在这 19 个文件内，不是真源码。`hooks/useI18n.tsx:61` 逐行核对确为空依赖数组 `}, []);`，护栏那条
  落点准确。`.gitignore` 无 `.scratch` 条目（约束 1 的「`.scratch/` 仍需入库」成立）。
- **(b) 越界改动：无。** diff 未触碰 `rules` 段、未加第二条 ignore、未改任何源码；未出现 `**/*.mjs`、
  `evidence/**`、`**/abandoned-*` 等宽泛模式（Constraint 2）。
- **(c) 实现是否错误：无。** `.scratch/**` 含斜杠，flat config 中锚定 basePath，只匹配顶层 `.scratch/` 下，
  不覆盖嵌套 `.scratch`，也不影响 `scripts/`、`lib/`；`lint` 脚本为 `eslint .`，全局 ignore 生效路径完整。
- **残余风险（report-only，非本 diff 造成）**：`.scratch/bootstrap-agent-build/manual/*.test.mjs` 本就不在
  `npm test` 的 glob（`lib|app|components|hooks/**/*.test.mjs`）内，改动前后都不参与测试，非本次回归。
- **结论：No issues found（零发现）。**

两轴不合并、不重排：Standards 轴 1 条硬发现（票据未收口，已修）+ 3 条有据豁免 + 1 条证伪；Spec 轴零发现。

### Further Notes（留给后续，不在本票动手）

1. **`hooks/useI18n.tsx:61` 的 `react-hooks/exhaustive-deps` 建议另开票。** 它是真源码的既有问题：effect 里
   用了 `locale` 却把依赖数组写成 `[]`，切语言时闭包可能拿旧值。本票明确不处置（Constraint 2/5）。
2. **本 ignore 的有效期依赖 `.scratch/` 的定位不变。** 若将来 `.scratch/` 里出现会被 `tsc` / `next build`
   吃到的活代码，正确做法是把它移出 `.scratch/` 或单点解禁，而不是放宽这条 ignore。
   （当前实测：`.scratch/` 不在 tsc 面，也无源码 import 它，所以这条 ignore 至今零构建覆盖面。）
3. **`npm run lint` 目前仍是红的**（exit 0 但有 1 条 warning）。这是刻意的：留着它当噪声探测器，
   等第 1 条另开票修掉。
4. **`.gitignore` 未动的副作用**（本票范围外，知情不处理）：`.scratch/` 入库后，每个新 effort 的归档文件
   都会进 git 历史，仓库体积会持续增长。若要治，得另开一票谈历史重写或 `.scratch/` 的归档策略。
