# 03 — 缩小混合长短词搜索的候选集并保留结果契约

Type: task
Status: resolved
Blocked by: None (can start immediately)
Spec: ../spec.md

**What to build:** 搜索包含长短 token 时可减少需要检查的消息候选，同时用户得到的命中、顺序、摘要、数量与频道可见范围保持和当前规则一致。

## Acceptance criteria

- [x] 全部 token 长度至少为 3 时仍走 FTS 并按 rank 排序；纯 1–2 字符查询仍走既有 LIKE 语义并按 rowid DESC 排序，不新增短 token 索引或 schema 迁移。
- [x] 混合查询可用长 token 产生候选，但必须以原有转义 LIKE 语义验证所有 token（AND）；候选必须覆盖旧 LIKE 命中，且在完整验证后才应用最终 limit。若无法证明候选是超集，安全回退到原有路径。
- [x] 混合查询结果仍按 rowid DESC；保持 CJK 短词、大小写/标点、`%`/`_`/反斜杠转义、摘要高亮、limit 与成员频道过滤语义不变。
- [x] 使用相同数据快照与查询集对照新旧完整命中 ID 序列，并覆盖纯短词、全长词、长短混合、多语言及多个 AND token；复用现有 SQLite 与领域测试接缝。
- [x] 在固定消息规模与查询分布上分别测量 FTS、纯短词和混合查询；基线和候选各预热后至少采集 30 个样本，归档扫描规模、原始样本、中位数、P90 和离散程度。
- [x] 候选在预先记录的目标规模上有稳定且超过噪声的改善才作为优化保留；若没有，保持现有行为并记录 no-go 及测量证据，不得宣称性能收益。

## Answer

Outcome: **产品实现与本地验收已完成；PR #150 已由 coordinator 在用户授权后创建**（https://github.com/whutlichao/worksplice/pull/150）。保留混合查询优化，真实 base commit `01369c574c6284dee6d6db54b3685c42451aa0de` 与候选在临时合成数据上的基准显示稳定改善。代码提交：`943e4e8`、`9ccaab2`；远端 push 与 PR 创建由 coordinator 按用户授权完成，本 follow-up 只收敛票据记录。

Files modified: `lib/data/sqlite.ts`、`lib/data/data-layer.test.mjs`、`lib/domain/collab/search.test.mjs`、本票文件。

### 实施与 TDD

- **RED**：旧实现上新增混合查询候选路径探针失败；实际 SQL 仍只有 `FROM messages ... LIKE ...`，没有 FTS 候选。原始失败日志：`/tmp/orch-worksplice/evidence/03-mixed-token-search/tdd-red.log`。
- **GREEN**：混合查询以长 token 的首个 3-codepoint trigram 生成 FTS 候选，再对全部 token 执行原转义 LIKE AND 校验；SQL 完成验证后按 `rowid DESC` 应用 limit。全部长 token 仍走 FTS/rank，纯短词仍走原 LIKE/rowid DESC；未改 schema、协作域调用、摘要或成员过滤。
- Standards review 指出 SQL monkeypatch/结构断言违反“只测外部行为，不测实现细节”；该测试已在 `9ccaab2` 移除。最终保留旧 LIKE 实现作为 oracle 的结果差分测试，基准另记录候选扫描与执行计划。红/绿过程日志：`tdd-red.log`、`tdd-green.log`；最终聚焦测试日志：`search-tests-postreview.log`。
- 差分测试覆盖 1/2 字 CJK、全长词、混合及多 token AND、中日文/拉丁混合、大小写、`%`/`_`/反斜杠转义、完整 ID 序列、snippet、排序和 limit；领域测试以混合查询覆盖成员频道可见范围。

### 验证

