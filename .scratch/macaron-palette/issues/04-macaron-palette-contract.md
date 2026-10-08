# 04: 马卡龙契约收口（contract）

**What to build:** 新契约成为唯一事实来源——没人再引用退役的旧档位，仓库里有一道**机械断言**守住对比度下限（以后谁把马卡龙亮档当文字色或状态点用，测试立刻红），四份设计文档与代码说的是同一件事。

**Blocked by:** 03（等它合入 main 后，从**新的 origin/main** 切本票 worktree）

**Status:** ready-for-agent

- [ ] 清掉不再被引用的旧档位（`--accent-line`；以实际引用计数为准，若仍有引用则不能清并须在 Answer 说明）
- [ ] 新增 `app/globals.contrast.test.mjs`：把 spec 的两张表（族 × 档位矩阵、配对实测值）与 ΔL 可见性落成机械断言
- [ ] **双向对照**：新断言在票 02 之前的色值上必须**红**（证明断言不是空转），在收口后的色值上绿
- [ ] 同步 `worksplice-design-system/DESIGN.md`（色板 / 语义色 / 头像三段）、`SKILL.md`（§4 的 on-accent 措辞、§7 的 token 名条款）、`AGENTS.md` 的 CSS 变量段（顺手对齐 ADR-0014 遗留的旧 token 名漂移）、`docs/spec.md` §4 整节
- [ ] `npm test` 全绿（本票新增了测试，属 G-impl「宽」档：影响面是全局色板契约）+ `npm run typecheck` / `npm run lint` 增量零新增
- [ ] 双轴 code-review（Standards + Spec）+ Answer 小节
- [ ] 推分支 + `gh pr create`，PR 号回填 Answer
