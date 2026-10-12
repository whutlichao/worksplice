# 产出上下文治理实现规格

Type: task
Status: resolved
Blocked by: 04

## Question

（待票 04 resolved 后，按 to-spec 流程填写：把 04 的决策转成可实施规格。）

## Answer

已按 to-spec 流程把票 04 的六点裁决与 pre-study 证据合成为可实施规格，落盘 [`spec.md`](./spec.md)——含问题陈述、分路径方案、已确认决策表、九条可观察行为条目、基线与验证两层通过条件、迁移与兼容约束与实施入口；本票无源码改动。

## Comments

- 规格撰写，无决策类提问：本票无 Q→A——只把票 04 已决六点与 pre-study 证据合成规格，未新开决策问题。
- 单轴自检（对照本票 spec Change 1–4；纯文档不做双轴）：① Change 1——`spec.md` 195 行，Problem Statement / Solution（分层总览、分路径方案、已确认决策、行为条目）/ User Stories / Implementation Decisions（迁移与兼容约束）/ Testing Decisions（基线与验证方法）/ Out of Scope / Further Notes（实施入口）齐备，九条行为条目均为「给定…当…则」＋断言形态，引用路径逐条核验存在、未复制漂移数字、reset/delete 相关条目均标注「目标语义，非当前代码保证」；② Change 2——本 Answer 与 `Status: resolved` 落盘；③ Change 3——`map.md` Decisions so far 追加票 05 一行 gist；④ Change 4——改动仅 `spec.md` / 本票 / `map.md`，issues/01–04 与 `research/options-pre-study.md` 原样未动、无源码/配置改动（git diff 复核）。结论：通过，无未决项。