- Base 从真实 SHA 创建临时 worktree：`/tmp/orch-worksplice/evidence/03-mixed-token-search/base-worktree`。`node_modules/.bin/tsc --noEmit` 0 errors；`npm run lint` 0 errors、1 warning（`hooks/useI18n.tsx:61`）。日志：`base-tsc.log`、`base-lint.log`。
- 最终候选：`node_modules/.bin/tsc --noEmit` 0 errors；`npm run lint` 0 errors、同一条既有 warning；`npm test` **1,349 passed / 0 failed**。日志：`candidate-tsc-postreview.log`、`candidate-lint-postreview.log`、`npm-test-postreview.log`。未运行 `next build`；依赖缺失时仅运行 `bun install --frozen-lockfile`。

### 性能证据

Harness：`/tmp/orch-worksplice/evidence/03-mixed-token-search/benchmark.mjs`。最终三轮的 JSON（`benchmark-final-run1.json` 至 `benchmark-final-run3.json`）含每路径 30 个 raw samples、完整 ID/snippet 差分、median、P90、标准差、CV 与执行计划。环境：Node v25.0.0、macOS arm64、SQLite 3.53.4；每轮在**同一临时 SQLite 快照**上打开 base 与 candidate adapter，预热 8 次后交错测量 30 次，limit=50。数据为确定性合成内容、不接触 live 数据：10k/100k 消息；`生态` 每 4 行、`火星` 每 97 行、`quasarprobe` 每 50 行；分别测全长 `quasarprobe`、纯短 `生态`、混合 `火星 quasarprobe`。

| 混合查询规模 | 完整命中 | Base 扫描/FTS 候选 | Base 中位数/P90/SD(ms)，run 1/2/3 | Candidate 中位数/P90/SD(ms)，run 1/2/3 | 中位数改善比 |
|---|---:|---:|---|---|---|
| 10k | 2 | 10,000 / 200 | .5865/.6469/.0413；.5922/.6163/.0294；.5722/.5951/.0120 | .1134/.1591/.0209；.1184/.1768/.0310；.1120/.1223/.0073 | 5.172×；5.002×；5.109× |
| 100k | 20 | 100,000 / 2,000 | 5.9522/6.2100/.1536；5.8730/5.9873/.1281；6.1298/6.5456/.9011 | 1.0868/1.3615/.1811；1.1161/1.3895/.1858；1.2872/1.5180/.9850 | 5.477×；5.262×；4.762× |

混合命中少于 limit=50，base LIKE 必须扫完整表；候选 FTS 缩至总量 2%（200/10k、2,000/100k），再以全部 LIKE 条件验证。三轮中位数与 P90 都稳定改善，明显大于离散度，因此**保留优化，非 no-go**。全长 FTS 与纯短 LIKE 两侧仍用相同路径，没有宣称收益：100k 全长的 candidate/base 中位数比为 `.999×/1.000×/1.045×`，纯短为 `.978×/.994×/.945×`。两类中出现的少量系统/GC 离群值、所有原始样本与离散度都保留在上述 JSON 内。

### 双轴 code-review

#### Standards

Review 初版报告 1 项 P1：`lib/data/data-layer.test.mjs` 的 `prepare` spy 和 SQL 结构断言违反 `docs/engineering-standards.md` §2.1「只测外部行为，不测实现细节」。**处置：有效，已修复**——`9ccaab2` 删除白盒断言，保留结果等价行为测试；性能执行计划由独立基准记录。最终针对性复审确认该项已解决、未发现移除导致的缺陷或其他标准/smell 问题，结论 **OK with notes**（未来性能回归由基准而非 SQL 断言保障）。

#### Spec

Review 确切 diff 后未发现遗漏、范围外改动或实现错误；移除白盒测试后的针对性复审确认结果差分覆盖充分、没有正确性缺口，先前疑虑不再成立，结论 **OK**。

### Decisions

1. 原 worker 对远端 push/创建 PR 的第三方操作先发起 escalation（`msg_350f6810ae03`），未代办。
2. 用户授权 coordinator 执行 `git push` 与 `gh pr create`。
3. coordinator 按授权完成推送并创建 [PR #150](https://github.com/whutlichao/worksplice/pull/150)；本 follow-up 仅更新本票记录，不重复操作 GitHub。
