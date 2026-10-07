# 01: 设计票 —— agent 状态点的错误恢复（换模型 ⇒ 模型探测 ⇒ 状态收敛）

**What to build:** 把用户报告（agent 因模型调用额度耗尽进入 `error`，换模型后状态点仍红）收敛成一份可实施的设计决策，
落 `.scratch/agent-status-recovery/spec.md`（本 effort 唯一正本，二级标题恰好七节、顺序照仓库 effort 模板）。
需要收敛的 8 个决策点逐条有结论或显式进 Out of Scope；术语决议 inline 落 `CONTEXT.md`；
ADR 三条件逐条判定后决定建或不建。**源码零改动**——机械判据：
`git diff <base> HEAD --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'` 输出为空。

**Blocked by:** None — can start immediately.

**Type:** design

**Status:** in-progress

- [ ] 读前置 skill 全文（`grill-with-docs` → `grilling` + `domain-modeling`）
- [ ] 复核现状事实（状态点两来源 / error 清除触发点 / runtime 保存路径 / 现成探测机制），逐条落进 Problem Statement 与 Further Notes
- [ ] grill 第 1 轮（根决策）：触发面 / 恢复形态 / 原因可见性 / 已死会话适用范围
- [ ] grill 第 2 轮（推论）：探测期间呈现 / 探测用哪个模型 / 失败语义与回滚 / 并发重复触发 / 契约与 ADR
- [ ] `.scratch/agent-status-recovery/spec.md`：7 节结构完整，8 个决策点逐条有结论，全文无「待定 / TBD」
- [ ] `CONTEXT.md`：术语决议 inline（或写明无术语变更 + 理由）
- [ ] ADR 判定：三条件逐条给判定；建则 `docs/adr/00NN-*.md`，不建则写明第几条不满足
- [ ] 机械判据取证：源码改动面为空 + `git status --porcelain` 空
- [ ] Answer：写明本票为设计票、测试 / 双轴 review / 浏览器证据不适用 + 理由
- [ ] 推分支 + `gh pr create`，PR 号回填 Answer

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。
- 本票不跑：测试（无被测对象）、双轴 code-review（审的是 diff，本票 diff 是文档）、浏览器几何证据（无渲染改动）。
