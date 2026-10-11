# 02 — 加速频道与线程消息合并的重复查找

Type: task
Status: resolved
Blocked by: None (can start immediately)
Spec: ../spec.md

**What to build:** 频道和线程接收轮询增量后，消息合并仍呈现与当前规则相同的条目与 seq 顺序，同时减少重复 ID 查找的工作量。

## Acceptance criteria

- [ ] 空 incoming 页仍返回同一个 prev 引用；prev 中已有的重复项保留；incoming 中与 prev 重复的 ID 被排除；incoming 自身重复项仍逐个保留；最终结果仍按 seq 升序排列。
- [ ] 合并不修改输入数组或消息对象。以现有纯函数测试接缝增加回归覆盖，并用确定性重复/乱序数据与现状参考结果逐项对照。
- [ ] 在固定、可重放的输入上测量 prev/incoming 大小、ID 重叠率与重复分布；基线和候选各预热后至少采集 30 个样本，归档原始样本、中位数、P90 和离散程度。
- [ ] 候选在预先记录的目标规模上有稳定且超过噪声的改善才作为优化保留；若没有，保持现有行为并记录 no-go 及测量证据，不得宣称性能收益。
- [ ] 票据列出的既有消息合并与轮询行为全部通过；不得改变消息内容、合并时机或 UI 行为。

## Answer

