# Spec: agent 状态点的错误恢复（换模型 ⇒ 模型探测 ⇒ 状态收敛）

来源：用户报告（agent 因模型调用额度耗尽进入 `error`，随后在面板换了另一个模型，状态点仍红；
用户原话「理论上换了 model 后应该进行了简单的检测让状态变绿才对吧？」）+ 本 effort 对现状的逐条复核
（事实清单与源码位置见 Further Notes）。本 effort 是**设计票**：本文件是唯一正本、源码改动面为空，
实施票另开（接缝清单见 Implementation Decisions 第 9 条）。8 个决策点全部经 `orchestration ask`
两轮 grill 由人类/coordinator 裁定（第 1 轮四条、第 2 轮四条，裁定记录逐条落在下面对应条目里）。

## Problem Statement

现状（已复核，逐条附位置）：

1. 状态点四态 `online / working / error / offline`（`lib/data/types.ts:13`），事实来源是
   `lib/agent-status.ts:51-66`：存活 wrapper 走现场推导（`lib/agent-runtime.ts:345-352`），
   wrapper 不在则回落 DB——`error` 保留，其余回落 `offline`。
2. `error` 的清除触发点被**刻意收窄**过：`agent_end` / `agent_settled` 不覆盖 error，
   注释明写「error 只被下一次 `agent_start`（新轮开始）清除」（`lib/agent-runtime.ts:294-308`）；
   空闲（存活但没在跑）时 `deriveLiveAgentStatus` 对 DB=error 返回 `null` ⇒ 不覆盖红点（`:345-352`）。
   契约出处：`.scratch/agent-isolation/spec-agent-isolation.md` Implementation Decisions 第 2 条、
   `AGENTS.md:472`。
3. per-agent runtime 保存这条路径**不触碰状态点**：面板 `saveRuntime`
   （`components/AgentDetailPanel.tsx:511-534`）成功只设一句提示文案；路由 PATCH
   （`app/api/members/[id]/runtime/route.ts:54-106`）对存活会话发 `set_model`、然后持久化覆盖。
4. 于是出现**永久红点**：换模型时该 agent 空闲、没有新 wake，`agent_start` 永远不会到来，
   `error` 没有任何一条现存触发点能清掉。idle shutdown 也不发状态
   （`lib/rpc/session.ts:429-438` 直接 `shutdown()`，不经 runtime 的 `destroySession`），
   所以 DB 里的 `error` 会一直留着——这正是「永久」成立的原因。

所以这不是「代码没按契约工作」，而是契约本身缺一条恢复路径——这正是本票走设计票而非直接修 bug 的原因：
重开一条已写明的计划决断需要论证并落档。

次生缺口：状态点只有四态、没有原因；`error` 的原因只落在可观测页「轮次记录」
（`round_logs.reason`，`lib/domain/collab/rounds.ts:35-58`，`components/AgentDetailPanel.tsx:1038-1080` 行内展示），
不在状态卡片就近可见。用户看到红点时无法就地判断「是旧错还没清」还是「新模型也不能用」。

## Solution

用户视角：**一个已经报错的 agent，在详情面板保存 per-agent runtime 后，系统会自动对当前生效的
模型覆盖做一次最小连通性探测，并让状态点按探测结论收敛**——探测通过且会话还活着 → 绿；
探测通过但会话已被 idle shutdown/进程重启关掉 → 灰（错误已清，「配置已验证、会话未运行」）；
探测不通过 → 保持红，并把这次的失败原因就地回给用户（不再是「红点不动、只能去会话流里猜」）。

没有报错的 agent 保存 runtime 的行为**完全不变**：不探测、不加延迟、不花 token。
红点状态下再点一次保存**就是一次复检**（零新增 UI）：配额恢复后想确认、或什么都没改只是想重试，
都用这个入口。

一句话语义：**恢复动作的证据是「模型此刻可用」这个显式裁决，不是「会话还活着」这个推导。**

