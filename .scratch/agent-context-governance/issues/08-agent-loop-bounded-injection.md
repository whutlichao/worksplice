# agent-loop 有界注入

Type: task
Status: resolved
Blocked by: 06, 07

## Question

在 agent-loop 应用层把每轮注入形状钉死为有界：超界的历史内容不进入注入，但可经既有 `search`
回查，回交维持既有观察相形状。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 B5（每轮注入有界）与 B8（回查协作维持既有形状约束）；
  对应裁决 D4（agent-loop 组合：compact 管会话长尾＋应用层钉死注入形状；阈值主权维持 SDK 默认＋
  用户 settings，产品不接管）与 D5（机制与预算数值留实现期按基线确定，规格不锁定单一机制）。
- 改动面：每轮 prompt 构建路径（[`loop.ts`](../../../lib/agent-loop/loop.ts)）——现状唯一的注入侧
  封顶是观察相每轮 1 次（[`loop.ts:498-499`](../../../lib/agent-loop/loop.ts#L498-L499)），inbox
  drain 无条数上限（[`inbox.ts:19-20`](../../../lib/domain/collab/inbox.ts#L19-L20)）；总预算必须
  覆盖整轮注入形状（历史轮、inbox、任务/频道语境），而非只封观察相。
- 不变量：超界历史不删除、不重写，仍留在原始会话记录中（经票 06/07 的归档＋检索面可达）；
  不接管 compact 阈值、应用层不做摘要生成；无应用层自动注入；不注册新工具、不改权限模型（B9）；
  回查入口沿用 `search` op 与既有观察相
  （[`member-ops.ts:575-586`](../../../lib/agent-loop/member-ops.ts#L575-L586)）。

## Answer

已在 agent-loop 应用层把每轮注入形状钉死为有界（base commit `4c415ee`，与本票同一基线）。
改动：`lib/agent-loop/injection-budget.ts`（新，上界常量＋投影/裁剪）、
`lib/agent-loop/loop.ts`（decide / revise / 观察相三条注入路径同口径）、
`lib/agent-loop/injection-budget.test.mjs`（新）、`loop.test.mjs`、`loop-ops.test.mjs`。
未触碰票 06/07 已交付面（`lib/session-archive.ts`、`lib/domain/collab/search*`、
`app/api/search/*`、`components/SearchView*`），未改 docs、未改 `inbox.ts`。

- **上界度量与裁剪策略（核心设计点）**：度量＝注入文本的**字符数**（仓库内无 tokenizer，字符
  是模型输入的单调代理，可确定性断言）；上界＝单个常量 `ROUND_INJECTION_BUDGET_CHARS = 20_000`，
  覆盖整轮注入形状的**合计**——历史积压消息 + 本期新消息 + 任务语境 + 频道/成员语境 +
  固定骨架 + 观察相；装配口径统一为「骨架先占位，弹性块吃剩余预算」（`elasticBudget`）：
  固定骨架（指令与 `[worksplice:target=… seq=…]` marker）永不裁，频道/成员语境块各 2_400
  字符硬顶，任务块 12 条 + 2_400 字符硬顶，消息块与观察文本吃剩余预算（`projectMessages`
  从最新往回装，装不下即停）。裁剪＝**保近期、裁远期**：最新一条消息永远在注入里（单条撑爆
  预算时截断它正文并标「（正文已按注入预算截断）」）；被裁内容在注入里显式声明
  「（N 条较早的消息不在本轮注入中：原始记录未删改，需要时用 search op 回查）」，任务被裁
  同样声明——不静默丢弃。
- **「历史轮内容」的覆盖口径（本票裁定）**：agent-loop 里「历史轮内容」在注入投影中的形态就是
  **尚未被消费的历史消息积压**（早期轮产生、游标未推进的内容），它与本期新消息是同一个
  `drain` 序列，由同一套近期窗口裁掉；已被消费的历史不会二次注入。前几轮 prompt 文本在 Pi
  session 里的**长尾累积**由 Pi compact 管辖——这是 D4 已定的边界（阈值主权维持 SDK 默认＋
  用户 settings，应用层不接管、不生成摘要），本票不越界动它。
- **初始预算值与依据**（D5 留实现期定，数值目标由票 10 按基线产出后再校准）：
  整轮上界 **20_000 字符**；消息窗口 **20 条**＋单条正文 **4_000**（两者都是 ADR-0005 决策一
  已裁定的「prompt 保守压缩」口径，不是新造数）；任务 **12 条**＋块硬顶 2_400；语境块各
  **2_400**；revise 原稿 **12_000**（它是本轮要发的内容，给比普通正文更宽的额度，截断时
  显式标注）。依据实测：满额语境（100 频道/100 成员）＋满额任务的 decide 轮固定部分约
  10_374 字符；24 条 × 4_000 字符的消息＝18_383；500 条 × 3_000 字符的积压被裁到 19_400；
  观察相既有最坏形状（50 条 × snippet 240）＝13_599——即**既有 B8 形状在最坏情形下仍在界内，
  不会被本票裁掉**，而长会话积压（实测无界时 42_272 字符）必然被裁。
- **既有断言的改动：无**。本票只新增断言，未修改任何既有断言——既有断言编码的是小夹具下的
  形状（消息数远小于窗口、长度远小于上界），它们在新实现下仍逐条成立（全量 1464/1464 绿）。
  票面允许「既有断言若编码无界现状就更新」的情形经核对未出现。
- **测试基数**：base commit `4c415ee` 复核基线 **1452**（隔离在本 worktree 干净 HEAD 上实测，
  与协调者同值）；本票新增 **12**（injection-budget 单测 5 ＋ loop.test.mjs 5 ＋
  loop-ops.test.mjs 2），全量 **1464/1464** 通过。`npm run typecheck` 干净、
  `npm run lint` 0 error（1 条既有 warning，非本票引入）。
- **code-review 双轴 findings 与处理**（对最终 diff）：
  - Spec 轴：①「任务块只有条数窗没有字符硬顶，尾部膨胀会让上界名存实亡」→ 已加任务块
    2_400 字符硬顶（`clampLines`），上界不再依赖 preview 长度；②「revise 轮缺上界断言」
    → 已补 `B5：revise 轮的注入同样受整轮上界约束`；③「任务/语境被裁无提示」→ 已补任务
    被裁提示行；④「草稿封顶属超出范围且可能让 resend 发出截断稿」→ 保留封顶但把额度提到
    12_000 并在截断时显式标注「（上面的原稿已按本轮注入预算截断，不是原稿全文）」，
    权衡与取舍写进本 Answer；⑤「观察文本截断静默」→ 已补截断提示行（并预留其长度，避免
    加了提示反而越界）。
  - Standards 轴：①术语漂移（「注入」未走 CONTEXT/GLOSSARY 词表）→ 在模块头显式把
    「注入投影＝活动上下文的选择视图」对齐 GLOSSARY 三条术语，不改 docs/词表（票面禁改 docs）；
    ②「窗口 24 与 ADR-0005 的 20 条冲突」→ 已改为 **20**，直接取 ADR-0005 已裁定口径；
    ③「三处同形的量骨架→投影→拼接」→ 抽出 `elasticBudget` 单一算式；④「导出常量无外部引用」
    → 补 `injection-budget.test.mjs` 让策略面（窗口/字符上界/投影/clamp）都有断言；
    ⑤「`export { ROUND_INJECTION_BUDGET_CHARS }` 是纯转发」→ 去掉转发，测试直接从
    `./injection-budget.ts` 导入。
  - 未处理（说明理由）：「缺文档产物 / AGENTS.md 模块清单未收录」——票面 Ownership 未授权改
    docs 与 AGENTS.md，本票的产物文档即本 Answer；「`projectMessages` 自己渲染消息行」
    ——预算与行渲染同属「注入投影」一件事，拆开反而让上界口径漂移，保持一处。
- **PR**：[#179](https://github.com/whutlichao/worksplice/pull/179)（body 路径：
  `/Users/apple/orca/workspaces/worksplice/context-governance-08-pr-body.md`），head 与最终
  提交一致（实现 `8a23ac4` + 本 Answer 回填提交）。
- **遗留**：①阈值（20_000 字符等）是初始值，按 D5/票 04 点 5 由票 10 基线产出后校准；
  ②`inbox.ts` 的 `drain` 仍一次取尽（无条数上限）——它是协作服务层的读取契约（HTTP 与
  agent-loop 共用），本票按「只钉注入投影、不改服务层读取语义」处理，若票 10 的基线显示
  drain 体积本身是成本项，另起票讨论；③行为层（真实 provider 的模型引用/答案正确性评测）
  按 D6 属另起 effort。

## Acceptance

- B5：合成会话下逐轮 prompt 形状 ≤ 应用层定义的恒定上界（上界的度量与预算数值属本票实现选择，
  spec 不锁定唯一机制，但必须是代码保证、可断言的）；早期轮埋入的关键事实不在注入中，却能经
  `search` 命中并经观察相交回。
- B8：一轮最多一次观察相；命中以观察相文本回交；无应用层自动注入、无新工具。
- 证据形式：fake session 每轮 prompt 捕获缝（[`loop.test.mjs`](../../../lib/agent-loop/loop.test.mjs)）
  与 `search` op → 观察相缝（[`loop-ops.test.mjs`](../../../lib/agent-loop/loop-ops.test.mjs)）扩展断言；
  数值目标（阈值）不在本票设定，由票 10 按基线产出后在实施票内确定。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。
