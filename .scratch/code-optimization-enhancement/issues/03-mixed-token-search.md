# 03 — 缩小混合长短词搜索的候选集并保留结果契约

Type: task
Status: ready-for-agent
Blocked by: None (can start immediately)
Spec: ../spec.md

**What to build:** 搜索包含长短 token 时可减少需要检查的消息候选，同时用户得到的命中、顺序、摘要、数量与频道可见范围保持和当前规则一致。

## Acceptance criteria

- [ ] 全部 token 长度至少为 3 时仍走 FTS 并按 rank 排序；纯 1–2 字符查询仍走既有 LIKE 语义并按 rowid DESC 排序，不新增短 token 索引或 schema 迁移。
- [ ] 混合查询可用长 token 产生候选，但必须以原有转义 LIKE 语义验证所有 token（AND）；候选必须覆盖旧 LIKE 命中，且在完整验证后才应用最终 limit。若无法证明候选是超集，安全回退到原有路径。
- [ ] 混合查询结果仍按 rowid DESC；保持 CJK 短词、大小写/标点、`%`/`_`/反斜杠转义、摘要高亮、limit 与成员频道过滤语义不变。
- [ ] 使用相同数据快照与查询集对照新旧完整命中 ID 序列，并覆盖纯短词、全长词、长短混合、多语言及多个 AND token；复用现有 SQLite 与领域测试接缝。
- [ ] 在固定消息规模与查询分布上分别测量 FTS、纯短词和混合查询；基线和候选各预热后至少采集 30 个样本，归档扫描规模、原始样本、中位数、P90 和离散程度。
- [ ] 候选在预先记录的目标规模上有稳定且超过噪声的改善才作为优化保留；若没有，保持现有行为并记录 no-go 及测量证据，不得宣称性能收益。