## User Stories

1. 作为 Owner，我给一个状态点已经变红的 agent 换了模型并保存后，不再需要猜：几秒内红点会按探测结论收敛。
2. 作为 Owner，当换上的模型仍然不可用时，红点保持红，且我在保存的那一次交互里就能看到失败原因。
3. 作为 Owner，即使该 agent 的空闲会话已被关闭（idle shutdown / 进程重启），我换模型后也会看到错误被清除
   （红 → 灰），而不是「进程重启过，所以红点永远不动」。
4. 作为 Owner，我在红点状态下什么都没改、只是再点一次保存时，系统会再复检一次模型——这是我的复检入口，
   不需要额外的「验证连接」按钮。
5. 作为 Owner，我在 agent 未报错时保存 runtime（包括只改 thinking level），行为和今天一模一样
   （无探测、无额外等待、无 token 消耗）。
6. 作为 Owner，探测要花几秒时，保存按钮保持忙态，我不会因为看不到反馈而重复点击。
7. 作为 Owner，我换的模型没通过探测时，配置**不会被静默回滚**——面板显示的就是我选的那个模型。
8. 作为 Owner，agent 正在跑一轮（黄点脉冲）时，我的保存不会插入一次并发探测去和那一轮抢状态点。
9. 作为 Owner，我在两个标签页里几乎同时保存同一个 agent 的不同模型时，状态点只反映最后一次保存的模型。

## Implementation Decisions

1. **触发面（第 1 个决策点，两轮裁定）**：只认 **per-agent runtime 保存**这一条面，
   谓词 = **「保存后存在具体的覆盖对（provider+modelId 非 null）」∧「保存前该 agent 处于 `error`」**，
   与「这次到底改了什么字段」无关。
   - **不看字段是否变化**（第 2 轮裁定 (b)）：红点状态下的任何一次保存都构成一次复检——
     这是零新增 UI 的复检入口（User Story 4），也让谓词只有一条前置、不做有效模型比对。
     推论写明：红点状态下只改 thinkingLevel 也会复检一次模型（一次极小调用，属复检语义，不是缺陷）；
     非 error 语境下任何保存（含改 thinkingLevel、含改模型）都不触发。
   - 全局模型配置（models.json / ModelsConfig）变更**不触发**：它对某个 agent 的错误没有确定的因果，
     却会按 error agent 数扇出 N 次探测（每次最多 20s + 一次模型调用）。
   - **清空覆盖（provider/modelId = null）不触发**（第 2 轮裁定 (a)，用代码事实修正了第 1 轮的
     「清空也算」）：清空并不改变这个 agent 实际会用的模型——路由在 null 时不给存活会话发 `set_model`
     （`app/api/members/[id]/runtime/route.ts:88-90`），带消息的会话下次启动也沿用文件里的模型
     （`lib/rpc/caller.ts:141-152`），而文件里的模型通常就是上次设的那个覆盖
     （`lib/rpc/session.ts:553-569` 的 `set_model` 顺手写全局默认）。若照第 1 轮字面执行
     （清空触发 + 探测全局默认），会产生**新的假绿**：探测通过 → 绿点，而会话仍用坏模型。
     该既有缺口记入 Out of Scope，并在 Further Notes 给「另开一票」的上下文指针。

2. **恢复形态（第 2 个决策点，本票核心）**：**真连通性探测**（不是乐观清错，也不是手动入口）。
   形态：复用模型配置面板已有的探测机制——`ModelRuntime` + `completeSimple`、最小 prompt、
   `maxTokens: 16`、`maxRetries: 0`、20s 超时（`app/api/models-config/test/route.ts:62-115`），
   **不落 session、不进会话历史、不唤醒 agent-loop、不写 round_logs**。
   与既有机制的唯一差别是输入来源：恢复探测吃的是**已落库的覆盖对**在真实配置下的解析结果，
   不是请求体里现造的配置 + 临时 models.json。
   - 不选乐观清错：配额/账户级失败下「绿 → 下一轮又红」是必然出现的假绿，比现状更误导（现状至少诚实）。
   - 不选只做手动入口：用户报告的流程正是「换完模型、什么都没发生」，不自动触发就等于没修；
     复检需求由决策 1 的谓词形态（红点下再点保存）覆盖，不新增按钮。
   - 成本：只在「已在 error + 存在覆盖对」时付出一次极小调用（`maxTokens: 16`，几十 token 量级）
     与最多 20s 等待——而这条路径上用户本来就在等结果。

