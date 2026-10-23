# Answer：中文界面 agent 生命周期按钮本地化

## 结果

agent 详情 dock 底部的三个生命周期按钮及两条直接提示在中文界面下已显示中文：重启 / 会话重置 / 完整重置。根因是 `lib/i18n/messages/zh-CN.ts` 中这几个词条的值本身就是英文；组件已正确走 `t()`，无需改动。

## 根因与实现

`components/AgentDetailPanel.tsx` 通过 `t("agent.restart")` 等键渲染按钮，`en.ts` 与 `zh-CN.ts` 键集相同、值不同；zh-CN 包中这 5 条值直接复制了英文，因此中文界面回落显示英文。

改动仅两处：

- `lib/i18n/messages/zh-CN.ts`：`agent.restart` → 重启、`agent.sessionReset` → 会话重置、`agent.fullReset` → 完整重置、`agent.fullResetSharedHint` → 当前绑定共享项目目录，完整重置不可用（请用会话重置）、`agent.stoppedHint` → 离线 = 已停止响应，身份仍在；可随时重启激活。术语取 `GLOSSARY.md` 的「会话重置（Session Reset）」「完整重置（Full Reset）」，未另造译名。
- `lib/i18n/messages.test.mjs`：新增 `agent lifecycle labels are localized in zh-CN`，逐键断言中文值且不含 `Restart` / `Session reset` / `Full reset` 字面量。

`en.ts`、组件、运行时、接口、构建与类型均未改动；未扩大范围翻译 `role.owner` / `runtime.provider` 等其它词条。

## 红绿与门禁

红证据在隔离副本取得：把 `lib/i18n` 复制到 `/tmp/red-i18n-check`，用 `git show HEAD:lib/i18n/messages/zh-CN.ts` 覆盖为旧文案后运行新测试，断言失败：

```text
✖ agent lifecycle labels are localized in zh-CN
  AssertionError: agent.restart 应为中文文案 — 'Restart' !== '重启'
```

工作区未做任何还原，最终 diff 无残留。

| 检查 | Base（旧 zh-CN） | 修改后 |
| --- | --- | --- |
| `node --test lib/i18n/messages.test.mjs components/AgentDetailPanel.test.mjs components/DetailPanel.test.mjs` | 新断言 1 fail | 52 pass / 0 fail |
| `npm run typecheck` | — | 通过（`tsc --noEmit`，exit 0） |
| `git diff --stat` | — | 2 files, +28 / -5，无格式化噪声 |

依赖按仓库纪律用 `bun install --frozen-lockfile` 安装（worktree 初始无 `node_modules`）；`node_modules` 未进入版本控制。未运行全量 `npm test`、`next build` 及宽档集成测试（按本票测试档约定）。

## Review 档

本票为纯文案改动：2 个文件、5 条 zh-CN 值 + 1 条断言，影响面可圈定，不触达共享接口 / 构建 / 类型。按 SKILL §3 省略双轴 code-review，理由即此。

## 交付状态

- 分支：`i18n-agent-lifecycle-zh`
- 实现提交：`704ed91 fix(i18n): 中文界面 agent 生命周期按钮改用中文术语`
- 改动文件：`lib/i18n/messages/zh-CN.ts`、`lib/i18n/messages.test.mjs`
- PR：#204（https://github.com/whutlichao/worksplice/pull/204）
- PR body：`.scratch/i18n-agent-lifecycle-zh/pr-body.md`
- 本 Answer：`.scratch/i18n-agent-lifecycle-zh/Answer.md`
