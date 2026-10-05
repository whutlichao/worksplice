# 01: 把 `.scratch/**` 从 ESLint 检查面排除

**What to build:** 在 `eslint.config.mjs` 的 flat config 数组里加一个**只含 `ignores` 键**的独立 config 对象，
把 `.scratch/**` 整体移出 lint 目标。理由：PR #86（commit `5df3501`）把 `.scratch/` 纳入版本库后，一次性带进
14 个旧 effort 的 295 个归档文件，`npm run lint` 凭空多出 6 条来自归档脚本的 warning；这种噪声随每个新 effort
线性增长，最终会让人习惯性忽略 lint 输出，等于门禁失效。

**Blocked by:** None — can start immediately.

**Type:** implementation

**Status:** claimed

- [ ] 红：改前 `npm run lint` = 7 problems，逐条列出 7 条落点
- [ ] 绿：改后 `npm run lint` = 1 problem，且是 `hooks/useI18n.tsx:61`，errors 仍为 0
- [ ] 护栏：改前改后 `eslint components lib hooks app scripts` 输出逐字一致
- [ ] 只改 `eslint.config.mjs`（+ 本票据），`git diff --numstat` 无四位数行
- [ ] `npm test` 全量 924 pass / 0 fail
- [ ] `npm run typecheck` 退出码 0
- [ ] 双轴 code-review（Standards + Spec 两份，不合并不重排）

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

（worker 施工中，完工后回填。）