3. **探测期间与结果的呈现（第 3 个决策点，第 2 轮裁定 (i)）**：四态契约不变，**不新增第五态**。
   - 探测期间状态点**保持不变**（错误语境下仍是红）：不做乐观写作，红点在任何时刻都只表示
     「上一次已知结论」。**不碰**「idle 推导不覆盖 error」那条刻意收窄的契约。
   - 「复用 `working` 表示探测中」**被否决**，理由是机械的而非审美的：`deriveLiveAgentStatus`
     在「wrapper 存活且空闲」时对任何非 error 的 DB 值一律返回 `online`（`:345-352`），
     所以发出的 `working` 会被现场推导覆盖成绿——那正是一个假绿窗口；要显示出来就得改那条推导规则，
     契约改动面因此变大。
   - 面板的忙态沿用既有的 `runtime.saving` 文案，**不引入客户端触发谓词**（同一判定两处实现会漂移；
     服务端是触发的唯一裁决者）。
   - 结论落点：探测通过 ∧ 会话存活 → `online`（绿）；探测通过 ∧ 无存活会话 → `offline`（红 → 灰，
     诚实收敛：四态语义里 `online` 本就表示「有存活会话」）；探测不通过 → 不写状态点（保持红）。
   - 发布仍走唯一发布口 `publishAgentStatus`（`lib/agent-status.ts:69-73`），前端经
     `/api/members/events` 的 SSE 快照自动收敛（`components/AppShell.tsx:233-248`）。

4. **失败语义与原因可见性（第 4 个决策点，裁定 (i)）**：探测不通过 ⇒ **保持 `error`**
   （不写状态点、不发明新错误码、不新增展示态）；**本次探测的失败原因就地回给那一次交互**
   （面板消息槽显示 `runtime.probeFailed` + 原因文本），**不持久化、不做历史**。
   原 `error` 的原因仍沿可观测页「轮次记录」看（已有 `round_logs.reason` 展示）。
   明确**不**做「状态卡片常驻错误原因」：那会让同一事实（最近一次错误原因）在两个展示面各写一遍。
   明确探测**不是轮次**：不写 `round_logs`（`CONTEXT.md` 的「轮次」词条把轮次定义为
   wake→drain→decide→act→reply→ack 的处理周期，探测没有这些阶段）。

5. **探测用哪个模型（第 5 个决策点）**：用**刚保存的那个覆盖对**，并走**与会话启动同一条解析路径**
   （不新建第二套解析）：`lib/model-listing.ts:53` 的 `loadModelListingServices`
   （cwd = 该 agent 的 workspace，与启动一致，project trust 与可见模型面同源）→
   `lib/model-scope.ts:57` 的 `resolveVisibleModels`（吃 `settings.getEnabledModels()`）→
   `lib/model-scope.ts:107` 的 `selectInitialModelScope({ requestedModel })`。
   这样探测结论同时覆盖两件事：模型**能不能通**，以及**下次启动能不能解析到它**——
   后者正是 `selectInitialModelScope` 对越出 `enabledModels` 作用域的 `requestedModel` 抛错的既有语义。
   解析失败（模型不存在 / 不在作用域 / 拿不到凭证 / agent 没绑工作区）⇒ **不发出探测调用、
   保持 `error`**、把可读原因回给面板（fail-closed，不假绿）。
   因为清空不触发（决策 1），这条路径**不需要**解析全局默认，也**不涉及** `enabledModels`
   回落到首个可见模型的那套语义——探测对象永远是一个具体的、已落库的覆盖对。

