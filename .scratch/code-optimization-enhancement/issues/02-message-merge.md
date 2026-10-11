# 02 — 加速频道与线程消息合并的重复查找

Type: task
Status: ready-for-agent
Blocked by: None (can start immediately)
Spec: ../spec.md

**What to build:** 频道和线程接收轮询增量后，消息合并仍呈现与当前规则相同的条目与 seq 顺序，同时减少重复 ID 查找的工作量。

## Acceptance criteria

- [ ] 空 incoming 页仍返回同一个 prev 引用；prev 中已有的重复项保留；incoming 中与 prev 重复的 ID 被排除；incoming 自身重复项仍逐个保留；最终结果仍按 seq 升序排列。
- [ ] 合并不修改输入数组或消息对象。以现有纯函数测试接缝增加回归覆盖，并用确定性重复/乱序数据与现状参考结果逐项对照。
- [ ] 在固定、可重放的输入上测量 prev/incoming 大小、ID 重叠率与重复分布；基线和候选各预热后至少采集 30 个样本，归档原始样本、中位数、P90 和离散程度。
- [ ] 候选在预先记录的目标规模上有稳定且超过噪声的改善才作为优化保留；若没有，保持现有行为并记录 no-go 及测量证据，不得宣称性能收益。
- [ ] 票据列出的既有消息合并与轮询行为全部通过；不得改变消息内容、合并时机或 UI 行为。
