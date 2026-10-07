# 01: 设计票 —— agent 状态点的错误恢复（换模型 ⇒ 模型探测 ⇒ 状态收敛）

**What to build:** 把用户报告（agent 因模型调用额度耗尽进入 `error`，换模型后状态点仍红）收敛成一份可实施的设计决策，
落 `.scratch/agent-status-recovery/spec.md`（本 effort 唯一正本，二级标题恰好七节、顺序照仓库 effort 模板）。
需要收敛的 8 个决策点逐条有结论或显式进 Out of Scope；术语决议 inline 落 `CONTEXT.md`；
ADR 三条件逐条判定后决定建或不建。**源码零改动**——机械判据：
`git diff <base> HEAD --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'` 输出为空。

**Blocked by:** None — can start immediately.

**Type:** design

**Status:** resolved

- [x] 读前置 skill 全文（`grill-with-docs` → `grilling` + `domain-modeling`）
- [x] 复核现状事实（状态点两来源 / error 清除触发点 / runtime 保存路径 / 现成探测机制），逐条落进 Problem Statement 与 Further Notes
      （7 条 F1–F7，每条附源码位置）
- [x] grill 第 1 轮（根决策）：触发面 (i) / 恢复形态 (b) 真探测 / 原因可见性 (i) 不加常驻展示面 / 已死会话 (i) 同样清
- [x] grill 第 2 轮（推论）：清空覆盖 (a) 不入触发面（用代码事实推翻第 1 轮那半句）/ 触发谓词 (b)
      「保存后存在覆盖对 ∧ 保存前 error」/ 探测期间 (i) 保持不变 / ADR 不建；5 条细节逐条获确认
- [x] `.scratch/agent-status-recovery/spec.md`：7 节结构完整，8 个决策点逐条有结论，全文无「待定 / TBD」
- [x] `CONTEXT.md`：术语决议 inline（新增「状态点」「模型探测」「错误恢复」三条，含 `_Avoid_` 行）
- [x] ADR 判定：三条件逐条给判定（① 难以反转 不满足 ⇒ 不建；② ③ 满足但不构成充分条件）
- [x] 机械判据取证：源码改动面为空 + `git status --porcelain` 空（见 Answer）
- [x] Answer：写明本票为设计票、测试 / 双轴 review / 浏览器证据不适用 + 理由
- [x] 推分支 + `gh pr create` → PR #104，号已回填 Answer

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。
- 本票不跑：测试（无被测对象）、双轴 code-review（审的是 diff，本票 diff 是文档）、浏览器几何证据（无渲染改动）。

## Answer

**结论**：本票为设计票，按门禁 **G-docs** 收口。交付物 = `.scratch/agent-status-recovery/spec.md`
（唯一正本，二级标题恰好七节：Problem Statement / Solution / User Stories / Implementation Decisions /
Testing Decisions / Out of Scope / Further Notes）+ `CONTEXT.md` 的术语决议 inline 更新。
**源码改动面为零**；测试 / 双轴 code-review / 浏览器几何证据三项逐条不适用（理由见下）。
分支 `whutlichao/agent-status-recovery`，**PR #104**。

### 8 个决策点的裁定（两轮 `orchestration ask`；决策类全部 ask 回来，无编造）

| # | 决策点 | 结论（出处：spec.md 对应条目） |
| --- | --- | --- |
| 1 | 触发面 | 只认 per-agent runtime 保存；谓词 =**保存后存在覆盖对 ∧ 保存前处于 `error`**（与「改了什么字段」无关）；全局配置变更、清空覆盖、非 error 语境都不触发（决策 1） |
| 2 | 恢复形态 | **真连通性探测**（复用 models-config 面板的 `completeSimple` 机制，`maxTokens: 16` / `maxRetries: 0` / 20s；不落 session、不进历史、不唤醒 loop、不写 `round_logs`）（决策 2） |
| 3 | 探测期间与结果的呈现 | 四态不变；探测期间状态点**保持不变**（`working` 会被现场推导覆盖成 `online` ⇒ 假绿窗口）；通过 ∧ 会话存活 → `online`，通过 ∧ 无存活会话 → `offline`，不通过 → 保持 `error`（决策 3） |
| 4 | 失败语义与原因可见性 | 保持 `error`、不写状态点；失败原因**就地回该次交互**，不落库、不做历史；不加常驻展示面（决策 4） |
| 5 | 探测用哪个模型 | 刚保存的覆盖对；解析走**与会话启动同一条路**（`loadModelListingServices` → `resolveVisibleModels` → `selectInitialModelScope`）；解析失败 ⇒ 不调用、保持 error、原因回面板（决策 5） |
| 6 | 会话与探测的关系 | 纯探测、**不建会话不预热**；**不回滚**覆盖（`set_model` 失败本就不落库）；不重放失败轮次的 pending；已死会话同样清（决策 6） |
| 7 | 并发与重复触发 | 同 agent FIFO 串行（形态照 `lib/cwd-mutex.ts`）；**发布前置两条**：模型未变 ∧ 状态仍为 `error`（过期/被接管的结论只回本次交互）（决策 7） |
| 8 | 契约自洽与 ADR | 新触发点是**追加**：`① agent_start ② 生命周期动作 ③ 新增：runtime 保存后的探测结论`；「idle 推导不覆盖 error」等既有两条规则不动。**ADR 不建**（决策 8） |