6. **会话与探测的关系（第 6 个决策点）**：
   - **纯探测，不建会话、不预热**：把一个配置动作放大成生命周期动作（建会话 → 落 session 文件 →
     绑 `pi_session_file` → 进 idle 计时 → 可能撞 `BusyCwdError`）不是这次保存的意图，
     也不是四态语义里 `online` 的含义。代价写明：会话已死时探测通过只到灰点。
   - **不因为探测失败回滚覆盖**：覆盖记录的是用户的意图；探测失败是当时的连通性事实，
     不是撤销用户配置的理由。也不存在「`set_model` 失败但覆盖已存」的形态——
     路由先 `await` 命令再持久化（`:84-100`），命令抛错即 400 且不落库。
   - **不重放失败的轮次**：探测只解决状态点；失败轮次留下的 pending 游标继续等下一次 wake。
     重放属于自动重试，越界（见 Out of Scope）。
   - **已死会话同样清**（第 1 轮裁定 (i)）：恢复动作的证据是「模型可用」而不是「会话活着」；
     清除陈旧 error 是诚实收敛（红 → 灰）。

7. **并发与重复触发（第 7 个决策点）**：
   - 同一 agent 的探测 **FIFO 串行**（形态照 `lib/cwd-mutex.ts` 的 per-key promise 链，键 = agent id），
     不同 agent 互不阻塞；20s 上限由探测自身超时收口，不引入取消/队列上限机制。
   - **发布前置两条**（防污染判据，两条同时成立才写状态点）：
     ① **当前持久化的有效模型仍等于本次探测的模型**（重读持久化配置比对；不等 = 结论已过期）；
     ② **当前状态点仍为 `error`**（恢复语境没有被别的事件接管）。
     任一不成立 ⇒ 结论只回给这次调用（响应里标注为已过期/已接管），状态点不动。
     第 ② 条同时兜住「探测期间起了一轮 / 一轮刚跑完」的竞态：那个窗口里该轮自己的事件是更权威的来源，
     不拿一个更早发出的探测结论去覆盖它（否则会出现「跑完一轮反而红」的假红）。
   - 重复保存：红点状态下每次保存都触发一次探测（决策 1 的复检语义），按上面的 FIFO 串行；
     结论是否生效由发布前置裁决，所以「先保存 A、再保存 B」只会留下 B 的结论。
   - 探测期间用户改别的字段（如 thinkingLevel）⇒ 不影响在途探测；结论仍按「模型是否仍是它」判定。

8. **契约自洽与 ADR 判定（第 8 个决策点）**：
   - 新触发点是**追加**，既有两条规则一字不动：
     ①「`agent_end`/`agent_settled` 不覆盖 error」（`lib/agent-runtime.ts:301-306`）；
     ②「idle 推导不覆盖 error」（`lib/agent-runtime.ts:351`）。
     两者防的都是「从存活状态**推导**出的绿」，而新触发点是**显式裁决**（一次探测的结论）：
     推导式清除仍被禁止，裁决式清除新增一条。
   - `error` 的清除触发点清单（更新后，即本设计对既有契约的完整重述）：
     ① 新一轮开始（`agent_start`，`lib/agent-runtime.ts:294-308`）；
     ② 生命周期动作 Restart / Session reset / Full reset / Change workspace / 删除身份
     （`lib/agent-lifecycle.ts:63-127` 各自 `publishAgentStatus(offline)`）；
     ③ **新增**：per-agent runtime 保存后的模型探测通过（本设计；判定置为 `online` 或 `offline`）。
     附带事实：idle shutdown 走 `AgentSessionWrapper.shutdown()`（`lib/rpc/session.ts:429-438`）、
     不经 runtime 的 `destroySession`，所以**不发状态**——这正是 DB 里的 `error` 能被保留、
     「永久红点」现象成立的原因（也是本设计的动机证据）。
   - **ADR 判定（三条件逐条）**：

