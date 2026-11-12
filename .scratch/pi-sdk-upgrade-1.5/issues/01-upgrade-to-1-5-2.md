# 01: 升级 pi SDK 到 1.5.2（四包原子升级 + 三处代码改动 + 15 项实跑验证）

**Spec:** [spec.md](../spec.md)

**Type:** task

**Status:** ready-for-agent

**Blocked by:** None — can start immediately.

## What to build

把四个 `@earendil-works/pi-*` 包从 `0.99.2` **一步**升到 `1.5.2`（`bun.lock` 一次重算，
`node_modules` 清空重装），同时把升级必然带来的三处代码改动改掉——三处性质各不相同：
grep 上下文行的读拦截**静默失效**（必须新写断言守着）、导出 HTML 的补丁块**要删掉**
（上游已内置同等实现）、theme-schema 测试路径**要改读新位置**。

判据是「装上了但行为不对」不算完成：四包在 `package.json` 与 `bun.lock` 里必须只有一套版本，
`bun.lock` 里 `@earendil-works/chord` 消失、`@earendil-works/pi-schema` 出现、`undici` 只剩一条，
并且评估文档 §10.2 的 15 项验证（V3 / V7 / V8 为本轮特有）逐项跑过并记录结果。

## Acceptance

- [ ] 四包在 `package.json` 精确 pin 为 `1.5.2`；`undici` 对齐 `8.12.3`；`bun install` 后
      `bun.lock` 复核四条机械判据全中（无 `0.99.2` 残留、`chord` 为 0、`pi-schema` ≥ 1、
      `undici` 顶层条目为 1），读数贴进 `## Answer`。
- [ ] `node_modules` 是清空后重装的树（旧嵌套布局不留），且未跑 `next build` 污染 `.next/`。
- [ ] **R1 先红后绿**：新增断言「允许根内的符号链接指向根外 + `grep` 带 `context` ⇒ 根外内容不出现」，
      **在改代码之前先观察到它红**（红输出留证），修完转绿；同时补一条反向断言
      「搜索根在允许根之外仍被拒」。
- [ ] **R4 先红后绿**：升级后 `/api/sessions/[id]/export` 先返回 500（`replaceRequired` 的锚点
      命中数 !== 1，留响应体），删掉补丁块后返回 200 且导出文件能在浏览器打开。
- [ ] theme-schema 测试改读 `schemas/theme.schema.json`，断言内容（51 项 `required`）不动，用例转绿。
- [ ] `tsc --noEmit` 与 `npm run lint` 的读数与升级前基线对照（只记本票引入的新增问题）。
- [ ] `npm test` 全量与升级前基线对照：本仓既存的环境相关红（`lib/model-listing.test.mjs` 里读真实
      `~/.pi/agent/models.json` 的用例）不计入本票失败。
- [ ] 15 项验证逐项有结果（通过 / 未通过 / 未跑及原因），V3 / V7 / V8 三项不得写「未跑」。
- [ ] `next.config.ts` 零 diff；构建后 `.next/server` 内不出现 `@earendil-works/pi-schema`（探针读数留证）。
- [ ] R2（成本口径）/ R3（`enabledModels` 歧义）/ trust 语义分歧三处**不改代码**，只在 `## Answer`
      记下观察结果与对外说明的落点。
- [ ] 使用 Azure 的实例所需的配置迁移（`azure-openai-responses` → `azure`）写进 `## Answer` 的
      「升级后运维动作」一节。

## Out of scope（本票明确不做）

- 不评估 `1.5.2` 之后的版本。
- 不为 `pi-ai` / `pi-tui` / `pi-agent-core` 做完整差异审计（只到本仓用到的符号层）。
- 不重构 `lib/pi-types.ts` 的 `AgentSessionLike` 镜像；不改 `lib/http-dispatcher.ts`；
  不改 `lib/project-trust.ts`；不碰 `next.config.ts`。
- 不把 15 项实跑全部固化成自动用例（只有 R1 / R4 / theme-schema 三处新增或修改断言）。
- 不更新 `docs/pi-sdk-upgrade-1.5-assessment.md` 与更早那份评估（历史记录不回填）。
- 不做分段升级。

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`
  （或按失败情形流转，并在 `## Answer` 写明）。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。
- 本票**跑**：`npm test` / `tsc --noEmit` / `npm run lint` / 15 项实跑 / 双轴 code-review
  （改了源码，双轴适用）。固定点 = 本票的 base commit。
- R1 与 R4 的**红**必须先于修法出现。没有红证据的「我判断它会红」不算。