- **outcome:** succeeded
- **files-modified:** `hooks/useChannelData.ts`, `hooks/useChannelData.test.mjs`, `.scratch/code-optimization-enhancement/issues/02-message-merge.md`
- **base commit:** `01369c574c6284dee6d6db54b3685c42451aa0de`（与 `origin/main` 开工时一致）
- **实现 commit:** `3fe34bc43dc171b37f18aa5281ce40a63d02413e`
- **PR:** [#149](https://github.com/whutlichao/worksplice/pull/149)

### 实现与 TDD

沿用 `mergeIncomingMessages` 纯函数 seam：非空页时只预建 `prevIds`，incoming 过滤只查该集合、不将 incoming ID 写回；排序 comparator、空 incoming 早返回均保持原样。

新增确定性回归用例逐项与旧 `prev.some` 参考结果比较，覆盖空 incoming 同一引用、prev 内重复保留、prev ID 命中排除、incoming 自身重复保留、乱序与相同 seq 的稳定顺序，以及冻结输入数组/消息对象不被修改。

- **Red：**先将候选改成过滤 incoming 时也 `seen.add(id)` 的错误变体，新增测试失败（1 fail），明确暴露 incoming 自身第二个重复 ID 被丢弃。
- **Green：**改为 Set 只含 prev IDs 后，该测试及定向档通过：base 为 82 pass；候选为 83 pass、0 fail。最终命令 `node --test --test-timeout=60000 hooks/useChannelData.test.mjs components/ChannelView.test.mjs`；另跑全量 `npm test`：1349 pass、0 fail。

### 性能证据

无 live 数据；所有输入均为公式生成的合成消息。目标与“稳定且超过噪声”判据在采样前记录于 `/tmp/orch-worksplice/evidence/02-message-merge/benchmark-plan.md`：目标为 `prev=1000`、`incoming=50`、98% overlap、无重复（约 20 页已加载历史；50 条最新页中 49 条已见、1 条新增）。环境为 Node v25.0.0 / V8 14.1 / macOS arm64 / Apple M1 Pro；base SHA 使用独立真实 worktree，且与候选共用同一 `node_modules`。

命令：

```sh
BASE_SHA=01369c574c6284dee6d6db54b3685c42451aa0de \
CANDIDATE_SHA=3fe34bc43dc171b37f18aa5281ce40a63d02413e \
node /tmp/orch-worksplice/evidence/02-message-merge/benchmark.mjs \
  /tmp/orch-worksplice/02-message-merge-base "$PWD" \
  /tmp/orch-worksplice/evidence/02-message-merge/benchmark-final-raw.json
```

共测 `prev=[50,250,1000,5000]` × `incoming=[10,50]` × overlap `[0%,50%,98%]` × duplicate 分布 `[none,repeated]`，48 组；每函数/输入预热 10 次、30 个配对样本，base/candidate 顺序交替。目标组结果：

| 统计 | base | candidate |
| --- | ---: | ---: |
| 中位数 | 170.292 µs | 44.916 µs |
| P90 | 175.167 µs | 51.041 µs |
| MAD | 0.480 µs | 0.396 µs |

配对中位节省 125.375 µs（73.67%），95% bootstrap 相对改善 CI `[73.41%, 73.77%]`，candidate 29/30 次更快；预注册噪声阈值为 `2 × base MAD = 0.959 µs`，三项 go 条件均满足，故保留 Set 优化。

诊断矩阵亦如实记录 `prev=5000/incoming=10/0% overlap` 的 synthetic 慢化：base 133.271 µs、candidate 286.396 µs；该组合与现有轮询的 `limit=50` 不相符，也不代表 5000 条历史下的实际最新页。对应 `incoming=50`、98% overlap、无重复组为 base 826.063 µs、candidate 284.396 µs（65.53% 节省）。不以目标平均数掩盖该诊断结果；目标 workload 仍远超噪声并通过预注册 go 判据。

可重放脚本、预注册计划、完整原始配对样本、第一次同源码探测及门禁/TDD 输出均在 `/tmp/orch-worksplice/evidence/02-message-merge/`；其中 `benchmark-final-raw.json` 记录 base 与 candidate commit SHA、全部样本、中位数/P90/MAD 及配对统计。

### Lint / Typecheck 增量对照

在 base SHA 的临时 worktree 与候选相同依赖环境分别执行 `node_modules/.bin/tsc --noEmit`、`npm run lint`，并按改动文件对照：

- **base：**typecheck exit 0、0 diagnostics；lint exit 0，0 errors / 1 warning。
- **candidate：**typecheck exit 0、0 diagnostics；lint exit 0，0 errors / 1 warning。唯一 warning 仍是未修改的 `hooks/useI18n.tsx:61` exhaustive-deps；本票改动文件无 lint finding，新增问题 0。
- 完整命令输出保存在 evidence 目录的 `base-*` 与 `final-*` 文件。

### Code Review

#### Standards

- 已审查提供的完整 diff：`hooks/useChannelData.ts:108–116` 将对 `prev` 的逐项 `some` 查找改为预建 `Set`；`hooks/useChannelData.test.mjs:47–97` 增加对重复 ID、排序、输入不变性及空输入行为的兼容性测试。
- **Documented-standard 违规：0。** `AGENTS.md`、README Development/Contributing、`CONTEXT.md` 与 `docs/agents/domain.md` 中未发现与这两个 hunk 冲突的约定。
- **Smell：0。** 未命中固定 smell baseline；测试中的旧逻辑作为行为参照，不构成生产代码重复。
- **Merge verdict: OK**

#### Spec

- **正确**：Spec 要求“只把 `prev` 的 ID 装入集合，不在遍历 incoming 时添加 ID”。diff 在 `hooks/useChannelData.ts:111-115` 正是如此：prev 内重复保留、与 prev 冲突的 incoming 排除、incoming 自身重复保留。空 incoming 早返回同一引用；排序仍使用原有 `seq` comparator，排序对象是新数组，不修改输入。
- **测试覆盖**：`hooks/useChannelData.test.mjs:47-100` 覆盖上述重复语义、乱序/tie、输入不变与空页引用；定向测试工件记录 83 项通过。
- **调用面未变**：频道 `applyPollPage` 仍调用该函数（`hooks/useChannelData.ts:142-145`）；线程轮询仍调用同一函数（`components/ThreadPanel.tsx:232`）。diff 未改变调用时机或 UI 行为。
- **性能及回归处置**：预注册目标 workload 达到 go：基线中位数 170.29µs，候选 44.92µs，29/30 配对更快，节省超过噪声阈值。确有诊断回归：`prev=5000/incoming=10/0% overlap` 基线 133.27µs、候选 286.40µs。它不是隐藏的平均值问题，但不是典型轮询输入：页大小上限为 50，且与 5000 条既有消息零重叠；实际 `incoming=50` 的 5000 条测试中，包括 98% overlap unique workload，候选有明显改善。因此该诊断回归不足以否定目标 workload 的优化，不构成 Spec finding。基准最终原始数据记录 30 样本、预热及提交 SHA。
- **Finding：0。Merge verdict: OK。**