| 条件 | 判定 | 理由 |
| --- | --- | --- |
| 难以反转 | **不满足** | 形态是「保存路径加一次调用 + 一个判定」；撤销 = 删掉调用点与模块，无数据结构迁移、无外部契约、无版本兼容成本。 |
| 无上下文会令人惊讶 | 满足 | 「保存一个配置字段会触发一次模型调用并改写状态点」与紧邻的既有注释「error 只被下一次 `agent_start` 清除」并置时确实反直觉。 |
| 是真实权衡的结果 | 满足 | 乐观清错 / 自动探测 / 手动入口三种形态，以及「已死会话是否同样清除」「清空覆盖是否算触发」都有真实代价差，取值有具体理由（决策 1/2/6）。 |

     按「三条件**全部**满足才建」的规则，第 1 条不满足 ⇒ **不建 ADR**；结论记入本节（有意为之，不是遗漏）。
     第 2 条的惊讶面由**实施票在调用点写清缘由**承担（「为什么保存配置会触发模型调用并改写状态点」），
     不需要跨仓决策记录。

9. **实施接缝（实施票的形态，本票不实施）**：
   - `lib/model-probe.ts`（新，探测内核）：把 `app/api/models-config/test/route.ts:69-115` 的
     「解析凭证 → `completeSimple` → 结论映射（`ok/error/latencyMs/status`）」抽成可复用内核；
     该面板路由的请求形态与行为**不变**（它仍用临时 models.json 造未保存配置）。两个调用点共用
     同一份常量与结论语义（避免「同一事实两处实现」）。
   - `lib/agent-recovery.ts`（新，恢复服务层 = 深模块）：`saveAgentRuntime(agentId, input, deps)` ——
     [应用存活会话命令 → 持久化覆盖 → 判定是否触发 → 串行执行探测 → 按发布前置决定是否写状态点 → 返回结论]。
     判定与映射导出为纯函数（`shouldProbeOnRuntimeSave`：决策 1 的谓词；`probeVerdictStatus`：
     决策 3 的映射；发布前置的两条判定）；SDK/runtime 经既有 `AgentRuntime` 接缝
     （`lib/agent-runtime.ts:21-32`）与可注入的 `probe` 参数进入——测试零 SDK 依赖。
   - `app/api/members/[id]/runtime/route.ts`（薄封装）：PATCH 调服务层并把结论写进响应
     （形如 `{ agent, probe: { attempted, ok?, error?, latencyMs?, superseded? } }`）；GET 不变。
   - `components/AgentDetailPanel.tsx`：`saveRuntime` 读响应里的结论，复用既有消息槽显示
     `runtime.probeOk` / `runtime.probeFailed`；i18n 两套语言包都加键（UI 文案层，`docs/i18n.md`）。
   - 状态发布只有 `publishAgentStatus` 一个口；探测内核不碰状态、不碰 DB。

10. **不变的东西**：状态点四态、`deriveLiveAgentStatus` 的两条既有规则、`round_logs` 的轮次定义、
    `POST /api/agent/[id]` 的命令面（`set_model` / `set_thinking_level` 的既有用法不动）、
    agent-loop 的 error 语义、`GET /api/members/[id]/runtime` 的响应形态（只增可选字段）。

## Testing Decisions

- **判定层纯函数**（新 `lib/agent-recovery.test.mjs`，无 SDK、无网络）：
  - 触发谓词矩阵：`(保存后是否有覆盖对, 保存前是否 error)` → 探测 / 跳过，
    含「无覆盖对（清空/继承全局）⇒ 跳过」「非 error ⇒ 跳过」两行否定用例。
  - 结论映射矩阵：`(probe.ok, 会话是否存活)` → `online / offline / 不写状态点`。
  - 发布前置矩阵：`(模型是否仍为本次探测的模型, 当前状态是否仍为 error)` → 写 / 不写（4 行穷举）。
  - 串行：同 agent 两次保存 → 探测 FIFO、只有最新结论生效；不同 agent 不互相阻塞。