**grill 过程**：第 1 轮 4 条根决策全部取推荐；第 2 轮在报告新代码事实后**收回了第 1 轮的半句结论**——
第 1 轮把「清空覆盖」当成「换模型的显式表态」，复核发现它并不改变 agent 实际会用的模型
（`app/api/members/[id]/runtime/route.ts:88-90` 在 null 时不给存活会话发 `set_model`；
`lib/rpc/caller.ts:141-152` 对带消息会话沿用文件模型），照字面执行会产生**新的假绿**，
故第 2 轮裁定清空不入触发面、缺口记入 Out of Scope 并在 Further Notes 给「另开一票」的上下文指针。
另 5 条细节（探测对象与解析路径 / 解析失败 fail-closed / FIFO 串行 + 发布前置 / 失败语义 / 不回滚·不重放·不预热）
经 coordinator 逐条确认。

### 机械判据（源码零改动 + 结构约束）

```text
$ git diff origin/main --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'
(空输出 ⇒ 源码改动面为零)

$ git diff origin/main --name-only
.scratch/agent-status-recovery/issues/01-runtime-save-error-recovery.md
.scratch/agent-status-recovery/spec.md
CONTEXT.md

$ grep -c '^## ' .scratch/agent-status-recovery/spec.md
7        # Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes

$ grep -n '待定\|TBD\|TODO\|FIXME' spec.md CONTEXT.md
(仅本票据清单里引用该要求的自述行，spec 与 CONTEXT 无命中)
```

`.pi-lens.json`（本地关闭 pi-lens 自动格式化）写在仓库根并已进 `.git/info/exclude`，
`git status --porcelain` 不出现它；交付前 `git status --porcelain` 为空（本 Answer 的提交后）。

### 不适用项（逐条 + 理由）

1. **测试不适用**：本票交付物是设计文档与词条，源码改动面为空 ⇒ **不存在被测对象**；
   机械判据是上面的 `git diff … | grep -v …` 空输出。Testing Decisions 给的是**实施票**的测试 seam
   （判定层纯函数矩阵 / fake runtime + fake probe 注入 / route 源码级断言 / 组件渲染断言 / 四态字面量不变）。
2. **双轴 code-review 不适用**：双轴（Standards + Spec）审的是代码 diff；本票 diff 只有文档与词条，
   无实现可供对标，审的会是文风而非实现是否兑现意图。
3. **真浏览器几何证据不适用**：本票零渲染改动（`components/` 未动），没有任何可观测的页面几何变化。

### 未做的事（逐条交代，避免留白被当遗漏）

1. **不改任何源码**（`lib/` / `app/` / `components/` / `hooks/` 全未动）——设计票性质 + Ownership 约束。
2. **不改 `AGENTS.md`**：状态点段落的「新清除触发点清单」由 coordinator 在验收后按治理例外处理。
3. **不建 ADR**：三条件第 1 条（难以反转）不满足；第 2、3 条虽满足但不构成充分条件（理由写在 spec 决策 8 的判定表里）。
4. **不实施设计**：实施接缝清单在 spec 决策 9（`lib/model-probe.ts` 探测内核 / `lib/agent-recovery.ts`
   恢复服务层 / route 薄封装 / 面板 + i18n 两套语言包），实施票另开。
5. **不修「清空覆盖 ≠ 回全局默认」这条既有缺口**：它在本设计下仍然存在，spec 已在 Out of Scope 写明
   并在 Further Notes 留了下一张票的上下文指针（三条事实依据 + 最小可验证形态）。
