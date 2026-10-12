# 基线与防丢失验证

Type: task
Status: pending
Blocked by: 06, 07, 08, 09

## Question

用合成数据建立机制层基线并执行防丢失验证的机制层通过条件：注入形状、截断、检索可达性与
`contextUsage` 峰值可断言，产出数值目标与证据。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 Testing Decisions（验证两层通过条件、测量口径、数值目标
  留实施期）与裁决 D5（机制层＝每轮注入规模＋`contextUsage` 峰值；现状口径＝session 累计 token/cost）
  和 D6（机制断言＋合成端到端两层）。
- 改动面：只复用既有测试缝（spec.md Testing Decisions「seams（复用既有测试缝，不新造）」）——
  每轮 prompt 捕获 [`loop.test.mjs`](../../../lib/agent-loop/loop.test.mjs)、`search` op → 观察相
  [`loop-ops.test.mjs`](../../../lib/agent-loop/loop-ops.test.mjs)、归档落点/清理
  [`agent-lifecycle.test.mjs`](../../../lib/agent-lifecycle.test.mjs)、合成 JSONL＋临时目录
  [`session-stats.test.mjs`](../../../lib/session-stats.test.mjs)、恢复幂等
  [`backfill.test.mjs`](../../../lib/agent-loop/backfill.test.mjs)；session 级现状口径见
  [`session-stats.ts:101-156`](../../../lib/session-stats.ts#L101-L156)。
- 不变量：只用合成数据（合成 JSONL、临时数据目录、fake runtime），不读 `~/.pi`／`~/.worksplice`
  真实用户数据（先例 [`default-datadir-guard.test.mjs`](../../../lib/data/default-datadir-guard.test.mjs)）；
  不引入外部索引服务；轮级 usage 归属「待核实 SDK 能力」不作为断言前提；行为层（真实 provider
  质量/召回评测）不在本票，另起 effort。

## Acceptance

- 机制层三条断言（spec.md Testing Decisions）：①活动上下文按注入形状缩小——每轮 prompt 有恒定上界
  （引用 B5）；②关键事实在原始记录/归档面可检索命中，并经观察相回交（引用 B2/B4/B8）；
  ③`contextUsage` 峰值可观测（compact 后到下一次有效 assistant usage 前为未知）。
- 合成多轮端到端：fake 回复脚本走「事实 → 压缩/截断 → 回查」剧情；compact 触发以「注入 compact 后
  投影形态」为主，不依赖真实 provider 的阈值触发；B8 的「一轮最多一次观察相」在回查剧情中复核。
- 基线与数值目标：机制基线（每轮注入规模＋`contextUsage` 峰值）与现状口径（session 累计 token/cost）
  分别产出；数值目标在本票内确定并记录；两层通过条件中行为层只定义边界、不执行。
- 证据形式：测试输出与基线数字写进 Answer。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。