- **服务层 + fake 注入**（同文件）：临时 DB（显式传目录的 `openDataDb(tmp)`）+ 注入 fake `AgentRuntime`
  与 fake `probe`；断言三条路径（error → online / error → offline / error 保持）、探测失败**不回滚**已存覆盖、
  未报错时 probe 调用次数为 0、探测参数（cwd/provider/modelId）与会话启动路径解析一致。
  禁止在测试里无参调用 `getDb()` / `openDataDb()`（常驻守卫 `lib/data/default-datadir-guard.test.mjs`）。
  禁止静态 import `lib/rpc/*`（node TS strip 模式解析不了 parameter properties）——用既有 `AgentRuntime` 接缝。
- **route 源码级断言**（本仓既有形态，如 `lib/domain/collab/*-route.test.mjs` 读源码正则）：
  PATCH 经服务层而不在路由里内联探测逻辑；响应带探测结论字段。
- **组件渲染断言**（扩展 `components/AgentDetailPanel.test.mjs`）：ok / 失败两种结论文案渲染；
  没带结论字段时与今天的行为逐字一致（既有用例不改仍绿）。
- **类型面**：`MemberStatus` 仍是四个字面量（不新增第五态）——断言放判定层测试里。
- 明确不做的测试：真跑 HTTP 端到端（沿用 ADR-0013 的记账：本仓 `*-route.test.mjs` 是读源码断言，
  不是真跑 HTTP）；真实 provider 调用（探测内核的接缝用 fake completion，模型可用性不是本仓测试的对象）；
  浏览器几何证据（本设计无渲染改动）。

## Out of Scope

- **第五态**（探测中 / 未知）与任何状态点之外的探测进度指示。
- **乐观清错**（不探测即清）与「探测结果持久化 / 错误历史时间线」（第 3、4 个决策点的备选）。
- **手动「验证连接」入口**（第 2 个决策点的备选 (c)）：复检需求由决策 1 的谓词形态覆盖
  （红点下再点保存 = 复检）；探测内核一旦抽出，将来加按钮不改判定层。
- **清空覆盖（null）触发恢复**，以及「清空 = 回全局默认」这条既有语义缺口本身：
  清空对存活会话不生效（`app/api/members/[id]/runtime/route.ts:88-90`），
  带消息的会话下次启动也沿用文件里的模型（`lib/rpc/caller.ts:141-152`）。
  要让那句话成立得先改清空语义，那是另一张票；本设计**不假装它能被探测兑现**，
  也**不接受**「探测全局默认 → 绿点」这种半修（假绿比留红更坏）。建议另开一票，指针见 Further Notes。
- **自动重试 / 熔断 / 配额与额度监控 / provider 健康巡检 / 定时复检**；**不重放**失败轮次留下的 pending 游标。
- **会话预热**（探测通过也不建会话）；`set_model` 之外不新增任何会话命令。
- **全局模型配置（models.json / ModelsConfig）变更触发恢复**（含扇出）。
- **状态卡片常驻错误原因**、错误原因归因的其它展示扩展。
- **agent-loop 的 error 语义**（回应失败、空回复、cap-ack、yielded、游标推进）与 `round_logs` 形态。
- **`error` 之外的其它状态迁移**（如 offline → online 的探测、idle 推导规则的任何改动）。
- 具体文案与视觉细节（在实施票的 i18n 层内定）。
- 真端到端 HTTP 测试与浏览器几何证据（无渲染改动，见 Testing Decisions）。

## Further Notes

**现状事实清单（本票逐一复核过，实施票可以直接引用）**

- F1 `components/AgentDetailPanel.tsx:511-534`：每次保存都发 `provider/modelId/thinkingLevel` 三个字段
  （没改的也照发）⇒ 谓词不能看字段存在性（本设计干脆不看变化，见决策 1）。
- F2 `app/api/members/[id]/runtime/route.ts:84-100`：先 `await` `set_model` 再持久化；
  命令抛错 ⇒ 400 且不落库 ⇒「命令失败但覆盖已存」不存在，不需要回滚设计。
- F3 `lib/domain/collab/rounds.ts:35-58` + `components/AgentDetailPanel.tsx:1038-1080`：
  `error` 轮次的 reason 已落 `round_logs` 并在「轮次记录」里行内展示（hover title 也有）。
- F4 `lib/agent-runtime.ts:345-352`：wrapper 存活且空闲时，DB 非 error 一律推导为 `online`
  ⇒「探测期间复用 `working`」在存活会话上会被覆盖成绿（决策 3 的机械依据）。
- F5 `app/api/models-config/test/route.ts:62-115`：现成探测机制的常量与结论语义
  （`maxTokens: 16` / `maxRetries: 0` / 20s / `ok, error, latencyMs, status`）。
- F6 `lib/rpc/session.ts:553-569`：`set_model` 有个既有副作用——顺手把**全局默认模型**写成该模型
  （`setDefaultModelAndProvider` + flush）。本设计不改它，但它解释了为什么「清空覆盖 = 回全局默认」
  这句注释在多数情况下看起来成立、实际不成立（决策 1 / Out of Scope 的事实依据）。
- F7 `lib/rpc/session.ts:429-438`：idle shutdown 直接 `shutdown()`，不经 runtime 的 `destroySession`
  ⇒ 不发状态 ⇒ DB 的 `error` 得以保留到回落路径（「永久红点」的成因）。

**下一张票的上下文指针（清空语义缺口，供 coordinator 在 to-tickets 阶段判断是否开票）**

- 症状：用户在红点 agent 上「清空覆盖 → 以为回全局默认 → 状态点与模型都没变」。
- 三个事实依据：F6 的三条（路由 null 不发 `set_model`、带消息会话沿用文件模型、`set_model` 写全局默认）。
- 最小可验证形态：清空时对存活会话发 `set_model` 到解析出的全局默认（`getDefaultProvider`/
  `getDefaultModel` + `enabledModels` 作用域回落），并决定带消息会话下次启动是否也应回默认
  （现为沿用文件模型，`lib/rpc/caller.ts:144-152`）。
- 与本案的边界：本案只做「保存了具体覆盖对 ⇒ 探测 ⇒ 状态收敛」，不碰清空语义。

**实施与治理**

- `AGENTS.md` 的状态点段落需要把决策 8 的新触发点清单补进去；`AGENTS.md` 由 coordinator 按治理例外
  在验收后处理，本票不改。
- 热重载陷阱：改 `lib/agent-*` / 被 globalThis 闭包引用的模块后必须重启 dev server（`AGENTS.md` 有记）。
  dev 期间绝不要跑 `next build`。
- 实施票的门禁建议：`node --test lib/agent-recovery.test.mjs components/AgentDetailPanel.test.mjs`
  + `node_modules/.bin/tsc --noEmit` + `npm run lint`（本仓门禁是只报告，不改写文件）。

**风险与残留（写清楚，别给假保证）**

- 探测通过 ≠ 下一轮一定成功：账户级配额、上下文长度、工具失败等都可能在真实轮次里再次失败，
  那时轮次事件会如实把状态点写回 `error`。这是「状态点 = 上一次运行的事实」的固有语义，不是本设计的缺陷。
- 探测本身有成本（一次极小调用）：成本被「已在 error + 存在覆盖对」两个前置收窄，
  但红点状态下重复保存会重复付出（FIFO 串行 + 20s 上限有界）。
- 清空覆盖那条路径的缺口（见 Out of Scope）在本设计下**仍然存在**，用户仍可能看到
  「清空了覆盖、红点还在」；本设计选择不掩盖它（假绿比留红更坏）。
